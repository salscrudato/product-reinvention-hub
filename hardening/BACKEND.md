# Hardening: Backend Reconciliation

## What is actually wired (source-authoritative)

The live backend is **Azure App Service** serving an Express host (`server/server.js`).
Every browser call goes to the same-origin `/api/*` prefix.  No Firebase, no AWS, no direct
Cosmos SDK in the browser.

| Layer | Technology | Implementation |
|---|---|---|
| Auth | Custom HS256 JWT (12 h TTL) | `server/lib/auth.js` — bootstrap users + Cosmos user store |
| Data | Azure Cosmos DB (NoSQL) | `server/lib/data.js` — transactional batches, tenant-partitioned |
| AI reasoning | Foundry → `claude-opus-4-8` | `server/lib/ai.js` + `server/lib/fleet.js` + `shared/src/ai/fleet.ts` |
| AI bulk | Foundry → `claude-haiku-4-5` | same fleet routing; BULK_VERIFY role |
| Vision | `gpt-5.1` (OpenAI via Foundry) | fleet VISION role; HomeCheck only |
| Storage | Azure Blob | `server/lib/storage.js` |
| Functions | **NOT deployed** | `functions/` workspace retained as reference; all AI handlers except `chat` and `summarizeProduct` return 501 |

## Adapter entrypoints

```
app/src/lib/backend/index.ts        — re-exports adapter singleton + all types
app/src/lib/backend/azure.adapter.ts — the single concrete BackendAdapter impl
app/src/lib/backend/types.ts        — BackendAdapter interface + MutationPayload + Query
```

All component reads/writes go through `adapter` imported from `src/lib/backend/`.  The adapter
talks exclusively to `/api/*` via plain `fetch` (token stored in `localStorage` under
`pf.azure.token`).  No platform SDK (Cosmos, Firebase, etc.) is imported in the browser.

### Key API routes (server-side)

| Method | Path | Guard | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | none | JWT sign-in (username + password + tenant?) |
| GET | `/api/auth/tenants` | none | tenant list (login dropdown) |
| GET | `/api/auth/me` | Bearer | validate + refresh user profile |
| POST | `/api/db/mutate` | EDITOR+ | atomic entity+audit+version+searchIndex batch |
| POST | `/api/db/mutateBatch` | EDITOR+ | multi-payload batch (NOT atomic across partitions) |
| GET | `/api/db/get?path=…` | VIEWER+ | single entity fetch |
| POST | `/api/db/list` | VIEWER+ | collection list (capped at MAX_LIST=1000) |
| POST | `/api/ai/chat` | ANALYST+ | SSE portfolio copilot (Opus grounded+cited) |
| POST | `/api/ai/summarizeProduct` | ANALYST+ | non-streaming product summary (Haiku) |
| POST | `/api/ai/:name` | ANALYST+ | wildcard; returns 501 for every other name |
| GET | `/api/admin/tenants` | ADMIN | unbounded tenant list (`.fetchAll()`) |
| GET | `/api/admin/users` | ADMIN | unbounded user list (`.fetchAll()`) |

## Deploy target and local dev

**Production deploy:** push to `main` triggers `azure-pipelines.yml` → Vite SPA build +
`server/` Express assembly → Azure App Service.  `server/` is NOT a pnpm workspace package —
it is a plain Node.js directory assembled separately by the pipeline.

**Local dev:**
1. Start the Express host: `node server/server.js` (requires env vars from App Service config —
   `COSMOS_ENDPOINT`, `COSMOS_KEY`, `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_KEY`,
   `AZURE_BLOB_CONNECTION`, `AUTH_JWT_SECRET`).
2. Start the Vite SPA: `VITE_API_BASE=http://localhost:3000 pnpm --filter app dev`.

There is no longer an emulator stack — the `emulators`, `dev:all`, `dev:seed`, `spinup`, and
`seed` scripts were removed when Firebase was retired.

## Code vs CLAUDE.md / documentation divergences

**1. Model IDs (binding invariant mismatch)**
CLAUDE.md states: *"Model IDs: `claude-sonnet-5` (reasoning) and `claude-haiku-4-5`
(bulk/simple), defined once in `functions/src/runtime.ts`."*  
Reality: `functions/src/runtime.ts` is in the **reference-only, not-deployed** `functions/`
workspace.  The deployed AI path (`server/lib/fleet.js` ← `shared/src/ai/fleet.ts`) uses:
- `claude-opus-4-8` for the `GROUNDED_CITED` role (portfolio chat)
- `claude-haiku-4-5` for the `BULK_VERIFY` role (product summaries)
- `gpt-5.1` for the `VISION` role (HomeCheck photo inventory)
- `gpt-5-mini` for the `CHEAP_GENERAL` (cost-degrade fallback)

The CLAUDE.md invariant binding `functions/src/runtime.ts` is stale relative to the deployed
fleet definition.  ADR-0001 predates the Azure migration.

**2. Firebase remnant in pnpm-workspace.yaml**
`pnpm-workspace.yaml` still allows `@firebase/util` in `allowBuilds`.  Firebase has been fully
removed from the app; this entry is inert but misleading.

**3. AWS-SWAP markers in functions/**
`functions/src/` contains dozens of `// AWS-SWAP:` comment markers (e.g., `audited.ts:14`,
`runtime.ts:5`, `admin.ts:4`, `retrieval/placeholder.ts:12,16,21,27`).  These are pre-migration
annotations from an earlier planned AWS cut-over that never shipped.  `functions/` is retained
as a reference implementation; the markers are dead but confusing.

**4. unifiedImport not ported (filing import broken on Azure)**
`adapter.fns.stream('unifiedImport', …)` → `POST /api/ai/unifiedImport` returns 501
`ai_handler_not_ported`.  The PDF/multi-format filing import path (NJ Lemonade HO filing,
ADR-0005) is NOT functional on the Azure host.  Only `chat` and `summarizeProduct` are ported.

**5. changePassword not persisted**
`server/lib/auth.js:29`: password overrides are stored in an in-process `Map` (`overrides`).
Changes are lost on server restart and never written to Cosmos.

**6. Hardcoded BOOTSTRAP users always active**
`server/lib/auth.js:25-28`: `admin`/`admin` and `sal.scrudato`/`sal.scrudato` are always
present regardless of Cosmos state.  `AUTH_JWT_SECRET` defaults to the literal string
`'dev-insecure-secret-change-me'` when the env var is absent (line 18).

**7. process-value-explorer.xlsx location**
`process-value-explorer.xlsx` is at `samples/process-value-explorer.xlsx`, not at the
repository root as some docs imply.

**8. GL canary value in harness spec**
The harness specification for this session cites GL canary "expected 2789".  The actual
authoritative value, per `shared/src/rating/generalLiability.evaluator.test.ts:27`, is
**$2,635**.  GROUND_TRUTH.md line 592 explicitly states: "the GL canary is $2,635 (see V15),
not $2,789."  The $2,789 figure appears only in stale documentation.  All harness assertions
use 2635.

## Optional slash commands

`.claude/commands/` directory exists with existing commands.  The five `harden-*` commands
have been registered there.

## signInAsDevAdmin

The originally-documented `signInAsDevAdmin()` adapter method **does not exist** in the current
codebase — it was removed during the Azure migration cleanup (see CLEANUP_REPORT.md and
GROUND_TRUTH.md V18).  DEF-0001 tracks the surviving equivalent risk: hardcoded BOOTSTRAP users
with trivial passwords in `server/lib/auth.js`.
