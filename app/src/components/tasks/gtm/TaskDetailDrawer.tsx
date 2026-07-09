// TaskDetailDrawer — the contextual task-detail slide-over that replaces the thin edit
// dialog. Built on the shared Drawer primitive (right-side panel, focus-trapped, Esc-close,
// focus restored to the trigger, reduced-motion-safe). It shows every task field; EDITOR+
// edits them and each save funnels through the atomic mutate() seam (commitTaskEdits),
// writing ONLY changed fields with an optimistic-lock rev. A stale save NEVER overwrites:
// the conflict surfaces and the panel reloads the latest. VIEWER sees the identical panel
// fully read-only. Below the fields, a single resolved artifact lens over the linked product
// (+ a grounded briefing) renders only when the project links a product — otherwise an
// honest empty state.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../../lib/backend'
import { ProductProvider } from '../../../context/ProductContext'
import { Drawer, Input, Button, Badge } from '../../ui'
import { IconLink, IconCheck, IconInfo, IconWarning } from '../../ui/icons'
import type { TaskColumn, TypeOfWork } from '@pf/shared'
import { GTM_COLUMNS, GTM_PHASES, WORK_TYPES, fmtShort, columnLabel, type TaskDoc, type ProjectDoc } from './gtm'
import { formFromTask, diffTaskEdits, commitTaskEdits, type TaskEditForm } from './taskEdits'
import { resolveTaskEnrichment } from './taskLens'
import { TaskLensPanel } from './TaskLensPanel'
import { TaskBriefing } from './TaskBriefing'

const selectCls = 'h-9 w-full px-2.5 rounded-[10px] bg-surface border text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25'
const inputBorder = { borderColor: 'var(--color-border-strong)' }

interface Props {
  task:    TaskDoc
  project: ProjectDoc
  canEdit: boolean
  actor:   { uid: string; name: string } | null
  onClose: () => void
}

export function TaskDetailDrawer({ task, project, canEdit, actor, onClose }: Props) {
  const navigate = useNavigate()
  const readOnly = !canEdit || !actor

  // The stable edit baseline: the snapshot the form diffs against AND the source of
  // expectedRev. The parent keys this drawer by task id, so it is fresh per task. The live
  // `task` prop is used only to detect a concurrent change and to reload after a conflict —
  // never to advance expectedRev underneath the user (which would silently overwrite).
  const [baseTask, setBaseTask] = useState<TaskDoc>(task)
  const [form, setForm] = useState<TaskEditForm>(() => formFromTask(task))
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)

  const dirty = useMemo(() => diffTaskEdits(baseTask, form) !== null, [baseTask, form])
  const staleFromLive = task.rev !== baseTask.rev && !conflict

  const enrichment = useMemo(() => resolveTaskEnrichment(project, task), [project, task])

  function set<K extends keyof TaskEditForm>(k: K, v: TaskEditForm[K]) { setForm(f => ({ ...f, [k]: v })) }

  // Deep-link into a product editor: close the panel, then navigate.
  function go(to: string) { onClose(); navigate(to) }

  async function reloadToLatest() {
    let latest = task
    if (task.rev === baseTask.rev) {
      const fresh = await adapter.db.get<TaskDoc>(`tasks/${baseTask.id}`).catch(() => null)
      if (fresh) latest = { ...(fresh as TaskDoc), id: baseTask.id }
    }
    setBaseTask(latest); setForm(formFromTask(latest))
  }

  async function save() {
    if (readOnly || !actor) return
    if (!form.title.trim()) { toast.error('Give the task a title.'); return }
    setBusy(true)
    try {
      const r = await commitTaskEdits({ task: baseTask, form, canEdit, actor, mutate: adapter.db.mutate })
      if (r === 'saved') { toast.success('Task updated'); onClose() }
      else if (r === 'noop') { onClose() }
    } catch (err) {
      if (err instanceof MutationConflictError) {
        setConflict(true)
        await reloadToLatest()
      } else {
        toast.error('Could not update task')
      }
    } finally {
      setBusy(false)
    }
  }

  // ── Checklist editing ──
  const checklist = form.checklist
  const setChecklist = (next: TaskEditForm['checklist']) => set('checklist', next)

  return (
    <Drawer open onClose={onClose} title="Task detail" width="w-[560px]">
      <div className="flex flex-col gap-5">
        {/* Conflict / staleness banners — never a silent overwrite */}
        {conflict && (
          <div role="alert" className="flex items-start gap-2 px-3 py-2.5 rounded-[10px] text-[12.5px] text-danger"
            style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-line)' }}>
            <IconWarning size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>This task changed since you opened it. It has been reloaded to the latest — review your changes and save again.</span>
          </div>
        )}
        {staleFromLive && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] text-[12px] text-dim"
            style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent-line)' }}>
            <span className="flex items-center gap-1.5"><IconInfo size={14} className="text-accent" aria-hidden="true" />Updated elsewhere.</span>
            <button type="button" onClick={() => void reloadToLatest()}
              className="font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
              Reload to latest
            </button>
          </div>
        )}

        {/* Origin + status */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge label={task.origin === 'adhoc' ? 'One-off' : 'Process task'} color={task.origin === 'adhoc' ? 'default' : 'purple'} />
          {readOnly
            ? <Badge label={form.done ? 'Done' : 'Open'} color={form.done ? 'good' : 'blue'} />
            : (
              <label className="inline-flex items-center gap-1.5 text-[12px] text-dim">
                <span className="font-medium">Status</span>
                <select value={form.done ? 'done' : 'open'} onChange={e => set('done', e.target.value === 'done')}
                  aria-label="Task status"
                  className="h-7 px-2 rounded-[8px] bg-surface border text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25" style={inputBorder}>
                  <option value="open">Open</option>
                  <option value="done">Done</option>
                </select>
              </label>
            )}
        </div>

        {/* Title */}
        {readOnly
          ? <h3 className="text-[15px] font-semibold text-text leading-snug">{form.title || '—'}</h3>
          : <Input label="Task" value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="e.g. Align pricing with reinsurance treaty" />}

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-3.5">
          <FieldWrap label="Phase (L2)">
            {/* Constrained to the canonical phase set so the launch runway (which groups
                segments by an exact phase-name match) can never break from a free-text typo. */}
            {readOnly ? <ReadValue v={form.phaseL2} />
              : <select className={selectCls} style={inputBorder} value={form.phaseL2}
                  onChange={e => set('phaseL2', e.target.value)} aria-label="Phase">
                  <option value="">—</option>
                  {!GTM_PHASES.some(p => p.name === form.phaseL2) && form.phaseL2 &&
                    <option value={form.phaseL2}>{form.phaseL2}</option>}
                  {GTM_PHASES.map(p => <option key={p.name} value={p.name}>{p.short}</option>)}
                </select>}
          </FieldWrap>
          <FieldWrap label="Group (L3)">
            {readOnly ? <ReadValue v={form.groupL3} />
              : <Input value={form.groupL3} onChange={e => set('groupL3', e.target.value)} placeholder="—" />}
          </FieldWrap>

          <FieldWrap label="Column">
            {readOnly ? <ReadValue v={columnLabel(form.column)} />
              : <select className={selectCls} style={inputBorder} value={form.column}
                  onChange={e => set('column', e.target.value as TaskColumn)} aria-label="Column">
                  {GTM_COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>}
          </FieldWrap>
          <FieldWrap label={task.ongoing ? 'Due date (ongoing)' : 'Due date'}>
            {readOnly ? <ReadValue v={form.dueDate ? fmtShort(form.dueDate) : (task.ongoing ? 'Ongoing' : '—')} />
              : <Input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />}
          </FieldWrap>

          <FieldWrap label="Owner role">
            {readOnly ? <ReadValue v={form.ownerRole} />
              : <Input value={form.ownerRole} onChange={e => set('ownerRole', e.target.value)} placeholder="Owner role" />}
          </FieldWrap>
          <FieldWrap label="Type of work">
            {readOnly ? <ReadValue v={form.typeOfWork} />
              : <select className={selectCls} style={inputBorder} value={form.typeOfWork}
                  onChange={e => set('typeOfWork', e.target.value as TypeOfWork)} aria-label="Type of work">
                  {WORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>}
          </FieldWrap>

          <FieldWrap label="SLA (business days)">
            {readOnly ? <ReadValue v={form.slaDays == null ? '—' : String(form.slaDays)} />
              : <Input type="number" min={0} value={form.slaDays ?? ''}
                  onChange={e => set('slaDays', e.target.value === '' ? null : Number(e.target.value))} placeholder="—" />}
          </FieldWrap>
        </div>

        {/* Checklist */}
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[.06em] text-faint">Checklist</span>
          {checklist.length === 0 && <p className="text-[12.5px] text-faint italic">No checklist items.</p>}
          <div className="flex flex-col gap-1.5">
            {checklist.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <button type="button" disabled={readOnly}
                  onClick={() => setChecklist(checklist.map((c, j) => j === i ? { ...c, done: !c.done } : c))}
                  aria-pressed={it.done} aria-label={it.done ? 'Mark item incomplete' : 'Mark item complete'}
                  className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center shrink-0 border text-white transition-all disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  style={{ background: it.done ? 'var(--gradient-accent)' : 'transparent', borderColor: it.done ? 'transparent' : 'var(--color-border-strong)' }}>
                  <IconCheck size={11} style={{ opacity: it.done ? 1 : 0 }} aria-hidden="true" />
                </button>
                {readOnly
                  ? <span className={`flex-1 text-[13px] ${it.done ? 'line-through text-faint' : 'text-dim'}`}>{it.t}</span>
                  : <>
                      <input value={it.t} onChange={e => setChecklist(checklist.map((c, j) => j === i ? { ...c, t: e.target.value } : c))}
                        placeholder="Checklist item"
                        className="flex-1 h-8 px-2 rounded-[8px] bg-surface border text-[13px] text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25" style={inputBorder} />
                      <button type="button" onClick={() => setChecklist(checklist.filter((_, j) => j !== i))}
                        aria-label="Remove item" className="w-7 h-7 rounded-[7px] text-faint hover:text-danger transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">×</button>
                    </>}
              </div>
            ))}
          </div>
          {!readOnly && (
            <button type="button" onClick={() => setChecklist([...checklist, { t: '', done: false }])}
              className="self-start text-[12px] font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
              + Add item
            </button>
          )}
        </div>

        {/* Actions (EDITOR+) or read-only note (VIEWER) */}
        {readOnly ? (
          <p className="text-[12px] text-faint flex items-center gap-1.5" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
            <IconInfo size={13} aria-hidden="true" />Read-only — you don't have edit access to this board.
          </p>
        ) : (
          <div className="flex items-center justify-end gap-2 pt-1" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy || !dirty}>Save changes</Button>
          </div>
        )}

        {/* ── Contextual artifact lens + grounded briefing ── */}
        <div className="flex flex-col gap-4 pt-1" style={{ borderTop: '1px dashed var(--color-border)', paddingTop: 18 }}>
          {enrichment.hasProduct && enrichment.productId ? (
            <ProductProvider pid={enrichment.productId}>
              <TaskLensPanel lens={enrichment.lens} pid={enrichment.productId} onNavigate={go} />
              <div className="pt-1" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
                <TaskBriefing task={task} pid={enrichment.productId} onNavigate={go} />
              </div>
            </ProductProvider>
          ) : (
            <div className="flex flex-col items-start gap-2 rounded-[12px] p-4"
              style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
              <span className="w-9 h-9 rounded-[10px] flex items-center justify-center text-dim bg-surface" style={{ border: '1px solid var(--color-border)' }}>
                <IconLink size={17} aria-hidden="true" />
              </span>
              <p className="text-[13px] font-semibold text-text">No product linked</p>
              <p className="text-[12.5px] text-dim leading-snug">
                Link a product to this project to see related coverages, forms, and rating — and to get a grounded briefing on what's left for this task.
              </p>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  )
}

// ─── Small field helpers ─────────────────────────────────────────────────────────

function FieldWrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[12px] font-medium text-dim">{label}</span>
      {children}
    </label>
  )
}

function ReadValue({ v }: { v: string }) {
  return <span className="text-[13.5px] text-text min-h-[20px]">{v || '—'}</span>
}
