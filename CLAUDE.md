# Product Reinvention Hub

pnpm monorepo: `app/` (React/Vite) · `shared/` (types, rating, seed) · `server/` (Azure App
Service host: Express + Cosmos + Foundry AI + Blob) · `functions/` (AI plumbing — retained as
reference, not deployed; see [functions/CLAUDE.md](functions/CLAUDE.md)).
Azure backend: the app talks to a same-origin `/api/*` host — JWT auth, Cosmos data, Foundry
Claude AI, Blob storage. See workspace guides below before touching any workspace.

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

## Read first

Before starting any session, read this file **and** the workspace guide for the area you are touching:

- [app/CLAUDE.md](app/CLAUDE.md) — React frontend
- [functions/CLAUDE.md](functions/CLAUDE.md) — Cloud Functions / AI plumbing
- [shared/CLAUDE.md](shared/CLAUDE.md) — shared types, rating engine, seed

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

## Hardening campaign (2026-07-12, branch feat/hardening-2026-07)

**Work queue:** [docs/audit/EXECUTION.md](docs/audit/EXECUTION.md) -- update checkboxes continuously.

### Gate (non-negotiable)

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Must stay green after every commit. Rating canaries $1,528 / $1,002 / $2,635 are deploy blockers.

### Architecture invariants (from HANDOFF.md section 3)

These are non-negotiable in addition to the binding invariants above:

| Invariant | Enforcement |
|---|---|
| Adapter seam | oxlint no-restricted-imports; TS2307 |
| Atomic mutations | source-audit test (DEF-0044/0047) |
| Role enforcement | requireRole middleware; source-audit test |
| AI server-side | oxlint; no SDK in app/src/ |
| AI grounded+cited | SYSTEM prompt; source-audit test (DEF-0045) |
| refId chips | never strip |
| HO-3 $1,528 canary | CI gate; deploys fail otherwise |
| Model IDs | claude-opus-4-8 (GROUNDED_CITED), claude-haiku-4-5 (BULK_VERIFY); never claude-fable-5 |
| Design tokens | No hard-coded hex in browser code |

### Do-not-change list (from HANDOFF.md section 8)

- `shared/src/rating/evaluator.ts` canary behavior (unless fixing a documented bug with a new canary value)
- `app/src/lib/backend/azure.adapter.ts` interface surface (extending is fine; renaming public methods breaks all callers)
- `server/lib/auth.js` RANK ordering or JWT format -- exception: adding `jti` claim for RISK-006 is additive/backward-compatible
- `azure-pipelines.yml` gate steps (adding steps is fine; removing the canary or budget check is not)
- DuckCreek golden XML fixtures (`shared/src/duckcreek/__golden__/*.xml`) unless serializer semantics change

### Commit format

```
type(RISK-00X): summary line
type(REQ-X): summary line
```

One ID per commit. No em-dashes, no en-dashes, no emoji in any new code, comment, or doc.

### Blocked item protocol

After 3 failed attempts on any item: mark it **BLOCKED** in EXECUTION.md with failure notes and move on.
Do not re-attempt a blocked item in the same session.
