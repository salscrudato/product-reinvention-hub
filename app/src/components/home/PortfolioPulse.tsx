// PortfolioPulse — the Home cockpit's analytics panel: a single grounded read on the
// health and shape of the whole portfolio. Four honest, real-data views, no fabrication:
//   • Readiness gauge — the mean stored product.health.score, coloured by band.
//   • Lifecycle mix   — products by lifecycle (DRAFT→IN_REVIEW→APPROVED→LAUNCHED),
//     using the same lifecycle colours as LifecyclePill so the whole app reads as one.
//   • Composition     — live counts of products / coverages / rules / forms from the
//     search index (the same index ⌘K and citations use).
//   • Change activity — a 14-day sparkline of edits from the append-only version log.
// Everything is derived from data already subscribed on Home; colour is token-only.
import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconActivity, IconArrowRight, IconWarning, IconCheckCircle } from '../ui/icons'
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

/** Health band → status colour + label + icon. A status colour always ships with a
 *  label (never colour alone), per the accessibility rule for status encodings. */
function healthBand(score: number): { color: string; label: string; Icon: typeof IconCheckCircle } {
  if (score >= 90) return { color: 'var(--color-good)',   label: 'Strong',  Icon: IconCheckCircle }
  if (score >= 70) return { color: 'var(--color-warn)',   label: 'Watch',   Icon: IconWarning }
  return { color: 'var(--color-danger)', label: 'At risk', Icon: IconWarning }
}

// ─── Readiness gauge (SVG donut) ────────────────────────────────────────────────

function HealthRing({ score, color }: { score: number; color: string }) {
  const r = 34
  const C = 2 * Math.PI * r
  const dash = (Math.max(0, Math.min(100, score)) / 100) * C
  return (
    <div className="relative shrink-0" style={{ width: 84, height: 84 }}>
      <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90" aria-hidden="true">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--color-raised)" strokeWidth="8" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${dash} ${C - dash}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[22px] font-bold tabular-nums text-text leading-none">{score}</span>
        <span className="text-[9px] text-faint uppercase tracking-wide mt-0.5">health</span>
      </div>
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function PortfolioPulse({ status, products, versions, index, now }: Props) {
  const navigate = useNavigate()

  const model = useMemo(() => {
    const scored = products.map(p => p.health?.score).filter((s): s is number => typeof s === 'number')
    const avgHealth = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 100

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
    return { avgHealth, lifecycle, buckets, changeTotal: buckets.reduce((a, b) => a + b, 0), countType }
  }, [products, versions, index, now])

  const band = healthBand(model.avgHealth)
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
        <p className="text-xs text-dim py-4 text-center">No products yet. Portfolio health, mix and activity will appear here.</p>
      ) : (
        <>
          {/* Readiness gauge */}
          <div className="flex items-center gap-4" aria-label={`Portfolio health ${model.avgHealth} of 100 — ${band.label}`}>
            <HealthRing score={model.avgHealth} color={band.color} />
            <div className="flex flex-col gap-1 min-w-0">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: band.color }}>
                <band.Icon size={14} aria-hidden="true" />{band.label}
              </span>
              <span className="text-xs text-dim">Mean readiness across {products.length} product{products.length !== 1 ? 's' : ''}</span>
              <span className="text-[11px] text-faint">Sourced from each product's stored health score</span>
            </div>
          </div>

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
