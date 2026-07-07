// homePriorities.ts — pure ranking + horizon logic for the Home cockpit's task rail.
// Kept free of React/Firestore so the ordering (the load-bearing, boundary-sensitive
// part) is unit-testable in isolation. Order is: due date (soonest / overdue first)
// → criticality → a stable remainder. Criticality itself is layered: the task's
// product health (lower score / more findings = more at risk), then lifecycle-stage
// proximity to filing (near-filing work outranks early ideation at the same due
// date). Every criticality input is GROUNDED in real data — product.health and the
// task's own column — nothing here is invented.
import type { TaskColumn } from '@pf/shared'

export type Horizon = 'daily' | 'weekly'

// Structural subset of Task the ranking reads — avoids coupling to the full type.
export interface RankTask {
  id:         string
  title:      string
  column:     TaskColumn
  dueAt?:     unknown
  productId?: string
  order?:     number
}

// A product's health, used as the task's criticality signal (only the fields we need).
export interface Criticality {
  score:        number   // 0..100; lower = more at risk = more critical
  findingCount: number
}

const DAY_MS = 86_400_000

// Stage proximity — the final criticality signal (after due date + product health):
// mid-flight / near-filing work outranks early ideation and post-launch monitoring.
const STAGE_RANK: Record<TaskColumn, number> = {
  TEST_APPROVE: 0, BUILD_FILE: 1, IDEATION: 2, LAUNCH_MONITOR: 3,
}

/** Firestore Timestamp | ISO string | epoch millis → millis (or null when absent). */
export function toMillis(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t }
  const o = v as { toDate?: () => Date; seconds?: number }
  if (typeof o.toDate === 'function') return o.toDate().getTime()
  if (typeof o.seconds === 'number') return o.seconds * 1000
  return null
}

/** Start-of-day (local) for a millis value. Bucketing to the day means two tasks due
 *  the *same day* tie on the due-date key, so criticality decides between them — the
 *  exact boundary the rail's ordering must get right. */
function dayStart(ms: number): number {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime()
}

/** Whole days from now until `ms` (negative = overdue), day-bucketed on both ends. */
export function daysUntil(ms: number, now: number): number {
  return Math.round((dayStart(ms) - dayStart(now)) / DAY_MS)
}

/** Is a task inside the horizon window? Overdue always counts; undated never does —
 *  the rail is deadline-driven, and undated work still lives on the full Tasks board. */
export function withinHorizon(due: number | null, horizon: Horizon, now: number): boolean {
  if (due == null) return false
  const d = daysUntil(due, now)
  return horizon === 'daily' ? d <= 0 : d <= 7   // daily: today + overdue · weekly: ≤ 7d + overdue
}

/** Deterministic total order over tasks. `healthOf` maps a task to its product's
 *  criticality (real health); a missing product is treated as healthy (least critical)
 *  so undiagnosable tasks never jump the queue ahead of a genuinely at-risk one. */
export function prioritize<T extends RankTask>(
  tasks: T[],
  healthOf: (t: T) => Criticality | null,
): T[] {
  return [...tasks].sort((a, b) => {
    // 1) Due date — day-bucketed; undated sorts last.
    const da = toMillis(a.dueAt), dbb = toMillis(b.dueAt)
    const ka = da  == null ? Infinity : dayStart(da)
    const kb = dbb == null ? Infinity : dayStart(dbb)
    if (ka !== kb) return ka - kb
    // 2) Criticality — lower product-health score first (more at risk); no product → 100.
    const ha = healthOf(a)?.score ?? 100
    const hb = healthOf(b)?.score ?? 100
    if (ha !== hb) return ha - hb
    // …then more findings first when scores tie.
    const fa = healthOf(a)?.findingCount ?? 0
    const fb = healthOf(b)?.findingCount ?? 0
    if (fa !== fb) return fb - fa
    // 3) Stage proximity — the last criticality signal: near-filing work first.
    if (STAGE_RANK[a.column] !== STAGE_RANK[b.column]) return STAGE_RANK[a.column] - STAGE_RANK[b.column]
    // 4) The rest — pure stability so the order never churns: seed order, then title.
    if ((a.order ?? 0) !== (b.order ?? 0)) return (a.order ?? 0) - (b.order ?? 0)
    return a.title.localeCompare(b.title)
  })
}
