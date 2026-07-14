// States tab — SVG grid choropleth + toggle grid editor + bulk actions.
import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { IconDownload, IconStates } from '../../components/ui/icons'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { Button, Skeleton } from '../../components/ui'
import { StateTileMap } from '../../components/product/StateTileMap'
import { resolveLob } from '@pf/shared'

// The wind/hail peril mark for the grid chips — the same amber-disc-with-bolt badge
// the map and its legend use, so the surface reads as one system (an emoji would be
// off-grid and platform-dependent). Decorative: the peril is spoken in each chip's
// aria-label, so the glyph is aria-hidden.
function PerilBolt() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <circle cx="6" cy="6" r="5" fill="var(--color-peril)" stroke="var(--color-surface)" strokeWidth="0.75" />
      <path d="M6.4 3.4 L4.2 6.4 L5.8 6.4 L5.4 8.6 L7.8 5.6 L6.2 5.6 Z" fill="var(--color-surface)" />
    </svg>
  )
}

export default function ProductStates() {
  const { pid, product, loading } = useProductCtx()
  const lob     = resolveLob(product)              // line-driven footprint + peril
  const FOOTPRINT = new Set<string>(lob.footprintStates)
  const COASTAL = new Set<string>(lob.peril.eligibleStates)
  const { user }   = useUser()
  const canEdit    = canI(user, 'product:write')
  const actor      = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const svgRef     = useRef<HTMLDivElement>(null)

  // The product's effective footprint, clipped to the line's standard footprint so
  // counts never exceed 100%. When `allStates` is true we treat the line footprint
  // as the product footprint; otherwise we honour the stored `states` (falling
  // back to the line footprint when empty).
  const initialStates = (product?.allStates
    ? (product?.states?.length ? product.states : lob.footprintStates)
    : (product?.states ?? lob.footprintStates)
  ).filter(st => FOOTPRINT.has(st))

  const [states, setStates] = useState<string[]>(() => initialStates)
  const [dirty,  setDirty]  = useState(false)

  const activeSet = new Set(states)

  function toggleState(st: string) {
    if (!FOOTPRINT.has(st)) return
    setStates(prev => prev.includes(st) ? prev.filter(s => s !== st) : [...prev, st])
    setDirty(true)
  }

  async function handleSave() {
    if (!product) return
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}`,
        data: { states, allStates: false },
        entityType: 'product', productId: pid, actor,
        expectedRev: (product as { rev?: number }).rev,
      })
      setDirty(false)
      toast.success('States saved')
    } catch (err) {
      if (err instanceof MutationConflictError) conflictToast({})
      else toast.error('Save failed')
    }
  }

  function exportSVG() {
    const svgEl = svgRef.current?.querySelector('svg')
    if (!svgEl) return
    const str = new XMLSerializer().serializeToString(svgEl)
    const blob = new Blob([str], { type: 'image/svg+xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'states-map.svg'; a.click()
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-56 rounded-[12px]" />
        <div className="flex flex-col gap-2">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Executive stat band figures — all deterministic, live with every toggle.
  const pct = FOOTPRINT.size > 0 ? Math.round((states.length / FOOTPRINT.size) * 100) : 0
  const perilInScope = states.filter(st => COASTAL.has(st)).length
  const RING_R = 17
  const RING_C = 2 * Math.PI * RING_R

  return (
    <div className="flex flex-col gap-5">
      {/* Stat band — coverage ring + live figures + actions. The ring animates with
          each toggle (spring on stroke-dashoffset; neutralised by reduced motion). */}
      <div className="flex items-center gap-4 flex-wrap rounded-[14px] bg-surface px-4 py-3"
        style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-center gap-3">
          <svg width="44" height="44" viewBox="0 0 44 44" role="img"
            aria-label={`Footprint coverage: ${pct}% — ${states.length} of ${FOOTPRINT.size} states`}>
            <circle cx="22" cy="22" r={RING_R} fill="none" stroke="var(--color-raised)" strokeWidth="4.5" />
            <circle
              cx="22" cy="22" r={RING_R} fill="none"
              stroke="url(#footprint-ring-grad)" strokeWidth="4.5" strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - pct / 100)}
              transform="rotate(-90 22 22)"
              style={{ transition: 'stroke-dashoffset .6s var(--ease-spring)' }}
            />
            <defs>
              <linearGradient id="footprint-ring-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--color-accent-bright)" />
                <stop offset="100%" stopColor="var(--color-accent-strong)" />
              </linearGradient>
            </defs>
            <text x="22" y="26" textAnchor="middle" fontSize="11" fontWeight="700"
              fill="var(--color-text)" fontFamily="var(--font-mono)">{pct}%</text>
          </svg>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text tnum tabular-nums">
              {states.length} of {FOOTPRINT.size} state{FOOTPRINT.size === 1 ? '' : 's'}
            </span>
            <span className="text-[11px] text-faint">of the {lob.name} footprint</span>
          </div>
        </div>

        {COASTAL.size > 0 && (
          <div className="flex items-center gap-2 pl-4" style={{ borderLeft: '1px solid var(--color-border)' }}>
            <PerilBolt />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-text tnum tabular-nums">{perilInScope} in scope</span>
              <span className="text-[11px] text-faint">{lob.peril.label}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {canEdit && (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setStates([...FOOTPRINT]); setDirty(true) }}>
                <IconStates size={13} />All footprint
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setStates([]); setDirty(true) }}>Clear</Button>
              {dirty && <Button variant="primary" size="sm" onClick={handleSave}>Save states</Button>}
            </>
          )}
          <Button variant="ghost" size="sm" onClick={exportSVG}>
            <IconDownload size={13} />SVG
          </Button>
        </div>
      </div>

      {/* Map */}
      <div ref={svgRef} className="bg-surface rounded-[14px] p-4 overflow-x-auto" style={{ border: '1px solid var(--color-border)' }}>
        <StateTileMap
          active={activeSet}
          footprint={FOOTPRINT}
          peril={lob.perilModel}
          onToggle={canEdit ? toggleState : undefined}
          canEdit={canEdit}
          ariaLabel={`Product footprint map — ${states.length} of ${FOOTPRINT.size} states selected.`}
        />
      </div>

      {/* Grid chips — a keyboard-friendly alternate to the map. The peril mark follows
          the state (coastal), not the selection, so it shows on every coastal footprint
          chip exactly as the map does. */}
      <div className="flex flex-wrap gap-1.5">
        {Array.from(FOOTPRINT).sort().map(st => {
          const on = activeSet.has(st)
          const coastal = COASTAL.has(st)
          return (
            <button
              key={st}
              disabled={!canEdit}
              aria-pressed={canEdit ? on : undefined}
              aria-label={`${st} — ${on ? 'in scope' : 'out of scope'}${coastal ? `, ${lob.peril.label}` : ''}`}
              onClick={() => canEdit && toggleState(st)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-xs font-mono font-medium border transition-colors
                ${on ? 'bg-accent text-on-accent border-accent' : 'bg-surface text-dim border-border-strong hover:border-accent hover:text-accent'}
                ${!canEdit ? 'cursor-default' : 'cursor-pointer'}`}
            >
              {st}
              {coastal && <PerilBolt />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
