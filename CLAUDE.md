# Product Reinvention Hub

pnpm monorepo: `app/` (React/Vite) · `shared/` (types, rating, seed) · `server/` (Azure App
Service host: Express + Cosmos + Foundry AI + Blob) · `functions/` (AI plumbing — reference only, not deployed).
Azure backend: the app talks to a same-origin `/api/*` host — JWT auth, Cosmos data, Foundry
Claude AI, Blob storage.

## Quick start

```sh
pnpm dev     # Vite dev server for the app (talks to the /api host; set VITE_API_BASE to point at one)
```

The backend is the Azure App Service host in `server/` (Express + Cosmos + Foundry AI + Blob) —
run it locally per [docs/DEPLOY_AZURE.md](docs/DEPLOY_AZURE.md). Seed Cosmos with the canonical
PH/PA/GL dataset via `scripts/migrate-to-cosmos.ts` (see its header for the exact env + command).

## Gate — must stay green

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Use `/gate` to run it. The $1,528 HO-3 canary (`shared/src/rating/evaluator.test.ts`) is the headline check.

## Binding invariants

Break any of these and the PR is blocked.

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
| **Model IDs** | `claude-opus-4-8` (reasoning/GROUNDED_CITED) and `claude-haiku-4-5` (bulk/BULK_VERIFY), defined in `shared/src/ai/fleet.ts` (deployed) and `server/lib/fleet.js`. Never `claude-fable-5`. `functions/src/runtime.ts` is reference-only and NOT deployed. |

## Environment safety

Production runs on Azure App Service (see [docs/DEPLOY_AZURE.md](docs/DEPLOY_AZURE.md) and
`azure-pipelines.yml`): a push to `main` builds the Vite SPA, assembles the `server/` Express
host (Cosmos + Foundry AI + Blob), and deploys it. The browser only ever talks to the same-origin
`/api/*` host — it never holds a data-store or AI credential.

- **Secrets are server-side only.** Cosmos (`COSMOS_ENDPOINT` / `COSMOS_KEY`), Foundry
  (`AZURE_FOUNDRY_ENDPOINT` / `AZURE_FOUNDRY_KEY`) and Blob credentials live in App Service
  configuration and are read from `process.env` in `server/lib/*`. Never embed them in code or the
  client bundle.
- **Local dev** points the app at a running host via `VITE_API_BASE` in the gitignored
  `app/.env.development.local`; with it empty the app calls the same origin it is served from.
- **Tenant isolation** is enforced server-side: every read/write is scoped to the JWT's
  `tenantId` (partition key `${tenantId}|${base}` + a `c.tenantId` filter on every query).
- **Seeding Cosmos** uses `scripts/migrate-to-cosmos.ts` — the canonical PH/PA/GL dataset, the
  same one the $1,528 / $1,002 / $2,635 rating canaries are built on.

## ADRs

- [docs/adr/0001-model-ids.md](docs/adr/0001-model-ids.md) — model selection + Sonnet 5 sampling constraints
- [docs/adr/0002-agent-workflow.md](docs/adr/0002-agent-workflow.md) — agent workflow, gate, commit cadence
- [docs/adr/0003-enhancement-baseline.md](docs/adr/0003-enhancement-baseline.md) — enhancement baseline
- [docs/adr/0004-guest-read-floor.md](docs/adr/0004-guest-read-floor.md) — guest (anonymous) read-only floor + `VITE_ALLOW_GUEST`
- [docs/adr/0005-filing-importer.md](docs/adr/0005-filing-importer.md) — filing importer (second ingestion mechanism) + evaluator credit-cap extension
- [docs/adr/0006-process-value-explorer.md](docs/adr/0006-process-value-explorer.md) — deterministic Process Value Explorer → GTM process converter (4E drop, fixture + generator)

