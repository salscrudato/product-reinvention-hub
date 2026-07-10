// Rules engine: evaluates product rules for any registered LOB, dispatching by
// line so a single public function covers Personal Home, Personal Auto, and GL.
// Pure function; no Firestore imports — all domain data is injected as constants.
import type {
  LDTable, SelectionContext, PASelectionContext, GLSelectionContext,
  RulesResult, TermOption, RuleViolation,
} from '../types'
import { PH_LOB } from '../insurance/lobRegistry'

// ── Personal Home: coastal states for wind/hail eligibility [PH.RU.008] ─────
const PH_COASTAL       = new Set<string>(PH_LOB.peril.eligibleStates)
const PH_COASTAL_LABEL = PH_LOB.peril.eligibleStates.join(' ')

// ── Personal Auto: states where UM/UIM is mandatory unless waived in writing ─
// [PA.RU.006] — representative footprint subset; source: ISO state mandates.
const PA_UM_MANDATORY = new Set<string>([
  'AZ', 'CO', 'CT', 'DC', 'FL', 'GA', 'IL', 'IN', 'KY', 'MA', 'MD', 'MI',
  'MN', 'MO', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'OH', 'OR', 'SC', 'SD',
  'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV',
])

// ── Discriminated input union — the `lob` field routes to the correct evaluator

export type RulesEngineInput =
  | { ldTables: Record<string, LDTable>; lob?: 'PH'; selection: SelectionContext }
  | { ldTables: Record<string, LDTable>; lob: 'PA'; selection: PASelectionContext }
  | { ldTables: Record<string, LDTable>; lob: 'GL'; selection: GLSelectionContext }

/**
 * Evaluate all product rules for the line identified by `lob` (default PH).
 * Returns available term options (with constraint violations noted), the form
 * numbers that must attach, and any hard violations. The result shape is
 * identical for all lines so the Rules screen needs no line-specific logic.
 */
export function evaluateRules(input: RulesEngineInput): RulesResult {
  if (input.lob === 'PA') return evaluateRulesPA(input.ldTables, input.selection)
  if (input.lob === 'GL') return evaluateRulesGL(input.ldTables, input.selection)
  return evaluateRulesPH(input.ldTables, input.selection)
}

// ── Personal Home evaluator ─────────────────────────────────────────────────

function evaluateRulesPH(ldTables: Record<string, LDTable>, selection: SelectionContext): RulesResult {
  const violations: RuleViolation[] = []

  // ── Available options per LD table ──────────────────────────────────────────

  // PH.LD.001 — Coverage E limits (no constraints)
  const covEOptions = buildOptions(ldTables['PH.LD.001'], () => null)

  // PH.LD.002 — Coverage F limits; $5,000 requires E ≥ $300,000 [PH.RU.006]
  const covFOptions = buildOptions(ldTables['PH.LD.002'], (row) => {
    if (row.value === 5000 && selection.covELimit < 300000) {
      return 'Available only when Coverage E ≥ 300,000'
    }
    return null
  })

  // PH.LD.003 — All-peril deductible (no eligibility constraints)
  const allPerilDedOptions = buildOptions(ldTables['PH.LD.003'], () => null)

  // PH.LD.004 — Wind/hail % deductible [PH.RU.008]
  const isCoastal = PH_COASTAL.has(selection.riskState)
  const windHailOptions = buildOptions(ldTables['PH.LD.004'], (row) => {
    if (!isCoastal) return `Available in coastal states only (${PH_COASTAL_LABEL})`
    // dollar amount (pct% × covA) must be ≥ the all-peril deductible
    const dollarAmt = (row.value / 100) * selection.covA
    if (dollarAmt < selection.allPerilDed) {
      return `${row.value}% of $${selection.covA.toLocaleString()} = $${dollarAmt.toLocaleString()} — must be ≥ all-peril deductible ($${selection.allPerilDed.toLocaleString()})`
    }
    return null
  })

  // PH.LD.005 — Coverage C % of A (no eligibility constraints)
  const covCOptions = buildOptions(ldTables['PH.LD.005'], () => null)

  // PH.LD.006 — Water back-up limit (no eligibility constraints beyond coverage election)
  const waterBackupOptions = buildOptions(ldTables['PH.LD.006'], () => null)

  // ── Hard violations ─────────────────────────────────────────────────────────

  // [PH.RU.006] Coverage F $5,000 selected but E < $300,000
  if (selection.covFLimit === 5000 && selection.covELimit < 300000) {
    violations.push({
      ruleRefId: 'PH.RU.006',
      message:   'Coverage F $5,000 limit requires Coverage E ≥ $300,000',
      severity:  'error',
    })
  }

  // [PH.RU.008] Wind/hail elected in non-coastal state
  if (selection.windHailElected && !isCoastal) {
    violations.push({
      ruleRefId: 'PH.RU.008',
      message:   `Wind/hail deductible is not available in ${selection.riskState}`,
      severity:  'error',
    })
  }

  // [PH.RU.008] Wind/hail dollar amount < all-peril deductible
  if (selection.windHailElected && selection.windHailPct !== undefined && isCoastal) {
    const dollarAmt = (selection.windHailPct / 100) * selection.covA
    if (dollarAmt < selection.allPerilDed) {
      violations.push({
        ruleRefId: 'PH.RU.008',
        message:   `Wind/hail deductible ($${dollarAmt.toLocaleString()}) must be ≥ all-peril deductible ($${selection.allPerilDed.toLocaleString()})`,
        severity:  'error',
      })
    }
  }

  // ── Eligibility [PH.RU.001] / [PH.RU.010] ──────────────────────────────────
  // Undefined occupancy defaults to the eligible base case (owner-occupied primary),
  // so callers that don't collect occupancy see no eligibility violation.
  const occupancy = selection.occupancy ?? 'PRIMARY_OWNER'
  if (occupancy === 'SEASONAL' || occupancy === 'SECONDARY') {
    // [PH.RU.010] seasonal/secondary is ineligible unless a companion primary is in force
    if (!selection.companionPolicy) {
      violations.push({
        ruleRefId: 'PH.RU.010',
        message:   'Seasonal or secondary dwelling is ineligible for HO-3 unless a companion primary policy is in force',
        severity:  'error',
      })
    }
  } else if (occupancy === 'TENANT_NONOWNER') {
    // [PH.RU.001] HO-3 requires an owner-occupied 1–4 family dwelling in residential use
    violations.push({
      ruleRefId: 'PH.RU.001',
      message:   'HO-3 requires an owner-occupied 1–4 family dwelling in residential use',
      severity:  'error',
    })
  }

  // ── Forms that attach ───────────────────────────────────────────────────────

  const formsThatAttach: string[] = []

  // Always-mandatory forms (non-rule attachments)
  formsThatAttach.push('HO 00 03', 'HO DS 01', 'PN HO 01')

  // [HO.FORM.RU.001] Replacement Cost
  if (selection.rcElected)          formsThatAttach.push('HO 04 90')
  // [HO.FORM.RU.002] Water Back-Up
  if (selection.waterBackupElected) formsThatAttach.push('HO 04 95')
  // [HO.FORM.RU.003] Scheduled Personal Property
  if (selection.sppElected)         formsThatAttach.push('HO 04 61')
  // [HO.FORM.RU.004] Protective device
  if (selection.deviceCredit !== 'none') formsThatAttach.push('HO 04 16')
  // [HO.FORM.RU.005] Wind/Hail deductible
  if (selection.windHailElected)    formsThatAttach.push('HO 03 12')
  // [HO.FORM.RU.006] State amendatories
  if (selection.riskState === 'CA') formsThatAttach.push('HO 01 04')
  if (selection.riskState === 'TX') formsThatAttach.push('HO 01 33')
  // [HO.FORM.RU.007] Day-care exclusion
  if (selection.dayCareCoverage)    formsThatAttach.push('HO 04 96')
  // [PH.RU.002] Other Structures — Increased Limits
  if (selection.otherStructuresInc) formsThatAttach.push('HO 04 48')

  return {
    availableOptions: {
      'PH.LD.001': covEOptions,
      'PH.LD.002': covFOptions,
      'PH.LD.003': allPerilDedOptions,
      'PH.LD.004': windHailOptions,
      'PH.LD.005': covCOptions,
      'PH.LD.006': waterBackupOptions,
    },
    formsThatAttach,
    violations,
    // Rules whose conditions are directly evaluated (eligibility + hard constraints).
    // LD-table-gated and form-attachment rules surface via availableOptions / formsThatAttach.
    evaluatedRuleRefIds: ['PH.RU.001', 'PH.RU.006', 'PH.RU.008', 'PH.RU.010'],
  }
}

// ── Personal Auto evaluator ─────────────────────────────────────────────────

function evaluateRulesPA(ldTables: Record<string, LDTable>, sel: PASelectionContext): RulesResult {
  const violations: RuleViolation[] = []

  // ── Available options per LD table ──────────────────────────────────────────

  // PA.LD.001 — BI limits; no cross-coverage constraint at the engine level
  const biOptions = buildOptions(ldTables['PA.LD.001'], () => null)

  // PA.LD.002 — PD limits; no cross-coverage constraint
  const pdOptions = buildOptions(ldTables['PA.LD.002'], () => null)

  // PA.LD.003 — Med Pay limits; no cross-coverage constraint
  const medOptions = buildOptions(ldTables['PA.LD.003'], () => null)

  // PA.LD.004 — UM/UIM limits must not exceed the elected BI limit [PA.RU.007]
  const umOptions = buildOptions(ldTables['PA.LD.004'], (row) => {
    if (row.value > sel.biLimit) {
      return `UM/UIM limit may not exceed BI limit ($${sel.biLimit.toLocaleString()})`
    }
    return null
  })

  // PA.LD.005 — Collision deductible; no cross-coverage constraint
  const colDedOptions = buildOptions(ldTables['PA.LD.005'], () => null)

  // PA.LD.006 — Comprehensive deductible; no cross-coverage constraint
  const compDedOptions = buildOptions(ldTables['PA.LD.006'], () => null)

  // ── Hard violations ─────────────────────────────────────────────────────────

  // [PA.RU.001] Eligibility — PP 00 01 covers personal-use vehicles only
  if (sel.vehicleUse === 'commercial') {
    violations.push({
      ruleRefId: 'PA.RU.001',
      message:   'PP 00 01 covers personal-use vehicles only; commercial-use vehicles are not eligible',
      severity:  'error',
    })
  }

  // [PA.RU.006] UM/UIM is mandatory (unless waived in writing) in most states
  if (!sel.umElected && PA_UM_MANDATORY.has(sel.riskState)) {
    violations.push({
      ruleRefId: 'PA.RU.006',
      message:   `UM/UIM coverage is mandatory (unless waived in writing) in ${sel.riskState}`,
      severity:  'warning',
    })
  }

  // [PA.RU.007] UIM limit may not exceed BI limit per occurrence
  if (sel.umElected && sel.umLimit !== undefined && sel.umLimit > sel.biLimit) {
    violations.push({
      ruleRefId: 'PA.RU.007',
      message:   `UIM limit ($${sel.umLimit.toLocaleString()}) may not exceed BI limit ($${sel.biLimit.toLocaleString()})`,
      severity:  'error',
    })
  }

  // [PA.RU.008] Rental Reimbursement requires physical damage coverage in force
  if (sel.rentalElected && !sel.collisionElected && !sel.compElected) {
    violations.push({
      ruleRefId: 'PA.RU.008',
      message:   'Rental Reimbursement (PP 13 01) requires Collision or Comprehensive to be in force',
      severity:  'error',
    })
  }

  // [PA.RU.009] Towing and Labor requires physical damage coverage in force
  if (sel.towingElected && !sel.collisionElected && !sel.compElected) {
    violations.push({
      ruleRefId: 'PA.RU.009',
      message:   'Towing and Labor (PP 03 28) requires Collision or Comprehensive to be in force',
      severity:  'error',
    })
  }

  // ── Forms that attach ───────────────────────────────────────────────────────

  const formsThatAttach: string[] = ['PP 00 01', 'PP DS 01', 'PN PP 01']

  // [PA.FORM.RU.001] Rental Reimbursement
  if (sel.rentalElected)         formsThatAttach.push('PP 13 01')
  // [PA.FORM.RU.002] Towing and Labor
  if (sel.towingElected)         formsThatAttach.push('PP 03 28')
  // [PA.FORM.RU.003] Loan/Lease Gap
  if (sel.loanLeaseGapElected)   formsThatAttach.push('PP 04 46')
  // [PA.FORM.RU.004] Named Non-Owner
  if (sel.namedNonOwner)         formsThatAttach.push('PP 03 01')
  // [PA.FORM.RU.006] State amendatories
  if (sel.riskState === 'CA')    formsThatAttach.push('PP 01 75')
  if (sel.riskState === 'TX')    formsThatAttach.push('PP 01 79')

  return {
    availableOptions: {
      'PA.LD.001': biOptions,
      'PA.LD.002': pdOptions,
      'PA.LD.003': medOptions,
      'PA.LD.004': umOptions,
      'PA.LD.005': colDedOptions,
      'PA.LD.006': compDedOptions,
    },
    formsThatAttach,
    violations,
    evaluatedRuleRefIds: ['PA.RU.001', 'PA.RU.006', 'PA.RU.007', 'PA.RU.008', 'PA.RU.009'],
  }
}

// ── General Liability evaluator ────────────────────────────────────────────────

function evaluateRulesGL(ldTables: Record<string, LDTable>, sel: GLSelectionContext): RulesResult {
  const violations: RuleViolation[] = []

  // ── Available options per LD table ──────────────────────────────────────────

  // GL.LD.001 — Per-occurrence limit; no cross-term constraint at the option level
  const occLimitOptions = buildOptions(ldTables['GL.LD.001'], () => null)

  // GL.LD.002 — General Aggregate; must be ≥ per-occurrence limit [GL.RU.007]
  const genAggOptions = buildOptions(ldTables['GL.LD.002'], (row) => {
    if (row.value < sel.occLimit) {
      return `General Aggregate ($${row.value.toLocaleString()}) must be ≥ per-occurrence limit ($${sel.occLimit.toLocaleString()})`
    }
    return null
  })

  // GL.LD.003 — PCO Aggregate; must be ≥ per-occurrence limit when elected [GL.RU.003]
  const pcoAggOptions = buildOptions(ldTables['GL.LD.003'], (row) => {
    if (sel.pcoElected && row.value < sel.occLimit) {
      return `PCO Aggregate ($${row.value.toLocaleString()}) must be ≥ per-occurrence limit ($${sel.occLimit.toLocaleString()}) when Products-Completed-Operations is elected`
    }
    return null
  })

  // GL.LD.004 — BI/PD deductible; no cross-term constraint
  const dedOptions = buildOptions(ldTables['GL.LD.004'], () => null)

  // ── Hard violations ─────────────────────────────────────────────────────────

  // [GL.RU.007] Aggregate consistency — per-occurrence limit must not exceed General Aggregate
  if (sel.occLimit > sel.genAggregate) {
    violations.push({
      ruleRefId: 'GL.RU.007',
      message:   `Per-occurrence limit ($${sel.occLimit.toLocaleString()}) may not exceed the General Aggregate ($${sel.genAggregate.toLocaleString()})`,
      severity:  'error',
    })
  }

  // [GL.RU.003] PCO dependency — PCO aggregate must be ≥ per-occurrence limit when elected
  if (sel.pcoElected && sel.pcoAggregate !== undefined && sel.pcoAggregate < sel.occLimit) {
    violations.push({
      ruleRefId: 'GL.RU.003',
      message:   `Products-Completed-Operations Aggregate ($${sel.pcoAggregate.toLocaleString()}) must be ≥ per-occurrence limit ($${sel.occLimit.toLocaleString()}) when PCO is elected`,
      severity:  'error',
    })
  }

  // ── Forms that attach ───────────────────────────────────────────────────────

  const formsThatAttach: string[] = ['CG 00 01', 'CG DS 01']

  // [GL.FORM.RU.001] PCO additional insured endorsement
  if (sel.pcoElected) formsThatAttach.push('CG 20 33')
  // [GL.FORM.RU.002] BI/PD deductible endorsement
  if (sel.occDeductible > 0) formsThatAttach.push('CG 03 00')
  // [GL.FORM.RU.003] Additional insured — ongoing operations
  if (sel.additionalInsuredReq) formsThatAttach.push('CG 20 10')

  return {
    availableOptions: {
      'GL.LD.001': occLimitOptions,
      'GL.LD.002': genAggOptions,
      'GL.LD.003': pcoAggOptions,
      'GL.LD.004': dedOptions,
    },
    formsThatAttach,
    violations,
    // [GL.RU.007] aggregate consistency and [GL.RU.003] PCO dependency are directly
    // evaluated here; LD-table option constraints surface via availableOptions.
    evaluatedRuleRefIds: ['GL.RU.003', 'GL.RU.007'],
  }
}

// ── Shared helper ───────────────────────────────────────────────────────────

/** Map an LDTable's rows to TermOption[], marking constrained rows as unavailable.
 *  row.constraintNote is informational only; only constraintFn controls availability. */
function buildOptions(
  table: LDTable | undefined,
  constraintFn: (row: { label: string; value: number; constraintNote?: string }) => string | null,
): TermOption[] {
  if (!table) return []
  return table.rows.map((row) => {
    const reason = constraintFn(row)
    return {
      label:           row.label,
      value:           row.value,
      constraintNote:  row.constraintNote,
      available:       reason === null,
      violationReason: reason ?? undefined,
    }
  })
}
