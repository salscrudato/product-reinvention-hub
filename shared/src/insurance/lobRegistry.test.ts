// Registry tests — lock the line-agnostic behavior the whole platform leans on:
// LOB resolution (by refId, by prefix, safe default), section grouping (Personal Home
// Section I/II partition + Personal Auto Part A/B/C/D catch-all), and coastal membership.
import { describe, it, expect } from 'vitest'
import {
  PH_LOB, PA_LOB, GL_LOB, IM_LOB, PR_LOB, LOB_REGISTRY, DEFAULT_LOB,
  resolveLob, resolveLobByRefId, groupBySection, isPerilState,
  deriveSegmentAxes, productSegments, matchesSegments,
  inferLob, synthesizeRefId,
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

  it('resolves the two new lines (IM, PR) from their distinct refId shapes', () => {
    // Inland Marine + Property use NON-dotted number tails — resolution is by prefix, so
    // the concatenated shapes ("IM.COV044.00", "PR.COV001.0", "PR.ROC.001") still resolve.
    expect(resolveLobByRefId('IM.COV044.00')).toBe(IM_LOB)
    expect(resolveLobByRefId('IM.RL.001')).toBe(IM_LOB)
    expect(resolveLobByRefId('PR.COV001.0')).toBe(PR_LOB)
    expect(resolveLobByRefId('PR.ROC.001')).toBe(PR_LOB)
    expect(resolveLob({ lob: { refId: 'IM.LOB.001' } })).toBe(IM_LOB)
    expect(resolveLob({ lob: { refId: 'PR.LOB.001' } })).toBe(PR_LOB)
  })

  it('registers exactly the five lines, each with a distinct prefix', () => {
    expect(Object.keys(LOB_REGISTRY).sort()).toEqual(
      ['GL.LOB.001', 'IM.LOB.001', 'PA.LOB.001', 'PH.LOB.001', 'PR.LOB.001'],
    )
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

  it('adding IM + PR does NOT change the derived facet values (segments drawn from the existing set)', () => {
    const byId = Object.fromEntries(deriveSegmentAxes().map(a => [a.id, a.values]))
    expect(byId['personalOrCommercial']).toEqual(['Commercial', 'Personal'])
    expect(byId['vertical']).toEqual(['Commercial Lines', 'Personal Lines'])
    expect(byId['family']).toEqual(['Automobile', 'Casualty', 'Property'])
    expect(byId['marketSegment']).toEqual(['Commercial Lines', 'Middle Market', 'Personal Lines', 'Small Commercial'])
  })
})

// ─── refId synthesis: the line's EXACT shape, incl. the TBD/blank-id case ────────────
describe('refId synthesis (per-line exact shapes)', () => {
  it('GL uses fully-dotted segments', () => {
    expect(synthesizeRefId(GL_LOB, 'coverage', 2)).toBe('GL.COV.002')
    expect(synthesizeRefId(GL_LOB, 'subCoverage', 3, 2)).toBe('GL.COV.002.003')
    expect(synthesizeRefId(GL_LOB, 'rule', 6)).toBe('GL.RU.006')
    expect(synthesizeRefId(GL_LOB, 'formRule', 7)).toBe('GL.FORM.RU.007')
    expect(synthesizeRefId(GL_LOB, 'ratingStep', 5)).toBe('GL.RAT.1.05')
  })

  it('IM concatenates the number onto the token with a 2-digit tail; rules use "RL"', () => {
    expect(synthesizeRefId(IM_LOB, 'coverage', 44)).toBe('IM.COV044.00')
    expect(synthesizeRefId(IM_LOB, 'subCoverage', 2, 44)).toBe('IM.COV044.02')
    expect(synthesizeRefId(IM_LOB, 'rule', 1)).toBe('IM.RL.001')
  })

  it('PR uses a 1-digit coverage tail and a "ROC" token for rating steps', () => {
    expect(synthesizeRefId(PR_LOB, 'coverage', 1)).toBe('PR.COV001.0')
    // Property ROC ships "TBD" step ids — the synthesizer mints the governed shape.
    expect(synthesizeRefId(PR_LOB, 'ratingStep', 1)).toBe('PR.ROC.001')
    expect(synthesizeRefId(PR_LOB, 'ratingProgram', 1)).toBe('PR.ROC')
  })

  it('every synthesized id resolves back to its own line', () => {
    for (const lob of [PH_LOB, PA_LOB, GL_LOB, IM_LOB, PR_LOB]) {
      expect(resolveLobByRefId(synthesizeRefId(lob, 'coverage', 3))).toBe(lob)
      expect(resolveLobByRefId(synthesizeRefId(lob, 'rule', 3))).toBe(lob)
    }
  })
})

// ─── Line inference from a workbook's OWN content (never a filename) ─────────────────
describe('inferLob (content-driven line inference)', () => {
  it('infers from the majority refId prefix', () => {
    expect(inferLob({ refIds: ['IM.COV044.00', 'IM.RL.001', 'IM.COV045.00'] })).toBe(IM_LOB)
    expect(inferLob({ refIds: ['PR.COV001.0', 'PR.ROC.001'] })).toBe(PR_LOB)
    expect(inferLob({ refIds: ['GL.COV.002', 'GL.RU.001'] })).toBe(GL_LOB)
    // Majority wins when mixed.
    expect(inferLob({ refIds: ['GL.COV.002', 'GL.COV.003', 'IM.COV001.00'] })).toBe(GL_LOB)
  })

  it('falls back to product/LOB/sheet-name signals when no usable refIds exist', () => {
    expect(inferLob({ productName: 'Monoline General Liability Product' })).toBe(GL_LOB)
    expect(inferLob({ lobName: 'Inland Marine' })).toBe(IM_LOB)
    expect(inferLob({ productName: 'Commercial Property Program' })).toBe(PR_LOB)
    expect(inferLob({ productName: 'Personal Home — HO-3 Special Form' })).toBe(PH_LOB)
    expect(inferLob({ productName: 'Personal Auto (PAP)' })).toBe(PA_LOB)
  })

  it('ignores TBD/blank refIds and recovers the line from sheet names (Property ROC)', () => {
    expect(inferLob({
      refIds: ['TBD', 'N/A', '', null, undefined],
      sheetNames: ['PROPERTY ROC', 'Rules Repository'],
    })).toBe(PR_LOB)
  })

  it('returns undefined when there is no content signal at all (filename is never used)', () => {
    expect(inferLob({})).toBeUndefined()
    expect(inferLob({ refIds: ['TBD', 'N/A'] })).toBeUndefined()
  })
})

// ─── IM + PR peril / section taxonomy ────────────────────────────────────────────────
describe('IM + PR peril and section taxonomy', () => {
  it('Inland Marine carries no coastal peril and groups scheduled/blanket/extensions', () => {
    expect(IM_LOB.perilModel.kind).toBe('NONE')
    const groups = groupBySection(IM_LOB, [
      { name: 'Scheduled Equipment Floater' },
      { name: 'Blanket Tools' },
      { name: 'Accounts Receivable' }, // → Coverage Extensions catch-all
    ])
    expect(groups.map(g => g.label)).toEqual([
      'Scheduled Property', 'Blanket & Equipment Coverage', 'Coverage Extensions',
    ])
  })

  it('Commercial Property carries a coastal wind/hail programme', () => {
    expect(PR_LOB.perilModel.kind).toBe('COASTAL_WIND_HAIL')
    expect(isPerilState(PR_LOB, 'FL')).toBe(true)
    expect(isPerilState(PR_LOB, 'LA')).toBe(true)
    expect(isPerilState(PR_LOB, 'OH')).toBe(false)
    const groups = groupBySection(PR_LOB, [
      { name: 'Building' },
      { name: 'Business Income' },
      { name: 'Ordinance or Law' }, // → Additional Coverages catch-all
    ])
    expect(groups.map(g => g.label)).toEqual([
      'Building & Business Personal Property', 'Time Element', 'Additional Coverages',
    ])
  })
})
