# 01_ARCHITECTURE.md — System Architecture

## What this app is
**Product Reinvention Hub** — an AI-native P&C insurance product management platform. Insurance product managers use it to browse, draft, and analyse their product portfolio (coverages, forms, rules, rating programs), run coverage gap analysis on claims scenarios, and receive AI-generated product scaffolds and rule drafts, all grounded in structured Firestore data.

---

## Tech Stack with Versions

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript | ~6.0.2 |
| Frontend framework | React | ^19.2.7 |
| Frontend build | Vite | ^8.1.1 |
| CSS framework | Tailwind CSS v4 | ^4.1.11 |
| Routing | React Router v7 | ^7.6.3 |
| Toast notifications | Sonner | ^2.0.5 |
| Backend runtime | Firebase Cloud Functions v2 (Node 20) | ^6.6.0 |
| Database | Firestore | (firebase-admin ^13.4.0) |
| Storage | Firebase Storage | (firebase-admin ^13.4.0) |
| Auth | Firebase Auth (custom claims) | firebase-admin ^13.4.0 |
| AI provider | Anthropic Claude via @anthropic-ai/sdk | ^0.54.0 |
| Embeddings/rerank | Voyage AI (optional; lexical fallback) | HTTP API |
| Monorepo | pnpm workspaces | pnpm-workspace.yaml |
| Package manager | pnpm | (system) |
| Linter | oxlint | ^1.71.0 |
| Test runner | Vitest | ^3.1.4 |
| E2E tests | Playwright | ^1.61.1 |
| Functions bundler | tsup (esbuild) | ^8.5.0 |
| Drag-and-drop | @dnd-kit | ^6.3.1 / ^10.0.0 |
| Excel read/write | exceljs | ^4.4.0 |
| Fuzzy search (UI) | fuse.js | ^7.1.0 |

---

## Repo Tree (3 levels, key items)

```
314358_InsurancePlatformsAI/
├── app/                          ← React + Vite frontend
│   ├── src/
│   │   ├── App.tsx               ← Root router (lazy routes, UserProvider)
│   │   ├── index.css             ← All design tokens (@theme block)
│   │   ├── main.tsx              ← Vite entry point
│   │   ├── routes/               ← Page-level route components
│   │   │   ├── Landing.tsx
│   │   │   ├── AppShell.tsx
│   │   │   ├── Home.tsx
│   │   │   ├── Products.tsx
│   │   │   ├── Claims.tsx
│   │   │   ├── Builder.tsx
│   │   │   ├── Explorer.tsx
│   │   │   ├── Tasks.tsx
│   │   │   ├── News.tsx
│   │   │   ├── Dictionary.tsx
│   │   │   ├── Feedback.tsx
│   │   │   ├── Admin.tsx
│   │   │   └── product/          ← Product workspace tabs
│   │   │       ├── ProductWorkspace.tsx
│   │   │       ├── ProductOverview.tsx
│   │   │       ├── ProductCoverages.tsx
│   │   │       ├── ProductForms.tsx
│   │   │       ├── ProductPricing.tsx
│   │   │       ├── ProductStates.tsx
│   │   │       └── ProductRules.tsx
│   │   ├── components/           ← Shared UI + feature components
│   │   │   ├── ui/               ← Design system primitives
│   │   │   ├── chat/             ← Portfolio AI chat
│   │   │   ├── claims/           ← Claims copilot UI
│   │   │   ├── explorer/         ← Global entity explorer
│   │   │   ├── feedback/         ← Feedback capture + board
│   │   │   ├── home/             ← Home dashboard
│   │   │   ├── product/          ← Product workspace feature components
│   │   │   ├── shell/            ← Nav, header, sidebar
│   │   │   └── tasks/            ← GTM board
│   │   ├── context/              ← React context providers
│   │   │   ├── UserContext.tsx
│   │   │   ├── ProductContext.tsx
│   │   │   └── CaptureContext.tsx
│   │   ├── lib/
│   │   │   ├── backend/          ← Adapter seam (Firebase implementation)
│   │   │   │   ├── index.ts      ← Single export point
│   │   │   │   ├── types.ts      ← BackendAdapter contract
│   │   │   │   ├── firebase.adapter.ts ← Live implementation
│   │   │   │   └── firebase.config.ts
│   │   │   ├── claims/           ← Claims determination helpers
│   │   │   ├── export/           ← Excel / DuckCreek export utilities
│   │   │   └── import/           ← ISO workbook import pipeline
│   │   └── features/             ← Additional feature modules
├── functions/                    ← Firebase Cloud Functions (AI backend)
│   ├── src/
│   │   ├── index.ts              ← Re-exports all Cloud Functions
│   │   ├── runtime.ts            ← Anthropic client, model constants, auth, SSE helpers
│   │   ├── ai.ts                 ← Portfolio chat SSE + shared agent loop
│   │   ├── claims.ts             ← Claims copilot (analyzeClaim, identifyBaseForm)
│   │   ├── extract.ts            ← Structured coverage extraction from PDFs
│   │   ├── rules.ts              ← AI rule composer (draftRule)
│   │   ├── scaffoldProduct.ts    ← AI product scaffold composer
│   │   ├── summarize.ts          ← Product summary via haiku (cached)
│   │   ├── news.ts               ← Market news scout (nightly + on-demand)
│   │   ├── describeForm.ts       ← Cache-first form description generator
│   │   ├── shapeFeedback.ts      ← Feedback → user story AI shaper
│   │   ├── exportDuckCreek.ts    ← DuckCreek export audit callable
│   │   ├── admin.ts              ← setUserRole (ADMIN only)
│   │   ├── tools.ts              ← Grounding tools + SYSTEM_PROMPT
│   │   ├── costGuard.ts          ← Budget caps + circuit breaker (I/O)
│   │   ├── telemetry.ts          ← AI usage recording
│   │   ├── portfolioDigest.ts    ← Cached portfolio digest for chat prefix
│   │   ├── semanticCache.ts      ← Semantic response cache
│   │   ├── invalidate.ts         ← Firestore write triggers → re-index
│   │   ├── interpretSearch.ts    ← NL → structured search query
│   │   ├── audited.ts            ← auditedMerge helper
│   │   ├── pdfText.ts            ← PDF→text extraction (server-side)
│   │   └── retrieval/
│   │       ├── index.ts          ← retrieve() entry point; Voyage vs lexical
│   │       ├── types.ts          ← Port contracts (EmbeddingsClient, VectorStore, …)
│   │       ├── firestoreStore.ts ← Live vector store (Firestore KNN)
│   │       ├── voyage.ts         ← Voyage embeddings + reranker
│   │       ├── indexer.ts        ← reindexGrounding callable
│   │       ├── citations.ts      ← Citations-API verification helpers
│   │       └── placeholder.ts    ← AWS OpenSearch swap stub
├── shared/                       ← @pf/shared — pure TypeScript, no platform deps
│   └── src/
│       ├── types.ts              ← All domain types (canonical Firestore shapes)
│       ├── index.ts              ← Barrel export
│       ├── rating/               ← Rating engine (evaluator, kits, tables)
│       ├── rules/                ← Rules engine
│       ├── insurance/            ← LOB registry, ISO import, terms, scaffold
│       ├── seed/                 ← Canonical seed data (HO-3, Personal Auto, GTM)
│       ├── retrieval/            ← Chunk/retrieve types + lexical ranker
│       ├── cost/                 ← Budget decision logic + circuit breaker (pure)
│       ├── grounding/            ← Citation verification, portfolio digest assembler
│       ├── claims/               ← Claims line-profile registry
│       ├── duckcreek/            ← DuckCreek XML serializer
│       ├── dictionary/           ← Dictionary usage computation
│       ├── feedback/             ← Feedback priority scoring
│       ├── gtm/                  ← GTM launch process schedule
│       ├── search/               ← Lexical document ranker
│       └── pdm/                  ← Product data model (PDM) builder
├── firestore.rules               ← Security rules (role matrix)
├── firestore.indexes.json        ← Firestore composite indexes
├── firebase.json                 ← Firebase hosting + functions + emulator config
├── .firebaserc                   ← Project alias (productreinvention)
├── package.json                  ← Root scripts (dev:seed, test, deploy, eval)
├── pnpm-workspace.yaml           ← Workspace: app, functions, shared
├── playwright.config.ts          ← E2E test config
├── scripts/
│   ├── seed.ts                   ← Seed script (populates emulator)
│   └── wait-and-seed.mjs         ← Dev helper: waits for emulators then seeds
├── samples/                      ← Sample ISO forms (PDF + XLSX)
├── docs/
│   ├── adr/                      ← Architecture Decision Records
│   ├── review/                   ← Past screenshots + cost reports
│   └── ELEVATION_SCOREBOARD.md   ← UI/UX quality rubric
└── e2e/smoke.spec.ts             ← Playwright smoke tests
```

---

## Entry Points and App Bootstrap Flow

### Frontend Bootstrap
1. `app/index.html` → `app/src/main.tsx` — Vite entry; mounts `<App />` into `#root`
2. `App.tsx` — wraps everything in `<BrowserRouter>`, `<UserProvider>`, `<VersionWatcher>`, `<ErrorBoundary>`, `<Suspense>`
3. `UserContext.tsx` — subscribes to `adapter.auth.onUser()` which calls Firebase `onAuthStateChanged`; auto-attempts anonymous sign-in if no user. On sign-in, the ID token is refreshed and the `role` custom claim is extracted.
4. `AppShell.tsx` — authenticated shell (nav, sidebar). Landing/MustChangePassword are accessible without the shell.
5. Route components are all `React.lazy()`-loaded — code-split per route.
6. `adapter` (singleton from `firebase.adapter.ts`) is module-level, initialized once with `initializeApp(firebaseConfig)`. Emulators are wired when `VITE_USE_EMULATORS=true`.

### Functions Bootstrap
1. `functions/src/index.ts` — re-exports every named Cloud Function; tsup bundles to `lib/index.js`.
2. Each function module initializes the Firebase Admin SDK with `if (!getApps().length) initializeApp()` (guard for shared cold-start).
3. `runtime.ts` initializes the Admin SDK, defines the two model constants, binds the Anthropic client, and exports the SSE helpers.

---

## Runtime Data Flow

```
Browser (React SPA)
    │
    ├── Firestore SDK ──────────────────────────── Firestore (GCP)
    │   (via adapter.db.get/list/subscribe/mutate)   ├── products/{id}/coverages, rules, ...
    │                                                ├── forms, ldTables, rtTables
    │                                                ├── dictionary, tasks, projects
    │                                                ├── feedback, news, baseForms
    │                                                └── aiUsage, groundingChunks (server-only)
    │
    ├── Firebase Storage ────────────────────────── Storage (GCP)
    │   (adapter.storage.upload/getUrl)              └── baseForms/<productId>/<uuid>.pdf
    │
    ├── Firebase Callable Functions ─────────────── Cloud Functions (Node 20, us-central1)
    │   (adapter.fns.call)                           ├── setUserRole (ADMIN)
    │   [structured JSON RPC]                        ├── identifyBaseForm (EDITOR+)
    │                                                ├── scaffoldProduct (EDITOR+)
    │                                                ├── summarizeProduct (any authed)
    │                                                ├── describeForm (EDITOR+)
    │                                                ├── shapeFeedback (any authed)
    │                                                └── exportDuckCreek (any authed)
    │
    └── SSE HTTPS Functions ─────────────────────── Cloud Functions (SSE)
        (adapter.fns.stream)                         ├── chat  (any authed)
        [Bearer token, POST, text/event-stream]      ├── analyzeClaim (any authed)
                                                     ├── extractCoverages (EDITOR+)
                                                     ├── draftRule (EDITOR+)
                                                     └── scaffoldProduct (EDITOR+)

Cloud Functions → Anthropic API (claude-sonnet-5 / claude-haiku-4-5)
Cloud Functions → Voyage AI (embeddings + rerank; optional)
Cloud Functions → Web (news scout: fetch + HEAD probes)
```

---

## Build and Run Commands (verified from package.json scripts)

```sh
# Full local dev stack (emulators + seed + Vite)
pnpm dev:seed

# Vite only (no emulators)
pnpm --filter app dev

# Re-seed only (emulators must be running)
pnpm seed          # (tsx scripts/seed.ts)

# Gate (must stay green)
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# Individual stages
pnpm typecheck     # tsc -b across all workspaces
pnpm lint          # oxlint across all workspaces
pnpm test          # vitest + rules tests + integration tests + playwright
pnpm build         # tsc + vite build (app/dist)

# Deploy
pnpm build && firebase deploy

# Eval (AI evaluation harness)
tsx functions/eval/runner.ts
```

---

## External Service Dependencies

| Service | How wired | Purpose |
|---|---|---|
| Firebase Auth | Client SDK + Admin SDK; JWT custom claims carry `role` | User authentication; role enforcement |
| Firestore | Client SDK (app) + Admin SDK (functions) | All structured data storage |
| Firebase Storage | Client SDK (app) + Admin SDK (functions) | PDF form uploads |
| Firebase Cloud Functions v2 | HTTP onRequest + onCall; `functions.json` in firebase.json | All server-side logic |
| Anthropic API | `@anthropic-ai/sdk` (server-only); key via Firebase Secret `ANTHROPIC_API_KEY` | All LLM calls (claude-sonnet-5 + claude-haiku-4-5) |
| Voyage AI | HTTP REST (server-only); key via Firebase Secret `VOYAGE_API_KEY` (optional) | Dense embeddings + reranking for grounded retrieval |
| Firebase Emulator Suite | Dev-only; auth:9099, firestore:8080, functions:5001, storage:9199, hosting:5000 | Local development |
| Google Analytics | `measurementId: G-82E4D44Q56` in firebase.config.ts | ASSUMPTION: analytics (not wired in code beyond the measurementId field) |

---

## State Management Approach

No global state library (no Redux, Zustand, etc.). State lives in:
1. **React Context** — `UserContext` (auth/role), `ProductContext` (current product workspace data + sub-collection subscriptions), `CaptureContext` (feedback capture panel state)
2. **Local component state** (`useState`, `useReducer`) for ephemeral UI state
3. **Firestore real-time subscriptions** via `adapter.db.subscribe()` → `onSnapshot`, managed in context providers and custom hooks (`useLiveCollection.ts`, `usePortfolioInventory.ts`)
4. **URL** as state for routing (React Router v7)

---

## Routing Map

| Path | Component | Auth required | Notes |
|---|---|---|---|
| `/` | `Landing` | No | Sign-in + app intro |
| `/must-change-password` | `MustChangePassword` | Yes | Forced on first login |
| `/app` | `AppShell` | Yes | Authenticated shell |
| `/app` (index) | `Home` | Yes | Portfolio chat + priorities |
| `/app/products` | `Products` | Yes | Product card grid / table / hierarchy |
| `/app/products/:id` | `ProductWorkspace` | Yes | Nested tab workspace |
| `/app/products/:id/overview` | `ProductOverview` | Yes | AI summary + metadata |
| `/app/products/:id/coverages` | `ProductCoverages` | Yes | Coverage tree editor |
| `/app/products/:id/forms` | `ProductForms` | Yes | Forms library |
| `/app/products/:id/pricing` | `ProductPricing` | Yes | Interactive rating |
| `/app/products/:id/states` | `ProductStates` | Yes | State footprint tile map |
| `/app/products/:id/rules` | `ProductRules` | Yes | Rules table + AI composer |
| `/app/builder` | `Builder` | Yes (EDITOR+) | New product creation + AI scaffold |
| `/app/explorer` | `Explorer` | Yes | Global entity search |
| `/app/tasks` | `Tasks` | Yes | GTM launch board |
| `/app/news` | `News` | Yes | Market news feed |
| `/app/claims` | `Claims` | Yes | Coverage copilot |
| `/app/dictionary` | `Dictionary` | Yes | Data dictionary |
| `/app/feedback` | `Feedback` | Yes | Feedback board |
| `/app/admin` | `Admin` | Yes (ADMIN only) | User management + cost tab |
| `*` | redirect to `/` | — | Catch-all |
