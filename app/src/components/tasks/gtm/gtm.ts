// GTM launch-tracker client helpers — the small, mostly-pure glue between the shared
// scheduler/process (in @pf/shared) and the board UI: column ↔ TaskColumn mapping,
// work-type + phase colour metadata (design tokens only), date coercion, and the
// mutate() payload builders for seeding + completing tasks. Kept out of the components
// so the board, dialogs and runway all agree on one vocabulary.
import type {
  Task, Project, TaskColumn, TypeOfWork, Disposition, ScheduledTask, GtmBoardColumn,
} from '@pf/shared'
import type { MutationPayload } from '../../../lib/backend/types'

export type TaskDoc    = Task & { id: string }
export type ProjectDoc = Project & { id: string }

// ─── Columns ───────────────────────────────────────────────────────────────────
// The four board columns. `bar` is the accent stripe (reusing existing brand tokens,
// no new hex): violet → deep violet → amber → blue, left to right.
export interface ColumnDef { id: TaskColumn; label: string; board: GtmBoardColumn; bar: string }
export const GTM_COLUMNS: ColumnDef[] = [
  { id: 'IDEATION',       label: 'Ideation & Design', board: 'IDEATION & DESIGN', bar: 'var(--color-accent-bright)' },
  { id: 'BUILD_FILE',     label: 'Build & File',      board: 'BUILD & FILE',      bar: 'var(--color-accent-strong)' },
  { id: 'TEST_APPROVE',   label: 'Test & Approve',    board: 'TEST & APPROVE',    bar: 'var(--color-peril)' },
  { id: 'LAUNCH_MONITOR', label: 'Launch & Monitor',  board: 'LAUNCH & MONITOR',  bar: 'var(--color-info)' },
]
const BOARD_TO_COLUMN: Record<GtmBoardColumn, TaskColumn> = {
  'IDEATION & DESIGN': 'IDEATION', 'BUILD & FILE': 'BUILD_FILE',
  'TEST & APPROVE': 'TEST_APPROVE', 'LAUNCH & MONITOR': 'LAUNCH_MONITOR',
}
export const columnLabel = (id: TaskColumn) => GTM_COLUMNS.find(c => c.id === id)?.label ?? id

// ─── Work-type chips ─────────────────────────────────────────────────────────────
// Maps each work type onto an existing Badge colour (token-driven, AA-safe): violet
// (Differentiating), indigo/blue (Analytical), slate/neutral (Transactional), amber
// (Regulatory / Compliance). Untyped tasks read as a neutral "General" chip.
export type BadgeColor = 'default' | 'purple' | 'blue' | 'warn'
export const TYPE_BADGE: Record<TypeOfWork, { color: BadgeColor }> = {
  'Differentiating':          { color: 'purple' },
  'Analytical':               { color: 'blue' },
  'Transactional':            { color: 'default' },
  'Regulatory / Compliance':  { color: 'warn' },
}
export const workTypeBadge = (t?: string): { label: string; color: BadgeColor } => {
  const meta = t ? TYPE_BADGE[t as TypeOfWork] : undefined
  return { label: t || 'General', color: meta?.color ?? 'default' }
}
export const WORK_TYPES: TypeOfWork[] =
  ['Differentiating', 'Analytical', 'Transactional', 'Regulatory / Compliance']

// ─── 4E disposition chips + tint ───────────────────────────────────────────────
// Only the three "automate" dispositions ever ride onto a board task (Exclude work is dropped
// by the converter). Each maps onto an existing brand token — no new hex: Embrace = brand
// accent (the platform embraces this work), Elevate = good/green, Enhance = info/blue. `token`
// tints the card's left stripe + the chip dot; `soft` is the chip background.
export type BoardDisposition = Exclude<Disposition, 'Exclude'>
export const DISPOSITIONS: BoardDisposition[] = ['Embrace', 'Elevate', 'Enhance']
export const DISPOSITION_META: Record<BoardDisposition, { token: string; soft: string }> = {
  Embrace: { token: 'var(--color-accent)', soft: 'var(--color-accent-soft)' },
  Elevate: { token: 'var(--color-good)',   soft: 'var(--color-good-soft)' },
  Enhance: { token: 'var(--color-info)',   soft: 'var(--color-info-soft)' },
}
/** The tint tokens for a task's disposition, or null when it carries none (ad-hoc / legacy). */
export function dispositionMeta(d?: string): { label: BoardDisposition; token: string; soft: string } | null {
  if (d && d in DISPOSITION_META) {
    const m = DISPOSITION_META[d as BoardDisposition]
    return { label: d as BoardDisposition, token: m.token, soft: m.soft }
  }
  return null
}

// ─── Phases (runway ramp) ────────────────────────────────────────────────────────
export interface PhaseMeta { name: string; short: string; cssVar: string; light: boolean }
export const GTM_PHASES: PhaseMeta[] = [
  { name: 'Product Research',                short: 'Research',   cssVar: '--color-gtm-phase-1', light: true  },
  { name: 'Product Design',                  short: 'Design',     cssVar: '--color-gtm-phase-2', light: true  },
  { name: 'Product Definition',              short: 'Definition', cssVar: '--color-gtm-phase-3', light: false },
  { name: 'Product Launch',                  short: 'Launch',     cssVar: '--color-gtm-phase-4', light: false },
  { name: 'Product Governance & Monitoring', short: 'Governance', cssVar: '--color-gtm-phase-5', light: false },
]
export const PRELAUNCH_PHASES = GTM_PHASES.slice(0, 4)

// ─── Dates ───────────────────────────────────────────────────────────────────────

/** Coerce a Firestore Timestamp / ISO string / millis to epoch millis (or null). */
export function toMillis(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t }
  const o = v as { toDate?: () => Date; seconds?: number }
  if (typeof o.toDate === 'function') return o.toDate().getTime()
  if (typeof o.seconds === 'number') return o.seconds * 1000
  return null
}

/** Local calendar date as an ISO `yyyy-mm-dd` string — the scheduler's injected "today". */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Local midnight, in millis — the overdue cutoff (a task due before today is overdue). */
export function startOfTodayMs(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime()
}

/** ISO `yyyy-mm-dd` `days` calendar days from today — sensible default for a date input. */
export function futureISO(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Jul 8" (same year) or "Jul 8 '27" — compact, from a Timestamp/ISO/millis value. */
export function fmtShort(v: unknown): string {
  const ms = toMillis(v)
  if (ms == null) return ''
  const d = new Date(ms)
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() !== new Date().getFullYear() ? `${base} '${String(d.getFullYear()).slice(2)}` : base
}

/** A board task is overdue when its due date is before today and it isn't done/ongoing.
 *  GTM due dates are ISO `yyyy-mm-dd`, so compare as strings (timezone-agnostic); fall
 *  back to a millis compare for any legacy Timestamp-valued dueAt. */
export function isOverdue(t: TaskDoc, todayIso: string): boolean {
  if (t.done || t.ongoing || t.dueAt == null) return false
  if (typeof t.dueAt === 'string') return t.dueAt.slice(0, 10) < todayIso
  const ms = toMillis(t.dueAt)
  return ms != null && ms < startOfTodayMs()
}

/** Column sort: earliest due first; ongoing / no-due last; ties broken by process order. */
export function byDueThenOrder(a: TaskDoc, b: TaskDoc): number {
  const av = toMillis(a.dueAt) ?? Infinity
  const bv = toMillis(b.dueAt) ?? Infinity
  if (av !== bv) return av - bv
  return (a.order ?? 0) - (b.order ?? 0)
}

// ─── Completion fields — `done` + `completedAt` (Completed section sorts by the latter) ──
export function doneFields(done: boolean): Record<string, unknown> {
  return { done, completedAt: done ? new Date().toISOString() : null }
}

// ─── mutate() payload builders ────────────────────────────────────────────────────

/** Task document data for one back-scheduled process task (no undefined — Firestore-safe). */
export function taskDataFromScheduled(s: ScheduledTask, project: ProjectDoc): Record<string, unknown> {
  return {
    title:       s.taskL4,
    column:      BOARD_TO_COLUMN[s.boardColumn],
    projectId:   project.id,
    productId:   project.productId ?? null,
    origin:      'seeded',
    phaseL2:     s.phaseL2,
    groupL3:     s.groupL3,
    taskL4:      s.taskL4,
    phaseOrder:  s.phaseOrder,
    slaDays:     s.slaDays,
    ownerRole:   s.owner,
    typeOfWork:  s.typeOfWork || null,
    valueOfWork: s.valueOfWork || null,
    disposition: s.disposition || null,
    ongoing:     s.ongoing,
    startDate:   s.startDate,
    dueAt:       s.dueDate,          // null for ongoing governance
    order:       s.globalOrder,
    assignee:    null,
    checklist:   [],
    done:        false,
    completedAt: null,
  }
}

/**
 * Build the atomic re-seed payload set: DELETE the project's existing seeded tasks (ad-hoc
 * tasks are preserved), then CREATE the freshly back-scheduled ones. Passed to
 * adapter.db.mutateBatch() so the whole set is chunked, atomic and fully audited.
 */
export function buildSeedPayloads(
  project: ProjectDoc, scheduled: ScheduledTask[], priorSeeded: TaskDoc[],
  actor: { uid: string; name: string },
): MutationPayload[] {
  const productId = project.productId ?? undefined
  const deletes: MutationPayload[] = priorSeeded.map(t => ({
    op: 'delete', path: `tasks/${t.id}`, entityType: 'task', productId, actor,
  }))
  const stamp = Date.now()
  const creates: MutationPayload[] = scheduled.map((s, i) => ({
    op: 'create', path: `tasks/gtm-${stamp}-${i}`, entityType: 'task', productId, actor,
    data: taskDataFromScheduled(s, project),
  }))
  return [...deletes, ...creates]
}
