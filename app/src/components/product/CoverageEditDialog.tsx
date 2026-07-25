// CoverageEditDialog — create or edit a coverage's identity + governance. Kept
// deliberately focused (limits/deductibles/states each have their own editor); this
// is the coverage's "spine": name, requirement, source, claims basis, whether it's
// rated, and its parent (for endorsements). Parent options are constrained to real
// top-level coverages so the hierarchy can never dangle.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { Dialog, Button, Input } from '../ui'
import { IconCoverage, IconClose } from '../ui/icons'
import { conflictToast } from '../../lib/conflict'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

type Draft = {
  name: string; refId: string; requirement: 'MANDATORY' | 'OPTIONAL' | 'UNKNOWN'
  // null = the source never stated premium treatment (F14): preserved on save
  // until the user explicitly sets the switch — an unrelated rename must not
  // silently persist `false`.
  source: 'BUREAU' | 'PROPRIETARY'; claimsBasis: string; premiumGenerating: boolean | null
  parentId: string | null
}

export function CoverageEditDialog({ cov, onClose }: { cov: WithId<Coverage> | null; onClose: () => void }) {
  const { pid, coverages } = useProductCtx()
  const { user } = useUser()
  const canEdit = canI(user, 'product:write')
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const isNew = !cov

  const [d, setD] = useState<Draft>(() => ({
    name: cov?.name ?? '', refId: cov?.refId ?? '',
    requirement: cov?.requirement ?? 'OPTIONAL', source: cov?.source ?? 'PROPRIETARY',
    claimsBasis: cov?.claimsBasis ?? '', premiumGenerating: cov ? (cov.premiumGenerating ?? null) : false,
    parentId: cov?.parentId ?? null,
  }))
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(p => ({ ...p, [k]: v }))

  // Valid parents: top-level coverages with a refId, excluding self.
  const parentChoices = coverages.filter(c => !c.parentId && c.refId && c.id !== cov?.id)

  async function save() {
    if (!canEdit) return
    if (!d.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      if (isNew) {
        const id = `cov-${Date.now()}`
        const order = Math.max(0, ...coverages.map(c => c.order ?? 0)) + 1
        await adapter.db.mutate({
          op: 'create', path: `products/${pid}/coverages/${id}`, entityType: 'coverage', productId: pid, actor,
          data: {
            refId: d.refId.trim() || null, name: d.name.trim(), parentId: d.parentId, order,
            requirement: d.requirement, source: d.source, claimsBasis: d.claimsBasis.trim(),
            premiumGenerating: d.premiumGenerating, formNumbers: [], terms: [],
            allStates: true, states: [],
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
        })
        toast.success('Coverage created')
      } else {
        await adapter.db.mutate({
          op: 'update', path: `products/${pid}/coverages/${cov.id}`, entityType: 'coverage', productId: pid, actor,
          expectedRev: (cov as { rev?: number }).rev,
          data: {
            refId: d.refId.trim() || null, name: d.name.trim(), parentId: d.parentId,
            requirement: d.requirement, source: d.source, claimsBasis: d.claimsBasis.trim(),
            premiumGenerating: d.premiumGenerating,
          },
        })
        toast.success('Coverage saved')
      }
      onClose()
    } catch (err) {
      if (err instanceof MutationConflictError && cov) {
        // "Reload latest": fetch the server version into the form; user can re-apply their edits.
        const reload = async () => {
          const fresh = await adapter.db.get<WithId<Coverage>>(`products/${pid}/coverages/${cov.id}`)
          if (fresh) setD({ name: fresh.name, refId: fresh.refId ?? '', requirement: fresh.requirement ?? 'OPTIONAL', source: fresh.source ?? 'PROPRIETARY', claimsBasis: fresh.claimsBasis ?? '', premiumGenerating: fresh.premiumGenerating ?? null, parentId: fresh.parentId ?? null })
          toast.info('Reloaded — review and save again.')
        }
        conflictToast({ reload, discard: onClose })
      } else {
        toast.error(err instanceof Error ? err.message : 'Save failed')
      }
    } finally { setSaving(false) }
  }

  const field = 'w-full h-10 px-3 rounded-[9px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25'

  return (
    <Dialog open onClose={onClose} width="max-w-lg">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}><IconCoverage size={22} /></span>
          <div>
            <h2 className="text-lg font-semibold text-text">{isNew ? 'New coverage' : 'Edit coverage'}</h2>
            <p className="text-sm text-dim">{isNew ? 'Add a coverage to this product' : 'Edit name, requirement, and governance'}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-faint hover:text-text rounded-[8px] p-1.5 hover:bg-raised transition-colors"><IconClose size={18} /></button>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Name</span>
            <Input value={d.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Building" autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Ref ID <span className="text-faint font-normal">(optional)</span></span>
            <Input value={d.refId} onChange={e => set('refId', e.target.value)} placeholder="HO.COV.007" className="font-mono" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Requirement</span>
            <select className={field} value={d.requirement} onChange={e => set('requirement', e.target.value as Draft['requirement'])}>
              <option value="MANDATORY">Mandatory</option><option value="OPTIONAL">Optional</option><option value="UNKNOWN">Unknown (source did not state)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Source</span>
            <select className={field} value={d.source} onChange={e => set('source', e.target.value as Draft['source'])}>
              <option value="BUREAU">Bureau</option><option value="PROPRIETARY">Proprietary</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Claims basis</span>
            <Input value={d.claimsBasis} onChange={e => set('claimsBasis', e.target.value)} placeholder="Occurrence" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dim">Parent (endorsement of)</span>
            <select className={field} value={d.parentId ?? ''} onChange={e => set('parentId', e.target.value || null)}>
              <option value="">None (top-level)</option>
              {parentChoices.map(c => <option key={c.id} value={c.refId!}>{c.name}</option>)}
            </select>
          </label>
        </div>

        <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-[10px] bg-raised cursor-pointer">
          <span className="flex flex-col">
            <span className="text-sm font-medium text-text">Premium generating</span>
            <span className="text-xs text-dim">{d.premiumGenerating == null ? 'Source did not state premium treatment — click to set it.' : 'This coverage participates in rating.'}</span>
          </span>
          <button type="button" onClick={() => set('premiumGenerating', d.premiumGenerating !== true)} role="switch" aria-checked={d.premiumGenerating === true}
            className="shrink-0 w-10 h-6 rounded-full p-0.5 transition-colors flex items-center" style={{ background: d.premiumGenerating === true ? 'var(--color-accent)' : 'var(--color-border-strong)', opacity: d.premiumGenerating == null ? 0.6 : 1 }}>
            <span className="w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: d.premiumGenerating === true ? 'translateX(16px)' : 'translateX(0)' }} />
          </button>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2 mt-6 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        {canEdit && <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create coverage' : 'Save changes'}</Button>}
      </div>
    </Dialog>
  )
}
