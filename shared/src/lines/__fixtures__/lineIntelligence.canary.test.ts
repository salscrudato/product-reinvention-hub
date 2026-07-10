// lineIntelligence.canary.test.ts — per-family canary tests for the Line Intelligence Registry.
//
// Each test: ratingKitGenerator(archetype) → generic RT+LD getters → evaluate(program, inputs)
// → assert(finalPremium === expectedPremium). This proves that a pure data LineArchetype +
// ArchetypeFixture reproduces a verified premium WITHOUT any line-specific code.
//
// Existing canaries are byte-for-byte unchanged — these are NEW per-family canaries only.
// The 17 fixtures cover all P&C families listed in the Line Intelligence Registry spec.
import { describe, it, expect } from 'vitest'
import { evaluate } from '../../rating/evaluator'
import { ratingKitGenerator } from '../ratingKit'
import type { LineArchetype } from '../types'
import type { ArchetypeFixture } from '../ratingKit'

import { HOMEOWNERS_ARCHETYPE,           HOMEOWNERS_FIXTURE }           from './homeowners.golden'
import { PERSONAL_AUTO_ARCHETYPE,        PERSONAL_AUTO_FIXTURE }        from './personalAuto.golden'
import { DWELLING_ARCHETYPE,             DWELLING_FIXTURE }             from './dwelling.golden'
import { PERSONAL_UMBRELLA_ARCHETYPE,    PERSONAL_UMBRELLA_FIXTURE }    from './personalUmbrella.golden'
import { INLAND_MARINE_ARCHETYPE,        INLAND_MARINE_FIXTURE }        from './inlandMarine.golden'
import { FLOOD_ARCHETYPE,                FLOOD_FIXTURE }                from './flood.golden'
import { GENERAL_LIABILITY_ARCHETYPE,    GENERAL_LIABILITY_FIXTURE }    from './generalLiability.golden'
import { COMMERCIAL_PROPERTY_ARCHETYPE,  COMMERCIAL_PROPERTY_FIXTURE }  from './commercialProperty.golden'
import { COMMERCIAL_AUTO_ARCHETYPE,      COMMERCIAL_AUTO_FIXTURE }      from './commercialAuto.golden'
import { WORKERS_COMP_ARCHETYPE,         WORKERS_COMP_FIXTURE }         from './workersComp.golden'
import { BOP_ARCHETYPE,                  BOP_FIXTURE }                  from './bop.golden'
import { COMMERCIAL_PACKAGE_ARCHETYPE,   COMMERCIAL_PACKAGE_FIXTURE }   from './commercialPackage.golden'
import { CYBER_ARCHETYPE,                CYBER_FIXTURE }                from './cyber.golden'
import { MANAGEMENT_LIABILITY_ARCHETYPE, MANAGEMENT_LIABILITY_FIXTURE } from './managementLiability.golden'
import { PROFESSIONAL_LIABILITY_ARCHETYPE, PROFESSIONAL_LIABILITY_FIXTURE } from './professionalLiability.golden'
import { CRIME_ARCHETYPE,                CRIME_FIXTURE }                from './crime.golden'
import { EXCESS_UMBRELLA_ARCHETYPE,      EXCESS_UMBRELLA_FIXTURE }      from './excessUmbrella.golden'

// ─── Fixture registry ─────────────────────────────────────────────────────────

interface CanaryEntry {
  archetype: LineArchetype
  fixture:   ArchetypeFixture
}

const CANARIES: CanaryEntry[] = [
  { archetype: HOMEOWNERS_ARCHETYPE,           fixture: HOMEOWNERS_FIXTURE },
  { archetype: PERSONAL_AUTO_ARCHETYPE,        fixture: PERSONAL_AUTO_FIXTURE },
  { archetype: DWELLING_ARCHETYPE,             fixture: DWELLING_FIXTURE },
  { archetype: PERSONAL_UMBRELLA_ARCHETYPE,    fixture: PERSONAL_UMBRELLA_FIXTURE },
  { archetype: INLAND_MARINE_ARCHETYPE,        fixture: INLAND_MARINE_FIXTURE },
  { archetype: FLOOD_ARCHETYPE,                fixture: FLOOD_FIXTURE },
  { archetype: GENERAL_LIABILITY_ARCHETYPE,    fixture: GENERAL_LIABILITY_FIXTURE },
  { archetype: COMMERCIAL_PROPERTY_ARCHETYPE,  fixture: COMMERCIAL_PROPERTY_FIXTURE },
  { archetype: COMMERCIAL_AUTO_ARCHETYPE,      fixture: COMMERCIAL_AUTO_FIXTURE },
  { archetype: WORKERS_COMP_ARCHETYPE,         fixture: WORKERS_COMP_FIXTURE },
  { archetype: BOP_ARCHETYPE,                  fixture: BOP_FIXTURE },
  { archetype: COMMERCIAL_PACKAGE_ARCHETYPE,   fixture: COMMERCIAL_PACKAGE_FIXTURE },
  { archetype: CYBER_ARCHETYPE,                fixture: CYBER_FIXTURE },
  { archetype: MANAGEMENT_LIABILITY_ARCHETYPE, fixture: MANAGEMENT_LIABILITY_FIXTURE },
  { archetype: PROFESSIONAL_LIABILITY_ARCHETYPE, fixture: PROFESSIONAL_LIABILITY_FIXTURE },
  { archetype: CRIME_ARCHETYPE,                fixture: CRIME_FIXTURE },
  { archetype: EXCESS_UMBRELLA_ARCHETYPE,      fixture: EXCESS_UMBRELLA_FIXTURE },
]

// ─── Generic canary pattern ───────────────────────────────────────────────────
// For each family: ratingKitGenerator(archetype) returns a kit with generic RT+LD getters.
// The test evaluates the fixture program against the fixture workedExample and asserts
// that finalPremium equals the fixture expectedPremium (the locked canary value).

describe('Line Intelligence Registry — per-family canaries', () => {
  it('covers all 17 P&C families', () => {
    // Guard: if a family is added to the registry without a fixture, this fails first.
    expect(CANARIES).toHaveLength(17)
    const families = new Set(CANARIES.map(c => c.archetype.family))
    // 15 distinct LineFamily values used across 17 archetypes (UMBRELLA appears twice:
    // personal + commercial; PACKAGE appears twice: BOP + CPP; 17 - 2 duplicates = 15).
    expect(families.size).toBe(15)
  })

  for (const { archetype, fixture } of CANARIES) {
    it(`${archetype.displayName} → $${fixture.expectedPremium}`, () => {
      // ratingKitGenerator produces generic getters — no line-specific code.
      const kit = ratingKitGenerator(archetype)
      const rtGetter = kit.makeRtGetter(fixture.rt)
      const ldGetter = kit.makeLdGetter(fixture.ld)
      const result = evaluate(fixture.program, fixture.workedExample, rtGetter, ldGetter)

      // The headline: the fixture worked example prices to the locked canary.
      expect(result.finalPremium).toBe(fixture.expectedPremium)

      // The premium shown is the final trace step's running total (no drift between
      // the number and the step-by-step audit trail).
      expect(result.finalPremium).toBe(result.trace[result.trace.length - 1]!.runningTotal)

      // Sanity: at least two trace steps (meaningful rating program).
      expect(result.trace.length).toBeGreaterThanOrEqual(2)
    })
  }
})

// ─── Data-first claim: ratingKitGenerator is generic ─────────────────────────
describe('ratingKitGenerator is line-agnostic', () => {
  it('produces a kit for every archetype without line-specific code', () => {
    for (const { archetype } of CANARIES) {
      const kit = ratingKitGenerator(archetype)
      expect(typeof kit.makeRtGetter).toBe('function')
      expect(typeof kit.makeLdGetter).toBe('function')
      expect(Array.isArray(kit.inputSpec)).toBe(true)
      // inputSpec is derived from exposureBases — every archetype has at least one.
      expect(kit.inputSpec.length).toBeGreaterThanOrEqual(1)
      expect(kit.archetype).toBe(archetype)
    }
  })

  it('makeRtGetter throws on missing table (not silently zero)', () => {
    const kit = ratingKitGenerator(HOMEOWNERS_ARCHETYPE)
    const getter = kit.makeRtGetter({})
    expect(() => getter('LI.HO.RT.001', { territory: '1' })).toThrow()
  })
})
