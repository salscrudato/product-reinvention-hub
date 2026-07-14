// featureFlags.ts — the platform feature-toggle registry (single source of truth).
//
// Two layers:
//   • GLOBAL default   — platform-wide, set by SUPER_ADMIN. Authoritative.
//   • PER-TENANT override — set by TENANT_ADMIN, ONLY for flags the platform marks
//                           `tenantOverridable`, and ONLY within the precedence rule below.
//
// PRECEDENCE (see resolveFlag):
//   1. registry default
//   2. GLOBAL override  — a platform DISABLE (false) is a FLOOR: a tenant can never
//      re-enable a surface the platform switched off (matches the live-test contract
//      "global Rating off → routes deny platform-wide").
//   3. TENANT override  — applies only when the flag is tenantOverridable and the
//      platform has not floored it. A tenant may disable a surface for itself, or
//      re-enable one the platform left enabled-by-default.
//
// Adding a toggle is ONE LINE in FEATURE_FLAGS plus one `requireFlag('<key>')` on the
// server route (and, for a nav surface, one `flags['<key>']` guard in the client shell).
//
// This module is PURE (no platform imports): bundled to server/lib/platform-shared.cjs
// via `pnpm build:platform` and imported by the app through the @pf/shared barrel, so the
// SAME registry drives client nav-hiding and server-side route enforcement.

export type FlagGroup = 'tab' | 'page' | 'feature'

export interface FeatureFlagDef {
  /** Stable key, namespaced `<group>.<name>`. Never rename (config persists by key). */
  key: string
  /** Human label for the ops/admin UI. */
  label: string
  group: FlagGroup
  /** Registry default when neither the platform nor the tenant has an opinion. */
  defaultEnabled: boolean
  /** May a TENANT_ADMIN set a per-tenant override for this flag? (the platform allowlist) */
  tenantOverridable: boolean
}

// ─── The registry ────────────────────────────────────────────────────────────
// Surface names reconciled with the live app (app/src/routes/**) and the F1/F3/F4
// workstream notes in orchestration.md: /pricing (F1·A), /portal PolicyholderPortal
// (F4·B), the import "Watch the agents" agent visualizer (F3·A), and the (designed)
// share-link seam (F1·A).
export const FEATURE_FLAGS: readonly FeatureFlagDef[] = [
  // Product-workspace tabs
  { key: 'tab.overview',   label: 'Overview tab',   group: 'tab', defaultEnabled: true, tenantOverridable: true },
  { key: 'tab.coverages',  label: 'Coverages tab',  group: 'tab', defaultEnabled: true, tenantOverridable: true },
  { key: 'tab.rules',      label: 'Rules tab',      group: 'tab', defaultEnabled: true, tenantOverridable: true },
  { key: 'tab.forms',      label: 'Forms tab',      group: 'tab', defaultEnabled: true, tenantOverridable: true },
  { key: 'tab.states',     label: 'States tab',     group: 'tab', defaultEnabled: true, tenantOverridable: true },

  // Pages / routes
  { key: 'page.rating',              label: 'Rating',             group: 'page', defaultEnabled: true, tenantOverridable: true },
  { key: 'page.claims',              label: 'Claims',             group: 'page', defaultEnabled: true, tenantOverridable: true },
  { key: 'page.homeCheck',           label: 'HomeCheck',          group: 'page', defaultEnabled: true, tenantOverridable: true },
  { key: 'page.explorer',            label: 'Explorer',           group: 'page', defaultEnabled: true, tenantOverridable: true },
  { key: 'page.tasks',               label: 'Tasks',              group: 'page', defaultEnabled: true, tenantOverridable: true },
  { key: 'page.dictionary',          label: 'Dictionary',         group: 'page', defaultEnabled: true, tenantOverridable: true },
  { key: 'page.news',                label: 'News',               group: 'page', defaultEnabled: true, tenantOverridable: true },
  { key: 'page.builder',             label: 'Builder',            group: 'page', defaultEnabled: true, tenantOverridable: true },
  { key: 'page.feedback',            label: 'Feedback',           group: 'page', defaultEnabled: true, tenantOverridable: true },
  { key: 'page.policyholderPortal',  label: 'Policyholder portal',group: 'page', defaultEnabled: true, tenantOverridable: true },
  { key: 'page.filing',              label: 'Filing',             group: 'page', defaultEnabled: true, tenantOverridable: true },
  // Public marketing surface — platform-controlled, NOT a per-tenant decision.
  { key: 'page.pricing',             label: 'Pricing',            group: 'page', defaultEnabled: true, tenantOverridable: false },

  // Major features
  { key: 'feature.agenticCopilot',   label: 'Agentic copilot',       group: 'feature', defaultEnabled: true, tenantOverridable: true },
  { key: 'feature.draftRule',        label: 'AI draft rule',         group: 'feature', defaultEnabled: true, tenantOverridable: true },
  { key: 'feature.scaffoldProduct',  label: 'AI scaffold product',   group: 'feature', defaultEnabled: true, tenantOverridable: true },
  { key: 'feature.filingGeneration', label: 'Filing generation',     group: 'feature', defaultEnabled: true, tenantOverridable: true },
  { key: 'feature.newsRefresh',      label: 'News refresh',          group: 'feature', defaultEnabled: true, tenantOverridable: true },
  { key: 'feature.agentVisualizer',  label: 'Agent visualizer',      group: 'feature', defaultEnabled: true, tenantOverridable: true },
  // Public share links expose tenant data outside auth — a platform risk decision.
  { key: 'feature.shareLinks',       label: 'Share links',           group: 'feature', defaultEnabled: true, tenantOverridable: false },
] as const

// Fast lookup + immutable key set.
const FLAG_BY_KEY: ReadonlyMap<string, FeatureFlagDef> = new Map(FEATURE_FLAGS.map((f) => [f.key, f]))

export const FLAG_KEYS: readonly string[] = FEATURE_FLAGS.map((f) => f.key)

export function isKnownFlag(key: string): boolean {
  return FLAG_BY_KEY.has(key)
}

export function flagDef(key: string): FeatureFlagDef | undefined {
  return FLAG_BY_KEY.get(key)
}

/** Keys a TENANT_ADMIN is allowed to override (the platform allowlist). */
export const TENANT_OVERRIDABLE_KEYS: readonly string[] =
  FEATURE_FLAGS.filter((f) => f.tenantOverridable).map((f) => f.key)

export type FlagMap = Record<string, boolean>

/** Resolve ONE flag under the layered precedence (see file header). */
export function resolveFlag(
  key: string,
  globalOverrides: FlagMap | undefined,
  tenantOverrides: FlagMap | undefined,
): boolean {
  const def = FLAG_BY_KEY.get(key)
  if (!def) return false // unknown surface — closed by default
  const g = globalOverrides?.[key]
  // A platform DISABLE is a floor: no tenant may re-enable it.
  if (g === false) return false
  let value = g === true ? true : def.defaultEnabled
  if (def.tenantOverridable && tenantOverrides && typeof tenantOverrides[key] === 'boolean') {
    value = tenantOverrides[key]
  }
  return value
}

/** Resolve the full effective flag map for a tenant (every registered key). */
export function resolveFlags(
  globalOverrides: FlagMap | undefined,
  tenantOverrides: FlagMap | undefined,
): FlagMap {
  const out: FlagMap = {}
  for (const def of FEATURE_FLAGS) out[def.key] = resolveFlag(def.key, globalOverrides, tenantOverrides)
  return out
}

export interface SanitizeResult {
  /** Sanitized map containing only known keys with boolean values. */
  value: FlagMap
  /** Keys rejected as unknown. */
  unknownKeys: string[]
  /** Keys rejected because the tenant plane may not override them. */
  forbiddenKeys: string[]
}

/**
 * Validate & sanitize a submitted override map.
 *   plane='platform' → any known flag may be set (global defaults or a tenant's stored overrides).
 *   plane='tenant'   → only tenantOverridable flags may be set; others are rejected (not silently dropped).
 * Non-boolean values are rejected. Returns the clean map plus what was rejected so the
 * caller can 400 with a precise reason (schema-validated, no partial silent write).
 */
export function sanitizeFlagOverrides(
  input: unknown,
  plane: 'platform' | 'tenant',
): SanitizeResult {
  const value: FlagMap = {}
  const unknownKeys: string[] = []
  const forbiddenKeys: string[] = []
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const def = FLAG_BY_KEY.get(k)
      if (!def) { unknownKeys.push(k); continue }
      if (typeof v !== 'boolean') { unknownKeys.push(k); continue }
      if (plane === 'tenant' && !def.tenantOverridable) { forbiddenKeys.push(k); continue }
      value[k] = v
    }
  }
  return { value, unknownKeys, forbiddenKeys }
}
