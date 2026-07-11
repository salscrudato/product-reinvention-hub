# Ground Truth — Verification Ledger

Established 2026-07-09 by reading code. Every answer is evidence-backed.
Companion: `docs/reviews/BASELINE.md` (gate state on the same date).

---

## V1 — Seeded lines and canaries

**FINDING (initial 2026-07-09):** Two LOBs were registered and seeded: PH and PA. GL was absent.
**CLOSED by V15 (2026-07-10):** GL is now registered in LOB_REGISTRY and fully seeded at parity.

**EVIDENCE (current state):**
- `shared/src/insurance/lobRegistry.ts` — `LOB_REGISTRY` now has three entries:
  - `PH.LOB.001` — prefix `PH`, label "Personal Home", lineCategory PROPERTY, family Property,
    perilModel COASTAL_WIND_HAIL (FL GA NC SC TX), supportsRulesSimulation true
  - `PA.LOB.001` — prefix `PA`, label "Personal Auto", lineCategory CASUALTY, family Automobile,
    perilModel TERRITORY, supportsRulesSimulation true
  - `GL.LOB.001` — prefix `GL`, label "General Liability", lineCategory CASUALTY, family Casualty,
    Commercial Lines / Small Commercial / Middle Market, supportsRulesSimulation true
- Rating canaries (all confirmed in V15 gate run):
  - HO-3: `shared/src/rating/evaluator.test.ts:16` — `expect(result.finalPremium).toBe(1528)` ✓
  - PA:   `shared/src/rating/personalAuto.evaluator.test.ts:18` — `expect(result.finalPremium).toBe(1002)` ✓
  - GL:   `shared/src/rating/generalLiability.evaluator.test.ts` — `expect(result.finalPremium).toBe(2635)` ✓
  - rtGrid canary: `shared/src/rating/rtGrid.test.ts:57` — also asserts 1528 (unchanged) ✓

**CONSEQUENCE:** All three lines are rated and fully seeded. GL adds a third entry to LOB
segmentation filters (Commercial Lines / Casualty / Small Commercial). See V15 for the GL canary.

---

## V2 — Model constants

**FINDING:** `MODEL = 'claude-sonnet-5'` and `MODEL_FAST = 'claude-haiku-4-5'`, defined at
`functions/src/runtime.ts:45-46`. Sonnet 5 rejects `temperature`, `top_p`, `top_k` (HTTP 400).
One duplicate found and **fixed in this session**: `functions/src/telemetry.ts` PRICING map
previously hardcoded `'claude-sonnet-5'` and `'claude-haiku-4-5'` as string keys; now uses
`[MODEL]` / `[MODEL_FAST]` computed property syntax. No stale `claude-sonnet-4-6` in production
code (only in fable-handoff/manifest.json metadata and docs/claims_enhancement_findings.md
documentation — neither is production runtime code).

**EVIDENCE:**
- `functions/src/runtime.ts:45-46` — authoritative constants
- `functions/src/telemetry.ts:32,38` — **fixed**: was `'claude-sonnet-5'` / `'claude-haiku-4-5'`
  literal keys in PRICING map; now `[MODEL]` / `[MODEL_FAST]` (also fixed fallback at :76)
- `functions/src/telemetry.ts:15` — `import { MODEL, MODEL_FAST } from './runtime'` (pre-existing)
- `fable-handoff/manifest.json:5` — `"compiler": "claude-sonnet-4-6"` (metadata only, not runtime)
- `docs/claims_enhancement_findings.md:9` — stale doc reference (not code)
- Other model string occurrences outside runtime.ts are in comments, workspace docs, or fable-handoff
  documentation — none are runtime imports

**CONSEQUENCE:** After fix, a future model upgrade in runtime.ts propagates automatically to
cost calculations. telemetry.ts is now clean. No other production files bypass the constants.

---

## V3 — share.ts / share link feature

**FINDING:** `functions/src/share.ts` does **not exist**. No `createShareLink`, no
`getShareSnapshot`, no `/share/:token` route is implemented in Cloud Functions.

**EVIDENCE:**
- `functions/src/` directory listing (confirmed by agent) — file absent. Complete file list:
  admin, ai, audited, claims, costGuard, describeForm, exportDuckCreek, extract, guards, health,
  index, interpretSearch, invalidate, news, pdfText, portfolioDigest, retrieval/, roleGuard,
  rules, runtime, scaffoldProduct, semanticCache, shapeFeedback, sse, summarize, telemetry,
  tools — no `share.ts`
- `docs/review/shots/32_share_public.png` exists — this surface was captured in a prior review
  session; implementation is either removed or lives elsewhere

**CONSEQUENCE:** Share-link feature is absent from the current codebase. The screenshot
(32_share_public.png) represents a past state. Do not assume it is reachable. Investigate
before implementing or referencing this feature.

---

## V4 — CLAUDE.md, README.md, docs/adr/

**FINDING:**
- `CLAUDE.md` — **EXISTS** at root with complete content: binding invariants, gate command,
  workspace guide pointers, model IDs table, ADR pointers
- `README.md` — **DOES NOT EXIST** at root
- `docs/adr/` — **EXISTS** with two files:
  - `docs/adr/0001-model-ids.md` (Accepted 2026-07-07)
  - `docs/adr/0002-agent-workflow.md` (Accepted 2026-07-07)

**EVIDENCE:** File system check and system context (CLAUDE.md content confirmed).

**CONSEQUENCE:** No CLAUDE.md recreation needed (exists). README.md gap means no onboarding
document for new contributors cloning the repo. Next ADR should be `0003-*`. See
`docs/adr/0003-enhancement-baseline.md` (created this session).

---

## V5 — Firestore rules tests

**FINDING:** Dedicated rules test suite exists at `tests/rules.test.ts` (10 test cases covering
VIEWER read, VIEWER write denied, VIEWER feedback, EDITOR write, ADMIN, unauthenticated,
VIEWER coverage/searchIndex/dictionary/tasks denied, VIEWER vote-only, EDITOR cannot manage
users, audit-log append-only). Integration tests also use `@firebase/rules-unit-testing`
(`tests/integration/mutate.test.ts`).

**EVIDENCE:**
- `tests/rules.test.ts:7` — `import { initializeTestEnvironment, assertFails, assertSucceeds, ... }`
- `tests/integration/mutate.test.ts:11` — `import { initializeTestEnvironment, ... }`
- `package.json:26` — `"@firebase/rules-unit-testing": "^5.0.1"` in devDependencies

**CONSEQUENCE:** `pnpm test:rules` is currently blocked by the port 8080 conflict (see
BASELINE.md). Rules test coverage exists and is substantial — once the port conflict is cleared,
both rules and integration suites will run. The suites use project ID `rules-test` (isolated
from seed data) so they are safe to run against emulators.

---

## V6 — meta/refCounters and allocateRefId

**FINDING:** `scripts/seed.ts` does **not** initialize `meta/refCounters`; no counter documents
are written anywhere in the seed. `allocateRefId()` (`app/src/lib/backend/firebase.adapter.ts:116`)
**scans the collection** via `getDocs` to find the current maximum sequence number, then returns
`max+1`. The fable-handoff documentation (05_DATA_MODEL.md) inaccurately describes this as using
`meta/refCounters`.

**EVIDENCE:**
- `app/src/lib/backend/firebase.adapter.ts:116-156` — function body: uses `refIdsIn(collectionPath)`
  which calls `getDocs`, extracts refId strings, reduces to max sequence with regex, returns `max+1`
- `scripts/seed.ts` — no `meta/` writes anywhere (confirmed by full grep)
- fable-handoff documentation is inaccurate on this point

**CONSEQUENCE:** `allocateRefId` runs **outside** any Firestore transaction (before the `applyEnvelope`
transaction at lines 361 and 387). Under concurrent creates targeting the same collection, two
callers can read the same max and both produce the same refId — a silent collision. Safe for
current single-user/low-concurrency workload; will require a counter-doc or transaction-based
approach at scale.

---

## V7 — adapter.db.mutate call sites and expectedRev

**FINDING:** All confirmed **UPDATE** operations pass `expectedRev`. **DELETE** operations at
`ProductCoverages.tsx:166` and `deleteDraft.ts` (multiple sites) omit `expectedRev`. The
`HistoryDrawer.tsx:149` restore-from-snapshot UPDATE omits `expectedRev` intentionally (restore
semantics are defined as unconditional). **CREATE** operations correctly omit `expectedRev`
everywhere.

**EVIDENCE (selected):**
- `app/src/routes/Tasks.tsx:137` — update, expectedRev: `task.rev` ✓
- `app/src/routes/Feedback.tsx:285,321` — update/delete, expectedRev passed ✓
- `app/src/routes/product/ProductWorkspace.tsx:68` — update, expectedRev passed ✓
- `app/src/routes/Dictionary.tsx:118,149` — update/delete, expectedRev passed ✓
- `app/src/routes/product/ProductRules.tsx:390` — update, expectedRev: `editing.rev` ✓
- `app/src/components/product/RatingTableEditor.tsx:252,268` — update, expectedRev passed ✓
- `app/src/components/product/PromoteDraftDialog.tsx:38` — update, expectedRev: `product.rev` ✓
- `app/src/routes/product/ProductCoverages.tsx:166` — **delete, expectedRev OMITTED** ✗
- `app/src/lib/product/deleteDraft.ts:37,46,57,61` — **delete, expectedRev OMITTED** ✗
- `app/src/components/product/HistoryDrawer.tsx:149` — update (restore), omission intentional

**CONSEQUENCE:** Delete operations without `expectedRev` can silently win a race condition
(concurrent delete beats an in-flight edit without error). For coverage deletes and draft
deletion this is low-risk in practice, but is a deviation from the atomic-mutation invariant.
The `MutationPayload` type allows `expectedRev?: number` so these callers could simply add the
field. HistoryDrawer omission is defensible by design.

---

## V8 — Pricing path and grid depth

**FINDING:** `ProductPricing.tsx` computes the premium **client-side** via the shared `evaluate()`
function imported directly from `@pf/shared` — no dedicated pricing endpoint, no `run_rating`
chat message. The RT/LD grid editor (`RatingTableEditor.tsx`) implements: keyboard navigation
(ArrowUp/Down/Left/Right + Enter), TSV paste range fill, tabbed 3-D matrix layout,
dimension add/remove/rename/reorder. Footer: `"Arrow keys / Enter to move · type to edit ·
paste TSV to fill a range"`. **Frozen headers** are NOT in the in-app editor (only in the
Excel export). Full keyboard Tab navigation is absent.

**EVIDENCE:**
- `app/src/routes/product/ProductPricing.tsx:9` — `import { evaluate, resolveLob, resolveRatingKit } from '@pf/shared'`
- `app/src/routes/product/ProductPricing.tsx:167-172` — `evaluate(ratingProgram, inputs, ...)`
- `app/src/components/product/RatingTableEditor.tsx:127-151` — keyboard nav + TSV paste
- `app/src/components/product/RatingTableEditor.tsx:409` — footer help text
- `app/src/lib/export/excel.ts:88` — frozen headers in Excel export only (`ySplit: freezeRows`)

**CONSEQUENCE:** Client-side evaluate() means rating logic runs in the browser. This is correct
and intentional (shared package is the single evaluator). Frozen headers and Tab-key navigation
are gaps relative to the "full 3-D grid" spec — candidates for future enhancement but not
blocking current functionality.

---

## V9 — Builder creation paths

**FINDING:** Builder at `/app/builder` is **fully implemented** with all four creation paths:
"Scaffold with AI" → `ScaffoldProductModal`, "Import workbook" → `ImportWorkbookModal`,
"Clone a product" → `CloneProductModal`, "Blank draft" → `NewProductModal`. No coming-soon stub.

**EVIDENCE:**
- `app/src/routes/Builder.tsx` — four `StartCard` components + four modal conditionals:
  `modal === 'scaffold'`, `modal === 'import'`, `modal === 'clone'`, `modal === 'new'`
- All four modal components are real implementations (confirmed by agent inspection)

**CONSEQUENCE:** Builder is production-ready. AI scaffold path calls `scaffoldProduct` Cloud
Function (grounded, not free-generating).

---

## V10 — Extraction scope

**FINDING:** `extractCoverages` (actually the `extract` Cloud Function) runs **all four sections**:
coverages, forms, rules, rating. Each section uses cheap-first cascade (MODEL_FAST/Haiku),
with per-section escalation to MODEL (Sonnet) if the sanitizer detects fabrication or
under-reading.

**EVIDENCE:**
- `functions/src/extract.ts:295-311` — `sections` array with four entries:
  `{ key: 'coverages', ... }`, `{ key: 'forms', ... }`, `{ key: 'rules', ... }`, `{ key: 'rating', ... }`
- Each entry has its own tool definition, instruction, maxTokens, and `clean` function

**CONSEQUENCE:** Extraction is comprehensive. Cost control is in place via cheap-first cascade
and per-section escalation gating.

---

## V11 — Design system

**FINDING:** No dark theme toggle (light-only design). No `lucide-react` imports (banned by
`app/CLAUDE.md`; all icons from `app/src/components/ui/icons.tsx`). Brand accent tokens:
`--color-accent #8B1FE0`, `--color-accent-bright #A100FF` (Accenture purple identity ✓),
`--color-accent-strong #7A00E6`. refId and chip elements styled with `font-mono` + `tabular-nums`
(`font-variant-numeric: tabular-nums lining-nums`, `font-feature-settings: "tnum" 1`).

**EVIDENCE:**
- `app/src/index.css` — `@theme` block: 50+ `--color-*` tokens; no hardcoded hex outside this file
- `app/CLAUDE.md` — "There is no `lucide-react` dependency; do not add it."
- Grep of `app/src` for `lucide-react` — zero hits
- Grep of `app/src` for `dark|theme-toggle|darkMode` — only CSS comments about WCAG AA darkening,
  no toggle component or dynamic class

**CONSEQUENCE:** Design token discipline is enforced. Accenture brand identity #A100FF–#7A00E6
is correctly expressed. Dark mode is not planned. refId monospace + tabular-nums are present.

---

## V12 — Environment safety

**FINDING:** `app/.env.development.local` **exists** (gitignored via `*.local`) and sets
`VITE_USE_EMULATORS=false`. This means `pnpm dev` without `pnpm dev:seed` connects to the
**real `productreinvention` Firebase project**. Storage emulator IS declared in `firebase.json`
(port 9199) and the adapter correctly connects to it when `VITE_USE_EMULATORS=true`.
When `false`, local uploads hit live Cloud Storage.

**EVIDENCE:**
- `app/.env.development.local` — `VITE_USE_EMULATORS=false`
- `firebase.json` — emulators: auth(9099), firestore(8080), functions(5001), hosting(5000),
  storage(9199) all declared
- `app/src/lib/backend/firebase.adapter.ts:43-49` — adapter switches Storage to emulator on
  `VITE_USE_EMULATORS=true` (labeled "B8 FOOTGUN FIX")

**CONSEQUENCE:** **FOOTGUN**: a developer running `pnpm dev` (not `pnpm dev:seed`) silently
connects to production Firebase. The gitignored `.env.development.local` enforces this default.
Mitigation: always use `pnpm dev:seed` for local development. Consider adding a guard that
logs a prominent warning when `VITE_USE_EMULATORS=false` in development mode.

---

## V13 — baseForms and Claims surface

**FINDING:** `scripts/seed.ts` seeds **6 baseForms documents** via `seedStorageForms()`:
HO 00 03, HO 04 61, PP 00 01, PP 13 01, PP 03 28, CG 00 01. The Claims surface is **not
inert** after a clean `pnpm dev:seed` — it has 6 pre-seeded forms ready for analysis.

**EVIDENCE:**
- `scripts/seed.ts:1168` — `await db.doc(\`baseForms/\${docId}\`).set({ ... status: 'READY' ... })`
- Seed guard: wrapped in `if (!targetProd)` so it only runs against emulators
- `shared/src/seed/personalHome.ts` and `personalAuto.ts` — no baseForms writes (all in seed script)

**CONSEQUENCE:** Claims copilot is immediately usable after seeding. The 6 forms cover HO,
PA, and GL base forms plus key endorsements. No PDF upload is required to start using Claims.

---

## V14 — Rules Simulate panel

**FINDING:** A full **Simulate panel exists** in `app/src/routes/product/ProductRules.tsx`.
Toggled by a "Simulate…" / "Hide simulate" button. When open: renders `PHSimulatePanel` (Personal
Home) or `PASimulatePanel` (Personal Auto) accepting a `SelectionContext`, displaying live
violations, blocked options, and attached forms per rule card using the shared rules engine.
Gated by `lob.supportsRulesSimulation` (both PH and PA have `true`; GL has no value → panel
absent for GL).

**EVIDENCE:**
- `app/src/routes/product/ProductRules.tsx:2` — file header: "Simulate panel that runs the SHARED rules engine"
- `app/src/routes/product/ProductRules.tsx:87-195` — `PHSimulatePanel` component
- `app/src/routes/product/ProductRules.tsx:197-320` — `PASimulatePanel` component
- `app/src/routes/product/ProductRules.tsx:323-346` — `canSimulate`, `simulateRule(r, result!)`
- `app/src/routes/product/ProductRules.tsx:463-502` — toggle button + conditional render
- `app/src/components/product/ruleSim.ts:26` — `simulateRule` implementation
- `shared/src/insurance/lobRegistry.ts` — `supportsRulesSimulation: true` on both PH and PA
- `shared/src/rules/engine.test.ts:30` — `PA_LOB.supportsRulesSimulation is true`

**CONSEQUENCE:** Simulate panel is production-ready for PH, PA, and GL (see V15). The panel
uses the same shared engine as the test suite, ensuring test-and-UI parity.

---

## REMEDIATED — Security half (session 2026-07-09)

Evidence-backed fixes landed this session (companion detail in the commit + `docs/adr/0004`):

- **SEC-01 — hardcoded demo admin removed.** `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, and
  `signInAsAdmin()` deleted from `app/src/lib/backend/firebase.adapter.ts`; `signInAsAdmin`
  removed from the `BackendAdapter` interface and the AWS placeholder. No runtime call sites
  existed (e2e signs in through the Landing form; `capture-screens.mjs` already used
  `CAPTURE_USER` / `CAPTURE_PASS`). The same credential strings in `FeedbackProvider.tsx` were
  sourced from `VITE_MAINTAINER_EMAIL` (default off) so nothing identifies a real account in the
  bundle. Verified: production build → `grep dist` for the email and password returns nothing.
- **SEC-02 — dev bypass structurally gated.** The entire dev-admin bypass (state, sessionStorage
  key, `signInAsDevAdmin`) lives behind a single `import.meta.env.DEV` guard and is spread onto
  the adapter only in dev; production omits it. Verified: `grep dist` for `signInAsDevAdmin` and
  `pf.devAdminBypass` returns nothing.
- **SEC-03 — guest read-only floor.** `VITE_ALLOW_GUEST` (default true) added; `firestore.rules`
  tightened so anonymous sessions can read but never write (`isGuest()`/`isMember()`). See
  `docs/adr/0004-guest-read-floor.md`.
- **SEC-04 — `hello` health function.** Now requires an authed caller, binds
  `[ANTHROPIC_API_KEY, VOYAGE_API_KEY]`, and returns `{ ok, voyage }` (secret PRESENCE only,
  never the values; no model call).
- **SEC-05 — env-drift guards.** `scripts/guard-backend.mjs` refuses a live-Firebase `pnpm dev`
  unless `ALLOW_LIVE=1`; `scripts/seed.ts` refuses `--project productreinvention` unless
  `ALLOW_LIVE=1` (plus the existing typed confirmation). Both print the target backend.

## HUMAN ACTIONS — required (not doable from the repo)

1. **Rotate the exposed demo-admin password** on the live `productreinvention` Firebase project.
   The password (`scrudato`, account `sal@productreinvention.app`) was compiled into the client
   bundle and must be treated as public. Set a new password for that account (and any other
   account provisioned with it) in Firebase Auth. The local emulator seed is unaffected.
2. **Restrict access to the live backend** — enable **Firebase App Check** (attestation on
   Firestore / Functions / Storage) and/or tighten **Authorized domains** in Firebase Auth so a
   leaked config + anonymous sign-in cannot drive the live project from an arbitrary origin.
   Confirm production Cloud Functions only allow the intended web origins (CORS).

---

## V15 — General Liability at parity (2026-07-10)

**FINDING:** Commercial General Liability (CGL, CG 00 01 occurrence form) is now registered and
seeded at full parity with PH and PA. Three rating canaries are locked.

**EVIDENCE:**
- `shared/src/insurance/lobRegistry.ts` — `GL_LOB` added; `LOB_REGISTRY` now has three entries.
  prefix `GL`, lineCategory CASUALTY, family Casualty, commercial vertical, supportsRulesSimulation true.
- `shared/src/seed/generalLiability.ts` — full GL seed:
  - `GL_LD_TABLES` (GL.LD.001–004): per-occurrence limit, general aggregate, PCO aggregate, deductible
  - `GL_RT_TABLES` (GL.RT.001–005): class base rate, increased-limits factor, deductible credit, PCO rate, exp mod
  - `GL_RATING_PROGRAM` (GL.RAT.1, 7 steps): SET class rate → MUL exposure → MUL ILF → MUL ded credit → ADD PCO (conditional) → MUL exp mod → MIN_FLOOR $500
  - `GL_COVERAGES` (GL.COV.001–003 + sub-coverages GL.COV.001.001, GL.COV.001.002): Coverage A (BI/PD + P&O + PCO), B (Pers/Adv Injury), C (Med Pay)
  - `GL_FORMS` (8 forms): CG 00 01, CG DS 01, CG 20 10, CG 20 33, CG 03 00, CG 21 06, CG 21 67, CG 21 70
  - `GL_RULES` (GL.RU.001–007): occurrence trigger, aggregate options, PCO dependency, exposure basis, deductibles, minimum premium, aggregate consistency
  - `GL_FORM_RULES` (GL.FORM.RU.001–003): PCO → CG 20 33, deductible → CG 03 00, AI → CG 20 10
  - `GL_DICTIONARY` (GL.DEF.001–006): occurrence, each-occurrence limit, general aggregate, PCO aggregate, exposure basis, claims-made trigger
  - `makeGLRtGetter` — bespoke lookup for GL.RT.001–005; GL.RT.004 returns pcoRate × pcoExposureThousands (the full PCO premium)
  - `makeGLLdGetter = makeLdGetter` — generic LD getter shared by all lines
  - `GL_RATING_INPUT_SPEC` — 7 fields driving DynamicRatingForm for GL
  - `GL_WORKED_EXAMPLE` — class 41677, exposureThousands 500, occLimit 1M, occDeductible 0, pcoElected true, pcoExposureThousands 200, expMod '1.00'
- `shared/src/rating/generalLiability.evaluator.test.ts` — GL canary (9 assertions):
  - `expect(result.finalPremium).toBe(2635)` — the regression lock
  - Per-step trace assertions: s1=2.5, s2×500=1250, s3×1.82=2275, s4×1.00=2275, s5+360=2635, s6×1.00=2635, s7 floor unchanged
- `shared/src/rating/kits.ts` — `GL` kit added (makeGLRtGetter, makeGLLdGetter, GL_WORKED_EXAMPLE, GL_RATING_INPUT_SPEC)
- `shared/src/rules/engine.ts` — `evaluateRulesGL()` added; dispatches on `lob === 'GL'`; covers:
  - GL.RU.007: occLimit > genAggregate → hard violation
  - GL.RU.003: pcoElected + pcoAggregate < occLimit → hard violation
  - GL.LD.001–004 option constraints
  - form attachment: CG 20 33 (PCO), CG 03 00 (deductible > 0), CG 20 10 (additional insured)
- `shared/src/types.ts` — `GLSelectionContext` added; `RulesEngineInput` extended with `lob: 'GL'` variant
- `scripts/seed.ts` — GL bundle added (GL.PROD.001 through all subcollections); GL canary verified at $2,635 (fatal on mismatch); GL news item seeded
- `app/src/routes/product/ProductRules.tsx` — `GLSimulatePanel` added; `glSel` state; `result` useMemo dispatches on `lob.prefix === 'GL'`
- `docs/reviews/GROUND_TRUTH.md` V1 updated to close the GL gap

**GL $2,635 canary derivation** (class 41677, payroll basis):
```
s1 SET  GL.RT.001[41677]           = 2.50                       → 2.50
s2 MUL  INPUT exposureThousands    = 500                        → 2.50 × 500   = 1,250.00
s3 MUL  GL.RT.002[occLimit=1M]     = 1.82                       → 1,250 × 1.82 = 2,275.00
s4 MUL  GL.RT.003[occDed=0]        = 1.00                       → 2,275 × 1.00 = 2,275.00
s5 ADD  GL.RT.004[41677,pco=200]   = 200 × 1.80 = 360           → 2,275 + 360  = 2,635.00
s6 MUL  GL.RT.005[expMod='1.00']   = 1.00                       → 2,635 × 1.00 = 2,635.00
s7 MIN_FLOOR CONST 500 round 0     → max(2,635, 500)            = $2,635
```

**HOSTILE SELF-REVIEW:**
- No GL coverage, form number, rule, or factor was invented; all derive from the ISO CGL programme
  structure and the workbook fixture definitions in `samples/iso/20-ISO-*-GL.xlsx` (referenced in
  the seed file header). The illustrative rates are marked as such in every RT table comment.
- HO-3 $1,528 canary is unchanged — evaluator.ts was not modified.
- PA $1,002 canary is unchanged — personalAuto seed and evaluator were not modified.
- GL knowledge does NOT appear in core prompts (`functions/src/ai.ts`, `functions/src/claims.ts`).
  GL context enters through the line-profile registry (`shared/src/claims/lineProfiles.ts`, already
  present before this session) and through seeded data (groundingChunks, coverages, rules).

**CONSEQUENCE:** GL is at parity with PH and PA. Portfolio digest, grounding index, DynamicRatingForm,
Simulate panel, LOB segmentation filters, and refId counters all include GL.

---

## V16 — Filing importer (second ingestion mechanism) + evaluator credit-cap (2026-07-10)

**FINDING:** The platform now has a SECOND ingestion mechanism alongside the ISO-workbook
importer: a **filing importer** that turns a real carrier rate filing (a set of PDFs) into a
reviewable, governed product. The reference set is the NJ Lemonade Homeowners filing, committed at
`samples/filings/nj-lemonade-ho/` (RATE ORDER OF CALCULATIONS, HOMEOWNERS MANUAL ed. Dec 2023,
policy form LEM 03 05 23). See `docs/adr/0005-filing-importer.md`.

**EVIDENCE:**
- Pure domain `shared/src/insurance/filing/`:
  - `types.ts` — `FilingDocRole`, rate-order/manual/policy-form proposal shapes, `FilingImportPlan`
    (wraps the workbook importer's `ImportPlan` + a review bundle + `unresolved` + `counts`).
  - `registry.ts` — `classifyRuleNumber` (ISO numbering plan: 92→CREDIT_CAP, 205→MIN_PREMIUM,
    406→DEDUCTIBLE, 1–2 base loss cost, 3xx scheduled property, 4xx protective device, 5xx/6xx
    endorsement schedules) + `FILING_CONCEPTS` + `matchConcept` (normalized-name + alias join,
    credit flags).
  - `tableParser.ts` — DETERMINISTIC `parseFactorTable` (pairs / triples / matrix) + `sampleCells`
    / `cellValueAppearsInText`. The model discovers the schema + quotes the verbatim region; code
    parses the rows and COUNTS what it can't (never invents). A ragged/misaligned row is skipped.
  - `sanitize.ts` — citation-mandatory guards for classify/rate-order/manual (mirror
    `insurance/extraction.ts`); a manual table carries only a SCHEMA + region, never model rows.
  - `reconcile.ts` — pure `reconcileFiling()`: joins the three extractions, emits the ImportPlan +
    review, maps rate-order variables onto engine ops (SET base loss cost, MUL factors, ADD flats,
    MIN_FLOOR from the min-premium rule, `creditFloor` from the max-credit rule). Unresolvable
    variables become UNRESOLVED with reason + citation. Conservation: `proposed === accepted + unresolved`.
  - `njLemonadeFiling.ts` — the reference extraction, grounded in the three PDFs (base loss costs,
    LCM 1.727, zip→territory→LCMF triples, tier relativities, Rule 406 matrix, Rule 92 = 50%/40%,
    Rule 205 = $420/$300/$60, Coverage A–F). Single source of truth for the golden test + AI_FAKE.
- Server pipeline `functions/src/filingImport.ts` (exported in `index.ts`): SSE, EDITOR/ADMIN,
  `sseCostGate('filingImport', …)`, `recordCascade`. CLASSIFY (cheap forced tool per doc) →
  EXTRACT (rate-order + manual forced tools with cheap-first→escalate; policyForm reuses
  `runFourSectionExtraction`, factored out of `extract.ts`) → RECONCILE (pure). `filingImport`
  cost key = $0.085 in `costGuard.ts`.
- AI_FAKE: `createFakeFilingClient()` (`functions/src/fake/index.ts`) — non-streaming forced-tool
  double dispatching on tool name; drives the pipeline in `functions/src/filingImport.test.ts`.
- Review UI: `app/src/components/product/FilingImportModal.tsx` (+ Builder "Import a filing" card,
  `app/src/lib/import/filingImportClient.ts`). UNRESOLVED first; per-section accept; persists via
  the existing `importPlan()` with `filingLineage()` (kind IMPORT, sources = the filing docs).
- **Evaluator extension** (`shared/src/rating/evaluator.ts`): optional `RatingProgram.creditFloor`
  + `RatingStep.isCredit`. Floors the cumulative credit product (Rule 92 archetype) with ONE
  corrective trace step after the last credit. NO change to any program that doesn't set them.
- **Pricing** (`shared/src/rating/gridInputs.ts` + `app/.../ProductPricing.tsx`):
  `deriveGridInputSpec()` builds a data-driven worksheet from a program's grid tables so an
  imported product prices in the UI; returns null (untouched) for the seeded PH/PA/GL lines.

**Imported product CANARY — $1,281** (`shared/src/insurance/filing/reconcile.test.ts`), priced
through the shared `evaluate()` with a manual-default worked example (territory 30 / zip 07004 /
tier 5 / Coverage A ≥ $300k, $2,500 deductible / PP replacement cost):
```
s1 SET  baseLossCost[30]        = 456.93
s2 MUL  LCM (Rule 1)            × 1.727 → 789.12
s3 MUL  LCMF[07004] (Rule 2)    × 1.606 → 1,267.32
s4 MUL  Tier[5] (Rule 13)       × 1.022 → 1,295.20
s5 MUL  Deductible[$300k+,2500] × 0.83  → 1,075.02   (Rule 406)
s6 MUL  Loss settlement (14)    × 1.35  → 1,451.28
s7 MUL  Renovation credit (26)  × 0.91  → 1,320.66   ┐ credits 0.8827 ≥ 0.50 floor (Rule 92)
s8 MUL  Loyalty credit (24)     × 0.97  → 1,281.04   │ → no cap correction
s9 MUL  Gated community (23)    × 1.000 → 1,281.04   ┘
s10 MIN_FLOOR $420 (Rule 205), round 0 = $1,281
```

**HOSTILE SELF-REVIEW:**
- *Can the model invent a factor/row?* No structured rows cross the wire — the manual tool returns
  a SCHEMA + verbatim region; `parseFactorTable` produces the rows; a fabricated value not in the
  region fails `cellValueAppearsInText` (tested). Base-loss-cost table is resolved by CONCEPT, not
  kind, so an LCMF table (also base-loss-cost kind) can't be mistaken for it.
- *Does anything persist without review?* No — the server writes nothing; persistence is the app's
  `importPlan()` after per-section accept. UNRESOLVED items are never persisted.
- *Is every unresolved item visible?* Yes — rendered first, with reason + citation; the golden test
  asserts `proposed === accepted + unresolved` and that Protection-Construction / Key Factor (real
  rate-order variables the manual states no table for) surface as UNRESOLVED.
- *Did the evaluator extension change any existing program?* No — HO-3 $1,528 / PA $1,002 / GL
  $2,635 re-asserted byte-identical in `evaluator.creditFloor.test.ts` (no `__credit_cap__` entry).

**CONSEQUENCE:** Carriers' actual filed documents are now a first-class ingestion path, at the same
grounding + governance bar as the workbook importer. Gate: typecheck ✓, lint ✓, 697 unit tests ✓
(576 shared+app, 121 functions), build ✓. `test:rules`/`integration`/`e2e` remain blocked by the
pre-existing port-8080 emulator conflict (V5 / BASELINE), unrelated to this work.

---

## V17 — Duck Creek export reconciled to the real reference + hardened (2026-07-10)

**FINDING:** The real Duck Creek reference (`samples/duckcreek/DuckCreekXML.xml`, and its
byte-identical twin `PolicyXML.xml`, `md5 06f63274…`) was supplied and committed read-only. It is
an `OnlineData.loadPolicyRs` **instance** (AIG PCG Naples-FL coastal-wind PersonalHome quote), not
a manuscript definition. The PDM→Duck Creek exporter was reconciled against it element by element,
the mappable gaps closed, validation made fail-closed, and byte-stable golden snapshots frozen for
all three seeded lines.

**EVIDENCE:**
- **Reconciliation** — `docs/reviews/DUCKCREEK_RECONCILIATION.md`: element/attribute × in-ref ×
  in-export × source-of-truth × action, grouped by region (policy header, line/risk, coverage
  entries, limits/deductibles, StatCode, subjectivities, indicators, territory mapping). Every row
  is MAP NOW (with source), OUT OF SCOPE (runtime, one-line reason), or NEEDS DATA.
- **Gaps closed** (`shared/src/duckcreek/{mapping,serialize}.ts`):
  - `<LineOfBusiness>` from `PdmLine.compactName` (child of `<product>`).
  - Coverage `<Indicator t="endorsement" ismandatory>` on endorsement-like coverages
    (OPTIONAL / sub-coverages); `ismandatory` from `requirement`. Base bureau coverages A–F carry
    none, matching the sample.
  - `<RiskManuscriptTableManuScriptID>` — `composeTableManuscriptIdForScope()` →
    `Carrier_LOB_Market_Tables_<state|country>_v_v_v_v`, one per peril-eligible state (PH → FL GA
    NC SC TX, incl. the sample's FL) else one national entry. Deterministic.
  - Coverage `t` convention (`CoverageA…F`), `Caption`, typed `limit`/`deductible` children were
    already correct — confirmed against the reference.
  - `lobTokens` gained an explicit `GL: 'GL'` (was falling back).
- **Out of scope (runtime)** — Premium quintet **emitted as zeros** (sample always includes it);
  TermFactor / PremiumAfterWaiver / risk scores / ISO stat codes / Verisk `dtsToTerritoryMapping` /
  subjectivities / account-party-session blocks **omitted**. Ledger + emit-vs-omit rationale in the
  reconciliation doc.
- **GL PDM builder** — `shared/src/pdm/source.ts` gained `GENERAL_LIABILITY_BUNDLE` +
  `buildGeneralLiabilityPdm()` (GL was seeded since V15 but had no PDM builder). The PDM builder is
  line-agnostic, so the GL bundle serializes + validates with no builder changes.
- **Fail-closed validation** (`shared/src/duckcreek/validate.ts`) — new `requiredFieldsPresent`,
  `enumsValid`, `numericFormatsValid` dimensions: required elements (root manuScriptID,
  LineOfBusiness, per-state RiskManuscriptTableManuScriptID, coverage Caption, form FormNumber),
  enum membership (requirement / rating op / sourceType / ruleType / valueType / booleans), numeric
  format (premium quintet, numeric eligible values, minimumPremium, const, roundTo), and a
  parse-back well-formedness re-parse. Any violation flips `ok=false`.
- **UI** — `DuckCreekExportModal` now renders a validation-dimension strip and (pre-existing) the
  field-level issue list; download stays disabled unless `report.ok` — silently-invalid XML is
  never emitted.
- **Golden snapshots** — `shared/src/duckcreek/golden.test.ts` + `__golden__/{personalHome,
  personalAuto,generalLiability}.duckcreek.xml`: each line serialized twice byte-identically and
  compared to the committed golden (regenerate with `UPDATE_GOLDEN=1`). The Prompt-6 filing fixture
  is out of scope (an import-time artifact, not a seeded standing bundle) — stated in both files.
- **Audit continuity** — `functions/src/exportDuckCreek.test.ts` asserts a `manuScriptID`-bearing
  `export-duckcreek` audit event on every export, including a REPEAT export of the same product
  (append-only; never deduped), and NO write when the guard rejects.

**HOSTILE SELF-REVIEW:**
- *Traceable?* Every emitted element maps to a reference element (reconciliation doc) or is a
  clearly-flagged honest extension (`refId`, `validValues`, `Section`, the definitional
  rating/rules sections the instance lacks). Every unmapped reference field is listed OUT OF SCOPE
  or NEEDS DATA with a reason.
- *Byte-stable across two runs?* Yes — golden.test.ts asserts two independent builds are identical
  and equal the committed golden; re-run in a fresh process reconfirmed. No clocks / no RNG;
  effectiveDate is opt-in; all ordering is fixed (coverages by order, tables by refId, steps by
  order, table scopes sorted).
- *Fail closed?* Yes — faithful PH/PA/GL pass all dimensions (asserted); tampering (non-numeric
  premium, out-of-enum op, missing LineOfBusiness, dropped refId, broken id prefix, missing
  namespace, malformed XML) each flips `ok=false` and the modal blocks download.
- *Canaries?* HO-3 $1,528 / PA $1,002 / GL $2,635 untouched — no rating code changed.

**CONSEQUENCE:** The Duck Creek export is reconciled to the real reference, fail-closed, and
byte-stable for all three seeded lines. Gate: typecheck ✓, lint ✓, 737 unit tests ✓ (612
shared+app, 125 functions), build ✓. `test:rules`/`integration`/`e2e` remain blocked by the
pre-existing port-8080 emulator conflict (V5 / BASELINE), unrelated to this work.

---

## V18 — Azure cutover complete + Firebase teardown (2026-07-10)

**FINDING:** The migration off Firebase/GCloud onto Azure is COMPLETE, and the orphaned
Firebase-era scaffolding has been removed (branch `sec-remediation-and-cleanse`). The runtime is
now: React/Vite SPA → same-origin Azure App Service host (`server/`, Express) → Cosmos DB (data),
JWT auth (tenant-scoped), Azure AI Foundry Claude (AI), Azure Blob (storage). V1–V17 above describe
the Firebase era and are retained as history; where they name `firebase.adapter.ts`,
`firestore.rules`, emulators, or `pnpm dev:seed`, read them as superseded by this entry.

**EVIDENCE (runtime is Azure-only):**
- `app/src/lib/backend/index.ts` — exports the Azure adapter; "The Firebase adapter is retired."
- `app/src/lib/backend/azure.adapter.ts` — talks ONLY to `/api/*`; reads `VITE_API_BASE`, never
  `VITE_USE_EMULATORS`. `subscribe()` degrades to polling (there is no Cosmos onSnapshot).
- `server/server.js` + `server/lib/{auth,data,cosmos,ai,storage,admin}.js` — the live host:
  `/api/auth` (JWT), `/api/db` (Cosmos), `/api/ai` (Foundry Claude, SSE), `/api/storage` (Blob),
  `/api/admin` (tenants + users).
- `server/lib/data.js` — the atomic-mutation invariant now lives here: entity + audit + version +
  searchIndex commit in ONE Cosmos `items.batch(ops, pk)`; `expectedRev` → 409; `requireRole('EDITOR')`
  on writes; tenant partition `${tenantId}|${base}`.
- `azure-pipelines.yml` — push to `main` builds the SPA + assembles `server/` + deploys to App
  Service. Nothing Firebase is built or deployed.
- `scripts/migrate-to-cosmos.ts` — the Cosmos seeder (Azure replacement for the deleted `seed.ts`).

**REMOVED (proven-dead; per-file evidence in `docs/reviews/CLEANUP_REPORT.md`):** Firebase
hosting/emulator/rules config (`firebase.json`, `.firebaserc`, `firestore.rules`,
`firestore.indexes.json`, `storage.rules`, `storage.cors.json`); emulator/seed/e2e/capture scripts
(`scripts/seed.ts`, `wait-and-seed.mjs`, `guard-backend.mjs`, `e2e-serve.mjs`, `capture-screens.mjs`,
`docs/handoff/take-screenshots.mjs`); the Firestore-rules + emulator integration suites
(`tests/rules.test.ts`, `tests/integration/*`, `vitest.rules.config.ts`, `vitest.integration.config.ts`,
`playwright.config.ts`, `e2e/*`); the Firestore-only client helpers extracted from the retired
adapter (`app/src/lib/backend/{envelope,refIdAlloc,coverageParent}.ts` + tests); app files superseded
by the unified importer (`FilingImportModal.tsx`, `filingImportClient.ts`, `BaseFormExtract.tsx`) and
the unused `app/src/lib/svg/ratingFlow.tsx`; the dead `signInAsDevAdmin` adapter member; and the
`firebase` / `firebase-admin` / `@firebase/rules-unit-testing` / `@playwright/test` /
`@axe-core/playwright` / `concurrently` / `pdf-lib` dev dependencies. `functions/` is RETAINED (a gated
reference; its AI handlers are not yet ported to `server/lib/ai.js`).

**CANARIES:** unchanged — HO-3 $1,528 · PA $1,002 · GL $2,635 · imported $1,281 (no rating code
was touched). NB: the GL canary is **$2,635** (see V15), not $2,789.

**CONSEQUENCE:** No Firebase-era runtime or scaffolding remains. The role-enforcement invariant
that V5 tested via `firestore.rules` is now enforced server-side in `server/lib` (and must be
maintained there); that layer has no automated test suite yet — a flagged follow-up gap.

---

## V21 — Desktop-first responsive · safe PWA · fleet-wide model routing (2026-07-11)

**FINDING:** Three fronts landed together, plus fixes for two live errors (service-worker clone
exceptions and a `summarizeProduct` 501). Canaries untouched: HO-3 **$1,528** · PA **$1,002** · GL
**$2,635** (re-asserted in the gate run).

**EVIDENCE:**
- **PWA (safe, anti-stale).** `app/vite.config.ts` derives the build id from the deploy GIT HASH
  (`BUILD_SOURCEVERSION` → `git rev-parse` → `Date.now()`), stamps it into `dist/sw.js`
  (`__BUILD_ID__` → `prh-<hash>` cache name) and `dist/version.json`. `app/public/sw.js` rewritten:
  cache-first hashed `/assets`, network-first HTML navigations, SWR public static + the SINGLE
  public API path `/api/auth/tenants`; **every other `/api/*` passes straight through** (fail-closed
  — `/api/db/*`, `/api/serff/*`, `/api/duckcreek/*`, `/api/storage/*`, `/api/homecheck` inventory PII
  are never cached); `/version.json` never cached (keeps `VersionWatcher` honest). `activate` evicts
  all non-current caches; `message` handles `SKIP_WAITING` / `CLEAR_ALL_CACHES`. The AZ4 clone bug is
  fixed (`cachePut` clones synchronously before the body is consumed) and `respondWith` always
  resolves to a Response (offline fallback). `VersionWatcher` now pulls + activates the new SW on a
  version change before prompting reload. `azure.adapter.signOut()` clears the SWR maps + all Cache
  Storage + posts `CLEAR_ALL_CACHES`.
- **Fleet-wide routing + cost guard.** `shared/src/ai/fleet.ts` is the single source of Foundry
  deployment names; new `FLEET_PRICING` / `estimateCostUsd` / `degradedRole`. Bundled to
  `server/lib/fleet-shared.cjs` (`pnpm build:fleet`, mirrors the serff/duckcreek bridges).
  `server/lib/fleet.js` resolves role→deployment and runs an in-process rolling-window cost guard
  (allow → soft-degrade at 80% → deny at ceiling). The three prod call sites now route through it
  with NO hardcoded model strings and per-call spend accounting: `ai.js` chat (GROUNDED_CITED, stream
  usage captured), `serff.js` memo prose (BULK_VERIFY), `homecheck.js` vision (VISION). `ai.js` also
  **ports `summarizeProduct`** (BULK_VERIFY, forced-tool, grounded, best-effort persist to Cosmos
  `productSummaries/{id}`) — fixing the Overview-tab 501. Production has no cascades; the reference
  ensemble router calibrates confidence from agreement, not self-report (unchanged).
- **Responsive (desktop density preserved — all changes gated at `sm:`/`max-*`/mobile-only).** Shared
  `Dialog` restructured to the scrollable-modal pattern (outer container scrolls, panel keeps
  overflow visible so in-panel dropdowns never clip) — tall modals are usable on mobile; behaviour
  locked by `Dialog.test.tsx`. `ProductHierarchy` reveals per-coverage actions on touch + tightens
  indent on mobile; `RatingTableEditor` gains a mobile scroll affordance; `DisagreementHeatmap` `<th>`
  gains `scope="col"`. GTM board already collapsed columns (`md`/`xl`) — unchanged.
- **Accessibility.** `vitest-axe` + `axe-core` re-added (dev-only; removed in V18 cleanup);
  `app/src/a11y.axe.test.tsx` runs axe over DisagreementHeatmap, UnifiedImportModal, DuckCreekExportModal
  and HomeCheck — which surfaced and fixed a real defect (the import file `<input>` had no label).

**HOSTILE SELF-REVIEW** — *after a push-to-main deploy, can a logged-in underwriter on the installed
PWA see a stale bundle or stale portfolio data, or does the SW ever cache an authenticated response?*
- **Stale bundle: no.** Navigations are network-first, so an online reload always fetches fresh HTML
  + content-hashed assets; the deploy changes the git-hash build id → new `CACHE_NAME` → the new SW's
  `activate` wipes every prior cache; `VersionWatcher` (5-min poll + on focus, reading no-cache
  `version.json`) prompts a reload. Verified end-to-end by booting the artifact: `version.json` is
  served `no-cache`, `sw.js` carries the git hash, assets are `immutable`.
- **Stale/authenticated data: no.** The only cached `/api` path is `/api/auth/tenants` (public,
  unauthenticated by server design). Every other `/api/*` passes through uncached; on logout all
  caches are cleared.

**GATE:** typecheck ✓ · lint ✓ · test ✓ (685 shared+app incl. new fleet/axe/Dialog suites, 187
functions) · build ✓ (bundle within budget; `sw.js` stamped). No server secret appears in the client
bundle (only the user's own JWT, by design).
