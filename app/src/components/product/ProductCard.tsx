// ProductCard — the portfolio card. A brand rail flows across the top; the product
// reads as name + refId + governance chips, then a row of domain "quick-nav" tiles
// (Coverages · Pricing · Forms · States · Rules) that jump straight into that part
// of the product — the frictionless deep-links a PM reaches for. Footer carries the
// at-a-glance facts and an AI summary affordance. No nested interactive elements:
// the container is a div; each region is its own button.
import { useNavigate } from 'react-router-dom'
import { StatusPill, LifecyclePill, Badge, RefChip } from '../ui'
import { IconCoverage, IconPricing, IconForm, IconStates, IconRule, IconSparkle, IconChevronRight } from '../ui/icons'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const TILES = [
  { key: 'coverages', label: 'Coverages', Icon: IconCoverage },
  { key: 'pricing',   label: 'Pricing',   Icon: IconPricing  },
  { key: 'forms',     label: 'Forms',     Icon: IconForm     },
  { key: 'states',    label: 'States',    Icon: IconStates   },
  { key: 'rules',     label: 'Rules',     Icon: IconRule     },
] as const

export function ProductCard({ p }: { p: WithId<Product> }) {
  const navigate = useNavigate()
  const go = (sub = 'overview') => navigate(`/app/products/${p.id}/${sub}`)

  const health = p.health?.score ?? 100
  const healthColor = health >= 80 ? 'var(--color-good)' : health >= 60 ? 'var(--color-warn)' : 'var(--color-danger)'
  const findings = p.health?.findingCount ?? 0

  return (
    <div
      className="group relative h-full bg-surface rounded-[16px] overflow-hidden flex flex-col hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] transition-all duration-200"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* Brand rail — subtle gradient flowing left→right, brightening on hover */}
      <span aria-hidden="true" className="block h-[3px] w-full opacity-70 group-hover:opacity-100 transition-opacity"
        style={{ background: 'linear-gradient(90deg, var(--color-accent-bright) 0%, var(--color-accent-strong) 55%, transparent 100%)' }} />

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Header — the whole title block opens the product */}
        <button onClick={() => go()} aria-label={`Open ${p.name}`}
          className="flex flex-col gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[8px]">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-[15px] text-text leading-snug group-hover:text-accent transition-colors">{p.name}</span>
            <IconChevronRight size={16} className="text-faint shrink-0 mt-0.5 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {p.refId && <RefChip id={p.refId} />}
            <StatusPill status={p.status} />
            <LifecyclePill lifecycle={p.lifecycle} />
            {p.lob?.name && <Badge label={p.lob.name} color="blue" />}
          </div>
        </button>

        {/* Domain quick-nav tiles */}
        <div className="grid grid-cols-5 gap-1.5">
          {TILES.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => go(key)} title={`Open ${label}`} aria-label={`${p.name} — ${label}`}
              className="group/tile flex flex-col items-center gap-1.5 py-2.5 rounded-[10px] bg-raised hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              <span className="w-7 h-7 rounded-[8px] bg-surface flex items-center justify-center text-dim group-hover/tile:text-accent transition-colors" style={{ border: '1px solid var(--color-border)' }}>
                <Icon size={15} />
              </span>
              <span className="text-[10px] font-medium text-faint group-hover/tile:text-dim transition-colors">{label}</span>
            </button>
          ))}
        </div>

        {/* Footer — facts + AI summary */}
        <div className="flex items-center gap-3 text-xs text-dim pt-3 mt-auto" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="tnum">{p.allStates ? 'All states' : `${p.states?.length ?? 0} states`}</span>
          <span className="truncate">{p.marketSegment ?? '—'}</span>
          <span className="ml-auto flex items-center gap-1.5" title={`Health ${health}${findings ? ` · ${findings} finding${findings === 1 ? '' : 's'}` : ''}`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: healthColor }} />
            <span className="truncate max-w-[80px]">{p.owner?.name ?? '—'}</span>
          </span>
          <button onClick={() => go('overview')} title="AI summary"
            className="shrink-0 inline-flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-[7px] text-[11px] font-medium text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
            <IconSparkle size={13} />Summary
          </button>
        </div>
      </div>
    </div>
  )
}
