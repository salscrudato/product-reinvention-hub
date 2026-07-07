// PortfolioMetrics — the portfolio cockpit's right-rail dashboard: the handful of
// product-level KPIs a P&C leader actually watches. Values are illustrative stubs
// (there is no live financials integration yet) but shaped and coloured like the real
// thing: PIF, written premium + growth, loss ratio, combined ratio, and quote-to-bind
// with a conversion bar. Sleek, token-driven, with tiny inline sparklines. When a real
// financials feed lands, swap the STUB constants for adapter reads — the layout holds.
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'
import { IconSparkle, IconArrowUp } from '../ui/icons'

type Trend = 'good' | 'bad' | 'flat'
interface Metric {
  label: string
  value: string
  delta: string
  trend: Trend            // is the delta a good or bad move (colour only)
  spark: number[]
}

const trendColor: Record<Trend, string> = {
  good: 'var(--color-good)', bad: 'var(--color-danger)', flat: 'var(--color-faint)',
}

// Illustrative KPI set — deterministic so the rail is stable across renders.
const METRICS: Metric[] = [
  { label: 'Policies in force', value: '48,213', delta: '+3.2%',  trend: 'good', spark: [38, 40, 39, 43, 45, 46, 48] },
  { label: 'Written premium',   value: '$62.4M', delta: '+8.1%',  trend: 'good', spark: [48, 51, 53, 55, 57, 60, 62] },
  { label: 'Loss ratio',        value: '61.4%',  delta: '−1.8 pt', trend: 'good', spark: [66, 65, 64, 64, 63, 62, 61] },
  { label: 'Combined ratio',    value: '94.2%',  delta: '−0.9 pt', trend: 'good', spark: [97, 96, 96, 95, 95, 95, 94] },
]

const QUOTE_TO_BIND = 0.382   // 38.2% conversion (stub)

function Spark({ points, color }: { points: number[]; color: string }) {
  const w = 60, h = 18
  const min = Math.min(...points), max = Math.max(...points)
  const rng = max - min || 1
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((p - min) / rng) * h).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" aria-hidden="true" className="shrink-0">
      <path d={d} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MetricTile({ m }: { m: Metric }) {
  const c = trendColor[m.trend]
  const down = m.delta.trim().startsWith('−') || m.delta.trim().startsWith('-')
  return (
    <div className="rounded-[12px] bg-raised p-3 flex flex-col gap-1.5 transition-shadow hover:shadow-[var(--shadow-card)]"
      style={{ border: '1px solid var(--color-border)' }}>
      <span className="text-[10.5px] font-medium uppercase tracking-[.05em] text-faint">{m.label}</span>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[18px] font-bold text-text tnum leading-none">{m.value}</span>
        <Spark points={m.spark} color={c} />
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] font-medium tnum" style={{ color: c }}>
        <IconArrowUp size={11} className={down ? 'rotate-180' : ''} aria-hidden="true" />
        {m.delta}
      </span>
    </div>
  )
}

export function PortfolioMetrics({ products }: { products: WithId<Product>[] }) {
  const live = products.filter(p => p.lifecycle === 'LAUNCHED').length
  const bindPct = Math.round(QUOTE_TO_BIND * 1000) / 10

  return (
    <section className="bg-surface rounded-[16px] overflow-hidden" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      aria-label="Portfolio metrics">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--gradient-accent-soft)' }}>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-[8px] flex items-center justify-center text-white" style={{ background: 'var(--gradient-accent)' }}>
            <IconSparkle size={13} aria-hidden="true" />
          </span>
          <h2 className="text-sm font-semibold text-text">Portfolio metrics</h2>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-wide text-faint px-1.5 py-0.5 rounded-[5px] bg-surface" style={{ border: '1px solid var(--color-border)' }}>
          {live} live
        </span>
      </div>

      <div className="p-3 flex flex-col gap-2.5">
        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-2.5">
          {METRICS.map(m => <MetricTile key={m.label} m={m} />)}
        </div>

        {/* Quote-to-bind conversion */}
        <div className="rounded-[12px] bg-raised p-3 flex flex-col gap-2" style={{ border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-medium uppercase tracking-[.05em] text-faint">Quote → bind</span>
            <span className="text-[13px] font-bold text-text tnum">{bindPct}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
            <div className="h-full rounded-full" style={{ width: `${bindPct}%`, background: 'var(--gradient-accent)' }} />
          </div>
        </div>

        {/* Financials integration — the "coming soon" hook */}
        <div className="flex items-center gap-2 text-[11px] text-faint px-1 pt-0.5">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-warn)' }} aria-hidden="true" />
          Financials integration — illustrative data, live feed pending
        </div>
      </div>
    </section>
  )
}
