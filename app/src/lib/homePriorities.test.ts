// Guards the Home cockpit task-rail ordering — the boundary a hostile reviewer probes:
// at the *same due date*, lifecycle stage must decide, and overdue must beat upcoming.
// Also pins the daily/weekly horizon windows.
import { describe, it, expect } from 'vitest'
import { prioritize, withinHorizon, daysUntil, toMillis, type RankTask } from './homePriorities'

// Fixed "now" at local noon so day-bucketing is stable (July → no DST edge).
const NOW = new Date(2026, 6, 7, 12, 0, 0).getTime()
const DAY = 86_400_000
const at = (days: number) => NOW + days * DAY   // due date `days` from now

function task(over: Partial<RankTask> & Pick<RankTask, 'id'>): RankTask {
  return { title: over.id, column: 'BUILD_FILE', order: 0, ...over }
}

describe('prioritize', () => {
  it('orders by due date first — overdue before today before future', () => {
    const out = prioritize(
      [task({ id: 'future', dueAt: at(5) }), task({ id: 'today', dueAt: at(0) }), task({ id: 'overdue', dueAt: at(-3) })],
    )
    expect(out.map(t => t.id)).toEqual(['overdue', 'today', 'future'])
  })

  it('breaks a same-due-date tie by lifecycle stage — near-filing work first', () => {
    // Both due the same day; TEST_APPROVE (stage 0) outranks BUILD_FILE (stage 1).
    const out = prioritize(
      [task({ id: 'build', column: 'BUILD_FILE', dueAt: at(2) }), task({ id: 'approve', column: 'TEST_APPROVE', dueAt: at(2) })],
    )
    expect(out.map(t => t.id)).toEqual(['approve', 'build'])
  })

  it('treats different times on the same calendar day as one due-date bucket', () => {
    // Same day, different clock time → still a tie on due date, so stage decides.
    const morning = new Date(2026, 6, 9, 8, 0, 0).getTime()
    const evening = new Date(2026, 6, 9, 20, 0, 0).getTime()
    const out = prioritize(
      [task({ id: 'build', column: 'BUILD_FILE', dueAt: morning }), task({ id: 'approve', column: 'TEST_APPROVE', dueAt: evening })],
    )
    expect(out.map(t => t.id)).toEqual(['approve', 'build'])   // approve first despite its later clock time
  })

  it('sorts undated tasks last', () => {
    const out = prioritize(
      [task({ id: 'none' }), task({ id: 'soon', dueAt: at(1) })],
    )
    expect(out.map(t => t.id)).toEqual(['soon', 'none'])
  })

  it('final tie-break is deterministic: stage → order → title', () => {
    // Identical due date → stage decides across all four columns.
    const out = prioritize([
      task({ id: 'monitor',  column: 'LAUNCH_MONITOR', dueAt: at(1) }),
      task({ id: 'ideation', column: 'IDEATION',       dueAt: at(1) }),
      task({ id: 'approve',  column: 'TEST_APPROVE',   dueAt: at(1) }),
      task({ id: 'build',    column: 'BUILD_FILE',     dueAt: at(1) }),
    ])
    expect(out.map(t => t.id)).toEqual(['approve', 'build', 'ideation', 'monitor'])
  })

  it('within the same stage, order then title break the tie', () => {
    const out = prioritize([
      task({ id: 'b', column: 'BUILD_FILE', dueAt: at(1), order: 1 }),
      task({ id: 'a', column: 'BUILD_FILE', dueAt: at(1), order: 0 }),
    ])
    expect(out.map(t => t.id)).toEqual(['a', 'b'])
  })

  it('does not mutate its input', () => {
    const input = [task({ id: 'b', dueAt: at(2) }), task({ id: 'a', dueAt: at(1) })]
    const copy = [...input]
    prioritize(input)
    expect(input).toEqual(copy)
  })
})

describe('withinHorizon', () => {
  it('daily = overdue + due today only', () => {
    expect(withinHorizon(at(-1), 'daily', NOW)).toBe(true)   // overdue
    expect(withinHorizon(at(0),  'daily', NOW)).toBe(true)   // today
    expect(withinHorizon(at(1),  'daily', NOW)).toBe(false)  // tomorrow
  })

  it('weekly = overdue through 7 days out; excludes day 8', () => {
    expect(withinHorizon(at(-2), 'weekly', NOW)).toBe(true)
    expect(withinHorizon(at(7),  'weekly', NOW)).toBe(true)  // boundary included
    expect(withinHorizon(at(8),  'weekly', NOW)).toBe(false)
  })

  it('undated tasks are in no horizon', () => {
    expect(withinHorizon(null, 'daily',  NOW)).toBe(false)
    expect(withinHorizon(null, 'weekly', NOW)).toBe(false)
  })
})

describe('date helpers', () => {
  it('toMillis handles Timestamp-like, ISO, millis, and nullish', () => {
    expect(toMillis(1_700_000_000_000)).toBe(1_700_000_000_000)
    expect(toMillis({ seconds: 1_700_000 })).toBe(1_700_000_000)
    expect(toMillis({ toDate: () => new Date(NOW) })).toBe(NOW)
    expect(toMillis('2026-07-07T00:00:00Z')).toBe(Date.parse('2026-07-07T00:00:00Z'))
    expect(toMillis(null)).toBeNull()
    expect(toMillis(undefined)).toBeNull()
  })

  it('daysUntil is day-bucketed and signed', () => {
    expect(daysUntil(at(0), NOW)).toBe(0)
    expect(daysUntil(at(3), NOW)).toBe(3)
    expect(daysUntil(at(-4), NOW)).toBe(-4)
  })
})
