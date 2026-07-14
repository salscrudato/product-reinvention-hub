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
- **Stowaway commits (bit us twice — run 2432).** Another lane's STAGED entries
  (worst case: deletions) ride into any bare `git commit`. Run 2432 failed exactly
  this way (SeedProcessDialog.tsx deletion inside import-brain `50a7f31`; healed by
  `92154c6`, run 2433 green). Before EVERY commit:
  `node tools/stowaway-check.mjs <your-files…>` (exit 1 = foreign staged entries →
  commit ONLY with `git commit -m "…" -- <your-files>`).
- **Gating against a dirty shared tree.** `pnpm build` in this checkout gates the
  WORKING TREE (everyone's half-edits), not your commit — false reds AND false greens.
  Gate the exact sha you'll push: `node tools/verify-commit.mjs [<sha>] [--full]`
  (detached temp worktree; no branch/stash; shared tree untouched). Known artifact:
  the vite step can fail in a fresh worktree on Node 24 (`#module-sync-enabled`) —
  typecheck/lint/test are reliable there; if only vite is in doubt, run `pnpm build`
  in the main tree at a quiet moment.

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
| **import-brain** | `server/lib/import-brain/**`, `server/lib/ai/unified-import.js`, `server/lib/fleet.js`, `shared/src/ai/fleet.ts`, `shared/src/import/structure/**`, `scripts/import-{eval,live}.mts`, `tests/golden/**`, `server/server.js` (SSE compression filter only) | ✅ **Done** — elite multi-format import live-verified on dev. Golden metrics: GL F1 0.970 / IM 1.000 / PR 0.999, numeric exact-match 1.000 everywhere, citation coverage 100% (up to 32.7k provenance rows/format). Stage-0 router (magic-byte, server-side XLSX/XLSM parse), no-cap IMPORT_CONTEXT (telemetry kept, `brain:spend` SSE), decorrelated ensemble + haiku→sonnet→opus ladder + gpt-5.1 judge, deterministic fast path, ISO-mapper canonical-identity join, completeness intelligence (pillar assessment + attach strategy), plan-integrity checks (dup refIds, orphan promotion, dangling form refs). Adversarial corpus 0 fabrications; blank templates yield EMPTY plans; persist verified via standard mutate; canaries green. NOTE: `unifiedImport` accepts raw base64 docs now; keep the SSE compression filter + :hb heartbeat in server.js. | `ecb4607` |
| **admin-control-plane** | `server/lib/{auth,authz,admin,tenant-admin,data}.js`, `server/server.js` (auth/write gates), `app/src/routes/{Admin,TenantAdmin}.tsx`, `app/src/components/shell/Topbar.tsx`, `app/src/lib/backend/**`, `app/src/lib/canI.ts` | ✅ Done — live-verified (break-glass, paging caps, audit trail, role matrix, cookie session). VIEWER holds `ai:invoke` (chat only); write-shaped AI (`unifiedImport`, `reindexProduct`) needs `product:write`. Dev bootstrap creds set per user directive. | `5256ba2` |
| **filing-verifier (Lane B)** | `server/lib/filing.js`, `server/lib/data.js` (reserved-base mutate guard only), `app/src/__invariants__/server-invariants.test.ts`, `tests/server/integration.test.ts` (filing sections), `scripts/filing-live.mts`, `docs/audit/EXECUTION-B.md` | ✅ Done — verifier on MID_REASONER role (live verdicts escalate to opus: sonnet unprovisioned in Foundry dev, provenance recorded); tamper probe live-rejected 422 (no freeze); mutate into `filings/` = 403 reserved_base; 15/15 live checks in isolated tenant `filing-live-b` (docs/audit/EXECUTION-B.md). | `9be28d0` (run 2427 ✅) + docs `3414225` |
| **audit-integrity** | `server/lib/data.js` (envelope + `/audit/verify`), `server/lib/filing.js` (freeze batch), `server/lib/auth.js` (bootstrap gate), `shared/src/audit/chain.ts`, `shared/src/money.ts`, `server/lib/audit-chain-shared.cjs`, `app/src/__invariants__/*` | ✅ Done — hash-chained audit events verified live (13/13 across 10 paths); 422 dangling parentId, 409 stale rev, 401 revoked jti. Bootstrap admins fail-closed behind `BOOTSTRAP_USERS_ENABLED` (still `true` on dev; rotating needs human-approved app-settings change). | `c132146` |
| **live-visualizer (F3·A)** | `app/src/import/AgentVisualizer.tsx` (new), `app/src/import/agentVisualizer.test.ts` (new), `app/src/import/unifiedImportClient.ts` (client-side additive: forward existing `json` SSE events + receipt timestamps; no protocol change), `app/src/import/UnifiedImportModal.tsx` ("Watch the agents" toggle + overlay), `app/src/a11y.axe.test.tsx` (additive cases), `app/src/index.css` (additive keyframes only), `docs/audit/EXECUTION-A-F3.md`. **Claimed server exception file: `server/lib/ai/refresh-news.js`** — after orientation, NOT edited (News already renders every item via `ArticleImage` real-image→deterministic-SVG fallback; news URLs are AI-generated slugs so no real source image exists to fetch). **HOLD respected:** import-brain row in progress → zero edits to `server/lib/ai/unified-import.js`, `server/lib/import-brain/**`, fleet files. Visualizer renders ONLY existing SSE events. **Wanted additive fields (for import-brain lane, no rush):** per-call events `{t:'agent', stage, role, deployment, phase, inputTokens, outputTokens}` for live per-reasoner fan-out; `{t:'escalation', stage, fromRole, toRole, reason}` when the haiku→sonnet→opus ladder fires; per-stage token subtotals in `brain:spend.byStage`. Until then the visualizer shows stage-level state live and per-deployment telemetry at run end (from `brain:spend`) — never simulated activity. | ⏸️ **Built + gate green — PUSH HELD by user directive** ("do not push"). Committed locally: visualizer (opt-in "Watch the agents", lazy-loaded — Builder chunk 25.1→20.4 kB gz, first-load 143.6/175), elevation pass (HeroSignIn keyboard eye-toggle; News/Tasks/Explorer recoverable subscribe-error states + `useLiveCollection.retry()`). StreamRenderer / News images / presence / conflict-diff verified already-shipped, not rebuilt. ⚠️ Note for all lanes: `pnpm build` alone does NOT run `scripts/check-bundle-budget.mjs` — run it explicitly before push; a 25 kB per-chunk breach only surfaces in the pipeline. Deploy + live-test matrix deferred until the push hold lifts (see docs/audit/EXECUTION-A-F3.md). | local (unpushed) |
| **policyholder-portal (F4·B)** | `app/src/routes/portal/**` (new: Portal.tsx, sanitizeHtml.ts + tests), `server/lib/portal.js` (new), `scripts/portal-live.mts` (new), `tests/server/portal.test.ts` (new), `server/server.js` (portal mount + `/api/portal` write-exempt entry + error-handler 413/400 pass-through — NOT the SSE compression filter), `server/lib/storage.js` (upload size/type enforcement), `server/lib/{auth,authz}.js` (POLICYHOLDER role, rank 0, portal:read/portal:upload caps), `server/lib/data.js` (`/db/get`+`/db/list` now require `product:read` — additive for all staff roles, blocks the new persona), `server/lib/homecheck.js` (additive `buildRiskPayload` export only), `app/src/lib/backend/{types,index,azure.adapter}.ts` (portal seam + api() now surfaces server error detail), `app/src/lib/canI.ts` (+POLICYHOLDER row), `app/src/App.tsx` (`/portal` route line only), `app/src/components/claims/BaseFormsLibrary.tsx` (honest upload errors + 15 MB pre-check), `docs/audit/EXECUTION-B.md` (F4 section). **Upload root cause fixed**: >18.7 MB PDFs blew the 25 MB JSON cap and the global error handler swallowed the 413 into an opaque 500 → "Upload failed"; now honest 413/415 at storage + transport + clear client toasts. **HOLD respected**: zero edits to import-brain/fleet/visualizer files; index.css untouched (portal styles are token-driven, scoped in-component). | ⏸️ **Built + full gate green (typecheck ✅ lint ✅ test 907+186+31 new ✅ build ✅ canary $1,528 ✅) — PUSH HELD awaiting user go** (push = deploy). Ready to deploy + live-test via `scripts/portal-live.mts` (isolated tenant `portal-live-b`) + mobile viewport check. | local (unpushed) |
| **public-surfaces (F1·A)** | `app/src/components/icons/**`, `app/src/components/ui/icons.tsx` (shim), `app/src/lib/pricing.ts`(+test), `app/src/routes/Pricing.tsx`, `app/src/App.tsx` (added `/pricing` route line only). See [docs/audit/EXECUTION-A.md](docs/audit/EXECUTION-A.md). | ✅ **Wave 1 done** — icon registry → `components/icons/` (**93 glyphs**, +7 F3 pre-cuts + `IconShare`); `ui/icons.tsx` now a re-export shim (77 importers untouched); new public `/pricing` (4 commercial layers + hand-rolled-SVG ROI calc) + `lib/pricing.ts` (ILLUSTRATIVE) + 12-test ROI lock. Gate green; run **2428 succeeded**; live smoke green (`/pricing` 200, chunk carries content, egg base64-only no leak). Egg + RISK-013 **verified already-shipped**, not rebuilt. **Share seam: ABSENT → full design + token shape recorded** in EXECUTION-A.md (build deferred at the $12 budget line — public token endpoints reading Cosmos need their own live-test cycle). ⚠️ **Landing.tsx owned by another lane — Lane A never touched it;** **ASK that lane:** add `<Link to="/pricing">Pricing</Link>` to the header nav + footer (route is live). | `677d748` |
| **task-seeding-v2** | `shared/src/gtm/{plan.ts,plan.test.ts,schedule.ts}`, `shared/src/{types.ts,index.ts}`, `app/src/components/tasks/gtm/{SeedReviewSheet.tsx,SeedReviewSheet.test.tsx,SeedReviewSheet.axe.test.tsx,seedReview.ts,seedReview.test.ts,gtm.ts,TaskCard.tsx}` (− `SeedProcessDialog.tsx`), `app/src/routes/Tasks.tsx`, `app/src/index.css`, `docs/audit/EXECUTION-task-seeding-v2.md`. See [docs/audit/EXECUTION-task-seeding-v2.md](docs/audit/EXECUTION-task-seeding-v2.md). | ⏸️ **Built + gate-green for this slice — awaiting human review, UNPUSHED** (per user "do not push / do not deploy"). Review→Adjust→Seed sheet replaces the blind phase-checkbox seed: per-task selection + live totals + inline owner/duration edits; **forward-only** planner (`planLaunch`, never before tomorrow; deadline-too-tight resolves inline); **idempotent** re-seed keyed by a stable `seedRefId` (L1–L4 path hash) — additive, so completions survive; board `?seedBatch=` filter + one-time arrival pulse (reduced-motion safe). Canaries $1,528/$1,002/$2,635 hold; bundle 144.1/175. **HOLD respected:** zero edits to import-brain / fleet / any `server/**` file; only `Tasks.tsx`/`index.css` in the shared client tree, both clean when taken. ⚠️ Two pre-existing `no-bare-writes` reds are the **F5 lane's** `server/lib/{platform-config,admin}.js` (`f5e64a2`/`dd836c2`), untouched here. | `96b94f4` (local, unpushed) |
| **cx-wave (R0)** | Customer-experience wave across 7 surfaces. CLIENT: `components/ai/{StreamRenderer,WaveformLoader}.tsx`, `components/shell/{Sidebar,Topbar}.tsx`, `routes/{AppShell,Home,Products,Explorer,Tasks,Claims,News,Builder}.tsx`, `routes/product/ProductWorkspace.tsx`, `components/home/PriorityRail.tsx`, `components/product/{ProductCard,ImportWorkbookModal}.tsx`, `components/explorer/{MillerColumn,PeekPanel}.tsx`, `components/tasks/gtm/{AdhocTaskDialog,SeedReviewSheet,TaskCard}.tsx`, `components/ui/{Dialog,Highlight,index}.ts(x)`, `components/claims/DeterminationCard.tsx`, `components/chat/ChatComposer.tsx`, `import/{UnifiedImportModal,AgentVisualizer,WarningsPanel,VirtualList}.tsx`, `lib/import/importProduct.ts`, `lib/backend/{azure.adapter,index}.ts`, `index.css` (2 new semantic hues: stage-warm/stage-cool), `vite.config.ts` (opt-in dev proxy). SERVER: NEW `lib/ai/task-summary.js` (MID_REASONER, cited task ids, strip-uncited enforced), REWRITTEN `lib/ai/refresh-news.js` (Anthropic web_search tool, real articles only, `{day}` backfill param, og:image→blob persist, honest 501 if web_search unsupported), NEW `lib/news-image.js` + `news-shared.cjs` (`build:news`), ADDITIVE `lib/ai/unified-import.js` + `lib/import-brain/ai-call.js` (`brain:escalation` SSE event — the F3 lane's wanted field, emitted only on a REAL ladder hand-off), `server.js` (news-image GET mount). Client write batching 50→150/HTTP call (server's ≤96-op transactional chunks unchanged — atomicity/audit/order identical). Harness: `scripts/news-backfill.mts`. See [docs/audit/EXECUTION-R0.md](docs/audit/EXECUTION-R0.md). | ⏸️ **Built + FULL GATE GREEN — PUSH HELD by user directive.** 7 local commits (waves 1–6 + Rebecca's promote→card-view/LOB-grouping feedback). Bundle 144.5/175 gz, worst chunk 22.7/25, axe green incl. new surfaces (PriorityRail, ProductCard kebab, visualizer). Deferred to go: push→deploy, Home/Products/Explorer/Tasks/Claims live walk, 5-day REAL news backfill (`news-backfill.mts`; ⚠️ risk: Foundry may reject the web_search server tool → endpoint 501s honestly, no fabrication), isolated-tenant workbook+filing import watching the constellation, 1,707-entity write before/after timing. ⚠️ `scripts/import-eval.mts` has a foreign uncommitted edit (not this lane's; untouched). | `2e6195c` (local, unpushed) |
| **ops-plane (F5·B)** | NEW: `shared/src/platform/**` (featureFlags + tenantConfig, bundled to `server/lib/platform-shared.cjs` via `build:platform`), `server/lib/{platform-config,metering}.js`, `server/lib/ai/ops-copilot.js`, `app/src/lib/useFeatureFlags.ts`, `tests/server/{platform,platform-toggles,metering,ops-copilot}.test.ts`, `shared/src/platform/platform.test.ts`. EDITED (additive): `server/lib/{admin,auth,tenant-admin,data,server}.js` + `server/lib/ai/{index,_shared,chat,summarize-product}.js` (per-tenant metering hook via AsyncLocalStorage), `app/src/lib/backend/{types,azure.adapter}.ts` + `app/src/components/shell/Sidebar.tsx` (flags on `/me` + nav-hiding), `package.json` (`build:platform`). **HOLD respected:** zero edits to import-brain/fleet/unified-import; barrel `shared/src/index.ts` UNTOUCHED (server uses the bundle, client gets the registry via API) — deliberately no ride-along on the hot barrel the GTM lane edits. | ✅ **DONE — all 5 waves on origin/main `c927369`, deployed, LIVE-VERIFIED 21/21** (`scripts/ops-live.mts` → `docs/audit/ops_live_results.json`, isolated `ops-live-a/b` torn down): provision→config(invalid-reject + partial-merge)→global + per-tenant toggle→A/B per-tenant metering + $cost→budget throttle (429, B unaffected)→copilot (cited on sonnet · propose→human-confirm→audited · injection-safe, no mutation/leak)→partition-scoped offboard (16 docs) with **tenant B untouched**. Full suite **1090/1090** (+79 F5), canary $1,528 ✅, census 54/54 ✅. Reached origin via co-agent batch pushes (this lane never ran `git push`); the "DO NOT DEPLOY" hold was later lifted and the user asked for live verification. Client dashboards/config-UI/copilot-panel = post-go client pass. See [docs/audit/EXECUTION-B.md](docs/audit/EXECUTION-B.md) F5. | `c927369` (all 5 waves + live proof) |

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
| 02:10 | 2435 | `ecb4607` | import-brain | Completeness intelligence + plan-integrity layer + eval timeout hooks (final wave) |
| 00:20 | 2433 | `92154c6` | import-brain | Heal stowaway deletion (SeedProcessDialog) from 50a7f31 |
| 00:15 | 2432 | `50a7f31` | import-brain | Blank-template fabrication guard (placeholder filter + stub cleanup) — run failed on stowaway, healed by 2433 |
| 23:50 | 2431 | `98a94a1` | import-brain | ISO-mapper canonical-identity join in stage 7 (mapper=identity, brain=provenance) |
| 23:20 | 2430 | `9a4d264` | import-brain | Canonical plan conventions (defaults/order/allStates) + eval diagnostics |
| 22:45 | 2426 | `441e7d6` | import-brain | Sheet-level parallelism stages 4+5; filing formNumbers crash fix; PDF vision timeouts |
| 03:00 | 2434 ✅ | `7ff0daf` | filing-verifier (Lane B) batch | Full 4-hour batch: Lane B docs/proof (`3414225`,`6cb50f7`) + F5 lifecycle/toggles/metering (`dd836c2`,`c012aff`,`d53b6a2`) + GTM Task Seeding v2 (`96b94f4`,`2827dbc`) + census heals (`612424a`,`7ff0daf`) that kept CI green for all of it. Gate at push sha: 1075+186 tests, canaries ✅. |
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
