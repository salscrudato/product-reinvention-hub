// PortfolioPulse — the Home cockpit's analytics panel: a single grounded read on the
// shape of the whole portfolio. Three honest, real-data views, no fabrication:
//   • Lifecycle mix   — products by lifecycle (DRAFT→IN_REVIEW→APPROVED→LAUNCHED),
//     using the same lifecycle colours as LifecyclePill so the whole app reads as one.
//   • Composition     — live counts of products / coverages / rules / forms from the
//     search index (the same index ⌘K and citations use).
//   • Change activity — a 14-day sparkline of edits from the append-only version log.
// Everything is derived from data already subscribed on Home; colour is token-only.
import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconActivity, IconArrowRight, IconWarning } from '../ui/icons'
import { toMillis } from '../../lib/homePriorities'
import type { LoadStatus } from '../../lib/useLiveCollection'
import type { Product, Version, SearchIndexEntry, Lifecycle, SearchEntityType } from '@pf/shared'

type ProductDoc = Product & { id: string }
type VersionDoc = Version & { id: string }

interface Props {
  status:   LoadStatus
  products: ProductDoc[]
  versions: VersionDoc[]
  index:    SearchIndexEntry[]
  now:      number
}

// Lifecycle presentation — fixed order (the filing progression), colours matched to
// LifecyclePill (Badge.tsx) so a lifecycle reads the same everywhere in the app.
const LIFECYCLE: { key: Lifecycle; label: string; color: string }[] = [
  { key: 'DRAFT',     label: 'Draft',     color: 'var(--color-faint)' },
  { key: 'IN_REVIEW', label: 'In review', color: 'var(--color-warn)' },
  { key: 'APPROVED',  label: 'Approved',  color: 'var(--color-accent)' },
  { key: 'LAUNCHED',  label: 'Launched',  color: 'var(--color-good)' },
]

const DAY = 86_400_000

// ─── Panel ────────────────────────────────────────────────────────────────────

export function PortfolioPulse({ status, products, versions, index, now }: Props) {
  const navigate = useNavigate()

  const model = useMemo(() => {
    const lifecycle = LIFECYCLE.map(l => ({ ...l, count: products.filter(p => p.lifecycle === l.key).length }))
      .filter(l => l.count > 0)

    const countType = (t: SearchEntityType) => index.filter(e => e.type === t).length

    // 14-day change activity from the version log. Bucket by local day; today is the
    // last bar. Sums only what's loaded (the recent log) — nothing is invented.
    const start = new Date(now); start.setHours(0, 0, 0, 0)
    const t0 = start.getTime()
    const buckets = new Array(14).fill(0) as number[]
    for (const v of versions) {
      const ms = toMillis(v.at)
      if (ms == null) continue
      const idx = Math.floor((ms - t0) / DAY) + 13
      if (idx >= 0 && idx < 14) buckets[idx]!++
    }
    return { lifecycle, buckets, changeTotal: buckets.reduce((a, b) => a + b, 0), countType }
  }, [products, versions, index, now])

  const kpis: { label: string; value: number; route: string }[] = [
    { label: 'Products',  value: products.length,          route: '/app/products' },
    { label: 'Coverages', value: model.countType('coverage'), route: '/app/explorer' },
    { label: 'Rules',     value: model.countType('rule'),     route: '/app/explorer' },
    { label: 'Forms',     value: model.countType('form'),     route: '/app/explorer' },
  ]
  const maxBar = Math.max(1, ...model.buckets)

  return (
    <section aria-labelledby="rail-pulse" aria-busy={status === 'loading'}
      className="bg-surface rounded-[14px] p-4 flex flex-col gap-4"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 id="rail-pulse" className="flex items-center gap-2 text-sm font-semibold text-text">
          <IconActivity size={15} className="text-accent" aria-hidden="true" /> Portfolio pulse
        </h2>
        <button onClick={() => navigate('/app/explorer')}
          className="inline-flex items-center gap-1 text-xs text-dim hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
          Explore <IconArrowRight size={12} aria-hidden="true" />
        </button>
      </div>

      {status === 'loading' ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map(i => <div key={i} className="h-14 rounded-[10px] bg-raised animate-pulse" />)}
        </div>
      ) : status === 'error' ? (
        <div className="flex items-center gap-2 text-xs text-danger py-3">
          <IconWarning size={14} aria-hidden="true" /> Couldn't load the portfolio. Refresh to try again.
        </div>
      ) : products.length === 0 ? (
        <p className="text-xs text-dim py-4 text-center">No products yet. Portfolio mix and activity will appear here.</p>
      ) : (
        <>
          {/* Lifecycle mix */}
          <Block title="Lifecycle mix">
            <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px]" role="img"
              aria-label={model.lifecycle.map(l => `${l.count} ${l.label}`).join(', ')}>
              {model.lifecycle.map(l => (
                <span key={l.key} style={{ flexGrow: l.count, background: l.color }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {model.lifecycle.map(l => (
                <span key={l.key} className="inline-flex items-center gap-1.5 text-[11px] text-dim">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: l.color }} aria-hidden="true" />
                  {l.label} <span className="tabular-nums text-text font-medium">{l.count}</span>
                </span>
              ))}
            </div>
          </Block>

          {/* Composition KPIs */}
          <div className="grid grid-cols-4 gap-1.5">
            {kpis.map(k => (
              <button key={k.label} onClick={() => navigate(k.route)}
                className="flex flex-col items-start gap-0.5 rounded-[10px] px-2.5 py-2 bg-raised hover:bg-accent-soft transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <span className="text-lg font-bold tabular-nums text-text leading-none">{k.value}</span>
                <span className="text-[10px] text-faint">{k.label}</span>
              </button>
            ))}
          </div>

          {/* Change activity — 14-day sparkline from the version log */}
          <Block title="Change activity" trailing={<span className="text-[11px] text-faint">{model.changeTotal} in 14 days</span>}>
            <div className="flex items-end gap-[2px] h-10" role="img" aria-label={`${model.changeTotal} changes over the last 14 days`}>
              {model.buckets.map((n, i) => {
                const dayMs = now - (13 - i) * DAY
                const when  = i === 13 ? 'Today' : new Date(dayMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                return (
                  <div key={i} className="flex-1 rounded-t-[3px]" title={`${when}: ${n} change${n !== 1 ? 's' : ''}`}
                    style={{ height: `${Math.max(6, (n / maxBar) * 100)}%`, background: n > 0 ? 'var(--color-accent)' : 'var(--color-border)' }} />
                )
              })}
            </div>
          </Block>
        </>
      )}
    </section>
  )
}

function Block({ title, trailing, children }: { title: string; trailing?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint">{title}</span>
        {trailing}
      </div>
      {children}
    </div>
  )
}
