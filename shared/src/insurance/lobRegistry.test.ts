// Registry tests — lock the line-agnostic behavior the whole platform leans on:
// LOB resolution (by refId, by prefix, safe default), section grouping (Homeowners
// Section I/II partition + GL coverage-part catch-all), and coastal membership.
import { describe, it, expect } from 'vitest'
import {
  HO_LOB, GL_LOB, LOB_REGISTRY, DEFAULT_LOB,
  resolveLob, resolveLobByRefId, groupBySection, isPerilState,
} from './lobRegistry'

describe('LOB resolution', () => {
  it('resolves a known LOB by exact refId', () => {
    expect(resolveLob({ lob: { refId: 'HO.LOB.001' } })).toBe(HO_LOB)
    expect(resolveLob({ lob: { refId: 'GL.LOB.001' } })).toBe(GL_LOB)
  })

  it('falls back to prefix when the LOB refId is unknown', () => {
    expect(resolveLob({ lob: { refId: 'GL.LOB.999' } })).toBe(GL_LOB)
    expect(resolveLob({ lob: { refId: 'HO.LOB.042' } })).toBe(HO_LOB)
  })

  it('defaults to Homeowners for missing / unrecognised LOB', () => {
    expect(resolveLob(null)).toBe(DEFAULT_LOB)
    expect(resolveLob({})).toBe(DEFAULT_LOB)
    expect(resolveLob({ lob: { refId: null } })).toBe(DEFAULT_LOB)
    expect(resolveLob({ lob: { refId: 'XX.LOB.001' } })).toBe(DEFAULT_LOB)
    expect(DEFAULT_LOB).toBe(HO_LOB)
  })

  it('resolves a LOB from any entity refId prefix', () => {
    expect(resolveLobByRefId('HO.COV.003.002')).toBe(HO_LOB)
    expect(resolveLobByRefId('HO.RU.006')).toBe(HO_LOB)
    expect(resolveLobByRefId('GL.COV.001')).toBe(GL_LOB)
    expect(resolveLobByRefId('ZZ.RU.001')).toBeUndefined()
    expect(resolveLobByRefId(undefined)).toBeUndefined()
  })

  it('every registry entry is keyed by its own refId and carries a distinct prefix', () => {
    for (const [key, lob] of Object.entries(LOB_REGISTRY)) expect(key).toBe(lob.refId)
    const prefixes = Object.values(LOB_REGISTRY).map(l => l.prefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })
})

describe('section grouping', () => {
  it('partitions Homeowners coverages into Section I (property) and Section II (liability)', () => {
    const covs = [
      { name: 'Coverage A — Dwelling' },
      { name: 'Coverage C — Personal Property' },
      { name: 'Coverage E — Personal Liability' },
      { name: 'Coverage F — Medical Payments' },
    ]
    const groups = groupBySection(HO_LOB, covs)
    expect(groups.map(g => g.label)).toEqual(['Section I — Property', 'Section II — Liability'])
    expect(groups[0]!.items.map(c => c.name)).toEqual(['Coverage A — Dwelling', 'Coverage C — Personal Property'])
    expect(groups[1]!.items.map(c => c.name)).toEqual(['Coverage E — Personal Liability', 'Coverage F — Medical Payments'])
  })

  it('preserves input order within a section and drops empty sections', () => {
    const groups = groupBySection(HO_LOB, [{ name: 'Coverage A — Dwelling' }, { name: 'Coverage B — Other Structures' }])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe('Section I — Property')
  })

  it('routes unmatched GL coverages into the catch-all section', () => {
    const groups = groupBySection(GL_LOB, [
      { name: 'Bodily Injury Liability' },
      { name: 'Personal & Advertising Injury' },
      { name: 'Fire Legal Liability' }, // matches no A/B/C keyword → catch-all
    ])
    const other = groups.find(g => g.label === 'Other Coverages')
    expect(other?.items.map(c => c.name)).toEqual(['Fire Legal Liability'])
  })
})

describe('peril / coastal rules', () => {
  it('holds the Homeowners coastal wind/hail subset (FL GA NC SC TX)', () => {
    expect([...HO_LOB.peril.eligibleStates]).toEqual(['FL', 'GA', 'NC', 'SC', 'TX'])
    expect(HO_LOB.peril.kind).toBe('COASTAL_WIND_HAIL')
    for (const s of ['FL', 'GA', 'NC', 'SC', 'TX']) expect(isPerilState(HO_LOB, s)).toBe(true)
    for (const s of ['OH', 'CA', 'AZ']) expect(isPerilState(HO_LOB, s)).toBe(false)
  })

  it('General Liability rates by territory with no coastal peril', () => {
    expect(GL_LOB.peril.kind).toBe('TERRITORY')
    expect(GL_LOB.peril.eligibleStates).toHaveLength(0)
    expect(isPerilState(GL_LOB, 'FL')).toBe(false)
  })
})
