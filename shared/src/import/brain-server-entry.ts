// shared/src/import/brain-server-entry.ts
// CJS bundle entry for server/lib/import-brain-shared.cjs (built via build:import-brain).
// Exports only deterministic helpers needed by the server brain stages:
//   - headerScore scoring functions (scoreHeaderCandidates, pickBestHeaderRow)
//   - CANONICAL_MAP + SURFACED_COLUMNS from the canonical field dictionary
// Brain-specific constants (SHEET_DOMAINS, DOMAIN_ENTITY_KINDS, confidence thresholds,
// utility functions extractJson / colLetter / splitMultiRefId) are inlined in
// server/lib/import-brain/constants.js to avoid TypeScript-to-CJS coupling.
// Zero platform imports; esbuild bundles this tree-shake safe.
export { scoreHeaderCandidates, pickBestHeaderRow } from './structure/headerScore'
export { CANONICAL_MAP, SURFACED_COLUMNS } from './canonicalMap'
// Server-side structural fingerprinting (stage 0 router): grid → StructuralModel
// with the real normalized cell grid embedded (SheetFingerprint.cells).
export { buildStructuralModel, fingerprintGrid, MAX_EMBED_ROWS, MAX_EMBED_COLS } from './structure/modelBuilder'
export { normalizeCellValue } from './structure/sentinels'
// Stacked sub-table segmentation + layout detection. Both are pure and deterministic
// over their cell grid, so the stage-0 router RE-INVOKES them after upgrading a
// truncated fingerprint to the authoritative uncapped grid. Two distinct losses ride
// on this: sub-tables segmented from the capped grid stop at the 2000-row cap (on a
// 7,184-row sheet that leaves 197 of 237 blocks unsegmented), and a sheet whose SECOND
// marker falls past the cap does not even register as STACKED_TABLES, because both
// detectors require >= 2 markers to fire.
export { segmentStackedTables } from './structure/stackedSegmenter'
export { detectLayoutShape } from './structure/layoutDetector'
// LOB inference for the router's line-of-business hint: refIds are DERIVED from the
// registry (prefix match / signal inference) — never invented by a model.
export { LOB_REGISTRY, resolveLobByRefId, inferLob, synthesizeRefId, refIdSegmentKind } from '../insurance/lobRegistry'
// THE canonical refId -> docId mint (BACKLOG_SEED item 1 / R1): case-preserving
// dot->dash. Server minters (stage7-plan, unified-import fallback) MUST use this —
// the lowercasing variants they carried produced parents the data.js validator
// could never resolve (422 INVALID_PARENT silent child drop).
export { refIdToDocId, dashId } from '../insurance/refId'
// Cell census (CE1): the deterministic conservation layer. workbook.js feeds
// RawCensusSheet from live ExcelJS worksheets; everything else is pure here.
export {
  buildSheetCensus, buildWorkbookCensus, fnv1a64, segmentTableRegions,
  createAccounting, post, postSpan, rollupSheet, rollupWorkbook,
  headerLockV2Signals, augmentHeaderCandidates, repeatingParentRuns,
  staircaseHierarchy, formTokenCensus, stateLexicon, idColumnProfile,
  nearDuplicateSheetClusters, harvestAliasOverlay, hiddenSheetSubstance,
} from './census'
// Deterministic ISO-family mapper: the canonical-identity oracle for recognized
// template workbooks. Stage 7 joins its registry-derived refIds/order/hierarchy
// with the brain's cited extraction (mapper = identity, brain = provenance).
export { mapIsoWorkbook } from '../insurance/isoImport'
// THE placeholder-sentinel rule. A cell reading "<Intentionally Blank>", "N/A", or
// "Intentionally left blank" is the workbook SAYING NOTHING at that level — it is not a
// value. The deterministic mapper has always blanked these (its `clean()`); the brain had
// no such notion, so a parent coverage row (whose SUB-COVERAGE cell holds the sentinel)
// imported with the sentinel as its literal name. One exported predicate keeps both paths
// on the same definition instead of two drifting copies.
export { isPlaceholder } from '../insurance/isoImport'
