# FUNCTIONAL_CODEBASE.md — Product Reinvention Hub

> **Read-only reconnaissance pack.** A code-verified functional map of the monorepo,
> produced against the live local emulator stack (Firestore/Auth/Functions/Storage/Hosting)
> with both rating canaries confirmed from the seed run: **HO-3 = $1,528** and
> **General Liability = $2,789**. No application source under `app/`, `functions/`, or
> `shared/` was modified in producing this document.
>
> **Method.** The router (`app/src/App.tsx`), the backend adapter (`app/src/lib/backend/`),
> configs, rules, and the rating stack were read directly; the full domain contract, data
> model, screens, AI layer, functions, and security were cross-read line-by-line and every
> claim below is anchored to a `file:line`. Where archived docs conflict with code, **code
> wins** and the divergence is called out in §15.

---

## 1. System overview

**Product Reinvention Hub** is an insurance **product-management workbench**: one app where a
product manager authors, inspects, prices, and governs insurance products — coverages, policy
forms, rating algorithms, product rules, state footprints — with a grounded AI copilot layered
over a fully audited, versioned data core.

Two reference products are seeded and drive every worked example:

- **HO.PROD.001 — Homeowners, HO-3 Special Form** (LOB `HO.LOB.001`, peril `COASTAL_WIND_HAIL`).
- **GL.PROD.001 — Monoline General Liability** (LOB `GL.LOB.001`, peril `TERRITORY`).

GL exists to prove the platform is **line-agnostic**: every surface renders from data + a
per-LOB registry, with no Homeowners assumptions in the chrome (`shared/src/insurance/lobRegistry.ts`).

The headline regression guarantee is the **rating canary**: HO-3 must evaluate to exactly
**$1,528** and GL to exactly **$2,789**, asserted in unit tests *and* re-verified by the seed
script before it writes its report (`scripts/seed.ts:318-334`).

## 2. Monorepo layout & stack

pnpm workspace (`pnpm-workspace.yaml`); three packages + root tooling:

| Workspace | Path | Role | Key stack |
|---|---|---|---|
| `app` | `app/` | React SPA (the workbench UI) | React 19.2, Vite 8.1, react-router-dom 7.6, Tailwind v4 (`@tailwindcss/vite`), Firebase JS SDK 11, `@dnd-kit/*`, fuse.js 7.1, exceljs 4.4, sonner 2 |
| `functions` | `functions/` | Firebase Cloud Functions v2 (Node 20 target) — all server-side AI + privileged writes | `firebase-functions ^6.6`, `firebase-admin ^13.4`, `@anthropic-ai/sdk ^0.54`, tsup → `lib/` |
| `@pf/shared` | `shared/` | Pure TypeScript: domain types, rating evaluator, rules engine, seed data, LOB registry, ISO import, search ranker | zero platform imports (no `firebase`, `window`, `process.env`) |

Backend is **Firebase**: Firestore (data), Auth (email/password + custom-claim roles), Cloud
Functions (AI + privileged mutations), Storage (form PDFs), Hosting (SPA). An **AWS swap** is
designed-for but not implemented — the `aws.adapter.placeholder.ts` seam plus `AWS-SWAP:`
comments throughout the adapter/rank/evaluator map Firestore→DynamoDB, callable/SSE→Lambda,
Auth→Cognito, TF-IDF→dense embeddings.

## 3. Architecture

### 3.1 The adapter seam — the one Firebase entry point

All frontend reads/writes go through a single `adapter`; **components never import
`firebase/*` directly**. This is the AWS-swap seam.

- `app/src/lib/backend/index.ts:2-3` — exports `adapter` (currently Firebase) + the
  `BackendAdapter`/`MutationPayload`/`MutationConflictError` types. Swapping clouds = flip one export.
- `types.ts` — the `BackendAdapter` contract + `MutationPayload`.
- `firebase.adapter.ts` — the live impl.
- `aws.adapter.placeholder.ts` — documented DynamoDB/Lambda/Cognito mapping.
- `firebase.config.ts` — public web config + `FUNCTIONS_REGION` (`us-central1`).

Adapter surface (`firebase.adapter.ts:98-427`): `auth` (`signIn`, `signOut`, `onUser`,
`signInAsAdmin`, `signInAsDevAdmin`, `changePassword`), `db` (`get`, `list`, `subscribe`,
`mutate`, `vote`, `tx`), `storage` (`upload`, `getUrl`), `fns` (`call`, `stream`),
`presence` (`join`, `watch`).

### 3.2 Emulator wiring & environment (safety-critical)

Emulators are wired **only** when `import.meta.env.VITE_USE_EMULATORS === 'true'`
(`firebase.adapter.ts:35-41`): Auth→`127.0.0.1:9099`, Firestore→`:8080`, Functions→`:5001`.
**Storage is deliberately never emulated** — `storage.upload`/`getUrl` hit **live** Firebase
Storage even in emulator mode (`firebase.adapter.ts:33,40`).

The committed default is **live/production**: both `app/.env.development` and the gitignored
`app/.env.development.local` ship `VITE_USE_EMULATORS=false`. A plain `pnpm --filter app dev`
therefore talks to the **real** `productreinvention` project; emulator mode is opt-in for
`pnpm dev:seed`. (Vite's `loadEnv` gives a shell `process.env.VITE_*` priority over the `.env`
files, so emulator mode can be forced per-process.) `adapter.fns.stream` picks the emulator
vs prod functions base URL the same way (`firebase.adapter.ts:367-369`).

### 3.3 The `mutate()` invariant — one atomic transaction

Every entity write goes through `adapter.db.mutate(payload)` as **one Firestore
`runTransaction`** (`firebase.adapter.ts:220-320`) — *not* a bare `writeBatch`. Atomically:

1. **Entity write + rev bump** — `create` sets `rev:1` + `createdAt/updatedAt/updatedBy`;
   `update` sets `rev=prev+1`; `delete` removes (`:273-280`).
2. **Optimistic concurrency** — if `expectedRev` is passed, the current rev is read **inside**
   the transaction and compared; mismatch throws `MutationConflictError` → "please refresh"
   toast (`:246-248`). The transactional read guarantees the rev validated is the rev committed
   against, so a concurrent writer cannot be silently overwritten (`:224-231`).
3. **Field-level version diff** — `{field, before, after}[]` computed vs the pre-image + a full
   `snapshot`, written to `versions/{autoId}` (`:250-258, 289-294`).
4. **Append-only audit** → `auditEvents/{autoId}` (`:283-286`).
5. **Search-index upsert/delete** → `searchIndex/{path_with_underscores}` for indexable types
   only (`product, coverage, rule, form, ldTable, rtTable, dictionary, task` — `:77, 296-318`).

**Domain guard at the seam:** a `coverage` write carrying `terms` is validated by
`assertCoverageTermsValid` **inside** the transaction against the merged doc, so a corrupt
option/limit matrix can never persist (`:265-270`). Two narrow paths bypass the full envelope by
design: `db.vote` (VIEWER-allowed `votes` only, un-audited — `:322-330`) and `presence`
heartbeats (`:407-427`).

### 3.4 Roles via custom claims

Role is a Firebase Auth **custom claim** `role ∈ {VIEWER, EDITOR, ADMIN}` read off the ID token
(`firebase.adapter.ts:49-63`). VIEWER is read-only, enforced **two-sided** — Firestore rules
*and* every Cloud Function (§9). Claim set by the ADMIN-only `setUserRole` callable; effective on
next token refresh. Auth entry points: real email/password `signIn` (bare username →
`…@productreinvention.app`), a real seeded-admin `signInAsAdmin`, and a **dev-only**
`signInAsDevAdmin` client bypass (fake ADMIN, **no backend**, reads empty / writes throw,
`import.meta.env.DEV`-guarded — remove before prod, `firebase.adapter.ts:79-96,151-168`).
Signed-out users are **auto-signed-in anonymously** (no role claim → rules deny writes) so
token-gated reads/AI work without a manual login (`:126-141`).

### 3.5 Server-side AI / SSE pipeline

All Anthropic calls live in `functions/`; the browser never holds the key. Client calls
`adapter.fns.call(name, data)` (unary callable) or `adapter.fns.stream(name, data, onChunk,
signal)` (POST + SSE, `AbortSignal`-cancellable) (`firebase.adapter.ts:358-404`). The SSE reader
splits on `\n`, forwards `data:` lines, and always releases the reader on exit (`:385-403`).
Server SSE events (`functions/src/runtime.ts:87-104`): `token{v}`, `tool{name,phase,summary?}`,
`json{key,value}`, `error{message}`, `done`. Model/tool/grounding detail in §7–§8.

### 3.6 Route table (`app/src/App.tsx:40-86`)

Lazy routes under `BrowserRouter` + `UserProvider` + `VersionWatcher` + `ErrorBoundary` +
`Suspense`.

| Path | Component | Auth |
|---|---|---|
| `/` | `routes/Landing.tsx` | public |
| `/sign-in` | `routes/SignIn.tsx` | public |
| `/must-change-password` | `routes/MustChangePassword.tsx` | public (post-login) |
| `/share/:id` | `routes/Share.tsx` | **public share viewer** (no auth) |
| `/app` | `routes/AppShell.tsx` (guarded; index → `Home`) | authed |
| `/app` (index) | `routes/Home.tsx` | portfolio Q&A |
| `/app/products` | `routes/Products.tsx` | |
| `/app/products/:id` | `routes/product/ProductWorkspace.tsx` (index → `overview`) | nested tabs |
| `.../overview` | `routes/product/ProductOverview.tsx` | |
| `.../coverages` | `routes/product/ProductCoverages.tsx` | |
| `.../forms` | `routes/product/ProductForms.tsx` | |
| `.../pricing` | `routes/product/ProductPricing.tsx` | |
| `.../states` | `routes/product/ProductStates.tsx` | |
| `.../rules` | `routes/product/ProductRules.tsx` | |
| `/app/builder` | `routes/Builder.tsx` | |
| `/app/explorer` | `routes/Explorer.tsx` | |
| `/app/tasks` | `routes/Tasks.tsx` | |
| `/app/news` | `routes/News.tsx` | |
| `/app/claims` | `routes/Claims.tsx` | |
| `/app/dictionary` | `routes/Dictionary.tsx` | |
| `/app/feedback` | `routes/Feedback.tsx` | |
| `/app/admin` | `routes/Admin.tsx` | ADMIN |
| `*` | → redirect `/` | |

---

## 4. Data model

Canonical contract: `shared/src/types.ts` (559 lines). `createdAt`/`updatedAt` are `unknown`
(Firestore Timestamp on read, null/ISO on the wire). Most entities mix in **`GovernanceBlock`**
(`types.ts:14-23`): `status`, `lifecycle`, `reviewStatus`, `reviewer?`, `createdAt`,
`updatedAt`, `updatedBy`, `rev` (the mutate() conflict guard) — and often **`StateScope`**
(`allStates`, `states[]`).

### 4.1 Collections

**Top-level** (governed by `firestore.rules`):

| Collection | Type (`types.ts`) | Notable fields |
|---|---|---|
| `products/{pid}` | `Product` `65-83` | `refId`, `name`, `lob:{refId,name}`, `marketSegment`, `owner`, `health:{score,findingCount}`, `baseForm?`, `lineage?` + Governance + StateScope |
| `forms/{formKey}` | `Form` `264-282` | **global**, `number`, `edition`, `category`, `dynamicFields[]`, `productRefIds[]`, `description` (AI, cached) + Governance + StateScope |
| `ldTables/{refId}` | `LDTable` `223-227` | **global**, `rows: LDRow[]` |
| `rtTables/{refId}` | `RTTable` `230-239` | **global**, `columns[]`, `rows[]`, `dimensions?`, `valueColumn?` |
| `dictionary/{id}` | `DictionaryEntry` `379-398` | `type`, `allowedValues[]`, `aliases?`, `usedIn?` (computed live, never persisted) + Governance |
| `tasks/{id}` | `Task` `324-336` | `column: TaskColumn`, `checklist`, `order`, `dueAt?` + Governance |
| `taskTemplates/{id}` | `TaskTemplate` `551-558` | ADMIN-writable; code constant is fallback |
| `feedback/{id}` | `Feedback` `343-357` | `type`, `votes:{count,voters[]}`, `impact/effort:1\|2\|3`, `priorityScore` (no Governance) |
| `comments/{id}` | `Comment` `313-320` | `entityPath`, `body`, `resolved` |
| `news/{id}` | `News` `361-370` | `urlHash`, `url`, `tags[]`, `relatedProductIds[]` |
| `newsPrefs/{uid}` | `NewsPrefs` `372-375` | per-user `instruction` |
| `baseForms/{id}` | (shape mirrors `Product.baseForm`) | uploaded base-form metadata |
| `auditEvents/{id}` | `AuditEvent` `302-309` | append-only; `actor`, `action`, `entityPath` |
| `versions/{id}` | `Version` `292-300` | append-only; `snapshot`, `diff: VersionDiff[]` |
| `searchIndex/{id}` | `SearchIndexEntry` `404-411` | doc id = entity path `/`→`_`; ⌘K corpus |
| `seedReports/{id}` | `SeedReport` `415-421` | Admin-SDK only |
| `presence/{pid}/viewers/{uid}` | — | realtime presence |
| `shares/{shareId}` | — | public read-only product snapshot |
| `users/{uid}` | `User` `54-61` | `role: Role`, `active`, `mustChangePassword` |

**Per-product subcollections** (`products/{pid}/…`): `coverages/{cid}` (`Coverage` `155-166`:
`parentId`, `requirement`, `formNumbers[]`, `terms: CoverageTerm[]`), `rules/{rid}` (`Rule`
`172-181`: `category`, `condition`, `outcome`, `coverageRefIds[]`, `formNumbers[]`,
`ldTableRef?`), `formRules/{id}` (`FormRule` `183-189`), `ratingPrograms/{gid}` (`RatingProgram`
`208-213`: `minimumPremium`, `steps: RatingStep[]`).

### 4.2 refId scheme & form numbers

**refId = `PREFIX.KIND.NNN[.NNN[.NNN]]`** — dotted; first segment = LOB prefix (resolves the
line), second = entity kind, rest = sequence + nesting. KIND tokens: `PROD`, `LOB`, `COV`, `RU`,
`FORM.RU`, `RAT`, `LD`*, `RT`*, `DEF`. *HO uses line-prefixed `HO.LD.*`/`HO.RT.*`; **GL uses
un-prefixed `LDTable.*`/`RTTable.*`** (`ho3.ts:66,125` vs `gl.ts:62,114`) — both keyed the same
in Firestore. Firestore doc id = refId with `.`→`-` (`isoImport.ts:173`; seed `:202`).

**Sub-coverage nesting:** a coverage is top-level when `parentId===null`, a sub-coverage when
`parentId` is set — and **`parentId` holds the parent's `refId`, not its doc id**
(`inventory.ts:16-18`). E.g. `HO.COV.001.001` (Water Back-Up) has `parentId:'HO.COV.001'`
(`ho3.ts:455-456`). Unresolvable parents are surfaced as `orphans`, never dropped
(`inventory.ts:65-71`; importer promotes to top-level with a warning `isoImport.ts:367-374`).

**Form numbers** = `"XX NN NN"` + separate `edition` `"MM YY"` (e.g. `HO 00 03` / `05 11`;
`CG 00 01` / `04 13`). Normalization for grounding checks strips whitespace/hyphens and
uppercases, requiring ≥4 chars to be verifiable (`extraction.ts:95-106`). Doc key = number with
spaces→`-`.

### 4.3 Enums (selected, `types.ts`)

`Status` (ACTIVE/INACTIVE/FUTURE), `Lifecycle` (DRAFT/IN_REVIEW/APPROVED/LAUNCHED),
`ReviewStatus`, `Role` (VIEWER/EDITOR/ADMIN), `Requirement` (MANDATORY/OPTIONAL),
`TermKind` (LIMIT/DEDUCTIBLE/OPTION), `LimitStructure` (SINGLE/OCCURRENCE_AGGREGATE/…/SCHEDULED),
`OptionValueType` (FLAT/PERCENT/SPLIT/CSL/SCHEDULED/WAITING_PERIOD), `RuleCategory`
(PRODUCT/RATING/FORMS), `FormCategory`, `DynamicFieldType`, `TaskColumn`
(IDEATION/BUILD_FILE/TEST_APPROVE/LAUNCH_MONITOR), `FeedbackType/Status`, `SearchEntityType`,
`LineageKind` (BLANK/IMPORT/CLONE/AI_SCAFFOLD), `HoOccupancy`.

---

## 5. Domain logic

### 5.1 Rating evaluator (`shared/src/rating/evaluator.ts`)

`evaluate(program, inputs, rtGetter, ldGetter): { finalPremium, trace }` (`evaluator.ts:21-62`).
Getters are DI'd so the engine is testable without Firestore. Flow (`:27-59`): steps **sorted by
`order`**; `running` starts **0**; a step with a falsy `condition` input-key is **skipped
entirely** (no trace entry); `source` resolves to a factor/amount; the `op` applies; if `roundTo`
set, `Math.round` (half-up) before store.

**Ops** (`:38-43`): `SET` (replace), `MUL` (×), `ADD` (+), `MIN_FLOOR` (`max(running,factor)`).
No default branch. **Sources** (`resolveSource :64-111`): `CONST` (literal), `INPUT`
(numeric input), `LD` (line/deductible getter — **dead for all seeded data**; both getters
throw), `RT` (rate table, keyed), `SPP` (**hard-coded** `Σ appraisedValue/100 × classRate`).
`TraceEntry` (`types.ts:474-482`): `{stepId, label, op, sourceRef, factorOrAmount, rounded,
runningTotal}`; `finalPremium` = last running total.

### 5.2 HO-3 worked example → **$1,528** (headline canary)

Inputs `HO3_WORKED_EXAMPLE` (`ho3.ts:847-865`); program `HO.RAT.1` = 14 steps (`ho3.ts:367-396`);
asserted `evaluator.test.ts:16`; re-checked `scripts/seed.ts:324`. 13 steps execute (s4b
skipped, `windHailElected:false`):

| Step | Op | Source | Factor/amt | Running |
|---|---|---|---|---|
| s1 | SET | RT `HO.RT.001`[territory T002] | 700 | 700 |
| s2 | MUL | RT `HO.RT.002`[pc 5, constr M] | 1.05 | 735 |
| s3 | MUL (round 0) | RT `HO.RT.003`[covA 400000] | 1.30 | 955.5 → **956** |
| s4a | MUL | RT `HO.RT.004`[allPerilDed 1000] | 1.00 | 956 |
| s4b | *skipped* | condition `windHailElected`=false | — | — |
| s5 | MUL | RT `HO.RT.005`[covCPct 70] | 1.06 | 1013.36 |
| s6 | ADD | RT `HO.RT.006`[covE 300000] | 24 | 1037.36 |
| s7 | ADD | RT `HO.RT.006`[covF 2000] | 6 | 1043.36 |
| s8a | MUL | CONST 1.10 (cond `rcElected`) | 1.10 | 1147.696 |
| s8b | MUL (round 2) | RT `HO.RT.008`[device none] | 1.00 | → 1147.70 |
| s9 | MUL | RT `HO.RT.009`[tier B] | 1.10 | 1262.47 |
| s10a | ADD | RT `HO.RT.010`[waterBackup 5000] (cond) | 75 | 1337.47 |
| s10b | ADD | SPP `HO.RT.007` (Jewelry 15000/100 × 1.27) | 190.50 | 1527.97 |
| s11 | MIN_FLOOR (round 0) | CONST 500 | 500 | max(1527.97,500) → **1528** |

### 5.3 GL worked example → **$2,789**

Inputs `GL_WORKED_EXAMPLE` (`gl.ts:255-266`); program `GL.RAT.1` = 8 steps (`gl.ts:238-247`);
asserted `gl.evaluator.test.ts:18`; re-checked `scripts/seed.ts:331`. All 8 execute:

| Step | Op | Source | Factor/amt | Running |
|---|---|---|---|---|
| s1 | SET | INPUT `lossCost` | 4.20 | 4.20 |
| s2 | MUL | INPUT `exposureUnits` | 300 | 1260 |
| s3 | MUL | RT `RTTable.002`[lcmState OH] | 1.50 | 1890 |
| s4 | MUL (round 2) | RT `RTTable.001`[Prem/Ops, tbl 2, occ 1000] | 1.40 | 2646 |
| s5 | MUL | INPUT `scheduleMod` | 0.90 | 2381.40 |
| s6 | MUL (round 2) | INPUT `tierFactor` | 1.15 | → 2738.61 |
| s7 | ADD | CONST 50 (cond `terrorismElected`) | 50 | 2788.61 |
| s8 | MIN_FLOOR (round 0) | RT `RTTable.004`[classTable 2] | 125 | max(2788.61,125) → **2789** |

(Alt cases: terrorism off → **$2,739** `gl.evaluator.test.ts:41`; tiny exposure → floor **$125** `:51-52`.)

### 5.4 Rules engine (`shared/src/rules/engine.ts`)

A **pure, hand-coded HO-3 evaluator** (not a generic condition-DSL interpreter — the stored
`Rule.condition`/`outcome` are free-text prose; the engine hard-codes the equivalent logic).
`evaluateRules({ldTables, selection}): RulesResult` (`engine.ts:22-155`) returns
`availableOptions` (per LD table), `formsThatAttach` (form numbers), `violations`,
`evaluatedRuleRefIds`. Three passes:

1. **Available options per LD table** (`:26-58`) — e.g. HO.LD.002 covF $5,000 requires E≥300k;
   HO.LD.004 wind/hail available in coastal states only *and* its `(pct/100)*covA` dollar ≥ the
   all-peril deductible.
2. **Hard violations** (`:60-112`) — `[HO.RU.006]` covF/covE, `[HO.RU.008]` wind/hail in
   non-coastal + wind/hail-dollar < all-peril, eligibility `[HO.RU.010]` seasonal/secondary
   w/o companion, `[HO.RU.001]` tenant/non-owner. All emitted at severity `error`.
3. **Forms that attach** (`:114-137`) — always `HO 00 03`/`HO DS 01`/`PN HO 01`, then
   conditional (RC→`HO 04 90`, water backup→`HO 04 95`, SPP→`HO 04 61`, TX→`HO 01 33`, …).

Operators are inline JS comparisons (`===`, `<`, `≥`, `Set.has`); no serialized operator
vocabulary. `evaluatedRuleRefIds` is hard-coded to the four rules whose conditions are directly
evaluated (`:153`). Coastal set comes from `HO_LOB.peril.eligibleStates` (`:8-10`). GL sets
`supportsRulesSimulation:false`, so its Rules tab shows a documentation-only message and no
Simulate.

### 5.5 Typed terms model — LIMIT / DEDUCTIBLE / OPTION

Logic in `shared/src/insurance/terms.ts`; invariants in `termConstraints.ts`. `CoverageTerm`
(`types.ts:136-153`) is a three-layer representation: **`optionSet` (rich `StandardOption[]`) is
authoritative when present; else derived from legacy `options`/`default`/`min`/`max` + LD
table**, with legacy fields mirrored via `syncLegacy` on save (`terms.ts:100-110`). `TermKind`
(LIMIT/DEDUCTIBLE/OPTION) is a category; the concrete value shape discriminates on
`StandardOption.type` (`OptionValueType`): `FLAT`/`CSL`/`SCHEDULED` → `value`, `PERCENT` →
integer %, `SPLIT` → `parts[]`, `WAITING_PERIOD` → hours. Each option carries its own
applicability (`allStates`/`states[]`) + `isDefault`/`enabled`.

Integrity rules (`types.ts:119-121`): exactly one enabled default; each option's states ⊆ the
coverage scope; values within [min,max]. `validateTerm` (`termConstraints.ts:55-108`) enforces
intrinsic rules; `validateHoDemonstratives` (`:123-191`) adds HO cross-coverage checks
(`[HO.RU.006]` covF-requires-covE, `[HO.RU.008]` windHail<allPeril). The **mutate()-seam assert**
`assertCoverageTermsValid` (`:217-227`) enforces only the four **structural** codes provable from
one document (`multi-default`, `no-default`, `no-states`, `states-scope`) and throws inside the
transaction; the cross-coverage demonstratives are gated in the editor pre-write.

### 5.6 LOB registry (HO COASTAL vs GL TERRITORY)

`shared/src/insurance/lobRegistry.ts`. A `LobDefinition` (`:46-72`) carries: refId/prefix,
display, segmentation (`vertical`, `family`, `lineCategory`), `sectionTaxonomy` (section
grouping predicates), `perilModel` (`kind ∈ COASTAL_WIND_HAIL|TERRITORY|NONE`, `eligibleStates`,
`label`), `footprintStates`, and `supportsRulesSimulation`.

| Aspect | HO (`:91-110`) | GL (`:127-150`) |
|---|---|---|
| refId/prefix | `HO.LOB.001` / HO | `GL.LOB.001` / GL |
| vertical / family | Personal Lines / Property | Commercial Lines / Casualty |
| sections | Section I — Property, Section II — Liability | Coverage A / B / C / Other |
| peril | `COASTAL_WIND_HAIL`, `[FL,GA,NC,SC,TX]` | `TERRITORY`, `[]` |
| footprint | 15 states | 44 states + DC |
| rules simulation | `true` | `false` |

Resolution: `resolveLob(product)` (exact refId → prefix → default HO), `resolveLobByRefId`
(prefix-only), `groupBySection`, `isPerilState`. Registry auto-extends portfolio segmentation
facets when a line is added (`:204-267`). Adjacent pure modules: `inventory.ts` (coverage tree /
inventory rows / display identity), `isoImport.ts` (ISO-workbook → canonical mapper, verbatim
refId/form preservation, orphan repair), `extraction.ts` + `scaffold.ts` (grounded-extraction
wire shapes + anti-fabrication sanitizers — **every proposal must carry a citation or is dropped
in code**), `search/rank.ts` (dependency-free TF-IDF cosine ranker over the `searchIndex`
corpus, `{id,score}` contract, AWS-swappable for dense embeddings).

---

## 6. Screen-by-screen

Adapter surface used by screens: `adapter.db.subscribe(path, cb)` (onSnapshot),
`adapter.fns.call/stream`, `adapter.presence.join/watch`. Write concurrency + gating summary for
the product workspace:

| Screen | mutate op / entityType | expectedRev? | canEdit-gated? |
|---|---|---|---|
| Workspace rename | update / product | **yes** (`product.rev`) | yes |
| Coverages delete | delete / coverage | n/a | yes (`if(!canEdit)return` + children-block + confirm) |
| States save | update / product | **yes** | yes |
| Rules edit | update / rule | **yes** (`editing.rev`) | yes |
| Rules create | create / rule | n/a (new) | yes |

### 6.0 AppShell + ProductWorkspace + contexts (shared frame)

- **AppShell** (`AppShell.tsx`) — authenticated frame: route guard (`if(!user) <Navigate
  to="/sign-in">` `:39`), collapsible `Sidebar`, `Topbar`, mustChangePassword banner
  (`:50-55`), `FeedbackProvider`, sonner `Toaster`. **Owns ⌘K/Ctrl+K** (`:20-29`, cleanup
  present) → `CommandPalette`. Solid.
- **ProductWorkspace** (`ProductWorkspace.tsx`) — hero header + tab strip. Presence
  join/watch (cleanup `:48`), sibling-switcher `subscribe('products')` (cleanup `:57`), inline
  rename with `expectedRev` + conflict toast (`:87-102`), Promote/Comments/History drawers,
  `ExportMenu`, `createShare` callable (`:68`, role-checked). Solid.
- **CommandPalette** (`components/palette/CommandPalette.tsx`) — subscribes to `searchIndex`
  while open (cleanup + reset on close `:105`), Fuse fuzzy match (title 0.7 / subtitle 0.3 /
  keywords 0.5), recents in localStorage, keyboard nav, type badges; `toRoute` maps
  entity→route (`:17-33`). Solid.
- **UserContext** — `auth.onUser` + nested `users/{uid}` profile subscription, both cleaned up,
  StrictMode-safe (`:31-59`). **ProductContext** — one effect opens **10 subscriptions**
  (`TOTAL_SUBS=10`) for product/coverages/rules/formRules/ratingPrograms + 5 global collections,
  all torn down on unmount (`:102`); `loading = loaded < 10`. Solid, no leaks.

### 6.1 Product › Overview (`ProductOverview.tsx` → `ProductSummaryDashboard.tsx`)

Thin route wrapper → `ProductSummaryDashboard`. Executive at-a-glance. **AI:**
`fns.call('summarizeProduct', {product: buildMeta()})` — compact metadata snapshot (coverages,
rules≤24, rating step count/min, `baseForm`), auto-runs once/product/session, cached to
sessionStorage (`pf.summary.${pid}`), Regenerate forces refresh. Grounding = a header label
"Grounded in the base form `<formNumber>`" (not per-claim citations). **Solid** (dashboard).

### 6.2 Product › Coverages (`ProductCoverages.tsx`)

Cards ⇄ list, grouped into LOB sections, parents then sub-coverages. Fuse search, view toggle
persisted, deep-link `?cov=`. **Delete** = mutate delete (children-blocked, confirm-gated,
canEdit). Create/aspect edits delegated to `CoverageEditDialog` / `TermOptionsDialog` /
`CoverageStatesDialog` / `CoverageFormsDialog`. **AI:** renders `BaseFormExtract` (create-time
base-form identify/extract entry). Coverage detail exposes Limits/Deductibles/Options + states +
forms. **Solid.**

### 6.3 Product › Forms (`ProductForms.tsx`)

Master-detail forms repository. Left = searchable/filterable list; right = `FormDetail`
(identity, editions, attachment, states, "where used" clickable backlinks, dynamic-fields).
Two-way linked with coverages via `?form=`/`?cov=`. **AI:** `fns.call('describeForm',
{formKey})` → cached plain-English description (button toggles Generate/Regenerate). **Solid.**

### 6.4 Product › Pricing (`ProductPricing.tsx`) — the $1,528/$2,789 surface

Rating worksheet. Left = editable, drag-reorderable algorithm with per-step running totals
(`RatingAlgorithm`); right = scenario inputs + spring-animated premium (`PremiumCard`).
`evaluate(ratingProgram, inputs, kit.makeRtGetter(rtTables), kit.makeLdGetter(ldTables))` in a
useMemo (try/catch → null). **No AI** — pure deterministic shared evaluator. HO/GL split:
`isHO = lob.prefix==='HO'` renders **`HomeownersRatingPanel`** (coastal set + riskState) vs
**`GenericRatingPanel`** (driven by `kit.inputSpec`); kit by `resolveRatingKit(lob.prefix)`.
Reduced-motion-aware spring, changed-step diff highlight, `PricingLinkagePanel` for `?cov=`.
**Solid.** (Note: `PremiumCard premium={result?.finalPremium ?? (tablesReady ? null : null)}` is
a redundant both-null ternary — harmless dead expression.)

### 6.5 Product › States (`ProductStates.tsx`)

SVG grid choropleth (`StateTileMap`, the shared component behind all three state surfaces) +
keyboard chips; bulk All/Clear; SVG export via `XMLSerializer`. **Save** = mutate update
(`states`, `allStates:false`) with `expectedRev`. Footprint-clipping so scope can never exceed
100%. Line-driven: `FOOTPRINT=lob.footprintStates`, `COASTAL=lob.peril.eligibleStates`, peril
badge from `lob.perilModel` — **no coastal facts hard-coded**. HO shows the amber wind/hail
bolt on coastal footprint states; GL (TERRITORY) supplies its own model. **Solid.**

### 6.6 Product › Rules (`ProductRules.tsx`)

IF→THEN flow cards grouped by ISO category→sub-category, a live **Simulate** panel running the
shared `evaluateRules` against a sample submission, and a grounded AI **RuleComposer**.
**Writes:** edit (update, `expectedRev`) / create (new refId `${prefix}.RU.NNN`, lifecycle DRAFT)
— with a **client-side grounding guard** (`:231-237`) filtering coverage/form/table refs to
those that exist on this product before `mutate()`. HO/GL: `canSimulate =
lob.supportsRulesSimulation` (HO true, GL doc-only). SimulatePanel is HO-shaped
(covA/covE/covF, windHail, occupancy). **Solid.**

### 6.7 Landing (`/` — `Landing.tsx`)

Public marketing showpiece: aurora background + a bespoke SVG "insight graph" (a PM fed by
inward capability streams), single CTA → `/sign-in`. **No adapter calls.** Reduced-motion
honored, draw-timer cleanup. **Solid** (static). Carries hard-coded `rgba()` color literals in
inline styles (no `#`-hex).

### 6.8 SignIn (`/sign-in` — `SignIn.tsx`)

Username/password sign-in → redirects to `from` (default `/app`). `adapter.auth.signIn`, error-code
mapping, keyboard-reachable password reveal (`aria-pressed`). **Solid.** **Note:** the file header
comment still describes a no-credentials **"Continue as admin"** button, but that button is **not
in the current JSX** — only username/password remain (`signInAsAdmin` still exists in the adapter
but is unsurfaced). The seeded logins are `sal`/`scrudato` and `rebecca`/`freeman` (both ADMIN).

### 6.9 MustChangePassword (`/must-change-password` — `MustChangePassword.tsx`)

Forced-reset interstitial when `mustChangePassword=true`. `adapter.auth.changePassword` then
`mutate(update users/{uid} {mustChangePassword:false})` (self-write, **no `expectedRev`**).
Length/match validation. **Solid.** (Not reachable by the seed users — both have
`mustChangePassword:false`.)

### 6.10 Share (`/share/:id` — `Share.tsx`) — public, no auth

Read-only public product snapshot. One-time `adapter.db.get('shares/{id}')` (not a subscription);
handles missing + `expiresAt`. Renders product header + top-level coverages with sub-coverages
(refId-grouped, form-count chip). **Solid but thin** (no forms/rules/rating in the snapshot).
Share **create** happens in the workspace (`createShare` callable); **read** is here via the
Admin-SDK `getShare` HTTP function.

### 6.11 Home (`/app` index — `Home.tsx`) — portfolio cockpit + grounded Q&A

**Inquiry-only, zero mutations** (a VIEWER sees the same as everyone). Reads live `tasks` +
`products` + subscribes `searchIndex` (cleanup present). **AI:** `adapter.fns.stream('chat', {messages})`
over SSE — streams `token`/`tool`/`json`/`error`/`done`; tool chips render live (spinner→check);
assistant prose via `<Markdown onCite={openCitation}>` where **`[bracketed]` citations are
load-bearing clickable chips** that resolve refId/form-number → the entity route (`routeFor`).
`AbortController` cancels on unmount and each new ask. Cockpit rail: `PriorityRail` +
`PortfolioMetrics`, starter pills, `now` frozen at mount. **Solid.**

### 6.12 Products (`/app/products` — `Products.tsx`)

The **published** portfolio (lifecycle `LAUNCHED` only — drafts never leak). Subscribes `products`
(cleanup present); lazy `usePortfolioInventory` for table/tree. Three views —
**Cards / Table (flattened inventory) / Hierarchy (framework tree)** — view persisted to
localStorage; Fuse search + `SegmentFilter` facet counts; staggered `rise-in`; Excel export
(read-only, reads forms/tables/subcollections via `adapter.db.list`). **No writes** ("New draft"
just routes to Builder). **Solid.**

### 6.13 Builder / Drafts (`/app/builder` — `Builder.tsx`)

**Drafts workbench** (lifecycle ≠ LAUNCHED). Subscribes `products` (cleanup present). Four grounded
entry points — **New / Import workbook / Clone / Scaffold with AI** (modals) — plus
`PromoteDraftDialog` (typed-confirmation promote is the only path to Products). **AI:**
`ScaffoldProductModal` → `scaffoldProduct` (SSE, in the modal). `LineageBadge`/`LifecyclePill`/
`RefChip` per draft. VIEWER sees drafts but no create/promote affordances. **A real workbench, not
a stub** — `StubRoute` is now dead/unused.

### 6.14 Explorer (`/app/explorer` — `Explorer.tsx`)

Miller-column cascading browser: Products → Coverages → Sub-coverages → peek. Subscribes products +
forms once, coverages per selection (all cleaned up; state cleared on switch — no stale bleed).
**Reads-only.** The most-engineered a11y surface: roving focus (`pendingFocus` + `useLayoutEffect`),
full keyboard nav + search handoff, reduced-motion `scrollIntoView`, breadcrumb, keyboard legend.
`PeekPanel` enriches attached-form chips from the forms subscription. **Solid.**

### 6.15 Tasks (`/app/tasks` — `Tasks.tsx`)

Product-lifecycle kanban — Board (dnd-kit, pointer+keyboard sensors) / List / Project (per product
w/ lifecycle strip) / People. Subscribes `tasks` + `products` (cleanup present). **Writes (EDITOR+):**
`toggleDone` and `onDragEnd` both `mutate(update task)` with **`expectedRev` + conflict toast**;
controls hidden + `useDraggable({disabled:!canEdit})` for VIEWER. SLA computation. **Solid.**
(Write fns are UI-gated, not internally role-guarded — relies on rules server-side, the documented
model.)

### 6.16 News (`/app/news` — `News.tsx`)

Nightly-agent market-news feed, ranked by **client-side** portfolio relevance (LOB +3, state +2,
server `relatedProductIds` +4) with provenance badges + NL article filter. Subscribes `news` +
optional `newsPrefs/{uid}` (cleanup present). **AI:** `adapter.fns.call('refreshNews', {})`
(on-demand trigger of the Haiku + web-search agent; nightly 06:00 ET is the primary producer).
`savePrefs` → `mutate(newsPrefs/{uid})` (no `expectedRev`). **Solid.** **⚠ VIEWER exposure:** News
has **no role check** — any authed user (incl. VIEWER) can trigger `refreshNews`, which writes the
shared ADMIN-only `news` collection server-side (§9 DRIFT).

### 6.17 Claims (`/app/claims` — `Claims.tsx`) — grounded coverage copilot

Left: base-forms library (`BaseFormsLibrary` — `storage.upload` → `mutate(baseForms PROCESSING)` →
`identifyBaseForm` callable → `mutate(READY)`; upload/remove gated on `canEdit`). Right:
conversation **disabled until a form is selected + its bytes load**. Subscribes `baseForms`
(cleanup); fetches the selected policy PDF from its Storage `url`. **AI:**
`adapter.fns.stream('analyzeClaim', {formNumber, lob?, formBase64|formText, mediaType})` over SSE;
the determination arrives as a `json` event and renders `DeterminationCard` **only if
`shouldRenderDetermination` passes** (client mirror of the server citation guard) — else it refuses
and asks for a rephrase. `AbortController` on unmount and form-switch. **Solid, well-guarded.**

### 6.18 Dictionary (`/app/dictionary` — `Dictionary.tsx`)

Governed catalogue of citable fields/terms with **live** "used in" backrefs (`computeDictionaryUsage`,
never stored) deep-linking to the exact product tab. Live `dictionary` + corpus. **Writes (EDITOR+):**
`save` update with **`expectedRev`**; create allocates `nextRefId`; `remove` behind `window.confirm`
(**no `expectedRev` on delete**). Citation target: `?term=HO.DEF.003` scroll+flash. **Solid.**

### 6.19 Admin (`/app/admin` — `Admin.tsx`) — ADMIN only

Five tabs — **Users / Share Links / Audit Log / Seed Report / Settings**. All subscriptions
(`users`, `shares`, `auditEvents`+`versions`, `seedReports`) cleaned up. **Writes:** UsersTab →
`setUserRole` callable (create/setRole/de-/reactivate); SharesTab → `mutate(delete share)`
attributed to the **real** acting admin; SettingsTab → localStorage (demo). The **audit→version
diff explorer** correlates an audit event to its version by `entityPath` + closest timestamp and
opens a before/after field-diff dialog. Seed Report shows both worked-example premiums + counts +
warnings. **Solid.** **⚠ Gate flash:** the guard is `if (profile && profile.role!=='ADMIN')`, so
while `profile` is loading (`null`) a non-admin briefly sees the console shell + subscribed data
(disclosure flash, not escalation — writes are server-enforced).

### 6.20 Feedback (`/app/feedback` — `Feedback.tsx`)

The product's own PM loop — Inbox / Backlog (drag-ranked) / Shipped / Declined. Subscribes
`feedback` (cleanup). **Writes:** `vote` via the dedicated `adapter.db.vote('feedback/{id}', uid)`
(one-vote, **available to any authed user by design** — matches the rules' vote-only allowance);
`patch` (status/impact/effort/rank) via `mutate(update)` with **`expectedRev`**, only from
`canEdit`-gated controls; `reorderPlanned` batches rank patches. **Solid.**

### 6.21 Key AI components (located)

- **Base-form extraction review dialog** → `app/src/components/product/BaseFormExtract.tsx`,
  rendered from the **Coverages tab** (`ProductCoverages.tsx:129`), *not* Claims/Builder. Streams
  `extractCoverages` (4 `json` sections), shows each proposal with an editable field + **confidence
  %** + a **"Cited:"** provenance line (nothing renders uncited — the server drops uncited/
  unverifiable items), then writes selected items via `mutate()` in dependency order
  (forms→coverages→rules→rating) allocating refIds **client-side**. `if(!canEdit) return null`.
- **Citation renderers:** `components/chat/Markdown.tsx` (`CitationChip` — clickable navigating
  button when `onCite` is supplied on Home, static chip in Claims; XSS-safe, no
  `dangerouslySetInnerHTML`) and `components/claims/DeterminationCard.tsx` (`CitedText` linkifies
  `[bracketed]` cites; verdict pill via tokens/`color-mix`; footer "aid, not a claims decision").

---

## 7. AI layer

Shared plumbing in `functions/src/runtime.ts` + grounding tool surface in `functions/src/tools.ts`.
Model constants (single source): `MODEL='claude-sonnet-5'` (reasoning), `MODEL_FAST='claude-haiku-4-5'`
(bulk) — `runtime.ts:29-30`. Client via `anthropic()` with `maxRetries:4` (`:34-36`), key read only
here. **No sampling params on any Sonnet-5 call**; the only sampling in the repo is
`temperature:0` on Haiku in `news.ts:98` (allowed). Prompt caching: the chat-family functions
build `system=[SYSTEM_PROMPT, opts.system]` with `cache_control:{ephemeral}` on the last stable
block and push volatile context *after* the breakpoint, so the tools+system prefix is reused
across turns/requests.

Grounding tool surface (`tools.ts`, used by chat/draftRule/scaffold/claims):
`search_entities`, `get_product_tree`, `get_coverage`, `get_rules`, `get_forms`, `get_ld_table`,
`run_rating`, `get_dictionary` — plus per-feature "emit" tools. **Grounding is enforced
unevenly:**

| Feature | Model | Grounding enforcement |
|---|---|---|
| `analyzeClaim` (SSE) | Sonnet-5 | **Strongest** — server *rejects* an uncited COVERED/NOT_COVERED/PARTIAL determination (`determinationIsCited`, `claims.ts:222-230`); base-form footer doesn't count |
| `draftRule` (SSE) | Sonnet-5 | Server `verifyDraft` drops unresolved coverage/form/LD refs (`rules.ts:102-152`) |
| `scaffoldProduct` (SSE) | Sonnet-5 | Server `verifyScaffold` drops uncited/invalid proposals + verifies LOB & form numbers (`scaffoldProduct.ts:133-169`) |
| `extractCoverages` (SSE) | Sonnet-5 | 4 forced-tool sections; sanitizers drop uncited items; text uploads grep-verify form numbers — **but PDF uploads set `verifyText=null`** (form numbers unverifiable, `extract.ts:230-232`) |
| `chat` (SSE) | Sonnet-5 | **Prompt-only** — free prose, house-rule "cite every claim", **no server guard** (weakest) |
| `summarizeProduct` | Haiku | Prompt-only; grounded on client-supplied metadata, no verification |
| `identifyBaseForm` | Sonnet-5 | forced `identify_form` tool; prompt "never invent a number" |
| `describeForm` | Haiku | grounded on server-read form metadata; no citation |
| `refreshNews`/`nightlyNews` | Haiku | `web_search` server tool; **no URL-existence verification** (hallucinated URL can be stored) |

Client-side defence-in-depth mirrors the claims guard in `app/src/lib/claims/determination.ts`
(tested).

## 8. Cloud Functions (14 loaded)

| Function | Module | Type | Model | Auth/role |
|---|---|---|---|---|
| `hello` | health.ts | onCall | — | none (ping) |
| `chat` | ai.ts | onRequest/SSE | Sonnet-5 | any signed-in (read-only) |
| `draftRule` | rules.ts | onRequest/SSE | Sonnet-5 | EDITOR/ADMIN |
| `scaffoldProduct` | scaffoldProduct.ts | onRequest/SSE | Sonnet-5 | EDITOR/ADMIN |
| `extractCoverages` | extract.ts | onRequest/SSE | Sonnet-5 | EDITOR/ADMIN |
| `summarizeProduct` | summarize.ts | onCall | Haiku | any signed-in |
| `analyzeClaim` | claims.ts | onRequest/SSE | Sonnet-5 | any signed-in (read-only) |
| `identifyBaseForm` | claims.ts | onCall | Sonnet-5 | EDITOR/ADMIN |
| `setUserRole` | admin.ts | onCall | — | **ADMIN only** |
| `refreshNews` | news.ts | onCall | Haiku | any signed-in ⚠️ writes ADMIN-only `news` |
| `nightlyNews` | news.ts | onSchedule (0 6 * * *, ET) | Haiku | system |
| `describeForm` | describeForm.ts | onCall | Haiku | any signed-in ⚠️ writes `canEdit` `forms` |
| `createShare` | share.ts | onCall | — | EDITOR/ADMIN |
| `getShare` | share.ts | onRequest | — | **public** (Admin SDK; expiry-checked) |

Timeouts: chat 300 s (SDK 120 s/turn), analyzeClaim 300 s (SDK 45 s), extract 240 s (SDK 90 s),
summarize 60 s (SDK 45 s). **No per-request Anthropic timeout** on `refreshNews`/`nightlyNews`
(`news.ts:95`) or `describeForm` (`:56`). `nightlyNews` has an **empty catch** per instruction
(`news.ts:221-224`, silent). `setUserRole` create path is non-atomic across 3 awaits (no
rollback, `admin.ts:31-40`).

## 9. Security

**Firestore rules** (`firestore.rules`) — role from the verified JWT claim: `canEdit()=isEditor()||isAdmin()`
is the VIEWER read-only gate (`:14`). Read is `isAuthed()` for domain collections; writes are
`canEdit()` for `products`(+all subcollections), `forms`, `ldTables`, `rtTables`, `dictionary`,
`tasks`, `baseForms`, `searchIndex`, `comments`. `auditEvents`/`versions` are **append-only**
(create authed, no update/delete); `users`/`news`/`taskTemplates` are **ADMIN**-write;
`seedReports` Admin-SDK-only; catch-all `{document=**}` denies. **Narrow allowances:** feedback
**vote-only** update passes only if `affectedKeys().hasOnly(['votes'])` + exactly one added voter
== self + `count==old+1` (`:64-72`); `presence`/`newsPrefs` own-uid only; **`shares` read is
`if true`** (deliberate public share links, `:112`).

**Storage rules** (`storage.rules`): `uploads/{uid}/**` — any authed read, own-uid write;
`baseforms/{uid}/**` — any authed read (incl. VIEWER, for read-only claims analysis), write only
own-uid **and** EDITOR/ADMIN role claim; catch-all deny.

**Indexes** (`firestore.indexes.json`): 5 composite — tasks(column,order), feedback(status,
priorityScore↓), versions(entityPath,at↓), auditEvents(productId,at↓), searchIndex(type,title).

**Role enforcement cross-check (rules ↔ functions).** Domain-data surfaces are only ever written
via `adapter.db.mutate()` → governed by rules (VIEWER read-only verified by `tests/rules.test.ts`).
Server-side Admin-SDK writers: `setUserRole` (ADMIN ✅), `createShare` (EDITOR/ADMIN ✅), and two
**mismatches** where a Function is more permissive than the matching rule:
- **`describeForm`** authenticates on `req.auth` only (any role incl. VIEWER) then writes
  `forms/{key}.description` — but the `forms` rule is `canEdit()` (`describeForm.ts:20,71` vs
  rules `:50`). A VIEWER can trigger a persisted write to a `canEdit`-protected collection.
- **`refreshNews`** gates on `req.auth` only then writes `news/{urlHash}` — but the `news` rule
  is `isAdmin()` (`news.ts:192,178` vs rules `:84`).
Both are "derived/system" data (not user domain edits) and bypass `mutate()`, but the two-sided
role invariant is not upheld for them (§13 DRIFT).

**Secret handling — clean.** `ANTHROPIC_API_KEY = defineSecret(...)` read only inside
`anthropic()` (`runtime.ts:19,35`), bound per AI function, never logged/returned. Caveat:
`err.message` is echoed to clients in several catch blocks (never the key).

## 10. Tests & coverage

17 test files. `pnpm test` (vitest, node env) runs shared + app unit/engine tests;
`pnpm test:rules` boots the Firestore emulator for `tests/rules.test.ts`.

**Covered:** the two canaries (`evaluator.test.ts` $1,528 with full trace + floor + wind/hail
branches; `gl.evaluator.test.ts` $2,789 + alt cases); grid model (`rtGrid.test.ts`, incl. a
grid-managed table still computing $1,528); rules engine (`engine.test.ts`); ISO import
(`isoImport.test.ts`); LOB registry; inventory; term constraints (incl. no-false-positives on the
real seed + the mutate-seam assert); extraction/scaffold grounding sanitizers; dictionary usage;
TF-IDF ranker; the client claims-determination guard (`app/src/lib/claims/determination.test.ts`,
mirrors the server); markdown parser; home-priorities. `tests/rules.test.ts` = 10+ cases proving
VIEWER read-only (products/coverages/searchIndex/dictionary/tasks write denied), the vote-only
allowance, EDITOR/ADMIN writes, append-only auditEvents.

**Gaps:** the **`adapter.db.mutate()` transaction is untested at runtime** (rev/conflict, diff,
term guard) — only the rules side is proven; **all Cloud Functions are untested** (auth/role
guards, SSE, AI wiring); no React component/UI tests; **`@playwright/test` is installed but
unused** (no `.spec.ts`); `storage.rules` untested; `types.test.ts` is a stub; `kits.ts` has no
dedicated test.

## 11. Scripts & tooling

Root scripts: `dev` (Vite only), `emulators`, `dev:all`, **`dev:seed`** (emulators + wait-and-seed
+ app = full local stack), **`spinup`** (emulators + wait-and-seed, **no Vite**), `seed`
(`tsx scripts/seed.ts`), `test`, `test:rules`, `typecheck` (`pnpm -r`), `lint` (`pnpm -r`),
`build` (app only), `deploy` (do not run here). **Gate** (`/gate`):
`typecheck && lint && test && build`. Caveats: `pnpm lint` only truly lints `app` (oxlint) —
`shared`/`functions` lint are `echo` no-ops; `pnpm test` does **not** include `test:rules`;
`build` builds only the app (functions build via `firebase deploy` predeploy). Seed
(`scripts/seed.ts`): defaults to emulators (sets `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST`
pre-init), `--only <prefix>` filters bundles, wipes seeded collections + product subcollections,
writes both bundles through one identical loop, creates auth users + custom claims, verifies both
canaries (non-fatal CRITICAL warning on miss), writes `seedReports`. `wait-and-seed.mjs` TCP-polls
`:8080` (≤120 s) then `pnpm seed`.

## 12. Dependencies (notable)

- **app** — react 19.2, react-dom 19.2, react-router-dom 7.6, firebase 11.9, `@tailwindcss/vite`
  4.1 + tailwindcss 4.1, vite 8.1, `@vitejs/plugin-react` 6, oxlint 1.71, **typescript ~6.0.2**,
  `@dnd-kit/*`, fuse.js 7.1, exceljs 4.4, sonner 2, `@fontsource-variable/{inter,jetbrains-mono}`.
- **functions** — `@anthropic-ai/sdk ^0.54.0`, `firebase-admin ^13.4.0`, `firebase-functions ^6.6.0`,
  tsup; Node engine pinned 20 (emulator runs it on host Node 24 with a warning).
- **root (dev)** — `@playwright/test` 1.61, `@firebase/rules-unit-testing` 5, concurrently 9,
  firebase 11.10, firebase-admin 13.10, tsx 4.19, typescript 5.7, vitest 3.1.
- **TS version drift:** app pins TS ~6.0 while root/functions/shared pin ~5.7 (§15).

---

## 13. Guardrail conformance

| Guardrail | Verdict | Evidence |
|---|---|---|
| **Adapter seam** — all app IO through `adapter`, no direct `firebase/*` in components | **PASS** | Single entry `app/src/lib/backend/index.ts`; all screens use `adapter.db.*`/`fns.*`/`presence.*` (§6); no `firebase/*` import found in components |
| **`mutate()` atomic invariant** — entity + audit + version diff + searchIndex + rev, one atomic unit | **PASS** (impl) / **PARTIAL** (verify) | `firebase.adapter.ts:220-320` (runTransaction, rev re-check, diff, term guard). But the transaction has **no runtime test** (§10); guides call it a "batch" (§15). A few Functions write domain-ish docs outside it (`describeForm`, `refreshNews`, `createShare`) |
| **Roles in rules AND Functions** — VIEWER read-only both sides | **PARTIAL / DRIFT** | Rules: `canEdit()` everywhere + tested (`tests/rules.test.ts`). Functions: EDITOR/ADMIN inline checks on author endpoints. **DRIFT:** `describeForm` + `refreshNews` write role-protected collections while gating only on `req.auth` (§9); functions/CLAUDE.md's `canEdit()` helper doesn't exist server-side (inline checks) |
| **AI server-side** — browser never calls Anthropic | **PASS** | Every AI call is `adapter.fns.call/stream` → `functions/`; no Anthropic SDK / model id in `app/` |
| **AI grounded + cited** — cite sources, free invention is a bug | **PARTIAL** | Strong: `analyzeClaim` (rejects uncited), `draftRule`/`scaffoldProduct`/`extractCoverages` (drop uncited). Weak: `chat` (prompt-only, no guard), `summarizeProduct` (client-metadata trust), `refreshNews` (no URL verification), and **PDF extract can't verify form numbers** (`verifyText=null`) |
| **refId / form-number traceability** | **PASS** | refId scheme + parentId nesting preserved verbatim through seed + importer (`isoImport.ts`); form chips/`RefChip` load-bearing in Coverages/Forms/Rules/Pricing/palette; normalization ≥4 chars |
| **Model IDs** — `claude-sonnet-5` + `claude-haiku-4-5`, defined once, never `claude-fable-5` | **PASS** | Only `runtime.ts:29-30`; every call imports `MODEL`/`MODEL_FAST`; no hard-coded model string; no `claude-fable-5` |
| **Design tokens** — no hard-coded hex outside `index.css` | **PASS** (hex) / **PARTIAL** (color) | No `#RRGGBB` in the screens read; but several `rgba()` literals inline (AppShell banner, ProductWorkspace hero/tab, CommandPalette backdrop/shadow) — allowed per the "hex only" letter, flagged for token purity |
| **Secret hygiene** — `ANTHROPIC_API_KEY` never in browser/logs | **PASS** | `defineSecret` + `.value()` only in `anthropic()`; never logged/returned |

## 14. Annotated directory tree

```
Product Reinvention Hub/
├─ app/                              React SPA (workbench UI)
│  ├─ .env.development(.local)       VITE_USE_EMULATORS=false (prod by default)
│  ├─ vite.config.ts                Vite 8; build id → version.json
│  └─ src/
│     ├─ App.tsx                     router (all routes; §3.6)
│     ├─ index.css                   @theme design tokens (all color/shadow/radius)
│     ├─ context/                    UserContext, ProductContext (10 subs), FeedbackProvider
│     ├─ lib/backend/                THE ADAPTER SEAM (index, types, firebase.adapter,
│     │                              aws.adapter.placeholder, firebase.config)
│     ├─ lib/claims/determination.ts client-side citation guard (mirrors server)
│     ├─ lib/homePriorities.ts       Home task-rail ranking
│     ├─ components/                 ui/ (Button…, icons.tsx 24px SVG family),
│     │                              palette/CommandPalette, product/ProductSummaryDashboard,
│     │                              chat/Markdown, StateTileMap, VersionWatcher, ErrorBoundary
│     └─ routes/                     Landing, SignIn, MustChangePassword, Share, AppShell,
│        └─ product/                 Home, Products, Builder, Explorer, Tasks, News, Claims,
│                                    Dictionary, Admin, Feedback  +  product/{Workspace,
│                                    Overview, Coverages, Forms, Pricing, States, Rules}
├─ functions/                        Cloud Functions v2 (all AI + privileged writes)
│  ├─ .env.local                     ANTHROPIC_API_KEY (emulator)
│  └─ src/                           index, runtime, tools, ai, rules, scaffoldProduct, extract,
│                                    summarize, claims, admin, news, describeForm, share, health
├─ shared/  (@pf/shared)             pure TS
│  └─ src/                           types.ts, index.ts (barrel),
│     ├─ rating/                     evaluator(+test), gl.evaluator.test, rtGrid(+test), kits
│     ├─ rules/                      engine(+test)
│     ├─ insurance/                  lobRegistry, inventory, isoImport, extraction, scaffold,
│     │                              terms, termConstraints (+ tests)
│     ├─ dictionary/usage.ts         live "used in" backref computation
│     ├─ search/rank.ts              TF-IDF ranker
│     └─ seed/                       ho3.ts (+ users, worked example, tasks, feedback), gl.ts
├─ scripts/                          seed.ts, wait-and-seed.mjs
├─ tests/rules.test.ts               Firestore-rules tests (@firebase/rules-unit-testing)
├─ docs/                             DOMAIN_GL.md, ELEVATION_SCOREBOARD.md, adr/000{1,2}, review/
├─ firestore.rules · storage.rules · firestore.indexes.json · firebase.json
└─ package.json (root) · pnpm-workspace.yaml · vitest.config.ts · vitest.rules.config.ts
```

---

## 15. Doc-vs-code divergences (code wins)

1. **Most reference docs are gone from the tree** (commit `61bddd1`): `CURRENT_CODEBASE.md`,
   `DATA_MODEL.md`, `DOMAIN_HO.md`, `AWS_SWAP.md`, ADRs 0003-0006. Only `docs/DOMAIN_GL.md`,
   `docs/ELEVATION_SCOREBOARD.md`, and `docs/adr/000{1,2}` remain. Intent reconstructed from code.
2. **`spinup` does not start Vite** (only emulators + seed); the brief and some habits assume it
   does. `dev:seed` is the full stack. (Verified in `package.json`.)
3. **`mutate()` is a `runTransaction`, not a `writeBatch`** — guides say "batch". Code is stronger.
4. **Demo-admin login drift (two layers).** (a) `signInAsAdmin` targets `admin@admin.com`/`admin123`,
   but the seed creates only `sal@productreinvention.app` (`scrudato`) and `rebecca@…` (`freeman`),
   both ADMIN, `mustChangePassword:false` (`firebase.adapter.ts:91-92` vs `ho3.ts:803-814`). (b) The
   SignIn file header still documents a "Continue as admin" button, but that button has been
   **removed from the JSX** — sign-in is username/password only. So the current login path is
   `sal`/`scrudato` (or `rebecca`/`freeman`) via the form.
5. **`canEdit()` server helper doesn't exist.** functions/CLAUDE.md references a `canEdit()` helper
   in `runtime.ts`; role checks are actually inline `role!=='EDITOR' && role!=='ADMIN'` literals.
6. **`StubRoute` is dead code** — no route imports it; every route resolves to a real component
   (Builder is a full Builder/Drafts workbench, Claims a real surface). Confirmed in `App.tsx`.
11. **`canEdit` role source is inconsistent across screens** — derived from `user.role` in Products
    and Builder, but from `profile.role` in Tasks/Claims/Dictionary/Feedback. If the two diverge
    during load or after a role change, edit affordances could flicker inconsistently.
12. **Admin gate flashes** — `Admin.tsx` guards on `profile && profile.role!=='ADMIN'`, so a
    non-admin briefly sees the console shell + subscribed data while `profile` is loading.
7. **Two-sided role invariant not upheld for `describeForm` / `refreshNews`** (§9) — Functions more
   permissive than the matching Firestore rule.
8. **HO uses `HO.LD.*`/`HO.RT.*` table refs; GL uses un-prefixed `LDTable.*`/`RTTable.*`** — a real
   inconsistency in the refId scheme across lines (both keyed identically in Firestore).
9. **TS version drift:** `app` on typescript ~6.0.2 while root/functions/shared pin ~5.7.
10. **Storage is never emulated** — even in emulator mode uploads/reads hit live Firebase Storage.
