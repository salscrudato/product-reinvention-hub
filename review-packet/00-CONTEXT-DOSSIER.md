# Product Reinvention Hub — Context Dossier for External Code Review

> **Audience:** an external AI/human code reviewer who has never seen this codebase.
> **Purpose:** a dense, factual, self-contained map of the product, its architecture, its
> invariants, and its known posture — enough to review any part of the system without
> first reverse-engineering it.
> **Contains no secret values.** All credentials referenced here live in Azure App Service
> configuration / gitignored local files and are read from `process.env` at runtime.

---

## Table of contents

1. [What this product is](#1-what-this-product-is)
2. [Repo topology & scale](#2-repo-topology--scale)
3. [Architecture overview](#3-architecture-overview)
4. [The binding invariants](#4-the-binding-invariants)
5. [Frontend (`app/`)](#5-frontend-app)
6. [Backend (`server/`) — full API surface](#6-backend-server--full-api-surface)
7. [The `shared/` engine](#7-the-shared-engine)
8. [CI/CD & deployment](#8-cicd--deployment)
9. [Hardening & known posture](#9-hardening--known-posture)
10. [ADRs](#10-adrs)
11. [Known constraints a reviewer should be aware of](#11-known-constraints-a-reviewer-should-be-aware-of)
12. [Appendix — quick file-path index](#12-appendix--quick-file-path-index)

---

## 1. What this product is

**Product Reinvention Hub** is an **insurance product-management platform** delivered as a
**multi-tenant SaaS on Azure**. It lets insurance carriers **author and govern insurance
Products** and everything attached to them, and it layers AI copilots on top of that governed
data.

**Lines of business (LOBs) supported today (5):**

| LOB code | Line | Kind |
|---|---|---|
| `PH.LOB.001` | Personal Home (Homeowners) | Personal |
| `PA.LOB.001` | Personal Auto | Personal |
| `GL.LOB.001` | General Liability | Commercial |
| `IM.LOB.001` | Inland Marine | Commercial |
| `PR.LOB.001` | Commercial Property | Commercial |

**Domain objects a carrier authors per Product:**

- **Coverages** (nestable via `parentId` — parent/sub-coverage hierarchy)
- **Forms** (policy form documents; `refId` and form-number chips are load-bearing UI)
- **Rating algorithms** (ordered rating steps → a computed premium)
- **Rules** (underwriting / eligibility rules; some LOBs support rule simulation)
- **State footprints** (where a product is filed/available)

**AI copilots layered on top:**

- **Portfolio Q&A** — grounded assistant chat over the tenant's product portfolio (RAG + citations).
- **Claims coverage analysis** — reads a claim + a policy form and produces a grounded coverage verdict.
- **Document import** — ingests carrier spreadsheets / filings / scanned PDFs into governed products.
- **Product scaffolding** — AI-assisted drafting of new products, rules, and field mappings.
- **Consumer HomeCheck** — a public (guest, no-auth) consumer home-risk check.

---

## 2. Repo topology & scale

pnpm monorepo. **Node 20 pinned everywhere** (CI, esbuild targets, App Service `NODE|20-lts`).
**Lint = oxlint** (not ESLint). **TypeScript ~6.0.2.** **No root tsconfig** — configuration is
per-workspace.

| Workspace | What it is | Scale | Deployed? |
|---|---|---|---|
| `app/` | React 19 + Vite 8 SPA | ~36,200 LOC / ~200 files | Yes — built and served by `server/` |
| `shared/` | Pure TypeScript engine (rating, types, seed, LOB registry, import, AI fleet constants, audit chain, retrieval). **ZERO platform imports.** | 22,487 LOC / 141 files | Yes — bundled into `server/lib/*-shared.cjs` |
| `server/` | Azure App Service Express host — the deployed backend (Cosmos + Foundry AI + Blob) | 44 files | **Yes — this is the deployed backend** |
| `functions/` | Firebase Cloud Functions | 13,302 LOC | **No — REFERENCE-ONLY, not deployed** |

**Supporting directories:**

| Directory | Contents |
|---|---|
| `scripts/` | 11 operational/migration scripts (Cosmos seeding, bundle-budget check, GTM generation, import judge, etc.) |
| `tests/` | Golden fixtures for the import contract |
| `hardening/` | Defect ledger (`ledger.md`), fault-injection checklist (`mutations.md`) |
| `docs/` | ADRs (`docs/adr/`), deployment guide (`docs/DEPLOY_AZURE.md`), review docs |

**The deployed unit** is the `server/` Express host, which serves both the **built SPA** and the
**`/api/*`** surface. `shared/` is not deployed as a package — its TypeScript is **esbuild-bundled
to committed `server/lib/*-shared.cjs`** files so the Express host can consume the same rating /
fleet / audit logic the SPA and tests use.

---

## 3. Architecture overview

```
   ┌────────────────────┐        same-origin HTTPS         ┌──────────────────────────────┐
   │  Browser SPA        │  ───────────────────────────▶   │  Express host (server/server.js)│
   │  React 19 / Vite 8  │      /api/*  (Bearer JWT)        │  serves built SPA + /api/*      │
   │  (holds NO Cosmos/  │  ◀───────────────────────────   │                                 │
   │   AI/Blob secret)   │                                  │   ├─ Cosmos DB   (data)          │
   └────────────────────┘                                   │   ├─ Azure AI Foundry (Claude +  │
                                                            │   │    OpenAI models)            │
                                                            │   └─ Azure Blob  (files)         │
                                                            └──────────────────────────────┘
                                                            Azure App Service: app-prodhub-dev
                                                            Deployed by Azure DevOps on push→main
```

Key facts:

- The **browser talks ONLY to the same-origin `/api/*`** host. It never holds a Cosmos, AI, or
  Blob credential. All secrets are server-side (`process.env`, App Service config).
- **Data** lives in **Cosmos DB**. **AI** is served via **Azure AI Foundry** (Anthropic Claude +
  OpenAI models). **Files** live in **Azure Blob**.
- **Production** = Azure App Service **`app-prodhub-dev`**, deployed by an **Azure DevOps
  pipeline on push to `main`**.

### RISK-005 — single-instance requirement (critical operational constraint)

The host **must run as a SINGLE INSTANCE.** The following are all **in-process / in-memory** and
do **not** survive scale-out:

- the AI **cost guard** (rolling spend window),
- the **rate limiters** (token buckets),
- the **JWT revocation cache** (`jti` denylist),
- the **HomeCheck session store**.

Horizontal scale-out would silently break cost enforcement, rate limiting, logout/revocation, and
HomeCheck sessions. See §11.

---

## 4. The binding invariants

These are reproduced verbatim from `CLAUDE.md`. **Breaking any one blocks the PR.**

| Invariant | Rule |
|---|---|
| **Adapter seam** | All app reads/writes go through `adapter` (`app/src/lib/backend/`). Never import a platform SDK (Cosmos/Firebase/etc.) directly in components. |
| **Atomic mutations** | Every entity write uses `adapter.db.mutate()`. The `/api` host batches entity + auditEvent + version + searchIndex atomically in one Cosmos transactional batch (`server/lib/data.js`). No bare data-store writes. |
| **Role enforcement** | `VIEWER` is read-only. Enforced server-side in the `/api` host role guards (`server/lib/auth.js` + `data.js`): every write is EDITOR+; always. |
| **AI server-side** | All AI calls live server-side (the `/api/ai` host, backed by Foundry Claude). The browser never calls the model API. |
| **AI grounded + cited** | AI responses must cite their source documents. Free invention is a bug. |
| **refId / form chips** | `refId` and form-number chips are load-bearing display elements. Never strip them. |
| **HO-3 $1,528 canary** | `shared/src/rating/evaluator.test.ts` must produce exactly $1,528. |
| **Design tokens** | No hard-coded hex outside `app/src/index.css`. Use `var(--color-*)` in browser-rendered code. SVG files exported to disk are the only exception. |
| **Model IDs** | `claude-opus-4-8` (reasoning/GROUNDED_CITED), `claude-sonnet-5` (import escalation/MID_REASONER), `claude-haiku-4-5` (bulk/BULK_VERIFY), defined in `shared/src/ai/fleet.ts` (deployed) and `server/lib/fleet.js`. **Never `claude-fable-5`.** `functions/src/runtime.ts` is reference-only and NOT deployed. |
| **Import no-cap** | The import path (`/api/ai/unifiedImport` → import-brain) runs under the named `IMPORT_CONTEXT` guard exemption: never budget-denied, never model-degraded. Telemetry (`fleet.record`, per-run `brain:spend`) is NEVER bypassed. Scope is import-only; every other AI role keeps the cost guard. |

### What each invariant is protecting

- **Adapter seam** — keeps the platform SDK out of components so the backend is swappable and
  every read/write is centralized, auditable, and testable. Enforced by an invariant test suite
  (`app/src/__invariants__/`).
- **Atomic mutations** — guarantees the entity, its audit event, its version snapshot, and its
  search index can never drift apart, because they are written in **one Cosmos transactional
  batch**. This is also what makes the audit hash-chain tamper-evident (see §6).
- **Role enforcement** — the client role check is a UX affordance only; the **server** is the
  authority. `VIEWER` is strictly read-only.
- **AI server-side** / **grounded + cited** — the browser never sees a model credential, and any
  AI answer that invents facts instead of citing source documents is treated as a defect
  (see DEF-0018 in §9).
- **refId / form chips** — these identifiers (e.g. `GL.COV.002.003`, a form number `CG 00 01`)
  are how carriers and citations reference governed objects; stripping them breaks traceability.
- **HO-3 $1,528 canary** — the headline deploy gate; a wrong number means the rating engine
  regressed.
- **Design tokens** — theming/dark-mode integrity; hex outside `index.css` bypasses the token
  system.
- **Model IDs** — the fleet is pinned; `claude-fable-5` is explicitly forbidden.
- **Import no-cap** — import must never be starved by the cost guard, but must still be fully
  observable.

---

## 5. Frontend (`app/`)

### Router

`app/src/App.tsx` is the router. **All screens are `React.lazy`.** The tree is wrapped:

```
UserProvider → VersionWatcher → ErrorBoundary → Suspense → <Routes>
```

#### Public routes (no authenticated shell)

| Path | Component | Notes |
|---|---|---|
| `/` | `Landing.tsx` (640 LOC) | OTP email + bootstrap password sign-in |
| `/must-change-password` | `MustChangePassword.tsx` | forced password rotation |
| `/home-check` | `HomeCheck.tsx` (913 LOC) | **GUEST-accessible** consumer home-risk check, **no auth**, AI via `/api/homecheck/v1` |
| `*` | redirect → `/` | catch-all |

#### Authenticated shell — `/app` (`AppShell.tsx` guard, requires `user.email`)

| Path | Component | Notes |
|---|---|---|
| `/app` | `Home.tsx` | portfolio cockpit + grounded assistant chat |
| `/app/products` | `Products.tsx` | Cards ⇄ Hierarchy views |
| `/app/products/:id` | `ProductWorkspace.tsx` | `ProductProvider` + tab outlet |
| `/app/products/:id/overview` | `ProductOverview` | tab |
| `/app/products/:id/coverages` | `ProductCoverages` (357 LOC) | tab |
| `/app/products/:id/forms` | `ProductForms` (306 LOC) | tab |
| `/app/products/:id/pricing` | `ProductPricing` (327 LOC) | tab |
| `/app/products/:id/states` | `ProductStates` (158 LOC) | tab |
| `/app/products/:id/rules` | `ProductRules` (710 LOC) | tab |
| `/app/builder` | `Builder.tsx` | drafts: AI scaffold / import / clone |
| `/app/explorer` | `Explorer.tsx` | Miller-column cascade |
| `/app/tasks` | `Tasks.tsx` | GTM launch tracker kanban |
| `/app/news` | `News.tsx` (1209 LOC) | industry news |
| `/app/claims` | `Claims.tsx` (507 LOC) | grounded claims copilot (SSE) |
| `/app/dictionary` | `Dictionary.tsx` | data dictionary |
| `/app/feedback` | `Feedback.tsx` (932 LOC) | 3-lane feedback board |
| `/app/admin` | `Admin.tsx` (1305 LOC) | platform console |
| `/app/tenant-admin` | `TenantAdmin.tsx` | org self-service admin |

### State management

**React Context + hooks + an adapter polling cache.** **No Redux, no Zustand.**

| Context | Responsibility |
|---|---|
| `UserContext` | current user / session |
| `ProductContext` | **10 live subscriptions per product workspace** |
| `CaptureContext` | feedback drawer capture |
| `FeedbackLaunchContext` | opening the feedback drawer from anywhere |

### Adapter seam — `app/src/lib/backend/`

The single seam through which the SPA reaches the backend.

| File | LOC | Role |
|---|---|---|
| `index.ts` | — | barrel export |
| `types.ts` | 197 | `BackendAdapter` contract: `auth` / `db` / `storage` / `fns` / `presence` / `tenancy` / `orgAdmin` sub-interfaces |
| `azure.adapter.ts` | 465 | **sole implementation** — talks to `/api/*` |

- The **Firebase adapter is RETIRED**. `azure.adapter.ts` is the only implementation.
- `db.mutate` POSTs to `/api/db/mutate`; a `409` becomes a `MutationConflictError`.
- **`subscribe` = SMART POLLING** (Cosmos has no browser `onSnapshot`):
  - pauses when the tab is hidden,
  - geometric backoff **3500 ms → 30000 ms**,
  - dedupes,
  - stale-while-revalidate.
- **JWT** is stored in `localStorage` key **`pf.azure.token`**, sent as a `Bearer` header.
- **`X-Tenant-Id`** header carries a `SUPER_ADMIN` tenant override — **honored server-side only
  under a live break-glass grant**.
- **Client role checks in `lib/canI.ts` are NON-authoritative** — they mirror the server's
  `authz.js` for UX only. The server is the authority.

### Design system

- `app/src/index.css` (638 LOC) — **Tailwind v4 `@theme` tokens**: surfaces, an
  Accenture-violet accent **`--color-accent` `#8B1FE0`**, semantic status colors, fonts
  (SF / Inter + JetBrains Mono).
- **Dark mode** via `[data-theme=dark]`.
- `prefers-reduced-motion` guard.
- Theme runtime in `app/src/lib/theme.ts`.
- **This is the only place hard-coded hex is allowed** (Design-tokens invariant).

### PWA

- `sw.js` (136 LOC, dependency-free):
  - hashed assets → cache-first,
  - HTML → network-first,
  - `/api` → pass-through **except** the allowlist entry `/api/auth/tenants`,
  - `CACHE_NAME = prh-${BUILD_ID}` where `BUILD_ID` is the **git SHA stamped by Vite**.
- `VersionWatcher` polls `/version.json` to detect a new deploy and prompt reload.

### Notable dependencies

| Dep | Use |
|---|---|
| `react-router-dom` 7 | routing |
| `@dnd-kit` | drag rating steps |
| `exceljs` | Excel import/export (**code-split, must stay lazy** — bundle budget) |
| `fuse.js` | command palette fuzzy search |
| `sonner` | toasts |

### Tests

- **vitest** at root, `jsdom` per-file.
- **vitest-axe** a11y — `app/src/a11y.axe.test.tsx`.
- **Invariant suites** in `app/src/__invariants__/`: `server-invariants`, `no-bare-writes`,
  `server-security`.

---

## 6. Backend (`server/`) — full API surface

### Boot & middleware (`server/server.js`)

- **Fail-closed if `AUTH_JWT_SECRET` is unset** — the host refuses to start.
- Middleware order:
  1. disable `x-powered-by`
  2. `compression` (**bypasses SSE**)
  3. `express.json` (**25 mb** limit)
  4. `auth.attachUser`
  5. **global auth + write gate (defense-in-depth):**
     - `PUBLIC_API` allowlist: `/api/health`, `/api/auth/otp/request`,
       `/api/auth/otp/verify`, `/api/auth/bootstrap`, `/api/auth/tenants`, `/api/homecheck/*`
     - otherwise **401** if no user
     - break-glass denial → **403**
     - **GET passes**; write-shaped requests need **`product:write`** capability unless whitelisted
- Routers mounted in `try/catch`.
- SPA served **after** the API; unknown `/api/*` → **404 JSON**.

### Auth (`server/lib/auth.js`)

**Hand-rolled HS256 JWT** (base64url, `timingSafeEqual`, **8h TTL**, `jti` for revocation).

**Roles & RANK:**

| Role | Rank | Plane |
|---|---|---|
| `VIEWER` | 0 | tenant |
| inquiry personas | 1 | tenant |
| `EDITOR` | 2 | tenant |
| `TENANT_ADMIN` | 3 | tenant |
| `ADMIN` | 3 | tenant |
| `SUPPORT` | 0 | platform |
| `SUPER_ADMIN` | 4 | platform |

**Two-plane model:** tenant plane vs platform plane.

- **OTP login** — 6-digit code, **HMAC-stored**, 10-min TTL, 5 attempts, 15-min lockout.
- **Bootstrap admin login** — username + password, **only if `BOOTSTRAP_ADMIN_PASSWORD` is set**
  or the `BOOTSTRAP_USERS_ENABLED` dev flag is on.
- **JIT-provisions** users at `VIEWER`.
- **Domain allowlist** `ALLOWED_EMAIL_DOMAINS` + `TENANT_DOMAIN_MAP` → tenant.
- **Break-glass:** `SUPER_ADMIN` `X-Tenant-Id` override works **only with a live grant**
  (5 min – 8 h, reason required, audited).
- **Impersonation:** 1-h **dual-attributed** token; **can NEVER grant a platform role**.
- `attachUser` reads a `Bearer` header **or** a `pf_session` HTTP-only cookie.

### Data (`server/lib/data.js`)

- **Partition key:** `pkFor = ${tenantId}|${baseKey(path)}`.
- **`envelope()` → atomic `mutate()` = ONE Cosmos transactional batch** writing:

  | Component | Op |
  |---|---|
  | entity | Upsert / Delete |
  | audit | Create (**append-only**, `hash` + `prevHash` + `diff`) |
  | version | Upsert |
  | searchIndex | Upsert |
  | chainHead | Upsert |
  | groundingChunk | Upsert |

- **Optimistic concurrency:** `expectedRev` mismatch → **409**.

**Audit hash chain (tamper-evident):**

- `computeAuditHash` = **SHA-256** over
  `[tenantId, entityPath, entityType, op, actor, rev, at, source, diff, prevHash]`.
- `prevHash` comes from `chainHead`.
- **ETag guard:** `chainHead._etag` is used as `ifMatchETag` to prevent concurrent chain forks —
  the loser gets **412** and rebuilds (**3 attempts**).
- `verifyAuditChain` recomputes and walks links, detecting `hash_mismatch`, `link_broken`,
  `fork`, and `truncation`.
- Endpoint: **`/api/db/audit/verify`**.

### AI fleet (`server/lib/fleet.js` + `fleet-shared.cjs`, from `shared/src/ai/fleet.ts`)

| Role | Deployment | Price (per MTok in / out) |
|---|---|---|
| `GROUNDED_CITED` | `claude-opus-4-8` | $15 / $75 |
| `MID_REASONER` | `claude-sonnet-5` | $3 / $15 |
| `BULK_VERIFY` | `claude-haiku-4-5` | $0.8 / $4 |
| `VISION` | `gpt-5.1` | — |
| `CHEAP_GENERAL` | `gpt-5-mini` | — |
| `EMBED` | `text-embedding-3-small` | — |

- **Cost guard:** rolling **1-hour** window, **$25 ceiling**, **soft-degrade at 80%**,
  **per-instance** (see RISK-005).
- **`IMPORT_CONTEXT = 'import-no-cap'`** always allows (no degrade) but **ALWAYS records
  telemetry**.
- **Escalation ladder:** haiku → sonnet → opus.

### AI features

| Feature | Behavior |
|---|---|
| **chat** | portfolio copilot, RAG grounding, citation verification, SSE |
| **summarizeProduct** | Haiku, **forced tool** |
| **unifiedImport** | the import brain (see below) |
| **analyzeClaim** | claims copilot; PDF form + grounding; **downgrades verdict to `NOT_ADDRESSED` if there is no cited reasoning**; treats the form as **untrusted / prompt-injection sandbox** |
| **scaffoldProduct** | AI product scaffold |
| **draftRule** | AI rule drafting |
| **proposeMapping** | **Opus proposer + gpt-5.1 validator ensemble** |
| **identifyBaseForm** | **regex-first**, AI fallback |
| **reindexProduct** | rebuild embeddings |

**RAG design:**

- **PORTFOLIO baseline** — all product chunks up to **200**.
- **DETAIL** — semantic **top-18** of up to **400**.
- **Hybrid score:** dense (**int8 cosine**) + lexical, **`HYBRID_ALPHA = 0.72`**.
- Chunks stored in Cosmos in the **same partition**, embedded at write time (best-effort).

**Citations:**

- Models emit bracketed refs, e.g. `[PH.PROD.001]`, `[CG 00 01]`.
- The server **extracts + verifies** them against the retrieved context.
- Unverified refs → a notice (not silently trusted).

### Import brain (`server/ai/unified-import.js` + `import-brain/`)

- **Stage-0 router** uses **magic-byte sniffing (not filename):**
  - XLSX / CSV → structural model → brain
  - text PDF → filing pipeline
  - scanned PDF → vision
- **6-stage adaptive brain:**
  1. sheet classify
  2. header lock
  3. column → field map (**parallel reasoners + reconcile**)
  4. row extract (multi-`refId`, `refId` synthesis)
  5. **adversarial validation via gpt-5.1** (decorrelated from Anthropic)
  6. reconcile
- **The brain WRITES NOTHING** — the app persists results via the standard `db.mutate`.
- **Every field cites its source cell** as `sheet!cell`.
- **SSE heartbeat `:hb` every 15 s** (Azure kills idle connections at 230 s).

### Rate limiting & resilience

- **In-process token buckets**, keyed on `x-forwarded-for`: login **10/hr**, tenants **60/hr**,
  HomeCheck risk **10/hr**, etc.
- SSE helpers live in `server/lib/_shared.js`.
- `fetchWithRetry` — exponential backoff on **408 / 429 / 5xx**.

---

### Full endpoint tables

#### Auth — `/api/auth`

| Method + Path | Notes |
|---|---|
| `POST /api/auth/otp/request` | rate-limited; **generic OK on bad domain** (anti-enumeration) |
| `POST /api/auth/otp/verify` | → JIT user + JWT + cookie |
| `POST /api/auth/bootstrap` | username + password → `SUPER_ADMIN`; **bootstrap accounts only** |
| `GET /api/auth/tenants` | login dropdown |
| `GET /api/auth/me` | current session |
| `POST /api/auth/logout` | revoke `jti` + clear cookie |
| `POST /api/auth/change-password` | **min 12 chars** |

#### Data — `/api/db`

| Method + Path | Notes |
|---|---|
| `GET /api/db/get` | single entity |
| `POST /api/db/list` | cursor-paged, field allowlist, **MAX_LIST 6000** |
| `POST /api/db/mutate` | **`product:write`**, atomic envelope |
| `POST /api/db/mutateBatch` | grouped by pk, **96 ops** |
| `POST /api/db/vote` | feedback voting |
| `POST /api/db/setNewsPins` | pin news |
| `POST /api/db/presence/join` | presence |
| `POST /api/db/presence/watch` | presence |
| `GET /api/db/audit` | **only if `PROBE_MODE=1`** |
| `GET /api/db/audit/verify` | reconstruct + verify hash chains |

#### AI — `/api/ai` (`POST /:name`, capability `ai:invoke`)

Names: `chat`, `summarizeProduct`, `unifiedImport`, `scaffoldProduct`, `draftRule`,
`analyzeClaim`, `proposeMapping`, `shapeFeedback`, `refreshNews`, `identifyBaseForm`,
`reindexProduct`.

| Condition | Response |
|---|---|
| unconfigured | **503** |
| unknown name | **501** |

#### Admin — `/api/admin` (`requirePlatform`: `SUPER_ADMIN` / `SUPPORT`)

| Method + Path | Notes |
|---|---|
| tenants CRUD + `/:id/summary` | tenant management |
| users CRUD | **passwords stripped** from responses |
| break-glass `grant` / `end` / `list` | **5 min – 8 h**, audited |
| `audit/search` | `data` \| `platform`, cursor-paged |
| `impersonate` | **1-h dual-attributed** token |

#### Tenant-admin — `/api/tenant-admin` (`member:manage`, same-tenant)

| Method + Path | Notes |
|---|---|
| members CRUD + role / disable | org self-service |
| audit | tenant-scoped audit |

#### SERFF — `/api/serff/v1`

| Method + Path | Notes |
|---|---|
| `POST /api/serff/v1/bundle` | **EDITOR**; diff two products → Texas SERFF bundle + AI memo |
| `GET /api/serff/v1/states` | supported states |

#### Filing — `/api/filing`

| Method + Path | Notes |
|---|---|
| `POST /api/filing/generate` | 5-step **SCOPE / RESOLVE / BUILD / VERIFY / FREEZE**; **201** freeze / **422** rejected |
| `GET /api/filing` | list frozen filings |
| `GET /api/filing/:id` | one filing |

#### Storage — `/api/storage`

| Method + Path | Notes |
|---|---|
| `POST /api/storage/upload` | **EDITOR**; base64 → blob; path sanitized |
| `GET /api/storage/url` | signed URL |

#### HomeCheck (guest) — `/api/homecheck/v1` (no auth, IP rate-limited, **zero portfolio access**)

| Method + Path | Notes |
|---|---|
| `POST /api/homecheck/v1/risk` | home-risk analysis (IP rate-limited) |
| `POST /api/homecheck/v1/report-html` | render report |
| `POST /api/homecheck/v1/inventory` | create inventory (vision via GPT) |
| `GET /api/homecheck/v1/inventory/:sessionId` | read |
| `DELETE /api/homecheck/v1/inventory/:sessionId` | delete |
| `GET /api/homecheck/v1/inventory/:sessionId/export` | export |
| `POST /api/homecheck/v1/twin-diff` | compare |

---

## 7. The `shared/` engine

`shared/` is **pure TypeScript with ZERO platform imports** — it can run in the browser, in the
Express host (via the `*-shared.cjs` bundles), and in tests unchanged.

### Rating evaluator — `shared/src/rating/evaluator.ts` (168 LOC)

- Pure function `evaluate(program, inputs, rtGetter, ldGetter)`.
- Steps sorted by `order`.
- Ops: **`SET` / `MUL` / `ADD` / `MIN_FLOOR`**.
- Sources: **`CONST` / `INPUT` / `LD` / `RT` / `SPP`**.
- **Opt-in maximum-credit cap** via `creditFloor`.

### Rating canaries — the deploy gate

| Canary | Value | Test |
|---|---|---|
| **HO-3** | **$1,528** | `shared/src/rating/evaluator.test.ts` — intermediate trace byte-exact |
| **PA** | **$1,002** | rating tests |
| **GL** | **$2,635** | rating tests — ⚠️ **was $2,789 in older screenshots**; reviewers should treat $2,635 as current |
| per-line | worked example | `workedExample.canary.test.ts` |

> ⚠️ **Reviewer note:** any documentation/screenshot showing **GL = $2,789** is stale. The live
> canary is **$2,635**.

### Types — `shared/src/types.ts` (730 LOC)

Core entities: `Product`, `Coverage` (`parentId` nesting), `Rule`, `RatingStep`,
`RatingProgram`, `LDTable`, `RTTable`, `Form`. `GovernanceBlock.rev` is the conflict guard. The
`refId` scheme is **owned by the LOB registry**.

### LOB registry — `shared/src/lobRegistry.ts` (612 LOC)

5 lines: `PH.LOB.001` / `PA` / `GL` / `IM` / `PR`. Each carries a **`RefIdScheme`**
(PH/PA/GL use dotted forms like `GL.COV.002.003`; IM/PR use different shapes),
`footprintStates`, a peril model, and `supportsRulesSimulation` (**PH/PA/GL only**).

### Seed dataset — `shared/src/seed/`

`personalHome.ts` (858 LOC) is the **reference line**. This is the canonical PH/PA/GL dataset the
rating canaries are built on.

### Import contract

| File | LOC | Role |
|---|---|---|
| `canonicalMap.ts` | 734 | canonical field dictionary = **grounding for the model-driven mapper** (NOT a string matcher) |
| `validateAgainstExpected.ts` | 171 | **pure offline judge**: precision / recall / F1 / refId-exactness / orphans / enum-conformance |

### Other shared modules

- `gtmProcess.ts` — **GENERATED** (65 L4 tasks from the Process Value Explorer, per ADR-0006).
- `audit/chain.ts` — the audit hash-chain primitives.
- `retrieval/chunk` + `retrieval/retrieve` — RAG chunking + retrieval.
- `cost/breaker` + `cost/budget` + `cost/semanticCache` — cost control primitives.
- `serff/*` — SERFF bundle logic.
- `grounding/citations` — citation extraction/verification.

---

## 8. CI/CD & deployment

### `azure-pipelines.yml` stages

| # | Stage | Gate behavior |
|---|---|---|
| 1 | Node 20 | pinned |
| 2 | `pnpm install --frozen-lockfile` | reproducible install |
| 3 | **GITLEAKS full-history secret scan** | **blocks deploy** |
| 4 | typecheck (`pnpm -r`) | |
| 5 | **RATING CANARIES** (`pnpm --filter @pf/shared test`) | **a red canary blocks deploy** |
| 6 | Vite build | |
| 7 | **bundle-size budget gate** (`scripts/check-bundle-budget.mjs`) | `initialCriticalJs` **175 KB gz**; **exceljs must stay lazy** |
| 8 | assemble Express host artifact | |
| 9 | deploy `AzureWebApp` | → `app-prodhub-dev` |

- **Trigger:** `main`, `batch`, `pr: none`.
- **Local gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (available as `/gate`).
- `.gitleaks.toml` — `useDefault` + **3 allowlisted false-positives**.

> **Note on the gitleaks gate:** the ADO deploy runs gitleaks on a **shallow clone** (scans the
> tip tree only), so tree-level fixes suffice; but the pipeline's own listed stage is described as
> **full-history**. Treat any committed secret as blocking regardless.

---

## 9. Hardening & known posture

- `hardening/ledger.md` — **50 DEF entries**, current **SUMMARY OPEN: 0**.
- Notable historical defects:

| ID | Severity | What |
|---|---|---|
| **DEF-0018** | **CRITICAL** | portfolio-chat **citation fabrication** — fixed by an anti-fabrication stack |
| **DEF-0036** | — | Foundry key leaked into `tmp.md` git history |
| **DEF-0041 / 0042** | — | bootstrap admin secrets |

- `hardening/mutations.md` — a **fault-injection checklist** (each mutation should turn the gate
  red, then be reverted).
- **Prompt-injection defense** lives in the `claims` / `import` / `identify` handlers via
  **untrusted-data sandbox blocks** — model-facing content is fenced so instructions inside a
  claim form or an imported document cannot hijack the system prompt.

---

## 10. ADRs

All under `docs/adr/`.

| ADR | Title | One-liner |
|---|---|---|
| 0001 | model-ids | model selection + Sonnet 5 sampling constraints |
| 0002 | agent-workflow | agent workflow, the gate, commit cadence |
| 0003 | enhancement-baseline | enhancement baseline |
| 0004 | guest-read-floor | guest (anonymous) read-only floor + `VITE_ALLOW_GUEST` (**see drift note in §11**) |
| 0005 | filing-importer | 2nd ingestion mechanism: carrier rate-filing PDFs → governed product; NJ Lemonade HO reference; evaluator credit-cap extension |
| 0006 | process-value-explorer | deterministic Process Value Explorer → GTM process converter (4E drop, fixture + generator) |

---

## 11. Known constraints a reviewer should be aware of

1. **RISK-005 single-instance requirement.** The AI cost guard, rate limiters, JWT revocation
   cache, and HomeCheck session store are **all in-memory** and do **not** survive scale-out.
   Running more than one instance silently breaks cost enforcement, rate limiting,
   logout/revocation, and HomeCheck.

2. **`functions/` is reference-only, not deployed.** It still contains **stale
   `claude-sonnet-5` / `claude-haiku` model defs** and **`AWS-SWAP` markers**. Do not treat it as
   the source of truth for model IDs — `shared/src/ai/fleet.ts` and `server/lib/fleet.js` are.

3. **Dev Cosmos is IP-firewalled** — no local writes/reads from outside Azure. Reseeding is done
   in-Azure via `/api/ai/reindexProduct`.

4. **Client role checks are non-authoritative** (`app/src/lib/canI.ts`). Only the server
   (`server/lib/auth.js` + `data.js`) enforces authorization.

5. **Hand-rolled JWT + HMAC OTP** (not a vetted library) — worth a dedicated security look
   (`server/lib/auth.js`).

6. **In-memory rate limiters / cost guard / revocation cache** don't survive scale-out (restates
   RISK-005 from the auth/limit angle).

7. **Documentation drift:** ADR 0004 (guest-read-floor) references **`VITE_ALLOW_GUEST`, which NO
   LONGER EXISTS in code.** Guest access today is **only** the `/home-check` public route.

8. **GL canary value drift:** older screenshots show GL = **$2,789**; the live canary is
   **$2,635** (see §7).

---

## 12. Appendix — quick file-path index

Absolute-path anchors a reviewer can navigate to.

| Concern | Path |
|---|---|
| Project instructions / invariants | `CLAUDE.md` |
| SPA router | `app/src/App.tsx` |
| Adapter contract | `app/src/lib/backend/types.ts` |
| Adapter impl (sole) | `app/src/lib/backend/azure.adapter.ts` |
| Client role checks (non-authoritative) | `app/src/lib/canI.ts` |
| Design tokens (only place for hex) | `app/src/index.css` |
| Service worker | `app/src/sw.js` (or `app/sw.js`) |
| A11y test | `app/src/a11y.axe.test.tsx` |
| Invariant test suites | `app/src/__invariants__/` |
| Express boot + middleware | `server/server.js` |
| Auth (JWT / OTP / roles / break-glass) | `server/lib/auth.js` |
| Data / atomic envelope / audit chain | `server/lib/data.js` |
| AI fleet + cost guard | `server/lib/fleet.js`, `server/lib/fleet-shared.cjs` |
| SSE helpers | `server/lib/_shared.js` |
| Import brain | `server/ai/unified-import.js`, `server/import-brain/` |
| Rating evaluator | `shared/src/rating/evaluator.ts` |
| HO-3 canary | `shared/src/rating/evaluator.test.ts` |
| Per-line canary | `shared/src/rating/workedExample.canary.test.ts` |
| Domain types | `shared/src/types.ts` |
| LOB registry | `shared/src/lobRegistry.ts` |
| Seed (reference line) | `shared/src/seed/personalHome.ts` |
| Import canonical dictionary | `shared/src/import/canonicalMap.ts` |
| Import offline judge | `shared/src/import/validateAgainstExpected.ts` |
| AI fleet constants (deployed source) | `shared/src/ai/fleet.ts` |
| Audit chain primitives | `shared/src/audit/chain.ts` |
| Generated GTM process | `shared/src/gtmProcess.ts` |
| CI/CD pipeline | `azure-pipelines.yml` |
| Bundle budget gate | `scripts/check-bundle-budget.mjs` |
| Gitleaks config | `.gitleaks.toml` |
| Defect ledger | `hardening/ledger.md` |
| Fault-injection checklist | `hardening/mutations.md` |
| ADRs | `docs/adr/0001..0006` |
| Deploy guide | `docs/DEPLOY_AZURE.md` |

---

*End of context dossier. Reviewer: start with §4 (invariants) and §6 (API surface); use §11 as a
standing list of things to probe.*
