// Registry tests — lock the line-agnostic behavior the whole platform leans on:
// LOB resolution (by refId, by prefix, safe default), section grouping (Personal Home
// Section I/II partition + Personal Auto Part A/B/C/D catch-all), and coastal membership.
import { describe, it, expect } from 'vitest'
import {
  PH_LOB, PA_LOB, LOB_REGISTRY, DEFAULT_LOB,
  resolveLob, resolveLobByRefId, groupBySection, isPerilState,
  deriveSegmentAxes, productSegments, matchesSegments,
} from './lobRegistry'

describe('LOB resolution', () => {
  it('resolves a known LOB by exact refId', () => {
    expect(resolveLob({ lob: { refId: 'PH.LOB.001' } })).toBe(PH_LOB)
    expect(resolveLob({ lob: { refId: 'PA.LOB.001' } })).toBe(PA_LOB)
  })

  it('falls back to prefix when the LOB refId is unknown', () => {
    expect(resolveLob({ lob: { refId: 'PA.LOB.999' } })).toBe(PA_LOB)
    expect(resolveLob({ lob: { refId: 'PH.LOB.042' } })).toBe(PH_LOB)
  })

  it('defaults to Personal Home for missing / unrecognised LOB', () => {
    expect(resolveLob(null)).toBe(DEFAULT_LOB)
    expect(resolveLob({})).toBe(DEFAULT_LOB)
    expect(resolveLob({ lob: { refId: null } })).toBe(DEFAULT_LOB)
    expect(resolveLob({ lob: { refId: 'XX.LOB.001' } })).toBe(DEFAULT_LOB)
    expect(DEFAULT_LOB).toBe(PH_LOB)
  })

  it('resolves a LOB from any entity refId prefix', () => {
    expect(resolveLobByRefId('PH.COV.003.002')).toBe(PH_LOB)
    expect(resolveLobByRefId('PH.RU.006')).toBe(PH_LOB)
    expect(resolveLobByRefId('PA.COV.001')).toBe(PA_LOB)
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
  it('partitions Personal Home coverages into Section I (property) and Section II (liability)', () => {
    const covs = [
      { name: 'Coverage A — Dwelling' },
      { name: 'Coverage C — Personal Property' },
      { name: 'Coverage E — Personal Liability' },
      { name: 'Coverage F — Medical Payments' },
    ]
    const groups = groupBySection(PH_LOB, covs)
    expect(groups.map(g => g.label)).toEqual(['Section I — Property', 'Section II — Liability'])
    expect(groups[0]!.items.map(c => c.name)).toEqual(['Coverage A — Dwelling', 'Coverage C — Personal Property'])
    expect(groups[1]!.items.map(c => c.name)).toEqual(['Coverage E — Personal Liability', 'Coverage F — Medical Payments'])
  })

  it('preserves input order within a section and drops empty sections', () => {
    const groups = groupBySection(PH_LOB, [{ name: 'Coverage A — Dwelling' }, { name: 'Coverage B — Other Structures' }])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe('Section I — Property')
  })

  it('routes PA coverages into the correct Parts', () => {
    const groups = groupBySection(PA_LOB, [
      { name: 'Part A — Liability Coverage' },
      { name: 'Part B — Medical Payments Coverage' },
      { name: 'Part C — Uninsured Motorists Coverage' },
      { name: 'Part D — Coverage for Damage to Your Auto' },
    ])
    expect(groups.map(g => g.label)).toEqual([
      'Part A — Liability Coverage',
      'Part B — Medical Payments Coverage',
      'Part C — Uninsured Motorists Coverage',
      'Part D — Coverage for Damage to Your Auto',
    ])
  })

  it('routes unmatched PA coverages into the Part D catch-all', () => {
    const groups = groupBySection(PA_LOB, [
      { name: 'Rental Reimbursement' }, // matches no A/B/C keyword → Part D catch-all
    ])
    const partD = groups.find(g => g.label === 'Part D — Coverage for Damage to Your Auto')
    expect(partD?.items.map(c => c.name)).toEqual(['Rental Reimbursement'])
  })
})

describe('peril / coastal rules', () => {
  it('holds the Personal Home coastal wind/hail subset (FL GA NC SC TX)', () => {
    expect([...PH_LOB.peril.eligibleStates]).toEqual(['FL', 'GA', 'NC', 'SC', 'TX'])
    expect(PH_LOB.peril.kind).toBe('COASTAL_WIND_HAIL')
    for (const s of ['FL', 'GA', 'NC', 'SC', 'TX']) expect(isPerilState(PH_LOB, s)).toBe(true)
    for (const s of ['OH', 'CA', 'AZ']) expect(isPerilState(PH_LOB, s)).toBe(false)
  })

  it('Personal Auto rates by territory with no coastal peril', () => {
    expect(PA_LOB.peril.kind).toBe('TERRITORY')
    expect(PA_LOB.peril.eligibleStates).toHaveLength(0)
    expect(isPerilState(PA_LOB, 'FL')).toBe(false)
  })
})

describe('segmentation (registry-driven)', () => {
  const PH = { lob: { refId: 'PH.LOB.001' } }
  const PA = { lob: { refId: 'PA.LOB.001' } }

  const GL = { lob: { refId: 'GL.LOB.001' } }

  it('derives axes and their values from the registry, not hard-coded lists', () => {
    const axes = deriveSegmentAxes()
    expect(axes.map(a => a.id)).toEqual(['personalOrCommercial', 'vertical', 'family', 'marketSegment'])
    const byId = Object.fromEntries(axes.map(a => [a.id, a.values]))
    // PH+PA are Personal; GL is Commercial (two-value grouping, sorted)
    expect(byId['personalOrCommercial']).toEqual(['Commercial', 'Personal'])
    // PH+PA are Personal Lines; GL adds Commercial Lines
    expect(byId['vertical']).toEqual(['Commercial Lines', 'Personal Lines'])
    // PH is Property, PA is Automobile, GL is Casualty (sorted alphabetically)
    expect(byId['family']).toEqual(['Automobile', 'Casualty', 'Property'])
    // GL adds Commercial Lines, Middle Market, Small Commercial
    expect(byId['marketSegment']).toEqual(['Commercial Lines', 'Middle Market', 'Personal Lines', 'Small Commercial'])
  })

  it('resolves a product\'s segment tags through its line of business', () => {
    expect(productSegments(PH)).toEqual({ personalOrCommercial: 'Personal', vertical: 'Personal Lines', family: 'Property', marketSegments: ['Personal Lines'] })
    expect(productSegments(PA)).toEqual({ personalOrCommercial: 'Personal', vertical: 'Personal Lines', family: 'Automobile', marketSegments: ['Personal Lines'] })
    // marketSegments is the line's own (unsorted) band list; the facet axis sorts, productSegments does not.
    expect(productSegments(GL)).toEqual({ personalOrCommercial: 'Commercial', vertical: 'Commercial Lines', family: 'Casualty', marketSegments: ['Commercial Lines', 'Small Commercial', 'Middle Market'] })
  })

  it('matches products against a selection; unset axes are wildcards', () => {
    expect(matchesSegments(PH, {})).toBe(true)                                    // no filter → all
    expect(matchesSegments(PH, { vertical: 'Personal Lines' })).toBe(true)
    expect(matchesSegments(PH, { vertical: 'Commercial Lines' })).toBe(false)
    expect(matchesSegments(PA, { family: 'Automobile' })).toBe(true)
    expect(matchesSegments(PA, { family: 'Property' })).toBe(false)
    expect(matchesSegments(PH, { family: 'Property' })).toBe(true)
    // Personal/Commercial grouping
    expect(matchesSegments(PH, { personalOrCommercial: 'Personal' })).toBe(true)
    expect(matchesSegments(PH, { personalOrCommercial: 'Commercial' })).toBe(false)
    expect(matchesSegments(GL, { personalOrCommercial: 'Commercial' })).toBe(true)
    // market-segment axis works for both lines
    expect(matchesSegments(PA, { marketSegment: 'Personal Lines' })).toBe(true)
    expect(matchesSegments(PH, { marketSegment: 'Personal Lines' })).toBe(true)
    expect(matchesSegments(GL, { marketSegment: 'Middle Market' })).toBe(true)
    expect(matchesSegments(PH, { marketSegment: 'Middle Market' })).toBe(false)
    // combined selection must satisfy every set axis
    expect(matchesSegments(PA, { personalOrCommercial: 'Personal', vertical: 'Personal Lines', family: 'Automobile', marketSegment: 'Personal Lines' })).toBe(true)
    expect(matchesSegments(PH, { vertical: 'Personal Lines', family: 'Automobile' })).toBe(false)
  })
})
