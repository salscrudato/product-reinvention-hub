// Review-model unit tests — the pure logic behind Review → Adjust → Seed: idempotency
// (already-on-board rows are proposed only once), deselection math, and that every created
// task carries product/project/seedRef lineage. No React, no emulator.
import { describe, it, expect } from 'vitest'
import { GTM_PROCESS_TEMPLATE, seedRefIdFor } from '@pf/shared'
import {
  taskSeedRefId, presentSeedRefIds, allSeedRefIds, computeReviewPlan,
} from './seedReview'
import { buildSeedPlanPayloads } from './gtm'
import type { TaskDoc, ProjectDoc } from './gtm'

const TODAY = '2026-07-03'
const project: ProjectDoc = {
  id: 'project-1', refId: 'PRJ.001', name: 'PA National', description: '',
  productId: 'PH.PROD.001', targetLaunchDate: '2027-06-30', status: 'planning',
  owner: { uid: 'u1', name: 'Sal' }, createdAt: null, updatedAt: null, rev: 3,
}
const seededTask = (over: Partial<TaskDoc> & { id: string }): TaskDoc =>
  ({ title: 't', column: 'IDEATION', checklist: [], order: 0, origin: 'seeded', ...over }) as unknown as TaskDoc

const firstRow = GTM_PROCESS_TEMPLATE[0]!
const firstId = seedRefIdFor(firstRow)

describe('taskSeedRefId — stored field, else recomputed from lineage', () => {
  it('prefers the stored seedRefId', () => {
    expect(taskSeedRefId(seededTask({ id: 'a', seedRefId: 'pm-deadbeef' }))).toBe('pm-deadbeef')
  })
  it('recomputes from L1→L4 lineage for legacy tasks (no stored field)', () => {
    const legacy = seededTask({ id: 'b', phaseL2: firstRow.phaseL2, groupL3: firstRow.groupL3, taskL4: firstRow.taskL4 })
    expect(taskSeedRefId(legacy)).toBe(firstId)
  })
  it('returns null for an ad-hoc task with no lineage', () => {
    expect(taskSeedRefId(seededTask({ id: 'c', origin: 'adhoc' }))).toBeNull()
  })
})

describe('presentSeedRefIds — the on-board key set', () => {
  it('collects stored + legacy ids and dedups', () => {
    const present = presentSeedRefIds([
      seededTask({ id: 'a', seedRefId: firstId }),
      seededTask({ id: 'b', phaseL2: firstRow.phaseL2, groupL3: firstRow.groupL3, taskL4: firstRow.taskL4 }), // same row, legacy
      seededTask({ id: 'c', origin: 'adhoc' }), // no lineage → ignored
    ])
    expect(present.has(firstId)).toBe(true)
    expect(present.size).toBe(1)
  })
})

describe('computeReviewPlan — deselection math', () => {
  const template = GTM_PROCESS_TEMPLATE
  it('a fresh project selects everything and creates every row', () => {
    const r = computeReviewPlan({
      template, selected: allSeedRefIds(template), present: new Set(), deadline: '2027-06-30',
      options: { today: TODAY },
    })
    expect(r.selectedCount).toBe(65)
    expect(r.newCount).toBe(65)
    expect(r.presentCount).toBe(0)
  })
  it('deselecting a whole phase shrinks the plan and the critical path', () => {
    const full = computeReviewPlan({
      template, selected: allSeedRefIds(template), present: new Set(), deadline: '2027-06-30',
      options: { today: TODAY },
    })
    // Deselect every "Product Research" row.
    const selected = new Set(allSeedRefIds(template))
    for (const t of template) if (t.phaseL2 === 'Product Research') selected.delete(seedRefIdFor(t))
    const trimmed = computeReviewPlan({ template, selected, present: new Set(), deadline: '2027-06-30', options: { today: TODAY } })
    expect(trimmed.selectedCount).toBeLessThan(full.selectedCount)
    expect(trimmed.plan.criticalPathDays).toBeLessThan(full.plan.criticalPathDays)
    expect(trimmed.newCount).toBe(trimmed.selectedCount)
  })
})

describe('computeReviewPlan — idempotent re-seed', () => {
  const template = GTM_PROCESS_TEMPLATE
  it('proposes only rows not already on the board', () => {
    // Half the rows already seeded.
    const half = template.slice(0, 30).map((t, i) => seededTask({ id: `gtm-${i}`, seedRefId: seedRefIdFor(t) }))
    const present = presentSeedRefIds(half)
    const r = computeReviewPlan({
      template, selected: allSeedRefIds(template), present, deadline: '2027-06-30', options: { today: TODAY },
    })
    expect(r.presentCount).toBe(30)
    expect(r.newCount).toBe(35)
    expect(r.selectedCount).toBe(65)
    // None of the toCreate rows is already present.
    expect(r.toCreate.every(p => !present.has(p.seedRefId))).toBe(true)
  })
  it('re-seeding an unchanged board proposes nothing', () => {
    const all = template.map((t, i) => seededTask({ id: `gtm-${i}`, seedRefId: seedRefIdFor(t) }))
    const present = presentSeedRefIds(all)
    const r = computeReviewPlan({
      template, selected: allSeedRefIds(template), present, deadline: '2027-06-30', options: { today: TODAY },
    })
    expect(r.newCount).toBe(0)
    expect(r.toCreate).toHaveLength(0)
  })
})

describe('buildSeedPlanPayloads — lineage on every created task', () => {
  const template = GTM_PROCESS_TEMPLATE
  const r = computeReviewPlan({
    template, selected: allSeedRefIds(template), present: new Set(), deadline: '2027-06-30', options: { today: TODAY },
  })
  it('every create carries projectId + productId + a stable seedRefId + seedBatchId', () => {
    const payloads = buildSeedPlanPayloads({ project, toCreate: r.toCreate, seedBatchId: 'batch-9', actor: { uid: 'u1', name: 'Sal' } })
    const creates = payloads.filter(p => p.op === 'create')
    expect(creates).toHaveLength(65)
    for (const c of creates) {
      expect(c.data!.projectId).toBe('project-1')
      expect(c.data!.productId).toBe('PH.PROD.001')
      expect(c.data!.seedRefId).toMatch(/^pm-[0-9a-f]{8}$/)
      expect(c.data!.seedBatchId).toBe('batch-9')
      expect(c.data!.origin).toBe('seeded')
      expect(c.path).toBe(`tasks/gtm-project-1-${c.data!.seedRefId}`)   // deterministic, idempotent id
    }
  })
  it('deterministic ids make a create set idempotent (same rows → same paths)', () => {
    const a = buildSeedPlanPayloads({ project, toCreate: r.toCreate, seedBatchId: 'b1', actor: { uid: 'u1', name: 'Sal' } })
    const b = buildSeedPlanPayloads({ project, toCreate: r.toCreate, seedBatchId: 'b2', actor: { uid: 'u1', name: 'Sal' } })
    expect(a.map(p => p.path)).toEqual(b.map(p => p.path))
  })
  it('persists a moved deadline as a rev-guarded project update, ahead of the creates', () => {
    const payloads = buildSeedPlanPayloads({
      project, toCreate: r.toCreate.slice(0, 2), seedBatchId: 'b', actor: { uid: 'u1', name: 'Sal' },
      deadlineUpdate: '2027-09-30',
    })
    expect(payloads[0]!.op).toBe('update')
    expect(payloads[0]!.path).toBe('projects/project-1')
    expect(payloads[0]!.expectedRev).toBe(3)
    expect(payloads[0]!.data!.targetLaunchDate).toBe('2027-09-30')
    // An unchanged deadline adds no update op.
    const same = buildSeedPlanPayloads({ project, toCreate: [], seedBatchId: 'b', actor: { uid: 'u1', name: 'Sal' }, deadlineUpdate: project.targetLaunchDate })
    expect(same).toHaveLength(0)
  })
})
