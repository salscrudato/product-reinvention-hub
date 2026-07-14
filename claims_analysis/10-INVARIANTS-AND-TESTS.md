# Claims Analysis — Invariants, Guarantees & Test Coverage

**What this covers.** This is the correctness dossier for the Claims Analysis feature: the
_binding invariants_ it inherits from `CLAUDE.md` and exactly where each is enforced in claims
code, the _pure-function guards_ that make grounded coverage determinations trustworthy, and the
_test suite_ that proves those guards in the gate (`pnpm typecheck && lint && test && build`).
Claims has **no rating canary** — the famous $1,528 HO-3 check (`shared/src/rating/evaluator.test.ts`)
is a rating invariant, not a claims one. Claims' safety net is instead (a) a set of small,
platform-free, unit-tested guard functions and (b) a server-side resolve-or-downgrade rule. Every
claim below is grounded in the actual code with file:line citations; where the code disagrees with a
source comment or the anchor, the **code wins** and the discrepancy is called out.

---

## 1. The correctness guarantees, at a glance

| # | Guarantee | Where proven / enforced | Test |
|---|-----------|-------------------------|------|
| G1 | A **substantive** verdict (COVERED / NOT_COVERED / PARTIAL) never reaches the card **uncited** | client `shouldRenderDetermination` + server downgrade | `determination.test.ts` |
| G2 | A **fabricated** citation the server couldn't resolve never renders as authoritative | client `shouldRenderDetermination` unverified branch | `determination.test.ts` |
| G3 | `NOT_ADDRESSED` (the honest "form is silent" answer) **always** renders | `shouldRenderDetermination` non-substantive branch | `determination.test.ts` |
| G4 | Every terminal SSE path shows **exactly one visible thing** — never a blank bubble | `assistantBubbleContent` priority ladder | `bubble.test.ts` |
| G5 | A form we could not identify becomes **NEEDS_REVIEW**, never a silent empty READY | `statusAfterIdentify` | `baseForm.test.ts` |
| G6 | Only a **READY form with a stored document** is analyzable (composer gate) | `isFormAnalyzable` | `baseForm.test.ts` |
| G7 | A coverage gap becomes a **grounded, prefilled** product-feedback IDEA | `buildGapFeedbackPrefill` / `matchedProductId` | `gapFeedback.test.ts` |
| G8 | The copilot stays **form-driven** — unknown line ⇒ generic profile; GL reaches HO parity | `resolveClaimsLineProfile` | `lineProfiles.test.ts` |
| G9 | The uploaded form is treated as **untrusted DATA**, never instructions (prompt-injection) | server `CLAIMS_SYSTEM` + `sandboxNote` | `functions/src/claims.test.ts` (legacy-ref) |

---

## 2. Binding invariants from `CLAUDE.md` that touch claims

The invariants table lives in `CLAUDE.md` lines 30–41. Here is **where each is enforced in the
claims path** specifically.

### Adapter seam — "never import a platform SDK in components"
All AI and storage go through `adapter`. Claims components import **no** Cosmos/Firebase/Azure SDK —
verified: a grep for `cosmos|firebase|@azure` imports across `app/src/components/claims/` returns
**zero** matches. The browser calls `adapter.fns.stream('analyzeClaim', …)` (SSE) and
`adapter.fns.call('identifyBaseForm', …)` (JSON); uploads go through `adapter.storage.upload`; entity
writes through `adapter.db.mutate`. Enforcement is architectural (the seam) plus the server never
exposing a data-store credential to the browser (`CLAUDE.md` §Environment safety).

### Atomic mutations — "every write is `adapter.db.mutate()`, batched server-side"
`BaseFormsLibrary` writes the `baseForms/{id}` entity via `adapter.db.mutate` (create at status
`PROCESSING`, then a full-replace upsert after identify). The `/api` host batches
entity + auditEvent + version + searchIndex in one Cosmos transactional batch (`server/lib/data.js`).
No claims code performs a bare data-store write.

### Role enforcement — "VIEWER read-only; writes EDITOR+; server-side always"
Two layers, both server-side:
- **Capability gate** on the AI router: `server/lib/ai/index.js:26`
  `router.post('/:name', requireCapability('ai:invoke'), requireTenant, …)` — so `analyzeClaim` and
  `identifyBaseForm` require the `ai:invoke` capability.
- **Capability matrix** (`server/lib/authz.js:41–65`): `VIEWER` holds `[product:read, ai:invoke]` —
  it may _analyze_ (read-only copilot) but has **no** `product:write`, so upload/mutate is refused.
  `EDITOR`+ hold `product:write`. Crucially **`POLICYHOLDER: [portal:read, portal:upload]`**
  (`authz.js:56`) — **no `ai:invoke`**, so every `/api/ai/*` route (including `analyzeClaim`) returns
  403 for the consumer persona. This matches the anchor exactly.

### AI server-side — "the browser never calls the model API"
The Foundry/Anthropic call lives in `server/lib/ai/analyze-claim.js` (`_forcedToolCall`, line 101).
The browser only opens an SSE stream to `/api/ai/analyzeClaim`. Additionally `server/server.js:158`
gates that route behind the `page.claims` feature flag, and `/api/ai/*` is rate-limited.

### AI grounded + cited — "free invention is a bug"
This is the **central claims invariant**, enforced in _two_ places (defense in depth) — see §4:
- **Server** (`analyze-claim.js:103–107`): a substantive verdict with **zero bracketed reasoning**
  is forced to `NOT_ADDRESSED` with an annotated summary.
- **Client** (`determination.ts:54–71`): `isDeterminationCited` + `shouldRenderDetermination` refuse
  to render an uncited (or unverified-citation) substantive card.

### refId / form chips — "load-bearing, never strip them"
`DeterminationCard.tsx` renders `RefChip`/`DataChip` and form-number chips; a grep for
`refId|formNumber|RefChip|DataChip` in that file returns **41** occurrences. The client also
_guarantees_ the footer form-number chip: `Claims.tsx:262` back-fills
`formNumber: d.formNumber || selectedForm.formNumber` before rendering.

### Design tokens — "no hard-coded hex outside `app/src/index.css`"
Verified: a grep for `#[0-9a-fA-F]{3,6}` in `DeterminationCard.tsx` returns **0** matches — all
colour is `var(--color-*)` / `color-mix`, per the anchor.

### Model IDs — "opus-4-8 / sonnet-5 / haiku-4-5; never `claude-fable-5`"
No claims handler hardcodes a model string. `analyze-claim.js:71`
`resolveModel('GROUNDED_CITED', g.degrade)` resolves to `claude-opus-4-8`
(`shared/src/ai/fleet.ts:40–42`); the form-identify AI fallback uses `BULK_VERIFY` →
`claude-haiku-4-5` (`fleet.ts:52–54`). On degrade, `degradedRole('GROUNDED_CITED')` → `BULK_VERIFY`
(`fleet.ts:135–138`). Claims does **not** use `opts.bypassDegrade` (that switch is import-only).

---

## 3. Test inventory — what each file asserts

Five active suites plus one legacy-reference suite. All are pure (no platform, no network), so they
run inside the gate.

```
app/src/lib/claims/determination.test.ts   citation + downgrade guard  (G1–G3)
app/src/lib/claims/bubble.test.ts           no-blank-bubble matrix      (G4)
app/src/lib/claims/baseForm.test.ts         form-lifecycle rules        (G5–G6)
app/src/lib/claims/gapFeedback.test.ts      coverage-gap → feedback     (G7)
shared/src/claims/lineProfiles.test.ts      line-profile resolution     (G8)
functions/src/claims.test.ts                LEGACY-REFERENCE (not deployed) — sandbox/injection + cite
```

### 3.1 `determination.test.ts` — the citation / downgrade guard

Two `describe` blocks on the pure guard, then four **EVAL** blocks that feed realistic grounded
payloads through it.

- **`isDeterminationCited`** — proves _what counts as a citation_:
  - `false` when only the base `formNumber` is present — *"the base formNumber alone does not count"*
    (line 13). This is the load-bearing negative: counting the always-present footer would make every
    determination trivially "cited" and defeat the guard.
  - `true` via any of: explicit `citations[]`, a coverage `refId`, a coverage `formNumber`
    (endorsement), a `limits[].source`, an **exclusion** form section, or a `[bracketed]` reasoning
    cite (lines 17–42).
  - Blank/whitespace-only citations are ignored (line 44) — `filled()` trims.
- **`shouldRenderDetermination`** — proves _the render gate_:
  - Blocks an uncited substantive verdict of **every** kind (COVERED, NOT_COVERED, PARTIAL) — line 56.
  - Allows a cited substantive verdict — line 62.
  - **Always** allows `NOT_ADDRESSED` even uncited — *"the honest 'form is silent' answer"* (line 68).
  - **Unverified branch** (lines 74–84): a structurally-cited verdict that also carries
    `unverifiedCitations: ['PH.COV.999']` is `isDeterminationCited === true` **but**
    `shouldRenderDetermination === false` — the unresolved flag wins.
  - The downgraded card the server _should_ produce (verdict `NOT_ADDRESSED` + `openItems` +
    `unverifiedCitations`) still renders (line 86).
- **EVAL blocks** (lines 97–251) exercise the guard with production-shaped determinations so a
  regression in the guard is caught with realistic data:
  - **HO 00 03**: COVERED pipe-burst (cited via coverage `refId` `PH.COV.001`); NOT_COVERED sewer
    backup (cited via exclusion form section `HO 00 03 §I.B.8`).
  - **PP 00 01**: COVERED third-party BI (coverage `refId`); NOT_COVERED mechanical breakdown (cited
    via **bracketed reasoning** with `citations: []` — proving bracket-only citation passes).
  - **CG 00 01 (GL parity)**: COVERED slip-and-fall (asserts the text contains `occurrence` and
    `general aggregate`); NOT_COVERED "damage to your work". Both assert `formNumber === 'CG 00 01'`
    (a GL determination cites GL forms, not HO/PA).
  - **Coverage-gap surfacing**: a `NOT_ADDRESSED` card carries a cited `coverageGap.sources`
    including `HO 00 03`, and still renders as the neutral card.

### 3.2 `bubble.test.ts` — the no-blank-bubble matrix

Proves `assistantBubbleContent(state, streamingThisTurn)` — the single decision for what an
assistant turn shows — resolves every terminal SSE path to one visible thing. The priority ladder
(`bubble.ts:19–25`) is `determination > text > notice > thinking > fallback`:

| state | streaming | result | line |
|-------|-----------|--------|------|
| `hasDetermination` | – | `determination` | 10 |
| non-blank `text` | – | `text` | 14 |
| `notice` only (deny/breaker/degrade) | – | `notice` | 18 |
| nothing yet | `true` | `thinking` | 22 |
| nothing, finished | `false` | `fallback` | 26 |
| card + notice / text + notice | – | card / text (advisory renders **alongside**, never alone-blank) | 31 |
| whitespace-only text | `false` | `fallback` (does not mask a blank) | 36 |

It also asserts `EMPTY_TURN_FALLBACK.trim().length > 0` (line 28) — the last-resort message is
non-empty (`bubble.ts:29`, *"I couldn't produce a response for that…"*).

### 3.3 `baseForm.test.ts` — the form-lifecycle rules

Proves the three pure lifecycle functions (`baseForm.ts`):

- **`statusAfterIdentify`** — READY iff a printed `formNumber` **OR** a recognised `lob`; else
  NEEDS_REVIEW (lines 9–37). Whitespace-only or empty meta ⇒ NEEDS_REVIEW. **Nuance proven**:
  `verified: false` does **not** force NEEDS_REVIEW — an identified-but-unverified form stays READY
  because *"the ATTACHED DOCUMENT is the authority"* (lines 23–28); only when unverified **and**
  nothing was identified is it NEEDS_REVIEW (line 30). Absent `verified` ⇒ READY (backwards-compat).
- **`isUnverified`** — `true` **only** for `verified === false`; absent/null/undefined ⇒ `false`
  (treated as verified) (lines 39–47).
- **`isFormAnalyzable`** — the composer gate — `true` **only** for `status === 'READY'` **and** a
  non-empty `storagePath`; `PROCESSING`, `NEEDS_REVIEW`, missing PDF, or a null selection ⇒ `false`
  (lines 49–71).

### 3.4 `gapFeedback.test.ts` — the coverage-gap → product-feedback prefill

Proves the deterministic core of the feedback loop (`gapFeedback.ts`):

- **`matchedProductId`** — resolves the product from the **first cited internal refId prefix**
  (`PH.COV.001` → `PH.PROD.001`, line 18) via `resolveLobByRefId`; **ignores form numbers** (they
  contain a space) and unknown prefixes, returning `undefined` when nothing resolves (line 21). The
  `INTERNAL_REFID = /^[A-Za-z]{2,4}\.[A-Za-z0-9]/` regex is what keeps `HO 00 03` from ever being
  mistaken for a product-bearing refId.
- **`buildGapFeedbackPrefill`** — always `type: 'IDEA'` (line 30); title = first line of the gap note
  (line 34); detail grounds `Scenario:`, `Verdict: not addressed.`, `Cited clauses:` including both
  `PH.COV.003` (gap source) and `PH.COV.001` (coverage refId) (line 38); context carries
  `baseFormNumber`, `matchedProductId: 'PH.PROD.001'`, and `route: '/app/claims'` (line 46). A
  >100-char gap note is **truncated for the title** (`…`) but the **full note is kept in the detail**
  as `Coverage gap: …` (line 52).

### 3.5 `lineProfiles.test.ts` — line-profile resolution & GL parity

Proves the form-driven, line-agnostic contract (`shared/src/claims/lineProfiles.ts`):

- **`resolveClaimsLineProfile`** — HO/PA/GL resolve to their own profile; case-insensitive + trims;
  any unrecognised/empty/`null`/`undefined`/`'BP'` code falls back to `DEFAULT_CLAIMS_LINE_PROFILE`
  whose `code === 'GENERIC'` (lines 14–34).
- **Registry shape** — ≥3 named profiles, each with a non-trivial briefing (`> 80` chars) and ≥1
  scenario; the generic profile has **0** scenarios and a briefing that mentions `form`; each line
  carries a **gap-probing** scenario (HO→`flood`, PA→`mechanical breakdown`, GL→`pollut`) (lines 36–55).
- **GL parity** — GL's briefing names `occurrence`, `claims-made`, `general aggregate`,
  `products-completed-operations`, and `reset`; carries `slip`/`product`/`completed` scenarios; and
  does **not** borrow HO framing (`open-peril` appears in HO, **not** GL) (lines 58–83).
- **`claimsLineCodeFromFormNumber`** — `HO*`→HO, `PP*`→PA, `CG*`→GL; case/space-tolerant; unknown
  prefix ⇒ `''` (lines 86–103).

### 3.6 `functions/src/claims.test.ts` — legacy-reference (NOT deployed)

`functions/` is reference-only per `CLAUDE.md` §Model IDs. This suite locks the **prompt-injection /
sandbox** defenses (`FORM_SANDBOX_NOTE`, `CLAIMS_SYSTEM`) and the citation contract
(`determinationIsCited`, `findUnverifiedDeterminationCitations`). The deployed server
(`server/lib/ai/analyze-claim.js`) carries the equivalent `CLAIMS_SYSTEM` + `sandboxNote` text and the
same "must cite" rule — but see §5 for a real divergence in the _unverified-citation_ behavior.

---

## 4. The two-layer citation guard (server ⟂ client)

The grounded-and-cited invariant is enforced twice — the layers are **complementary, not identical**.

```mermaid
flowchart TD
  M[Model emits emit_determination tool call] --> S1{Server: any reasoning entry<br/>with a '[' bracket?}
  S1 -- no & verdict is COVERED/NOT_COVERED/PARTIAL --> DG[Downgrade verdict → NOT_ADDRESSED<br/>+ annotate summary]
  S1 -- yes --> J[emit json determination]
  DG --> J
  J --> N{cited tokens not found in<br/>portfolio context?}
  N -- yes --> NOTE[emit notice kind:unverified level:warn]
  N -- no --> DONE[emit done]
  J --> C1{Client shouldRenderDetermination}
  C1 -- non-substantive --> R[render card]
  C1 -- unverifiedCitations present --> BLK[block → 'couldn't ground' text]
  C1 -- substantive & isDeterminationCited --> R
  C1 -- substantive & uncited --> BLK
```

**Server rule** (`analyze-claim.js:103–107`) keys narrowly off **bracketed reasoning**:

```js
const citedReasoning = (Array.isArray(raw.reasoning) ? raw.reasoning : []).filter(r => r && /\[/.test(r))
if (citedReasoning.length === 0 && (raw.verdict === 'COVERED' || raw.verdict === 'NOT_COVERED' || raw.verdict === 'PARTIAL')) {
  raw.verdict = 'NOT_ADDRESSED'
  raw.summary = (raw.summary || '') + ' (Determination downgraded to NOT_ADDRESSED: no cited reasoning provided.)'
}
```

**Client rule** (`determination.ts:54–71`) is **broader** on what counts as a citation (coverage
refId, coverage/exclusion form number, limit source, explicit citations, **or** bracketed reasoning)
_and adds_ the `unverifiedCitations` veto. So a determination cited only via `coverages[].refId` with
no bracket in `reasoning` passes the **client** guard but is nonetheless **downgraded by the server**
(which looks only at reasoning brackets). This is deliberate defense-in-depth, and it's worth
knowing the two rules are not the same predicate. `Claims.tsx:263–274` applies the client gate: if it
fails, the card is replaced with *"I couldn't ground that determination in the form — please rephrase."*

---

## 5. The gate, and why claims has no canary

The gate (`CLAUDE.md:21`) is:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

`pnpm test` runs every suite in §3 (the four `app/src/lib/claims/*.test.ts`, the shared
`lineProfiles.test.ts`, and the legacy-reference `functions/src/claims.test.ts`). There is **no
claims rating canary** — the headline $1,528 HO-3 canary (`shared/src/rating/evaluator.test.ts`) is a
**rating** invariant. Claims cannot have a single golden numeric assertion because its output is a
model-generated determination, not a deterministic premium. Instead its correctness net is:

1. **Pure guard unit tests** — the citation guard, the no-blank-bubble ladder, the lifecycle rules,
   the gap prefill, and the line-profile registry are all platform-free functions with exhaustive
   truth tables, so a regression is caught deterministically in the gate without a live model.
2. **Server-side downgrade** — even if a caller bypassed the client, `analyze-claim.js` forces an
   uncited substantive verdict to `NOT_ADDRESSED` before it leaves the server.

The pure functions are the "canary equivalent": they encode the trust boundary in code that _can_ be
asserted deterministically.

---

## 6. What is NOT yet tested / integration gaps

Documented honestly — these are the reverse-engineering findings where the tests, the anchor, and
the deployed code do not fully line up. **Where they differ, the code is authoritative.**

- **No end-to-end test against a live SSE stream.** Everything is unit-level on pure functions. The
  actual wire protocol (`{t:'token'|'tool'|'json'|'notice'|'error'|'done'}`), the RAF token batching,
  the AbortController-per-turn, and the server dispatch in `analyze-claim.js` have **no** automated
  integration coverage. A protocol drift between the server `emit()` union and the `Claims.tsx`
  consumer would not be caught by the gate.

- **No component test** for `DeterminationCard.tsx` or `BaseFormsLibrary.tsx` — glob confirms the only
  claims tests are the five pure suites. The card's verdict-emblem/accordion rendering, the
  design-token compliance, and the upload/identify flow are unverified by automated tests.

- **The `unverifiedCitations` guard is unit-tested but not wired end-to-end in the deployed server.**
  `determination.ts:35–39` comments that *"the SERVER … already downgrades such a determination to
  NOT_ADDRESSED"* and `shouldRenderDetermination` vetoes on `d.unverifiedCitations`. But the deployed
  `analyze-claim.js` does **not** set `unverifiedCitations` on the determination JSON, nor downgrade
  for unresolved-catalogue citations — it emits the determination first (lines 141), _then_ a separate
  `notice` (`kind:'unverified'`, lines 142–146). And `Claims.tsx:280` stores that notice in
  `m.notice.refs`, **not** merged into `d.unverifiedCitations`, and the render gate at line 263 runs
  **before** the notice arrives. Net: in the live path the `unverifiedCitations` branch of
  `shouldRenderDetermination` is currently exercised **only by the unit test**. The full
  resolve-or-downgrade (via `findUnverifiedDeterminationCitations`) lives in the **legacy** `functions/`
  reference, not the deployed handler. This is a real gap between intent and deployment.

- **The per-line briefing is client/UX-only — not wired into the determination prompt.** The
  `lineProfiles` briefings (HO/PA/GL/GENERIC) drive scenario starters and chip labels in `Claims.tsx`
  / `BaseFormsLibrary.tsx`, and the payload sends `lob`, **but** `analyze-claim.js` never reads
  `body.lob` nor injects `profile.briefing` — its `CLAIMS_SYSTEM` is line-agnostic and derives the
  line *"FROM THE FORM"* (line 54). So the rich occurrence/aggregate GL knowledge tested by
  `lineProfiles.test.ts` does **not** currently reach the model prompt. Opportunity: inject the
  resolved briefing server-side (deterministically, from the form number, not blindly from
  client-supplied `lob`).

- **PDF-extractor 0-char cases are untested at the seam.** `_extractPdfText` returns `null` for
  garbage/too-short output, and `analyze-claim.js:94` then falls back to the **native document block**
  (`{type:'document', source:{base64}}`). That fallback branch — the safety net for the known
  0-char sample PDFs — has no automated test; correctness there depends on the model reading the raw
  PDF.

- **Source-comment staleness.** `determination.ts:4` and `determination.test.ts:3` say the guard
  *"Mirrors the server guard in `functions/src/claims.ts`"*. That file is the **legacy, not-deployed**
  reference; the actually-deployed mirror is `server/lib/ai/analyze-claim.js`. The rule is equivalent,
  but the file citation in the comment points at the wrong (reference-only) location.

---

## Related documents

- [README.md](./README.md) — index & reading order
- [01-OVERVIEW.md](./01-OVERVIEW.md) — what Claims Analysis is, user-facing
- [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) — component & data-flow map
- [03-BACKEND-PIPELINE.md](./03-BACKEND-PIPELINE.md) — `analyzeClaim` handler flow end-to-end
- [04-MULTI-MODEL-ORCHESTRATION.md](./04-MULTI-MODEL-ORCHESTRATION.md) — fleet, roles, cost guard, degrade
- [05-EMBEDDINGS-AND-RAG.md](./05-EMBEDDINGS-AND-RAG.md) — grounding / hybrid retrieval
- [06-FRONTEND.md](./06-FRONTEND.md) — `Claims.tsx`, SSE consumption, `DeterminationCard`
- [07-DATA-MODEL-AND-CONTRACTS.md](./07-DATA-MODEL-AND-CONTRACTS.md) — `Determination`, `BaseForm`, SSE union
- [08-DESIGN-PATTERNS.md](./08-DESIGN-PATTERNS.md) — pure-guard + defense-in-depth patterns
- [09-RECREATE-FROM-SCRATCH.md](./09-RECREATE-FROM-SCRATCH.md) — step-by-step rebuild
- [10-INVARIANTS-AND-TESTS.md](./10-INVARIANTS-AND-TESTS.md) — **this document**
- [code-inventory.md](./code-inventory.md) — file-by-file index
