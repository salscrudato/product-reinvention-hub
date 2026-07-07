// ProductSummaryDashboard — a premium, AI-generated overview of the product built ONLY
// from its loaded metadata (coverages, rules, rating, footprint) — never from form text.
// It calls summarizeProduct with a compact metadata snapshot and renders the structured
// result as a clean dashboard: headline + overview, at-a-glance highlight tiles, key
// coverage notes, and considerations. Cached per product for the session so it doesn't
// re-bill on every visit; a Regenerate button forces a fresh pass.
import { useEffect, useRef, useState } from 'react'
import { adapter } from '../../lib/backend'
import { useProductCtx } from '../../context/useProductCtx'
import { Skeleton } from '../ui'
import { IconSparkle, IconSpinner, IconRefresh, IconWarning } from '../ui/icons'
import type { Coverage, Rule, RatingProgram, Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

interface ProductSummary {
  headline: string
  overview: string
  highlights: { label: string; value: string }[]
  coverageHighlights: { name: string; note: string }[]
  considerations?: string[]
}

function buildMeta(product: WithId<Product>, coverages: WithId<Coverage>[], rules: WithId<Rule>[], ratingProgram: WithId<RatingProgram> | null) {
  return {
    name: product.name,
    lob: product.lob?.name,
    marketSegment: product.marketSegment,
    allStates: product.allStates,
    statesCount: product.allStates ? undefined : product.states?.length,
    coverages: coverages.map(c => ({
      name: c.name, requirement: c.requirement, rated: !!c.premiumGenerating,
      sub: !!c.parentId, forms: c.formNumbers ?? [],
      limit: c.terms?.find(t => t.kind === 'LIMIT')?.label,
    })),
    rules: rules.slice(0, 24).map(r => {
      const o = r as unknown as { condition?: string; outcome?: string; name?: string; description?: string }
      return { condition: o.condition ?? o.name ?? '', outcome: o.outcome ?? o.description ?? '' }
    }),
    rating: ratingProgram ? { steps: ratingProgram.steps?.length ?? 0, minimumPremium: ratingProgram.minimumPremium } : undefined,
  }
}

export function ProductSummaryDashboard() {
  const { pid, product, coverages, rules, ratingProgram } = useProductCtx()
  const [summary, setSummary] = useState<ProductSummary | null>(null)
  const [state, setState]     = useState<'idle' | 'loading' | 'error'>('idle')
  const requested = useRef<string | null>(null)

  async function generate(force = false) {
    if (!product) return
    const cacheKey = `pf.summary.${pid}`
    if (!force) {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) { try { setSummary(JSON.parse(cached) as ProductSummary); setState('idle'); return } catch { /* refetch */ } }
    }
    setState('loading')
    try {
      const meta = buildMeta(product, coverages, rules, ratingProgram)
      const res = await adapter.fns.call<{ product: ReturnType<typeof buildMeta> }, ProductSummary>('summarizeProduct', { product: meta })
      setSummary(res); setState('idle')
      try { sessionStorage.setItem(cacheKey, JSON.stringify(res)) } catch { /* quota — non-fatal */ }
    } catch {
      setState('error')
    }
  }

  // Generate once per product per session (cached). Regenerate is explicit.
  useEffect(() => {
    if (!product || requested.current === pid) return
    requested.current = pid
    void generate(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, product])

  return (
    <section className="rounded-[16px] overflow-hidden bg-surface" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--gradient-accent-soft)' }}>
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[9px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}>
            <IconSparkle size={16} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-text leading-tight">AI product summary</h2>
            <p className="text-[11px] text-faint">Generated from this product's metadata</p>
          </div>
        </div>
        <button onClick={() => void generate(true)} disabled={state === 'loading'}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[8px] text-[12px] font-medium text-accent hover:bg-accent-soft transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
          {state === 'loading' ? <IconSpinner size={13} className="animate-spin" aria-hidden="true" /> : <IconRefresh size={13} aria-hidden="true" />}
          {state === 'loading' ? 'Generating…' : 'Regenerate'}
        </button>
      </div>

      <div className="p-5">
        {state === 'loading' && !summary ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-[12px]" />)}</div>
          </div>
        ) : state === 'error' && !summary ? (
          <div className="flex items-center gap-2 text-sm text-dim">
            <IconWarning size={15} className="text-warn shrink-0" aria-hidden="true" />
            Couldn't generate the summary. <button onClick={() => void generate(true)} className="text-accent font-medium hover:underline">Try again</button>
          </div>
        ) : summary ? (
          <div className="flex flex-col gap-5">
            {/* Headline + overview */}
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[17px] font-bold text-text leading-snug">{summary.headline}</h3>
              <p className="text-sm text-dim leading-relaxed">{summary.overview}</p>
            </div>

            {/* Highlight tiles */}
            {summary.highlights?.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {summary.highlights.map((h, i) => (
                  <div key={i} className="rounded-[12px] bg-raised px-3 py-2.5" style={{ border: '1px solid var(--color-border)' }}>
                    <div className="text-[15px] font-bold text-text leading-tight tnum">{h.value}</div>
                    <div className="text-[11px] text-faint mt-0.5">{h.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Coverage highlights */}
            {summary.coverageHighlights?.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint">Key coverages</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {summary.coverageHighlights.map((c, i) => (
                    <div key={i} className="flex flex-col gap-0.5 rounded-[10px] px-3 py-2" style={{ border: '1px solid var(--color-border)' }}>
                      <span className="text-[13px] font-semibold text-text">{c.name}</span>
                      <span className="text-[12px] text-dim leading-snug">{c.note}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Considerations */}
            {summary.considerations && summary.considerations.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint">Considerations</span>
                <ul className="flex flex-col gap-1.5">
                  {summary.considerations.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-dim leading-relaxed">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: 'var(--color-accent)' }} aria-hidden="true" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <button onClick={() => void generate(true)} className="text-sm text-accent font-medium hover:underline">Generate AI summary</button>
        )}
      </div>
    </section>
  )
}
