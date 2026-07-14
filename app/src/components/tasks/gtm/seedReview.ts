// Pure model behind the Review → Adjust → Seed surface. Kept out of the component so the
// load-bearing logic — idempotency (which rows are already on the board), deselection math,
// and the forward-only plan for the current selection — is unit-tested without React.
import type { GtmTemplateTask, LaunchPlan, PlannedTask, PlanOptions } from '@pf/shared'
import { planLaunch, seedRefIdFor, seedRefIdFromPath } from '@pf/shared'
import type { TaskDoc } from './gtm'

/** The seedRefId of a prior seeded task: its stored field, or — for tasks seeded before the
 *  field existed — recomputed from its L1→L4 lineage, so legacy boards still match on re-seed. */
export function taskSeedRefId(t: TaskDoc): string | null {
  if (t.seedRefId) return t.seedRefId
  if (t.phaseL2 && t.groupL3 && t.taskL4) return seedRefIdFromPath(t.phaseL2, t.groupL3, t.taskL4)
  return null
}

/** The process rows already on the board for this project — the idempotency key set. */
export function presentSeedRefIds(priorSeeded: TaskDoc[]): Set<string> {
  const s = new Set<string>()
  for (const t of priorSeeded) { const id = taskSeedRefId(t); if (id) s.add(id) }
  return s
}

/** Every template row's seedRefId — the default selection (everything selected up front). */
export function allSeedRefIds(template: GtmTemplateTask[]): Set<string> {
  return new Set(template.map(seedRefIdFor))
}

export interface ReviewPlan {
  /** The forward-only plan over the selected set (present + newly-selected) — drives the live header. */
  plan:          LaunchPlan
  /** Selected rows NOT already on the board — exactly what a seed will create. */
  toCreate:      PlannedTask[]
  newCount:      number
  /** Selected rows already on the board (skipped by the idempotent seed). */
  presentCount:  number
  /** All rows in the plan (present + new). */
  selectedCount: number
}

/**
 * Compute the live plan + the create set for the current selection / overrides / deadline.
 * Rows already on the board are always kept in the plan (you cannot deselect an existing task
 * from here) but are excluded from `toCreate` — so re-seeding proposes only what is missing.
 */
export function computeReviewPlan(args: {
  template: GtmTemplateTask[]
  selected: Set<string>          // seedRefIds the PM wants seeded
  present:  Set<string>          // seedRefIds already on the board
  deadline: string
  options:  PlanOptions
}): ReviewPlan {
  const { template, selected, present, deadline, options } = args
  const subset = template.filter(t => {
    const id = seedRefIdFor(t)
    return selected.has(id) || present.has(id)   // present rows are always in the plan
  })
  const plan = planLaunch(subset, deadline, options)
  const toCreate = plan.tasks.filter(t => !present.has(t.seedRefId))
  return {
    plan,
    toCreate,
    newCount: toCreate.length,
    presentCount: plan.tasks.length - toCreate.length,
    selectedCount: plan.tasks.length,
  }
}
