// taskEdits — the pure edit model behind the task-detail slide-over: a serialisable form
// snapshot, a CHANGED-fields-only diff builder, and a thin commit that funnels through the
// injected atomic mutate() (never a bare write). Kept out of the component so the save path
// — "only the changed fields", the VIEWER guard, and the optimistic-lock conflict — is unit
// tested in node without a DOM. The slide-over passes adapter.db.mutate as `mutate`.
import type { TaskColumn, TypeOfWork } from '@pf/shared'
import type { MutationPayload } from '../../../lib/backend/types'
import { toMillis, type TaskDoc } from './gtm'

export interface ChecklistItem { t: string; done: boolean }

/** The editable projection of a board task — every field the slide-over exposes. Process
 *  lineage (phase/group/SLA) is editable too, but the diff only writes what actually moved,
 *  so a seeded task keeps its back-schedule unless the PM deliberately changes it. */
export interface TaskEditForm {
  title:      string
  phaseL2:    string
  groupL3:    string
  column:     TaskColumn
  ownerRole:  string
  typeOfWork: TypeOfWork
  slaDays:    number | null
  dueDate:    string            // ISO yyyy-mm-dd, or '' for none
  done:       boolean
  checklist:  ChecklistItem[]
}

/** A stored dueAt (ISO `yyyy-mm-dd`, or a legacy Timestamp/millis) → a date-input value. */
export function toDateInput(v: unknown): string {
  if (typeof v === 'string') return v.slice(0, 10)
  const ms = toMillis(v)
  if (ms == null) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The baseline form snapshot for a task — what the slide-over loads, and the reference the
 *  diff compares against so an untouched field is never written. */
export function formFromTask(task: TaskDoc): TaskEditForm {
  return {
    title:      task.title ?? '',
    phaseL2:    task.phaseL2 ?? '',
    groupL3:    task.groupL3 ?? '',
    column:     task.column,
    ownerRole:  task.ownerRole ?? '',
    typeOfWork: (task.typeOfWork as TypeOfWork) ?? 'Differentiating',
    slaDays:    typeof task.slaDays === 'number' ? task.slaDays : null,
    dueDate:    toDateInput(task.dueAt),
    done:       !!task.done,
    checklist:  (task.checklist ?? []).map(c => ({ t: c.t, done: !!c.done })),
  }
}

const checklistEqual = (a: ChecklistItem[], b: ChecklistItem[]) =>
  a.length === b.length && a.every((it, i) => it.t === b[i]!.t && it.done === b[i]!.done)

/**
 * Build the partial update for a task edit: ONLY the fields that changed vs. the task's
 * current state. Returns null when nothing changed (so the caller writes nothing). Mirrors
 * the seeded/adhoc rules of the old dialog — a one-off task keeps title and taskL4 in sync;
 * toggling done stamps/clears completedAt.
 */
export function diffTaskEdits(task: TaskDoc, form: TaskEditForm): Record<string, unknown> | null {
  const base = formFromTask(task)
  const data: Record<string, unknown> = {}

  const title = form.title.trim()
  if (title !== base.title.trim()) {
    data.title = title
    if (task.origin === 'adhoc') data.taskL4 = title   // one-off: L4 mirrors the title
  }
  if (form.phaseL2.trim() !== base.phaseL2.trim()) data.phaseL2 = form.phaseL2.trim() || null
  if (form.groupL3.trim() !== base.groupL3.trim()) data.groupL3 = form.groupL3.trim() || null
  if (form.column !== base.column) data.column = form.column
  if (form.ownerRole.trim() !== base.ownerRole.trim()) data.ownerRole = form.ownerRole.trim() || 'Unassigned'
  if (form.typeOfWork !== base.typeOfWork) data.typeOfWork = form.typeOfWork

  const sla = typeof form.slaDays === 'number' && Number.isFinite(form.slaDays) ? form.slaDays : null
  if (sla !== base.slaDays) data.slaDays = sla

  if (form.dueDate !== base.dueDate) data.dueAt = form.dueDate || null

  if (form.done !== base.done) {
    data.done = form.done
    data.completedAt = form.done ? new Date().toISOString() : null
  }

  if (!checklistEqual(form.checklist, base.checklist))
    data.checklist = form.checklist.map(c => ({ t: c.t, done: !!c.done }))

  return Object.keys(data).length ? data : null
}

export type CommitResult = 'saved' | 'noop' | 'forbidden'

/**
 * Commit a task edit through the atomic mutate() seam. Enforces the role gate FIRST
 * (a VIEWER never reaches a write), writes ONLY the changed fields, and passes expectedRev
 * so a stale edit rejects with MutationConflictError — which propagates so the caller can
 * surface the conflict and reload instead of silently overwriting. `mutate` is injected
 * (adapter.db.mutate in the app) so this path is unit-testable.
 */
export async function commitTaskEdits(args: {
  task:    TaskDoc
  form:    TaskEditForm
  canEdit: boolean
  actor:   { uid: string; name: string }
  mutate:  (m: MutationPayload) => Promise<void>
}): Promise<CommitResult> {
  if (!args.canEdit) return 'forbidden'          // VIEWER read-only — no write is reachable
  const data = diffTaskEdits(args.task, args.form)
  if (!data) return 'noop'
  await args.mutate({
    op: 'update', path: `tasks/${args.task.id}`, entityType: 'task',
    productId: args.task.productId, actor: args.actor, expectedRev: args.task.rev, data,
  })
  return 'saved'
}
