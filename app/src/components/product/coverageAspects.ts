// coverageAspects — shared definitions for a coverage's six related aspects and a
// hook that derives their live counts from the canonical model. Kept separate from
// the card/row components so both consume one source of truth (and so those files
// only export components, keeping fast-refresh happy).
import { IconLimit, IconDeductible, IconStates, IconForm, IconPricing, IconRule } from '../ui/icons'
import { useProductCtx } from '../../context/useProductCtx'
import { resolveTermOptions } from '@pf/shared'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

export type CoverageAspect = 'limits' | 'deductibles' | 'states' | 'forms' | 'pricing' | 'rules'

export const COVERAGE_ASPECTS: { key: CoverageAspect; label: string; Icon: typeof IconLimit }[] = [
  { key: 'limits',      label: 'Limits',      Icon: IconLimit },
  { key: 'deductibles', label: 'Deductibles', Icon: IconDeductible },
  { key: 'states',      label: 'States',      Icon: IconStates },
  { key: 'forms',       label: 'Forms',       Icon: IconForm },
  { key: 'pricing',     label: 'Pricing',     Icon: IconPricing },
  { key: 'rules',       label: 'Rules',       Icon: IconRule },
]

/** Live per-aspect counts for a coverage, drawn from the product context. */
export function useCoverageCounts(cov: WithId<Coverage>): Record<CoverageAspect, number> {
  const { product, rules, ratingProgram, ldTables } = useProductCtx()
  const countOpts = (kind: 'LIMIT' | 'DEDUCTIBLE') =>
    (cov.terms ?? []).filter(t => t.kind === kind)
      .reduce((n, t) => n + resolveTermOptions(t, t.ldTableRef ? ldTables[t.ldTableRef] : undefined).filter(o => o.enabled).length, 0)
  const footprint = product?.allStates ? 50 : (product?.states?.length ?? 50)
  return {
    limits:      countOpts('LIMIT'),
    deductibles: countOpts('DEDUCTIBLE'),
    states:      cov.allStates ? footprint : (cov.states?.length ?? 0),
    forms:       cov.formNumbers?.length ?? 0,
    pricing:     cov.premiumGenerating ? (ratingProgram?.steps?.length ?? 0) : 0,
    rules:       rules.filter(r => cov.refId && r.coverageRefIds?.includes(cov.refId)).length,
  }
}
