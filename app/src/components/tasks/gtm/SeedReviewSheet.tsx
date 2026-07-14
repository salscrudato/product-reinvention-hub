// SeedReviewSheet — the Review → Adjust → Seed surface that replaces the old phase-checkbox
// modal. A PM sees every process task before it lands: phases as collapsible groups, each
// Level-4 task a row with owner, duration, work-type and a computed date range. Everything is
// selected up front; deselect at task or phase level. A live header recomputes task count,
// critical path, start and landing date instantly. Scheduling is FORWARD-ONLY — nothing lands
// before tomorrow; an impossible deadline resolves inline (move it, or cut scope) rather than
// scheduling into the past. Owner + duration are editable inline and preserved onto the tasks.
// On confirm, ONLY the not-yet-present rows are created (idempotent by seedRefId) in one atomic,
// audited batch through adapter.db.mutateBatch(); a moved deadline is persisted alongside.
import { useMemo, useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../../lib/backend'
import { conflictToast } from '../../../lib/conflict'
import { Drawer, Button, Badge } from '../../ui'
import { IconCheck, IconWarning, IconChevronDown } from '../../ui/icons'
import {
  GTM_PROCESS_TEMPLATE, seedRefIdFor, addBusinessDays, subtractBusinessDays, toISODate,
  type PlanOverride, type GtmTemplateTask,
} from '@pf/shared'
import {
  GTM_PHASES, workTypeBadge, fmtShort, todayISO, buildSeedPlanPayloads,
  type ProjectDoc, type TaskDoc,
} from './gtm'
import { computeReviewPlan, presentSeedRefIds, allSeedRefIds } from './seedReview'

interface Props {
  project:     ProjectDoc
  priorSeeded: TaskDoc[]
  actor:       { uid: string; name: string }
  onClose:     () => void
  /** Called after a successful seed with the batch id + how many tasks landed. */
  onSeeded:    (batchId: string, count: number) => void
}

export function SeedReviewSheet({ project, priorSeeded, actor, onClose, onSeeded }: Props) {
  const present = useMemo(() => presentSeedRefIds(priorSeeded), [priorSeeded])
  const [selected, setSelected] = useState<Set<string>>(() => allSeedRefIds(GTM_PROCESS_TEMPLATE))
  const [businessDays, setBusinessDays] = useState(true)
  const [deadline, setDeadline] = useState(project.targetLaunchDate)
  const [overrides, setOverrides] = useState<Record<string, PlanOverride>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  const overridesKey = JSON.stringify(overrides)
  const selectedKey = [...selected].sort().join('|')
  const review = useMemo(
    () => computeReviewPlan({
      template: GTM_PROCESS_TEMPLATE, selected, present, deadline,
      options: { today: todayISO(), businessDays, overrides },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKey, present, deadline, businessDays, overridesKey],
  )
  const { plan } = review
  const missingDeadline = !deadline
  const tooTight = !plan.fits && !missingDeadline
  const canSeed = review.newCount > 0 && plan.fits && !busy
  // Why Seed is disabled, in plain language — ALWAYS shown inline beside the button
  // (root cause of the "silently greyed-out Seed": a missing deadline, or a fits
  // failure with no pre-launch warning row, used to render no explanation at all).
  const seedBlockReason = busy ? null
    : review.newCount === 0
      ? (present.size > 0 ? 'Everything is already on the board.' : 'Select at least one task to seed.')
      : missingDeadline
        ? 'Set a launch deadline above to schedule the plan.'
        : !plan.fits
          ? `Deadline too tight — needs ${plan.warnings[0]?.neededDays ?? plan.criticalPathDays} ${businessDays ? 'business' : 'calendar'} days (earliest launch ${fmtShort(plan.earliestLaunch)}).`
          : null

  // Row lookup for computed dates (only selected rows are in the plan).
  const planByRef = useMemo(() => new Map(plan.tasks.map(t => [t.seedRefId, t])), [plan])

  // ── Selection helpers ──
  function toggleTask(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function setPhase(phase: string, on: boolean) {
    const ids = GTM_PROCESS_TEMPLATE.filter(t => t.phaseL2 === phase).map(seedRefIdFor)
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) {
        if (present.has(id)) continue
        if (on) next.add(id); else next.delete(id)
      }
      return next
    })
  }
  function setOverride(id: string, patch: Partial<PlanOverride>) {
    setOverrides(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }
  const toggleCollapse = (phase: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(phase)) next.delete(phase); else next.add(phase)
      return next
    })

  // ── Deadline controls (forward-only nudges) ──
  const nudge = (dir: -1 | 1) =>
    setDeadline(d => toISODate(dir === 1 ? addBusinessDays(d, 1, businessDays) : subtractBusinessDays(d, 1, businessDays)))
  const moveDeadlineToEarliest = () => setDeadline(plan.earliestLaunch)

  async function confirm() {
    if (!canSeed) return
    setBusy(true)
    const batchId = String(Date.now())
    const deadlineUpdate = deadline !== project.targetLaunchDate ? deadline : null
    try {
      await adapter.db.mutateBatch(buildSeedPlanPayloads({ project, toCreate: review.toCreate, seedBatchId: batchId, actor, deadlineUpdate }))
      onSeeded(batchId, review.newCount)
      onClose()
    } catch (err) {
      if (err instanceof MutationConflictError) conflictToast({})
      else toast.error('Could not seed the board')
      setBusy(false)
    }
  }

  return (
    <Drawer open onClose={onClose} title="Review launch plan" width="w-[880px]">
      {/* ── Sticky live header ── */}
      <div className="sticky top-0 z-10 -mx-6 -mt-6 px-6 pt-5 pb-4 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <p className="text-[12.5px] text-dim mb-3">
          Every task in the insurance product process, back-scheduled to land on your deadline.
          Cut what you don’t need — the plan updates as you go.
        </p>
        <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
          <Metric
            value={present.size > 0 ? String(review.newCount) : String(review.selectedCount)}
            label={present.size > 0 ? 'To add' : 'Tasks'} accent
          />
          <Metric value={`${plan.criticalPathDays}`} unit={businessDays ? 'business days' : 'days'} label="Critical path" />
          <Metric value={fmtShort(plan.projectStartDate) || '—'} label="Starts" />
          <Metric value={fmtShort(plan.landingDate) || '—'} label={plan.fits ? 'Lands on launch' : 'Earliest launch'} danger={!plan.fits} />
          {present.size > 0 && (
            <span className="text-[11.5px] text-faint font-medium ml-auto self-center">
              {review.presentCount} already on the board
            </span>
          )}
        </div>

        {/* Deadline + working-time controls */}
        <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
          <label className="flex items-center gap-2 text-[12px] font-semibold text-dim">
            Launch deadline
            <input type="date" value={deadline} onChange={e => e.target.value && setDeadline(e.target.value)}
              aria-label="Launch deadline"
              className="h-8 px-2 rounded-[9px] bg-raised text-[12.5px] text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              style={{ border: '1px solid var(--color-border)' }} />
          </label>
          <div className="flex items-center rounded-[9px] bg-raised" style={{ border: '1px solid var(--color-border)' }}>
            <NudgeButton label="Pull deadline one day earlier" onClick={() => nudge(-1)}>−</NudgeButton>
            <span className="w-px h-4" style={{ background: 'var(--color-border)' }} aria-hidden="true" />
            <NudgeButton label="Push deadline one day later" onClick={() => nudge(1)}>+</NudgeButton>
          </div>
          <div className="flex gap-1 p-0.5 rounded-[9px] bg-raised ml-auto" style={{ border: '1px solid var(--color-border)' }}>
            {([['Business days', true], ['Calendar days', false]] as const).map(([label, val]) => (
              <button key={label} type="button" onClick={() => setBusinessDays(val)} aria-pressed={businessDays === val}
                className={`px-2.5 py-1 rounded-[7px] text-[11.5px] font-medium transition-colors ${
                  businessDays === val ? 'bg-surface text-text shadow-sm' : 'text-dim hover:text-text'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Phase groups ── */}
      <div className="flex flex-col gap-3 py-4">
        {GTM_PHASES.map(ph => {
          const rows = GTM_PROCESS_TEMPLATE.filter(t => t.phaseL2 === ph.name)
          if (rows.length === 0) return null
          const isOpen = !collapsed.has(ph.name)
          const newRows = rows.filter(t => !present.has(seedRefIdFor(t)))
          const selCount = newRows.filter(t => selected.has(seedRefIdFor(t))).length
          const phaseState: 'all' | 'some' | 'none' =
            newRows.length === 0 ? 'all' : selCount === newRows.length ? 'all' : selCount === 0 ? 'none' : 'some'
          return (
            <section key={ph.name} className="rounded-[12px] overflow-hidden transition-shadow hover:shadow-[var(--shadow-card)]" style={{ border: '1px solid var(--color-border)' }}>
              {/* Phase band — tint rail, name, live selection + duration chips */}
              <div className="relative flex items-center gap-2.5 pl-4 pr-3 py-2.5 bg-raised">
                <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: `var(${ph.cssVar})` }} aria-hidden="true" />
                <TriCheckbox
                  state={phaseState}
                  disabled={newRows.length === 0}
                  onChange={on => setPhase(ph.name, on)}
                  label={`Select all ${ph.name} tasks`}
                />
                <button type="button" onClick={() => toggleCollapse(ph.name)} aria-expanded={isOpen}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left rounded-[7px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                  <IconChevronDown size={14} className="transition-transform duration-200 shrink-0 text-faint" style={{ transform: isOpen ? 'none' : 'rotate(-90deg)' }} aria-hidden="true" />
                  <span className="text-[13px] font-semibold text-text truncate">{ph.name}</span>
                </button>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[10.5px] font-semibold tabular-nums bg-surface text-dim whitespace-nowrap" style={{ border: '1px solid var(--color-border)' }}>
                  {newRows.length === 0 ? 'all on board' : `${selCount}/${newRows.length} selected`}
                </span>
                <span className="text-[10.5px] font-semibold text-faint tabular-nums whitespace-nowrap">
                  {ph.name === 'Product Governance & Monitoring' ? 'post-launch' : `${phaseDays(rows, overrides)}d`}
                </span>
              </div>
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--color-border)' }}>
                  {/* Column legend — names the editable columns so the grid reads at a glance */}
                  <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[.08em] text-faint select-none" style={{ borderBottom: '1px solid var(--color-border)' }} aria-hidden="true">
                    <span className="w-4 shrink-0" />
                    <span className="flex-1 min-w-0">Task</span>
                    <span className="w-[128px]">Owner</span>
                    <span className="w-[52px] text-right">Days</span>
                    <span className="hidden md:block w-[76px]">Type</span>
                    <span className="w-[112px] text-right">Schedule</span>
                  </div>
                  {rows.map(t => {
                    const id = seedRefIdFor(t)
                    const onBoard = present.has(id)
                    const planned = planByRef.get(id)
                    return (
                      <TaskRow
                        key={id} task={t} onBoard={onBoard}
                        selected={selected.has(id)} planned={planned}
                        ownerValue={overrides[id]?.owner ?? t.owner}
                        durationValue={overrides[id]?.slaDays ?? t.slaDays}
                        onToggle={() => toggleTask(id)}
                        onOwner={v => setOverride(id, { owner: v })}
                        onDuration={v => setOverride(id, { slaDays: v })}
                      />
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {/* ── Sticky footer: resolution + actions ── */}
      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 px-6 py-4 bg-surface" style={{ borderTop: '1px solid var(--color-border)' }}>
        {(tooTight || (missingDeadline && review.newCount > 0)) && (
          <div className="flex flex-wrap items-center gap-2.5 mb-3 px-3 py-2.5 rounded-[11px] text-[12.5px]"
            style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-line)' }}>
            <IconWarning size={16} className="shrink-0 text-danger" aria-hidden="true" />
            <span className="text-danger font-medium flex-1 min-w-[220px]">
              {missingDeadline
                ? <>This project has no launch deadline yet — set one above to schedule the plan.</>
                : <>This plan needs {plan.warnings[0]?.neededDays ?? plan.criticalPathDays} {businessDays ? 'business' : 'calendar'} days. The earliest
                  you can launch is <b>{fmtShort(plan.earliestLaunch)}</b>.</>}
            </span>
            <Button variant="default" size="sm" onClick={moveDeadlineToEarliest}>
              {missingDeadline ? `Use earliest launch (${fmtShort(plan.earliestLaunch)})` : `Move deadline to ${fmtShort(plan.earliestLaunch)}`}
            </Button>
            {!missingDeadline && <span className="text-[11.5px] text-dim">or deselect phases to fit</span>}
          </div>
        )}
        <div className="flex items-center gap-3">
          <span
            className={`text-[12px] ${seedBlockReason && review.newCount > 0 ? 'text-danger font-medium' : 'text-faint'}`}
            role={seedBlockReason ? 'status' : undefined}
          >
            {seedBlockReason ?? (present.size > 0
              ? `${review.newCount} new task${review.newCount === 1 ? '' : 's'} · ${review.presentCount} kept`
              : `${review.newCount} task${review.newCount === 1 ? '' : 's'} ready to seed`)}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void confirm()} disabled={!canSeed}>
              <IconCheck size={14} aria-hidden="true" />
              {review.newCount > 0 ? `Seed ${review.newCount} task${review.newCount === 1 ? '' : 's'}` : 'Seed board'}
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  )
}

// ── Sum of the (possibly overridden) SLA for a phase's non-ongoing rows (display only). ──
function phaseDays(rows: GtmTemplateTask[], overrides: Record<string, PlanOverride>): number {
  return rows.filter(t => !t.ongoing).reduce((s, t) => {
    const ov = overrides[seedRefIdFor(t)]?.slaDays
    return s + (typeof ov === 'number' ? Math.max(0, Math.trunc(ov)) : t.slaDays)
  }, 0)
}

// ── One task row: select, name/group, inline owner + duration, work-type chip, date range. ──
function TaskRow({
  task, onBoard, selected, planned, ownerValue, durationValue, onToggle, onOwner, onDuration,
}: {
  task: GtmTemplateTask
  onBoard: boolean
  selected: boolean
  planned: { startDate: string | null; dueDate: string | null; ongoing: boolean } | undefined
  ownerValue: string
  durationValue: number
  onToggle: () => void
  onOwner: (v: string) => void
  onDuration: (v: number) => void
}) {
  const wt = workTypeBadge(task.typeOfWork || undefined)
  const dateLabel = !planned
    ? '—'
    : planned.ongoing
      ? 'Ongoing'
      : planned.startDate && planned.dueDate
        ? `${fmtShort(planned.startDate)} – ${fmtShort(planned.dueDate)}`
        : task.phaseOrder === 5 ? 'Post-launch' : '—'
  const editable = !onBoard && selected
  return (
    <div className={`group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-raised/60 ${onBoard ? 'opacity-60' : selected ? '' : 'opacity-75'}`}
      style={{ borderTop: '1px solid var(--color-border)' }}>
      {onBoard ? (
        <span title="Already on the board" className="w-[17px] h-[17px] rounded-[5px] grid place-items-center shrink-0"
          style={{ background: 'var(--color-good-soft)' }}>
          <IconCheck size={11} className="text-good" aria-hidden="true" />
        </span>
      ) : (
        <input type="checkbox" checked={selected} onChange={onToggle}
          aria-label={`Include: ${task.taskL4}`}
          className="w-4 h-4 accent-[var(--color-accent)] shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-text leading-snug truncate">{task.taskL4}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10.5px] text-faint font-semibold truncate">{task.groupL3}</span>
          {onBoard && <span className="text-[9.5px] font-bold uppercase tracking-[.04em] text-good">On board</span>}
        </div>
      </div>

      {/* Owner (editable role) */}
      {editable ? (
        <input value={ownerValue} onChange={e => onOwner(e.target.value)} aria-label={`Owner for ${task.taskL4}`}
          className="hidden sm:block w-[128px] h-7 px-2 rounded-[7px] bg-surface text-[11.5px] text-text truncate transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 hover:border-[color:var(--color-accent-line)]"
          style={{ border: '1px solid var(--color-border)' }} />
      ) : (
        <span className="hidden sm:block w-[128px] text-[11.5px] text-dim truncate">{ownerValue}</span>
      )}

      {/* Duration (editable business/calendar days) */}
      {editable && !task.ongoing ? (
        <label className="hidden sm:flex items-center gap-1 shrink-0" title="Duration (days)">
          <input type="number" min={0} value={durationValue}
            onChange={e => onDuration(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
            aria-label={`Duration in days for ${task.taskL4}`}
            className="w-12 h-7 px-1.5 rounded-[7px] bg-raised text-[11.5px] text-text text-right tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            style={{ border: '1px solid var(--color-border)' }} />
          <span className="text-[10.5px] text-faint">d</span>
        </label>
      ) : (
        <span className="hidden sm:block w-[52px] text-[11px] text-faint text-right tabular-nums shrink-0">
          {task.ongoing ? '—' : `${durationValue}d`}
        </span>
      )}

      <Badge label={wt.label} color={wt.color} className="text-[10px] hidden md:inline-flex" />
      <span className="w-[112px] text-[11px] font-semibold text-dim text-right tabular-nums shrink-0">{dateLabel}</span>
    </div>
  )
}

// ── Small presentational bits ──
function Metric({ value, unit, label, accent, danger }: {
  value: string; unit?: string; label: string; accent?: boolean; danger?: boolean
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className="text-[20px] font-bold tracking-tight tabular-nums"
          style={{ color: danger ? 'var(--color-danger)' : accent ? 'var(--color-accent-strong)' : 'var(--color-text)' }}>
          {value}
        </span>
        {unit && <span className="text-[11px] font-semibold text-faint">{unit}</span>}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-[.06em] text-faint mt-0.5">{label}</div>
    </div>
  )
}

function NudgeButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="w-8 h-8 grid place-items-center text-[15px] font-semibold text-dim hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
      {children}
    </button>
  )
}

/** A tri-state (all / some / none) checkbox for phase-level select-all. */
function TriCheckbox({ state, disabled, onChange, label }: {
  state: 'all' | 'some' | 'none'; disabled?: boolean; onChange: (on: boolean) => void; label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some' }, [state])
  return (
    <input ref={ref} type="checkbox" checked={state === 'all'} disabled={disabled}
      onChange={e => onChange(e.target.checked)} aria-label={label}
      className="w-4 h-4 accent-[var(--color-accent)] shrink-0 disabled:opacity-40" />
  )
}
