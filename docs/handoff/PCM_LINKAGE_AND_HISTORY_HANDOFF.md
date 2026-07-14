# HANDOFF — PCM Attachment Integrity + Product History/Versioning (import perfection pass)

You own making imported products **structurally complete and fully linked** (every limit,
deductible, rating step, and form tied to its coverage per the PCM), and making **product
history/versioning work end-to-end**. Work autonomously: review → fix → gate → deploy →
live-verify → iterate until the acceptance criteria hold. Read this whole file first.

## 0. Prime directives (non-negotiable)

1. **Read first:** `CLAUDE.md` (binding invariants), `orchestration.md` (multi-agent protocol —
   other agents share this checkout AND dev), `product_first_principles.md` (the PCM
   methodology — THE spec for this task), `docs/handoff/IMPORT_BRAIN_HANDOFF.md` §5
   (gotchas that already bit), `docs/audit/import_eval_iso_join_investigation.md` (recent
   root-cause work you build on).
2. **Gate before push:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` +
   `node scripts/check-bundle-budget.mjs`. Canaries PH $1,528 / PA $1,002 / GL $2,635 stay green.
3. **Push = deploy** to `app-prodhub-dev` (~7 min, ADO run via
   `az pipelines runs list --organization https://dev.azure.com/garage-repos --project "Product Hub" --top 2`;
   az binary: `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`). A deploy RESTARTS dev
   and severs every in-flight SSE stream. **Batch pushes into waves.**
4. **Shared working tree:** `node tools/stowaway-check.mjs <paths>` before EVERY commit;
   `git commit --only <paths>`; never `git add -A`. Check `git status` at start — other
   sessions leave in-flight edits; foreign files are NOT yours to commit or revert.
5. **ALL live testing in the ACCENTURE TEST tenant** (`IMPORT_TENANT=accenture-test`,
   bootstrap admin/admin). Never touch `testco`. Tear down every product/draft you create.
   **Do NOT touch the user's own imported "Core" product in their tenant** — reproduce
   with your own upload.
6. **Import has no cost cap** (`IMPORT_CONTEXT`) but telemetry is never bypassed.
7. **Grounding:** every extracted field cited; refIds byte-for-byte or registry-derived;
   flagged-not-dropped; blank templates → empty plans. `refId` and form-number chips are
   load-bearing UI (invariant — never strip).

## 1. Wave 0 — inherit and ship the pending state (do this before anything else)

The previous session left verified-but-possibly-uncommitted work in the tree. Check
`git status` + `git log --oneline -5` and reconcile — the user said they may deploy it
themselves; whatever is still pending, YOU gate and ship it as your first wave:

| File | Change | Verification already done |
|---|---|---|
| `server/lib/import-brain/workbook.js` | Feed `brainShared.normalizeCellValue(...)` per cell into `isoGrids` (raw ExcelJS formula/richText objects broke the ISO mapper's state-scope tests → 137 rules-`allStates` misses) | Repro'd deterministically both ways; bridge export confirmed; typecheck green (EM session) |
| `server/lib/import-brain/stage4-extract.js` | Conflict ladder pooled ONCE per sheet into dense ≤20-row chunks (3-wide) + judge calls 4-wide (was: per-batch ladder — 2059 s of a 2292 s forms-library run, 40 opus calls) | Syntax + module load + `pMap` scope verified; brain tests 19/19; full gate green except one KNOWN FLAKE (below) |
| `scripts/import-eval.mts` | SSE stall watchdog (90 s), stage/notice logging into stdout + results JSON, always-dump extractions, `--rescore` offline re-scoring | Offline eval green 4/4 formats |
| `docs/handoff/IMPORT_BRAIN_HANDOFF.md`, `docs/audit/import_eval_iso_join_investigation.md`, `docs/audit/import_eval_results*.json` | Status + root-cause docs | n/a |

**Known flake (not yours, but it can red a pipeline):** `tests/server/metering.test.ts`
"accumulates tokens + cost per tenant" runs 4.4 s against a 5 s vitest timeout and fails
under full-suite load; passes isolated. Bump its timeout in a one-line change (own it in
your wave with a comment) rather than shipping a coin-flip pipeline.

**Post-deploy confirmations owed** (run after wave 0 deploys, detached — see §6):
- CORE live eval on the instrumented harness — expect **F1 ≈ 0.999** (was 0.967 with the
  `allStates` misses; the workbook.js fix removes them):
  `IMPORT_EVAL_TIMEOUT_MS=7200000 IMPORT_EVAL_ONLY=CORE IMPORT_TENANT=accenture-test npx tsx scripts/import-eval.mts --live` (~95 min, run solo, no pushes mid-run).
- Forms-library timing re-run (stage-4 pooling should cut the 2292 s run to well under
  1800 s): one-request probe of
  `additional_samples/Product_Forms Library_General Liability Example_2025.xlsx`.
  Watch extraction QUALITY parity too: entity/flag counts in the same ballpark
  (was: 656 entities, 6 flagged, 118 stage-5 discrepancies).

## 2. Problem A — PCM attachment integrity (the screenshot problem)

The user imported the CORE Product Specifications workbook via the UI. Result (screenshot
evidence, product "Core", 112 coverages):

- **Every coverage card shows Limits `–`, Deductibles `–`, Pricing `–`** even though the
  workbook contains Limits & Deductibles specification sheets and rating specifications.
- **Forms are partially linked**: some coverages show forms (2, 34, 15), most show `–`.
- Rules and States counts DO populate (17/3/14/…, 15/14/11 states).
- Product header says **"0 states"** while its coverages carry 15 states — the product-level
  rollup is missing.
- Product chip row: LOB **"Personal Auto"** but marketSegment reads **"Personal Lines /
  Property"** — identity fields inconsistent (auto product, property segment).
- The imported product shows **"Live"** immediately — confirm whether an import is supposed
  to land ACTIVE/Live directly (mapper adopts source `status`) or should arrive as a draft
  pending promote; make the behavior deliberate and documented, not incidental.

Per `product_first_principles.md` this is a **methodology violation**, not cosmetics: a
coverage MUST have a limit, a deductible, a premium (else it is not a coverage), and the
**Product Framework ID is the linkage key** tying Forms/Rules/Rating to PCM nodes. "Imported
but unlinked" is the exact failure the PCM exists to prevent.

### Where to look (verified starting points, not conclusions)

- `server/lib/import-brain/stage7-plan.js` DOES assemble `ldTables` / `rtTables` /
  `ratingProgram` (lines ~304–408) including the iso-join and stamps `productId` on tables.
  So the pipeline has the data. The gap is somewhere between plan assembly → persist →
  what the UI reads.
- The UI (`app/src/routes/product/ProductCoverages.tsx`) renders "Limits and Deductibles
  (typed standard options)" **per coverage** — find exactly which docs/fields the coverage
  card counts (coverage-doc-embedded `limits`/`deductibles` arrays? separate `ldTable`
  entities keyed by coverage refId? compare against how the SEEDED products (PH/PA/GL, which
  render correctly) store limits/deductibles/pricing — `shared/src/seed/*` +
  `scripts/migrate-to-cosmos.ts` are the reference shape).
- Likely root-cause classes (verify, then fix at the right layer):
  1. **Schema mismatch**: import persists `ldTables`/`rtTables` as standalone entities while
     the UI reads coverage-embedded options (or vice-versa). Fix = fold at stage-7/persist
     into the app's canonical shape — the app model is the contract, not the import's.
  2. **Linkage-key mismatch**: refId dot-vs-dash (`GL.COV.001` vs `GL-COV-001` docIds — the
     same class as the `parentId` resolver fix in `server/lib/data.js` ~line 240), or
     `productId` stamped but `coverageRefId` absent on tables.
  3. **Source sheets never parsed**: the CORE L&D / rating sheets may not be recognized by
     `mapIsoWorkbook` or the brain's column mapper (check `brain:stage1` classify output for
     which sheets were ignored). If the source data never enters the plan, the completeness
     assessment must SAY so (`importWarnings` + pillar assessment), loudly, in the review UI.
  4. **Forms partial linkage**: formNumbers arrays exist (mapper gap-fill) but form
     entities don't resolve to coverage attachment — trace one coverage that shows `34`
     against one that shows `–` and diff their persisted docs.
- Reproduce with the same workbook the eval uses: `scripts/import-eval.mts` `FORMATS` names
  the CORE sample files under `samples/`. Upload via `POST /api/ai/unifiedImport` (raw
  base64 docs) or the Builder UI in `accenture-test`, persist the draft, then inspect the
  persisted docs via `POST /api/db/list` (`{path: 'products/<id>/coverages'}` etc.) and the
  rendered UI.

### Acceptance criteria (A)

For a CORE workbook import into `accenture-test`:
- Every coverage whose source sheets define limits/deductibles shows them in the UI
  (non-`–`), backed by correctly-linked persisted docs; coverages genuinely lacking source
  data carry an explicit `importWarning` visible in the review UI — never silent `–`.
- Rating: the product Pricing tab and coverage Pricing counts reflect the imported rating
  program/steps/tables, linked by Framework ID; premium-bearing coverages reference their
  rating steps.
- Forms: every formNumber chip resolves to a persisted form entity attached at the correct
  PCM level (base form → product, coverage/exclusion forms → coverage, notices → LOB —
  §5.2 of the first-principles doc).
- Product rollups correct: states rollup (not "0 states"), marketSegment derived from the
  LOB registry (auto ≠ "Property"), LOB chip consistent.
- All of the above **locked by tests + eval** (see §4), not just fixed once.

## 3. Problem B — product history / versioning broken

User report: the History surface shows nothing for imported products AND ordinary product
changes are not getting logged. Facts already verified in code:

- The mutation envelope (`server/lib/data.js` ~line 280) writes a `kind: 'version'` doc
  (`id: ver:<path>:<rev>`, `entityPath`, `rev`, `op`, `diff`, `actor`, snapshot semantics)
  in the SAME transactional batch as the entity + audit event. The write side exists.
- The UI reads versions in `app/src/components/product/HistoryDrawer.tsx` via
  `useProductCtx().versions` → `app/src/context/ProductContext.tsx` → adapter.
- **Scent trail:** the generic `POST /api/db/list` endpoint filters `c.kind = 'entity'` —
  it can NEVER return `kind:'version'` docs. Find what ProductContext actually calls: if it
  lists a Firebase-era `versions` subcollection path through `db.list`, it gets `[]` forever
  on the Azure adapter. Either a dedicated versions endpoint exists and is broken/unwired,
  or it never got ported in the Azure cutover. Also check `POST /db/mutateBatch` (the bulk
  path imports use) writes version ops per entity like `mutate` does — if it skips them for
  throughput, imported entities have no version zero and restore can't work.

### Repro protocol (before fixing)

In `accenture-test`: (1) edit a field on a SEEDED product (e.g. a coverage name on
PA.PROD.001) via the UI → does HistoryDrawer show it? does Cosmos hold `ver:...` docs
(query via a read-only script)? (2) import a workbook → persist → any version docs for the
draft's entities? This splits read-side vs write-side definitively. Fix at the right layer,
then add: a server integration test asserting mutate/mutateBatch produce version docs and a
versions-read endpoint test; a UI test for HistoryDrawer rendering + restore path
(restore uses `expectedRev` — verify 409 conflict handling still works).

### Acceptance criteria (B)

- Editing any entity through the UI produces a History entry (correct actor, diff, rev)
  visible in HistoryDrawer within one refresh; restore-to-snapshot works and writes its own
  version.
- Imported entities carry version zero (create) with the import lineage/actor, visible in
  History.
- Audit chain remains intact (`/api/db/audit/verify` green) — do not fork the envelope;
  the version fix must ride the SAME transactional batch (atomic-mutations invariant).

## 4. Hardening — make "perfectly loaded" measurable and locked

The golden eval (F1/numeric/citations) scores per-entity fields, so it stayed green while
attachments were missing. Close that class:

1. **Linkage metrics in the eval**: extend `scripts/import-eval.mts` `score()` (and golden
   sets under `tests/golden/import/` if needed) with an attachment score: % of coverages
   with limits/deductibles when source defines them, % formNumbers resolving to form
   entities, % premium-bearing coverages referenced by rating, parentId resolution rate,
   product rollups (states, marketSegment). Report per-format; target 100% where source
   data exists. Add to the results JSON and the pass/fail gate.
2. **Persist-side referential integrity**: a post-import verification pass (e.g.
   `scripts/import-verify.mts <tenant> <productId>`) that walks the PERSISTED draft and
   asserts every cross-reference resolves (parentId, formNumbers, table↔coverage,
   step↔coverage). Wire it into the live harness (`pnpm import:live` roundtrip slice) so
   every future live run proves linkage, not just extraction.
3. **Completeness surfacing**: the stage-7 pillar assessment / `PARTIAL_NO_BACKBONE`
   machinery exists — extend it to attachment gaps ("N coverages missing limits — source
   sheet 'X' unmapped") and make sure the review UI renders it prominently before persist.
4. **Offline goldens for the fold**: if you fold L&D/rating into coverage docs at stage-7,
   regenerate goldens deliberately (`--write-golden`) and eyeball the diff — goldens encode
   mapper conventions on purpose.
5. **Scoring artifact decision** (small, from the investigation doc): golden fields that
   canonicalize to null still count as misses when the entity omits the field (~0.015 F1 on
   CORE). Decide the semantics, implement, and note it in the results JSON so runs stay
   comparable.

## 5. Other enhancements (fold into your waves where natural)

- **Iso-join intermittency watch**: the full-workbook iso-join skipped at least once
  (07:21Z run) with no code diff vs a later joining run. The instrumented eval now logs the
  skip notice. If you ever see `Deterministic ISO mapper skipped: <reason>` live, capture it
  and fix the cause — the investigation doc is the dossier.
- **`import_eval_extracted-*.json` + `--rescore`**: use them to iterate scoring cheaply;
  only `--live` validates server-side changes.
- **UI truthfulness**: coverage cards render `–` for both "none defined" and "zero after a
  broken join" — distinguish "no source data (warned)" from genuine zero if cheap to do.
- **Version pruning/pagination**: if version docs accumulate per import (thousands of
  entities × versions), check HistoryDrawer/list paging so the product workspace stays fast
  (admin paging patterns exist from the control-plane lane).

## 6. Harnesses, environment, gotchas

- Live probes: build a small SSE client (pattern: `review-packet/capture-current-state.mjs`
  for Playwright auth-injection; a fetch-based SSE reader for `/api/ai/unifiedImport` —
  bootstrap `admin/admin` on `https://app-prodhub-dev.azurewebsites.net`, tenant
  `accenture-test`). **tee output to a file — piping to `head` SIGPIPE-kills probes.**
- Long runs (>10 min): the Bash tool's background cap kills them. Use PowerShell
  `Start-Process` on a **CRLF/ASCII `.cmd`** (Write-tool `.cmd` files get LF and silently
  no-op — write via PowerShell `Set-Content -Encoding Ascii`), log to a file, watch with a
  `tail -f | grep --line-buffered` monitor that matches FAILURE signatures too.
- `pnpm import:eval -- --live` env: `IMPORT_EVAL_ONLY`, `IMPORT_TENANT`,
  `IMPORT_EVAL_TIMEOUT_MS`; results land in `docs/audit/import_eval_results*.json`.
- All of `docs/handoff/IMPORT_BRAIN_HANDOFF.md` §5 applies (runtime-only import misses;
  never edit files via `node -e`; `tests/import-brain/brain-routing.test.ts` fleet-mock must
  gain any new fleet exports; rebuild + commit `server/lib/*-shared.cjs` when touching
  consumed `shared/src/**` — `pnpm build:fleet` / `build:import-brain` / `build:filing`;
  client `aborted` vs server `terminated`).
- Direct Cosmos writes from local scripts may be permission-denied by the harness — prefer
  the app's own APIs; read-only Cosmos queries are fine (real account:
  `cosmos-prodhub-dev-1r99` / db `prodhub`, creds via
  `az webapp config appsettings list -n app-prodhub-dev -g rg-prodhub-dev`).
- `app/src/routes/product/ProductCoverages.tsx` was touched by another session recently —
  check `git status`/`git log` for it before editing and coordinate via `orchestration.md`.

## 7. Definition of done

1. Wave 0 shipped and confirmed: CORE live ≈0.999 (or the gap explained + fixed), forms-lib
   < 1800 s with quality parity, metering flake de-flaked.
2. A fresh CORE workbook import in `accenture-test` renders every coverage with its
   limits/deductibles/pricing/forms per the source (or an explicit visible warning),
   correct product rollups and identity — verified in the LIVE UI (Playwright or manual
   screenshot parity with the user's report) and via persisted-doc inspection.
3. History works: UI edits and imports both produce visible, restorable History entries;
   server + UI regression tests added; audit chain verify green.
4. Linkage metrics wired into eval + a persist-side integrity checker in the live harness;
   all four golden formats still pass F1 ≥ 0.95 / numeric ≥ 0.98 / citations 100% **plus**
   the new attachment targets.
5. Gate green; everything committed on `main`, pushed, deployed, pipeline green;
   `orchestration.md` workstream row + deploy log updated with your final sha; every probe
   tenant/draft you created torn down; a successor handoff written ONLY if anything
   material remains open.
