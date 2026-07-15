// boardDnd — the board's drag-and-drop WRITE path, extracted pure so this test can pin
// it forever: a drop writes EXACTLY { column } (never order, never a batch) through one
// atomic mutate() with the optimistic-lock rev, and the optimistic overlay rolls back on
// failure. These assertions are the E1 gate "dnd still writes correctly".
import { describe, it, expect, vi } from 'vitest'
import { MutationConflictError } from '../../../lib/backend/types'
import { resolveDrop, moveTaskPayload, commitMove } from './boardDnd'
import type { TaskDoc } from './gtm'

const task = (over: Partial<TaskDoc> = {}): TaskDoc => ({
  id: 't1', title: 'File rates with DOI', column: 'BUILD_FILE',
  order: 12, checklist: [], rev: 3, productId: 'PA.PROD.001',
  ...over,
} as unknown as TaskDoc)

const actor = { uid: 'u1', name: 'Pat PM' }

describe('resolveDrop — DragEndEvent → concrete move (or null)', () => {
  const tasks = [task(), task({ id: 't2', column: 'IDEATION' })]

  it('drop outside any column (over: null) is a no-op', () => {
    expect(resolveDrop({ active: { id: 't1' }, over: null }, tasks)).toBeNull()
  })
  it('drop on a non-column id is a no-op', () => {
    expect(resolveDrop({ active: { id: 't1' }, over: { id: 'not-a-column' } }, tasks)).toBeNull()
  })
  it('drop on the SAME column is a no-op (no write)', () => {
    expect(resolveDrop({ active: { id: 't1' }, over: { id: 'BUILD_FILE' } }, tasks)).toBeNull()
  })
  it('unknown task id is a no-op', () => {
    expect(resolveDrop({ active: { id: 'ghost' }, over: { id: 'IDEATION' } }, tasks)).toBeNull()
  })
  it('a valid cross-column drop resolves to the task + target column', () => {
    expect(resolveDrop({ active: { id: 't1' }, over: { id: 'TEST_APPROVE' } }, tasks))
      .toEqual({ task: tasks[0], toColumn: 'TEST_APPROVE' })
  })
})

describe('moveTaskPayload — the exact write, pinned', () => {
  it('is a single update of { column } ONLY, with expectedRev', () => {
    const p = moveTaskPayload(task(), 'TEST_APPROVE', actor)
    expect(p).toEqual({
      op: 'update', path: 'tasks/t1', data: { column: 'TEST_APPROVE' },
      entityType: 'task', productId: 'PA.PROD.001', actor, expectedRev: 3,
    })
    // The load-bearing pin: a drop never writes order (or anything else) alongside column.
    expect(Object.keys(p.data as object)).toEqual(['column'])
  })
})

describe('commitMove — optimistic overlay + rollback + honest classification', () => {
  it('sets the overlay BEFORE the mutate resolves, and reports moved', async () => {
    const calls: string[] = []
    const mutate = vi.fn(async () => { calls.push('mutate') })
    const setOverride = vi.fn((_id: string, patch: unknown) => { calls.push(patch ? 'overlay' : 'clear') })
    const r = await commitMove({ task: task(), toColumn: 'TEST_APPROVE', actor, mutate, setOverride })
    expect(r).toBe('moved')
    expect(calls).toEqual(['overlay', 'mutate'])
    expect(setOverride).toHaveBeenCalledWith('t1', { column: 'TEST_APPROVE' })
    expect(mutate).toHaveBeenCalledTimes(1)
  })
  it('rolls the overlay back (null) on failure and reports error', async () => {
    const mutate = vi.fn(async () => { throw new Error('boom') })
    const setOverride = vi.fn()
    const r = await commitMove({ task: task(), toColumn: 'IDEATION', actor, mutate, setOverride })
    expect(r).toBe('error')
    expect(setOverride).toHaveBeenLastCalledWith('t1', null)
  })
  it('classifies a stale-rev failure as conflict (and still rolls back)', async () => {
    const mutate = vi.fn(async () => { throw new MutationConflictError('tasks/t1') })
    const setOverride = vi.fn()
    const r = await commitMove({ task: task(), toColumn: 'IDEATION', actor, mutate, setOverride })
    expect(r).toBe('conflict')
    expect(setOverride).toHaveBeenLastCalledWith('t1', null)
  })
})
