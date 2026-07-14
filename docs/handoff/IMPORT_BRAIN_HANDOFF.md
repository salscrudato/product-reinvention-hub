# HANDOFF — Elite Multi-Format Import Pipeline (import-brain)

You are taking over a **working, live-verified, multi-format insurance-product import
pipeline** with a short list of open items. Read this whole file before touching code.
Work autonomously, verify everything live, and leave nothing uncommitted or undeployed.

---

## 0. Prime directives (non-negotiable)

1. **Read first:** `CLAUDE.md` (binding invariants), `orchestration.md` (multi-agent
   protocol — other agents share this checkout AND dev), `product_first_principles.md`
   (the PCM methodology the whole pipeline reasons with — product / LOB / coverage /
   sub-coverage hierarchy; rules=GOVERNED, forms=PRESENTED, rating=PRICED; the
   Product Framework ID is the linkage key; an exclusion is NOT a coverage).
2. **Gate before push:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
   Canaries PH $1,528 / PA $1,002 / GL $2,635 (`shared/src/rating/*.test.ts`) must stay green.
3. **Push = deploy.** Every push to `main` auto-deploys `app-prodhub-dev` (~7 min,
   ADO pipeline; check with `az pipelines runs list --organization
   https://dev.azure.com/garage-repos --project "Product Hub" --top 2`;
   az binary: `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`).
   A deploy RESTARTS dev and severs every in-flight SSE stream (yours and other
   agents'). Batch pushes; harnesses retry 3×45 s.
4. **Shared working tree:** other agents edit this same checkout. `git add` only your
   own paths, run `node tools/stowaway-check.mjs <paths>` before EVERY commit, and use
   `git commit --only <paths>`. Never `git add -A`, never `commit -a`, never rebase over
   another lane's unstaged edits.
5. **No cost cap on import** (product decision): `fleet.guard(IMPORT_CONTEXT)` never
   denies/degrades; telemetry ALWAYS recorded (`brain:spend` / `import:spend` SSE events).
   Scope stays import-only.
6. **Grounding:** every extracted field carries a `sheet!cell` or page citation +
   confidence. refIds are byte-for-byte from cells or DERIVED from `lobRegistry`
   (never model-invented). Anything flagged becomes an `importWarning` — nothing is
   silently dropped. Blank/placeholder templates must yield EMPTY plans.

## 1. Architecture (what exists, all live)

`POST /api/ai/unifiedImport` (SSE; auth: bootstrap login, needs `product:write`)
accepts **raw base64 documents** (`{documents:[{name,base64,mediaType?}], lobRefIdHint?}`)
or a legacy `structural` model.

| Stage | File | What it does |
|---|---|---|
| 0 Router | `server/lib/import-brain/stage0-router.js` + `workbook.js` | Magic-byte sniff (never filename): PK-zip→XLSX/XLSM (macros ignored; hidden sheets skipped for AI but fed to the ISO mapper), %PDF→text-vs-vision triage (<400 chars extractable → native-PDF document blocks), text→CSV. LOB/edition: deterministic `inferLob` (refId prefixes) then haiku assist escalating to opus <0.6 conf; prefix validated against `LOB_REGISTRY`. |
| 1–3 | `stage1-classify.js`, `stage2-header-lock.js`, `stage3-column-map.js` | Decorrelated classify (opus+gpt-5.1; haiku/gpt-mini prefilter; opus adjudication), deterministic header lock (r1/r2/r5 conventions, banner rows, phantom 1M-row extents clamped), column mapping in 24-col batches @8192 tokens, **state-matrix columns excluded & folded deterministically** (`stateColumns`, `allStatesColIndex`). Sheets run 4-wide / 3-wide (pMap). |
| 4 Extract | `stage4-extract.js` | **Deterministic fast path** when map is confident (≥0.8 conf on ≥60% cols + real grid): code copies cells byte-perfect with citations; AI sample cross-checks the MAP only. Else haiku+gpt-mini ensemble → field-level consensus → **haiku→sonnet→opus ladder** (sonnet IS provisioned in Foundry) → gpt-5.1 judge (grounded-candidates only). Sheets 2-wide, batches 3-wide. |
| 5 Validate | `stage5-validate.js` | gpt-5.1 adversarial validator (full pass on AI-extracted, sampled on deterministic), sheet-groups 3-wide. |
| 6 Reconcile | `stage6-reconcile.js` | Pure aggregation → `importWarnings`. |
| 7 Plan | `stage7-plan.js` | Cited entities → persistable `ImportPlan` bundle (persists via app `importPlan()` → `adapter.db.mutate`, atomic Cosmos batch). **ISO-mapper join**: `mapIsoWorkbook` (bundled in `import-brain-shared.cjs`, sees hidden sheets) is the canonical-identity oracle — registry refIds (TBD sources → `IM.COV044.02`-style), parentId, order, formNumbers, **gap-fills template fields the brain missed** (brain's cited value wins on conflict). Folds: enums, Yes/No→bool, formNumbers→array, non-canonical status→`sourceStatus`, workflow defaults, sibling order. **Plan integrity**: dup-refId flags, orphan promotion, dangling formNumber refs, exclusion-as-coverage. **Completeness intelligence**: pillar assessment (framework/forms/rules/rating), `PARTIAL_NO_BACKBONE` alerts, `attachStrategy`, SSE notice. **Placeholder filter** (blank templates → empty plan). |
| Filing PDFs | `stage-filing.js` | classify + rateOrder + manual + policyForm **all concurrent**; vision docs race haiku∥opus (richer grounded result wins, sonnet if both empty); citation-drop visibility (`citations-dropped` / `sanitize-note` warn notices); reconcile via `filing-shared.cjs`. |
| Handler | `server/lib/ai/unified-import.js` | Routes stage 0 → brain/filing; `normalizeBundle()` guarantees the FULL UnifiedProposalBundle surface on every emit (review sections, sampledVerifications, splitProducts, fingerprint, extractionPlan, provenance…) — the review UI dereferences these unguarded. SSE `:hb` heartbeat every 15 s (Azure kills idle streams ~230 s); compression bypassed for SSE (`server/server.js`). |

Fleet: `shared/src/ai/fleet.ts` → `server/lib/fleet-shared.cjs` (rebuild `pnpm build:fleet`).
Roles: GROUNDED_CITED=claude-opus-4-8, MID_REASONER=claude-sonnet-5 (provisioned),
BULK_VERIFY=claude-haiku-4-5, VISION/judge=gpt-5.1, CHEAP=gpt-5-mini.
`ESCALATION_LADDER`, `IMPORT_CONTEXT`, missing-deployment 404 cache in `ai-call.js`
(also: retry w/ backoff, per-run spend telemetry, prompt-cached system blocks,
`timeoutMs` opt — document blocks use 300 s).

## 2. Verified state (live, tenant-isolated on dev)

| Check | Result |
|---|---|
| Golden eval (`pnpm import:eval --live`, targets F1≥0.95 / numeric≥0.98 / citations 100%) | GL **0.970/1.000/100%** ✓ · IM **1.000/1.000/100%** ✓ · PR **0.999/1.000/100%** ✓ · CORE **0.907** ✗→ gap-fill fix (`c76f4c2`) deployed, **rerun pending** (expect ≥0.95) |
| Adversarial corpus (blank/decoy/dup/placeholder/wrong-LOB/mixed-lang/garbage-PDF) | 0 fabrications ✓ |
| XLSM (macro, 10 sheets, 1M phantom rows) | `PR.PROD.001`: 1067 cov + 240 forms + 1608 rules, 29,290/29,290 cited ✓ |
| additional_samples (gitignored, repo root: Hagerty/FY25/FY26/2026 variants) | pass (105–450 covs); header-only templates correctly source-gap ✓ |
| NJ filing PDFs (encrypted/CID — naive text = 0 chars) | policy form 22 covs via vision ✓; rate-order/manual **0 items — open item #1** |
| Persist (`/api/db/mutate` atomic batch) + canaries | ✓ (probe leftover: 8 coverage docs in `import-persist-probe` tenant — clean up) |

## 3. OPEN ITEMS (your job, priority order)

1. **NJ filing rate-order + manual — ROOT CAUSE FOUND, fix deployed, VERIFY IT.** Debug notices caught it live: with maxTokens 4000/8000 the models UNDER-FILL the forced tool call (opus returned maxCreditRuleRef + note but NO variables array; haiku/sonnet returned {}). Fix in `3c1b93b`: output budgets 16000 (rate order, manual) / 8192 (policy form) + one explicit fill-the-array retry per rung when the primary array is empty. A solo rate-order probe already yielded **70 cited variables**. YOUR FIRST TASK: confirm run for `3c1b93b` succeeded, then replay all 3 samples/filings/nj-lemonade-ho PDFs in ONE request (scratch probe-live.mjs pattern or your own SSE client; tee output to a file — piping through head SIGPIPE-kills the probe). Expect: classify all 3 roles, three extractions concurrent (start together ~8s), rate-order ~70 variables, manual rules > 0 (raise its budget further if the extract-empty notice shows under-fill again — the manual is table-dense), policy form 22 coverages, normalized bundle, no UI crash. If manual still under-fills at 16k, split extraction per page-range or per rule-number block.
2. **CORE rerun** after gap-fill: `IMPORT_EVAL_TIMEOUT_MS=7200000 IMPORT_EVAL_ONLY=CORE
   IMPORT_TENANT=eval-core10 npx tsx scripts/import-eval.mts --live` (~90 min; run solo,
   avoid pushes meanwhile). Expect F1 ≥0.95. Diagnostics land in
   `docs/audit/import_eval_results-CORE.json` (`missByField`, `sampleMisses`,
   `IMPORT_EVAL_DUMP=1` dumps extracted entities).
3. **`Product_Forms Library_General Liability Example_2025.xlsx`** (additional_samples)
   is the slowest artifact (heavy text-column consensus churn; timed out at 900 s and
   30 min pre-sonnet). Retest at 1800 s on the current deploy; if still slow, profile
   which stage burns time (stage-4 conflict ladder likely) and consider batching
   conflicts per sheet into ONE ladder call.
4. **Persist E2E via the real UI path** for a filing bundle (persist probe:
   `<scratch>/persist-probe.mjs` pattern) and clean the leftover docs in
   `import-persist-probe`.
5. Optional hardening: single-scheme grounding-chunk corpus (see memory
   `reference-cosmos-reseed`), UnifiedImportModal ownership is ANOTHER lane's
   (AgentVisualizer) — coordinate via orchestration.md before restyling.

## 4. Test harnesses & commands

- Offline (no AI, gate-safe): `pnpm import:eval` (parse-stability vs
  `tests/golden/import/*.golden.json`; regenerate with `--write-golden`).
- Live metrics: `pnpm import:eval -- --live` with env `IMPORT_EVAL_ONLY=GL,IM`,
  `IMPORT_TENANT=<isolated>`, `IMPORT_EVAL_TIMEOUT_MS`, `IMPORT_EVAL_DUMP=1`.
- Live robustness: `pnpm import:live` with `IMPORT_LIVE_ONLY=gl|im|pr|core|pdf|addl|adv|roundtrip`
  (per-slice results `docs/audit/import_live_results-<slice>.json`). Parallelize slices
  in separate tenants — one workbook import ≈ 1–40 min, ~$0.30–0.70 per single workbook.
- One-off probe: scratchpad `probe-live.mjs <files…> [--lob GL.LOB.001]` — streams
  stage events, prints plan/provenance/spend. Auth = bootstrap admin/admin.
- Windows detached long-runs: PowerShell `Start-Process` on a CRLF/ASCII `.cmd`
  (Write-tool `.cmd` files get LF endings and silently no-op; bash path:
  `C:\Users\salvatore.scrudato\AppData\Local\Programs\Git\usr\bin\bash.exe -l`).

## 5. Gotchas that already bit (do not repeat)

- **Runtime-only import misses**: `node --check` + `require()` pass while an
  identifier used inside functions is undefined (`pMap`). After edits, INVOKE the code
  path or grep imports vs uses.
- Never edit files via `node -e` regex scripts — they half-apply; use proper editor
  tooling (a corrupted `writeFileSync(join(AUDIT, ), …)` shipped once).
- `tests/import-brain/brain-routing.test.ts` mocks `server/lib/fleet` — new fleet
  exports must be added to the mock; its fetch stub lacks `status`/`headers`
  (`ai-call.js` tolerates this — keep it that way).
- Touch `shared/src/**` consumed by the server → rebuild + COMMIT the matching
  `server/lib/*-shared.cjs` (`pnpm build:fleet` / `build:import-brain` / `build:filing`).
- Client aborts read as `fetch: This operation was aborted` (timeout), server restarts
  as `fetch: terminated` (another lane deployed) — different causes, different fixes.
- The golden set encodes mapper conventions (workflow defaults ACTIVE/DRAFT/
  NOT_STARTED, sibling `order`, `allStates`, registry-synthesized refIds for
  TBD sources) — parity comes from the stage-7 ISO join, not from prompting.
- `additional_samples/` and `tmp_keys.md`/`model_secrets.md` are gitignored — never
  commit them.

## 6. Definition of done

NJ filing uploads yield non-empty, cited rate-order variables + manual rules + policy
coverages (or explicit, user-visible warnings explaining exactly what was dropped and
why) with no UI crash; CORE ≥0.95 F1; all four golden formats pass all three targets;
forms-lib-2025 imports within 30 min; persist E2E green; gate green; everything
committed on `main`, pushed, deployed, `orchestration.md` row updated with your final
sha; leftover probe tenants cleaned.
