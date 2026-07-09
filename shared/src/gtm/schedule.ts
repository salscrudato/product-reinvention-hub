// Backward scheduler for the GTM launch tracker — pure, deterministic (no Date.now
// inside; `today` is injected). LAUNCH is the pivot, not the end of the process:
//   • PRE-LAUNCH  (phaseOrder ≤ 4) is back-scheduled so the LAST pre-launch task's due
//     date lands exactly on the deadline, each earlier task chained adjacently before it.
//   • POST-LAUNCH (phaseOrder = 5, governance) is forward-scheduled from the deadline;
//     ongoing tasks start at launch with no due date.
// Each task consumes at least one working day (Math.max(sla,1)) so zero-SLA milestone
// tasks don't collapse onto a single date — the mockup's approved behaviour. The
// compression check, however, uses the RAW Σ slaDays (the true critical path).
//
// Dates are ISO `yyyy-mm-dd` strings computed in UTC, so results never drift with the
// caller's timezone and unit tests are stable. Zero platform imports.
import type {
  GtmTemplateTask, ScheduledTask, ScheduleOptions, ScheduleResult, ScheduleWarning,
} from './types'
import { GTM_PRELAUNCH_MAX_PHASE_ORDER } from './types'

const MS_DAY = 86_400_000

/** Normalise a `yyyy-mm-dd` string or Date to a UTC-midnight Date (by its UTC parts). */
function toDate(d: string | Date): Date {
  if (d instanceof Date) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, day ?? 1))
}

/** Format a Date as an ISO `yyyy-mm-dd` string from its UTC parts. */
export function formatISODate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isWeekend(d: Date): boolean {
  const g = d.getUTCDay()
  return g === 0 || g === 6   // Sunday | Saturday
}

function step(d: Date, delta: number): Date {
  return new Date(d.getTime() + delta * MS_DAY)
}

/** Add `n` days after `date`. When `businessDays` (default), weekends are skipped. */
export function addBusinessDays(date: string | Date, n: number, businessDays = true): Date {
  let d = toDate(date)
  if (n <= 0) return d
  let counted = 0
  while (counted < n) { d = step(d, 1); if (!businessDays || !isWeekend(d)) counted++ }
  return d
}

/** Subtract `n` days before `date`. When `businessDays` (default), weekends are skipped. */
export function subtractBusinessDays(date: string | Date, n: number, businessDays = true): Date {
  let d = toDate(date)
  if (n <= 0) return d
  let counted = 0
  while (counted < n) { d = step(d, -1); if (!businessDays || !isWeekend(d)) counted++ }
  return d
}

/** Business days strictly after `a`, up to and including `b` (0 if `b` ≤ `a`). */
export function businessDaysBetween(a: string | Date, b: string | Date): number {
  let d = toDate(a)
  const end = toDate(b)
  if (end <= d) return 0
  let counted = 0
  while (d < end) { d = step(d, 1); if (!isWeekend(d)) counted++ }
  return counted
}

/**
 * Schedule template tasks around a launch deadline.
 * @returns tasks (input order, each annotated with startDate/dueDate), the earliest
 *          pre-launch start (projectStartDate), the critical path (Σ pre-launch slaDays),
 *          and a `compressed` warning when the deadline is sooner than the path needs.
 */
export function scheduleFromDeadline(
  templateTasks: GtmTemplateTask[],
  targetLaunchDate: string | Date,
  options: ScheduleOptions,
): ScheduleResult {
  const biz = options.businessDays !== false     // default = business days
  const deadline = toDate(targetLaunchDate)
  const today = toDate(options.today)

  // Clone in input order; pre/post reference the same clones so mutations are visible
  // in the returned array regardless of scheduling direction.
  const tasks: ScheduledTask[] = templateTasks.map(t => ({ ...t, startDate: null, dueDate: null }))
  const pre  = tasks.filter(t => t.phaseOrder <= GTM_PRELAUNCH_MAX_PHASE_ORDER)
                    .sort((a, b) => a.globalOrder - b.globalOrder)
  const post = tasks.filter(t => t.phaseOrder >  GTM_PRELAUNCH_MAX_PHASE_ORDER)
                    .sort((a, b) => a.globalOrder - b.globalOrder)

  // PRE-LAUNCH — back-schedule from the deadline. Walk last → first: the final task's
  // due date IS the deadline; start = due − max(sla,1); the predecessor's due = this start.
  let cursor = deadline
  for (let i = pre.length - 1; i >= 0; i--) {
    const t = pre[i]!
    const start = subtractBusinessDays(cursor, Math.max(t.slaDays, 1), biz)
    t.dueDate = formatISODate(cursor)
    t.startDate = formatISODate(start)
    cursor = start
  }
  const projectStartDate = pre.length ? pre[0]!.startDate : formatISODate(deadline)

  // POST-LAUNCH — forward-schedule governance from the deadline. Ongoing tasks pin to
  // launch with no due date; others chain forward, each consuming max(sla,1) days.
  let forward = deadline
  for (const t of post) {
    if (t.ongoing) {
      t.startDate = formatISODate(deadline)
      t.dueDate = null
    } else {
      const due = addBusinessDays(forward, Math.max(t.slaDays, 1), biz)
      t.startDate = formatISODate(forward)
      t.dueDate = formatISODate(due)
      forward = due
    }
  }

  // Compression check uses the RAW critical path (Σ slaDays) vs. business days available.
  const criticalPathDays = pre.reduce((sum, t) => sum + t.slaDays, 0)
  const availableDays = businessDaysBetween(today, deadline)
  const warnings: ScheduleWarning[] = []
  if (criticalPathDays > 0 && availableDays < criticalPathDays) {
    warnings.push({ code: 'compressed', neededDays: criticalPathDays, availableDays })
  }

  return { tasks, projectStartDate, criticalPathDays, warnings }
}
