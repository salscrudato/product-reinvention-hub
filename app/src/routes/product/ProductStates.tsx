// States tab — SVG grid choropleth + toggle grid editor + bulk actions.
import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { IconDownload, IconStates } from '../../components/ui/icons'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Button } from '../../components/ui'
import { StateTileMap } from '../../components/product/StateTileMap'
import { resolveLob } from '@pf/shared'
import { US_TILE_GRID as STATE_GRID } from '../../lib/geo/usTileGrid'

const ALL_STATES = Object.keys(STATE_GRID)

export default function ProductStates() {
  const { pid, product, loading } = useProductCtx()
  const lob     = resolveLob(product)              // line-driven footprint + peril
  const FOOTPRINT = new Set<string>(lob.footprintStates)
  const COASTAL = new Set<string>(lob.peril.eligibleStates)
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
              <IconStates size={13} />All footprint
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setStates([]); setDirty(true) }}>Clear</Button>
            {dirty && <Button variant="primary" size="sm" onClick={handleSave}>Save states</Button>}
          </>
        )}
        <Button variant="ghost" size="sm" onClick={exportSVG} className="ml-auto">
          <IconDownload size={13} />SVG
        </Button>
      </div>

      {/* Map */}
      <div ref={svgRef} className="bg-surface rounded-[14px] p-4 overflow-x-auto" style={{ border: '1px solid var(--color-border)' }}>
        <StateTileMap active={activeSet} coastal={COASTAL} onToggle={toggleState} canEdit={canEdit} />
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
