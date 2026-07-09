// ProjectDialog — create a launch project: name, description, optional Product link,
// a launch DEADLINE, owner and status. Writes via the atomic mutate() (refId minted at
// the seam). On success the parent selects the new project and offers to seed its board.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../../lib/backend'
import { Dialog, Input, Button } from '../../ui'
import { futureISO } from './gtm'
import type { ProjectStatus } from '@pf/shared'

const selectCls = 'h-9 w-full px-2.5 rounded-[10px] bg-surface border text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25'

interface Props {
  products: { id: string; name: string }[]
  actor:    { uid: string; name: string }
  onClose:  () => void
  onCreated: (projectId: string) => void
}

export function ProjectDialog({ products, actor, onClose, onCreated }: Props) {
  const [name, setName]         = useState('')
  const [description, setDesc]  = useState('')
  const [productId, setProduct] = useState('')
  const [deadline, setDeadline] = useState(futureISO(150))   // healthy default runway
  const [owner, setOwner]       = useState(actor.name)
  const [status, setStatus]     = useState<ProjectStatus>('planning')
  const [busy, setBusy]         = useState(false)

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) { toast.error('Give the project a name.'); return }
    if (!deadline) { toast.error('Pick a launch deadline.'); return }
    setBusy(true)
    const id = `project-${Date.now()}`
    try {
      await adapter.db.mutate({
        op: 'create', path: `projects/${id}`, entityType: 'project', actor,
        data: {
          name: trimmed,
          description: description.trim(),
          productId: productId || null,
          targetLaunchDate: deadline,
          status,
          owner: { uid: actor.uid, name: owner.trim() || actor.name },
        },
      })
      toast.success('Project created')
      onClose()
      onCreated(id)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Could not create project')
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="New project">
      <p className="text-[12.5px] text-dim -mt-2 mb-4">
        A product launch with a hard deadline. You’ll seed and back-schedule its tasks next.
      </p>
      <div className="flex flex-col gap-3.5">
        <Input label="Project name" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Personal Auto — National Launch" autoFocus />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">Description</span>
          <textarea value={description} onChange={e => setDesc(e.target.value)} rows={2}
            placeholder="What is launching, and why"
            className={`${selectCls} h-auto py-2 resize-y`} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">Product (optional)</span>
          <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }}
            value={productId} onChange={e => setProduct(e.target.value)}>
            <option value="">Not linked yet</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Launch deadline" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text">Status</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }}
              value={status} onChange={e => setStatus(e.target.value as ProjectStatus)}>
              <option value="planning">Planning</option>
              <option value="active">Active</option>
            </select>
          </label>
        </div>

        <Input label="Owner" value={owner} onChange={e => setOwner(e.target.value)} placeholder="Owner name" />

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => void create()} disabled={busy}>Create project</Button>
        </div>
      </div>
    </Dialog>
  )
}
