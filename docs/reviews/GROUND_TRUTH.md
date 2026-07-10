# Ground Truth — Verification Ledger

Established 2026-07-09 by reading code. Every answer is evidence-backed.
Companion: `docs/reviews/BASELINE.md` (gate state on the same date).

---

## V1 — Seeded lines and canaries

**FINDING:** Two LOBs are registered and seeded: **PH** (Personal Home, HO-3) and **PA**
(Personal Auto, PAP). **GL is not registered** in LOB_REGISTRY; a CG 00 01 PDF form is seeded
to Storage for claims use, but GL has no LobDefinition, no rating kit, and no seed data.

**EVIDENCE:**
- `shared/src/insurance/lobRegistry.ts` — `LOB_REGISTRY` has exactly two entries:
  - `PH.LOB.001` — prefix `PH`, label "Personal Home", lineCategory PROPERTY, family Property,
    perilModel COASTAL_WIND_HAIL (FL GA NC SC TX), supportsRulesSimulation true
  - `PA.LOB.001` — prefix `PA`, label "Personal Auto", lineCategory CASUALTY, family Automobile,
    perilModel TERRITORY, supportsRulesSimulation true
- `shared/src/seed/personalHome.ts` — full HO-3 product seed (PH.RAT.1 rating program)
- `shared/src/seed/personalAuto.ts` — full PAP seed (PA.RAT.1 rating program)
- `scripts/seed.ts:1168` — `baseForms/CG-00-01` written for GL claims use only
- Rating canaries (both confirmed PASS in baseline gate):
  - HO-3: `shared/src/rating/evaluator.test.ts:16` — `expect(result.finalPremium).toBe(1528)`
  - PA:   `shared/src/rating/personalAuto.evaluator.test.ts:18` — `expect(result.finalPremium).toBe(1002)`
  - rtGrid canary: `shared/src/rating/rtGrid.test.ts:57` — also asserts 1528

**CONSEQUENCE:** GL is a claims-only surface driven by the uploaded CG 00 01 base form; it
cannot be rated and does not appear in LOB segmentation filters. Rating kit coverage: HO-3
and PA only. Steers Prompt 5 — no GL rating work needed.

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

**CONSEQUENCE:** Simulate panel is production-ready for PH and PA. GL rules simulation is not
supported (no GL rules engine). The panel uses the same shared engine as the test suite,
ensuring test-and-UI parity.

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
