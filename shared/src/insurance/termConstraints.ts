// termConstraints.ts — the single source of truth for premium-editor validation of
// the typed terms model. Two layers, both pure so the app editor (live UI + a hard
// pre-save gate) and the mutate() seam (a structural assert) share one implementation:
//
//   1. Intrinsic invariants that hold for EVERY line — exactly one enabled option is
//      the default, each option's applicability ⊆ the coverage's state scope, and
//      each value is well-formed for its type / within [min,max].
//   2. The Homeowners demonstrative cross-coverage constraints — Coverage F $5,000
//      requires Coverage E ≥ $300,000, and a wind/hail % deductible must be ≥ the
//      all-peril deductible in dollar terms. These are line-specific and resolve
//      through the LOB registry exactly like the rules engine, so Personal Auto (and any
//      other line) is left untouched.
import type { Coverage, CoverageTerm, LDTable } from '../types'
import { resolveLob } from './lobRegistry'
import { resolveTermOptions, formatOption } from './terms'

export type TermIssueSeverity = 'error' | 'warning'

/** One validation finding, addressable to a term (and optionally a single option) so
 *  the editor can highlight the exact row. `code` is a stable machine key; `message`
 *  is PM-facing copy. */
export interface TermIssue {
  termId:    string
  termLabel: string
  optionId?: string
  severity:  TermIssueSeverity
  code:      string
  message:   string
}

/** The state scope an option's applicability must fall within. `null` means "no
 *  restriction" (the coverage is all-states and the caller can't enumerate the
 *  footprint) — emptiness is still flagged, but membership is not. */
export type TermScope = string[] | null

const money = (n: number) => `$${Math.round(n).toLocaleString()}`

/** The distinct numeric values a term currently OFFERS (enabled, non-split/waiting),
 *  resolving the rich optionSet when present and falling back to the legacy fields +
 *  LD table so seeded content is measured too. */
function offeredNumbers(term: CoverageTerm, ldTables?: Record<string, LDTable>): number[] {
  const opts = resolveTermOptions(term, term.ldTableRef ? ldTables?.[term.ldTableRef] : undefined)
  return opts
    .filter(o => o.enabled && o.type !== 'SPLIT' && o.type !== 'WAITING_PERIOD')
    .map(o => o.value)
}

const nameIsCoverage = (name: string, letter: string) =>
  new RegExp(`coverage\\s*${letter}\\b`, 'i').test(name)

// ─── Layer 1: intrinsic invariants (line-agnostic) ────────────────────────────

/** Validate one term's optionSet against the intrinsic typed-model invariants. A term
 *  with no options (e.g. a yes/no OPTION flag) has nothing to check here. */
export function validateTerm(term: CoverageTerm, scope: TermScope): TermIssue[] {
  const issues: TermIssue[] = []
  const opts = term.optionSet ?? []
  if (!opts.length) return issues

  const at = (code: string, severity: TermIssueSeverity, message: string, optionId?: string): void => {
    issues.push({ termId: term.id, termLabel: term.label, optionId, severity, code, message })
  }

  // Exactly one enabled option is the default.
  const enabled = opts.filter(o => o.enabled)
  if (enabled.length === 0) {
    at('none-enabled', 'warning', 'No options are enabled — this term offers nothing.')
  } else {
    const defaults = enabled.filter(o => o.isDefault)
    if (defaults.length === 0) at('no-default', 'error', 'Mark one option as the default.')
    else if (defaults.length > 1) at('multi-default', 'error', `Only one option can be the default (found ${defaults.length}).`)
  }

  // Per-option applicability + value integrity.
  for (const o of opts) {
    if (!o.allStates) {
      if (o.states.length === 0) {
        at('no-states', 'error', `"${formatOption(o)}" has no states selected — pick states or choose all.`, o.id)
      } else if (scope) {
        const outside = o.states.filter(s => !scope.includes(s))
        if (outside.length) {
          at('states-scope', 'error', `"${formatOption(o)}" applies outside the coverage's states: ${outside.join(', ')}.`, o.id)
        }
      }
    }

    switch (o.type) {
      case 'PERCENT':
        if (!(o.value > 0 && o.value <= 100)) at('pct-range', 'error', `"${formatOption(o)}" — percentage must be 1–100.`, o.id)
        break
      case 'WAITING_PERIOD':
        if (!(o.value > 0)) at('waiting', 'error', 'Waiting period must be greater than zero.', o.id)
        break
      case 'SPLIT':
        if (!o.parts || o.parts.length < 2 || o.parts.some(p => !(p > 0)))
          at('split', 'warning', 'A split limit needs at least two positive parts.', o.id)
        break
      default: // FLAT | CSL | SCHEDULED
        if (!(o.value >= 0)) at('negative', 'error', 'Value cannot be negative.', o.id)
        else {
          if (term.min !== undefined && o.value < term.min) at('range-min', 'error', `"${formatOption(o)}" is below the minimum (${money(term.min)}).`, o.id)
          if (term.max !== undefined && o.value > term.max) at('range-max', 'error', `"${formatOption(o)}" is above the maximum (${money(term.max)}).`, o.id)
        }
    }
  }

  return issues
}

/** Validate every term on a coverage against the intrinsic invariants. */
export function validateCoverageIntrinsic(
  coverage: Pick<Coverage, 'terms'>,
  scope: TermScope,
): TermIssue[] {
  return (coverage.terms ?? []).flatMap(t => validateTerm(t, scope))
}

// ─── Layer 2: Homeowners demonstrative cross-coverage constraints ──────────────

/** The Homeowners demonstratives for the coverage being edited, measured against its
 *  sibling coverages. No-op for any non-HO line. Requires the full coverage set +
 *  product because the constraints reach across coverages (Coverage E, Coverage A). */
export function validateHoDemonstratives(
  coverage: Coverage & { id?: string },
  allCoverages: Coverage[],
  product: Parameters<typeof resolveLob>[0],
  ldTables?: Record<string, LDTable>,
): TermIssue[] {
  if (resolveLob(product).prefix !== 'PH') return []
  const issues: TermIssue[] = []

  for (const term of coverage.terms ?? []) {
    const isCovF = term.kind === 'LIMIT' && (term.ldTableRef === 'PH.LD.002' || nameIsCoverage(coverage.name, 'F'))
    const isWindHail = term.kind === 'DEDUCTIBLE' &&
      (term.ldTableRef === 'PH.LD.004' || /wind|hail/i.test(`${term.label} ${coverage.name}`))

    // [PH.RU.006] Coverage F $5,000 requires Coverage E ≥ $300,000.
    if (isCovF) {
      const covE = allCoverages.find(c =>
        (c.terms ?? []).some(t => t.kind === 'LIMIT' && t.ldTableRef === 'PH.LD.001') || nameIsCoverage(c.name, 'E'))
      const covEMax = covE
        ? Math.max(0, ...(covE.terms ?? []).filter(t => t.kind === 'LIMIT').flatMap(t => offeredNumbers(t, ldTables)))
        : 0
      const highOptions = (term.optionSet ?? []).filter(o => o.enabled && o.type !== 'SPLIT' && o.value >= 5000)
      if (highOptions.length && (!covE || covEMax < 300000)) {
        for (const o of highOptions) {
          issues.push({
            termId: term.id, termLabel: term.label, optionId: o.id, severity: 'error', code: 'covF-requires-covE',
            message: covE
              ? `Coverage F ${formatOption(o)} requires Coverage E ≥ $300,000 (Coverage E currently offers up to ${money(covEMax)}).`
              : `Coverage F ${formatOption(o)} requires Coverage E ≥ $300,000, but no Coverage E was found.`,
          })
        }
      }
    }

    // [HO.RU.008] Wind/hail % deductible must be ≥ the all-peril deductible in dollars.
    if (isWindHail) {
      // Reference Coverage A = the smallest dwelling limit the product offers (worst
      // case: if the % clears the smallest home, it clears every home).
      const covA = allCoverages.find(c => nameIsCoverage(c.name, 'A') || /\.COV\.001$/.test(c.refId ?? ''))
      const covAMins = covA
        ? (covA.terms ?? []).filter(t => t.kind === 'LIMIT').flatMap(t => offeredNumbers(t, ldTables))
        : []
      const refCovA = covAMins.length ? Math.min(...covAMins) : 0

      // Reference all-peril deductible = the largest flat deductible offered on this
      // coverage, else anywhere in the product.
      const allPerilTerms = [coverage, ...allCoverages].flatMap(c => (c.terms ?? []).filter(t =>
        t.kind === 'DEDUCTIBLE' && t.id !== term.id &&
        (t.ldTableRef === 'PH.LD.003' || /all.?peril|aop/i.test(t.label))))
      const allPerilMax = allPerilTerms.length
        ? Math.max(0, ...allPerilTerms.flatMap(t => offeredNumbers(t, ldTables)))
        : undefined

      if (refCovA > 0 && allPerilMax !== undefined && allPerilMax > 0) {
        for (const o of (term.optionSet ?? []).filter(op => op.enabled && op.type === 'PERCENT')) {
          const dollar = (o.value / 100) * refCovA
          if (dollar < allPerilMax) {
            issues.push({
              termId: term.id, termLabel: term.label, optionId: o.id, severity: 'error', code: 'windHail-lt-allPeril',
              message: `${o.value}% of ${money(refCovA)} = ${money(dollar)} is below the all-peril deductible (${money(allPerilMax)}).`,
            })
          }
        }
      }
    }
  }

  return issues
}

/** Full editor-side validation: intrinsic invariants + HO demonstratives. */
export function validateCoverageTerms(
  coverage: Coverage & { id?: string },
  allCoverages: Coverage[],
  product: Parameters<typeof resolveLob>[0],
  ldTables: Record<string, LDTable> | undefined,
  scope: TermScope,
): TermIssue[] {
  return [
    ...validateCoverageIntrinsic(coverage, scope),
    ...validateHoDemonstratives(coverage, allCoverages, product, ldTables),
  ]
}

// ─── Mutation-seam assert (structural invariants only) ─────────────────────────

// The invariants provable from a single coverage document, with no sibling context.
const STRUCTURAL_CODES = new Set(['multi-default', 'no-default', 'no-states', 'states-scope'])

/** Throw if a coverage's terms violate the structural invariants (exactly-one-default,
 *  option-states ⊆ coverage scope). Called inside mutate() for every coverage term
 *  write so no path — present or future — can persist a corrupt option matrix. Cross-
 *  coverage demonstratives can't be proven from one document, so they stay gated in
 *  the editor before the write. */
export function assertCoverageTermsValid(
  coverage: { allStates?: boolean; states?: string[]; terms?: CoverageTerm[] },
): void {
  const scope: TermScope = coverage.allStates ? null : (coverage.states ?? [])
  const blocking = (coverage.terms ?? [])
    .flatMap(t => validateTerm(t, scope))
    .filter(i => i.severity === 'error' && STRUCTURAL_CODES.has(i.code))
  if (blocking.length) {
    throw new Error(`Invalid coverage terms — ${blocking[0].message}`)
  }
}
