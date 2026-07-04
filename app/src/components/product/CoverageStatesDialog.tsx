// CoverageStatesDialog — edit a coverage's state scope on the US tile map without
// leaving the coverages collection. "All footprint states" inherits the product's
// footprint; otherwise the coverage carries its own subset. Saves atomically via
// mutate (audit + version). A coverage can never be filed outside the product's
// footprint, so counts read against that footprint (fixes the >100% coverage math).
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { Dialog, Button } from '../ui'
import { IconStates, IconClose } from '../ui/icons'
import { StateTileMap } from './StateTileMap'
import { HO3_COASTAL_STATES } from '@pf/shared'
import { US_TILE_GRID } from '../../lib/geo/usTileGrid'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const COASTAL = new Set<string>(HO3_COASTAL_STATES)
const ALL_TILE_STATES = Object.keys(US_TILE_GRID)

export function CoverageStatesDialog({ cov, onClose }: { cov: WithId<Coverage>; onClose: () => void }) {
  const { pid, product } = useProductCtx()
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }

  // The product footprint bounds every coverage; default to it when unset.
  const footprint = product?.allStates ? ALL_TILE_STATES : (product?.states ?? ALL_TILE_STATES)
  const [allStates, setAllStates] = useState(cov.allStates ?? false)
  const [states, setStates] = useState<string[]>(() => (cov.states ?? []).filter(s => footprint.includes(s)))
  const [saving, setSaving] = useState(false)

  const active = allStates ? new Set(footprint) : new Set(states)
  const selectedCount = allStates ? footprint.length : states.length

  function toggle(s: string) {
    if (!canEdit || allStates || !footprint.includes(s)) return
    setStates(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function save() {
    if (!canEdit) return
    setSaving(true)
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/coverages/${cov.id}`,
        data: { allStates, states: allStates ? [] : states },
        entityType: 'coverage', productId: pid, actor,
        expectedRev: (cov as { rev?: number }).rev,
      })
      toast.success('State scope saved'); onClose()
    } catch (err) {
      toast.error(err instanceof MutationConflictError
        ? 'Conflict — this coverage changed elsewhere. Please reopen.'
        : err instanceof Error ? err.message : 'Save failed')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onClose={onClose} width="max-w-2xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}><IconStates size={22} /></span>
          <div>
            <h2 className="text-lg font-semibold text-text">State Availability</h2>
            <p className="text-sm text-dim">{cov.name}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-faint hover:text-text rounded-[8px] p-1.5 hover:bg-raised transition-colors"><IconClose size={18} /></button>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3">
        <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
          <input type="checkbox" className="accent-accent" checked={allStates} disabled={!canEdit}
            onChange={e => setAllStates(e.target.checked)} />
          All footprint states
        </label>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-dim"><b className="text-text tnum">{selectedCount}</b> selected</span>
          <span className="text-faint">of {footprint.length} in footprint</span>
          {canEdit && !allStates && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setStates([...footprint])} className="text-accent font-medium hover:underline">All</button>
              <span className="text-faint">·</span>
              <button onClick={() => setStates([])} className="text-dim font-medium hover:underline">Clear</button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-page rounded-[12px] p-3" style={{ border: '1px solid var(--color-border)' }}>
        <StateTileMap active={active} coastal={COASTAL} onToggle={toggle} canEdit={canEdit && !allStates}
          labels={{ active: 'In scope', coastal: 'Coastal wind/hail', inactive: 'Out of scope' }} />
      </div>

      <div className="flex items-center justify-end gap-2 mt-5 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        {canEdit && <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>}
      </div>
    </Dialog>
  )
}
