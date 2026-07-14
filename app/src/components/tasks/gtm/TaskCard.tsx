// TaskCard — one board card, and CompletedRow — one row in the Completed section.
// A card shows the L4 title, its phase/group lineage (or a "One-off" badge), the owner
// role, a due date (overdue-red when past, an "Ongoing" pill for no-due governance) and a
// work-type colour chip. Completing a task moves it out of its column into Completed.
import { Badge } from '../../ui'
import { IconCheck } from '../../ui/icons'
import { fmtShort, workTypeBadge, columnLabel, isOverdue, dispositionMeta, type TaskDoc } from './gtm'

function initials(name?: string): string {
  if (!name) return '·'
  const words = name.replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '·'
}

function CalendarGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="opacity-70">
      <rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  )
}

/** The complete/reopen checkbox — token-driven, keyboard-reachable. */
function CheckBox({ done, onToggle, size = 19, label }: { done: boolean; onToggle: () => void; size?: number; label: string }) {
  return (
    <button
      type="button" onClick={onToggle} aria-pressed={done} title={label} aria-label={label}
      className="rounded-[6px] flex items-center justify-center shrink-0 border text-white transition-all focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      style={{
        width: size, height: size, marginTop: 1,
        background: done ? 'var(--gradient-accent)' : 'transparent',
        borderColor: done ? 'transparent' : 'var(--color-border-strong)',
      }}
    >
      <IconCheck size={Math.round(size * 0.62)} style={{ opacity: done ? 1 : 0 }} aria-hidden="true" />
    </button>
  )
}

export function TaskCard({ task, canEdit, todayIso, arriving, dragHandle, onToggle, onOpen }: {
  task: TaskDoc; canEdit: boolean; todayIso: string; arriving?: boolean
  /** Optional drag affordance (grip) rendered top-right — supplied by the board's DnD wrapper. */
  dragHandle?: React.ReactNode
  onToggle: (t: TaskDoc) => void; onOpen: (t: TaskDoc) => void
}) {
  const overdue = isOverdue(task, todayIso)
  const wt = workTypeBadge(task.typeOfWork)
  const disp = dispositionMeta(task.disposition)
  const lineage = task.origin === 'adhoc'
    ? null
    : [task.phaseL2, task.groupL3].filter(Boolean).join(' / ')

  return (
    <div
      className={`group bg-surface rounded-[11px] p-3 flex gap-2.5 rise-in transition-shadow hover:shadow-[var(--shadow-card-hover)] focus-within:shadow-[var(--shadow-card-hover)]${arriving ? ' task-arrive' : ''}`}
      style={{
        border: '1px solid var(--color-border)',
        // 4E tint: a subtle left stripe in the disposition's token (Embrace/Elevate/Enhance).
        borderLeft: disp ? `3px solid ${disp.token}` : '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Complete/reopen — EDITOR+ only. Sibling of the open button (never nested). */}
      {canEdit
        ? <CheckBox done={!!task.done} onToggle={() => onToggle(task)} label="Mark complete" />
        : <span className="w-[19px] shrink-0" aria-hidden="true" />}

      {/* Card body — opens the task-detail slide-over. A real button, so Enter/Space and
          focus-visible work for free; VIEWER opens the identical (read-only) panel. */}
      <button type="button" onClick={() => onOpen(task)} aria-label={`Open task: ${task.title}`}
        className="flex-1 min-w-0 text-left rounded-[8px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0 text-[13px] font-medium leading-snug text-text">{task.title}</div>
        </div>

        {task.origin === 'adhoc'
          ? <span className="inline-block mt-1.5 text-[9.5px] font-bold uppercase tracking-[.05em] text-faint rounded-[5px] px-1.5 py-0.5"
              style={{ border: '1px solid var(--color-border)' }}>One-off</span>
          : lineage && <div className="text-[10.5px] text-faint font-semibold mt-1.5 truncate">{lineage}</div>}

        <div className="flex items-center flex-wrap gap-2 mt-2.5">
          {task.ownerRole && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-dim font-medium min-w-0">
              <span className="w-[15px] h-[15px] rounded-full grid place-items-center text-[8px] font-bold shrink-0"
                style={{ background: 'var(--color-chip)', color: 'var(--color-dim)' }}>{initials(task.ownerRole)}</span>
              <span className="truncate max-w-[120px]">{task.ownerRole}</span>
            </span>
          )}
          {task.ongoing ? (
            <span className="text-[11px] font-semibold rounded-[6px] px-1.5 py-0.5 bg-accent-soft text-accent">Ongoing</span>
          ) : task.dueAt ? (
            // Overdue reads calm: a soft danger pill, not shouting red text.
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${overdue ? 'text-danger rounded-[6px] px-1.5 py-0.5' : 'text-dim'}`}
              style={overdue ? { background: 'var(--color-danger-soft)' } : undefined}>
              <CalendarGlyph />{fmtShort(task.dueAt)}{overdue ? ' · overdue' : ''}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-1.5">
            {disp && (
              <span title={`4E disposition: ${disp.label}`}
                className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-[5px] px-1.5 py-0.5"
                style={{ background: disp.soft, color: disp.token }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: disp.token }} aria-hidden="true" />
                {disp.label}
              </span>
            )}
            <Badge label={wt.label} color={wt.color} className="text-[10px]" />
          </span>
        </div>
      </button>

      {/* Drag affordance — visible on hover/focus so the card invites moving. */}
      {dragHandle}
    </div>
  )
}

export function CompletedRow({ task, canEdit, onToggle, onOpen }: {
  task: TaskDoc; canEdit: boolean; onToggle: (t: TaskDoc) => void; onOpen: (t: TaskDoc) => void
}) {
  const tag = task.origin === 'adhoc' ? 'One-off' : (task.phaseL2?.replace(/^Product /, '') ?? columnLabel(task.column))
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-[11px] rise-in"
      style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
      {canEdit
        ? <CheckBox done onToggle={() => onToggle(task)} size={17} label="Reopen task" />
        : <span className="w-[17px] shrink-0" aria-hidden="true" />}
      <button type="button" onClick={() => onOpen(task)} aria-label={`Open task: ${task.title}`}
        className="flex-1 min-w-0 text-left text-[12.5px] text-dim line-through truncate rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        {task.title}
      </button>
      <span className="text-[10.5px] text-faint font-semibold whitespace-nowrap">{tag}</span>
      <span className="text-[11px] text-faint font-semibold whitespace-nowrap">{fmtShort(task.completedAt)}</span>
    </div>
  )
}
