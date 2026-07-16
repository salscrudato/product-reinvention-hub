// @pf/shared — pure TypeScript; zero platform imports.
// Exports types, rating evaluator, rules engine, retrieval ranker, and seed data.
export * from './types'
export * from './rating/evaluator'
export * from './rating/rtGrid'
export * from './rating/gridInputs'
export * from './rating/kits'
export * from './rules/engine'
export * from './insurance/terms'
export * from './insurance/termConstraints'
export * from './insurance/ranges'
export * from './insurance/lobRegistry'
export * from './insurance/inventory'
export * from './insurance/isoImport'
export * from './insurance/extraction'
export * from './insurance/filing'
export * from './insurance/scaffold'
export * from './dictionary/usage'
export * from './grounding/citations'
export * from './grounding/sources'
export * from './grounding/portfolioDigest'
export * from './claims/lineProfiles'
export * from './search/rank'
export * from './feedback/priority'
export * from './cost/budget'
export * from './cost/breaker'
export * from './cost/semanticCache'
export * from './retrieval/types'
export * from './retrieval/chunk'
export * from './retrieval/retrieve'
export * from './seed/personalHome'
export * from './seed/personalAuto'
export * from './seed/generalLiability'
// GTM launch tracker — process template + backward scheduler (pure, deterministic) + the
// Process Value Explorer → template converter that generates the process seed.
export * from './gtm/types'
export * from './gtm/schedule'
export * from './gtm/plan'
export * from './gtm/processExplorer'
export * from './seed/gtmProcess'
// Line Intelligence Registry — pure data archetypes for all P&C families.
export * from './lines'
// Unified ingestion service types — FormatFingerprint, ExtractionPlan, UnifiedProposalBundle, etc.
export * from './import'
// Multi-model fleet constants — ModelRole, FleetDeployment, DEPLOY_*, resolveDeployment.
export * from './ai/fleet'
// Clone-based change-set diff engine + typed ChangeSet shapes.
export * from './changeset/types'
export * from './changeset/diff'
// State filing-type matrix — Texas fully populated; all states stubbed.
export * from './registry/stateFilingMatrix'
// SERFF filing bundle assembler + Texas DOI reviewer lens (pure, deterministic).
export * from './serff'

export * from './platform/portfolio'
