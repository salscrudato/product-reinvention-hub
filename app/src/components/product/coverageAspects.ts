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

/** Live per-aspect counts for a coverage, drawn from the product context. */
export function useCoverageCounts(cov: WithId<Coverage>): Record<CoverageAspect, number> {
  const { product, rules, ratingProgram, ldTables, rtTables } = useProductCtx()
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

  const countOpts = (kind: 'LIMIT' | 'DEDUCTIBLE') =>
    (cov.terms ?? []).filter(t => t.kind === kind)
      .reduce((n, t) => n + resolveTermOptions(t, t.ldTableRef ? ldTables[t.ldTableRef] : undefined).filter(o => o.enabled).length, 0)

  // Elective OPTION terms: enabled selectable values, or 1 for a yes/no election flag.
  const optionsCount = (cov.terms ?? []).filter(t => t.kind === 'OPTION')
    .reduce((n, t) => n + (resolveTermOptions(t, t.ldTableRef ? ldTables[t.ldTableRef] : undefined).filter(o => o.enabled).length || 1), 0)

  return {
    limits:      countOpts('LIMIT'),
    deductibles: countOpts('DEDUCTIBLE'),
    options:     optionsCount,
    states:      coverageStates.length,
    forms:       cov.formNumbers?.length ?? 0,
    // Real linkage — the rating steps that actually reference this coverage, not the
    // whole program. Non-rated coverages contribute nothing.
    pricing:     cov.premiumGenerating ? linkCoverageToPricing(cov, ratingProgram, rtTables, ldTables).steps.length : 0,
    rules:       rules.filter(r => cov.refId && r.coverageRefIds?.includes(cov.refId)).length,
  }
}
