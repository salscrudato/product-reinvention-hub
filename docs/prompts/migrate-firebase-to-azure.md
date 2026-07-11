# Prompt: Migrate all Firebase / GCloud to Azure

Paste this entire prompt into a new Claude Code session from the repo root.

---

## Context

This is a pnpm monorepo (`app/` · `functions/` · `shared/` · `server/`) that has
been partially migrated to Azure App Service.  The **frontend** already talks to the
Azure host (`server/server.js`) through `app/src/lib/backend/azure.adapter.ts`.
`server/server.js` already mounts four route families: `auth` (JWT), `db` (Cosmos),
`ai` (Foundry/Anthropic SSE), and `storage` (Azure Blob) — but most of the actual
implementation inside those mounts is incomplete or a stub because the real business
logic still lives in **`functions/src/`** (Firebase Cloud Functions).

**Goal:** move all of that logic out of `functions/src/` and into `server/lib/`, so
the app has zero dependency on Firebase and Google Cloud at runtime.

---

## Current Firebase surface to replace

Read these files before writing anything:

| File | What it does |
|---|---|
| `functions/src/runtime.ts` | Anthropic client, model constants, Firebase ID-token verify, role guard, SSE helpers, secrets |
| `functions/src/ai.ts` | Portfolio chat (SSE, tool-grounded) |
| `functions/src/claims.ts` | Coverage copilot — `analyzeClaim`, `identifyBaseForm` |
| `functions/src/extract.ts` | Structured extraction (`tool_choice: {type:"tool"}`) |
| `functions/src/news.ts` | Market-news scout + `nightlyNews` scheduler |
| `functions/src/rules.ts` | Grounded rule drafting |
| `functions/src/scaffoldProduct.ts` | Product scaffold |
| `functions/src/admin.ts` | `setUserRole` — writes role to user record |
| `functions/src/audited.ts` | Atomic entity + audit + version + searchIndex write |
| `functions/src/costGuard.ts` | Per-UID token-cost gate |
| `functions/src/describeForm.ts` | Form description |
| `functions/src/exportDuckCreek.ts` | DuckCreek export |
| `functions/src/filingImport.ts` | Filing importer |
| `functions/src/unifiedImport.ts` | Unified ingestion pipeline |
| `functions/src/portfolioDigest.ts` | Portfolio digest |
| `functions/src/summarize.ts` | Product summaries |
| `functions/src/invalidate.ts` | 9 Firestore-triggered cache-invalidation functions |
| `functions/src/retrieval/` | Grounding chunks: Cosmos KNN or lexical fallback |
| `functions/src/telemetry.ts` | AI usage append-only log |
| `functions/src/tools.ts` | Grounding tool surface (product read tools for the AI) |
| `functions/src/semanticCache.ts` | Semantic response cache |
| `functions/src/shapeFeedback.ts` | Shape feedback collection |
| `functions/src/sources.ts` | Source document registry |

Also read:
- `app/src/lib/backend/azure.adapter.ts` — what the frontend currently calls on `/api/*`
- `server/server.js` — what's already mounted
- `server/lib/auth.js` — the JWT auth system already in place
- `server/lib/data.js`, `server/lib/ai.js`, `server/lib/storage.js` — existing stubs (read them to understand what's complete vs placeholder)
- `docs/DEPLOY_AZURE.md` — Azure resource names, App Service settings, ADO pipeline
- `CLAUDE.md` — binding invariants (do not break any of them)

---

## Azure equivalents

| Firebase service | Azure replacement |
|---|---|
| `firebase-admin/firestore` | `@azure/cosmos` (Cosmos DB for NoSQL) — already used in `server/lib/data.js` |
| `firebase-admin/auth` (verifyIdToken) | `server/lib/auth.js` JWT verify — already exists |
| `firebase-admin/auth` (setCustomUserClaims) | Update user document in Cosmos `users` collection + re-issue JWT |
| `firebase-admin/storage` | `@azure/storage-blob` — already mounted at `/api/storage` |
| `defineSecret('ANTHROPIC_API_KEY')` | `process.env.ANTHROPIC_API_KEY` (set in App Service environment variables) |
| `defineSecret('VOYAGE_API_KEY')` | `process.env.VOYAGE_API_KEY` (same) |
| `firebase-functions/v2/https` `onRequest` / `onCall` | Express `router.post(...)` handlers in `server/lib/` |
| `firebase-functions/v2/firestore` `onDocumentWritten` | Cosmos DB change-feed listener (`ChangeFeedIterator`) in a background worker or triggered from the mutation path |
| `firebase-functions/v2/scheduler` `onSchedule` | `node-cron` schedule inside `server/server.js` (or a separate background process) |
| Firebase Secrets Manager | Azure Key Vault references on App Service settings (already documented in `docs/DEPLOY_AZURE.md`) |
| Firebase emulators (Auth/Firestore/Functions/Storage) | Azurite (Azure Storage emulator) + Cosmos DB emulator for local dev |

---

## Binding invariants — do not break

These are in `CLAUDE.md` and are enforced by the gate + PR review:

1. **Adapter seam** — all app reads/writes go through `app/src/lib/backend/`.  
   `azure.adapter.ts` is already the active adapter.  Do not touch `app/` component
   code or import Cosmos/Azure SDKs inside `app/`.

2. **Atomic mutations** — every entity write must atomically commit entity +
   auditEvent + version + searchIndex.  This is currently done in
   `functions/src/audited.ts`.  Port that logic into `server/lib/data.js` (or a
   `server/lib/audited.js` module it calls).  The Azure adapter already calls
   `adapter.db.mutate()`; the server-side implementation of that endpoint is what
   must be atomic.  Use a Cosmos DB transactional batch (`container.items.batch()`)
   scoped to the same partition key.

3. **Role enforcement** — VIEWER is read-only.  Every `/api/db` write route and every
   `/api/ai` route must check the JWT role extracted by `auth.requireAuth` /
   `auth.attachUser` before doing any work.  Mirror the same checks that exist in the
   Firestore security rules.

4. **AI server-side** — the Anthropic client lives in `server/lib/` only.  No
   Anthropic key or call ever reaches the browser.

5. **AI grounded + cited** — AI responses must cite source documents.  The tool
   surface in `functions/src/tools.ts` must be ported faithfully to
   `server/lib/tools.js` (or `.ts` if the server workspace is TypeScript).

6. **HO-3 $1,528 canary** — `shared/src/rating/evaluator.test.ts` must still pass.
   This test is pure TypeScript with no platform imports.  Do not touch it.

7. **Model IDs** — `claude-sonnet-5` (reasoning) and `claude-haiku-4-5`
   (bulk/simple), defined once in `server/lib/runtime.js` (the Azure successor to
   `functions/src/runtime.ts`).  Never `claude-fable-5`.  Never hardcode a model
   string outside that one file.

8. **No sampling params on Sonnet 5** — the model uses adaptive thinking by default
   and rejects `temperature`, `top_p`, `top_k` with HTTP 400.  Do not add them.

9. **Design tokens** — no hard-coded hex outside `app/src/index.css`.

---

## Implementation plan (execute in this order)

### Phase 1 — Runtime foundation (`server/lib/runtime.js`)

Create `server/lib/runtime.js` as the Azure successor to `functions/src/runtime.ts`:

- Export `MODEL = 'claude-sonnet-5'` and `MODEL_FAST = 'claude-haiku-4-5'`.
- Build the Anthropic client from `process.env.ANTHROPIC_API_KEY` (throw at startup
  if missing — fail fast, don't silently degrade).
- Export the same `openSse(res)`, `send(res, event)` SSE helpers (copy them from
  `functions/src/runtime.ts` — they are plain HTTPS and need no changes).
- Export `voyageKey()` that returns `process.env.VOYAGE_API_KEY || undefined`.
- The `authenticate(req)` function already lives in `server/lib/auth.js`.  Export a
  `requireRole(minRole)` middleware from `runtime.js` that calls `auth.requireAuth`
  then checks role.

### Phase 2 — Data layer (`server/lib/data.js`)

Read the existing `server/lib/data.js` stub.  Complete it so it:

- Connects to Cosmos DB using `@azure/cosmos` with `process.env.COSMOS_ENDPOINT` +
  `process.env.COSMOS_KEY` (or managed identity via `DefaultAzureCredential`).
- Exposes `GET /api/db/:path(*)` for document + collection reads (mirrors
  `adapter.db.get()` and `adapter.db.list()` call shapes from `azure.adapter.ts`).
- Exposes `POST /api/db/mutate` for atomic writes (entity + auditEvent + version +
  searchIndex).  Use a Cosmos transactional batch.  Return `{ rev }` on success;
  return HTTP 409 on version conflict (the adapter catches `MutationConflictError`
  on 409).
- Exposes `GET /api/db/search?q=...` for the search-index query path.
- Port the `audited.ts` logic (version counter, auditEvent shape, searchIndex upsert)
  into a `mutate()` helper inside this file.

Collections to mirror (from `functions/src/audited.ts` and the Firebase adapter):
`products`, `products/{pid}/coverages`, `products/{pid}/rules`,
`products/{pid}/formRules`, `products/{pid}/ratingPrograms`, `forms`,
`dictionary`, `ldTables`, `rtTables`, `searchIndex`, `auditEvents`, `versions`,
`users`, `presence`, `newsPrefs`, `meta`.

### Phase 3 — Storage (`server/lib/storage.js`)

Read the existing `server/lib/storage.js` stub.  Complete it so it:

- Connects to Azure Blob Storage using `@azure/storage-blob` with
  `process.env.AZURE_BLOB_CONNECTION`.
- Exposes `POST /api/storage/upload` (multipart) — returns `{ storagePath }`.
- Exposes `GET /api/storage/download/:path(*)` — streams the blob.
- Exposes `DELETE /api/storage/:path(*)` — deletes a blob.

The only caller today is `claims.ts` which downloads a base-form PDF by storage
path.  The Azure adapter's storage surface must match the same interface.

### Phase 4 — AI routes (`server/lib/ai.js`)

This is the largest phase.  Port every AI function from `functions/src/` to Express
route handlers.  Read each source file fully before porting it.

Create `server/lib/ai.js` as the router.  Group routes by domain:

**Chat** (`functions/src/ai.ts` → `POST /api/ai/chat`)
- SSE streaming.  Grounded via the tool surface.  Use `openSse` / `send` from
  `runtime.js`.
- Port the grounding tools from `functions/src/tools.ts` → `server/lib/tools.js`.
  These tools call Cosmos (via `data.js`) to read product/form/coverage docs.
- Port `functions/src/semanticCache.ts` → `server/lib/semanticCache.js` (Cosmos
  `semanticCache` collection, server-only — no client access).
- Port `functions/src/costGuard.ts` → `server/lib/costGuard.js` (Cosmos
  `costCounters` + `config/costPolicy`).

**Claims** (`functions/src/claims.ts` → `POST /api/ai/claims/analyze`,
`POST /api/ai/claims/identify-base-form`)
- `identifyBaseForm` downloads a PDF from Azure Blob (via `storage.js`), then
  passes it to the Anthropic API.
- `analyzeClaim` reads product/coverage/form docs from Cosmos.
- SSE streaming on `analyzeClaim`.

**Extract** (`functions/src/extract.ts` → `POST /api/ai/extract`)
- Forced `tool_choice: { type: "tool", name: "..." }`.  No sampling params.

**Rules** (`functions/src/rules.ts` → `POST /api/ai/rules/draft`)
- Grounded rule drafting.

**Scaffold** (`functions/src/scaffoldProduct.ts` → `POST /api/ai/scaffold`)

**Describe form** (`functions/src/describeForm.ts` → `POST /api/ai/describe-form`)

**Filing import** (`functions/src/filingImport.ts` → `POST /api/ai/import/filing`)

**Unified import** (`functions/src/unifiedImport.ts` → `POST /api/ai/import/unified`)

**Portfolio digest** (`functions/src/portfolioDigest.ts` → `POST /api/ai/digest`)

**Summarize** (`functions/src/summarize.ts` → `POST /api/ai/summarize`)

**Shape feedback** (`functions/src/shapeFeedback.ts` → `POST /api/ai/feedback`)

**Export DuckCreek** (`functions/src/exportDuckCreek.ts` → `POST /api/ai/export/duckcreek`)

**Telemetry** (`functions/src/telemetry.ts`) — port to a helper in `server/lib/`
that appends to a Cosmos `aiUsage` collection.

**Retrieval** (`functions/src/retrieval/`) — port `firestoreStore.ts` to a Cosmos
store (`server/lib/retrieval/cosmosStore.js`).  The Cosmos SDK supports vector
indexing natively; use `container.items.query()` with a vector distance function
for KNN, or fall back to the lexical ranker if `VOYAGE_API_KEY` is absent (the
fallback path in `retrieval/` is already platform-agnostic).

### Phase 5 — Admin routes (`server/lib/admin.js`)

Port `functions/src/admin.ts`:
- `POST /api/admin/set-role` — ADMIN only.  Updates the user record in Cosmos
  `users` collection, then returns a fresh JWT with the new role embedded.
  (There is no Firebase custom-claim refresh delay — the new JWT is valid
  immediately.)

### Phase 6 — News + scheduler

Port `functions/src/news.ts`:
- `POST /api/ai/news/refresh` — on-demand news refresh (the on-demand version of
  `refreshNews`; was an HTTPS callable).
- Add a `node-cron` job inside `server/server.js` that fires at 06:00 ET daily
  (equivalent to the Firebase `nightlyNews` scheduler).  Import the refresh handler
  directly.

### Phase 7 — Invalidation (was Firestore triggers)

The 9 Firestore-triggered cache-invalidation functions in
`functions/src/invalidate.ts` fired on every write to products, coverages, rules,
formRules, ratingPrograms, forms, dictionary, ldTables, rtTables.

On Azure, trigger invalidation synchronously at the end of each successful
`POST /api/db/mutate` call: after the Cosmos batch commits, call the relevant
`invalidate(entityType, entityId)` helper.  This is simpler than a change-feed
listener and avoids eventual-consistency lag.  Port the invalidation logic (which
clears `groundingChunks`, `productSummaries`, `meta/dictionaryCorpusVersion`,
`meta/digestEpoch`) into `server/lib/invalidate.js` and call it from `data.js`.

### Phase 8 — Update the frontend adapter

`app/src/lib/backend/azure.adapter.ts` currently calls `/api/ai/*` using the same
path names that the Firebase callable functions had.  After Phase 4, verify that
every `fetch(...)` and SSE call in the adapter resolves to the new route paths.
Update any mismatches.  Do not change any component code.

### Phase 9 — Remove Firebase dead code

Once all routes are live and the gate is green:

1. Delete `functions/src/` entirely (or archive it as `functions/src/_firebase_archive/`).
2. Delete `app/src/lib/backend/firebase.adapter.ts` (dead code — not exported by `index.ts`).
3. Delete `app/src/lib/backend/firebase.config.ts`.
4. Remove `firebase`, `firebase-admin`, `firebase-functions` from all `package.json` files.
5. Remove `firebase.json`, `.firebaserc` (or keep `firebase.json` only if the emulator
   suite is still used for any integration test; if so, note which tests).
6. Remove the `cors:set` / `cors:get` gsutil scripts from root `package.json`.
7. Remove `VITE_USE_EMULATORS` logic from `app/` (no longer meaningful).
8. Update `CLAUDE.md` to remove Firebase references and update the "Adapter seam" invariant.

---

## Local dev (replace Firebase emulators)

After the migration, local dev needs:
- **Azurite** (`npx azurite`) — emulates Azure Blob Storage.
- **Azure Cosmos DB Emulator** — emulates Cosmos DB (or use the free-tier cloud endpoint).
- Update `pnpm dev:seed` (currently fires `firebase emulators:start`) to start Azurite
  instead.  The seed script (`scripts/seed.ts`) targets Firestore today; port it to write
  the same seed data to Cosmos using `@azure/cosmos`.
- `functions/.env.local` (currently holds the live `ANTHROPIC_API_KEY`) → move to
  `server/.env.local` (or root `.env.local`) with the new variable names:
  `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `COSMOS_ENDPOINT`, `COSMOS_KEY`,
  `AZURE_BLOB_CONNECTION`.

---

## Gate — must stay green throughout

Run after every phase:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

The `$1,528` HO-3 canary (`shared/src/rating/evaluator.test.ts`) is the headline
check — it must pass on every commit.  Run `/gate` to execute the full suite.

---

## What NOT to do

- Do not change `shared/` (pure TypeScript, no platform imports — it must stay that way).
- Do not import `@azure/cosmos` or any Azure SDK inside `app/`.
- Do not add `temperature`, `top_p`, or `top_k` to Sonnet 5 calls.
- Do not use `claude-fable-5`.
- Do not add Firebase or Google Cloud packages after Phase 9.
- Do not use bare Cosmos writes outside the `mutate()` helper — all entity writes must
  stay atomic (entity + audit + version + searchIndex).
- Do not strip `refId` chips or form-number chips from any UI component.
- Do not hard-code hex colors in components; use `var(--color-*)`.
