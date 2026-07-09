// Backward-scheduler unit tests — deterministic (today is injected), no emulator.
// Proves the load-bearing scheduling invariants: the last pre-launch task lands on the
// deadline, the adjacency chain holds, weekends are skipped, governance trails after
// launch, ongoing tasks have no due date, compression warns (never corrupts), and the
// calendar-days option stretches the spans.
import { describe, it, expect } from 'vitest'
import {
  scheduleFromDeadline, addBusinessDays, subtractBusinessDays, businessDaysBetween,
} from './schedule'
import type { GtmTemplateTask } from './types'
import { GTM_PROCESS_TEMPLATE } from '../seed/gtmProcess'

// UTC day-of-week for an ISO date (0 = Sun … 6 = Sat).
const dow = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay()
const isWeekend = (iso: string) => dow(iso) === 0 || dow(iso) === 6

const mk = (o: number, phaseOrder: number, sla: number, ongoing = false): GtmTemplateTask => ({
  globalOrder: o, phaseL2: 'P', groupL3: 'G', taskL4: `T${o}`,
  boardColumn: 'IDEATION & DESIGN', phaseOrder, slaDays: sla, ongoing,
  owner: 'Product Mgr.', typeOfWork: 'Analytical',
})

describe('business-day helpers', () => {
  it('addBusinessDays skips the weekend', () => {
    // 2026-07-03 is a Friday → +1 business day is Monday the 6th.
    expect(addBusinessDays('2026-07-03', 1).toISOString().slice(0, 10)).toBe('2026-07-06')
  })
  it('subtractBusinessDays skips the weekend', () => {
    // Monday 2026-07-06 → −1 business day is Friday the 3rd.
    expect(subtractBusinessDays('2026-07-06', 1).toISOString().slice(0, 10)).toBe('2026-07-03')
  })
  it('calendar mode does NOT skip weekends', () => {
    expect(addBusinessDays('2026-07-03', 1, false).toISOString().slice(0, 10)).toBe('2026-07-04')
  })
  it('businessDaysBetween counts weekdays only', () => {
    expect(businessDaysBetween('2026-07-03', '2026-07-06')).toBe(1)   // only Monday counts
    expect(businessDaysBetween('2026-07-06', '2026-07-03')).toBe(0)   // reversed → 0
    expect(businessDaysBetween('2026-07-06', '2026-07-13')).toBe(5)   // Mon→Mon = one work week
  })
})

describe('scheduleFromDeadline — pre-launch back-scheduling', () => {
  const deadline = '2026-12-31'   // Thursday — ample runway from an early "today"
  const today = '2026-01-01'

  it('lands the LAST pre-launch task exactly on the deadline', () => {
    const { tasks } = scheduleFromDeadline(GTM_PROCESS_TEMPLATE, deadline, { today })
    const pre = tasks.filter(t => t.phaseOrder <= 4)
    const last = pre.reduce((a, b) => (a.globalOrder > b.globalOrder ? a : b))
    expect(last.dueDate).toBe(deadline)
  })

  it('holds the adjacency chain: each task due === the next task start', () => {
    const { tasks } = scheduleFromDeadline(GTM_PROCESS_TEMPLATE, deadline, { today })
    const pre = tasks.filter(t => t.phaseOrder <= 4).sort((a, b) => a.globalOrder - b.globalOrder)
    for (let i = 0; i < pre.length - 1; i++) {
      expect(pre[i]!.dueDate).toBe(pre[i + 1]!.startDate)
    }
  })

  it('places every pre-launch date on a weekday (business mode)', () => {
    const { tasks } = scheduleFromDeadline(GTM_PROCESS_TEMPLATE, deadline, { today })
    for (const t of tasks.filter(t => t.phaseOrder <= 4)) {
      expect(isWeekend(t.startDate!)).toBe(false)
      expect(isWeekend(t.dueDate!)).toBe(false)
    }
  })

  it('projectStartDate is the earliest pre-launch start', () => {
    const { tasks, projectStartDate } = scheduleFromDeadline(GTM_PROCESS_TEMPLATE, deadline, { today })
    const earliest = tasks.filter(t => t.phaseOrder <= 4)
      .map(t => t.startDate!).sort()[0]
    expect(projectStartDate).toBe(earliest)
  })

  it('chains a hand-built two-task subset precisely', () => {
    // A(sla2) → B(sla3), deadline Wednesday 2026-07-08.
    const tpl = [mk(1, 1, 2), mk(2, 1, 3)]
    const { tasks, projectStartDate } = scheduleFromDeadline(tpl, '2026-07-08', { today: '2026-01-01' })
    const [a, b] = tasks
    expect(b!.dueDate).toBe('2026-07-08')
    expect(b!.startDate).toBe(subtractBusinessDays('2026-07-08', 3).toISOString().slice(0, 10)) // 2026-07-03
    expect(a!.dueDate).toBe(b!.startDate)                                                        // adjacency
    expect(a!.startDate).toBe(subtractBusinessDays(a!.dueDate!, 2).toISOString().slice(0, 10))   // 2026-07-01
    expect(projectStartDate).toBe(a!.startDate)
  })

  it('gives zero-SLA milestone tasks a one-day span so they do not stack on the deadline', () => {
    const tpl = [mk(1, 1, 0), mk(2, 1, 0)]
    const { tasks } = scheduleFromDeadline(tpl, '2026-07-08', { today: '2026-01-01' })
    // Distinct due dates; the earlier task's start is strictly before the deadline.
    expect(tasks[0]!.dueDate).not.toBe(tasks[1]!.dueDate)
    expect(tasks[0]!.startDate! < '2026-07-08').toBe(true)
  })
})

describe('scheduleFromDeadline — post-launch governance', () => {
  const deadline = '2026-07-08'   // Wednesday

  it('schedules non-ongoing governance AFTER the deadline, forward-chained', () => {
    const tpl = [mk(1, 5, 0), mk(2, 5, 0)]
    const { tasks } = scheduleFromDeadline(tpl, deadline, { today: '2026-01-01' })
    const [g1, g2] = tasks
    expect(g1!.startDate).toBe(deadline)                       // first governance starts at launch
    expect(g1!.dueDate! > deadline).toBe(true)                 // …and finishes after it
    expect(g2!.startDate).toBe(g1!.dueDate)                    // forward adjacency
    expect(g2!.dueDate! > g2!.startDate!).toBe(true)
  })

  it('gives ongoing governance a null due date pinned to the launch', () => {
    const tpl = [mk(1, 5, 0, true)]
    const { tasks } = scheduleFromDeadline(tpl, deadline, { today: '2026-01-01' })
    expect(tasks[0]!.ongoing).toBe(true)
    expect(tasks[0]!.startDate).toBe(deadline)
    expect(tasks[0]!.dueDate).toBeNull()
  })

  it('full template: the ONE ongoing governance task has a null due date', () => {
    const { tasks } = scheduleFromDeadline(GTM_PROCESS_TEMPLATE, deadline, { today: '2026-01-01' })
    const ongoing = tasks.filter(t => t.ongoing)
    expect(ongoing).toHaveLength(1)
    expect(ongoing[0]!.dueDate).toBeNull()
  })
})

describe('scheduleFromDeadline — compression + critical path', () => {
  it('critical path equals Σ pre-launch slaDays (=100 for the full template)', () => {
    const { criticalPathDays } = scheduleFromDeadline(GTM_PROCESS_TEMPLATE, '2026-12-31', { today: '2026-01-01' })
    expect(criticalPathDays).toBe(100)
  })

  it('warns "compressed" when the deadline is too soon — and still computes a schedule', () => {
    const { warnings, tasks } = scheduleFromDeadline(GTM_PROCESS_TEMPLATE, '2026-01-15', { today: '2026-01-01' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.code).toBe('compressed')
    expect(warnings[0]!.neededDays).toBe(100)
    expect(warnings[0]!.availableDays).toBeLessThan(100)
    // Not corrupted: the last pre-launch task still lands on the deadline (starts fall in the past).
    const pre = tasks.filter(t => t.phaseOrder <= 4)
    const last = pre.reduce((a, b) => (a.globalOrder > b.globalOrder ? a : b))
    expect(last.dueDate).toBe('2026-01-15')
    expect(pre.every(t => t.startDate !== null)).toBe(true)
  })

  it('does NOT warn when the deadline gives ample runway', () => {
    const { warnings } = scheduleFromDeadline(GTM_PROCESS_TEMPLATE, '2026-12-31', { today: '2026-01-01' })
    expect(warnings).toHaveLength(0)
  })
})

describe('scheduleFromDeadline — calendar vs business days', () => {
  it('the calendarDays option changes the spans', () => {
    const tpl = [mk(1, 1, 5)]
    const biz = scheduleFromDeadline(tpl, '2026-07-08', { today: '2026-01-01', businessDays: true })
    const cal = scheduleFromDeadline(tpl, '2026-07-08', { today: '2026-01-01', businessDays: false })
    // Both land the task on the deadline, but calendar mode (no weekend skips) starts later.
    expect(biz.tasks[0]!.dueDate).toBe('2026-07-08')
    expect(cal.tasks[0]!.dueDate).toBe('2026-07-08')
    expect(biz.tasks[0]!.startDate).not.toBe(cal.tasks[0]!.startDate)
    expect(cal.tasks[0]!.startDate! > biz.tasks[0]!.startDate!).toBe(true)
  })
})
