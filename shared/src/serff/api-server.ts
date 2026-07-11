// serff/api-server.ts — entry point for the server-side CJS bundle of the SERFF module.
// Compiled by `pnpm build:serff` (esbuild) to server/lib/serff-shared.cjs.
// Exports only what server/lib/serff.js needs; no UI code, no app-layer dependencies.
// Run `pnpm build:serff` whenever shared/src/serff/** or shared/src/changeset/** change.

// ── Diff engine ────────────────────────────────────────────────────────────────
export { diffProducts } from '../changeset/diff'
export type { ProductSnapshot } from '../changeset/diff'
export type { ChangeSet } from '../changeset/types'

// ── SERFF bundle assembler ─────────────────────────────────────────────────────
export { generateRedlineDocuments } from './redline'
export { generateRateExhibit, computePremiumImpacts, buildHistogram, overallImpactPct } from './rateExhibit'
export type { ExhibitInputScenario } from './rateExhibit'
export { buildMemoStructure } from './memo'
export { assembleSerffBundle, documentsInTab } from './bundle'
export type { BundleInput } from './bundle'
export { checkTexasBundle } from './reviewer'

// ── Types ──────────────────────────────────────────────────────────────────────
export type {
  SerffBundle, SerffDocument, SerffTabName, SerffGrouping,
  RedlineContent, RateExhibitContent, MemoContent,
  ReviewerResult, ReviewerFinding, ReviewerCheckItem,
} from './types'

// ── State filing matrix ────────────────────────────────────────────────────────
export { STATE_FILING_MATRIX, TEXAS_FILING_PROFILE, getStateProfile, requiresMarkedCopies, requiresRateExhibits } from '../registry/stateFilingMatrix'
export type { StateFilingProfile, FilingType, SerffTabRequirements } from '../registry/stateFilingMatrix'

// ── Rating kits (resolveRatingKit → line-appropriate getter factories + worked example) ──
export { resolveRatingKit } from '../rating/kits'
export type { RatingKit } from '../rating/kits'
