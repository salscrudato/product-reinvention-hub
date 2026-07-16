// Unit tests for the pure concept-matching toolkit. These lock the deterministic linkage
// primitives the concept-linker import path stands on (isoImport.ts): the form-token
// grammar, coverage-code resolution, the coverage-name matcher's four tiers, the
// rule-reference → table matcher (containment / token-subset / form-token / state-family /
// coverage-fallback), and rating-group resolution incl. endorsement-package → form linking.
// Everything resolves against a synthetic hierarchy — no hard-coded carrier ids.
import { describe, it, expect } from 'vitest'
import {
  norm, squish, stem, tokens, formTokens, foldSynonyms,
  matchCoverageByName, resolveCoverageCode, physicalDamageCoverages,
  matchRuleReferenceToTables, matchGroup, inferTableKind,
  type NamedCoverage, type ConceptTable,
} from './conceptMatch'

// ── A synthetic auto-domain hierarchy (names only; refIds are opaque) ──
const COVERAGES: NamedCoverage[] = [
  { refId: 'X.COV.001', name: 'Bodily Injury' },
  { refId: 'X.COV.002', name: 'Motorcycle Passenger Liability' },
  { refId: 'X.COV.003', name: 'Property Damage' },
  { refId: 'X.COV.004', name: 'Medical Payments' },
  { refId: 'X.COV.005', name: 'Uninsured Motorists Bodily Injury' },
  { refId: 'X.COV.006', name: 'Uninsured Motorists Property Damage' },
  { refId: 'X.COV.007', name: 'Underinsured Motorists Bodily Injury' },
  { refId: 'X.COV.008', name: 'Underinsured Motorists Property Damage' },
  { refId: 'X.COV.009', name: 'Collision' },
  { refId: 'X.COV.010', name: 'Other Than Collision' },
  { refId: 'X.COV.012', name: 'Spare Parts' },
  { refId: 'X.COV.020', name: 'Evacuation Expense' },
]

describe('string primitives', () => {
  it('norm strips punctuation, uppercases, collapses whitespace', () => {
    expect(norm('Sub-\nCoverage (A/B)')).toBe('SUB COVERAGE A B')
  })
  it('squish is norm minus spaces', () => {
    expect(squish('AC 00 01')).toBe('AC0001')
    expect(squish('AC 0001')).toBe('AC0001')
  })
  it('stem folds a trailing S only for tokens longer than 3 chars', () => {
    expect(stem('LIMITS')).toBe('LIMIT')
    expect(stem('GAS')).toBe('GAS')       // 3 chars → untouched
  })
  it('tokens drops stopwords and stems', () => {
    expect(tokens('The Table of Occurrence Limits')).toEqual(['OCCURRENCE', 'LIMIT'])
  })
})

describe('form-token grammar', () => {
  it('detects carrier form tokens across prefixes', () => {
    expect(formTokens('see AC 400 and PP 0001')).toEqual(['AC 400', 'PP 0001'])
  })
  it('treats an embedded space as insignificant: AC 00 01 ≡ AC 0001', () => {
    expect(squish(formTokens('AC 00 01')[0]!)).toBe(squish(formTokens('AC 0001')[0]!))
  })
  it('captures a state-suffixed AC form (at least the base token)', () => {
    const t = formTokens('AC 002 CO')
    expect(t.some(x => squish(x).startsWith('AC002'))).toBe(true)
  })
  it('is case-insensitive and de-duplicates', () => {
    expect(formTokens('ac 400, AC 400')).toEqual(['AC 400'])
  })
})

describe('coverage-code map (D1/D7)', () => {
  it('CSL resolves to BOTH bodily injury and property damage', () => {
    expect(resolveCoverageCode('CSL', COVERAGES).sort()).toEqual(['X.COV.001', 'X.COV.003'])
  })
  it('BI/PD CSL (slash form) resolves the same', () => {
    expect(resolveCoverageCode('BI/PD CSL', COVERAGES).sort()).toEqual(['X.COV.001', 'X.COV.003'])
  })
  it('UM BI resolves to the uninsured-motorists BI coverage only', () => {
    expect(resolveCoverageCode('UM BI', COVERAGES)).toEqual(['X.COV.005'])
  })
  it('UM/UIM BI resolves to both UM-BI and UIM-BI', () => {
    expect(resolveCoverageCode('UM/UIM BI', COVERAGES).sort()).toEqual(['X.COV.005', 'X.COV.007'])
  })
  it('MP / MED PAY both resolve to Medical Payments', () => {
    expect(resolveCoverageCode('MP', COVERAGES)).toEqual(['X.COV.004'])
    expect(resolveCoverageCode('MED PAY', COVERAGES)).toEqual(['X.COV.004'])
  })
  it('an unknown code resolves to nothing (never a guess)', () => {
    expect(resolveCoverageCode('ZZ', COVERAGES)).toEqual([])
  })
  it('physical damage = collision + other than collision', () => {
    expect(physicalDamageCoverages(COVERAGES).sort()).toEqual(['X.COV.009', 'X.COV.010'])
  })
  it('physical damage excludes a "Comprehensive Personal Liability" coverage (anchored, not substring)', () => {
    const withCpl = [...COVERAGES, { refId: 'X.COV.099', name: 'Comprehensive Personal Liability' }]
    expect(physicalDamageCoverages(withCpl).sort()).toEqual(['X.COV.009', 'X.COV.010'])
  })
})

describe('coverage-name matcher (four tiers)', () => {
  it('tier 1 — exact normalized name', () => {
    expect(matchCoverageByName('bodily injury', COVERAGES)).toMatchObject({ refId: 'X.COV.001', how: 'exact name' })
  })
  it('tier 2 — domain synonym fold (UM BI → Uninsured Motorists Bodily Injury)', () => {
    expect(matchCoverageByName('UM BI', COVERAGES)?.refId).toBe('X.COV.005')
  })
  it('strips parenthetical qualifiers and "excluding" tails', () => {
    expect(matchCoverageByName('Bodily Injury (excluding trailers)', COVERAGES)?.refId).toBe('X.COV.001')
  })
  it('tier 4 — containment when overlap is too low', () => {
    const m = matchCoverageByName('Optional Additional Spare Parts Property Item Extended', COVERAGES)
    expect(m).toMatchObject({ refId: 'X.COV.012', how: 'containment' })
  })
  it('returns null when nothing clears the bar (no false match)', () => {
    expect(matchCoverageByName('Cyber Liability', COVERAGES)).toBeNull()
  })
})

describe('rule-reference → table matcher (D2)', () => {
  const tables: ConceptTable[] = [
    { refId: 'X.TBL.001', baseName: 'Liability Limits - AZ', state: 'AZ' },
    { refId: 'X.TBL.002', baseName: 'Liability Limits - CA', state: 'CA' },
    { refId: 'X.TBL.003', baseName: 'Liability Limits - TX', state: 'TX' },
    { refId: 'X.TBL.004', baseName: 'Minimum Premiums' },
    { refId: 'X.TBL.005', baseName: 'Sub-Coverage Limit Matrix' },
    { refId: 'X.TBL.006', baseName: 'Physical Damage Deductibles AC 114' },
  ]
  it('token-subset match on the reference name', () => {
    const m = matchRuleReferenceToTables('Minimum Premium', tables, [], true, COVERAGES)
    expect(m.tableRefIds).toEqual(['X.TBL.004'])
  })
  it('state-family preference: an AZ rule prefers the AZ variant', () => {
    const m = matchRuleReferenceToTables('Liability Limits', tables, ['AZ'], false, COVERAGES)
    expect(m.tableRefIds).toEqual(['X.TBL.001'])
  })
  it('an all-states rule keeps the whole state family', () => {
    const m = matchRuleReferenceToTables('Liability Limits', tables, [], true, COVERAGES)
    expect(m.tableRefIds.sort()).toEqual(['X.TBL.001', 'X.TBL.002', 'X.TBL.003'])
  })
  it('matrix synonym: "…Limit Matrix" resolves to the sub-coverage limit matrix', () => {
    const m = matchRuleReferenceToTables('Form/Coverage/Limit Matrix', tables, [], true, COVERAGES)
    expect(m.tableRefIds).toEqual(['X.TBL.005'])
  })
  it('shared form token links a table that cites the same form', () => {
    const m = matchRuleReferenceToTables('Deductible rule AC 114', tables, [], true, COVERAGES)
    expect(m.tableRefIds).toContain('X.TBL.006')
  })
  it('coverage fallback (D8): a reference that names a coverage resolves to it, no table', () => {
    const m = matchRuleReferenceToTables('Evacuation Expense', tables, [], true, COVERAGES)
    expect(m.tableRefIds).toEqual([])
    expect(m.resolvedCoverageRefId).toBe('X.COV.020')
  })
  it('genuinely unresolved reference reports NO MATCHING TABLE', () => {
    const m = matchRuleReferenceToTables('Quantum Flux Table', tables, [], true, COVERAGES)
    expect(m.tableRefIds).toEqual([])
    expect(m.resolvedCoverageRefId).toBeUndefined()
    expect(m.how).toMatch(/NO MATCHING TABLE/)
  })
})

describe('rating-group matcher + package→form linking (D5)', () => {
  const covsByForm = new Map<string, string[]>([
    [squish('AC 114'), ['X.COV.009', 'X.COV.010']],   // Legendary Ride package grants these
  ])
  it('endorsement package resolves via the package form’s coverage list', () => {
    const m = matchGroup('Legendary Ride™', COVERAGES, covsByForm)
    expect(m.covRefIds.sort()).toEqual(['X.COV.009', 'X.COV.010'])
    expect(m.formNums).toEqual(['AC 114'])
    expect(m.matchBasis).toBe('derived')
  })
  it('direct coverage-name group resolves to its coverage', () => {
    const m = matchGroup('Spare Parts', COVERAGES, covsByForm)
    expect(m.covRefIds).toEqual(['X.COV.012'])
  })
  it('a group naming no coverage in the hierarchy is flagged unmatched (never invented)', () => {
    const m = matchGroup('Business Use', COVERAGES, covsByForm)
    expect(m.covRefIds).toEqual([])
    expect(m.matchBasis).toBe('unmatched')
  })
  it('domain taxonomy: "Combined Single Limit" rates bodily injury + property damage', () => {
    expect(matchGroup('Combined Single Limit', COVERAGES, covsByForm).covRefIds.sort()).toEqual(['X.COV.001', 'X.COV.003'])
  })
  it('domain taxonomy: bare "Uninsured Motorists" → its bodily-injury coverage', () => {
    expect(matchGroup('Uninsured Motorists', COVERAGES, covsByForm).covRefIds).toEqual(['X.COV.005'])
  })
  it('domain taxonomy: "Under insured Motorists" folds → its BI coverage', () => {
    expect(matchGroup('Under insured Motorists', COVERAGES, covsByForm).covRefIds).toEqual(['X.COV.007'])
  })
  it('domain taxonomy: "Uninsured Motorists Combined Single Limit" → UM BI + UM PD', () => {
    expect(matchGroup('Uninsured Motorists Combined Single Limit', COVERAGES, covsByForm).covRefIds.sort()).toEqual(['X.COV.005', 'X.COV.006'])
  })
  it('containment catches "Optional Bodily Injury To Others" → Bodily Injury', () => {
    expect(matchGroup('Optional Bodily Injury To Others', COVERAGES, covsByForm).covRefIds).toEqual(['X.COV.001'])
  })
  it('combined "Uninsured/Underinsured Motorists Combined Single Limit" → all four UM/UIM BI+PD', () => {
    const m = matchGroup('Uninsured/Underinsured Motorists Combined Single Limit', COVERAGES, covsByForm)
    expect(m.covRefIds.sort()).toEqual(['X.COV.005', 'X.COV.006', 'X.COV.007', 'X.COV.008'])
  })
  it('a package name with NO form provenance in the file is not stamped (never fabricates the form)', () => {
    // "Value-Added" → AC 400, but covsByForm carries no AC 400 → must fall through, not stamp AC 400.
    const m = matchGroup('Value-Added', COVERAGES, covsByForm)
    expect(m.formNums).toEqual([])
    expect(m.matchBasis).toBe('unmatched')
  })
})

describe('term-kind inference', () => {
  it('reads DEDUCTIBLE / LIMIT from the table hay, else OPTION', () => {
    expect(inferTableKind('Physical Damage Deductibles')).toBe('DEDUCTIBLE')
    expect(inferTableKind('Occurrence Limits')).toBe('LIMIT')
    expect(inferTableKind('Vehicle Symbols')).toBe('OPTION')
  })
})

describe('foldSynonyms', () => {
  it('expands domain abbreviations to canonical words', () => {
    expect(foldSynonyms('UM BI')).toBe('UNINSURED MOTORISTS BODILY INJURY')
    expect(foldSynonyms('under insured motorists')).toBe('UNDERINSURED MOTORISTS')
  })
})
