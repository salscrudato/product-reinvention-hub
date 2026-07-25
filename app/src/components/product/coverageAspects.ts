// coverageAspects — shared definitions for a coverage's six related aspects and a
// hook that derives their live counts from the canonical model. Kept separate from
// the card/row components so both consume one source of truth (and so those files
// only export components, keeping fast-refresh happy).
import { IconLimit, IconDeductible, IconStates, IconForm, IconPricing, IconRule, IconCheckSquare } from '../ui/icons'
import { useProductCtx } from '../../context/useProductCtx'
import { resolveTermOptions, resolveLob } from '@pf/shared'
import { linkCoverageToPricing } from '../../lib/insurance/pricingLinks'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

export type CoverageAspect = 'limits' | 'deductibles' | 'options' | 'states' | 'forms' | 'pricing' | 'rules'

export const COVERAGE_ASPECTS: { key: CoverageAspect; label: string; Icon: typeof IconLimit }[] = [
  { key: 'limits',      label: 'Limits',      Icon: IconLimit },
  { key: 'deductibles', label: 'Deductibles', Icon: IconDeductible },
  { key: 'options',     label: 'Options',     Icon: IconCheckSquare },
  { key: 'states',      label: 'States',      Icon: IconStates },
  { key: 'forms',       label: 'Forms',       Icon: IconForm },
  { key: 'pricing',     label: 'Pricing',     Icon: IconPricing },
  { key: 'rules',       label: 'Rules',       Icon: IconRule },
]

/** Live per-aspect counts for a coverage, drawn from the product context.
 *  When `filterStates` is non-empty, every state-dimensioned aspect (limits,
 *  deductibles, options, states, forms and rules) is counted only for the children
 *  that apply to at least one of those states — mirroring the page's state-facet
 *  filter so a single selected state cascades into what each coverage card reports.
 *  An `allStates` child always qualifies; an unfiltered call is byte-identical to
 *  the pre-cascade counts (the predicate is a no-op when no state is selected). */
export function useCoverageCounts(cov: WithId<Coverage>, filterStates: string[] = []): Record<CoverageAspect, number> {
  const { product, rules, ratingProgram, ldTables, rtTables, forms } = useProductCtx()
  const lob = resolveLob(product)

  // Product footprint used as the denominator for coverage state counts. When the
  // product is marked `allStates`, the line's standard footprint is the baseline;
  // otherwise we honour the stored product states, clipped to that footprint.
  const productFootprintStates = (product?.allStates
    ? (product?.states?.length ? product.states : lob.footprintStates)
    : (product?.states ?? lob.footprintStates)
  ).filter(st => lob.footprintStates.includes(st))

  const coverageStates = cov.allStates
    ? productFootprintStates
    : (cov.states ?? []).filter(st => productFootprintStates.includes(st))

  const stateFilterSet = new Set(filterStates)
  const filterActive = stateFilterSet.size > 0
  // A state-scoped child matches when no filter is active, when it applies to every
  // state, or when at least one of its states is selected. `states` is defended
  // against a missing array so legacy/partial records never throw.
  const matchesState = (scope: { allStates?: boolean; states?: string[] }) =>
    !filterActive || scope.allStates === true || (scope.states ?? []).some(s => stateFilterSet.has(s))

  const countOpts = (kind: 'LIMIT' | 'DEDUCTIBLE') =>
    (cov.terms ?? []).filter(t => t.kind === kind)
      .reduce((n, t) => {
        const opts = resolveTermOptions(t, t.ldTableRef ? ldTables[t.ldTableRef] : undefined).filter(o => o.enabled)
        return n + opts.filter(matchesState).length
      }, 0)

  // Elective OPTION terms: enabled selectable values narrowed by the state filter, or
  // 1 for a bare yes/no election flag (no values) — which applies at the coverage's own
  // scope and so is counted whenever the coverage card itself is in view.
  const optionsCount = (cov.terms ?? []).filter(t => t.kind === 'OPTION')
    .reduce((n, t) => {
      const opts = resolveTermOptions(t, t.ldTableRef ? ldTables[t.ldTableRef] : undefined).filter(o => o.enabled)
      return n + (opts.length === 0 ? 1 : opts.filter(matchesState).length)
    }, 0)

  // Forms scoped to this coverage (matched by form number). A form number that does not
  // resolve to a loaded form entity is kept — the count never hides data whose state
  // scope we cannot verify (flag-not-invent). Unfiltered, this equals formNumbers.length.
  const formByNumber = new Map(forms.map(f => [f.number, f]))
  const formsCount = (cov.formNumbers ?? []).reduce((n, num) => {
    const f = formByNumber.get(num)
    return n + (!f || matchesState(f) ? 1 : 0)
  }, 0)

  return {
    limits:      countOpts('LIMIT'),
    deductibles: countOpts('DEDUCTIBLE'),
    options:     optionsCount,
    states:      filterActive ? coverageStates.filter(s => stateFilterSet.has(s)).length : coverageStates.length,
    forms:       formsCount,
    // Real linkage — the rating steps that actually reference this coverage, not the
    // whole program. Non-rated coverages contribute nothing. Pricing has no state scope
    // of its own, so the state filter does not narrow it.
    pricing:     cov.premiumGenerating ? linkCoverageToPricing(cov, ratingProgram, rtTables, ldTables).steps.length : 0,
    rules:       rules.filter(r => cov.refId && r.coverageRefIds?.includes(cov.refId) && matchesState(r)).length,
  }
}
