# 🎛️ Orchestration — multi-agent coordination

One repo, one branch, one shared dev environment, several agents. This file is the
coordination channel: **read it before you push; update it when your state changes.**

---

## The five rules

| # | Rule | In practice |
|---|------|-------------|
| 1 | **Everything ships** | All work ends up committed on `main`, pushed to `origin/main`, and deployed. No stashes, no side branches, no local-only commits, no flag-hidden features left behind. |
| 2 | **`main` only** | `git pull --rebase origin main` → resolve → push. Never force-push, never rewrite history. |
| 3 | **Push = deploy** | Every green push auto-deploys to `app-prodhub-dev` (~6–9 min). There is no separate deploy step. |
| 4 | **Gate before push** | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green locally first. A red canary (PH $1,528 / PA $1,002 / GL $2,635) blocks the pipeline for everyone. |
| 5 | **Bundles ride along** | Touching server-consumed `shared/src/**`? Rebuild the matching `server/lib/*-shared.cjs` (`pnpm build:fleet` / `build:import-brain` / `build:filing` / …) and commit it with the change. The server runs the bundle, not your TS. |

## ⚠️ Hazards

- **Deploys sever in-flight SSE.** Every push restarts dev; streaming requests in
  flight die with `fetch: terminated`. **Batch pushes** (one per fix wave) and make
  live harnesses retry (import-eval / import-live already retry 3× with 45 s warm-up).
- **Shared working tree.** Agents share this checkout. `git add` **only your own
  files** — never `git add -A` / `git commit -a`. If `git pull --rebase` refuses due
  to another agent's unstaged edits, push without rebasing only when `origin/main`
  hasn't moved; otherwise coordinate here.
- **Shared dev data.** Use an isolated tenant per workstream (`import-live-smoke`,
  `import-persist-probe`, …) and tear down what you create. Never touch the `testco`
  tenant — the live rating canaries depend on its seeded data.
- **Auth floor (since `c132146`).** All non-GET `/api/*` requires auth + `product:write`
  (whitelist in `server.js`). Harnesses must bootstrap-login first. Cross-tenant
  SUPER_ADMIN override needs a break-glass grant (`POST /api/admin/break-glass`).
- **Audit chain (since `c132146`).** The mutation envelope writes hash-chained audit
  ops in the same transactional batch — do not strip them. Any new Cosmos write in
  `server/` must be added to the no-bare-writes allowlist with a rationale.

## ✅ Finishing checklist

1. `git status` clean — nothing staged, nothing stashed.
2. `origin/main` contains your final sha; pipeline run for it is green:
   `az pipelines runs list --organization https://dev.azure.com/garage-repos --project "Product Hub" --top 1`
   (`az` = `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`).
3. Your workstream row below says **done** and lists the final sha.
4. Append your last push to the deploy log below.

---

## 🧭 Workstreams

| Workstream | Area | Status | Final sha |
|---|---|---|---|
| **import-brain** | `server/lib/import-brain/**`, `server/lib/ai/unified-import.js`, `server/lib/fleet.js`, `shared/src/ai/fleet.ts`, `shared/src/import/structure/**`, `scripts/import-{eval,live}.mts`, `tests/golden/**`, `server/server.js` (SSE compression filter only) | 🔄 In progress — live-test loop (golden eval + persist + robustness sweep) against dev; fix waves still landing. Please don't edit these files until done. | `912b643` |
| **admin-control-plane** | `server/lib/{auth,authz,admin,tenant-admin,data}.js`, `server/server.js` (auth/write gates), `app/src/routes/{Admin,TenantAdmin}.tsx`, `app/src/components/shell/Topbar.tsx`, `app/src/lib/backend/**`, `app/src/lib/canI.ts` | ✅ Done — live-verified (break-glass, paging caps, audit trail, role matrix, cookie session). VIEWER holds `ai:invoke` (chat only); write-shaped AI (`unifiedImport`, `reindexProduct`) needs `product:write`. Dev bootstrap creds set per user directive. | `5256ba2` |
| **filing-verifier (Lane B)** | `server/lib/filing.js`, `server/lib/data.js` (reserved-base mutate guard only), `app/src/__invariants__/server-invariants.test.ts`, `tests/server/integration.test.ts` (filing sections), `scripts/filing-live.mts`, `docs/audit/EXECUTION-B.md` | ✅ Done — verifier on MID_REASONER role (live verdicts escalate to opus: sonnet unprovisioned in Foundry dev, provenance recorded); tamper probe live-rejected 422 (no freeze); mutate into `filings/` = 403 reserved_base; 15/15 live checks in isolated tenant `filing-live-b` (docs/audit/EXECUTION-B.md). | see log |
| **audit-integrity** | `server/lib/data.js` (envelope + `/audit/verify`), `server/lib/filing.js` (freeze batch), `server/lib/auth.js` (bootstrap gate), `shared/src/audit/chain.ts`, `shared/src/money.ts`, `server/lib/audit-chain-shared.cjs`, `app/src/__invariants__/*` | ✅ Done — hash-chained audit events verified live (13/13 across 10 paths); 422 dangling parentId, 409 stale rev, 401 revoked jti. Bootstrap admins fail-closed behind `BOOTSTRAP_USERS_ENABLED` (still `true` on dev; rotating needs human-approved app-settings change). | `c132146` |
| **live-visualizer (F3·A)** | `app/src/import/AgentVisualizer.tsx` (new), `app/src/import/agentVisualizer.test.ts` (new), `app/src/import/unifiedImportClient.ts` (client-side additive: forward existing `json` SSE events + receipt timestamps; no protocol change), `app/src/import/UnifiedImportModal.tsx` ("Watch the agents" toggle + overlay), `app/src/a11y.axe.test.tsx` (additive cases), `app/src/index.css` (additive keyframes only), `docs/audit/EXECUTION-A-F3.md`. **Claimed server exception file: `server/lib/ai/refresh-news.js`** — after orientation, NOT edited (News already renders every item via `ArticleImage` real-image→deterministic-SVG fallback; news URLs are AI-generated slugs so no real source image exists to fetch). **HOLD respected:** import-brain row in progress → zero edits to `server/lib/ai/unified-import.js`, `server/lib/import-brain/**`, fleet files. Visualizer renders ONLY existing SSE events. **Wanted additive fields (for import-brain lane, no rush):** per-call events `{t:'agent', stage, role, deployment, phase, inputTokens, outputTokens}` for live per-reasoner fan-out; `{t:'escalation', stage, fromRole, toRole, reason}` when the haiku→sonnet→opus ladder fires; per-stage token subtotals in `brain:spend.byStage`. Until then the visualizer shows stage-level state live and per-deployment telemetry at run end (from `brain:spend`) — never simulated activity. | ⏸️ **Built + gate green — PUSH HELD by user directive** ("do not push"). Committed locally: visualizer (opt-in "Watch the agents", lazy-loaded — Builder chunk 25.1→20.4 kB gz, first-load 143.6/175), elevation pass (HeroSignIn keyboard eye-toggle; News/Tasks/Explorer recoverable subscribe-error states + `useLiveCollection.retry()`). StreamRenderer / News images / presence / conflict-diff verified already-shipped, not rebuilt. ⚠️ Note for all lanes: `pnpm build` alone does NOT run `scripts/check-bundle-budget.mjs` — run it explicitly before push; a 25 kB per-chunk breach only surfaces in the pipeline. Deploy + live-test matrix deferred until the push hold lifts (see docs/audit/EXECUTION-A-F3.md). | local (unpushed) |
| **public-surfaces (F1·A)** | `app/src/components/icons/**`, `app/src/components/ui/icons.tsx` (shim), `app/src/lib/pricing.ts`(+test), `app/src/routes/Pricing.tsx`, `app/src/App.tsx` (added `/pricing` route line only). See [docs/audit/EXECUTION-A.md](docs/audit/EXECUTION-A.md). | ✅ **Wave 1 done** — icon registry → `components/icons/` (**93 glyphs**, +7 F3 pre-cuts + `IconShare`); `ui/icons.tsx` now a re-export shim (77 importers untouched); new public `/pricing` (4 commercial layers + hand-rolled-SVG ROI calc) + `lib/pricing.ts` (ILLUSTRATIVE) + 12-test ROI lock. Gate green; run **2428 succeeded**; live smoke green (`/pricing` 200, chunk carries content, egg base64-only no leak). Egg + RISK-013 **verified already-shipped**, not rebuilt. **Share seam: ABSENT → full design + token shape recorded** in EXECUTION-A.md (build deferred at the $12 budget line — public token endpoints reading Cosmos need their own live-test cycle). ⚠️ **Landing.tsx owned by another lane — Lane A never touched it;** **ASK that lane:** add `<Link to="/pricing">Pricing</Link>` to the header nav + footer (route is live). | `677d748` |

### 🎨 Icon registry (public-surfaces F1·A)

Canonical home is now `app/src/components/icons/index.tsx` — **93 named glyph exports**,
zero third-party icon deps app-wide; `components/ui/icons.tsx` is a `export * from '../icons'`
shim (77 existing importers untouched). **8 added this lane:** `IconShare` + the 7 F3 pre-cuts
`IconAgent` · `IconStage` · `IconEscalate` · `IconVerify` · `IconReconcile` · `IconDisagreement` · `IconStream`
(F3: import from `components/icons`). Full list in [docs/audit/EXECUTION-A.md](docs/audit/EXECUTION-A.md).

## 📜 Push & deploy log

Append one row per push (newest first). Time = local (ET).

| When | Run | Sha | Workstream | What shipped |
|---|---|---|---|---|
| 01:55 | — | (this push) | filing-verifier (Lane B) | Lane B done: live proof 15/15 (tamper 422, VIEWER 403, reserved_base 403) + EXECUTION-B ledger + row flip |
| 01:31 | 2427 | `9be28d0` | filing-verifier (Lane B) | MID_REASONER verifier + ladder + tamper probe + filings-base 403 guard + tests + live harness |
| 01:40 | 2428 | `677d748` | public-surfaces (F1·A) | Icon registry → `components/icons/` (+7 F3 glyphs + IconShare); public `/pricing` page + hand-rolled-SVG ROI calc + `lib/pricing.ts` (ILLUSTRATIVE). Carried admin/auth `8c17381` on the fast-forward. |
| 20:05 | 2425 | `912b643` | import-brain | Harness retry on SSE termination; hazard docs |
| 19:54 | 2424 | `9447142` | admin/audit | (rode pipeline batch) |
| 19:51 | 2423 | `c132146` | admin + audit | Auth floor, break-glass, hash-chained audit envelope |
| 19:42 | 2422 | `b65cb08` | import-brain | SSE `:hb` keepalive + stage-4 batch progress; eval slicing |
| 19:12 | 2421 | `5fd4485` | import-brain | orchestration.md created |
| 19:05 | 2420 | `2c3f1bf` | import-brain | Coverage/sub-coverage name + enum folding in plan assembly |
| 18:57 | 2419 | `94cce03` | import-brain | Bounded parallelism across brain stages (≈3× faster) |
| 18:52 | 2418 | `a0f3a8a` | import-brain | Column-map batching + state-matrix folding; SSE past compression; unmapped-sheet skip |
| 18:46 | 2417 | `1807b34` | import-brain | Missing-deployment cache (sonnet rung dormant) |
| 18:23 | 2416 | `6d998c3` | import-brain | Import brain V2: stage-0 router, no-cap fleet context, ensemble ladder, deterministic fast path, ImportPlan assembly, golden eval |

---

## 🤝 Cross-lane assist for import-brain (from Lane A · no action required · NOT pushed)

Read-only triage of your `docs/audit/import_*_results-*.json` — **no brain file touched,
no dev call, nothing pushed** (a push would deploy and sever your SSE). Details:
[docs/audit/import-triage-fromA.md](docs/audit/import-triage-fromA.md) · tool: `node tools/eval-triage.mjs`.

- **Reframe:** golden evals aren't failing on accuracy — they never return. **CORE/GL =
  `fetch: terminated` @ ~48m (deploy severed the stream), IM/PR = `aborted` @ exactly
  ~15m (fixed client timeout).** Adversarial + safety are green (9/9, **0 fabrications**).
- **Biggest lever — a push-free window, and it's available now:** every other lane
  (admin, audit, filing-B, public-A) is DONE. Nobody else needs to deploy. If pushes
  stay quiet you get a clean ~48-min runway for CORE/GL — that's your first real
  accuracy read. **Other lanes: please hold non-critical pushes while brain runs.**
- **Fast check:** is the 900 s an *idle* timeout? CORE/GL hit 48m in the same batch IM/PR
  aborted at 15m → if abort is inactivity-based, IM/PR **stalled** (a stage stopped
  emitting `:hb`). Also: PDF path returns products with **0 coverages** (separate gap).
