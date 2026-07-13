# orchestration.md — multi-agent coordination (pushes, deploys, sync)

Multiple agents are working this codebase concurrently. This file is the coordination
channel. **Read it before you push or deploy; update it when your state changes.**
Commit changes to this file like any other change (small, frequent commits are fine).

## Non-negotiable end state

1. **Everything ships.** All work must ultimately be COMMITTED to local `main`,
   PUSHED to `origin/main` (ADO), and DEPLOYED. No staged-but-uncommitted code, no
   stashes left behind, no local-only commits, no side branches, no feature flags
   hiding unfinished work. If you created a branch to experiment, merge it to `main`
   and delete it before you finish.
2. **`main` is the only branch.** Commit locally on `main`, `git pull --rebase origin main`,
   resolve conflicts yourself, then push. Never force-push. Never rewrite history.
3. **Push = deploy.** ADO pipeline auto-deploys every push to `main` to
   `app-prodhub-dev` (~6-9 min, gated on typecheck + rating canaries + bundle budget).
   There is no separate deploy step — a green push IS the deploy.
4. **Gate before push.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
   must be green locally before you push. A red canary (PH $1,528 / PA $1,002 /
   GL $2,635) blocks the pipeline for everyone — do not push red.
5. **Shared CJS bundles are committed.** If you touch `shared/src/**` consumed by the
   server (`fleet`, `import`, `filing`, `retrieval`, `serff`), rebuild the matching
   `server/lib/*-shared.cjs` (`pnpm build:fleet`, `build:import-brain`, `build:filing`, …)
   and commit the bundle WITH your change — the server runs the bundle, not your TS.

## Coordination protocol

- **Before pushing:** `git pull --rebase origin main` (always — someone else has
  probably pushed since you last fetched). Re-run the gate if the rebase pulled in
  changes that touch your area. Then push.
- **Deploy awareness:** pushes batch in the pipeline (`batch: true`); your commit may
  ride along with another agent's. After pushing, verify YOUR sha (or a later one)
  reached a completed successful run before live-testing against dev:
  `az pipelines runs list --organization https://dev.azure.com/garage-repos --project "Product Hub" --top 1`
  (az lives at `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`).
- **Live testing on dev:** dev is SHARED. Use an isolated test tenant per workstream
  (e.g. `import-live-smoke`, `import-persist-probe`) and tear down what you create.
  Never mutate the `testco` tenant's seeded data — the rating canaries live there.
- **Conflicts in this file:** union-merge by hand — keep everyone's entries.
- **Finishing:** before you declare done, run `git status` — the tree must be clean —
  and confirm `origin/main` contains your final sha and the pipeline for it is green.

## Active workstreams (add yours; update status as you go)

| Agent / workstream | Area (files) | Status | Last sha pushed |
|---|---|---|---|
| import-brain (Claude, this session) | `server/lib/import-brain/**`, `server/lib/ai/unified-import.js`, `server/lib/fleet.js`, `shared/src/ai/fleet.ts`, `shared/src/import/structure/**`, `scripts/import-eval.mts`, `scripts/import-live.mts`, `tests/golden/**`, `server/server.js` (SSE/compression filter only) | Live-test loop in progress: golden eval + persist probe + robustness sweep running against dev; further fix waves may push | `2c3f1bf` |
| admin-control-plane (Claude) | `server/lib/auth.js`, `server/lib/authz.js`, `server/lib/admin.js`, `server/lib/tenant-admin.js`, `server/lib/data.js`, `server/server.js` (global auth/write gates only — SSE compression filter preserved), `app/src/routes/Admin.tsx`, `app/src/routes/TenantAdmin.tsx`, `app/src/components/shell/Topbar.tsx`, `app/src/lib/backend/**`, `app/src/lib/canI.ts` | In progress: bounded+audited admin surfaces, cookie session, break-glass tenant override | — |

**Note to other agents from import-brain:** please avoid editing the files in my area
column until my status reads "done" (fix waves are still landing). `server/server.js`
change is a 6-line compression filter for SSE — if you touch server.js, rebase and keep it.
