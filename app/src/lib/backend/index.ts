// Single export point for the active backend adapter.
// Fully merged to Azure: data (Cosmos) + auth (JWT) + AI (Foundry) via the
// same-origin /api host (see azure.adapter.ts).
export { adapter, setSuperAdminTenant, getSuperAdminTenant, resolveApiUrl } from './azure.adapter'
export type { BackendAdapter, AuthUser, Session, Query, MutationPayload, TenantInfo, ManagedUser, TenantMember, TenantSummary, AuditSearchEvent, AuditSearchFilters, Tier, Capability, PortalPolicy, PortalSummary, DraftIdentity, DraftReadiness, DraftDedupMatch, PortfolioPulse, TenantResolveResult, TenantMembership, ImportRunStatus, ImportRunStageSummary, ImportRunStep, ImportRunOutcome, ImportRunSpend, ImportRunDocument, ImportRunSummary, ImportRunPayload, ImportRunTrace } from './types'
export { MutationConflictError, PromoteBlockedError } from './types'
