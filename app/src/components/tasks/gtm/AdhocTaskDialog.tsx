// AdhocTaskDialog — add a one-off task to the current project, outside the seeded
// process (origin='adhoc', shows a "One-off" badge on the board). Title, board column,
// due date, owner role and work type. Independent of the template/scheduler; written
// through the atomic mutate().
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../../lib/backend'
import { Dialog, Input, Button } from '../../ui'
import { GTM_COLUMNS, WORK_TYPES, futureISO, type ProjectDoc } from './gtm'
import type { TaskColumn, TypeOfWork } from '@pf/shared'

const selectCls = 'h-9 w-full px-2.5 rounded-[10px] bg-surface border text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25'

interface Props {
  project: ProjectDoc
  actor:   { uid: string; name: string }
  onClose: () => void
}

export function AdhocTaskDialog({ project, actor, onClose }: Props) {
  const [title, setTitle]     = useState('')
  const [column, setColumn]   = useState<TaskColumn>('IDEATION')
  const [dueDate, setDueDate] = useState(futureISO(10))
  const [owner, setOwner]     = useState('Product Mgr.')
  const [typeOfWork, setType] = useState<TypeOfWork>('Differentiating')
  const [busy, setBusy]       = useState(false)

  async function create() {
    const trimmed = title.trim()
    if (!trimmed) { toast.error('Give the task a title.'); return }
    setBusy(true)
    const id = `adhoc-${Date.now()}`
    try {
      await adapter.db.mutate({
        op: 'create', path: `tasks/${id}`, entityType: 'task', productId: project.productId ?? undefined, actor,
        data: {
          title: trimmed, taskL4: trimmed, column,
          projectId: project.id, productId: project.productId ?? null,
          origin: 'adhoc', ownerRole: owner.trim() || 'Unassigned', typeOfWork,
          dueAt: dueDate ? dueDate : null, startDate: null, ongoing: false,
          phaseL2: null, groupL3: null, phaseOrder: null, slaDays: null,
          order: Date.now(), assignee: null, checklist: [],
          done: false, completedAt: null,
        },
      })
      toast.success('Task added')
      onClose()
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Could not add task')
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="New task">
      <p className="text-[12.5px] text-dim -mt-2 mb-4">A one-off task in this project, outside the seeded process.</p>
      <div className="flex flex-col gap-3.5">
        <Input label="Task" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Align pricing with reinsurance treaty" autoFocus />

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text">Column</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }}
              value={column} onChange={e => setColumn(e.target.value as TaskColumn)}>
              {GTM_COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <Input label="Due date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Owner" value={owner} onChange={e => setOwner(e.target.value)} placeholder="Owner role" />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text">Type of work</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }}
              value={typeOfWork} onChange={e => setType(e.target.value as TypeOfWork)}>
              {WORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => void create()} disabled={busy}>Add task</Button>
        </div>
      </div>
    </Dialog>
  )
}
