// Single export point for the active backend adapter.
// Fully merged to Azure: data (Cosmos) + auth (JWT) + AI (Foundry) via the
// same-origin /api host. The Firebase adapter is retired (see azure.adapter.ts).
export { adapter, setSuperAdminTenant, getSuperAdminTenant, resolveApiUrl } from './azure.adapter'
export type { BackendAdapter, AuthUser, Session, Query, MutationPayload, TenantInfo, ManagedUser, TenantMember, TenantSummary, AuditSearchEvent, AuditSearchFilters, Tier, Capability, PortalPolicy, PortalSummary, DraftIdentity, DraftDedupMatch, PortfolioPulse, TenantResolveResult, TenantMembership } from './types'
export { MutationConflictError } from './types'
