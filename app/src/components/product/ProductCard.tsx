// ProductCard — the portfolio card. A brand rail flows across the top; the product
// reads as governance chips → name → at-a-glance facts, then a row of domain "quick-nav"
// tiles (Coverages · Pricing · Forms · States · Rules) that jump straight into that part
// of the product. The WHOLE card opens the product (mouse click anywhere non-interactive);
// the title button stays the accessible primary link. Summary / retire / delete live in a
// kebab menu (destructive items confirm via the typed-name dialogs). Search matches are
// highlighted in place; `focused` marks the keyboard-selected card from the search field.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ProductStatusPill, Badge, Highlight } from '../ui'
import {
  IconCoverage, IconPricing, IconForm, IconStates, IconRule, IconSparkle,
  IconChevronRight, IconTrash, IconArchive, IconMore,
} from '../ui/icons'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const TILES = [
  { key: 'coverages', label: 'Coverages', Icon: IconCoverage },
  { key: 'pricing',   label: 'Pricing',   Icon: IconPricing  },
  { key: 'forms',     label: 'Forms',     Icon: IconForm     },
  { key: 'states',    label: 'States',    Icon: IconStates   },
  { key: 'rules',     label: 'Rules',     Icon: IconRule     },
] as const

// ─── Kebab menu — Summary / Retire / Delete ────────────────────────────────────
// Outside-click + Escape close; destructive entries only open the existing
// typed-name confirmation dialogs, never act directly.
function CardMenu({ name, onSummary, onRetire, onDelete }: {
  name: string
  onSummary: () => void
  onRetire?: () => void
  onDelete?: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const item = 'w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

  return (
    <div ref={wrapRef} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu" aria-expanded={open} aria-label={`${name} — actions`}
        className="inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-faint hover:text-text hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <IconMore size={15} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={`${name} actions`}
          className="absolute right-0 bottom-[calc(100%+4px)] z-20 min-w-[168px] rounded-[10px] overflow-hidden bg-surface py-1"
          style={{ border: '1px solid var(--color-border-strong)', boxShadow: 'var(--shadow-card)' }}>
          <button role="menuitem" className={`${item} text-dim hover:bg-raised hover:text-text`}
            onClick={() => { setOpen(false); onSummary() }}>
            <IconSparkle size={13} className="text-accent" aria-hidden="true" /> AI summary
          </button>
          {onRetire && (
            <button role="menuitem" className={`${item} text-dim hover:bg-warn/10 hover:text-warn`}
              onClick={() => { setOpen(false); onRetire() }}>
              <IconArchive size={13} aria-hidden="true" /> Retire…
            </button>
          )}
          {onDelete && (
            <button role="menuitem" className={`${item} text-dim hover:bg-danger/10 hover:text-danger`}
              onClick={() => { setOpen(false); onDelete() }}>
              <IconTrash size={13} aria-hidden="true" /> Delete…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ProductCard({ p, canEdit, onDelete, onRetire, highlight = '', focused = false }: {
  p: WithId<Product>
  canEdit?: boolean
  onDelete?: () => void
  onRetire?: () => void
  /** Active search query — matched fragments render highlighted. */
  highlight?: string
  /** Keyboard-selected from the search field (↑/↓); Enter opens this card. */
  focused?: boolean
}) {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const go = (sub = 'overview') => navigate(`/app/products/${p.id}/${sub}`)

  useEffect(() => {
    if (focused) rootRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  const stateLabel = p.allStates ? 'All states' : `${p.states?.length ?? 0} state${(p.states?.length ?? 0) === 1 ? '' : 's'}`

  return (
    <div
      ref={rootRef}
      onClick={() => go()}
      className="group relative h-full bg-surface rounded-[16px] overflow-visible flex flex-col cursor-pointer shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5 transition-all duration-200"
      style={{
        border: `1px solid ${focused ? 'var(--color-accent)' : 'var(--color-border)'}`,
        boxShadow: focused ? 'var(--shadow-card-hover), 0 0 0 2px var(--color-accent-line)' : undefined,
      }}
    >
      {/* Brand rail — subtle gradient flowing left→right, brightening on hover */}
      <span aria-hidden="true" className="block h-[3px] w-full rounded-t-[16px] opacity-70 group-hover:opacity-100 transition-opacity"
        style={{ background: 'linear-gradient(90deg, var(--color-accent-bright) 0%, var(--color-accent-strong) 55%, transparent 100%)' }} />

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Header — the title block is the accessible primary link */}
        <button onClick={e => { e.stopPropagation(); go() }} aria-label={`Open ${p.name}`}
          className="flex flex-col gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[8px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <ProductStatusPill lifecycle={p.lifecycle} />
            {p.lob?.name && <Badge label={p.lob.name} color="blue" />}
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-[15px] text-text leading-snug group-hover:text-accent transition-colors">
              <Highlight text={p.name} query={highlight} />
            </span>
            <IconChevronRight size={16} aria-hidden="true" className="text-faint shrink-0 mt-0.5 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
          </div>
          <p className="text-xs text-dim tnum">
            <Highlight text={stateLabel} query={highlight} />
            {p.marketSegment ? <> · <Highlight text={p.marketSegment} query={highlight} /></> : null}
          </p>
        </button>

        {/* Domain quick-nav tiles — deep-link into that tab */}
        <div className="grid grid-cols-5 gap-1.5">
          {TILES.map(({ key, label, Icon }) => (
            <button key={key} onClick={e => { e.stopPropagation(); go(key) }} aria-label={`${p.name} — ${label}`}
              className="group/tile flex flex-col items-center gap-1.5 py-2.5 rounded-[10px] bg-raised hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              <span className="w-7 h-7 rounded-[8px] bg-surface flex items-center justify-center text-dim group-hover/tile:text-accent transition-colors" style={{ border: '1px solid var(--color-border)' }}>
                <Icon size={15} />
              </span>
              <span className="text-[10px] font-medium text-faint group-hover/tile:text-dim transition-colors">{label}</span>
            </button>
          ))}
        </div>

        {/* Footer — refId provenance + the kebab (Summary / Retire / Delete) */}
        <div className="flex items-center justify-between gap-2 text-xs pt-3 mt-auto" style={{ borderTop: '1px solid var(--color-border)' }}>
          {p.refId ? (
            <span className="font-mono text-[10.5px] text-faint truncate" title={p.refId}>
              <Highlight text={p.refId} query={highlight} />
            </span>
          ) : <span />}
          <CardMenu
            name={p.name}
            onSummary={() => go('overview')}
            onRetire={canEdit && onRetire && p.lifecycle !== 'RETIRED' ? onRetire : undefined}
            onDelete={canEdit && onDelete ? onDelete : undefined}
          />
        </div>
      </div>
    </div>
  )
}
