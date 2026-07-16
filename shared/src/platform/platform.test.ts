import { describe, it, expect } from 'vitest'
import {
  FEATURE_FLAGS, FLAG_KEYS, TENANT_OVERRIDABLE_KEYS, isKnownFlag,
  resolveFlag, resolveFlags, sanitizeFlagOverrides,
} from './featureFlags'
import {
  KNOWN_AI_ROLES, DEFAULT_ENTITLEMENTS, ENTITLEMENT_CAPS,
  validateConfigPatch, mergeConfig, effectiveEntitlements,
} from './tenantConfig'

describe('featureFlags registry', () => {
  it('has unique, namespaced keys', () => {
    expect(new Set(FLAG_KEYS).size).toBe(FLAG_KEYS.length)
    for (const f of FEATURE_FLAGS) expect(f.key).toMatch(/^(tab|page|feature)\.[a-zA-Z]+$/)
  })
  it('exposes only tenant-overridable keys in the allowlist', () => {
    // pricing + shareLinks are platform-only; the rest are overridable.
    expect(TENANT_OVERRIDABLE_KEYS).not.toContain('page.pricing')
    expect(TENANT_OVERRIDABLE_KEYS).not.toContain('feature.shareLinks')
    expect(TENANT_OVERRIDABLE_KEYS).toContain('page.rating')
  })
})

describe('page.dictionary default (EX-02 / DEFAULTS_SPEC §2)', () => {
  it('ships DISABLED by default — the Dictionary hides until a DC export earns it', () => {
    const def = FEATURE_FLAGS.find(f => f.key === 'page.dictionary')
    expect(def?.defaultEnabled).toBe(false)
    expect(def?.tenantOverridable).toBe(true)   // the unlock lever (P3's export-success hook)
    expect(resolveFlags({}, {})['page.dictionary']).toBe(false)
  })
  it('the reveal path: a tenant override true flips it on (the ONE shared switch)', () => {
    expect(resolveFlags({}, { 'page.dictionary': true })['page.dictionary']).toBe(true)
    // …and the platform hard floor still wins over a tenant opt-in:
    expect(resolveFlags({ 'page.dictionary': false }, { 'page.dictionary': true })['page.dictionary']).toBe(false)
  })
})

describe('resolveFlag precedence', () => {
  it('falls back to the registry default', () => {
    expect(resolveFlag('page.rating', undefined, undefined)).toBe(true)
    expect(resolveFlag('page.rating', {}, {})).toBe(true)
  })
  it('unknown surface is closed', () => {
    expect(resolveFlag('page.nope', { 'page.nope': true }, undefined)).toBe(false)
    expect(isKnownFlag('page.nope')).toBe(false)
  })
  it('global override wins over the default', () => {
    expect(resolveFlag('page.rating', { 'page.rating': false }, undefined)).toBe(false)
  })
  it('GLOBAL DISABLE is a floor a tenant cannot re-enable (Rating off = platform-wide)', () => {
    // Even if the tenant tries to turn it back on, the global false wins.
    expect(resolveFlag('page.rating', { 'page.rating': false }, { 'page.rating': true })).toBe(false)
  })
  it('a tenant may disable a surface just for itself', () => {
    expect(resolveFlag('page.claims', undefined, { 'page.claims': false })).toBe(false)
    // ...without affecting the platform default for other tenants (pure function, no shared state)
    expect(resolveFlag('page.claims', undefined, undefined)).toBe(true)
  })
  it('a tenant override cannot flip a platform-only (non-overridable) flag', () => {
    // page.pricing is not tenantOverridable; a tenant override is ignored by resolveFlag.
    expect(resolveFlag('page.pricing', undefined, { 'page.pricing': false })).toBe(true)
  })
})

describe('resolveFlags full map', () => {
  it('returns every registered key', () => {
    const m = resolveFlags({ 'page.rating': false }, { 'page.claims': false })
    expect(Object.keys(m).sort()).toEqual([...FLAG_KEYS].sort())
    expect(m['page.rating']).toBe(false)
    expect(m['page.claims']).toBe(false)
    expect(m['tab.overview']).toBe(true)
  })
})

describe('sanitizeFlagOverrides', () => {
  it('rejects unknown + non-boolean keys', () => {
    const r = sanitizeFlagOverrides({ 'page.rating': true, 'page.bogus': true, 'tab.rules': 'yes' }, 'platform')
    expect(r.value).toEqual({ 'page.rating': true })
    expect(r.unknownKeys).toEqual(expect.arrayContaining(['page.bogus', 'tab.rules']))
  })
  it('tenant plane rejects platform-only flags into forbiddenKeys', () => {
    const r = sanitizeFlagOverrides({ 'page.rating': false, 'page.pricing': false }, 'tenant')
    expect(r.value).toEqual({ 'page.rating': false })
    expect(r.forbiddenKeys).toEqual(['page.pricing'])
  })
  it('platform plane may set a platform-only flag', () => {
    const r = sanitizeFlagOverrides({ 'page.pricing': false }, 'platform')
    expect(r.value).toEqual({ 'page.pricing': false })
    expect(r.forbiddenKeys).toEqual([])
  })
})

describe('validateConfigPatch', () => {
  it('accepts a valid platform patch', () => {
    const r = validateConfigPatch({
      branding: { displayName: 'Acme Insurance', accent: 'violet' },
      flags: { 'page.rating': false },
      entitlements: { maxSeats: 10, maxProducts: 5, monthlyAiTokenBudget: 1_000_000, aiModelRoles: ['GROUNDED_CITED'] },
    }, 'platform')
    expect(r.ok).toBe(true)
    expect(r.value?.entitlements?.maxSeats).toBe(10)
  })
  it('rejects entitlements on the tenant plane', () => {
    const r = validateConfigPatch({ entitlements: { maxSeats: 999999 } }, 'tenant')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/platform-set/)
  })
  it('rejects a non-overridable flag on the tenant plane (no write, precise error)', () => {
    const r = validateConfigPatch({ flags: { 'page.pricing': false } }, 'tenant')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/not tenant-overridable/)
  })
  it('rejects a bad accent (enum), never a raw hex', () => {
    const r = validateConfigPatch({ branding: { accent: '#ff0000' } }, 'platform')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/accent/)
  })
  it('rejects entitlement over the platform cap', () => {
    const r = validateConfigPatch({ entitlements: { maxSeats: ENTITLEMENT_CAPS.maxSeats + 1 } }, 'platform')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/cap/)
  })
  it('rejects a negative / non-integer entitlement', () => {
    expect(validateConfigPatch({ entitlements: { maxSeats: -1 } }, 'platform').ok).toBe(false)
    expect(validateConfigPatch({ entitlements: { maxSeats: 2.5 } }, 'platform').ok).toBe(false)
  })
  it('rejects unknown model roles', () => {
    const r = validateConfigPatch({ entitlements: { aiModelRoles: ['GROUNDED_CITED', 'claude-fable-5'] } }, 'platform')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/unknown roles/)
  })
  it('rejects unknown top-level keys (typo protection)', () => {
    const r = validateConfigPatch({ entitlement: { maxSeats: 5 } }, 'platform')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/unknown config key/)
  })
  it('strips control chars + clamps branding length', () => {
    const withCtl = 'Ac' + String.fromCharCode(7) + 'me'
    const r = validateConfigPatch({ branding: { displayName: withCtl + 'x'.repeat(200) } }, 'platform')
    expect(r.ok).toBe(true)
    expect(r.value?.branding?.displayName?.includes(String.fromCharCode(7))).toBe(false)
    expect(r.value?.branding?.displayName?.startsWith('Acme')).toBe(true)
    expect(r.value?.branding?.displayName?.length ?? 0).toBeLessThanOrEqual(60)
  })
})

describe('mergeConfig + effectiveEntitlements', () => {
  it('merges flags by key without wiping others', () => {
    const merged = mergeConfig({ flags: { 'page.rating': false, 'page.claims': false } }, { flags: { 'page.claims': true } })
    expect(merged.flags).toEqual({ 'page.rating': false, 'page.claims': true })
  })
  it('entitlements patch returns ONLY the provided fields (no silent default reset)', () => {
    const r = validateConfigPatch({ entitlements: { maxSeats: 50 } }, 'platform')
    expect(r.ok).toBe(true)
    expect(r.value?.entitlements).toEqual({ maxSeats: 50 })
  })
  it('merges entitlements by field — raising one preserves the others', () => {
    const merged = mergeConfig(
      { entitlements: { maxSeats: 10, maxProducts: 5, monthlyAiTokenBudget: 1000, aiModelRoles: ['GROUNDED_CITED'] } },
      { entitlements: { maxSeats: 50 } },
    )
    expect(merged.entitlements).toEqual({ maxSeats: 50, maxProducts: 5, monthlyAiTokenBudget: 1000, aiModelRoles: ['GROUNDED_CITED'] })
  })
  it('falls back to platform defaults when unset', () => {
    expect(effectiveEntitlements(undefined)).toEqual(DEFAULT_ENTITLEMENTS)
    expect(effectiveEntitlements({}).maxSeats).toBe(DEFAULT_ENTITLEMENTS.maxSeats)
  })
})

describe('KNOWN_AI_ROLES', () => {
  it('covers the fleet role vocabulary and never includes a model id', () => {
    expect(KNOWN_AI_ROLES).toContain('GROUNDED_CITED')
    expect(KNOWN_AI_ROLES).toContain('MID_REASONER')
    expect(KNOWN_AI_ROLES.some((r) => r.startsWith('claude-'))).toBe(false)
  })
})
