// Rules engine tests — validates constraints, form attachment, and violations.
import { describe, it, expect } from 'vitest'
import { evaluateRules } from './engine'
import { HO3_LD_TABLES } from '../seed/ho3'
import type { SelectionContext } from '../types'

const BASE: SelectionContext = {
  riskState:          'OH',
  covELimit:          300000,
  covFLimit:          1000,
  allPerilDed:        1000,
  windHailElected:    false,
  windHailPct:        undefined,
  covA:               300000,
  rcElected:          false,
  deviceCredit:       'none',
  waterBackupElected: false,
  waterBackupLimit:   undefined,
  sppElected:         false,
  dayCareCoverage:    false,
  otherStructuresInc: false,
}

describe('HO-3 rules engine', () => {
  // ── Coverage F constraint [HO.RU.006] ──────────────────────────────────────

  it('blocks Coverage F $5,000 when Coverage E = $100,000', () => {
    const result = evaluateRules({
      ldTables:  HO3_LD_TABLES,
      selection: { ...BASE, covELimit: 100000, covFLimit: 5000 },
    })
    const fOpts = result.availableOptions['HO.LD.002']
    const row5k = fOpts.find(o => o.value === 5000)!
    expect(row5k.available).toBe(false)
    expect(result.violations.some(v => v.ruleRefId === 'HO.RU.006')).toBe(true)
  })

  it('allows Coverage F $5,000 when Coverage E = $300,000', () => {
    const result = evaluateRules({
      ldTables:  HO3_LD_TABLES,
      selection: { ...BASE, covELimit: 300000, covFLimit: 5000 },
    })
    const row5k = result.availableOptions['HO.LD.002'].find(o => o.value === 5000)!
    expect(row5k.available).toBe(true)
    expect(result.violations.some(v => v.ruleRefId === 'HO.RU.006')).toBe(false)
  })

  // ── Wind/hail state constraint [HO.RU.008] ─────────────────────────────────

  it('rejects wind/hail deductible in non-coastal state OH', () => {
    const result = evaluateRules({
      ldTables:  HO3_LD_TABLES,
      selection: { ...BASE, riskState: 'OH', windHailElected: true, windHailPct: 2 },
    })
    expect(result.violations.some(v => v.ruleRefId === 'HO.RU.008')).toBe(true)
    const whOpts = result.availableOptions['HO.LD.004']
    expect(whOpts.every(o => !o.available)).toBe(true)
  })

  it('accepts wind/hail deductible in coastal state FL when ≥ all-peril deductible', () => {
    // covA 400k, 1% WH = 4000 >= allPerilDed 1000 → valid
    const result = evaluateRules({
      ldTables:  HO3_LD_TABLES,
      selection: { ...BASE, riskState: 'FL', covA: 400000, allPerilDed: 1000, windHailElected: true, windHailPct: 1 },
    })
    expect(result.violations.some(v => v.ruleRefId === 'HO.RU.008')).toBe(false)
    const opt1pct = result.availableOptions['HO.LD.004'].find(o => o.value === 1)!
    expect(opt1pct.available).toBe(true)
  })

  // ── Form attachment [HO.FORM.RU.*] ─────────────────────────────────────────

  it('attaches HO 04 61 when Scheduled Personal Property is elected', () => {
    const result = evaluateRules({
      ldTables:  HO3_LD_TABLES,
      selection: { ...BASE, sppElected: true },
    })
    expect(result.formsThatAttach).toContain('HO 04 61')
  })

  it('attaches HO 01 33 for a TX risk and HO 01 04 for CA — but not cross-state', () => {
    const txResult = evaluateRules({ ldTables: HO3_LD_TABLES, selection: { ...BASE, riskState: 'TX' } })
    expect(txResult.formsThatAttach).toContain('HO 01 33')
    expect(txResult.formsThatAttach).not.toContain('HO 01 04')

    const caResult = evaluateRules({ ldTables: HO3_LD_TABLES, selection: { ...BASE, riskState: 'CA' } })
    expect(caResult.formsThatAttach).toContain('HO 01 04')
    expect(caResult.formsThatAttach).not.toContain('HO 01 33')
  })
})
