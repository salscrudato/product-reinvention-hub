# 03_CODE_BUNDLE.md — Curated Source Inventory and Key Code Patterns

This file is a structured code tour rather than a raw dump. It documents the key algorithms, patterns, and non-obvious implementation choices across the three workspaces. For verbatim source, cite the paths given below — Fable should treat this as a navigational guide, not a complete copy.

All paths are relative to the repo root. Node versions: Node 20 (functions), browser (app), Node 20 (shared tests).

---

## Domain A — AI Backend (`functions/src/`)

### A1. Runtime Plumbing (`functions/src/runtime.ts`, 163 lines)

The single source of truth for:
- Model constants (`MODEL`, `MODEL_FAST`)
- Prompt cache control (`CACHE_1H`)
- Anthropic client factory (`anthropic()`)
- Firebase Admin SDK initialization (guarded with `getApps().length`)
- SSE helpers (`openSse`, `send`)
- Auth helpers (`authenticate`, `requireRole`)
- Retry classification (`isRetryableAnthropicError`)

**Key pattern — partial-stream recovery:** `isRetryableAnthropicError` is used AFTER the SDK's own `maxRetries: 4` (which covers connection setup). The app adds a second retry layer inside `streamTurn()` (`ai.ts`) to recover from faults that surface mid-stream (not covered by the SDK's retry logic), with 400ms/800ms backoff.

**Key pattern — no sampling on Sonnet 5:** `anthropic().messages.create({model: MODEL, ...})` never includes `temperature`, `top_p`, or `top_k`. Sonnet 5 rejects these with HTTP 400 when adaptive thinking is active. The reasoning path is constrained purely by system prompt + tool results.

### A2. Portfolio Chat Agent Loop (`functions/src/ai.ts`, ~450 lines)

**`runChatAgent(client, messages, res, opts)`** — the shared agentic loop driving portfolio chat, rule drafting, and scaffolding:
1. Calls `anthropic().messages.stream(params)` with the tool set
2. On `content_block_delta` events: accumulates text deltas, calls `send(res, {t:'token', v:delta})`
3. On `stop_reason: 'tool_use'`: dispatches each tool call to `runTool()` and appends the results
4. Loop continues up to `maxTurns` (6 normally, 3 when degraded)
5. On `stop_reason: 'end_turn'` or turn limit: sends `{t:'done'}`

**`buildSystemBlocks(opts)`** — assembles the system prompt as an array of content blocks:
1. Grounding tools (always first, with `CACHE_1H` on the last tool block)
2. `SYSTEM_PROMPT` (stable; sits before the cache breakpoint)
3. Portfolio digest (injected as a stable system block inside the cache breakpoint)
4. Optional volatile focus (productId-specific briefing; placed after the breakpoint so it never invalidates the stable cache)

**`sseCostGate(res, feature, sessionKey)`** — shared pre-flight for all SSE endpoints:
1. Calls `guardSpend(feature, sessionKey)` from Firestore
2. `deny` → sends `{t:'error'}` and ends the response immediately
3. `degrade` → reduces `maxTurns`, skips citation augmentation; sends `{t:'notice', level:'warn'}`
4. `allow` → proceeds normally

**`streamTurn(client, params, res)`** — single Anthropic call with partial-stream recovery:
- Attempt 1–3 with exponential backoff (400ms, 800ms)
- Only retries if `isRetryableAnthropicError(err)` returns true
- On a mid-stream retry, the accumulated text so far is lost (the token delta is not re-sent); the client re-renders from the start of the new attempt

**Chat endpoint** (the full `chat` onRequest handler, `ai.ts:380-450`):
1. `authenticate(req)` → `caller`
2. `sseCostGate(...)` → action
3. `openSse(res)`
4. Build semantic cache key (Voyage embedding or hash of query)
5. Check semantic cache (freshness gate + similarity gate + haiku verifier)
6. On cache hit → stream cached answer + `{t:'notice', level:'info', message:'cached'}`
7. On cache miss → RAG retrieval (`retrieve(params)`) → inject as system block → `runChatAgent(...)` → write to semantic cache with citation anchors
8. Citation verification → any unverified refId triggers a `{t:'notice', level:'warn', refs:[...]}` notice
9. `bumpSpend(feature, sessionKey, cost)` → update Firestore cost counters

### A3. Claims Copilot (`functions/src/claims.ts`, ~530 lines)

**Multi-turn structure:**
```
authenticate → openSse → sseCostGate
→ fetch baseForms[formId] from Firestore
→ fetch PDF from Storage → pdfText() → text string
→ buildMessages(): [
    {role:'user', content:[
      FORM_SANDBOX_NOTE (text block),
      {type:'document', source:{type:'text', ...pdfText}, cache_control: CACHE_1H},
      scenario description
    ]}
  ]
→ runClaimsAgent() — max 6 turns
  → on emit_determination tool call:
      verifyDetermination(result, knownCitations)  // drops unverified citations
      send(res, {t:'json', key:'determination', value:result})
      if verdict is substantive and citations empty → return {needsCitationRetry: true}
→ send(res, {t:'done'})
→ bumpSpend(...)
```

The `{type:'document', cache_control: CACHE_1H}` on the PDF text block is the key caching optimization: the document is only uploaded to Anthropic's API on the first request; subsequent multi-turn messages in the same session reuse the cached document block.

**Grounding invariant enforcement:** if the model emits a determination with `verdict !== 'NOT_ADDRESSED'` and zero citations, the loop re-invokes with a `{role:'user', content:'[...your previous determination had no citations...]'}` message and decrements the turn budget. The model must retry with citations.

**`identifyBaseForm` two-pass:** haiku call (max 400 tokens) → if `!formNumber && !recognizedLob` → sonnet-5 escalation. Both use `identify_form` forced tool. Result written to `baseForms/{id}` via `auditedMerge()`.

### A4. Coverage Extraction (`functions/src/extract.ts`, ~300 lines)

**Four-section pipeline:**
```
for section in [coverages, forms, rules, rating]:
  result = runSection(client, document, section, MODEL_FAST, tools)
  sanitized = sanitize(result)
  if sectionNeedsEscalation(result, sanitized):
    result = runSection(client, document, section, MODEL, tools)
    sanitized = sanitize(result)
  accumulate(sanitized)
```

**`sectionNeedsEscalation(raw, sanitized)`:**
- Coverages/forms: escalate if `raw.items.length > 0 && sanitized.items.length === 0` (ALL items dropped by sanitizer — hallucination signal)
- Coverages: also escalate if `sanitized.items.length === 0` (empty — under-read signal)

**Sanitization** (in `shared/src/insurance/extraction.ts`):
- Drops items without `citation`
- For `propose_forms`: calls `verifyText(formNumber, pdfText)` — drops any form number not literally present as a substring in the PDF text (prevents hallucinated form numbers)

### A5. Market News Scout (`functions/src/news.ts`, ~300 lines)

Uses `web_search_20250305` Anthropic built-in tool (5 max uses per call). The `pause_turn` continuation loop handles the case where the model issues fewer than 8 items but wants to search more. Each raw item goes through:
1. `verifyItems(items)` — HEAD probe each URL; drops 404/410/timeout
2. `resolveImageUrl(item)` — fetch OG/Twitter meta tags or first inline image; HEAD probe content-type; fallback to generated tile
3. `storeItems(items, productIds)` — SHA-1 dedup; `relatedProductIds` matched by LOB/state substring

### A6. Cost Guard (`functions/src/costGuard.ts`, 162 lines)

**Three Firestore counters** (all in `costCounters` collection):
- `day-{YYYY-MM-DD}` — global daily rolling total (USD)
- `feat-{feature}-{YYYY-MM-DD}` — per-feature daily total
- `sess-{sessionKey}-{YYYY-MM-DD}` — per-session daily total

**`guardSpend(feature, sessionKey): Promise<'allow'|'degrade'|'deny'>`:**
1. `getDoc` on breaker doc (`costCounters/breaker-anthropic`)
2. If breaker is `open` and `openedAt` < 1 hour ago → return `degrade`
3. `getDocs` (3 concurrent reads) on day/feat/sess counters
4. Compare each against cap ladder from `shared/src/cost/budget.ts`
5. Returns `deny` if any hard cap exceeded; `degrade` if any soft cap exceeded; `allow` otherwise

**`bumpSpend(feature, sessionKey, estimatedUsd): Promise<void>`:**
1. Increments all three counters in a Firestore `runTransaction`
2. Updates `aiUsage` collection for the Admin cost tab via `telemetry.ts`
3. If global daily total now exceeds the breaker threshold → opens the circuit breaker

**Pure budget logic** (`shared/src/cost/budget.ts`, 93 lines): the cap ladder is a pure function of feature name → `{softCap, hardCap, sessionCap}` (no Firestore I/O). Keeps the budget thresholds unit-testable without mocking Firestore.

---

## Domain B — Shared Library (`shared/src/`)

### B1. Rating Engine (`shared/src/rating/evaluator.ts`)

**`evaluate(program, inputs, rtGetter, ldGetter): EvaluatorResult`** — line-agnostic:
```ts
let running = 0
for (const step of program.steps.sort(byOrder)) {
  if (step.condition && !inputs[step.condition]) continue  // conditional skip
  const factor = resolveSource(step.source, inputs, rtGetter, ldGetter)
  running = applyOp(step.op, running, factor, program.minimumPremium)
  if (step.roundTo != null) running = round(running, step.roundTo)
  trace.push({ stepId, label, op, sourceRef, factorOrAmount: factor, rounded, runningTotal: running })
}
return { finalPremium: running, trace }
```

**Canary (must never change):** `evaluate(HO3_PROGRAM, HO3_WORKED_EXAMPLE, rtGetter, ldGetter).finalPremium === 1528`

### B2. LOB Registry (`shared/src/insurance/lobRegistry.ts`, 268 lines)

Defines the registered Lines of Business. Each LOB entry provides:
- `prefix` (e.g. `'HO'`, `'PA'`)
- `name` (e.g. `'Homeowners'`, `'Personal Auto'`)
- `ratingKit`: the line's rating kit (input field definitions + `workedExample` + `makeRtGetter` + `makeLdGetter`)
- `rulesEngine`: the line's rules engine entry point

Key exports: `resolveLob(product)`, `resolveLobByRefId(refId)`, `resolveRatingKit(prefix)`, `LOB_REGISTRY`, `DEFAULT_LOB`.

Used by: rating digest (`portfolioDigest.ts`), scaffold verification (`scaffoldProduct.ts`), extraction escalation (`extract.ts`), refId allocation (`firebase.adapter.ts`).

### B3. ISO Import (`shared/src/insurance/isoImport.ts`)

Parses an ISO workbook (Excel, read via `exceljs`) into the canonical domain types. Maps ISO column names to coverage/form/rule schemas. Called by `app/src/lib/import/importProduct.ts` which persists the result via `adapter.db.mutateBatch()`. Test: `app/src/lib/import/isoFixture.test.ts` (golden snapshot regression harness for Phase 0).

### B4. DuckCreek Export (`shared/src/duckcreek/`)

Pure client-side XML serialization. No server call needed.
- `mapping.ts` — canonical domain types → DuckCreek parameterized field mapping (384 lines)
- `serialize.ts` — walks the mapping tree and emits DuckCreek XML
- `xml.ts` — low-level XML builder (attribute escaping, element nesting)
- `validate.ts` — pre-export validation (required fields, enum values)
- `guid.ts` — deterministic GUID generation (hash of refId for stable re-exports)

Server-side: `functions/src/exportDuckCreek.ts` — callable that records the `manuScriptID` in the AuditEvent and returns presigned download metadata.

### B5. Rules Engine (`shared/src/rules/`)

Two line-specific engines:
- HO-3 rules: `SelectionContext` → `RulesResult` (evaluates 10+ rules including eligibility [HO.RU.001], wind/hail option gating, Coverage E limit gating, form attachment rules)
- Personal Auto rules: `PASelectionContext` → `RulesResult` (evaluates PA.RU.001–009: eligibility, UM/UIM ≤ BI limit constraint, physical damage dependency for rental/towing)

Both engines return `evaluatedRuleRefIds` — the set of rule refIds the engine actually checked — so the UI can show a live satisfied/violated badge for those specific rules.

### B6. GTM Process Scheduler (`shared/src/gtm/`)

`shared/src/gtm/` contains the back-scheduling logic: given a `targetLaunchDate` and the standard L1–L4 insurance product process, computes `startDate` and `dueAt` for each task by walking backwards from the deadline. The process template lives in `shared/src/seed/gtmProcess.ts`.

### B7. Retrieval — Lexical Fallback (`shared/src/retrieval/`)

`shared/src/retrieval/retrieve.ts` — TF-IDF lexical ranker:
- Tokenizes chunk text and query
- Computes per-token IDF across the chunk corpus
- Returns top-K chunks by cosine similarity on TF-IDF vectors
- Zero external dependencies; works without Voyage key

---

## Domain C — Frontend (`app/src/`)

### C1. Adapter Seam (`app/src/lib/backend/`)

The adapter pattern enforces the invariant: no Firebase SDK imports outside this directory. All component code imports only from `app/src/lib/backend/index.ts` (which re-exports `{ adapter }`).

`types.ts` defines the `BackendAdapter` interface. `firebase.adapter.ts` implements it. The AWS swap comment (`// AWS-SWAP`) in `firebase.adapter.ts` marks every seam where the Firebase SDK call would be replaced.

**`mutate()` → `runTransaction()`:** Every entity create/update/delete runs as a Firestore transaction that: reads the current entity (for rev check + diff), writes the entity, writes an auditEvent, writes a version (with field-level diff), and writes the searchIndex entry. All four writes commit or none do.

**`stream()` (SSE):** Issues a POST with Bearer token to the function URL. Reads the response body as a ReadableStream, decodes SSE `data:` lines as JSON, and dispatches typed `StreamEvent` objects to the caller's `onChunk` callback. Caller-owned AbortSignal for cancellation on unmount/conversation switch.

### C2. React Context Architecture

**`UserContext`** (`app/src/context/UserContext.tsx`): subscribes to `adapter.auth.onUser()`. Extracts `uid`, `email`, `name`, `role` from the Firebase ID token claims. All role gates in the UI check `user.role`.

**`ProductContext`** (`app/src/context/ProductContext.tsx`): subscribes to all product sub-collections (`coverages`, `rules`, `formRules`, `ratingPrograms`) via real-time `onSnapshot`. Provides the live product data tree to all `ProductWorkspace` tabs. Unmounts all subscriptions on product navigation.

**`CaptureContext`** (`app/src/context/CaptureContext.tsx`): global feedback capture panel state. Stores the current `captureContext` (route + label + entityPath + refId) published by each page/component. The capture panel's submit flow calls `adapter.fns.call('shapeFeedback', {...})`.

### C3. SSE Streaming Pattern (used on Home, Claims, Rules, Scaffold pages)

```ts
// Pattern used across all SSE surfaces
const controller = new AbortController()
adapter.fns.stream('chat', payload, (event) => {
  if (event.t === 'token') {
    // RAF-batched: schedule the DOM update on the next animation frame
    requestAnimationFrame(() => {
      setTokens(prev => prev + event.v)
    })
  } else if (event.t === 'json') {
    setStructuredResult(event.value)
  } else if (event.t === 'notice') {
    setNotice(event)
  } else if (event.t === 'done') {
    setStreaming(false)
  } else if (event.t === 'error') {
    setError(event.message)
  }
}, controller.signal)

// Cleanup on unmount or conversation switch
return () => controller.abort()
```

RAF-batching prevents layout thrash during high-frequency token streaming. The `sessionId` (UUIDv4 per conversation start) is passed in `payload` for per-session cost scoping.

### C4. Design Token System (`app/src/index.css`)

Tailwind CSS v4 `@theme` block defines all color/spacing/radius/shadow tokens. No hard-coded hex values in component code. Token names follow `--color-{name}` convention. Component code uses `var(--color-brand)`, `var(--color-surface)`, etc. The only exception is SVG files exported to disk.

**Invariant:** `refId` chips and form-number chips are styled with `--color-chip-ref` and `--color-chip-form` tokens respectively. These chips are load-bearing display elements and must never be omitted or replaced with plain text.

### C5. Rating Worksheet (`app/src/routes/product/ProductPricing.tsx` + `app/src/components/product/RatingWorksheet.tsx`)

HO-3 has a bespoke `RatingWorksheet` component that mirrors the ISO pricing worksheet. Other lines use a data-driven `DynamicRatingForm` driven by `RatingInputField[]` from the LOB kit. Both submit inputs to `run_rating` (via the chat tool — the pricing panel sends a pre-canned message to the chat function to invoke the `run_rating` grounding tool and returns the `EvaluatorResult`). ASSUMPTION: the pricing panel may use a direct `adapter.fns.call()` to a dedicated rating endpoint rather than the chat flow; exact routing not confirmed.

---

## Key Invariants in Code

| Invariant | Enforcement location |
|---|---|
| All AI calls server-side | `functions/` only; `VITE_*` env vars contain no API keys |
| No bare Firestore writes | `mutate()` / `mutateBatch()` in `firebase.adapter.ts`; `auditedMerge()` in `audited.ts` |
| Grounded AI responses | `SYSTEM_PROMPT` house rules + tool-only data; `verifyDetermination()`, `verifyDraft()`, `verifyScaffold()` |
| Prompt injection defense | `FORM_SANDBOX_NOTE` placed before every uploaded document |
| refId never null after create | `allocateRefId()` in `firebase.adapter.ts:allocateRefId()` |
| HO-3 $1,528 canary | `shared/src/rating/evaluator.test.ts` |
| VIEWER read-only | Firestore rules (`canEdit()`) + `requireRole()` in every Function handler |

---

## File Count by Workspace

| Workspace | Human-authored TS/TSX files (approx) |
|---|---|
| `app/src/` | ~90 files |
| `functions/src/` | ~25 files |
| `shared/src/` | ~40 files |
| Total | ~155 files |

Excluded from this bundle: `node_modules/`, `app/dist/`, `functions/lib/`, `*.snap`, `*.json` data files, `snowchat/` (separate Python project, out of scope).
