# Claims Analysis — Current-State Recon

Read-only reconnaissance of the Claims copilot (`analyzeClaim` + `identifyBaseForm` and their UI).
**No source files were changed in this pass.** Ground truth is the code, not any prior hand-off doc.

## Headline: the "enhanced" systems already exist — the hand-off premise is stale

The hand-off doc warned that several systems "may NOT exist," and `CURRENT_CODEBASE.md` supposedly
showed `claude-sonnet-4-6` + `temperature: 0.2` + an ephemeral cache. Empirically, **the opposite is
true** — the repo is already in the enhanced state:

- **`CURRENT_CODEBASE.md` does not exist in this repo** (glob `**/CURRENT_CODEBASE.md` → no files). The
  closest artefact is `docs/review/FUNCTIONAL_CODEBASE.md`, which already records the enhanced state.
- **Zero occurrences of `claude-sonnet-4-6` or `claude-fable-5` anywhere** (repo-wide grep). The only
  `claude-mythos-5` hits are in the Glasswing-swap comment (`functions/src/runtime.ts:43`) and ADR-0001.
- The reasoning path already passes **no sampling params**; `CACHE_1H` (1-hour TTL), the SSE cost/breaker
  gate (`sseCostGate`), Voyage-gated retrieval augmentation, `verifyCitations` / `loadKnownCitations`,
  and the Haiku→Sonnet identify cascade are all present and wired.

The practical consequence: the follow-on "fix stale model strings" task is essentially a **no-op** — there
is nothing stale to replace. See CLM-01/CLM-02.

Model + sampling facts verified against the bundled Anthropic `claude-api` reference (models table +
Thinking/Effort matrix, cached 2026-06-24) and cross-checked with `docs/adr/0001-model-ids.md`:
`claude-sonnet-5` and `claude-haiku-4-5` are current GA; Sonnet 5 runs adaptive thinking by default and
**rejects a non-default `temperature`/`top_p`/`top_k` with HTTP 400** (omitting them is accepted). Haiku
4.5 still accepts sampling.

## Findings

| ID | Area | Evidence (file:line) | Documented behavior | Actual behavior | Sev | Remediation hypothesis |
|----|------|----------------------|---------------------|-----------------|-----|------------------------|
| CLM-01 | Model strings | `functions/src/runtime.ts:45-46`; `claims.ts:357`; `ai.ts:113`; `extract.ts:316,323`; `claims.ts:438,448` | Hand-off: `claude-sonnet-4-6` reasoning | `MODEL='claude-sonnet-5'`, `MODEL_FAST='claude-haiku-4-5'`, single source, imported everywhere | LOW (doc drift) | None — code is already correct; discard the stale doc |
| CLM-02 | Sampling params | `functions/src/ai.ts:107-115`; `runtime.ts:38-44`; `news.ts:117`; `semanticCache.ts:60` | Hand-off: `temperature: 0.2` on analyzeClaim | Reasoning path passes **no** sampling params; `temperature:0` only on Haiku calls | LOW (already safe) | None — matches the Sonnet-5 sampling contract |
| CLM-03 | SSE schema (client) | server union `runtime.ts:144-150`; client union `Claims.tsx:20-25`; switch `Claims.tsx:172-219` | Client handles every emitted event | Client union + switch **omit `notice`**; no `default` case → `notice` silently dropped | HIGH | Add `case 'notice'` in the handler (surface as an inline advisory) |
| CLM-04 | Terminal empty bubble | `claims.ts:238-239`→`ai.ts:143-152`; render `Claims.tsx:310-320` | No blank assistant bubbles | Cost-gate **deny/breaker** emits `notice`+`done` *before any token*; client drops both → blank bubble (spinner branch needs `streaming`) | HIGH | Handle `notice` (CLM-03) and/or render a fallback for an empty, non-streaming assistant turn |
| CLM-05 | Determination citation guard | server `claims.ts:151-162,302-313`; client `determination.ts:41-54`; `Claims.tsx:202-213` | "Grounded + cited" enforced | Guard checks a **string is present** (citation/refId/form/limit-source/`[bracket]`), not that the refId/form **exists** in the catalog; base-form footer alone doesn't count | MED | Resolve determination refIds/forms via `loadKnownCitations` (as `chat` does at `ai.ts:304`) and flag unresolved |
| CLM-06 | identifyBaseForm failure | `claims.ts:419-429,446-451`; hint `claims.ts:318-322` | Failure → safe empty identity | On failure `lob=''`, `formNumber=''`; empty `lob` → no hint (form stays authoritative, safe). A **wrong** `lob` injects an authoritative-sounding wrong line hint | MED | Soften the line-hint wording or verify `lob` against the attached form before steering |
| CLM-07 | LOB code drift (HO vs PH) | identify enum `claims.ts:382`; server labels `claims.ts:192-196`; `BaseFormsLibrary.tsx:30`; registry prefix `lobRegistry.ts:92`; `Claims.tsx:51` | One consistent line code | Claims uses `HO`/`PA`/`GL`; LOB registry uses prefix `PH` for Personal Home. `Claims.tsx` header tooltip (`LINE_TITLE={PH,PA}`) can't resolve `HO` | LOW | Reconcile the two code systems (add `HO` to `Claims.tsx` LINE_TITLE, or standardize) |
| CLM-08 | Cost gate / breaker / retrieval | `ai.ts:141-158,19`; `claims.ts:238,258-267,330,346` | May not exist | **All present.** `sseCostGate`→`guardSpend`; degrade cuts turns 7→5 and skips Voyage augmentation; Citations-API `verifyCitations` runs | INFO | None — document that they exist |
| CLM-09 | GL framing | `CLAIMS_SYSTEM` `claims.ts:121-143`; portfolio note `claims.ts:123`; GL refs `claims.ts:194,382,74,106,133`; registry `lobRegistry.ts` (only PH+PA) | Multi-line incl. GL | **HO-centric + Personal Auto only.** No GL framing (no occurrence-vs-claims-made, per-occurrence/aggregate, CGL exclusions) and no GL seed product; GL appears only in the identify enum, a line label, and citation examples | MED | Either add GL framing + seed, or drop GL from the identify enum/examples so support isn't implied |
| CLM-10 | Empty library per role | `BaseFormsLibrary.tsx:177-183,139,240-243`; composer `Claims.tsx:136,334-345` | Line-neutral empty state | EDITOR: "Upload a Homeowners or Personal Auto base form…"; VIEWER: "Ask an editor to upload a base form…" + upload hidden. Copy is **line-specific (not neutral)** and omits GL | LOW | If multi-line, make copy line-neutral (ties to CLM-09) |

## Answers to the eight questions (file:line evidence)

### 1. Exact model string(s) and where defined

- Both constants live in **`functions/src/runtime.ts:45-46`**:
  `export const MODEL = 'claude-sonnet-5'` (reasoning) and `export const MODEL_FAST = 'claude-haiku-4-5'` (bulk).
- **`analyzeClaim`** → `runChatAgent(...)` → the `messages.create` call uses `MODEL` at
  **`functions/src/ai.ts:113`**. Telemetry also records `model: MODEL` at `functions/src/claims.ts:357`.
- **`identifyBaseForm`** → cascade: cheap pass `MODEL_FAST` then escalate to `MODEL` —
  **`functions/src/claims.ts:438`** (`run(MODEL_FAST)`) and **`:448`** (`run(MODEL)`).
- **`extractCoverages`** → cheap `MODEL_FAST` then escalate `MODEL` — **`functions/src/extract.ts:316`** and **`:323`**.
- **`chat`** → `runChatAgent` → `MODEL` at **`functions/src/ai.ts:113`**.
- No hard-coded model string exists outside `runtime.ts` (grep-verified). ADR: `docs/adr/0001-model-ids.md`.

### 2. Sampling params on the analyzeClaim call, and where

- **None.** `analyzeClaim` reuses `runChatAgent`, whose per-turn request is built at
  **`functions/src/ai.ts:111-115`**: `{ model: MODEL, max_tokens, system, tools, messages }` — no
  `temperature`/`top_p`/`top_k`. The intent is documented at **`ai.ts:108-109`** and **`runtime.ts:38-44`**
  (Sonnet 5 rejects non-default sampling → 400).
- `temperature` survives **only on Haiku (bulk) calls**: `functions/src/news.ts:117` and
  `functions/src/semanticCache.ts:60` (both `temperature: 0`), which Haiku 4.5 still accepts. This matches
  the verified contract — no change needed.

### 3. SSE event schema, terminal events, and client coverage

- Server event union (`StreamEvent`, **`functions/src/runtime.ts:144-150`**):
  `token` | `tool{phase:start|end}` | `json` | `notice{level:info|warn}` | `error` | `done`.
- Emitted by `analyzeClaim` / `runChatAgent`: `token` (`ai.ts:72`), `tool` start/end (`ai.ts:124,126`),
  `json` determination (`claims.ts:311`), `notice` (cost gate `ai.ts:144,149,154`; unverified-citation warn
  `claims.ts:348`), `error` (silent-empty guard `claims.ts:340`; catch `claims.ts:354`), `done`
  (`claims.ts:350`; cost gate `ai.ts:146,151`).
- **Terminal events:** `done` (normal), `error` (failure/empty), and the cost-gate `notice`+`done` (deny/
  breaker). There is no `deny`/`degrade` discriminator — those are folded into `notice`.
- **Client coverage (`Claims.tsx:172-219`):** cases for `token`, `tool`, `json`, `error`, `done` — **no
  `case 'notice'` and no `default`.** The client's own `StreamEvent` type (`Claims.tsx:20-25`) doesn't even
  include `notice`. So `notice` is silently dropped (CLM-03).
- **Can it render an empty bubble?** Yes (CLM-04). On the cost-gate **deny/breaker** path the server sends
  `notice` then `done` **before any `token`** (`claims.ts:238-239` → `ai.ts:143-152`). The client ignores
  `notice`, `done` is a no-op (`Claims.tsx:218`), so the assistant turn ends with empty text, no
  determination, and `streaming=false`. The render (`Claims.tsx:310-320`) shows the DeterminationCard, else
  text, else a spinner **only while streaming** — none apply → a blank bubble. (The mid-stream silent-empty
  case is caught server-side via `error` at `claims.ts:339-341`, which the client does render.)

### 4. Determination citation guard — server + client, exact rule, catalog check?

- **Server:** `determinationIsCited(d)` at **`functions/src/claims.ts:153-162`**, enforced in the
  `emit_determination` executor at **`claims.ts:302-313`** — a substantive verdict that isn't cited is
  handed back to the model to re-issue (never surfaced).
- **Client:** `isDeterminationCited` / `shouldRenderDetermination` at
  **`app/src/lib/claims/determination.ts:41-54`**, applied before rendering at **`Claims.tsx:202-213`**.
- **Exact "cited" rule** (both sides agree): a substantive verdict (COVERED / NOT_COVERED / PARTIAL) counts
  as cited iff **≥1** of — a non-empty `citations[]` entry; a coverage with a `refId` or `formNumber`; an
  exclusion with a `refId` or `formNumber`; a limit with a `source`; or a reasoning line containing a
  `[bracketed]` token. `NOT_ADDRESSED` is exempt. The always-present base-form footer does **not** count on
  its own (`determination.ts:37-40`, test `determination.test.ts:13-15`).
- **Catalog check?** **No — presence only.** The guard verifies a *string is present*, not that the cited
  `refId`/`formNumber` **exists** in the live catalog, so a fabricated `[HO.COV.999]` passes. This is weaker
  than `chat`, which resolves every cited token against `loadKnownCitations` and flags misses
  (`functions/src/ai.ts:224-225,304-311`, `tools.ts:453-484`). The Citations-API `verifyCitations`
  (`claims.ts:346`, `retrieval/citations.ts:64-82`) only confirms a returned citation's `document_index`
  falls within the supplied set (base form + any Voyage chunks) and emits a **non-fatal** notice — it does
  not validate the determination's bracketed refIds against the catalog.

### 5. identifyBaseForm on failure — status/lob/formNumber, and can a bad lob steer the model?

- `readIdentity` (**`claims.ts:419-429`**) defaults `formNumber` to `''` when absent and `lob` to `''`
  unless it is exactly `HO`/`PA`/`GL`. The cascade escalates to the reasoning model **only when both are
  empty** (`claims.ts:446`). A hard failure therefore yields `{ title, formNumber:'', edition:'', lob:'' }`.
- There is **no `status` field** in the identify result — status is owned by the upload flow, which marks
  the form `READY` even when identify fails (best-effort; `BaseFormsLibrary.tsx:108-111`). So an
  empty-metadata form is still selectable and analyzable.
- **Empty lob is safe:** in `analyzeClaim`, `LINE_LABELS['']` is undefined → `lobHint=''`
  (**`claims.ts:318-322`**), so nothing steers the model and the attached form remains authoritative
  (`CLAIMS_SYSTEM`, `claims.ts:121`).
- **A wrong lob is the risk:** a mis-identified `lob` (e.g. an HO form tagged `PA`) injects
  *"The attached form has been identified as an ISO Personal Auto Policy form — analyze on that line…"*
  (`claims.ts:321`) as volatile context. The form-is-authoritative framing mitigates this, but a confident
  wrong hint can still misdirect product resolution (CLM-06).

### 6. Cost/budget gate, circuit breaker, or retrieval augmentation in the claims path?

- **All present** (contradicts the hand-off):
  - **Cost cap + breaker:** `sseCostGate` (**`functions/src/ai.ts:141-158`**, wrapping `guardSpend`/
    `estCostFor` from `costGuard`, `ai.ts:19`) is called in `analyzeClaim` at **`claims.ts:238-241`**. A
    hard `deny` or open `breaker` streams a notice+done and returns; a soft `degrade` continues cheaper.
  - **Degradation:** under a soft cap, `maxTurns` drops 7→5 (**`claims.ts:330`**) and Voyage citation
    augmentation is skipped (**`claims.ts:261`**).
  - **Retrieval augmentation:** `buildCiteableDocuments(await retrieve({...voyageKey}))` gated on a Voyage
    key (**`claims.ts:256-267`**), plus `verifyCitations` post-check (**`claims.ts:346`**).

### 7. GL framing in CLAIMS_SYSTEM

- **HO-centric, plus Personal Auto — no real GL framing.** `CLAIMS_SYSTEM` (**`claims.ts:121-143`**) frames
  only Homeowners (HO-3/HO 00 03) and the ISO Personal Auto Policy (PP 00 01); the "RESOLVE THE RIGHT
  PRODUCT" note states the portfolio holds exactly two products — Personal Home and Personal Auto
  (**`claims.ts:123`**) — and the "LINE FRAMING" block covers only those two (**`claims.ts:135-137`**).
- GL surfaces **only** as: the line label `GL: 'a Commercial General Liability form'` (`claims.ts:194`), the
  `identify_form` `lob` enum value `GL` (`claims.ts:382`), and citation **examples** mentioning `CG 00 01` /
  `GL.COV.002` (`claims.ts:74,106,133`). There is **no** GL-specific guidance (nothing on occurrence vs
  claims-made, per-occurrence/aggregate limits, or CGL exclusions) and **no GL seed product** — the LOB
  registry defines only Personal Home and Personal Auto (`shared/src/insurance/lobRegistry.ts`). GL is a
  phantom line the model can be *told* about but cannot ground against (CLM-09).

### 8. Empty baseForms library behavior per role

- **Empty state** (`BaseFormsLibrary.tsx:177-183`): title **"No base forms yet"**; description branches on
  role — EDITOR/ADMIN: *"Upload a Homeowners or Personal Auto base form to start a coverage conversation."*
  VIEWER: *"Ask an editor to upload a base form to start."*
- **Upload control** is gated to EDITOR/ADMIN (`BaseFormsLibrary.tsx:139`); VIEWER instead sees a footer
  note *"Viewer — analysis only. Editors upload forms."* (`BaseFormsLibrary.tsx:240-243`).
- The right pane composer stays disabled until a `READY` form with a `storagePath` is selected
  (`Claims.tsx:136`, placeholder/hint at `Claims.tsx:334-345`).
- The empty-state copy is **line-specific, not line-neutral** — it names "Homeowners or Personal Auto" and
  omits GL, consistent with CLM-09 (CLM-10).

## Files reviewed (all read-only)

`functions/src/runtime.ts`, `functions/src/claims.ts`, `functions/src/ai.ts`, `functions/src/tools.ts`,
`functions/src/extract.ts`, `functions/src/retrieval/citations.ts`, `app/src/routes/Claims.tsx`,
`app/src/components/claims/DeterminationCard.tsx`, `app/src/components/claims/BaseFormsLibrary.tsx`,
`app/src/lib/claims/determination.ts` (+ `.test.ts`), `app/src/lib/backend/firebase.adapter.ts` (stream
path), `shared/src/insurance/lobRegistry.ts`, `docs/adr/0001-model-ids.md`, `functions/CLAUDE.md`.
Absent as noted: `CURRENT_CODEBASE.md` (does not exist).
