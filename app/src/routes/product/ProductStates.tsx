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

// Simplified US state grid layout [col, row] (0-indexed from top-left)
const STATE_GRID: Record<string, [number, number]> = {
  WA:[0,0],MT:[2,0],ND:[4,0],MN:[5,0],WI:[6,0],MI:[7,0],NY:[9,0],VT:[10,0],ME:[11,0],
  OR:[0,1],ID:[2,1],SD:[4,1],IA:[5,1],IL:[6,1],IN:[6,1],OH:[7,1],PA:[8,1],NJ:[9,1],NH:[10,1],
  CA:[0,2],NV:[1,2],WY:[3,2],NE:[4,2],MO:[5,2],KY:[6,2],WV:[7,2],VA:[8,2],MD:[9,2],DE:[10,2],
  AZ:[1,3],UT:[2,3],CO:[3,3],KS:[4,3],TN:[5,3],NC:[6,3],SC:[7,3],
  NM:[2,4],OK:[4,4],AR:[5,4],GA:[6,4],
  TX:[3,5],LA:[5,5],AL:[6,5],FL:[7,5],
  AK:[0,6],HI:[2,6],MS:[5,6],
}

const ALL_STATES = Object.keys(STATE_GRID)

function StateMapSVG({ active, coastal, onToggle, canEdit }: {
  active: Set<string>; coastal: Set<string>; onToggle?: (s: string) => void; canEdit: boolean
}) {
  const CELL = 22; const GAP = 2; const PAD = 8
  const maxCol = Math.max(...Object.values(STATE_GRID).map(([c]) => c)) + 1
  const maxRow = Math.max(...Object.values(STATE_GRID).map(([,r]) => r)) + 1
  const W = maxCol * (CELL + GAP) + PAD * 2
  const H = maxRow * (CELL + GAP) + PAD * 2

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="US states map"
      style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}>
      {ALL_STATES.map(st => {
        const pos = STATE_GRID[st]
        if (!pos) return null
        const [col, row] = pos
        const x = PAD + col * (CELL + GAP); const y = PAD + row * (CELL + GAP)
        const isActive  = active.has(st)
        const isCoastal = coastal.has(st)
        const fill = isActive ? (isCoastal ? '#8B1FE0' : '#3b82f6') : '#e5e7eb'
        const textFill = isActive ? '#fff' : '#9ca3af'
        return (
          <g key={st} onClick={() => canEdit && onToggle?.(st)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
            <rect x={x} y={y} width={CELL} height={CELL} rx={3} fill={fill}
              stroke={isActive ? 'rgba(0,0,0,.15)' : 'transparent'} strokeWidth={1}
              className={canEdit ? 'hover:opacity-80 transition-opacity' : ''} />
            {isCoastal && isActive && (
              <circle cx={x + CELL - 4} cy={y + 4} r={2.5} fill="rgba(255,255,255,.6)" />
            )}
            <text x={x + CELL/2} y={y + CELL/2 + 3} textAnchor="middle" fontSize={7} fill={textFill}>{st}</text>
          </g>
        )
      })}
      {/* Legend */}
      <g>
        <rect x={PAD} y={H - 16} width={CELL} height={10} rx={2} fill="#3b82f6" />
        <text x={PAD + CELL + 4} y={H - 8} fontSize={7} fill="#5B5C6B">Active</text>
        <rect x={PAD + 70} y={H - 16} width={CELL} height={10} rx={2} fill="#8B1FE0" />
        <text x={PAD + 70 + CELL + 4} y={H - 8} fontSize={7} fill="#5B5C6B">Coastal</text>
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
              ${activeSet.has(st) ? (COASTAL.has(st) ? 'bg-accent text-white border-accent' : 'bg-[#3b82f6] text-white border-[#3b82f6]') : 'bg-surface text-dim border-border-strong hover:border-accent hover:text-accent'}
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
