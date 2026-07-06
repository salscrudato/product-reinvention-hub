// Rules engine: derives available term options, which forms attach, and violations.
// Pure function; no Firestore imports — all domain data is injected as constants.
import type {
  LDTable, SelectionContext, RulesResult, TermOption, RuleViolation,
} from '../types'
import { HO_LOB } from '../insurance/lobRegistry'

// Coastal states for wind/hail eligibility [HO.RU.008] — owned by the LOB registry.
const COASTAL_STATES = new Set<string>(HO_LOB.peril.eligibleStates)
const COASTAL_LABEL  = HO_LOB.peril.eligibleStates.join(' ')

export interface RulesEngineInput {
  ldTables:   Record<string, LDTable>
  selection:  SelectionContext
}

/**
 * Evaluate all HO-3 product rules against the current selection.
 * Returns available term options (with constraint violations noted),
 * the list of form numbers that must attach, and any hard violations.
 */
export function evaluateRules(input: RulesEngineInput): RulesResult {
  const { ldTables, selection } = input
  const violations: RuleViolation[] = []

  // ── Available options per LD table ──────────────────────────────────────────

  // HO.LD.001 — Coverage E limits (no constraints)
  const covEOptions = buildOptions(ldTables['HO.LD.001'], () => null)

  // HO.LD.002 — Coverage F limits; 5,000 requires E ≥ 300,000 [HO.RU.006]
  const covFOptions = buildOptions(ldTables['HO.LD.002'], (row) => {
    if (row.value === 5000 && selection.covELimit < 300000) {
      return 'Available only when Coverage E ≥ 300,000'
    }
    return null
  })

  // HO.LD.003 — All-peril deductible (no eligibility constraints)
  const allPerilDedOptions = buildOptions(ldTables['HO.LD.003'], () => null)

  // HO.LD.004 — Wind/hail % deductible [HO.RU.008]
  const isCoastal = COASTAL_STATES.has(selection.riskState)
  const windHailOptions = buildOptions(ldTables['HO.LD.004'], (row) => {
    if (!isCoastal) return `Available in coastal states only (${COASTAL_LABEL})`
    // dollar amount (pct% × covA) must be ≥ all-peril deductible
    const dollarAmt = (row.value / 100) * selection.covA
    if (dollarAmt < selection.allPerilDed) {
      return `${row.value}% of $${selection.covA.toLocaleString()} = $${dollarAmt.toLocaleString()} — must be ≥ all-peril deductible ($${selection.allPerilDed.toLocaleString()})`
    }
    return null
  })

  // HO.LD.005 — Coverage C % of A (no eligibility constraints)
  const covCOptions = buildOptions(ldTables['HO.LD.005'], () => null)

  // HO.LD.006 — Water back-up limit (no eligibility constraints beyond coverage election)
  const waterBackupOptions = buildOptions(ldTables['HO.LD.006'], () => null)

  // ── Hard violations ─────────────────────────────────────────────────────────

  // [HO.RU.006] Coverage F 5,000 selected but E < 300,000
  if (selection.covFLimit === 5000 && selection.covELimit < 300000) {
    violations.push({
      ruleRefId: 'HO.RU.006',
      message:   'Coverage F $5,000 limit requires Coverage E ≥ $300,000',
      severity:  'error',
    })
  }

  // [HO.RU.008] Wind/hail elected in non-coastal state
  if (selection.windHailElected && !isCoastal) {
    violations.push({
      ruleRefId: 'HO.RU.008',
      message:   `Wind/hail deductible is not available in ${selection.riskState}`,
      severity:  'error',
    })
  }

  // [HO.RU.008] Wind/hail dollar amount < all-peril deductible
  if (selection.windHailElected && selection.windHailPct !== undefined && isCoastal) {
    const dollarAmt = (selection.windHailPct / 100) * selection.covA
    if (dollarAmt < selection.allPerilDed) {
      violations.push({
        ruleRefId: 'HO.RU.008',
        message:   `Wind/hail deductible ($${dollarAmt.toLocaleString()}) must be ≥ all-peril deductible ($${selection.allPerilDed.toLocaleString()})`,
        severity:  'error',
      })
    }
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
  // [HO.RU.002] Other Structures — Increased Limits
  if (selection.otherStructuresInc) formsThatAttach.push('HO 04 48')

  return {
    availableOptions: {
      'HO.LD.001': covEOptions,
      'HO.LD.002': covFOptions,
      'HO.LD.003': allPerilDedOptions,
      'HO.LD.004': windHailOptions,
      'HO.LD.005': covCOptions,
      'HO.LD.006': waterBackupOptions,
    },
    formsThatAttach,
    violations,
  }
}

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
      label:            row.label,
      value:            row.value,
      constraintNote:   row.constraintNote,
      available:        reason === null,
      violationReason:  reason ?? undefined,
    }
  })
}
