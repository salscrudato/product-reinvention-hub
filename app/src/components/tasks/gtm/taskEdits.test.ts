// Save-path unit tests: the diff writes ONLY changed fields, the commit funnels through
// mutate() exactly once with the right entity path + expectedRev, a VIEWER never reaches a
// write, and a rev mismatch (MutationConflictError) propagates without a second write.
// mutate() is injected as a spy — the adapter stand-in — so this runs in node, no DOM.
import { describe, it, expect, vi } from 'vitest'
import { diffTaskEdits, commitTaskEdits, formFromTask } from './taskEdits'
import type { TaskEditForm } from './taskEdits'
import type { TaskDoc } from './gtm'
import type { MutationPayload } from '../../../lib/backend/types'
import { MutationConflictError } from '../../../lib/backend/types'

const actor = { uid: 'u1', name: 'PM' }

function makeTask(overrides: Partial<TaskDoc> = {}): TaskDoc {
  return {
    id: 't1',
    title: 'Develop rating plan',
    column: 'BUILD_FILE',
    productId: 'PH.PROD.001',
    projectId: 'P1',
    origin: 'seeded',
    phaseL2: 'Product Design',
    groupL3: 'Product Pricing',
    taskL4: 'Develop rating plan',
    phaseOrder: 2,
    slaDays: 5,
    ownerRole: 'Product Mgr.',
    typeOfWork: 'Analytical',
    dueAt: '2027-01-15',
    startDate: '2027-01-08',
    ongoing: false,
    order: 42,
    checklist: [{ t: 'Draft factors', done: false }],
    done: false,
    rev: 7,
    // GovernanceBlock fields the tracker doesn't use but the type requires:
    status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
    createdAt: null, updatedAt: null, updatedBy: 'u1',
    ...overrides,
  } as TaskDoc
}

describe('diffTaskEdits — only the changed fields', () => {
  it('title change → exactly { title } (nothing else)', () => {
    const task = makeTask()
    const form: TaskEditForm = { ...formFromTask(task), title: 'Develop rating plan v2' }
    const data = diffTaskEdits(task, form)
    expect(data).toEqual({ title: 'Develop rating plan v2' })
  })

  it('no edits → null (caller writes nothing)', () => {
    const task = makeTask()
    expect(diffTaskEdits(task, formFromTask(task))).toBeNull()
  })

  it('toggling done stamps done + completedAt together', () => {
    const task = makeTask()
    const data = diffTaskEdits(task, { ...formFromTask(task), done: true })!
    expect(data.done).toBe(true)
    expect(typeof data.completedAt).toBe('string')
    expect(Object.keys(data).sort()).toEqual(['completedAt', 'done'])
  })

  it('a one-off task keeps title and taskL4 in sync; a seeded task does not', () => {
    const adhoc = makeTask({ origin: 'adhoc', taskL4: 'Ad-hoc' })
    const dA = diffTaskEdits(adhoc, { ...formFromTask(adhoc), title: 'Renamed' })!
    expect(dA).toEqual({ title: 'Renamed', taskL4: 'Renamed' })

    const seeded = makeTask({ origin: 'seeded' })
    const dS = diffTaskEdits(seeded, { ...formFromTask(seeded), title: 'Renamed' })!
    expect(dS).toEqual({ title: 'Renamed' })
  })

  it('clearing the due date writes dueAt:null; empty owner normalises to Unassigned', () => {
    const task = makeTask()
    const cleared = diffTaskEdits(task, { ...formFromTask(task), dueDate: '' })!
    expect(cleared).toEqual({ dueAt: null })
    const owner = diffTaskEdits(task, { ...formFromTask(task), ownerRole: '  ' })!
    expect(owner).toEqual({ ownerRole: 'Unassigned' })
  })
})

describe('commitTaskEdits — mutate() seam', () => {
  it('EDITOR save → mutate called exactly once with the right path, rev and changed fields', async () => {
    const mutate = vi.fn<(m: MutationPayload) => Promise<void>>().mockResolvedValue()
    const task = makeTask()
    const form: TaskEditForm = { ...formFromTask(task), column: 'TEST_APPROVE' }

    const result = await commitTaskEdits({ task, form, canEdit: true, actor, mutate })

    expect(result).toBe('saved')
    expect(mutate).toHaveBeenCalledTimes(1)
    const payload = mutate.mock.calls[0]![0]
    expect(payload).toMatchObject({
      op: 'update', path: 'tasks/t1', entityType: 'task',
      productId: 'PH.PROD.001', expectedRev: 7, actor,
      data: { column: 'TEST_APPROVE' },   // ONLY the changed field
    })
    expect(Object.keys(payload.data!)).toEqual(['column'])
  })

  it('VIEWER (canEdit=false) → forbidden and NO mutate is reachable', async () => {
    const mutate = vi.fn<(m: MutationPayload) => Promise<void>>().mockResolvedValue()
    const task = makeTask()
    const form: TaskEditForm = { ...formFromTask(task), title: 'Sneaky edit' }

    const result = await commitTaskEdits({ task, form, canEdit: false, actor, mutate })

    expect(result).toBe('forbidden')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('no changes → noop, mutate never called', async () => {
    const mutate = vi.fn<(m: MutationPayload) => Promise<void>>().mockResolvedValue()
    const task = makeTask()
    const result = await commitTaskEdits({ task, form: formFromTask(task), canEdit: true, actor, mutate })
    expect(result).toBe('noop')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('rev mismatch → the conflict propagates and NOTHING further is written', async () => {
    const mutate = vi.fn<(m: MutationPayload) => Promise<void>>().mockRejectedValue(new MutationConflictError())
    const task = makeTask()
    const form: TaskEditForm = { ...formFromTask(task), title: 'Concurrent edit' }

    await expect(commitTaskEdits({ task, form, canEdit: true, actor, mutate }))
      .rejects.toBeInstanceOf(MutationConflictError)

    // One attempt, then it stops — never a silent retry/overwrite.
    expect(mutate).toHaveBeenCalledTimes(1)
  })
})
