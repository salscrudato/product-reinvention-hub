// ProductCard — portfolio grid card. A subtle brand gradient rail flows across the
// top; the refId reads as a chip; a small health dot replaces the old score badge.
import { StatusPill, LifecyclePill, Badge, RefChip } from '../ui'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

export function ProductCard({ p, onClick }: { p: WithId<Product>; onClick: () => void }) {
  const health = p.health?.score ?? 100
  const healthColor = health >= 80 ? 'var(--color-good)' : health >= 60 ? 'var(--color-warn)' : 'var(--color-danger)'
  const findings = p.health?.findingCount ?? 0

  return (
    <button
      onClick={onClick}
      aria-label={`Open ${p.name}`}
      className="group relative bg-surface rounded-[16px] overflow-hidden text-left flex flex-col hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* Brand rail — subtle gradient flowing left→right, brightening on hover */}
      <span aria-hidden="true" className="block h-[3px] w-full opacity-70 group-hover:opacity-100 transition-opacity"
        style={{ background: 'linear-gradient(90deg, var(--color-accent-bright) 0%, var(--color-accent-strong) 55%, transparent 100%)' }} />

      <div className="p-5 flex flex-col gap-3.5 flex-1">
        <div className="flex flex-col gap-2">
          <span className="font-semibold text-[15px] text-text leading-snug group-hover:text-accent transition-colors">{p.name}</span>
          {p.refId && <span><RefChip id={p.refId} /></span>}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusPill status={p.status} />
          <LifecyclePill lifecycle={p.lifecycle} />
          {p.lob?.name && <Badge label={p.lob.name} color="blue" />}
        </div>

        <div className="flex items-center gap-3 text-xs text-dim pt-3 mt-auto" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="tnum">{p.states?.length ?? 0} states</span>
          <span className="truncate">{p.marketSegment ?? '—'}</span>
          <span className="ml-auto flex items-center gap-1.5" title={`Health ${health}${findings ? ` · ${findings} finding${findings === 1 ? '' : 's'}` : ''}`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: healthColor }} />
            <span className="truncate max-w-[90px]">{p.owner?.name ?? '—'}</span>
          </span>
        </div>
      </div>
    </button>
  )
}
