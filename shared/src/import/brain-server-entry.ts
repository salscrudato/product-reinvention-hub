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
// LOB inference for the router's line-of-business hint: refIds are DERIVED from the
// registry (prefix match / signal inference) — never invented by a model.
export { LOB_REGISTRY, resolveLobByRefId, inferLob, synthesizeRefId } from '../insurance/lobRegistry'
// Deterministic ISO-family mapper: the canonical-identity oracle for recognized
// template workbooks. Stage 7 joins its registry-derived refIds/order/hierarchy
// with the brain's cited extraction (mapper = identity, brain = provenance).
export { mapIsoWorkbook } from '../insurance/isoImport'
