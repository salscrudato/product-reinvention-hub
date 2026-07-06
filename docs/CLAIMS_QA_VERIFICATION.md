# CLAIMS_QA_VERIFICATION.md — Coverage-copilot accuracy log

Verification of the Claims Analysis "coverage copilot" (`functions/src/claims.ts` +
`app/src/routes/Claims.tsx`) driven end-to-end on the Emulator Suite against the **real**
sample base form `sample-forms/HO3_sample.pdf` — the ISO **Homeowners 3 – Special Form,
HO 00 03 10 00** (22 pp.) — and the seeded HO-3 product data. Each `analyzeClaim` call
signs in as the seeded admin, streams over SSE, reads the actual policy PDF server-side
(base64 `document` block) and grounds limits/rules/endorsements through the tools.

Method: `scripts`-style Node SSE harness (scratchpad) POSTing to the emulator function,
capturing tool calls, streamed prose and the structured `emit_determination` payload.
Critique axes: **(A)** correctness vs form+domain, **(B)** completeness, **(C)** citation
accuracy, **(D)** honesty about what the form doesn't determine, **(E)** card
formatting/scannability, **(F)** no fabricated coverage/limit/exclusion.

## Scenario battery — expected vs. got (final)

| # | Scenario | Expected | Verdict (got) | Grounding cited |
|---|----------|----------|---------------|-----------------|
| S1 | Pipe burst → hardwood floors + ceiling below | COVERED (sudden/accidental water) | **COVERED** | Coverage A [HO.COV.001], Coverage D [HO.COV.004]; accidental-discharge exception; all-peril ded (Declarations) |
| S2 | Slow seepage behind shower wall for months → mold | NOT COVERED (gradual seepage / mold) | **NOT_COVERED** | §I Perils A.2.c.(6)(e) seepage, A.2.c.(5) mold; names both exclusions; empty coverages/limits |
| S3 | Water backs up through basement floor drain / sump | DEPENDS on Water Back-Up endorsement | **PARTIAL** | §I Excl A.3.b (base excludes); HO 04 95 [HO.COV.001.001] restores; sub-limit $5k [HO.LD.006] |
| S4 | Wildfire → detached garage + hotel 2 weeks | COVERED (Coverage B + D) | **COVERED** | Coverage B [HO.COV.002] (10% of A), Coverage D [HO.COV.004] (30% of A); fire is open-peril |
| S5 | Laptop stolen from car at mall | Coverage C off-premises; note special limits; Declarations governs amount | **COVERED / PARTIAL*** | Coverage C worldwide theft [HO.COV.003]; $1,500 Category j special limit analysed; limit per Declarations [HO.LD.005] |
| S6 | Wind/hail deductible in a coastal state (limits Q) | Cite coastal rule/table; ≥ all-peril; don't invent % | **prose (no card)** | HO 03 12, options 1/2/5% [HO.LD.004], coastal-only FL/GA/NC/SC/TX, ≥ all-peril [HO.RU.008 / HO.LD.003] |
| S7 | Follow-up: "what if the deductible were $2,500?" (multi-turn) | Confirm context carries; verdict unchanged | **prose, verdict stays COVERED** | Quotes §I Conditions C.2 "after application of any deductible"; notes small-loss exception |

\* S5 is a genuinely ambiguous point (whether a laptop is "equipped to be operated by
power from the motor vehicle's electrical system" under Category j). Both a COVERED read
(a standard battery laptop is not so equipped → full Coverage C, less deductible) and a
PARTIAL read (treat the dual-power test as an adjuster fact-question, flag the $1,500 cap
and SPP scheduling override) appeared across runs. **Both are grounded, cited, and
honest** — each identifies Coverage C worldwide theft, cites the $1,500 Category j special
limit with its precise condition, and states the Coverage C limit is set by the
Declarations. No value was fabricated.

## Iterations

### Pass 1 — baseline
All seven scenarios returned correct, grounded, cited verdicts on the first run (S1
COVERED, S2 NOT_COVERED, S3 PARTIAL, S4 COVERED, S5 COVERED, S6/S7 prose). Determination
cards were well-structured and honest about Declarations-dependent figures. Three defects
found on critique:

1. **(E) Process narration leaked into prose answers.** Non-determination answers (S6/S7)
   opened with meta like *"This is a definition/limit lookup question … so I'll answer in
   cited prose without calling `emit_determination`"* — exposing the internal mechanism to
   the user, and un-premium.
2. **(E) Doubled prose on multi-tool prose answers.** Text streamed *before* a tool call
   ("let me pull the structured data…") accumulated with the post-tool final answer,
   producing two stacked answers.
3. **(E/C) `formNumber` inconsistently populated** on the determination (S2, S4 left it
   empty → the card footer fell back to "the base form" instead of the `HO 00 03` chip).
   `openItems` also ran long (6 items on S1).

### Fixes applied
- **System prompt** (`CLAIMS_SYSTEM`): "use tools silently; never describe your process or
  name the tools/`emit_determination`; lead with the answer; don't preface a prose answer
  by classifying the question." Always set the determination `formNumber`. Told it the
  portfolio has two products (HO-3 + a GL line) and to prefer refId-keyed tools.
- **`emit_determination` schema**: `openItems` "usually 2–4, most important first";
  `formNumber` "always set"; limit `source` "a single source".
- **Client** (`Claims.tsx`): on each tool `start`, clear any text streamed so far (drops
  pre-tool "thinking"); and fall back to the selected form's number for the card footer if
  the model omits `formNumber`.

### Pass 2 — after fixes (final)
- S1–S5 determination cards: clean, `formNumber` populated on every card, `openItems`
  trimmed to ~4, prose lead-ins free of process/tool talk.
- S6: leads directly with the answer ("The wind/hail deductible is a separate,
  percentage-based deductible…"), cites HO 03 12 / HO.LD.004 / HO.LD.003, restricts to
  coastal states, requires ≥ all-peril, and gives the percentage tiers as *options* with an
  explicitly hypothetical example ("If Coverage A is $400,000 and the 2% tier…") — **no
  invented policy value**.
- S7: multi-turn context carries — the follow-up keeps the prior COVERED verdict, explains
  a higher deductible changes only the net payment (quoting §I Conditions C.2), and does
  not fabricate a new determination.

## Role / security enforcement (verified on the emulator, real tokens)

| Action | ADMIN | EDITOR | VIEWER |
|--------|-------|--------|--------|
| Storage upload to `baseforms/{uid}/…` | 200 ✓ | 200 ✓ | **403 denied** ✓ |
| `identifyBaseForm` callable | 200 ✓ | 200 ✓ | **PERMISSION_DENIED** ✓ |
| `analyzeClaim` (read-only) | ✓ | ✓ | ✓ (any signed-in role may analyse) |

Enforced in `storage.rules` (`baseforms/` requires `request.auth.token.role` ∈
{EDITOR,ADMIN}), `firestore.rules` (`baseForms/{id}` write = `canEdit()`), and in the
Functions (`identifyBaseForm` role guard). Not UI-only. `identifyBaseForm` read the actual
PDF header back as *"Homeowners 3 – Special Form / HO 00 03 / 10 00"*.

## Craft / non-functional checks
- **Grounded + traceable:** every specific coverage/limit/rule/exclusion cites a refId,
  form number or form section; Declarations-dependent figures are labelled "Per the
  Declarations" rather than guessed. No fabricated coverage/limit/exclusion observed.
- **Dual mode:** loss scenarios render a deterministic `DeterminationCard` from the
  structured `json` event; definitional/limit/follow-up questions stream cited prose.
- **Multi-turn:** the full conversation history is sent each turn; the PDF rides the first
  user turn as a cached `document` block.
- **Reduced motion / keyboard / a11y / zero-empty-error states:** the two-pane workspace
  uses only design tokens + in-house SVG, `rise-in`/pulse are neutralised under
  `prefers-reduced-motion`, the composer is disabled with a hint until a form is selected,
  and the library ships loading skeletons + an empty state. VIEWER sees the list but no
  upload control (and the rules reject an upload regardless).
- **Adapter seam / secrets:** the browser never calls Anthropic; the key stays in
  `functions/.env.local`; all backend access is via `app/src/lib/backend`. A dev-bypass
  guard was added to `adapter.storage.upload` so the tokenless "Continue as admin" fails
  with a clear message instead of a raw 403.

## $1,528 canary
Untouched. `shared` was not modified; `pnpm test` → 52/52 pass, HO-3 $1,528 and GL $2,789
worked examples confirmed by the seed and the evaluator tests.
