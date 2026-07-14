// Forward-only launch-planner unit tests — deterministic (today is injected), no emulator.
// Proves the v2 guarantees the old backward scheduler did NOT: nothing ever schedules before
// the next working day after today; an impossible deadline resolves to the earliest feasible
// launch (never the past, never truncated); per-task overrides reflow the chain; and every
// task carries a stable, collision-free seedRefId derived from its L1→L4 path.
import { describe, it, expect } from 'vitest'
import { planLaunch, seedRefIdFor, seedRefIdFromPath } from './plan'
import type { GtmTemplateTask } from './types'
import { GTM_PROCESS_TEMPLATE } from '../seed/gtmProcess'

const dow = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay()
const isWeekend = (iso: string) => dow(iso) === 0 || dow(iso) === 6

const mk = (o: number, phaseOrder: number, sla: number, ongoing = false): GtmTemplateTask => ({
  globalOrder: o, phaseL2: 'P', groupL3: 'G', taskL4: `T${o}`,
  boardColumn: 'IDEATION & DESIGN', phaseOrder, slaDays: sla, ongoing,
  owner: 'Product Mgr.', typeOfWork: 'Analytical', valueOfWork: 'Enables', disposition: 'Embrace',
})

describe('seedRefId — stable, unique, path-derived identity', () => {
  it('is deterministic for the same L1→L4 path (ignores order/sla/owner)', () => {
    const t = mk(1, 1, 2)
    const variant: GtmTemplateTask = { ...t, globalOrder: 999, slaDays: 7, owner: 'X' }
    expect(seedRefIdFor(t)).toBe(seedRefIdFor(variant))
    expect(seedRefIdFromPath('a', 'b', 'c')).toBe(seedRefIdFromPath('a', 'b', 'c'))
  })
  it('is doc-id-safe (pm- + 8 hex)', () => {
    expect(seedRefIdFor(mk(1, 1, 2))).toMatch(/^pm-[0-9a-f]{8}$/)
  })
  it('differs when any path segment differs', () => {
    expect(seedRefIdFromPath('a', 'b', 'c')).not.toBe(seedRefIdFromPath('a', 'b', 'd'))
    expect(seedRefIdFromPath('a', 'b', 'c')).not.toBe(seedRefIdFromPath('a', 'x', 'c'))
    // No concat ambiguity across segment boundaries.
    expect(seedRefIdFromPath('ab', '', 'c')).not.toBe(seedRefIdFromPath('a', 'b', 'c'))
  })
  it('assigns all 65 fixture rows a UNIQUE seedRefId (idempotency depends on this)', () => {
    const ids = new Set(GTM_PROCESS_TEMPLATE.map(seedRefIdFor))
    expect(ids.size).toBe(GTM_PROCESS_TEMPLATE.length)
    expect(GTM_PROCESS_TEMPLATE.length).toBe(65)
  })
})

describe('planLaunch — forward-only floor (never before tomorrow)', () => {
  it('sets earliestStart to the next BUSINESS day after a Friday today', () => {
    // 2026-07-03 is a Friday → the floor is Monday the 6th.
    const plan = planLaunch([mk(1, 1, 2)], '2026-12-31', { today: '2026-07-03' })
    expect(plan.earliestStart).toBe('2026-07-06')
  })
  it('sets earliestStart to Monday when today is the weekend', () => {
    // 2026-07-04 Sat / 2026-07-05 Sun → floor is Monday the 6th either way.
    expect(planLaunch([mk(1, 1, 2)], '2026-12-31', { today: '2026-07-04' }).earliestStart).toBe('2026-07-06')
    expect(planLaunch([mk(1, 1, 2)], '2026-12-31', { today: '2026-07-05' }).earliestStart).toBe('2026-07-06')
  })
  it('never places any pre-launch start before earliestStart — even when the deadline is too tight', () => {
    // Full template, an impossible deadline two weeks out from a Friday today.
    const plan = planLaunch(GTM_PROCESS_TEMPLATE, '2026-07-17', { today: '2026-07-03' })
    const pre = plan.tasks.filter(t => t.phaseOrder <= 4)
    expect(pre.length).toBeGreaterThan(0)
    for (const t of pre) {
      expect(t.startDate! >= plan.earliestStart).toBe(true)   // the guarantee the old scheduler broke
      expect(t.startDate! >= '2026-07-04').toBe(true)          // strictly after today
    }
  })
  it('keeps every pre-launch date on a weekday in business mode', () => {
    const plan = planLaunch(GTM_PROCESS_TEMPLATE, '2027-06-30', { today: '2026-07-03' })
    for (const t of plan.tasks.filter(t => t.phaseOrder <= 4)) {
      expect(isWeekend(t.startDate!)).toBe(false)
      expect(isWeekend(t.dueDate!)).toBe(false)
    }
  })
})

describe('planLaunch — deadline-too-tight resolution (calm, not silent)', () => {
  it('flags too-tight with the earliest feasible launch, and lands the plan there (not the past)', () => {
    const tpl = [mk(1, 1, 2), mk(2, 1, 3)]   // span = 5 working days
    const plan = planLaunch(tpl, '2026-07-07', { today: '2026-07-03' })   // Tue deadline, floor Mon 6th
    expect(plan.fits).toBe(false)
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]!.code).toBe('deadline-too-tight')
    expect(plan.warnings[0]!.neededDays).toBe(5)               // Σ max(sla,1)
    expect(plan.warnings[0]!.earliestLaunch).toBe(plan.earliestLaunch)
    // The plan lands on earliestLaunch, and the first task starts exactly on the floor.
    expect(plan.landingDate).toBe(plan.earliestLaunch)
    const pre = plan.tasks.filter(t => t.phaseOrder <= 4).sort((a, b) => a.globalOrder - b.globalOrder)
    expect(pre[0]!.startDate).toBe(plan.earliestStart)          // '2026-07-06'
    expect(pre[pre.length - 1]!.dueDate).toBe(plan.earliestLaunch)
  })
  it('does NOT warn when the deadline gives ample runway, and lands the last task on the deadline', () => {
    const plan = planLaunch(GTM_PROCESS_TEMPLATE, '2027-06-30', { today: '2026-07-03' })
    expect(plan.fits).toBe(true)
    expect(plan.warnings).toHaveLength(0)
    const pre = plan.tasks.filter(t => t.phaseOrder <= 4)
    const last = pre.reduce((a, b) => (a.globalOrder > b.globalOrder ? a : b))
    expect(last.dueDate).toBe('2027-06-30')
    expect(plan.projectStartDate! >= plan.earliestStart).toBe(true)
  })
  it('holds the adjacency chain: each pre-launch due === the next start', () => {
    const plan = planLaunch(GTM_PROCESS_TEMPLATE, '2027-06-30', { today: '2026-07-03' })
    const pre = plan.tasks.filter(t => t.phaseOrder <= 4).sort((a, b) => a.globalOrder - b.globalOrder)
    for (let i = 0; i < pre.length - 1; i++) expect(pre[i]!.dueDate).toBe(pre[i + 1]!.startDate)
  })
})

describe('planLaunch — governance trails after launch', () => {
  it('forward-schedules non-ongoing governance after the landing date', () => {
    const tpl = [mk(1, 1, 3), mk(2, 5, 0), mk(3, 5, 0, true)]
    const plan = planLaunch(tpl, '2027-06-30', { today: '2026-07-03' })
    const g = plan.tasks.filter(t => t.phaseOrder === 5)
    const gov = g.find(t => !t.ongoing)!
    const ongoing = g.find(t => t.ongoing)!
    expect(gov.startDate).toBe(plan.landingDate)
    expect(gov.dueDate! > plan.landingDate).toBe(true)
    expect(ongoing.startDate).toBe(plan.landingDate)
    expect(ongoing.dueDate).toBeNull()
  })
})

describe('planLaunch — per-task overrides (Adjust step) reflow forward-only', () => {
  it('a duration override changes the span and the computed dates, forward-only', () => {
    const tpl = [mk(1, 1, 2), mk(2, 1, 3)]
    const base = planLaunch(tpl, '2027-06-30', { today: '2026-07-03' })
    const id2 = seedRefIdFor(tpl[1]!)
    const bumped = planLaunch(tpl, '2027-06-30', { today: '2026-07-03', overrides: { [id2]: { slaDays: 10 } } })
    const bt2 = bumped.tasks.find(t => t.seedRefId === id2)!
    expect(bt2.effectiveSla).toBe(10)
    expect(bumped.spanDays).toBe(base.spanDays + 7)             // 3 → 10 adds 7 working days
    // Still lands on the deadline, still forward-only.
    expect(bumped.tasks[1]!.dueDate).toBe('2027-06-30')
    expect(bumped.projectStartDate! >= bumped.earliestStart).toBe(true)
  })
  it('an owner override rides onto the planned task; a blank one falls back to the template', () => {
    const tpl = [mk(1, 1, 2)]
    const id = seedRefIdFor(tpl[0]!)
    const named = planLaunch(tpl, '2027-06-30', { today: '2026-07-03', overrides: { [id]: { owner: '  Pricing Actuary  ' } } })
    expect(named.tasks[0]!.owner).toBe('Pricing Actuary')       // trimmed
    const blank = planLaunch(tpl, '2027-06-30', { today: '2026-07-03', overrides: { [id]: { owner: '   ' } } })
    expect(blank.tasks[0]!.owner).toBe('Product Mgr.')          // template fallback
  })
  it('a zero/negative duration override is clamped and still consumes one scheduled day', () => {
    const tpl = [mk(1, 1, 5)]
    const id = seedRefIdFor(tpl[0]!)
    const plan = planLaunch(tpl, '2027-06-30', { today: '2026-07-03', overrides: { [id]: { slaDays: -3 } } })
    expect(plan.tasks[0]!.effectiveSla).toBe(0)
    expect(plan.spanDays).toBe(1)                               // max(0,1)
    expect(plan.tasks[0]!.startDate! < plan.tasks[0]!.dueDate!).toBe(true)
  })
})

describe('planLaunch — calendar vs business days', () => {
  it('calendar mode does not skip weekends for the floor or the spans', () => {
    // today Friday 2026-07-03; calendar floor is Saturday the 4th.
    const plan = planLaunch([mk(1, 1, 2)], '2027-06-30', { today: '2026-07-03', businessDays: false })
    expect(plan.earliestStart).toBe('2026-07-04')
  })
})
