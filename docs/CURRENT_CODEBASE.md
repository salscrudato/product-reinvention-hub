# CURRENT_CODEBASE.md
> AI-optimized reference for the Product Reinvention Hub monorepo.
> Generated 2026-07-06. Ground truth: code, not prior docs.

---

## 1. Overview

**Product Reinvention Hub** (internal alias: *Product Factory*) is an AI-native web application for P&C insurance product managers. It provides a structured workspace for designing, governing, and pricing multi-line insurance products: defining coverages, limits/deductibles, policy forms, business rules, and rating programs. Two fully seeded reference lines ship out-of-the-box—an ISO-style Homeowners HO-3 Special Form and a Monoline General Liability (CGL)—proving the platform is line-agnostic. An Anthropic-powered portfolio chat, a grounded claims coverage copilot, a market news scout, and a kanban task board round out the feature set. The app is deployed to Firebase Hosting (`productreinvention.web.app`) and developed locally against the Firebase Emulator Suite.

---

## 2. Monorepo Layout

```
product-reinvention-hub/         pnpm workspace root
├── app/                         React 19 + Vite SPA (the product-management UI)
├── functions/                   Firebase Functions v2 (AI, sharing, admin, news)
├── shared/                      Pure-TS library: types, rating engine, seed data, LOB registry
├── scripts/                     Seed CLI (seed.ts) + wait-and-seed.mjs
├── tests/                       Firestore security-rules tests (Vitest + @firebase/rules-unit-testing)
├── docs/                        Domain docs (DATA_MODEL.md, DOMAIN_HO.md — others deleted from disk)
├── tooling/                     Dev tooling (capture-screens.mjs)
├── firestore.rules              Role-gated Firestore security rules
├── firestore.indexes.json       Composite indexes
├── firebase.json                Hosting, Functions, emulator port config
└── pnpm-workspace.yaml          Workspace: app, functions, shared
```

| Directory | Purpose |
|-----------|---------|
| `app/` | All UI code: React components, routes, adapter wiring, CSS design-system |
| `functions/` | Cloud Functions v2: AI endpoints (chat/extract/claims), sharing, admin RBAC, news |
| `shared/` | Zero-platform pure TS: `types.ts`, rating evaluator, rules engine, LOB registry, seed constants, search ranking |
| `scripts/` | `seed.ts` wipes + re-seeds both reference products into Firestore; verifies the $1,528 canary |
| `tests/` | `rules.test.ts` drives the Firestore emulator to verify the security-rule matrix |

---

## 3. Stack and Key Dependencies

### App (`app/`)
| Package | Version | Role |
|---------|---------|------|
| `react` | 19.2.7 | UI framework |
| `react-dom` | 19.2.7 | DOM renderer |
| `react-router-dom` | 7.6.3 | Client-side routing |
| `tailwindcss` | 4.1.11 | Utility CSS (Vite plugin) |
| `vite` | 8.1.1 | Dev server + bundler |
| `typescript` | ~6.0.2 | App-workspace TS (stricter than root) |
| `firebase` | 11.9.0 | Client SDK (auth, Firestore, storage, functions) |
| `@pf/shared` | workspace:* | Shared types + engine |
| `@dnd-kit/core` | 6.3.1 | Drag-and-drop (tasks board) |
| `@dnd-kit/sortable` | 10.0.0 | Sortable list extension |
| `exceljs` | 4.4.0 | Excel export for product data |
| `fuse.js` | 7.1.0 | Client-side fuzzy search fallback |
| `sonner` | 2.0.5 | Toast notifications |
| `oxlint` | 1.71.0 | Fast Rust-based linter |

### Functions (`functions/`)
| Package | Version | Role |
|---------|---------|------|
| `firebase-functions` | 6.6.0 | Functions v2 framework |
| `firebase-admin` | 13.4.0 | Admin SDK (Firestore, Auth) |
| `@anthropic-ai/sdk` | 0.54.0 | Anthropic API client |
| `tsup` | 8.5.0 | Functions bundler (esm → cjs for Node 20) |
| `typescript` | 5.7.3 | Functions TS |

### Shared (`shared/`)
| Package | Version | Role |
|---------|---------|------|
| `typescript` | 5.7.3 | Shared TS (no platform imports) |
| `vitest` | 3.1.4 | Unit tests for rating/rules/types |

### Root
| Package | Version | Role |
|---------|---------|------|
| `firebase` | 11.10.0 | CLI + rules-unit-testing |
| `@firebase/rules-unit-testing` | 5.0.1 | Firestore rules tests |
| `tsx` | 4.19.2 | Run seed.ts without pre-building |
| `vitest` | 3.1.4 | Root test runner |
| `concurrently` | 9.1.2 | `pnpm spinup` parallel launch |
| `@playwright/test` | 1.61.1 | Screenshot capture (tooling) |

---

## 4. Architecture and Guardrails

### a. Adapter Seam — **PASS**

> Rule: no `firebase/*` imports outside `app/src/lib/backend/` and `functions/`.

Grepping `app/src` for `from 'firebase` produces hits **only** in:
- `app/src/lib/backend/firebase.adapter.ts` (the implementation)
- `app/src/lib/backend/firebase.config.ts` (Firebase app config)

All components and routes import from `app/src/lib/backend/index.ts` (re-exports the adapter), never directly from `firebase/*`. The `UserContext.tsx` comment at line 3 explicitly enforces this: *"Never import firebase/* here — everything goes through the adapter seam."*

The adapter defines a `BackendAdapter` interface (`app/src/lib/backend/types.ts`); a comment in `firebase.adapter.ts` marks `// AWS-SWAP:` at every swap point.

### b. `mutate()` Invariant — **PASS**

`firebase.adapter.ts:192–271` implements one atomic `WriteBatch`:

```
1. Rev check (reads current doc; throws MutationConflictError if rev mismatch)
2. Entity write (create → set with rev=1 + timestamps; update → rev++ + timestamps; delete → batch.delete)
3. auditEvents write (append-only: actor, action, entityType, entityPath, productId, at)
4. versions write (snapshot + field-level diff array: [{field, before, after}])
5. searchIndex upsert/delete (for INDEXABLE entity types)
6. batch.commit()
```

The invariant holds: every mutation is one atomic batch. `MutationConflictError` is thrown (not swallowed) on rev mismatch, surfaced to the caller as a friendly conflict toast.

**One drift**: `DATA_MODEL.md` mentions "parentId enforced in mutate()" for sub-coverage creation, but the adapter does NOT validate `parentId` existence before the batch — it relies on the caller to pass a valid parent. This is a documentation overstatement; the validation is UI-side only.

### c. Roles via Firebase Custom Claims — **PASS**

Three-tier RBAC: `VIEWER | EDITOR | ADMIN`.

- **Set by**: `functions/src/admin.ts` — `setUserRole` callable (ADMIN-only). Creates users, calls `auth.setCustomUserClaims(uid, { role })`, mirrors to `users/{uid}`.
- **Enforced in Firestore rules** (`firestore.rules`): `role() { return request.auth.token.get('role', '') }`. VIEWER can read + create feedback/comments; EDITOR/ADMIN write domain data; ADMIN writes users.
- **Enforced in Functions** (`functions/src/runtime.ts:48–58`): `authenticate()` verifies the Bearer ID token via Admin SDK and extracts `decoded['role']`. `claims.ts:extractCoverages` and `claims.ts:identifyBaseForm` gate on `role !== 'EDITOR' && role !== 'ADMIN'`.
- **UI enforcement**: Role-gated via `useUser().profile.role` checks in components; `Admin.tsx:33` shows `EmptyState` for non-ADMIN; write buttons are hidden for VIEWER. UI gating is **supplementary** — Firestore rules are the authoritative guard.
- **Anonymous users**: Auto-signed-in via `signInAnonymously()` (adapter `onUser`); they get a real Firebase ID token with no role claim (`role: null`). They can read all domain data but cannot write.
- **Dev bypass**: `adapter.auth.signInAsDevAdmin()` creates a fake ADMIN session with no backend — every db call returns empty. Shown on sign-in only when `import.meta.env.DEV && VITE_USE_EMULATORS !== 'false'`. **TEMPORARY — must be removed before production.**

### d. Grounded AI (Server-Side Only) — **PASS**

- All Anthropic API calls live in `functions/src/` only. The browser never calls Anthropic directly.
- `functions/src/tools.ts` defines `SYSTEM_PROMPT` with explicit house rules: *"Assert ONLY what the tools return. Never invent coverages, forms, rules, limits, factors or premiums. Cite every specific claim with its refId or form number in square brackets."*
- The `emit_determination` tool in `claims.ts` requires the model to ground its verdict in the uploaded form and tool results; its description says *"Ground every field in the uploaded form's language and the product data — never invent a coverage, limit or exclusion."*
- `extractCoverages` (`extract.ts`) uses `propose_coverages` with *"do not invent coverages"* in the description.
- `identifyBaseForm` reads only what the form *actually shows* and leaves fields blank if not stated.
- The news scout (`news.ts`) uses Claude with `web_search` to find real URLs, not to hallucinate summaries.

### e. Traceability — **PASS**

- Every entity carries a `refId` (human-readable source ID, e.g. `HO.COV.003.002`, `HO.RU.006`, `HO.LD.002`).
- The `SYSTEM_PROMPT` mandates citations: *"Cite every specific claim with its refId or form number in square brackets, e.g. [HO.RU.006] [HO 04 90]. One id per bracket."*
- The `emit_determination` tool schema includes `citations: string[]` and `formNumber: string` as required fields.
- The rating trace (`EvaluatorResult.trace`) carries `sourceRef` (e.g. `HO.RT.003[covA=400000]`) for every step.
- `searchIndex` entries carry `refId` and `path` so the AI's `search_entities` tool always returns traceable paths.

---

## 5. Firestore Data Model

> Field shapes from `shared/src/types.ts`. Data types confirmed against seed constants.
> **GovernanceBlock** = `{ status, lifecycle, reviewStatus, reviewer, createdAt, updatedAt, updatedBy, rev }` (on every domain entity).
> **StateScope** = `{ allStates: boolean, states: string[] }`.

### Top-level collections

| Collection | Key | Shape summary |
|------------|-----|---------------|
| `users/{uid}` | Firebase Auth UID | `email, name, role (mirror), active, mustChangePassword, createdAt` |
| `products/{pid}` | Auto-ID | GovernanceBlock + StateScope + `refId, name, lob{refId,name}, description, marketSegment, owner{uid,name}, health{score,findingCount,updatedAt}, baseForm?{path,url,name,uploadedAt,uploadedBy}` |
| `forms/{formKey}` | Normalized form number (`HO-00-03`) | GovernanceBlock + StateScope + `number, name, edition, category (BASE_COVERAGE\|DECLARATIONS\|ENDORSEMENT\|EXCLUSION\|AMENDATORY\|POLICY_NOTICE), claimsBasis, dynamic, mandatoryDefault, attachmentCondition (RULE\|NONE), source (BUREAU\|PROPRIETARY), admitted, displayOnSchedule, multiUse, transactions[], coverageParts[], productRefIds[], description, dynamicFields[{name,dataType,repeating,options?,notes?}]` |
| `ldTables/{refId}` | refId (e.g. `HO.LD.001`) | `name, defaultValue?, rows[{label,value,constraintNote?}]` |
| `rtTables/{refId}` | refId (e.g. `HO.RT.001`) | `name, columns[], rows[], dimensions?[{key,label?,values[]}], valueColumn?` |
| `auditEvents/{id}` | Auto-ID | `actor{uid,name}, action (create\|update\|delete), entityType, entityPath, productId?, at` — **create-only, never updated** |
| `versions/{id}` | Auto-ID | `entityType, entityPath, productId?, snapshot, diff[{field,before,after}], actor{uid,name}, at` — **create-only** |
| `comments/{id}` | Auto-ID | `entityPath, refId?, body, author{uid,name}, resolved, at` |
| `tasks/{id}` | Auto-ID | GovernanceBlock + `title, column (IDEATION\|BUILD_FILE\|TEST_APPROVE\|LAUNCH_MONITOR), productId?, assignee?, dueAt?, checklist[{t,done}], order` |
| `feedback/{id}` | Auto-ID | `type (IDEA\|ISSUE\|PRAISE), title, detail, context{route,entityPath?,refId?}, votes{count,voters[]}, status (NEW\|REVIEWING\|PLANNED\|SHIPPED\|DECLINED), impact 1–3, effort 1–3, priorityScore, rank?, author{uid,name}, createdAt, updatedAt` |
| `news/{urlHash}` | SHA-1 of URL | `urlHash, url, source, title, summary, tags[], relatedProductIds[], fetchedAt` |
| `newsPrefs/{uid}` | Firebase Auth UID | `instruction (natural language), updatedAt` |
| `dictionary/{id}` | Auto-ID | GovernanceBlock + `name, type (TEXT\|CURRENCY\|DATE\|LIST\|PERCENT), description, allowedValues[], format, tags[], usedIn[{entityPath,label}]` |
| `shareLinks/{token}` | Random hex | `productId, createdBy, expiresAt` — **no client read/write (Admin SDK only)** |
| `searchIndex/{id}` | Path-derived (slashes→underscores) | `type, refId?, title, subtitle, path, keywords[]` |
| `seedReports/{id}` | Auto-ID | `counts, warnings[], workedExamplePremium, workedExamplePremiums?, at` — **Admin SDK write only** |
| `baseForms/{id}` | Auto-ID | Not in DATA_MODEL.md. Used by Claims Analysis: uploaded PDF metadata + base64/text. `allow read: if isAuthed(); allow write: if canEdit()` |
| `presence/{pid}/viewers/{uid}` | Composite path | `uid, at (Timestamp)` — heartbeat docs, 30s interval |

### Products sub-collections

| Sub-collection | Path | Shape |
|----------------|------|-------|
| `coverages/{cid}` | `products/{pid}/coverages/{cid}` | GovernanceBlock + StateScope + `refId, name, parentId (null=top-level; set=sub-coverage), order, requirement (MANDATORY\|OPTIONAL), claimsBasis, premiumGenerating, source, formNumbers[], terms[CoverageTerm]` |
| `rules/{rid}` | `products/{pid}/rules/{rid}` | GovernanceBlock + StateScope + `refId, category (PRODUCT\|RATING\|FORMS), subCategory, condition, outcome, ldTableRef?, coverageRefIds[], formNumbers[]` |
| `formRules/{id}` | `products/{pid}/formRules/{id}` | GovernanceBlock + `refId, condition, outcome, formNumbers[], mandatory` |
| `ratingPrograms/{gid}` | `products/{pid}/ratingPrograms/{gid}` | GovernanceBlock + StateScope + `refId, name, minimumPremium, steps[RatingStep]` |

**`CoverageTerm`** (nested in coverage): `{ id, kind (LIMIT\|DEDUCTIBLE\|OPTION), label, ldTableRef?, options?, min?, max?, default, basis, unit?, notes?, structure?, limitBasis?, optionSet?[StandardOption] }`. The `optionSet` / `structure` / `limitBasis` fields are the typed canonical model; legacy flat `options[]` is preserved for compatibility.

**Field in code but not in DATA_MODEL.md**: `Product.baseForm` — added with the claims feature. `baseForms` collection is missing entirely from DATA_MODEL.md. `RTTable.dimensions` and `RTTable.valueColumn` (grid editor metadata) are not in DATA_MODEL.md.

**Field in DATA_MODEL.md but not in code**: The doc mentions `Timestamp; money in integer cents where computed` — in practice money is stored as plain `number` (dollars), not cents. The `timestamp` note is aspirational; `serverTimestamp()` is used, not a cents convention.

---

## 6. Routing Map

Routes defined in `app/src/App.tsx`. All authenticated routes live under `/app` (guarded by `AppShell.tsx`, which redirects to `/sign-in` when `user` is falsy).

| Path | Component file | What it renders | Role gate | Data sources |
|------|---------------|-----------------|-----------|-------------|
| `/` | `routes/Landing.tsx` | Aurora hero + insight-graph SVG, Sign-in CTA | None (public) | None |
| `/sign-in` | `routes/SignIn.tsx` | Email/password form; dev bypass button (DEV only) | None (public) | None |
| `/must-change-password` | `routes/MustChangePassword.tsx` | Password-change form | Any authed | `adapter.auth.changePassword` |
| `/share/:token` | `routes/ShareView.tsx` | Read-only snapshot (product + coverages + forms) via `getShareSnapshot` callable | None (anonymous) | `fns.call('getShareSnapshot')` |
| `/app` (index) | `routes/Home.tsx` | Portfolio health bar + recent products + activity feed + AI chat widget | Any authed | `db.subscribe('products')`, `db.subscribe('auditEvents')` |
| `/app/products` | `routes/Products.tsx` | Grid of product cards with health score, lifecycle badges, search | Any authed | `db.subscribe('products')`, searchIndex |
| `/app/products/:id` | `routes/product/ProductWorkspace.tsx` | Product hero + tab bar + `<Outlet>` + presence avatars | Any authed | `ProductContext` (onSnapshot on product + sub-collections) |
| `/app/products/:id/overview` | `routes/product/ProductOverview.tsx` | Product metadata, health findings, description editor, coverage tree summary | Any authed / write=EDITOR+ | `ProductContext` |
| `/app/products/:id/coverages` | `routes/product/ProductCoverages.tsx` | Coverage hierarchy (Section I/II), term editors (Limit/Deductible/Option), DnD reorder | Any authed / write=EDITOR+ | `ProductContext`, `CoverageFormsDialog`, `TermOptionsDialog` |
| `/app/products/:id/forms` | `routes/product/ProductForms.tsx` | Forms library with attach/detach, category filter, dynamic fields, attachment rules | Any authed / write=EDITOR+ | `ProductContext`, `db.subscribe('forms')` |
| `/app/products/:id/pricing` | `routes/product/ProductPricing.tsx` | Live rating worksheet (HO bespoke panel or GL data-driven panel), animated trace, SVG flow diagram, RT grid editor | Any authed / write=EDITOR+ | `ProductContext`, shared `evaluate()`, `mutate()` for table edits |
| `/app/products/:id/states` | `routes/product/ProductStates.tsx` | State tile-map (US choropleth), state scope editor, coastal-peril overlay | Any authed / write=EDITOR+ | `ProductContext`, `db.subscribe` on product |
| `/app/products/:id/rules` | `routes/product/ProductRules.tsx` | Product/Rating/Forms rules table, add/edit rule dialog | Any authed / write=EDITOR+ | `ProductContext` |
| `/app/builder` | `routes/stub/StubRoute.tsx` | **STUB** — "AI Builder — coming soon" | Any authed | None |
| `/app/explorer` | `routes/Explorer.tsx` | Full-text search across the portfolio (searchIndex + Fuse.js) | Any authed | `db.subscribe('searchIndex')` |
| `/app/tasks` | `routes/Tasks.tsx` | Kanban board (IDEATION→BUILD_FILE→TEST_APPROVE→LAUNCH_MONITOR), DnD cards | Any authed / write=EDITOR+ | `db.subscribe('tasks')` |
| `/app/news` | `routes/News.tsx` | Market news feed + per-user instruction editor; manual refresh via `refreshNews` callable | Any authed | `db.subscribe('news')`, `db.subscribe('newsPrefs/{uid}')` |
| `/app/claims` | `routes/Claims.tsx` | Two-pane claims copilot: base-forms library (left) + multi-turn chat (right); SSE from `analyzeClaim` | Any authed / upload=EDITOR+ | `db.subscribe('baseForms')`, `fns.stream('analyzeClaim')` |
| `/app/dictionary` | `routes/Dictionary.tsx` | Data dictionary entries (search, filter by type/tag) | Any authed | `db.subscribe('dictionary')` |
| `/app/feedback` | `routes/Feedback.tsx` | Feedback board (IDEA/ISSUE/PRAISE), vote, priority score | Any authed (VIEWER may create+vote) | `db.subscribe('feedback')` |
| `/app/admin` | `routes/Admin.tsx` | Users, Audit Log, Seed Report, Settings tabs (ADMIN EmptyState for others) | ADMIN (UI gate; Firestore enforces) | `db.list('users')`, `db.list('auditEvents')`, `db.list('versions')`, `db.list('seedReports')` |

---

## 7. AI / Functions Layer

All functions defined in `functions/src/`. Index at `functions/src/index.ts`.

### `chat` — Portfolio AI chat

| Attribute | Value |
|-----------|-------|
| Trigger | `onRequest` (HTTP POST, SSE response) |
| Model | `'claude-sonnet-4-6'` (const `MODEL` in `runtime.ts:28`) |
| Auth | Any signed-in user (anonymous included) via `authenticate()` |
| Max tokens | 2048 |
| Max turns | 6 |
| Tools | All 8 grounding tools (`TOOLS` from `tools.ts`) |
| Streaming | SSE: `data: {"t":"token","v":"..."}` / `data: {"t":"tool","name":"...","phase":"start"|"end"}` / `data: {"t":"done"}` |
| Caching | SYSTEM_PROMPT sent with `cache_control: {type:"ephemeral"}` on every request |
| Secret | `ANTHROPIC_API_KEY` via `defineSecret()` |
| File | `functions/src/ai.ts` |

### `extractCoverages` — AI coverage extraction from PDF

| Attribute | Value |
|-----------|-------|
| Trigger | `onRequest` (HTTP POST, SSE response) |
| Model | `'claude-sonnet-4-6'` |
| Auth | EDITOR or ADMIN only |
| Tool | `propose_coverages` (forced `tool_choice`) |
| Output | `data: {"t":"json","key":"proposal","value":{coverages:[...]}}` |
| Timeout | 120s |
| File | `functions/src/extract.ts` |

### `analyzeClaim` — Claims coverage copilot

| Attribute | Value |
|-----------|-------|
| Trigger | `onRequest` (HTTP POST, SSE response) |
| Model | `'claude-sonnet-4-6'` |
| Auth | Any signed-in user |
| Tools | All 8 grounding tools + `emit_determination` |
| Temperature | 0.2 (for determinism; comment: "a Glasswing operator swapping MODEL to the thinking model must drop this") |
| Max tokens | 2600 |
| Max turns | 7 |
| PDF handling | First user turn carries the policy PDF as a `document` block (base64, `cache_control: ephemeral`) |
| Structured output | `emit_determination` tool call → `data: {"t":"json","key":"determination","value":{...}}` |
| File | `functions/src/claims.ts` |

### `identifyBaseForm` — One-shot form metadata read

| Attribute | Value |
|-----------|-------|
| Trigger | `onCall` |
| Model | `'claude-sonnet-4-6'` |
| Auth | EDITOR or ADMIN only |
| Tool | `identify_form` (forced `tool_choice`) |
| Max tokens | 400 |
| File | `functions/src/claims.ts` |

### `setUserRole` — User management

| Attribute | Value |
|-----------|-------|
| Trigger | `onCall` |
| Actions | `create` / `setRole` / `deactivate` / `reactivate` |
| Auth | ADMIN only (checks `req.auth.token.role`) |
| Side effects | `auth.setCustomUserClaims` + `users/{uid}` Firestore mirror |
| File | `functions/src/admin.ts` |

### `refreshNews` / `nightlyNews` — Market news scout

| Attribute | Value |
|-----------|-------|
| Trigger | `onCall` (manual) / `onSchedule` (nightly 06:00 ET) |
| Model | `'claude-haiku-4-5'` (const `MODEL_FAST` in `runtime.ts:29`) |
| Tool | `{type: 'web_search_20250305', name: 'web_search', max_uses: 5}` — **non-standard type, cast via `as unknown`**; Anthropic's built-in web-search beta |
| Dedup | SHA-1 hash of URL; skips existing `news/{urlHash}` docs |
| File | `functions/src/news.ts` |

### `createShareLink` / `getShareSnapshot` / `share`

| Function | Trigger | Purpose |
|----------|---------|---------|
| `createShareLink` | `onCall` | Creates a 30-day share token in `shareLinks/{token}` via Admin SDK |
| `getShareSnapshot` | `onCall` | Returns product + coverages + forms for a valid token |
| `share` | `onRequest` | Renders crawler-friendly OG-card HTML at `/share/:token` for social previews |
| File | `functions/src/share.ts` | |

### `hello` — Health check
Simple `onCall` returning `{message:"Hello from Product Factory!"}`. `functions/src/health.ts`.

### Secret binding
`ANTHROPIC_API_KEY` is defined via `defineSecret('ANTHROPIC_API_KEY')` in `functions/src/runtime.ts:19`. All AI functions bind it via `{ secrets: [ANTHROPIC_API_KEY] }`. Locally: `functions/.env.local`. In production: Firebase Secrets Manager.

### Grounding tools (8 total)
Defined in `functions/src/tools.ts`. All read Firestore; none write.

| Tool | Purpose |
|------|---------|
| `search_entities` | TF-IDF cosine search over `searchIndex`; returns top-15 with score |
| `get_product_tree` | Product + full coverage hierarchy + rating programs + counts |
| `get_coverage` | One coverage by refId (uses collectionGroup query) |
| `get_rules` | Rules for a product or filtered by coverageRefId |
| `get_forms` | Forms with filters (category, state, form number, coverage part, free text) |
| `get_ld_table` | One LD table by refId |
| `run_rating` | Executes the evaluator; defaults unspecified inputs to the line's worked example |
| `get_dictionary` | One dictionary entry by name (exact then prefix match) |

**Flag**: `news.ts` uses `web_search_20250305` as the tool type string, cast via `as unknown as Anthropic.Tool[]`. This is Anthropic's built-in web-search tool (not a user-defined tool); it only works in production (not in the emulator Functions environment without a real API key + web search access).

**Model strings quoted verbatim** (both are GA Anthropic models):
- `'claude-sonnet-4-6'` — `functions/src/runtime.ts:28`
- `'claude-haiku-4-5'` — `functions/src/runtime.ts:29`

---

## 8. Rating Engine and the $1,528 Canary

### Files
- `shared/src/rating/evaluator.ts` — pure `evaluate()` function (no platform imports)
- `shared/src/rating/kits.ts` — `RatingKit` bridge (line-agnostic; maps LOB prefix → getters + worked example)
- `shared/src/rating/rtGrid.ts` — generic N-dimensional RT table lookup for grid-editor-managed tables
- `shared/src/seed/ho3.ts` — `HO3_RATING_PROGRAM`, `HO3_RT_TABLES`, `HO3_LD_TABLES`, `makeHO3RtGetter`, `HO3_WORKED_EXAMPLE`
- `shared/src/rating/evaluator.test.ts` — the canary test

### How the Evaluator Works

`evaluate(program, inputs, rtGetter, ldGetter)` → `{ finalPremium, trace[] }`.

Steps execute in `order` sequence (sorted ascending). Each step:
1. **Gate**: if `step.condition` is set and `inputs[condition]` is falsy → step skipped (trace entry omitted)
2. **Source resolution** (`resolveSource`):
   - `CONST`: literal `value`
   - `INPUT`: `inputs[ref]` (must be `number`)
   - `LD`: `ldGetter(ref, inputs[keys[0]])`
   - `RT`: `rtGetter(ref, {k:inputs[k] for k in keys})`
   - `SPP`: Σ over `inputs.sppItems` of `(appraisedValue/100) × rtGetter(ref, {itemClass})`
3. **Operation** on `running`: `SET` (replace) / `MUL` (multiply) / `ADD` (add) / `MIN_FLOOR` (`Math.max`)
4. **Round** if `step.roundTo` is set

### HO-3 Rating Program (`HO.RAT.1`) — 14 Steps

| Step | Order | Label | Op | Source | Condition |
|------|-------|-------|----|--------|-----------|
| s1 | 1 | Territory base rate | SET | RT HO.RT.001 [territory] | — |
| s2 | 2 | Protection/construction factor | MUL | RT HO.RT.002 [pc, construction] | — |
| s3 | 3 | Coverage A key factor → Key Premium | MUL | RT HO.RT.003 [covA] | — (rounds to $) |
| s4a | 4 | All-peril deductible factor | MUL | RT HO.RT.004 [allPerilDed] | — |
| s4b | 5 | Wind/hail deductible factor | MUL | RT HO.RT.004 [windHailPct] | `windHailElected` |
| s5 | 6 | Coverage C percentage factor | MUL | RT HO.RT.005 [covCPct] | — |
| s6 | 7 | Coverage E increased-limit charge | ADD | RT HO.RT.006 [covELimit] | — |
| s7 | 8 | Coverage F increased-limit charge | ADD | RT HO.RT.006 [covFLimit] | — |
| s8a | 9 | Replacement Cost endorsement factor | MUL | CONST 1.10 | `rcElected` |
| s8b | 10 | Protective device credit | MUL | RT HO.RT.008 [deviceCredit] | — (rounds to ¢) |
| s9 | 11 | Tier factor | MUL | RT HO.RT.009 [tier] | — |
| s10a | 12 | Water back-up flat premium | ADD | RT HO.RT.010 [waterBackupLimit] | `waterBackupElected` |
| s10b | 13 | Scheduled Personal Property premium | ADD | SPP HO.RT.007 | `sppElected` |
| s11 | 14 | Apply minimum premium ($500) | MIN_FLOOR | CONST 500 | — (rounds to $) |

### The $1,528 Canary

**Test**: `shared/src/rating/evaluator.test.ts:13`
```
it('produces $1,528 for the DOMAIN_HO worked example with exact per-step trace', () => {
  const result = evaluate(HO3_RATING_PROGRAM, HO3_WORKED_EXAMPLE, rtGetter, ldGetter)
  expect(result.finalPremium).toBe(1528)
  ...per-step assertions...
})
```

**Worked example inputs** (`HO3_WORKED_EXAMPLE` in `shared/src/seed/ho3.ts:803`):
```
territory:'T002', pc:5, construction:'M', covA:400000, allPerilDed:1000,
windHailElected:false, covCPct:70, covELimit:300000, covFLimit:2000,
rcElected:true, deviceCredit:'none', tier:'B',
waterBackupElected:true, waterBackupLimit:5000,
sppElected:true, sppItems:[{itemClass:'Jewelry', appraisedValue:15000}]
```

**Trace** (per test assertions):
`700 → ×1.05=735 → ×1.30=955.50→956 → ×1.00=956 → ×1.06=1013.36 → +24=1037.36 → +6=1043.36 → ×1.10=1147.70 → ×1.00=1147.70 → ×1.10=1262.47 → +75=1337.47 → +190.50=1527.97 → MAX(1527.97,500)→1528`

**GL Canary**: `GL_WORKED_EXAMPLE` → `$2,789` (asserted in `shared/src/rating/gl.evaluator.test.ts` and verified by seed script on every run).

---

## 9. Seed Data

Seed script: `scripts/seed.ts`. Command: `pnpm seed`. Auto-run via `pnpm spinup` (with emulator wait).

Seed is idempotent: wipes seeded collections then re-seeds. Supports `--only ho` / `--only gl` flag. Verifies both canary premiums after seeding.

**Seed counts (from actual run)**:

| Entity | Count | Notes |
|--------|-------|-------|
| `products` | 2 | HO.PROD.001 + GL.PROD.001 |
| `coverages` | 24 | 10 HO-3 (6 mandatory + 4 optional sub) + 14 GL |
| `ldTables` | 10 | 6 HO.LD + 4 GL LDTable |
| `rtTables` | 14 | 10 HO.RT + 4 GL RTTable |
| `ratingPrograms` | 2 | HO.RAT.1 + GL.RAT.1 |
| `forms` | 26 | 12 HO-3 + 14 GL |
| `rules` | 23 | 10 HO-3 + 13 GL |
| `formRules` | 9 | 7 HO-3 + 2 GL |
| `dictionary` | 17 | 10 HO-3 + 7 GL |
| `tasks` | 8 | Default task templates (HO-3 only; GL shares the board) |
| `feedback` | 3 | Sample feedback items |
| `searchIndex` | 93 | All indexable entities |
| `users` | 4 | admin@admin.com (ADMIN), admin@productfactory.app (ADMIN, must-change-pw), editor@productfactory.app (EDITOR), viewer@productfactory.app (VIEWER) |

### HO-3 Product Structure

- **Product**: `HO.PROD.001` — *Homeowners — HO-3 Special Form*, LOB Homeowners, 15-state footprint (AZ CA CO FL GA IL IN MI NC OH PA SC TN TX VA), min premium $500
- **Coverages (10)**: Coverage A Dwelling (mandatory), B Other Structures (mandatory), C Personal Property (mandatory), D Loss of Use (mandatory), E Personal Liability (mandatory), F Medical Payments (mandatory), + sub-coverages: Water Back-Up (optional, child of A), Other Structures Increased Limits (optional, child of B), Personal Property Replacement Cost (optional, child of C), Scheduled Personal Property (optional, child of C)
- **LD Tables (6)**: HO.LD.001 (Cov E limits), HO.LD.002 (Cov F limits), HO.LD.003 (all-peril ded), HO.LD.004 (WH % ded), HO.LD.005 (Cov C % of A), HO.LD.006 (water backup limits)
- **RT Tables (10)**: HO.RT.001–010 (territory rate, PC×construction factor, Coverage A key factor, deductible factors, Cov C % factor, liability increased limits, SPP class rates, endorsement/device credit, tier factor, water backup flat premium)
- **Forms (12)**: HO 00 03 (base), HO DS 01 (declarations), HO 04 90/95/61/16/48 (endorsements), HO 03 12 (WH% deductible), HO 04 96 (exclusion), HO 01 04/33 (CA/TX amendatory), PN HO 01 (notice)
- **Rules (10)**: HO.RU.001–010 (eligibility, coverage limits, deductible rules)
- **Form Rules (7)**: HO.FORM.RU.001–007 (RC→HO 04 90, water backup→HO 04 95, SPP→HO 04 61, device→HO 04 16, WH%→HO 03 12, state amendatories, day-care exclusion)

---

## 10. Data-Flow and State Patterns

### Read path
1. Component calls `adapter.db.subscribe(path, cb)` → `onSnapshot` on collection or document → callback fires on every change
2. `ProductContext` (`app/src/context/ProductContext.tsx`) manages a product workspace: subscribes to `products/{pid}`, `products/{pid}/coverages`, `rules`, `formRules`, `ratingPrograms`; fetches `ldTables` and `rtTables` from top-level collections; holds loading state; unsubscribes on unmount
3. `useProductCtx()` hook exposes the context to child routes
4. The `evaluate()` call in `ProductPricing.tsx` is pure client-side (no network); inputs come from local state updated by the worksheet controls

### Write path (mutations)
1. Component calls `adapter.db.mutate(payload)` where `payload = { op, path, data, entityType, actor, productId?, expectedRev? }`
2. Adapter reads current doc, checks `rev` against `expectedRev` (throws `MutationConflictError` on mismatch)
3. Builds atomic `WriteBatch` (entity + auditEvent + version + searchIndex + rev bump)
4. `batch.commit()` — all-or-nothing Firestore write
5. `onSnapshot` subscriptions fire automatically → UI updates reactively

### Optimistic concurrency
`rev` field (integer) incremented on every `update`. `expectedRev` must match stored `rev`; mismatch → `MutationConflictError` → caller (component) shows a conflict toast. No retry logic — user must re-read and re-apply their change.

### AI streaming
`adapter.fns.stream(name, data, onChunk)` issues a `fetch` POST to the Function URL with a Bearer token. It reads the response body as a stream, splitting on `\n`, and calls `onChunk` for each `data: ...` line. The component parses the JSON event (`StreamEvent` type from `runtime.ts`) and updates local state (appending tokens, showing tool chips, rendering `DeterminationCard` on `emit_determination`).

### Anonymous auth
On first load with no existing session, `onUser` calls `signInAnonymously(auth)`. Anonymous users get a real Firebase ID token (no role claim). They can read all domain data (Firestore rules: `isAuthed()`) and use AI features but cannot write.

---

## 11. Known Gaps, Stubs, and TODOs

### Critical stubs
- **`/app/builder`** (`routes/stub/StubRoute.tsx`): Fully stubbed. "AI Builder — Generate product structures, draft coverage language and validate rules with Claude — coming soon." No implementation.

### Thin / incomplete features
- **News** (`routes/News.tsx`): Requires `refreshNews` callable to have a real Anthropic API key with web-search access (`web_search_20250305`). In the emulator, calling `refreshNews` will fail if no real API key is present in `functions/.env.local`. The news list shows empty if not pre-populated.
- **Claims Analysis**: Chat is disabled until a base-form PDF is selected from the library. The library shows `baseForms` from Firestore — freshly seeded state has no base forms uploaded. `sample-forms/HO3_sample.pdf` exists in git history but is **deleted from disk** (git status: `D sample-forms/HO3_sample.pdf`).
- **Dictionary editing**: The dictionary shows entries and allows search/filter, but the inline editing UI is thin — governance block is present but there is no rich editor dialog matching the coverage editor UX.
- **Product creation flow**: The Products screen shows a "New product" button, but the form is thin (name, LOB, description). AI extraction (`extractCoverages`) requires a base form PDF upload to propose coverages. Without a PDF, PMs manually create coverages one by one.
- **Share view** (`/share/:token`): The React `ShareView` component calls `getShareSnapshot` callable. The Functions `share` endpoint serves the OG-card HTML independently — these are two different things sharing the same URL pattern.
- **Admin Settings tab**: Exposes only local app settings (e.g., dev bypass toggle). No org-wide settings.

### Technical debt / hard-coded values
- **Dev admin bypass** (`firebase.adapter.ts:81–140`): Fake ADMIN session with no backend. Must be removed before production. `signInAsDevAdmin()` stores a flag in `sessionStorage`.
- **Storage emulator intentionally skipped** (`firebase.adapter.ts:38`): `connectStorageEmulator` is NOT called even in dev. Comment: *"Storage always uses live endpoints (no emulator) to avoid CORS issues."* Uploads always go to production Cloud Storage, even in local development.
- **`app/.env.development.local`**: Sets `VITE_USE_EMULATORS=false` → running dev server is connected to **production Firebase**, not the emulator. This file is gitignored and user-local.
- **`resolveProductId` in tools.ts:158**: Returns `null` for multi-product portfolios when `productId` is omitted — the AI then gets `{found:false, note:"Specify productId — more than one product exists."}`. With two seeded products, the `get_product_tree` tool requires an explicit `productId`.
- **Console noise**: Anonymous sign-in failure warning, and `subscribe` listener errors logged to console on permission issues.
- **`HO3_SAMPLE_FEEDBACK` item references `$1,528`** with comment "the evaluator returns a trace array but the pricing tab does not display it yet" — this was true at time of seeding but is now **stale** (the trace IS displayed via the animated flow diagram + table).

### Dead code / deleted files
- `CLAUDE.md`, `README.md`, `app/CLAUDE.md`, `functions/CLAUDE.md`, `shared/CLAUDE.md` — all deleted from disk
- `docs/adr/*.md`, `docs/AWS_SWAP.md`, `docs/BASELINE_AUDIT.md`, `docs/CLAIMS_QA_VERIFICATION.md`, `docs/ELEVATION_PROMPT.md` — all deleted from disk
- `sample-forms/HO3_sample.pdf`, `samples/*.xlsx` — all deleted from disk

### Missing dark mode
The app is **light-mode only**. `app/src/index.css` has no `@media (prefers-color-scheme: dark)` block and no `.dark` Tailwind variant. There is no theme toggle in the UI.

---

## 12. Build / Dev / Test Commands

All commands run from the monorepo root unless noted.

| Command | What it does |
|---------|-------------|
| `pnpm emulators` | `firebase emulators:start` — starts Auth:9099, Firestore:8080, Functions:5001, Storage:9199, Hosting:5000, UI:4000 |
| `pnpm seed` | `tsx scripts/seed.ts` — wipes + re-seeds both reference products; verifies $1,528 + $2,789 canaries |
| `pnpm spinup` | Parallel: `pnpm emulators` + `node scripts/wait-and-seed.mjs` (waits for Firestore, then seeds) |
| `pnpm dev` | `pnpm --filter app dev` → `vite` on port 5173 |
| `pnpm dev:all` | `concurrently "pnpm emulators" "pnpm --filter app dev"` — emulators + Vite together |
| `pnpm typecheck` | `pnpm -r typecheck` — runs `tsc --noEmit` in all workspaces |
| `pnpm lint` | `pnpm -r lint` — runs `oxlint src` in app; echoes no-op in functions and shared |
| `pnpm test` | `vitest run` — runs shared/ unit tests (evaluator, rules engine, types) |
| `pnpm test:rules` | `firebase emulators:exec --only firestore "vitest run --config vitest.rules.config.ts"` — Firestore security rules tests |
| `pnpm build` | `pnpm --filter app build` → `tsc -b && vite build` → outputs to `app/dist/` |
| `pnpm deploy` | `pnpm build && firebase deploy` — builds + deploys hosting + functions |

**Full local development in one command**:
```
pnpm spinup          # terminal 1 — emulators + auto-seed
pnpm dev             # terminal 2 — Vite dev server
```
Ensure `app/.env.development` has `VITE_USE_EMULATORS=true` (the committed default). The `app/.env.development.local` file overrides this to `false` (production) for local developer convenience — delete it to go back to emulators.

**Functions hot-reload in emulator**: The emulator auto-reloads `functions/lib/index.js` from the pre-built output. Run `pnpm --filter functions build` to rebuild functions when source changes.

---

## 13. Key Module Index

| File | Purpose |
|------|---------|
| `shared/src/types.ts` | All Firestore collection shapes + evaluator I/O types; zero platform imports |
| `shared/src/rating/evaluator.ts` | Pure rating engine: `evaluate()`, `resolveSource()`, `RtGetter`/`LdGetter` types |
| `shared/src/rating/evaluator.test.ts` | $1,528 canary test + per-step trace assertions |
| `shared/src/rating/kits.ts` | `resolveRatingKit(lobPrefix)` → `{makeRtGetter, makeLdGetter, workedExample, inputSpec?}` |
| `shared/src/rating/rtGrid.ts` | Generic N-dimensional RT table lookup for grid-editor-managed tables |
| `shared/src/seed/ho3.ts` | All HO-3 seed constants: product, coverages, LD/RT tables, rating program, forms, rules, users, worked example |
| `shared/src/seed/gl.ts` | All GL seed constants (mirrors ho3.ts structure for the commercial line) |
| `shared/src/insurance/lobRegistry.ts` | `LobDefinition`, `HO_LOB`, `GL_LOB`, `resolveLob()`, `groupBySection()`, `isPerilState()` |
| `shared/src/insurance/terms.ts` | Canonical typed limit/deductible/option term logic |
| `shared/src/rules/engine.ts` | Client-side rules engine: evaluates form attachment rules and option availability |
| `shared/src/search/rank.ts` | TF-IDF cosine ranking (`rankDocuments()`) used by both the AI tool and client |
| `shared/src/index.ts` | Barrel re-export of everything shared |
| `app/src/App.tsx` | React Router tree: all routes, lazy loading, UserProvider |
| `app/src/lib/backend/firebase.adapter.ts` | Complete `BackendAdapter` implementation: auth, db (subscribe/mutate/vote/tx), storage, fns (call/stream), presence |
| `app/src/lib/backend/firebase.config.ts` | Firebase app config (`firebaseConfig` + `FUNCTIONS_REGION`) |
| `app/src/lib/backend/types.ts` | `BackendAdapter` interface + `AuthUser`, `Session`, `Query`, `MutationPayload`, `MutationConflictError` |
| `app/src/context/UserContext.tsx` | Auth state + Firestore profile subscription + `UserProvider` |
| `app/src/context/ProductContext.tsx` | Product workspace: all onSnapshot subscriptions for one product's data |
| `app/src/routes/AppShell.tsx` | Auth guard, sidebar, topbar, command palette, toast container |
| `app/src/routes/product/ProductWorkspace.tsx` | Product hero, tab bar, presence avatars, history/comments drawers |
| `app/src/routes/product/ProductPricing.tsx` | Live rating worksheet (HO bespoke + GL data-driven), animated trace, SVG export, RT grid editor |
| `app/src/routes/product/ProductCoverages.tsx` | Coverage hierarchy, term editors (Limit/Deductible/Option), DnD reorder |
| `app/src/routes/product/ProductForms.tsx` | Forms library with attach/detach, form rules panel |
| `app/src/routes/product/ProductStates.tsx` | US state tile-map, state scope editor, coastal peril overlay |
| `app/src/routes/product/ProductRules.tsx` | Product/Rating/Forms rules table |
| `app/src/routes/product/ProductOverview.tsx` | Product metadata, health findings, description editor |
| `app/src/routes/Claims.tsx` | Claims copilot UI: base-forms library + streaming chat + DeterminationCard |
| `app/src/routes/Admin.tsx` | ADMIN console: users, audit log, seed report, settings |
| `app/src/components/product/CoverageFormsDialog.tsx` | Coverage ↔ forms assignment dialog |
| `app/src/components/product/CoverageStatesDialog.tsx` | Per-coverage state scope editor |
| `app/src/components/product/TermOptionsDialog.tsx` | Typed limit/deductible/option editor with StandardOption matrix |
| `app/src/components/product/coverageAspects.ts` | Coverage-aspect utilities (recently modified in git) |
| `app/src/components/shell/Sidebar.tsx` | Navigation sidebar with collapse |
| `app/src/components/shell/Topbar.tsx` | Top bar with breadcrumb + command palette trigger |
| `app/src/components/palette/CommandPalette.tsx` | ⌘K search palette (searchIndex + Fuse.js) |
| `app/src/components/claims/DeterminationCard.tsx` | Structured determination card (verdict + coverages + limits + reasoning + citations) |
| `app/src/lib/productHealth.ts` | `computeProductFindings()` + `healthScore()` (finds missing coverage terms, forms, rating steps) |
| `functions/src/runtime.ts` | MODEL strings, `anthropic()` factory, `authenticate()`, SSE helpers |
| `functions/src/tools.ts` | 8 grounding tools + `SYSTEM_PROMPT` + `runTool()` dispatcher |
| `functions/src/ai.ts` | `chat` function + `runChatAgent()` shared agent loop |
| `functions/src/claims.ts` | `analyzeClaim` + `identifyBaseForm` |
| `functions/src/extract.ts` | `extractCoverages` |
| `functions/src/news.ts` | `refreshNews` + `nightlyNews` |
| `functions/src/admin.ts` | `setUserRole` callable |
| `firestore.rules` | Role-gated security rules (VIEWER/EDITOR/ADMIN, anonymous read, feedback/vote special path) |
| `scripts/seed.ts` | Full seed script: both products, canary verification, user creation |

---

## 14. Open Questions and Risks for a Major Enhancement Effort

1. **Multi-product AI disambiguation**: `get_product_tree` and `run_rating` fall back to the sole product only when `products` has exactly one doc. With two+ products (as seeded), the tool returns `{found:false}` unless `productId` is explicitly passed. The AI's `CLAIMS_SYSTEM` prompt notes this but adds complexity to every tool call.

2. **Storage emulator gap**: Uploads always go to live Firebase Storage (Storage emulator intentionally disabled). Any feature touching PDFs or exported files will fail locally without proper CORS config on the production bucket. The `storage.cors.json` + `cors:apply` scripts exist but are manual.

3. **`app/.env.development.local` drift risk**: This file sets `VITE_USE_EMULATORS=false`, routing local dev to production. Any developer without this file gets emulators; any with it gets production. There is no CI check for this divergence.

4. **Anonymous user experience gaps**: Anonymous users can read all data and initiate AI chats, but cannot create feedback, vote, or use any write surfaces. The UI doesn't consistently surface "sign in to do this" messaging.

5. **Rev-based concurrency is UI-only**: `MutationConflictError` is thrown and shown as a toast, but there is no auto-retry or diff-and-rebase logic. In a multi-editor scenario, the second writer must manually re-read and re-apply their change.

6. **No password reset flow**: No "Forgot password" on sign-in; no email-based reset. Only admin-triggered resets via `setUserRole(deactivate/reactivate)` or direct Firebase console.

7. **Functions cold start**: AI functions (512MiB, 300s timeout) have JVM-style warm-up delays on first invocation. No minimum instances configured — the first claim analysis may time out on a cold emulator.

8. **Rules engine is client-side only**: `shared/src/rules/engine.ts` runs in the browser. The form-attachment rules and option availability checks are not enforced server-side (Firestore rules don't call the engine). A malicious EDITOR could bypass option constraints.

9. **`web_search_20250305` tool type**: This non-standard type string is cast via `as unknown`. It works with Anthropic's current API but is fragile — if Anthropic changes the web-search tool's API surface or type name, the news function will silently fail with an opaque error.

10. **No automated E2E test suite**: Unit tests cover the rating engine and rules engine in isolation; `tests/rules.test.ts` covers Firestore security rules. There are no E2E tests for the React UI or the AI function flows. A regression in the Pricing trace display or the Claims copilot would only be caught manually.

11. **GL product is a second-class citizen in AI**: `CLAIMS_SYSTEM` and `SYSTEM_PROMPT` are HO-3-centric in their examples and domain notes. GL analysis is possible (the tools are line-agnostic) but the system prompt doesn't guide GL-specific coverage logic (ISO CGL exclusions, occurrence vs claims-made, aggregate resets).

12. **`baseForms` collection not in DATA_MODEL.md**: If this is replaced or expanded (e.g., to support multiple policy forms per product), there's no canonical spec to reference.

---

## Divergences from Documentation

| Doc | Claim | Reality |
|-----|-------|---------|
| `DATA_MODEL.md` | parentId validated in mutate() | Not validated; UI-side only |
| `DATA_MODEL.md` | money in integer cents | Stored as `number` (dollars) |
| `DATA_MODEL.md` | No mention of `baseForms` collection | Collection exists in code and rules |
| `DATA_MODEL.md` | No RTTable grid-editor fields | `dimensions`, `valueColumn` exist in types.ts |
| Deleted docs | `CLAUDE.md`, `README.md`, all ADRs, AWS_SWAP.md, etc. | Not present on disk |
| Seed feedback item | "pricing tab does not display trace" | Trace IS displayed (stale feedback) |
| `firebase.adapter.ts` comment | Storage emulator connected | Storage emulator intentionally NOT connected |
| Any doc assuming single product | AI tools default to sole product | Two products seeded; `productId` required |
