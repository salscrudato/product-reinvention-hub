# Product Reinvention Hub

## MISSION

The platform converts semi-structured insurance documents (framework workbooks, rate
manuals, carrier filing PDFs) into a governed canonical Product Component Model and prices
it through a deterministic rating engine. This is the ingestion-hardening era: the import
brain is certified against a frozen holdout corpus, and every change is judged by whether
extraction stays grounded, cited, and byte-faithful to its sources while the four rating
canaries stay exact. Depth lives in the reverse-engineering docs; this file is only the
contract you must not break.

## NON-NEGOTIABLES

- Adapter seam: all app reads/writes go through `adapter` (`app/src/lib/backend/`); never
  import a platform SDK (Cosmos etc.) in a component.
- Atomic mutation envelope: every entity write uses `adapter.db.mutate()`; the `/api` host
  batches entity + auditEvent + version + searchIndex in one Cosmos transactional batch
  (`server/lib/data.js`). No bare data-store writes.
- Audit hash-chain: audit events are chained with an etag-guarded `chainHead`
  (`/api/db/audit/verify` must stay green); never write around the envelope.
- Canaries, read from the locked tests only: PH $1,528
  (`shared/src/rating/evaluator.test.ts`), PA $1,002
  (`shared/src/rating/workedExample.canary.test.ts`), GL $2,635
  (`shared/src/rating/generalLiability.evaluator.test.ts`), filing-import $1,281
  (`shared/src/insurance/filing/reconcile.test.ts`). Exact or broken.
- Citations-or-discarded: AI output must cite its source documents; uncited claims are
  dropped, free invention is a bug.
- Flag-not-invent: when a source does not establish a value, surface a notice; never
  fabricate a plausible one.
- refIds and form-number chips are load-bearing and byte-for-byte; never strip or
  normalize them.
- Model IDs come from the fleet registry only (`shared/src/ai/fleet.ts` +
  `server/lib/fleet.js`), routed through the in-process cost guard; never hardcode a model
  string. Import runs under the named `IMPORT_CONTEXT` guard exemption (never
  budget-denied, never degraded) but its telemetry is never bypassed.
- Secrets live in `process.env` only (App Service settings; local humans use the
  gitignored `keys.md`). Never in code, docs, or the client bundle.
- Quality floor: strict TypeScript; design tokens (`var(--color-*)`) with no hard-coded
  hex outside `app/src/index.css`; custom SVG only (no icon fonts); WCAG 2.2 AA; app
  bundle <= 175 KB gzip (exceljs chunk excepted).

## COMMANDS

- Gate (must be green before any commit): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- Bridge rebuilds: `pnpm build:fleet` / `pnpm build:filing` / `pnpm build:import-brain`
  (plus `build:serff`, `build:chunk`, `build:retrieve`, `build:seed`, `build:audit-chain`,
  `build:platform`, `build:news`; `pnpm build` runs them all then the app build)
- Eval: `pnpm import:eval` (import scoring), `pnpm import:live` / `pnpm live:smoke`
  (live endpoint harnesses)
- Dev boot: `pnpm dev` (Vite SPA; point it at a host with `VITE_API_BASE` in the
  gitignored `app/.env.development.local`); the API host is `node server/server.js` with
  env from App Service settings or your shell.

## LAYOUT

- `app/` React/Vite SPA (talks only to the same-origin `/api/*` host)
- `server/` Azure App Service Express host: Cosmos + Foundry AI + Blob; external
  data-source clients in `server/lib/external/` (read its README before any new upstream)
- `shared/` types, rating engine, import brain, seed data
- Bridges rule: `server/lib/*-shared.cjs` are esbuild artifacts. Edit `shared/src/**`,
  regenerate with the `build:*` script, never hand-edit a `.cjs`.

## FLEET

Roles route through `shared/src/ai/fleet.ts` (bridged to `server/lib/fleet-shared.cjs`):
GROUNDED_CITED = claude-opus-4-8 (reasoning, citations), MID_REASONER = claude-sonnet-5
(import escalation), BULK_VERIFY = claude-haiku-4-5 (bulk checks), plus VISION,
CHEAP_GENERAL, EMBED and the EXTENDED_DEPLOYMENTS specialty surfaces (deep reasoner,
cross-vendor verify, rerank, OCR). Never `claude-fable-5`. Never a hardcoded model string
in a handler - always a fleet role, always metered through the cost guard.

## WORKING AGREEMENTS

- One writer per worktree; parallel agents work in `.claude/worktrees/<lane>`, never in
  another lane's tree.
- Stowaway check before every commit: review `git status`, stage explicitly, use
  `git commit --only <paths>` discipline; never `git add -A` into someone else's
  in-flight edits.
- Push only with the lane's push token / explicit authorization; merge to local `main`
  and push once, then watch the pipeline to green.
- Tests are law: never weaken a test, threshold, canary, or golden to go green; fix at
  the cause.
- Verify-first: claims about behavior come from running the gate, booting the server, or
  hitting the endpoint - not from reading code alone.
