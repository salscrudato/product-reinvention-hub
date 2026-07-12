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
