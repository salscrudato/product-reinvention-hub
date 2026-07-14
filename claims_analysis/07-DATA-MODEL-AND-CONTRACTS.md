# 07 — Claims Analysis: Data Model & Wire Contracts

This document is the single reference for every data shape and wire contract the Claims Analysis
feature depends on: the persisted `BaseForm` entity, the two AI request payloads (`analyzeClaim`,
`identifyBaseForm`), the six-member SSE `StreamEvent` protocol that carries a streamed
determination from server to browser, the `Determination` object and its source-of-truth
`emit_determination` tool schema, the `ClaimsLineProfile` registry, and the `adapter.fns`
stream/call parsing contract. Every claim below is grounded in the code with `path:line`
citations; where the verified anchor and the code disagree, the **code wins** and the divergence
is called out in the "Discrepancies & nuances" section at the end.

---

## 0. Contract map (at a glance)

| Surface | Transport | Client caller | Server handler | Shape |
|---|---|---|---|---|
| `baseForms/{id}` | Cosmos via `adapter.db.mutate` | `BaseFormsLibrary.tsx` | `server/lib/data.js` batch | `BaseForm` entity |
| `identifyBaseForm` | JSON `POST /api/ai/identifyBaseForm` | `adapter.fns.call` | `identify-base-form.js` | req → `{title,formNumber,edition,lob,verified?}` |
| `analyzeClaim` | SSE `POST /api/ai/analyzeClaim` | `adapter.fns.stream` | `analyze-claim.js` | req → `StreamEvent[]` |
| `emit_determination` | Foundry tool call (server-only) | — | `_forcedToolCall` in `_shared.js` | tool `input_schema` → `Determination` |

Both AI routes are guarded server-side by `requireCapability('ai:invoke')` + `requireTenant`
(`server/lib/ai/index.js:26`), a per-tenant monthly budget throttle (`index.js:32-37`), and
`analyzeClaim` additionally sits behind the `page.claims` feature flag
(`server/server.js:158`, 403 `feature_disabled` when off). `POLICYHOLDER` holds no `ai:invoke`
capability, so neither route is reachable from that role.

---

## 1. The `BaseForm` entity

Defined at `app/src/components/claims/BaseFormsLibrary.tsx:16-33`. This is the persisted
left-pane record; the server mirrors it as an entity in Cosmos (partition `${tenantId}|baseForms`).

```ts
export interface BaseForm {
  id:             string
  title:          string
  formNumber:     string
  edition:        string
  lob?:           string   // detected line: 'HO' | 'PA' | 'GL' | ''
  fileName:       string
  storagePath:    string
  url:            string
  mediaType:      string
  status:         BaseFormStatus   // 'PROCESSING' | 'READY' | 'NEEDS_REVIEW'
  verified?:      boolean
  uploadedBy:     string
  uploadedByName: string
  createdAt?:     unknown
}
```

| Field | Req? | Written by | Notes |
|---|---|---|---|
| `id` | yes | client | `bf-${Date.now()}` (`BaseFormsLibrary.tsx:96`). Doc path is `baseForms/${id}`. |
| `title` | yes | client → server identify | Starts as `file.name`; replaced with `meta.title` after identify (`:140`). |
| `formNumber` | yes | server identify | Printed ISO form number (e.g. `HO 00 03`), or `''` if none read. |
| `edition` | yes | server identify | Edition date (e.g. `04 13`), or `''`. |
| `lob` | opt | server identify | Detected line code; drives the compact line chip + scenario starters. `''`/absent → GENERIC. |
| `fileName` | yes | client | Original upload name. |
| `storagePath` | yes | client | **`baseforms/{uid}/{id}/{filename}`** (`:101`). The blob key the server later fetches. |
| `url` | yes | `adapter.storage.upload` | Returned by `/storage/upload`. |
| `mediaType` | yes | client | `application/pdf` or `text/plain` (`:98`). Sent to `analyzeClaim` as `formStorageMediaType`. |
| `status` | yes | client + server | See enum below; the composer gate. |
| `verified` | opt | server identify | **Server-authoritative.** `false` only. See below. |
| `uploadedBy` / `uploadedByName` | yes | client | Actor identity re-sent on every update (full-replace). |
| `createdAt` | opt | server | Stamped by the mutation envelope; read as Firestore-ish `{toDate?, seconds?}` in `relativeTime` (`:61-70`). |

### `status` enum — `BaseFormStatus` (`app/src/lib/claims/baseForm.ts:10`)

| Value | Meaning | Analyzable? |
|---|---|---|
| `PROCESSING` | Identify pass running; record shown immediately on upload | no |
| `READY` | Identified (printed number **or** recognised line) + stored document present | **yes** |
| `NEEDS_REVIEW` | Identify returned neither a number nor a line, or threw | no |

Three **pure, unit-tested** rules govern the lifecycle (`baseForm.ts`):

- `statusAfterIdentify(meta)` → `READY` iff `meta.formNumber?.trim() || meta.lob?.trim()`, else
  `NEEDS_REVIEW` (`:21-24`). Never a silent empty-metadata `READY`.
- `isUnverified(form)` → `form.verified === false` (`:29-31`). `verified` does **not** gate
  status — a form whose number the catalogue couldn't confirm is still `READY` + analyzable (the
  attached document is the authority); it merely carries an "Unverified" chip.
- `isFormAnalyzable(form)` → `status === 'READY' && !!storagePath?.trim()` (`:36-38`). This is the
  composer gate in `Claims.tsx` (`composerReady`, `:194`) and the `ask()` guard (`:201`).

### Persistence: full-replace `mutate` (`BaseFormsLibrary.tsx`)

The upload flow does three writes through the adapter seam (no direct SDK — binding invariant):

1. `adapter.storage.upload(storagePath, file)` → blob (`:102-103`).
2. `adapter.db.mutate({op:'create', path:'baseForms/{id}', status:'PROCESSING', …})` (`:105-113`) — shows as "Processing" instantly.
3. After `identifyBaseForm`, `adapter.db.mutate({op:'update', …})` (`:136-146`) sets
   `title/formNumber/edition/lob`, `status: statusAfterIdentify(meta)`, and
   `...(meta.verified === false ? { verified: false } : {})`.

> **Critical:** `op:'update'` is a **FULL replace** (server does Upsert, not partial patch). Every
> field that must survive is re-sent — `storagePath/url/mediaType/fileName/uploadedBy/uploadedByName`
> are packed into `baseFields` and spread into both the success and the `catch` (→ `NEEDS_REVIEW`,
> `:163-167`) updates. Dropping them would orphan the blob pointer.

Duplicate-upload guard (`:151-158`): a verified, printed `formNumber` matching an existing
form's `normalizeFormNumber` + `edition` prompts **Use existing / Upload anyway**.

---

## 2. AI request payloads

### 2a. `analyzeClaim` request (SSE)

Built in `Claims.tsx:210-216`, consumed in `analyze-claim.js:62-99`.

```ts
const payload = {
  messages: wire,                                        // [{ role, content }]
  formNumber: selectedForm.formNumber,
  formStoragePath: selectedForm.storagePath,
  formStorageMediaType: selectedForm.mediaType ?? 'application/pdf',
  ...(selectedForm.lob ? { lob: selectedForm.lob } : {}),
}
```

| Field | Req? | Server use | Notes |
|---|---|---|---|
| `messages` | **yes** | `analyze-claim.js:64-68` | `[{role:'user'\|'assistant', content:string}]`. Empty → `{t:'error'}`+`{t:'done'}`. `wire` serialises prior card turns to text via `historyText`/`determinationToText` (`Claims.tsx:209,77-92`). |
| `formStoragePath` | opt | `:75-79` | If present, server emits `fetch:form` tool and pulls the blob to base64 via `_fetchBlobBase64` (container `AZURE_BLOB_CONTAINER`, default `'uploads'`). |
| `formStorageMediaType` | opt | `:95` | `media_type` for the native document block; server falls back to `body.mediaType` then `'application/pdf'`. |
| `formNumber` | opt | `:92,138` | Labels the extracted-text block; also the **guaranteed footer** form number on the determination. |
| `lob` | opt | **NOT READ** | Sent by client but the server never reads `body.lob` — see Discrepancy #1. |
| `formBase64` / `formText` | opt | `:80-81` | Server-supported fallbacks (used when there is no blob). The current client does **not** send these; it always uses `formStoragePath`. |

The server derives the document block in priority order (`:90-98`): extracted PDF text
(if `>100` chars, sliced to `60_000`) as a `{type:'text'}` block → native `{type:'document'}`
base64 block → `"(No form document available…)"`. There is **no** `analyzeClaim` JSON response body;
the entire result streams as `StreamEvent`s (§3).

### 2b. `identifyBaseForm` request + response (JSON)

`adapter.fns.call('identifyBaseForm', payload)` (`BaseFormsLibrary.tsx:130`) → `identify-base-form.js:73`.

**Request** (one of two, `BaseFormsLibrary.tsx:127-129`):

```ts
isPdf ? { formBase64, mediaType, fileName }   // PDF
      : { formText,   fileName }              // .txt / .md
```

| Field | Req? | Notes |
|---|---|---|
| `formBase64` | one-of | Chunked base64 of the file. |
| `formText` | one-of | Decoded text for non-PDF uploads. Missing both → `400 missing_form` (`:76-78`). |
| `mediaType` | opt | `media_type` for the native document fallback (`:114`). |
| `fileName` | opt | Only used as the `title` fallback; **never** mined for a form number (`:69-70`). |

**Response** — `{ title, formNumber, edition, lob, verified? }`. `verified` is
**server-authoritative** and its *presence* varies by path:

| Path | Cost | Response `verified` |
|---|---|---|
| Regex fast path (`:84-95`) — a `FORM_NUM_RE` match found | **none** (no AI) | Always present: `true` iff prefix ∈ `LOB_BY_PREFIX`, else `false`. |
| AI fallback (`:119-129`) — number found & recognised | haiku (`BULK_VERIFY`) | **omitted** (treated as verified). |
| AI fallback — number found, prefix not recognised | haiku | `verified: false` (`:129` spread). |
| AI fallback — no number / no line | haiku | **omitted**. |
| AI not configured (`:99-101`) | none | `verified: false`. |

The client only special-cases `meta.verified === false` (the Unverified chip + dedupe skip,
`:143,152`), so an omitted `verified` is treated as verified. `regexExtract` (`:39-51`) picks the
first `FORM_NUM_RE` match as `formNumber`, parses `EDITION_RE` (`:33`), and maps prefix→lob via
`LOB_BY_PREFIX` (`:11-24`: `CG/GL→GL`, `HO/DP→HO`, `PP/PA/CA→PA`, `IM/FM→IM`, `CP/BPP/IL→PR`).

---

## 3. The SSE `StreamEvent` protocol — the load-bearing browser↔server contract

`analyzeClaim` communicates entirely through a six-member discriminated union. The server union
lives implicitly in `emit()` calls (`analyze-claim.js`); the **client union is declared verbatim**
at `Claims.tsx:27-33`. These two definitions have no shared type import — **they must be kept in
sync by hand**, and the client comment even flags it as a "mirror of `functions/src/runtime.ts`".

```ts
// Claims.tsx:27-33
type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }
  | { t: 'notice'; level: 'info' | 'warn'; message: string; refs?: string[]; kind?: NoticeKind }
  | { t: 'error'; message: string }
  | { t: 'done' }
```

| `t` | Fields | Emitted by | Consumed by | Purpose |
|---|---|---|---|---|
| `token` | `v: string` | (not emitted by `analyzeClaim` today — reserved) | `Claims.tsx:234-243` | Incremental assistant text; RAF-batched into `text`. |
| `tool` | `name`, `phase:'start'\|'end'`, `summary?` | `analyze-claim.js:76,78,82,84,100,140` | `Claims.tsx:244-257` | Progress chips (`fetch:form`, `load:context`, `emit_determination`). |
| `json` | `key:'determination'`, `value:Determination` | `analyze-claim.js:141` | `Claims.tsx:258-276` | The structured determination → `DeterminationCard`. |
| `notice` | `level`, `message`, `refs?`, `kind?` | `analyze-claim.js:146` (`kind:'unverified'`) | `Claims.tsx:277-280` | Non-fatal advisory (unverified citations, budget, degrade). |
| `error` | `message` | `analyze-claim.js:68,70,150` | `Claims.tsx:281-282` | Fatal, appended to text with a ⚠️. |
| `done` | — | `analyze-claim.js:68,70,148,151` | `Claims.tsx:283` | Turn terminator (always the last frame). |

### Serialization

Server (`_shared.js:18`): `emit = (res, ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`)` after
`sse(res)` sets `Content-Type: text/event-stream` + `no-cache` + keep-alive (`:12-17`). Each event
is one `data: <json>` line followed by a blank line.

### Ordering guarantees within a single `analyzeClaim` turn

```mermaid
sequenceDiagram
    participant S as analyze-claim.js
    Note over S: sse(res); validate messages[]; fleet.guard()
    opt formStoragePath present
      S->>Client: tool fetch:form start / end
    end
    S->>Client: tool load:context start / end
    S->>Client: tool emit_determination start
    Note over S: _forcedToolCall → emit_determination
    S->>Client: tool emit_determination end
    S->>Client: json determination
    opt cited refs not in portfolio context
      S->>Client: notice (kind:unverified, level:warn)
    end
    S->>Client: done
```

Guarantees: `done` is always last; `json determination` (when present) precedes any `unverified`
notice and always precedes `done`; `tool …end` follows its matching `…start`. The **error path**
(`:149-152`, or the two early guards) emits `{t:'error'}` then `{t:'done'}` and nothing else — so
`shouldRenderDetermination` never has to defend against a card on that path; the no-blank-bubble
guard (§4) covers it instead.

---

## 4. The `Determination` object + `emit_determination` tool schema

### 4a. `Determination` interface (`app/src/lib/claims/determination.ts:8-40`)

```ts
export type Verdict = 'COVERED' | 'NOT_COVERED' | 'PARTIAL' | 'NOT_ADDRESSED'

export interface Determination {
  verdict:     Verdict
  summary:     string
  coverages:   DeterminationCoverage[]     // { name, refId?, formNumber?, definition }
  exclusions?: DeterminationExclusion[]    // { name, refId?, formNumber?, note? }
  limits:      DeterminationLimit[]        // { label, value, source?, note? }
  reasoning:   string[]
  considerations?: string[]
  openItems?:  string[]
  citations?:  string[]
  formNumber?: string
  coverageGap?: { note: string; sources?: string[] }   // NOT_ADDRESSED / PARTIAL only
  unverifiedCitations?: string[]                        // SERVER-authoritative signal
}
```

| Field | Req? | Source | Card section (`DeterminationCard.tsx`) |
|---|---|---|---|
| `verdict` | yes | model | Emblem + accent bar + `VERDICT[]` label/headline (`:25-30,271`). |
| `summary` | yes | model | Hero paragraph (`:277`). |
| `coverages` | yes* | model (normalised) | "Document citations" accordion `DocCitation` (`:227-229`). |
| `exclusions` | opt | model (normalised) | Same accordion, danger-dot (`:230-232`). |
| `limits` | yes* | model | "Limits & deductibles" `ValueRow`; split by `/deduct/i` (`:190-193,242-243`). |
| `reasoning` | yes | model | "Why it's <verdict>" cited `Point`s, sliced to 3 (`:180,207-213`). |
| `considerations` | opt | model | "Things to consider"; falls back to `openItems` (`:184,215-221`). |
| `openItems` | opt | (legacy) | "Not determined by the form" callout, only when distinct (`:187,293`). |
| `citations` | opt | model | Feeds "Data citations" provenance chips (`:202`). |
| `formNumber` | opt | body/model | Footer "Grounded in …" (`:338`); client guarantees it (`Claims.tsx:262`). |
| `coverageGap` | opt | model | Warn callout + "Create product feedback" (`:306-334`). Only `NOT_ADDRESSED`/`PARTIAL`. |
| `unverifiedCitations` | opt | **server (legacy)** | Not rendered; gates `shouldRenderDetermination` — see Discrepancy #2. |

`*` `coverages` and `limits` are non-optional in the interface, but the card defaults both to `[]`
(`:178,191`) so a partial payload renders cleanly. The server always sends `coverages: []` and does
**not** send `limits` at all (see #3).

### 4b. `emit_determination` tool `input_schema` (`analyze-claim.js:7-50`)

| Property | Type | Constraint / description |
|---|---|---|
| `verdict` | string enum | `[COVERED, NOT_COVERED, PARTIAL, NOT_ADDRESSED]` |
| `summary` | string | "Three-sentence coverage summary." |
| `reasoning` | string[] | "Exactly 3 … each citing `[formSection]` or `[refId]`." |
| `considerations` | string[] | "Exactly 3." |
| `coverages` | object[] | items `{name, refId?, formNumber?, definition}`, **required** `name`+`definition`. |
| `exclusions` | object[] | items `{name, refId?, formNumber?, note?}`, **required** `name`. |
| `citations` | string[] | free tokens. |
| `formNumber` | string | — |
| **`required`** | — | `['verdict', 'summary', 'reasoning', 'considerations']` |

Note the schema has **no `limits`, `openItems`, or `coverageGap`** properties — those interface
fields are never populated by the deployed `analyzeClaim` handler (Discrepancy #3).

### 4c. Tool output → `Determination` (server transforms, `analyze-claim.js:103-139`)

The handler is not a pass-through; it applies **server-authoritative** transforms:

1. **Citation downgrade** (`:103-107`): if a substantive verdict
   (`COVERED`/`NOT_COVERED`/`PARTIAL`) has **zero** reasoning entries containing a `[` bracket, the
   verdict is forced to `NOT_ADDRESSED` and the summary is annotated
   *"(Determination downgraded to NOT_ADDRESSED: no cited reasoning provided.)"*.
2. **Coverage/exclusion normalisation** (`:110-129`): accepts the new object shape **and** legacy
   `{coverage, applicable, note}` / plain strings, mapping to `{name, refId?, formNumber?, definition|note}`.
3. **`formNumber`** (`:138`): `body.formNumber || raw.formNumber || ''` (the footer is guaranteed).
4. **Unverified-citation sweep** (`:142-146`): collect all cited tokens (from `citations[]` +
   `[bracket]` matches in `reasoning`); for any token **not** found bracketed in the portfolio
   context `ctx` **and not** starting with a digit, emit a **separate** `{t:'notice', kind:'unverified',
   level:'warn', refs:[…]}` event. **It does not set `determination.unverifiedCitations`** — see #2.

### 4d. Client render guard (`determination.ts:54-71`)

```ts
SUBSTANTIVE_VERDICTS = ['COVERED', 'NOT_COVERED', 'PARTIAL']

isDeterminationCited(d)  // true if any: explicit citation, coverage refId|formNumber,
                         // exclusion refId|formNumber, limit source, or [bracket] in reasoning.
                         // The always-present footer formNumber does NOT count alone.

shouldRenderDetermination(d)
  // non-substantive → always render
  // substantive + unverifiedCitations.length>0 → refuse
  // else → isDeterminationCited(d)
```

Applied in `Claims.tsx:262-274`: on the `json determination` event the client injects the footer
`formNumber`, then either renders the card (and serialises it into `historyText`) or replaces it
with *"I couldn't ground that determination in the form — please rephrase the scenario."* This is
**defense in depth** mirroring the server downgrade — a fabricated citation must never reach the
card. The no-blank-bubble invariant (`bubble.ts:19-25`, priority
`determination > text > notice > thinking > fallback`) guarantees every terminal SSE path shows
*something*.

---

## 5. The `ClaimsLineProfile` registry (`shared/src/claims/lineProfiles.ts`)

```ts
export type ClaimsLineCode = 'HO' | 'PA' | 'GL'

export interface ClaimsLineProfile {
  code:        ClaimsLineCode | 'GENERIC'
  displayName: string            // e.g. "General Liability" — chip tooltips
  briefing:    string            // one coverage-analyst paragraph (trigger, limit/aggregate, exclusions)
  scenarios:   readonly string[] // one-tap loss starters (GENERIC has none)
}
```

Registry: `HO_PROFILE`, `PA_PROFILE`, `GL_PROFILE` in `PROFILES` (`:118-122`) + `GENERIC_PROFILE`
(`DEFAULT_CLAIMS_LINE_PROFILE`, `:125`). Two resolvers:

| Function | Signature | Behaviour |
|---|---|---|
| `resolveClaimsLineProfile(code?)` | `:133-136` | Case-insensitive; unknown/empty/`'OTHER'` → `GENERIC`. |
| `claimsLineCodeFromFormNumber(num?)` | `:142-148` | `HO*→HO`, `PP*→PA`, `CG*→GL`, else `''`. |

**Why it is separate from `LOB_REGISTRY`:** the portfolio LOB registry
(`shared/src/insurance/lobRegistry.ts`) drives Products/Explorer/segmentation and is asserted
*exactly* by `lobRegistry.test.ts`. A claims form need not correspond to a seeded product, so adding
a line profile here **never ripples portfolio-wide** (`lineProfiles.ts:9-11`). Client consumers:
`Claims.tsx:170` (scenario starters + `lineTitle` tooltip) and `BaseFormsLibrary.tsx:38-41`
(line-chip tooltip). Note the code enum here is only `HO|PA|GL`, while the identify `lob` enum is
`HO|PA|GL|IM|PR` — an `IM`/`PR` form resolves to `GENERIC` (graceful, but no dedicated briefing).

---

## 6. The `adapter.fns` stream / call parsing contract (`app/src/lib/backend/azure.adapter.ts`)

### `fns.call` (JSON) — `:332-334`

```ts
async call<TIn, TOut>(name, data) { return api<TOut>(`/ai/${name}`, { method: 'POST', body: JSON.stringify(data) }) }
```

`api()` (`:38-67`) attaches `Authorization: Bearer <token>`, throws `MutationConflictError` on 409,
clears token on 401, and surfaces the server's honest `detail`/`error` on other non-2xx (so an
upload size cap shows its real message instead of a generic toast). This is how `identifyBaseForm`
is called.

### `fns.stream` (SSE) — `:336-359`

```ts
async stream(name, data, onChunk, signal) {
  const res = await fetch(`${API}/api/ai/${name}`, { method:'POST',
    headers:{ 'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{}) },
    body: JSON.stringify(data), signal })
  if (!res.ok || !res.body) throw new Error(`Stream ${name} failed: ${res.status}`)
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop() ?? ''
    for (const line of lines) if (line.startsWith('data: ')) onChunk(line.slice(6))
  }
}
```

Contract details that matter:

- **Framing:** splits the byte stream on `\n`, keeps the trailing partial line in `buf`, and for
  every complete line beginning `data: ` (6 chars) passes **the JSON after the prefix** to
  `onChunk`. The blank line that separates SSE events (from `emit`'s `\n\n`) is a non-`data:` line
  and is safely ignored.
- **Payload to `onChunk`:** a raw JSON *string* of one `StreamEvent`. `Claims.tsx:231-232`
  `JSON.parse`s it inside a `try/catch` that silently drops an unparseable chunk.
- **Abort:** the caller passes `controller.signal`; `Claims.tsx` aborts on new form selection and
  on unmount (`:174,177,226-228`) so a stale stream can't bleed into a new thread.
- **`AbortError` is swallowed** (`Claims.tsx:288`); any other stream error is written into the
  bubble text.

---

## 7. Required / optional / server-authoritative — consolidated

**Server-authoritative fields (client cannot forge; server sets or overrides):**

| Field | Owner | Rule |
|---|---|---|
| `Determination.verdict` (downgrade) | `analyze-claim.js:104-106` | Forced `NOT_ADDRESSED` if no cited reasoning. |
| `Determination.formNumber` | server `:138` / client footer guarantee `Claims.tsx:262` | body/model, never blank on the card. |
| `unverified` notice `refs` | `analyze-claim.js:145-146` | Emitted, not a field on the determination (see #2). |
| `BaseForm.verified` | `identify-base-form.js:87,93,128-129` | Catalogue confirmation; `false` only. |
| `BaseForm.status` | client via `statusAfterIdentify` on server meta | Honest identification. |
| deployment/model | `fleet.resolveModel(...)` server-side | Never a client-sent model string. |

**Client-guaranteed on the wire:** `messages[]` non-empty, `formStoragePath` for an analyzable
form (composer gate), `formNumber` footer injection.

---

## 8. Discrepancies & nuances found (reverse-engineering findings)

1. **`lob` is sent but never read by the server.** `Claims.tsx:215` includes `lob` in the
   `analyzeClaim` payload, but `analyze-claim.js` never references `body.lob`, and `CLAIMS_SYSTEM`
   (`:52-60`) is deliberately line-agnostic ("Determine the line FROM THE FORM"). The
   `ClaimsLineProfile.briefing` paragraph is **client/UX-only** (scenario starters + chip labels);
   it is **not** injected into the determination prompt. This matches the anchor's flagged finding —
   confirmed against the code. *Opportunity:* the per-line briefing could be appended to
   `systemBlocks` server-side to make determinations line-aware.

2. **The deployed server never sets `Determination.unverifiedCitations`.** The interface field
   (`determination.ts:39`) and the client guard branch (`shouldRenderDetermination`, `:69`) exist,
   but `analyze-claim.js` surfaces unverified citations only as a **separate `notice` event**
   (`:146`), not by populating the field. The only code that sets `unverifiedCitations` on a
   determination is the **legacy, non-deployed** `functions/src/claims.ts:372`. So on the live
   Azure path the client's `unverifiedCitations` branch is **latent defense-in-depth** — it can only
   fire against a cached/legacy payload, never against a fresh deployed response. (01-OVERVIEW.md
   describes it identically as "latent defense-in-depth".)

3. **`limits`, `openItems`, and `coverageGap` are in the interface but not in the tool schema.**
   `emit_determination` (`:10-49`) has no `limits`/`openItems`/`coverageGap` properties, and the
   assembled determination object (`:130-139`) omits them. So the "Limits & deductibles" and
   "Coverage gap" card sections and the gap→feedback loop (`gapFeedback.ts`) are **defined and
   render-ready but not currently fed by the deployed analyze handler** — they render only if a
   payload carries those fields (e.g. legacy/functions path or a future schema addition). The
   client is correctly defensive (`DeterminationCard.tsx:178-193` default everything to `[]`).

4. **`token` events are declared but not emitted by `analyzeClaim`.** The client handles `token`
   (RAF-batched text) and the union includes it, but the deployed `analyze-claim.js` emits only
   `tool`/`json`/`notice`/`error`/`done` — the determination arrives as one `json` frame, not
   streamed prose. The `token` handling is shared plumbing kept for the streaming-chat handlers and
   forward-compat.

5. **`verified` presence is asymmetric** between the regex fast path (always present) and the AI
   fallback (present only when a number was read but unrecognised). Documented in §2b; the client's
   `=== false` check makes this safe, but a consumer expecting `verified` to always exist would be
   surprised on the AI-recognised path.

---

## Related documents

- [README.md](./README.md) — dossier index
- [01-OVERVIEW.md](./01-OVERVIEW.md) — what Claims Analysis is, at a glance
- [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) — component & module topology
- [03-BACKEND-PIPELINE.md](./03-BACKEND-PIPELINE.md) — the `analyzeClaim` server flow end to end
- [04-MULTI-MODEL-ORCHESTRATION.md](./04-MULTI-MODEL-ORCHESTRATION.md) — fleet roles, cost guard, degrade
- [05-EMBEDDINGS-AND-RAG.md](./05-EMBEDDINGS-AND-RAG.md) — hybrid grounding that feeds portfolio context
- [06-FRONTEND.md](./06-FRONTEND.md) — `Claims.tsx`, library, card, SSE consumption
- **07-DATA-MODEL-AND-CONTRACTS.md** — this document
- [08-DESIGN-PATTERNS.md](./08-DESIGN-PATTERNS.md) — the invariants & patterns behind these shapes
- [09-RECREATE-FROM-SCRATCH.md](./09-RECREATE-FROM-SCRATCH.md) — rebuild guide
- [10-INVARIANTS-AND-TESTS.md](./10-INVARIANTS-AND-TESTS.md) — the guards & their tests
- [code-inventory.md](./code-inventory.md) — file-by-file index
