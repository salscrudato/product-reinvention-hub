// Rules engine tests — validates constraints, form attachment, and violations
// for both Personal Home (PH) and Personal Auto (PA).
import { describe, it, expect } from 'vitest'
import { evaluateRules } from './engine'
import { PH_LD_TABLES } from '../seed/personalHome'
import { PA_LD_TABLES } from '../seed/personalAuto'
import { PA_LOB } from '../insurance/lobRegistry'
import type { SelectionContext, PASelectionContext } from '../types'

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
  // ── Coverage F constraint [PH.RU.006] ──────────────────────────────────────

  it('blocks Coverage F $5,000 when Coverage E = $100,000', () => {
    const result = evaluateRules({
      ldTables:  PH_LD_TABLES,
      selection: { ...BASE, covELimit: 100000, covFLimit: 5000 },
    })
    const fOpts = result.availableOptions['PH.LD.002']
    const row5k = fOpts.find(o => o.value === 5000)!
    expect(row5k.available).toBe(false)
    expect(result.violations.some(v => v.ruleRefId === 'PH.RU.006')).toBe(true)
  })

  it('allows Coverage F $5,000 when Coverage E = $300,000', () => {
    const result = evaluateRules({
      ldTables:  PH_LD_TABLES,
      selection: { ...BASE, covELimit: 300000, covFLimit: 5000 },
    })
    const row5k = result.availableOptions['PH.LD.002'].find(o => o.value === 5000)!
    expect(row5k.available).toBe(true)
    expect(result.violations.some(v => v.ruleRefId === 'PH.RU.006')).toBe(false)
  })

  // ── Wind/hail state constraint [PH.RU.008] ─────────────────────────────────

  it('rejects wind/hail deductible in non-coastal state OH', () => {
    const result = evaluateRules({
      ldTables:  PH_LD_TABLES,
      selection: { ...BASE, riskState: 'OH', windHailElected: true, windHailPct: 2 },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PH.RU.008')).toBe(true)
    const whOpts = result.availableOptions['PH.LD.004']
    expect(whOpts.every(o => !o.available)).toBe(true)
  })

  it('accepts wind/hail deductible in coastal state FL when ≥ all-peril deductible', () => {
    // covA 400k, 1% WH = 4000 >= allPerilDed 1000 → valid
    const result = evaluateRules({
      ldTables:  PH_LD_TABLES,
      selection: { ...BASE, riskState: 'FL', covA: 400000, allPerilDed: 1000, windHailElected: true, windHailPct: 1 },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PH.RU.008')).toBe(false)
    const opt1pct = result.availableOptions['PH.LD.004'].find(o => o.value === 1)!
    expect(opt1pct.available).toBe(true)
  })

  it('flags PH.RU.008 in coastal FL when the wind/hail dollar amount is below the all-peril deductible', () => {
    // covA 100k, 1% WH = $1,000 < all-peril $2,000 → the dollar-floor branch must fire.
    const result = evaluateRules({
      ldTables:  PH_LD_TABLES,
      selection: { ...BASE, riskState: 'FL', covA: 100000, allPerilDed: 2000, windHailElected: true, windHailPct: 1 },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PH.RU.008')).toBe(true)
    // The same floor makes the 1% option unavailable with an explanatory reason.
    const opt1pct = result.availableOptions['PH.LD.004'].find(o => o.value === 1)!
    expect(opt1pct.available).toBe(false)
    expect(opt1pct.violationReason).toBeTruthy()
  })

  // ── Form attachment [HO.FORM.RU.*] ─────────────────────────────────────────

  it('attaches HO 04 61 when Scheduled Personal Property is elected', () => {
    const result = evaluateRules({
      ldTables:  PH_LD_TABLES,
      selection: { ...BASE, sppElected: true },
    })
    expect(result.formsThatAttach).toContain('HO 04 61')
  })

  it('attaches endorsement forms only for the options actually elected', () => {
    // Baseline (nothing optional elected) attaches only the mandatory forms.
    const base = evaluateRules({ ldTables: PH_LD_TABLES, selection: BASE })
    for (const f of ['HO 04 90', 'HO 04 95', 'HO 04 16', 'HO 04 48']) {
      expect(base.formsThatAttach).not.toContain(f)
    }
    expect(base.formsThatAttach).toEqual(expect.arrayContaining(['HO 00 03', 'HO DS 01', 'PN HO 01']))

    // Each election pulls in exactly its form.
    const elected = evaluateRules({
      ldTables:  PH_LD_TABLES,
      selection: { ...BASE, rcElected: true, waterBackupElected: true, deviceCredit: 'central', otherStructuresInc: true },
    })
    expect(elected.formsThatAttach).toEqual(
      expect.arrayContaining(['HO 04 90', 'HO 04 95', 'HO 04 16', 'HO 04 48']),
    )
  })

  it('attaches HO 01 33 for a TX risk and HO 01 04 for CA — but not cross-state', () => {
    const txResult = evaluateRules({ ldTables: PH_LD_TABLES, selection: { ...BASE, riskState: 'TX' } })
    expect(txResult.formsThatAttach).toContain('HO 01 33')
    expect(txResult.formsThatAttach).not.toContain('HO 01 04')

    const caResult = evaluateRules({ ldTables: PH_LD_TABLES, selection: { ...BASE, riskState: 'CA' } })
    expect(caResult.formsThatAttach).toContain('HO 01 04')
    expect(caResult.formsThatAttach).not.toContain('HO 01 33')
  })

  // ── Eligibility [PH.RU.001] / [PH.RU.010] ──────────────────────────────────

  it('treats an unspecified / owner-occupied primary dwelling as eligible (back-compat)', () => {
    const base    = evaluateRules({ ldTables: PH_LD_TABLES, selection: BASE })
    const primary = evaluateRules({ ldTables: PH_LD_TABLES, selection: { ...BASE, occupancy: 'PRIMARY_OWNER' } })
    for (const r of [base, primary]) {
      expect(r.violations.some(v => v.ruleRefId === 'PH.RU.001')).toBe(false)
      expect(r.violations.some(v => v.ruleRefId === 'PH.RU.010')).toBe(false)
    }
  })

  it('flags PH.RU.001 for a tenant / non-owner-occupied risk', () => {
    const result = evaluateRules({ ldTables: PH_LD_TABLES, selection: { ...BASE, occupancy: 'TENANT_NONOWNER' } })
    expect(result.violations.some(v => v.ruleRefId === 'PH.RU.001')).toBe(true)
  })

  it('flags PH.RU.010 for a seasonal dwelling without a companion policy, clears it with one', () => {
    const without = evaluateRules({ ldTables: PH_LD_TABLES, selection: { ...BASE, occupancy: 'SEASONAL', companionPolicy: false } })
    expect(without.violations.some(v => v.ruleRefId === 'PH.RU.010')).toBe(true)

    const withCompanion = evaluateRules({ ldTables: PH_LD_TABLES, selection: { ...BASE, occupancy: 'SECONDARY', companionPolicy: true } })
    expect(withCompanion.violations.some(v => v.ruleRefId === 'PH.RU.010')).toBe(false)
  })

  it('declares the rules it evaluates directly via evaluatedRuleRefIds', () => {
    const result = evaluateRules({ ldTables: PH_LD_TABLES, selection: BASE })
    expect(result.evaluatedRuleRefIds).toEqual(
      expect.arrayContaining(['PH.RU.001', 'PH.RU.006', 'PH.RU.008', 'PH.RU.010']),
    )
  })
})

// ── Personal Auto rules engine ─────────────────────────────────────────────────

const PA_BASE: PASelectionContext = {
  riskState:        'OH',
  vehicleUse:       'personal',
  biLimit:          100000,
  pdLimit:          100000,
  medPayElected:    true,
  medPayLimit:      5000,
  umElected:        true,
  umLimit:          100000,
  collisionElected: true,
  collisionDed:     500,
  compElected:      true,
  compDed:          250,
  rentalElected:    false,
  towingElected:    false,
}

describe('PA rules engine — Simulate capability', () => {
  it('PA_LOB.supportsRulesSimulation is true after enabling the engine', () => {
    expect(PA_LOB.supportsRulesSimulation).toBe(true)
  })

  it('evaluateRules with lob=PA produces a RulesResult with the expected shape', () => {
    const result = evaluateRules({ ldTables: PA_LD_TABLES, lob: 'PA', selection: PA_BASE })
    expect(result.violations).toEqual([])
    expect(result.formsThatAttach).toEqual(expect.arrayContaining(['PP 00 01', 'PP DS 01', 'PN PP 01']))
    expect(result.evaluatedRuleRefIds).toEqual(
      expect.arrayContaining(['PA.RU.001', 'PA.RU.006', 'PA.RU.007', 'PA.RU.008', 'PA.RU.009']),
    )
    // All six LD tables populated
    expect(Object.keys(result.availableOptions)).toEqual(
      expect.arrayContaining(['PA.LD.001', 'PA.LD.002', 'PA.LD.003', 'PA.LD.004', 'PA.LD.005', 'PA.LD.006']),
    )
  })
})

describe('PA rules engine — clean case (no violations)', () => {
  it('personal-use vehicle with UM elected and valid limits produces zero violations', () => {
    const result = evaluateRules({ ldTables: PA_LD_TABLES, lob: 'PA', selection: PA_BASE })
    expect(result.violations).toHaveLength(0)
  })

  it('attaches only mandatory forms when no optional coverages elected', () => {
    const sel: PASelectionContext = { ...PA_BASE, rentalElected: false, towingElected: false }
    const result = evaluateRules({ ldTables: PA_LD_TABLES, lob: 'PA', selection: sel })
    expect(result.formsThatAttach).toEqual(expect.arrayContaining(['PP 00 01', 'PP DS 01', 'PN PP 01']))
    for (const f of ['PP 13 01', 'PP 03 28', 'PP 04 46', 'PP 03 01']) {
      expect(result.formsThatAttach).not.toContain(f)
    }
  })

  it('attaches PP 13 01 when rental is elected WITH physical damage in force', () => {
    const result = evaluateRules({
      ldTables: PA_LD_TABLES, lob: 'PA',
      selection: { ...PA_BASE, collisionElected: true, rentalElected: true },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PA.RU.008')).toBe(false)
    expect(result.formsThatAttach).toContain('PP 13 01')
  })

  it('attaches PP 01 75 for CA and PP 01 79 for TX — not cross-state', () => {
    const caResult = evaluateRules({ ldTables: PA_LD_TABLES, lob: 'PA', selection: { ...PA_BASE, riskState: 'CA' } })
    expect(caResult.formsThatAttach).toContain('PP 01 75')
    expect(caResult.formsThatAttach).not.toContain('PP 01 79')

    const txResult = evaluateRules({ ldTables: PA_LD_TABLES, lob: 'PA', selection: { ...PA_BASE, riskState: 'TX' } })
    expect(txResult.formsThatAttach).toContain('PP 01 79')
    expect(txResult.formsThatAttach).not.toContain('PP 01 75')
  })

  it('attaches PP 04 46 when loan/lease gap elected, PP 03 01 when named non-owner', () => {
    const gapResult = evaluateRules({ ldTables: PA_LD_TABLES, lob: 'PA', selection: { ...PA_BASE, loanLeaseGapElected: true } })
    expect(gapResult.formsThatAttach).toContain('PP 04 46')

    const nonOwnerResult = evaluateRules({ ldTables: PA_LD_TABLES, lob: 'PA', selection: { ...PA_BASE, namedNonOwner: true } })
    expect(nonOwnerResult.formsThatAttach).toContain('PP 03 01')
  })
})

describe('PA rules engine — violation cases', () => {
  // ── PA.RU.001 Eligibility ──────────────────────────────────────────────────

  it('flags PA.RU.001 for commercial-use vehicle', () => {
    const result = evaluateRules({
      ldTables: PA_LD_TABLES, lob: 'PA',
      selection: { ...PA_BASE, vehicleUse: 'commercial' },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PA.RU.001' && v.severity === 'error')).toBe(true)
  })

  it('passes PA.RU.001 for personal-use vehicle', () => {
    const result = evaluateRules({ ldTables: PA_LD_TABLES, lob: 'PA', selection: PA_BASE })
    expect(result.violations.some(v => v.ruleRefId === 'PA.RU.001')).toBe(false)
  })

  // ── PA.RU.006 Mandatory UM/UIM ────────────────────────────────────────────

  it('warns PA.RU.006 when UM not elected in a mandatory state (OH)', () => {
    const result = evaluateRules({
      ldTables: PA_LD_TABLES, lob: 'PA',
      selection: { ...PA_BASE, riskState: 'OH', umElected: false },
    })
    const v = result.violations.find(v => v.ruleRefId === 'PA.RU.006')
    expect(v).toBeDefined()
    expect(v!.severity).toBe('warning')
  })

  it('clears PA.RU.006 when UM is elected in a mandatory state', () => {
    const result = evaluateRules({
      ldTables: PA_LD_TABLES, lob: 'PA',
      selection: { ...PA_BASE, riskState: 'OH', umElected: true },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PA.RU.006')).toBe(false)
  })

  // ── PA.RU.007 UIM limit ≤ BI limit ────────────────────────────────────────

  it('flags PA.RU.007 when UIM limit exceeds BI limit', () => {
    // biLimit=100k, umLimit=250k → violation
    const result = evaluateRules({
      ldTables: PA_LD_TABLES, lob: 'PA',
      selection: { ...PA_BASE, biLimit: 100000, umElected: true, umLimit: 250000 },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PA.RU.007' && v.severity === 'error')).toBe(true)
    // The 250k option must also be blocked in the LD table
    const blocked = result.availableOptions['PA.LD.004']!.find(o => o.value === 250000)!
    expect(blocked.available).toBe(false)
    expect(blocked.violationReason).toBeTruthy()
    // 100k option stays available
    const ok = result.availableOptions['PA.LD.004']!.find(o => o.value === 100000)!
    expect(ok.available).toBe(true)
  })

  it('clears PA.RU.007 when UIM limit equals BI limit', () => {
    const result = evaluateRules({
      ldTables: PA_LD_TABLES, lob: 'PA',
      selection: { ...PA_BASE, biLimit: 100000, umElected: true, umLimit: 100000 },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PA.RU.007')).toBe(false)
  })

  // ── PA.RU.008 Rental requires physical damage ──────────────────────────────

  it('flags PA.RU.008 when rental elected without any physical damage coverage', () => {
    const result = evaluateRules({
      ldTables: PA_LD_TABLES, lob: 'PA',
      selection: { ...PA_BASE, collisionElected: false, compElected: false, rentalElected: true },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PA.RU.008' && v.severity === 'error')).toBe(true)
    // PP 13 01 still listed (the form that would attach) — the violation flags the constraint
    expect(result.formsThatAttach).toContain('PP 13 01')
  })

  it('clears PA.RU.008 when rental elected with comp only', () => {
    const result = evaluateRules({
      ldTables: PA_LD_TABLES, lob: 'PA',
      selection: { ...PA_BASE, collisionElected: false, compElected: true, rentalElected: true },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PA.RU.008')).toBe(false)
  })

  // ── PA.RU.009 Towing requires physical damage ──────────────────────────────

  it('flags PA.RU.009 when towing elected without any physical damage coverage', () => {
    const result = evaluateRules({
      ldTables: PA_LD_TABLES, lob: 'PA',
      selection: { ...PA_BASE, collisionElected: false, compElected: false, towingElected: true },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PA.RU.009' && v.severity === 'error')).toBe(true)
  })

  it('clears PA.RU.009 when towing elected with collision only', () => {
    const result = evaluateRules({
      ldTables: PA_LD_TABLES, lob: 'PA',
      selection: { ...PA_BASE, collisionElected: true, compElected: false, towingElected: true },
    })
    expect(result.violations.some(v => v.ruleRefId === 'PA.RU.009')).toBe(false)
  })
})
