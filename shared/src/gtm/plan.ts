// Forward-only launch planner for Task Seeding v2 — pure, deterministic (today injected).
// Layered on the backward scheduler in schedule.ts. Two things it adds:
//
//   1) FORWARD-ONLY FLOOR. No task ever starts before the next working day after `today`.
//      When the deadline can't fit the pre-launch chain, the plan lands on the EARLIEST
//      FEASIBLE launch instead of scheduling into the past, and flags 'deadline-too-tight'
//      with that date so the UI can offer a one-tap resolution (never a silent truncation).
//      Concretely: land the last pre-launch task on `landingDate = max(deadline, earliestLaunch)`,
//      which guarantees the first start ≥ earliestStart by construction.
//
//   2) STABLE IDENTITY + PER-TASK OVERRIDES. Each task carries a stable `seedRefId` (a hash
//      of its L1→L4 path) so re-seeding is idempotent, and accepts owner/duration overrides
//      keyed by that id, which reflow the chain forward-only and persist onto the seeded task.
//
// Governance (phaseOrder 5) still trails after launch; ongoing tasks pin to the landing date.
// Zero platform imports; every span honours the business/calendar toggle.
import type { GtmTemplateTask } from './types'
import { GTM_PRELAUNCH_MAX_PHASE_ORDER } from './types'
import { addBusinessDays, subtractBusinessDays, formatISODate, toISODate } from './schedule'
import { contentHash } from '../retrieval/chunk'

// The single top-level (L1) process. The fixture reader hard-filters to this name, so it is
// constant across every row — but we fold it into the identity so the key is a full L1→L4 path.
const L1 = 'Product Manufacture'
const SEP = ' || ' // mirrors the converter group-key convention; no taxonomy name contains it

/** Stable per-row identity from the L1→L4 name path. Collision-free for the 65-row fixture
 *  (all L2|L3|L4 paths are distinct) and, unlike `globalOrder`, invariant under fixture
 *  regeneration. Doc-id-safe (an `pm-` prefix + 8 hex chars). */
export function seedRefIdFromPath(phaseL2: string, groupL3: string, taskL4: string): string {
  return `pm-${contentHash([L1, phaseL2, groupL3, taskL4].join(SEP))}`
}
export function seedRefIdFor(t: Pick<GtmTemplateTask, 'phaseL2' | 'groupL3' | 'taskL4'>): string {
  return seedRefIdFromPath(t.phaseL2, t.groupL3, t.taskL4)
}

/** Per-task adjustment the PM made in the review step (keyed by seedRefId). */
export interface PlanOverride {
  /** Duration override in working/calendar days (per the toggle); clamped to ≥ 0. */
  slaDays?: number
  /** Owner-role override (a role, not a person). Blank/whitespace falls back to the template. */
  owner?:   string
}

export interface PlanOptions {
  /** Injected "today" so the planner is pure + deterministic (no Date.now inside). */
  today:         string | Date
  /** true (default) = count spans in business days (Mon–Fri); false = calendar days. Also
   *  governs the forward-only floor (next business day vs next calendar day). */
  businessDays?: boolean
  /** Per-task overrides keyed by seedRefId. */
  overrides?:    Record<string, PlanOverride>
}

/** A template task annotated with its stable id, effective duration/owner and computed dates. */
export interface PlannedTask extends GtmTemplateTask {
  seedRefId:    string
  effectiveSla: number         // slaDays after any override (≥ 0)
  owner:        string         // owner-role after any override (shadows GtmTemplateTask.owner)
  startDate:    string | null  // ISO yyyy-mm-dd
  dueDate:      string | null  // ISO; null for ongoing governance
}

/** Emitted when the deadline is too soon for the selected pre-launch chain. The plan is still
 *  fully computed (landing on `earliestLaunch`) — never scheduled into the past, never truncated. */
export interface LaunchPlanWarning {
  code:           'deadline-too-tight'
  neededDays:     number   // working/calendar-day span the selected pre-launch chain needs (Σ max(sla,1))
  earliestLaunch: string   // ISO — the soonest date the chain can land without starting in the past
}

export interface LaunchPlan {
  tasks:            PlannedTask[]   // input order, each annotated with its schedule
  projectStartDate: string | null  // earliest pre-launch start (the landing date if no pre-launch)
  earliestStart:    string         // the forward-only floor: next working day after today
  earliestLaunch:   string         // soonest feasible landing date given that floor
  landingDate:      string         // where the last pre-launch task lands (deadline, or earliestLaunch when too tight)
  criticalPathDays: number         // Σ effectiveSla over pre-launch (the displayed critical path)
  spanDays:         number         // Σ max(effectiveSla,1) over pre-launch (the true chain length)
  fits:             boolean        // deadline ≥ earliestLaunch (i.e. the deadline is achievable)
  warnings:         LaunchPlanWarning[]
}

/**
 * Plan a launch, forward-only, around a target deadline.
 * @param template  the (already phase/task-filtered) template tasks to schedule
 * @param targetLaunchDate  the PM's desired launch deadline (the schedule pivot)
 */
export function planLaunch(
  template: GtmTemplateTask[],
  targetLaunchDate: string | Date,
  options: PlanOptions,
): LaunchPlan {
  const biz = options.businessDays !== false      // default = business days
  const overrides = options.overrides ?? {}

  // Annotate every task with its stable id + effective (overridden) duration/owner.
  const tasks: PlannedTask[] = template.map(t => {
    const seedRefId = seedRefIdFor(t)
    const ov = overrides[seedRefId]
    const rawSla = ov?.slaDays ?? t.slaDays
    const effectiveSla = Math.max(0, Number.isFinite(rawSla) ? Math.trunc(rawSla) : t.slaDays)
    const owner = ov?.owner && ov.owner.trim() ? ov.owner.trim() : t.owner
    return { ...t, seedRefId, effectiveSla, owner, startDate: null, dueDate: null }
  })

  const pre  = tasks.filter(t => t.phaseOrder <= GTM_PRELAUNCH_MAX_PHASE_ORDER)
                    .sort((a, b) => a.globalOrder - b.globalOrder)
  const post = tasks.filter(t => t.phaseOrder >  GTM_PRELAUNCH_MAX_PHASE_ORDER)
                    .sort((a, b) => a.globalOrder - b.globalOrder)

  // spanDays = the true chain length (each task consumes at least one day); criticalPathDays =
  // the raw Σ used for the headline number. Both over the SELECTED pre-launch tasks.
  const spanDays = pre.reduce((s, t) => s + Math.max(t.effectiveSla, 1), 0)
  const criticalPathDays = pre.reduce((s, t) => s + t.effectiveSla, 0)

  // FORWARD-ONLY FLOOR — earliest start = the next working day after today.
  const earliestStartD = addBusinessDays(options.today, 1, biz)
  const earliestStart = formatISODate(earliestStartD)
  // Soonest the chain can land: the floor plus the full span (only pre-launch occupies runway).
  const earliestLaunch = pre.length ? formatISODate(addBusinessDays(earliestStartD, spanDays, biz)) : earliestStart

  const deadline = toISODate(targetLaunchDate)
  // ISO yyyy-mm-dd sorts chronologically, so a lexical compare is a date compare.
  const fits = deadline >= earliestLaunch
  const landingDate = fits ? deadline : earliestLaunch

  // PRE-LAUNCH — back-schedule from the landing date. Because landingDate ≥ earliestLaunch =
  // earliestStart + span, the first start round-trips to ≥ earliestStart: nothing lands in the past.
  let cursor: string | Date = landingDate
  for (let i = pre.length - 1; i >= 0; i--) {
    const t = pre[i]!
    const start = subtractBusinessDays(cursor, Math.max(t.effectiveSla, 1), biz)
    t.dueDate = toISODate(cursor)
    t.startDate = formatISODate(start)
    cursor = start
  }
  const projectStartDate = pre.length ? pre[0]!.startDate : landingDate

  // POST-LAUNCH — governance trails after launch; ongoing tasks pin to the landing date.
  let forward: string | Date = landingDate
  for (const t of post) {
    if (t.ongoing) {
      t.startDate = landingDate
      t.dueDate = null
    } else {
      const due = addBusinessDays(forward, Math.max(t.effectiveSla, 1), biz)
      t.startDate = toISODate(forward)
      t.dueDate = formatISODate(due)
      forward = due
    }
  }

  const warnings: LaunchPlanWarning[] = []
  if (!fits && pre.length) warnings.push({ code: 'deadline-too-tight', neededDays: spanDays, earliestLaunch })

  return { tasks, projectStartDate, earliestStart, earliestLaunch, landingDate, criticalPathDays, spanDays, fits, warnings }
}
