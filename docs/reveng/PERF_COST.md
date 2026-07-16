# PERF_COST — run economics, bundle budget, hot paths, cache/checkpoint status (`d28c8a1`)

> `docs/reveng/` dossier. Numbers below are from committed run artifacts
> (`docs/import-hardening/RESULTS/`), the diagnostic, and commands RUN on this tree
> (quoted where so).

## 1. Import-run economics (the platform's dominant cost)

- **The CORE live run**: the diagnostic and Platform_Review quote ~95-110 min / ~$70 per
  attempt. The certified record is harder: the wave-3 CORE Tier-2 run
  (`docs/import-hardening/RESULTS/phasew-gate.md:8`) completed **headless after the
  150-min client window** and was **recovered by runId, not re-run** — and the hardening
  loop's own cost correction (`RESULTS/loop-summary.md:82`) shows a full headless CORE
  run at **$110.81 / 7,652 calls** (the earlier ~$60 forensics understated it). Scored:
  F1 0.999, precision 1.000, numeric 1.000, citations 100%, fabrication 0.0%.
- **Where the time goes**: stage-4 extraction is ~90% of wall-clock and spend
  [diagnostic A7, mechanism confirmed: 2-vote ensemble per 20-row batch across every
  mapped sheet, `stage4-extract.js:34`]. Vision manuals cost up to ~300s/read
  (`stage-filing.js` 300s doc timeout); the dense-manual optimization (commit `9372aa4`)
  runs haiku+opus in parallel and drops haiku's empty-retry (`heavyDoc`), saving a wasted
  whole-PDF re-read per manual.
- **Cost controls that exist**: deterministic fast paths skip AI entirely when structure
  is confident (stage-2 scorer > 0.80 skips the model; stage-4 CODE extraction when the
  column map is >=0.80 confident on >=60% of columns — `stage2-header-lock.js:22`,
  `stage4-extract.js:41-43`); prompt caching via ephemeral `cache_control` on system +
  data blocks (`ai-call.js:118`); haiku-first laddering everywhere; trimmed-workbook
  iteration harness (`scripts/trim-workbook.mjs`, 60-row cap ~= 1/10 wall-clock + spend).
- **Recovery economics (F23/F29)**: durable run results + `IMPORT_EVAL_RECOVER_RUN`
  scoring mean a severed run is RECOVERED, not re-bought — the wave-3 CORE run cost $0 of
  re-spend against three prior lost attempts (`loop-summary.md:12`).
- **Spend governance**: global 1h window, `AI_SPEND_CEILING_USD` default $25 (live
  override 250 on the dev App Service), soft-degrade at 80% (`fleet.js:80-105`);
  per-tenant monthly token budgets -> 429 (`metering.js:101-106`); import is the single
  named no-cap exemption — telemetry never bypassed (`fleet.js:77,101`;
  `ai-call.js:76-89` per-run `brain:spend`).

## 2. Bundle budget — VERIFIED ON THIS TREE

`node scripts/check-bundle-budget.mjs` run on this tree after the gate build
(2026-07-16):

```text
Bundle budget (gzipped KB):
  initial critical JS : 151.7 / 175
  CSS                 : 18.6 / 25
  worst route chunk   : 23.1 / 25  (Builder-BQBf__hS.js)
✓ bundle within budget
```

Headroom notes: the worst route chunk (Builder) is at 92% of its 25 KB budget — the next
Builder feature likely needs a split. exceljs (256 KB gz) is enforced-lazy. The pipeline
runs this check (`azure-pipelines.yml:73-74`); **local `pnpm build` does not** — run it
explicitly before pushing UI changes.

## 3. Known hot paths (server)

| Path | Why hot | Mitigation in place |
|---|---|---|
| Stage-4 extraction | 2 model votes/field over every row batch | deterministic fast path; batch halving on token truncation; sheet-level parallelism (commit `441e7d6` era) |
| Mutation envelope | every write = 6-doc batch + SYNCHRONOUS embedding call (20s timeout) before commit | embeddings best-effort; failure degrades to lexical (`data.js:177-207`, `embed.js:48`) |
| Whole-collection subscriptions | `MAX_LIST=6000` rows per poll cycle per subscriber | poll backoff + tab-hidden pause + coalescing (client side) |
| `parentId` validation | 1 sequential `readEntity` per candidate per child on import waves | none (diagnostic A6; small per-call, large on 1,700-entity imports) |
| Admin export/offboard | up to 200k docs in memory, single JSON response | none ("should stream to blob" — Platform_Review sec 13) |
| Filing point-in-time replay | reads versions TOP 2000 | silent truncation past 2000 (`filing.js:109-112`) |
| SSE lifetime | one socket held ~110+ min per big import | 15s `:hb`; headless continuation + durable results on drop |

Client: RAF token batching for streaming, virtualized 1,700-row import list, route
code-split + hover prefetch, manual React vendor chunk (all verified in the build output:
`vendor-react` 74.5 KB gz, route chunks enumerated in the gate log).

## 4. Cache / checkpoint status (what exists vs what does not)

| Layer | Status |
|---|---|
| Anthropic prompt cache (ephemeral cache_control) | EXISTS (`ai-call.js:118`) |
| Durable run result + recover-by-runId (F23/F29) | EXISTS (`unified-import.js:213-218`, `unifiedImportResult`) |
| Per-stage checkpoint/resume of a live run | **DOES NOT EXIST** — an App Service recycle mid-run still loses computation up to the persisted bundle (Platform_Review E4, open) |
| Semantic extraction cache keyed by contentHash | **DOES NOT EXIST** — chunks carry FNV-1a `contentHash` but extraction results are never cached (Platform_Review E3, open) |
| Client SWR + snapshot cache | EXISTS (`azure.adapter.ts:110-306`) |
| SW build-versioned asset cache | EXISTS (`app/public/sw.js:19-49`) |
| In-memory spend/limit state across restarts | LOST on every deploy (ARCHITECTURE.md sec 8) |

## 5. Gate + boot timings on this tree (evidence)

```text
node scripts/ops/cleanse/gate.mjs  (2026-07-16, this worktree, Node 24)
PASS  typecheck  34.6s
PASS  lint       12.4s
PASS  test       113.6s
PASS  build      71.1s
GATE GREEN (total 231.7s)
```

Local boot with dummy env reached `{"status":"ok"}` on `/api/health` in <6s with all 10
mounts logged (ARCHITECTURE.md sec 9). Deploy pipeline end-to-end is ~6-9 min
(push -> live), which is also the SSE-severing window all lanes coordinate around
(`orchestration.md` hazards).

## 6. Cheapest wins (ranked by cost-of-run reduction per effort)

1. Extraction cache on `contentHash` (E3) — eval re-runs and re-imports skip unchanged
   regions; the invalidation key is already computed.
2. Page-range chunking for >40-page manuals (E2) — parallel sub-minute windows instead of
   one 5-min serial read; also unlocks manuals past the 180k-char text cap.
3. Stage checkpointing to Blob keyed by runId (E4) — makes the $110 run restart-proof.
4. Batch the parentId candidate reads (diagnostic A6) — one query per wave instead of one
   read per child.
