// States tab — SVG grid choropleth + toggle grid editor + bulk actions.
import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Download, Globe } from 'lucide-react'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Button } from '../../components/ui'
import { HO3_FOOTPRINT_STATES, HO3_COASTAL_STATES } from '@pf/shared'

const COASTAL = new Set<string>(HO3_COASTAL_STATES)
const FOOTPRINT = new Set<string>(HO3_FOOTPRINT_STATES)

// Geographic US tile grid — each state a tile at its approximate map position.
// Authored as a visual string grid (easy to verify), parsed to [col,row] coords.
const TILE_ROWS = [
  'WA .. .. .. .. .. .. .. .. .. .. ME',
  'OR ID MT ND MN WI .. MI .. NY VT NH',
  'NV UT WY SD IA IL IN OH PA NJ CT MA',
  'CA AZ CO NE MO KY WV VA MD DE RI ..',
  '.. NM KS OK AR TN NC SC DC .. .. ..',
  '.. .. TX LA MS AL GA FL .. .. .. ..',
  'AK HI .. .. .. .. .. .. .. .. .. ..',
]
const STATE_GRID: Record<string, [number, number]> = {}
TILE_ROWS.forEach((row, r) => row.split(/\s+/).forEach((st, c) => { if (st !== '..') STATE_GRID[st] = [c, r] }))
const ALL_STATES = Object.keys(STATE_GRID)
const GRID_COLS = 12

function StateMapSVG({ active, coastal, onToggle, canEdit }: {
  active: Set<string>; coastal: Set<string>; onToggle?: (s: string) => void; canEdit: boolean
}) {
  const CELL = 30, GAP = 4, PAD = 12, LEGEND = 22
  const maxRow = Math.max(...Object.values(STATE_GRID).map(([, r]) => r)) + 1
  const W = GRID_COLS * (CELL + GAP) - GAP + PAD * 2
  const H = maxRow * (CELL + GAP) - GAP + PAD * 2 + LEGEND

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W, height: 'auto', fontFamily: 'JetBrains Mono Variable, monospace' }}
      role="img" aria-label={`United States tile map — ${active.size} states in the product footprint, coastal wind/hail states marked.`}>
      <defs>
        <linearGradient id="sm-coastal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#A100FF" /><stop offset="100%" stopColor="#7A00E6" />
        </linearGradient>
      </defs>
      {ALL_STATES.map(st => {
        const [col, row] = STATE_GRID[st]!
        const x = PAD + col * (CELL + GAP), y = PAD + row * (CELL + GAP)
        const isActive = active.has(st), isCoastal = coastal.has(st) && isActive
        const fill = isCoastal ? 'url(#sm-coastal)' : isActive ? '#8B1FE0' : '#F0F0F5'
        const textFill = isActive ? '#fff' : '#9A9CAC'
        return (
          <g key={st} onClick={() => canEdit && onToggle?.(st)} style={{ cursor: canEdit ? 'pointer' : 'default' }}
            className={canEdit ? 'hover:opacity-85 transition-opacity' : ''}>
            <title>{st}{isCoastal ? ' · coastal wind/hail' : isActive ? ' · in footprint' : ''}</title>
            <rect x={x} y={y} width={CELL} height={CELL} rx={7} fill={fill}
              stroke={isActive ? 'rgba(19,19,26,.10)' : 'rgba(19,19,26,.05)'} strokeWidth={1} />
            <text x={x + CELL / 2} y={y + CELL / 2 + 3.5} textAnchor="middle" fontSize={9} fontWeight={600} fill={textFill}>{st}</text>
            {isCoastal && (
              <g transform={`translate(${x + CELL - 6} ${y + 6})`}>
                <circle r={5} fill="#F59E0B" stroke="#fff" strokeWidth={0.75} />
                <path d="M0.4 -2.6 L-1.8 0.4 L-0.2 0.4 L-0.6 2.6 L1.8 -0.4 L0.2 -0.4 Z" fill="#fff" />
              </g>
            )}
          </g>
        )
      })}
      {/* Legend */}
      <g transform={`translate(${PAD} ${H - 10})`} fontSize={9} fill="#5B5C6B">
        <rect x={0} y={-9} width={12} height={12} rx={3} fill="#8B1FE0" /><text x={17} y={0}>In footprint</text>
        <rect x={92} y={-9} width={12} height={12} rx={3} fill="url(#sm-coastal)" />
        <circle cx={101.5} cy={-6.5} r={3} fill="#F59E0B" stroke="#fff" strokeWidth={0.5} /><text x={109} y={0}>Coastal wind/hail</text>
        <rect x={228} y={-9} width={12} height={12} rx={3} fill="#F0F0F5" /><text x={245} y={0}>Not filed</text>
      </g>
    </svg>
  )
}

export default function ProductStates() {
  const { pid, product, loading } = useProductCtx()
  const { user }   = useUser()
  const canEdit    = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor      = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const svgRef     = useRef<HTMLDivElement>(null)

  const [states, setStates] = useState<string[]>(() => product?.states ?? [])
  const [dirty,  setDirty]  = useState(false)

  const activeSet = new Set(states)

  function toggleState(st: string) {
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
      if (err instanceof MutationConflictError) toast.error('Conflict — refresh and try again.')
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

  if (loading) return <div className="h-64 bg-raised animate-pulse rounded-[14px]" />

  return (
    <div className="flex flex-col gap-5">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-text">{states.length} states selected</span>
        {canEdit && (
          <>
            <Button variant="ghost" size="sm" onClick={() => { setStates([...FOOTPRINT]); setDirty(true) }}>
              <Globe size={12} />All footprint
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setStates([]); setDirty(true) }}>Clear</Button>
            {dirty && <Button variant="primary" size="sm" onClick={handleSave}>Save states</Button>}
          </>
        )}
        <Button variant="ghost" size="sm" onClick={exportSVG} className="ml-auto">
          <Download size={12} />SVG
        </Button>
      </div>

      {/* Map */}
      <div ref={svgRef} className="bg-surface rounded-[14px] p-4 overflow-x-auto" style={{ border: '1px solid var(--color-border)' }}>
        <StateMapSVG active={activeSet} coastal={COASTAL} onToggle={toggleState} canEdit={canEdit} />
      </div>

      {/* Grid chips */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_STATES.sort().map(st => (
          <button
            key={st}
            disabled={!canEdit}
            onClick={() => canEdit && toggleState(st)}
            className={`px-2 py-1 rounded-[6px] text-xs font-mono font-medium border transition-colors
              ${activeSet.has(st) ? 'bg-accent text-white border-accent' : 'bg-surface text-dim border-border-strong hover:border-accent hover:text-accent'}
              ${!canEdit ? 'cursor-default' : 'cursor-pointer'}`}
          >
            {st}
            {COASTAL.has(st) && activeSet.has(st) && <span className="ml-0.5 text-[8px]">⚡</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
