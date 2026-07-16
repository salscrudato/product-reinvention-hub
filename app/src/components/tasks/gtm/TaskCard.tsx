// TaskCard — one board card, and CompletedRow — one row in the Completed section.
// The card leads with ONE clear main step (the L4 title); identity chips (phase, 4E
// disposition, work type) sit on a quiet second line; owner / due / checklist progress
// on a third; and back-scheduled tasks close with a runway micro-bar reading how far
// through their start→due window they are. The L2/L3 lineage detail lives in the task
// drawer (keyboard-operable, focus-trapped) — never a nested wall on the card. The
// card's left edge carries the board's per-project accent (--proj-accent, scoped by
// the board root; every color a token).
import { Badge } from '../../ui'
import { IconCheck, IconCalendar, IconList } from '../../ui/icons'
import {
  fmtShort, workTypeBadge, columnLabel, isOverdue, dispositionMeta, elapsedFraction,
  GTM_PHASES, type TaskDoc,
} from './gtm'

function initials(name?: string): string {
  if (!name) return '·'
  const words = name.replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '·'
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
  const phase = task.phaseL2 ? GTM_PHASES.find(p => p.name === task.phaseL2) ?? null : null
  const checklistDone = task.checklist?.filter(c => c.done).length ?? 0
  const checklistTotal = task.checklist?.length ?? 0
  const runway = task.ongoing || task.done ? null : elapsedFraction(task.startDate, task.dueAt, todayIso)

  return (
    <div
      className={`group bg-surface rounded-[11px] p-3 flex gap-2.5 rise-in transition-shadow hover:shadow-[var(--shadow-card-hover)] focus-within:shadow-[var(--shadow-card-hover)]${arriving ? ' task-arrive' : ''}`}
      style={{
        border: '1px solid var(--color-border)',
        // The organizing signal: the board's per-project accent on every card's left edge.
        borderLeft: '3px solid var(--proj-accent, var(--color-accent))',
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
        {/* Main step — the one thing this card asks of the reader. */}
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0 text-[13px] font-semibold leading-snug text-text">{task.title}</div>
        </div>

        {/* Identity chips: phase (L2) or One-off · 4E disposition · work type. */}
        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          {task.origin === 'adhoc' ? (
            <span className="inline-block text-[9.5px] font-bold uppercase tracking-[.05em] text-faint rounded-[5px] px-1.5 py-0.5"
              style={{ border: '1px solid var(--color-border)' }}>One-off</span>
          ) : phase ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-dim rounded-[5px] px-1.5 py-0.5 bg-raised"
              title={`Phase: ${phase.name}`} style={{ border: '1px solid var(--color-border)' }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: `var(${phase.cssVar})` }} aria-hidden="true" />
              {phase.short}
            </span>
          ) : task.phaseL2 ? (
            <span className="text-[10px] font-semibold text-faint truncate max-w-[140px]">{task.phaseL2}</span>
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

        {/* Meta: owner · due (overdue calm, ongoing pill) · checklist progress. */}
        <div className="flex items-center flex-wrap gap-2 mt-2">
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
              <IconCalendar size={11} className="opacity-70" aria-hidden="true" />
              {fmtShort(task.dueAt)}{overdue ? ' · overdue' : ''}
            </span>
          ) : null}
          {checklistTotal > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-dim tabular-nums"
              aria-label={`Checklist: ${checklistDone} of ${checklistTotal} done`}
              title={`Checklist: ${checklistDone}/${checklistTotal} done`}>
              <IconList size={11} className="opacity-70" aria-hidden="true" />
              {checklistDone}/{checklistTotal}
            </span>
          )}
        </div>

        {/* Runway micro-bar — how far through its back-scheduled start→due window this
            task is. The fill edge IS the today read; no animation (reduced-motion-free). */}
        {runway != null && (
          <span
            role="img"
            aria-label={`Task window ${fmtShort(task.startDate)} to ${fmtShort(task.dueAt)}, ${Math.round(runway * 100)}% elapsed`}
            title={`${fmtShort(task.startDate)} → ${fmtShort(task.dueAt)} · ${Math.round(runway * 100)}% of the window elapsed`}
            className="block mt-2.5 h-[3px] rounded-full overflow-hidden"
            style={{ background: 'var(--color-chip)' }}
          >
            <span className="block h-full rounded-full" style={{
              width: `${runway * 100}%`,
              background: overdue ? 'var(--color-danger)' : 'var(--proj-accent, var(--color-accent))',
            }} />
          </span>
        )}
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
