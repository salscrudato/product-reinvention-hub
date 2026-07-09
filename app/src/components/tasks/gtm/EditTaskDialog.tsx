// EditTaskDialog — edit an existing board task (seeded OR one-off). Changes the fields a
// PM actually adjusts on the board — title, column, due date, owner role, work type — via
// a PARTIAL atomic update so a seeded task keeps its process lineage (phase/group/SLA).
// Optimistic concurrency: expectedRev guards a stale edit. Sibling of AdhocTaskDialog
// (which creates one-offs); both write through the atomic mutate() seam.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../../lib/backend'
import { Dialog, Input, Button } from '../../ui'
import { GTM_COLUMNS, WORK_TYPES, toMillis, type TaskDoc } from './gtm'
import type { TaskColumn, TypeOfWork } from '@pf/shared'

const selectCls = 'h-9 w-full px-2.5 rounded-[10px] bg-surface border text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25'

/** A stored dueAt (ISO `yyyy-mm-dd`, or a legacy Timestamp/millis) → a date-input value. */
function toDateInput(v: unknown): string {
  if (typeof v === 'string') return v.slice(0, 10)
  const ms = toMillis(v)
  if (ms == null) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Props {
  task:    TaskDoc
  actor:   { uid: string; name: string }
  onClose: () => void
}

export function EditTaskDialog({ task, actor, onClose }: Props) {
  const [title, setTitle]     = useState(task.title ?? '')
  const [column, setColumn]   = useState<TaskColumn>(task.column)
  const [dueDate, setDueDate] = useState(toDateInput(task.dueAt))
  const [owner, setOwner]     = useState(task.ownerRole ?? '')
  const [typeOfWork, setType] = useState<TypeOfWork>((task.typeOfWork as TypeOfWork) ?? 'Differentiating')
  const [busy, setBusy]       = useState(false)

  async function save() {
    const trimmed = title.trim()
    if (!trimmed) { toast.error('Give the task a title.'); return }
    setBusy(true)
    try {
      await adapter.db.mutate({
        op: 'update', path: `tasks/${task.id}`, entityType: 'task', productId: task.productId, actor,
        expectedRev: task.rev,
        // Partial update — merges over the stored doc, so a seeded task's phase/group/SLA
        // lineage is untouched. taskL4 only mirrors the title for one-off tasks (where the
        // two are the same); a seeded task keeps its canonical L4 process-step name.
        data: {
          title: trimmed,
          column,
          ownerRole: owner.trim() || 'Unassigned',
          typeOfWork,
          dueAt: dueDate ? dueDate : null,
          ...(task.origin === 'adhoc' ? { taskL4: trimmed } : {}),
        },
      })
      toast.success('Task updated')
      onClose()
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Could not update task')
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Edit task">
      <p className="text-[12.5px] text-dim -mt-2 mb-4">
        {task.origin === 'adhoc' ? 'A one-off task in this project.' : 'A seeded process task — its phase lineage is preserved.'}
      </p>
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
          <Input label={task.ongoing ? 'Due date (ongoing)' : 'Due date'} type="date"
            value={dueDate} onChange={e => setDueDate(e.target.value)} />
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
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>Save changes</Button>
        </div>
      </div>
    </Dialog>
  )
}
