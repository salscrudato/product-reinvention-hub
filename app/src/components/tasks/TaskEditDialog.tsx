// TaskEditDialog — create or edit a lifecycle task. On create, a template picker
// pre-fills a generic task (title + lifecycle column + planned duration) that the PM can
// then override. Assignee is chosen from the people already on the board (plus "me" and
// "unassigned"), so tasks can be monitored by person. Writes go through the adapter's
// atomic mutate (optimistic-locked on edit).
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Dialog, Input, Button } from '../ui'
import type { Task, TaskColumn } from '@pf/shared'

type TaskDoc = Task & { id: string }

const TASK_COLUMNS: { id: TaskColumn; label: string }[] = [
  { id: 'IDEATION',       label: 'Ideation & Design' },
  { id: 'BUILD_FILE',     label: 'Build & File' },
  { id: 'TEST_APPROVE',   label: 'Test & Approve' },
  { id: 'LAUNCH_MONITOR', label: 'Launch & Monitor' },
]

// Preloaded generic tasks with typical durations (working days). Overridable on create.
const TASK_TEMPLATES: { title: string; column: TaskColumn; durationDays: number }[] = [
  { title: 'Market research',            column: 'IDEATION',       durationDays: 5 },
  { title: 'Competitive analysis',       column: 'IDEATION',       durationDays: 5 },
  { title: 'Product design & pricing',   column: 'IDEATION',       durationDays: 10 },
  { title: 'Coverage & form drafting',   column: 'BUILD_FILE',     durationDays: 10 },
  { title: 'Rate & rule filing',         column: 'BUILD_FILE',     durationDays: 15 },
  { title: 'System configuration',       column: 'BUILD_FILE',     durationDays: 10 },
  { title: 'UAT & testing',              column: 'TEST_APPROVE',   durationDays: 7 },
  { title: 'Regulatory approval',        column: 'TEST_APPROVE',   durationDays: 20 },
  { title: 'Launch readiness review',    column: 'LAUNCH_MONITOR', durationDays: 5 },
  { title: 'Post-launch monitoring',     column: 'LAUNCH_MONITOR', durationDays: 30 },
]

function toDateInput(v: unknown): string {
  if (v == null) return ''
  const ms = typeof v === 'number' ? v
    : typeof v === 'string' ? Date.parse(v)
    : (v as { toDate?: () => Date })?.toDate?.().getTime() ?? NaN
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

interface Props {
  task:      TaskDoc | null      // null → create
  products:  { id: string; name: string }[]
  assignees: { uid: string; name: string }[]
  actor:     { uid: string; name: string }
  onClose:   () => void
}

export function TaskEditDialog({ task, products, assignees, actor, onClose }: Props) {
  const editing = !!task
  const [title, setTitle]       = useState(task?.title ?? '')
  const [column, setColumn]     = useState<TaskColumn>(task?.column ?? 'IDEATION')
  const [productId, setProductId] = useState(task?.productId ?? '')
  const [assigneeUid, setAssigneeUid] = useState(task?.assignee?.uid ?? '')
  const [dueDate, setDueDate]   = useState(toDateInput(task?.dueAt))
  const [duration, setDuration] = useState<string>(task?.durationDays != null ? String(task.durationDays) : '')
  const [busy, setBusy]         = useState(false)

  // People options: unassigned, me, then everyone already on the board (deduped).
  const people = [
    { uid: actor.uid, name: `${actor.name} (me)` },
    ...assignees.filter(a => a.uid !== actor.uid),
  ]

  function applyTemplate(t: string) {
    const tpl = TASK_TEMPLATES.find(x => x.title === t)
    if (!tpl) return
    setTitle(tpl.title); setColumn(tpl.column); setDuration(String(tpl.durationDays))
  }

  async function save() {
    const name = title.trim()
    if (!name) { toast.error('Give the task a title.'); return }
    setBusy(true)
    const assignee = assigneeUid
      ? { uid: assigneeUid, name: assigneeUid === actor.uid ? actor.name : (assignees.find(a => a.uid === assigneeUid)?.name ?? 'Unknown') }
      : null
    const dueAt = dueDate ? new Date(dueDate + 'T00:00:00').toISOString() : null
    const durationDays = duration.trim() ? Math.max(0, Math.round(Number(duration))) : null
    const data = { title: name, column, productId: productId || null, assignee, dueAt, durationDays }
    try {
      if (editing) {
        await adapter.db.mutate({
          op: 'update', path: `tasks/${task!.id}`, data,
          entityType: 'task', productId: productId || undefined, actor, expectedRev: task!.rev,
        })
        toast.success('Task updated')
      } else {
        const id = `task-${Date.now()}`
        await adapter.db.mutate({
          op: 'create', path: `tasks/${id}`,
          data: { ...data, checklist: [], order: Date.now(), done: false },
          entityType: 'task', productId: productId || undefined, actor,
        })
        toast.success('Task created')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Save failed')
      setBusy(false)
    }
  }

  const selectCls = 'h-9 w-full px-2.5 rounded-[8px] bg-surface border text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25'

  return (
    <Dialog open onClose={onClose} title={editing ? 'Edit task' : 'New task'}>
      <div className="flex flex-col gap-3.5">
        {!editing && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-dim">Start from a template</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }} defaultValue=""
              onChange={e => applyTemplate(e.target.value)}>
              <option value="">Blank task…</option>
              {TASK_TEMPLATES.map(t => <option key={t.title} value={t.title}>{t.title} · {t.durationDays}d</option>)}
            </select>
          </label>
        )}

        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Market research" autoFocus />

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-dim">Stage</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }} value={column} onChange={e => setColumn(e.target.value as TaskColumn)}>
              {TASK_COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-dim">Product</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }} value={productId} onChange={e => setProductId(e.target.value)}>
              <option value="">Unassigned</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-dim">Assignee</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }} value={assigneeUid} onChange={e => setAssigneeUid(e.target.value)}>
              <option value="">Unassigned</option>
              {people.map(p => <option key={p.uid} value={p.uid}>{p.name}</option>)}
            </select>
          </label>
          <Input label="Duration (days)" type="number" min={0} value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. 5" />
        </div>

        <Input label="Due date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>{editing ? 'Save' : 'Create task'}</Button>
        </div>
      </div>
    </Dialog>
  )
}
