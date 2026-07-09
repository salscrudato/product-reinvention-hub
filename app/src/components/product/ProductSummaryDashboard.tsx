// ProductSummaryDashboard — a premium, AI-generated overview of the product built ONLY
// from its loaded metadata (coverages, rules, rating, footprint) — never from form text.
// The grounded result is PERSISTED server-side (productSummaries/{pid}, written by the
// summarizeProduct callable via the Admin SDK), so the Overview tab hydrates it INSTANTLY
// on every visit — any device, any role — with no model call. It auto-generates once when
// no cached summary exists yet, and flags the summary as stale (with an emphasised
// Regenerate) when the product's metadata has changed since it was written.
import { useEffect, useMemo, useRef, useState } from 'react'
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

// The persisted shape (productSummaries/{pid}) — the summary plus provenance the UI shows.
interface StoredSummary extends ProductSummary {
  id: string
  productName?: string
  metaHash?: string | null
  basisFormNumber?: string | null
  generatedAt?: unknown
  model?: string
  // Set true by the server-side invalidation trigger (Part B) when a product-scoped entity
  // changes, so the summary is flagged stale even when the client-computed metaHash can't tell.
  stale?: boolean
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
    // The base coverage form (from create-time identify) grounds the summary.
    baseForm: product.baseForm
      ? { number: product.baseForm.formNumber, title: product.baseForm.title, edition: product.baseForm.edition }
      : undefined,
  }
}

// A cheap, order-stable djb2 hash — used as the summary's freshness signal.
function hashMeta(meta: unknown): string {
  const str = JSON.stringify(meta)
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// The product's ITEM COMPOSITION — the sorted set of coverage / rule / form identities.
// This is the summary's staleness signal: the cached summary is reused until the set
// changes (a new item is ADDED — or an existing one removed). Editing an existing item's
// fields, or a product field, does NOT change it, so the summary never churns on edits.
function compositionKeyOf(product: WithId<Product>, coverages: WithId<Coverage>[], rules: WithId<Rule>[]): string {
  const items = [
    ...coverages.map(c => `c:${c.refId ?? c.id}`),
    ...rules.map(r => `r:${r.refId ?? r.id}`),
    ...coverages.flatMap(c => (c.formNumbers ?? []).map(f => `f:${f}`)),
    ...(product.baseForm?.formNumber ? [`f:${product.baseForm.formNumber}`] : []),
  ]
  return hashMeta([...new Set(items)].sort())
}

function timeAgo(at: unknown): string {
  if (!at) return ''
  const ts = at instanceof Object && 'toDate' in (at as object) ? (at as { toDate(): Date }).toDate() : new Date(String(at))
  if (Number.isNaN(ts.getTime())) return ''
  const diff = Math.round((Date.now() - ts.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return ts.toLocaleDateString()
}

export function ProductSummaryDashboard() {
  const { pid, product, coverages, rules, ratingProgram } = useProductCtx()
  const [stored, setStored]   = useState<StoredSummary | null>(null)
  const [state, setState]     = useState<'idle' | 'loading' | 'error'>('idle')
  // Whether the cache doc has resolved at least once for this pid (so we don't auto-fire
  // a generation before we know whether one already exists).
  const [hydrated, setHydrated] = useState(false)
  const autoFired = useRef<string | null>(null)

  // The freshness signal is the item composition — NOT the full metadata — so the cached
  // summary is reused across edits and only flagged stale when an item is added/removed.
  const compositionKey = useMemo(
    () => (product ? compositionKeyOf(product, coverages, rules) : ''),
    [product, coverages, rules],
  )

  // Subscribe to the server-written cache — hydrates the summary instantly on every visit.
  useEffect(() => {
    setStored(null); setHydrated(false); setState('idle'); autoFired.current = null
    const unsub = adapter.db.subscribe<StoredSummary | null>(`productSummaries/${pid}`, (doc) => {
      setStored((doc as StoredSummary | null) ?? null)
      setHydrated(true)
    })
    return unsub
  }, [pid])

  async function generate() {
    if (!product) return
    setState('loading')
    try {
      const meta = buildMeta(product, coverages, rules, ratingProgram)
      // The callable persists to productSummaries/{pid}; the subscription then delivers the
      // fresh doc. We also optimistically reflect the result so it appears without a round-trip.
      const res = await adapter.fns.call<{ product: ReturnType<typeof buildMeta>; productId: string; metaHash: string }, ProductSummary>(
        'summarizeProduct', { product: meta, productId: pid, metaHash: compositionKey },
      )
      setStored(prev => ({ ...(prev ?? { id: pid }), ...res, metaHash: compositionKey, stale: false }))
      setState('idle')
    } catch {
      setState('error')
    }
  }

  // Auto-generate exactly once per product when no cached summary exists yet, so the
  // Overview lands populated rather than on an empty "Generate" prompt.
  useEffect(() => {
    if (!product || !hydrated || stored || state === 'loading') return
    if (autoFired.current === pid) return
    autoFired.current = pid
    void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, hydrated, stored, pid])

  const summary = stored
  // Stale only when the ITEM COMPOSITION changed (a new item added / one removed) — either the
  // stored composition key drifted, or the server flagged a newly-added item (Part B). Plain
  // edits to existing items or product fields never mark the cached summary stale.
  const isStale = !!(stored && ((stored.metaHash && compositionKey && stored.metaHash !== compositionKey) || stored.stale))
  const updated = timeAgo(stored?.generatedAt)

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
            {/* summarizeProduct reads the metadata snapshot, never the form PDF — so the
                label says "summarized from metadata". The base-form number chip is still
                surfaced (load-bearing) when we have one, plus a freshness timestamp. */}
            <p className="text-[11px] text-faint">
              {product?.baseForm?.formNumber
                ? <>Summarized from product metadata · base form <span className="font-mono text-dim">{product.baseForm.formNumber}</span></>
                : 'Summarized from product metadata'}
              {updated && <> · <span className="text-dim">updated {updated}</span></>}
            </p>
          </div>
        </div>
        <button onClick={() => void generate()} disabled={state === 'loading'}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[8px] text-[12px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
            isStale ? 'text-white' : 'text-accent hover:bg-accent-soft'}`}
          style={isStale ? { background: 'var(--gradient-accent)' } : undefined}>
          {state === 'loading'
            ? <IconSpinner size={13} className="animate-spin" aria-hidden="true" />
            : summary ? <IconRefresh size={13} aria-hidden="true" /> : <IconSparkle size={13} aria-hidden="true" />}
          {state === 'loading' ? 'Generating…' : summary ? 'Regenerate' : 'Generate summary'}
        </button>
      </div>

      {/* Stale banner — the product changed since this summary was written. */}
      {isStale && state !== 'loading' && (
        <div className="flex items-center gap-2 px-5 py-2 text-[12px] text-warn" style={{ background: 'color-mix(in srgb, var(--color-warn) 8%, transparent)', borderBottom: '1px solid var(--color-border)' }}>
          <IconWarning size={13} className="shrink-0" aria-hidden="true" />
          The product's items have changed since this summary was generated. Regenerate for the latest.
        </div>
      )}

      <div className="p-5">
        {state === 'loading' && !summary ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-[12px]" />)}</div>
          </div>
        ) : state === 'error' && !summary ? (
          <div className="flex items-center gap-2 text-sm text-dim">
            <IconWarning size={15} className="text-warn shrink-0" aria-hidden="true" />
            Couldn't generate the summary. <button onClick={() => void generate()} className="text-accent font-medium hover:underline">Try again</button>
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
          <button onClick={() => void generate()} className="text-sm text-accent font-medium hover:underline">Generate AI summary</button>
        )}
      </div>
    </section>
  )
}
