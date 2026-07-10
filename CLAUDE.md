# Product Reinvention Hub

pnpm monorepo: `app/` (React/Vite) · `functions/` (Cloud Functions / AI) · `shared/` (types, rating, seed).
Firebase backend (Firestore + Functions + Storage). See workspace guides below before touching any workspace.

## Quick start

```sh
pnpm dev:seed          # emulators + seed + Vite — one command, full local stack
pnpm seed              # re-seed only (emulators must already be running)
```

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
| **Adapter seam** | All app reads/writes go through `adapter` (`app/src/lib/backend/`). Never import Firebase SDK directly in components. |
| **Atomic mutations** | Every entity write uses `adapter.db.mutate()`. It batches entity + auditEvent + version + searchIndex atomically. No bare Firestore writes. |
| **Role enforcement** | `VIEWER` is read-only. Enforced in Firestore security rules **and** in every Function — both sides, always. |
| **AI server-side** | All Anthropic calls live in `functions/`. The browser never calls the Anthropic API. |
| **AI grounded + cited** | AI responses must cite their source documents. Free invention is a bug. |
| **refId / form chips** | `refId` and form-number chips are load-bearing display elements. Never strip them. |
| **HO-3 $1,528 canary** | `shared/src/rating/evaluator.test.ts` must produce exactly $1,528. |
| **Design tokens** | No hard-coded hex outside `app/src/index.css`. Use `var(--color-*)` in browser-rendered code. SVG files exported to disk are the only exception. |
| **Model IDs** | `claude-sonnet-5` (reasoning) and `claude-haiku-4-5` (bulk/simple), defined once in `functions/src/runtime.ts`. Never `claude-fable-5`. |

## Environment safety

Local dev and seed default to the **emulators**. Two guards stop a session from silently
touching the live `productreinvention` project (see `docs/reviews/GROUND_TRUTH.md` V12):

- **Dev app** — `pnpm dev` runs `scripts/guard-backend.mjs` before Vite. It resolves the
  effective `VITE_USE_EMULATORS` (Vite env-file precedence) and **refuses to start against live
  Firebase unless `ALLOW_LIVE=1`**, printing the target backend either way. For the full local
  stack use `pnpm dev:seed` with `VITE_USE_EMULATORS=true` in the gitignored
  `app/.env.development.local`.
- **Seed** — `scripts/seed.ts` targets emulators by default; the production path
  (`--project productreinvention`) is refused unless `ALLOW_LIVE=1`, and still requires the
  typed `seed-production` confirmation.

**Storage-emulator exception:** when `VITE_USE_EMULATORS=true` the adapter points Auth,
Firestore, Functions **and Storage** at the emulator (the "B8 footgun fix" in
`app/src/lib/backend/firebase.adapter.ts`). Storage was historically the one service left on the
LIVE bucket in emulator mode, so a local upload wrote production objects; it is now emulated
alongside the rest. The only place a local flow still touches a real bucket by design is the
production CORS helper (`pnpm cors:set` / `cors:get`), which operates on `gs://productreinvention.*`.

## ADRs

- [docs/adr/0001-model-ids.md](docs/adr/0001-model-ids.md) — model selection + Sonnet 5 sampling constraints
- [docs/adr/0002-agent-workflow.md](docs/adr/0002-agent-workflow.md) — agent workflow, gate, commit cadence
- [docs/adr/0003-enhancement-baseline.md](docs/adr/0003-enhancement-baseline.md) — enhancement baseline
- [docs/adr/0004-guest-read-floor.md](docs/adr/0004-guest-read-floor.md) — guest (anonymous) read-only floor + `VITE_ALLOW_GUEST`
- [docs/adr/0005-filing-importer.md](docs/adr/0005-filing-importer.md) — filing importer (second ingestion mechanism) + evaluator credit-cap extension
- [docs/adr/0006-process-value-explorer.md](docs/adr/0006-process-value-explorer.md) — deterministic Process Value Explorer → GTM process converter (4E drop, fixture + generator)
