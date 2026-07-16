// @pf/shared platform module — feature flags + per-tenant config schema.
// Pure, platform-import-free. Consumed by the app (via the @pf/shared barrel) and
// by the server (via server/lib/platform-shared.cjs, built from ./server-entry.ts).
export * from './featureFlags'
export * from './tenantConfig'
export * from './portfolio'
