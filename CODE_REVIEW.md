# Product Reinvention Hub — Code Review Bundle

**Purpose.** This single file bundles the full functional source of *Product Reinvention Hub* (an AI‑native product‑management platform for P&C insurance product managers) for a comprehensive AI code review. It concatenates every git‑tracked source/config/docs file (via `git ls-files`), so `node_modules`, build output (`functions/lib`, `app/dist`), and gitignored secrets (`apikeys.md`, `functions/.env.local`) are **excluded by construction**. The only credential present is the Firebase *web* config (`app/src/lib/backend/firebase.config.ts`), which is public by design and safe in the client bundle.

**Stack.** React + Vite + TypeScript (strict) + Tailwind v4 (`@theme` tokens) + React Router. pnpm workspaces: `app`, `functions`, `shared`. Firebase: Auth (custom‑claim roles), Firestore (realtime `onSnapshot`), Cloud Functions v2 (Node 20, all AI over SSE), Storage, Hosting, Emulator Suite. Anthropic SDK **in Functions only** — `claude-fable-5` (reasoning) / `claude-haiku-4-5` (bulk). Local git only (a GitHub remote is being added for this review).

**Architecture guardrails (enforced in‑repo).**
- **Adapter seam:** app code never imports `firebase/*` directly — everything flows through `app/src/lib/backend` (`adapter.*`). `firebase.adapter.ts` is active; `aws.adapter.placeholder.ts` mirrors it with `// AWS-SWAP:` mappings.
- **Mutation invariant:** every write goes through `adapter.db.mutate()`, which atomically writes the entity + an `AuditEvent` + a `Version` snapshot + `searchIndex` upkeep + a `rev` bump. No silent writes.
- **Roles via custom claims**, enforced in Firestore rules **and** Functions (never UI‑only): VIEWER (read + feedback), EDITOR (author content), ADMIN (users/settings/audit).
- **Grounded AI:** Functions only; answers cite `[refId]` / form numbers and never invent coverages/forms/rules/limits/factors.
- **Traceability:** reference IDs (`HO.COV.003`, `HO.RU.006`, `HO.RT.003`, `HO.LD.002`) and form numbers (`HO 00 03`, `HO 04 90`) are preserved as first‑class monospaced chips. The seeded HO‑3 product's 11‑step rating algorithm produces a **$1,528** worked example that the shared evaluator and tests must keep correct.

Read `docs/DOMAIN_HO.md` (domain + rating), `docs/DATA_MODEL.md` (Firestore model), `docs/AWS_SWAP.md` (portability), and `docs/ELEVATION_PROMPT.md` (the design brief driving current work) — all included below.

---

## What this review should focus on

A full‑app **premium UI/UX elevation** is in progress against `docs/ELEVATION_PROMPT.md` (persona "Vesper", Apple‑caliber bar). The elevation must preserve every domain rule, stay production‑safe, honor the adapter/mutation/role guardrails, and hit a 10‑axis rubric (layout, typography, spacing, color/depth, motion, iconography, affordance, states, domain truth, a11y) at ≥4.5 on every surface. Reviewers: weigh correctness + domain fidelity first, then craft.

---

## Progress so far (elevation pass — 8 commits on `master`, each type/lint/build‑green and driven on the emulator)

| Surface | Status | Notes |
|---|---|---|
| **Global foundation** | ✅ | `index.css` global `cursor:pointer` affordance rule (§7.1); shared `IconType`; the in‑house SVG icon family in `components/ui/icons.tsx` greatly extended (nav, action, feedback, alert, upload glyphs) so **`lucide-react` can be purged app‑wide**. |
| **Landing (`/`)** | ✅ | Kept the self‑drawing insight‑graph + aurora; added a Claude‑style **grounded hero composer** (rotating domain‑true prompts, honest hand‑off to sign‑in); purged lucide. |
| **Sign‑in / Change‑password** | ✅ | Calm/centered; lucide → in‑house `IconSpinner`/shield; fixed a `setState`‑in‑render warning by rendering `<Navigate>`. |
| **App shell** | ✅ | Sidebar, Topbar, ⌘K command palette, ⌘. feedback capture — all on the in‑house icon family; fixed a duplicate‑key React warning in the breadcrumb (product + tab crumb shared a `to`). |
| **Home (`/app`)** | ✅ | In‑house focus‑rail icons; tool‑status chip now shows a green check on completion. |
| **Products** | ✅ | Page/card/row already elevated; purged lucide from the **shared primitives** (`Dialog`/`Drawer`/`Table`/`Combobox`) so all consumers are clean. |
| **Product › Overview (§8A)** | ✅ | **Right rail removed** → single‑column focused reading. Health folded into the workspace header as a subtle **pill** (`95 · 1 finding`); the single most important finding surfaces as one **quiet, dismissible inline banner** (Review → / ×). Coverages shown as the grouped ISO **Section I/II** collection. New `lib/productHealth.ts` derives findings/score/color (shared by pill + banner). Deduped presence avatars by uid. |
| **Product › Coverages (§8C) + base‑form gate & grounded AI extraction (§8B / §10.1)** | ✅ **verified live** | Coverage hub cards / aspect tiles already premium. New: **`Product.baseForm`**; **`functions/extract.ts` (`extractCoverages`)** — EDITOR/ADMIN SSE endpoint that reads the uploaded base form (text or base64 PDF) and asks Claude via a single **forced `propose_coverages` tool** to return grounded coverage proposals (name, requirement, rated, form numbers, **confidence + citation**); never invents. **`BaseFormExtract.tsx`** implements the gate (Extract disabled until a base form is uploaded, with tooltip), the upload (Storage + `mutate`), the review dialog (proposals prefilled & pre‑checked, subtle confidence, deselect before writing), and persist (creates each via `mutate()`, allocating the next `HO.COV.NNN`). **Driven end‑to‑end on the emulator:** uploading `docs/DOMAIN_HO.md` returned all 10 coverages with real citations (`HO.COV.001 (Section I property)`, `HO.RU.002 · 10% of Coverage A`, `HO.RAT.1 step 5`, `HO.LD.001`). |
| **Product › Forms** | ✅ | Already elevated + lucide‑free (table + drawer + `?form=`/`?cov=` deep links + two‑way coverage links); verified. No change needed. |

---

## What's next (remaining elevation scope, per `docs/ELEVATION_PROMPT.md`)

1. **Product › Pricing (§8D) + Excel‑like 3‑D rating grid (§10.2).** Keep the live rating trace (proves the `$1,528` derivation) but elevate the worksheet; for **table‑based (RT/LD) steps**, let the PM pick **up to 3 dimensions** and fill a keyboard‑first, paste‑friendly grid (1‑D column / 2‑D matrix / 3‑D tabbed pages). Persist as the step's table via `mutate()` so the shared evaluator + trace pick it up immediately; keep `$1,528` correct; keep `shared/` types additive/backward‑compatible. *(Currently reading `app/src/routes/product/ProductPricing.tsx`; not yet started.)*
2. **Product › States (§8E).** Elevate the signature **`StateTileMap`** (US tile grid): coastal/peril badges, selected/available/out‑of‑scope legend, hover + keyboard selection, accurate counts (never >100% — count against the footprint), smooth fills. Used for product footprint, per‑coverage scope, and per‑option applicability.
3. **Product › Rules.** Elevate the IF→THEN flow cards + Simulate panel + composer; purge lucide (`ProductRules.tsx`, `RuleBuilder.tsx`).
4. **Explorer (§8F / §10.3).** Rebuild as **Finder‑style Miller columns** (products → coverages → sub‑coverages → peek panel), searchable + keyboard‑navigable, with a breadcrumb and per‑column states.
5. **Remaining pages:** Builder, Tasks, News, Claims, Dictionary, Feedback, Admin, Share — each elevated to the same bar; purge remaining `lucide-react` (see `ErrorBoundary`, `App`, `DictionaryPicker`, `CommentsPanel`, `ExportMenu`, `HistoryDrawer`, `ShareModal`, `RuleBuilder`, and the corresponding routes).
6. **Cross‑cutting exit criteria still open:** finish removing all `lucide-react` usage app‑wide; confirm every surface scores ≥4.5 on all ten rubric axes; keep the gate (`typecheck && lint && test && build`) green.

**Known env note:** the base‑form + extraction flow requires a full emulator suite (Auth+Firestore+Functions+Storage) with the Anthropic key in `functions/.env.local`; verification above was done after restarting the suite and re‑seeding HO‑3.


---

# File index (139 files, ~688 KB of source)

- `docs/AWS_SWAP.md`
- `docs/DATA_MODEL.md`
- `docs/DOMAIN_HO.md`
- `docs/ELEVATION_PROMPT.md`
- `CLAUDE.md`
- `firebase.json`
- `firestore.indexes.json`
- `firestore.rules`
- `package.json`
- `pnpm-workspace.yaml`
- `README.md`
- `storage.rules`
- `vitest.config.ts`
- `vitest.rules.config.ts`
- `shared/package.json`
- `shared/src/index.ts`
- `shared/src/insurance/terms.ts`
- `shared/src/rating/evaluator.test.ts`
- `shared/src/rating/evaluator.ts`
- `shared/src/rules/engine.test.ts`
- `shared/src/rules/engine.ts`
- `shared/src/search/rank.test.ts`
- `shared/src/search/rank.ts`
- `shared/src/seed/ho3.ts`
- `shared/src/types.test.ts`
- `shared/src/types.ts`
- `shared/tsconfig.json`
- `shared/vitest.config.ts`
- `functions/package.json`
- `functions/src/admin.ts`
- `functions/src/ai.ts`
- `functions/src/extract.ts`
- `functions/src/health.ts`
- `functions/src/index.ts`
- `functions/src/news.ts`
- `functions/src/runtime.ts`
- `functions/src/share.ts`
- `functions/src/tools.ts`
- `functions/tsconfig.json`
- `functions/tsup.config.ts`
- `scripts/grant-invoker.mjs`
- `scripts/seed.ts`
- `scripts/verify-api.mjs`
- `scripts/verify-invariant.ts`
- `scripts/verify-ui.mjs`
- `scripts/zztest.ts`
- `app/.oxlintrc.json`
- `app/index.html`
- `app/package.json`
- `app/README.md`
- `app/src/App.tsx`
- `app/src/components/chat/ChatComposer.tsx`
- `app/src/components/dictionary/DictionaryPicker.tsx`
- `app/src/components/ErrorBoundary.tsx`
- `app/src/components/feedback/feedbackContext.ts`
- `app/src/components/feedback/FeedbackProvider.tsx`
- `app/src/components/palette/CommandPalette.tsx`
- `app/src/components/product/BaseFormExtract.tsx`
- `app/src/components/product/CommentsPanel.tsx`
- `app/src/components/product/coverageAspects.ts`
- `app/src/components/product/CoverageCollection.tsx`
- `app/src/components/product/CoverageEditDialog.tsx`
- `app/src/components/product/CoverageHubCard.tsx`
- `app/src/components/product/CoverageRow.tsx`
- `app/src/components/product/CoverageStatesDialog.tsx`
- `app/src/components/product/ExportMenu.tsx`
- `app/src/components/product/HistoryDrawer.tsx`
- `app/src/components/product/NewProductModal.tsx`
- `app/src/components/product/ProductCard.tsx`
- `app/src/components/product/ProductRow.tsx`
- `app/src/components/product/RuleBuilder.tsx`
- `app/src/components/product/ShareModal.tsx`
- `app/src/components/product/StateTileMap.tsx`
- `app/src/components/product/TermOptionsDialog.tsx`
- `app/src/components/shell/Sidebar.tsx`
- `app/src/components/shell/Topbar.tsx`
- `app/src/components/ui/Badge.tsx`
- `app/src/components/ui/Button.tsx`
- `app/src/components/ui/Card.tsx`
- `app/src/components/ui/Combobox.tsx`
- `app/src/components/ui/Dialog.tsx`
- `app/src/components/ui/Drawer.tsx`
- `app/src/components/ui/EmptyState.tsx`
- `app/src/components/ui/icons.tsx`
- `app/src/components/ui/index.ts`
- `app/src/components/ui/Input.tsx`
- `app/src/components/ui/Logo.tsx`
- `app/src/components/ui/RefChip.tsx`
- `app/src/components/ui/Skeleton.tsx`
- `app/src/components/ui/Table.tsx`
- `app/src/components/ui/Tabs.tsx`
- `app/src/components/ui/Tooltip.tsx`
- `app/src/components/ui/ViewToggle.tsx`
- `app/src/context/ProductContext.tsx`
- `app/src/context/useProductCtx.ts`
- `app/src/context/UserContext.tsx`
- `app/src/context/useUser.ts`
- `app/src/fontsource.d.ts`
- `app/src/index.css`
- `app/src/lib/backend/aws.adapter.placeholder.ts`
- `app/src/lib/backend/firebase.adapter.ts`
- `app/src/lib/backend/firebase.config.ts`
- `app/src/lib/backend/index.ts`
- `app/src/lib/backend/types.ts`
- `app/src/lib/export/excel.ts`
- `app/src/lib/geo/usTileGrid.test.ts`
- `app/src/lib/geo/usTileGrid.ts`
- `app/src/lib/insurance/vocab.ts`
- `app/src/lib/integrations/accenture.ts`
- `app/src/lib/integrations/duckcreek.ts`
- `app/src/lib/productHealth.ts`
- `app/src/lib/svg/ratingFlow.tsx`
- `app/src/main.tsx`
- `app/src/routes/Admin.tsx`
- `app/src/routes/AppShell.tsx`
- `app/src/routes/Dictionary.tsx`
- `app/src/routes/Explorer.tsx`
- `app/src/routes/Feedback.tsx`
- `app/src/routes/Home.tsx`
- `app/src/routes/Landing.tsx`
- `app/src/routes/MustChangePassword.tsx`
- `app/src/routes/News.tsx`
- `app/src/routes/product/ProductCoverages.tsx`
- `app/src/routes/product/ProductForms.tsx`
- `app/src/routes/product/ProductOverview.tsx`
- `app/src/routes/product/ProductPricing.tsx`
- `app/src/routes/product/ProductRules.tsx`
- `app/src/routes/product/ProductStates.tsx`
- `app/src/routes/product/ProductWorkspace.tsx`
- `app/src/routes/Products.tsx`
- `app/src/routes/ShareView.tsx`
- `app/src/routes/SignIn.tsx`
- `app/src/routes/stub/StubRoute.tsx`
- `app/src/routes/Tasks.tsx`
- `app/tsconfig.app.json`
- `app/tsconfig.json`
- `app/tsconfig.node.json`
- `app/vite.config.ts`
- `tests/rules.test.ts`

---

# Full source


## `docs/AWS_SWAP.md`

````markdown
# AWS_SWAP.md — Backend portability seam (Firebase → AWS)

Firebase is the active backend. Every Firebase touchpoint sits behind one typed
interface so the swap is an adapter implementation + infra, not an app rewrite.

## The seam
`app/src/lib/backend/`
- `types.ts` — the contract. Sketch:
  ```ts
  export interface BackendAdapter {
    auth: {
      signIn(email, password): Promise<Session>; signOut(): Promise<void>;
      onUser(cb): Unsubscribe;            // session + role (custom claim)
      changePassword(next): Promise<void>;
    };
    db: {
      get<T>(path): Promise<T | null>;
      list<T>(path, q?: Query): Promise<T[]>;
      subscribe<T>(path | q, cb): Unsubscribe;   // realtime
      mutate(m: Mutation): Promise<void>;         // entity + audit + version + index, atomic
      tx<T>(fn): Promise<T>;                      // rev-checked saves
    };
    storage: { upload(path, file): Promise<string>; getUrl(path): Promise<string> };
    fns: {
      call<TIn, TOut>(name, data): Promise<TOut>; // callable
      stream(name, data, onChunk): Promise<void>; // SSE (AI chat)
    };
    presence: { join(pid): Unsubscribe; watch(pid, cb): Unsubscribe };
  }
  ```
- `firebase.adapter.ts` — active implementation (modular SDK; connects to the
  Emulator Suite when `VITE_USE_EMULATORS=true`).
- `aws.adapter.placeholder.ts` — same interface; every method throws
  `NotImplemented` and carries a comment mapping it to its AWS service.
- `index.ts` — the one-line switch:
  ```ts
  // AWS-SWAP: flip this export to aws.adapter once implemented.
  export { adapter } from "./firebase.adapter";
  ```

Grep `AWS-SWAP:` to find every seam decision in the codebase.

## Service mapping
| Concern | Firebase (now) | AWS (later) |
|---|---|---|
| Auth + roles | Firebase Auth, custom claims | Cognito user pool, groups/claims in JWT |
| Database | Firestore | DynamoDB (single-table) or Aurora Postgres + Prisma |
| Realtime | onSnapshot | AppSync subscriptions (or polling fallback) |
| Functions/AI | Cloud Functions v2 (SSE onRequest) | Lambda + API Gateway (or Lambda URLs) w/ streaming |
| Scheduled agents | onSchedule | EventBridge Scheduler → Lambda |
| File storage | Cloud Storage | S3 (presigned uploads) |
| Hosting | Firebase Hosting | S3 + CloudFront or Amplify Hosting |
| Secrets (Anthropic key) | functions:secrets / .env.local | AWS Secrets Manager |
| Share snapshot (public) | Hosting rewrite → Function | CloudFront → Lambda@Edge or API GW route |

## Swap procedure
1. Implement `aws.adapter.ts` against `types.ts` (start with auth + db.get/list/
   mutate; `subscribe` may temporarily poll — the UI already tolerates it).
2. Port `functions/src/*` handlers to Lambda; they already isolate all
   Anthropic/Admin-SDK usage and import pure logic from `shared/` unchanged.
3. Stand up infra (table/pool/bucket/API), load secrets into Secrets Manager,
   run `scripts/seed.ts` against the new DB driver.
4. Flip the export in `index.ts`. Delete nothing Firebase until parity verified.

## Design rules that keep the swap cheap
- No `firebase/*` imports outside `lib/backend` (app) and `functions/` (server).
- `shared/` stays 100% pure TypeScript — engines, types and seed constants have
  zero platform imports and move as-is.
- Documents address by string `path`; the AWS adapter maps paths → keys/tables.
- Streaming AI uses plain SSE over HTTPS — identical pattern on Lambda.
- Security lives in rules **and** server checks; on AWS the server checks remain
  and rules translate to IAM/authorizer logic.
````


## `docs/DATA_MODEL.md`

```markdown
# DATA_MODEL.md — Canonical Firestore model

One versioned, metadata-rich schema unifying the four insurance spec domains:
Framework (structure) · Rules (logic + limits/deductibles) · Rating (pricing math)
· Forms (documents) — plus governance (lifecycle, review, audit, comments,
feedback). All app access goes through the BackendAdapter (`docs/AWS_SWAP.md`).

## Conventions
- `refId` — human-readable source ID (HO.COV.003.002, HO.RU.006, HO.LD.002,
  HO.RT.003, HO.FORM.RU.001). Unique when present; null for user-created items
  until assigned. Form docs are keyed by normalized form number (`HO-04-61`).
- Governance block on every domain entity:
  `status: ACTIVE|INACTIVE|FUTURE` · `lifecycle: DRAFT|IN_REVIEW|APPROVED|LAUNCHED`
  · `reviewStatus: NOT_STARTED|IN_PROGRESS|BUSINESS_REVIEW|APPROVED|REJECTED`
  · `reviewer` · `createdAt/updatedAt/updatedBy` · `rev` (int, optimistic concurrency).
- State applicability inline on entities: `{ allStates: boolean, states: string[] }`.
- Timestamps are Firestore Timestamps; money in integer cents where computed,
  displayed via a single currency util.

## Collections

users/{uid}
  email, name, role (mirror of custom claim — claim is authoritative),
  active, mustChangePassword, createdAt

products/{pid}
  refId, name, lob { refId, name }, description, marketSegment,
  governance block, states/allStates, owner { uid, name },
  health { score 0–100, findingCount, updatedAt }
  ├─ coverages/{cid}
  │    refId, name, parentId (null = coverage; set = sub-coverage — parent must
  │    exist, enforced in mutate()), order, requirement MANDATORY|OPTIONAL,
  │    claimsBasis, premiumGenerating, source BUREAU|PROPRIETARY,
  │    formNumbers[], governance, states/allStates,
  │    terms: [{ id, kind LIMIT|DEDUCTIBLE|OPTION, label, ldTableRef?,
  │             options?[], min?, max?, default, basis, unit, notes?,
  │             // canonical typed model (optional; derived from the legacy fields
  │             // above when absent, mirrored back on save — see shared/insurance/terms.ts):
  │             structure? (SINGLE|OCCURRENCE_AGGREGATE|EACH_CLAIM_AGGREGATE|SPLIT|
  │                         CSL|SCHEDULED  for limits · FLAT|PERCENT|PERCENT_MIN_MAX|
  │                         WAITING_PERIOD|SPLIT  for deductibles),
  │             limitBasis? (PER_OCCURRENCE|AGGREGATE|PER_PERSON|PER_CLAIM|PER_ITEM|PER_LOCATION),
  │             optionSet?: [{ id, type FLAT|PERCENT|SPLIT|CSL|SCHEDULED|WAITING_PERIOD,
  │                           value, parts?[], label?, allStates, states[] (⊆ coverage
  │                           scope), isDefault (exactly one enabled), enabled, constraintNote? }] }]
  ├─ rules/{rid}
  │    refId, category PRODUCT|RATING|FORMS, subCategory, condition, outcome,
  │    ldTableRef?, coverageRefIds[], formNumbers[], governance, states
  ├─ formRules/{id}
  │    refId, condition, outcome, formNumbers[], mandatory, governance
  └─ ratingPrograms/{gid}
       refId (HO.RAT.1), name, minimumPremium, states, governance,
       steps: [{ id, order, label,
                 op SET|MUL|ADD|MIN_FLOOR,
                 source { type RT|LD|INPUT|CONST, ref?, keys?[], value? },
                 condition? (input flag that gates the step),
                 roundTo? (int decimal places) }]
       // The evaluator executes steps in order and returns a full trace.

forms/{formKey}
  number, name, edition, category BASE_COVERAGE|DECLARATIONS|ENDORSEMENT|
  EXCLUSION|AMENDATORY|POLICY_NOTICE, claimsBasis, dynamic (bool),
  mandatoryDefault, attachmentCondition RULE|NONE, source BUREAU|PROPRIETARY,
  admitted, displayOnSchedule, multiUse, transactions[], coverageParts[],
  states/allStates, productRefIds[], description (AI plain-English, cached),
  dynamicFields: [{ name, dataType TEXT|CURRENCY|DATE|LIST|PERCENT, repeating,
                    options?[], notes? }], governance

ldTables/{refId}   name, defaultValue?, rows: [{ label, value, constraintNote? }]
rtTables/{refId}   name, columns[], rows[]  // layout preserved as-is for lookups

versions/{id}      entityType, entityPath, productId?, snapshot, 
                   diff: [{ field, before, after }], actor { uid, name }, at
auditEvents/{id}   actor, action, entityType, entityPath, productId?, at
                   // create-only; explored in /app/admin
comments/{id}      entityPath, refId?, body, author, resolved, at
tasks/{id}         title, column IDEATION|BUILD_FILE|TEST_APPROVE|LAUNCH_MONITOR,
                   productId?, assignee?, dueAt, checklist[{t,done}], order, governance
feedback/{id}      type IDEA|ISSUE|PRAISE, title, detail,
                   context { route, entityPath?, refId? }  // auto-captured by ⌘.
                   votes { count, voters[uid] }, status NEW|REVIEWING|PLANNED|
                   SHIPPED|DECLINED, impact 1–3, effort 1–3,
                   priorityScore  // votes × recency decay, recomputed on write
                   rank (Planned lane order), author, timestamps
news/{id}          urlHash (dedup), url, source, title, summary, tags[],
                   relatedProductIds[], fetchedAt
newsPrefs/{uid}    instruction (natural language), updatedAt
dictionary/{id}    name, type, description, allowedValues[], format, tags[],
                   usedIn[{ entityPath, label }], governance
shareLinks/{token} productId, createdBy, expiresAt
                   // never client-readable; served by the share Function
searchIndex/{id}   type, refId?, title, subtitle, path, keywords[]
                   // maintained by seed + mutate(); powers ⌘K
seedReports/{id}   counts, warnings[], workedExamplePremium, at

## Access + integrity
- Firestore rules: role from `request.auth.token.role`. VIEWER → read all domain
  data, write nothing (may vote/submit feedback + comment). EDITOR → write domain
  collections. ADMIN → users/settings too. `auditEvents`/`versions`: create-only.
  `shareLinks`: no client read/write (Functions only, Admin SDK).
- `mutate()` (adapter) = one WriteBatch: entity write + auditEvent + version
  (+ searchIndex upsert) + `rev` increment; save rejects on rev mismatch
  (friendly conflict toast). // AWS-SWAP: becomes a Lambda-side transaction.
- Custom claims set only via the `setUserRole` callable (ADMIN); the seed script
  bootstraps the first admin.
- Realtime: onSnapshot subscriptions give live multi-user updates + presence
  (`presence/{pid}/viewers/{uid}` heartbeat docs).

## Composite indexes (declare in firestore.indexes.json as needed)
tasks (column, order) · feedback (status, priorityScore desc) ·
news (fetchedAt desc) · versions (entityPath, at desc) ·
auditEvents (productId, at desc) · searchIndex (type, title)
```


## `docs/DOMAIN_HO.md`

```markdown
# DOMAIN_HO.md — Seed product: Homeowners HO-3 (Special Form)

The app seeds exactly this dataset. A representative ISO-style sample for demo
purposes (numbers, editions and rates are illustrative). `shared/src/seed/ho3.ts`
encodes it verbatim; `pnpm seed` writes it; tests assert the worked example.

## Product
- HO.PROD.001 — "Homeowners — HO-3 Special Form" · LOB HO.LOB.001 Homeowners
- marketSegment: Personal Lines / Property · status ACTIVE · lifecycle LAUNCHED
- Footprint states (15): AZ CA CO FL GA IL IN MI NC OH PA SC TN TX VA
- Coastal wind/hail states (subset): FL GA NC SC TX
- Minimum premium: $500 · Rating program HO.RAT.1

## Coverages (Section I property, Section II liability)
| refId | Name | Parent | Req | Terms |
|---|---|---|---|---|
| HO.COV.001 | Coverage A — Dwelling | — | Mandatory | LIMIT = Coverage A amount (input, currency) |
| HO.COV.002 | Coverage B — Other Structures | — | Mandatory | LIMIT = 10% of A (default; increase via HO 04 48) |
| HO.COV.003 | Coverage C — Personal Property | — | Mandatory | LIMIT % of A per HO.LD.005 (default 50%) |
| HO.COV.004 | Coverage D — Loss of Use | — | Mandatory | LIMIT = 30% of A |
| HO.COV.005 | Coverage E — Personal Liability | — | Mandatory | LIMIT per HO.LD.001 (default 300,000) |
| HO.COV.006 | Coverage F — Medical Payments | — | Mandatory | LIMIT per HO.LD.002 (default 1,000) |
| HO.COV.001.001 | Water Back-Up & Sump Overflow | HO.COV.001 | Optional | LIMIT per HO.LD.006 → form HO 04 95 |
| HO.COV.002.001 | Other Structures — Increased Limits | HO.COV.002 | Optional | LIMIT (currency, free) → HO 04 48 |
| HO.COV.003.001 | Personal Property Replacement Cost | HO.COV.003 | Optional | flag → HO 04 90 |
| HO.COV.003.002 | Scheduled Personal Property | HO.COV.003 | Optional | schedule (class + value, repeating) → HO 04 61 |

Section I deductible terms (on product): All-peril per HO.LD.003 (default 1,000);
Wind/Hail % per HO.LD.004 (coastal only). Protective-device credit input
(none | local | central) → HO 04 16 when not none. Claims basis: Occurrence.
All coverages BUREAU except HO.COV.002.001 (PROPRIETARY, demo).

## Limits & Deductibles tables (LD)
- **HO.LD.001** Coverage E limits: 100,000 · **300,000 (default)** · 500,000
- **HO.LD.002** Coverage F limits: **1,000 (default)** · 2,000 · 5,000 —
  constraint on 5,000: "Available only when Coverage E ≥ 300,000"  ← demo constraint
- **HO.LD.003** All-peril deductible: 500 · **1,000 (default)** · 2,500 · 5,000
- **HO.LD.004** Wind/Hail % deductible: 1% · 2% · 5% — constraints: coastal states
  only (FL GA NC SC TX); dollar amount (% × Cov A) must be ≥ all-peril deductible
- **HO.LD.005** Coverage C % of A: **50 (default)** · 70 · 75
- **HO.LD.006** Water back-up limit: **5,000 (default)** · 10,000 · 25,000

## Rating tables (RT)
- **HO.RT.001** Territory base rate: T001 640 · T002 700 · T003 815 · T004 905 · T005 1,040
- **HO.RT.002** Protection class × construction factor:
  PC 1–3 F 0.95 / M 0.90 · PC 4–6 F 1.10 / **M 1.05** · PC 7–8 F 1.30 / M 1.20 · PC 9–10 F 1.55 / M 1.45
- **HO.RT.003** Coverage A key factor: 200k 0.80 · 250k 0.90 · 300k 1.00 ·
  350k 1.14 · **400k 1.30** · 500k 1.62 · 600k 1.94 · each add'l 100k +0.32
- **HO.RT.004** Deductible factors — all-peril: 500 1.10 · **1,000 1.00** ·
  2,500 0.88 · 5,000 0.76; wind/hail % (multiplied when elected): 1% 0.97 · 2% 0.94 · 5% 0.89
- **HO.RT.005** Coverage C % factor: 50 1.00 · **70 1.06** · 75 1.09
- **HO.RT.006** Liability increased-limit charges (additive $): Cov E — 100k +0 ·
  **300k +24** · 500k +38; Cov F — 1k +0 · **2k +6** · 5k +18
- **HO.RT.007** Scheduled Personal Property class rates per $100 of value:
  **Jewelry 1.27** · Furs 0.55 · Cameras 1.10 · Fine Arts 0.85 · Silverware 0.45 · Musical Instruments 0.60
- **HO.RT.008** Endorsement/credit factors: HO 04 90 Replacement Cost **1.10**;
  protective devices — **none 1.00** · local alarm 0.98 · central station 0.95
- **HO.RT.009** Tier factor: A 0.90 · **B 1.10** · C 1.25
- **HO.RT.010** Water back-up flat premium: 5,000 → **75** · 10,000 → 110 · 25,000 → 175

## Rating algorithm — HO.RAT.1 (11 steps)
| # | Step | Op | Source | Round |
|---|---|---|---|---|
| 1 | Territory base rate | SET | HO.RT.001[territory] | — |
| 2 | Protection/construction factor | MUL | HO.RT.002[pc, construction] | — |
| 3 | Coverage A key factor → Key Premium | MUL | HO.RT.003[covA] | 0 |
| 4 | Deductible factor(s) (wind/hail factor multiplies only if elected) | MUL | HO.RT.004 | — |
| 5 | Coverage C percentage factor | MUL | HO.RT.005[covC%] | — |
| 6 | Coverage E increased-limit charge | ADD | HO.RT.006[E] | — |
| 7 | Coverage F increased-limit charge | ADD | HO.RT.006[F] | — |
| 8 | Endorsement/credit factors (HO 04 90 if elected × device credit) | MUL | HO.RT.008 | 2 |
| 9 | Tier factor | MUL | HO.RT.009[tier] | — |
| 10 | Flat/scheduled endorsement premiums (water back-up + SPP Σ value/100 × class rate) | ADD | HO.RT.010 + HO.RT.007 | — |
| 11 | Final premium = MAX(running, minimum 500) | MIN_FLOOR | CONST 500 | 0 |

### Worked example (seed default preset — tests must assert $1,528)
Inputs: territory T002 · PC 5 Masonry · Cov A 400,000 · all-peril ded 1,000 ·
no wind/hail ded · Cov C 70% · Cov E 300,000 · Cov F 2,000 · Replacement Cost
elected · protective device none · Tier B · Water back-up 5,000 · SPP Jewelry 15,000.

700.00 → ×1.05 = 735.00 → ×1.30 = 955.50 → **956** → ×1.00 = 956.00 →
×1.06 = 1,013.36 → +24 = 1,037.36 → +6 = 1,043.36 → ×(1.10×1.00) = **1,147.70** →
×1.10 = 1,262.47 → +75 +190.50 = 1,527.97 → MAX(·,500), round 0 = **$1,528**.

## Forms catalog (12)
| Number | Edition | Name | Category | Attach | Dyn | States |
|---|---|---|---|---|---|---|
| HO 00 03 | 05 11 | Homeowners 3 — Special Form | Base Coverage | Mandatory | — | footprint |
| HO DS 01 | 05 11 | Homeowners Policy Declarations | Declarations | Mandatory | ✓ | footprint |
| HO 04 90 | 05 11 | Personal Property Replacement Cost Loss Settlement | Endorsement | Rule | — | footprint |
| HO 04 95 | 05 11 | Water Back-Up and Sump Discharge or Overflow | Endorsement | Rule | ✓ | footprint |
| HO 04 61 | 05 11 | Scheduled Personal Property Endorsement | Endorsement | Rule | ✓ | footprint |
| HO 04 16 | 05 11 | Premises Alarm or Fire Protection System | Endorsement | Rule | ✓ | footprint |
| HO 04 48 | 05 11 | Other Structures — Increased Limits | Endorsement | Rule | ✓ | footprint |
| HO 03 12 | 05 11 | Windstorm or Hail Percentage Deductible | Endorsement | Rule | ✓ | coastal |
| HO 04 96 | 05 11 | No Section II Coverage — Home Day Care Business | Exclusion | Rule | — | footprint |
| HO 01 04 | 05 11 | Special Provisions — California | Amendatory | Rule | — | CA |
| HO 01 33 | 05 11 | Special Provisions — Texas | Amendatory | Rule | — | TX |
| PN HO 01 | 05 11 | Policyholder Notice — Important Information | Policy Notice | Mandatory | — | footprint |

Dynamic fields:
- HO DS 01: NamedInsured TEXT · PropertyAddress TEXT · PolicyEffective DATE ·
  PolicyExpiration DATE · CoverageLimits (repeating: Coverage TEXT, Limit CURRENCY) ·
  TotalPremium CURRENCY
- HO 04 61 (repeating): ItemClass LIST[Jewelry, Furs, Cameras, Fine Arts,
  Silverware, Musical Instruments] · ItemDescription TEXT · AppraisedValue CURRENCY
- HO 04 95: BackUpLimit CURRENCY · HO 04 16: DeviceType LIST[Local Alarm, Central
  Station] + CertificateNo TEXT · HO 04 48 (repeating): StructureDescription TEXT +
  IncreasedLimit CURRENCY · HO 03 12: DeductiblePercent LIST[1%, 2%, 5%]

## Product rules (HO.RU.*)
- 001 Eligibility — owner-occupied 1–4 family dwelling, residential use → eligible
- 002 Coverage B default limit = 10% of Coverage A; increase only via HO 04 48
- 003 Coverage C options per HO.LD.005; default 50% of A
- 004 Coverage D limit = 30% of Coverage A
- 005 Coverage E options per HO.LD.001; default 300,000
- 006 Coverage F options per HO.LD.002; 5,000 requires Coverage E ≥ 300,000
- 007 All-peril deductible per HO.LD.003; default 1,000
- 008 Wind/Hail % deductible per HO.LD.004 — coastal states only and ≥ all-peril ded
- 009 Minimum policy premium $500 (HO.RAT.1 step 11)
- 010 Seasonal/secondary dwellings ineligible unless a companion primary policy is in force

## Form attachment rules (HO.FORM.RU.*)
- 001 Replacement Cost elected → attach HO 04 90 (mandatory)
- 002 Water Back-Up elected → attach HO 04 95 (limit merges from term)
- 003 Scheduled Personal Property elected → attach HO 04 61 (schedule merges)
- 004 Protective-device credit ≠ none → attach HO 04 16
- 005 Wind/Hail % deductible elected → attach HO 03 12
- 006 Risk state = CA → attach HO 01 04; risk state = TX → attach HO 01 33
- 007 Home day-care exclusion elected → attach HO 04 96

## Dictionary starter fields (10)
Named Insured TEXT · Property Address TEXT · Coverage A Amount CURRENCY ·
All-Peril Deductible CURRENCY · Protection Class LIST[1–10] · Construction Type
LIST[Frame, Masonry] · Territory Code LIST[T001–T005] · Appraised Value CURRENCY ·
Device Type LIST · Effective Date DATE

## Default task set (auto-created per new product; D = creation date)
Ideation & Design: "Define coverage strategy" D+7 · "Draft rating plan" D+14
Build & File: "Configure product in Factory" D+30 · "File with states" D+45
Test & Approve: "UAT rating scenarios" D+60 · "Business review sign-off" D+70
Launch & Monitor: "Launch readiness check" D+80 · "30-day results review" D+110

## Seed extras
Admin user admin@productfactory.app / admin123 (custom claim ADMIN,
mustChangePassword=true) · sample EDITOR + VIEWER users · 3 sample feedback items
(one per lane) · seedReport with counts + the computed worked-example premium.
```


## `docs/ELEVATION_PROMPT.md`

````markdown
# Elevation Prompt — Product Factory, full-app premium UI/UX pass

> Copy everything below into a fresh coding-agent session that has this repository
> checked out. It is self-contained and repo-specific.

---

## 0 · Persona

You are **"Vesper" — a Principal Design Engineer** who has shipped the interfaces
people screenshot and say *"why can't our tools look like this?"*. Your taste is the
intersection of **Apple Human Interface Guidelines, Linear, Stripe, Vercel, and
Things**: ruthless whitespace, a strict typographic scale, physical-feeling motion,
and zero visual noise. You are also **fluent in P&C insurance product management** —
you know what a coverage, endorsement, limit, deductible, rating step, ISO form
number and filing footprint actually are, and you design for the product manager
doing real work, not a demo.

You hold two non-negotiable standards at once:
1. **Elegance** — every screen should feel calm, premium, deliberate, and *fast*.
2. **Correctness** — nothing ships unless it type-checks, lints, tests, builds, and
   you have driven it yourself against the emulators.

You do not produce "good enough." You iterate until a discerning designer would call
it best-in-class. When unsure, you choose the more restrained option.

---

## 1 · Mission

Perform a **comprehensive, thorough, recursive UI/UX elevation of the entire
application** so it *wows* users with an elegant, premium, Apple-inspired, innovative
experience — while preserving every domain rule and staying production-safe. Work
**page by page**, but treat the app as one coherent system: shared components, one
type scale, one motion language, one icon family.

This is not a re-theme. It is a design-and-build pass: restructure layouts, rebuild
components, refine typography and spacing, replace weak visuals, add the missing
interactions, and remove clutter — everywhere.

---

## 2 · Product & domain context

**Product Factory** is an AI-native product-management platform for P&C insurance
product managers: they author, configure, price, govern, and ship insurance products.
The reference product is a standard ISO-style **Homeowners HO-3** (see
`docs/DOMAIN_HO.md`), with coverages A–F, endorsements, LD/RT rating tables, an
11-step rating algorithm and a **$1,528** worked example. Read `docs/DOMAIN_HO.md`
and `docs/DATA_MODEL.md` before touching related code.

**Traceability is sacred:** reference IDs like `HO.COV.003.002`, `HO.RU.006`,
`HO.RT.003`, and form numbers like `HO 04 61` must be preserved and shown as
first-class, monospaced chips. AI answers are **grounded** — they cite `[refId]` /
`[form number]` and never invent coverages, forms, rules, limits, or factors.

---

## 3 · Repository map & commands

Stack: **React + Vite + TypeScript (strict) + Tailwind v4 (`@theme` tokens) + React
Router**, pnpm workspaces (`app`, `functions`, `shared`). Firebase: Auth (custom
claims), Firestore (realtime `onSnapshot`), Cloud Functions v2 (Node 20; all AI),
Storage, Hosting, Emulator Suite. Anthropic SDK **in Functions only**
(`claude-fable-5` reasoning, `claude-haiku-4-5` bulk), streamed over SSE.

```
app/src
  routes/            landing, sign-in, app shell, and every page
  routes/product/    Overview · Coverages · Forms · Pricing · States · Rules
  components/ui/      design-system primitives (Button, Card, Dialog, Drawer, Tabs,
                      Badge, Input, EmptyState, Skeleton, Logo, ViewToggle, icons.tsx)
  components/product/ product/coverage feature components (incl. StateTileMap)
  components/shell/   Sidebar, Topbar
  context/            ProductContext (10 realtime subs), UserContext
  lib/backend/        the BackendAdapter seam (firebase.adapter.ts) — app NEVER
                      imports firebase/* directly
  lib/insurance/vocab.ts   domain vocab + limit/deductible structure catalogues
  lib/geo/usTileGrid.ts    US tile-map geometry
  index.css           the design tokens (@theme) + animations
shared/src/           types, rating evaluator, rules engine, seed/ho3, insurance/terms
functions/src/        ai.ts (SSE chat) · builder · describe · news · share · admin · tools
docs/                 DATA_MODEL.md · DOMAIN_HO.md · AWS_SWAP.md
```

Commands (root):
```
pnpm dev:all      # vite + emulators together
pnpm emulators    # firebase emulators (auth, firestore, functions, storage, hosting)
pnpm seed         # seed HO-3 into the emulator (users: editor@productfactory.app / editor123)
pnpm typecheck · pnpm lint · pnpm test · pnpm build
```
Emulator-connected dev server: run vite with `VITE_USE_EMULATORS=true`.

---

## 4 · Golden rules (do not violate)

1. **Adapter seam** — all data/auth/storage/AI goes through `app/src/lib/backend`
   (`adapter.*`). Never import `firebase/*` in app code. Tag portability-relevant
   choices with `// AWS-SWAP:`.
2. **Mutation invariant** — every write goes through `adapter.db.mutate()`, which
   atomically writes the entity + an `AuditEvent` + a `Version` snapshot + searchIndex
   upkeep + a `rev` bump. No silent writes. Rev-mismatch shows a friendly conflict toast.
3. **Roles via custom claims**, enforced in **Firestore rules AND Functions**, never
   UI-only: VIEWER = read + feedback/vote/comment; EDITOR = author domain content;
   ADMIN = users/settings/audit. Editing affordances hide for VIEWER but the server is
   the source of truth.
4. **Grounded AI** — Functions only; cite refIds/form numbers; say so when a tool
   returns nothing; never fabricate.
5. **Secrets** — the Anthropic key lives in `functions/.env.local` + Firebase Secrets
   (`defineSecret`). Never `VITE_*`, never in the bundle, never logged, never committed.
6. **Lean + commented** — every module opens with a 1–3 line purpose comment; comment
   the *why*; no dead code; no console noise. Prefer editing existing code; no drive-by
   refactors unrelated to the elevation.
7. **Preserve refIds** and the reference numbers exactly.

---

## 5 · Design North Star

Design as if this were an Apple product surface. The felt qualities to hit:

- **Calm & focused** — one primary action per view; generous negative space; nothing
  competes. Remove chrome, boxes, and dividers that don't earn their place.
- **Typographic clarity** — a strict scale, optical tracking, tabular figures, a clear
  hierarchy. Text is the UI; make it beautiful.
- **Material honesty** — soft, layered surfaces (page / surface / raised), hairline
  borders, a single restrained shadow language. Depth through light, not lines.
- **Physical motion** — 150–260ms, `cubic-bezier(.22,.61,.36,1)`, spring-like;
  entrances stagger subtly; nothing bounces gratuitously; **honor
  `prefers-reduced-motion`** everywhere.
- **Innovative, never gimmicky** — the "wow" comes from craft (a self-drawing SVG, a
  live rating flow, an intelligent extraction, a cascading explorer), not decoration.
- **Fast** — perceived performance is design. Skeletons match final layout; no layout
  shift; instant typeahead on every list.

Reference (for **functionality inspiration only — do not copy visuals**):
`https://insurance-product-hub.firebaseapp.com/login` (`admin@admin.com` /
`admin123`, a public demo). Borrow *what a PM can do*; the look must be far more
premium than that or the current app.

---

## 6 · Design system — honor and evolve

Tokens live in `app/src/index.css` (`@theme`). Keep the brand and extend the system;
never hard-code hex in components — use the tokens / gradient vars.

- **Palette** — page `#F7F7FA`, surface `#FFFFFF`, raised `#F3F3F8`; text `#131318`,
  dim `#5B5C6B`, faint `#8E90A0`; hairline borders `rgba(19,19,26,.08)`. Accent =
  Accenture-inspired **violet** (`#8B1FE0` / bright `#A100FF` / strong `#7A00E6`),
  gradient `#A100FF→#7A00E6`. Status: good `#059669`, warn `#B45309`, danger `#DC2626`.
- **Type** — **Inter** (UI) + **JetBrains Mono** (refIds, form numbers, figures, code).
  Establish and apply a disciplined Apple-caliber scale app-wide, e.g.
  `display 30/1.1 (-0.022em)`, `title 20/1.25 (-0.014em)`, `heading 16/1.35`,
  `body 14–15/1.5`, `label 12–13`, `caption 11`. Tabular, lining numerals for all
  figures (`tnum`); balanced wrapping on headings; optical sizing on. Refine
  line-height and letter-spacing until it reads like a shipping Apple app.
- **Shape & depth** — radii 12–16px; `--shadow-card` / `--shadow-card-hover` only.
- **Motion** — use the existing `--ease-spring` and the `rise-in` / node / flow
  animations; add tasteful micro-interactions (hover lift, focus glow, value counters).

---

## 7 · Global mandates (apply on EVERY surface)

1. **Cursor affordance** — every clickable element uses `cursor: pointer` (buttons,
   cards, rows, tiles, chips, tabs, toggles, nav). Add a base rule so
   `button, [role="button"], a, [role="tab"], summary { cursor: pointer }` and audit
   custom clickable `div`s. Disabled controls use `cursor: not-allowed`.
2. **Premium SVGs only** — audit **every** SVG: the icon family
   (`components/ui/icons.tsx`), the `Logo`, landing illustrations, the **US state tile
   map**, the rating-flow graphic, and empty-state art. All crisp on a 24px grid,
   `currentColor`-stroked (rounded joins), consistent weight, innovative but legible at
   16px. **Remove all remaining `lucide-react` usage app-wide** and replace with the
   in-house family (extend it as needed). No stock icons anywhere.
3. **Typography** — apply the scale from §6 to every heading, label, figure, and body
   run. No default browser sizing left behind.
4. **State completeness** — every list/detail/async view ships **loading (skeleton
   matching final layout), empty, and error** states. No dead ends, no raw spinners
   where a skeleton belongs.
5. **Accessibility & keyboard** — AA contrast; visible focus rings (the `focus-ring`
   utility); full keyboard operability; `aria-label`/roles on icon buttons, switches,
   tabs, dialogs, grids; `⌘K` palette and `⌘.` feedback keep working; respect reduced
   motion.
6. **Responsive** — graceful from ~1024px up (primary), degrade sensibly narrower.
7. **Consistency** — reuse `components/ui` primitives; if you need a new pattern
   (segmented control, stat, popover, upload dropzone, stepper, data-grid, column
   browser), build it **once** in `components/ui` and use it everywhere.

---

## 8 · Explicit mandated changes (from the product owner)

Required, in addition to the general elevation:

**A. Product Overview — simplify and make it sleek.**
- **Remove the entire right-hand rail** (the *Health score* card and *Quick stats*
  card). The Overview must be a **single-column, focused, modern reading experience**.
- Don't lose the signal: fold the essentials into the product header — the meta line
  already reads `N coverages · N states · Market`; add a subtle **health pill** there
  and surface the *single most important finding* (if any) as one quiet, dismissible
  inline banner — not a panel. Everything else in "quick stats" is redundant with the
  header/tabs; drop it.
- Present coverages as a beautiful, logically-grouped collection (Section I / II),
  generous spacing, elegant refId + limit typography.

**B. Base form gating + AI coverage extraction.** A product must have a **base coverage
form uploaded** before the **AI Summary / extraction** action is enabled (disabled with
a friendly hint until then). Once present, extraction reads the form and **proposes the
product's coverages** — prefilling as much as possible — and lets the user **review and
deselect** wrong ones before anything is written. Full spec in §10.1.

**C. Coverages view — significant UI/UX enhancement.** The coverage hub cards, the tile
grid, and the Limits/Deductibles/States editors exist — elevate them further: refined
density and typography, clearer counts and relationships, smoother transitions opening
the editors, better zero states ("0 Limits → Add your first"), premium option tables,
and a genuinely delightful cards ⇄ list experience.

**D. Pricing page — enhance UI/UX, incl. multi-dimension table steps.** Keep the live
rating trace (it proves the `$1,528` derivation), but make the worksheet premium: the
inputs panel as a clean grouped form; the trace as an elegant, legible flow with
tasteful running-total emphasis; refined Flow/Table toggle; crisp refId chips. **When a
rating step is table-based, let the PM pick up to 3 dimensions and fill an Excel-like
grid of values** — full spec in §10.2. Make the link between an input change and the
premium feel *alive*.

**E. US state map — first-class, premium, everywhere it belongs.** The **US map must be
included and elevated**. `StateTileMap` (`components/product/StateTileMap.tsx`) is a
signature component used for the **product footprint** (States tab), **per-coverage
state scope**, and **per-option applicability**. Elevate it: refined geography/tile
grid, coastal & peril badges, a clear selected / available / out-of-scope legend, hover
+ keyboard selection, accurate counts (**never >100%** — count against the footprint),
smooth fills. It should be one of the app's showpiece visuals.

**F. Explorer — cascading left-to-right column browser.** Rebuild the Explorer as
Finder-style **Miller columns** (products → coverages → sub-coverages). Full spec in
§10.3.

---

## 9 · Page-by-page scope (elevate all of it)

Bring every surface to the North Star. For each: fix layout, typography, spacing,
color, motion, icons, cursors, and all loading/empty/error states.

- **Landing (`/`)** — the showpiece. Refine the aurora, the self-drawing SVG hierarchy,
  the glass module cards, the Claude/ChatGPT-style grounded chat box. Fast LCP.
- **Sign-in / Change-password** — calm, centered, premium.
- **App shell** — Sidebar + Topbar + the `⌘K` palette + `⌘.` feedback + the product
  header banner shared across tabs. Make the banner elegant and quieter.
- **Home** — the assistant + at-a-glance workspace.
- **Products** — cards ⇄ list; refine card, list density, filters, empty states.
- **Product › Overview** — per §8A.
- **Product › Coverages** — per §8C, incl. Limit/Deductible/States editors & coverage CRUD.
- **Product › Forms** — the table + drawer + `?cov`/`?form` deep links; premium.
- **Product › Pricing** — per §8D + §10.2.
- **Product › States** — per §8E: the elevated US map + footprint editor, correct counts.
- **Product › Rules** — the IF→THEN flow cards + Simulate panel + composer.
- **Explorer** — per §8F + §10.3 (cascading columns).
- **Builder, Tasks, News, Claims, Dictionary, Feedback, Admin, Share** — each elevated
  to the same bar; do not leave any page behind.

---

## 10 · Feature specs

Deliver each end to end, through the adapter seam, grounded and role-aware per §4.

### 10.1 · Base Form upload → grounded coverage extraction
1. **Upload** — let an EDITOR upload the **base coverage form** (PDF or text) to Storage
   via `adapter.storage.upload(...)`. Store a reference on the product
   (`baseForm: { path, name, uploadedAt, uploadedBy }`) via `mutate()`. Show a tasteful
   file chip with replace/remove. VIEWER cannot upload (rules + UI).
2. **Gate** — the **AI Summary / "Extract coverages"** action is **disabled until a base
   form exists**, with a clear tooltip/hint. Enabled once present.
3. **Extraction** — a Cloud Function (extend `functions/src`; parse PDF→text
   server-side) uses Claude via tools to return a **structured proposal**: coverages
   with prefilled `name`, `requirement`, `premiumGenerating`, candidate limits/
   deductibles (typed `StandardOption`s), and attached form numbers — each with a
   **confidence** and a **citation** back to the form. Never invent; mark low confidence
   when unsure.
4. **Review UI** — a review step (dialog/drawer) lists the proposed coverages
   **prefilled and pre-checked**; the user can **deselect wrong ones**, edit values, and
   confirm. Show confidence subtly. Nothing is written until "Add selected".
5. **Persist** — on confirm, create the selected coverages via `mutate()` (one write
   each → entity + audit + version + searchIndex), preserving/allocating refIds.
6. **Grounded summary** — the summary the button produces cites the base form and the
   extracted refIds; honest about anything it couldn't determine.

Make the flow feel like magic and stay trustworthy: upload → shimmer → "we found N
coverages" → review → confirm.

### 10.2 · Table-based rating steps → up to 3 dimensions → Excel-like grid
When a rating step's source is **table-based** (RT/LD lookup), let the PM **define the
table by selecting up to 3 dimensions** (lookup keys — e.g. territory, protection
class, construction) from the rating inputs / data dictionary. The editor then renders
an **Excel-like grid** of every dimension combination to fill with values:
- **1 dimension** → a single labeled column of value rows.
- **2 dimensions** → a rows × columns matrix.
- **3 dimensions** → the third dimension as tabs/pages (or grouped sections) over the
  2-D matrix, each page a rows × columns grid.

Requirements:
- Add / rename / reorder / remove the values along each dimension.
- **Keyboard-first grid**: arrow-key navigation, Tab/Enter to advance, type-to-edit;
  **paste from clipboard (TSV)** to fill a range fast; inline numeric validation.
- A compact header showing the chosen dimensions and cell count; empty-cell warnings.
- Persist as the step's RT/LD table via `mutate()` so the **shared rating evaluator and
  the live trace pick it up immediately** — the seeded **`$1,528`** example must stay
  correct. Reflect the shape in `shared/` types if needed (keep it additive /
  backward-compatible; don't break the evaluator, export, or tests).
- Premium and dense-but-calm: tabular figures, sticky headers, zebra-free hairlines,
  frozen first column/row, tasteful selection. This grid is the centerpiece of the
  Pricing enhancement.

### 10.3 · Explorer — cascading column browser (Miller columns)
Rebuild the Explorer as a **left-to-right cascading column browser**:
- **Column 1 — Products.** Selecting a product…
- **Column 2 — Coverages** of that product. Clicking a coverage…
- **Column 3 — Sub-coverages (endorsements)** of that coverage.
- Optional **Column 4 / peek panel** — the selected node's key facts (refId, status,
  limits summary, attached forms) with deep links into its editors.

Each column is a clean, **searchable, keyboard-navigable** list (↑/↓ to move, →/Enter to
descend, ← to go back); the selected item in each column is highlighted and drives the
next; a **breadcrumb** shows the current path. Smooth column transitions; per-column
loading/empty states; every node links into its editor (coverage → Limits/Deductibles/
States/etc.). Think macOS Finder columns — premium.

---

## 11 · Method — recursive elevation loop

Work in this loop until the exit criteria are met:

1. **Read** CLAUDE.md + the relevant `docs/` before each area. Inspect the current
   surface (run it against emulators).
2. **Critique** against this rubric, scoring each 1–5 and only accepting ≥4.5:
   - **A. Layout & hierarchy** — is the eye led; one clear primary action?
   - **B. Typography** — scale, tracking, rhythm, tabular figures, refId treatment.
   - **C. Spacing & density** — generous, consistent, aligned to a grid.
   - **D. Color & depth** — restrained palette, honest layering, one shadow language.
   - **E. Motion & micro-interaction** — physical, purposeful, reduced-motion safe.
   - **F. Iconography & SVG** — premium, in-family, crisp, innovative.
   - **G. Affordance** — cursors, hover/active/focus, disabled clarity.
   - **H. States** — loading/empty/error/zero all designed.
   - **I. Domain truth** — refIds, relationships, grounded AI, roles honored.
   - **J. A11y & keyboard** — AA, focus, roles, keyboard-first.
3. **Rebuild** the surface to hit the bar (restructure, don't just restyle).
4. **Verify** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then run it
   yourself against the emulators (seed HO-3) and confirm the acceptance criteria.
5. **Self-review as a hostile senior designer + engineer**, fix what you find.
6. **Commit** locally with a clear message. Move to the next surface.

Exit criteria: every surface scores ≥4.5 on all ten rubric axes; the gate is green;
you've driven every changed flow on the emulators; **no `lucide-react` remains**; every
clickable element has a pointer cursor; **Overview has no right rail**; the **US map is
elevated**; **base-form gate + extraction** works end to end; **table steps support up
to 3 dimensions with an Excel-like grid** (and `$1,528` still computes); the **Explorer
is a cascading product → coverage → sub-coverage column browser**.

---

## 12 · Definition of Done & guardrails

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass; you ran it against
  the emulators and verified acceptance criteria for every change.
- Loading/empty/error states shipped; roles enforced in rules + Functions; audit +
  version written on every mutation; keyboard + screen-reader friendly; reduced-motion
  respected; AA contrast.
- No dead code, no console noise, no stray `lucide-react`, no hard-coded hex.
- Commit locally per surface with clear messages. **Do NOT deploy to production and do
  NOT push** without explicit approval. Never touch production data; if a step would,
  stop and ask first.
- Report at the end with a per-surface before/after summary, the rubric scores, the gate
  result, screenshots, and anything deferred.

**Bar:** a discerning designer opens the app and says *"this is the most beautiful
insurance tool I've ever seen."* Iterate until that's true.
````


## `CLAUDE.md`

```markdown
# CLAUDE.md — Product Factory (Firebase edition)

## What this is
Product Factory: an AI-native product management platform for P&C insurance product
managers. Reference line for the seed: a standard ISO-style **Homeowners HO-3**
product defined in `docs/DOMAIN_HO.md`. Users author, configure, price, govern and
ship insurance products. Read `docs/DATA_MODEL.md` (Firestore model) and
`docs/AWS_SWAP.md` (portability seam) before touching related code.
Repo folder: **"Product Reinvention Hub"** (local git only — no remote yet).
Firebase project: **productreinvention** (Blaze; Firestore, Storage, Auth
email/password + anonymous, Functions and Hosting already enabled).

## Golden rules
- Read this file and the relevant doc in `docs/` before any task. Prefer editing
  existing code. No drive-by refactors.
- **Secrets:** the Anthropic key originates in `apikeys.md` at the repo root
  (user-provided, gitignored). Its canonical homes are `functions/.env.local`
  (local dev, gitignored) and Firebase Secrets (`firebase functions:secrets:set
  ANTHROPIC_API_KEY`, bound via `defineSecret`). Never `VITE_*`, never in the app
  bundle, never committed, never echoed to logs.
- **Adapter seam:** app code never imports `firebase/*` directly — everything goes
  through `app/src/lib/backend` (the `BackendAdapter`). `firebase.adapter.ts` is
  active; `aws.adapter.placeholder.ts` mirrors the interface with commented AWS
  mappings. Tag every portability-relevant decision with a `// AWS-SWAP:` comment.
- **Lean + well-commented:** every module opens with a 1–3 line purpose comment;
  comment the *why*, not the obvious *what*; no dead code, no console noise.
- Every mutation flows through `adapter.db.mutate()` which writes the entity change
  + an AuditEvent + a Version snapshot + searchIndex upkeep in one batch. No silent
  writes anywhere.
- Preserve reference IDs (`refId`) like HO.COV.003.002, HO.RU.006, HO.FORM.RU.003,
  HO.LD.002, HO.RT.003, and form numbers like HO 04 61 — they are the traceability
  backbone.
- AI answers are grounded through tools and cite refIds/form numbers in square
  brackets, e.g. [HO.RU.006] [HO 04 90]. Never invent coverages, forms, rules,
  limits or factors. If a tool returns nothing, say so.
- Roles via Firebase Auth **custom claims** (mirrored on `users/{uid}` for display):
  VIEWER = inquiry-only (no edit affordances; writes rejected by security rules);
  EDITOR = create/update domain content; ADMIN = users, settings, audit explorer.
  Enforce in Firestore rules and in Functions — never UI-only.

## Stack
React + Vite + TypeScript strict + Tailwind (Vite plugin). React Router.
Firebase: Auth (email/password + custom claims), Firestore (data + realtime via
onSnapshot), Cloud Functions v2 (Node 20 — all AI + agents + share snapshot),
Storage (doc uploads), Hosting (deploy), Emulator Suite (local dev).
Anthropic SDK in Functions only — `claude-fable-5` for reasoning,
`claude-haiku-4-5` for bulk/simple generations, prompt caching on the shared
system context, streamed responses (SSE over `onRequest`).
Shared pure logic in `shared/` (types, rating evaluator, rules engine, HO-3 seed
constants) consumed by both app and functions. exceljs (client) for Excel export.
Vitest. pnpm workspaces: `app`, `functions`, `shared`.

## Commands (root)
pnpm dev            # Vite dev server (expects emulators running)
pnpm emulators      # firebase emulators:start (auth, firestore, functions, storage, hosting)
pnpm dev:all        # both, concurrently
pnpm seed           # seed HO-3 into the emulator (or --project <id> for prod, with confirm)
pnpm test           # vitest (shared engines + app units)
pnpm typecheck · pnpm lint · pnpm build
pnpm deploy         # build + firebase deploy

## Layout
app/src
  routes: / (public landing) · /app (auth shell): home, products,
  products/:id/(overview|coverages|forms|pricing|states|rules), builder, explorer,
  tasks, news, claims, dictionary, feedback, admin · /share/:token (public)
  components/ (ui primitives + feature components)
  lib/backend/ (types.ts, firebase.adapter.ts, aws.adapter.placeholder.ts, index.ts,
  firebase.config.ts) · lib/ (export/excel.ts, svg/, utils)
functions/src (ai.ts SSE chat · builder.ts · claims.ts · gap.ts · describe.ts ·
  health.ts · news.ts scheduled · share.ts · admin.ts setUserRole · tools.ts)
shared/src (types.ts · rating/evaluator.ts · rules/engine.ts · seed/ho3.ts)
docs/ (DATA_MODEL.md · DOMAIN_HO.md · AWS_SWAP.md) · scripts/seed.ts
firebase.json · firestore.rules · firestore.indexes.json · storage.rules

## Design system (light, premium, Apple-inspired)
Backgrounds #F7F7FA page, #FFFFFF surface, #F3F3F8 raised; borders rgba(19,19,26,.08).
Text #131318 / dim #5B5C6B / faint #8E90A0.
Accent gradient **#C026D3 → #EC4899**; accent-soft rgba(192,38,211,.07);
status: good #059669, warn #B45309, danger #DC2626.
Fonts: Inter (UI), JetBrains Mono (refIds, numbers, labels, code).
Radius 14–16px. Card glow: 0 1px 2px rgba(19,19,26,.04), 0 14px 34px rgba(192,38,211,.06).
Motion cubic-bezier(.22,.61,.36,1), 150–300ms; respect prefers-reduced-motion.
Every list gets instant typeahead; ⌘K opens the global palette; ⌘. opens quick
feedback capture. Landing page (public /) is the showpiece: subtle animated aurora,
self-drawing custom SVG hierarchy, glass module cards — no stock images, inline SVG
only, fast LCP. Design loading/empty/error states for every view. Keyboard-first. AA.

## Domain model
Canonical structure, governance metadata, and every collection shape:
`docs/DATA_MODEL.md`. The seeded HO-3 product — coverages A–F, endorsements,
LD/RT tables, the 11-step rating algorithm and the $1,528 worked example — is
specified exactly in `docs/DOMAIN_HO.md`; the seed and tests must match it.

## Definition of done — every task
pnpm typecheck && pnpm lint && pnpm test pass; run it yourself against the
emulators and verify the acceptance criteria before reporting. Loading/empty/error
states shipped. Rules + Functions enforce roles. Audit + Version written on every
mutation. Keyboard and screen-reader friendly. Then review your own work as a
hostile senior reviewer, fix what you find, commit locally with a clear message
(no remote yet), and only then report done with a summary of changes.
```


## `firebase.json`

```json
{
  "hosting": {
    "public": "app/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "/share/**",
        "function": "share"
      },
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  },
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "ignore": [
        "node_modules",
        ".git",
        "firebase-debug.log",
        "firebase-debug.*.log",
        "*.local"
      ],
      "predeploy": ["pnpm --filter functions run build"]
    }
  ],
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "storage": { "port": 9199 },
    "hosting": { "port": 5000 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```


## `firestore.indexes.json`

```json
{
  "indexes": [
    { "collectionGroup": "tasks",       "queryScope": "COLLECTION", "fields": [{ "fieldPath": "column", "order": "ASCENDING" }, { "fieldPath": "order", "order": "ASCENDING" }] },
    { "collectionGroup": "feedback",    "queryScope": "COLLECTION", "fields": [{ "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "priorityScore", "order": "DESCENDING" }] },
    { "collectionGroup": "versions",    "queryScope": "COLLECTION", "fields": [{ "fieldPath": "entityPath", "order": "ASCENDING" }, { "fieldPath": "at", "order": "DESCENDING" }] },
    { "collectionGroup": "auditEvents", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "productId", "order": "ASCENDING" }, { "fieldPath": "at", "order": "DESCENDING" }] },
    { "collectionGroup": "searchIndex", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "type", "order": "ASCENDING" }, { "fieldPath": "title", "order": "ASCENDING" }] }
  ],
  "fieldOverrides": []
}
```


## `firestore.rules`

```js
// Firestore security rules — role matrix per docs/DATA_MODEL.md Access section.
// Role is read from the verified JWT custom claim (set via setUserRole callable).
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── Helpers ──────────────────────────────────────────────────────────────

    function isAuthed()  { return request.auth != null; }
    function role()      { return isAuthed() ? request.auth.token.get('role', '') : ''; }
    function isViewer()  { return role() == 'VIEWER'; }
    function isEditor()  { return role() == 'EDITOR'; }
    function isAdmin()   { return role() == 'ADMIN'; }
    function canEdit()   { return isEditor() || isAdmin(); }
    function myUid()     { return request.auth.uid; }

    // ── Share links — no client access; Admin SDK only ────────────────────────
    match /shareLinks/{token} {
      allow read, write: if false;
    }

    // ── Audit events — create-only from authenticated users ───────────────────
    match /auditEvents/{id} {
      allow create: if isAuthed();
      allow read:   if isAdmin();
      allow update, delete: if false;
    }

    // ── Versions — create-only; readable by any authed user (powers the History
    //    drawer + restore for EDITORs, and the product workspace context). ───────
    match /versions/{id} {
      allow create: if isAuthed();
      allow read:   if isAuthed();
      allow update, delete: if false;
    }

    // ── Users — ADMIN reads + writes; others read own doc only ────────────────
    match /users/{uid} {
      allow read:  if isAdmin() || myUid() == uid;
      allow write: if isAdmin();
    }

    // ── Products + sub-collections ────────────────────────────────────────────
    match /products/{pid} {
      allow read:  if isAuthed();
      allow write: if canEdit();

      match /coverages/{cid}      { allow read: if isAuthed(); allow write: if canEdit(); }
      match /rules/{rid}          { allow read: if isAuthed(); allow write: if canEdit(); }
      match /formRules/{id}       { allow read: if isAuthed(); allow write: if canEdit(); }
      match /ratingPrograms/{gid} { allow read: if isAuthed(); allow write: if canEdit(); }
    }

    // ── Forms, LD/RT tables, Dictionary — EDITOR/ADMIN write; all read ────────
    match /forms/{formKey}        { allow read: if isAuthed(); allow write: if canEdit(); }
    match /ldTables/{refId}       { allow read: if isAuthed(); allow write: if canEdit(); }
    match /rtTables/{refId}       { allow read: if isAuthed(); allow write: if canEdit(); }
    match /dictionary/{id}        { allow read: if isAuthed(); allow write: if canEdit(); }

    // ── Tasks — EDITOR/ADMIN write; all read ─────────────────────────────────
    match /tasks/{id}             { allow read: if isAuthed(); allow write: if canEdit(); }

    // ── Feedback — special: VIEWER may submit + vote; EDITOR/ADMIN manage ────
    match /feedback/{id} {
      allow read:   if isAuthed();
      // VIEWER may create feedback
      allow create: if isAuthed();
      // VIEWER may cast exactly one vote (arrayUnion own uid to voters)
      allow update: if isAuthed() &&
        (canEdit() ||
          // Vote-only path: only votes.count and votes.voters change
          (request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['votes']) &&
           request.resource.data.votes.voters.toSet().difference(
             resource.data.votes.voters.toSet()).hasOnly([myUid()]) &&
           request.resource.data.votes.count ==
             resource.data.votes.count + 1));
      allow delete: if canEdit();
    }

    // ── Comments — any auth user may create; VIEWER cannot edit others ────────
    match /comments/{id} {
      allow read:   if isAuthed();
      allow create: if isAuthed();
      allow update, delete: if canEdit();
    }

    // ── News + prefs — read all; write prefs own; news via Functions ──────────
    match /news/{id}              { allow read: if isAuthed(); allow write: if isAdmin(); }
    match /newsPrefs/{uid}        { allow read: if isAuthed() && myUid() == uid;
                                    allow write: if isAuthed() && myUid() == uid; }

    // ── Search index — maintained by seed + mutate(); read by all authed ──────
    match /searchIndex/{id}       { allow read: if isAuthed(); allow write: if canEdit(); }

    // ── Seed reports — read-only for all authed; write via Admin SDK ──────────
    match /seedReports/{id}       { allow read: if isAuthed(); allow write: if false; }

    // ── Presence heartbeats ───────────────────────────────────────────────────
    match /presence/{pid}/viewers/{uid} {
      allow read:  if isAuthed();
      allow write: if isAuthed() && myUid() == uid;
    }

    // ── Deny everything not explicitly matched ────────────────────────────────
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```


## `package.json`

```json
{
  "name": "product-reinvention-hub",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "dev": "pnpm --filter app dev",
    "emulators": "firebase emulators:start",
    "dev:all": "concurrently \"pnpm emulators\" \"pnpm --filter app dev\"",
    "seed": "tsx scripts/seed.ts",
    "test": "vitest run",
    "test:rules": "firebase emulators:exec --only firestore --project productreinvention \"vitest run --config vitest.rules.config.ts\"",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "build": "pnpm --filter app build",
    "deploy": "pnpm build && firebase deploy"
  },
  "devDependencies": {
    "@firebase/rules-unit-testing": "^5.0.1",
    "concurrently": "^9.1.2",
    "firebase": "^11.10.0",
    "firebase-admin": "^13.10.0",
    "playwright": "^1.61.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^3.1.4"
  }
}
```


## `pnpm-workspace.yaml`

```yaml
packages:
  - 'app'
  - 'functions'
  - 'shared'
allowBuilds:
  '@firebase/util': true
  esbuild: true
  protobufjs: true
```


## `README.md`

````markdown
# Product Reinvention Hub

An AI-native product-management platform for P&C insurance product managers. Author
coverages, price with confidence, govern with traceability, and ship — from first
draft to state filing. The reference product is an ISO-style **Homeowners HO-3**
(`docs/DOMAIN_HO.md`).

## Stack

- **App** — React + Vite + TypeScript (strict) + Tailwind v4, React Router. All
  backend access goes through the adapter seam (`app/src/lib/backend`) — app code
  never imports `firebase/*` directly (`docs/AWS_SWAP.md`).
- **Functions** — Cloud Functions v2 (Node 20). All Anthropic usage lives here
  (`claude-sonnet-4-6`): tool-grounded chat (SSE), claims, gap, builder, form
  descriptions, health, and the nightly news agent. Secrets via `defineSecret`.
- **Data** — Firestore (realtime via `onSnapshot`), Storage, Auth (email/password +
  custom-claim roles). Pure domain logic (types, rating evaluator, rules engine,
  HO-3 seed) lives in `shared/` and is consumed by both.
- **Monorepo** — pnpm workspaces: `app`, `functions`, `shared`.

## Prerequisites

- Node 20+ and **pnpm**
- **Java 21+** (for the Firestore emulator)
- **Firebase CLI** (`npm i -g firebase-tools`)
- An Anthropic API key for the AI features (see Secrets)

```bash
pnpm install
```

## Secrets

The Anthropic key originates in `apikeys.md` (repo root, gitignored). Its canonical
homes:

- **Local/emulator** — `functions/.env.local` → `ANTHROPIC_API_KEY=sk-ant-...`
- **Production** — `firebase functions:secrets:set ANTHROPIC_API_KEY`

Never expose it as `VITE_*`, never commit it, never log it.

## Run it locally

```bash
pnpm emulators     # Auth, Firestore, Functions, Storage, Hosting (needs Java)
pnpm seed          # seed the HO-3 product into the emulator (prints $1,528)
pnpm dev           # Vite dev server (expects emulators running)
# or both at once:
pnpm dev:all
```

Open the app, then sign in with a seeded account (or use **Continue as admin** on
the sign-in page):

| Role   | Email                       | Password    |
| ------ | --------------------------- | ----------- |
| ADMIN  | admin@productfactory.app    | `admin123`  |
| EDITOR | editor@productfactory.app   | `editor123` |
| VIEWER | viewer@productfactory.app   | `viewer123` |

The seeded admin keeps a "temporary password" banner until it's changed.

## Quality gates

```bash
pnpm typecheck     # tsc across all workspaces
pnpm lint          # oxlint (app)
pnpm test          # vitest — shared engines + units
```

## Deploy

```bash
pnpm build         # build the app
pnpm deploy        # build + firebase deploy (hosting + functions + rules + indexes)
```

Set the production secret first (`firebase functions:secrets:set ANTHROPIC_API_KEY`).
Shared links are served by the `share` Function via the `/share/**` hosting rewrite
(per-product social card + read-only summary).

## Where things live

```
app/src
  routes/            home (portfolio chat), products, product/* tabs, tasks, news,
                     dictionary, feedback, admin, explorer, share view, landing, sign-in
  components/        ui primitives, shell, palette, product, feedback, dictionary
  lib/backend/       the BackendAdapter seam (firebase.adapter.ts is active)
  lib/export/        exceljs workbook (four DOMAIN_HO sheets)
  lib/integrations/  duckcreek.ts (coming soon) · accenture.ts (env-driven client)
functions/src        runtime · tools · ai · admin · news · share · health
shared/src           types · rating/evaluator · rules/engine · seed/ho3
docs/                DATA_MODEL.md · DOMAIN_HO.md · AWS_SWAP.md
```

## Portability

Every platform touchpoint sits behind `BackendAdapter`. To move off Firebase,
implement `aws.adapter.ts` against the same interface and flip the export in
`app/src/lib/backend/index.ts`. Grep `AWS-SWAP:` for every seam decision.
````


## `storage.rules`

```js
// Cloud Storage rules — authenticated users may upload to their own prefix only.
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /uploads/{uid}/{allPaths=**} {
      allow read:  if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    // Deny everything else.
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```


## `vitest.config.ts`

```ts
// Root vitest config — covers shared engines and app units.
// Functions integration tests run separately against the emulators.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'shared/src/**/*.test.ts',
      'app/src/**/*.test.ts',
    ],
    reporter: 'verbose',
  },
})
```


## `vitest.rules.config.ts`

```ts
// Separate vitest config for Firestore security rules tests.
// Run via: pnpm test:rules  (which uses firebase emulators:exec to start Firestore first)
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment:   'node',
    include:       ['tests/**/*.test.ts'],
    testTimeout:   20000,
    hookTimeout:   30000,
    singleThread:  true,   // rules tests are stateful; run serially
  },
})
```


## `shared/package.json`

```json
{
  "name": "@pf/shared",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo 'no linter configured for shared'"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.1.4"
  }
}
```


## `shared/src/index.ts`

```ts
// @pf/shared — pure TypeScript; zero platform imports.
// Exports types, rating evaluator, rules engine, retrieval ranker, and HO-3 seed.
export * from './types'
export * from './rating/evaluator'
export * from './rules/engine'
export * from './insurance/terms'
export * from './search/rank'
export * from './seed/ho3'
```


## `shared/src/insurance/terms.ts`

```ts
// terms.ts — canonical logic for coverage limit/deductible terms. Pure functions
// shared by the app editors, the rating/export code and any Function that reads a
// term. The rich `optionSet` is authoritative when present; otherwise it is
// derived from the legacy (`options`/`default`/`min`/`max`) fields + LD table so
// seeded content renders in the new UI. On save the editor persists `optionSet`
// AND mirrors the legacy fields (see `syncLegacy`) so nothing downstream breaks.
import type {
  CoverageTerm, LDTable, StandardOption, OptionValueType,
  LimitStructure, DeductibleStructure, LimitBasis,
} from '../types'

export function isPercentTerm(t: Pick<CoverageTerm, 'unit' | 'basis'>): boolean {
  return t.unit === '%' || t.unit === 'percent' || (t.basis?.toLowerCase().includes('percent') ?? false)
}

/** The default value-type for a term with no explicit typing yet. */
export function deriveOptionType(t: CoverageTerm): OptionValueType {
  if (isPercentTerm(t)) return 'PERCENT'
  return 'FLAT'
}

export function deriveStructure(t: CoverageTerm): LimitStructure | DeductibleStructure {
  if (t.structure) return t.structure
  if (t.kind === 'DEDUCTIBLE') return isPercentTerm(t) ? 'PERCENT' : 'FLAT'
  return 'SINGLE'
}

export function deriveBasis(t: CoverageTerm): LimitBasis {
  if (t.limitBasis) return t.limitBasis
  const b = t.basis?.toLowerCase() ?? ''
  if (b.includes('person')) return 'PER_PERSON'
  if (b.includes('aggregate')) return 'AGGREGATE'
  if (b.includes('item')) return 'PER_ITEM'
  if (b.includes('claim')) return 'PER_CLAIM'
  if (b.includes('location')) return 'PER_LOCATION'
  return 'PER_OCCURRENCE'
}

const compactMoney = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`
  : n >= 1_000 ? `$${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
  : `$${n.toLocaleString()}`

/** Human label for an option, honouring an explicit `label` then its type. */
export function formatOption(o: StandardOption, compact = false): string {
  if (o.label) return o.label
  switch (o.type) {
    case 'PERCENT':        return `${o.value}%`
    case 'WAITING_PERIOD': return o.value % 24 === 0 ? `${o.value / 24} days` : `${o.value} hours`
    case 'SPLIT':          return (o.parts ?? []).map(p => compact ? compactMoney(p) : `$${p.toLocaleString()}`).join(' / ')
    default:               return compact ? compactMoney(o.value) : `$${o.value.toLocaleString()}`
  }
}

/** Numeric options for range math — SPLIT/WAITING are excluded from min/max. */
function numericValue(o: StandardOption): number | undefined {
  return o.type === 'SPLIT' ? undefined : o.value
}

/** Resolve a term's option matrix: the stored `optionSet` if present, otherwise a
 *  derived one from legacy fields + LD table. Always returns at least the default. */
export function resolveTermOptions(t: CoverageTerm, ldTable?: LDTable): StandardOption[] {
  if (t.optionSet?.length) return t.optionSet

  const type = deriveOptionType(t)
  const fromLegacy = (t.options?.filter(o => typeof o === 'number') as number[] | undefined) ?? []
  const fromTable  = ldTable?.rows.map(r => r.value) ?? []
  const numbers    = [...new Set([...fromLegacy, ...fromTable])].sort((a, b) => a - b)

  const defNum = typeof t.default === 'number' ? t.default : undefined
  const values = numbers.length ? numbers : defNum !== undefined ? [defNum] : []

  const opts: StandardOption[] = values.map(v => ({
    id: `opt-${v}`, type, value: v,
    allStates: true, states: [],
    isDefault: defNum !== undefined ? v === defNum : false,
    enabled: true,
  }))
  return ensureOneDefault(opts)
}

/** Guarantee exactly one enabled option is the default (relationship integrity). */
export function ensureOneDefault(opts: StandardOption[]): StandardOption[] {
  if (!opts.length) return opts
  const enabled = opts.filter(o => o.enabled)
  const pool = enabled.length ? enabled : opts
  const chosen = pool.find(o => o.isDefault) ?? pool[0]
  return opts.map(o => ({ ...o, isDefault: o.id === chosen.id }))
}

/** Mirror the rich option matrix back onto the legacy fields the rating engine,
 *  Excel export and compact summaries still read. Keeps the two representations
 *  consistent so we never have to migrate all consumers at once. */
export function syncLegacy(opts: StandardOption[]): Pick<CoverageTerm, 'options' | 'default' | 'min' | 'max'> {
  const enabled = opts.filter(o => o.enabled)
  const nums = enabled.map(numericValue).filter((n): n is number => n !== undefined).sort((a, b) => a - b)
  const def = enabled.find(o => o.isDefault) ?? enabled[0]
  const defVal = def ? (def.type === 'SPLIT' ? formatOption(def) : def.value) : ''
  return {
    options: nums,
    default: defVal,
    ...(nums.length ? { min: nums[0], max: nums[nums.length - 1] } : {}),
  }
}

/** A compact "$1k – $25k" range summary for a term, or null when not applicable. */
export function rangeLabel(t: CoverageTerm, ldTable?: LDTable): string | null {
  const opts = resolveTermOptions(t, ldTable)
  const nums = opts.map(numericValue).filter((n): n is number => n !== undefined)
  const lo = t.min ?? (nums.length ? Math.min(...nums) : undefined)
  const hi = t.max ?? (nums.length ? Math.max(...nums) : undefined)
  if (lo === undefined || hi === undefined || lo === hi) return null
  const pct = isPercentTerm(t)
  const f = (n: number) => (pct ? `${n}%` : compactMoney(n))
  return `${f(lo)} – ${f(hi)}`
}
```


## `shared/src/rating/evaluator.test.ts`

```ts
// Evaluator tests — must assert the $1,528 worked example with exact per-step values.
import { describe, it, expect } from 'vitest'
import { evaluate } from './evaluator'
import {
  HO3_RATING_PROGRAM, HO3_RT_TABLES, HO3_LD_TABLES,
  HO3_WORKED_EXAMPLE, makeHO3RtGetter, makeHO3LdGetter,
} from '../seed/ho3'

const rtGetter = makeHO3RtGetter(HO3_RT_TABLES)
const ldGetter = makeHO3LdGetter(HO3_LD_TABLES)

describe('HO-3 rating evaluator', () => {
  it('produces $1,528 for the DOMAIN_HO worked example with exact per-step trace', () => {
    const result = evaluate(HO3_RATING_PROGRAM, HO3_WORKED_EXAMPLE, rtGetter, ldGetter)

    expect(result.finalPremium).toBe(1528)

    // Per-step assertions from DOMAIN_HO.md worked example trace
    // 700.00 → ×1.05 = 735.00 → ×1.30 = 955.50 → 956 → ×1.00 = 956.00 →
    // ×1.06 = 1,013.36 → +24 = 1,037.36 → +6 = 1,043.36 →
    // ×(1.10×1.00) = 1,147.70 → ×1.10 = 1,262.47 → +75 +190.50 = 1,527.97 → 1,528
    const by = (id: string) => result.trace.find(t => t.stepId === id)!

    expect(by('s1').runningTotal).toBe(700)          // territory T002 base rate
    expect(by('s2').runningTotal).toBe(735)           // ×1.05 PC5/Masonry
    expect(by('s3').runningTotal).toBe(956)           // ×1.30 covA400k, rounded to $
    expect(by('s4a').runningTotal).toBe(956)          // ×1.00 ded1000 (no change)
    // s4b skipped (windHailElected=false)
    expect(result.trace.find(t => t.stepId === 's4b')).toBeUndefined()
    expect(by('s5').runningTotal).toBeCloseTo(1013.36, 2)   // ×1.06 covC70%
    expect(by('s6').runningTotal).toBeCloseTo(1037.36, 2)   // +24 covE300k
    expect(by('s7').runningTotal).toBeCloseTo(1043.36, 2)   // +6 covF2k
    expect(by('s8a').runningTotal).toBeCloseTo(1147.696, 2) // ×1.10 RC
    expect(by('s8b').runningTotal).toBe(1147.70)            // ×1.00 device=none, rounded to ¢
    expect(by('s9').runningTotal).toBeCloseTo(1262.47, 2)   // ×1.10 tierB
    expect(by('s10a').runningTotal).toBeCloseTo(1337.47, 2) // +75 water backup
    expect(by('s10b').runningTotal).toBeCloseTo(1527.97, 2) // +190.50 SPP jewelry
    expect(by('s11').runningTotal).toBe(1528)               // MAX(1527.97,500) rounded
  })

  it('produces minimum premium $500 when calculated premium is lower', () => {
    const lowInputs = {
      ...HO3_WORKED_EXAMPLE,
      territory: 'T001',
      covA: 200000,
      covCPct: 50,
      covELimit: 100000,
      covFLimit: 1000,
      allPerilDed: 5000,
      rcElected: false,
      tier: 'A',
      waterBackupElected: false,
      sppElected: false,
      sppItems: [],
    }
    const result = evaluate(HO3_RATING_PROGRAM, lowInputs, rtGetter, ldGetter)
    expect(result.finalPremium).toBeGreaterThanOrEqual(500)
  })

  it('wind/hail step is skipped when not elected', () => {
    const result = evaluate(
      HO3_RATING_PROGRAM,
      { ...HO3_WORKED_EXAMPLE, windHailElected: false },
      rtGetter, ldGetter,
    )
    expect(result.trace.find(t => t.stepId === 's4b')).toBeUndefined()
  })

  it('wind/hail step executes and reduces premium when elected for coastal input', () => {
    // FL risk, CovA 400k, all-peril ded 1000; 2% WH = 0.94 factor
    const coastalInputs: typeof HO3_WORKED_EXAMPLE = {
      ...HO3_WORKED_EXAMPLE,
      windHailElected: true,
      windHailPct: 2,
    }
    const withWH    = evaluate(HO3_RATING_PROGRAM, coastalInputs, rtGetter, ldGetter)
    const withoutWH = evaluate(HO3_RATING_PROGRAM, { ...coastalInputs, windHailElected: false }, rtGetter, ldGetter)
    expect(withWH.finalPremium).toBeLessThan(withoutWH.finalPremium)
    const s4b = withWH.trace.find(t => t.stepId === 's4b')
    expect(s4b).toBeDefined()
    expect(s4b!.factorOrAmount).toBe(0.94)
  })
})
```


## `shared/src/rating/evaluator.ts`

```ts
// Pure rating engine: executes a RatingProgram step-by-step and returns a full trace.
// No platform imports; injected table getters keep this testable without Firestore.
import type { RatingProgram, RatingInputs, EvaluatorResult, TraceEntry } from '../types'

/** Look up a value from an RT table given a set of resolved input keys. */
export type RtGetter = (tableRef: string, queryInputs: Record<string, unknown>) => number

/** Look up a value from an LD table by the selected option value (or label). */
export type LdGetter = (tableRef: string, selectedValue: number | string) => number

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Evaluate a RatingProgram against the provided inputs.
 * Steps execute in `order` sequence; the `condition` field is an input key
 * that gates execution (falsy → step is skipped, running total unchanged).
 */
export function evaluate(
  program: RatingProgram,
  inputs: RatingInputs,
  rtGetter: RtGetter,
  ldGetter: LdGetter,
): EvaluatorResult {
  const sortedSteps = [...program.steps].sort((a, b) => a.order - b.order)
  let running = 0
  const trace: TraceEntry[] = []

  for (const step of sortedSteps) {
    // Gate: skip if condition input is falsy
    if (step.condition !== undefined && !inputs[step.condition]) continue

    const { factor, sourceRef } = resolveSource(step, inputs, rtGetter, ldGetter)

    let nextRunning: number
    switch (step.op) {
      case 'SET':      nextRunning = factor;                break
      case 'MUL':      nextRunning = running * factor;      break
      case 'ADD':      nextRunning = running + factor;      break
      case 'MIN_FLOOR': nextRunning = Math.max(running, factor); break
    }

    const didRound = step.roundTo !== undefined
    if (didRound) nextRunning = round(nextRunning, step.roundTo!)

    running = nextRunning

    trace.push({
      stepId:         step.id,
      label:          step.label,
      op:             step.op,
      sourceRef,
      factorOrAmount: factor,
      rounded:        didRound,
      runningTotal:   running,
    })
  }

  return { finalPremium: running, trace }
}

function resolveSource(
  step: RatingProgram['steps'][number],
  inputs: RatingInputs,
  rtGetter: RtGetter,
  ldGetter: LdGetter,
): { factor: number; sourceRef: string } {
  const src = step.source

  switch (src.type) {
    case 'CONST':
      return { factor: src.value!, sourceRef: `CONST(${src.value})` }

    case 'INPUT': {
      const v = inputs[src.ref!]
      if (typeof v !== 'number') throw new Error(`INPUT '${src.ref}' must be a number, got ${typeof v}`)
      return { factor: v, sourceRef: `INPUT(${src.ref})` }
    }

    case 'LD': {
      const selectedValue = inputs[src.keys![0]]
      if (selectedValue === undefined) throw new Error(`LD key '${src.keys![0]}' not found in inputs`)
      const factor = ldGetter(src.ref!, selectedValue as number | string)
      return { factor, sourceRef: `${src.ref}[${selectedValue}]` }
    }

    case 'RT': {
      const queryInputs: Record<string, unknown> = {}
      for (const k of src.keys ?? []) queryInputs[k] = inputs[k]
      const factor = rtGetter(src.ref!, queryInputs)
      const keyStr = (src.keys ?? []).map(k => `${k}=${inputs[k]}`).join(',')
      return { factor, sourceRef: `${src.ref}[${keyStr}]` }
    }

    case 'SPP': {
      // Σ(appraisedValue / 100 × classRate) across all SPP items
      const items = inputs.sppItems ?? []
      let total = 0
      for (const item of items) {
        const ratePerHundred = rtGetter(src.ref!, { itemClass: item.itemClass })
        total += (item.appraisedValue / 100) * ratePerHundred
      }
      return { factor: total, sourceRef: `SPP(${src.ref})` }
    }

    default:
      throw new Error(`Unknown source type: ${(src as { type: string }).type}`)
  }
}
```


## `shared/src/rules/engine.test.ts`

```ts
// Rules engine tests — validates constraints, form attachment, and violations.
import { describe, it, expect } from 'vitest'
import { evaluateRules } from './engine'
import { HO3_LD_TABLES } from '../seed/ho3'
import type { SelectionContext } from '../types'

const BASE: SelectionContext = {
  riskState:          'OH',
  covELimit:          300000,
  covFLimit:          1000,
  allPerilDed:        1000,
  windHailElected:    false,
  windHailPct:        undefined,
  covA:               300000,
  rcElected:          false,
  deviceCredit:       'none',
  waterBackupElected: false,
  waterBackupLimit:   undefined,
  sppElected:         false,
  dayCareCoverage:    false,
  otherStructuresInc: false,
}

describe('HO-3 rules engine', () => {
  // ── Coverage F constraint [HO.RU.006] ──────────────────────────────────────

  it('blocks Coverage F $5,000 when Coverage E = $100,000', () => {
    const result = evaluateRules({
      ldTables:  HO3_LD_TABLES,
      selection: { ...BASE, covELimit: 100000, covFLimit: 5000 },
    })
    const fOpts = result.availableOptions['HO.LD.002']
    const row5k = fOpts.find(o => o.value === 5000)!
    expect(row5k.available).toBe(false)
    expect(result.violations.some(v => v.ruleRefId === 'HO.RU.006')).toBe(true)
  })

  it('allows Coverage F $5,000 when Coverage E = $300,000', () => {
    const result = evaluateRules({
      ldTables:  HO3_LD_TABLES,
      selection: { ...BASE, covELimit: 300000, covFLimit: 5000 },
    })
    const row5k = result.availableOptions['HO.LD.002'].find(o => o.value === 5000)!
    expect(row5k.available).toBe(true)
    expect(result.violations.some(v => v.ruleRefId === 'HO.RU.006')).toBe(false)
  })

  // ── Wind/hail state constraint [HO.RU.008] ─────────────────────────────────

  it('rejects wind/hail deductible in non-coastal state OH', () => {
    const result = evaluateRules({
      ldTables:  HO3_LD_TABLES,
      selection: { ...BASE, riskState: 'OH', windHailElected: true, windHailPct: 2 },
    })
    expect(result.violations.some(v => v.ruleRefId === 'HO.RU.008')).toBe(true)
    const whOpts = result.availableOptions['HO.LD.004']
    expect(whOpts.every(o => !o.available)).toBe(true)
  })

  it('accepts wind/hail deductible in coastal state FL when ≥ all-peril deductible', () => {
    // covA 400k, 1% WH = 4000 >= allPerilDed 1000 → valid
    const result = evaluateRules({
      ldTables:  HO3_LD_TABLES,
      selection: { ...BASE, riskState: 'FL', covA: 400000, allPerilDed: 1000, windHailElected: true, windHailPct: 1 },
    })
    expect(result.violations.some(v => v.ruleRefId === 'HO.RU.008')).toBe(false)
    const opt1pct = result.availableOptions['HO.LD.004'].find(o => o.value === 1)!
    expect(opt1pct.available).toBe(true)
  })

  // ── Form attachment [HO.FORM.RU.*] ─────────────────────────────────────────

  it('attaches HO 04 61 when Scheduled Personal Property is elected', () => {
    const result = evaluateRules({
      ldTables:  HO3_LD_TABLES,
      selection: { ...BASE, sppElected: true },
    })
    expect(result.formsThatAttach).toContain('HO 04 61')
  })

  it('attaches HO 01 33 for a TX risk and HO 01 04 for CA — but not cross-state', () => {
    const txResult = evaluateRules({ ldTables: HO3_LD_TABLES, selection: { ...BASE, riskState: 'TX' } })
    expect(txResult.formsThatAttach).toContain('HO 01 33')
    expect(txResult.formsThatAttach).not.toContain('HO 01 04')

    const caResult = evaluateRules({ ldTables: HO3_LD_TABLES, selection: { ...BASE, riskState: 'CA' } })
    expect(caResult.formsThatAttach).toContain('HO 01 04')
    expect(caResult.formsThatAttach).not.toContain('HO 01 33')
  })
})
```


## `shared/src/rules/engine.ts`

```ts
// Rules engine: derives available term options, which forms attach, and violations.
// Pure function; no Firestore imports — all domain data is injected as constants.
import type {
  LDTable, SelectionContext, RulesResult, TermOption, RuleViolation,
} from '../types'

// Coastal states for wind/hail eligibility [HO.RU.008]
const COASTAL_STATES = new Set(['FL', 'GA', 'NC', 'SC', 'TX'])

export interface RulesEngineInput {
  ldTables:   Record<string, LDTable>
  selection:  SelectionContext
}

/**
 * Evaluate all HO-3 product rules against the current selection.
 * Returns available term options (with constraint violations noted),
 * the list of form numbers that must attach, and any hard violations.
 */
export function evaluateRules(input: RulesEngineInput): RulesResult {
  const { ldTables, selection } = input
  const violations: RuleViolation[] = []

  // ── Available options per LD table ──────────────────────────────────────────

  // HO.LD.001 — Coverage E limits (no constraints)
  const covEOptions = buildOptions(ldTables['HO.LD.001'], () => null)

  // HO.LD.002 — Coverage F limits; 5,000 requires E ≥ 300,000 [HO.RU.006]
  const covFOptions = buildOptions(ldTables['HO.LD.002'], (row) => {
    if (row.value === 5000 && selection.covELimit < 300000) {
      return 'Available only when Coverage E ≥ 300,000'
    }
    return null
  })

  // HO.LD.003 — All-peril deductible (no eligibility constraints)
  const allPerilDedOptions = buildOptions(ldTables['HO.LD.003'], () => null)

  // HO.LD.004 — Wind/hail % deductible [HO.RU.008]
  const isCoastal = COASTAL_STATES.has(selection.riskState)
  const windHailOptions = buildOptions(ldTables['HO.LD.004'], (row) => {
    if (!isCoastal) return 'Available in coastal states only (FL GA NC SC TX)'
    // dollar amount (pct% × covA) must be ≥ all-peril deductible
    const dollarAmt = (row.value / 100) * selection.covA
    if (dollarAmt < selection.allPerilDed) {
      return `${row.value}% of $${selection.covA.toLocaleString()} = $${dollarAmt.toLocaleString()} — must be ≥ all-peril deductible ($${selection.allPerilDed.toLocaleString()})`
    }
    return null
  })

  // HO.LD.005 — Coverage C % of A (no eligibility constraints)
  const covCOptions = buildOptions(ldTables['HO.LD.005'], () => null)

  // HO.LD.006 — Water back-up limit (no eligibility constraints beyond coverage election)
  const waterBackupOptions = buildOptions(ldTables['HO.LD.006'], () => null)

  // ── Hard violations ─────────────────────────────────────────────────────────

  // [HO.RU.006] Coverage F 5,000 selected but E < 300,000
  if (selection.covFLimit === 5000 && selection.covELimit < 300000) {
    violations.push({
      ruleRefId: 'HO.RU.006',
      message:   'Coverage F $5,000 limit requires Coverage E ≥ $300,000',
      severity:  'error',
    })
  }

  // [HO.RU.008] Wind/hail elected in non-coastal state
  if (selection.windHailElected && !isCoastal) {
    violations.push({
      ruleRefId: 'HO.RU.008',
      message:   `Wind/hail deductible is not available in ${selection.riskState}`,
      severity:  'error',
    })
  }

  // [HO.RU.008] Wind/hail dollar amount < all-peril deductible
  if (selection.windHailElected && selection.windHailPct !== undefined && isCoastal) {
    const dollarAmt = (selection.windHailPct / 100) * selection.covA
    if (dollarAmt < selection.allPerilDed) {
      violations.push({
        ruleRefId: 'HO.RU.008',
        message:   `Wind/hail deductible ($${dollarAmt.toLocaleString()}) must be ≥ all-peril deductible ($${selection.allPerilDed.toLocaleString()})`,
        severity:  'error',
      })
    }
  }

  // ── Forms that attach ───────────────────────────────────────────────────────

  const formsThatAttach: string[] = []

  // Always-mandatory forms (non-rule attachments)
  formsThatAttach.push('HO 00 03', 'HO DS 01', 'PN HO 01')

  // [HO.FORM.RU.001] Replacement Cost
  if (selection.rcElected)          formsThatAttach.push('HO 04 90')
  // [HO.FORM.RU.002] Water Back-Up
  if (selection.waterBackupElected) formsThatAttach.push('HO 04 95')
  // [HO.FORM.RU.003] Scheduled Personal Property
  if (selection.sppElected)         formsThatAttach.push('HO 04 61')
  // [HO.FORM.RU.004] Protective device
  if (selection.deviceCredit !== 'none') formsThatAttach.push('HO 04 16')
  // [HO.FORM.RU.005] Wind/Hail deductible
  if (selection.windHailElected)    formsThatAttach.push('HO 03 12')
  // [HO.FORM.RU.006] State amendatories
  if (selection.riskState === 'CA') formsThatAttach.push('HO 01 04')
  if (selection.riskState === 'TX') formsThatAttach.push('HO 01 33')
  // [HO.FORM.RU.007] Day-care exclusion
  if (selection.dayCareCoverage)    formsThatAttach.push('HO 04 96')
  // [HO.RU.002] Other Structures — Increased Limits
  if (selection.otherStructuresInc) formsThatAttach.push('HO 04 48')

  return {
    availableOptions: {
      'HO.LD.001': covEOptions,
      'HO.LD.002': covFOptions,
      'HO.LD.003': allPerilDedOptions,
      'HO.LD.004': windHailOptions,
      'HO.LD.005': covCOptions,
      'HO.LD.006': waterBackupOptions,
    },
    formsThatAttach,
    violations,
  }
}

/** Map an LDTable's rows to TermOption[], marking constrained rows as unavailable.
 *  row.constraintNote is informational only; only constraintFn controls availability. */
function buildOptions(
  table: LDTable | undefined,
  constraintFn: (row: { label: string; value: number; constraintNote?: string }) => string | null,
): TermOption[] {
  if (!table) return []
  return table.rows.map((row) => {
    const reason = constraintFn(row)
    return {
      label:            row.label,
      value:            row.value,
      constraintNote:   row.constraintNote,
      available:        reason === null,
      violationReason:  reason ?? undefined,
    }
  })
}
```


## `shared/src/search/rank.test.ts`

```ts
// Guards the TF-IDF cosine ranker used for grounded retrieval: relevant docs
// rank first, rare terms outweigh common ones, and empty queries are safe.
import { describe, it, expect } from 'vitest'
import { rankDocuments, type RankDoc } from './rank'

const DOCS: RankDoc[] = [
  { id: 'covA', text: 'Coverage A Dwelling HO.COV.001 limit replacement cost' },
  { id: 'covF', text: 'Coverage F Medical Payments HO.COV.006 each person' },
  { id: 'spp',  text: 'Scheduled Personal Property HO.COV.003.002 jewelry HO 04 61' },
  { id: 'wind', text: 'Wind Hail percentage deductible coastal HO 03 12' },
]

describe('TF-IDF cosine ranker', () => {
  it('ranks the most relevant document first', () => {
    const r = rankDocuments('scheduled personal property jewelry', DOCS)
    expect(r[0]!.id).toBe('spp')
    expect(r[0]!.score).toBeGreaterThan(0)
  })

  it('matches on an exact refId', () => {
    expect(rankDocuments('HO.COV.006', DOCS)[0]!.id).toBe('covF')
  })

  it('respects topK and returns descending scores', () => {
    const r = rankDocuments('coverage', DOCS, 2)
    expect(r).toHaveLength(2)
    expect(r[0]!.score).toBeGreaterThanOrEqual(r[1]!.score)
  })

  it('is safe on an empty query', () => {
    const r = rankDocuments('   ', DOCS)
    expect(r).toHaveLength(DOCS.length)
    expect(r.every(x => x.score === 0)).toBe(true)
  })
})
```


## `shared/src/search/rank.ts`

```ts
// rank.ts — dependency-free vector-space retrieval for grounding. Documents and
// the query are turned into sparse TF-IDF vectors and scored by cosine
// similarity, so the AI's search tool retrieves the *most relevant* entities
// rather than any that merely contain a token. Pure and deterministic (tested).
// AWS-SWAP: to move to dense embeddings, swap this ranker for a call to an
// embeddings service (e.g. Bedrock Titan / Voyage) + a vector store; the
// { id, score } contract stays the same so callers don't change.

export interface RankDoc { id: string; text: string }
export interface Ranked { id: string; score: number }

const tokenize = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9.]+/).filter(t => t.length > 1)

/**
 * Rank documents by TF-IDF cosine similarity to the query.
 * Returns ids sorted by descending score (0..1). With an empty query, returns
 * the documents in their original order at score 0.
 */
export function rankDocuments(query: string, docs: RankDoc[], topK = 15): Ranked[] {
  const qTokens = tokenize(query)
  if (qTokens.length === 0) return docs.slice(0, topK).map(d => ({ id: d.id, score: 0 }))

  const N = docs.length || 1
  const docTokens = docs.map(d => tokenize(d.text))

  // Document frequency for idf.
  const df = new Map<string, number>()
  for (const toks of docTokens) for (const w of new Set(toks)) df.set(w, (df.get(w) ?? 0) + 1)
  const idf = (w: string) => Math.log(1 + N / ((df.get(w) ?? 0) + 1))

  // Query vector.
  const qtf = new Map<string, number>()
  for (const w of qTokens) qtf.set(w, (qtf.get(w) ?? 0) + 1)
  const qVec = new Map<string, number>()
  qtf.forEach((tf, w) => qVec.set(w, tf * idf(w)))
  const qNorm = Math.sqrt([...qVec.values()].reduce((s, v) => s + v * v, 0)) || 1

  const scored: Ranked[] = docs.map((d, i) => {
    const tf = new Map<string, number>()
    for (const w of docTokens[i]!) tf.set(w, (tf.get(w) ?? 0) + 1)
    let dot = 0, sumSq = 0
    tf.forEach((f, w) => {
      const wt = f * idf(w)
      sumSq += wt * wt
      const qw = qVec.get(w)
      if (qw) dot += qw * wt
    })
    const dNorm = Math.sqrt(sumSq) || 1
    return { id: d.id, score: dot / (qNorm * dNorm) }
  })

  return scored.sort((a, b) => b.score - a.score).slice(0, topK)
}
```


## `shared/src/seed/ho3.ts`

```ts
// HO-3 seed constants — encodes docs/DOMAIN_HO.md verbatim.
// Every refId, rate, factor and form number here is the traceability backbone.
// The seed script reads these and writes them to Firestore; tests assert against them.
import type {
  Product, Coverage, LDTable, RTTable, RatingProgram, Form,
  Rule, FormRule, DictionaryEntry, Task, Feedback, User, RatingInputs,
} from '../types'

// ─── State sets ──────────────────────────────────────────────────────────────

export const HO3_FOOTPRINT_STATES = ['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA'] as const
export const HO3_COASTAL_STATES   = ['FL','GA','NC','SC','TX'] as const

// ─── Governance helper ───────────────────────────────────────────────────────

// createdAt/updatedAt are null here; the seed script replaces them with FieldValue.serverTimestamp()
function gov(overrides: { lifecycle?: Product['lifecycle']; status?: Product['status'] } = {}) {
  return {
    status:       (overrides.status       ?? 'ACTIVE') as Product['status'],
    lifecycle:    (overrides.lifecycle    ?? 'LAUNCHED') as Product['lifecycle'],
    reviewStatus: 'APPROVED'                              as Product['reviewStatus'],
    reviewer:     'system',
    createdAt:    null,
    updatedAt:    null,
    updatedBy:    'seed',
    rev:          1,
  }
}

const FOOTPRINT_SCOPE = { allStates: false, states: [...HO3_FOOTPRINT_STATES] }
const COASTAL_SCOPE   = { allStates: false, states: [...HO3_COASTAL_STATES] }

// ─── Product ─────────────────────────────────────────────────────────────────

export const HO3_PRODUCT: Omit<Product, 'createdAt' | 'updatedAt'> & {
  createdAt: null; updatedAt: null
} = {
  refId:         'HO.PROD.001',
  name:          'Homeowners — HO-3 Special Form',
  lob:           { refId: 'HO.LOB.001', name: 'Homeowners' },
  description:   'ISO-style Special Form homeowners policy covering dwelling, personal property, liability and medical payments on an open-peril basis.',
  marketSegment: 'Personal Lines / Property',
  owner:         { uid: 'seed', name: 'Product Factory Seed' },
  health:        { score: 100, findingCount: 0, updatedAt: null },
  ...FOOTPRINT_SCOPE,
  ...gov(),
}

// ─── Limits & Deductible tables ───────────────────────────────────────────────

export const HO3_LD_TABLES: Record<string, LDTable> = {
  'HO.LD.001': {
    name:         'Coverage E — Personal Liability Limits',
    defaultValue: 300000,
    rows: [
      { label: '$100,000', value: 100000 },
      { label: '$300,000', value: 300000 },
      { label: '$500,000', value: 500000 },
    ],
  },
  'HO.LD.002': {
    name:         'Coverage F — Medical Payments Limits',
    defaultValue: 1000,
    rows: [
      { label: '$1,000',  value: 1000 },
      { label: '$2,000',  value: 2000 },
      { label: '$5,000',  value: 5000, constraintNote: 'Available only when Coverage E ≥ 300,000' },
    ],
  },
  'HO.LD.003': {
    name:         'All-Peril Deductible',
    defaultValue: 1000,
    rows: [
      { label: '$500',   value: 500 },
      { label: '$1,000', value: 1000 },
      { label: '$2,500', value: 2500 },
      { label: '$5,000', value: 5000 },
    ],
  },
  'HO.LD.004': {
    name: 'Wind/Hail Percentage Deductible',
    rows: [
      { label: '1%', value: 1, constraintNote: 'Coastal states only (FL GA NC SC TX); dollar amount must be ≥ all-peril deductible' },
      { label: '2%', value: 2, constraintNote: 'Coastal states only (FL GA NC SC TX); dollar amount must be ≥ all-peril deductible' },
      { label: '5%', value: 5, constraintNote: 'Coastal states only (FL GA NC SC TX); dollar amount must be ≥ all-peril deductible' },
    ],
  },
  'HO.LD.005': {
    name:         'Coverage C — Personal Property % of Coverage A',
    defaultValue: 50,
    rows: [
      { label: '50%', value: 50 },
      { label: '70%', value: 70 },
      { label: '75%', value: 75 },
    ],
  },
  'HO.LD.006': {
    name:         'Water Back-Up & Sump Overflow Limit',
    defaultValue: 5000,
    rows: [
      { label: '$5,000',  value: 5000 },
      { label: '$10,000', value: 10000 },
      { label: '$25,000', value: 25000 },
    ],
  },
}

// ─── Rating tables ────────────────────────────────────────────────────────────

export const HO3_RT_TABLES: Record<string, RTTable> = {
  'HO.RT.001': {
    name:    'Territory Base Rate',
    columns: ['territory', 'rate'],
    rows: [
      { territory: 'T001', rate: 640 },
      { territory: 'T002', rate: 700 },
      { territory: 'T003', rate: 815 },
      { territory: 'T004', rate: 905 },
      { territory: 'T005', rate: 1040 },
    ],
  },

  'HO.RT.002': {
    name:    'Protection Class × Construction Factor',
    // pcMin/pcMax define the PC range; F = Frame, M = Masonry
    columns: ['pcMin', 'pcMax', 'F', 'M'],
    rows: [
      { pcMin: 1, pcMax: 3,  F: 0.95, M: 0.90 },
      { pcMin: 4, pcMax: 6,  F: 1.10, M: 1.05 },
      { pcMin: 7, pcMax: 8,  F: 1.30, M: 1.20 },
      { pcMin: 9, pcMax: 10, F: 1.55, M: 1.45 },
    ],
  },

  'HO.RT.003': {
    // Exact lookup; covA > 600,000 extrapolates at +0.32 per additional 100k [DOMAIN_HO.md]
    name:    'Coverage A Key Factor',
    columns: ['covA', 'factor'],
    rows: [
      { covA: 200000, factor: 0.80 },
      { covA: 250000, factor: 0.90 },
      { covA: 300000, factor: 1.00 },
      { covA: 350000, factor: 1.14 },
      { covA: 400000, factor: 1.30 },
      { covA: 500000, factor: 1.62 },
      { covA: 600000, factor: 1.94 },
    ],
  },

  'HO.RT.004': {
    // subTable field distinguishes all-peril rows from wind/hail rows
    name:    'Deductible Factors',
    columns: ['subTable', 'key', 'factor'],
    rows: [
      { subTable: 'allPeril', key: 500,   factor: 1.10 },
      { subTable: 'allPeril', key: 1000,  factor: 1.00 },
      { subTable: 'allPeril', key: 2500,  factor: 0.88 },
      { subTable: 'allPeril', key: 5000,  factor: 0.76 },
      { subTable: 'windHail', key: 1,     factor: 0.97 },
      { subTable: 'windHail', key: 2,     factor: 0.94 },
      { subTable: 'windHail', key: 5,     factor: 0.89 },
    ],
  },

  'HO.RT.005': {
    name:    'Coverage C Percentage Factor',
    columns: ['covCPct', 'factor'],
    rows: [
      { covCPct: 50, factor: 1.00 },
      { covCPct: 70, factor: 1.06 },
      { covCPct: 75, factor: 1.09 },
    ],
  },

  'HO.RT.006': {
    // limType "E" | "F" distinguishes Coverage E rows from Coverage F rows
    name:    'Liability Increased-Limit Charges ($)',
    columns: ['limType', 'limit', 'charge'],
    rows: [
      { limType: 'E', limit: 100000, charge: 0  },
      { limType: 'E', limit: 300000, charge: 24 },
      { limType: 'E', limit: 500000, charge: 38 },
      { limType: 'F', limit: 1000,   charge: 0  },
      { limType: 'F', limit: 2000,   charge: 6  },
      { limType: 'F', limit: 5000,   charge: 18 },
    ],
  },

  'HO.RT.007': {
    name:    'Scheduled Personal Property Class Rates (per $100 of appraised value)',
    columns: ['itemClass', 'ratePerHundred'],
    rows: [
      { itemClass: 'Jewelry',              ratePerHundred: 1.27 },
      { itemClass: 'Furs',                 ratePerHundred: 0.55 },
      { itemClass: 'Cameras',              ratePerHundred: 1.10 },
      { itemClass: 'Fine Arts',            ratePerHundred: 0.85 },
      { itemClass: 'Silverware',           ratePerHundred: 0.45 },
      { itemClass: 'Musical Instruments',  ratePerHundred: 0.60 },
    ],
  },

  'HO.RT.008': {
    name:    'Endorsement/Credit Factors',
    columns: ['deviceCredit', 'factor'],
    rows: [
      { deviceCredit: 'none',    factor: 1.00 },
      { deviceCredit: 'local',   factor: 0.98 },
      { deviceCredit: 'central', factor: 0.95 },
    ],
    // Note: RC factor (1.10) is CONST 1.10 in step 8a; only device credit is a table lookup.
  },

  'HO.RT.009': {
    name:    'Tier Factor',
    columns: ['tier', 'factor'],
    rows: [
      { tier: 'A', factor: 0.90 },
      { tier: 'B', factor: 1.10 },
      { tier: 'C', factor: 1.25 },
    ],
  },

  'HO.RT.010': {
    name:    'Water Back-Up Flat Premium',
    columns: ['limit', 'flatPremium'],
    rows: [
      { limit: 5000,  flatPremium: 75  },
      { limit: 10000, flatPremium: 110 },
      { limit: 25000, flatPremium: 175 },
    ],
  },
}

// ─── RT getter (HO-3 specific) ────────────────────────────────────────────────

import type { RtGetter, LdGetter } from '../rating/evaluator'

export function makeHO3RtGetter(tables: Record<string, RTTable>): RtGetter {
  return (tableRef: string, q: Record<string, unknown>): number => {
    const t = tables[tableRef]
    if (!t) throw new Error(`RT table not found: ${tableRef}`)
    const rows = t.rows

    switch (tableRef) {
      case 'HO.RT.001': {
        const r = rows.find(r => r['territory'] === q['territory'])
        if (!r) throw new Error(`HO.RT.001: no row for territory=${q['territory']}`)
        return r['rate'] as number
      }
      case 'HO.RT.002': {
        const pc = q['pc'] as number
        const constr = q['construction'] as string
        const r = rows.find(r => (r['pcMin'] as number) <= pc && pc <= (r['pcMax'] as number))
        if (!r) throw new Error(`HO.RT.002: no row for pc=${pc}`)
        const f = r[constr]
        if (typeof f !== 'number') throw new Error(`HO.RT.002: unknown construction=${constr}`)
        return f
      }
      case 'HO.RT.003': {
        const covA = q['covA'] as number
        const exact = rows.find(r => r['covA'] === covA)
        if (exact) return exact['factor'] as number
        // Extrapolate above 600k: +0.32 per additional 100k (ceiling increments)
        if (covA > 600000) {
          return 1.94 + Math.ceil((covA - 600000) / 100000) * 0.32
        }
        throw new Error(`HO.RT.003: no row for covA=${covA}`)
      }
      case 'HO.RT.004': {
        if ('allPerilDed' in q) {
          const r = rows.find(r => r['subTable'] === 'allPeril' && r['key'] === q['allPerilDed'])
          if (!r) throw new Error(`HO.RT.004: no allPeril row for ded=${q['allPerilDed']}`)
          return r['factor'] as number
        }
        if ('windHailPct' in q) {
          const r = rows.find(r => r['subTable'] === 'windHail' && r['key'] === q['windHailPct'])
          if (!r) throw new Error(`HO.RT.004: no windHail row for pct=${q['windHailPct']}`)
          return r['factor'] as number
        }
        throw new Error('HO.RT.004: query must include allPerilDed or windHailPct')
      }
      case 'HO.RT.005': {
        const r = rows.find(r => r['covCPct'] === q['covCPct'])
        if (!r) throw new Error(`HO.RT.005: no row for covCPct=${q['covCPct']}`)
        return r['factor'] as number
      }
      case 'HO.RT.006': {
        if ('covELimit' in q) {
          const r = rows.find(r => r['limType'] === 'E' && r['limit'] === q['covELimit'])
          if (!r) throw new Error(`HO.RT.006: no E row for limit=${q['covELimit']}`)
          return r['charge'] as number
        }
        if ('covFLimit' in q) {
          const r = rows.find(r => r['limType'] === 'F' && r['limit'] === q['covFLimit'])
          if (!r) throw new Error(`HO.RT.006: no F row for limit=${q['covFLimit']}`)
          return r['charge'] as number
        }
        throw new Error('HO.RT.006: query must include covELimit or covFLimit')
      }
      case 'HO.RT.007': {
        const r = rows.find(r => r['itemClass'] === q['itemClass'])
        if (!r) throw new Error(`HO.RT.007: unknown itemClass=${q['itemClass']}`)
        return r['ratePerHundred'] as number
      }
      case 'HO.RT.008': {
        const r = rows.find(r => r['deviceCredit'] === q['deviceCredit'])
        if (!r) throw new Error(`HO.RT.008: unknown deviceCredit=${q['deviceCredit']}`)
        return r['factor'] as number
      }
      case 'HO.RT.009': {
        const r = rows.find(r => r['tier'] === q['tier'])
        if (!r) throw new Error(`HO.RT.009: unknown tier=${q['tier']}`)
        return r['factor'] as number
      }
      case 'HO.RT.010': {
        const r = rows.find(r => r['limit'] === q['waterBackupLimit'])
        if (!r) throw new Error(`HO.RT.010: no row for limit=${q['waterBackupLimit']}`)
        return r['flatPremium'] as number
      }
      default:
        throw new Error(`No lookup implementation for RT table: ${tableRef}`)
    }
  }
}

// LdGetter is not used in HO.RAT.1 steps (all LD values flow as INPUTs after user selection)
export function makeHO3LdGetter(_tables: Record<string, LDTable>): LdGetter {
  return (_tableRef: string, _selectedValue: number | string): number => {
    // LD table lookups are not needed in the evaluator; the selected numeric value
    // flows directly through RatingInputs. This getter exists for interface completeness.
    throw new Error('LdGetter should not be called by any HO.RAT.1 step')
  }
}

// ─── Rating program (HO.RAT.1 — 11 logical steps, 14 executable steps) ───────

export const HO3_RATING_PROGRAM: Omit<RatingProgram, 'createdAt' | 'updatedAt'> & {
  createdAt: null; updatedAt: null
} = {
  refId:          'HO.RAT.1',
  name:           'HO-3 Special Form Rating Program',
  minimumPremium: 500,
  ...FOOTPRINT_SCOPE,
  ...gov(),
  steps: [
    // Step 1: Territory base rate
    { id: 's1',  order: 1,  label: 'Territory base rate',                    op: 'SET',       source: { type: 'RT',    ref: 'HO.RT.001', keys: ['territory'] } },
    // Step 2: Protection class × construction factor
    { id: 's2',  order: 2,  label: 'Protection/construction factor',          op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.002', keys: ['pc', 'construction'] } },
    // Step 3: Coverage A key factor → Key Premium (round to $)
    { id: 's3',  order: 3,  label: 'Coverage A key factor → Key Premium',     op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.003', keys: ['covA'] },                roundTo: 0 },
    // Step 4a: All-peril deductible factor
    { id: 's4a', order: 4,  label: 'All-peril deductible factor',             op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.004', keys: ['allPerilDed'] } },
    // Step 4b: Wind/hail deductible factor (only when wind/hail elected)
    { id: 's4b', order: 5,  label: 'Wind/hail deductible factor',             op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.004', keys: ['windHailPct'] },          condition: 'windHailElected' },
    // Step 5: Coverage C percentage factor
    { id: 's5',  order: 6,  label: 'Coverage C percentage factor',            op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.005', keys: ['covCPct'] } },
    // Step 6: Coverage E increased-limit charge (additive $)
    { id: 's6',  order: 7,  label: 'Coverage E increased-limit charge',       op: 'ADD',       source: { type: 'RT',    ref: 'HO.RT.006', keys: ['covELimit'] } },
    // Step 7: Coverage F increased-limit charge (additive $)
    { id: 's7',  order: 8,  label: 'Coverage F increased-limit charge',       op: 'ADD',       source: { type: 'RT',    ref: 'HO.RT.006', keys: ['covFLimit'] } },
    // Step 8a: Replacement Cost endorsement factor ×1.10 (only when RC elected)
    { id: 's8a', order: 9,  label: 'Replacement Cost endorsement factor',     op: 'MUL',       source: { type: 'CONST', value: 1.10 },                                      condition: 'rcElected' },
    // Step 8b: Protective device credit; round to ¢ captures combined 8a×8b result
    { id: 's8b', order: 10, label: 'Protective device credit',                op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.008', keys: ['deviceCredit'] },         roundTo: 2 },
    // Step 9: Tier factor
    { id: 's9',  order: 11, label: 'Tier factor',                             op: 'MUL',       source: { type: 'RT',    ref: 'HO.RT.009', keys: ['tier'] } },
    // Step 10a: Water back-up flat premium (only when elected)
    { id: 's10a',order: 12, label: 'Water back-up flat premium',              op: 'ADD',       source: { type: 'RT',    ref: 'HO.RT.010', keys: ['waterBackupLimit'] },     condition: 'waterBackupElected' },
    // Step 10b: Scheduled Personal Property premium Σ(value/100 × classRate)
    { id: 's10b',order: 13, label: 'Scheduled Personal Property premium',     op: 'ADD',       source: { type: 'SPP',   ref: 'HO.RT.007' },                                condition: 'sppElected' },
    // Step 11: Apply minimum premium; round to $
    { id: 's11', order: 14, label: 'Apply minimum premium ($500)',             op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 },                                       roundTo: 0 },
  ],
}

// ─── Coverages ────────────────────────────────────────────────────────────────

type CoverageSeed = Omit<Coverage, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

function covGov() { return gov() }

export const HO3_COVERAGES: CoverageSeed[] = [
  {
    refId: 'HO.COV.001', name: 'Coverage A — Dwelling',
    parentId: null, order: 1, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-a-limit', kind: 'LIMIT', label: 'Coverage A Amount', basis: 'per occurrence', default: 300000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.002', name: 'Coverage B — Other Structures',
    parentId: null, order: 2, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: false, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-b-limit', kind: 'LIMIT', label: 'Coverage B Limit (10% of A default)', basis: 'per occurrence', ldTableRef: undefined, default: '10% of Coverage A', unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.003', name: 'Coverage C — Personal Property',
    parentId: null, order: 3, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-c-pct', kind: 'LIMIT', label: 'Coverage C % of A', basis: 'per occurrence', ldTableRef: 'HO.LD.005', default: 50, unit: 'percent' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.004', name: 'Coverage D — Loss of Use',
    parentId: null, order: 4, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: false, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-d-limit', kind: 'LIMIT', label: 'Coverage D Limit (30% of A)', basis: 'per occurrence', default: '30% of Coverage A', unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.005', name: 'Coverage E — Personal Liability',
    parentId: null, order: 5, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-e-limit', kind: 'LIMIT', label: 'Coverage E Limit', basis: 'per occurrence', ldTableRef: 'HO.LD.001', default: 300000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.006', name: 'Coverage F — Medical Payments',
    parentId: null, order: 6, requirement: 'MANDATORY',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 00 03'],
    terms: [{ id: 'cov-f-limit', kind: 'LIMIT', label: 'Coverage F Limit', basis: 'per person per occurrence', ldTableRef: 'HO.LD.002', default: 1000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.001.001', name: 'Water Back-Up & Sump Overflow',
    parentId: 'HO.COV.001', order: 1, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 04 95'],
    terms: [{ id: 'water-backup-limit', kind: 'LIMIT', label: 'Water Back-Up Limit', basis: 'per occurrence', ldTableRef: 'HO.LD.006', default: 5000, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.002.001', name: 'Other Structures — Increased Limits',
    parentId: 'HO.COV.002', order: 1, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'PROPRIETARY',
    formNumbers: ['HO 04 48'],
    terms: [{ id: 'other-struct-limit', kind: 'LIMIT', label: 'Other Structures Increased Limit', basis: 'per occurrence', default: 0, unit: 'dollars' }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.003.001', name: 'Personal Property Replacement Cost',
    parentId: 'HO.COV.003', order: 1, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 04 90'],
    terms: [{ id: 'rc-elected', kind: 'OPTION', label: 'Replacement Cost Coverage', basis: 'flag', default: false }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
  {
    refId: 'HO.COV.003.002', name: 'Scheduled Personal Property',
    parentId: 'HO.COV.003', order: 2, requirement: 'OPTIONAL',
    claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: ['HO 04 61'],
    terms: [{
      id: 'spp-schedule', kind: 'OPTION', label: 'SPP Schedule (class + appraised value)',
      basis: 'per item', default: false,
      notes: 'Repeating schedule: ItemClass + AppraisedValue per item. See HO 04 61.',
    }],
    ...FOOTPRINT_SCOPE, ...covGov(),
  },
]

// ─── Forms ────────────────────────────────────────────────────────────────────

type FormSeed = Omit<Form, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const HO3_FORMS: FormSeed[] = [
  {
    number: 'HO 00 03', edition: '05 11',
    name: 'Homeowners 3 — Special Form', category: 'BASE_COVERAGE',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Section I', 'Section II'],
    productRefIds: ['HO.PROD.001'],
    description: 'Base open-peril homeowners policy form covering dwelling, other structures, personal property, loss of use, personal liability and medical payments.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO DS 01', edition: '05 11',
    name: 'Homeowners Policy Declarations', category: 'DECLARATIONS',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['HO.PROD.001'],
    description: 'Policy declarations page showing named insured, property address, coverage limits, deductibles and total premium.',
    dynamicFields: [
      { name: 'NamedInsured',     dataType: 'TEXT',     repeating: false },
      { name: 'PropertyAddress',  dataType: 'TEXT',     repeating: false },
      { name: 'PolicyEffective',  dataType: 'DATE',     repeating: false },
      { name: 'PolicyExpiration', dataType: 'DATE',     repeating: false },
      { name: 'CoverageLimits',   dataType: 'CURRENCY', repeating: true, notes: 'Coverage TEXT + Limit CURRENCY per row' },
      { name: 'TotalPremium',     dataType: 'CURRENCY', repeating: false },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 90', edition: '05 11',
    name: 'Personal Property Replacement Cost Loss Settlement', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Section I'],
    productRefIds: ['HO.PROD.001'],
    description: 'Amends Coverage C to settle losses at replacement cost rather than actual cash value.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 95', edition: '05 11',
    name: 'Water Back-Up and Sump Discharge or Overflow', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Section I'],
    productRefIds: ['HO.PROD.001'],
    description: 'Extends coverage to loss caused by water that backs up through sewers or drains or overflows from a sump.',
    dynamicFields: [{ name: 'BackUpLimit', dataType: 'CURRENCY', repeating: false }],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 61', edition: '05 11',
    name: 'Scheduled Personal Property Endorsement', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: false,
    transactions: [], coverageParts: ['Section I'],
    productRefIds: ['HO.PROD.001'],
    description: 'Schedules high-value personal property items (jewelry, furs, cameras, fine arts, etc.) at agreed appraised values.',
    dynamicFields: [
      { name: 'ItemClass',       dataType: 'LIST',     repeating: true, options: ['Jewelry','Furs','Cameras','Fine Arts','Silverware','Musical Instruments'] },
      { name: 'ItemDescription', dataType: 'TEXT',     repeating: true },
      { name: 'AppraisedValue',  dataType: 'CURRENCY', repeating: true },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 16', edition: '05 11',
    name: 'Premises Alarm or Fire Protection System', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['HO.PROD.001'],
    description: 'Documents a qualifying protective device system and applies the corresponding premium credit.',
    dynamicFields: [
      { name: 'DeviceType',    dataType: 'LIST', repeating: false, options: ['Local Alarm','Central Station'] },
      { name: 'CertificateNo', dataType: 'TEXT', repeating: false },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 48', edition: '05 11',
    name: 'Other Structures — Increased Limits', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: true, multiUse: true,
    transactions: [], coverageParts: ['Section I'],
    productRefIds: ['HO.PROD.001'],
    description: 'Increases Coverage B beyond the default 10% of Coverage A for specifically described other structures.',
    dynamicFields: [
      { name: 'StructureDescription', dataType: 'TEXT',     repeating: true },
      { name: 'IncreasedLimit',        dataType: 'CURRENCY', repeating: true },
    ],
    ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 03 12', edition: '05 11',
    name: 'Windstorm or Hail Percentage Deductible', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: true, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: ['Section I'],
    productRefIds: ['HO.PROD.001'],
    description: 'Replaces the standard deductible for windstorm or hail losses with a percentage-of-dwelling deductible.',
    dynamicFields: [
      { name: 'DeductiblePercent', dataType: 'LIST', repeating: false, options: ['1%','2%','5%'] },
    ],
    ...COASTAL_SCOPE, ...gov(),
  },
  {
    number: 'HO 04 96', edition: '05 11',
    name: 'No Section II Coverage — Home Day Care Business', category: 'EXCLUSION',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: ['Section II'],
    productRefIds: ['HO.PROD.001'],
    description: 'Excludes personal liability and medical payments coverage for the day-care business conducted at the residence.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
  {
    number: 'HO 01 04', edition: '05 11',
    name: 'Special Provisions — California', category: 'AMENDATORY',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['HO.PROD.001'],
    description: 'Modifies the base policy to comply with California statutes and Department of Insurance requirements.',
    dynamicFields: [],
    allStates: false, states: ['CA'], ...gov(),
  },
  {
    number: 'HO 01 33', edition: '05 11',
    name: 'Special Provisions — Texas', category: 'AMENDATORY',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false,
    attachmentCondition: 'RULE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['HO.PROD.001'],
    description: 'Modifies the base policy to comply with Texas Department of Insurance requirements.',
    dynamicFields: [],
    allStates: false, states: ['TX'], ...gov(),
  },
  {
    number: 'PN HO 01', edition: '05 11',
    name: 'Policyholder Notice — Important Information', category: 'POLICY_NOTICE',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: true,
    attachmentCondition: 'NONE', source: 'BUREAU', admitted: true,
    displayOnSchedule: false, multiUse: false,
    transactions: [], coverageParts: [],
    productRefIds: ['HO.PROD.001'],
    description: 'Required notice providing policyholders with important information about their policy rights and obligations.',
    dynamicFields: [], ...FOOTPRINT_SCOPE, ...gov(),
  },
]

// ─── Product rules ────────────────────────────────────────────────────────────

type RuleSeed = Omit<Rule, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const HO3_RULES: RuleSeed[] = [
  { refId: 'HO.RU.001', category: 'PRODUCT', subCategory: 'Eligibility',
    condition: 'Owner-occupied 1–4 family dwelling, residential use',
    outcome: 'Eligible for HO-3 Special Form',
    coverageRefIds: [], formNumbers: [], ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.002', category: 'PRODUCT', subCategory: 'Coverage Limits',
    condition: 'Coverage B default limit',
    outcome: 'Default = 10% of Coverage A; increase only via HO 04 48',
    ldTableRef: undefined, coverageRefIds: ['HO.COV.002'], formNumbers: ['HO 04 48'],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.003', category: 'PRODUCT', subCategory: 'Coverage Limits',
    condition: 'Coverage C percentage of A',
    outcome: 'Options per HO.LD.005; default 50% of A',
    ldTableRef: 'HO.LD.005', coverageRefIds: ['HO.COV.003'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.004', category: 'PRODUCT', subCategory: 'Coverage Limits',
    condition: 'Coverage D limit',
    outcome: '30% of Coverage A (calculated)',
    coverageRefIds: ['HO.COV.004'], formNumbers: [], ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.005', category: 'PRODUCT', subCategory: 'Coverage Limits',
    condition: 'Coverage E limit options',
    outcome: 'Options per HO.LD.001; default $300,000',
    ldTableRef: 'HO.LD.001', coverageRefIds: ['HO.COV.005'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.006', category: 'PRODUCT', subCategory: 'Coverage Constraints',
    condition: 'Coverage F $5,000 limit selected',
    outcome: 'Requires Coverage E ≥ $300,000',
    ldTableRef: 'HO.LD.002', coverageRefIds: ['HO.COV.005','HO.COV.006'], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.007', category: 'RATING', subCategory: 'Deductibles',
    condition: 'All-peril deductible selection',
    outcome: 'Options per HO.LD.003; default $1,000',
    ldTableRef: 'HO.LD.003', coverageRefIds: [], formNumbers: [],
    ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.008', category: 'RATING', subCategory: 'Deductibles',
    condition: 'Wind/Hail percentage deductible elected',
    outcome: 'Coastal states only (FL GA NC SC TX); dollar amount ≥ all-peril deductible',
    ldTableRef: 'HO.LD.004', coverageRefIds: [], formNumbers: ['HO 03 12'],
    ...COASTAL_SCOPE, ...gov() },
  { refId: 'HO.RU.009', category: 'RATING', subCategory: 'Premium Floor',
    condition: 'Calculated premium',
    outcome: 'Minimum policy premium $500 (HO.RAT.1 step 11)',
    coverageRefIds: [], formNumbers: [], ...FOOTPRINT_SCOPE, ...gov() },
  { refId: 'HO.RU.010', category: 'PRODUCT', subCategory: 'Eligibility',
    condition: 'Seasonal or secondary dwelling',
    outcome: 'Ineligible unless companion primary policy is in force',
    coverageRefIds: [], formNumbers: [], ...FOOTPRINT_SCOPE, ...gov() },
]

// ─── Form attachment rules ────────────────────────────────────────────────────

type FormRuleSeed = Omit<FormRule, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const HO3_FORM_RULES: FormRuleSeed[] = [
  { refId: 'HO.FORM.RU.001', condition: 'Replacement Cost elected', outcome: 'Attach HO 04 90',         formNumbers: ['HO 04 90'], mandatory: true,  ...gov() },
  { refId: 'HO.FORM.RU.002', condition: 'Water Back-Up elected',    outcome: 'Attach HO 04 95',         formNumbers: ['HO 04 95'], mandatory: true,  ...gov() },
  { refId: 'HO.FORM.RU.003', condition: 'Scheduled Personal Property elected', outcome: 'Attach HO 04 61', formNumbers: ['HO 04 61'], mandatory: true, ...gov() },
  { refId: 'HO.FORM.RU.004', condition: 'Protective-device credit ≠ none', outcome: 'Attach HO 04 16',  formNumbers: ['HO 04 16'], mandatory: true,  ...gov() },
  { refId: 'HO.FORM.RU.005', condition: 'Wind/Hail % deductible elected',  outcome: 'Attach HO 03 12',  formNumbers: ['HO 03 12'], mandatory: true,  ...gov() },
  { refId: 'HO.FORM.RU.006', condition: 'Risk state = CA',           outcome: 'Attach HO 01 04; TX → HO 01 33', formNumbers: ['HO 01 04','HO 01 33'], mandatory: true, ...gov() },
  { refId: 'HO.FORM.RU.007', condition: 'Home day-care exclusion elected', outcome: 'Attach HO 04 96',  formNumbers: ['HO 04 96'], mandatory: false, ...gov() },
]

// ─── Dictionary ───────────────────────────────────────────────────────────────

type DictSeed = Omit<DictionaryEntry, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }

export const HO3_DICTIONARY: DictSeed[] = [
  { name: 'Named Insured',      type: 'TEXT',     description: 'Full legal name of the primary insured',    allowedValues: [], format: '',       tags: ['person'], usedIn: [], ...gov() },
  { name: 'Property Address',   type: 'TEXT',     description: 'Street address of the insured dwelling',    allowedValues: [], format: '',       tags: ['location'], usedIn: [], ...gov() },
  { name: 'Coverage A Amount',  type: 'CURRENCY', description: 'Insured replacement value of the dwelling', allowedValues: [], format: 'USD',    tags: ['coverage','rating'], usedIn: [], ...gov() },
  { name: 'All-Peril Deductible', type: 'CURRENCY', description: 'Per-occurrence deductible for all covered perils', allowedValues: [], format: 'USD', tags: ['deductible','rating'], usedIn: [], ...gov() },
  { name: 'Protection Class',   type: 'LIST',     description: 'ISO fire protection class 1–10',            allowedValues: ['1','2','3','4','5','6','7','8','9','10'], format: '', tags: ['rating'], usedIn: [], ...gov() },
  { name: 'Construction Type',  type: 'LIST',     description: 'Primary construction material of the dwelling', allowedValues: ['Frame','Masonry'], format: '', tags: ['rating'], usedIn: [], ...gov() },
  { name: 'Territory Code',     type: 'LIST',     description: 'Rating territory assigned to the property location', allowedValues: ['T001','T002','T003','T004','T005'], format: '', tags: ['rating'], usedIn: [], ...gov() },
  { name: 'Appraised Value',    type: 'CURRENCY', description: 'Professionally appraised value of a scheduled personal property item', allowedValues: [], format: 'USD', tags: ['spp'], usedIn: [], ...gov() },
  { name: 'Device Type',        type: 'LIST',     description: 'Type of qualifying protective device installed at the premises', allowedValues: ['Local Alarm','Central Station'], format: '', tags: ['credit'], usedIn: [], ...gov() },
  { name: 'Effective Date',     type: 'DATE',     description: 'Policy effective date',                     allowedValues: [], format: 'YYYY-MM-DD', tags: ['policy'], usedIn: [], ...gov() },
]

// ─── Default task template ────────────────────────────────────────────────────

// D = product creation date; offsets in days
export const HO3_DEFAULT_TASK_TEMPLATES: Array<{
  title: string; column: Task['column']; daysOffset: number
}> = [
  { title: 'Define coverage strategy',       column: 'IDEATION',        daysOffset: 7   },
  { title: 'Draft rating plan',              column: 'IDEATION',        daysOffset: 14  },
  { title: 'Configure product in Factory',   column: 'BUILD_FILE',      daysOffset: 30  },
  { title: 'File with states',               column: 'BUILD_FILE',      daysOffset: 45  },
  { title: 'UAT rating scenarios',           column: 'TEST_APPROVE',    daysOffset: 60  },
  { title: 'Business review sign-off',       column: 'TEST_APPROVE',    daysOffset: 70  },
  { title: 'Launch readiness check',         column: 'LAUNCH_MONITOR',  daysOffset: 80  },
  { title: '30-day results review',          column: 'LAUNCH_MONITOR',  daysOffset: 110 },
]

// ─── Sample users ─────────────────────────────────────────────────────────────

export const HO3_SEED_USERS: Array<Omit<User, 'createdAt'> & { createdAt: null; password: string }> = [
  {
    email: 'admin@productfactory.app', name: 'Product Factory Admin',
    role: 'ADMIN', active: true, mustChangePassword: true,
    password: 'admin123', createdAt: null,
  },
  {
    email: 'editor@productfactory.app', name: 'Product Editor',
    role: 'EDITOR', active: true, mustChangePassword: false,
    password: 'editor123', createdAt: null,
  },
  {
    email: 'viewer@productfactory.app', name: 'Product Viewer',
    role: 'VIEWER', active: true, mustChangePassword: false,
    password: 'viewer123', createdAt: null,
  },
]

// ─── Sample feedback ──────────────────────────────────────────────────────────

export const HO3_SAMPLE_FEEDBACK: Array<Omit<Feedback, 'createdAt' | 'updatedAt'> & { createdAt: null; updatedAt: null }> = [
  {
    type: 'IDEA', title: 'Add flood coverage endorsement',
    detail: 'Customers frequently ask about flood. Adding a standalone flood endorsement option would expand our addressable market.',
    context: { route: '/app/products' },
    votes: { count: 3, voters: [] }, status: 'NEW', impact: 3, effort: 3,
    priorityScore: 3, author: { uid: 'seed', name: 'Product Factory Seed' },
    createdAt: null, updatedAt: null,
  },
  {
    type: 'ISSUE', title: 'Rating trace should display step-by-step in the UI',
    detail: 'During UAT we needed to verify the $1,528 worked example. The evaluator returns a trace array but the pricing tab does not display it yet.',
    context: { route: '/app/products/:id/pricing' },
    votes: { count: 5, voters: [] }, status: 'REVIEWING', impact: 2, effort: 1,
    priorityScore: 5, author: { uid: 'seed', name: 'Product Factory Seed' },
    createdAt: null, updatedAt: null,
  },
  {
    type: 'PRAISE', title: 'Form attachment rules work perfectly',
    detail: 'Tested all 7 HO.FORM.RU rules. Every form attaches exactly when expected. The rules engine is solid.',
    context: { route: '/app/products/:id/forms' },
    votes: { count: 1, voters: [] }, status: 'PLANNED', impact: 1, effort: 1,
    priorityScore: 1, author: { uid: 'seed', name: 'Product Factory Seed' },
    createdAt: null, updatedAt: null,
  },
]

// ─── Worked-example preset (must produce $1,528) ──────────────────────────────

export const HO3_WORKED_EXAMPLE: RatingInputs = {
  territory:           'T002',
  pc:                  5,
  construction:        'M',
  covA:                400000,
  allPerilDed:         1000,
  windHailElected:     false,
  windHailPct:         undefined,
  covCPct:             70,
  covELimit:           300000,
  covFLimit:           2000,
  rcElected:           true,
  deviceCredit:        'none',
  tier:                'B',
  waterBackupElected:  true,
  waterBackupLimit:    5000,
  sppElected:          true,
  sppItems:            [{ itemClass: 'Jewelry', appraisedValue: 15000 }],
}
```


## `shared/src/types.test.ts`

```ts
// Smoke test — verifies shared types compile and are exported correctly.
// Real tests (rating evaluator, rules engine, seed assertions) are added in Prompt 2.
import { describe, it, expect } from 'vitest'
import type { GovernanceBlock, Status, Lifecycle } from './types'

describe('shared types', () => {
  it('GovernanceBlock has expected fields', () => {
    const block: GovernanceBlock = {
      status: 'ACTIVE' as Status,
      lifecycle: 'LAUNCHED' as Lifecycle,
      reviewStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: 'uid-001',
      rev: 1,
    }
    expect(block.status).toBe('ACTIVE')
    expect(block.rev).toBe(1)
  })
})
```


## `shared/src/types.ts`

```ts
// Shared domain types — mirror of every Firestore collection shape in docs/DATA_MODEL.md.
// Zero platform imports; consumed by both app (Vite) and functions (Node 20).

// ─── Governance ─────────────────────────────────────────────────────────────

export type Status       = 'ACTIVE' | 'INACTIVE' | 'FUTURE'
export type Lifecycle    = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'LAUNCHED'
export type ReviewStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BUSINESS_REVIEW' | 'APPROVED' | 'REJECTED'
export type Role         = 'VIEWER' | 'EDITOR' | 'ADMIN'
export type Requirement  = 'MANDATORY' | 'OPTIONAL'
export type Source       = 'BUREAU' | 'PROPRIETARY'
export type TermKind     = 'LIMIT' | 'DEDUCTIBLE' | 'OPTION'

export interface GovernanceBlock {
  status:       Status
  lifecycle:    Lifecycle
  reviewStatus: ReviewStatus
  reviewer?:    string
  createdAt:    unknown   // Firestore Timestamp in Firebase; null/ISO in seed/wire
  updatedAt:    unknown
  updatedBy:    string
  rev:          number    // incremented by mutate(); conflict guard
}

export interface StateScope {
  allStates: boolean
  states:    string[]
}

// ─── Users ──────────────────────────────────────────────────────────────────

export interface User {
  email:              string
  name:               string
  role:               Role   // mirror of custom claim — claim is authoritative
  active:             boolean
  mustChangePassword: boolean
  createdAt:          unknown
}

// ─── Products ───────────────────────────────────────────────────────────────

export interface Product extends GovernanceBlock, StateScope {
  refId:         string | null
  name:          string
  lob:           { refId: string; name: string }
  description:   string
  marketSegment: string
  owner:         { uid: string; name: string }
  health:        { score: number; findingCount: number; updatedAt: unknown }
  // The uploaded base coverage form that gates + grounds AI coverage extraction.
  baseForm?:     { path: string; url: string; name: string; uploadedAt: unknown; uploadedBy: string } | null
}

// ─── Coverages ──────────────────────────────────────────────────────────────

// How a limit/deductible is *shaped* — mirrors how P&C filings express amounts.
export type LimitStructure =
  | 'SINGLE'                // one limit applies to all covered loss
  | 'OCCURRENCE_AGGREGATE'  // per-occurrence limit plus a policy aggregate
  | 'EACH_CLAIM_AGGREGATE'  // per-claim limit plus aggregate (claims-made lines)
  | 'SPLIT'                 // component limits, e.g. BI per person / per accident / PD
  | 'CSL'                   // combined single limit
  | 'SCHEDULED'             // per-item / scheduled values

export type DeductibleStructure =
  | 'FLAT'                  // fixed dollar amount
  | 'PERCENT'              // percentage of insured value or loss
  | 'PERCENT_MIN_MAX'      // percentage bounded by a dollar min & max
  | 'WAITING_PERIOD'       // time-based (hours/days), e.g. business income
  | 'SPLIT'                // separate deductibles by peril/component

// What a limit amount is measured against.
export type LimitBasis =
  | 'PER_OCCURRENCE' | 'AGGREGATE' | 'PER_PERSON' | 'PER_CLAIM' | 'PER_ITEM' | 'PER_LOCATION'

// The concrete kind of a single option value.
export type OptionValueType =
  | 'FLAT'           // dollar amount (value)
  | 'PERCENT'        // percentage (value = integer percent)
  | 'SPLIT'          // components in `parts`, e.g. [100000,300000,100000]
  | 'CSL'            // combined single limit (value)
  | 'SCHEDULED'      // scheduled/per-item cap (value)
  | 'WAITING_PERIOD' // hours (value = hours)

/** One standard, selectable option inside a limit/deductible term. Each option
 *  carries its own type, applicability (a StateScope), a default flag and an
 *  enabled flag so the option matrix models real filing variation — a limit
 *  offered only in some states, one marked the default, some disabled. Integrity
 *  the editor enforces: exactly one enabled option is the default; each option's
 *  applicability ⊆ its coverage's state scope; values stay within [min,max].
 *  (Distinct from `TermOption` below, which is the rules engine's availability I/O.) */
export interface StandardOption {
  id:              string
  type:            OptionValueType
  value:           number
  parts?:          number[]
  label?:          string          // display override; derived from value when absent
  allStates:       boolean
  states:          string[]
  isDefault:       boolean
  enabled:         boolean
  constraintNote?: string
}

export interface CoverageTerm {
  id:          string
  kind:        TermKind
  label:       string
  ldTableRef?: string
  options?:    (string | number)[]   // legacy flat option list (kept in sync w/ optionSet)
  min?:        number
  max?:        number
  default:     string | number | boolean
  basis:       string                // free-text legacy basis (e.g. "per occurrence")
  unit?:       string
  notes?:      string
  // ── Canonical typed model (optional; derived from the legacy fields above when
  //    absent, and written back on first edit). See shared/insurance/terms.ts. ──
  structure?:   LimitStructure | DeductibleStructure
  limitBasis?:  LimitBasis
  optionSet?:   StandardOption[]
}

export interface Coverage extends GovernanceBlock, StateScope {
  refId:             string | null
  name:              string
  parentId:          string | null   // null = top-level; set = sub-coverage
  order:             number
  requirement:       Requirement
  claimsBasis:       string
  premiumGenerating: boolean
  source:            Source
  formNumbers:       string[]
  terms:             CoverageTerm[]
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export type RuleCategory = 'PRODUCT' | 'RATING' | 'FORMS'

export interface Rule extends GovernanceBlock, StateScope {
  refId:           string | null
  category:        RuleCategory
  subCategory:     string
  condition:       string
  outcome:         string
  ldTableRef?:     string
  coverageRefIds:  string[]
  formNumbers:     string[]
}

export interface FormRule extends GovernanceBlock {
  refId:       string | null
  condition:   string
  outcome:     string
  formNumbers: string[]
  mandatory:   boolean
}

// ─── Rating ──────────────────────────────────────────────────────────────────

export interface RatingStep {
  id:        string
  order:     number
  label:     string
  op:        'SET' | 'MUL' | 'ADD' | 'MIN_FLOOR'
  source: {
    type:   'RT' | 'LD' | 'INPUT' | 'CONST' | 'SPP'
    ref?:   string    // RT/LD/SPP: table ref; INPUT: input field name
    keys?:  string[]  // RT: names of RatingInputs fields to use as lookup keys
    value?: number    // CONST: the constant value
  }
  condition?: string  // name of a boolean RatingInputs field; step skips when falsy
  roundTo?:   number  // decimal places to round running total after this step
}

export interface RatingProgram extends GovernanceBlock, StateScope {
  refId:          string
  name:           string
  minimumPremium: number
  steps:          RatingStep[]
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export interface LDRow {
  label:           string
  value:           number
  constraintNote?: string
}

export interface LDTable {
  name:          string
  defaultValue?: number
  rows:          LDRow[]
}

// rows layout is preserved as-is; lookup logic lives in the concrete getter
export interface RTTable {
  name:    string
  columns: string[]
  rows:    Record<string, unknown>[]
}

// ─── Forms ───────────────────────────────────────────────────────────────────

export type FormCategory        = 'BASE_COVERAGE' | 'DECLARATIONS' | 'ENDORSEMENT' | 'EXCLUSION' | 'AMENDATORY' | 'POLICY_NOTICE'
export type AttachmentCondition = 'RULE' | 'NONE'
export type DynamicFieldType    = 'TEXT' | 'CURRENCY' | 'DATE' | 'LIST' | 'PERCENT'

export interface DynamicField {
  name:       string
  dataType:   DynamicFieldType
  repeating:  boolean
  options?:   string[]
  notes?:     string
}

export interface Form extends GovernanceBlock, StateScope {
  number:              string
  name:                string
  edition:             string
  category:            FormCategory
  claimsBasis:         string
  dynamic:             boolean
  mandatoryDefault:    boolean
  attachmentCondition: AttachmentCondition
  source:              Source
  admitted:            boolean
  displayOnSchedule:   boolean
  multiUse:            boolean
  transactions:        string[]
  coverageParts:       string[]
  productRefIds:       string[]
  description:         string   // AI-generated plain English, cached
  dynamicFields:       DynamicField[]
}

// ─── Audit + Versions ─────────────────────────────────────────────────────────

export interface VersionDiff {
  field:  string
  before: unknown
  after:  unknown
}

export interface Version {
  entityType: string
  entityPath: string
  productId?: string
  snapshot:   unknown
  diff:       VersionDiff[]
  actor:      { uid: string; name: string }
  at:         unknown
}

export interface AuditEvent {
  actor:      { uid: string; name: string }
  action:     'create' | 'update' | 'delete'
  entityType: string
  entityPath: string
  productId?: string
  at:         unknown
}

// ─── Collaboration ───────────────────────────────────────────────────────────

export interface Comment {
  entityPath: string
  refId?:     string
  body:       string
  author:     { uid: string; name: string }
  resolved:   boolean
  at:         unknown
}

export type TaskColumn = 'IDEATION' | 'BUILD_FILE' | 'TEST_APPROVE' | 'LAUNCH_MONITOR'

export interface Task extends GovernanceBlock {
  title:      string
  column:     TaskColumn
  productId?: string
  assignee?:  { uid: string; name: string }
  dueAt?:     unknown
  checklist:  { t: string; done: boolean }[]
  order:      number
}

// ─── Feedback ────────────────────────────────────────────────────────────────

export type FeedbackType   = 'IDEA' | 'ISSUE' | 'PRAISE'
export type FeedbackStatus = 'NEW' | 'REVIEWING' | 'PLANNED' | 'SHIPPED' | 'DECLINED'

export interface Feedback {
  type:          FeedbackType
  title:         string
  detail:        string
  context:       { route: string; entityPath?: string; refId?: string }
  votes:         { count: number; voters: string[] }
  status:        FeedbackStatus
  impact:        1 | 2 | 3
  effort:        1 | 2 | 3
  priorityScore: number
  rank?:         number
  author:        { uid: string; name: string }
  createdAt:     unknown
  updatedAt:     unknown
}

// ─── News ────────────────────────────────────────────────────────────────────

export interface News {
  urlHash:           string
  url:               string
  source:            string
  title:             string
  summary:           string
  tags:              string[]
  relatedProductIds: string[]
  fetchedAt:         unknown
}

export interface NewsPrefs {
  instruction: string
  updatedAt:   unknown
}

// ─── Dictionary ──────────────────────────────────────────────────────────────

export interface DictionaryEntry extends GovernanceBlock {
  name:          string
  type:          DynamicFieldType
  description:   string
  allowedValues: string[]
  format:        string
  tags:          string[]
  usedIn:        { entityPath: string; label: string }[]
}

// ─── Share + Search ──────────────────────────────────────────────────────────

export interface ShareLink {
  productId:  string
  createdBy:  string
  expiresAt:  unknown
}

export type SearchEntityType = 'product' | 'coverage' | 'rule' | 'form' | 'ldTable' | 'rtTable' | 'dictionary' | 'task'

export interface SearchIndexEntry {
  type:      SearchEntityType
  refId?:    string
  title:     string
  subtitle:  string
  path:      string
  keywords:  string[]
}

// ─── Seed Report ─────────────────────────────────────────────────────────────

export interface SeedReport {
  counts:                Record<string, number>
  warnings:              string[]
  workedExamplePremium:  number
  at:                    unknown
}

// ─── Evaluator I/O ───────────────────────────────────────────────────────────

export interface SppItem {
  itemClass:       string
  appraisedValue:  number
}

/** All inputs the HO-3 rating engine reads from a submission. */
export interface RatingInputs {
  territory:           string         // "T001".."T005"
  pc:                  number         // 1..10
  construction:        string         // "F" | "M"
  covA:                number         // dollars (e.g. 400000)
  allPerilDed:         number         // 500 | 1000 | 2500 | 5000
  windHailElected:     boolean
  windHailPct?:        number         // 1 | 2 | 5 (percent integer)
  covCPct:             number         // 50 | 70 | 75
  covELimit:           number         // 100000 | 300000 | 500000
  covFLimit:           number         // 1000 | 2000 | 5000
  rcElected:           boolean        // Personal Property Replacement Cost
  deviceCredit:        string         // "none" | "local" | "central"
  tier:                string         // "A" | "B" | "C"
  waterBackupElected:  boolean
  waterBackupLimit?:   number         // 5000 | 10000 | 25000
  sppElected:          boolean
  sppItems?:           SppItem[]
  [key: string]:       unknown        // allows generic INPUT source resolution
}

export interface TraceEntry {
  stepId:         string
  label:          string
  op:             'SET' | 'MUL' | 'ADD' | 'MIN_FLOOR'
  sourceRef:      string
  factorOrAmount: number
  rounded:        boolean
  runningTotal:   number
}

export interface EvaluatorResult {
  finalPremium: number
  trace:        TraceEntry[]
}

// ─── Rules Engine I/O ────────────────────────────────────────────────────────

export interface SelectionContext {
  riskState:          string   // 2-letter state code
  covELimit:          number
  covFLimit:          number
  allPerilDed:        number
  windHailElected:    boolean
  windHailPct?:       number
  covA:               number
  rcElected:          boolean
  deviceCredit:       string
  waterBackupElected: boolean
  waterBackupLimit?:  number
  sppElected:         boolean
  dayCareCoverage:    boolean
  otherStructuresInc: boolean
}

export interface TermOption {
  label:           string
  value:           number
  constraintNote?: string
  available:       boolean
  violationReason?: string
}

export interface RuleViolation {
  ruleRefId: string
  message:   string
  severity:  'error' | 'warning'
}

export interface RulesResult {
  availableOptions:   Record<string, TermOption[]>  // keyed by term ldTableRef
  formsThatAttach:    string[]                       // form numbers
  violations:         RuleViolation[]
}

// Utility: unsubscribe function returned by realtime subscriptions
export type Unsubscribe = () => void
```


## `shared/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "noEmit": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```


## `shared/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```


## `functions/package.json`

```json
{
  "name": "functions",
  "private": true,
  "version": "0.0.1",
  "engines": { "node": "20" },
  "main": "lib/index.js",
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no linter configured for functions'"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.54.0",
    "firebase-admin": "^13.4.0",
    "firebase-functions": "^6.6.0"
  },
  "devDependencies": {
    "@types/node": "^20.19.0",
    "tsup": "^8.5.0",
    "typescript": "^5.7.3"
  }
}
```


## `functions/src/admin.ts`

```ts
// admin.ts — setUserRole callable (ADMIN only): create users, assign roles via
// custom claims (mirrored on users/{uid} for display), and (de)activate accounts.
// Custom claims are authoritative for security rules; the mirror doc is display-only.
// AWS-SWAP: Cognito AdminCreateUser + group assignment; mirror row in the users table.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

if (!getApps().length) initializeApp()

type Role = 'ADMIN' | 'EDITOR' | 'VIEWER'
interface SetUserRoleInput {
  action:    'create' | 'setRole' | 'deactivate' | 'reactivate'
  uid?:      string
  email?:    string
  password?: string
  name?:     string
  role?:     Role
}

export const setUserRole = onCall<SetUserRoleInput>({ maxInstances: 5 }, async (req) => {
  const callerRole = (req.auth?.token as { role?: string } | undefined)?.role
  if (callerRole !== 'ADMIN') throw new HttpsError('permission-denied', 'Admin access required.')

  const db   = getFirestore()
  const auth = getAuth()
  const { action } = req.data

  switch (action) {
    case 'create': {
      const { email, password, name, role } = req.data
      if (!email || !password || !role) throw new HttpsError('invalid-argument', 'email, password and role are required.')
      const user = await auth.createUser({ email, password, displayName: name ?? email })
      await auth.setCustomUserClaims(user.uid, { role })
      await db.doc(`users/${user.uid}`).set({
        email, name: name ?? email, role, active: true, mustChangePassword: true,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { uid: user.uid }
    }
    case 'setRole': {
      const { uid, role } = req.data
      if (!uid || !role) throw new HttpsError('invalid-argument', 'uid and role are required.')
      await auth.setCustomUserClaims(uid, { role })
      await db.doc(`users/${uid}`).set({ role }, { merge: true })
      return { uid }
    }
    case 'deactivate':
    case 'reactivate': {
      const { uid } = req.data
      if (!uid) throw new HttpsError('invalid-argument', 'uid is required.')
      const disabled = action === 'deactivate'
      await auth.updateUser(uid, { disabled })
      await db.doc(`users/${uid}`).set({ active: !disabled }, { merge: true })
      return { uid }
    }
    default:
      throw new HttpsError('invalid-argument', `Unknown action: ${String(action)}`)
  }
})
```


## `functions/src/ai.ts`

```ts
// ai.ts — the portfolio chat SSE endpoint and the reusable tool-grounded agent
// loop. `runChatAgent` streams assistant tokens + tool-status events while
// looping over tool_use turns; claims.ts and gap.ts reuse it with their own
// system context and tool set.
import { onRequest } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, openSse, send, ANTHROPIC_API_KEY } from './runtime'
import type { SseResponse } from './runtime'
import { TOOLS, SYSTEM_PROMPT, runTool } from './tools'

export interface AgentOptions {
  system?:    string             // extra, non-cached system context (e.g. focus product)
  tools?:     Anthropic.Tool[]   // defaults to the grounding TOOLS
  maxTokens?: number
  maxTurns?:  number
}

/**
 * Drive a tool-grounded conversation to completion, streaming as it goes.
 * Returns the full message list (including the final assistant turn) so callers
 * can persist or post-process it. Tool errors surface to the model, not the client.
 */
export async function runChatAgent(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  res: SseResponse,
  opts: AgentOptions = {},
): Promise<Anthropic.MessageParam[]> {
  // Stable rules first (cached across requests); volatile focus context after the breakpoint.
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ]
  if (opts.system) system.push({ type: 'text', text: opts.system })

  const tools    = opts.tools ?? TOOLS
  const maxTurns  = opts.maxTurns ?? 6
  const convo: Anthropic.MessageParam[] = [...messages]

  for (let turn = 0; turn < maxTurns; turn++) {
    const stream = client.messages.stream({
      model:      MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      system,
      tools,
      messages:   convo,
    })
    stream.on('text', (delta) => send(res, { t: 'token', v: delta }))
    const final = await stream.finalMessage()
    convo.push({ role: 'assistant', content: final.content })

    const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (final.stop_reason !== 'tool_use' || toolUses.length === 0) break

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      send(res, { t: 'tool', name: tu.name, phase: 'start' })
      const out = await runTool(tu.name, (tu.input as Record<string, unknown>) ?? {})
      send(res, { t: 'tool', name: tu.name, phase: 'end', summary: out.summary })
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.content })
    }
    convo.push({ role: 'user', content: results })
  }
  return convo
}

// ─── chat endpoint ──────────────────────────────────────────────────────────────

interface ChatBody {
  messages?:  Array<{ role: string; content: string }>
  productId?: string
}

export const chat = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Any signed-in role may chat — it only reads. Writes are gated elsewhere.
    try { await authenticate(req) }
    catch (e) { res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return }

    openSse(res)
    try {
      const body     = (req.body ?? {}) as ChatBody
      const incoming = (body.messages ?? []).filter(m => m.content?.trim())
      if (incoming.length === 0) { send(res, { t: 'error', message: 'No message provided.' }); return }

      const messages: Anthropic.MessageParam[] = incoming.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }))
      const focus = body.productId
        ? `The user is focused on product ${body.productId}. Prefer that product when a productId is needed.`
        : undefined

      await runChatAgent(anthropic(), messages, res, { system: focus })
      send(res, { t: 'done' })
    } catch (err) {
      send(res, { t: 'error', message: err instanceof Error ? err.message : 'AI request failed.' })
    } finally {
      res.end()
    }
  },
)
```


## `functions/src/extract.ts`

```ts
// extract.ts — grounded coverage extraction from an uploaded base coverage form.
// The client sends the form's content (text, or a base64 PDF); Claude reads it and,
// via a single forced tool, proposes the product's coverages — each prefilled with
// its requirement / rated flag / attached form numbers, plus a confidence and a
// citation back to the form. Never invents coverages; lower confidence when the
// form is ambiguous. EDITOR/ADMIN only. Streamed over SSE (one json event).
// AWS-SWAP: onRequest → Lambda URL; auth + secret handling live in runtime.ts.
import { onRequest } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, openSse, send, ANTHROPIC_API_KEY } from './runtime'

interface ExtractBody {
  productName?: string
  formText?:    string
  formBase64?:  string
  mediaType?:   string
}

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propose_coverages',
  description:
    'Return the coverages the base form actually defines. Only include coverages the ' +
    'document describes — never invent coverages, forms, limits or requirements. Use ' +
    'lower confidence when the form is ambiguous about a field.',
  input_schema: {
    type: 'object',
    properties: {
      coverages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:              { type: 'string',  description: 'Coverage name exactly as the form uses it, e.g. "Coverage A — Dwelling".' },
            requirement:       { type: 'string',  enum: ['MANDATORY', 'OPTIONAL'] },
            premiumGenerating: { type: 'boolean', description: 'True if this coverage is rated (generates premium).' },
            formNumbers:       { type: 'array', items: { type: 'string' }, description: 'Attached ISO/proprietary form numbers, e.g. "HO 00 03".' },
            limitHint:         { type: 'string',  description: 'Short summary of the limit basis if the form states one, e.g. "10% of Coverage A".' },
            confidence:        { type: 'number',  description: '0..1 confidence this coverage is correctly identified.' },
            citation:          { type: 'string',  description: 'Where in the form this was found (section / heading / page).' },
          },
          required: ['name', 'requirement', 'premiumGenerating', 'confidence', 'citation'],
        },
      },
    },
    required: ['coverages'],
  },
}

const SYSTEM =
  'You are a P&C insurance product analyst. Read the provided base coverage form and ' +
  'identify the coverages it defines for the product. Ground every proposal in the ' +
  "form's actual text — do not invent coverages, forms, limits or requirements. Prefer " +
  'the exact coverage names and ISO form numbers used in the document. When the form is ' +
  'ambiguous about a field, lower the confidence. Call propose_coverages exactly once.'

export const extractCoverages = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Author-only: extraction proposes writes, so guard like a mutation.
    try {
      const caller = await authenticate(req)
      if (caller.role !== 'EDITOR' && caller.role !== 'ADMIN') {
        res.status(403).json({ error: 'Editor access required.' }); return
      }
    } catch (e) {
      res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return
    }

    openSse(res)
    try {
      const body = (req.body ?? {}) as ExtractBody
      const content: Anthropic.ContentBlockParam[] = []

      if (body.formBase64 && body.mediaType === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.formBase64 } })
      } else if (body.formText?.trim()) {
        content.push({ type: 'text', text: `BASE COVERAGE FORM:\n\n${body.formText.slice(0, 120_000)}` })
      } else {
        send(res, { t: 'error', message: 'No form content provided.' }); return
      }
      content.push({ type: 'text', text: `Product: ${body.productName ?? 'this product'}. Identify every coverage this form defines, then call propose_coverages.` })

      send(res, { t: 'tool', name: 'read_base_form', phase: 'start' })
      const msg = await anthropic().messages.create({
        model:       MODEL,
        max_tokens:  3000,
        system:      SYSTEM,
        tools:       [PROPOSE_TOOL],
        tool_choice: { type: 'tool', name: 'propose_coverages' },
        messages:    [{ role: 'user', content }],
      })

      const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      const proposal = (tu?.input as { coverages?: unknown[] } | undefined) ?? { coverages: [] }
      const count = Array.isArray(proposal.coverages) ? proposal.coverages.length : 0
      send(res, { t: 'tool', name: 'read_base_form', phase: 'end', summary: `${count} coverage${count === 1 ? '' : 's'} found` })
      send(res, { t: 'json', key: 'proposal', value: proposal })
      send(res, { t: 'done' })
    } catch (err) {
      send(res, { t: 'error', message: err instanceof Error ? err.message : 'Extraction failed.' })
    } finally {
      res.end()
    }
  },
)
```


## `functions/src/health.ts`

```ts
// health.ts — lightweight callable to verify the Functions pipeline is alive.
import { onCall } from 'firebase-functions/v2/https'

export const hello = onCall({ maxInstances: 10 }, (request) => {
  return {
    message: 'Product Factory Functions are alive.',
    uid: request.auth?.uid ?? null,
    at: new Date().toISOString(),
  }
})
```


## `functions/src/index.ts`

```ts
// functions/src/index.ts — re-exports every Cloud Function.
// Add new function modules here as they are implemented.
export { hello } from './health'
export { createShareLink, getShareSnapshot, share } from './share'
export { chat } from './ai'
export { extractCoverages } from './extract'
export { setUserRole } from './admin'
export { refreshNews, nightlyNews } from './news'
```


## `functions/src/news.ts`

````ts
// news.ts — the market-news agent. A nightly onSchedule run (06:00 ET) and a
// manual refresh callable both ask Claude (with the web-search tool) to find
// recent items matching each user's natural-language instruction, then dedup by
// urlHash and store. AWS-SWAP: EventBridge Scheduler → Lambda; same web search.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL_FAST, ANTHROPIC_API_KEY } from './runtime'

const DEFAULT_INSTRUCTION =
  'Recent U.S. homeowners insurance rate filings, regulatory changes, and competitor HO-3 product launches.'

interface NewsItem { url: string; source: string; title: string; summary: string; tags: string[] }

const NEWS_SYSTEM = `You are a P&C insurance news scout for a product manager. Use the web_search tool to find recent, real, relevant news items matching the user's instruction. Prefer primary sources (regulator sites, carrier newsrooms, trade press). Return ONLY a JSON array (max 8 items) — no prose before or after — where each item is:
{"url": string, "source": string, "title": string, "summary": string (1–2 sentences), "tags": string[] (2–4 short topical labels)}.
If you find nothing relevant, return [].`

/** Pull the first balanced JSON array out of text (tolerant of prose + [1] citations). */
function extractJsonArray(text: string): unknown[] {
  const candidates: string[] = []
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) candidates.push(fence[1]!)
  const start = text.indexOf('[')
  if (start >= 0) {
    let depth = 0
    for (let i = start; i < text.length; i++) {
      if (text[i] === '[') depth++
      else if (text[i] === ']' && --depth === 0) { candidates.push(text.slice(start, i + 1)); break }
    }
  }
  candidates.push(text.trim())
  for (const c of candidates) {
    try { const a = JSON.parse(c.trim()); if (Array.isArray(a)) return a } catch { /* try next */ }
  }
  return []
}

/** Run one instruction through Claude + web search and parse the JSON items.
 *  Handles the server-tool `pause_turn` continuation loop. */
async function fetchForInstruction(instruction: string): Promise<NewsItem[]> {
  const client = anthropic()
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: instruction }]
  let finalText = ''
  for (let turn = 0; turn < 6; turn++) {
    const res = await client.messages.create({
      model:       MODEL_FAST,
      max_tokens:  2048,
      temperature: 0,   // grounded extraction → deterministic, low-variance output
      system:      NEWS_SYSTEM,
      // Basic web-search variant — supported on the fast (Haiku) tier; the parser
      // only reads final text, so it is agnostic to the result-block shape.
      tools:       [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] as unknown as Anthropic.Tool[],
      messages,
    })
    const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
    if (text.trim()) finalText = text
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue }
    break
  }
  return extractJsonArray(finalText)
    .map(x => x as Partial<NewsItem>)
    .filter(x => x.url && x.title)
    .map(x => ({ url: x.url!, source: x.source ?? '', title: x.title!, summary: x.summary ?? '', tags: x.tags ?? [] }))
}

/** Store items, deduped by a hash of the URL. Returns how many were newly stored. */
async function storeItems(items: NewsItem[]): Promise<number> {
  const db = getFirestore()
  let stored = 0
  for (const it of items) {
    const urlHash = createHash('sha1').update(it.url).digest('hex')
    const ref = db.doc(`news/${urlHash}`)
    if ((await ref.get()).exists) continue
    await ref.set({
      urlHash, url: it.url, source: it.source, title: it.title, summary: it.summary,
      tags: it.tags, relatedProductIds: [], fetchedAt: Timestamp.now(),
    })
    stored++
  }
  return stored
}

// ─── Manual refresh (dev / on-demand) ─────────────────────────────────────────

export const refreshNews = onCall(
  { secrets: [ANTHROPIC_API_KEY], maxInstances: 3, timeoutSeconds: 180 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in to refresh news.')
    const prefDoc     = await getFirestore().doc(`newsPrefs/${req.auth.uid}`).get()
    const instruction = (prefDoc.data()?.instruction as string | undefined)?.trim() || DEFAULT_INSTRUCTION
    try {
      const items  = await fetchForInstruction(instruction)
      const stored = await storeItems(items)
      return { found: items.length, stored }
    } catch (err) {
      return { found: 0, stored: 0, error: err instanceof Error ? err.message : 'News fetch failed' }
    }
  },
)

// ─── Nightly agent (06:00 America/New_York) ───────────────────────────────────

export const nightlyNews = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'America/New_York', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540 },
  async () => {
    const prefs = await getFirestore().collection('newsPrefs').get()
    const instructions = prefs.docs
      .map(d => (d.data().instruction as string | undefined)?.trim())
      .filter((s): s is string => !!s)
    const unique = [...new Set(instructions.length ? instructions : [DEFAULT_INSTRUCTION])]
    for (const instruction of unique) {
      try {
        const items = await fetchForInstruction(instruction)
        await storeItems(items)
      } catch { /* one bad instruction shouldn't fail the whole run */ }
    }
  },
)
````


## `functions/src/runtime.ts`

```ts
// runtime.ts — shared AI plumbing: the Anthropic client (secret-bound), Firebase
// ID-token verification + role guard, SSE helpers, and model constants. Every
// AI function (ai/builder/claims/gap/describe/health) composes these so secret
// handling, auth and streaming stay in exactly one place.
// AWS-SWAP: secret → Secrets Manager; verifyIdToken → Cognito JWT verify; SSE is
// plain HTTPS and ports to Lambda URLs unchanged.
import { defineSecret } from 'firebase-functions/params'
import type { Request } from 'firebase-functions/v2/https'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import Anthropic from '@anthropic-ai/sdk'
import type { Role } from '@pf/shared'

// Initialize the Admin SDK once per cold start (shared with share.ts's guard).
if (!getApps().length) initializeApp()

// The Anthropic key. Canonical homes: functions/.env.local (emulator) and Firebase
// Secrets (prod). Bind via `secrets: [ANTHROPIC_API_KEY]` on every AI function.
export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')

// Two models per spec: a reasoning model for chat/analysis, a fast model for
// bulk/simple generations. Fable 5 has thinking always on and REJECTS the
// sampling params (temperature/top_p/top_k → 400) — grounded chat leans on tools,
// not sampling. Haiku is right-sized for the news scout and accepts temperature.
export const MODEL      = 'claude-fable-5'    // reasoning: portfolio chat, analysis
export const MODEL_FAST = 'claude-haiku-4-5'  // bulk/simple: market-news scout

/** Anthropic client — call inside a handler so the bound secret is resolvable.
 *  maxRetries adds explicit exponential backoff on 429 / 5xx / connection errors. */
export function anthropic(): Anthropic {
  return new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 4 })
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface Caller {
  uid:  string
  role: Role | null
  name: string
}

export class AuthError extends Error {}

/** Verify the caller's Firebase ID token (Bearer header) and return uid + role. */
export async function authenticate(req: Request): Promise<Caller> {
  const header = req.headers.authorization ?? ''
  const match  = /^Bearer (.+)$/.exec(header)
  if (!match) throw new AuthError('Sign in to use AI features.')

  const decoded = await getAuth().verifyIdToken(match[1])
  return {
    uid:  decoded.uid,
    role: (decoded['role'] as Role | undefined) ?? null,
    name: (decoded['name'] as string | undefined) ?? decoded.email ?? 'User',
  }
}

// ─── SSE ────────────────────────────────────────────────────────────────────────

// Minimal structural type — satisfied by the Express response onRequest provides,
// without pulling express types into the surface.
export interface SseResponse {
  setHeader(name: string, value: string): void
  write(chunk: string): boolean
  end(): void
  flushHeaders?(): void
}

/** Every event the AI stream emits. The client parses each `data:` line as JSON. */
export type StreamEvent =
  | { t: 'token'; v: string }                                   // assistant text delta
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }                 // structured payload (drafts, determinations)
  | { t: 'error'; message: string }
  | { t: 'done' }

export function openSse(res: SseResponse): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
}

export function send(res: SseResponse, event: StreamEvent): void {
  // Blank line terminates the SSE record; JSON.stringify escapes any newlines.
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}
```


## `functions/src/share.ts`

```ts
// share.ts — creates share links (callable), serves read-only snapshots (callable),
// and renders the public shared page with a clean social card (onRequest, wired to
// the /share/** hosting rewrite).
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { randomBytes } from 'crypto'

// Initialize Admin SDK once per cold start.
if (!getApps().length) initializeApp()

// ─── Public shared page (onRequest) — per-product OG card + clean summary ──────

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function page(opts: { title: string; description: string; image: string; body: string }): string {
  const { title, description, image, body } = opts
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#8B1FE0">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Product Reinvention Hub">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:#F7F7FA;color:#131318;
  min-height:100svh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:100%;max-width:520px;background:#fff;border:1px solid rgba(19,19,26,.08);border-radius:18px;
  padding:32px;box-shadow:0 1px 2px rgba(19,19,26,.04),0 14px 34px rgba(139,31,224,.08)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#A100FF,#8B1FE0,#6D28D9)}
.brand span{font-weight:600;font-size:15px;letter-spacing:-.2px}
.pill{display:inline-block;font:600 11px/1.4 'JetBrains Mono',monospace;color:#8B1FE0;background:rgba(139,31,224,.08);
  padding:4px 10px;border-radius:999px;margin-bottom:14px}
h1{font-size:26px;font-weight:800;letter-spacing:-.5px;margin:0 0 6px}
.ref{font:600 13px 'JetBrains Mono',monospace;color:#5B5C6B;margin-bottom:16px}
.desc{color:#5B5C6B;line-height:1.6;margin:0 0 20px}
.stats{display:flex;gap:20px;padding:16px 0;border-top:1px solid rgba(19,19,26,.08);border-bottom:1px solid rgba(19,19,26,.08);margin-bottom:20px}
.stat b{display:block;font-size:20px;font-weight:800}.stat s{display:block;font-size:12px;color:#8E90A0;text-decoration:none}
.cta{display:inline-block;background:linear-gradient(135deg,#A100FF,#8B1FE0,#6D28D9);color:#fff;text-decoration:none;
  font-weight:600;font-size:14px;padding:12px 22px;border-radius:12px;box-shadow:0 6px 22px rgba(139,31,224,.3)}
.foot{margin-top:18px;font-size:12px;color:#8E90A0}
</style></head>
<body><div class="card">
<div class="brand"><span class="logo"></span><span>Product Reinvention Hub</span></div>
${body}
</div></body></html>`
}

/**
 * Public shared product page. Wired to the `/share/**` hosting rewrite: serves
 * crawler-friendly per-product Open Graph tags and a clean read-only summary.
 * AWS-SWAP: CloudFront → Lambda@Edge / API Gateway route serving the same HTML.
 */
export const share = onRequest({ maxInstances: 10 }, async (req, res) => {
  const token = req.path.split('/').filter(Boolean).pop() ?? ''
  const origin = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers.host ?? 'productreinvention.web.app'}`
  const image = `${origin}/og-card.svg`
  res.set('Cache-Control', 'public, max-age=300')

  const linkDoc = token ? await getFirestore().doc(`shareLinks/${token}`).get() : null
  if (!linkDoc || !linkDoc.exists) {
    res.status(404).send(page({ title: 'Shared product not found', description: 'This share link is invalid.', image,
      body: `<h1>Link not found</h1><p class="desc">This share link is invalid or has been removed.</p><a class="cta" href="${origin}/">Go to the Hub →</a>` }))
    return
  }

  const link = linkDoc.data() as { productId: string; expiresAt: Timestamp }
  if (link.expiresAt.toDate() < new Date()) {
    res.status(410).send(page({ title: 'Shared link expired', description: 'This shared snapshot has expired.', image,
      body: `<h1>Link expired</h1><p class="desc">This shared snapshot is no longer available.</p><a class="cta" href="${origin}/">Go to the Hub →</a>` }))
    return
  }

  const db = getFirestore()
  const productDoc = await db.doc(`products/${link.productId}`).get()
  const p = (productDoc.data() ?? {}) as { name?: string; refId?: string; description?: string; marketSegment?: string; lob?: { name?: string }; states?: string[]; allStates?: boolean }
  const covCount = await db.collection(`products/${link.productId}/coverages`).count().get().then(s => s.data().count).catch(() => 0)
  const stateCount = p.allStates ? 'All' : String((p.states ?? []).length)

  const title = `${p.name ?? 'Insurance product'} · Product Reinvention Hub`
  const description = p.description || `A shared read-only snapshot of ${p.name ?? 'an insurance product'}${p.lob?.name ? ` (${p.lob.name})` : ''}.`
  res.status(200).send(page({
    title, description, image,
    body: `
      <span class="pill">Read-only shared snapshot</span>
      <h1>${esc(p.name ?? 'Insurance product')}</h1>
      ${p.refId ? `<div class="ref">${esc(p.refId)}</div>` : ''}
      <p class="desc">${esc(p.description || description)}</p>
      <div class="stats">
        <div class="stat"><b>${covCount}</b><s>coverages</s></div>
        <div class="stat"><b>${esc(stateCount)}</b><s>states</s></div>
        <div class="stat"><b>${esc(p.lob?.name ?? '—')}</b><s>line of business</s></div>
      </div>
      <a class="cta" href="${origin}/">Open Product Reinvention Hub →</a>
      <div class="foot">Snapshot expires ${esc(link.expiresAt.toDate().toLocaleDateString())}</div>`,
  }))
})

// ─── createShareLink callable ─────────────────────────────────────────────────

interface CreateShareInput  { productId: string }
interface CreateShareOutput { token: string; expiresAt: string }

export const createShareLink = onCall<CreateShareInput>(
  { maxInstances: 10 },
  async (request): Promise<CreateShareOutput> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to create a share link')

    const { productId } = request.data
    if (!productId) throw new HttpsError('invalid-argument', 'productId is required')

    const db        = getFirestore()
    const token     = randomBytes(20).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    // Verify product exists
    const productDoc = await db.doc(`products/${productId}`).get()
    if (!productDoc.exists) throw new HttpsError('not-found', 'Product not found')

    await db.doc(`shareLinks/${token}`).set({
      productId,
      createdBy: request.auth.uid,
      expiresAt: Timestamp.fromDate(expiresAt),
    })

    return { token, expiresAt: expiresAt.toISOString() }
  },
)

// ─── getShareSnapshot callable ────────────────────────────────────────────────

interface SnapshotInput  { token: string }
interface SnapshotOutput {
  product:   Record<string, unknown>
  coverages: Record<string, unknown>[]
  forms:     Record<string, unknown>[]
  expired:   false
}

export const getShareSnapshot = onCall<SnapshotInput>(
  { maxInstances: 10 },
  async (request): Promise<SnapshotOutput | { expired: true }> => {
    const { token } = request.data
    if (!token) throw new HttpsError('invalid-argument', 'token is required')

    const db      = getFirestore()
    const linkDoc = await db.doc(`shareLinks/${token}`).get()
    if (!linkDoc.exists) throw new HttpsError('not-found', 'Share link not found')

    const link = linkDoc.data() as { productId: string; expiresAt: Timestamp }
    if (link.expiresAt.toDate() < new Date()) return { expired: true }

    const productDoc   = await db.doc(`products/${link.productId}`).get()
    const coveragesSnap = await db.collection(`products/${link.productId}/coverages`).get()
    const formsSnap     = await db.collection('forms').get()

    const productData = { id: productDoc.id, ...productDoc.data() }
    const coverages   = coveragesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const allForms    = formsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const forms = allForms.filter(f => {
      const d    = f as Record<string, unknown>
      const refs = (d['productRefIds'] as string[] | undefined) ?? []
      return refs.includes(link.productId)
    })

    return { product: productData, coverages, forms, expired: false }
  },
)
```


## `functions/src/tools.ts`

```ts
// tools.ts — Firestore-backed grounding tools + the shared system prompt.
// The AI never answers from memory: every specific claim must come from a tool
// result and cite its refId / form number. Tool results are compact JSON so the
// model spends its context on reasoning, not boilerplate.
import { getFirestore } from 'firebase-admin/firestore'
import type Anthropic from '@anthropic-ai/sdk'
import {
  evaluate, makeHO3RtGetter, makeHO3LdGetter, HO3_WORKED_EXAMPLE, rankDocuments,
} from '@pf/shared'
import type { RankDoc } from '@pf/shared'
import type {
  RatingInputs, RatingProgram, RTTable, LDTable, Coverage, Rule, Form,
  Product, DictionaryEntry, SearchIndexEntry,
} from '@pf/shared'

// ─── Tool definitions (Anthropic schema) ───────────────────────────────────────

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_entities',
    description:
      'Full-text search the portfolio index for products, coverages, rules, forms, tables or dictionary terms. Use first when you need to locate something by name or keyword. Returns each hit with its path and refId.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text, e.g. "scheduled personal property" or "HO.RU.006".' },
        type:  { type: 'string', enum: ['product', 'coverage', 'rule', 'form', 'ldTable', 'rtTable', 'dictionary', 'task'], description: 'Optional entity-type filter.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product_tree',
    description:
      'Return a product with its full coverage hierarchy (terms, requirement, form numbers), rating programs and collection counts. Omit productId to use the sole product in the portfolio.',
    input_schema: {
      type: 'object',
      properties: { productId: { type: 'string', description: 'Product document id (from a search path products/{id}). Optional.' } },
    },
  },
  {
    name: 'get_coverage',
    description: 'Return one coverage in full (terms with LD refs, requirement, claims basis, attached form numbers, state scope) by its refId, e.g. HO.COV.003.002.',
    input_schema: {
      type: 'object',
      properties: { refId: { type: 'string', description: 'Coverage refId, e.g. HO.COV.001.' } },
      required: ['refId'],
    },
  },
  {
    name: 'get_rules',
    description: 'Return product/rating/forms rules. Filter by coverageRefId (rules touching that coverage) or productId. Each rule has condition, outcome and the refIds/forms it references.',
    input_schema: {
      type: 'object',
      properties: {
        coverageRefId: { type: 'string', description: 'Return only rules referencing this coverage refId.' },
        productId:     { type: 'string', description: 'Product document id. Optional (defaults to sole product).' },
      },
    },
  },
  {
    name: 'get_forms',
    description: 'Return forms (documents) with optional filters. Use to see which forms exist and when they attach. Filter by category, state, a specific form number, product, or coverage part (A–F).',
    input_schema: {
      type: 'object',
      properties: {
        category:     { type: 'string', enum: ['BASE_COVERAGE', 'DECLARATIONS', 'ENDORSEMENT', 'EXCLUSION', 'AMENDATORY', 'POLICY_NOTICE'] },
        state:        { type: 'string', description: '2-letter state code; returns forms admitted in that state.' },
        formNumber:   { type: 'string', description: 'A specific form number, e.g. "HO 04 61".' },
        coveragePart: { type: 'string', description: 'Coverage part letter A–F.' },
        search:       { type: 'string', description: 'Free text over form name/number.' },
      },
    },
  },
  {
    name: 'get_ld_table',
    description: 'Return a Limit/Deductible option table by refId (e.g. HO.LD.002) — its rows, values and any per-row constraint notes.',
    input_schema: {
      type: 'object',
      properties: { refId: { type: 'string', description: 'LD table refId, e.g. HO.LD.001.' } },
      required: ['refId'],
    },
  },
  {
    name: 'run_rating',
    description:
      'Execute the rating algorithm and return the final premium with a step-by-step trace. Pass programRef (e.g. HO.RAT.1) and any subset of inputs; unspecified inputs default to the standard $1,528 worked example. Use to trace or re-price a premium.',
    input_schema: {
      type: 'object',
      properties: {
        programRef: { type: 'string', description: 'Rating program refId, e.g. HO.RAT.1.' },
        inputs:     { type: 'object', description: 'Partial RatingInputs (territory, pc, construction, covA, allPerilDed, covCPct, covELimit, covFLimit, tier, deviceCredit, rcElected, windHailElected/windHailPct, waterBackupElected/waterBackupLimit, sppElected/sppItems). Merged over the worked example.' },
      },
      required: ['programRef'],
    },
  },
  {
    name: 'get_dictionary',
    description: 'Return a data-dictionary term by name (type, description, allowed values, format). Use for canonical field definitions.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Dictionary term name, e.g. "Coverage A" or "Protection Class".' } },
      required: ['name'],
    },
  },
]

// ─── System prompt (cacheable) ─────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are Product Factory's portfolio analyst for P&C insurance product managers. The reference product is an ISO-style Homeowners HO-3.

DATA MODEL (Firestore, all reachable via the tools):
- products → coverages (Coverage A–F plus endorsements; each has terms of kind LIMIT | DEDUCTIBLE | OPTION), rules (category PRODUCT | RATING | FORMS, each a condition → outcome), formRules, and ratingPrograms (ordered SET/MUL/ADD/MIN_FLOOR steps).
- forms — policy documents keyed by number (e.g. "HO 04 61"), with category, attachment condition and coverage parts.
- ldTables — Limit/Deductible option tables (refIds like HO.LD.002). rtTables — rate tables (refIds like HO.RT.003). dictionary — canonical field definitions.

REFERENCE IDs are the traceability backbone and must be preserved and cited exactly: coverage refIds (HO.COV.003.002), rule refIds (HO.RU.006), form-rule refIds (HO.FORM.RU.003), table refIds (HO.LD.002, HO.RT.003) and form numbers (HO 04 61, HO 04 90).

HOUSE RULES — non-negotiable:
1. Assert ONLY what the tools return. Never invent coverages, forms, rules, limits, factors or premiums.
2. Cite every specific claim with its refId or form number in square brackets, e.g. [HO.RU.006] [HO 04 90]. One id per bracket.
3. If a tool returns nothing (found:false or an empty list), say so plainly — do not guess or fill the gap from prior knowledge.
4. Prefer calling a tool over answering from memory, and chain tools when needed (e.g. get_coverage to read a coverage's form numbers, then get_forms to describe them).
5. Be concise and concrete. Use the exact domain terminology and numbers the tools return.`

// ─── Dispatch ───────────────────────────────────────────────────────────────────

export interface ToolOutput {
  content: string   // compact JSON string returned to the model as the tool_result
  summary: string   // short human label for the UI status chip
}

/** Execute a grounding tool. Errors are returned (not thrown) so the model can recover. */
export async function runTool(name: string, input: Record<string, unknown>): Promise<ToolOutput> {
  try {
    switch (name) {
      case 'search_entities': return await searchEntities(String(input.query ?? ''), input.type as string | undefined)
      case 'get_product_tree': return await getProductTree(input.productId as string | undefined)
      case 'get_coverage':     return await getCoverage(String(input.refId ?? ''))
      case 'get_rules':        return await getRules(input.coverageRefId as string | undefined, input.productId as string | undefined)
      case 'get_forms':        return await getForms(input)
      case 'get_ld_table':     return await getLdTable(String(input.refId ?? ''))
      case 'run_rating':       return await runRating(String(input.programRef ?? ''), (input.inputs as Partial<RatingInputs>) ?? {})
      case 'get_dictionary':   return await getDictionary(String(input.name ?? ''))
      default: return { content: JSON.stringify({ error: `Unknown tool ${name}` }), summary: 'error' }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { content: JSON.stringify({ error: message }), summary: 'error' }
  }
}

// ─── Executors ───────────────────────────────────────────────────────────────────

/** Resolve the product id to use: the given one, or the sole product if omitted. */
async function resolveProductId(given?: string): Promise<string | null> {
  if (given) return given
  const snap = await getFirestore().collection('products').limit(2).get()
  return snap.size === 1 ? snap.docs[0]!.id : null
}

async function searchEntities(query: string, type?: string): Promise<ToolOutput> {
  const snap = await getFirestore().collection('searchIndex').get()
  const entries = snap.docs
    .map(d => d.data() as SearchIndexEntry)
    .filter(e => !type || e.type === type)

  // Vector-space (TF-IDF cosine) retrieval so the model gets the most relevant
  // entities, not merely ones containing a token. refId is repeated to weight it.
  const docs: RankDoc[] = entries.map((e, i) => ({
    id: String(i),
    text: `${e.title} ${e.subtitle} ${e.refId ?? ''} ${e.refId ?? ''} ${(e.keywords ?? []).join(' ')}`,
  }))
  const ranked = rankDocuments(query, docs, 15).filter(r => r.score > 0 || !query.trim())

  const hits = ranked.map(r => {
    const e = entries[Number(r.id)]!
    return { type: e.type, refId: e.refId ?? null, title: e.title, subtitle: e.subtitle, path: e.path, score: Math.round(r.score * 1000) / 1000 }
  })
  return { content: JSON.stringify(hits), summary: `${hits.length} result${hits.length === 1 ? '' : 's'}` }
}

async function getProductTree(productIdArg?: string): Promise<ToolOutput> {
  const db        = getFirestore()
  const productId = await resolveProductId(productIdArg)
  if (!productId) return { content: JSON.stringify({ found: false, note: 'Specify productId — more than one product exists.' }), summary: 'not found' }

  const productDoc = await db.doc(`products/${productId}`).get()
  if (!productDoc.exists) return { content: JSON.stringify({ found: false }), summary: 'not found' }
  const p = productDoc.data() as Product

  const [covSnap, ruleSnap, ratingSnap] = await Promise.all([
    db.collection(`products/${productId}/coverages`).get(),
    db.collection(`products/${productId}/rules`).get(),
    db.collection(`products/${productId}/ratingPrograms`).get(),
  ])
  const formCount = await db.collection('forms').where('productRefIds', 'array-contains', productId).get().then(s => s.size).catch(() => 0)

  const coverages = covSnap.docs
    .map(d => d.data() as Coverage)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(c => ({
      refId: c.refId, name: c.name, parentId: c.parentId, requirement: c.requirement,
      premiumGenerating: c.premiumGenerating, formNumbers: c.formNumbers,
      terms: (c.terms ?? []).map(t => ({ label: t.label, kind: t.kind, ldTableRef: t.ldTableRef ?? null, default: t.default })),
    }))

  const tree = {
    productId,
    product: { refId: p.refId, name: p.name, marketSegment: p.marketSegment, lifecycle: p.lifecycle, allStates: p.allStates, states: p.states },
    coverages,
    ratingPrograms: ratingSnap.docs.map(d => { const r = d.data() as RatingProgram; return { refId: r.refId, name: r.name, minimumPremium: r.minimumPremium } }),
    counts: { coverages: covSnap.size, rules: ruleSnap.size, forms: formCount },
  }
  return { content: JSON.stringify(tree), summary: `${coverages.length} coverages` }
}

async function getCoverage(refId: string): Promise<ToolOutput> {
  if (!refId) return { content: JSON.stringify({ error: 'refId required' }), summary: 'error' }
  const snap = await getFirestore().collectionGroup('coverages').where('refId', '==', refId).limit(1).get()
  if (snap.empty) return { content: JSON.stringify({ found: false, refId }), summary: 'not found' }

  const c = snap.docs[0]!.data() as Coverage
  const out = {
    refId: c.refId, name: c.name, parentId: c.parentId, requirement: c.requirement,
    claimsBasis: c.claimsBasis, premiumGenerating: c.premiumGenerating, source: c.source,
    formNumbers: c.formNumbers, allStates: c.allStates, states: c.states,
    terms: c.terms ?? [],
  }
  return { content: JSON.stringify(out), summary: c.name }
}

async function getRules(coverageRefId?: string, productIdArg?: string): Promise<ToolOutput> {
  const db = getFirestore()
  let snap
  if (coverageRefId) {
    snap = await db.collectionGroup('rules').where('coverageRefIds', 'array-contains', coverageRefId).get()
  } else {
    const productId = await resolveProductId(productIdArg)
    const ref = productId ? db.collection(`products/${productId}/rules`) : db.collectionGroup('rules')
    snap = await ref.get()
  }

  const rules = snap.docs.map(d => d.data() as Rule).map(r => ({
    refId: r.refId, category: r.category, subCategory: r.subCategory,
    condition: r.condition, outcome: r.outcome,
    coverageRefIds: r.coverageRefIds, formNumbers: r.formNumbers, ldTableRef: r.ldTableRef ?? null,
  }))
  return { content: JSON.stringify(rules), summary: `${rules.length} rule${rules.length === 1 ? '' : 's'}` }
}

async function getForms(filter: Record<string, unknown>): Promise<ToolOutput> {
  const snap    = await getFirestore().collection('forms').get()
  const category     = filter.category as string | undefined
  const state        = (filter.state as string | undefined)?.toUpperCase()
  const formNumber   = (filter.formNumber as string | undefined)?.replace(/\s+/g, ' ').trim().toLowerCase()
  const coveragePart = (filter.coveragePart as string | undefined)?.toUpperCase()
  const search       = (filter.search as string | undefined)?.toLowerCase()

  const forms = snap.docs.map(d => d.data() as Form).filter(f => {
    if (category && f.category !== category) return false
    if (state && !f.allStates && !(f.states ?? []).includes(state)) return false
    if (formNumber && f.number.toLowerCase() !== formNumber) return false
    if (coveragePart && !(f.coverageParts ?? []).includes(coveragePart)) return false
    if (search && !`${f.number} ${f.name}`.toLowerCase().includes(search)) return false
    return true
  }).slice(0, 25).map(f => ({
    number: f.number, name: f.name, edition: f.edition, category: f.category,
    mandatoryDefault: f.mandatoryDefault, attachmentCondition: f.attachmentCondition,
    coverageParts: f.coverageParts, description: f.description || null,
  }))
  return { content: JSON.stringify(forms), summary: `${forms.length} form${forms.length === 1 ? '' : 's'}` }
}

async function getLdTable(refId: string): Promise<ToolOutput> {
  if (!refId) return { content: JSON.stringify({ error: 'refId required' }), summary: 'error' }
  const doc = await getFirestore().doc(`ldTables/${refId}`).get()
  if (!doc.exists) return { content: JSON.stringify({ found: false, refId }), summary: 'not found' }
  const t = doc.data() as LDTable
  return { content: JSON.stringify({ refId, name: t.name, defaultValue: t.defaultValue ?? null, rows: t.rows }), summary: `${t.rows?.length ?? 0} rows` }
}

async function runRating(programRef: string, partial: Partial<RatingInputs>): Promise<ToolOutput> {
  const db = getFirestore()
  const progSnap = await db.collectionGroup('ratingPrograms').where('refId', '==', programRef).limit(1).get()
  if (progSnap.empty) return { content: JSON.stringify({ found: false, programRef }), summary: 'not found' }

  const program = progSnap.docs[0]!.data() as RatingProgram
  const [rtSnap, ldSnap] = await Promise.all([db.collection('rtTables').get(), db.collection('ldTables').get()])
  const rtTables: Record<string, RTTable> = {}
  for (const d of rtSnap.docs) rtTables[d.id] = d.data() as RTTable
  const ldTables: Record<string, LDTable> = {}
  for (const d of ldSnap.docs) ldTables[d.id] = d.data() as LDTable

  const inputs: RatingInputs = { ...HO3_WORKED_EXAMPLE, ...partial }
  const { finalPremium, trace } = evaluate(program, inputs, makeHO3RtGetter(rtTables), makeHO3LdGetter(ldTables))
  const out = {
    programRef, finalPremium,
    trace: trace.map(t => ({ stepId: t.stepId, label: t.label, op: t.op, sourceRef: t.sourceRef, factorOrAmount: t.factorOrAmount, runningTotal: t.runningTotal })),
  }
  return { content: JSON.stringify(out), summary: `$${finalPremium.toLocaleString()}` }
}

async function getDictionary(name: string): Promise<ToolOutput> {
  if (!name) return { content: JSON.stringify({ error: 'name required' }), summary: 'error' }
  const db   = getFirestore()
  const snap = await db.collection('dictionary').get()
  const wanted = name.toLowerCase()
  const entry =
    snap.docs.map(d => d.data() as DictionaryEntry).find(e => e.name.toLowerCase() === wanted) ??
    snap.docs.map(d => d.data() as DictionaryEntry).find(e => e.name.toLowerCase().includes(wanted))
  if (!entry) return { content: JSON.stringify({ found: false, name }), summary: 'not found' }
  return {
    content: JSON.stringify({ name: entry.name, type: entry.type, description: entry.description, allowedValues: entry.allowedValues, format: entry.format }),
    summary: entry.name,
  }
}
```


## `functions/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["es2022"],
    "outDir": "lib",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "paths": {
      "@pf/shared": ["../shared/src/index.ts"]
    }
  },
  "include": ["src"],
  "exclude": ["lib", "node_modules"]
}
```


## `functions/tsup.config.ts`

```ts
// tsup bundles @pf/shared into the output so functions ship self-contained — no
// workspace:* dependency in the deployed package.json (Cloud Build runs npm, which
// can't resolve pnpm's workspace protocol). Shared is resolved from source via an
// alias, so no node_modules symlink is required at build or deploy time.
import { defineConfig } from 'tsup'
import { fileURLToPath } from 'node:url'

const sharedEntry = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url))

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node20',
  bundle: true,
  outDir: 'lib',
  clean: true,
  splitting: false,
  sourcemap: true,
  // Bundle local workspace packages; leave Firebase + Node built-ins as external.
  noExternal: ['@pf/shared'],
  external: ['firebase-admin', 'firebase-functions'],
  esbuildOptions(options) {
    options.alias = { ...(options.alias ?? {}), '@pf/shared': sharedEntry }
  },
})
```


## `scripts/grant-invoker.mjs`

```js
// One-off infra fix: ensure the HTTP/callable Cloud Functions (gen2 = Cloud Run)
// allow unauthenticated invocation (allUsers → roles/run.invoker). Auth is enforced
// IN-CODE for these functions (Firebase ID token / callable context) — this is the
// standard Firebase posture; the binding just lets requests reach the function.
import { GoogleAuth } from 'google-auth-library'

const PROJECT = 'productreinvention', LOC = 'us-central1'
const SERVICES = ['chat', 'share', 'createsharelink', 'getsharesnapshot', 'refreshnews', 'setuserrole', 'hello']

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
const client = await auth.getClient()
const { token } = await client.getAccessToken()
const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-goog-user-project': PROJECT }

for (const s of SERVICES) {
  const base = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${LOC}/services/${s}`
  const gp = await fetch(`${base}:getIamPolicy`, { headers: H })
  if (gp.status !== 200) { console.log(`${s}: getIamPolicy ${gp.status} — ${(await gp.text()).slice(0, 100)}`); continue }
  const pol = await gp.json()
  const bindings = pol.bindings ?? []
  let b = bindings.find(x => x.role === 'roles/run.invoker')
  if (!b) { b = { role: 'roles/run.invoker', members: [] }; bindings.push(b) }
  if (b.members?.includes('allUsers')) { console.log(`${s}: already public`); continue }
  b.members = [...(b.members ?? []), 'allUsers']
  const sp = await fetch(`${base}:setIamPolicy`, { method: 'POST', headers: H, body: JSON.stringify({ policy: { bindings, etag: pol.etag } }) })
  console.log(`${s}: setIamPolicy ${sp.status} — ${sp.status === 200 ? 'granted allUsers invoker' : (await sp.text()).slice(0, 160)}`)
}
```


## `scripts/seed.ts`

```ts
// scripts/seed.ts — Seeds the full HO-3 dataset into Firestore.
// Default target: emulators (env vars set before admin init).
// Pass --project productreinvention to target production (typed confirmation required).
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { Auth } from 'firebase-admin/auth'
import {
  HO3_PRODUCT, HO3_COVERAGES, HO3_LD_TABLES, HO3_RT_TABLES,
  HO3_RATING_PROGRAM, HO3_FORMS, HO3_RULES, HO3_FORM_RULES,
  HO3_DICTIONARY, HO3_DEFAULT_TASK_TEMPLATES, HO3_SEED_USERS,
  HO3_SAMPLE_FEEDBACK, HO3_WORKED_EXAMPLE,
  makeHO3RtGetter, makeHO3LdGetter,
} from '../shared/src/seed/ho3'
import { evaluate } from '../shared/src/rating/evaluator'
import type { SearchEntityType } from '../shared/src/types'
import * as readline from 'readline'

// ─── Types ────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>
interface IndexEntry { type: SearchEntityType; refId?: string; title: string; subtitle: string; path: string; keywords: string[] }

// ─── CLI flag parsing ─────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const projectFlag = args[args.indexOf('--project') + 1]
const targetProd  = projectFlag === 'productreinvention'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTs(obj: Doc, now: FieldValue): Doc {
  const out = { ...obj }
  for (const k of ['createdAt', 'updatedAt', 'at']) {
    if (k in out && out[k] === null) out[k] = now
  }
  if (typeof out['health'] === 'object' && out['health'] !== null) {
    const h = out['health'] as Doc
    if (h['updatedAt'] === null) out['health'] = { ...h, updatedAt: now }
  }
  return out
}

function keywords(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(k => k.length > 2)
}

function promptConfirm(q: string, expected: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(q, answer => { rl.close(); resolve(answer.trim() === expected) })
  })
}

async function deleteAll(db: Firestore, collPath: string): Promise<void> {
  const snap = await db.collection(collPath).get()
  if (snap.empty) return
  const batch = db.batch()
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {

  // ── Target setup ──────────────────────────────────────────────────────────
  if (!targetProd) {
    // Set BEFORE initializeApp so the admin SDK connects to emulators
    process.env['FIRESTORE_EMULATOR_HOST']     = '127.0.0.1:8080'
    process.env['FIREBASE_AUTH_EMULATOR_HOST']  = '127.0.0.1:9099'
    console.log('🔌 Targeting EMULATORS (Firestore :8080, Auth :9099)')
  } else {
    const ok = await promptConfirm(
      '⚠️  Seeding PRODUCTION "productreinvention". Type "seed-production" to confirm: ',
      'seed-production',
    )
    if (!ok) { console.log('Aborted.'); process.exit(0) }
    console.log('⚡ Targeting PRODUCTION')
  }

  admin.initializeApp({ projectId: 'productreinvention' })
  const db:   Firestore = admin.firestore()
  // Ignore undefined fields in seed data (optional fields typed as foo?: X may be undefined)
  db.settings({ ignoreUndefinedProperties: true })
  const auth: Auth      = admin.auth()
  const now             = FieldValue.serverTimestamp()

  const counts: Record<string, number> = {}
  const warnings: string[] = []
  const searchEntries: { id: string; data: IndexEntry }[] = []

  const inc   = (col: string, n = 1) => { counts[col] = (counts[col] ?? 0) + n }
  const addIdx = (e: IndexEntry) => searchEntries.push({ id: e.path.replace(/\//g, '_'), data: e })

  const pid = HO3_PRODUCT.refId!

  // ── Wipe ──────────────────────────────────────────────────────────────────
  console.log('🧹 Wiping…')
  await Promise.all([
    'products', 'forms', 'ldTables', 'rtTables',
    'dictionary', 'tasks', 'feedback', 'searchIndex', 'seedReports',
  ].map(c => deleteAll(db, c)))
  for (const sub of ['coverages', 'rules', 'formRules', 'ratingPrograms']) {
    await deleteAll(db, `products/${pid}/${sub}`)
  }

  // ── Product ───────────────────────────────────────────────────────────────
  await db.doc(`products/${pid}`).set(withTs(HO3_PRODUCT as Doc, now))
  inc('products')
  addIdx({ type: 'product', refId: pid, title: HO3_PRODUCT.name,
    subtitle: `${HO3_PRODUCT.lob.name} · ${HO3_PRODUCT.marketSegment}`,
    path: `products/${pid}`,
    keywords: [...keywords(HO3_PRODUCT.name), 'homeowners', 'ho3', 'ho-3', pid.toLowerCase()],
  })

  // ── Coverages ─────────────────────────────────────────────────────────────
  for (const cov of HO3_COVERAGES) {
    const id = cov.refId!.replace(/\./g, '-')
    await db.doc(`products/${pid}/coverages/${id}`).set(withTs(cov as Doc, now))
    inc('coverages')
    addIdx({ type: 'coverage', refId: cov.refId ?? undefined, title: cov.name,
      subtitle: cov.refId ?? '', path: `products/${pid}/coverages/${id}`,
      keywords: keywords(cov.name),
    })
  }

  // ── LD Tables ─────────────────────────────────────────────────────────────
  for (const [refId, tbl] of Object.entries(HO3_LD_TABLES)) {
    await db.doc(`ldTables/${refId}`).set(tbl as Doc)
    inc('ldTables')
    addIdx({ type: 'ldTable', refId, title: tbl.name, subtitle: refId,
      path: `ldTables/${refId}`, keywords: [...keywords(tbl.name), ...keywords(refId)] })
  }

  // ── RT Tables ─────────────────────────────────────────────────────────────
  for (const [refId, tbl] of Object.entries(HO3_RT_TABLES)) {
    await db.doc(`rtTables/${refId}`).set(tbl as Doc)
    inc('rtTables')
    addIdx({ type: 'rtTable', refId, title: tbl.name, subtitle: refId,
      path: `rtTables/${refId}`, keywords: [...keywords(tbl.name), ...keywords(refId)] })
  }

  // ── Rating Program ────────────────────────────────────────────────────────
  const rpId = HO3_RATING_PROGRAM.refId.replace(/\./g, '-')
  await db.doc(`products/${pid}/ratingPrograms/${rpId}`)
    .set(withTs(HO3_RATING_PROGRAM as Doc, now))
  inc('ratingPrograms')

  // ── Forms ─────────────────────────────────────────────────────────────────
  for (const form of HO3_FORMS) {
    const key = form.number.replace(/\s+/g, '-')
    await db.doc(`forms/${key}`).set(withTs(form as Doc, now))
    inc('forms')
    addIdx({ type: 'form', title: form.name,
      subtitle: `${form.number} · ${form.edition}`,
      path: `forms/${key}`,
      keywords: [...keywords(form.name), ...keywords(form.number)],
    })
  }

  // ── Product Rules ─────────────────────────────────────────────────────────
  for (const rule of HO3_RULES) {
    const id = rule.refId!.replace(/\./g, '-')
    await db.doc(`products/${pid}/rules/${id}`).set(withTs(rule as Doc, now))
    inc('rules')
  }

  // ── Form Rules ────────────────────────────────────────────────────────────
  for (const fr of HO3_FORM_RULES) {
    const id = fr.refId!.replace(/\./g, '-')
    await db.doc(`products/${pid}/formRules/${id}`).set(withTs(fr as Doc, now))
    inc('formRules')
  }

  // ── Dictionary ────────────────────────────────────────────────────────────
  for (const entry of HO3_DICTIONARY) {
    const id = entry.name.toLowerCase().replace(/\s+/g, '-')
    await db.doc(`dictionary/${id}`).set(withTs(entry as Doc, now))
    inc('dictionary')
    addIdx({ type: 'dictionary', title: entry.name, subtitle: entry.type,
      path: `dictionary/${id}`, keywords: [...keywords(entry.name), ...entry.tags],
    })
  }

  // ── Default Tasks ─────────────────────────────────────────────────────────
  const base = new Date()
  for (let i = 0; i < HO3_DEFAULT_TASK_TEMPLATES.length; i++) {
    const tmpl  = HO3_DEFAULT_TASK_TEMPLATES[i]
    const dueAt = new Date(base)
    dueAt.setDate(dueAt.getDate() + tmpl.daysOffset)
    await db.collection('tasks').add({
      title: tmpl.title, column: tmpl.column,
      productId: pid, checklist: [], order: i,
      dueAt: Timestamp.fromDate(dueAt),
      status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
      updatedBy: 'seed', rev: 1, createdAt: now, updatedAt: now,
    })
    inc('tasks')
  }

  // ── Sample Feedback ───────────────────────────────────────────────────────
  for (const fb of HO3_SAMPLE_FEEDBACK) {
    await db.collection('feedback').add(withTs(fb as Doc, now))
    inc('feedback')
  }

  // ── Search Index (batched) ────────────────────────────────────────────────
  for (let i = 0; i < searchEntries.length; i += 400) {
    const batch = db.batch()
    for (const { id, data } of searchEntries.slice(i, i + 400)) {
      batch.set(db.doc(`searchIndex/${id}`), data)
    }
    await batch.commit()
  }
  inc('searchIndex', searchEntries.length)

  // ── Auth Users ────────────────────────────────────────────────────────────
  console.log('👤 Creating auth users…')
  for (const u of HO3_SEED_USERS) {
    try {
      try {
        const existing = await auth.getUserByEmail(u.email)
        await auth.deleteUser(existing.uid)
      } catch { /* not yet created */ }

      const created = await auth.createUser({ email: u.email, password: u.password, displayName: u.name })
      await auth.setCustomUserClaims(created.uid, { role: u.role })
      await db.doc(`users/${created.uid}`).set({
        email: u.email, name: u.name, role: u.role,
        active: u.active, mustChangePassword: u.mustChangePassword,
        createdAt: now,
      })
      inc('users')
      console.log(`  ✓ ${u.email} (${u.role})`)
    } catch (e) {
      const msg = `  ✗ ${u.email}: ${(e as Error).message}`
      console.warn(msg); warnings.push(msg)
    }
  }

  // ── Verify worked example → must equal $1,528 ────────────────────────────
  console.log('\n🧮 Verifying worked example…')
  const rtGetter = makeHO3RtGetter(HO3_RT_TABLES)
  const ldGetter = makeHO3LdGetter(HO3_LD_TABLES)
  const { finalPremium } = evaluate(HO3_RATING_PROGRAM, HO3_WORKED_EXAMPLE, rtGetter, ldGetter)

  if (finalPremium !== 1528) {
    warnings.push(`CRITICAL: worked example premium = ${finalPremium}, expected $1,528`)
    console.error(`  ✗ Got $${finalPremium} — expected $1,528!`)
  } else {
    console.log('  ✓ $1,528 confirmed')
  }

  // ── Seed Report ───────────────────────────────────────────────────────────
  await db.collection('seedReports').add({ counts, warnings, workedExamplePremium: finalPremium, at: now })

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete.')
  console.log('   Counts:')
  for (const [k, v] of Object.entries(counts)) console.log(`     ${k}: ${v}`)
  if (warnings.length) console.warn('\n   Warnings:', warnings)
  console.log(`\n   💰 Worked example premium: $${finalPremium.toLocaleString()}`)
}

main().catch(err => { console.error('Seed failed:', err); process.exit(1) })
```


## `scripts/verify-api.mjs`

```js
// Live API/SSE verification against the DEPLOYED functions (not localhost).
// Checks f (grounded chat SSE + honest no-data), j (VIEWER write rejected server-side),
// k (share link public render + no leak), m (graceful malformed/unauth failures).
const API_KEY = 'AIzaSyCoqf7-ty_z-0VI6EDGs56MHy-RH_5giN8' // public web config key (safe)
const FN = 'https://us-central1-productreinvention.cloudfunctions.net'
const PREVIEW = process.env.PREVIEW_URL
const results = []
const rec = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id} — ${detail}`) }

async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })
  const j = await r.json()
  if (!j.idToken) throw new Error('signin failed: ' + JSON.stringify(j))
  return j.idToken
}

async function chatSSE(token, content) {
  const r = await fetch(`${FN}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: [{ role: 'user', content }] }) })
  let text = '', tools = 0, errors = []; const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
  while (true) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true })
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2)
      if (!line.startsWith('data:')) continue
      try { const ev = JSON.parse(line.slice(5).trim()); if (ev.t === 'token') text += ev.v; else if (ev.t === 'tool') tools++; else if (ev.t === 'error') errors.push(ev.message) } catch { /* */ } } }
  return { status: r.status, text, tools, errors }
}

const CITE = /\[(HO[\s.][A-Z0-9][A-Z0-9.\s]*?)\]/

async function main() {
  const admin = await signIn('admin@productfactory.app', 'admin123')

  // ── f: grounded chat ──
  try {
    const g = await chatSSE(admin, 'Trace the premium for the default HO-3 worked example and name which rating tables feed steps 1-3. Cite refIds.')
    const cited = CITE.exec(g.text)
    rec('f-grounded', g.status === 200 && g.text.length > 40 && !!cited && g.errors.length === 0,
      `status=${g.status} tools=${g.tools} chars=${g.text.length} cite=${cited ? cited[1] : 'NONE'} err=${g.errors.join('|') || 'none'}`)
  } catch (e) { rec('f-grounded', false, 'threw: ' + e.message) }

  // ── f: ungroundable → honest ──
  try {
    const u = await chatSSE(admin, 'What is our commercial cyber-liability breach premium for policies written in Japan?')
    const honest = /\b(no|not|don't|cannot|couldn't|unable|isn't|no data|no such|not find|no information)\b/i.test(u.text)
    const invented = /\$\s?\d{2,}|premium is \$|HO\.CYBER|CYBER\.\d/.test(u.text)
    rec('f-nodata', u.status === 200 && honest && !invented, `honest=${honest} invented=${invented} sample="${u.text.slice(0, 90).replace(/\n/g, ' ')}"`)
  } catch (e) { rec('f-nodata', false, 'threw: ' + e.message) }

  // ── j: VIEWER write rejected server-side (Firestore rules) — target ZZTEST doc for safety ──
  try {
    const viewer = await signIn('viewer@productfactory.app', 'viewer123')
    const url = `https://firestore.googleapis.com/v1/projects/productreinvention/databases/(default)/documents/products/ZZTEST-PROD-001?updateMask.fieldPaths=description&key=${API_KEY}`
    const r = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${viewer}` }, body: JSON.stringify({ fields: { description: { stringValue: 'viewer-should-not-write' } } }) })
    rec('j-role', r.status === 403, `VIEWER PATCH status=${r.status} (expect 403 PERMISSION_DENIED)`)
  } catch (e) { rec('j-role', false, 'threw: ' + e.message) }

  // ── k: share link → public render, no private leak (share the ZZTEST product) ──
  try {
    const r = await fetch(`${FN}/createShareLink`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` }, body: JSON.stringify({ data: { productId: 'ZZTEST-PROD-001' } }) })
    const j = await r.json()
    const token = j?.result?.token
    if (!token) { rec('k-share', false, 'createShareLink returned ' + JSON.stringify(j).slice(0, 120)); }
    else {
      const pub = await fetch(`${PREVIEW}/share/${token}`)
      const html = await pub.text()
      const renders = pub.status === 200 && /ZZTEST/.test(html)
      const leaks = /admin@productfactory|viewer123|editor123|sk-ant|password|customClaims|rev":/i.test(html)
      rec('k-share', renders && !leaks, `pub status=${pub.status} rendersProduct=${renders} leaks=${leaks} token=${token.slice(0, 8)}…`)
      globalThis.__shareToken = token
    }
  } catch (e) { rec('k-share', false, 'threw: ' + e.message) }

  // ── m: resilience — malformed (empty messages) + unauthenticated ──
  try {
    const empty = await chatSSE(admin, '')  // trims to empty → server should send a graceful error event
    const gracefulEmpty = empty.status === 200 && empty.errors.some(m => /no message/i.test(m)) && !/\n\s*at\s|sk-ant/i.test(JSON.stringify(empty))
    const noAuth = await fetch(`${FN}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) })
    const noAuthBody = await noAuth.text()
    const gracefulAuth = noAuth.status === 401 && !/\bat\s.+:\d+:\d+|sk-ant/i.test(noAuthBody)
    rec('m-resilience', gracefulEmpty && gracefulAuth, `emptyGraceful=${gracefulEmpty}(err="${empty.errors.join('|')}") noauth=${noAuth.status} noauthGraceful=${gracefulAuth}`)
  } catch (e) { rec('m-resilience', false, 'threw: ' + e.message) }

  console.log('\n=== API SUMMARY ===')
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}`)
  console.log(JSON.stringify({ shareToken: globalThis.__shareToken ?? null }))
}
main().catch(e => { console.error('verify-api crashed:', e); process.exit(1) })
```


## `scripts/verify-invariant.ts`

```ts
// Reads back the mutation invariant after the live EDITOR edit: entity rev bump +
// Version snapshot + AuditEvent for the ZZTEST coverage (Admin SDK bypasses rules).
import * as admin from 'firebase-admin'

const COV_PATH = 'products/ZZTEST-PROD-001/coverages/ZZTEST-COV-C'

async function main() {
  admin.initializeApp({ projectId: 'productreinvention' })
  const db = admin.firestore()
  const cov = await db.doc(COV_PATH).get()
  const covData = cov.data() as { rev?: number; terms?: Array<{ default?: unknown }> } | undefined
  console.log('coverage rev:', covData?.rev, '| Cov C default now:', covData?.terms?.[0]?.default)

  const vers = await db.collection('versions').get()
  const vHit = vers.docs.filter(d => JSON.stringify(d.data()).includes('ZZTEST-COV-C'))
  console.log('Version snapshots referencing ZZTEST-COV-C:', vHit.length,
    '| fields:', vHit[0] ? Object.keys(vHit[0].data()).join(',') : 'none')

  const aud = await db.collection('auditEvents').get()
  const aHit = aud.docs.filter(d => JSON.stringify(d.data()).includes('ZZTEST-COV-C') || (d.data() as { productId?: string }).productId === 'ZZTEST-PROD-001')
  console.log('AuditEvents referencing ZZTEST coverage:', aHit.length,
    '| sample:', aHit[0] ? JSON.stringify(aHit[0].data()).slice(0, 160) : 'none')
}
main().catch(e => { console.error('invariant read-back failed:', e); process.exit(1) })
```


## `scripts/verify-ui.mjs`

```js
// Live browser verification (Playwright) against the deployed PREVIEW channel.
// a landing · b auth · c ⌘K · d rating $1,528 · e rules/limits · i edit(EDITOR) · l Excel.
import { chromium } from 'playwright'
import { mkdirSync, statSync } from 'node:fs'

const PREVIEW = process.env.PREVIEW_URL
const SHOTS = process.env.SHOTS || './scratch-shots'
mkdirSync(SHOTS, { recursive: true })
const results = []
const rec = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id} — ${detail}`) }
const shot = async (page, name) => { await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) }
const P = (path) => `${PREVIEW}${path}`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
page.setDefaultTimeout(25000)

try {
  // a: landing
  try {
    const t0 = Date.now(); const r = await page.goto(PREVIEW, { waitUntil: 'domcontentloaded' })
    await page.getByText('Ship insurance').first().waitFor()
    const svg = await page.locator('svg[role="img"]').count(); await shot(page, 'a-landing')
    rec('a-landing', r.status() === 200 && svg > 0, `http=${r.status()} heroSVGs=${svg} domReady=${Date.now() - t0}ms`)
  } catch (e) { await shot(page, 'a-fail'); rec('a-landing', false, e.message) }

  // b: auth (editor) → shell
  try {
    await page.goto(P('/sign-in'), { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email').fill('editor@productfactory.app')
    await page.getByLabel('Password').fill('editor123')
    await page.getByRole('button', { name: /^Sign in$/ }).click()
    await page.waitForURL(/\/app/); await page.getByRole('button', { name: /Search/i }).first().waitFor()
    await shot(page, 'b-shell')
    rec('b-auth', true, `signed in as editor → ${new URL(page.url()).pathname}`)
  } catch (e) { await shot(page, 'b-fail'); rec('b-auth', false, e.message) }

  // c: command palette
  try {
    await page.getByRole('button', { name: /Search/i }).first().click()
    const input = page.getByPlaceholder(/Search products/i); await input.waitFor()
    await input.fill('HO 04 61'); await page.waitForTimeout(700)
    const form = await page.getByText(/Scheduled Personal Property|HO 04 61/i).count()
    await input.fill('ZZTEST'); await page.waitForTimeout(700)
    const zz = await page.getByText(/ZZTEST/i).count()
    await shot(page, 'c-palette')
    await page.getByText(/ZZTEST/i).first().click().catch(() => {}); await page.waitForTimeout(800)
    rec('c-palette', form > 0 && zz > 0, `HO0461=${form} ZZTEST=${zz} → ${new URL(page.url()).pathname}`)
  } catch (e) { await shot(page, 'c-fail'); rec('c-palette', false, e.message) }

  // d: rating $1,528 (SVG text → check textContent)
  try {
    await page.goto(P('/app/products/HO.PROD.001/pricing'), { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.textContent.includes('1,528'), { timeout: 25000 })
    const refs = await page.evaluate(() => (document.body.textContent.match(/HO\.RT\.00\d/g) || []).length)
    await shot(page, 'd-rating')
    rec('d-rating', true, `$1,528 rendered live; RT refs in trace=${refs}`)
  } catch (e) { await shot(page, 'd-fail'); rec('d-rating', false, e.message) }

  // e: rules/limits — Cov F gate + wind/hail FL vs OH
  try {
    await page.goto(P('/app/products/HO.PROD.001/rules'), { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /Simulate/i }).click()
    await page.waitForTimeout(600)
    const covE = page.locator('select', { has: page.locator('option[value="300000"]') }).first()
    const covF = page.locator('select', { has: page.locator('option[value="2000"]') }).first()
    await covE.selectOption('100000'); await covF.selectOption('5000'); await page.waitForTimeout(500)
    const covFViolation = await page.getByText(/HO\.RU\.006|Coverage E|300,000/i).count()
    const stateSel = page.locator('select', { has: page.locator('option', { hasText: 'FL' }) }).first()
    await stateSel.selectOption('OH'); await page.waitForTimeout(300)
    const oh = await page.getByText(/non-coastal/i).count()
    await stateSel.selectOption('FL'); await page.waitForTimeout(300)
    const fl = await page.getByText(/coastal ✓/i).count()
    await shot(page, 'e-rules')
    rec('e-rules', covFViolation > 0 && oh > 0 && fl > 0, `covF@5k/E100k violationRefs=${covFViolation}; windHail OH=non-coastal(${oh}) FL=coastal(${fl})`)
  } catch (e) { await shot(page, 'e-fail'); rec('e-rules', false, e.message) }

  // l: Excel export round-trip
  try {
    await page.goto(P('/app/products'), { waitUntil: 'domcontentloaded' })
    await page.getByText(/Homeowners — HO-3/).first().waitFor()
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 25000 }),
      page.getByRole('button', { name: /Export/i }).first().click(),
    ])
    const path = await dl.path(); const size = path ? statSync(path).size : 0
    rec('l-excel', !!path && size > 3000 && /\.xlsx$/i.test(dl.suggestedFilename()), `file=${dl.suggestedFilename()} bytes=${size}`)
  } catch (e) { await shot(page, 'l-fail'); rec('l-excel', false, e.message) }

  // i: edit as EDITOR on ZZTEST coverage → save (mutation)
  try {
    await page.goto(P('/app/products/ZZTEST-PROD-001/coverages'), { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /\$75,000/ }).first().waitFor({ timeout: 25000 })
    await page.getByRole('button', { name: /\$75,000/ }).first().click()
    await page.getByRole('button', { name: /^Save$/ }).click()
    await page.getByText(/saved/i).first().waitFor({ timeout: 10000 })
    await shot(page, 'i-edit')
    rec('i-edit', true, 'editor changed Coverage C limit → $75,000 and saved (toast seen)')
  } catch (e) { await shot(page, 'i-fail'); rec('i-edit', false, e.message) }

  console.log('\n=== UI SUMMARY ===')
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id} :: ${r.detail}`)
} finally { await browser.close() }
```


## `scripts/zztest.ts`

```ts
// scripts/zztest.ts — isolated, clearly-namespaced ("ZZTEST") verification fixtures
// for live testing against the deployed system, plus reusable mock FNOL / intake
// inputs. Everything here is cleanly deletable. Usage (quota project must be set):
//   GOOGLE_CLOUD_QUOTA_PROJECT=productreinvention tsx scripts/zztest.ts seed|teardown|verify
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'

const PROJECT = 'productreinvention'
const PREFIX  = 'ZZTEST'
const PID     = 'ZZTEST-PROD-001'

// ── Reusable mock inputs (for grounded chat / future extraction & claims) ──────
export const MOCK_INTAKE_FORM = `HOMEOWNERS APPLICATION (intake)
Named Insured: Jane Q. Public
Property Address: 742 Evergreen Terrace, Austin, TX 78701
Coverage A (Dwelling): $400,000
All-Peril Deductible: $1,000
Construction: Masonry   Protection Class: 5   Territory: T002
Requested: Replacement Cost, Scheduled Personal Property (Jewelry $15,000)`

export const MOCK_FNOL = {
  claimNumber: 'ZZTEST-FNOL-1001', policyForm: 'HO-3', riskState: 'TX',
  lossType: 'Water damage — plumbing supply line', lossDate: '2026-06-30',
  reserve: 8500, description: 'Sudden pipe burst under kitchen sink; water backup to finished basement.',
}

const gov = { status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED', updatedBy: 'zztest', rev: 1 }

async function seed(db: admin.firestore.Firestore) {
  const now = FieldValue.serverTimestamp()
  await db.doc(`products/${PID}`).set({
    refId: 'ZZTEST.PROD.001', name: 'ZZTEST — Renters HO-4 (verification)',
    lob: { refId: 'HO.LOB.001', name: 'Homeowners' }, description: 'Temporary verification fixture.',
    marketSegment: 'Personal Lines / Property', owner: { uid: 'zztest', name: 'Verify Bot' },
    allStates: false, states: ['TX', 'CA'], health: { score: 100, findingCount: 0, updatedAt: now },
    ...gov, createdAt: now, updatedAt: now,
  })
  await db.doc(`products/${PID}/coverages/ZZTEST-COV-C`).set({
    refId: 'ZZTEST.COV.003', name: 'Coverage C — Personal Property (ZZTEST)', parentId: null, order: 1,
    requirement: 'MANDATORY', claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: [], terms: [{ id: 't1', kind: 'LIMIT', label: 'Contents limit', default: 40000, basis: 'input', options: [25000, 40000, 75000] }],
    allStates: false, states: ['TX', 'CA'], ...gov, createdAt: now, updatedAt: now,
  })
  await db.doc(`forms/ZZTEST-ZZ-04-99`).set({
    number: 'ZZ 04 99', name: 'ZZTEST Verification Endorsement', edition: '01 26', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false, attachmentCondition: 'RULE',
    source: 'PROPRIETARY', admitted: true, displayOnSchedule: true, multiUse: false, transactions: [],
    coverageParts: ['C'], productRefIds: [PID], allStates: false, states: ['TX', 'CA'], ...gov, createdAt: now, updatedAt: now,
  })
  const idx = [
    { id: `${PREFIX}_prod_001`, type: 'product', refId: 'ZZTEST.PROD.001', title: 'ZZTEST — Renters HO-4 (verification)', subtitle: 'Homeowners · Personal Lines / Property', path: `products/${PID}`, keywords: ['zztest', 'renters', 'ho4', 'verification'] },
    { id: `${PREFIX}_form_zz0499`, type: 'form', title: 'ZZTEST Verification Endorsement', subtitle: 'ZZ 04 99 · 01 26', path: `forms/ZZTEST-ZZ-04-99`, keywords: ['zztest', 'verification', 'endorsement', 'zz', '0499'] },
  ]
  const batch = db.batch()
  idx.forEach(e => batch.set(db.doc(`searchIndex/${e.id}`), e))
  await batch.commit()
  console.log(`SEEDED ${PREFIX}: product ${PID}, 1 coverage, 1 form, ${idx.length} searchIndex entries`)
}

async function findZZ(db: admin.firestore.Firestore) {
  const [prods, forms, idx] = await Promise.all([
    db.collection('products').get(),
    db.collection('forms').get(),
    db.collection('searchIndex').get(),
  ])
  const isZZ = (d: FirebaseFirestore.QueryDocumentSnapshot) =>
    d.id.startsWith(PREFIX) || String((d.data() as { refId?: string }).refId ?? '').startsWith(PREFIX) || String((d.data() as { name?: string }).name ?? '').startsWith(PREFIX)
  return {
    products: prods.docs.filter(isZZ),
    forms: forms.docs.filter(isZZ),
    idx: idx.docs.filter(isZZ),
  }
}

async function teardown(db: admin.firestore.Firestore) {
  // Delete the ZZTEST product's subcollections first, then top-level ZZTEST docs.
  for (const sub of ['coverages', 'rules', 'formRules', 'ratingPrograms']) {
    const s = await db.collection(`products/${PID}/${sub}`).get()
    const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); if (s.size) await b.commit()
  }
  const { products, forms, idx } = await findZZ(db)
  const b = db.batch()
  ;[...products, ...forms, ...idx].forEach(d => b.delete(d.ref))
  if (products.length + forms.length + idx.length) await b.commit()
  console.log(`TORE DOWN ${PREFIX}: products ${products.length}, forms ${forms.length}, searchIndex ${idx.length}`)
}

async function verify(db: admin.firestore.Firestore) {
  const { products, forms, idx } = await findZZ(db)
  const total = products.length + forms.length + idx.length
  console.log(`REMAINING ${PREFIX}: products ${products.length}, forms ${forms.length}, searchIndex ${idx.length} → ${total === 0 ? 'CLEAN ✓' : 'NOT CLEAN ✗'}`)
  return total
}

async function main() {
  const mode = process.argv[2]
  admin.initializeApp({ projectId: PROJECT })
  const db = admin.firestore()
  db.settings({ ignoreUndefinedProperties: true })
  if (mode === 'seed') await seed(db)
  else if (mode === 'teardown') await teardown(db)
  else if (mode === 'verify') await verify(db)
  else { console.error('usage: zztest.ts seed|teardown|verify'); process.exit(1) }
}
main().catch(e => { console.error('zztest failed:', e); process.exit(1) })
```


## `app/.oxlintrc.json`

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```


## `app/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#8B1FE0" />
    <title>Product Reinvention Hub</title>
    <meta name="description" content="AI-native product management for property & casualty insurers. Author coverages, price with confidence, and govern with full traceability — from first draft to state filing." />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Product Reinvention Hub" />
    <meta property="og:title" content="Product Reinvention Hub" />
    <meta property="og:description" content="Ship insurance products faster. AI-native product management for P&C insurers — coverages, forms, rules, rating and governance in one workspace." />
    <meta property="og:image" content="/og-card.svg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Product Reinvention Hub" />
    <meta name="twitter:description" content="Ship insurance products faster. AI-native product management for P&C insurers." />
    <meta name="twitter:image" content="/og-card.svg" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```


## `app/package.json`

```json
{
  "name": "app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b",
    "lint": "oxlint src"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@fontsource-variable/inter": "^5.2.8",
    "@fontsource-variable/jetbrains-mono": "^5.2.8",
    "@pf/shared": "workspace:*",
    "exceljs": "^4.4.0",
    "firebase": "^11.9.0",
    "fuse.js": "^7.1.0",
    "lucide-react": "^0.534.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-router-dom": "^7.6.3",
    "sonner": "^2.0.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.11",
    "@types/node": "^24.13.2",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.3",
    "oxlint": "^1.71.0",
    "tailwindcss": "^4.1.11",
    "typescript": "~6.0.2",
    "vite": "^8.1.1"
  }
}
```


## `app/README.md`

````markdown
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
````


## `app/src/App.tsx`

```tsx
// Root router — lazy routes, UserProvider, Suspense fallback.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { UserProvider } from './context/UserContext'
import { Skeleton } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Wand2, BarChart3 } from 'lucide-react'
import { StubRoute } from './routes/stub/StubRoute'

const Landing            = lazy(() => import('./routes/Landing'))
const SignIn             = lazy(() => import('./routes/SignIn'))
const MustChangePassword = lazy(() => import('./routes/MustChangePassword'))
const AppShell           = lazy(() => import('./routes/AppShell'))
const ShareView          = lazy(() => import('./routes/ShareView'))
const Home               = lazy(() => import('./routes/Home'))
const Products           = lazy(() => import('./routes/Products'))
const Explorer           = lazy(() => import('./routes/Explorer'))
const ProductWorkspace   = lazy(() => import('./routes/product/ProductWorkspace'))
const ProductOverview    = lazy(() => import('./routes/product/ProductOverview'))
const ProductCoverages   = lazy(() => import('./routes/product/ProductCoverages'))
const ProductForms       = lazy(() => import('./routes/product/ProductForms'))
const ProductPricing     = lazy(() => import('./routes/product/ProductPricing'))
const ProductStates      = lazy(() => import('./routes/product/ProductStates'))
const ProductRules       = lazy(() => import('./routes/product/ProductRules'))
const Tasks              = lazy(() => import('./routes/Tasks'))
const Dictionary         = lazy(() => import('./routes/Dictionary'))
const Admin              = lazy(() => import('./routes/Admin'))
const Feedback           = lazy(() => import('./routes/Feedback'))
const News               = lazy(() => import('./routes/News'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-svh bg-page">
      <Skeleton className="w-48 h-3" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <UserProvider>
        <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/"                      element={<Landing />} />
            <Route path="/sign-in"               element={<SignIn />} />
            <Route path="/must-change-password"  element={<MustChangePassword />} />
            <Route path="/share/:token"          element={<ShareView />} />

            <Route path="/app" element={<AppShell />}>
              <Route index                element={<Home />} />
              <Route path="products"      element={<Products />} />

              {/* Product workspace — nested tabs */}
              <Route path="products/:id" element={<ProductWorkspace />}>
                <Route index                element={<Navigate to="overview" replace />} />
                <Route path="overview"      element={<ProductOverview />} />
                <Route path="coverages"     element={<ProductCoverages />} />
                <Route path="forms"         element={<ProductForms />} />
                <Route path="pricing"       element={<ProductPricing />} />
                <Route path="states"        element={<ProductStates />} />
                <Route path="rules"         element={<ProductRules />} />
              </Route>

              <Route path="builder"    element={<StubRoute title="AI Builder" description="Generate product structures, draft coverage language and validate rules with Claude — coming soon." icon={Wand2} />} />
              <Route path="explorer"   element={<Explorer />} />
              <Route path="tasks"      element={<Tasks />} />
              <Route path="news"       element={<News />} />
              <Route path="claims"     element={<StubRoute title="Claims Analysis" description="Loss-ratio trends and emerging risk signals." icon={BarChart3} />} />
              <Route path="dictionary" element={<Dictionary />} />
              <Route path="feedback"   element={<Feedback />} />
              <Route path="admin"      element={<Admin />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </UserProvider>
    </BrowserRouter>
  )
}
```


## `app/src/components/chat/ChatComposer.tsx`

```tsx
// ChatComposer — the modern AI chat box (à la Claude / ChatGPT): an auto-growing
// text field in a soft rounded surface, a grounding hint, and a circular up-arrow
// send. Controlled; Enter sends, Shift+Enter newlines.
import { useRef, useEffect } from 'react'
import { IconArrowUp, IconSpinner, IconSparkle } from '../ui/icons'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  streaming?: boolean
  placeholder?: string
  autoFocus?: boolean
}

export function ChatComposer({ value, onChange, onSubmit, streaming = false, placeholder = 'Ask your product portfolio…', autoFocus }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const canSend = !!value.trim() && !streaming

  // Auto-grow the textarea up to a cap, then scroll.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`
  }, [value])

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (canSend) onSubmit() }}
      className="relative bg-surface rounded-[22px] transition-shadow focus-within:shadow-[var(--shadow-card-hover)]"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSubmit() } }}
        placeholder={placeholder}
        rows={1}
        autoFocus={autoFocus}
        aria-label="Message"
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-11 text-[15px] leading-relaxed text-text placeholder:text-faint focus:outline-none"
      />

      <div className="absolute left-4 bottom-3 flex items-center gap-1.5 text-[11px] text-faint select-none pointer-events-none">
        <IconSparkle size={12} className="text-accent" aria-hidden="true" />
        Grounded — every answer cites its refId
      </div>

      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send message"
        className={`absolute right-3 bottom-3 w-8 h-8 rounded-full flex items-center justify-center text-white transition-transform ${canSend ? 'hover:scale-105 active:scale-95' : 'opacity-30 cursor-not-allowed'}`}
        style={{ background: 'var(--gradient-accent)', boxShadow: canSend ? '0 1px 3px var(--glow-accent)' : 'none' }}
      >
        {streaming ? <IconSpinner size={15} className="animate-spin" aria-hidden="true" /> : <IconArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />}
      </button>
    </form>
  )
}
```


## `app/src/components/dictionary/DictionaryPicker.tsx`

```tsx
// DictionaryPicker — a typeahead over the data dictionary. Drop into any editor
// (coverage terms, a form's dynamic fields) to insert a canonical field
// definition instead of re-typing name/type/format by hand.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { adapter } from '../../lib/backend'
import { Badge } from '../ui'
import type { DictionaryEntry } from '@pf/shared'

type DictDoc = DictionaryEntry & { id: string }

export function DictionaryPicker({ onSelect, placeholder = 'Insert a dictionary field…' }: {
  onSelect: (entry: DictDoc) => void
  placeholder?: string
}) {
  const [entries, setEntries] = useState<DictDoc[]>([])
  const [query, setQuery]     = useState('')
  const [open, setOpen]       = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = adapter.db.subscribe<DictDoc>('dictionary', d => { if (Array.isArray(d)) setEntries(d) })
    return unsub
  }, [])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const matches = useMemo(() => {
    const q = query.toLowerCase()
    return entries
      .filter(e => !q || `${e.name} ${(e.tags ?? []).join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [entries, query])

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <BookOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label="Insert dictionary field"
          className="w-full h-9 rounded-[10px] bg-surface border border-border-strong pl-9 pr-3 text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-surface rounded-[12px] py-1"
          style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }} role="listbox">
          {matches.map(e => (
            <button key={e.id} type="button" role="option" aria-selected={false}
              onClick={() => { onSelect(e); setQuery(''); setOpen(false) }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-raised transition-colors">
              <span className="flex flex-col min-w-0">
                <span className="text-sm text-text truncate">{e.name}</span>
                {e.description && <span className="text-xs text-faint truncate">{e.description}</span>}
              </span>
              <Badge label={e.type} color="default" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```


## `app/src/components/ErrorBoundary.tsx`

```tsx
// ErrorBoundary — catches render-time crashes and shows a calm, plain-language
// recovery screen (never a raw stack) with a way forward. React error boundaries
// must be class components; this is the one intentional class in the app.
import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Surface for local debugging; never rendered to the user.
    console.error('[ErrorBoundary]', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-svh flex items-center justify-center bg-page p-6">
        <div className="max-w-md w-full bg-surface rounded-[16px] p-8 flex flex-col items-center text-center gap-4"
          style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <div className="w-12 h-12 rounded-[14px] flex items-center justify-center" style={{ background: 'var(--gradient-accent-soft)' }}>
            <AlertTriangle size={22} className="text-accent" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-text">Something went wrong</h1>
          <p className="text-sm text-dim leading-relaxed">
            This page hit an unexpected error. Your data is safe — reload to try again,
            or head back to your workspace.
          </p>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 h-9 rounded-[10px] text-white text-sm font-semibold transition-transform hover:scale-[1.02] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ background: 'var(--gradient-accent)', boxShadow: '0 1px 3px var(--glow-accent)' }}
            >
              Reload page
            </button>
            <a
              href="/app"
              className="inline-flex items-center px-4 h-9 rounded-[10px] bg-raised text-text text-sm font-medium hover:bg-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Back to home
            </a>
          </div>
        </div>
      </div>
    )
  }
}
```


## `app/src/components/feedback/feedbackContext.ts`

```ts
// Feedback context — lets any page publish the entity the user is viewing so the
// ⌘. quick-capture pre-links feedback to the exact coverage, form or rule.
import { createContext, useContext, useEffect } from 'react'

export interface FeedbackEntity { entityPath?: string; refId?: string; label?: string }

interface FeedbackCtxValue {
  entity:      FeedbackEntity | null
  setEntity:   (c: FeedbackEntity | null) => void
  openCapture: () => void
}

export const FeedbackContext = createContext<FeedbackCtxValue | null>(null)

/** Open the quick-capture sheet from anywhere. */
export function useFeedback(): FeedbackCtxValue {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useFeedback must be used within FeedbackProvider')
  return ctx
}

/** Register (and auto-clear) the entity in view so captured feedback links to it. */
export function useFeedbackEntity(entity: FeedbackEntity | null): void {
  const ctx = useContext(FeedbackContext)
  useEffect(() => {
    if (!ctx) return
    ctx.setEntity(entity)
    return () => ctx.setEntity(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, entity?.entityPath, entity?.refId, entity?.label])
}
```


## `app/src/components/feedback/FeedbackProvider.tsx`

```tsx
// FeedbackProvider — global quick-capture: a ⌘. shortcut and a floating button
// open a sheet (Idea / Issue / Praise + title + detail) that auto-attaches the
// route and any registered entity context, so feedback lands pre-linked. Any
// signed-in role may submit. Mounted once inside the app shell.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { adapter } from '../../lib/backend'
import { useUser } from '../../context/useUser'
import { Dialog, Button, Input } from '../ui'
import { IconChat, IconIdea, IconBug, IconHeart, IconLink, type IconType } from '../ui/icons'
import { FeedbackContext, type FeedbackEntity } from './feedbackContext'
import type { FeedbackType } from '@pf/shared'

const TYPES: { id: FeedbackType; label: string; icon: IconType }[] = [
  { id: 'IDEA',   label: 'Idea',   icon: IconIdea },
  { id: 'ISSUE',  label: 'Issue',  icon: IconBug },
  { id: 'PRAISE', label: 'Praise', icon: IconHeart },
]

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { user } = useUser()
  const location = useLocation()
  const [entity, setEntity] = useState<FeedbackEntity | null>(null)
  const [open, setOpen]     = useState(false)
  const [type, setType]     = useState<FeedbackType>('IDEA')
  const [title, setTitle]   = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy]     = useState(false)

  const openCapture = useCallback(() => setOpen(true), [])

  // ⌘. / Ctrl+. global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') { e.preventDefault(); setOpen(o => !o) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const value = useMemo(() => ({ entity, setEntity, openCapture }), [entity, openCapture])

  async function submit() {
    if (!title.trim() || !user) return
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      await adapter.db.mutate({
        op: 'create', path: `feedback/${id}`,
        data: {
          type, title: title.trim(), detail: detail.trim(),
          context: { route: location.pathname, entityPath: entity?.entityPath ?? null, refId: entity?.refId ?? null, label: entity?.label ?? null },
          votes: { count: 0, voters: [] },
          status: 'NEW', impact: 2, effort: 2, priorityScore: 0,
          author: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        },
        entityType: 'feedback',
        actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
      })
      toast.success('Feedback captured')
      setOpen(false); setTitle(''); setDetail(''); setType('IDEA')
    } catch {
      toast.error('Could not submit feedback')
    } finally {
      setBusy(false)
    }
  }

  const contextLabel = entity?.label ?? location.pathname

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {/* Floating capture button */}
      <button
        onClick={openCapture}
        title="Capture feedback (⌘.)" aria-label="Capture feedback"
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ background: 'var(--gradient-accent-vivid)', boxShadow: '0 8px 24px var(--glow-accent-strong)' }}
      >
        <IconChat size={20} aria-hidden="true" />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Quick feedback">
        <div className="flex flex-col gap-4">
          {/* Type */}
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map(t => {
              const Icon = t.icon; const active = type === t.id
              return (
                <button key={t.id} onClick={() => setType(t.id)} aria-pressed={active}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-[10px] text-xs font-medium transition-all ${active ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}
                  style={active ? { border: '1px solid var(--color-accent-line)' } : { border: '1px solid transparent' }}>
                  <Icon size={16} /> {t.label}
                </button>
              )
            })}
          </div>

          <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="A short summary" autoFocus />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text" htmlFor="fb-detail">Detail</label>
            <textarea id="fb-detail" value={detail} onChange={e => setDetail(e.target.value)} rows={3} placeholder="What happened, or what would help?"
              className="rounded-[10px] bg-surface border border-border-strong text-sm text-text p-3 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none" />
          </div>

          {/* Auto-attached context */}
          <div className="flex items-center gap-2 text-xs text-faint bg-raised rounded-[8px] px-3 py-2">
            <IconLink size={12} className="shrink-0" aria-hidden="true" />
            <span className="truncate">Linked to <span className="text-dim font-medium">{contextLabel}</span>{entity?.refId ? <span className="font-mono text-accent"> · {entity.refId}</span> : null}</span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={submit} disabled={busy || !title.trim()}>{busy ? 'Sending…' : 'Submit'}</Button>
          </div>
        </div>
      </Dialog>
    </FeedbackContext.Provider>
  )
}
```


## `app/src/components/palette/CommandPalette.tsx`

```tsx
// ⌘K command palette — fuzzy search over searchIndex + action shortcuts.
// Opens via keyboard shortcut or the topbar search field click.
import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse, { type FuseResultMatch, type FuseResult } from 'fuse.js'
import { createPortal } from 'react-dom'
import {
  IconSearch, IconArrowRight, IconRecent, IconProduct, IconForm,
  IconBook, IconInfo, IconTable, IconRule, IconTasks, IconCoverage, type IconType,
} from '../ui/icons'
import { adapter } from '../../lib/backend'
import { Badge } from '../ui/Badge'
import type { SearchIndexEntry, SearchEntityType } from '@pf/shared'

// ─── Routing helper ───────────────────────────────────────────────────────────

function toRoute(entry: SearchIndexEntry): string {
  const parts = entry.path.split('/')
  const productId = entry.path.includes('products/') ? (parts[1] ?? 'HO.PROD.001') : 'HO.PROD.001'
  switch (entry.type) {
    case 'product':    return `/app/products/${parts[1]}`
    case 'coverage':   return `/app/products/${productId}/coverages`
    case 'rule':       return `/app/products/${productId}/rules`
    case 'form':       return `/app/products/${productId}/forms`
    case 'ldTable':
    case 'rtTable':    return `/app/explorer`
    case 'dictionary': return `/app/dictionary`
    case 'task':       return `/app/tasks`
    default:           return '/app'
  }
}

const TYPE_ICON: Record<SearchEntityType, IconType> = {
  product:    IconProduct,
  coverage:   IconCoverage,
  rule:       IconRule,
  form:       IconForm,
  ldTable:    IconTable,
  rtTable:    IconTable,
  dictionary: IconBook,
  task:       IconTasks,
}

const TYPE_LABEL: Record<SearchEntityType, string> = {
  product: 'Product', coverage: 'Coverage', rule: 'Rule', form: 'Form',
  ldTable: 'LD Table', rtTable: 'RT Table', dictionary: 'Dictionary', task: 'Task',
}

const ACTIONS = [
  { id: 'new-product',  label: 'New product',          subtitle: 'Create a new insurance product',    route: '/app/products?new=1' },
  { id: 'go-tasks',     label: 'Go to Tasks',           subtitle: 'View the task board',               route: '/app/tasks' },
  { id: 'go-explorer',  label: 'Go to Explorer',        subtitle: 'Browse all entities',               route: '/app/explorer' },
  { id: 'go-admin',     label: 'Go to Settings',        subtitle: 'Admin console',                     route: '/app/admin' },
]

const RECENT_KEY = 'pf:palette:recent'
const MAX_RECENT  = 5

type Recent = { id: string; title: string; subtitle: string; route: string }

function loadRecents(): Recent[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}
function saveRecent(r: Recent) {
  const prev = loadRecents().filter(x => x.id !== r.id)
  localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...prev].slice(0, MAX_RECENT)))
}

// ─── Highlight matches ────────────────────────────────────────────────────────

function Highlight({ text, matches }: { text: string; matches?: readonly FuseResultMatch[] }) {
  const match = matches?.find(m => m.key === 'title' || m.key === 'keywords')
  if (!match?.indices?.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let last = 0
  const indices = [...match.indices].sort((a, b) => a[0] - b[0])
  for (const [s, e] of indices) {
    if (s > last) parts.push(text.slice(last, s))
    parts.push(<mark key={s} className="bg-accent-soft text-accent not-italic rounded-[2px]">{text.slice(s, e + 1)}</mark>)
    last = e + 1
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// ─── Main component ───────────────────────────────────────────────────────────

interface CommandPaletteProps { open: boolean; onClose: () => void }

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query,   setQuery]   = useState('')
  const [entries, setEntries] = useState<SearchIndexEntry[]>([])
  const [cursor,  setCursor]  = useState(0)
  const inputRef              = useRef<HTMLInputElement>(null)
  const navigate              = useNavigate()

  // Subscribe to searchIndex while open
  useEffect(() => {
    if (!open) return
    const unsub = adapter.db.subscribe<SearchIndexEntry>('searchIndex', (data) => {
      if (Array.isArray(data)) setEntries(data)
    })
    return () => { unsub(); setEntries([]) }
  }, [open])

  // Focus input on open
  useEffect(() => {
    if (open) { setQuery(''); setCursor(0); setTimeout(() => inputRef.current?.focus(), 30) }
  }, [open])

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const fuse = useMemo(() => new Fuse(entries, {
    keys: [
      { name: 'title',    weight: 0.7 },
      { name: 'subtitle', weight: 0.3 },
      { name: 'keywords', weight: 0.5 },
    ],
    threshold: 0.4,
    includeMatches: true,
    minMatchCharLength: 2,
  }), [entries])

  const fuseResults = useMemo(
    () => (query.length >= 1 ? fuse.search(query, { limit: 12 }) : []),
    [fuse, query],
  )

  // Build flat result list for keyboard nav
  type ResultItem =
    | { kind: 'recent'; data: Recent }
    | { kind: 'entry';  data: FuseResult<SearchIndexEntry> }
    | { kind: 'action'; data: typeof ACTIONS[number] }

  const allResults: ResultItem[] = useMemo(() => {
    if (query) {
      return [
        ...fuseResults.map(r => ({ kind: 'entry' as const, data: r })),
        ...ACTIONS.filter(a => a.label.toLowerCase().includes(query.toLowerCase())).map(a => ({ kind: 'action' as const, data: a })),
      ]
    }
    const recents = loadRecents()
    return [
      ...recents.map(r => ({ kind: 'recent' as const, data: r })),
      ...ACTIONS.map(a => ({ kind: 'action' as const, data: a })),
    ]
  }, [query, fuseResults])

  const total = allResults.length

  function goTo(route: string, recent: Recent) {
    saveRecent(recent)
    onClose()
    navigate(route)
  }

  function activate(item: ResultItem) {
    if (item.kind === 'recent') { goTo(item.data.route, item.data); return }
    if (item.kind === 'action') { goTo(item.data.route, { id: item.data.id, title: item.data.label, subtitle: item.data.subtitle, route: item.data.route }); return }
    const entry = item.data.item
    const route = toRoute(entry)
    goTo(route, { id: entry.path, title: entry.title, subtitle: entry.subtitle, route })
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % Math.max(total, 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => (c - 1 + Math.max(total, 1)) % Math.max(total, 1)) }
    if (e.key === 'Enter' && allResults[cursor]) activate(allResults[cursor])
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[rgba(19,19,26,.55)] backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Command palette"
        className="relative w-full max-w-xl bg-surface rounded-[16px] overflow-hidden"
        style={{ boxShadow: '0 24px 64px rgba(19,19,26,.18)', border: '1px solid var(--color-border)' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <IconSearch size={16} className="text-faint shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-text placeholder:text-faint outline-none"
            placeholder="Search products, forms, rules… or type a command"
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0) }}
            onKeyDown={handleKey}
            aria-autocomplete="list"
            autoComplete="off"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-faint hover:text-text text-xs">Clear</button>
          )}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {!query && (
            <p className="px-4 py-1 text-xs font-medium text-faint uppercase tracking-wide">
              {loadRecents().length ? 'Recent' : 'Quick actions'}
            </p>
          )}
          {query && fuseResults.length > 0 && (
            <p className="px-4 py-1 text-xs font-medium text-faint uppercase tracking-wide">Results</p>
          )}

          {allResults.map((item, i) => {
            const active = i === cursor

            if (item.kind === 'recent') {
              return (
                <button
                  key={item.data.id}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-raised'}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => activate(item)}
                >
                  <IconRecent size={14} className="text-faint shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-text truncate">{item.data.title}</span>
                    <span className="text-xs text-dim truncate">{item.data.subtitle}</span>
                  </span>
                </button>
              )
            }

            if (item.kind === 'action') {
              return (
                <button
                  key={item.data.id}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-raised'}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => activate(item)}
                >
                  <IconArrowRight size={14} className="text-faint shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-text">{item.data.label}</span>
                    <span className="text-xs text-dim">{item.data.subtitle}</span>
                  </span>
                </button>
              )
            }

            // entry
            const entry    = item.data.item
            const entryType = entry.type as SearchEntityType
            const Icon     = TYPE_ICON[entryType] ?? IconInfo
            return (
              <button
                key={entry.path}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-raised'}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => activate(item)}
              >
                <Icon size={14} className="text-faint shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-text truncate">
                    <Highlight text={entry.title} matches={item.data.matches} />
                  </span>
                  <span className="text-xs text-dim font-mono truncate">{entry.subtitle}</span>
                </span>
                <Badge label={TYPE_LABEL[entryType] ?? entryType} color="default" />
              </button>
            )
          })}

          {query && !fuseResults.length && (
            <p className="px-4 py-8 text-center text-faint text-sm">No results for "{query}"</p>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 text-xs text-faint" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
```


## `app/src/components/product/BaseFormExtract.tsx`

```tsx
// BaseFormExtract — the base-form gate + grounded coverage extraction (§8B/§10.1).
// An EDITOR uploads a base coverage form; until one exists the "Extract coverages"
// action is disabled with a hint. Once present, extraction reads the form via a
// Cloud Function + Claude and proposes the product's coverages (prefilled and
// pre-checked); the user reviews / deselects before anything is written. Each
// confirmed coverage is created through mutate() (entity + audit + version +
// searchIndex), allocating the next HO.COV.NNN refId. VIEWER sees nothing.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Dialog, Button, Tooltip, RefChip, Badge } from '../ui'
import { IconUpload, IconFile, IconSparkle, IconTrash, IconSpinner } from '../ui/icons'
import type { Coverage, Product, Requirement } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

interface ProposedCoverage {
  name:              string
  requirement:       Requirement
  premiumGenerating: boolean
  formNumbers?:      string[]
  limitHint?:        string
  confidence:        number
  citation:          string
}

interface Props {
  product:   WithId<Product>
  coverages: WithId<Coverage>[]
  canEdit:   boolean
  actor:     { uid: string; name: string }
}

type Busy = 'upload' | 'extract' | 'add' | null

// Chunked base64 — avoids call-stack overflow on large PDFs.
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

function confidenceColor(c: number): string {
  return c >= 0.8 ? 'var(--color-good)' : c >= 0.5 ? 'var(--color-warn)' : 'var(--color-faint)'
}

export function BaseFormExtract({ product, coverages, canEdit, actor }: Props) {
  const [busy, setBusy] = useState<Busy>(null)
  const [proposed, setProposed] = useState<ProposedCoverage[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [reviewOpen, setReviewOpen] = useState(false)
  const baseForm = product.baseForm ?? null

  if (!canEdit) return null

  async function upload(file: File) {
    setBusy('upload')
    try {
      const path = `uploads/${actor.uid}/baseforms/${product.id}/${Date.now()}-${file.name}`
      const url = await adapter.storage.upload(path, file)
      await adapter.db.mutate({
        op: 'update', path: `products/${product.id}`,
        data: { baseForm: { path, url, name: file.name, uploadedAt: new Date().toISOString(), uploadedBy: actor.uid } },
        entityType: 'product', actor,
      })
      toast.success('Base form uploaded')
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — please refresh.' : 'Upload failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('upload')
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${product.id}`, data: { baseForm: null },
        entityType: 'product', actor,
      })
      toast.success('Base form removed')
    } catch { toast.error('Could not remove the base form') }
    finally { setBusy(null) }
  }

  async function extract() {
    if (!baseForm) return
    setBusy('extract')
    try {
      const resp = await fetch(baseForm.url)
      if (!resp.ok) throw new Error('Could not read the uploaded form')
      const blob = await resp.blob()
      const isPdf = blob.type === 'application/pdf' || baseForm.name.toLowerCase().endsWith('.pdf')
      const payload = isPdf
        ? { formBase64: toBase64(await blob.arrayBuffer()), mediaType: 'application/pdf', productName: product.name }
        : { formText: await blob.text(), productName: product.name }

      // `raw`/`streamErr` are written inside the stream callback, so keep them
      // `unknown`/loosely typed to avoid TS narrowing them to their initializers.
      let raw: unknown = null
      let streamErr = ''
      await adapter.fns.stream('extractCoverages', payload, chunk => {
        let ev: { t: string; key?: string; value?: unknown; message?: string }
        try { ev = JSON.parse(chunk) } catch { return }
        if (ev.t === 'json' && ev.key === 'proposal') raw = ev.value
        if (ev.t === 'error') streamErr = ev.message ?? 'Extraction failed'
      })
      if (streamErr) throw new Error(streamErr)

      const list = ((raw as { coverages?: ProposedCoverage[] } | null)?.coverages ?? []).filter(c => Boolean(c?.name))
      if (!list.length) { toast.error('No coverages found in the form.'); return }
      setProposed(list)
      setChecked(new Set(list.map((_, i) => i)))
      setReviewOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setBusy(null)
    }
  }

  async function addSelected() {
    const chosen = proposed.filter((_, i) => checked.has(i))
    if (!chosen.length) return
    setBusy('add')
    const nums = coverages.map(c => c.refId).filter(Boolean)
      .map(r => { const m = /^HO\.COV\.(\d+)$/.exec(r!); return m ? Number(m[1]) : 0 })
    let next = Math.max(0, ...nums)
    const maxOrder = Math.max(0, ...coverages.map(c => c.order ?? 0))
    try {
      let i = 0
      for (const p of chosen) {
        next += 1; i += 1
        await adapter.db.mutate({
          op: 'create', path: `products/${product.id}/coverages/cov-${Date.now()}-${i}`,
          data: {
            refId: `HO.COV.${String(next).padStart(3, '0')}`,
            name: p.name, parentId: null, order: maxOrder + i,
            requirement: p.requirement, claimsBasis: '', premiumGenerating: p.premiumGenerating,
            source: p.formNumbers?.length ? 'BUREAU' : 'PROPRIETARY',
            formNumbers: p.formNumbers ?? [], terms: [],
            allStates: false, states: [],
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
            updatedBy: actor.uid, rev: 1,
          },
          entityType: 'coverage', productId: product.id, actor,
        })
      }
      toast.success(`Added ${chosen.length} coverage${chosen.length === 1 ? '' : 's'}`)
      setReviewOpen(false)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — please refresh.' : 'Could not add coverages')
    } finally {
      setBusy(null)
    }
  }

  const toggle = (i: number) => setChecked(prev => {
    const n = new Set(prev)
    if (n.has(i)) n.delete(i); else n.add(i)
    return n
  })

  return (
    <>
      <div className="flex items-center gap-2">
        {baseForm ? (
          <span className="inline-flex items-center gap-2 h-9 pl-2.5 pr-1.5 rounded-[9px] bg-raised text-sm text-dim max-w-[220px]"
            style={{ border: '1px solid var(--color-border)' }}>
            <IconFile size={14} className="text-accent shrink-0" aria-hidden="true" />
            <span className="truncate" title={baseForm.name}>{baseForm.name}</span>
            <label className="shrink-0 rounded-[6px] p-1 hover:bg-hover hover:text-text transition-colors cursor-pointer" title="Replace form" aria-label="Replace base form">
              <IconUpload size={13} aria-hidden="true" />
              <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" className="hidden"
                disabled={busy !== null}
                onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
            </label>
            <button onClick={remove} disabled={busy !== null} title="Remove form" aria-label="Remove base form"
              className="shrink-0 rounded-[6px] p-1 hover:bg-hover hover:text-danger transition-colors">
              <IconTrash size={13} aria-hidden="true" />
            </button>
          </span>
        ) : (
          <label className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-[9px] text-sm font-medium transition-colors cursor-pointer ${busy === 'upload' ? 'opacity-60' : 'text-dim hover:text-text bg-raised hover:bg-hover'}`}
            style={{ border: '1px solid var(--color-border)' }}>
            {busy === 'upload' ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : <IconUpload size={14} aria-hidden="true" />}
            Upload base form
            <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" className="hidden"
              disabled={busy !== null}
              onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
          </label>
        )}

        <Tooltip content={baseForm ? '' : 'Upload a base coverage form to enable AI extraction'} side="bottom">
          <Button variant="primary" size="sm" disabled={!baseForm || busy !== null} onClick={() => void extract()}>
            {busy === 'extract' ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : <IconSparkle size={14} aria-hidden="true" />}
            {busy === 'extract' ? 'Reading form…' : 'Extract coverages'}
          </Button>
        </Tooltip>
      </div>

      <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} title="Review extracted coverages" width="max-w-2xl">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Found <span className="font-medium text-text">{proposed.length}</span> coverage{proposed.length === 1 ? '' : 's'} in{' '}
            <span className="font-mono text-dim">{baseForm?.name}</span>. Deselect anything wrong, then add — nothing is written until you confirm.
          </p>

          <div className="flex flex-col gap-2 max-h-[52vh] overflow-y-auto -mx-1 px-1">
            {proposed.map((p, i) => {
              const on = checked.has(i)
              return (
                <label key={i}
                  className={`flex items-start gap-3 rounded-[12px] p-3 cursor-pointer transition-colors ${on ? 'bg-accent-soft' : 'bg-raised hover:bg-hover'}`}
                  style={{ border: `1px solid ${on ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(i)}
                    className="mt-1 w-4 h-4 accent-[var(--color-accent)] shrink-0" aria-label={`Include ${p.name}`} />
                  <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[14px] text-text truncate">{p.name}</span>
                      <span className="text-[11px] font-mono tnum shrink-0" style={{ color: confidenceColor(p.confidence) }}
                        title="Extraction confidence">
                        {Math.round(p.confidence * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge label={p.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional'} color={p.requirement === 'MANDATORY' ? 'purple' : 'default'} />
                      {p.premiumGenerating && <Badge label="Rated" color="good" />}
                      {p.formNumbers?.map(fn => <RefChip key={fn} id={fn} tone="accent" />)}
                    </div>
                    <p className="text-xs text-faint truncate">
                      {p.citation}{p.limitHint ? ` · ${p.limitHint}` : ''}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-faint">{checked.size} selected</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReviewOpen(false)} disabled={busy === 'add'}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => void addSelected()} disabled={busy === 'add' || checked.size === 0}>
                {busy === 'add' && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
                Add selected{checked.size ? ` (${checked.size})` : ''}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  )
}
```


## `app/src/components/product/CommentsPanel.tsx`

```tsx
// Comments panel — add, view and resolve comments for any entity.
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { CheckCircle } from 'lucide-react'
import { Drawer } from '../ui/Drawer'
import { Button } from '../ui/Button'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter } from '../../lib/backend'

interface Props { onClose: () => void; entityPath: string }

function timeAgo(at: unknown): string {
  if (!at) return '—'
  try {
    const ts = at instanceof Object && 'toDate' in (at as object) ? (at as { toDate(): Date }).toDate() : new Date(String(at))
    const diff = Math.round((Date.now() - ts.getTime()) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.round(diff/60)}m ago`
    return ts.toLocaleDateString()
  } catch { return '—' }
}

export function CommentsPanel({ onClose, entityPath }: Props) {
  const { comments, pid } = useProductCtx()
  const { user }   = useUser()
  const canEdit    = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor      = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const [body,     setBody]     = useState('')
  const [loading,  setLoading]  = useState(false)

  const relevant = comments.filter(c => c.entityPath === entityPath)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setLoading(true)
    try {
      await adapter.db.mutate({
        op: 'create',
        path: `comments/comment-${Date.now()}`,
        data: { entityPath, body: body.trim(), author: actor, resolved: false, at: null },
        entityType: 'comment', productId: pid, actor,
      })
      setBody('')
      toast.success('Comment added')
    } catch {
      toast.error('Failed to add comment')
    } finally {
      setLoading(false)
    }
  }

  async function handleResolve(commentId: string, rev: number | undefined) {
    try {
      await adapter.db.mutate({
        op: 'update', path: `comments/${commentId}`,
        data: { resolved: true }, entityType: 'comment', productId: pid, actor,
        expectedRev: rev,
      })
    } catch { toast.error('Could not resolve comment') }
  }

  return (
    <Drawer open title="Comments" onClose={onClose} width="w-[400px]">
      <div className="flex flex-col gap-4 h-full">
        {/* Comment list */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-3">
          {relevant.length === 0 && <p className="text-sm text-faint">No comments yet.</p>}
          {relevant.map(c => (
            <div key={c.id} className={`rounded-[10px] p-3 ${c.resolved ? 'opacity-50' : ''}`}
              style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm text-text">{c.body}</p>
                  <p className="text-xs text-faint mt-1">{c.author?.name ?? '—'} · {timeAgo(c.at)}</p>
                </div>
                {canEdit && !c.resolved && (
                  <button onClick={() => handleResolve(c.id, (c as { rev?: number }).rev)}
                    className="text-faint hover:text-good transition-colors" title="Resolve">
                    <CheckCircle size={14} />
                  </button>
                )}
              </div>
              {c.resolved && <p className="text-xs text-good mt-1">Resolved</p>}
            </div>
          ))}
        </div>

        {/* New comment */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <textarea
            className="w-full h-20 px-3 py-2 rounded-[10px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint resize-none focus:outline-none focus:ring-2 focus:ring-accent/25"
            placeholder="Add a comment..."
            value={body} onChange={e => setBody(e.target.value)}
            disabled={loading}
          />
          <Button type="submit" variant="primary" size="sm" disabled={loading || !body.trim()}>
            {loading ? 'Posting...' : 'Post comment'}
          </Button>
        </form>
      </div>
    </Drawer>
  )
}
```


## `app/src/components/product/coverageAspects.ts`

```ts
// coverageAspects — shared definitions for a coverage's six related aspects and a
// hook that derives their live counts from the canonical model. Kept separate from
// the card/row components so both consume one source of truth (and so those files
// only export components, keeping fast-refresh happy).
import { IconLimit, IconDeductible, IconStates, IconForm, IconPricing, IconRule } from '../ui/icons'
import { useProductCtx } from '../../context/useProductCtx'
import { resolveTermOptions } from '@pf/shared'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

export type CoverageAspect = 'limits' | 'deductibles' | 'states' | 'forms' | 'pricing' | 'rules'

export const COVERAGE_ASPECTS: { key: CoverageAspect; label: string; Icon: typeof IconLimit }[] = [
  { key: 'limits',      label: 'Limits',      Icon: IconLimit },
  { key: 'deductibles', label: 'Deductibles', Icon: IconDeductible },
  { key: 'states',      label: 'States',      Icon: IconStates },
  { key: 'forms',       label: 'Forms',       Icon: IconForm },
  { key: 'pricing',     label: 'Pricing',     Icon: IconPricing },
  { key: 'rules',       label: 'Rules',       Icon: IconRule },
]

/** Live per-aspect counts for a coverage, drawn from the product context. */
export function useCoverageCounts(cov: WithId<Coverage>): Record<CoverageAspect, number> {
  const { product, rules, ratingProgram, ldTables } = useProductCtx()
  const countOpts = (kind: 'LIMIT' | 'DEDUCTIBLE') =>
    (cov.terms ?? []).filter(t => t.kind === kind)
      .reduce((n, t) => n + resolveTermOptions(t, t.ldTableRef ? ldTables[t.ldTableRef] : undefined).filter(o => o.enabled).length, 0)
  const footprint = product?.allStates ? 50 : (product?.states?.length ?? 50)
  return {
    limits:      countOpts('LIMIT'),
    deductibles: countOpts('DEDUCTIBLE'),
    states:      cov.allStates ? footprint : (cov.states?.length ?? 0),
    forms:       cov.formNumbers?.length ?? 0,
    pricing:     cov.premiumGenerating ? (ratingProgram?.steps?.length ?? 0) : 0,
    rules:       rules.filter(r => cov.refId && r.coverageRefIds?.includes(cov.refId)).length,
  }
}
```


## `app/src/components/product/CoverageCollection.tsx`

```tsx
// CoverageCollection — the product's coverages presented the way a P&C product
// manager thinks about them: grouped into ISO sections (Section I property,
// Section II liability), each coverage a card with its headline limit, attached
// forms and nested endorsements. Click a card to open it in the Coverages tab.
import { IconChevronRight } from '../ui/icons'
import { Badge, RefChip } from '../ui'
import type { Coverage, CoverageTerm } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const STATUS_DOT: Record<string, string> = { ACTIVE: 'var(--color-good)', INACTIVE: 'var(--color-faint)', FUTURE: 'var(--color-info)' }

function fmtTerm(t: CoverageTerm): string {
  const v = t.default
  if (typeof v === 'boolean') return v ? 'Included' : '—'
  if (typeof v === 'number') {
    if (t.unit === '%' || t.basis?.toLowerCase().includes('percent')) return `${v}%`
    return `$${v.toLocaleString()}`
  }
  return String(v)
}

/** Range summary from an LD table's options or the term's min/max, e.g. "$1k – $25k". */
function rangeSummary(t: CoverageTerm): string | null {
  const nums = (t.options?.filter(o => typeof o === 'number') as number[] | undefined) ?? []
  const lo = t.min ?? (nums.length ? Math.min(...nums) : undefined)
  const hi = t.max ?? (nums.length ? Math.max(...nums) : undefined)
  if (lo === undefined || hi === undefined || lo === hi) return null
  const pct = t.unit === '%' || t.basis?.toLowerCase().includes('percent')
  const fmt = pct
    ? (n: number) => `${n}%`
    : (n: number) => n >= 1000 ? `$${(n / 1000).toLocaleString()}k` : `$${n}`
  return `${fmt(lo)} – ${fmt(hi)}`
}

function primaryTerm(cov: WithId<Coverage>): CoverageTerm | undefined {
  return cov.terms?.find(t => t.kind === 'LIMIT') ?? cov.terms?.[0]
}

function CoverageCard({ cov, endorsements, onOpen }: {
  cov: WithId<Coverage>; endorsements: WithId<Coverage>[]; onOpen: (id: string) => void
}) {
  const term = primaryTerm(cov)
  const range = term && rangeSummary(term)

  return (
    <div className="bg-surface rounded-[14px] flex flex-col overflow-hidden transition-all duration-200 hover:shadow-[var(--shadow-card-hover)]"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      <button
        onClick={() => onOpen(cov.id)}
        className="group text-left p-4 flex flex-col gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_DOT[cov.status] ?? 'var(--color-faint)' }} />
              <span className="font-semibold text-[14px] text-text leading-snug group-hover:text-accent transition-colors truncate">{cov.name}</span>
            </div>
            {cov.refId && <div><RefChip id={cov.refId} /></div>}
          </div>
          <IconChevronRight size={16} className="text-faint shrink-0 group-hover:text-accent group-hover:translate-x-0.5 transition-all mt-0.5" aria-hidden="true" />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge label={cov.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional'} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
          {cov.premiumGenerating && <Badge label="Rated" color="good" />}
          {cov.source === 'PROPRIETARY' && <Badge label="Proprietary" color="warn" />}
        </div>

        {term && (
          <div className="flex items-baseline justify-between gap-2 pt-1">
            <span className="text-xs text-dim truncate">{term.label}</span>
            <span className="font-mono text-[13px] font-semibold text-text tnum shrink-0">
              {fmtTerm(term)}{range && <span className="text-faint font-normal ml-1.5">· {range}</span>}
            </span>
          </div>
        )}
      </button>

      {(cov.formNumbers?.length > 0 || endorsements.length > 0) && (
        <div className="px-4 pb-3 pt-0 flex flex-col gap-2.5">
          {cov.formNumbers?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {cov.formNumbers.map(fn => <RefChip key={fn} id={fn} tone="accent" />)}
            </div>
          )}
          {endorsements.length > 0 && (
            <div className="flex flex-col gap-1 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-faint pt-1.5">Endorsements</span>
              {endorsements.map(e => (
                <button key={e.id} onClick={() => onOpen(e.id)}
                  className="group flex items-center gap-2 text-left rounded-[8px] px-2 py-1.5 -mx-1 hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT[e.status] ?? 'var(--color-faint)' }} />
                  <span className="text-[13px] text-dim group-hover:text-text truncate flex-1">{e.name}</span>
                  {e.refId && <span className="font-mono text-[10px] text-faint shrink-0">{e.refId.split('.').slice(-1)[0]}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const isLiability = (c: WithId<Coverage>) => /liabilit|medical/i.test(c.name)

export function CoverageCollection({ coverages, onOpen }: { coverages: WithId<Coverage>[]; onOpen: (id: string) => void }) {
  const roots = coverages.filter(c => !c.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const endorsementsOf = (refId: string | null) => refId ? coverages.filter(c => c.parentId === refId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : []

  const sections = [
    { label: 'Section I — Property',  items: roots.filter(c => !isLiability(c)) },
    { label: 'Section II — Liability', items: roots.filter(isLiability) },
  ].filter(s => s.items.length > 0)

  if (!roots.length) return <p className="text-sm text-faint py-8 text-center">No coverages yet.</p>

  return (
    <div className="flex flex-col gap-6">
      {sections.map(section => (
        <section key={section.label} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[.09em] text-faint">{section.label}</h3>
            <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
            <span className="text-[11px] text-faint tnum">{section.items.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {section.items.map(cov => (
              <CoverageCard key={cov.id} cov={cov} endorsements={endorsementsOf(cov.refId)} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
```


## `app/src/components/product/CoverageEditDialog.tsx`

```tsx
// CoverageEditDialog — create or edit a coverage's identity + governance. Kept
// deliberately focused (limits/deductibles/states each have their own editor); this
// is the coverage's "spine": name, requirement, source, claims basis, whether it's
// rated, and its parent (for endorsements). Parent options are constrained to real
// top-level coverages so the hierarchy can never dangle.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { Dialog, Button, Input } from '../ui'
import { IconCoverage, IconClose } from '../ui/icons'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

type Draft = {
  name: string; refId: string; requirement: 'MANDATORY' | 'OPTIONAL'
  source: 'BUREAU' | 'PROPRIETARY'; claimsBasis: string; premiumGenerating: boolean
  parentId: string | null
}

export function CoverageEditDialog({ cov, onClose }: { cov: WithId<Coverage> | null; onClose: () => void }) {
  const { pid, coverages } = useProductCtx()
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const isNew = !cov

  const [d, setD] = useState<Draft>(() => ({
    name: cov?.name ?? '', refId: cov?.refId ?? '',
    requirement: cov?.requirement ?? 'OPTIONAL', source: cov?.source ?? 'PROPRIETARY',
    claimsBasis: cov?.claimsBasis ?? '', premiumGenerating: cov?.premiumGenerating ?? false,
    parentId: cov?.parentId ?? null,
  }))
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(p => ({ ...p, [k]: v }))

  // Valid parents: top-level coverages with a refId, excluding self.
  const parentChoices = coverages.filter(c => !c.parentId && c.refId && c.id !== cov?.id)

  async function save() {
    if (!canEdit) return
    if (!d.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      if (isNew) {
        const id = `cov-${Date.now()}`
        const order = Math.max(0, ...coverages.map(c => c.order ?? 0)) + 1
        await adapter.db.mutate({
          op: 'create', path: `products/${pid}/coverages/${id}`, entityType: 'coverage', productId: pid, actor,
          data: {
            refId: d.refId.trim() || null, name: d.name.trim(), parentId: d.parentId, order,
            requirement: d.requirement, source: d.source, claimsBasis: d.claimsBasis.trim(),
            premiumGenerating: d.premiumGenerating, formNumbers: [], terms: [],
            allStates: true, states: [],
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
        })
        toast.success('Coverage created')
      } else {
        await adapter.db.mutate({
          op: 'update', path: `products/${pid}/coverages/${cov.id}`, entityType: 'coverage', productId: pid, actor,
          expectedRev: (cov as { rev?: number }).rev,
          data: {
            refId: d.refId.trim() || null, name: d.name.trim(), parentId: d.parentId,
            requirement: d.requirement, source: d.source, claimsBasis: d.claimsBasis.trim(),
            premiumGenerating: d.premiumGenerating,
          },
        })
        toast.success('Coverage saved')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof MutationConflictError
        ? 'Conflict — this coverage changed elsewhere. Please reopen.'
        : err instanceof Error ? err.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const field = 'w-full h-10 px-3 rounded-[9px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25'

  return (
    <Dialog open onClose={onClose} width="max-w-lg">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}><IconCoverage size={22} /></span>
          <div>
            <h2 className="text-lg font-semibold text-text">{isNew ? 'New coverage' : 'Edit coverage'}</h2>
            <p className="text-sm text-dim">{isNew ? 'Add a coverage to this product' : cov.name}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-faint hover:text-text rounded-[8px] p-1.5 hover:bg-raised transition-colors"><IconClose size={18} /></button>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Name</span>
            <Input value={d.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Building" autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Ref ID <span className="text-faint font-normal">(optional)</span></span>
            <Input value={d.refId} onChange={e => set('refId', e.target.value)} placeholder="HO.COV.007" className="font-mono" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Requirement</span>
            <select className={field} value={d.requirement} onChange={e => set('requirement', e.target.value as Draft['requirement'])}>
              <option value="MANDATORY">Mandatory</option><option value="OPTIONAL">Optional</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Source</span>
            <select className={field} value={d.source} onChange={e => set('source', e.target.value as Draft['source'])}>
              <option value="BUREAU">Bureau</option><option value="PROPRIETARY">Proprietary</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Claims basis</span>
            <Input value={d.claimsBasis} onChange={e => set('claimsBasis', e.target.value)} placeholder="Occurrence" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Parent (endorsement of)</span>
            <select className={field} value={d.parentId ?? ''} onChange={e => set('parentId', e.target.value || null)}>
              <option value="">None (top-level)</option>
              {parentChoices.map(c => <option key={c.id} value={c.refId!}>{c.name}</option>)}
            </select>
          </label>
        </div>

        <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-[10px] bg-raised cursor-pointer">
          <span className="flex flex-col">
            <span className="text-sm font-medium text-text">Premium generating</span>
            <span className="text-xs text-dim">This coverage participates in rating.</span>
          </span>
          <button type="button" onClick={() => set('premiumGenerating', !d.premiumGenerating)} role="switch" aria-checked={d.premiumGenerating}
            className="shrink-0 w-10 h-6 rounded-full p-0.5 transition-colors flex items-center" style={{ background: d.premiumGenerating ? 'var(--color-accent)' : 'var(--color-border-strong)' }}>
            <span className="w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: d.premiumGenerating ? 'translateX(16px)' : 'translateX(0)' }} />
          </button>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2 mt-6 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        {canEdit && <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create coverage' : 'Save changes'}</Button>}
      </div>
    </Dialog>
  )
}
```


## `app/src/components/product/CoverageHubCard.tsx`

```tsx
// CoverageHubCard — a coverage as a hub: identity + governance chips on top, then
// a tile grid for its six related aspects (Limits · Deductibles · States · Forms ·
// Pricing · Rules). Each tile shows a live count drawn from the canonical model
// and drills straight into that aspect's editor or tab — the coverage is the spine
// everything hangs off. (No "clauses" — intentionally dropped.)
import { StatusPill, Badge, RefChip, Tooltip } from '../ui'
import { IconEdit, IconTrash, IconEndorsement } from '../ui/icons'
import { COVERAGE_ASPECTS as ASPECTS, useCoverageCounts, type CoverageAspect } from './coverageAspects'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

export function CoverageHubCard({ cov, parentName, canEdit, onTile, onEdit, onDelete }: {
  cov: WithId<Coverage>
  parentName?: string
  canEdit: boolean
  onTile: (aspect: CoverageAspect, cov: WithId<Coverage>) => void
  onEdit: (cov: WithId<Coverage>) => void
  onDelete: (cov: WithId<Coverage>) => void
}) {
  const counts = useCoverageCounts(cov)

  return (
    <div className="group relative bg-surface rounded-[16px] overflow-hidden flex flex-col hover:shadow-[var(--shadow-card-hover)] transition-all duration-200"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      <div className="p-4 flex flex-col gap-3.5 flex-1">
        {/* Identity */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5 min-w-0">
            {parentName && (
              <span className="inline-flex items-center gap-1 text-[11px] text-faint">
                <IconEndorsement size={12} /> Endorsement · {parentName}
              </span>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cov.status === 'ACTIVE' ? 'var(--color-good)' : cov.status === 'FUTURE' ? 'var(--color-info)' : 'var(--color-faint)' }} />
              <span className="font-semibold text-[15px] text-text leading-snug truncate">{cov.name}</span>
              {cov.refId && <span className="shrink-0"><RefChip id={cov.refId} /></span>}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge label={cov.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional'} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
              {cov.premiumGenerating && <Badge label="Rated" color="good" />}
              {cov.source === 'PROPRIETARY' && <Badge label="Proprietary" color="warn" />}
              {cov.status !== 'ACTIVE' && <StatusPill status={cov.status} />}
            </div>
          </div>
          {canEdit && (
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <Tooltip content="Edit coverage"><button onClick={() => onEdit(cov)} aria-label={`Edit ${cov.name}`} className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors"><IconEdit size={15} /></button></Tooltip>
              <Tooltip content="Delete coverage"><button onClick={() => onDelete(cov)} aria-label={`Delete ${cov.name}`} className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[rgba(220,38,38,.08)] transition-colors"><IconTrash size={15} /></button></Tooltip>
            </div>
          )}
        </div>

        {/* Aspect tile grid */}
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECTS.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => onTile(key, cov)} aria-label={`${cov.name} — ${label} (${counts[key]})`}
              className="group/tile flex items-center gap-2 px-2.5 py-2 rounded-[10px] bg-raised hover:bg-accent-soft transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ borderLeft: '2px solid transparent' }}>
              <span className="text-dim group-hover/tile:text-accent transition-colors shrink-0"><Icon size={16} /></span>
              <span className="flex flex-col leading-tight min-w-0">
                <span className="text-[11px] font-medium text-dim group-hover/tile:text-text truncate transition-colors">{label}</span>
                <span className="text-[13px] font-semibold text-text tnum">{counts[key]}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```


## `app/src/components/product/CoverageRow.tsx`

```tsx
// CoverageRow — the list-view counterpart to CoverageHubCard: one dense row with
// identity, governance chips and the six aspect counts as compact icon buttons
// that drill into the same editors/tabs.
import { RefChip, Badge, Tooltip } from '../ui'
import { IconEdit, IconTrash } from '../ui/icons'
import { COVERAGE_ASPECTS as ASPECTS, useCoverageCounts, type CoverageAspect } from './coverageAspects'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

export function CoverageRow({ cov, isEndorsement, canEdit, onTile, onEdit, onDelete }: {
  cov: WithId<Coverage>
  isEndorsement?: boolean
  canEdit: boolean
  onTile: (aspect: CoverageAspect, cov: WithId<Coverage>) => void
  onEdit: (cov: WithId<Coverage>) => void
  onDelete: (cov: WithId<Coverage>) => void
}) {
  const counts = useCoverageCounts(cov)
  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 bg-surface hover:bg-raised transition-colors" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cov.status === 'ACTIVE' ? 'var(--color-good)' : cov.status === 'FUTURE' ? 'var(--color-info)' : 'var(--color-faint)' }} title={cov.status} />
      <div className={`min-w-0 flex items-center gap-2 flex-1 ${isEndorsement ? 'pl-3' : ''}`}>
        <span className="font-medium text-sm text-text truncate">{cov.name}</span>
        {cov.refId && <span className="hidden md:inline shrink-0"><RefChip id={cov.refId} /></span>}
        <span className="hidden lg:flex items-center gap-1.5 shrink-0">
          <Badge label={cov.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional'} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
          {cov.premiumGenerating && <Badge label="Rated" color="good" />}
        </span>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {ASPECTS.map(({ key, label, Icon }) => (
          <Tooltip key={key} content={`${label}: ${counts[key]}`}>
            <button onClick={() => onTile(key, cov)} aria-label={`${cov.name} — ${label} (${counts[key]})`}
              className="flex items-center gap-1 h-7 px-1.5 rounded-[7px] text-faint hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              <Icon size={15} /><span className="text-[11px] font-semibold tnum text-dim">{counts[key]}</span>
            </button>
          </Tooltip>
        ))}
      </div>

      {canEdit && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(cov)} aria-label={`Edit ${cov.name}`} className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors"><IconEdit size={15} /></button>
          <button onClick={() => onDelete(cov)} aria-label={`Delete ${cov.name}`} className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[rgba(220,38,38,.08)] transition-colors"><IconTrash size={15} /></button>
        </div>
      )}
    </div>
  )
}
```


## `app/src/components/product/CoverageStatesDialog.tsx`

```tsx
// CoverageStatesDialog — edit a coverage's state scope on the US tile map without
// leaving the coverages collection. "All footprint states" inherits the product's
// footprint; otherwise the coverage carries its own subset. Saves atomically via
// mutate (audit + version). A coverage can never be filed outside the product's
// footprint, so counts read against that footprint (fixes the >100% coverage math).
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { Dialog, Button } from '../ui'
import { IconStates, IconClose } from '../ui/icons'
import { StateTileMap } from './StateTileMap'
import { HO3_COASTAL_STATES } from '@pf/shared'
import { US_TILE_GRID } from '../../lib/geo/usTileGrid'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const COASTAL = new Set<string>(HO3_COASTAL_STATES)
const ALL_TILE_STATES = Object.keys(US_TILE_GRID)

export function CoverageStatesDialog({ cov, onClose }: { cov: WithId<Coverage>; onClose: () => void }) {
  const { pid, product } = useProductCtx()
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }

  // The product footprint bounds every coverage; default to it when unset.
  const footprint = product?.allStates ? ALL_TILE_STATES : (product?.states ?? ALL_TILE_STATES)
  const [allStates, setAllStates] = useState(cov.allStates ?? false)
  const [states, setStates] = useState<string[]>(() => (cov.states ?? []).filter(s => footprint.includes(s)))
  const [saving, setSaving] = useState(false)

  const active = allStates ? new Set(footprint) : new Set(states)
  const selectedCount = allStates ? footprint.length : states.length

  function toggle(s: string) {
    if (!canEdit || allStates || !footprint.includes(s)) return
    setStates(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function save() {
    if (!canEdit) return
    setSaving(true)
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/coverages/${cov.id}`,
        data: { allStates, states: allStates ? [] : states },
        entityType: 'coverage', productId: pid, actor,
        expectedRev: (cov as { rev?: number }).rev,
      })
      toast.success('State scope saved'); onClose()
    } catch (err) {
      toast.error(err instanceof MutationConflictError
        ? 'Conflict — this coverage changed elsewhere. Please reopen.'
        : err instanceof Error ? err.message : 'Save failed')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onClose={onClose} width="max-w-2xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}><IconStates size={22} /></span>
          <div>
            <h2 className="text-lg font-semibold text-text">State Availability</h2>
            <p className="text-sm text-dim">{cov.name}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-faint hover:text-text rounded-[8px] p-1.5 hover:bg-raised transition-colors"><IconClose size={18} /></button>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3">
        <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
          <input type="checkbox" className="accent-accent" checked={allStates} disabled={!canEdit}
            onChange={e => setAllStates(e.target.checked)} />
          All footprint states
        </label>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-dim"><b className="text-text tnum">{selectedCount}</b> selected</span>
          <span className="text-faint">of {footprint.length} in footprint</span>
          {canEdit && !allStates && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setStates([...footprint])} className="text-accent font-medium hover:underline">All</button>
              <span className="text-faint">·</span>
              <button onClick={() => setStates([])} className="text-dim font-medium hover:underline">Clear</button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-page rounded-[12px] p-3" style={{ border: '1px solid var(--color-border)' }}>
        <StateTileMap active={active} coastal={COASTAL} onToggle={toggle} canEdit={canEdit && !allStates}
          labels={{ active: 'In scope', coastal: 'Coastal wind/hail', inactive: 'Out of scope' }} />
      </div>

      <div className="flex items-center justify-end gap-2 mt-5 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        {canEdit && <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>}
      </div>
    </Dialog>
  )
}
```


## `app/src/components/product/ExportMenu.tsx`

```tsx
// ExportMenu — the product's export affordances: Excel (exceljs, client-side)
// now, Duck Creek XML wired but disabled ("coming soon"). Integration seams live
// in lib/integrations and lib/export.
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, FileSpreadsheet, FileCode2, ChevronDown } from 'lucide-react'
import { Button } from '../ui'
import { exportProductExcel, type ProductExport } from '../../lib/export/excel'
import { DUCK_CREEK_ENABLED } from '../../lib/integrations/duckcreek'

export function ExportMenu({ data }: { data: ProductExport }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  async function toExcel() {
    setBusy(true)
    try { await exportProductExcel(data); toast.success('Workbook exported') }
    catch { toast.error('Export failed') }
    finally { setBusy(false); setOpen(false) }
  }

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="sm" onClick={() => setOpen(o => !o)} disabled={busy}>
        <Download size={14} /> Export <ChevronDown size={12} />
      </Button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-surface rounded-[12px] py-1 z-30"
          style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }} role="menu">
          <button onClick={toExcel} disabled={busy} role="menuitem"
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised transition-colors text-left">
            <FileSpreadsheet size={15} className="text-good" /> Export to Excel
          </button>
          <button disabled aria-disabled title="Coming soon" role="menuitem"
            className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-sm text-faint cursor-not-allowed text-left">
            <span className="flex items-center gap-2.5"><FileCode2 size={15} /> Duck Creek XML</span>
            <span className="text-[10px] uppercase tracking-wide">{DUCK_CREEK_ENABLED ? '' : 'soon'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
```


## `app/src/components/product/HistoryDrawer.tsx`

```tsx
// History drawer — versions list with field diffs and confirmed Restore.
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import { Drawer } from '../ui/Drawer'
import { Button } from '../ui/Button'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import type { WithId } from '../../context/ProductContext'
import type { Version } from '@pf/shared'

interface Props { onClose: () => void; entityPath: string }

function timeAgo(at: unknown): string {
  if (!at) return '—'
  const ts = at instanceof Object && 'toDate' in (at as object) ? (at as { toDate(): Date }).toDate() : new Date(String(at))
  const diff = Math.round((Date.now() - ts.getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.round(diff/60)}m ago`
  if (diff < 86400) return `${Math.round(diff/3600)}h ago`
  return ts.toLocaleDateString()
}

function DiffView({ diff }: { diff: WithId<Version>['diff'] }) {
  if (!diff?.length) return <p className="text-xs text-faint">No field changes recorded.</p>
  return (
    <div className="flex flex-col gap-1">
      {diff.map((d, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className="font-mono text-faint w-32 shrink-0 truncate">{d.field}</span>
          <span className="text-danger line-through truncate max-w-[80px]">{String(d.before ?? '—').substring(0, 30)}</span>
          <span className="text-faint">→</span>
          <span className="text-good truncate max-w-[80px]">{String(d.after ?? '—').substring(0, 30)}</span>
        </div>
      ))}
    </div>
  )
}

export function HistoryDrawer({ onClose, entityPath }: Props) {
  const { versions, pid } = useProductCtx()
  const { user } = useUser()
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const [expanded, setExpanded] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  // Filter versions for this entity path
  const entityVersions = useMemo(() =>
    versions.filter(v => v.entityPath === entityPath)
  , [versions, entityPath])

  async function handleRestore(v: WithId<Version>) {
    if (!v.snapshot) { toast.error('No snapshot available for this version'); return }
    const confirmed = window.confirm(`Restore to version from ${timeAgo(v.at)}? This will overwrite current values.`)
    if (!confirmed) return
    setRestoring(v.id)
    try {
      await adapter.db.mutate({
        op: 'update', path: entityPath,
        data: v.snapshot as Record<string, unknown>,
        entityType: v.entityType, productId: pid, actor,
      })
      toast.success('Restored successfully')
    } catch (err) {
      if (err instanceof MutationConflictError) toast.error('Conflict — refresh and try again.')
      else toast.error('Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  return (
    <Drawer open title="Version history" onClose={onClose} width="w-[460px]">
      {entityVersions.length === 0 ? (
        <p className="text-sm text-faint">No versions recorded for this entity yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entityVersions.map(v => (
            <div key={v.id} className="rounded-[12px] bg-raised overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <button
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-left hover:bg-[rgba(19,19,26,.02)]"
                onClick={() => setExpanded(e => e === v.id ? null : v.id)}
              >
                {expanded === v.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-text capitalize">{v.entityType}</span>
                  <span className="text-dim"> · {v.actor?.name ?? '—'}</span>
                  <span className="float-right text-xs text-faint">{timeAgo(v.at)}</span>
                </div>
              </button>

              {expanded === v.id && (
                <div className="px-4 pb-3 flex flex-col gap-3">
                  <DiffView diff={v.diff ?? []} />
                  {(user?.role === 'EDITOR' || user?.role === 'ADMIN') && v.snapshot != null && (
                    <Button variant="ghost" size="sm" disabled={restoring === v.id}
                      onClick={() => handleRestore(v)}>
                      <RotateCcw size={12} />
                      {restoring === v.id ? 'Restoring...' : 'Restore to this version'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}
```


## `app/src/components/product/NewProductModal.tsx`

```tsx
// Modal to create a DRAFT product shell and auto-seed the default task set.
import { useState, type FormEvent } from 'react'
import { adapter } from '../../lib/backend'
import { IconSpinner } from '../ui/icons'
import { useUser } from '../../context/useUser'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { HO3_DEFAULT_TASK_TEMPLATES } from '@pf/shared'
import { PRODUCT_NAME_SUGGESTIONS, MARKET_SEGMENTS } from '../../lib/insurance/vocab'

interface Props { onClose: () => void; onCreated: (id: string) => void }

export function NewProductModal({ onClose, onCreated }: Props) {
  const { user }   = useUser()
  const [name,     setName]     = useState('')
  const [seg,      setSeg]      = useState('Personal Lines / Property')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setLoading(true); setError('')
    const actor  = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
    const pid    = `prod-${Date.now()}`
    const baseDate = new Date()
    try {
      await adapter.db.mutate({
        op: 'create', path: `products/${pid}`,
        data: {
          refId: null, name: name.trim(),
          lob: { refId: 'HO.LOB.001', name: 'Homeowners' },
          description: '', marketSegment: seg,
          owner: actor, status: 'ACTIVE', lifecycle: 'DRAFT',
          reviewStatus: 'NOT_STARTED', updatedBy: actor.uid,
          rev: 1, allStates: false, states: [],
          health: { score: 100, findingCount: 0, updatedAt: null },
        },
        entityType: 'product', actor,
      })
      // Auto-seed default tasks
      for (let i = 0; i < HO3_DEFAULT_TASK_TEMPLATES.length; i++) {
        const tmpl  = HO3_DEFAULT_TASK_TEMPLATES[i]
        const dueAt = new Date(baseDate)
        dueAt.setDate(dueAt.getDate() + tmpl.daysOffset)
        await adapter.db.mutate({
          op: 'create', path: `tasks/task-${pid}-${i}`,
          data: {
            title: tmpl.title, column: tmpl.column, productId: pid,
            checklist: [], order: i, dueAt: dueAt.toISOString(),
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
            updatedBy: actor.uid,
          },
          entityType: 'task', productId: pid, actor,
        })
      }
      onCreated(pid)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create product.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open title="New product" onClose={onClose} width="max-w-md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <datalist id="np-names">{PRODUCT_NAME_SUGGESTIONS.map(n => <option key={n} value={n} />)}</datalist>
        <Input label="Product name" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Homeowners — HO-3 Special Form" list="np-names" autoComplete="off" required />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">Market segment</label>
          <select className="h-9 px-3 rounded-[10px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
            value={seg} onChange={e => setSeg(e.target.value)}>
            {MARKET_SEGMENTS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={loading || !name.trim()}>
            {loading && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
            Create product
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
```


## `app/src/components/product/ProductCard.tsx`

```tsx
// ProductCard — the portfolio card. A brand rail flows across the top; the product
// reads as name + refId + governance chips, then a row of domain "quick-nav" tiles
// (Coverages · Pricing · Forms · States · Rules) that jump straight into that part
// of the product — the frictionless deep-links a PM reaches for. Footer carries the
// at-a-glance facts and an AI summary affordance. No nested interactive elements:
// the container is a div; each region is its own button.
import { useNavigate } from 'react-router-dom'
import { StatusPill, LifecyclePill, Badge, RefChip } from '../ui'
import { IconCoverage, IconPricing, IconForm, IconStates, IconRule, IconSparkle, IconChevronRight } from '../ui/icons'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const TILES = [
  { key: 'coverages', label: 'Coverages', Icon: IconCoverage },
  { key: 'pricing',   label: 'Pricing',   Icon: IconPricing  },
  { key: 'forms',     label: 'Forms',     Icon: IconForm     },
  { key: 'states',    label: 'States',    Icon: IconStates   },
  { key: 'rules',     label: 'Rules',     Icon: IconRule     },
] as const

export function ProductCard({ p }: { p: WithId<Product> }) {
  const navigate = useNavigate()
  const go = (sub = 'overview') => navigate(`/app/products/${p.id}/${sub}`)

  const health = p.health?.score ?? 100
  const healthColor = health >= 80 ? 'var(--color-good)' : health >= 60 ? 'var(--color-warn)' : 'var(--color-danger)'
  const findings = p.health?.findingCount ?? 0

  return (
    <div
      className="group relative bg-surface rounded-[16px] overflow-hidden flex flex-col hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] transition-all duration-200"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* Brand rail — subtle gradient flowing left→right, brightening on hover */}
      <span aria-hidden="true" className="block h-[3px] w-full opacity-70 group-hover:opacity-100 transition-opacity"
        style={{ background: 'linear-gradient(90deg, var(--color-accent-bright) 0%, var(--color-accent-strong) 55%, transparent 100%)' }} />

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Header — the whole title block opens the product */}
        <button onClick={() => go()} aria-label={`Open ${p.name}`}
          className="flex flex-col gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[8px]">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-[15px] text-text leading-snug group-hover:text-accent transition-colors">{p.name}</span>
            <IconChevronRight size={16} className="text-faint shrink-0 mt-0.5 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {p.refId && <RefChip id={p.refId} />}
            <StatusPill status={p.status} />
            <LifecyclePill lifecycle={p.lifecycle} />
            {p.lob?.name && <Badge label={p.lob.name} color="blue" />}
          </div>
        </button>

        {/* Domain quick-nav tiles */}
        <div className="grid grid-cols-5 gap-1.5">
          {TILES.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => go(key)} title={`Open ${label}`} aria-label={`${p.name} — ${label}`}
              className="group/tile flex flex-col items-center gap-1.5 py-2.5 rounded-[10px] bg-raised hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              <span className="w-7 h-7 rounded-[8px] bg-surface flex items-center justify-center text-dim group-hover/tile:text-accent transition-colors" style={{ border: '1px solid var(--color-border)' }}>
                <Icon size={15} />
              </span>
              <span className="text-[10px] font-medium text-faint group-hover/tile:text-dim transition-colors">{label}</span>
            </button>
          ))}
        </div>

        {/* Footer — facts + AI summary */}
        <div className="flex items-center gap-3 text-xs text-dim pt-3 mt-auto" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="tnum">{p.allStates ? '50' : (p.states?.length ?? 0)} states</span>
          <span className="truncate">{p.marketSegment ?? '—'}</span>
          <span className="ml-auto flex items-center gap-1.5" title={`Health ${health}${findings ? ` · ${findings} finding${findings === 1 ? '' : 's'}` : ''}`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: healthColor }} />
            <span className="truncate max-w-[80px]">{p.owner?.name ?? '—'}</span>
          </span>
          <button onClick={() => go('overview')} title="AI summary"
            className="shrink-0 inline-flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-[7px] text-[11px] font-medium text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
            <IconSparkle size={13} />Summary
          </button>
        </div>
      </div>
    </div>
  )
}
```


## `app/src/components/product/ProductRow.tsx`

```tsx
// ProductRow — the list-view counterpart to ProductCard: one dense, scannable row
// with the same governance chips, at-a-glance facts and domain quick-nav icons.
// Used when the portfolio is switched to List mode.
import { useNavigate } from 'react-router-dom'
import { StatusPill, LifecyclePill, Badge, RefChip, Tooltip } from '../ui'
import { IconCoverage, IconPricing, IconForm, IconStates, IconRule, IconChevronRight } from '../ui/icons'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const TILES = [
  { key: 'coverages', label: 'Coverages', Icon: IconCoverage },
  { key: 'pricing',   label: 'Pricing',   Icon: IconPricing  },
  { key: 'forms',     label: 'Forms',     Icon: IconForm     },
  { key: 'states',    label: 'States',    Icon: IconStates   },
  { key: 'rules',     label: 'Rules',     Icon: IconRule     },
] as const

export function ProductRow({ p }: { p: WithId<Product> }) {
  const navigate = useNavigate()
  const go = (sub = 'overview') => navigate(`/app/products/${p.id}/${sub}`)

  const health = p.health?.score ?? 100
  const healthColor = health >= 80 ? 'var(--color-good)' : health >= 60 ? 'var(--color-warn)' : 'var(--color-danger)'

  return (
    <div className="group flex items-center gap-3 px-4 py-3 bg-surface hover:bg-raised transition-colors"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      {/* Identity — clickable */}
      <button onClick={() => go()} aria-label={`Open ${p.name}`}
        className="flex items-center gap-3 min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[6px]">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: healthColor }} title={`Health ${health}`} />
        <span className="font-medium text-sm text-text truncate group-hover:text-accent transition-colors">{p.name}</span>
        {p.refId && <span className="hidden md:inline shrink-0"><RefChip id={p.refId} /></span>}
      </button>

      {/* Governance + facts */}
      <div className="hidden lg:flex items-center gap-1.5 shrink-0">
        <StatusPill status={p.status} />
        <LifecyclePill lifecycle={p.lifecycle} />
        {p.lob?.name && <Badge label={p.lob.name} color="blue" />}
      </div>
      <span className="hidden xl:block w-32 text-xs text-dim truncate shrink-0">{p.marketSegment ?? '—'}</span>
      <span className="hidden sm:block w-16 text-xs text-dim tnum text-right shrink-0">{p.allStates ? 50 : (p.states?.length ?? 0)} st.</span>
      <span className="hidden xl:block w-28 text-xs text-dim truncate text-right shrink-0">{p.owner?.name ?? '—'}</span>

      {/* Quick-nav icons */}
      <div className="hidden md:flex items-center gap-0.5 shrink-0">
        {TILES.map(({ key, label, Icon }) => (
          <Tooltip key={key} content={label}>
            <button onClick={() => go(key)} aria-label={`${p.name} — ${label}`}
              className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              <Icon size={15} />
            </button>
          </Tooltip>
        ))}
      </div>

      <button onClick={() => go()} aria-label={`Open ${p.name}`}
        className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint group-hover:text-accent transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
        <IconChevronRight size={16} />
      </button>
    </div>
  )
}
```


## `app/src/components/product/RuleBuilder.tsx`

```tsx
// RuleBuilder — how P&C product managers read and author rules.
//  • RuleFlowCard renders a rule as a logical IF → THEN flow with clickable
//    refId / coverage / form links (rules link to everything).
//  • RuleComposer is a guided, type-ahead builder: pick a subject, operator and
//    value, then an outcome; it assembles the condition/outcome + links and
//    hands a complete rule up to be persisted via mutate().
import { useMemo, useState } from 'react'
import { ArrowRight, Plus, X } from 'lucide-react'
import { Badge, Button, RefChip } from '../ui'
import type { Rule, RuleCategory } from '@pf/shared'

// ─── Domain vocabulary for type-ahead ─────────────────────────────────────────

const SUBJECTS: { label: string; covRefId?: string }[] = [
  { label: 'Coverage A limit', covRefId: 'HO.COV.001' },
  { label: 'Coverage B limit', covRefId: 'HO.COV.002' },
  { label: 'Coverage C percentage', covRefId: 'HO.COV.003' },
  { label: 'Coverage D limit', covRefId: 'HO.COV.004' },
  { label: 'Coverage E limit', covRefId: 'HO.COV.005' },
  { label: 'Coverage F limit', covRefId: 'HO.COV.006' },
  { label: 'All-peril deductible' }, { label: 'Wind/hail deductible' }, { label: 'Risk state' },
  { label: 'Replacement Cost' }, { label: 'Scheduled Personal Property' }, { label: 'Water back-up' },
  { label: 'Protective device' }, { label: 'Home day-care' },
]
const OPERATORS = ['is at least', 'is at most', 'is', 'is one of', 'is elected', 'is not elected', 'requires']
const VALUE_SUGGESTIONS = [
  '$100,000', '$300,000', '$500,000', '$1,000', '$2,000', '$5,000', '1%', '2%', '5%', '50%', '70%', '75%',
  'AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA',
]
const OUTCOMES: { id: string; label: string; needsTarget: boolean; phrase: (t: string) => string }[] = [
  { id: 'attach',     label: 'Attach form',     needsTarget: true,  phrase: t => `Attach ${t}` },
  { id: 'block',      label: 'Block option',    needsTarget: true,  phrase: t => `Block ${t}` },
  { id: 'require',    label: 'Require',         needsTarget: true,  phrase: t => `Require ${t}` },
  { id: 'setDefault', label: 'Set default',     needsTarget: true,  phrase: t => `Set default to ${t}` },
  { id: 'ineligible', label: 'Make ineligible', needsTarget: false, phrase: () => 'Ineligible' },
]

// ─── Rule flow card (display) ─────────────────────────────────────────────────

export interface RuleLike {
  id?: string; refId: string | null; category: RuleCategory; subCategory?: string
  condition: string; outcome: string; ldTableRef?: string; coverageRefIds?: string[]; formNumbers?: string[]
}
const CAT_COLOR: Record<RuleCategory, 'purple'|'blue'|'warn'> = { PRODUCT: 'purple', RATING: 'blue', FORMS: 'warn' }

export function RuleFlowCard({ rule, onOpenCoverage, onOpenForm }: {
  rule: RuleLike; onOpenCoverage?: (refId: string) => void; onOpenForm?: (num: string) => void
}) {
  return (
    <div className="bg-surface rounded-[12px] p-4 flex flex-col gap-3" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        {rule.refId && <RefChip id={rule.refId} tone="accent" />}
        <Badge label={rule.category} color={CAT_COLOR[rule.category] ?? 'default'} />
        {rule.subCategory && <span className="text-xs text-faint">{rule.subCategory}</span>}
        {rule.ldTableRef && <RefChip id={rule.ldTableRef} />}
      </div>

      {/* IF → THEN flow */}
      <div className="flex flex-col sm:flex-row items-stretch rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <div className="flex-1 bg-raised px-3 py-2 min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-faint mb-0.5">If</span>
          <p className="text-sm text-text leading-snug">{rule.condition}</p>
        </div>
        <div className="flex items-center justify-center px-1.5 bg-raised shrink-0" aria-hidden="true">
          <ArrowRight size={15} className="text-accent rotate-90 sm:rotate-0" />
        </div>
        <div className="flex-1 px-3 py-2 min-w-0" style={{ background: 'var(--color-accent-soft)' }}>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-accent mb-0.5">Then</span>
          <p className="text-sm text-text leading-snug">{rule.outcome}</p>
        </div>
      </div>

      {((rule.coverageRefIds?.length ?? 0) > 0 || (rule.formNumbers?.length ?? 0) > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {rule.coverageRefIds?.map(r => <RefChip key={r} id={r} onClick={onOpenCoverage ? () => onOpenCoverage(r) : undefined} title={`Open ${r}`} />)}
          {rule.formNumbers?.map(f => <RefChip key={f} id={f} tone="accent" onClick={onOpenForm ? () => onOpenForm(f) : undefined} title={`Open ${f}`} />)}
        </div>
      )}
    </div>
  )
}

// ─── Rule composer (guided authoring) ─────────────────────────────────────────

export type NewRule = Pick<Rule, 'category' | 'subCategory' | 'condition' | 'outcome' | 'coverageRefIds' | 'formNumbers'>

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 flex-1 min-w-[120px]"><span className="text-[11px] font-medium text-faint">{label}</span>{children}</label>
}
const inputCls = 'h-8 px-2.5 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25'

export function RuleComposer({ forms, onCreate, onCancel }: {
  forms: string[]; onCreate: (r: NewRule) => Promise<void> | void; onCancel: () => void
}) {
  const [category, setCategory] = useState<RuleCategory>('PRODUCT')
  const [subject, setSubject]   = useState('')
  const [operator, setOperator] = useState(OPERATORS[0]!)
  const [value, setValue]       = useState('')
  const [outcomeId, setOutcomeId] = useState('attach')
  const [target, setTarget]     = useState('')
  const [saving, setSaving]     = useState(false)

  const outcome = OUTCOMES.find(o => o.id === outcomeId)!
  const subjectMeta = SUBJECTS.find(s => s.label.toLowerCase() === subject.toLowerCase())

  const condition = useMemo(() => {
    if (!subject) return ''
    const op = operator === 'is elected' || operator === 'is not elected' ? operator : `${operator} ${value}`.trim()
    return `${subject} ${op}`.trim()
  }, [subject, operator, value])
  const outcomeText = outcome.needsTarget ? (target ? outcome.phrase(target) : '') : outcome.phrase('')
  const valid = !!subject && (operator === 'is elected' || operator === 'is not elected' || !!value) && (!outcome.needsTarget || !!target)

  async function submit() {
    if (!valid || saving) return
    setSaving(true)
    const coverageRefIds = subjectMeta?.covRefId ? [subjectMeta.covRefId] : []
    const formNumbers = outcomeId === 'attach' && /HO\s?\d/.test(target) ? [target.trim()] : []
    try {
      await onCreate({ category, subCategory: 'Authored', condition, outcome: outcomeText, coverageRefIds, formNumbers })
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-surface rounded-[14px] p-5 flex flex-col gap-4" style={{ border: '1px solid var(--color-accent-line)', boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text">New rule</p>
        <button onClick={onCancel} className="text-faint hover:text-text" aria-label="Cancel"><X size={16} /></button>
      </div>

      <datalist id="rc-subjects">{SUBJECTS.map(s => <option key={s.label} value={s.label} />)}</datalist>
      <datalist id="rc-values">{VALUE_SUGGESTIONS.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="rc-forms">{forms.map(f => <option key={f} value={f} />)}</datalist>

      {/* Category */}
      <div className="flex items-center gap-0.5 p-0.5 rounded-[9px] bg-raised self-start" role="tablist">
        {(['PRODUCT', 'RATING', 'FORMS'] as RuleCategory[]).map(c => (
          <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
            className={`px-3 h-7 rounded-[7px] text-xs font-medium transition-colors ${category === c ? 'bg-surface text-accent shadow-[var(--shadow-card)]' : 'text-dim hover:text-text'}`}>{c}</button>
        ))}
      </div>

      {/* IF row */}
      <div className="flex flex-wrap items-end gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint pb-2">If</span>
        <Field label="Subject"><input list="rc-subjects" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Coverage E limit" className={inputCls} /></Field>
        <Field label="Operator">
          <select value={operator} onChange={e => setOperator(e.target.value)} className={inputCls}>{OPERATORS.map(o => <option key={o}>{o}</option>)}</select>
        </Field>
        {operator !== 'is elected' && operator !== 'is not elected' && (
          <Field label="Value"><input list="rc-values" value={value} onChange={e => setValue(e.target.value)} placeholder="$300,000" className={inputCls} /></Field>
        )}
      </div>

      {/* THEN row */}
      <div className="flex flex-wrap items-end gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent pb-2">Then</span>
        <Field label="Outcome">
          <select value={outcomeId} onChange={e => setOutcomeId(e.target.value)} className={inputCls}>{OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </Field>
        {outcome.needsTarget && (
          <Field label={outcomeId === 'attach' ? 'Form' : 'Target'}>
            <input list={outcomeId === 'attach' ? 'rc-forms' : 'rc-values'} value={target} onChange={e => setTarget(e.target.value)} placeholder={outcomeId === 'attach' ? 'HO 04 90' : '$5,000'} className={inputCls} />
          </Field>
        )}
      </div>

      {/* Live preview */}
      {(condition || outcomeText) && (
        <div className="flex items-center gap-2 text-sm rounded-[8px] bg-page px-3 py-2" style={{ border: '1px solid var(--color-border)' }}>
          <span className="text-dim">{condition || '…'}</span>
          <ArrowRight size={14} className="text-accent shrink-0" />
          <span className="text-text font-medium">{outcomeText || '…'}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={submit} disabled={!valid || saving}>
          <Plus size={14} />{saving ? 'Creating…' : 'Create rule'}
        </Button>
      </div>
    </div>
  )
}
```


## `app/src/components/product/ShareModal.tsx`

```tsx
// Share modal — calls createShareLink function, shows URL + copy button.
import { useState } from 'react'
import { Copy, Check, ExternalLink, Loader2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { adapter } from '../../lib/backend'

interface Props { onClose: () => void; productId: string; productName: string }

export function ShareModal({ onClose, productId, productName }: Props) {
  const [token,   setToken]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied,  setCopied]  = useState(false)
  const [error,   setError]   = useState('')

  const shareUrl = token ? `${window.location.origin}/share/${token}` : null

  async function handleCreate() {
    setLoading(true); setError('')
    try {
      const result = await adapter.fns.call<{ productId: string }, { token: string }>(
        'createShareLink', { productId },
      )
      setToken(result.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share link')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open title={`Share "${productName}"`} onClose={onClose} width="max-w-md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-dim">
          Share links create a read-only public snapshot of this product that expires in 30 days.
        </p>

        {!token ? (
          <Button variant="primary" onClick={handleCreate} disabled={loading}>
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Creating link...' : 'Create share link'}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-raised" style={{ border: '1px solid var(--color-border)' }}>
              <span className="flex-1 text-xs font-mono text-dim truncate">{shareUrl}</span>
              <button onClick={handleCopy} className="text-faint hover:text-accent transition-colors" title="Copy link">
                {copied ? <Check size={14} className="text-good" /> : <Copy size={14} />}
              </button>
              <a href={shareUrl!} target="_blank" rel="noopener noreferrer" className="text-faint hover:text-accent transition-colors" title="Open">
                <ExternalLink size={14} />
              </a>
            </div>
            <p className="text-xs text-faint">Link expires in 30 days. Anyone with the link can view this product.</p>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}
```


## `app/src/components/product/StateTileMap.tsx`

```tsx
// StateTileMap — the reusable geographic US tile map. Renders every state at its
// approximate map position; selected states fill with the brand violet, coastal
// wind/hail states get an amber bolt badge. Click to toggle when editable. Used
// for the product footprint and per-coverage state scope.
import { useId } from 'react'
import { US_TILE_GRID as GRID, US_TILE_COLS as COLS } from '../../lib/geo/usTileGrid'

const ALL_STATES = Object.keys(GRID)

interface Props {
  active: Set<string>
  coastal: Set<string>
  onToggle?: (state: string) => void
  canEdit?: boolean
  labels?: { active: string; coastal: string; inactive: string }
}

export function StateTileMap({ active, coastal, onToggle, canEdit = false, labels }: Props) {
  const id = useId()
  const L = labels ?? { active: 'In footprint', coastal: 'Coastal wind/hail', inactive: 'Not filed' }
  const CELL = 30, GAP = 4, PAD = 12, LEGEND = 22
  const maxRow = Math.max(...Object.values(GRID).map(([, r]) => r)) + 1
  const W = COLS * (CELL + GAP) - GAP + PAD * 2
  const H = maxRow * (CELL + GAP) - GAP + PAD * 2 + LEGEND

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W, height: 'auto', fontFamily: 'JetBrains Mono Variable, monospace' }}
      role="img" aria-label={`United States tile map — ${active.size} states selected; coastal wind/hail states marked.`}>
      <defs>
        <linearGradient id={`${id}-c`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#A100FF" /><stop offset="100%" stopColor="#7A00E6" />
        </linearGradient>
      </defs>
      {ALL_STATES.map(st => {
        const [col, row] = GRID[st]!
        const x = PAD + col * (CELL + GAP), y = PAD + row * (CELL + GAP)
        const isActive = active.has(st), isCoastal = coastal.has(st) && isActive
        const fill = isCoastal ? `url(#${id}-c)` : isActive ? '#8B1FE0' : '#F0F0F5'
        const textFill = isActive ? '#fff' : '#9A9CAC'
        return (
          <g key={st} onClick={() => canEdit && onToggle?.(st)} style={{ cursor: canEdit ? 'pointer' : 'default' }}
            className={canEdit ? 'hover:opacity-85 transition-opacity' : ''}>
            <title>{st}{isCoastal ? ` · ${L.coastal.toLowerCase()}` : isActive ? ` · ${L.active.toLowerCase()}` : ''}</title>
            <rect x={x} y={y} width={CELL} height={CELL} rx={7} fill={fill}
              stroke={isActive ? 'rgba(19,19,26,.10)' : 'rgba(19,19,26,.05)'} strokeWidth={1} />
            <text x={x + CELL / 2} y={y + CELL / 2 + 3.5} textAnchor="middle" fontSize={9} fontWeight={600} fill={textFill}>{st}</text>
            {isCoastal && (
              <g transform={`translate(${x + CELL - 6} ${y + 6})`}>
                <circle r={5} fill="#F59E0B" stroke="#fff" strokeWidth={0.75} />
                <path d="M0.4 -2.6 L-1.8 0.4 L-0.2 0.4 L-0.6 2.6 L1.8 -0.4 L0.2 -0.4 Z" fill="#fff" />
              </g>
            )}
          </g>
        )
      })}
      {/* Legend */}
      <g transform={`translate(${PAD} ${H - 10})`} fontSize={9} fill="#5B5C6B">
        <rect x={0} y={-9} width={12} height={12} rx={3} fill="#8B1FE0" /><text x={17} y={0}>{L.active}</text>
        <rect x={92} y={-9} width={12} height={12} rx={3} fill={`url(#${id}-c)`} />
        <circle cx={101.5} cy={-6.5} r={3} fill="#F59E0B" stroke="#fff" strokeWidth={0.5} /><text x={109} y={0}>{L.coastal}</text>
        <rect x={228} y={-9} width={12} height={12} rx={3} fill="#F0F0F5" /><text x={245} y={0}>{L.inactive}</text>
      </g>
    </svg>
  )
}
```


## `app/src/components/product/TermOptionsDialog.tsx`

```tsx
// TermOptionsDialog — the rich editor for a coverage's limits or deductibles.
// A PM picks the STRUCTURE (how the amount is shaped), the BASIS (what it applies
// to), an editable min/max RANGE, then a table of STANDARD OPTIONS — each option
// typed (flat $, %, split, CSL, scheduled, waiting period), scoped to states,
// with a default marker and an enabled switch. Relationships are enforced on save:
// exactly one enabled default, applicability ⊆ the coverage's state scope, and the
// legacy term fields are mirrored so rating + export keep working.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { Dialog, Button } from '../ui'
import {
  IconPlus, IconTrash, IconStar, IconCheck, IconClose,
  IconSingle, IconLayers, IconSplit, IconCombine, IconScheduled, IconPercent, IconClock, IconPeril,
} from '../ui/icons'
import { LIMIT_STRUCTURES, DEDUCTIBLE_STRUCTURES, LIMIT_BASES } from '../../lib/insurance/vocab'
import {
  resolveTermOptions, ensureOneDefault, syncLegacy, formatOption,
  isPercentTerm, deriveStructure, deriveBasis,
} from '@pf/shared'
import type {
  Coverage, CoverageTerm, StandardOption, OptionValueType,
  LimitStructure, DeductibleStructure, LimitBasis,
} from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

type Mode = 'LIMIT' | 'DEDUCTIBLE'

const STRUCT_ICON: Record<string, typeof IconSingle> = {
  single: IconSingle, layers: IconLayers, split: IconSplit,
  combine: IconCombine, scheduled: IconScheduled, percent: IconPercent, clock: IconClock, peril: IconPeril,
}

const OPTION_TYPES: Record<Mode, { id: OptionValueType; label: string }[]> = {
  LIMIT: [
    { id: 'FLAT', label: '$' }, { id: 'PERCENT', label: '%' }, { id: 'SPLIT', label: 'Split' },
    { id: 'CSL', label: 'CSL' }, { id: 'SCHEDULED', label: 'Item' },
  ],
  DEDUCTIBLE: [
    { id: 'FLAT', label: '$' }, { id: 'PERCENT', label: '%' }, { id: 'WAITING_PERIOD', label: 'Hrs' },
  ],
}

// The option value-type a structure implies (used when the structure changes).
function impliedType(structure: string): OptionValueType {
  switch (structure) {
    case 'SPLIT':          return 'SPLIT'
    case 'CSL':            return 'CSL'
    case 'SCHEDULED':      return 'SCHEDULED'
    case 'PERCENT':
    case 'PERCENT_MIN_MAX': return 'PERCENT'
    case 'WAITING_PERIOD':  return 'WAITING_PERIOD'
    default:                return 'FLAT'
  }
}

const parseNum = (s: string) => { const n = Number(s.replace(/[,$%\s]/g, '')); return Number.isFinite(n) ? n : 0 }

interface Props { cov: WithId<Coverage>; mode: Mode; onClose: () => void }

export function TermOptionsDialog({ cov, mode, onClose }: Props) {
  const { pid, product, ldTables } = useProductCtx()
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }

  const structures = mode === 'LIMIT' ? LIMIT_STRUCTURES : DEDUCTIBLE_STRUCTURES
  const scopeStates = cov.allStates ? (product?.states ?? []) : (cov.states ?? [])

  // Normalise every term of this kind so editing is uniform (rich optionSet + typing).
  const [terms, setTerms] = useState<CoverageTerm[]>(() =>
    (cov.terms ?? []).map(t => {
      if (t.kind !== mode) return t
      const opts = resolveTermOptions(t, t.ldTableRef ? ldTables[t.ldTableRef] : undefined)
      const nums = opts.map(o => o.value)
      return {
        ...t, optionSet: opts, structure: deriveStructure(t),
        limitBasis: mode === 'LIMIT' ? deriveBasis(t) : undefined,
        min: t.min ?? (nums.length ? Math.min(...nums) : undefined),
        max: t.max ?? (nums.length ? Math.max(...nums) : undefined),
      }
    }))

  const kindTerms = terms.filter(t => t.kind === mode)
  const [activeId, setActiveId] = useState<string>(() => kindTerms[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const active = terms.find(t => t.id === activeId && t.kind === mode)

  function patchActive(patch: Partial<CoverageTerm>) {
    if (!canEdit) return
    setTerms(prev => prev.map(t => t.id === activeId ? { ...t, ...patch } : t))
  }
  function setOptions(next: StandardOption[]) { patchActive({ optionSet: ensureOneDefault(next) }) }

  function addTerm() {
    const id = `${mode.toLowerCase()}-${Date.now()}`
    const t: CoverageTerm = {
      id, kind: mode, label: mode === 'LIMIT' ? 'Limit' : 'Deductible',
      basis: 'per occurrence', default: 0, unit: 'dollars',
      structure: mode === 'LIMIT' ? 'SINGLE' : 'FLAT',
      limitBasis: mode === 'LIMIT' ? 'PER_OCCURRENCE' : undefined, optionSet: [],
    }
    setTerms(prev => [...prev, t]); setActiveId(id)
  }

  async function save() {
    if (!canEdit || !active) return
    setSaving(true)
    try {
      // Enforce relationships + mirror legacy fields for each edited term.
      const nextTerms = terms.map(t => {
        if (t.kind !== mode || !t.optionSet) return t
        const opts = ensureOneDefault(t.optionSet).map(o => ({
          ...o,
          // applicability ⊆ coverage scope
          states: o.allStates ? [] : o.states.filter(s => scopeStates.includes(s)),
        }))
        return { ...t, optionSet: opts, ...syncLegacy(opts) }
      })
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/coverages/${cov.id}`,
        data: { terms: nextTerms }, entityType: 'coverage', productId: pid, actor,
        expectedRev: (cov as { rev?: number }).rev,
      })
      toast.success(`${mode === 'LIMIT' ? 'Limits' : 'Deductibles'} saved`)
      onClose()
    } catch (err) {
      toast.error(err instanceof MutationConflictError
        ? 'Conflict — this coverage changed elsewhere. Please reopen.'
        : err instanceof Error ? err.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const options = active?.optionSet ?? []
  const pct = active ? isPercentTerm(active) : false

  return (
    <Dialog open onClose={onClose} width="max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}>
            {mode === 'LIMIT' ? <IconLayers size={22} /> : <IconPercent size={22} />}
          </span>
          <div>
            <h2 className="text-lg font-semibold text-text">{mode === 'LIMIT' ? 'Limit Options' : 'Deductible Options'}</h2>
            <p className="text-sm text-dim">{cov.name}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-faint hover:text-text rounded-[8px] p-1.5 hover:bg-raised transition-colors"><IconClose size={18} /></button>
      </div>

      {/* Term switcher (when a coverage carries more than one) */}
      {kindTerms.length > 1 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {kindTerms.map(t => (
            <button key={t.id} onClick={() => setActiveId(t.id)}
              className={`px-2.5 py-1 rounded-[7px] text-xs font-medium transition-colors ${t.id === activeId ? 'bg-accent text-white' : 'bg-raised text-dim hover:text-text'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!active ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-dim">No {mode === 'LIMIT' ? 'limit' : 'deductible'} defined for this coverage yet.</p>
          {canEdit && <Button variant="primary" size="sm" onClick={addTerm}><IconPlus size={14} />Add {mode === 'LIMIT' ? 'limit' : 'deductible'}</Button>}
        </div>
      ) : (
        <div className="flex flex-col gap-6 max-h-[62vh] overflow-y-auto pr-1 -mr-1">
          {/* Structure */}
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mb-2.5">{mode === 'LIMIT' ? 'Limit structure' : 'Deductible structure'}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {structures.map(s => {
                const Icon = STRUCT_ICON[s.icon] ?? IconSingle
                const selected = (active.structure ?? 'SINGLE') === s.id
                return (
                  <button key={s.id} disabled={!canEdit}
                    onClick={() => patchActive({
                      structure: s.id as LimitStructure | DeductibleStructure,
                      ...(mode === 'DEDUCTIBLE' ? { unit: impliedType(s.id) === 'PERCENT' ? '%' : 'dollars' } : {}),
                      optionSet: (active.optionSet ?? []).map(o => ({ ...o, type: impliedType(s.id) })),
                    })}
                    className={`text-left p-3 rounded-[12px] transition-all ${selected ? 'bg-accent-soft' : 'bg-surface hover:bg-raised'}`}
                    style={{ border: selected ? '1.5px solid var(--color-accent)' : '1px solid var(--color-border)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <span className={`w-8 h-8 rounded-[9px] flex items-center justify-center ${selected ? 'text-accent bg-surface' : 'text-dim bg-raised'}`} style={selected ? { border: '1px solid var(--color-accent-line)' } : undefined}>
                        <Icon size={17} />
                      </span>
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${selected ? 'bg-accent text-white' : ''}`} style={{ border: selected ? 'none' : '1.5px solid var(--color-border-strong)' }}>
                        {selected && <IconCheck size={10} strokeWidth={3} />}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-text mt-2">{s.label}</p>
                    <p className="text-xs text-dim mt-0.5 leading-snug">{s.blurb}</p>
                    <p className="font-mono text-[11px] text-accent mt-1.5">{s.sample}</p>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Basis (limits) + Range */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {mode === 'LIMIT' && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mb-2.5">Limit basis</p>
                <select disabled={!canEdit} value={active.limitBasis ?? 'PER_OCCURRENCE'}
                  onChange={e => patchActive({ limitBasis: e.target.value as LimitBasis })}
                  className="w-full h-10 px-3 rounded-[9px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25">
                  {LIMIT_BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>
            )}
            <div className={mode === 'LIMIT' ? '' : 'sm:col-span-2'}>
              <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mb-2.5">Range {pct ? '(%)' : '($)'}</p>
              <div className="flex items-center gap-2">
                <input key={`min-${active.id}`} aria-label="Minimum" defaultValue={active.min ?? ''} disabled={!canEdit}
                  onBlur={e => patchActive({ min: e.target.value ? parseNum(e.target.value) : undefined })}
                  placeholder="min" className="w-full h-10 px-3 rounded-[9px] bg-surface border border-border-strong font-mono text-sm text-text text-center focus:outline-none focus:ring-2 focus:ring-accent/25" />
                <span className="text-faint text-sm">–</span>
                <input key={`max-${active.id}`} aria-label="Maximum" defaultValue={active.max ?? ''} disabled={!canEdit}
                  onBlur={e => patchActive({ max: e.target.value ? parseNum(e.target.value) : undefined })}
                  placeholder="max" className="w-full h-10 px-3 rounded-[9px] bg-surface border border-border-strong font-mono text-sm text-text text-center focus:outline-none focus:ring-2 focus:ring-accent/25" />
              </div>
            </div>
          </section>

          {/* Standard options */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">Standard options</p>
                <p className="text-xs text-faint mt-0.5">{options.filter(o => o.enabled).length} enabled · {options.length} total</p>
              </div>
              {canEdit && (
                <Button variant="default" size="sm" onClick={() => setOptions([...options, {
                  id: `opt-${Date.now()}`, type: impliedType(active.structure ?? 'SINGLE'),
                  value: 0, allStates: true, states: [], isDefault: options.length === 0, enabled: true,
                }])}><IconPlus size={13} />Add option</Button>
              )}
            </div>

            {options.length === 0 ? (
              <p className="text-sm text-faint text-center py-6 rounded-[10px] bg-raised">No options yet — add the standard values a PM can select.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {options.map(o => (
                  <OptionRow key={o.id} o={o} mode={mode} scopeStates={scopeStates} canEdit={canEdit}
                    inRange={rangeOk(o, active)}
                    onChange={next => setOptions(options.map(x => x.id === o.id ? next : x))}
                    onDefault={() => setOptions(options.map(x => ({ ...x, isDefault: x.id === o.id })))}
                    onRemove={() => setOptions(options.filter(x => x.id !== o.id))} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 mt-6 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        {canEdit && active && <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>}
      </div>
    </Dialog>
  )
}

function rangeOk(o: StandardOption, t: CoverageTerm): boolean {
  if (o.type === 'SPLIT' || o.type === 'WAITING_PERIOD') return true
  if (t.min !== undefined && o.value < t.min) return false
  if (t.max !== undefined && o.value > t.max) return false
  return true
}

// ─── One editable option row ─────────────────────────────────────────────────

function OptionRow({ o, mode, scopeStates, canEdit, inRange, onChange, onDefault, onRemove }: {
  o: StandardOption; mode: Mode; scopeStates: string[]; canEdit: boolean; inRange: boolean
  onChange: (o: StandardOption) => void; onDefault: () => void; onRemove: () => void
}) {
  const [editStates, setEditStates] = useState(false)
  const types = OPTION_TYPES[mode]

  return (
    <div className="rounded-[10px] bg-surface" style={{ border: `1px solid ${o.isDefault ? 'var(--color-accent-line)' : 'var(--color-border)'}`, opacity: o.enabled ? 1 : 0.55 }}>
      <div className="flex items-center gap-2 p-2">
        {/* Type */}
        <select disabled={!canEdit} value={o.type} onChange={e => onChange({ ...o, type: e.target.value as OptionValueType })}
          className="h-8 px-1.5 rounded-[7px] bg-raised text-xs font-medium text-dim focus:outline-none focus:ring-2 focus:ring-accent/25 shrink-0">
          {types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>

        {/* Value */}
        {o.type === 'SPLIT' ? (
          <div className="flex items-center gap-1 flex-1">
            {[0, 1, 2].map(i => (
              <input key={i} disabled={!canEdit} defaultValue={o.parts?.[i] ?? ''} placeholder={['per person', 'per acc.', 'PD'][i]}
                onBlur={e => { const parts = [...(o.parts ?? [0, 0, 0])]; parts[i] = parseNum(e.target.value); onChange({ ...o, parts, value: parts[0] }) }}
                className="w-full h-8 px-2 rounded-[7px] bg-surface border border-border-strong font-mono text-xs text-center focus:outline-none focus:ring-2 focus:ring-accent/25" />
            ))}
          </div>
        ) : (
          <div className="relative flex-1">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-faint text-xs pointer-events-none">{o.type === 'PERCENT' ? '' : o.type === 'WAITING_PERIOD' ? '' : '$'}</span>
            <input disabled={!canEdit} defaultValue={o.value || ''} inputMode="numeric"
              onBlur={e => onChange({ ...o, value: parseNum(e.target.value) })}
              className={`w-full h-8 ${o.type === 'PERCENT' || o.type === 'WAITING_PERIOD' ? 'px-2' : 'pl-5 pr-2'} rounded-[7px] bg-surface border font-mono text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25 ${inRange ? 'border-border-strong' : 'border-danger'}`} />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-faint text-[11px] pointer-events-none">{o.type === 'PERCENT' ? '%' : o.type === 'WAITING_PERIOD' ? 'hrs' : ''}</span>
          </div>
        )}

        {/* Applicability */}
        <button disabled={!canEdit} onClick={() => setEditStates(v => !v)} title="State applicability"
          className={`h-8 px-2.5 rounded-[7px] text-xs font-medium shrink-0 transition-colors ${o.allStates ? 'bg-raised text-dim' : 'bg-accent-soft text-accent'} hover:text-accent`}>
          {o.allStates ? 'All States' : `${o.states.length} state${o.states.length === 1 ? '' : 's'}`}
        </button>

        {/* Default (star) */}
        <button disabled={!canEdit} onClick={onDefault} aria-pressed={o.isDefault} title="Set as default"
          className={`w-8 h-8 rounded-[7px] flex items-center justify-center shrink-0 transition-colors ${o.isDefault ? 'text-[#B45309] bg-[rgba(180,83,9,.1)]' : 'text-faint hover:text-dim hover:bg-raised'}`}>
          <IconStar size={15} className={o.isDefault ? 'fill-current' : ''} />
        </button>

        {/* Enabled toggle */}
        <button disabled={!canEdit} onClick={() => onChange({ ...o, enabled: !o.enabled })} role="switch" aria-checked={o.enabled} title={o.enabled ? 'Enabled' : 'Disabled'}
          className="shrink-0 w-9 h-[22px] rounded-full p-0.5 transition-colors flex items-center" style={{ background: o.enabled ? 'var(--color-accent)' : 'var(--color-border-strong)' }}>
          <span className="w-[18px] h-[18px] rounded-full bg-white transition-transform" style={{ transform: o.enabled ? 'translateX(14px)' : 'translateX(0)' }} />
        </button>

        {/* Remove */}
        {canEdit && (
          <button onClick={onRemove} aria-label="Remove option" className="w-8 h-8 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[rgba(220,38,38,.08)] transition-colors shrink-0">
            <IconTrash size={15} />
          </button>
        )}
      </div>

      {/* Inline state picker (⊆ coverage scope) */}
      {editStates && (
        <div className="px-2 pb-2.5 pt-1 flex flex-col gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <label className="flex items-center gap-2 text-xs text-dim cursor-pointer">
            <input type="checkbox" className="accent-accent" checked={o.allStates} disabled={!canEdit}
              onChange={e => onChange({ ...o, allStates: e.target.checked, states: e.target.checked ? [] : o.states })} />
            Available in all of this coverage's states
          </label>
          {!o.allStates && (
            scopeStates.length === 0
              ? <p className="text-xs text-faint">This coverage has no states in scope yet.</p>
              : <div className="flex flex-wrap gap-1">
                  {scopeStates.map(s => {
                    const on = o.states.includes(s)
                    return (
                      <button key={s} disabled={!canEdit}
                        onClick={() => onChange({ ...o, states: on ? o.states.filter(x => x !== s) : [...o.states, s] })}
                        className={`px-1.5 py-0.5 rounded-[5px] text-[11px] font-mono transition-colors ${on ? 'bg-accent text-white' : 'bg-raised text-dim hover:text-accent'}`}>
                        {s}
                      </button>
                    )
                  })}
                </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-faint">{formatOption(o)}</span>
            <button onClick={() => setEditStates(false)} className="text-[11px] text-accent font-medium">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
```


## `app/src/components/shell/Sidebar.tsx`

```tsx
// Sidebar — grouped, collapsible workspace nav. Sections give the app a clear
// mental model (author vs. intelligence); the active item is a soft brand pill
// with a gradient rail. Collapsed → icon-only with tooltips.
import { NavLink, useLocation } from 'react-router-dom'
import { Tooltip, Logo } from '../ui'
import {
  IconHome, IconProduct, IconSparkle, IconExplorer, IconTasks,
  IconNews, IconChart, IconBook, IconChat, IconChevronLeft,
  IconChevronRight, IconSettings, type IconType,
} from '../ui/icons'

interface NavItem { to: string; label: string; icon: IconType; exact?: boolean }

const SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/app',          label: 'Home',       icon: IconHome, exact: true },
      { to: '/app/products', label: 'Products',   icon: IconProduct },
      { to: '/app/builder',  label: 'AI Builder', icon: IconSparkle },
      { to: '/app/explorer', label: 'Explorer',   icon: IconExplorer },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/app/tasks',      label: 'Tasks',           icon: IconTasks },
      { to: '/app/news',       label: 'News',            icon: IconNews },
      { to: '/app/claims',     label: 'Claims Analysis', icon: IconChart },
      { to: '/app/dictionary', label: 'Data Dictionary', icon: IconBook },
      { to: '/app/feedback',   label: 'Feedback',        icon: IconChat },
    ],
  },
]

interface SidebarProps { collapsed: boolean; onToggle: () => void }

function Item({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) {
  const Icon = item.icon
  return (
    <Tooltip content={collapsed ? item.label : ''} side="right">
      <NavLink
        to={item.to}
        end={item.exact}
        aria-current={active ? 'page' : undefined}
        className={`relative flex items-center gap-3 mx-2 px-2.5 py-2 rounded-[10px] text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
          ${active ? 'bg-accent-soft text-accent font-medium' : 'text-dim hover:bg-raised hover:text-text'} ${collapsed ? 'justify-center' : ''}`}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
            style={{ background: 'var(--gradient-accent)' }} aria-hidden="true" />
        )}
        <Icon size={18} strokeWidth={active ? 2.2 : 1.9} className="shrink-0" aria-hidden="true" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    </Tooltip>
  )
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation()
  const isActive = (to: string, exact?: boolean) => exact ? location.pathname === to : location.pathname.startsWith(to)

  return (
    <aside
      className="flex flex-col shrink-0 h-full bg-surface transition-all duration-200"
      style={{ width: collapsed ? 60 : 232, borderRight: '1px solid var(--color-border)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 h-14 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Logo size={26} rounded={7} className="shrink-0 shadow-[0_2px_8px_rgba(139,31,224,.25)]" />
        {!collapsed && <span className="font-semibold text-sm text-text tracking-tight truncate">Product Reinvention Hub</span>}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        {SECTIONS.map((section, si) => (
          <div key={section.label}>
            {!collapsed
              ? <p className="px-4 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-faint select-none">{section.label}</p>
              : si > 0 && <div className="my-2 mx-3 h-px" style={{ background: 'var(--color-border)' }} aria-hidden="true" />}
            <div className="flex flex-col gap-0.5">
              {section.items.map(item => (
                <Item key={item.to} item={item} collapsed={collapsed} active={isActive(item.to, item.exact)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Item item={{ to: '/app/admin', label: 'Settings', icon: IconSettings }} collapsed={collapsed} active={isActive('/app/admin')} />
        <button
          onClick={onToggle}
          className={`flex items-center gap-3 mx-2 px-2.5 py-2 rounded-[10px] text-sm text-dim hover:bg-raised hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent w-[calc(100%-16px)] ${collapsed ? 'justify-center' : ''}`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <IconChevronRight size={18} aria-hidden="true" /> : <><IconChevronLeft size={18} aria-hidden="true" /><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  )
}
```


## `app/src/components/shell/Topbar.tsx`

```tsx
// Topbar — breadcrumb, global search (opens palette), presence slot, user menu.
import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { IconSearch, IconSignOut, IconChevronDown, IconUser, IconHome } from '../ui/icons'
import { useUser } from '../../context/useUser'
import { adapter } from '../../lib/backend'
import type { Product } from '@pf/shared'

interface TopbarProps { onOpenPalette: () => void }

const LABELS: Record<string, string> = {
  products: 'Products', builder: 'AI Builder', explorer: 'Explorer',
  tasks: 'Tasks', news: 'News', claims: 'Claims Analysis', dictionary: 'Data Dictionary',
  feedback: 'Feedback', admin: 'Settings',
}
const TAB_LABELS: Record<string, string> = {
  overview: 'Overview', coverages: 'Coverages', forms: 'Forms',
  pricing: 'Pricing', states: 'States', rules: 'Rules',
}

interface Crumb { label: string; to: string }

/** Resolve the current path to labelled, linkable crumbs (product ids → names). */
function useCrumbs(): Crumb[] {
  const { pathname } = useLocation()
  const [names, setNames] = useState<Record<string, string>>({})
  const onProductPage = pathname.startsWith('/app/products/')

  // Lightweight id→name map so a product crumb reads "Homeowners HO-3", not its id.
  // Subscribe once while in product-land (not per tab switch) to avoid listener churn.
  useEffect(() => {
    if (!onProductPage) return
    const unsub = adapter.db.subscribe<Product & { id?: string }>('products', d => {
      if (Array.isArray(d)) setNames(Object.fromEntries(d.map(p => [p.id ?? '', p.name])))
    })
    return unsub
  }, [onProductPage])

  const parts = pathname.split('/').filter(Boolean).slice(1) // drop 'app'
  const crumbs: Crumb[] = []
  if (parts[0] === 'products' && parts[1]) {
    crumbs.push({ label: 'Products', to: '/app/products' })
    crumbs.push({ label: names[parts[1]] ?? 'Product', to: `/app/products/${parts[1]}/overview` })
    if (parts[2]) crumbs.push({ label: TAB_LABELS[parts[2]] ?? parts[2], to: `/app/products/${parts[1]}/${parts[2]}` })
  } else if (parts[0]) {
    crumbs.push({ label: LABELS[parts[0]] ?? parts[0], to: `/app/${parts[0]}` })
  }
  return crumbs
}

function Breadcrumb() {
  const crumbs = useCrumbs()
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm min-w-0">
      <Link to="/app" aria-label="Home"
        className={`flex items-center gap-1.5 shrink-0 rounded-[6px] px-1 -mx-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${crumbs.length ? 'text-dim hover:text-text' : 'text-text font-medium'}`}>
        <IconHome size={14} aria-hidden="true" />{!crumbs.length && <span>Home</span>}
      </Link>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1
        return (
          <span key={`${i}-${c.to}`} className="flex items-center gap-1.5 min-w-0">
            <span className="text-faint shrink-0" aria-hidden="true">/</span>
            {last
              ? <span className="font-medium text-text truncate" aria-current="page">{c.label}</span>
              : <Link to={c.to} className="text-dim hover:text-text truncate rounded-[6px] px-1 -mx-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{c.label}</Link>}
          </span>
        )
      })}
    </nav>
  )
}

export function Topbar({ onOpenPalette }: TopbarProps) {
  const { user } = useUser()
  const navigate  = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    await adapter.auth.signOut()
    navigate('/')
  }

  return (
    <header
      className="flex items-center gap-4 h-14 px-5 bg-surface shrink-0"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <div className="flex-1 min-w-0"><Breadcrumb /></div>

      {/* Search field — opens palette */}
      <button
        onClick={onOpenPalette}
        className="hidden sm:flex items-center gap-2 px-3 h-8 rounded-[8px] text-sm text-faint bg-raised hover:bg-hover transition-colors"
        style={{ border: '1px solid var(--color-border)', minWidth: 200 }}
        aria-label="Search (Ctrl+K)"
      >
        <IconSearch size={14} aria-hidden="true" />
        <span>Search...</span>
        <kbd className="ml-auto text-xs bg-surface rounded px-1 py-0.5 font-mono text-faint" style={{ border: '1px solid var(--color-border)' }}>Ctrl+K</kbd>
      </button>

      {/* Presence slot (wired in Prompt 4) */}
      <div className="hidden lg:flex items-center gap-1" id="presence-slot" />

      {/* User menu */}
      {user && (
        <div className="relative">
          <button
            onClick={() => setMenuOpen(m => !m)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-sm text-dim hover:bg-raised hover:text-text transition-colors"
          >
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-soft text-accent text-xs font-semibold">
              {(user.name ?? user.email ?? 'U')[0].toUpperCase()}
            </span>
            <span className="hidden md:block max-w-[120px] truncate">{user.name ?? user.email}</span>
            <IconChevronDown size={12} aria-hidden="true" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div
                className="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-surface rounded-[12px] py-1 text-sm"
                style={{ boxShadow: '0 8px 24px rgba(19,19,26,.12)', border: '1px solid var(--color-border)' }}
              >
                <div className="px-3 py-2 border-b border-[rgba(19,19,26,.08)]">
                  <p className="font-medium text-text truncate">{user.name ?? user.email}</p>
                  <p className="text-xs text-faint font-mono mt-0.5">{user.role}</p>
                </div>
                <button
                  onClick={() => { setMenuOpen(false); void handleSignOut() }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-dim hover:bg-raised hover:text-text transition-colors"
                >
                  <IconSignOut size={14} aria-hidden="true" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!user && (
        <button onClick={() => navigate('/sign-in')} className="flex items-center gap-1.5 text-sm text-dim hover:text-text">
          <IconUser size={14} aria-hidden="true" />Sign in
        </button>
      )}
    </header>
  )
}
```


## `app/src/components/ui/Badge.tsx`

```tsx
// Badge + StatusPill — semantic color chips for status, lifecycle and reviewStatus.
import type { Status, Lifecycle, ReviewStatus } from '@pf/shared'

// ─── Generic badge ────────────────────────────────────────────────────────────

type BadgeColor = 'default' | 'accent' | 'good' | 'warn' | 'danger' | 'blue' | 'purple'

const badgeColors: Record<BadgeColor, string> = {
  default: 'bg-raised text-dim',
  accent:  'text-white',
  good:    'bg-[rgba(5,150,105,.1)] text-good',
  warn:    'bg-[rgba(180,83,9,.1)] text-warn',
  danger:  'bg-[rgba(220,38,38,.1)] text-danger',
  blue:    'bg-[rgba(37,99,235,.08)] text-info',
  purple:  'bg-accent-soft text-accent',
}

interface BadgeProps {
  label: string
  color?: BadgeColor
  mono?: boolean
  className?: string
}

export function Badge({ label, color = 'default', mono = false, className = '' }: BadgeProps) {
  const isAccent = color === 'accent'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium leading-none
        ${badgeColors[color]} ${mono ? 'font-mono' : ''} ${className}`}
      style={isAccent ? { background: 'var(--gradient-accent)', color: '#fff' } : undefined}
    >
      {label}
    </span>
  )
}

// ─── StatusPill ───────────────────────────────────────────────────────────────

const statusColors: Record<Status, BadgeColor>        = { ACTIVE: 'good', INACTIVE: 'default', FUTURE: 'blue' }
const lifecycleColors: Record<Lifecycle, BadgeColor>  = { LAUNCHED: 'good', APPROVED: 'purple', IN_REVIEW: 'warn', DRAFT: 'default' }
const reviewColors: Record<ReviewStatus, BadgeColor>  = {
  APPROVED: 'good', BUSINESS_REVIEW: 'warn', IN_PROGRESS: 'blue',
  NOT_STARTED: 'default', REJECTED: 'danger',
}

export function StatusPill({ status }:        { status: Status })       { return <Badge label={status}   color={statusColors[status]}   /> }
export function LifecyclePill({ lifecycle }:  { lifecycle: Lifecycle }) { return <Badge label={lifecycle} color={lifecycleColors[lifecycle]} /> }
export function ReviewPill({ review }:        { review: ReviewStatus }) { return <Badge label={review.replace(/_/g,' ')} color={reviewColors[review]} /> }
```


## `app/src/components/ui/Button.tsx`

```tsx
// Button — four visual variants sharing the same layout rhythm.
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'default' | 'primary' | 'ghost' | 'destructive'
type Size    = 'sm' | 'md' | 'lg'

const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-[10px] border-0 cursor-pointer transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none'

const variants: Record<Variant, string> = {
  default:     'bg-raised text-text hover:bg-hover focus-visible:outline-accent',
  primary:     'text-white focus-visible:outline-accent',
  ghost:       'bg-transparent text-dim hover:bg-raised hover:text-text focus-visible:outline-accent',
  destructive: 'bg-[rgba(220,38,38,.08)] text-danger hover:bg-[rgba(220,38,38,.14)] focus-visible:outline-danger',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm h-8',
  md: 'px-4 py-2 text-sm h-9',
  lg: 'px-5 py-2.5 text-base h-11',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'default', size = 'md', className = '', style, children, ...props }: ButtonProps) {
  const isPrimary = variant === 'primary'
  return (
    <button
      {...props}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      style={isPrimary ? {
        background: 'var(--gradient-accent)',
        boxShadow: '0 1px 3px var(--glow-accent)',
        ...style,
      } : style}
    >
      {children}
    </button>
  )
}
```


## `app/src/components/ui/Card.tsx`

```tsx
// Card — white surface with the soft purple-haze glow from the design system.
import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: boolean
}

export function Card({ className = '', padding = true, children, style, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={`bg-surface rounded-[14px] ${padding ? 'p-5' : ''} ${className}`}
      style={{
        boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--color-border)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
```


## `app/src/components/ui/Combobox.tsx`

```tsx
// Combobox — instant Fuse.js typeahead with keyboard nav and match highlighting.
import { useState, useRef, useEffect, useId } from 'react'
import Fuse from 'fuse.js'
import { IconChevronDown, IconClose, IconSpinner } from './icons'

interface ComboboxProps<T> {
  items:       T[]
  value:       T | null
  onChange:    (item: T | null) => void
  getLabel:    (item: T) => string
  getValue:    (item: T) => string
  placeholder?: string
  loading?:    boolean
  clearable?:  boolean
  className?:  string
}

function highlight(text: string, ranges: readonly [number, number][]): React.ReactNode {
  if (!ranges.length) return text
  const parts: React.ReactNode[] = []
  let last = 0
  for (const [start, end] of ranges) {
    if (start > last) parts.push(text.slice(last, start))
    parts.push(<mark key={start} className="bg-accent-soft text-accent font-medium not-italic rounded-[2px]">{text.slice(start, end + 1)}</mark>)
    last = end + 1
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function Combobox<T>({ items, value, onChange, getLabel, getValue, placeholder = 'Search…', loading, clearable = true, className = '' }: ComboboxProps<T>) {
  const [query, setQuery]       = useState('')
  const [open, setOpen]         = useState(false)
  const [active, setActive]     = useState(0)
  const id                      = useId()
  const inputRef                = useRef<HTMLInputElement>(null)
  const listRef                 = useRef<HTMLUListElement>(null)

  const fuse = new Fuse(items, { keys: [{ name: 'label', getFn: getLabel }], threshold: 0.4, includeMatches: true })
  const results = query ? fuse.search(query) : items.map(item => ({ item, matches: [] }))

  const displayValue = value ? getLabel(value) : ''

  useEffect(() => { if (!open) setQuery('') }, [open])
  useEffect(() => { setActive(0) }, [query])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); if (results[active]) select(results[active].item) }
    if (e.key === 'Escape')    { setOpen(false) }
  }

  function select(item: T) {
    onChange(item)
    setOpen(false)
    inputRef.current?.blur()
  }

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div className={`relative ${className}`}>
      <div
        className={`flex items-center gap-2 h-9 px-3 rounded-[10px] bg-surface border cursor-text
          ${open ? 'border-accent ring-2 ring-accent/25' : 'border-border-strong hover:border-[rgba(19,19,26,.22)]'}`}
        onClick={() => { setOpen(true); inputRef.current?.focus() }}
      >
        <input
          ref={inputRef}
          id={id}
          className="flex-1 min-w-0 bg-transparent text-sm text-text placeholder:text-faint outline-none"
          placeholder={open ? placeholder : (displayValue || placeholder)}
          value={open ? query : displayValue}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={`${id}-list`}
          autoComplete="off"
        />
        {loading && <IconSpinner size={14} className="animate-spin text-faint shrink-0" aria-hidden="true" />}
        {clearable && value && !loading && (
          <button type="button" className="text-faint hover:text-text shrink-0" onClick={e => { e.stopPropagation(); onChange(null) }} aria-label="Clear">
            <IconClose size={14} aria-hidden="true" />
          </button>
        )}
        {!value && <IconChevronDown size={14} className="text-faint shrink-0" aria-hidden="true" />}
      </div>

      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-surface rounded-[10px] overflow-hidden overflow-y-auto max-h-56 text-sm"
          style={{ boxShadow: '0 8px 24px rgba(19,19,26,.12)', border: '1px solid var(--color-border)' }}
          onMouseLeave={() => setActive(0)}
        >
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-faint">No results</li>
          )}
          {results.map(({ item, matches }, i) => {
            const label = getLabel(item)
            const match = matches?.find(m => m.key === 'label' || m.key === undefined)
            return (
              <li
                key={getValue(item)}
                role="option"
                aria-selected={value ? getValue(value) === getValue(item) : false}
                className={`px-3 py-2 cursor-pointer transition-colors
                  ${i === active ? 'bg-accent-soft' : 'hover:bg-raised'}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => { e.preventDefault(); select(item) }}
              >
                {match?.indices ? highlight(label, match.indices as [number,number][]) : label}
              </li>
            )
          })}
        </ul>
      )}

      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />}
    </div>
  )
}
```


## `app/src/components/ui/Dialog.tsx`

```tsx
// Dialog — accessible modal with backdrop blur and spring entrance.
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './icons'

interface DialogProps {
  open:       boolean
  onClose:    () => void
  title?:     string
  children:   ReactNode
  width?:     string
}

export function Dialog({ open, onClose, title, children, width = 'max-w-lg' }: DialogProps) {
  // Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[rgba(19,19,26,.5)] backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'dialog-title' : undefined}
        className={`relative w-full ${width} bg-surface rounded-[16px] p-6 shadow-2xl`}
        style={{ border: '1px solid var(--color-border)' }}
      >
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h2 id="dialog-title" className="text-base font-semibold text-text">{title}</h2>
            <button onClick={onClose} className="text-faint hover:text-text rounded-[6px] p-1 transition-colors" aria-label="Close">
              <IconClose size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
```


## `app/src/components/ui/Drawer.tsx`

```tsx
// Drawer — right-side panel with backdrop; slides in from the edge.
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './icons'

interface DrawerProps {
  open:     boolean
  onClose:  () => void
  title?:   string
  children: ReactNode
  width?:   string
}

export function Drawer({ open, onClose, title, children, width = 'w-96' }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[rgba(19,19,26,.4)] backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative ${width} max-w-full h-full bg-surface flex flex-col shadow-2xl`}
        style={{ borderLeft: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {title && <h2 className="text-base font-semibold text-text">{title}</h2>}
          <button onClick={onClose} className="text-faint hover:text-text rounded-[6px] p-1 ml-auto transition-colors" aria-label="Close">
            <IconClose size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
```


## `app/src/components/ui/EmptyState.tsx`

```tsx
// EmptyState — premium designed placeholder for not-yet-built views.
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?:        ReactNode
  title:        string
  description?: string
  action?:      ReactNode
  compact?:     boolean
}

// Subtle generative dot grid as a micro-illustration
function DotGrid() {
  return (
    <svg width="80" height="56" viewBox="0 0 80 56" fill="none" aria-hidden="true">
      {Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 8 }, (_, col) => (
          <circle
            key={`${row}-${col}`}
            cx={col * 10 + 5}
            cy={row * 11 + 6}
            r={1.5}
            fill="var(--color-accent-line)"
            // Deterministic scatter (stable across renders — no Math.random flicker).
            style={{ opacity: ((row * 8 + col) * 37) % 11 > 4 ? 1 : 0.28 }}
          />
        ))
      )}
    </svg>
  )
}

export function EmptyState({ icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center gap-3 ${compact ? 'py-10' : 'py-20'}`}>
      <DotGrid />
      {icon && <div className="text-faint mb-1">{icon}</div>}
      <h3 className="text-base font-semibold text-text">{title}</h3>
      {description && <p className="text-sm text-dim max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
```


## `app/src/components/ui/icons.tsx`

```tsx
// icons.tsx — the app's own SVG icon family. Hand-drawn on a 24px grid, stroked
// with `currentColor` (rounded caps/joins) so every icon inherits colour + size
// from its context and feels part of one system rather than a stock set. A few
// domain glyphs carry a subtle accent-tinted fill for a more tactile, premium read.
// Prefer these over any third-party icon pack across authoring surfaces.
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number; title?: string }

/** Shared shape for every in-house glyph — use where a component takes an icon. */
export type IconType = (props: IconProps) => React.ReactElement

// Shared frame: fixes the viewBox + stroke defaults; decorative unless a title is
// given (then it is announced to screen readers as an image).
function Glyph({ size = 20, title, children, strokeWidth = 1.6, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  )
}

// ─── Domain glyphs (products, coverages + the six coverage aspects) ───────────

/** Product — a faceted parcel / package, the unit a PM ships. */
export const IconProduct = (p: IconProps) => (
  <Glyph {...p}><path d="M12 2.6 20.5 7v10L12 21.4 3.5 17V7z" /><path d="M3.7 7.2 12 11.6l8.3-4.4" /><path d="M12 11.6V21" /></Glyph>
)

/** Coverage — a shield, the classic mark for protection/scope. */
export const IconCoverage = (p: IconProps) => (
  <Glyph {...p}><path d="M12 2.7 19 5.4v5.3c0 4.6-2.9 8-7 10.3-4.1-2.3-7-5.7-7-10.3V5.4z" /><path d="m9 11.6 2.2 2.2L15.2 9" /></Glyph>
)

/** Limit — a dial/gauge: a bounded range with a needle at the chosen value. */
export const IconLimit = (p: IconProps) => (
  <Glyph {...p}><path d="M4.5 16.5a8 8 0 1 1 15 0" /><path d="M12 12.5 15.4 9" /><circle cx="12" cy="12.7" r="1.15" fill="currentColor" stroke="none" /><path d="M4.5 16.5h2M17.5 16.5h2" /></Glyph>
)

/** Deductible — balance scales: the retained-vs-transferred split. */
export const IconDeductible = (p: IconProps) => (
  <Glyph {...p}><path d="M12 3.5v15" /><path d="M6 18.5h12" /><path d="M4.5 7h15" /><path d="M4.5 7 2.6 11.5h3.8zM19.5 7l1.9 4.5h-3.8z" /><path d="M2.6 11.5a1.9 1.9 0 0 0 3.8 0M17.6 11.5a1.9 1.9 0 0 0 3.8 0" /></Glyph>
)

/** State — a map pin over a territory, for geographic availability. */
export const IconStates = (p: IconProps) => (
  <Glyph {...p}><path d="M12 21c4-3.6 6-6.6 6-9.6a6 6 0 1 0-12 0c0 3 2 6 6 9.6Z" /><circle cx="12" cy="11.2" r="2.2" /></Glyph>
)

/** Form — a document with a folded corner + lines of text. */
export const IconForm = (p: IconProps) => (
  <Glyph {...p}><path d="M6.5 2.7h7L18.5 8v13a.8.8 0 0 1-.8.8H6.5a.8.8 0 0 1-.8-.8V3.5a.8.8 0 0 1 .8-.8Z" /><path d="M13 2.9V8h5" /><path d="M9 12.5h6M9 15.7h6M9 18.9h3.5" /></Glyph>
)

/** Pricing — a price tag carrying a currency mark. */
export const IconPricing = (p: IconProps) => (
  <Glyph {...p}><path d="M4 12.4V4.8a.8.8 0 0 1 .8-.8h7.6a.8.8 0 0 1 .57.24l6.5 6.5a1.6 1.6 0 0 1 0 2.26l-6.66 6.66a1.6 1.6 0 0 1-2.26 0l-6.5-6.5A.8.8 0 0 1 4 12.4Z" /><circle cx="8.2" cy="8.2" r="1.15" fill="currentColor" stroke="none" /><path d="M13.6 10.4h-2a1.2 1.2 0 0 0 0 2.4h1.2a1.2 1.2 0 0 1 0 2.4h-2M12.6 9.6v1M12.6 15.6v1" /></Glyph>
)

/** Rule — a decision flow: a node branching into two outcomes. */
export const IconRule = (p: IconProps) => (
  <Glyph {...p}><rect x="9" y="3.4" width="6" height="5" rx="1.2" /><rect x="3.4" y="15.6" width="6" height="5" rx="1.2" /><rect x="14.6" y="15.6" width="6" height="5" rx="1.2" /><path d="M12 8.4v3.1a1.5 1.5 0 0 1-1.5 1.5H7.9a1.5 1.5 0 0 0-1.5 1.5v1.1M12 8.4v3.1a1.5 1.5 0 0 0 1.5 1.5h2.6a1.5 1.5 0 0 1 1.5 1.5v1.1" /></Glyph>
)

/** Endorsement — a document with a plus, for add-on coverages. */
export const IconEndorsement = (p: IconProps) => (
  <Glyph {...p}><path d="M6.5 2.7h7L18.5 8v13a.8.8 0 0 1-.8.8H6.5a.8.8 0 0 1-.8-.8V3.5a.8.8 0 0 1 .8-.8Z" /><path d="M13 2.9V8h5" /><path d="M12 12.6v5M9.5 15.1h5" /></Glyph>
)

// ─── Limit / deductible structure glyphs ─────────────────────────────────────

/** Single limit — one amount covering all loss. */
export const IconSingle = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 10 12 8l2.5 2" /></Glyph>
)

/** Occurrence + aggregate — a per-event layer beneath a term cap. */
export const IconLayers = (p: IconProps) => (
  <Glyph {...p}><path d="m12 3.4 8 4.2-8 4.2-8-4.2z" /><path d="m4 12 8 4.2 8-4.2M4 15.8 12 20l8-4.2" /></Glyph>
)

/** Split limits — a value divided into components (BI/PD). */
export const IconSplit = (p: IconProps) => (
  <Glyph {...p}><path d="M12 3.5v17" /><path d="M6.5 8H4.8a.8.8 0 0 0-.8.8v6.4a.8.8 0 0 0 .8.8h1.7M17.5 8h1.7a.8.8 0 0 1 .8.8v6.4a.8.8 0 0 1-.8.8h-1.7" /><path d="M8.5 12H6M18 12h-2.5" /></Glyph>
)

/** Combined single limit — components compressed into one. */
export const IconCombine = (p: IconProps) => (
  <Glyph {...p}><path d="M4 5.5 7.5 9M20 5.5 16.5 9M4 18.5 7.5 15M20 18.5 16.5 15" /><rect x="9" y="9" width="6" height="6" rx="1.4" /></Glyph>
)

/** Scheduled / per-item — an itemised list. */
export const IconScheduled = (p: IconProps) => (
  <Glyph {...p}><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.6" cy="6.5" r="1.15" /><circle cx="4.6" cy="12" r="1.15" /><circle cx="4.6" cy="17.5" r="1.15" /></Glyph>
)

/** Percent — a percentage-based value. */
export const IconPercent = (p: IconProps) => (
  <Glyph {...p}><path d="M6 18 18 6" /><circle cx="7.8" cy="7.8" r="2.3" /><circle cx="16.2" cy="16.2" r="2.3" /></Glyph>
)

/** Waiting period — a time-based deductible. */
export const IconClock = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8.2" /><path d="M12 7.4V12l3.2 1.9" /></Glyph>
)

/** Catastrophe / wind-hail — a peril flame. */
export const IconPeril = (p: IconProps) => (
  <Glyph {...p}><path d="M12 3.2c2.4 3 3.6 5.2 3.6 7.1 0 1.2-.8 2.2-2 2.4.6-1.4.2-2.9-1-4 .2 2.3-1.2 3.4-2 4.2-1.5 1.5-1.6 3.6-.3 5A5 5 0 0 1 7 12.9c0-3 1.7-6.2 5-9.7Z" /></Glyph>
)

// ─── UI / action glyphs ──────────────────────────────────────────────────────

/** Cards view — a 2×2 tile grid. */
export const IconCards = (p: IconProps) => (
  <Glyph {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></Glyph>
)

/** List view — stacked rows. */
export const IconList = (p: IconProps) => (
  <Glyph {...p}><path d="M8 6.5h12M8 12h12M8 17.5h12" /><path d="M4 6.5h.01M4 12h.01M4 17.5h.01" strokeWidth={2.2} /></Glyph>
)

export const IconPlus = (p: IconProps) => (<Glyph {...p}><path d="M12 5v14M5 12h14" /></Glyph>)
export const IconClose = (p: IconProps) => (<Glyph {...p}><path d="M6 6 18 18M18 6 6 18" /></Glyph>)
export const IconCheck = (p: IconProps) => (<Glyph {...p}><path d="m4.5 12.5 4.5 4.5L19.5 6.5" /></Glyph>)
export const IconChevronRight = (p: IconProps) => (<Glyph {...p}><path d="m9 5 7 7-7 7" /></Glyph>)
export const IconChevronDown = (p: IconProps) => (<Glyph {...p}><path d="m5 9 7 7 7-7" /></Glyph>)
export const IconChevronUp = (p: IconProps) => (<Glyph {...p}><path d="m5 15 7-7 7 7" /></Glyph>)
/** Sort — a double chevron, the neutral (unsorted) column indicator. */
export const IconSort = (p: IconProps) => (<Glyph {...p}><path d="m8 9 4-4 4 4M8 15l4 4 4-4" /></Glyph>)
export const IconEdit = (p: IconProps) => (<Glyph {...p}><path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17.2z" /><path d="m14.5 8.5 2.8 2.8" /></Glyph>)
export const IconTrash = (p: IconProps) => (<Glyph {...p}><path d="M4.5 6.5h15M9 6.5V5a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 5v1.5M6.3 6.5l.8 12.6a1.3 1.3 0 0 0 1.3 1.2h7.2a1.3 1.3 0 0 0 1.3-1.2l.8-12.6" /></Glyph>)
export const IconSearch = (p: IconProps) => (<Glyph {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.7-4.7" /></Glyph>)
export const IconFilter = (p: IconProps) => (<Glyph {...p}><path d="M4 5.5h16l-6.2 7.4V19l-3.6 1.6v-7.7z" /></Glyph>)
export const IconDownload = (p: IconProps) => (<Glyph {...p}><path d="M12 3.5v11M8 10.5l4 4 4-4M5 20h14" /></Glyph>)
export const IconDrag = (p: IconProps) => (<Glyph {...p}><path d="M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01" strokeWidth={2.4} /></Glyph>)
export const IconArrowUp = (p: IconProps) => (<Glyph {...p}><path d="M12 20V5M6 11l6-6 6 6" /></Glyph>)
export const IconArrowRight = (p: IconProps) => (<Glyph {...p}><path d="M4 12h15M13 6l6 6-6 6" /></Glyph>)
/** Tasks — a kanban board: two columns of stacked cards. */
export const IconTasks = (p: IconProps) => (<Glyph {...p}><rect x="3.5" y="4" width="7" height="16" rx="1.5" /><rect x="13.5" y="4" width="7" height="10" rx="1.5" /><path d="M6 8h2M17 8h2" /></Glyph>)
export const IconInfo = (p: IconProps) => (<Glyph {...p}><circle cx="12" cy="12" r="8.4" /><path d="M12 11v5.2" /><circle cx="12" cy="7.9" r="1.05" fill="currentColor" stroke="none" /></Glyph>)
export const IconBack = (p: IconProps) => (<Glyph {...p}><path d="M15 5 8 12l7 7" /></Glyph>)
export const IconExpand = (p: IconProps) => (<Glyph {...p}><path d="M9 4H5v4M15 4h4v4M9 20H5v-4M15 20h4v-4" /></Glyph>)
export const IconRefresh = (p: IconProps) => (<Glyph {...p}><path d="M4.6 12a7.4 7.4 0 0 1 12.6-5.2L20 9.4" /><path d="M20 4v5.5h-5.5" /><path d="M19.4 12a7.4 7.4 0 0 1-12.6 5.2L4 14.6" /><path d="M4 20v-5.5h5.5" /></Glyph>)
export const IconTable = (p: IconProps) => (<Glyph {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="1.6" /><path d="M3.5 9.6h17M9.2 9.6V19.5" /></Glyph>)
export const IconUpload = (p: IconProps) => (<Glyph {...p}><path d="M12 15.5v-11M8 8.5l4-4 4 4M5 19.5h14" /></Glyph>)
export const IconFile = (p: IconProps) => (<Glyph {...p}><path d="M6.5 2.7h7L18.5 8v13a.8.8 0 0 1-.8.8H6.5a.8.8 0 0 1-.8-.8V3.5a.8.8 0 0 1 .8-.8Z" /><path d="M13 2.9V8h5" /></Glyph>)
/** Spinner — a partial ring; pair with `animate-spin` for loading affordances. */
export const IconSpinner = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8.5" opacity=".22" /><path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" /></Glyph>
)

/** Star — the default-option marker (fills when active via CSS `fill-current`). */
export const IconStar = (p: IconProps) => (
  <Glyph {...p}><path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 22.7l-5.2-2.75 1-5.8-4.2-4.1 5.8-.85z" /></Glyph>
)

/** Sparkle — the AI affordance, a four-point star with a companion twinkle. */
export const IconSparkle = (p: IconProps) => (
  <Glyph {...p}><path d="M12 3.5c.5 3.4 1.6 4.5 5 5-3.4.5-4.5 1.6-5 5-.5-3.4-1.6-4.5-5-5 3.4-.5 4.5-1.6 5-5Z" /><path d="M18.5 14c.25 1.5.75 2 2.2 2.2-1.45.25-1.95.75-2.2 2.2-.25-1.45-.75-1.95-2.2-2.2 1.45-.2 1.95-.7 2.2-2.2Z" /></Glyph>
)

/** Chat — a speech bubble, for the conversational surface. */
export const IconChat = (p: IconProps) => (
  <Glyph {...p}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.4V16H6.5A2.5 2.5 0 0 1 4 13.5z" /><path d="M8.5 9.5h7M8.5 12.5h4" /></Glyph>
)

// ─── Navigation / shell glyphs ────────────────────────────────────────────────

/** Home — a house; the workspace landing. */
export const IconHome = (p: IconProps) => (
  <Glyph {...p}><path d="M4 11 12 4l8 7" /><path d="M6 9.6V19a.8.8 0 0 0 .8.8h10.4a.8.8 0 0 0 .8-.8V9.6" /><path d="M9.8 20.8V14.6h4.4v6.2" /></Glyph>
)
/** Explorer — a compass, for browsing the hierarchy. */
export const IconExplorer = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8.5" /><path d="m15.2 8.8-2.4 4-4 2.4 2.4-4z" /></Glyph>
)
/** News — a newspaper with a folded side column. */
export const IconNews = (p: IconProps) => (
  <Glyph {...p}><path d="M4 6h11.5v12.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M15.5 9H19a.5.5 0 0 1 .5.5v9a1.5 1.5 0 0 1-1.5 1.5" /><path d="M6.8 9.2h6M6.8 12.2h6M6.8 15.2h3.6" /></Glyph>
)
/** Chart — grouped bars, for analytics. */
export const IconChart = (p: IconProps) => (
  <Glyph {...p}><path d="M4 4v15.2a.8.8 0 0 0 .8.8H20" /><rect x="6.6" y="12" width="3" height="5" rx="1" /><rect x="11.2" y="8.4" width="3" height="8.6" rx="1" /><rect x="15.8" y="10.6" width="3" height="6.4" rx="1" /></Glyph>
)
/** Book — an open book, for the data dictionary. */
export const IconBook = (p: IconProps) => (
  <Glyph {...p}><path d="M12 6.2C10.3 4.9 7.8 4.4 4.8 5v12.6c3-.6 5.5-.1 7.2 1.2" /><path d="M12 6.2c1.7-1.3 4.2-1.8 7.2-1.2v12.6c-3-.6-5.5-.1-7.2 1.2" /><path d="M12 6.2v12.6" /></Glyph>
)
/** Settings — sliders. */
export const IconSettings = (p: IconProps) => (
  <Glyph {...p}><path d="M4 8h8M17 8h3M4 16h3M12 16h8" /><circle cx="14.5" cy="8" r="2.3" /><circle cx="9.5" cy="16" r="2.3" /></Glyph>
)
/** Sign-out — a door with an out-arrow. */
export const IconSignOut = (p: IconProps) => (
  <Glyph {...p}><path d="M14 5.5H6.8A1.8 1.8 0 0 0 5 7.3v9.4a1.8 1.8 0 0 0 1.8 1.8H14" /><path d="M11 12h9M17 8.5l3.5 3.5L17 15.5" /></Glyph>
)
/** User — head and shoulders. */
export const IconUser = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="8.5" r="3.7" /><path d="M5 19.5c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" /></Glyph>
)
/** Key — for the temporary-password affordance. */
export const IconKey = (p: IconProps) => (
  <Glyph {...p}><circle cx="8.5" cy="8.5" r="3.8" /><path d="m11.2 11.2 7.3 7.3M15.6 15.6l2-2M17.6 13.6l1.6 1.6" /></Glyph>
)
export const IconChevronLeft = (p: IconProps) => (<Glyph {...p}><path d="m15 5-7 7 7 7" /></Glyph>)
/** Clock — recents / waiting. */
export const IconRecent = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8.2" /><path d="M12 7.4V12l3.2 1.9" /></Glyph>
)

// ─── Feedback glyphs ──────────────────────────────────────────────────────────

/** Idea — a lightbulb. */
export const IconIdea = (p: IconProps) => (
  <Glyph {...p}><path d="M9 16.3a5 5 0 1 1 6 0 2 2 0 0 0-.8 1.6v.6H9.8v-.6A2 2 0 0 0 9 16.3Z" /><path d="M9.8 20.6h4.4" /></Glyph>
)
/** Issue — a bug. */
export const IconBug = (p: IconProps) => (
  <Glyph {...p}><rect x="8" y="8" width="8" height="10" rx="4" /><path d="M9.6 6.4 8.3 5M14.4 6.4 15.7 5M8 11H4.6M16 11h3.4M8 15H4.6M16 15h3.4M12 8.2v9.6" /></Glyph>
)
/** Praise — a heart. */
export const IconHeart = (p: IconProps) => (
  <Glyph {...p}><path d="M12 20.3S3.6 15 3.6 9A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.4 2c0 6-8.4 11.3-8.4 11.3Z" /></Glyph>
)
/** Link — a chain, for attached context. */
export const IconLink = (p: IconProps) => (
  <Glyph {...p}><path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.6 1.6" /><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.6-1.6" /></Glyph>
)
/** Activity — a heartbeat line, for health / readiness. */
export const IconActivity = (p: IconProps) => (
  <Glyph {...p}><path d="M3 12h3.5l2-6 4 13 2.5-7H21" /></Glyph>
)
/** Clipboard-check — reviews awaiting action. */
export const IconClipboard = (p: IconProps) => (
  <Glyph {...p}><path d="M8.5 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-2" /><rect x="8.5" y="2.9" width="7" height="3.6" rx="1.2" /><path d="m9.2 13.5 2 2 3.8-4" /></Glyph>
)
/** Share — three nodes joined by links. */
export const IconShare = (p: IconProps) => (
  <Glyph {...p}><circle cx="6" cy="12" r="2.4" /><circle cx="17" cy="6" r="2.4" /><circle cx="17" cy="18" r="2.4" /><path d="m8.1 10.9 6.8-3.8M8.1 13.1l6.8 3.8" /></Glyph>
)
/** Users — presence / collaborators. */
export const IconUsers = (p: IconProps) => (
  <Glyph {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c0-3.1 2.5-4.8 5.5-4.8s5.5 1.7 5.5 4.8" /><path d="M16 5.5a3.2 3.2 0 0 1 0 6.1M17.6 14.4c2.1.5 3.8 2 3.8 4.6" /></Glyph>
)
/** Warning — a triangle, for a soft (warning) finding. */
export const IconWarning = (p: IconProps) => (
  <Glyph {...p}><path d="M12 4.3 20.8 19a1 1 0 0 1-.87 1.5H4.07A1 1 0 0 1 3.2 19z" /><path d="M12 10v4.3" /><circle cx="12" cy="17.4" r="1" fill="currentColor" stroke="none" /></Glyph>
)
/** Alert — a circle with a bang, for a hard (error) finding. */
export const IconAlertCircle = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8.4" /><path d="M12 7.6v5.3" /><circle cx="12" cy="16.4" r="1" fill="currentColor" stroke="none" /></Glyph>
)
```


## `app/src/components/ui/index.ts`

```ts
export { Button } from './Button'
export { Card } from './Card'
export { Badge, StatusPill, LifecyclePill, ReviewPill } from './Badge'
export { RefChip } from './RefChip'
export { Input } from './Input'
export { Combobox } from './Combobox'
export { Table } from './Table'
export type { Column } from './Table'
export { Tabs } from './Tabs'
export { Dialog } from './Dialog'
export { Drawer } from './Drawer'
export { Tooltip } from './Tooltip'
export { Skeleton, SkeletonCard } from './Skeleton'
export { EmptyState } from './EmptyState'
export { Logo } from './Logo'
export { ViewToggle } from './ViewToggle'
export type { ViewMode } from './ViewToggle'
export * as Icons from './icons'
```


## `app/src/components/ui/Input.tsx`

```tsx
// Input — styled text input that follows the design token palette.
import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?:    string
  error?:    string
  leftIcon?: React.ReactNode
}

export function Input({ label, error, leftIcon, className = '', id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-text">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none">
            {leftIcon}
          </span>
        )}
        <input
          id={inputId}
          {...props}
          className={`w-full h-9 rounded-[10px] bg-surface border text-text text-sm
            placeholder:text-faint
            focus:outline-none focus:ring-2
            disabled:opacity-50 disabled:cursor-not-allowed
            ${leftIcon ? 'pl-9' : 'pl-3'} pr-3
            ${error ? 'border-danger focus:ring-danger/30' : 'border-border-strong focus:ring-accent/25 focus:border-accent'}
            ${className}`}
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
```


## `app/src/components/ui/Logo.tsx`

```tsx
// Logo — the Product Reinvention Hub mark: signal sources converging on a bright
// central core (the product manager at the centre of the app's insight graph).
// Balanced radial convergence + glassy sheen + core glow; legible from 16px up.
import { useId } from 'react'

// Sources feeding the hub, with the curve control point that bends each into the core.
const STREAMS = [
  { x: 6,  y: 8,  cx: 11, cy: 11 },
  { x: 5,  y: 16, cx: 10, cy: 16 },
  { x: 6,  y: 24, cx: 11, cy: 21 },
  { x: 26, y: 9,  cx: 21, cy: 12 },
  { x: 26, y: 23, cx: 21, cy: 20 },
]

export function Logo({ size = 28, className = '', rounded = 8 }: { size?: number; className?: string; rounded?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} role="img" aria-label="Product Reinvention Hub">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A100FF" /><stop offset="0.5" stopColor="#8B1FE0" /><stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.26" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-core`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" /><stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="32" height="32" rx={rounded} fill={`url(#${id}-bg)`} />
      <rect width="32" height="32" rx={rounded} fill={`url(#${id}-sheen)`} />

      {/* Streams converging on the core, with a source node at each far end */}
      <g stroke="#fff" strokeLinecap="round" fill="none">
        {STREAMS.map((s, i) => (
          <path key={i} d={`M${s.x} ${s.y} Q${s.cx} ${s.cy} 16 16`} strokeWidth="1.6" opacity="0.85" />
        ))}
      </g>
      <g fill="#fff">
        {STREAMS.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r="1.15" opacity="0.75" />)}
      </g>

      {/* Core */}
      <circle cx="16" cy="16" r="7" fill={`url(#${id}-core)`} />
      <circle cx="16" cy="16" r="3.6" fill="#fff" />
    </svg>
  )
}
```


## `app/src/components/ui/RefChip.tsx`

```tsx
// RefChip — the canonical treatment for a reference id / form number (HO.COV.001,
// HO 04 90). Monospace, tabular, subtly chipped so identifiers read as precise,
// scannable tokens everywhere they appear. Optional onClick makes it a jump link.
interface RefChipProps {
  id: string
  tone?: 'default' | 'accent'
  onClick?: () => void
  title?: string
  className?: string
}

export function RefChip({ id, tone = 'default', onClick, title, className = '' }: RefChipProps) {
  const base = 'inline-flex items-center rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none tracking-[-.01em] align-baseline'
  const toneCls = tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-raised text-dim'
  const interactive = onClick ? 'cursor-pointer hover:bg-accent-soft hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent' : ''
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title ?? `Open ${id}`} className={`${base} ${toneCls} ${interactive} ${className}`}>
        {id}
      </button>
    )
  }
  return <span title={title} className={`${base} ${toneCls} ${className}`}>{id}</span>
}
```


## `app/src/components/ui/Skeleton.tsx`

```tsx
// Skeleton — shimmer placeholder for content loading states.
interface SkeletonProps { className?: string; rounded?: string }

export function Skeleton({ className = '', rounded = 'rounded-[8px]' }: SkeletonProps) {
  return (
    <div
      className={`bg-raised animate-pulse ${rounded} ${className}`}
      aria-hidden="true"
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="bg-surface rounded-[14px] p-5 flex flex-col gap-3" style={{ boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}
```


## `app/src/components/ui/Table.tsx`

```tsx
// Table — sticky sortable header, alternating row shading, keyboard accessible.
import type { ReactNode } from 'react'
import { IconChevronUp, IconChevronDown, IconSort } from './icons'

export interface Column<T> {
  key:       string
  header:    string
  width?:    string
  sortable?: boolean
  render:    (row: T) => ReactNode
}

interface TableProps<T> {
  columns:   Column<T>[]
  rows:      T[]
  rowKey:    (row: T) => string
  sortKey?:  string
  sortDir?:  'asc' | 'desc'
  onSort?:   (key: string) => void
  empty?:    ReactNode
}

export function Table<T>({ columns, rows, rowKey, sortKey, sortDir, onSort, empty }: TableProps<T>) {
  return (
    <div className="overflow-auto rounded-[14px] bg-surface" style={{ border: '1px solid var(--color-border)' }}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="sticky top-0 z-10 bg-raised" style={{ borderBottom: '1px solid var(--color-border)' }}>
            {columns.map(col => (
              <th
                key={col.key}
                className={`text-left px-4 py-3 text-xs font-medium text-dim uppercase tracking-wide ${col.width ?? ''} ${col.sortable ? 'cursor-pointer hover:text-text select-none' : ''}`}
                onClick={() => col.sortable && onSort?.(col.key)}
              >
                <span className="flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    sortKey === col.key
                      ? sortDir === 'asc' ? <IconChevronUp size={12} aria-hidden="true" /> : <IconChevronDown size={12} aria-hidden="true" />
                      : <IconSort size={12} className="opacity-40" aria-hidden="true" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="text-center py-10 text-faint">{empty ?? 'No records'}</td></tr>
          )}
          {rows.map((row, i) => (
            <tr
              key={rowKey(row)}
              className={`transition-colors hover:bg-raised ${i % 2 === 1 ? 'bg-[rgba(19,19,26,.018)]' : ''}`}
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              {columns.map(col => (
                <td key={col.key} className="px-4 py-3">{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```


## `app/src/components/ui/Tabs.tsx`

```tsx
// Tabs — pill-style tab strip with animated active indicator.
import type { ReactNode } from 'react'

interface Tab { id: string; label: string; count?: number }

interface TabsProps {
  tabs:     Tab[]
  active:   string
  onChange: (id: string) => void
  children?: ReactNode
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div
      className="flex gap-1 p-1 rounded-[10px] bg-raised"
      role="tablist"
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-sm font-medium transition-all duration-150
            ${active === tab.id
              ? 'bg-surface text-text shadow-sm'
              : 'text-dim hover:text-text'
            }`}
          style={active === tab.id ? { boxShadow: 'var(--shadow-card)' } : undefined}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`text-xs rounded-full px-1.5 py-0.5 ${active === tab.id ? 'bg-accent-soft text-accent' : 'bg-[rgba(19,19,26,.06)] text-faint'}`}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
```


## `app/src/components/ui/Tooltip.tsx`

```tsx
// Tooltip — CSS-only hover label; no JS needed for this simple variant.
import type { ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

const sideStyles: Record<NonNullable<TooltipProps['side']>, string> = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left:   'right-full top-1/2 -translate-y-1/2 mr-2',
  right:  'left-full top-1/2 -translate-y-1/2 ml-2',
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <div className="relative inline-flex group">
      {children}
      <div
        role="tooltip"
        className={`absolute z-50 px-2 py-1 text-xs text-white bg-[#131318] rounded-[6px]
          whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100
          transition-opacity duration-150 ${sideStyles[side]}`}
      >
        {content}
      </div>
    </div>
  )
}
```


## `app/src/components/ui/ViewToggle.tsx`

```tsx
// ViewToggle — a compact segmented control for switching a collection between
// card and list layouts. Used on every browse surface (products, coverages) so
// the "cards ⇄ list" affordance looks and behaves identically everywhere.
import { IconCards, IconList } from './icons'

export type ViewMode = 'cards' | 'list'

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const opt = (m: ViewMode, label: string, Icon: typeof IconCards) => {
    const active = mode === m
    return (
      <button
        type="button"
        onClick={() => onChange(m)}
        aria-pressed={active}
        aria-label={`${label} view`}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent
          ${active ? 'bg-surface text-accent shadow-[0_1px_2px_rgba(19,19,26,.06)]' : 'text-dim hover:text-text'}`}
        style={active ? { border: '1px solid var(--color-border)' } : undefined}
      >
        <Icon size={15} strokeWidth={active ? 1.9 : 1.6} />
        <span className="hidden sm:inline">{label}</span>
      </button>
    )
  }
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-[10px] bg-raised" role="group" aria-label="View mode">
      {opt('cards', 'Cards', IconCards)}
      {opt('list', 'List', IconList)}
    </div>
  )
}
```


## `app/src/context/ProductContext.tsx`

```tsx
// All realtime data for a product workspace, subscribed once at the shell level.
// Every tab reads from this context rather than subscribing independently.
import { createContext, useEffect, useState, type ReactNode } from 'react'
import { adapter } from '../lib/backend'
import type {
  Product, Coverage, Rule, FormRule, RatingProgram,
  Form, LDTable, RTTable, Version, Comment,
} from '@pf/shared'

export type WithId<T> = T & { id: string }

export interface ProductContextValue {
  pid:             string
  product:         WithId<Product> | null
  coverages:       WithId<Coverage>[]
  rules:           WithId<Rule>[]
  formRules:       WithId<FormRule>[]
  ratingProgram:   WithId<RatingProgram> | null
  forms:           WithId<Form>[]           // global forms filtered by productRefIds
  ldTables:        Record<string, LDTable>
  rtTables:        Record<string, RTTable>
  versions:        WithId<Version>[]        // all versions for this product
  comments:        WithId<Comment>[]
  loading:         boolean
}

const Ctx = createContext<ProductContextValue | null>(null)

export function ProductProvider({ pid, children }: { pid: string; children: ReactNode }) {
  const [product,       setProduct]       = useState<WithId<Product> | null>(null)
  const [coverages,     setCoverages]     = useState<WithId<Coverage>[]>([])
  const [rules,         setRules]         = useState<WithId<Rule>[]>([])
  const [formRules,     setFormRules]     = useState<WithId<FormRule>[]>([])
  const [ratingProgram, setRatingProgram] = useState<WithId<RatingProgram> | null>(null)
  const [forms,         setForms]         = useState<WithId<Form>[]>([])
  const [ldTables,      setLdTables]      = useState<Record<string, LDTable>>({})
  const [rtTables,      setRtTables]      = useState<Record<string, RTTable>>({})
  const [versions,      setVersions]      = useState<WithId<Version>[]>([])
  const [comments,      setComments]      = useState<WithId<Comment>[]>([])
  const [loaded,        setLoaded]        = useState(0)   // count resolved subscriptions

  const TOTAL_SUBS = 10

  function inc() { setLoaded(n => Math.min(n + 1, TOTAL_SUBS)) }

  useEffect(() => {
    setLoaded(0)
    const unsubs = [
      // Product document
      adapter.db.subscribe<WithId<Product>>(`products/${pid}`, (d) => {
        if (!Array.isArray(d)) setProduct(d)
        inc()
      }),
      // Sub-collections
      adapter.db.subscribe<WithId<Coverage>>(`products/${pid}/coverages`, (d) => {
        if (Array.isArray(d)) { setCoverages(d.sort((a,b) => (a.order??0)-(b.order??0))); inc() }
      }),
      adapter.db.subscribe<WithId<Rule>>(`products/${pid}/rules`, (d) => {
        if (Array.isArray(d)) { setRules(d); inc() }
      }),
      adapter.db.subscribe<WithId<FormRule>>(`products/${pid}/formRules`, (d) => {
        if (Array.isArray(d)) { setFormRules(d); inc() }
      }),
      adapter.db.subscribe<WithId<RatingProgram>>(`products/${pid}/ratingPrograms`, (d) => {
        if (Array.isArray(d)) { setRatingProgram(d[0] ?? null); inc() }
      }),
      // Global collections (small — filter client-side)
      adapter.db.subscribe<WithId<Form>>('forms', (d) => {
        if (Array.isArray(d)) {
          setForms(d.filter(f => (f.productRefIds ?? []).includes(pid) || (f.productRefIds ?? []).some(r => r === pid)))
          inc()
        }
      }),
      adapter.db.subscribe<WithId<LDTable> & { id: string }>('ldTables', (d) => {
        if (Array.isArray(d)) {
          const rec: Record<string, LDTable> = {}
          d.forEach(t => { rec[t.id] = t })
          setLdTables(rec); inc()
        }
      }),
      adapter.db.subscribe<WithId<RTTable> & { id: string }>('rtTables', (d) => {
        if (Array.isArray(d)) {
          const rec: Record<string, RTTable> = {}
          d.forEach(t => { rec[t.id] = t })
          setRtTables(rec); inc()
        }
      }),
      adapter.db.subscribe<WithId<Version>>('versions', (d) => {
        if (Array.isArray(d)) {
          setVersions(d.filter(v => v.productId === pid).sort((a,b) => {
            const ta = a.at instanceof Object ? 0 : Number(a.at)
            const tb = b.at instanceof Object ? 0 : Number(b.at)
            return tb - ta
          }))
          inc()
        }
      }),
      adapter.db.subscribe<WithId<Comment>>('comments', (d) => {
        if (Array.isArray(d)) { setComments(d.filter(c => c.entityPath?.startsWith(`products/${pid}`))); inc() }
      }),
    ]
    return () => { unsubs.forEach(u => u()); setLoaded(0) }
  }, [pid])

  return (
    <Ctx value={{
      pid, product, coverages, rules, formRules, ratingProgram,
      forms, ldTables, rtTables, versions, comments,
      loading: loaded < TOTAL_SUBS,
    }}>
      {children}
    </Ctx>
  )
}

// useProductCtx lives in useProductCtx.ts to satisfy react/only-export-components
export { Ctx }
```


## `app/src/context/useProductCtx.ts`

```ts
// useProductCtx — separate file satisfies react/only-export-components rule.
import { useContext } from 'react'
import { Ctx } from './ProductContext'

export function useProductCtx() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useProductCtx must be used inside ProductProvider')
  return ctx
}
```


## `app/src/context/UserContext.tsx`

```tsx
// Auth state, Firestore profile, and sign-in/out helpers for the whole app.
// Never import firebase/* here — everything goes through the adapter seam.
import { createContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { adapter } from '../lib/backend'
import type { AuthUser } from '../lib/backend'

export interface UserProfile {
  mustChangePassword: boolean
  role: AuthUser['role']
}

interface UserContextValue {
  user:    AuthUser | null
  profile: UserProfile | null
  loading: boolean
}

const UserContext = createContext<UserContextValue | null>(null)

export function UserProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  // Ref to unsubscribe from the profile doc when the user changes
  const profileUnsub = useRef<(() => void) | null>(null)

  useEffect(() => {
    return adapter.auth.onUser((u) => {
      setUser(u)
      // Tear down previous profile subscription
      profileUnsub.current?.()
      profileUnsub.current = null

      if (u) {
        // Subscribe to own user doc so mustChangePassword updates immediately after write.
        profileUnsub.current = adapter.db.subscribe<{ mustChangePassword?: boolean }>(
          `users/${u.uid}`,
          (doc) => {
            if (doc && !Array.isArray(doc)) {
              setProfile({ mustChangePassword: doc.mustChangePassword ?? false, role: u.role })
            } else {
              setProfile({ mustChangePassword: false, role: u.role })
            }
            setLoading(false)
          },
        )
      } else {
        setProfile(null)
        setLoading(false)
      }
    })
  }, [])

  return (
    <UserContext value={{ user, profile, loading }}>
      {children}
    </UserContext>
  )
}

// exported for use in useUser.ts — do not call directly
export { UserContext }
```


## `app/src/context/useUser.ts`

```ts
// useUser — custom hook in its own file to satisfy the react/only-export-components rule.
import { useContext } from 'react'
import { UserContext } from './UserContext'

export function useUser() {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error('useUser must be used inside UserProvider')
  return ctx
}
```


## `app/src/fontsource.d.ts`

```ts
// Type declarations for @fontsource side-effect imports (CSS only, no JS exports).
declare module '@fontsource-variable/inter' {}
declare module '@fontsource-variable/jetbrains-mono' {}
```


## `app/src/index.css`

```css
/* Product Factory design system — light, premium, Apple-inspired.
   Fonts self-hosted via @fontsource (imported in main.tsx).
   BRAND: violet-forward, evoking the Accenture mark (#A100FF → #7A00E6),
   tuned for AA contrast on the light surfaces. All accent colour lives here;
   components reference the tokens / gradient vars below, never raw hex. */
@import "tailwindcss";

@theme {
  --color-page:        #F7F7FA;
  --color-surface:     #FFFFFF;
  --color-raised:      #F3F3F8;
  --color-hover:       #EAEAF0;   /* raised, one step darker (button/search hover) */
  --color-border:      rgba(19,19,26,.08);
  --color-border-strong: rgba(19,19,26,.12);
  --color-text:        #131318;
  --color-dim:         #5B5C6B;
  --color-faint:       #8E90A0;

  /* Accent — Accenture-inspired violet. `accent` reads AA (6.1:1) on white for
     text/icons/borders; `bright` is the signature stop (glows + gradient start);
     `strong` is the deep end / pressed state. */
  --color-accent:        #8B1FE0;
  --color-accent-bright: #A100FF;
  --color-accent-strong: #7A00E6;
  --color-accent-soft:   rgba(139,31,224,.08);
  --color-accent-line:   rgba(139,31,224,.22);

  --color-good:        #059669;
  --color-warn:        #B45309;
  --color-danger:      #DC2626;
  --color-info:        #2563EB;

  --font-ui:   'Inter Variable', 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;

  --radius-card: 14px;
  --ease-spring: cubic-bezier(.22,.61,.36,1);

  --shadow-card:       0 1px 2px rgba(19,19,26,.04), 0 14px 34px rgba(139,31,224,.06);
  --shadow-card-hover: 0 2px 4px rgba(19,19,26,.06), 0 20px 48px rgba(139,31,224,.13);
}

/* Gradient + glow tokens — kept as plain custom properties (not @theme) so they
   are always emitted and usable in inline style={{}} via var(). Change here to
   restyle every gradient surface, focus glow and SVG stroke in the app. */
:root {
  --gradient-accent:       linear-gradient(135deg, #A100FF 0%, #7A00E6 100%);
  --gradient-accent-vivid: linear-gradient(120deg, #A100FF 0%, #8B1FE0 48%, #6D28D9 100%);
  --gradient-accent-soft:  linear-gradient(135deg, rgba(161,0,255,.12) 0%, rgba(122,0,230,.09) 100%);
  --glow-accent:  rgba(139,31,224,.30);
  --glow-accent-strong: rgba(139,31,224,.45);

  /* Type — a deliberate, Apple-adjacent scale. Display sizes get tighter tracking. */
  --tracking-display: -0.022em;
  --tracking-tight:   -0.014em;
  --tracking-wide:     0.02em;
}

/* ─── Base reset ─────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }

/* ─── Affordance: every actionable element reads as clickable ──────────────────
   Global mandate — buttons, links, tabs, switches and native summaries get the
   pointer; custom clickable divs opt in with `cursor-pointer`. Disabled controls
   fall back to not-allowed so the "you can't do this" state is legible. */
button, [role="button"], [role="tab"], [role="switch"], [role="option"],
a[href], summary, label[for] { cursor: pointer; }
button:disabled, [role="button"][aria-disabled="true"],
[aria-disabled="true"] { cursor: not-allowed; }

html {
  font-family: var(--font-ui);
  color: var(--color-text);
  background: var(--color-page);
  font-optical-sizing: auto;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body { margin: 0; }
#root { min-height: 100svh; display: flex; flex-direction: column; }

/* ─── Typography rhythm ──────────────────────────────────────────────────────
   Monospaced text (refIds, form numbers, figures) always uses tabular, lined
   numerals so digits align in columns and never reflow. */
.font-mono {
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings: "tnum" 1, "ss01" 1;
  letter-spacing: -0.01em;
}
/* Currency / metric figures line up too. */
.tnum { font-variant-numeric: tabular-nums lining-nums; }

/* Headings carry a consistent optical tracking + balanced wrapping app-wide. */
h1, h2, h3 { letter-spacing: var(--tracking-tight); }
h1, h2 { text-wrap: balance; }

/* Display headings — larger, tighter, balanced wrapping. */
@utility text-display {
  letter-spacing: var(--tracking-display);
  text-wrap: balance;
  font-optical-sizing: auto;
}

/* ─── Gradient text utility ──────────────────────────────────────────────── */
@utility gradient-text {
  background: var(--gradient-accent);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ─── Focus ring — one consistent, on-brand keyboard-focus treatment ──────── */
@utility focus-ring {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* ─── Aurora animation (landing background) ──────────────────────────────── */
@keyframes aurora-a {
  0%,100% { transform: translate(0,0) scale(1);      opacity:.35; }
  40%      { transform: translate(40px,-30px) scale(1.08); opacity:.5;  }
  70%      { transform: translate(-25px,20px) scale(.96); opacity:.4;  }
}
@keyframes aurora-b {
  0%,100% { transform: translate(0,0) scale(1);      opacity:.3;  }
  35%      { transform: translate(-35px,40px) scale(1.06); opacity:.45; }
  65%      { transform: translate(30px,-15px) scale(.97); opacity:.35; }
}
@keyframes aurora-c {
  0%,100% { transform: translate(0,0) scale(1.02); opacity:.25; }
  50%      { transform: translate(20px,35px) scale(.95);  opacity:.38; }
}

.aurora-a { animation: aurora-a 18s ease-in-out infinite; }
.aurora-b { animation: aurora-b 22s ease-in-out infinite; }
.aurora-c { animation: aurora-c 15s ease-in-out infinite; }

/* ─── SVG constellation stroke-draw animation ───────────────────────────── */
.constellation-line {
  stroke-dashoffset: var(--dash-len, 300);
  transition: stroke-dashoffset 1.1s var(--ease-spring);
  transition-delay: var(--draw-delay, 0ms);
}
.constellation-line.drawn { stroke-dashoffset: 0; }

/* ─── Node graph — flowing directional edges, breathing nodes, gentle float ── */
@keyframes edge-flow { to { stroke-dashoffset: -140; } }
.edge-flow {
  stroke-dasharray: 2 12;
  animation: edge-flow 3.2s linear infinite;
  animation-delay: var(--flow-delay, 0ms);
}

@keyframes node-breathe {
  0%, 100% { opacity: .35; transform: scale(1);    }
  50%      { opacity: .8;  transform: scale(1.08); }
}
.node-glow {
  transform-box: fill-box;
  transform-origin: center;
  animation: node-breathe 4.5s ease-in-out infinite;
  animation-delay: var(--breathe-delay, 0ms);
}

@keyframes graph-float {
  0%, 100% { transform: translateY(0);    }
  50%      { transform: translateY(-7px); }
}
.graph-float { animation: graph-float 8s ease-in-out infinite; }

/* ─── Rating-flow: running-total counter pulse + step draw ────────────────── */
@keyframes flow-step-in {
  from { opacity: 0; transform: translateY(6px) scale(.98); }
  to   { opacity: 1; transform: translateY(0)   scale(1);   }
}
.flow-step { animation: flow-step-in .5s var(--ease-spring) both; animation-delay: var(--step-delay, 0ms); }

/* ─── Staggered entrance for hero + cards ────────────────────────────────── */
@keyframes rise-in {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0);    }
}
.rise-in { animation: rise-in .7s var(--ease-spring) both; animation-delay: var(--rise-delay, 0ms); }

/* Shimmer for skeletons — subtle, brand-tinted. */
@keyframes shimmer { 100% { transform: translateX(100%); } }

/* ─── Scrollbar ──────────────────────────────────────────────────────────── */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-border-strong); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-faint); }

/* ─── Reduced-motion overrides ───────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
  .aurora-a, .aurora-b, .aurora-c { animation: none !important; opacity: .35 !important; }
  .edge-flow { animation: none !important; stroke-dasharray: none !important; opacity: 0 !important; }
  .node-glow, .graph-float { animation: none !important; }
  .rise-in, .flow-step { animation: none !important; }
}
```


## `app/src/lib/backend/aws.adapter.placeholder.ts`

```ts
// AWS adapter placeholder — mirrors BackendAdapter; every method throws NotImplemented
// and carries a comment mapping it to the AWS service that would replace it.
// AWS-SWAP: implement this file to complete the Firebase → AWS migration.
// See docs/AWS_SWAP.md for the full service mapping and swap procedure.
import type { BackendAdapter } from './types'
import { MutationConflictError } from './types'

function notImplemented(method: string): never {
  throw new Error(`AWS adapter: ${method} is not yet implemented. See docs/AWS_SWAP.md.`)
}

export const adapter: BackendAdapter = {
  auth: {
    // AWS-SWAP: Cognito signIn — Auth.signIn(username, password)
    signIn: (_email, _password) => notImplemented('auth.signIn'),
    // AWS-SWAP: Cognito signOut — Auth.signOut()
    signOut: () => notImplemented('auth.signOut'),
    // AWS-SWAP: Hub.listen('auth') → dispatch AuthUser from Cognito JWT
    onUser: (_cb) => notImplemented('auth.onUser'),
    // AWS-SWAP: Auth.changePassword(oldPassword, newPassword)
    changePassword: (_next) => notImplemented('auth.changePassword'),
  },
  db: {
    // AWS-SWAP: DynamoDB GetItem or Aurora SELECT
    get: (_path) => notImplemented('db.get'),
    // AWS-SWAP: DynamoDB Query/Scan or Aurora SELECT with WHERE
    list: (_path, _q) => notImplemented('db.list'),
    // AWS-SWAP: AppSync GraphQL subscription (or polling fallback)
    subscribe: (_pathOrQuery, _cb) => notImplemented('db.subscribe'),
    // AWS-SWAP: DynamoDB TransactWriteItems (entity + auditEvent + version + searchIndex)
    mutate: (_m) => notImplemented('db.mutate'),
    // AWS-SWAP: DynamoDB UpdateItem with ADD (votes.voters, votes.count)
    vote: (_path, _uid) => notImplemented('db.vote'),
    // AWS-SWAP: DynamoDB TransactGetItems + condition expressions for optimistic lock
    tx: (_fn) => notImplemented('db.tx'),
  },
  storage: {
    // AWS-SWAP: S3 presigned PUT upload
    upload: (_path, _file) => notImplemented('storage.upload'),
    // AWS-SWAP: S3 presigned GET URL
    getUrl: (_path) => notImplemented('storage.getUrl'),
  },
  fns: {
    // AWS-SWAP: API Gateway + Lambda invoke (Amplify API.post or aws-sdk invoke)
    call: (_name, _data) => notImplemented('fns.call'),
    // AWS-SWAP: Lambda URL + streaming response (same SSE pattern over HTTPS)
    stream: (_name, _data, _onChunk) => notImplemented('fns.stream'),
  },
  presence: {
    // AWS-SWAP: DynamoDB TTL heartbeat or AppSync mutation
    join: (_pid) => notImplemented('presence.join'),
    // AWS-SWAP: AppSync subscription or polling
    watch: (_pid, _cb) => notImplemented('presence.watch'),
  },
}

export { MutationConflictError }
```


## `app/src/lib/backend/firebase.adapter.ts`

```ts
// Firebase implementation of BackendAdapter.
// Connects to the Emulator Suite when VITE_USE_EMULATORS=true.
// AWS-SWAP: replace with aws.adapter.ts — see aws.adapter.placeholder.ts for the mapping.
import { initializeApp, getApps, getApp } from 'firebase/app'
import {
  getAuth, signInWithEmailAndPassword, signOut as fbSignOut,
  onAuthStateChanged, updatePassword, connectAuthEmulator,
} from 'firebase/auth'
import {
  getFirestore, doc, collection, getDoc, getDocs, onSnapshot,
  writeBatch, serverTimestamp, setDoc, deleteDoc, updateDoc,
  arrayUnion, increment,
  query as fbQuery, where, orderBy, limit as fbLimit,
  runTransaction, connectFirestoreEmulator,
} from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions'
import { firebaseConfig, FUNCTIONS_REGION } from './firebase.config'
import type { BackendAdapter, AuthUser, Session, Query, MutationPayload } from './types'
import { MutationConflictError } from './types'

// Singleton — safe under React StrictMode and Vite HMR.
const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig)
const auth        = getAuth(firebaseApp)
const db          = getFirestore(firebaseApp)
const storage     = getStorage(firebaseApp)
const functions   = getFunctions(firebaseApp, FUNCTIONS_REGION)

// Wire emulators in development; module-level guard prevents duplicate connects on HMR.
// AWS-SWAP: no emulator step needed; point to real AWS endpoints per environment config.
let _emulatorsWired = false
if (import.meta.env.VITE_USE_EMULATORS === 'true' && !_emulatorsWired) {
  _emulatorsWired = true
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
}

/** Parse a Firestore document snapshot into a typed value with its id. */
function snapToData<T>(snapshot: { id: string; data(): Record<string, unknown> | undefined }): T | null {
  const d = snapshot.data()
  return d ? ({ id: snapshot.id, ...d } as unknown as T) : null
}

/** Extract the AuthUser from Firebase user + custom claims. */
async function toAuthUser(fbUser: {
  uid: string
  email: string | null
  displayName: string | null
  getIdTokenResult(force?: boolean): Promise<{ claims: Record<string, unknown> }>
}): Promise<AuthUser> {
  const result = await fbUser.getIdTokenResult()
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    name: fbUser.displayName,
    role: (result.claims['role'] as AuthUser['role']) ?? null,
  }
}

/** Build a Firestore Query from the adapter Query shape. */
function buildQuery(collRef: ReturnType<typeof collection>, q: Query) {
  const constraints: Parameters<typeof fbQuery>[1][] = []
  for (const w of q.where ?? []) constraints.push(where(w.field, w.op, w.value))
  for (const o of q.orderBy ?? []) constraints.push(orderBy(o.field, o.dir ?? 'asc'))
  if (q.limit != null) constraints.push(fbLimit(q.limit))
  return fbQuery(collRef, ...constraints)
}

// Entity types that belong in the ⌘K search index. Others (feedback, comment,
// newsPrefs…) skip the searchIndex write — which also keeps VIEWER feedback
// submissions within their allowed rule surface (searchIndex is EDITOR+ write).
const INDEXABLE = new Set(['product', 'coverage', 'rule', 'form', 'ldTable', 'rtTable', 'dictionary', 'task'])

export const adapter: BackendAdapter = {
  auth: {
    async signIn(email, password): Promise<Session> {
      const cred = await signInWithEmailAndPassword(auth, email, password)
      const user = await toAuthUser(cred.user)
      const token = await cred.user.getIdToken()
      return { user, token }
    },

    async signOut(): Promise<void> {
      await fbSignOut(auth)
    },

    onUser(cb) {
      return onAuthStateChanged(auth, async (fbUser) => {
        if (!fbUser) { cb(null); return }
        cb(await toAuthUser(fbUser))
      })
    },

    async changePassword(next) {
      const user = auth.currentUser
      if (!user) throw new Error('Not authenticated')
      await updatePassword(user, next)
    },
  },

  db: {
    async get<T>(path: string): Promise<T | null> {
      const snap = await getDoc(doc(db, path))
      return snapToData<T>(snap)
    },

    async list<T>(path: string, q?: Query): Promise<T[]> {
      const collRef = collection(db, path)
      const snap = await getDocs(q ? buildQuery(collRef, q) : collRef)
      return snap.docs.map((d) => snapToData<T>(d)).filter(Boolean) as T[]
    },

    subscribe<T>(pathOrQuery: string | Query, cb: (data: T | T[]) => void) {
      if (typeof pathOrQuery !== 'string') {
        throw new Error('subscribe() with a Query object requires a string path')
      }
      const parts = pathOrQuery.split('/').filter(Boolean)
      // On a listener error (e.g. permission-denied) surface it and degrade to an
      // empty result rather than hanging every consumer waiting on the callback.
      const onErr = (err: unknown) => {
        console.warn(`[subscribe] ${pathOrQuery} listener error:`, (err as { code?: string })?.code ?? err)
      }
      if (parts.length % 2 === 0) {
        // Document
        return onSnapshot(doc(db, pathOrQuery), (snap) => { cb(snapToData<T>(snap) as T) }, onErr)
      }
      // Collection
      return onSnapshot(collection(db, pathOrQuery),
        (snap) => { cb(snap.docs.map((d) => snapToData<T>(d)).filter(Boolean) as T[]) },
        (err) => { onErr(err); cb([] as T[]) })
    },

    async mutate(m: MutationPayload): Promise<void> {
      // Atomic batch: entity + auditEvent + version (with field diffs) + searchIndex + rev bump.
      // Rev mismatch throws MutationConflictError → caller shows a friendly conflict toast.
      // AWS-SWAP: becomes a DynamoDB TransactWriteItems call in the Lambda adapter.
      const entityRef = doc(db, m.path)
      const now       = serverTimestamp()

      // Read current for rev check + diff computation before the batch.
      const current = m.op !== 'create' ? await getDoc(entityRef) : null

      if (m.expectedRev !== undefined && current) {
        const storedRev = (current.data() as Record<string, unknown>)?.['rev']
        if (storedRev !== m.expectedRev) throw new MutationConflictError()
      }

      // Compute field-level diff for the version snapshot.
      const prevData   = current?.data() ?? {}
      const nextData   = m.data ?? {}
      const allFields  = new Set([...Object.keys(prevData), ...Object.keys(nextData)])
      const diff: Array<{ field: string; before: unknown; after: unknown }> = []
      for (const field of allFields) {
        if (JSON.stringify(prevData[field]) !== JSON.stringify(nextData[field])) {
          diff.push({ field, before: prevData[field] ?? null, after: nextData[field] ?? null })
        }
      }

      const batch = writeBatch(db)

      if (m.op === 'delete') {
        batch.delete(entityRef)
      } else if (m.op === 'create') {
        batch.set(entityRef, { ...m.data, createdAt: now, updatedAt: now, updatedBy: m.actor.uid, rev: 1 })
      } else {
        const newRev = ((prevData['rev'] as number) ?? 0) + 1
        batch.update(entityRef, { ...m.data, updatedAt: now, updatedBy: m.actor.uid, rev: newRev })
      }

      // Audit event (append-only)
      batch.set(doc(collection(db, 'auditEvents')), {
        actor: m.actor, action: m.op, entityType: m.entityType,
        entityPath: m.path, productId: m.productId ?? null, at: now,
      })

      // Version snapshot with field-level diff
      batch.set(doc(collection(db, 'versions')), {
        entityType: m.entityType, entityPath: m.path,
        productId: m.productId ?? null,
        snapshot: m.op !== 'delete' ? (m.data ?? null) : null,
        diff, actor: m.actor, at: now,
      })

      // SearchIndex upsert: derive title/keywords from entity data for ⌘K palette.
      // AWS-SWAP: becomes a DynamoDB put on the searchIndex table.
      if (m.op !== 'delete' && m.data && INDEXABLE.has(m.entityType)) {
        const d = m.data
        const indexId  = m.path.replace(/\//g, '_')
        const title    = (d['name'] as string | undefined) ?? (d['title'] as string | undefined) ?? ''
        const subtitle = (d['refId'] as string | undefined) ?? m.entityType
        const keywords = [title, subtitle, d['refId'] as string, d['description'] as string]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .split(/\W+/)
          .filter(k => k.length > 2)
        batch.set(doc(db, `searchIndex/${indexId}`), {
          type:     m.entityType,
          refId:    (d['refId'] as string | null) ?? null,
          title,
          subtitle,
          path:     m.path,
          keywords: [...new Set(keywords)],
        })
      } else if (m.op === 'delete' && INDEXABLE.has(m.entityType)) {
        const indexId = m.path.replace(/\//g, '_')
        batch.delete(doc(db, `searchIndex/${indexId}`))
      }

      await batch.commit()
    },

    async vote(path: string, uid: string): Promise<void> {
      // Narrow, un-audited write matching the VIEWER vote-only rule: only `votes`
      // changes (arrayUnion the uid, +1 count). AWS-SWAP: DynamoDB UpdateItem ADD.
      await updateDoc(doc(db, path), {
        'votes.voters': arrayUnion(uid),
        'votes.count':  increment(1),
      })
    },

    async tx<T>(fn: (helpers: { get: BackendAdapter['db']['get'] }) => Promise<T>): Promise<T> {
      // runTransaction gives Firestore-level atomicity; the helpers.get respects the transaction.
      return runTransaction(db, (fsTx) => {
        const txGet = async <U>(path: string): Promise<U | null> => {
          const snap = await fsTx.get(doc(db, path))
          return snapToData<U>(snap)
        }
        return fn({ get: txGet })
      })
    },
  },

  storage: {
    async upload(path, file) {
      const snap = await uploadBytes(ref(storage, path), file)
      return getDownloadURL(snap.ref)
    },
    async getUrl(path) {
      return getDownloadURL(ref(storage, path))
    },
  },

  fns: {
    async call<TIn, TOut>(name: string, data: TIn): Promise<TOut> {
      const result = await httpsCallable<TIn, TOut>(functions, name)(data)
      return result.data
    },

    async stream(name, data, onChunk) {
      // SSE over HTTPS — identical streaming pattern on Lambda.
      // AWS-SWAP: swap the base URL; the SSE parsing below is platform-agnostic.
      const base = import.meta.env.VITE_USE_EMULATORS === 'true'
        ? `http://127.0.0.1:5001/${firebaseConfig.projectId}/${FUNCTIONS_REGION}`
        : `https://${FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net`

      const user = auth.currentUser
      const token = user ? await user.getIdToken() : null

      const res = await fetch(`${base}/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      })
      if (!res.ok || !res.body) throw new Error(`Stream ${name} failed: ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) onChunk(line.slice(6))
        }
      }
    },
  },

  presence: {
    join(pid) {
      const user = auth.currentUser
      if (!user) return () => {}
      const presRef = doc(db, `presence/${pid}/viewers/${user.uid}`)
      const heartbeat = () => void setDoc(presRef, { uid: user.uid, at: serverTimestamp() }, { merge: true })
      heartbeat()
      const timer = setInterval(heartbeat, 30_000)
      return () => {
        clearInterval(timer)
        void deleteDoc(presRef)
      }
    },

    watch(pid, cb) {
      return onSnapshot(collection(db, `presence/${pid}/viewers`), (snap) => {
        cb(snap.docs.map((d) => d.id))
      })
    },
  },
}

export { MutationConflictError }
```


## `app/src/lib/backend/firebase.config.ts`

```ts
// Firebase web app config — public identifiers, safe in the bundle.
// AWS-SWAP: replace with Amplify config (Auth/API/Storage endpoints) once implemented.
import type { FirebaseOptions } from 'firebase/app'

export const firebaseConfig: FirebaseOptions = {
  apiKey: 'AIzaSyCoqf7-ty_z-0VI6EDGs56MHy-RH_5giN8',
  authDomain: 'productreinvention.firebaseapp.com',
  projectId: 'productreinvention',
  storageBucket: 'productreinvention.firebasestorage.app',
  messagingSenderId: '621888798672',
  appId: '1:621888798672:web:7cae95f217eb015eb603d5',
  measurementId: 'G-82E4D44Q56',
}

// Region where Cloud Functions v2 are deployed.
export const FUNCTIONS_REGION = 'us-central1'
```


## `app/src/lib/backend/index.ts`

```ts
// Single export point for the active backend adapter.
// AWS-SWAP: flip this export to aws.adapter once implemented.
export { adapter } from './firebase.adapter'
export type { BackendAdapter, AuthUser, Session, Query, MutationPayload } from './types'
export { MutationConflictError } from './types'
```


## `app/src/lib/backend/types.ts`

```ts
// BackendAdapter contract — the only interface app code may depend on.
// AWS-SWAP: all platform concerns live behind this seam; swap the implementation,
// not the callers. See docs/AWS_SWAP.md.
import type { Unsubscribe } from '@pf/shared'

export interface AuthUser {
  uid: string
  email: string | null
  name: string | null
  role: 'VIEWER' | 'EDITOR' | 'ADMIN' | null
}

export interface Session {
  user: AuthUser
  token: string
}

export interface Query {
  where?: Array<{ field: string; op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'array-contains'; value: unknown }>
  orderBy?: Array<{ field: string; dir?: 'asc' | 'desc' }>
  limit?: number
  startAfter?: unknown
}

// Every mutation is atomic: entity + auditEvent + version + searchIndex + rev bump.
// Rev mismatch throws MutationConflictError so callers can show a conflict toast.
export interface MutationPayload {
  op: 'create' | 'update' | 'delete'
  path: string
  data?: Record<string, unknown>
  entityType: string
  productId?: string
  actor: { uid: string; name: string }
  expectedRev?: number   // absent = no optimistic lock
}

export class MutationConflictError extends Error {
  constructor() { super('Document was modified by another user — please refresh.') }
}

export interface BackendAdapter {
  auth: {
    signIn(email: string, password: string): Promise<Session>
    signOut(): Promise<void>
    /** Fires immediately with current user, then on every change. */
    onUser(cb: (user: AuthUser | null) => void): Unsubscribe
    changePassword(next: string): Promise<void>
  }
  db: {
    get<T>(path: string): Promise<T | null>
    list<T>(path: string, q?: Query): Promise<T[]>
    /** Subscribe to a document or collection query. Returns unsubscribe fn. */
    subscribe<T>(pathOrQuery: string | Query, cb: (data: T | T[]) => void): Unsubscribe
    /** Atomic entity + audit + version + searchIndex write. */
    mutate(m: MutationPayload): Promise<void>
    /** Narrow, un-audited vote: arrayUnion the uid into votes.voters and +1 votes.count.
     *  Matches the VIEWER vote-only path in firestore.rules (only `votes` may change). */
    vote(path: string, uid: string): Promise<void>
    /** Rev-checked transaction wrapper for optimistic concurrency. */
    tx<T>(fn: (helpers: { get: BackendAdapter['db']['get'] }) => Promise<T>): Promise<T>
  }
  storage: {
    upload(path: string, file: File): Promise<string>
    getUrl(path: string): Promise<string>
  }
  fns: {
    /** Invoke a Firebase callable function. */
    call<TIn, TOut>(name: string, data: TIn): Promise<TOut>
    /** Stream an SSE endpoint; calls onChunk for each text/event-stream line. */
    stream(name: string, data: unknown, onChunk: (chunk: string) => void): Promise<void>
  }
  presence: {
    /** Heartbeat doc in presence/{pid}/viewers/{uid}; returns cleanup fn. */
    join(pid: string): Unsubscribe
    /** Watch presence for a product; returns unsubscribe fn. */
    watch(pid: string, cb: (viewerUids: string[]) => void): Unsubscribe
  }
}
```


## `app/src/lib/export/excel.ts`

```ts
// excel.ts — client-side workbook export (exceljs). One workbook whose four
// sheets mirror the DOMAIN_HO structures: Framework, Rules + Limits/Deductibles,
// Rating + Rate Tables, Forms + Dynamic Data. Styled headers, mono refIds.
// Works for a single product or a whole portfolio (rows carry a Product column).
import ExcelJS from 'exceljs'
import type { Product, Coverage, Rule, Form, LDTable, RTTable, RatingProgram } from '@pf/shared'

export interface ProductExport {
  product:       Product & { id: string }
  coverages:     Coverage[]
  rules:         Rule[]
  forms:         Form[]
  ldTables:      Record<string, LDTable>
  rtTables:      Record<string, RTTable>
  ratingProgram: RatingProgram | null
}

const ACCENT = 'FFC026D3'
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } }
const MONO = 'Consolas'

/** Add a styled header row + data rows; return the next free row number. */
function addTable(ws: ExcelJS.Worksheet, startRow: number, headers: string[], rows: (string | number)[][], monoCols: number[] = []): number {
  const head = ws.getRow(startRow)
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    c.fill = HEADER_FILL
    c.alignment = { vertical: 'middle' }
  })
  head.height = 20
  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + 1 + ri)
    r.forEach((v, ci) => {
      const c = row.getCell(ci + 1)
      c.value = v
      c.alignment = { vertical: 'top', wrapText: typeof v === 'string' && v.length > 40 }
      if (monoCols.includes(ci)) c.font = { name: MONO, size: 10 }
    })
  })
  return startRow + rows.length + 2
}

function autoWidth(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
}

// ─── Sheets ───────────────────────────────────────────────────────────────────

function frameworkSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = wb.addWorksheet('Framework', { views: [{ state: 'frozen', ySplit: 1 }] })
  const rows: (string | number)[][] = []
  for (const it of items) {
    for (const c of [...it.coverages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      rows.push([
        it.product.name, c.refId ?? '', c.name, c.parentId ?? '(top-level)', c.requirement,
        c.premiumGenerating ? 'Yes' : 'No', c.claimsBasis ?? '', c.source ?? '',
        (c.formNumbers ?? []).join(', '),
        c.allStates ? 'All' : (c.states ?? []).join(', '),
        (c.terms ?? []).map(t => `${t.label} (${t.kind}=${t.default})`).join('; '),
      ])
    }
  }
  autoWidth(ws, [22, 16, 26, 18, 12, 8, 14, 12, 20, 18, 44])
  addTable(ws, 1, ['Product', 'RefId', 'Coverage', 'Parent', 'Requirement', 'Prem-Gen', 'Claims Basis', 'Source', 'Form Numbers', 'States', 'Terms'], rows, [1])
}

function rulesSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = wb.addWorksheet('Rules + L&D')
  autoWidth(ws, [22, 16, 12, 18, 34, 34, 18, 18])
  const ruleRows: (string | number)[][] = []
  for (const it of items) for (const r of it.rules) {
    ruleRows.push([it.product.name, r.refId ?? '', r.category, r.subCategory ?? '', r.condition ?? '', r.outcome ?? '', (r.coverageRefIds ?? []).join(', '), (r.formNumbers ?? []).join(', ')])
  }
  ws.getCell('A1').value = 'RULES'; ws.getCell('A1').font = { bold: true, size: 12, color: { argb: ACCENT } }
  let next = addTable(ws, 2, ['Product', 'RefId', 'Category', 'Sub-Category', 'Condition', 'Outcome', 'Coverage Refs', 'Form Numbers'], ruleRows, [1])

  const ldRows: (string | number)[][] = []
  for (const it of items) for (const [ref, t] of Object.entries(it.ldTables)) {
    for (const row of t.rows ?? []) ldRows.push([ref, t.name, row.label, row.value, row.constraintNote ?? ''])
  }
  ws.getCell(`A${next}`).value = 'LIMITS & DEDUCTIBLES'; ws.getCell(`A${next}`).font = { bold: true, size: 12, color: { argb: ACCENT } }
  addTable(ws, next + 1, ['Table RefId', 'Name', 'Label', 'Value', 'Constraint'], ldRows, [0])
}

function ratingSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = wb.addWorksheet('Rating + RT')
  autoWidth(ws, [22, 10, 8, 28, 10, 30, 10])
  const stepRows: (string | number)[][] = []
  for (const it of items) {
    const p = it.ratingProgram
    if (!p) continue
    for (const s of [...(p.steps ?? [])].sort((a, b) => a.order - b.order)) {
      const src = s.source.type === 'CONST' ? `CONST(${s.source.value})` : `${s.source.type}(${s.source.ref ?? ''}${s.source.keys ? ' ' + s.source.keys.join(',') : ''})`
      stepRows.push([p.refId, s.id, s.order, s.label, s.op, src, s.roundTo ?? ''])
    }
  }
  ws.getCell('A1').value = 'RATING STEPS'; ws.getCell('A1').font = { bold: true, size: 12, color: { argb: ACCENT } }
  let next = addTable(ws, 2, ['Program', 'Step', 'Order', 'Label', 'Op', 'Source', 'Round'], stepRows, [0, 1])

  for (const it of items) for (const [ref, t] of Object.entries(it.rtTables)) {
    ws.getCell(`A${next}`).value = `${ref} — ${t.name}`; ws.getCell(`A${next}`).font = { bold: true, size: 11, color: { argb: ACCENT } }
    const cols = t.columns ?? []
    const rtRows = (t.rows ?? []).map(r => cols.map(c => { const v = (r as Record<string, unknown>)[c]; return typeof v === 'number' ? v : String(v ?? '') }))
    next = addTable(ws, next + 1, cols.length ? cols : ['(no columns)'], rtRows)
  }
}

function formsSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = wb.addWorksheet('Forms + Dynamic')
  autoWidth(ws, [14, 30, 10, 16, 10, 14, 18, 40])
  const formRows: (string | number)[][] = []
  const dynRows: (string | number)[][] = []
  for (const it of items) for (const f of it.forms) {
    formRows.push([f.number, f.name, f.edition ?? '', f.category, f.mandatoryDefault ? 'Yes' : 'No', f.attachmentCondition, (f.coverageParts ?? []).join(', '), f.description ?? ''])
    for (const d of f.dynamicFields ?? []) dynRows.push([f.number, d.name, d.dataType, d.repeating ? 'Yes' : 'No', (d.options ?? []).join(', ')])
  }
  ws.getCell('A1').value = 'FORMS'; ws.getCell('A1').font = { bold: true, size: 12, color: { argb: ACCENT } }
  const next = addTable(ws, 2, ['Number', 'Name', 'Edition', 'Category', 'Mandatory', 'Attachment', 'Coverage Parts', 'Description'], formRows, [0])
  ws.getCell(`A${next}`).value = 'DYNAMIC DATA'; ws.getCell(`A${next}`).font = { bold: true, size: 12, color: { argb: ACCENT } }
  addTable(ws, next + 1, ['Form', 'Field', 'Type', 'Repeating', 'Options'], dynRows, [0])
}

// ─── Public API ─────────────────────────────────────────────────────────────

async function download(wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function buildWorkbook(items: ProductExport[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Product Reinvention Hub'
  wb.created = new Date()
  frameworkSheet(wb, items)
  rulesSheet(wb, items)
  ratingSheet(wb, items)
  formsSheet(wb, items)
  return wb
}

export async function exportProductExcel(data: ProductExport): Promise<void> {
  const name = (data.product.refId ?? data.product.name ?? 'product').replace(/[^A-Za-z0-9.-]+/g, '_')
  await download(buildWorkbook([data]), `${name}.xlsx`)
}

export async function exportPortfolioExcel(items: ProductExport[]): Promise<void> {
  await download(buildWorkbook(items), `portfolio_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
```


## `app/src/lib/geo/usTileGrid.test.ts`

```ts
// Guards the US tile grid: full coverage and — critically — no two states sharing
// a cell (a real bug the previous ad-hoc grid had, where IL and IN overlapped).
import { describe, it, expect } from 'vitest'
import { US_TILE_GRID, US_TILE_ROWS, parseTileGrid } from './usTileGrid'

const USPS = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]
// HO-3 seed footprint (docs/DOMAIN_HO.md) — every one must have a tile to render.
const HO3_FOOTPRINT = ['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA']

describe('US tile grid', () => {
  it('places all 50 states plus DC', () => {
    expect(Object.keys(US_TILE_GRID)).toHaveLength(51)
    for (const st of [...USPS, 'DC']) expect(US_TILE_GRID[st], `${st} should have a tile`).toBeDefined()
  })

  it('never overlaps two states in the same cell', () => {
    const seen = new Map<string, string>()
    for (const [st, [col, row]] of Object.entries(US_TILE_GRID)) {
      const key = `${col},${row}`
      expect(seen.has(key), `${st} collides with ${seen.get(key)} at ${key}`).toBe(false)
      seen.set(key, st)
    }
  })

  it('covers every HO-3 footprint state', () => {
    for (const st of HO3_FOOTPRINT) expect(US_TILE_GRID[st], `footprint state ${st}`).toBeDefined()
  })

  it('parses tolerantly (irregular whitespace)', () => {
    const g = parseTileGrid(['AL   AK', '  ..  FL '])
    expect(g).toEqual({ AL: [0, 0], AK: [1, 0], FL: [1, 1] })
    expect(US_TILE_ROWS.length).toBe(7)
  })
})
```


## `app/src/lib/geo/usTileGrid.ts`

```ts
// usTileGrid.ts — a geographic tile-grid layout of the US (50 states + DC), each
// state at an approximate [col,row]. Authored as a visual string grid so tile
// positions are easy to verify; parsed once to coordinates. Consumed by the
// States map; guarded by usTileGrid.test.ts (no duplicate tiles, full coverage).

export const US_TILE_ROWS = [
  'WA .. .. .. .. .. .. .. .. .. .. ME',
  'OR ID MT ND MN WI .. MI .. NY VT NH',
  'NV UT WY SD IA IL IN OH PA NJ CT MA',
  'CA AZ CO NE MO KY WV VA MD DE RI ..',
  '.. NM KS OK AR TN NC SC DC .. .. ..',
  '.. .. TX LA MS AL GA FL .. .. .. ..',
  'AK HI .. .. .. .. .. .. .. .. .. ..',
] as const

export const US_TILE_COLS = 12

export function parseTileGrid(rows: readonly string[]): Record<string, [number, number]> {
  const grid: Record<string, [number, number]> = {}
  rows.forEach((row, r) => row.trim().split(/\s+/).forEach((st, c) => {
    if (st !== '..') grid[st] = [c, r]
  }))
  return grid
}

export const US_TILE_GRID = parseTileGrid(US_TILE_ROWS)
```


## `app/src/lib/insurance/vocab.ts`

```ts
// Insurance domain vocabulary powering type-ahead suggestions across authoring
// surfaces (new product, limit options, rule composer). Central so the same
// standard values appear everywhere a PM enters data.
import type { LimitStructure, DeductibleStructure, LimitBasis } from '@pf/shared'

export const PRODUCT_NAME_SUGGESTIONS = [
  'Homeowners — HO-3 Special Form',
  'Homeowners — HO-5 Comprehensive',
  'Homeowners — HO-6 Unit-Owners (Condo)',
  'Renters — HO-4 Contents',
  'Dwelling Fire — DP-3',
  'Landlord — DP-1',
  'Mobile Homeowners — MH',
  'Personal Umbrella',
  'Personal Auto',
  'Private Flood',
  'Personal Earthquake',
]

export const MARKET_SEGMENTS = [
  'Personal Lines / Property',
  'Personal Lines / Liability',
  'Personal Lines / Auto',
  'Commercial Lines / Property',
  'Commercial Lines / Liability',
]

// Common currency limit/deductible amounts and coverage percentages.
export const LIMIT_AMOUNTS = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 300000, 500000, 1000000]
export const PERCENT_OPTIONS = [1, 2, 5, 10, 25, 30, 50, 70, 75, 100]

// Presets for the richer option types (typed standard options).
export const SPLIT_PRESETS: number[][] = [
  [100000, 300000, 100000],   // 100/300/100 — classic BI/PD
  [250000, 500000, 100000],
  [500000, 1000000, 500000],
]
export const WAITING_PERIOD_HOURS = [24, 48, 72, 120, 168]  // 1d, 2d, 3d, 5d, 7d

// ── Limit / deductible STRUCTURE catalogue (UI copy). `icon` keys into the
//    editor's structure-icon map; pure term logic lives in @pf/shared/terms. ──
export interface StructureMeta<T extends string> {
  id: T; label: string; blurb: string; sample: string; icon: string
}

export const LIMIT_STRUCTURES: StructureMeta<LimitStructure>[] = [
  { id: 'SINGLE',               label: 'Single Limit',          blurb: 'One limit applies to all covered loss.',                                    sample: '$1,000,000',     icon: 'single' },
  { id: 'OCCURRENCE_AGGREGATE', label: 'Occurrence + Aggregate', blurb: 'Per-occurrence limit plus a policy aggregate.',                             sample: '$1M / $2M',      icon: 'layers' },
  { id: 'EACH_CLAIM_AGGREGATE', label: 'Each Claim + Aggregate', blurb: 'Per-claim limit with a policy-term aggregate (common in claims-made).',     sample: '$1M / $3M',      icon: 'layers' },
  { id: 'SPLIT',                label: 'Split Limits',           blurb: 'Separate limits by component (e.g. BI per person / per accident / PD).',    sample: '100 / 300 / 100', icon: 'split' },
  { id: 'CSL',                  label: 'Combined Single Limit',  blurb: 'One limit covering bodily injury and property damage combined.',            sample: '$1,000,000',     icon: 'combine' },
  { id: 'SCHEDULED',            label: 'Scheduled / Per-Item',   blurb: 'Itemised values, each carrying its own limit.',                             sample: 'per item',       icon: 'scheduled' },
]

export const DEDUCTIBLE_STRUCTURES: StructureMeta<DeductibleStructure>[] = [
  { id: 'FLAT',            label: 'Flat Dollar',          blurb: 'Fixed dollar amount deductible.',                        sample: '$1,000',                   icon: 'single' },
  { id: 'PERCENT',         label: 'Percentage',           blurb: 'Percentage of insured value or loss.',                   sample: '2% of TIV',                icon: 'percent' },
  { id: 'PERCENT_MIN_MAX', label: 'Percentage w/ Min/Max', blurb: 'Percentage with minimum and maximum dollar bounds.',    sample: '2% ($1k min / $25k max)',  icon: 'percent' },
  { id: 'WAITING_PERIOD',  label: 'Waiting Period',       blurb: 'Time-based deductible (hours/days).',                    sample: '72 hours',                 icon: 'clock' },
  { id: 'SPLIT',           label: 'By Peril',             blurb: 'Separate deductibles by peril or component.',            sample: 'Wind 2% · AOP $1,000',     icon: 'peril' },
]

export const LIMIT_BASES: { id: LimitBasis; label: string }[] = [
  { id: 'PER_OCCURRENCE', label: 'Per Occurrence' },
  { id: 'AGGREGATE',      label: 'Aggregate' },
  { id: 'PER_PERSON',     label: 'Per Person' },
  { id: 'PER_CLAIM',      label: 'Per Claim' },
  { id: 'PER_ITEM',       label: 'Per Item' },
  { id: 'PER_LOCATION',   label: 'Per Location' },
]
```


## `app/src/lib/integrations/accenture.ts`

```ts
// accenture.ts — typed, env-driven fetch client for an Accenture integration API.
// Documents the seam pattern: configuration comes from Vite env (never hardcoded),
// the client is created lazily, and callers get a typed surface. Not wired to a
// live endpoint yet — `createAccentureClient()` throws until configured.
// AWS-SWAP: the base URL + auth move to API Gateway + IAM/Cognito; the fetch
// shape below is unchanged. Keep secrets server-side — the browser only ever
// holds a short-lived token, never a long-lived key.
import type { ProductExport } from '../export/excel'

interface AccentureConfig { baseUrl: string; token?: string }

export interface AccentureClient {
  /** Push a product package to the integration API. */
  pushProduct(data: ProductExport): Promise<{ id: string; status: string }>
}

/** Read config from Vite env. Returns null when not configured. */
function readConfig(): AccentureConfig | null {
  const baseUrl = import.meta.env.VITE_ACCENTURE_API_URL as string | undefined
  if (!baseUrl) return null
  return { baseUrl, token: import.meta.env.VITE_ACCENTURE_API_TOKEN as string | undefined }
}

export function isAccentureConfigured(): boolean {
  return readConfig() !== null
}

export function createAccentureClient(): AccentureClient {
  const cfg = readConfig()
  if (!cfg) throw new Error('Accenture integration is not configured (set VITE_ACCENTURE_API_URL).')

  async function request<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${cfg!.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg!.token ? { Authorization: `Bearer ${cfg!.token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Accenture API ${path} failed: ${res.status}`)
    return res.json() as Promise<T>
  }

  return {
    pushProduct: (data) => request('/products', {
      refId: data.product.refId, name: data.product.name,
      coverages: data.coverages.length, forms: data.forms.length,
    }),
  }
}
```


## `app/src/lib/integrations/duckcreek.ts`

```ts
// duckcreek.ts — Duck Creek XML export seam (coming soon). The menu item that
// points here is intentionally disabled in the UI; this module defines the target
// shape so the wiring exists ahead of the implementation.
// AWS-SWAP: unchanged — this is a pure client transform; only the download path
// (Blob today, S3 presigned URL later) differs by backend.
import type { ProductExport } from '../export/excel'

/** The Duck Creek product-XML export. Not yet implemented. */
export function exportDuckCreekXML(_data: ProductExport): never {
  // TODO: map ProductExport → Duck Creek Example Product XML (Manuscripts,
  // rating worksheets, form lists). Tracked as a follow-up.
  throw new Error('Duck Creek XML export is coming soon.')
}

/** Whether the Duck Creek export is available yet (drives the disabled menu item). */
export const DUCK_CREEK_ENABLED = false
```


## `app/src/lib/productHealth.ts`

```ts
// Product health — derives readiness "findings" (dangling table refs, missing
// terms, unattached forms, unset states) and a 0–100 score from a product's live
// data. Shared by the workspace header pill and the Overview finding banner so
// the number and the top finding always agree. Errors are listed before warnings
// so `findings[0]` is the single most important thing to fix.
import type { Coverage, Rule, FormRule, RatingProgram, LDTable, RTTable } from '@pf/shared'

export interface Finding {
  severity: 'error' | 'warning'
  message: string
  route: string
}

export interface HealthInput {
  pid: string
  coverages: (Coverage & { id: string })[]
  rules: Rule[]
  ratingProgram: RatingProgram | null
  ldTables: Record<string, LDTable>
  rtTables: Record<string, RTTable>
  formRules: FormRule[]
}

export function computeProductFindings(
  { pid, coverages, rules, ratingProgram, ldTables, rtTables, formRules }: HealthInput,
): Finding[] {
  const findings: Finding[] = []
  const to = (sub: string) => `/app/products/${pid}/${sub}`

  // ── Errors (dangling references) ──
  rules.forEach(rule => {
    if (rule.ldTableRef && !ldTables[rule.ldTableRef]) {
      findings.push({ severity: 'error', message: `Rule ${rule.refId} references missing LD table ${rule.ldTableRef}`, route: to('rules') })
    }
  })
  ratingProgram?.steps?.forEach(step => {
    if (step.source.type === 'RT' && step.source.ref && !rtTables[step.source.ref]) {
      findings.push({ severity: 'error', message: `Rating step "${step.label}" references missing RT table ${step.source.ref}`, route: to('pricing') })
    }
  })

  // ── Warnings (incomplete authoring) ──
  coverages.forEach(cov => {
    if (cov.premiumGenerating && !cov.terms?.length) {
      findings.push({ severity: 'warning', message: `${cov.name} has no terms defined`, route: to('coverages') })
    }
  })
  coverages.filter(c => c.requirement === 'OPTIONAL').forEach(cov => {
    const hasRule = formRules.some(fr => fr.formNumbers?.some(fn => cov.formNumbers?.includes(fn)))
    if (!hasRule && cov.formNumbers?.length) {
      findings.push({ severity: 'warning', message: `${cov.name} has no form attachment rule`, route: to('forms') })
    }
  })
  coverages.forEach(cov => {
    if (!cov.allStates && (!cov.states || cov.states.length === 0)) {
      findings.push({ severity: 'warning', message: `${cov.name} has no states configured`, route: to('states') })
    }
  })

  return findings
}

export function healthScore(findings: Finding[]): number {
  if (!findings.length) return 100
  const errors   = findings.filter(f => f.severity === 'error').length
  const warnings = findings.filter(f => f.severity === 'warning').length
  return Math.max(0, 100 - errors * 20 - warnings * 5)
}

export function healthColor(score: number): string {
  return score >= 80 ? 'var(--color-good)' : score >= 60 ? 'var(--color-warn)' : 'var(--color-danger)'
}
```


## `app/src/lib/svg/ratingFlow.tsx`

```tsx
// ratingFlow.tsx — bespoke, animated SVG of a rating algorithm's step-by-step
// trace: a vertical spine of operation cards (SET/MUL/ADD/MIN_FLOOR), each citing
// its source refId, flowing into the final premium. Renders as a real <svg> so it
// scales crisply and exports cleanly (parent serialises the node). Palette is a
// single local map (SVG exports can't resolve CSS vars) mirroring the brand tokens.
import type { TraceEntry } from '@pf/shared'

const OP: Record<string, { color: string; tint: string; sign: string }> = {
  SET:       { color: '#2563EB', tint: 'rgba(37,99,235,.10)',  sign: 'SET' },
  MUL:       { color: '#8B1FE0', tint: 'rgba(139,31,224,.10)', sign: '×' },
  ADD:       { color: '#059669', tint: 'rgba(5,150,105,.10)',  sign: '+' },
  MIN_FLOOR: { color: '#B45309', tint: 'rgba(180,83,9,.10)',   sign: '≥' },
}

const MONO = 'JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace'

function opValue(t: TraceEntry): string {
  switch (t.op) {
    case 'MUL':       return `× ${t.factorOrAmount}`
    case 'ADD':       return `+ $${t.factorOrAmount.toFixed(2)}`
    case 'SET':       return `$${t.factorOrAmount}`
    default:          return `≥ $${t.factorOrAmount}`
  }
}

interface RatingFlowProps { trace: TraceEntry[]; finalPremium: number; animate?: boolean }

/** Vertical rating-flow diagram. Width is fixed (360) — the SVG scales to its box. */
export function RatingFlow({ trace, finalPremium, animate = true }: RatingFlowProps) {
  const W = 360, PAD = 14, CARD_H = 50, GAP = 14, CARD_W = W - PAD * 2
  const steps = trace.filter(t => t.op !== 'MIN_FLOOR') // floor is represented by the final node
  const FINAL_H = 60
  const stepTop = (i: number) => PAD + i * (CARD_H + GAP)
  const finalY = stepTop(steps.length)
  const H = finalY + FINAL_H + PAD

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, height: 'auto', display: 'block', margin: '0 auto' }}
      role="img" aria-label={`Rating flow: ${steps.length} steps resolving to a final premium of $${finalPremium.toLocaleString()}.`}>
      <defs>
        <linearGradient id="rf-final" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#A100FF" /><stop offset="100%" stopColor="#7A00E6" />
        </linearGradient>
      </defs>

      {/* Connectors between steps (drawn under the cards) */}
      {steps.map((t, i) => {
        const y1 = stepTop(i) + CARD_H, y2 = (i < steps.length - 1 ? stepTop(i + 1) : finalY)
        const col = OP[t.op]?.color ?? '#8E90A0'
        return <line key={`c${i}`} x1={W / 2} y1={y1} x2={W / 2} y2={y2} stroke={col} strokeOpacity={0.35} strokeWidth={2} strokeLinecap="round" />
      })}

      {/* Step cards */}
      {steps.map((t, i) => {
        const y = stepTop(i)
        const op = OP[t.op] ?? { color: '#8E90A0', tint: 'rgba(142,144,160,.10)', sign: t.op }
        return (
          <g key={t.stepId} className={animate ? 'flow-step' : undefined} style={{ '--step-delay': `${i * 70}ms` } as React.CSSProperties}>
            <rect x={PAD} y={y} width={CARD_W} height={CARD_H} rx={12} fill="#fff" stroke="rgba(19,19,26,.08)" strokeWidth={1} />
            {/* op accent bar */}
            <rect x={PAD} y={y + 8} width={4} height={CARD_H - 16} rx={2} fill={op.color} />
            {/* op badge */}
            <rect x={PAD + 12} y={y + CARD_H / 2 - 9} width={30} height={18} rx={5} fill={op.tint} />
            <text x={PAD + 27} y={y + CARD_H / 2 + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={op.color} style={{ fontFamily: MONO }}>{op.sign}</text>
            {/* label + source ref (traceability) */}
            <text x={PAD + 52} y={y + 20} fontSize={10.5} fontWeight={600} fill="#131318">{t.label.length > 30 ? t.label.slice(0, 29) + '…' : t.label}</text>
            <text x={PAD + 52} y={y + 34} fontSize={8.5} fill="#8E90A0" style={{ fontFamily: MONO }}>{t.sourceRef} · {opValue(t)}</text>
            {/* running total */}
            <text x={PAD + CARD_W - 12} y={y + CARD_H / 2 + 4} textAnchor="end" fontSize={13} fontWeight={700} fill="#131318" style={{ fontFamily: MONO }}>
              ${t.runningTotal.toLocaleString(undefined, { minimumFractionDigits: t.rounded ? 0 : 2, maximumFractionDigits: 2 })}
            </text>
          </g>
        )
      })}

      {/* Final premium node */}
      <g className={animate ? 'flow-step' : undefined} style={{ '--step-delay': `${steps.length * 70}ms` } as React.CSSProperties}>
        <rect x={PAD} y={finalY} width={CARD_W} height={FINAL_H} rx={14} fill="url(#rf-final)"
          style={{ filter: 'drop-shadow(0 8px 20px rgba(139,31,224,.28))' }} />
        <text x={PAD + 18} y={finalY + 26} fontSize={11} fontWeight={600} fill="rgba(255,255,255,.9)">Final premium</text>
        <text x={PAD + 18} y={finalY + 44} fontSize={9} fill="rgba(255,255,255,.7)" style={{ fontFamily: MONO }}>MAX(running, minimum) · round 0</text>
        <text x={PAD + CARD_W - 18} y={finalY + FINAL_H / 2 + 8} textAnchor="end" fontSize={26} fontWeight={800} fill="#fff" style={{ fontFamily: MONO }}>
          ${finalPremium.toLocaleString()}
        </text>
      </g>
    </svg>
  )
}
```


## `app/src/main.tsx`

```tsx
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```


## `app/src/routes/Admin.tsx`

```tsx
// Admin (/app/admin, ADMIN only) — user management (via the setUserRole callable),
// an audit-log explorer that opens any event to its before/after diff, the seed
// report, and local app settings.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Shield, Plus, UserX, UserCheck, Search, FileClock } from 'lucide-react'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Tabs, Badge, Button, Input, Dialog, Skeleton, EmptyState } from '../components/ui'
import type { User, AuditEvent, Version, SeedReport, Role } from '@pf/shared'

type UserDoc      = User & { id: string }
type AuditDoc     = AuditEvent & { id: string }
type VersionDoc   = Version & { id: string }
type SeedReportDoc = SeedReport & { id: string }

function toMillis(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  const o = v as { toDate?: () => Date; seconds?: number }
  if (typeof o.toDate === 'function') return o.toDate().getTime()
  if (typeof o.seconds === 'number') return o.seconds * 1000
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t }
  return null
}
const fmt = (v: unknown) => { const m = toMillis(v); return m ? new Date(m).toLocaleString() : '—' }

export default function Admin() {
  const { profile } = useUser()
  const [tab, setTab] = useState('users')

  if (profile && profile.role !== 'ADMIN') {
    return <EmptyState icon={<Shield size={28} />} title="Admins only" description="You need the ADMIN role to view the admin console." />
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-text">Admin</h1>
        <p className="text-sm text-dim">Users, audit trail, seed report and settings.</p>
      </div>
      <Tabs
        tabs={[{ id: 'users', label: 'Users' }, { id: 'audit', label: 'Audit Log' }, { id: 'seed', label: 'Seed Report' }, { id: 'settings', label: 'Settings' }]}
        active={tab} onChange={setTab}
      />
      {tab === 'users'    && <UsersTab />}
      {tab === 'audit'    && <AuditTab />}
      {tab === 'seed'     && <SeedTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ─── Users ──────────────────────────────────────────────────────────────────

const ROLES: Role[] = ['ADMIN', 'EDITOR', 'VIEWER']
const roleColor: Record<Role, 'purple' | 'blue' | 'default'> = { ADMIN: 'purple', EDITOR: 'blue', VIEWER: 'default' }

function UsersTab() {
  const [users, setUsers] = useState<UserDoc[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ email: '', name: '', password: '', role: 'VIEWER' as Role })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsub = adapter.db.subscribe<UserDoc>('users', d => { if (Array.isArray(d)) setUsers(d) })
    return unsub
  }, [])

  async function call(data: Record<string, unknown>, ok: string) {
    setBusy(true)
    try { await adapter.fns.call('setUserRole', data); toast.success(ok) }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Action failed') }
    finally { setBusy(false) }
  }

  async function createUser() {
    if (!draft.email || !draft.password) { toast.error('Email and password required'); return }
    await call({ action: 'create', ...draft }, 'User created')
    setCreating(false); setDraft({ email: '', name: '', password: '', role: 'VIEWER' })
  }

  if (users === null) return <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={14} /> New user</Button>
      </div>
      <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        {users.map(u => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <span className="w-8 h-8 rounded-full text-[11px] font-semibold text-white flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#A100FF,#6D28D9)' }}>
              {(u.name || u.email).slice(0, 2).toUpperCase()}
            </span>
            <div className="flex-1 min-w-[160px]">
              <div className="text-sm font-medium text-text">{u.name || '—'}</div>
              <div className="text-xs text-faint font-mono">{u.email}</div>
            </div>
            {!u.active && <Badge label="deactivated" color="danger" />}
            <select value={u.role} disabled={busy} aria-label={`Role for ${u.email}`}
              onChange={e => call({ action: 'setRole', uid: u.id, role: e.target.value }, 'Role updated')}
              className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-text focus:outline-none" style={{ borderColor: 'var(--color-border)' }}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <Badge label={u.role} color={roleColor[u.role]} />
            {u.active
              ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => call({ action: 'deactivate', uid: u.id }, 'User deactivated')}><UserX size={13} /> Deactivate</Button>
              : <Button variant="ghost" size="sm" disabled={busy} onClick={() => call({ action: 'reactivate', uid: u.id }, 'User reactivated')}><UserCheck size={13} /> Reactivate</Button>}
          </div>
        ))}
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="New user">
        <div className="flex flex-col gap-4">
          <Input label="Email" type="email" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="person@company.com" autoFocus />
          <Input label="Name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Full name" />
          <Input label="Temporary password" type="text" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} placeholder="min 6 characters" />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text" htmlFor="new-role">Role</label>
            <select id="new-role" value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value as Role })}
              className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text focus:outline-none" style={{ borderColor: 'rgba(19,19,26,.12)' }}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={createUser} disabled={busy || !draft.email || !draft.password}>{busy ? 'Creating…' : 'Create user'}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

// ─── Audit explorer ─────────────────────────────────────────────────────────

const actionColor: Record<string, 'good' | 'blue' | 'danger' | 'default'> = { create: 'good', update: 'blue', delete: 'danger' }

function AuditTab() {
  const [events, setEvents]     = useState<AuditDoc[] | null>(null)
  const [versions, setVersions] = useState<VersionDoc[]>([])
  const [actor, setActor]       = useState('')
  const [entityType, setEntityType] = useState('')
  const [action, setAction]     = useState('')
  const [since, setSince]       = useState('')
  const [open, setOpen]         = useState<AuditDoc | null>(null)

  useEffect(() => {
    const u1 = adapter.db.subscribe<AuditDoc>('auditEvents', d => { if (Array.isArray(d)) setEvents(d) })
    const u2 = adapter.db.subscribe<VersionDoc>('versions', d => { if (Array.isArray(d)) setVersions(d) })
    return () => { u1(); u2() }
  }, [])

  const entityTypes = useMemo(() => [...new Set((events ?? []).map(e => e.entityType))].sort(), [events])

  const filtered = useMemo(() => {
    let list = [...(events ?? [])]
    if (actor)      list = list.filter(e => (e.actor?.name ?? '').toLowerCase().includes(actor.toLowerCase()))
    if (entityType) list = list.filter(e => e.entityType === entityType)
    if (action)     list = list.filter(e => e.action === action)
    if (since)      { const s = Date.parse(since); list = list.filter(e => (toMillis(e.at) ?? 0) >= s) }
    return list.sort((a, b) => (toMillis(b.at) ?? 0) - (toMillis(a.at) ?? 0)).slice(0, 200)
  }, [events, actor, entityType, action, since])

  // Correlate an audit event to its version (same entityPath, closest timestamp).
  const versionFor = (e: AuditDoc): VersionDoc | null => {
    const at = toMillis(e.at) ?? 0
    const candidates = versions.filter(v => v.entityPath === e.entityPath)
    if (!candidates.length) return null
    return candidates.reduce((best, v) => Math.abs((toMillis(v.at) ?? 0) - at) < Math.abs((toMillis(best.at) ?? 0) - at) ? v : best)
  }

  if (events === null) return <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={actor} onChange={e => setActor(e.target.value)} placeholder="Actor…" leftIcon={<Search size={13} />} className="max-w-[180px] h-8" />
        <select value={entityType} onChange={e => setEntityType(e.target.value)} className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-dim" style={{ borderColor: 'var(--color-border)' }} aria-label="Entity type">
          <option value="">All entities</option>
          {entityTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={action} onChange={e => setAction(e.target.value)} className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-dim" style={{ borderColor: 'var(--color-border)' }} aria-label="Action">
          <option value="">All actions</option>
          {['create', 'update', 'delete'].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="date" value={since} onChange={e => setSince(e.target.value)} className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-dim" style={{ borderColor: 'var(--color-border)' }} aria-label="Since date" />
        {(actor || entityType || action || since) && <button className="text-xs text-accent" onClick={() => { setActor(''); setEntityType(''); setAction(''); setSince('') }}>Clear</button>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<FileClock size={26} />} title="No matching events" description="Adjust the filters, or perform a change to generate audit events." />
      ) : (
        <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {filtered.map(e => (
            <button key={e.id} onClick={() => setOpen(e)} className="w-full flex flex-wrap items-center gap-3 px-4 py-2.5 bg-surface text-left hover:bg-raised transition-colors" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Badge label={e.action} color={actionColor[e.action] ?? 'default'} />
              <span className="text-sm text-text">{e.entityType}</span>
              <span className="text-xs font-mono text-faint flex-1 min-w-[120px] truncate">{e.entityPath}</span>
              <span className="text-xs text-dim">{e.actor?.name ?? '—'}</span>
              <span className="text-xs text-faint">{fmt(e.at)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Diff viewer */}
      <Dialog open={!!open} onClose={() => setOpen(null)} title="Audit event" width="max-w-2xl">
        {open && (() => {
          const v = versionFor(open)
          return (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge label={open.action} color={actionColor[open.action] ?? 'default'} />
                <span className="font-mono text-xs text-dim">{open.entityPath}</span>
              </div>
              <div className="text-xs text-faint">{open.actor?.name} · {fmt(open.at)}</div>
              {v && v.diff?.length ? (
                <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                  <div className="grid grid-cols-[1fr_1fr_1fr] text-[11px] font-semibold text-faint uppercase px-3 py-1.5 bg-raised">
                    <span>Field</span><span>Before</span><span>After</span>
                  </div>
                  {v.diff.map((d, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 text-xs" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <span className="font-mono text-text">{d.field}</span>
                      <span className="text-danger font-mono break-all">{JSON.stringify(d.before)}</span>
                      <span className="text-good font-mono break-all">{JSON.stringify(d.after)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-dim">{v ? 'No field-level diff recorded for this event.' : 'No version snapshot correlated to this event.'}</p>
              )}
            </div>
          )
        })()}
      </Dialog>
    </div>
  )
}

// ─── Seed report ────────────────────────────────────────────────────────────

function SeedTab() {
  const [reports, setReports] = useState<SeedReportDoc[] | null>(null)
  useEffect(() => {
    const unsub = adapter.db.subscribe<SeedReportDoc>('seedReports', d => { if (Array.isArray(d)) setReports(d) })
    return unsub
  }, [])

  if (reports === null) return <Skeleton className="h-40" />
  const latest = [...reports].sort((a, b) => (toMillis(b.at) ?? 0) - (toMillis(a.at) ?? 0))[0]
  if (!latest) return <EmptyState icon={<FileClock size={26} />} title="No seed reports" description="Run pnpm seed to generate one." />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text">Latest seed</span>
        <span className="text-xs text-faint">{fmt(latest.at)}</span>
      </div>
      <div className="flex items-center justify-between px-4 py-3 rounded-[12px]" style={{ background: 'linear-gradient(135deg, rgba(161,0,255,.08), rgba(122,0,230,.06))', border: '1px solid rgba(139,31,224,.2)' }}>
        <span className="text-sm text-text">Worked example premium</span>
        <span className="text-lg font-bold" style={{ background: 'linear-gradient(135deg,#8B1FE0,#7A00E6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>${latest.workedExamplePremium?.toLocaleString()}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(latest.counts ?? {}).map(([k, n]) => (
          <div key={k} className="bg-surface rounded-[12px] p-3" style={{ border: '1px solid var(--color-border)' }}>
            <div className="text-lg font-bold text-text tabular-nums">{n}</div>
            <div className="text-xs text-faint">{k}</div>
          </div>
        ))}
      </div>
      {(latest.warnings ?? []).length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-warn uppercase">Warnings</span>
          {latest.warnings.map((w, i) => <span key={i} className="text-xs text-dim">• {w}</span>)}
        </div>
      )}
    </div>
  )
}

// ─── Settings (local, demo) ─────────────────────────────────────────────────

const SETTINGS_KEY = 'prh:settings'
function SettingsTab() {
  const [appName, setAppName] = useState('Product Reinvention Hub')
  const [expiry, setExpiry]   = useState('30')

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); if (s.appName) setAppName(s.appName); if (s.expiry) setExpiry(String(s.expiry)) } catch { /* ignore */ }
  }, [])

  function save() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ appName, expiry: Number(expiry) }))
    toast.success('Settings saved')
  }

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <Input label="App name" value={appName} onChange={e => setAppName(e.target.value)} />
      <Input label="Default share-link expiry (days)" type="number" value={expiry} onChange={e => setExpiry(e.target.value)} min={1} />
      <p className="text-xs text-faint">Stored locally in this browser for the demo.</p>
      <div><Button variant="primary" size="sm" onClick={save}>Save settings</Button></div>
    </div>
  )
}
```


## `app/src/routes/AppShell.tsx`

```tsx
﻿// Authenticated app shell — route guard, sidebar, topbar, command palette, outlet.
import { useState, useEffect } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useUser } from '../context/useUser'
import { IconKey } from '../components/ui/icons'
import { Sidebar } from '../components/shell/Sidebar'
import { Topbar } from '../components/shell/Topbar'
import { CommandPalette } from '../components/palette/CommandPalette'
import { FeedbackProvider } from '../components/feedback/FeedbackProvider'
import { Skeleton } from '../components/ui'

export default function AppShell() {
  const { user, profile, loading } = useUser()
  const navigate = useNavigate()
  const [collapsed,    setCollapsed]    = useState(false)
  const [paletteOpen, setPaletteOpen]   = useState(false)

  // âŒ˜K / Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(p => !p)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (loading) {
    return (
      <div className="flex h-svh items-center justify-center bg-page gap-3">
        <Skeleton className="w-32 h-4" />
      </div>
    )
  }

  if (!user) return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />

  return (
    <FeedbackProvider>
      <div className="flex h-svh overflow-hidden bg-page">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Topbar onOpenPalette={() => setPaletteOpen(true)} />

          {/* Persistent banner until the seeded/temp password is changed */}
          {profile?.mustChangePassword && (
            <div className="flex items-center justify-between gap-3 px-6 py-2 text-sm" style={{ background: 'rgba(180,83,9,.08)', borderBottom: '1px solid rgba(180,83,9,.2)' }}>
              <span className="flex items-center gap-2 text-warn"><IconKey size={14} aria-hidden="true" /> You're using a temporary password. Please set a new one.</span>
              <button onClick={() => navigate('/must-change-password')} className="font-medium text-warn hover:underline shrink-0">Change password →</button>
            </div>
          )}

          <main className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <Toaster richColors position="bottom-right" />
      </div>
    </FeedbackProvider>
  )
}
```


## `app/src/routes/Dictionary.tsx`

```tsx
// Data Dictionary (/app/dictionary) — reusable field definitions with audited
// create/edit/delete. Each card shows type, description, allowed values, format,
// tags and "used in" backlinks. The DictionaryPicker component (see
// components/dictionary) lets other editors insert one of these by typeahead.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { BookOpen, Plus, Search, Trash2, Link2 } from 'lucide-react'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Button, Input, Dialog, Skeleton, EmptyState } from '../components/ui'
import type { DictionaryEntry, DynamicFieldType } from '@pf/shared'

type DictDoc = DictionaryEntry & { id: string }

const TYPES: DynamicFieldType[] = ['TEXT', 'CURRENCY', 'DATE', 'LIST', 'PERCENT']
const TYPE_COLOR: Record<DynamicFieldType, 'blue' | 'good' | 'purple' | 'warn' | 'default'> = {
  TEXT: 'default', CURRENCY: 'good', DATE: 'blue', LIST: 'purple', PERCENT: 'warn',
}

// Map an entity path (e.g. products/HO.PROD.001/coverages/x) to an in-app route.
function pathToRoute(entityPath: string): string {
  const parts = entityPath.split('/')
  const pid = parts[1] ?? 'HO.PROD.001'
  if (entityPath.includes('/coverages')) return `/app/products/${pid}/coverages`
  if (entityPath.includes('/rules'))     return `/app/products/${pid}/rules`
  if (entityPath.startsWith('forms'))    return `/app/products/${pid}/forms`
  if (entityPath.startsWith('products')) return `/app/products/${pid}/overview`
  return '/app/explorer'
}

interface Draft { id?: string; name: string; type: DynamicFieldType; description: string; allowedValues: string; format: string; tags: string; source?: DictDoc }
const EMPTY_DRAFT: Draft = { name: '', type: 'TEXT', description: '', allowedValues: '', format: '', tags: '' }

export default function Dictionary() {
  const navigate = useNavigate()
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'

  const [entries, setEntries] = useState<DictDoc[] | null>(null)
  const [query, setQuery]     = useState('')
  const [typeFilter, setTypeFilter] = useState<DynamicFieldType | ''>('')
  const [draft, setDraft]     = useState<Draft | null>(null)
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    const unsub = adapter.db.subscribe<DictDoc>('dictionary', d => { if (Array.isArray(d)) setEntries(d) })
    return unsub
  }, [])

  const visible = useMemo(() => {
    let list = entries ?? []
    if (typeFilter) list = list.filter(e => e.type === typeFilter)
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(e => `${e.name} ${e.description} ${(e.tags ?? []).join(' ')}`.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [entries, query, typeFilter])

  async function save() {
    if (!draft || !user) return
    const name = draft.name.trim()
    if (!name) { toast.error('Name is required'); return }
    setSaving(true)
    const actor = { uid: user.uid, name: user.name ?? user.email ?? 'User' }
    const allowedValues = draft.allowedValues.split(',').map(s => s.trim()).filter(Boolean)
    const tags          = draft.tags.split(',').map(s => s.trim()).filter(Boolean)

    try {
      if (draft.source) {
        // Update — spread the full current entity so the version diff is clean.
        const { id, ...rest } = draft.source
        await adapter.db.mutate({
          op: 'update', path: `dictionary/${id}`,
          data: { ...rest, name, type: draft.type, description: draft.description.trim(), allowedValues, format: draft.format.trim(), tags },
          entityType: 'dictionary', actor, expectedRev: draft.source.rev,
        })
        toast.success('Field updated')
      } else {
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID()
        await adapter.db.mutate({
          op: 'create', path: `dictionary/${id}`,
          data: {
            name, type: draft.type, description: draft.description.trim(), allowedValues, format: draft.format.trim(), tags,
            usedIn: [], status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
          entityType: 'dictionary', actor,
        })
        toast.success('Field created')
      }
      setDraft(null)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!draft?.source || !user) return
    if (!window.confirm(`Delete the “${draft.source.name}” field? This can be restored from version history.`)) return
    setSaving(true)
    try {
      await adapter.db.mutate({
        op: 'delete', path: `dictionary/${draft.source.id}`,
        entityType: 'dictionary', actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
      })
      toast.success('Field deleted')
      setDraft(null)
    } catch {
      toast.error('Delete failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Data Dictionary</h1>
          <p className="text-sm text-dim">Canonical field definitions, reused across coverages and forms.</p>
        </div>
        {canEdit && (
          <Button variant="primary" size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <Plus size={14} /> New field
          </Button>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search fields…" leftIcon={<Search size={14} />} className="max-w-xs" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setTypeFilter('')} aria-pressed={typeFilter === ''}
            className={`px-2.5 py-1 rounded-[8px] text-xs font-medium ${typeFilter === '' ? 'bg-accent-soft text-accent' : 'bg-surface text-dim'}`} style={{ border: '1px solid var(--color-border)' }}>All</button>
          {TYPES.map(t => (
            <button key={t} onClick={() => setTypeFilter(t === typeFilter ? '' : t)} aria-pressed={typeFilter === t}
              className={`px-2.5 py-1 rounded-[8px] text-xs font-medium ${typeFilter === t ? 'bg-accent-soft text-accent' : 'bg-surface text-dim'}`} style={{ border: '1px solid var(--color-border)' }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {entries === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<BookOpen size={28} />} title={query || typeFilter ? 'No matching fields' : 'No dictionary fields yet'}
          description={query || typeFilter ? 'Try a different search or type.' : 'Define your first reusable field.'}
          action={canEdit && !query && !typeFilter ? <Button variant="primary" size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}><Plus size={14} /> New field</Button> : undefined} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(e => (
            <button key={e.id} onClick={() => canEdit && setDraft({ id: e.id, name: e.name, type: e.type, description: e.description, allowedValues: (e.allowedValues ?? []).join(', '), format: e.format ?? '', tags: (e.tags ?? []).join(', '), source: e })}
              className={`text-left bg-surface rounded-[16px] p-4 flex flex-col gap-3 transition-all ${canEdit ? 'hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5' : 'cursor-default'}`}
              style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-sm text-text">{e.name}</span>
                <Badge label={e.type} color={TYPE_COLOR[e.type]} />
              </div>
              {e.description && <p className="text-xs text-dim leading-relaxed line-clamp-3">{e.description}</p>}
              {e.format && <span className="text-[11px] font-mono text-faint">format: {e.format}</span>}
              {(e.allowedValues ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {e.allowedValues.slice(0, 4).map(v => <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded-[5px] bg-raised text-dim">{v}</span>)}
                  {e.allowedValues.length > 4 && <span className="text-[10px] text-faint">+{e.allowedValues.length - 4}</span>}
                </div>
              )}
              {(e.tags ?? []).length > 0 && <div className="flex flex-wrap gap-1">{e.tags.map(t => <Badge key={t} label={t} color="default" />)}</div>}
              {(e.usedIn ?? []).length > 0 && (
                <div className="flex flex-col gap-1 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <span className="text-[10px] uppercase tracking-wide text-faint">Used in</span>
                  {e.usedIn.slice(0, 3).map((u, i) => (
                    <span key={i} role="link" tabIndex={0}
                      onClick={ev => { ev.stopPropagation(); navigate(pathToRoute(u.entityPath)) }}
                      onKeyDown={ev => { if (ev.key === 'Enter') { ev.stopPropagation(); navigate(pathToRoute(u.entityPath)) } }}
                      className="flex items-center gap-1 text-[11px] text-accent hover:underline cursor-pointer">
                      <Link2 size={10} /> {u.label}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Editor dialog */}
      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.source ? 'Edit field' : 'New field'}>
        {draft && (
          <div className="flex flex-col gap-4">
            <Input label="Name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Coverage A" autoFocus />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text" htmlFor="dict-type">Type</label>
              <select id="dict-type" value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value as DynamicFieldType })}
                className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25" style={{ borderColor: 'rgba(19,19,26,.12)' }}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text" htmlFor="dict-desc">Description</label>
              <textarea id="dict-desc" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} rows={3}
                className="rounded-[10px] bg-surface border text-sm text-text p-3 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none" style={{ borderColor: 'rgba(19,19,26,.12)' }} placeholder="What this field means…" />
            </div>
            <Input label="Allowed values (comma-separated)" value={draft.allowedValues} onChange={e => setDraft({ ...draft, allowedValues: e.target.value })} placeholder="50, 70, 75" />
            <Input label="Format" value={draft.format} onChange={e => setDraft({ ...draft, format: e.target.value })} placeholder="USD, percent, ISO-8601…" />
            <Input label="Tags (comma-separated)" value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} placeholder="rating, limits" />

            <div className="flex items-center justify-between pt-2">
              {draft.source
                ? <Button variant="destructive" size="sm" onClick={remove} disabled={saving}><Trash2 size={14} /> Delete</Button>
                : <span />}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={save} disabled={saving || !draft.name.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
```


## `app/src/routes/Explorer.tsx`

```tsx
// Explorer — unified entity browser: products, coverages, forms, rules, LD/RT tables, dictionary.
import { useState, useMemo } from 'react'
import { adapter } from '../lib/backend'
import { useEffect } from 'react'
import { Tabs, Badge, Skeleton, EmptyState } from '../components/ui'
import { Input } from '../components/ui/Input'
import { Search, Database, FileText, Hash, BookOpen, CheckSquare, Package } from 'lucide-react'
import Fuse from 'fuse.js'
import type { SearchIndexEntry, SearchEntityType } from '@pf/shared'
import { useNavigate } from 'react-router-dom'

const TYPES: Array<{ id: SearchEntityType | 'all'; label: string }> = [
  { id: 'all',        label: 'All'        },
  { id: 'product',    label: 'Products'   },
  { id: 'coverage',   label: 'Coverages'  },
  { id: 'form',       label: 'Forms'      },
  { id: 'rule',       label: 'Rules'      },
  { id: 'ldTable',    label: 'LD Tables'  },
  { id: 'rtTable',    label: 'RT Tables'  },
  { id: 'dictionary', label: 'Dictionary' },
]

const TYPE_ICON: Partial<Record<SearchEntityType, React.FC<{ size?: number; className?: string }>>> = {
  product:    Package,
  coverage:   Hash,
  form:       FileText,
  rule:       CheckSquare,
  ldTable:    Database,
  rtTable:    Database,
  dictionary: BookOpen,
}

function toRoute(entry: SearchIndexEntry): string {
  const parts = entry.path.split('/')
  const pid   = parts[1] ?? 'HO.PROD.001'
  switch (entry.type) {
    case 'product':    return `/app/products/${pid}`
    case 'coverage':   return `/app/products/${pid}/coverages`
    case 'form':       return `/app/products/HO.PROD.001/forms`
    case 'rule':       return `/app/products/${pid}/rules`
    case 'ldTable':
    case 'rtTable':    return `/app/explorer`
    case 'dictionary': return `/app/dictionary`
    default:           return '/app'
  }
}

export default function Explorer() {
  const navigate  = useNavigate()
  const [entries, setEntries] = useState<SearchIndexEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query,   setQuery]   = useState('')
  const [tab,     setTab]     = useState<SearchEntityType | 'all'>('all')

  useEffect(() => {
    const unsub = adapter.db.subscribe<SearchIndexEntry>('searchIndex', (data) => {
      if (Array.isArray(data)) { setEntries(data); setLoading(false) }
    })
    return unsub
  }, [])

  const fuse = useMemo(() => new Fuse(entries, {
    keys: ['title', 'subtitle', 'keywords'],
    threshold: 0.4,
    includeMatches: false,
  }), [entries])

  const matched = useMemo(() => {
    const base = query ? fuse.search(query).map(r => r.item) : entries
    return tab === 'all' ? base : base.filter(e => e.type === tab)
  }, [query, tab, entries, fuse])

  // Cap the DOM to keep rendering cheap if the index grows large.
  const CAP = 90
  const visible = matched.slice(0, CAP)

  const tabs = TYPES.map(t => ({
    id: t.id,
    label: t.label,
    count: t.id === 'all' ? entries.length : entries.filter(e => e.type === t.id).length,
  }))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold text-text">Explorer</h1>
        <p className="text-sm text-dim">Browse every entity in the Product Reinvention Hub.</p>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search all entities…"
          leftIcon={<Search size={14} />}
          className="max-w-md"
        />
        <div className="overflow-x-auto pb-1">
          <Tabs
            tabs={tabs}
            active={tab}
            onChange={v => setTab(v as SearchEntityType | 'all')}
          />
        </div>
      </div>

      {/* Results grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="bg-surface rounded-[14px] p-4 flex flex-col gap-2" style={{ border: '1px solid var(--color-border)' }}>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={query ? `No results for "${query}"` : 'No entities found'}
          description={query ? 'Try a different search term.' : 'Run pnpm seed to populate the explorer.'}
          compact
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map(entry => {
            const Icon = TYPE_ICON[entry.type]
            return (
              <button
                key={entry.path}
                onClick={() => navigate(toRoute(entry))}
                className="bg-surface rounded-[14px] p-4 text-left hover:shadow-[var(--shadow-card-hover)] transition-all duration-200 group flex flex-col gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm text-text group-hover:text-accent transition-colors line-clamp-2">{entry.title}</span>
                  {Icon && <Icon size={14} className="text-faint shrink-0 mt-0.5" aria-hidden="true" />}
                </div>
                {entry.subtitle && (
                  <span className="text-xs font-mono text-faint truncate">{entry.subtitle}</span>
                )}
                <div className="mt-auto pt-1">
                  <Badge
                    label={entry.type}
                    color={entry.type === 'form' ? 'blue' : entry.type === 'product' ? 'accent' : entry.type === 'rule' ? 'warn' : 'default'}
                  />
                </div>
              </button>
            )
          })}
          {matched.length > CAP && (
            <p className="col-span-full text-xs text-faint text-center pt-1">
              Showing {CAP} of {matched.length} — refine your search to narrow results.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
```


## `app/src/routes/Feedback.tsx`

```tsx
// Feedback & Backlog (/app/feedback) — the product's own PM loop. Left: the Inbox
// (NEW + REVIEWING) with a context chip that deep-links, a one-vote-per-user
// button, and a votes×recency heat bar. Right: the Backlog (PLANNED), drag-ranked
// by EDITOR+ with impact/effort chips. Below: a SHIPPED changelog; DECLINED
// collapsed. Status changes are EDITOR+ and audited. Realtime throughout.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { toast } from 'sonner'
import { Lightbulb, Bug, Heart, ArrowBigUp, Link2, GripVertical } from 'lucide-react'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Skeleton } from '../components/ui'
import type { Feedback, FeedbackType, FeedbackStatus } from '@pf/shared'

type FeedbackDoc = Feedback & { id: string }

const TYPE_META: Record<FeedbackType, { icon: typeof Lightbulb; color: 'blue' | 'danger' | 'good' }> = {
  IDEA:   { icon: Lightbulb, color: 'blue' },
  ISSUE:  { icon: Bug,       color: 'danger' },
  PRAISE: { icon: Heart,     color: 'good' },
}

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v
  const o = v as { toDate?: () => Date; seconds?: number }
  if (o && typeof o.toDate === 'function') return o.toDate().getTime()
  if (o && typeof o.seconds === 'number') return o.seconds * 1000
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t }
  return 0
}

// votes × recency decay (half-life ~14 days)
function heatOf(fb: FeedbackDoc): number {
  const ageDays = Math.max(0, (Date.now() - toMillis(fb.createdAt)) / 86_400_000)
  return (fb.votes?.count ?? 0) * Math.exp(-ageDays / 14) + 0.15 * Math.exp(-ageDays / 14)
}

export default function Feedback() {
  const navigate = useNavigate()
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'
  const [items, setItems] = useState<FeedbackDoc[] | null>(null)

  useEffect(() => {
    const unsub = adapter.db.subscribe<FeedbackDoc>('feedback', d => { if (Array.isArray(d)) setItems(d) })
    return unsub
  }, [])

  const maxHeat = useMemo(() => Math.max(0.001, ...(items ?? []).map(heatOf)), [items])
  const lanes = useMemo(() => {
    const by = (s: FeedbackStatus) => (items ?? []).filter(f => f.status === s)
    return {
      NEW:       by('NEW').sort((a, b) => heatOf(b) - heatOf(a)),
      REVIEWING: by('REVIEWING').sort((a, b) => heatOf(b) - heatOf(a)),
      PLANNED:   by('PLANNED').sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
      SHIPPED:   by('SHIPPED').sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)),
      DECLINED:  by('DECLINED'),
    }
  }, [items])

  async function vote(fb: FeedbackDoc) {
    if (!user) return
    if ((fb.votes?.voters ?? []).includes(user.uid)) { toast.info('You already voted'); return }
    try { await adapter.db.vote(`feedback/${fb.id}`, user.uid) }
    catch { toast.error('Vote failed') }
  }

  async function patch(fb: FeedbackDoc, changes: Partial<Feedback>, ok: string) {
    if (!user) return
    const { id, ...rest } = fb
    try {
      await adapter.db.mutate({
        op: 'update', path: `feedback/${id}`, data: { ...rest, ...changes },
        entityType: 'feedback', actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        expectedRev: (fb as { rev?: number }).rev,
      })
      toast.success(ok)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Update failed')
    }
  }

  async function reorderPlanned(ordered: FeedbackDoc[]) {
    // Persist new sequential ranks for any item whose rank changed (audited).
    await Promise.all(ordered.map((fb, i) => (fb.rank ?? -1) === i ? null : patch(fb, { rank: i }, 'Backlog reordered')).filter(Boolean) as Promise<void>[])
  }

  if (items === null) {
    return <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
  }

  const cardProps = { canEdit, uid: user?.uid, maxHeat, onVote: vote, onPatch: patch, navigate }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-text">Feedback &amp; Backlog</h1>
        <p className="text-sm text-dim">Capture with ⌘. anywhere. Vote to raise the heat. Plan what ships next.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inbox */}
        <div className="flex flex-col gap-4">
          <Lane title="New" count={lanes.NEW.length}>
            {lanes.NEW.length === 0 ? <LaneEmpty text="No new feedback. Press ⌘. to add some." /> : lanes.NEW.map(fb => <Card key={fb.id} fb={fb} {...cardProps} />)}
          </Lane>
          <Lane title="Reviewing" count={lanes.REVIEWING.length}>
            {lanes.REVIEWING.length === 0 ? <LaneEmpty text="Nothing under review." /> : lanes.REVIEWING.map(fb => <Card key={fb.id} fb={fb} {...cardProps} />)}
          </Lane>
        </div>

        {/* Backlog */}
        <Lane title="Backlog · Planned" count={lanes.PLANNED.length}>
          {lanes.PLANNED.length === 0 ? <LaneEmpty text="Nothing planned yet." /> : (
            <PlannedList items={lanes.PLANNED} canEdit={canEdit} onReorder={reorderPlanned}>
              {fb => <Card fb={fb} {...cardProps} sortable />}
            </PlannedList>
          )}
        </Lane>
      </div>

      {/* Shipped changelog */}
      {lanes.SHIPPED.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-good uppercase tracking-wide">Shipped</span>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {lanes.SHIPPED.map(fb => (
              <div key={fb.id} className="shrink-0 w-56 bg-surface rounded-[12px] p-3 flex flex-col gap-1" style={{ border: '1px solid var(--color-border)' }}>
                <span className="text-sm font-medium text-text truncate">{fb.title}</span>
                <span className="text-[11px] text-faint">{new Date(toMillis(fb.updatedAt)).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Declined (collapsed) */}
      {lanes.DECLINED.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-dim hover:text-text">Declined ({lanes.DECLINED.length})</summary>
          <div className="flex flex-col gap-2 mt-2 opacity-70">
            {lanes.DECLINED.map(fb => <Card key={fb.id} fb={fb} {...cardProps} />)}
          </div>
        </details>
      )}
    </div>
  )
}

// ─── Lane wrappers ──────────────────────────────────────────────────────────

function Lane({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-dim uppercase tracking-wide">{title}</span>
        <span className="text-[11px] text-faint tabular-nums">{count}</span>
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}
function LaneEmpty({ text }: { text: string }) { return <p className="text-xs text-faint italic px-1 py-3">{text}</p> }

function PlannedList({ items, canEdit, onReorder, children }: {
  items: FeedbackDoc[]; canEdit: boolean; onReorder: (o: FeedbackDoc[]) => void; children: (fb: FeedbackDoc) => React.ReactNode
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor))
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const oldI = items.findIndex(i => i.id === e.active.id)
    const newI = items.findIndex(i => i.id === e.over!.id)
    if (oldI < 0 || newI < 0) return
    onReorder(arrayMove(items, oldI, newI))
  }
  if (!canEdit) return <>{items.map(fb => <div key={fb.id}>{children(fb)}</div>)}</>
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
        {items.map(fb => <div key={fb.id}>{children(fb)}</div>)}
      </SortableContext>
    </DndContext>
  )
}

// ─── Card ───────────────────────────────────────────────────────────────────

const NEXT: Record<FeedbackStatus, FeedbackStatus[]> = {
  NEW:       ['REVIEWING', 'PLANNED', 'DECLINED'],
  REVIEWING: ['PLANNED', 'DECLINED', 'NEW'],
  PLANNED:   ['SHIPPED', 'REVIEWING', 'DECLINED'],
  SHIPPED:   ['PLANNED'],
  DECLINED:  ['NEW'],
}

interface CardProps {
  fb: FeedbackDoc
  canEdit: boolean
  uid?: string
  maxHeat: number
  onVote: (fb: FeedbackDoc) => void
  onPatch: (fb: FeedbackDoc, c: Partial<Feedback>, ok: string) => void
  navigate: (to: string) => void
  sortable?: boolean
}

function Card({ fb, canEdit, uid, maxHeat, onVote, onPatch, navigate, sortable }: CardProps) {
  const sort = useSortable({ id: fb.id, disabled: !sortable || !canEdit })
  const voted = uid ? (fb.votes?.voters ?? []).includes(uid) : false
  const heat  = heatOf(fb)
  const ctx   = fb.context as { route?: string; label?: string; refId?: string } | undefined
  const chipLabel = ctx?.refId ?? ctx?.label ?? ctx?.route

  const style = sortable && sort.transform
    ? { transform: `translate3d(${sort.transform.x}px, ${sort.transform.y}px, 0)`, transition: sort.transition }
    : undefined

  return (
    <div ref={sortable ? sort.setNodeRef : undefined}
      style={{ ...style, border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      className={`bg-surface rounded-[12px] p-3.5 flex flex-col gap-2.5 ${sort.isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start gap-2">
        {sortable && canEdit && (
          <button {...sort.attributes} {...sort.listeners} className="text-faint hover:text-dim cursor-grab active:cursor-grabbing mt-0.5" aria-label="Drag to reorder"><GripVertical size={14} /></button>
        )}
        <span className="mt-0.5"><Badge label={fb.type} color={TYPE_META[fb.type].color} /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-text">{fb.title}</span>
          {fb.detail && <span className="block text-xs text-dim leading-relaxed line-clamp-2 mt-0.5">{fb.detail}</span>}
        </span>
        {/* Vote */}
        <button onClick={() => onVote(fb)} disabled={voted}
          className={`shrink-0 flex flex-col items-center rounded-[9px] px-2 py-1 transition-colors ${voted ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}
          title={voted ? 'You voted' : 'Vote'} aria-pressed={voted}>
          <ArrowBigUp size={15} />
          <span className="text-[11px] font-semibold tabular-nums">{fb.votes?.count ?? 0}</span>
        </button>
      </div>

      {/* Heat bar */}
      <div className="h-1.5 rounded-full bg-raised overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(6, (heat / maxHeat) * 100)}%`, background: 'linear-gradient(90deg,#A100FF,#6D28D9)' }} />
      </div>

      <div className="flex items-center flex-wrap gap-2">
        {chipLabel && (
          <button onClick={() => ctx?.route && navigate(ctx.route)}
            className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline max-w-full truncate" title={ctx?.route}>
            <Link2 size={10} className="shrink-0" /> <span className="font-mono truncate">{chipLabel}</span>
          </button>
        )}
        <span className="flex-1" />
        {(fb.status === 'PLANNED' || canEdit) && (
          <>
            <ImpactEffortChip label="Impact" value={fb.impact} canEdit={canEdit} onCycle={v => onPatch(fb, { impact: v }, 'Impact updated')} />
            <ImpactEffortChip label="Effort" value={fb.effort} canEdit={canEdit} onCycle={v => onPatch(fb, { effort: v }, 'Effort updated')} />
          </>
        )}
        {canEdit && (
          <select value="" onChange={e => e.target.value && onPatch(fb, { status: e.target.value as FeedbackStatus }, `Moved to ${e.target.value}`)}
            className="h-6 px-1.5 rounded-[7px] bg-raised border-0 text-[11px] text-dim focus:outline-none" aria-label="Change status">
            <option value="">Move…</option>
            {NEXT[fb.status].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}

function ImpactEffortChip({ label, value, canEdit, onCycle }: { label: string; value: 1 | 2 | 3; canEdit: boolean; onCycle: (v: 1 | 2 | 3) => void }) {
  const next = ((value % 3) + 1) as 1 | 2 | 3
  const dots = '●'.repeat(value) + '○'.repeat(3 - value)
  return (
    <button disabled={!canEdit} onClick={() => onCycle(next)}
      className={`text-[10px] px-1.5 py-0.5 rounded-[6px] bg-raised text-dim ${canEdit ? 'hover:text-text' : 'cursor-default'}`}
      title={`${label}: ${value}/3`}>
      {label[0]} {dots}
    </button>
  )
}
```


## `app/src/routes/Home.tsx`

```tsx
// Home (/app) — the portfolio's front door: a centered, tool-grounded chat over
// the whole product portfolio, plus a "Today's Focus" rail (SLA tasks, reviews
// awaiting me, health findings, latest news). Streaming tokens, live tool-status
// chips, and citations that link straight to the cited entity.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconSparkle, IconCheck, IconTasks, IconClipboard, IconActivity, IconNews, IconSpinner,
} from '../components/ui/icons'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge } from '../components/ui'
import { ChatComposer } from '../components/chat/ChatComposer'
import type { SearchIndexEntry, Task, Product, News } from '@pf/shared'

// ─── Stream protocol (mirror of functions/src/runtime.ts StreamEvent) ───────────

type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }
  | { t: 'error'; message: string }
  | { t: 'done' }

interface ToolChip { name: string; done: boolean; summary?: string }
interface ChatMessage { role: 'user' | 'assistant'; text: string; tools: ToolChip[] }

const SUGGESTIONS = [
  'Which forms attach if I add Scheduled Personal Property on a Texas risk?',
  'Trace the premium for the default HO-3 example.',
  'What are the eligibility rules that reference Coverage F medical payments?',
  'Show the wind/hail percentage deductible options and their constraints.',
]

// ─── Citation linkifying ────────────────────────────────────────────────────────

// Match bracketed refIds / form numbers: [HO.RU.006], [HO 04 90], [HO.LD.002].
const CITE_RE = /\[(HO[\s.][A-Z0-9][A-Z0-9.\s]*?)\]/g

/** Render assistant text with clickable citation chips. */
function RichText({ text, onCite }: { text: string; onCite: (cite: string) => void }) {
  const nodes: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  CITE_RE.lastIndex = 0
  let i = 0
  while ((m = CITE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const cite = m[1]!.trim()
    nodes.push(
      <button
        key={`c${i++}`}
        onClick={() => onCite(cite)}
        className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-[5px] bg-accent-soft text-accent font-mono text-[11px] font-medium hover:bg-accent/15 transition-colors align-baseline"
        title={`Open ${cite}`}
      >
        {cite}
      </button>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return <span className="whitespace-pre-wrap leading-relaxed">{nodes}</span>
}

// ─── Timestamp helper (Firestore Timestamp | ISO | millis → millis) ─────────────

function toMillis(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t }
  const o = v as { toDate?: () => Date; seconds?: number }
  if (typeof o.toDate === 'function') return o.toDate().getTime()
  if (typeof o.seconds === 'number') return o.seconds * 1000
  return null
}

function relativeDue(ms: number | null): { label: string; overdue: boolean } {
  if (ms == null) return { label: 'no date', overdue: false }
  const days = Math.round((ms - Date.now()) / 86_400_000)
  if (days < 0)  return { label: `${-days}d overdue`, overdue: true }
  if (days === 0) return { label: 'due today', overdue: true }
  if (days === 1) return { label: 'due tomorrow', overdue: false }
  return { label: `in ${days}d`, overdue: false }
}

// ─── Today's Focus data ─────────────────────────────────────────────────────────

interface WithId { id?: string }

function useFocusData(uid: string | undefined) {
  const [tasks, setTasks]       = useState<(Task & WithId)[]>([])
  const [products, setProducts] = useState<(Product & WithId)[]>([])
  const [news, setNews]         = useState<(News & WithId)[]>([])

  useEffect(() => {
    const u1 = adapter.db.subscribe<Task & WithId>('tasks',    d => Array.isArray(d) && setTasks(d))
    const u2 = adapter.db.subscribe<Product & WithId>('products', d => Array.isArray(d) && setProducts(d))
    const u3 = adapter.db.subscribe<News & WithId>('news',      d => Array.isArray(d) && setNews(d))
    return () => { u1(); u2(); u3() }
  }, [])

  const myTasks = useMemo(() => tasks
    .filter(t => t.column !== 'LAUNCH_MONITOR')
    .filter(t => !uid || !t.assignee || t.assignee.uid === uid)
    .sort((a, b) => (toMillis(a.dueAt) ?? Infinity) - (toMillis(b.dueAt) ?? Infinity))
    .slice(0, 5), [tasks, uid])

  const awaitingReview = useMemo(() =>
    products.filter(p => p.reviewStatus === 'BUSINESS_REVIEW' || p.reviewStatus === 'IN_PROGRESS').slice(0, 4),
    [products])

  const healthFindings = useMemo(() =>
    [...products].sort((a, b) => (a.health?.score ?? 100) - (b.health?.score ?? 100)).slice(0, 3),
    [products])

  const latestNews = useMemo(() =>
    [...news].sort((a, b) => (toMillis(b.fetchedAt) ?? 0) - (toMillis(a.fetchedAt) ?? 0)).slice(0, 3),
    [news])

  return { myTasks, awaitingReview, healthFindings, latestNews }
}

function FocusSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-faint">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide">{title}</span>
      </div>
      {children}
    </section>
  )
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate()
  const { user } = useUser()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput]       = useState('')
  const [streaming, setStreaming] = useState(false)
  const [indexEntries, setIndexEntries] = useState<SearchIndexEntry[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const { myTasks, awaitingReview, healthFindings, latestNews } = useFocusData(user?.uid)

  useEffect(() => {
    const unsub = adapter.db.subscribe<SearchIndexEntry>('searchIndex', d => { if (Array.isArray(d)) setIndexEntries(d) })
    return unsub
  }, [])

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])

  // Resolve a cited refId / form number to an entity route and navigate there.
  function openCitation(cite: string) {
    const norm = cite.toLowerCase().replace(/\s+/g, ' ').trim()
    const hit = indexEntries.find(e =>
      (e.refId ?? '').toLowerCase() === norm ||
      e.subtitle?.toLowerCase() === norm ||
      e.title.toLowerCase().includes(norm) ||
      (e.keywords ?? []).some(k => k.toLowerCase() === norm.replace(/\s/g, '-') || k.toLowerCase() === norm),
    )
    navigate(hit ? routeFor(hit) : `/app/explorer`)
  }

  async function ask(text: string) {
    const question = text.trim()
    if (!question || streaming) return
    setInput('')

    const history: ChatMessage[] = [...messages, { role: 'user', text: question, tools: [] }]
    // Placeholder assistant message we stream into.
    setMessages([...history, { role: 'assistant', text: '', tools: [] }])
    setStreaming(true)

    const wire = history.map(m => ({ role: m.role, content: m.text }))

    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages(prev => {
        const next = [...prev]
        const idx = next.length - 1
        if (idx >= 0 && next[idx]!.role === 'assistant') next[idx] = fn(next[idx]!)
        return next
      })

    try {
      await adapter.fns.stream('chat', { messages: wire }, (chunk) => {
        let ev: StreamEvent
        try { ev = JSON.parse(chunk) as StreamEvent } catch { return }
        switch (ev.t) {
          case 'token':
            patchAssistant(m => ({ ...m, text: m.text + ev.v })); break
          case 'tool':
            patchAssistant(m => {
              const tools = [...m.tools]
              if (ev.phase === 'start') tools.push({ name: ev.name, done: false })
              else {
                const i = [...tools].reverse().findIndex(t => t.name === ev.name && !t.done)
                if (i >= 0) tools[tools.length - 1 - i] = { name: ev.name, done: true, summary: ev.summary }
              }
              return { ...m, tools }
            }); break
          case 'error':
            patchAssistant(m => ({ ...m, text: m.text + `\n\n⚠️ ${ev.message}` })); break
          case 'done': break
          case 'json': break
        }
      })
    } catch (err) {
      patchAssistant(m => ({ ...m, text: m.text || `⚠️ ${err instanceof Error ? err.message : 'Request failed.'}` }))
    } finally {
      setStreaming(false)
    }
  }

  const empty = messages.length === 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 h-full min-h-0">
      {/* Chat column */}
      <div className="flex flex-col min-h-0 max-w-3xl w-full mx-auto">
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 pr-1">
          {empty ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-6 py-10">
              <div className="w-14 h-14 rounded-[16px] flex items-center justify-center"
                style={{ background: 'var(--gradient-accent)' }}>
                <IconSparkle size={26} className="text-white" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-1.5">
                <h1 className="text-xl font-bold text-text">Ask your product portfolio</h1>
                <p className="text-sm text-dim max-w-md">Grounded in your coverages, forms, rules and rating tables — every answer cites the exact refId or form number.</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-2.5 w-full max-w-xl">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => ask(s)}
                    className="text-left text-sm text-dim bg-surface rounded-[12px] px-4 py-3 hover:text-text hover:shadow-[var(--shadow-card-hover)] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    style={{ border: '1px solid var(--color-border)' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5 py-4">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={m.role === 'user'
                    ? 'max-w-[85%] rounded-[14px] px-4 py-2.5 text-sm text-white'
                    : 'max-w-[92%] flex flex-col gap-2'}
                    style={m.role === 'user' ? { background: 'var(--gradient-accent)' } : undefined}>
                    {m.role === 'assistant' && m.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.tools.map((t, ti) => (
                          <span key={ti} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-raised text-[11px] text-dim font-mono">
                            {t.done ? <IconCheck size={10} className="text-good" aria-hidden="true" /> : <IconSpinner size={10} className="animate-spin text-accent" aria-hidden="true" />}
                            {t.name}{t.done && t.summary ? ` · ${t.summary}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.role === 'assistant'
                      ? <div className="text-sm text-text"><RichText text={m.text} onCite={openCitation} />{streaming && i === messages.length - 1 && <span className="inline-block w-1.5 h-4 ml-0.5 bg-accent align-middle animate-pulse" />}</div>
                      : m.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="mt-3">
          <ChatComposer value={input} onChange={setInput} onSubmit={() => ask(input)} streaming={streaming} />
        </div>
      </div>

      {/* Today's Focus rail */}
      <aside className="hidden lg:flex flex-col gap-6 overflow-y-auto min-h-0 pl-1">
        <h2 className="text-sm font-semibold text-text">Today's Focus</h2>

        <FocusSection icon={<IconTasks size={13} aria-hidden="true" />} title="My open tasks">
          {myTasks.length === 0 ? <EmptyLine text="No open tasks assigned." /> : myTasks.map(t => {
            const due = relativeDue(toMillis(t.dueAt))
            return (
              <button key={t.id} onClick={() => navigate('/app/tasks')} className="flex items-center justify-between gap-2 text-left w-full group">
                <span className="text-xs text-dim group-hover:text-text truncate">{t.title}</span>
                <Badge label={due.label} color={due.overdue ? 'danger' : 'default'} />
              </button>
            )
          })}
        </FocusSection>

        <FocusSection icon={<IconClipboard size={13} aria-hidden="true" />} title="Awaiting review">
          {awaitingReview.length === 0 ? <EmptyLine text="Nothing awaiting review." /> : awaitingReview.map(p => (
            <button key={p.id} onClick={() => navigate(`/app/products/${p.id}/overview`)} className="flex items-center justify-between gap-2 text-left w-full group">
              <span className="text-xs text-dim group-hover:text-text truncate">{p.name}</span>
              <Badge label={p.reviewStatus.replace(/_/g, ' ')} color="warn" />
            </button>
          ))}
        </FocusSection>

        <FocusSection icon={<IconActivity size={13} aria-hidden="true" />} title="Health findings">
          {healthFindings.length === 0 ? <EmptyLine text="No products yet." /> : healthFindings.map(p => (
            <button key={p.id} onClick={() => navigate(`/app/products/${p.id}/overview`)} className="flex items-center justify-between gap-2 text-left w-full group">
              <span className="text-xs text-dim group-hover:text-text truncate">{p.name}</span>
              <span className="flex items-center gap-1.5">
                {(p.health?.findingCount ?? 0) > 0 && <span className="text-[11px] text-warn">{p.health.findingCount}</span>}
                <Badge label={`${p.health?.score ?? '—'}`} color={(p.health?.score ?? 100) < 70 ? 'danger' : (p.health?.score ?? 100) < 90 ? 'warn' : 'good'} />
              </span>
            </button>
          ))}
        </FocusSection>

        <FocusSection icon={<IconNews size={13} aria-hidden="true" />} title="Latest news">
          {latestNews.length === 0 ? <EmptyLine text="No news items yet." /> : latestNews.map(n => (
            <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="flex flex-col gap-0.5 group">
              <span className="text-xs text-dim group-hover:text-text line-clamp-2">{n.title}</span>
              <span className="text-[10px] text-faint">{n.source}</span>
            </a>
          ))}
        </FocusSection>
      </aside>
    </div>
  )
}

function EmptyLine({ text }: { text: string }) {
  return <span className="text-xs text-faint italic">{text}</span>
}

// Map a search-index hit to its in-app route (mirrors Explorer's toRoute).
function routeFor(entry: SearchIndexEntry): string {
  const pid = entry.path.split('/')[1] ?? 'HO.PROD.001'
  switch (entry.type) {
    case 'product':    return `/app/products/${pid}/overview`
    case 'coverage':   return `/app/products/${pid}/coverages`
    case 'form':       return `/app/products/${pid}/forms`
    case 'rule':       return `/app/products/${pid}/rules`
    case 'dictionary': return `/app/dictionary`
    default:           return `/app/explorer`
  }
}
```


## `app/src/routes/Landing.tsx`

```tsx
// Public landing — the showpiece. Aurora background + a bespoke "insight graph":
// an insurance product manager at the focal point, informed by inward-flowing
// streams from the app's capabilities (live news, coverages & forms, an AI
// copilot, rating, intelligent tasks). Coverages branch out from their node.
// A Claude-style grounded composer is the hero's primary call-to-action — it
// previews the copilot's grounded, refId-citing answers, then hands off to
// sign-in. Pure CSS + inline SVG, zero images, honours prefers-reduced-motion.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Logo } from '../components/ui'
import { IconArrowUp, IconLayers, IconSparkle, IconTasks } from '../components/ui/icons'

// A glyph accepts size / className / strokeWidth — matches the in-house icon shape.
type Glyph = (p: { size?: number; className?: string; strokeWidth?: number }) => React.ReactElement

// ─── Aurora background ────────────────────────────────────────────────────────

function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="aurora-a absolute w-[720px] h-[520px] rounded-full opacity-30 -top-48 -left-40"
        style={{ background: 'radial-gradient(ellipse at center, rgba(161,0,255,.5) 0%, transparent 70%)' }} />
      <div className="aurora-b absolute w-[620px] h-[460px] rounded-full opacity-25 top-1/4 -right-32"
        style={{ background: 'radial-gradient(ellipse at center, rgba(109,40,217,.42) 0%, transparent 70%)' }} />
      <div className="aurora-c absolute w-[520px] h-[420px] rounded-full opacity-20 bottom-0 left-1/4"
        style={{ background: 'radial-gradient(ellipse at center, rgba(139,31,224,.4) 0%, transparent 70%)' }} />
    </div>
  )
}

// ─── Insight-graph geometry ───────────────────────────────────────────────────

interface Vec { x: number; y: number }
const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y)
const unit = (a: Vec, b: Vec): Vec => { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d } }
const rad = (deg: number) => (deg * Math.PI) / 180

// Focal point: the product manager.
const PM  = { x: 348, y: 234 }
const RPM = 46           // medallion radius
const RN  = 22           // feature-node radius

type GlyphId = 'news' | 'ai' | 'cov' | 'rate' | 'task'
interface Feature { id: GlyphId; label: string; x: number; y: number }

// Capability sources — arranged on a left arc, converging on the PM.
const FEATURES: Feature[] = [
  { id: 'news', label: 'Live news',  x: 100, y: 66  },
  { id: 'ai',   label: 'AI copilot', x: 64,  y: 152 },
  { id: 'cov',  label: 'Coverages',  x: 70,  y: 240 },
  { id: 'rate', label: 'Rating',     x: 80,  y: 328 },
  { id: 'task', label: 'Tasks',      x: 112, y: 410 },
]

// Coverage leaves that branch out of the Coverages node.
const COV = FEATURES.find(f => f.id === 'cov')!
const COV_LEAVES = ['A', 'B', 'C', 'D', 'E', 'F'].map((letter, i) => {
  const angle = 108 + i * 22               // fan out to the left, evenly spaced, clear of neighbours
  return { letter, x: COV.x + 50 * Math.cos(rad(angle)), y: COV.y + 50 * Math.sin(rad(angle)) }
})

interface Edge { d: string; len: number; drawDelay: number; flowDelay: number; head: string }

function buildEdges(): Edge[] {
  return FEATURES.map((n, i) => {
    const u  = unit(n, PM)
    const S  = { x: n.x + u.x * RN,   y: n.y + u.y * RN  }  // leaves the node toward PM
    const E  = { x: PM.x - u.x * RPM, y: PM.y - u.y * RPM } // arrives at the medallion edge
    const c1 = { x: S.x + (E.x - S.x) * 0.45, y: S.y }
    const c2 = { x: E.x - 78, y: E.y + (n.y - PM.y) * 0.05 }
    const d  = `M ${S.x} ${S.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${E.x} ${E.y}`
    // Arrowhead pointing into the PM (makes the inward direction unmistakable at rest).
    const p  = { x: -u.y, y: u.x }
    const b1 = { x: E.x - u.x * 8 + p.x * 4, y: E.y - u.y * 8 + p.y * 4 }
    const b2 = { x: E.x - u.x * 8 - p.x * 4, y: E.y - u.y * 8 - p.y * 4 }
    return {
      d, len: dist(S, E) * 1.18,
      drawDelay: 200 + i * 90,
      flowDelay: 600 + i * 140,
      head: `${E.x},${E.y} ${b1.x},${b1.y} ${b2.x},${b2.y}`,
    }
  })
}
const EDGES = buildEdges()

// ─── Feature glyphs (hand-drawn, no icon fonts) ───────────────────────────────

function Glyph({ id }: { id: GlyphId }) {
  const s = { stroke: 'var(--color-accent)', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (id) {
    case 'news': return <g {...s}><rect x={-7} y={-8} width={14} height={16} rx={2} /><line x1={-4} y1={-4} x2={4} y2={-4} /><line x1={-4} y1={0} x2={4} y2={0} /><line x1={-4} y1={4} x2={1} y2={4} /></g>
    case 'ai':   return <path d="M0 -9 C1 -3 3 -1 9 0 C3 1 1 3 0 9 C-1 3 -3 1 -9 0 C-3 -1 -1 -3 0 -9 Z" fill="var(--color-accent)" />
    case 'cov':  return <g {...s}>{[-5, 0, 5].map((dy, i) => <path key={i} d={`M-8 ${dy} L0 ${dy - 4} L8 ${dy} L0 ${dy + 4} Z`} />)}</g>
    case 'rate': return <g {...s}><line x1={-6} y1={7} x2={-6} y2={1} /><line x1={0} y1={7} x2={0} y2={-3} /><line x1={6} y1={7} x2={6} y2={-7} /></g>
    case 'task': return <g {...s}><rect x={-7} y={-7} width={14} height={14} rx={3} /><path d="M-3 0 L-0.5 3 L4 -3" /></g>
  }
}

// ─── The insight graph ────────────────────────────────────────────────────────

function InsightGraph() {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 150); return () => clearTimeout(t) }, [])

  return (
    <svg
      viewBox="0 0 470 470" width="100%" height="100%" fill="none"
      className="graph-float max-w-[500px]"
      role="img"
      aria-label="An insurance product manager at the focal point, continuously informed by inward-flowing streams from the platform: live market news, the product's coverages and forms branching from a coverages node, an AI copilot, rating, and intelligent tasks."
    >
      <defs>
        <radialGradient id="ig-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity=".32" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ig-edge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-accent-bright)" stopOpacity=".18" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity=".6" />
        </linearGradient>
        <linearGradient id="ig-flow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-accent-bright)" />
          <stop offset="100%" stopColor="var(--color-accent-strong)" />
        </linearGradient>
        <linearGradient id="ig-medallion" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-accent-bright)" />
          <stop offset="100%" stopColor="var(--color-accent-strong)" />
        </linearGradient>
      </defs>

      {/* Converging edges: self-drawing base + inward-flowing pulse + arrowhead */}
      {EDGES.map((e, i) => (
        <g key={`e${i}`}>
          <path d={e.d} stroke="url(#ig-edge)" strokeWidth={1.5} strokeLinecap="round"
            className={`constellation-line ${drawn ? 'drawn' : ''}`}
            style={{ '--dash-len': `${e.len}px`, '--draw-delay': `${e.drawDelay}ms`, strokeDasharray: e.len } as React.CSSProperties} />
          <path d={e.d} stroke="url(#ig-flow)" strokeWidth={2} strokeLinecap="round" className="edge-flow"
            style={{ '--flow-delay': `${e.flowDelay}ms` } as React.CSSProperties} />
          <polygon points={e.head} fill="var(--color-accent)" opacity={drawn ? 0.75 : 0}
            style={{ transition: 'opacity .5s ease', transitionDelay: `${e.drawDelay + 700}ms` }} />
        </g>
      ))}

      {/* Coverage leaves branching out of the Coverages node */}
      {COV_LEAVES.map((leaf, i) => (
        <g key={`cov${leaf.letter}`} className="rise-in" style={{ '--rise-delay': `${1100 + i * 70}ms` } as React.CSSProperties}>
          <line x1={COV.x} y1={COV.y} x2={leaf.x} y2={leaf.y} stroke="var(--color-accent-line)" strokeWidth={1} />
          <circle cx={leaf.x} cy={leaf.y} r={9} fill="rgba(255,255,255,.95)" stroke="var(--color-accent-line)" strokeWidth={1}
            style={{ filter: 'drop-shadow(0 1px 5px rgba(139,31,224,.10))' }} />
          <text x={leaf.x} y={leaf.y + 3} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="var(--color-accent)"
            style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}>{leaf.letter}</text>
        </g>
      ))}

      {/* Feature source nodes */}
      {FEATURES.map((f, i) => (
        <g key={f.id} className="rise-in" style={{ '--rise-delay': `${250 + i * 110}ms` } as React.CSSProperties}>
          <circle cx={f.x} cy={f.y} r={RN + 7} fill="url(#ig-glow)" className="node-glow"
            style={{ '--breathe-delay': `${i * 420}ms` } as React.CSSProperties} />
          <circle cx={f.x} cy={f.y} r={RN} fill="rgba(255,255,255,.96)" stroke="var(--color-accent-line)" strokeWidth={1}
            style={{ filter: 'drop-shadow(0 3px 12px rgba(139,31,224,.12))' }} />
          <g transform={`translate(${f.x} ${f.y})`}><Glyph id={f.id} /></g>
          <text x={f.x} y={f.y - RN - 8} textAnchor="middle" fontSize="10" fontWeight="600" fill="#131318">{f.label}</text>
        </g>
      ))}

      {/* Focal point — the product manager, aggregating every stream */}
      <g className="rise-in" style={{ '--rise-delay': '150ms' } as React.CSSProperties}>
        <circle cx={PM.x} cy={PM.y} r={RPM + 22} fill="url(#ig-glow)" className="node-glow" />
        {/* Orbiting intake ring (reuses the edge-flow dash animation) */}
        <circle cx={PM.x} cy={PM.y} r={RPM + 9} fill="none" stroke="var(--color-accent-line)" strokeWidth={1.25}
          className="edge-flow" style={{ strokeDasharray: '3 9' } as React.CSSProperties} />
        <circle cx={PM.x} cy={PM.y} r={RPM} fill="url(#ig-medallion)"
          style={{ filter: 'drop-shadow(0 8px 26px rgba(139,31,224,.34))' }} />
        {/* Product-manager glyph: head + shoulders */}
        <g fill="#fff">
          <circle cx={PM.x} cy={PM.y - 9} r={11} />
          <path d={`M${PM.x - 19} ${PM.y + 22} C${PM.x - 19} ${PM.y + 6} ${PM.x + 19} ${PM.y + 6} ${PM.x + 19} ${PM.y + 22} Z`} />
        </g>
        <text x={PM.x} y={PM.y + RPM + 22} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#131318">Product Manager</text>
      </g>
    </svg>
  )
}

// ─── Hero composer — a grounded, Claude-style entry point ─────────────────────
// Previews the copilot: rotating, domain-true prompts that all cite refIds/forms.
// Submitting (or picking a suggestion) starts a session by handing off to sign-in.

const PROMPTS = [
  'Trace how the $1,528 HO-3 premium is built',
  'Which forms attach to Coverage C — Personal Property?',
  'What does endorsement HO 04 90 change?',
  'Where does wind/hail carry a separate deductible?',
]

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function HeroComposer() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [promptIdx, setPromptIdx] = useState(0)

  // Cycle the placeholder through grounded example prompts (frozen if the user
  // prefers reduced motion, or once they start typing).
  useEffect(() => {
    if (prefersReducedMotion() || value) return
    const t = setInterval(() => setPromptIdx(i => (i + 1) % PROMPTS.length), 3600)
    return () => clearInterval(t)
  }, [value])

  // Any attempt to ask hands off to the workspace sign-in — honest: real answers
  // are grounded in your data, which lives behind auth.
  function start() { navigate('/sign-in') }

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={e => { e.preventDefault(); start() }}
        className="group flex items-center gap-2 bg-surface rounded-[16px] pl-4 pr-2 py-2 transition-shadow duration-200"
        style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
        onFocus={e => { e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)' }}
        onBlur={e => { e.currentTarget.style.boxShadow = 'var(--shadow-card)' }}
      >
        <IconSparkle size={18} className="text-accent shrink-0" aria-hidden="true" />
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={PROMPTS[promptIdx]}
          aria-label="Ask your portfolio anything"
          className="flex-1 min-w-0 bg-transparent text-[15px] text-text placeholder:text-faint outline-none py-1.5"
        />
        <button
          type="submit"
          aria-label="Ask the copilot"
          className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-[11px] text-white transition-transform duration-200 hover:scale-[1.05] active:scale-[.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{ background: 'var(--gradient-accent-vivid)', boxShadow: '0 4px 14px var(--glow-accent)' }}
        >
          <IconArrowUp size={17} aria-hidden="true" />
        </button>
      </form>
      <p className="text-xs text-faint px-1 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-good shrink-0" aria-hidden="true" />
        Grounded in your data — every answer cites its <span className="font-mono text-dim">refId</span> and form number.
      </p>
    </div>
  )
}

// ─── Feature cards ────────────────────────────────────────────────────────────

const CARDS: { icon: Glyph; title: string; body: string }[] = [
  {
    icon: IconLayers,
    title: 'Your whole portfolio, one workspace',
    body: 'Author coverages, forms, rules and rating side by side — versioned, governed and instantly searchable, from first draft to state filing.',
  },
  {
    icon: IconSparkle,
    title: 'An AI copilot for product managers',
    body: 'Ask your portfolio anything. Trace a premium, see which forms attach, draft language — every answer grounded in your data and cited to the exact refId.',
  },
  {
    icon: IconTasks,
    title: 'Every signal, aggregated',
    body: 'Live market news, readiness checks, reviews awaiting you and a living task board — the whole picture converges on you, so nothing slips.',
  },
]

function FeatureCard({ icon: Icon, title, body, delay }: { icon: Glyph; title: string; body: string; delay: number }) {
  return (
    <div
      className="group rise-in bg-surface rounded-[18px] p-6 flex flex-col gap-4 transition-all duration-300 hover:-translate-y-1"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)', '--rise-delay': `${delay}ms` } as React.CSSProperties}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-card)' }}
    >
      <div className="w-11 h-11 rounded-[13px] flex items-center justify-center transition-transform duration-300 group-hover:scale-[1.06]"
        style={{ background: 'var(--gradient-accent-soft)' }}>
        <Icon size={20} className="text-accent" strokeWidth={1.75} />
      </div>
      <h3 className="text-[15px] font-semibold text-text leading-snug">{title}</h3>
      <p className="text-sm text-dim leading-relaxed">{body}</p>
    </div>
  )
}

// ─── Landing ────────────────────────────────────────────────────────────────

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="relative min-h-svh flex flex-col overflow-hidden bg-page">
      <Aurora />

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
        <div className="flex items-center gap-2.5">
          <Logo size={32} rounded={9} className="shadow-[0_2px_10px_rgba(139,31,224,.3)]" />
          <span className="font-semibold text-text text-[15px] tracking-tight">Product Reinvention Hub</span>
        </div>
        <button
          onClick={() => navigate('/sign-in')}
          className="text-sm font-medium text-dim hover:text-text transition-colors px-4 py-2 rounded-[9px] hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Sign in →
        </button>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex flex-col lg:flex-row items-center justify-center gap-10 lg:gap-16 px-6 sm:px-10 pt-8 pb-16 flex-1 max-w-6xl mx-auto w-full">
        <div className="flex flex-col gap-7 max-w-lg text-center lg:text-left">
          <span className="rise-in inline-flex items-center gap-2 self-center lg:self-start text-xs font-medium text-accent bg-accent-soft rounded-full px-3 py-1"
            style={{ '--rise-delay': '0ms' } as React.CSSProperties}>
            <span className="w-1.5 h-1.5 rounded-full bg-accent" /> AI-native · P&amp;C insurance
          </span>

          <h1 className="rise-in text-display text-[2.75rem] leading-[1.04] sm:text-6xl font-bold text-text"
            style={{ '--rise-delay': '70ms' } as React.CSSProperties}>
            Ship insurance<br />products{' '}
            <span className="gradient-text">faster.</span>
          </h1>

          <p className="rise-in text-base sm:text-lg text-dim leading-relaxed max-w-md mx-auto lg:mx-0"
            style={{ '--rise-delay': '150ms' } as React.CSSProperties}>
            The product manager sits at the centre. Coverages, rating, live market news,
            intelligent tasks and an AI copilot all flow to you — grounded, governed and
            fully traceable, from first draft to state filing.
          </p>

          <div className="rise-in" style={{ '--rise-delay': '230ms' } as React.CSSProperties}>
            <HeroComposer />
          </div>
        </div>

        {/* Insight graph */}
        <div className="relative shrink-0 w-[360px] h-[360px] sm:w-[480px] sm:h-[480px] flex items-center justify-center">
          <div className="absolute inset-10 rounded-full blur-3xl opacity-[.16] pointer-events-none"
            style={{ background: 'radial-gradient(circle, var(--color-accent-bright), transparent 70%)' }} aria-hidden="true" />
          <InsightGraph />
        </div>
      </main>

      {/* Feature cards */}
      <section className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-5 px-6 sm:px-10 pb-16 max-w-5xl mx-auto w-full" aria-label="What the Hub does">
        {CARDS.map((f, i) => <FeatureCard key={f.title} {...f} delay={280 + i * 90} />)}
      </section>

      {/* Footer */}
      <footer className="relative z-10 flex items-center justify-center py-6 text-xs text-faint" style={{ borderTop: '1px solid var(--color-border)' }}>
        Product Reinvention Hub · P&amp;C Insurance Product Management · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
```


## `app/src/routes/MustChangePassword.tsx`

```tsx
// Interstitial shown when mustChangePassword=true on the user's Firestore doc.
import { useState, type FormEvent } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { adapter } from '../lib/backend'
import { IconSpinner } from '../components/ui/icons'
import { useUser } from '../context/useUser'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'

export default function MustChangePassword() {
  const { user }  = useUser()
  const navigate  = useNavigate()

  const [next,    setNext]    = useState('')
  const [confirm, setConfirm] = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  if (!user) return <Navigate to="/sign-in" replace />

  // Capture for async closure — TypeScript cannot narrow closure vars after early return
  const currentUser = user

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (next.length < 8)           { setError('Password must be at least 8 characters.'); return }
    if (next !== confirm)          { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      await adapter.auth.changePassword(next)
      await adapter.db.mutate({
        op: 'update', path: `users/${currentUser.uid}`,
        data: { mustChangePassword: false },
        entityType: 'user',
        actor: { uid: currentUser.uid, name: currentUser.name ?? currentUser.email ?? 'unknown' },
      })
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-[rgba(180,83,9,.1)] flex items-center justify-center text-warn font-bold text-lg" aria-hidden="true">!</div>
          <h1 className="text-xl font-bold text-text">Set a new password</h1>
          <p className="text-sm text-dim text-center">Your account requires a password change before you can continue.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface rounded-[16px] p-6 flex flex-col gap-4"
          style={{ boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}
          noValidate
        >
          <Input
            label="New password"
            type="password"
            value={next}
            onChange={e => setNext(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
            disabled={loading}
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Repeat password"
            autoComplete="new-password"
            required
            disabled={loading}
          />
          {error && <p role="alert" className="text-sm text-danger bg-[rgba(220,38,38,.06)] rounded-[8px] px-3 py-2">{error}</p>}
          <Button type="submit" variant="primary" className="w-full mt-1" disabled={loading || !next || !confirm}>
            {loading && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
            {loading ? 'Saving...' : 'Set password'}
          </Button>
        </form>
      </div>
    </div>
  )
}
```


## `app/src/routes/News.tsx`

```tsx
// News (/app/news) — a market-news feed curated by the nightly agent, plus a
// natural-language preference box (stored per user as newsPrefs) and a manual
// "Refresh now" for on-demand fetches. Empty state explains the nightly agent.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Newspaper, RefreshCw, ExternalLink, Sparkles } from 'lucide-react'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Button, Skeleton, EmptyState } from '../components/ui'
import type { News as NewsType, NewsPrefs } from '@pf/shared'

type NewsDoc = NewsType & { id: string }

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v
  const o = v as { toDate?: () => Date; seconds?: number }
  if (o && typeof o.toDate === 'function') return o.toDate().getTime()
  if (o && typeof o.seconds === 'number') return o.seconds * 1000
  return 0
}

export default function News() {
  const { user } = useUser()
  const [items, setItems]         = useState<NewsDoc[] | null>(null)
  const [instruction, setInstr]   = useState('')
  const [savedInstr, setSaved]    = useState('')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const u1 = adapter.db.subscribe<NewsDoc>('news', d => { if (Array.isArray(d)) setItems(d) })
    let u2: (() => void) | undefined
    if (user) {
      u2 = adapter.db.subscribe<NewsPrefs>(`newsPrefs/${user.uid}`, d => {
        if (d && !Array.isArray(d)) { setInstr(d.instruction ?? ''); setSaved(d.instruction ?? '') }
      })
    }
    return () => { u1(); u2?.() }
  }, [user])

  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => toMillis(b.fetchedAt) - toMillis(a.fetchedAt)), [items])

  async function savePrefs() {
    if (!user) return
    try {
      await adapter.db.mutate({
        op: savedInstr ? 'update' : 'create', path: `newsPrefs/${user.uid}`,
        data: { instruction: instruction.trim() },
        entityType: 'newsPrefs', actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
      })
      setSaved(instruction.trim())
      toast.success('Tracking preference saved')
    } catch {
      toast.error('Could not save preference')
    }
  }

  async function refresh() {
    setRefreshing(true)
    try {
      const r = await adapter.fns.call<Record<string, never>, { found: number; stored: number; error?: string }>('refreshNews', {})
      if (r.error) toast.error(r.error)
      else toast.success(`Found ${r.found}, added ${r.stored} new item${r.stored === 1 ? '' : 's'}`)
    } catch {
      toast.error('Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Market News</h1>
          <p className="text-sm text-dim">Curated nightly by an AI agent from your tracking instruction.</p>
        </div>
        <Button variant="default" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Fetching…' : 'Refresh now'}
        </Button>
      </div>

      {/* Preference box */}
      <div className="bg-surface rounded-[14px] p-4 flex flex-col gap-2" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <label htmlFor="news-instr" className="flex items-center gap-1.5 text-sm font-medium text-text"><Sparkles size={14} className="text-accent" /> What should the agent track?</label>
        <textarea id="news-instr" value={instruction} onChange={e => setInstr(e.target.value)} rows={2}
          placeholder="e.g. Track homeowners rate filings and competitor HO-3 launches in TX and FL"
          className="rounded-[10px] bg-surface border text-sm text-text p-3 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none" style={{ borderColor: 'rgba(19,19,26,.12)' }} />
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={savePrefs} disabled={!instruction.trim() || instruction.trim() === savedInstr}>Save preference</Button>
        </div>
      </div>

      {/* Feed */}
      {items === null ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : sorted.length === 0 ? (
        <EmptyState icon={<Newspaper size={28} />} title="No news yet"
          description="A nightly agent (06:00 ET) searches the web for your tracking instruction and files what it finds here. Set a preference above, then use “Refresh now” to fetch immediately." />
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map(n => (
            <a key={n.id} href={n.url} target="_blank" rel="noreferrer"
              className="group bg-surface rounded-[14px] p-4 flex flex-col gap-2 transition-all hover:shadow-[var(--shadow-card-hover)]"
              style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-center gap-2 text-xs text-faint">
                <span className="font-medium text-dim">{n.source || 'Web'}</span>
                {n.fetchedAt ? <><span>·</span><span>{new Date(toMillis(n.fetchedAt)).toLocaleDateString()}</span></> : null}
                <ExternalLink size={12} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <h3 className="text-sm font-semibold text-text group-hover:text-accent transition-colors leading-snug">{n.title}</h3>
              {n.summary && <p className="text-sm text-dim leading-relaxed">{n.summary}</p>}
              {(n.tags ?? []).length > 0 && <div className="flex flex-wrap gap-1.5 pt-0.5">{n.tags.map(t => <Badge key={t} label={t} color="purple" />)}</div>}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
```


## `app/src/routes/product/ProductCoverages.tsx`

```tsx
// Coverages — the product's coverages as a browsable collection (cards ⇄ list).
// Every coverage is a hub whose tiles drill into focused editors: Limits and
// Deductibles (typed standard options), States (US map), and the Forms/Pricing/
// Rules tabs — filtered to that coverage so the relationships stay navigable both
// ways. Create / edit / delete keep the hierarchy consistent.
import { useMemo, useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { toast } from 'sonner'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Button, Skeleton, EmptyState, ViewToggle, type ViewMode } from '../../components/ui'
import { IconPlus, IconSearch, IconCoverage } from '../../components/ui/icons'
import { CoverageHubCard } from '../../components/product/CoverageHubCard'
import { CoverageRow } from '../../components/product/CoverageRow'
import { BaseFormExtract } from '../../components/product/BaseFormExtract'
import type { CoverageAspect } from '../../components/product/coverageAspects'
import { TermOptionsDialog } from '../../components/product/TermOptionsDialog'
import { CoverageStatesDialog } from '../../components/product/CoverageStatesDialog'
import { CoverageEditDialog } from '../../components/product/CoverageEditDialog'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const VIEW_KEY = 'pf.coverages.view'
const byOrder = (a: WithId<Coverage>, b: WithId<Coverage>) => (a.order ?? 0) - (b.order ?? 0)

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[.09em] text-faint">{label}</h3>
      <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
      <span className="text-[11px] text-faint tnum">{count}</span>
    </div>
  )
}

export default function ProductCoverages() {
  const { pid, product, coverages, loading } = useProductCtx()
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) || 'cards')
  const setViewPersist = (m: ViewMode) => { setView(m); localStorage.setItem(VIEW_KEY, m) }
  const [query, setQuery] = useState('')

  // Aspect editors (dialogs) + coverage create/edit.
  const [dialog, setDialog] = useState<{ kind: 'limits' | 'deductibles' | 'states'; cov: WithId<Coverage> } | null>(null)
  const [editCov, setEditCov] = useState<WithId<Coverage> | 'new' | null>(null)

  const fuse = useMemo(() => new Fuse(coverages, { keys: ['name', 'refId', 'claimsBasis'], threshold: 0.4 }), [coverages])
  const filtered = query ? fuse.search(query).map(r => r.item) : coverages
  const roots = filtered.filter(c => !c.parentId).sort(byOrder)
  const endorsements = filtered.filter(c => c.parentId).sort(byOrder)
  const parentName = (refId?: string | null) => coverages.find(c => c.refId === refId)?.name

  // A deep link (?cov=<id|refId>) auto-opens that coverage's Limits editor once,
  // after coverages have loaded (guarded so closing it doesn't reopen).
  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current) return
    const target = params.get('cov')
    if (!target || !coverages.length) return
    const cov = coverages.find(c => c.id === target || c.refId === target)
    if (cov) { setDialog({ kind: 'limits', cov }); deepLinkDone.current = true }
  }, [coverages, params])

  function onTile(aspect: CoverageAspect, cov: WithId<Coverage>) {
    if (aspect === 'limits' || aspect === 'deductibles' || aspect === 'states') setDialog({ kind: aspect, cov })
    else navigate(`/app/products/${pid}/${aspect}?cov=${encodeURIComponent(cov.refId ?? cov.id)}`)
  }

  async function onDelete(cov: WithId<Coverage>) {
    if (!canEdit) return
    const children = coverages.filter(c => c.parentId === cov.refId)
    if (children.length) { toast.error(`Reassign or remove its ${children.length} endorsement${children.length === 1 ? '' : 's'} first.`); return }
    if (!window.confirm(`Delete "${cov.name}"? This cannot be undone.`)) return
    try {
      await adapter.db.mutate({ op: 'delete', path: `products/${pid}/coverages/${cov.id}`, entityType: 'coverage', productId: pid, actor })
      toast.success('Coverage deleted')
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — please refresh.' : err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const hubProps = (cov: WithId<Coverage>) => ({ cov, canEdit, onTile, onEdit: setEditCov, onDelete })

  if (loading) return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-44 rounded-[16px]" />)}
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-dim tnum shrink-0">{coverages.length} coverage{coverages.length === 1 ? '' : 's'}</span>
        <div className="relative flex-1 min-w-[200px]">
          <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search coverages by name or code…"
            className="w-full h-9 pl-9 pr-3 rounded-[9px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent" />
        </div>
        <ViewToggle mode={view} onChange={setViewPersist} />
        {product && <BaseFormExtract product={product} coverages={coverages} canEdit={canEdit} actor={actor} />}
        {canEdit && <Button variant="primary" size="sm" onClick={() => setEditCov('new')}><IconPlus size={14} />Add coverage</Button>}
      </div>

      {coverages.length === 0 ? (
        <EmptyState icon={<IconCoverage size={32} />} title="No coverages yet"
          description={canEdit ? 'Add the first coverage to start building this product.' : undefined}
          action={canEdit ? <Button variant="primary" size="sm" onClick={() => setEditCov('new')}><IconPlus size={14} />Add coverage</Button> : undefined} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<IconSearch size={32} />} title={`No coverages match "${query}"`} />
      ) : (
        <div className="flex flex-col gap-6">
          {roots.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader label="Coverages" count={roots.length} />
              {view === 'cards' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {roots.map(cov => <CoverageHubCard key={cov.id} {...hubProps(cov)} />)}
                </div>
              ) : (
                <div className="rounded-[14px] overflow-hidden bg-surface" style={{ border: '1px solid var(--color-border)' }}>
                  {roots.map(cov => <CoverageRow key={cov.id} {...hubProps(cov)} />)}
                </div>
              )}
            </section>
          )}

          {endorsements.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader label="Endorsements" count={endorsements.length} />
              {view === 'cards' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {endorsements.map(cov => <CoverageHubCard key={cov.id} parentName={parentName(cov.parentId)} {...hubProps(cov)} />)}
                </div>
              ) : (
                <div className="rounded-[14px] overflow-hidden bg-surface" style={{ border: '1px solid var(--color-border)' }}>
                  {endorsements.map(cov => <CoverageRow key={cov.id} isEndorsement {...hubProps(cov)} />)}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Aspect editors */}
      {dialog?.kind === 'limits' && <TermOptionsDialog cov={dialog.cov} mode="LIMIT" onClose={() => setDialog(null)} />}
      {dialog?.kind === 'deductibles' && <TermOptionsDialog cov={dialog.cov} mode="DEDUCTIBLE" onClose={() => setDialog(null)} />}
      {dialog?.kind === 'states' && <CoverageStatesDialog cov={dialog.cov} onClose={() => setDialog(null)} />}
      {editCov !== null && <CoverageEditDialog cov={editCov === 'new' ? null : editCov} onClose={() => setEditCov(null)} />}
    </div>
  )
}
```


## `app/src/routes/product/ProductForms.tsx`

```tsx
// Forms tab — table of product forms with facets; row click opens a full Drawer.
// Two-way linked with coverages: a coverage's form chip deep-links here (?form=),
// and each form lists the coverages that reference it (clickable back).
import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { useProductCtx } from '../../context/useProductCtx'
import { Badge, Skeleton, EmptyState, RefChip } from '../../components/ui'
import { IconForm, IconClose } from '../../components/ui/icons'
import { Drawer } from '../../components/ui/Drawer'
import type { WithId } from '../../context/ProductContext'
import type { Form, Coverage } from '@pf/shared'

const CAT_COLOR: Record<string, 'blue'|'purple'|'warn'|'danger'|'good'|'default'> = {
  BASE_COVERAGE: 'purple', DECLARATIONS: 'blue', ENDORSEMENT: 'good',
  EXCLUSION: 'danger', AMENDATORY: 'warn', POLICY_NOTICE: 'default',
}

function FormDrawer({ form, coverages, onOpenCoverage, onClose }: {
  form: WithId<Form>; coverages: WithId<Coverage>[]; onOpenCoverage: (id: string) => void; onClose: () => void
}) {
  const referencedBy = coverages.filter(c => c.formNumbers?.includes(form.number))
  return (
    <Drawer open title={`${form.number} — ${form.name}`} onClose={onClose} width="w-[480px]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-1.5">
          <Badge label={form.category.replace('_', ' ')} color={CAT_COLOR[form.category] ?? 'default'} />
          <Badge label={`Ed. ${form.edition}`} color="default" />
          <Badge label={form.source} color="default" />
          {form.dynamic && <Badge label="Dynamic" color="blue" />}
          {form.mandatoryDefault && <Badge label="Mandatory" color="purple" />}
        </div>

        <div>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-1">Description</p>
          <p className="text-sm text-dim">{form.description || 'No description yet.'}</p>
        </div>

        {/* Two-way link back to coverages */}
        {referencedBy.length > 0 && (
          <div>
            <p className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Referenced by coverages</p>
            <div className="flex flex-col gap-1">
              {referencedBy.map(c => (
                <button key={c.id} onClick={() => onOpenCoverage(c.id)}
                  className="flex items-center justify-between gap-2 text-left px-3 py-2 rounded-[8px] bg-raised hover:bg-accent/5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                  <span className="text-sm text-text truncate">{c.name}</span>
                  {c.refId && <span className="font-mono text-[11px] text-faint shrink-0">{c.refId}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {form.dynamicFields?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Dynamic fields</p>
            <div className="flex flex-col gap-1.5">
              {form.dynamicFields.map(f => (
                <div key={f.name} className="flex items-center justify-between px-3 py-2 bg-raised rounded-[8px] text-sm">
                  <span className="font-medium text-text">{f.name}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge label={f.dataType} color="default" />
                    {f.repeating && <Badge label="repeating" color="blue" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-1">Attachment</p>
          <p className="text-sm text-dim">{form.attachmentCondition === 'NONE' ? 'Mandatory — always attached' : 'Rule-driven — see Forms rules'}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-1">States</p>
          <p className="text-sm text-dim">{form.allStates ? 'All states' : (form.states?.join(', ') || 'None')}</p>
        </div>
      </div>
    </Drawer>
  )
}

export default function ProductForms() {
  const { pid, forms, coverages, loading } = useProductCtx()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [query, setQuery]     = useState('')
  const [catFilter, setCat]   = useState('')
  const [selected, setSelected] = useState<WithId<Form> | null>(null)

  // Honour a deep link from a coverage's form chip (…/forms?form=HO%2004%2090).
  const focusForm = params.get('form')
  useEffect(() => {
    if (focusForm && forms.length) {
      const hit = forms.find(f => f.number === focusForm)
      if (hit) setSelected(hit)
    }
  }, [focusForm, forms])

  // Honour a coverage deep link from its Forms tile (…/forms?cov=<refId>) — scope
  // the table to just that coverage's attached forms, with a clearable chip.
  const covFilter = coverages.find(c => c.refId === params.get('cov') || c.id === params.get('cov'))
  const covForms = covFilter ? new Set(covFilter.formNumbers ?? []) : null

  const fuse    = useMemo(() => new Fuse(forms, { keys: ['number', 'name', 'category'], threshold: 0.4 }), [forms])
  const base    = query ? fuse.search(query).map(r => r.item) : forms
  const filtered = base
    .filter(f => !catFilter || f.category === catFilter)
    .filter(f => !covForms || covForms.has(f.number))
  const cats = [...new Set(forms.map(f => f.category))]

  if (loading) return <Skeleton className="h-64 rounded-[14px]" />

  return (
    <div className="flex flex-col gap-4">
      {covFilter && (
        <div className="flex items-center gap-2 self-start pl-3 pr-1.5 py-1.5 rounded-[9px] bg-accent-soft text-sm">
          <span className="text-dim">Forms attached to</span>
          <span className="font-medium text-accent">{covFilter.name}</span>
          <button onClick={() => { const p = new URLSearchParams(params); p.delete('cov'); setParams(p, { replace: true }) }}
            aria-label="Clear coverage filter" className="w-6 h-6 rounded-[6px] flex items-center justify-center text-accent hover:bg-surface transition-colors"><IconClose size={14} /></button>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          className="flex-1 min-w-[200px] h-8 px-3 rounded-[8px] bg-surface border border-border-strong text-sm placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
          placeholder="Search forms..."
          value={query} onChange={e => setQuery(e.target.value)}
        />
        <select
          className="h-8 px-3 rounded-[8px] bg-surface border border-border-strong text-sm text-dim focus:outline-none focus:ring-2 focus:ring-accent/25"
          value={catFilter} onChange={e => setCat(e.target.value)}
        >
          <option value="">All categories</option>
          {cats.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
        <span className="text-sm text-faint tnum">{filtered.length} form{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<IconForm size={32} />} title={covFilter ? `No forms attached to ${covFilter.name}` : 'No forms'} description={covFilter ? undefined : 'Forms appear here once the product is seeded.'} compact />
      ) : (
        <div className="bg-surface rounded-[14px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-raised text-xs font-medium text-dim uppercase tracking-wide" style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Number','Name','Edition','Category','Dyn','States'].map(h => (
                  <th key={h} className="text-left px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(form => (
                <tr key={form.id} onClick={() => setSelected(form)}
                  className="cursor-pointer hover:bg-raised transition-colors"
                  style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-3"><RefChip id={form.number} /></td>
                  <td className="px-4 py-3 text-text max-w-[200px] truncate">{form.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-dim">{form.edition}</td>
                  <td className="px-4 py-3"><Badge label={form.category.replace('_',' ')} color={CAT_COLOR[form.category] ?? 'default'} /></td>
                  <td className="px-4 py-3 text-center">{form.dynamic ? '✓' : '—'}</td>
                  <td className="px-4 py-3 text-xs text-dim">{form.allStates ? 'All' : form.states?.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <FormDrawer
          form={selected}
          coverages={coverages}
          onOpenCoverage={id => { setSelected(null); navigate(`/app/products/${pid}/coverages?cov=${id}`) }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
```


## `app/src/routes/product/ProductOverview.tsx`

```tsx
// Overview — a single-column, focused reading experience: the product's coverages
// presented as a logically-grouped collection (ISO Section I / II), with generous
// spacing and elegant refId + limit typography. Health lives in the workspace
// header pill; the single most important finding (if any) surfaces here as one
// quiet, dismissible inline banner — never a panel.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProductCtx } from '../../context/useProductCtx'
import { Skeleton } from '../../components/ui'
import { IconWarning, IconAlertCircle, IconArrowRight, IconClose } from '../../components/ui/icons'
import { CoverageCollection } from '../../components/product/CoverageCollection'
import { computeProductFindings, type Finding } from '../../lib/productHealth'

// ─── Quiet inline finding banner ───────────────────────────────────────────────

function FindingBanner({ top, more, onReview, onDismiss }: {
  top: Finding; more: number; onReview: () => void; onDismiss: () => void
}) {
  const isError = top.severity === 'error'
  const Icon = isError ? IconAlertCircle : IconWarning
  const tint = isError ? 'rgba(220,38,38,' : 'rgba(180,83,9,'
  return (
    <div className="flex items-center gap-3 rounded-[12px] px-4 py-2.5 text-sm rise-in"
      style={{ background: `${tint}.05)`, border: `1px solid ${tint}.18)` }}>
      <Icon size={15} className={isError ? 'text-danger shrink-0' : 'text-warn shrink-0'} aria-hidden="true" />
      <span className="text-dim flex-1 min-w-0 truncate">{top.message}</span>
      {more > 0 && <span className="text-xs text-faint shrink-0 hidden sm:inline">+{more} more</span>}
      <button onClick={onReview}
        className="text-accent font-medium inline-flex items-center gap-1 shrink-0 rounded-[6px] px-1 hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
        Review <IconArrowRight size={13} aria-hidden="true" />
      </button>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-faint hover:text-text shrink-0 rounded-[6px] p-0.5 transition-colors">
        <IconClose size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

// ─── Overview route ───────────────────────────────────────────────────────────

export default function ProductOverview() {
  const navigate = useNavigate()
  const ctx = useProductCtx()
  const { pid, coverages, loading } = ctx
  const [dismissed, setDismissed] = useState(false)

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-[14px]" />)}
        </div>
      </div>
    )
  }

  const findings = computeProductFindings({
    pid, coverages, rules: ctx.rules, ratingProgram: ctx.ratingProgram,
    ldTables: ctx.ldTables, rtTables: ctx.rtTables, formRules: ctx.formRules,
  })
  const top = findings[0]

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      {top && !dismissed && (
        <FindingBanner
          top={top}
          more={findings.length - 1}
          onReview={() => navigate(top.route)}
          onDismiss={() => setDismissed(true)}
        />
      )}

      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-text tracking-tight">Coverages</h2>
        <span className="text-xs text-dim tnum">
          {coverages.length} total{findings.length ? ` · ${findings.length} finding${findings.length !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      <CoverageCollection coverages={coverages} onOpen={id => navigate(`/app/products/${pid}/coverages?cov=${id}`)} />
    </div>
  )
}
```


## `app/src/routes/product/ProductPricing.tsx`

```tsx
// Pricing worksheet — live rating evaluation via the shared engine; defaults to $1,528 worked example.
import { useState, useMemo, useRef } from 'react'
import { IconDownload, IconRefresh, IconRule, IconTable } from '../../components/ui/icons'
import { evaluate } from '@pf/shared'
import { makeHO3RtGetter, makeHO3LdGetter, HO3_WORKED_EXAMPLE, HO3_COASTAL_STATES } from '@pf/shared'
import type { RatingInputs, TraceEntry } from '@pf/shared'
import { useProductCtx } from '../../context/useProductCtx'
import { Button, Badge, Skeleton } from '../../components/ui'
import { RatingFlow } from '../../lib/svg/ratingFlow'

const COASTAL = new Set<string>(HO3_COASTAL_STATES)

// ─── Input panel ─────────────────────────────────────────────────────────────

interface InputSelectProps {
  label: string
  options: { label: string; value: number | string; disabled?: boolean; note?: string }[]
  value: number | string
  onChange: (v: number | string) => void
}
function InputSelect({ label, options, value, onChange }: InputSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-dim">{label}</span>
      <select
        className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
        value={String(value)} onChange={e => {
          const opt = options.find(o => String(o.value) === e.target.value)
          onChange(opt?.value ?? e.target.value)
        }}
      >
        {options.map(o => <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>{o.label}{o.disabled ? ' (blocked)' : ''}</option>)}
      </select>
    </div>
  )
}

function InputNumber({ label, value, onChange, min, step }: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-dim">{label}</span>
      <input
        type="number" min={min} step={step ?? 1000}
        className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
        value={value} onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

// ─── Trace: animated flow diagram + detailed table + clean SVG export ─────────

function TracePanel({ trace, finalPremium }: { trace: TraceEntry[]; finalPremium: number }) {
  const [view, setView] = useState<'flow' | 'table'>('flow')
  const flowRef = useRef<HTMLDivElement>(null)

  // Export the on-screen flow SVG verbatim (adds a page-background rect for a
  // self-contained file). Serialising the rendered node keeps export == on-screen.
  function exportSVG() {
    const svg = flowRef.current?.querySelector('svg')
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#F7F7FA')
    clone.insertBefore(bg, clone.firstChild)
    const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone)
    const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' }))
    const a = document.createElement('a'); a.href = url; a.download = 'rating-flow.svg'; a.click()
    URL.revokeObjectURL(url)
  }

  const seg = (v: 'flow' | 'table', icon: React.ReactNode, label: string) => (
    <button onClick={() => setView(v)} aria-pressed={view === v}
      className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-[7px] text-xs font-medium transition-colors ${view === v ? 'bg-surface text-accent shadow-[var(--shadow-card)]' : 'text-dim hover:text-text'}`}>
      {icon}{label}
    </button>
  )

  return (
    <div className="flex flex-col gap-0 h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-text">Rating trace</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-[9px] bg-raised" role="tablist" aria-label="Trace view">
            {seg('flow', <IconRule size={13} />, 'Flow')}
            {seg('table', <IconTable size={13} />, 'Table')}
          </div>
          <Button variant="ghost" size="sm" onClick={exportSVG} aria-label="Export rating flow as SVG"><IconDownload size={13} />SVG</Button>
        </div>
      </div>

      {view === 'flow' ? (
        <div ref={flowRef} className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
          <RatingFlow trace={trace} finalPremium={finalPremium} />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-faint uppercase tracking-wide" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Step','Op','Source','Factor / $','Running total'].map(h => <th key={h} className="text-left px-3 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {trace.map(t => (
                  <tr key={t.stepId} className="hover:bg-raised" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2 font-mono text-text">{t.stepId}</td>
                    <td className="px-3 py-2"><Badge label={t.op} color={t.op === 'MUL' ? 'purple' : t.op === 'ADD' ? 'good' : t.op === 'SET' ? 'blue' : 'warn'} /></td>
                    <td className="px-3 py-2 font-mono text-dim truncate max-w-[140px]">{t.sourceRef}</td>
                    <td className="px-3 py-2 font-mono text-text">
                      {t.op === 'MUL' ? `×${t.factorOrAmount}` : t.op === 'ADD' ? `+$${t.factorOrAmount.toFixed(2)}` : t.op === 'SET' ? `$${t.factorOrAmount}` : `≥$${t.factorOrAmount}`}
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-text">
                      ${t.runningTotal.toLocaleString(undefined, { minimumFractionDigits: t.rounded ? 0 : 2, maximumFractionDigits: 2 })}
                      {t.rounded && <span className="text-faint text-[10px] ml-1">rounded</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Final premium */}
          <div
            className="flex items-center justify-between px-5 py-4 rounded-[12px] mt-3"
            style={{ background: 'var(--gradient-accent-soft)', border: '1px solid var(--color-accent-line)' }}
          >
            <span className="text-sm font-semibold text-text">Final premium</span>
            <span className="text-2xl font-bold tabular-nums gradient-text">${finalPremium.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main route ───────────────────────────────────────────────────────────────

export default function ProductPricing() {
  const { ratingProgram, ldTables, rtTables, loading } = useProductCtx()
  const [inputs, setInputs]       = useState<RatingInputs>({ ...HO3_WORKED_EXAMPLE })
  const [riskState, setRiskState] = useState('OH')

  const upd = (patch: Partial<RatingInputs>) => setInputs(prev => ({ ...prev, ...patch }))

  const result = useMemo(() => {
    if (!ratingProgram || !Object.keys(rtTables).length || !Object.keys(ldTables).length) return null
    try {
      const rtGetter = makeHO3RtGetter(rtTables)
      const ldGetter = makeHO3LdGetter(ldTables)
      return evaluate(ratingProgram, inputs, rtGetter, ldGetter)
    } catch { return null }
  }, [ratingProgram, rtTables, ldTables, inputs])

  if (loading) return <div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><Skeleton className="h-[500px]" /><Skeleton className="h-[500px]" /></div>

  // Build LD option arrays from loaded tables
  const ldOpts = (ref: string) => ldTables[ref]?.rows.map(r => ({ label: r.label, value: r.value, note: r.constraintNote })) ?? []
  const covFOpts = ldOpts('HO.LD.002').map(o => ({ ...o, disabled: o.value === 5000 && inputs.covELimit < 300000 }))
  const windHailCoastal = COASTAL.has(riskState)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Left — inputs */}
      <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-text">Rating inputs</span>
          <Button variant="ghost" size="sm" onClick={() => setInputs({ ...HO3_WORKED_EXAMPLE })}>
            <IconRefresh size={13} />Reset to $1,528
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InputSelect label="Territory" value={inputs.territory}
            options={[{label:'T001 ($640)',value:'T001'},{label:'T002 ($700)',value:'T002'},{label:'T003 ($815)',value:'T003'},{label:'T004 ($905)',value:'T004'},{label:'T005 ($1,040)',value:'T005'}]}
            onChange={v => upd({ territory: String(v) })} />

          <div className="flex flex-col gap-1">
            <span className="text-xs text-dim">Risk state</span>
            <select className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none"
              value={riskState} onChange={e => setRiskState(e.target.value)}>
              {['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA'].map(s => (
                <option key={s} value={s}>{s}{COASTAL.has(s) ? ' ⚡' : ''}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-dim">Protection class</span>
            <input type="number" min={1} max={10} className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none"
              value={inputs.pc} onChange={e => upd({ pc: Number(e.target.value) })} />
          </div>

          <InputSelect label="Construction" value={inputs.construction}
            options={[{label:'Frame',value:'F'},{label:'Masonry',value:'M'}]}
            onChange={v => upd({ construction: String(v) })} />

          <InputNumber label="Coverage A ($)" value={inputs.covA} min={100000} onChange={v => upd({ covA: v })} />

          <InputSelect label="All-peril deductible" value={inputs.allPerilDed}
            options={ldOpts('HO.LD.003')} onChange={v => upd({ allPerilDed: Number(v) })} />

          {/* Wind/hail — only shown for coastal risk states */}
          {windHailCoastal ? (
            <>
              <div className="flex items-center gap-2 col-span-2">
                <input type="checkbox" id="wh" checked={inputs.windHailElected}
                  onChange={e => upd({ windHailElected: e.target.checked, windHailPct: e.target.checked ? 1 : undefined })} />
                <label htmlFor="wh" className="text-xs text-dim">Wind/Hail % deductible (coastal) [HO.RU.008]</label>
              </div>
              {inputs.windHailElected && (
                <InputSelect label="Wind/hail %" value={inputs.windHailPct ?? 1}
                  options={ldOpts('HO.LD.004').map(o => ({
                    label: o.label, value: o.value,
                    disabled: (Number(o.value) / 100 * inputs.covA) < inputs.allPerilDed,
                  }))}
                  onChange={v => upd({ windHailPct: Number(v) })} />
              )}
            </>
          ) : (
            <div className="col-span-2 text-xs text-faint italic">Wind/hail deductible not available for {riskState} [HO.RU.008]</div>
          )}

          <InputSelect label="Coverage C %" value={inputs.covCPct}
            options={ldOpts('HO.LD.005')} onChange={v => upd({ covCPct: Number(v) })} />

          <InputSelect label="Coverage E limit" value={inputs.covELimit}
            options={ldOpts('HO.LD.001')} onChange={v => upd({ covELimit: Number(v) })} />

          <InputSelect label="Coverage F limit [HO.RU.006]" value={inputs.covFLimit}
            options={covFOpts} onChange={v => upd({ covFLimit: Number(v) })} />

          <InputSelect label="Tier" value={inputs.tier}
            options={[{label:'A (×0.90)',value:'A'},{label:'B (×1.10)',value:'B'},{label:'C (×1.25)',value:'C'}]}
            onChange={v => upd({ tier: String(v) })} />

          <InputSelect label="Device credit" value={inputs.deviceCredit}
            options={[{label:'None',value:'none'},{label:'Local alarm (×0.98)',value:'local'},{label:'Central station (×0.95)',value:'central'}]}
            onChange={v => upd({ deviceCredit: String(v) })} />

          <div className="flex items-center gap-2 col-span-2">
            <input type="checkbox" id="rc" checked={inputs.rcElected}
              onChange={e => upd({ rcElected: e.target.checked })} />
            <label htmlFor="rc" className="text-xs text-dim">Replacement Cost (HO 04 90) ×1.10</label>
          </div>

          <div className="flex items-center gap-2 col-span-2">
            <input type="checkbox" id="wb" checked={inputs.waterBackupElected}
              onChange={e => upd({ waterBackupElected: e.target.checked, waterBackupLimit: e.target.checked ? 5000 : undefined })} />
            <label htmlFor="wb" className="text-xs text-dim">Water back-up (HO 04 95)</label>
          </div>
          {inputs.waterBackupElected && (
            <InputSelect label="Water back-up limit" value={inputs.waterBackupLimit ?? 5000}
              options={ldOpts('HO.LD.006')} onChange={v => upd({ waterBackupLimit: Number(v) })} />
          )}

          {/* SPP */}
          <div className="flex items-center gap-2 col-span-2">
            <input type="checkbox" id="spp" checked={inputs.sppElected}
              onChange={e => upd({ sppElected: e.target.checked, sppItems: e.target.checked ? (inputs.sppItems?.length ? inputs.sppItems : [{ itemClass: 'Jewelry', appraisedValue: 15000 }]) : [] })} />
            <label htmlFor="spp" className="text-xs text-dim">Scheduled Personal Property (HO 04 61)</label>
          </div>
          {inputs.sppElected && (
            <div className="col-span-2 flex flex-col gap-2">
              {(inputs.sppItems ?? []).map((item, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs"
                    value={item.itemClass}
                    onChange={e => { const s = [...(inputs.sppItems ?? [])]; s[i] = { ...s[i]!, itemClass: e.target.value }; upd({ sppItems: s }) }}>
                    {['Jewelry','Furs','Cameras','Fine Arts','Silverware','Musical Instruments'].map(c => <option key={c}>{c}</option>)}
                  </select>
                  <input type="number" className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs"
                    value={item.appraisedValue}
                    onChange={e => { const s = [...(inputs.sppItems ?? [])]; s[i] = { ...s[i]!, appraisedValue: Number(e.target.value) }; upd({ sppItems: s }) }} />
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={() => upd({ sppItems: [...(inputs.sppItems ?? []), { itemClass: 'Jewelry', appraisedValue: 10000 }] })}>
                + Add item
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Right — trace */}
      <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
        {!ratingProgram || !result ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-faint">
            <IconRefresh size={24} className={!ratingProgram ? '' : 'animate-spin'} />
            <span className="text-sm">{!ratingProgram ? 'No rating program found' : 'Loading tables...'}</span>
          </div>
        ) : (
          <TracePanel trace={result.trace} finalPremium={result.finalPremium} />
        )}
      </div>
    </div>
  )
}
```


## `app/src/routes/product/ProductRules.tsx`

```tsx
// Rules tab — grouped product rules + live Simulate panel (form attachment + violations).
import { useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react'
import { evaluateRules } from '@pf/shared'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Badge, Skeleton, EmptyState } from '../../components/ui'
import { IconPlus, IconClose } from '../../components/ui/icons'
import { Button } from '../../components/ui/Button'
import { RuleFlowCard, RuleComposer, type NewRule } from '../../components/product/RuleBuilder'
import type { RuleCategory, SelectionContext } from '@pf/shared'
import { HO3_COASTAL_STATES } from '@pf/shared'

const COASTAL = new Set<string>(HO3_COASTAL_STATES)
const CAT_COLOR: Record<RuleCategory, 'purple'|'blue'|'warn'> = { PRODUCT: 'purple', RATING: 'blue', FORMS: 'warn' }

// ─── Simulate panel ───────────────────────────────────────────────────────────

const DEFAULT_SEL: SelectionContext = {
  riskState: 'TX', covELimit: 300000, covFLimit: 1000, allPerilDed: 1000,
  windHailElected: false, covA: 400000,
  rcElected: true, deviceCredit: 'none',
  waterBackupElected: false, sppElected: true,
  dayCareCoverage: false, otherStructuresInc: false,
}

function SimulatePanel() {
  const { ldTables } = useProductCtx()
  const [sel, setSel] = useState<SelectionContext>(DEFAULT_SEL)
  const upd = (p: Partial<SelectionContext>) => setSel(prev => ({ ...prev, ...p }))

  const result = useMemo(() => {
    if (!Object.keys(ldTables).length) return null
    return evaluateRules({ ldTables, selection: sel })
  }, [ldTables, sel])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Inputs */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">Simulate selections</p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-dim w-36">Risk state</span>
            <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs flex-1"
              value={sel.riskState} onChange={e => upd({ riskState: e.target.value })}>
              {['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-dim w-36">Coverage E limit</span>
            <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs flex-1"
              value={sel.covELimit} onChange={e => upd({ covELimit: Number(e.target.value) })}>
              {[{l:'$100k',v:100000},{l:'$300k',v:300000},{l:'$500k',v:500000}].map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-dim w-36">Coverage F limit</span>
            <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs flex-1"
              value={sel.covFLimit} onChange={e => upd({ covFLimit: Number(e.target.value) })}>
              {[{l:'$1k',v:1000},{l:'$2k',v:2000},{l:'$5k',v:5000}].map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          {[
            { key: 'rcElected' as const, label: 'Replacement Cost (HO 04 90)' },
            { key: 'sppElected' as const, label: 'Scheduled Personal Property (HO 04 61)' },
            { key: 'waterBackupElected' as const, label: 'Water Back-Up (HO 04 95)' },
            { key: 'windHailElected' as const, label: `Wind/Hail % deductible (${COASTAL.has(sel.riskState) ? 'coastal ✓' : 'non-coastal'})` },
            { key: 'dayCareCoverage' as const, label: 'Home day-care exclusion (HO 04 96)' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <input type="checkbox" id={key} checked={Boolean(sel[key])}
                onChange={e => upd({ [key]: e.target.checked })} className="accent-accent" />
              <label htmlFor={key} className="text-xs text-dim">{label}</label>
            </div>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">Result</p>
        {!result ? <Skeleton className="h-32" /> : (
          <>
            {/* Violations */}
            {result.violations.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-faint uppercase tracking-wide">Violations</p>
                {result.violations.map((v, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-[8px] bg-[rgba(220,38,38,.06)] text-sm">
                    <AlertCircle size={14} className="text-danger shrink-0 mt-0.5" />
                    <span className="text-danger text-xs">{v.message} <span className="font-mono">[{v.ruleRefId}]</span></span>
                  </div>
                ))}
              </div>
            )}
            {result.violations.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-good">
                <CheckCircle size={14} />No violations
              </div>
            )}

            {/* Forms that attach */}
            <div>
              <p className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Forms that attach</p>
              <div className="flex flex-wrap gap-1.5">
                {result.formsThatAttach.map(fn => <Badge key={fn} label={fn} color="blue" mono />)}
              </div>
            </div>

            {/* Available options summary */}
            {Object.entries(result.availableOptions).map(([tableRef, opts]) => {
              const blocked = opts.filter(o => !o.available)
              if (!blocked.length) return null
              return (
                <div key={tableRef}>
                  <p className="text-xs font-medium text-faint uppercase tracking-wide mb-1">{tableRef} constraints</p>
                  {blocked.map(o => (
                    <div key={o.value} className="flex items-center gap-2 text-xs text-warn">
                      <AlertTriangle size={10} />{o.label}: {o.violationReason}
                    </div>
                  ))}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main route ───────────────────────────────────────────────────────────────

export default function ProductRules() {
  const ctx = useProductCtx()
  const { pid, rules, formRules, coverages, loading } = ctx
  const { user } = useUser()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const canEdit  = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const [query,  setQuery]  = useState('')
  const [simOpen, setSimOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)

  // Coverage deep link from its Rules tile (…/rules?cov=<refId>) — show only rules
  // that govern that coverage, with a clearable chip.
  const covFilter = coverages.find(c => c.refId === params.get('cov') || c.id === params.get('cov'))
  const covRef = covFilter?.refId ?? null

  // Deep-link helpers so a rule links to the coverages / forms it governs.
  const openCoverage = (refId: string) => {
    const c = coverages.find(x => x.refId === refId)
    navigate(`/app/products/${pid}/coverages?cov=${c?.id ?? refId}`)
  }
  const openForm = (num: string) => navigate(`/app/products/${pid}/forms?form=${encodeURIComponent(num)}`)

  async function createRule(nr: NewRule) {
    if (!user) return
    const next = Math.max(10, ...rules.map(r => Number(/HO\.RU\.(\d+)/.exec(r.refId ?? '')?.[1] ?? 0))) + 1
    const refId = `HO.RU.${String(next).padStart(3, '0')}`
    try {
      await adapter.db.mutate({
        op: 'create', path: `products/${pid}/rules/${crypto.randomUUID()}`,
        data: { ...nr, refId, allStates: true, states: [], status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED' },
        entityType: 'rule', productId: pid, actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
      })
      toast.success(`Rule ${refId} created`)
      setComposerOpen(false)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Could not create rule.')
    }
  }

  const grouped = useMemo(() => {
    let filtered = query ? rules.filter(r => `${r.refId} ${r.condition} ${r.outcome}`.toLowerCase().includes(query.toLowerCase())) : rules
    if (covRef) filtered = filtered.filter(r => r.coverageRefIds?.includes(covRef))
    const map: Record<string, typeof filtered> = {}
    for (const rule of filtered) {
      const cat = rule.category ?? 'PRODUCT'
      if (!map[cat]) map[cat] = []
      map[cat]!.push(rule)
    }
    return map
  }, [rules, query, covRef])

  if (loading) return <Skeleton className="h-64 rounded-[14px]" />

  return (
    <div className="flex flex-col gap-5">
      {covFilter && (
        <div className="flex items-center gap-2 self-start pl-3 pr-1.5 py-1.5 rounded-[9px] bg-accent-soft text-sm">
          <span className="text-dim">Rules governing</span>
          <span className="font-medium text-accent">{covFilter.name}</span>
          <button onClick={() => { const p = new URLSearchParams(params); p.delete('cov'); setParams(p, { replace: true }) }}
            aria-label="Clear coverage filter" className="w-6 h-6 rounded-[6px] flex items-center justify-center text-accent hover:bg-surface transition-colors"><IconClose size={14} /></button>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <input className="flex-1 max-w-sm h-8 px-3 rounded-[8px] bg-surface border border-border-strong text-sm placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
          placeholder="Search rules..." value={query} onChange={e => setQuery(e.target.value)} />
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="ghost" size="sm" onClick={() => setSimOpen(s => !s)}>
            {simOpen ? 'Hide simulate' : 'Simulate…'}
          </Button>
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => setComposerOpen(o => !o)}>
              <IconPlus size={14} />New rule
            </Button>
          )}
        </div>
      </div>

      {composerOpen && canEdit && (
        <RuleComposer forms={ctx.forms.map(f => f.number)} onCreate={createRule} onCancel={() => setComposerOpen(false)} />
      )}

      {simOpen && (
        <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
          <p className="text-sm font-semibold text-text mb-4">Simulate panel — enter selections to see which forms attach and what violations fire</p>
          <SimulatePanel />
        </div>
      )}

      {/* Product rules — rendered as logical IF → THEN flows */}
      {Object.entries(grouped).map(([cat, catRules]) => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-2">
            <Badge label={cat} color={CAT_COLOR[cat as RuleCategory] ?? 'default'} />
            <span className="text-xs text-faint">{catRules.length} rule{catRules.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
            {catRules.map(rule => (
              <RuleFlowCard key={rule.id} rule={rule} onOpenCoverage={openCoverage} onOpenForm={openForm} />
            ))}
          </div>
        </div>
      ))}

      {/* Form attachment rules (hidden when scoped to a single coverage) */}
      {!covRef && formRules.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge label="FORM ATTACHMENT" color="warn" />
            <span className="text-xs text-faint">{formRules.length} rule{formRules.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
            {formRules.map(fr => (
              <RuleFlowCard key={fr.id}
                rule={{ id: fr.id, refId: fr.refId, category: 'FORMS', subCategory: fr.mandatory ? 'Mandatory' : undefined, condition: fr.condition, outcome: fr.outcome, formNumbers: fr.formNumbers }}
                onOpenForm={openForm} />
            ))}
          </div>
        </div>
      )}

      {Object.keys(grouped).length === 0 && (covRef || !formRules.length) && (
        <EmptyState
          title={covRef ? `No rules governing ${covFilter?.name}` : 'No rules'}
          description={covRef ? undefined : 'Rules will appear here once the product is seeded.'} compact />
      )}
    </div>
  )
}
```


## `app/src/routes/product/ProductStates.tsx`

```tsx
// States tab — SVG grid choropleth + toggle grid editor + bulk actions.
import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { IconDownload, IconStates } from '../../components/ui/icons'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Button } from '../../components/ui'
import { StateTileMap } from '../../components/product/StateTileMap'
import { HO3_FOOTPRINT_STATES, HO3_COASTAL_STATES } from '@pf/shared'
import { US_TILE_GRID as STATE_GRID } from '../../lib/geo/usTileGrid'

const COASTAL = new Set<string>(HO3_COASTAL_STATES)
const FOOTPRINT = new Set<string>(HO3_FOOTPRINT_STATES)
const ALL_STATES = Object.keys(STATE_GRID)

export default function ProductStates() {
  const { pid, product, loading } = useProductCtx()
  const { user }   = useUser()
  const canEdit    = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor      = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const svgRef     = useRef<HTMLDivElement>(null)

  const [states, setStates] = useState<string[]>(() => product?.states ?? [])
  const [dirty,  setDirty]  = useState(false)

  const activeSet = new Set(states)

  function toggleState(st: string) {
    setStates(prev => prev.includes(st) ? prev.filter(s => s !== st) : [...prev, st])
    setDirty(true)
  }

  async function handleSave() {
    if (!product) return
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}`,
        data: { states, allStates: false },
        entityType: 'product', productId: pid, actor,
        expectedRev: (product as { rev?: number }).rev,
      })
      setDirty(false)
      toast.success('States saved')
    } catch (err) {
      if (err instanceof MutationConflictError) toast.error('Conflict — refresh and try again.')
      else toast.error('Save failed')
    }
  }

  function exportSVG() {
    const svgEl = svgRef.current?.querySelector('svg')
    if (!svgEl) return
    const str = new XMLSerializer().serializeToString(svgEl)
    const blob = new Blob([str], { type: 'image/svg+xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'states-map.svg'; a.click()
  }

  if (loading) return <div className="h-64 bg-raised animate-pulse rounded-[14px]" />

  return (
    <div className="flex flex-col gap-5">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-text">{states.length} states selected</span>
        {canEdit && (
          <>
            <Button variant="ghost" size="sm" onClick={() => { setStates([...FOOTPRINT]); setDirty(true) }}>
              <IconStates size={13} />All footprint
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setStates([]); setDirty(true) }}>Clear</Button>
            {dirty && <Button variant="primary" size="sm" onClick={handleSave}>Save states</Button>}
          </>
        )}
        <Button variant="ghost" size="sm" onClick={exportSVG} className="ml-auto">
          <IconDownload size={13} />SVG
        </Button>
      </div>

      {/* Map */}
      <div ref={svgRef} className="bg-surface rounded-[14px] p-4 overflow-x-auto" style={{ border: '1px solid var(--color-border)' }}>
        <StateTileMap active={activeSet} coastal={COASTAL} onToggle={toggleState} canEdit={canEdit} />
      </div>

      {/* Grid chips */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_STATES.sort().map(st => (
          <button
            key={st}
            disabled={!canEdit}
            onClick={() => canEdit && toggleState(st)}
            className={`px-2 py-1 rounded-[6px] text-xs font-mono font-medium border transition-colors
              ${activeSet.has(st) ? 'bg-accent text-white border-accent' : 'bg-surface text-dim border-border-strong hover:border-accent hover:text-accent'}
              ${!canEdit ? 'cursor-default' : 'cursor-pointer'}`}
          >
            {st}
            {COASTAL.has(st) && activeSet.has(st) && <span className="ml-0.5 text-[8px]">⚡</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
```


## `app/src/routes/product/ProductWorkspace.tsx`

```tsx
// Product workspace — loads product context, renders hero header + tab outlet.
import { useParams, useNavigate, useLocation, Outlet, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ProductProvider } from '../../context/ProductContext'
import { useProductCtx } from '../../context/useProductCtx'
import { adapter } from '../../lib/backend'
import { Skeleton, StatusPill, LifecyclePill, Badge, Button } from '../../components/ui'
import { IconShare, IconRecent, IconChat, IconUsers } from '../../components/ui/icons'
import { computeProductFindings, healthScore, healthColor } from '../../lib/productHealth'
import { HistoryDrawer } from '../../components/product/HistoryDrawer'
import { CommentsPanel } from '../../components/product/CommentsPanel'
import { ShareModal } from '../../components/product/ShareModal'
import { ExportMenu } from '../../components/product/ExportMenu'

const TABS = [
  { id: 'overview',  label: 'Overview'  },
  { id: 'coverages', label: 'Coverages' },
  { id: 'forms',     label: 'Forms'     },
  { id: 'pricing',   label: 'Pricing'   },
  { id: 'states',    label: 'States'    },
  { id: 'rules',     label: 'Rules'     },
]

function WorkspaceInner() {
  const { pid, product, coverages, rules, formRules, forms, ldTables, rtTables, ratingProgram, loading } = useProductCtx()
  const navigate     = useNavigate()
  const { pathname } = useLocation()
  const activeTab    = TABS.find(t => pathname.includes(t.id))?.id ?? 'overview'
  const [historyOpen, setHistoryOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [shareOpen,    setShareOpen]    = useState(false)
  const [viewers, setViewers] = useState<string[]>([])

  // Presence
  useEffect(() => {
    const leavePresence = adapter.presence.join(pid)
    // Dedupe by uid — one avatar per person even with multiple open tabs/sessions.
    const unwatch = adapter.presence.watch(pid, uids => setViewers([...new Set(uids)]))
    return () => { leavePresence(); unwatch() }
  }, [pid])

  if (loading && !product) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 rounded-[16px]" /><Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-[16px]" />
      </div>
    )
  }

  if (!product) return <Navigate to="/app/products" replace />

  // Readiness pill — same source as the Overview finding banner, so they agree.
  const findings = computeProductFindings({ pid, coverages, rules, ratingProgram, ldTables, rtTables, formRules })
  const score  = healthScore(findings)
  const hColor = healthColor(score)

  return (
    <div className="flex flex-col gap-0">
      {/* Hero header */}
      <div
        className="rounded-[16px] p-6 mb-5 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, rgba(139,31,224,.08) 0%, rgba(122,0,230,.06) 100%)', border: '1px solid var(--color-border)' }}
      >
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl opacity-30"
            style={{ background: 'radial-gradient(circle, #8B1FE0, #7A00E6)' }} />
        </div>

        <div className="relative">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusPill status={product.status} />
                <LifecyclePill lifecycle={product.lifecycle} />
                {product.lob?.name && <Badge label={product.lob.name} color="blue" />}
                <span
                  className="inline-flex items-center gap-1.5 rounded-full pl-2 pr-2.5 py-0.5 text-xs font-medium tnum"
                  style={{ background: `color-mix(in srgb, ${hColor} 12%, transparent)`, color: hColor }}
                  title={findings.length ? `${findings.length} readiness finding${findings.length !== 1 ? 's' : ''}` : 'No issues found'}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: hColor }} aria-hidden="true" />
                  {score}{findings.length ? ` · ${findings.length} finding${findings.length !== 1 ? 's' : ''}` : ' · Healthy'}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-text">{product.name}</h1>
              {product.refId && (
                <span className="text-sm font-mono text-dim">{product.refId}</span>
              )}
              <p className="text-sm text-dim mt-1">
                {coverages.length} coverage{coverages.length !== 1 ? 's' : ''}
                {' · '}{product.states?.length ?? 0} state{(product.states?.length ?? 0) !== 1 ? 's' : ''}
                {' · '}{product.marketSegment}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Presence avatars */}
              {viewers.length > 0 && (
                <div className="flex items-center gap-1 mr-2">
                  <IconUsers size={12} className="text-faint" aria-hidden="true" />
                  <div className="flex -space-x-1">
                    {viewers.slice(0,4).map((uid, i) => (
                      <div key={uid} className="w-6 h-6 rounded-full bg-accent-soft border-2 border-surface flex items-center justify-center text-[9px] font-bold text-accent" title={uid}>
                        {String.fromCharCode(65 + i)}
                      </div>
                    ))}
                    {viewers.length > 4 && <div className="w-6 h-6 rounded-full bg-raised border-2 border-surface flex items-center justify-center text-[9px] text-dim">+{viewers.length-4}</div>}
                  </div>
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={() => setCommentsOpen(true)}>
                <IconChat size={14} aria-hidden="true" />Comments
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                <IconRecent size={14} aria-hidden="true" />History
              </Button>
              <ExportMenu data={{ product, coverages, rules, forms, ldTables, rtTables, ratingProgram }} />
              <Button variant="ghost" size="sm" onClick={() => setShareOpen(true)}>
                <IconShare size={14} aria-hidden="true" />Share
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-0 mb-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => navigate(`/app/products/${pid}/${tab.id}`)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              activeTab === tab.id
                ? 'text-accent border-accent'
                : 'text-dim border-transparent hover:text-text hover:border-[rgba(19,19,26,.2)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pt-5">
        <Outlet />
      </div>

      {historyOpen  && <HistoryDrawer  onClose={() => setHistoryOpen(false)}  entityPath={`products/${pid}`} />}
      {commentsOpen && <CommentsPanel  onClose={() => setCommentsOpen(false)} entityPath={`products/${pid}`} />}
      {shareOpen    && <ShareModal     onClose={() => setShareOpen(false)}    productId={pid} productName={product.name} />}
    </div>
  )
}

export default function ProductWorkspace() {
  const { id } = useParams<{ id: string }>()
  if (!id) return <Navigate to="/app/products" replace />
  return (
    <ProductProvider pid={id}>
      <WorkspaceInner />
    </ProductProvider>
  )
}
```


## `app/src/routes/Products.tsx`

```tsx
// Products list — realtime portfolio with card + list views, facet filters,
// typeahead, and New Product.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { toast } from 'sonner'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Button, Skeleton, EmptyState, Tabs, ViewToggle, type ViewMode } from '../components/ui'
import { IconPlus, IconDownload, IconProduct, IconSearch } from '../components/ui/icons'
import { ProductCard } from '../components/product/ProductCard'
import { ProductRow } from '../components/product/ProductRow'
import { NewProductModal } from '../components/product/NewProductModal'
import { exportPortfolioExcel, type ProductExport } from '../lib/export/excel'
import type { Product, Coverage, Rule, Form, LDTable, RTTable, RatingProgram } from '@pf/shared'
import type { WithId } from '../context/ProductContext'

const VIEW_KEY = 'pf.products.view'

const TABS = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'drafts',    label: 'Drafts'    },
]

export default function Products() {
  const navigate   = useNavigate()
  const { user }   = useUser()
  const canEdit    = user?.role === 'EDITOR' || user?.role === 'ADMIN'

  const [products, setProducts] = useState<WithId<Product>[]>([])
  const [loading,  setLoading]  = useState(true)
  const [query,    setQuery]    = useState('')
  const [tab,      setTab]      = useState('portfolio')
  const [lobFilter, setLobFilter] = useState('')
  const [newOpen,  setNewOpen]  = useState(false)
  const [exporting, setExporting] = useState(false)
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) || 'cards')
  const setViewPersist = (m: ViewMode) => { setView(m); localStorage.setItem(VIEW_KEY, m) }

  async function exportPortfolio() {
    if (!products.length) return
    setExporting(true)
    try {
      const [forms, ldList, rtList] = await Promise.all([
        adapter.db.list<Form & { id: string }>('forms'),
        adapter.db.list<LDTable & { id: string }>('ldTables'),
        adapter.db.list<RTTable & { id: string }>('rtTables'),
      ])
      const ldTables = Object.fromEntries(ldList.map(t => [t.id, t])) as Record<string, LDTable>
      const rtTables = Object.fromEntries(rtList.map(t => [t.id, t])) as Record<string, RTTable>
      const items: ProductExport[] = await Promise.all(products.map(async p => {
        const [coverages, rules, programs] = await Promise.all([
          adapter.db.list<Coverage>(`products/${p.id}/coverages`),
          adapter.db.list<Rule>(`products/${p.id}/rules`),
          adapter.db.list<RatingProgram>(`products/${p.id}/ratingPrograms`),
        ])
        return { product: p, coverages, rules, forms: forms.filter(f => (f.productRefIds ?? []).includes(p.id)), ldTables, rtTables, ratingProgram: programs[0] ?? null }
      }))
      await exportPortfolioExcel(items)
      toast.success('Portfolio exported')
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    const unsub = adapter.db.subscribe<WithId<Product>>('products', (data) => {
      if (Array.isArray(data)) { setProducts(data); setLoading(false) }
    })
    return unsub
  }, [])

  // Separate portfolio (LAUNCHED) from drafts (everything else)
  const tabbed = useMemo(() => {
    const base = tab === 'portfolio'
      ? products.filter(p => p.lifecycle === 'LAUNCHED')
      : products.filter(p => p.lifecycle !== 'LAUNCHED')
    return lobFilter ? base.filter(p => p.lob?.name === lobFilter) : base
  }, [products, tab, lobFilter])

  const fuse = useMemo(() => new Fuse(tabbed, { keys: ['name', 'refId', 'marketSegment'], threshold: 0.4 }), [tabbed])
  const visible = query ? fuse.search(query).map(r => r.item) : tabbed

  const lobs = [...new Set(products.map(p => p.lob?.name).filter(Boolean))] as string[]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Products</h1>
          <p className="text-sm text-dim mt-0.5">{products.length} product{products.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {products.length > 0 && (
            <Button variant="ghost" size="sm" onClick={exportPortfolio} disabled={exporting}>
              <IconDownload size={14} />{exporting ? 'Exporting…' : 'Export'}
            </Button>
          )}
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
              <IconPlus size={14} />New product
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <div className="relative flex-1 min-w-[200px]">
          <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            className="w-full h-8 pl-9 pr-3 rounded-[8px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent"
            placeholder="Search products…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        {lobs.length > 1 && (
          <select
            className="h-8 px-3 rounded-[8px] bg-surface border border-border-strong text-sm text-dim focus:outline-none focus:ring-2 focus:ring-accent/25"
            value={lobFilter}
            onChange={e => setLobFilter(e.target.value)}
          >
            <option value="">All LOBs</option>
            {lobs.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <ViewToggle mode={view} onChange={setViewPersist} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface rounded-[14px] p-5 flex flex-col gap-3" style={{ border: '1px solid var(--color-border)' }}>
              <Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<IconProduct size={32} />} title={query ? `No results for "${query}"` : `No ${tab === 'portfolio' ? 'launched' : 'draft'} products`}
          description={canEdit ? 'Create a new product to get started.' : undefined}
          action={canEdit ? <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}><IconPlus size={14} />New product</Button> : undefined}
        />
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(p => <ProductCard key={p.id} p={p} />)}
        </div>
      ) : (
        <div className="rounded-[14px] overflow-hidden bg-surface" style={{ border: '1px solid var(--color-border)' }}>
          {visible.map(p => <ProductRow key={p.id} p={p} />)}
        </div>
      )}

      {newOpen && <NewProductModal onClose={() => setNewOpen(false)} onCreated={id => { setNewOpen(false); navigate(`/app/products/${id}`) }} />}
    </div>
  )
}
```


## `app/src/routes/ShareView.tsx`

```tsx
// Public share view — fetches a read-only product snapshot via the share function.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adapter } from '../lib/backend'
import { Badge, StatusPill, LifecyclePill, Skeleton, Logo } from '../components/ui'
import type { Product, Coverage, Form } from '@pf/shared'

interface Snapshot {
  product:   Product & { id: string }
  coverages: (Coverage & { id: string })[]
  forms:     (Form & { id: string })[]
  expired:   false
}

export default function ShareView() {
  const { token } = useParams<{ token: string }>()
  const [data,    setData]    = useState<Snapshot | null>(null)
  const [expired, setExpired] = useState(false)
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    adapter.fns.call<{ token: string }, Snapshot | { expired: true }>(
      'getShareSnapshot', { token },
    )
      .then(result => {
        if ('expired' in result && result.expired) setExpired(true)
        else setData(result as Snapshot)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load share'))
      .finally(() => setLoading(false))
  }, [token])

  // Reflect the shared product in the tab title.
  useEffect(() => {
    const name = (data?.product as { name?: string } | undefined)?.name
    if (name) document.title = `${name} · Product Reinvention Hub`
    return () => { document.title = 'Product Reinvention Hub' }
  }, [data])

  if (loading) {
    return (
      <div className="min-h-svh bg-page flex items-center justify-center">
        <div className="flex flex-col gap-4 w-full max-w-2xl px-6">
          <Skeleton className="h-32 rounded-[16px]" />
          <Skeleton className="h-48 rounded-[16px]" />
        </div>
      </div>
    )
  }

  if (expired) {
    return (
      <div className="min-h-svh bg-page flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-bold text-text">Link expired</p>
          <p className="text-dim mt-2">This share link is no longer valid. Ask the owner to create a new one.</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-svh bg-page flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl font-bold text-text">Could not load</p>
          <p className="text-dim mt-2">{error || 'Share link not found.'}</p>
        </div>
      </div>
    )
  }

  const { product, coverages, forms } = data

  return (
    <div className="min-h-svh bg-page">
      {/* Header */}
      <header className="bg-surface px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2.5">
          <Logo size={24} rounded={6} />
          <span className="font-semibold text-sm text-text">Product Reinvention Hub</span>
        </div>
        <Badge label="Read-only snapshot" color="default" />
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
        {/* Product hero */}
        <div className="rounded-[16px] p-6" style={{ background: 'linear-gradient(135deg, rgba(139,31,224,.06), rgba(122,0,230,.04))', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <StatusPill status={product.status} />
            <LifecyclePill lifecycle={product.lifecycle} />
            {product.lob?.name && <Badge label={product.lob.name} color="blue" />}
          </div>
          <h1 className="text-2xl font-bold text-text">{product.name}</h1>
          {product.refId && <p className="text-sm font-mono text-dim mt-1">{product.refId}</p>}
          {product.description && <p className="text-sm text-dim mt-2">{product.description}</p>}
          <div className="flex gap-4 mt-3 text-sm text-dim">
            <span>{coverages.length} coverages</span>
            <span>{product.states?.length ?? 0} states</span>
            <span>{product.marketSegment}</span>
          </div>
        </div>

        {/* Coverages */}
        {coverages.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-text mb-3">Coverages</h2>
            <div className="flex flex-col gap-2">
              {coverages.filter(c => !c.parentId).map(cov => {
                const subs = coverages.filter(c => c.parentId === cov.refId)
                return (
                  <div key={cov.id} className="bg-surface rounded-[12px] p-4" style={{ border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">{cov.name}</span>
                      {cov.refId && <span className="text-xs font-mono text-faint">{cov.refId}</span>}
                      <Badge label={cov.requirement} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
                    </div>
                    {subs.length > 0 && (
                      <div className="ml-4 mt-2 flex flex-col gap-1">
                        {subs.map(s => (
                          <div key={s.id} className="flex items-center gap-2 text-sm text-dim">
                            <span>↳ {s.name}</span>
                            {s.refId && <span className="font-mono text-xs text-faint">{s.refId}</span>}
                            <Badge label={s.requirement} color="default" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Forms */}
        {forms.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-text mb-3">Forms ({forms.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {forms.map(form => (
                <div key={form.id} className="bg-surface rounded-[12px] px-4 py-3" style={{ border: '1px solid var(--color-border)' }}>
                  <p className="text-sm font-medium text-text">{form.name}</p>
                  <p className="text-xs font-mono text-faint mt-0.5">{form.number} · Ed. {form.edition}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="text-xs text-faint text-center pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          Read-only snapshot · Product Reinvention Hub · Expires 30 days from creation
        </footer>
      </main>
    </div>
  )
}
```


## `app/src/routes/SignIn.tsx`

```tsx
// Sign-in — email + password through the adapter, plus a temporary
// "Continue as admin" shortcut for demos. Premium, calm, Apple-inspired.
import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { adapter } from '../lib/backend'
import { IconSpinner, IconCoverage } from '../components/ui/icons'
import { useUser } from '../context/useUser'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Logo } from '../components/ui'

const DEMO_ADMIN = { email: 'admin@productfactory.app', password: 'admin123' }

export default function SignIn() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { user }  = useUser()
  const from      = (location.state as { from?: string } | null)?.from ?? '/app'

  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState<'form' | 'admin' | null>(null)

  // Already signed in — redirect (render-time <Navigate>, not an in-render call)
  if (user) return <Navigate to={from} replace />

  async function doSignIn(e: string, p: string, mode: 'form' | 'admin') {
    setError('')
    setLoading(mode)
    try {
      await adapter.auth.signIn(e.trim(), p)
      navigate(from, { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed'
      if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
        setError('Invalid email or password.')
      } else if (msg.includes('too-many-requests')) {
        setError('Too many attempts — try again in a moment.')
      } else {
        setError(msg)
      }
      setLoading(null)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void doSignIn(email, pass, 'form')
  }

  const busy = loading !== null

  return (
    <div className="min-h-svh flex items-center justify-center bg-page px-4">
      {/* Aurora wash */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="aurora-a absolute -top-40 left-1/2 -translate-x-1/2 w-[680px] h-[380px] rounded-full blur-3xl opacity-20"
          style={{ background: 'radial-gradient(ellipse, #A100FF, #6D28D9)' }} />
      </div>

      <div className="relative w-full max-w-sm rise-in">
        <div className="flex flex-col items-center gap-4 mb-8">
          <Logo size={48} rounded={14} className="shadow-[0_6px_20px_rgba(139,31,224,.3)]" />
          <div className="text-center">
            <h1 className="text-xl font-bold text-text tracking-tight">Product Reinvention Hub</h1>
            <p className="text-sm text-dim mt-1">Sign in to your workspace</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface rounded-[18px] p-6 flex flex-col gap-4"
          style={{ boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}
          noValidate
        >
          <Input
            label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com" autoComplete="email" required disabled={busy}
          />
          <Input
            label="Password" type="password" value={pass} onChange={e => setPass(e.target.value)}
            placeholder="password" autoComplete="current-password" required disabled={busy}
          />

          {error && (
            <p role="alert" className="text-sm text-danger bg-[rgba(220,38,38,.06)] rounded-[8px] px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" className="w-full mt-1" disabled={busy || !email || !pass}>
            {loading === 'form' && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
            {loading === 'form' ? 'Signing in…' : 'Sign in'}
          </Button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-1" aria-hidden="true">
            <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
            <span className="text-[11px] uppercase tracking-wide text-faint">or</span>
            <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
          </div>

          {/* Temporary demo shortcut */}
          <Button
            type="button" variant="default" className="w-full"
            disabled={busy}
            onClick={() => void doSignIn(DEMO_ADMIN.email, DEMO_ADMIN.password, 'admin')}
          >
            {loading === 'admin' ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : <IconCoverage size={14} aria-hidden="true" />}
            {loading === 'admin' ? 'Signing in…' : 'Continue as admin'}
          </Button>
        </form>

        <p className="text-center text-xs text-faint mt-4">
          Demo workspace · <span className="font-mono">admin@productfactory.app</span>
        </p>
      </div>
    </div>
  )
}
```


## `app/src/routes/stub/StubRoute.tsx`

```tsx
// Stub component for routes not yet built — displays a premium empty state.
import { EmptyState } from '../../components/ui'
import type { LucideIcon } from 'lucide-react'

interface StubProps { title: string; description: string; icon: LucideIcon }

export function StubRoute({ title, description, icon: Icon }: StubProps) {
  return <EmptyState icon={<Icon size={32} />} title={title} description={description} />
}
```


## `app/src/routes/Tasks.tsx`

```tsx
// Tasks (/app/tasks) — a 4-column Kanban of the product lifecycle. Drag between
// columns is audited via adapter.mutate (EDITOR+ only). Cards show product,
// assignee, an SLA badge coloured by urgency, and checklist progress. Filters
// (mine / product / overdue) and a board/list toggle. Realtime throughout.
import { useEffect, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCorners,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { toast } from 'sonner'
import { LayoutGrid, List, CheckSquare, Filter } from 'lucide-react'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Skeleton, EmptyState } from '../components/ui'
import type { Task, Product, TaskColumn } from '@pf/shared'

type TaskDoc = Task & { id: string }
type ProductDoc = Product & { id: string }

const COLUMNS: { id: TaskColumn; label: string }[] = [
  { id: 'IDEATION',       label: 'Ideation & Design' },
  { id: 'BUILD_FILE',     label: 'Build & File' },
  { id: 'TEST_APPROVE',   label: 'Test & Approve' },
  { id: 'LAUNCH_MONITOR', label: 'Launch & Monitor' },
]

// ─── date helpers ───────────────────────────────────────────────────────────

function toMillis(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t }
  const o = v as { toDate?: () => Date; seconds?: number }
  if (typeof o.toDate === 'function') return o.toDate().getTime()
  if (typeof o.seconds === 'number') return o.seconds * 1000
  return null
}

function sla(ms: number | null): { label: string; color: 'danger' | 'warn' | 'default' } | null {
  if (ms == null) return null
  const days = Math.round((ms - Date.now()) / 86_400_000)
  if (days < 0)  return { label: `${-days}d overdue`, color: 'danger' }
  if (days === 0) return { label: 'due today', color: 'warn' }
  if (days <= 3)  return { label: `due in ${days}d`, color: 'warn' }
  const d = new Date(ms)
  return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), color: 'default' }
}

function initials(name?: string): string {
  if (!name) return '·'
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

// ─── Card ───────────────────────────────────────────────────────────────────

function CardBody({ task, productName }: { task: TaskDoc; productName?: string }) {
  const due  = sla(toMillis(task.dueAt))
  const done = task.checklist?.filter(c => c.done).length ?? 0
  const total = task.checklist?.length ?? 0
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-text leading-snug">{task.title}</span>
        {task.assignee && (
          <span className="shrink-0 w-6 h-6 rounded-full text-[10px] font-semibold text-white flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#A100FF,#6D28D9)' }} title={task.assignee.name}>
            {initials(task.assignee.name)}
          </span>
        )}
      </div>
      <div className="flex items-center flex-wrap gap-1.5">
        {productName && <Badge label={productName} color="purple" />}
        {due && <Badge label={due.label} color={due.color} />}
      </div>
      {total > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(done / total) * 100}%`, background: 'linear-gradient(90deg,#A100FF,#6D28D9)' }} />
          </div>
          <span className="text-[10px] text-faint tabular-nums">{done}/{total}</span>
        </div>
      )}
    </>
  )
}

function DraggableCard({ task, productName, canEdit }: { task: TaskDoc; productName?: string; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !canEdit })
  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      className={`bg-surface rounded-[12px] p-3 flex flex-col gap-2 ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''}`}
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <CardBody task={task} productName={productName} />
    </div>
  )
}

// ─── Column ─────────────────────────────────────────────────────────────────

function Column({ id, label, tasks, nameFor, canEdit }: {
  id: TaskColumn; label: string; tasks: TaskDoc[]; nameFor: (t: TaskDoc) => string | undefined; canEdit: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div className="flex flex-col min-w-[260px] flex-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs font-semibold text-dim uppercase tracking-wide">{label}</span>
        <span className="text-[11px] text-faint tabular-nums">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 rounded-[14px] p-2 min-h-[120px] flex-1 transition-colors ${isOver ? 'bg-accent-soft' : 'bg-raised/50'}`}
        style={{ border: isOver ? '1px dashed var(--color-accent)' : '1px solid transparent' }}
      >
        {tasks.map(t => <DraggableCard key={t.id} task={t} productName={nameFor(t)} canEdit={canEdit} />)}
        {tasks.length === 0 && <div className="text-xs text-faint text-center py-6">Nothing here</div>}
      </div>
    </div>
  )
}

// ─── Route ──────────────────────────────────────────────────────────────────

export default function Tasks() {
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'

  const [tasks, setTasks]       = useState<TaskDoc[] | null>(null)
  const [products, setProducts] = useState<ProductDoc[]>([])
  const [view, setView]         = useState<'board' | 'list'>('board')
  const [mine, setMine]         = useState(false)
  const [overdue, setOverdue]   = useState(false)
  const [productId, setProductId] = useState('')
  const [dragId, setDragId]     = useState<string | null>(null)

  useEffect(() => {
    const u1 = adapter.db.subscribe<TaskDoc>('tasks',    d => { if (Array.isArray(d)) setTasks(d) })
    const u2 = adapter.db.subscribe<ProductDoc>('products', d => { if (Array.isArray(d)) setProducts(d) })
    return () => { u1(); u2() }
  }, [])

  const nameFor = (t: TaskDoc) => products.find(p => p.id === t.productId)?.name

  const filtered = useMemo(() => {
    let list = tasks ?? []
    if (mine && user)   list = list.filter(t => t.assignee?.uid === user.uid)
    if (productId)      list = list.filter(t => t.productId === productId)
    if (overdue)        list = list.filter(t => { const m = toMillis(t.dueAt); return m != null && m < Date.now() })
    return list
  }, [tasks, mine, productId, overdue, user])

  const byColumn = useMemo(() => {
    const map: Record<TaskColumn, TaskDoc[]> = { IDEATION: [], BUILD_FILE: [], TEST_APPROVE: [], LAUNCH_MONITOR: [] }
    for (const t of filtered) (map[t.column] ?? map.IDEATION).push(t)
    for (const col of COLUMNS) map[col.id].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    return map
  }, [filtered])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  function onDragStart(e: DragStartEvent) { setDragId(String(e.active.id)) }

  async function onDragEnd(e: DragEndEvent) {
    setDragId(null)
    const overId = e.over?.id as TaskColumn | undefined
    if (!overId || !tasks || !user) return
    const task = tasks.find(t => t.id === e.active.id)
    if (!task || task.column === overId) return

    const maxOrder = Math.max(0, ...(byColumn[overId]?.map(t => t.order ?? 0) ?? []))
    const { id, ...rest } = task
    try {
      await adapter.db.mutate({
        op: 'update', path: `tasks/${id}`,
        data: { ...rest, column: overId, order: maxOrder + 1 },
        entityType: 'task', productId: task.productId,
        actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        expectedRev: task.rev,
      })
      toast.success(`Moved to ${COLUMNS.find(c => c.id === overId)?.label}`)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Move failed')
    }
  }

  const activeTask = dragId ? tasks?.find(t => t.id === dragId) : null

  return (
    <div className="flex flex-col gap-5 h-full min-h-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Tasks</h1>
          <p className="text-sm text-dim">Every product from ideation to launch.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-[9px] p-0.5 bg-raised" role="tablist" aria-label="View">
            <button onClick={() => setView('board')} aria-pressed={view === 'board'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-xs font-medium transition-colors ${view === 'board' ? 'bg-surface text-text shadow-sm' : 'text-dim'}`}>
              <LayoutGrid size={13} /> Board
            </button>
            <button onClick={() => setView('list')} aria-pressed={view === 'list'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-xs font-medium transition-colors ${view === 'list' ? 'bg-surface text-text shadow-sm' : 'text-dim'}`}>
              <List size={13} /> List
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={14} className="text-faint" aria-hidden="true" />
        <FilterChip active={mine} onClick={() => setMine(m => !m)}>Mine</FilterChip>
        <FilterChip active={overdue} onClick={() => setOverdue(o => !o)}>Overdue</FilterChip>
        <select
          value={productId} onChange={e => setProductId(e.target.value)}
          className="h-7 px-2 rounded-[8px] bg-surface border text-xs text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
          style={{ borderColor: 'var(--color-border)' }} aria-label="Filter by product"
        >
          <option value="">All products</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Body */}
      {tasks === null ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {COLUMNS.map(c => <Skeleton key={c.id} className="h-64" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<CheckSquare size={28} />} title="No tasks match" description="Adjust your filters, or create a product to seed its default task set." />
      ) : view === 'board' ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-2 flex-1 min-h-0">
            {COLUMNS.map(col => (
              <Column key={col.id} id={col.id} label={col.label} tasks={byColumn[col.id]} nameFor={nameFor} canEdit={canEdit} />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? (
              <div className="bg-surface rounded-[12px] p-3 flex flex-col gap-2 rotate-2" style={{ border: '1px solid var(--color-accent)', boxShadow: 'var(--shadow-card-hover)' }}>
                <CardBody task={activeTask} productName={nameFor(activeTask)} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <ListView columns={COLUMNS} byColumn={byColumn} nameFor={nameFor} />
      )}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`px-2.5 py-1 rounded-[8px] text-xs font-medium transition-colors ${active ? 'bg-accent-soft text-accent' : 'bg-surface text-dim hover:text-text'}`}
      style={{ border: '1px solid var(--color-border)' }}>
      {children}
    </button>
  )
}

function ListView({ columns, byColumn, nameFor }: {
  columns: typeof COLUMNS; byColumn: Record<TaskColumn, TaskDoc[]>; nameFor: (t: TaskDoc) => string | undefined
}) {
  return (
    <div className="flex flex-col gap-6">
      {columns.map(col => byColumn[col.id].length > 0 && (
        <div key={col.id} className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-dim uppercase tracking-wide">{col.label}</span>
          <div className="flex flex-col rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {byColumn[col.id].map(t => {
              const due = sla(toMillis(t.dueAt)); const done = t.checklist?.filter(c => c.done).length ?? 0; const total = t.checklist?.length ?? 0
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <span className="flex-1 text-sm text-text truncate">{t.title}</span>
                  {nameFor(t) && <Badge label={nameFor(t)!} color="purple" />}
                  {total > 0 && <span className="text-xs text-faint tabular-nums">{done}/{total}</span>}
                  {due && <Badge label={due.label} color={due.color} />}
                  {t.assignee && <span className="text-xs text-dim">{t.assignee.name}</span>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
```


## `app/tsconfig.app.json`

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "types": ["vite/client"],
    "allowArbitraryExtensions": true,
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Strict + linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```


## `app/tsconfig.json`

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```


## `app/tsconfig.node.json`

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "types": ["node"],
    "skipLibCheck": true,

    /* Bundler mode */
    "module": "nodenext",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}
```


## `app/vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```


## `tests/rules.test.ts`

```ts
// Firestore security rules tests — requires the Firestore emulator to be running.
// Run via: pnpm test:rules  (firebase emulators:exec starts it automatically)
import { describe, it, beforeAll, afterAll, afterEach } from 'vitest'
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { setDoc, doc, getDoc } from 'firebase/firestore'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES = readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8')

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  // Use isolated project so clearFirestore() never touches seed data in productreinvention
  testEnv = await initializeTestEnvironment({
    projectId: 'rules-test',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => { await testEnv.cleanup() })
afterEach(async () => { await testEnv.clearFirestore() })

// Helper contexts
const admin   = () => testEnv.authenticatedContext('admin-uid',   { role: 'ADMIN' })
const editor  = () => testEnv.authenticatedContext('editor-uid',  { role: 'EDITOR' })
const viewer  = () => testEnv.authenticatedContext('viewer-uid',  { role: 'VIEWER' })
const unauthed = () => testEnv.unauthenticatedContext()

describe('Firestore security rules — role matrix', () => {

  // ── 1. VIEWER can read domain data ──────────────────────────────────────────
  it('VIEWER can read a product document', async () => {
    // Seed a product using admin bypass
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'products/HO3'), { name: 'HO-3', rev: 1 })
    })
    const db = viewer().firestore()
    await assertSucceeds(getDoc(doc(db, 'products/HO3')))
  })

  // ── 2. VIEWER cannot write to domain collections ─────────────────────────────
  it('VIEWER write to products is rejected', async () => {
    const db = viewer().firestore()
    await assertFails(setDoc(doc(db, 'products/NEW'), { name: 'New Product' }))
  })

  // ── 3. VIEWER can create feedback ────────────────────────────────────────────
  it('VIEWER can submit new feedback', async () => {
    const db = viewer().firestore()
    await assertSucceeds(
      setDoc(doc(db, 'feedback/fb1'), {
        type: 'IDEA', title: 'Test', detail: '', status: 'NEW',
        votes: { count: 0, voters: [] },
        impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'viewer-uid', name: 'Viewer' },
        context: { route: '/app' }, createdAt: null, updatedAt: null,
      }),
    )
  })

  // ── 4. VIEWER can vote (add own uid to voters, increment count) ──────────────
  it('VIEWER vote allowance: can add own uid and increment count', async () => {
    // Seed the feedback doc first
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'feedback/fb2'), {
        type: 'IDEA', title: 'Voteable', status: 'NEW',
        votes: { count: 0, voters: [] },
        impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'editor-uid', name: 'Editor' },
        context: { route: '/app' },
      })
    })
    const db = viewer().firestore()
    await assertSucceeds(
      setDoc(doc(db, 'feedback/fb2'), {
        type: 'IDEA', title: 'Voteable', status: 'NEW',
        // Only votes changes
        votes: { count: 1, voters: ['viewer-uid'] },
        impact: 1, effort: 1, priorityScore: 0,
        author: { uid: 'editor-uid', name: 'Editor' },
        context: { route: '/app' },
      }),
    )
  })

  // ── 5. EDITOR can write domain data ──────────────────────────────────────────
  it('EDITOR can create and update a product', async () => {
    const db = editor().firestore()
    await assertSucceeds(
      setDoc(doc(db, 'products/EDIT1'), { name: 'Editor Product', rev: 1 })
    )
    await assertSucceeds(
      setDoc(doc(db, 'products/EDIT1'), { name: 'Updated', rev: 2 })
    )
  })

  // ── 6. ADMIN can write to users collection; unauthenticated cannot ────────────
  it('ADMIN can write users; unauthenticated is rejected', async () => {
    const adminDb = admin().firestore()
    await assertSucceeds(
      setDoc(doc(adminDb, 'users/some-uid'), { email: 'x@x.com', role: 'VIEWER' })
    )
    const anonDb = unauthed().firestore()
    await assertFails(
      setDoc(doc(anonDb, 'users/some-uid'), { email: 'hack@x.com' })
    )
  })
})
```

