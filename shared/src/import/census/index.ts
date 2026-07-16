// shared/src/import/census — the deterministic cell-census conservation layer.
// Pure TypeScript; zero platform imports. Server feeding lives in
// server/lib/import-brain/workbook.js (formatting needs live ExcelJS worksheets).
export * from './types'
export { fnv1a64 } from './hash'
export { buildSheetCensus, buildWorkbookCensus, colLabel, cellRef, rawVerbatim, classifyCellType, VERBATIM_CAP } from './buildCensus'
export { segmentTableRegions, rowBands } from './regions'
export { createAccounting, post, postSpan, rollupSheet, rollupWorkbook } from './accounting'
export type { SheetAccounting } from './accounting'
export {
  headerLockV2Signals, augmentHeaderCandidates,
  repeatingParentRuns, staircaseHierarchy,
  formTokenCensus, FORM_TOKEN_GENERAL,
  stateLexicon, idColumnProfile, REFID_SHAPE,
  nearDuplicateSheetClusters, harvestAliasOverlay, hiddenSheetSubstance,
  cellsGrid,
} from './detectors'
export type {
  HeaderRowSignals, RepeatingParentColumn, StaircaseSignal, StateSignal,
  IdColumnProfile, IdProfile, SheetCluster, EnumDomain, CensusAliasOverlay,
} from './detectors'
