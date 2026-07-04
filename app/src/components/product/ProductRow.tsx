// ProductRow — the list-view counterpart to ProductCard: one dense, scannable row
// with the same governance chips, at-a-glance facts and domain quick-nav icons.
// Used when the portfolio is switched to List mode.
import { useNavigate } from 'react-router-dom'
import { StatusPill, LifecyclePill, Badge, RefChip, Tooltip } from '../ui'
import { IconCoverage, IconPricing, IconForm, IconStates, IconRule, IconChevronRight } from '../ui/icons'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const TILES = [
  { key: 'coverages', label: 'Coverages', Icon: IconCoverage },
  { key: 'pricing',   label: 'Pricing',   Icon: IconPricing  },
  { key: 'forms',     label: 'Forms',     Icon: IconForm     },
  { key: 'states',    label: 'States',    Icon: IconStates   },
  { key: 'rules',     label: 'Rules',     Icon: IconRule     },
] as const

export function ProductRow({ p }: { p: WithId<Product> }) {
  const navigate = useNavigate()
  const go = (sub = 'overview') => navigate(`/app/products/${p.id}/${sub}`)

  const health = p.health?.score ?? 100
  const healthColor = health >= 80 ? 'var(--color-good)' : health >= 60 ? 'var(--color-warn)' : 'var(--color-danger)'

  return (
    <div className="group flex items-center gap-3 px-4 py-3 bg-surface hover:bg-raised transition-colors"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      {/* Identity — clickable */}
      <button onClick={() => go()} aria-label={`Open ${p.name}`}
        className="flex items-center gap-3 min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[6px]">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: healthColor }} title={`Health ${health}`} />
        <span className="font-medium text-sm text-text truncate group-hover:text-accent transition-colors">{p.name}</span>
        {p.refId && <span className="hidden md:inline shrink-0"><RefChip id={p.refId} /></span>}
      </button>

      {/* Governance + facts */}
      <div className="hidden lg:flex items-center gap-1.5 shrink-0">
        <StatusPill status={p.status} />
        <LifecyclePill lifecycle={p.lifecycle} />
        {p.lob?.name && <Badge label={p.lob.name} color="blue" />}
      </div>
      <span className="hidden xl:block w-32 text-xs text-dim truncate shrink-0">{p.marketSegment ?? '—'}</span>
      <span className="hidden sm:block w-16 text-xs text-dim tnum text-right shrink-0">{p.allStates ? 50 : (p.states?.length ?? 0)} st.</span>
      <span className="hidden xl:block w-28 text-xs text-dim truncate text-right shrink-0">{p.owner?.name ?? '—'}</span>

      {/* Quick-nav icons */}
      <div className="hidden md:flex items-center gap-0.5 shrink-0">
        {TILES.map(({ key, label, Icon }) => (
          <Tooltip key={key} content={label}>
            <button onClick={() => go(key)} aria-label={`${p.name} — ${label}`}
              className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              <Icon size={15} />
            </button>
          </Tooltip>
        ))}
      </div>

      <button onClick={() => go()} aria-label={`Open ${p.name}`}
        className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint group-hover:text-accent transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
        <IconChevronRight size={16} />
      </button>
    </div>
  )
}
