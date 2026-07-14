// @vitest-environment jsdom
// Interaction test — walks the Review → Adjust → Seed flow end-to-end at the React boundary:
// open the sheet, deselect a whole phase and two individual tasks, seed, and assert the atomic
// batch creates EXACTLY the selected set (deselected rows absent), each carrying full lineage.
// This is the automated stand-in for the manual local walk (a live walk needs the Azure host).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { GTM_PROCESS_TEMPLATE, seedRefIdFor } from '@pf/shared'
import type { MutationPayload } from '../../../lib/backend/types'
import type { ProjectDoc } from './gtm'

// Hoisted so the vi.mock factory (also hoisted) can close over the same spy.
const { mutateBatch } = vi.hoisted(() => ({ mutateBatch: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../../lib/backend', () => {
  class MutationConflictError extends Error {}
  return { MutationConflictError, adapter: { db: { mutateBatch } } }
})

import { SeedReviewSheet } from './SeedReviewSheet'

const actor = { uid: 'u1', name: 'PM' }
const project = {
  id: 'project-1', refId: 'PRJ.001', name: 'PA National', description: '', productId: 'PH.PROD.001',
  targetLaunchDate: '2099-12-31', status: 'planning', owner: actor, createdAt: null, updatedAt: null, rev: 1,
} as unknown as ProjectDoc

const researchCount = GTM_PROCESS_TEMPLATE.filter(t => t.phaseL2 === 'Product Research').length
const designRows = GTM_PROCESS_TEMPLATE.filter(t => t.phaseL2 === 'Product Design').slice(0, 2)

beforeEach(() => mutateBatch.mockClear())
afterEach(cleanup)

describe('SeedReviewSheet — walk the flow', () => {
  it('seeds exactly the selected set: deselect a phase + two tasks, then seed', async () => {
    const onSeeded = vi.fn()
    render(<SeedReviewSheet project={project} priorSeeded={[]} actor={actor} onClose={() => {}} onSeeded={onSeeded} />)

    // Starts with everything selected.
    expect(screen.getByRole('button', { name: `Seed ${GTM_PROCESS_TEMPLATE.length} tasks` })).toBeTruthy()

    // Deselect the whole Product Research phase.
    fireEvent.click(screen.getByLabelText('Select all Product Research tasks'))
    // Deselect two Product Design tasks.
    for (const t of designRows) fireEvent.click(screen.getByLabelText(`Include: ${t.taskL4}`))

    const remaining = GTM_PROCESS_TEMPLATE.length - researchCount - designRows.length
    const seedBtn = screen.getByRole('button', { name: `Seed ${remaining} tasks` })
    fireEvent.click(seedBtn)

    // The seed resolves on a microtask; wait for the success callback to fire.
    await waitFor(() => expect(onSeeded).toHaveBeenCalled())

    // The atomic batch was called once with exactly the selected set.
    expect(mutateBatch).toHaveBeenCalledTimes(1)
    const payloads = mutateBatch.mock.calls[0]![0] as MutationPayload[]
    const creates = payloads.filter(p => p.op === 'create')
    expect(creates).toHaveLength(remaining)

    // None of the deselected rows made it in.
    const seededRefs = new Set(creates.map(c => c.data!.seedRefId as string))
    for (const t of GTM_PROCESS_TEMPLATE.filter(t => t.phaseL2 === 'Product Research')) {
      expect(seededRefs.has(seedRefIdFor(t))).toBe(false)
    }
    for (const t of designRows) expect(seededRefs.has(seedRefIdFor(t))).toBe(false)

    // Every created task carries project + product + a batch id; onSeeded fired with the count.
    for (const c of creates) {
      expect(c.data!.projectId).toBe('project-1')
      expect(c.data!.productId).toBe('PH.PROD.001')
      expect(typeof c.data!.seedBatchId).toBe('string')
    }
    expect(onSeeded).toHaveBeenCalledWith(expect.any(String), remaining)
  })

  it('blocks seeding when nothing new is selectable and shows why', () => {
    // Re-seed an already-complete board: everything is present → nothing to add.
    const prior = GTM_PROCESS_TEMPLATE.map((t, i) =>
      ({ id: `gtm-${i}`, title: t.taskL4, column: 'IDEATION', checklist: [], order: 0, origin: 'seeded', seedRefId: seedRefIdFor(t) }) as unknown as import('./gtm').TaskDoc)
    render(<SeedReviewSheet project={project} priorSeeded={prior} actor={actor} onClose={() => {}} onSeeded={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Seed board' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByText('Everything is already on the board.')).toBeTruthy()
  })
})
