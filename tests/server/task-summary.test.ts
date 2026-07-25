// task-summary.test.ts — R0 Home wave: the grounded task summary's grounding
// invariants, tested directly (no model call): citations that don't resolve to a
// real roster id are stripped (never shown invented), and the open/overdue/next-7
// buckets are computed deterministically server-side.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

// task-summary pulls in the auth chain at require time. Set here rather than relying on
// another test file in the same worker having set it first — that ordering is incidental,
// and adding any test file can break it (same convention as cost-guard/daily-brief).
process.env.AUTH_JWT_SECRET ??= 'test-secret-task-summary-tests-minimum32c'

const _require = createRequire(import.meta.url)
const ts = _require('../../server/lib/ai/task-summary') as {
  _stripUncited: (raw: string, valid: Set<string>) => { summary: string; cited: string[] }
  _bucketize: (tasks: Array<Record<string, unknown>>) => { open: unknown[]; overdue: unknown[]; next7: unknown[]; dueToday: unknown[] }
}

describe('_stripUncited (grounded + cited invariant)', () => {
  const valid = new Set(['gtm-p1-pm-aaaa1111', 'adhoc-42'])

  it('keeps citations that resolve to roster ids', () => {
    const { summary, cited } = ts._stripUncited('Finish [gtm-p1-pm-aaaa1111] first, then [adhoc-42].', valid)
    expect(summary).toBe('Finish [gtm-p1-pm-aaaa1111] first, then [adhoc-42].')
    expect(cited).toEqual(['gtm-p1-pm-aaaa1111', 'adhoc-42'])
  })

  it('strips invented citations and reports zero cited when none resolve', () => {
    const { summary, cited } = ts._stripUncited('Do [made-up-id] and [another-fake] now.', valid)
    expect(summary).not.toContain('made-up-id')
    expect(summary).not.toContain('[')
    expect(cited).toEqual([])
  })

  it('mixes: real citations survive, fakes vanish, spacing collapses', () => {
    const { summary, cited } = ts._stripUncited('Start [adhoc-42] then [fake-1] then rest.', valid)
    expect(summary).toBe('Start [adhoc-42] then then rest.')
    expect(cited).toEqual(['adhoc-42'])
  })
})

describe('_bucketize (deterministic counts)', () => {
  const today = new Date().toISOString().slice(0, 10)
  const past = '2020-01-01'
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  const far = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  it('dueToday (additive, brief-consumed): the next7 slice due exactly today', () => {
    const { dueToday, next7 } = ts._bucketize([
      { id: 'today', dueAt: today, done: false },
      { id: 'soon', dueAt: soon, done: false },
    ])
    expect(dueToday).toHaveLength(1)
    expect(next7).toHaveLength(2)
  })

  it('buckets open / overdue / next-7 correctly', () => {
    const tasks = [
      { id: 'a', dueAt: past, done: false },              // overdue + open
      { id: 'b', dueAt: soon, done: false },              // next7 + open
      { id: 'c', dueAt: far, done: false },               // open only
      { id: 'd', dueAt: past, done: true },               // done — excluded everywhere
      { id: 'e', dueAt: past, done: false, ongoing: true }, // ongoing — open, never overdue
      { id: 'f', dueAt: today, done: false },             // due today → next7
    ]
    const b = ts._bucketize(tasks)
    expect(b.open.length).toBe(5)
    expect(b.overdue.map((t: any) => t.id)).toEqual(['a'])
    expect(b.next7.map((t: any) => t.id).sort()).toEqual(['b', 'f'])
  })
})
