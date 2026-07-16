# CE1 REPORT - Deterministic core: cell census, parser armor, docId unification

Lane: `ce1-census` (worktree `.claude/worktrees/ce1-census`, branch `ce/ce1-census`,
fork `main@0ad8689`). Model: claude-fable-5 (no fallback). ASCII only. Zero pushes.

Companion artifacts: [ledger.json](ledger.json) (per-step rows + commits),
[CELL_CENSUS.md](CELL_CENSUS.md) (corpus baseline + findings F-C1..F-C8),
[BASELINE/](BASELINE/) (per-file census JSON).

## 1. What was built

| Step | Deliverable | Commit |
|---|---|---|
| S1 | Preconditions, lineage reconciliation (prompt said d28c8a1/feat branch; actual tip main@0ad8689, ancestor verified), baseline gate green on Node 24 (server npm deps are a fresh-worktree gotcha) | b3c5631 |
| S2 | `refIdToDocId` in `shared/src/insurance/refId.ts` (case-preserving dot->dash; `dashId` alias); isoImport consumes it; bridged; stage7-plan `toDocId` lowercasing DELETED for refIds; unified-import :374 mint canonical; data.js third (lowercase) parent candidate; locks 1a (142-refId seed walk) + 1b (CSV child-persist e2e through the REAL envelope) + 1c (canaries + byte-stable goldens) | 9212101 |
| S3 | `inspectOoxmlContainer` zip pre-inspection (EOCD+CEN, zip64-aware, declared sizes only, IMPORT_413 structured errors, env-tunable ceilings); parse wall-clock race; L4 used-range locks (synthetic + real All Lines); F-0 residual closed (`collectWorkbookSignals` exported seam-free, crash-census replica deleted, router twin pinned) | 415efd2 |
| S4+S5 | `shared/src/import/census/` conservation layer (CellRecord/SheetCensus/TableRegion/accounting math) + detectors a-i, bridged, 39 unit tests + live SECURA smoke | c938f15 |
| S7 | `scripts/ops/corpus/cell-census.mjs` + BASELINE artifacts + CELL_CENSUS.md findings (run before S6; self-contained) | 740a463 |
| S6 | consumedSpans instrumentation in mapIsoWorkbook + ld/rt/reference parsers; byte-identity locks on all four real formats | 8a9f19c |
| S8 | L1-L7 pinning locks (L4 rode S3) | c07057e |
| S9 | fast-check property fuzz: census never throws, accounting sums exactly, segmentation deterministic (600 runs) | 6e4f5ee |

Numbers: the four premium canaries stayed exact throughout (PH 1528 / PA 1002 /
GL 2635 / filing-import 1281); offline eval 4/4 formats F1 = 1.0000 with
byte-identical goldens after every wave.

## 2. Deliberate non-goals (and why they are safe for now)

- `'fil-prod'` literal product docId at `unified-import.js:397` left in place: its
  twin lives at `stage-filing.js:517` (outside this lane's allowlist); changing one
  half of a matched pair splits a convention inside one feature. The :374 coverage
  mint (the spec target) IS canonical now. CE3 item.
- `dashId` private copy in `shared/src/insurance/filing/reconcile.ts:55` untouched:
  same case-preserving semantics, but that file feeds the locked $1,281 filing
  canary and is outside the allowlist. CE3 folds it onto refId.ts.
- `stage0-router.js` untouched (not allowlisted): its internal
  `collectWorkbookSignals` twin survives but is PINNED byte-identical to the
  exported one by a source tripwire test; its catch still folds IMPORT_413 into the
  generic `unparseable-workbook` warning kind - the message text carries the
  structured reason, a dedicated notice kind is CE3.
- Census is NOT wired into the live import path: the full formatting walk costs
  1.3 GB child RSS on All_Lines (F-C6). CLI-only until CE3 adds a formatting-lite
  mode.
- Hidden-sheet extraction policy, near-dup cluster folding, >128-col wide-matrix
  recovery: census REPORTS all three; policy flips are CE3 by design.
- Historic lowercase docIds already persisted in Cosmos are NOT re-keyed (that
  would fork audit chains); they stay reachable via the validator's third
  candidate. Re-import remains the clean fix per entity.
- `scripts/import-eval.mts` reader slowness (trusts `ws.rowCount`; CORE walks
  ~286s of phantom cells per parse) observed, measured, NOT fixed - eval harness
  changes are CE2's namespace.

## 3. Census baseline (summary - full table in CELL_CENSUS.md)

10/10 corpus files censused, zero crashes, zero timeouts, conservation identity
EXACT on every sheet. Highlights: SECURA hidden "Forms View - MTG" = 2,072 cells
(prediction confirmed to the cell); PCM Coverages version trio clusters on header
signature; SECURA Ref Connect Pull segments into 3 regions across 16-row blank
runs; total corpus substance 247,532 non-empty cells across 150 sheets.

EXPECTATION FAILED HONESTLY (F-C4): the predicted 148-col Client Master PCM does
not exist in this corpus - observed 689x71 reported / 70 real; NO sheet exceeds
128 real cols anywhere in the 10 files, so the embed-cap loss case is currently
untestable. CE3 needs a synthetic wide fixture or the missing reference workbooks
(memory says 17 were planned; 6 are present).

## 4. Unaccounted-risk mechanisms handed to CE3

1. Every censused cell is UNACCOUNTED until a poster claims it - the ledger
   exists, posting from the LIVE pipeline (stage-4/7 + mapper spans -> FACT/SCHEMA)
   is the next wave. consumedSpans are emitted; nothing posts them in production yet.
2. Merge-anchor-empty under-count: the census assumes the anchor carries the
   value. A hand-crafted sheet whose merged VALUE sits on a covered (non-anchor)
   cell would be auto-shadowed and the substance under-counted. Not observed in
   the corpus; unpinned.
3. Declared-size trust: the zip armor reads CEN-declared sizes. A zip whose LOCAL
   data streams inflate larger than the central directory declares would pass
   pre-inspection (mitigated upstream by the 25 MB body cap; a streaming
   inflate-budget guard is the CE3 armor extension).
4. parseWallClockMs bounds WAITING, not CPU: ExcelJS cannot be aborted mid-parse
   in-process. Harnesses use child isolation; the live host relies on the
   pre-load ceilings killing the memory-bomb class first.
5. Sheet-level visibility only: hidden ROWS/COLUMNS inside visible sheets are not
   captured by the census records (ExcelJS row/col hidden flags exist - CE3 can
   extend CellRecord.format).
6. Data Validation harvest covers type='list' only; formula-sourced domains are
   recorded as sourceRange but not resolved cross-sheet.
7. Formula cells contribute their CACHED result (same contract as the reader); a
   workbook saved with stale caches lies to both equally - flagged, not solved.

## 5. Hostile self-review

**1. Which corpus sheet came closest to breaking gap segmentation, and what
exactly defended it?**
SECURA_Property "Ref Connect Pull" (4,983 x 41, stacked blocks separated by blank
runs up to 16 rows, interior single blank rows inside blocks). Two rules defended
it, both now pinned: the blank-run threshold (`BLANK_RUN_SPLIT = 2` in
`shared/src/import/census/regions.ts`) keeps single blank separator rows INSIDE a
region (unit: "a SINGLE blank row does not split; a run of 2+ does") while the
16-row runs close regions; and the disjoint-band rule only splits when the
incoming row band shares NO columns with the running region (unit: "an
overlapping band widens the region instead of splitting"), so the sheet's ragged
right edge could not shatter one block into confetti. Result: 3 regions,
deterministic under re-run (also property-fuzzed, 200 runs).

**2. Prove mapper instrumentation changed nothing - evidence, not a claim.**
Three independent proofs, all run AFTER the S6 edits:
- Runtime serialize-diff on all four real formats
  (`tests/import/consumed-spans.test.ts`, grids from the REAL server reader):
  `expect(JSON.stringify(instrumented)).toBe(JSON.stringify(bare))` - GL, IM, PR,
  CORE all green (4/4, 21s).
- Golden regeneration: `npx tsx scripts/import-eval.mts --write-golden` then
  `git diff tests/golden/import/` -> `GOLDEN DIFF LINES: 0`. Post-change sha256:
  CORE 0b0c52483cf6b413..., GL cb91405eeb941630..., IM 265a8a57a2e79b35...,
  PR 097263c13b68b3fe... - identical to the committed (pre-change) bytes.
- Offline eval after the edits: 4/4 formats F1 1.0000 / numeric 1.0000 /
  extras 0 / parent=edges=forms=1.000.

**3. Where could the census double-count or under-count merged spans? Show the
test that pins it.**
Double-count: a merged banner's covered cells carry the anchor's value in ExcelJS,
so naive counting books the same substance N times. Pinned by census.test.ts
"merge double-count pin: the 2-wide banner is ONE substance cell + ONE shadow" -
nonEmpty 11, denominator excludes the shadow (11 - 1 shadow - 3 header - 1 noise
= 6), coverage lands exactly 1.0, and posts to the shadow are REJECTED
("shadow is immutable" assertion). Under-count: the symmetric hole - an
empty-anchor merge whose value sits on a covered cell - is NOT pinned; recorded
as CE3 handoff item 2 above (no corpus file exhibits it).

**4. What did you deliberately NOT armor, and why is that safe until CE3?**
See section 2/4: local-vs-CEN declared-size mismatch (upstream 25 MB body cap
bounds the blast radius; ratio+total ceilings kill the cheap version of the
attack), in-process parse abort (child isolation covers harnesses; pre-load
ceilings cover the live memory class), hidden rows/cols and >128-col recovery
(census observes, no policy flip without CE3's fixtures), and the live-path
census wiring (1.3 GB RSS says not yet). Each is bounded by an armor layer that
DOES exist in front of it.

**5. If Fable was unavailable and you ran on Opus: what would Fable have designed
differently?**
Not applicable - this ran on claude-fable-5 end to end (confirmed in-session
before the first edit; ledger row CE1-S1). The two places where model judgment
materially shaped the design, for the record: (a) `declaredCellCount` is enforced
as declared-sheet-XML-bytes / 24 rather than the dimension element, because the
literal reading would have rejected the exact phantom-row corpus files the
used-range clamp exists to save - the spec self-contradicted and the estimator
resolves it in favor of L4; (b) the S6 byte-identity lock reads grids through the
real server reader instead of the eval flatten after measuring a 286s phantom
walk - same lock, 20x cheaper, and it locks the grids the live oracle actually
sees.

## 6. DONE-WHEN checklist

- [x] Gate green (typecheck, lint, test, build) - final run at close, plus per-step
- [x] Four canaries exact (locked tests, 30 assertions)
- [x] Offline eval byte-stable (goldens regenerated, git diff 0 lines, sha256 match)
- [x] Bundle budget green (app untouched; proven anyway at close)
- [x] refIdToDocId canonical everywhere in scope; CSV child-persist e2e green;
      dashId === refIdToDocId over the seed corpus (142 ids)
- [x] Zip bombs rejected with structured IMPORT_413 (ratio + entry-count fixtures,
      plus total-bytes and cell-estimate variants); L4 green on the real
      million-row sheet AND a synthetic
- [x] cell-census.mjs: 10/10 corpus files, zero crashes, accounting sums exactly
      to nonEmpty everywhere
- [x] L1-L7 locks green (18 assertions; L4 in parser-armor.test.ts)
- [x] Property fuzz green (3 properties, 600 runs)
- [x] consumedSpans proven output-identical (three independent proofs)
- [x] Zero pushes; ledger complete; this report exists
