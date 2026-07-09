// lineProfiles.test.ts — locks the form-driven, line-agnostic contract of the Claims copilot:
// every recognised line resolves to its own profile, an unrecognised form falls back to the
// generic (no-assumed-line) profile, and General Liability reaches PARITY with Homeowners —
// it carries the occurrence/aggregate briefing and its own loss scenarios so GL renders as
// gracefully as HO. Pure unit test; no platform, no network.
import { describe, it, expect } from 'vitest'
import {
  resolveClaimsLineProfile,
  DEFAULT_CLAIMS_LINE_PROFILE,
  CLAIMS_LINE_PROFILES,
} from './lineProfiles'

describe('resolveClaimsLineProfile', () => {
  it('resolves each recognised line code to its own profile', () => {
    expect(resolveClaimsLineProfile('HO').code).toBe('HO')
    expect(resolveClaimsLineProfile('PA').code).toBe('PA')
    expect(resolveClaimsLineProfile('GL').code).toBe('GL')
  })

  it('is case-insensitive and trims', () => {
    expect(resolveClaimsLineProfile('gl').code).toBe('GL')
    expect(resolveClaimsLineProfile('  ho ').code).toBe('HO')
  })

  it('falls back to the generic (form-driven) profile for an unrecognised / empty line', () => {
    expect(resolveClaimsLineProfile('OTHER')).toBe(DEFAULT_CLAIMS_LINE_PROFILE)
    expect(resolveClaimsLineProfile('')).toBe(DEFAULT_CLAIMS_LINE_PROFILE)
    expect(resolveClaimsLineProfile(undefined)).toBe(DEFAULT_CLAIMS_LINE_PROFILE)
    expect(resolveClaimsLineProfile(null)).toBe(DEFAULT_CLAIMS_LINE_PROFILE)
    expect(resolveClaimsLineProfile('BP')).toBe(DEFAULT_CLAIMS_LINE_PROFILE)
    expect(DEFAULT_CLAIMS_LINE_PROFILE.code).toBe('GENERIC')
  })
})

describe('registry shape', () => {
  it('every named profile has a display name, a non-trivial briefing and at least one scenario', () => {
    expect(CLAIMS_LINE_PROFILES.length).toBeGreaterThanOrEqual(3)
    for (const p of CLAIMS_LINE_PROFILES) {
      expect(p.displayName.trim().length).toBeGreaterThan(0)
      expect(p.briefing.length).toBeGreaterThan(80)
      expect(p.scenarios.length).toBeGreaterThan(0)
    }
  })

  it('the generic fallback teaches the model to derive from the form and offers no assumed scenarios', () => {
    expect(DEFAULT_CLAIMS_LINE_PROFILE.scenarios).toHaveLength(0)
    expect(DEFAULT_CLAIMS_LINE_PROFILE.briefing.toLowerCase()).toContain('form')
  })
})

describe('GL parity — General Liability is briefed as fully as Homeowners', () => {
  const gl = resolveClaimsLineProfile('GL')
  const ho = resolveClaimsLineProfile('HO')

  it('names the CGL coverage trigger and aggregate structure the copilot must apply', () => {
    const b = gl.briefing.toLowerCase()
    expect(b).toContain('occurrence')
    expect(b).toContain('claims-made')
    expect(b).toContain('general aggregate')
    expect(b).toContain('products-completed-operations')
    // aggregates reset each policy period — the semantics the task calls out explicitly
    expect(b).toContain('reset')
  })

  it('carries GL-specific loss scenarios (slip-and-fall, products, completed operations)', () => {
    const joined = gl.scenarios.join(' ').toLowerCase()
    expect(joined).toContain('slip') // a slip-and-fall bodily-injury claim
    expect(joined).toContain('product')
    expect(joined).toContain('completed')
  })

  it('does not borrow Homeowners framing (no first-party open-peril water language in GL)', () => {
    expect(gl.briefing.toLowerCase()).not.toContain('open-peril')
    expect(ho.briefing.toLowerCase()).toContain('open-peril')
    expect(gl.displayName).toBe('General Liability')
  })
})
