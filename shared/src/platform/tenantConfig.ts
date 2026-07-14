// tenantConfig.ts — per-tenant configuration schema + validation (pure, testable).
//
// Config drives BOTH the app (branding, which surfaces render) and the AI layer
// (approved model roles, monthly token budget) at runtime. Every change is
// schema-validated HERE before it is persisted + audited server-side.
//
// Authority planes:
//   • platform (SUPER_ADMIN) — may set branding, entitlements, the model allowlist,
//     and any feature-flag default/override.
//   • tenant   (TENANT_ADMIN) — may set branding text + feature-flag overrides within
//     the platform allowlist ONLY. Entitlements + model allowlist are platform-set and
//     are rejected on the tenant plane (never silently dropped).
//
// PURE: no platform imports; bundled to server/lib/platform-shared.cjs.

import { sanitizeFlagOverrides, type FlagMap } from './featureFlags'

// ─── Branding ─────────────────────────────────────────────────────────────────
// Accent is an ENUM of design-token names, never a raw hex — the "no hard-coded hex
// outside index.css" invariant holds because the client maps the accent to an existing
// `var(--color-*)` token. A tenant can never inject an arbitrary colour string.
export const BRAND_ACCENTS = ['default', 'blue', 'violet', 'emerald', 'amber', 'rose', 'slate'] as const
export type BrandAccent = typeof BRAND_ACCENTS[number]

export interface Branding {
  displayName?: string    // <= 60 chars; product name shown in-shell
  tagline?: string        // <= 120 chars
  accent?: BrandAccent    // token name, mapped client-side to var(--color-*)
}

// ─── Entitlements ───────────────────────────────────────────────────────────
// Approved AI roles: the fleet ROLE names a tenant may invoke. These are ROLE labels
// (authz/config vocabulary), NOT model-id strings — the model-id invariant is untouched.
// Mirrors the role set in shared/src/ai/fleet.ts; kept as a local constant so this pure
// module has zero fleet import. A parity test pins them in sync.
export const KNOWN_AI_ROLES = ['GROUNDED_CITED', 'MID_REASONER', 'BULK_VERIFY', 'VISION', 'CHEAP_GENERAL', 'EMBED'] as const
export type AiRole = typeof KNOWN_AI_ROLES[number]

export interface Entitlements {
  maxSeats: number             // >= 1
  maxProducts: number          // >= 1
  monthlyAiTokenBudget: number // >= 0 tokens (0 = AI disabled by budget)
  aiModelRoles: AiRole[]       // approved fleet roles (subset of KNOWN_AI_ROLES)
}

// Hard ceilings — a platform admin can set anything up to these; absurd values are
// rejected so a fat-fingered entitlement can't uncap a tenant.
export const ENTITLEMENT_CAPS = {
  maxSeats: 100_000,
  maxProducts: 100_000,
  monthlyAiTokenBudget: 5_000_000_000, // 5B tokens/month
} as const

export const DEFAULT_ENTITLEMENTS: Entitlements = {
  maxSeats: 25,
  maxProducts: 100,
  monthlyAiTokenBudget: 20_000_000, // 20M tokens/month
  aiModelRoles: ['GROUNDED_CITED', 'MID_REASONER', 'BULK_VERIFY', 'VISION', 'CHEAP_GENERAL', 'EMBED'],
}

export interface TenantConfig {
  branding?: Branding
  flags?: FlagMap          // per-tenant flag overrides
  entitlements?: Entitlements
}

export interface ValidationResult<T> {
  ok: boolean
  errors: string[]
  value: T | null
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
const clampStr = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  // strip C0 + DEL control chars (defense-in-depth; the client sanitizes again on render)
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\x00-\x1f\x7f]/g, '').trim()
  return s.slice(0, max)
}

function validateBranding(input: unknown, errors: string[]): Branding | undefined {
  if (input === undefined) return undefined
  if (!isPlainObject(input)) { errors.push('branding must be an object'); return undefined }
  const out: Branding = {}
  if (input.displayName !== undefined) {
    const s = clampStr(input.displayName, 60)
    if (s === null) errors.push('branding.displayName must be a string')
    else out.displayName = s
  }
  if (input.tagline !== undefined) {
    const s = clampStr(input.tagline, 120)
    if (s === null) errors.push('branding.tagline must be a string')
    else out.tagline = s
  }
  if (input.accent !== undefined) {
    if (!BRAND_ACCENTS.includes(input.accent as BrandAccent)) {
      errors.push(`branding.accent must be one of ${BRAND_ACCENTS.join(', ')}`)
    } else out.accent = input.accent as BrandAccent
  }
  return out
}

function validateEntitlements(input: unknown, errors: string[]): Entitlements | undefined {
  if (input === undefined) return undefined
  if (!isPlainObject(input)) { errors.push('entitlements must be an object'); return undefined }
  const out = { ...DEFAULT_ENTITLEMENTS }
  const numField = (key: 'maxSeats' | 'maxProducts' | 'monthlyAiTokenBudget', min: number) => {
    if (input[key] === undefined) return
    if (!isInt(input[key])) { errors.push(`entitlements.${key} must be an integer`); return }
    const n = input[key] as number
    if (n < min) { errors.push(`entitlements.${key} must be >= ${min}`); return }
    if (n > ENTITLEMENT_CAPS[key]) { errors.push(`entitlements.${key} exceeds the platform cap of ${ENTITLEMENT_CAPS[key]}`); return }
    out[key] = n
  }
  numField('maxSeats', 1)
  numField('maxProducts', 1)
  numField('monthlyAiTokenBudget', 0)
  if (input.aiModelRoles !== undefined) {
    if (!Array.isArray(input.aiModelRoles)) errors.push('entitlements.aiModelRoles must be an array')
    else {
      const bad = input.aiModelRoles.filter((r) => !KNOWN_AI_ROLES.includes(r as AiRole))
      if (bad.length) errors.push(`entitlements.aiModelRoles has unknown roles: ${bad.join(', ')}`)
      else out.aiModelRoles = [...new Set(input.aiModelRoles as AiRole[])]
    }
  }
  return out
}

/**
 * Validate a config PATCH from a given authority plane. Returns a normalized partial
 * config (only the keys present in the patch) or a list of errors. NEVER mutates.
 * The server merges the returned value onto the stored config and audits the change.
 */
export function validateConfigPatch(
  patch: unknown,
  plane: 'platform' | 'tenant',
): ValidationResult<TenantConfig> {
  const errors: string[] = []
  if (!isPlainObject(patch)) return { ok: false, errors: ['config patch must be an object'], value: null }

  const out: TenantConfig = {}

  if (patch.branding !== undefined) {
    const b = validateBranding(patch.branding, errors)
    if (b !== undefined) out.branding = b
  }

  if (patch.flags !== undefined) {
    const { value, unknownKeys, forbiddenKeys } = sanitizeFlagOverrides(patch.flags, plane)
    if (unknownKeys.length) errors.push(`flags: unknown or non-boolean keys: ${unknownKeys.join(', ')}`)
    if (forbiddenKeys.length) errors.push(`flags: not tenant-overridable: ${forbiddenKeys.join(', ')}`)
    out.flags = value
  }

  if (patch.entitlements !== undefined) {
    if (plane === 'tenant') {
      errors.push('entitlements are platform-set and cannot be changed on the tenant plane')
    } else {
      const e = validateEntitlements(patch.entitlements, errors)
      if (e !== undefined) out.entitlements = e
    }
  }

  // Reject unknown top-level keys so a typo (e.g. "entitlement") is never silently ignored.
  const KNOWN_TOP = new Set(['branding', 'flags', 'entitlements'])
  for (const k of Object.keys(patch)) if (!KNOWN_TOP.has(k)) errors.push(`unknown config key: ${k}`)

  if (errors.length) return { ok: false, errors, value: null }
  return { ok: true, errors: [], value: out }
}

/** Merge a validated patch onto an existing stored config (shallow per section; flags merge by key). */
export function mergeConfig(current: TenantConfig | undefined, patch: TenantConfig): TenantConfig {
  const base = current || {}
  return {
    branding: patch.branding !== undefined ? { ...base.branding, ...patch.branding } : base.branding,
    flags: patch.flags !== undefined ? { ...base.flags, ...patch.flags } : base.flags,
    entitlements: patch.entitlements !== undefined ? patch.entitlements : base.entitlements,
  }
}

/** The effective entitlements for a tenant (stored config, else platform defaults). */
export function effectiveEntitlements(config: TenantConfig | undefined): Entitlements {
  const e = config?.entitlements
  if (!e) return { ...DEFAULT_ENTITLEMENTS }
  return {
    maxSeats: e.maxSeats ?? DEFAULT_ENTITLEMENTS.maxSeats,
    maxProducts: e.maxProducts ?? DEFAULT_ENTITLEMENTS.maxProducts,
    monthlyAiTokenBudget: e.monthlyAiTokenBudget ?? DEFAULT_ENTITLEMENTS.monthlyAiTokenBudget,
    aiModelRoles: e.aiModelRoles ?? [...DEFAULT_ENTITLEMENTS.aiModelRoles],
  }
}
