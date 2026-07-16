# PROJECT_KNOWLEDGE_EXPORT — exact files to upload to the Claude Project

> Upload these files, in this order. Together they give a zero-context agent (or a
> Claude Project) full, verified understanding of the codebase as of post-cleanse sha
> `d28c8a1` (+ the P-CORPUS deliverables from the same wave).

## From docs/reveng/ (this dossier — P-REVENG)

| # | File | One line |
|---|---|---|
| 1 | `docs/reveng/EXEC_OVERVIEW.md` | One page: what the platform is, strong/weak, next build pack, hostile self-review, verification ledger |
| 2 | `docs/reveng/ARCHITECTURE.md` | System + container views, middleware gauntlet, write lifecycle, push=deploy pipeline, single-instance constraints (gate + boot evidence) |
| 3 | `docs/reveng/INGESTION_PIPELINE.md` | The import brain end to end: stage graph, concept linker + fill-only AI overlay, ensemble, grounding, docId map with CONFIRMED-AT-HEAD marks, failure modes |
| 4 | `docs/reveng/API_SURFACE.md` | All 62 routes: method, path, capability, tenant scoping, shapes, SSE |
| 5 | `docs/reveng/DATA_MODEL_DELTA.md` | DATA_MODEL.md vs code as built: confirmations, 6 drifts, omission inventory |
| 6 | `docs/reveng/FRONTEND_MAP.md` | Adapter seam, route map, token system, primitives, invariant tests, import review surface E2E |
| 7 | `docs/reveng/SECURITY_TENANCY.md` | Platform_Review F1-F12 re-verified (2 FIXED / 1 PARTIAL / 9 OPEN), two-plane authz, tenant isolation mechanics |
| 8 | `docs/reveng/PERF_COST.md` | Run economics ($110.81 CORE correction), bundle budget (verified), hot paths, cache/checkpoint status |
| 9 | `docs/reveng/TEST_MAP.md` | 112 suites mapped, four canaries with files, eval harness modes, holdouts, anti-overfit rule, coverage gaps (+ run evidence) |
| 10 | `docs/reveng/FLEET.md` | Role registry, cost guard, 9-vs-16 deployment reconciliation, unused models, external.* client inventory |
| 11 | `docs/reveng/RISK_REGISTER.md` | 28 prioritized risks with evidence and owners |
| 12 | `docs/reveng/BACKLOG_SEED.md` | Build-ready backlog (docId fix ranked 1), v6 landed-vs-parked, 7 LOCK candidates |

## Companions from the same wave

| # | File | One line |
|---|---|---|
| 13 | `CLEANSE_MANIFEST.md` (repo root, P-CLEANSE) | Every destructive cleanse action: path, delete/archive, size, destination, reason |
| 14 | `CLAUDE.md` (repo root, post-cleanse) | The binding invariants + quick start the docs above assume |
| 15 | `FIXTURES.md` (P-CORPUS) | Fixture/corpus catalog from the P-CORPUS lane |
| 16 | `CRASH_CENSUS.md` (P-CORPUS) | Crash/failure census from the P-CORPUS lane |
| 17 | `EVAL_BASELINE.md` (P-CORPUS) | Eval baseline record from the P-CORPUS lane |

Notes: items 15-17 are P-CORPUS deliverables — take them from wherever that lane
publishes them (its worktree/allowlist row in `orchestration.md`); paths were not final
when this list was written. Item 14 is the post-cleanse root CLAUDE.md, not the
`artifacts/` library copy.
