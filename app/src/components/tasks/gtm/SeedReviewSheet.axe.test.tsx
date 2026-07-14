// @vitest-environment jsdom
// Accessibility (axe) checks for the Review → Adjust → Seed surface, across its three states:
// a fresh seed, an idempotent re-seed (with already-on-board rows), and the deadline-too-tight
// resolution. jsdom can't compute layout, so color-contrast is disabled (tokens are checked
// separately); `region` is off because this is an isolated component render with no page <main>.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { vi } from 'vitest'
import { GTM_PROCESS_TEMPLATE, seedRefIdFor } from '@pf/shared'
import { SeedReviewSheet } from './SeedReviewSheet'
import type { ProjectDoc, TaskDoc } from './gtm'

vi.mock('../../../lib/backend', () => {
  class MutationConflictError extends Error {}
  return { MutationConflictError, adapter: { db: { mutateBatch: vi.fn().mockResolvedValue(undefined) } } }
})

const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }
async function axeViolations(el: Element): Promise<string[]> {
  const { violations } = await axe(el, AXE_OPTS)
  return violations.map(v => `${v.id} (${v.nodes.length} node(s)): ${v.help}`)
}

const actor = { uid: 'u1', name: 'PM' }
const project = {
  id: 'project-1', refId: 'PRJ.001', name: 'PA National', description: '', productId: 'PH.PROD.001',
  targetLaunchDate: '2099-12-31', status: 'planning', owner: actor, createdAt: null, updatedAt: null, rev: 1,
} as unknown as ProjectDoc
const seededTask = (over: Partial<TaskDoc> & { id: string }): TaskDoc =>
  ({ title: 't', column: 'IDEATION', checklist: [], order: 0, origin: 'seeded', ...over }) as unknown as TaskDoc

afterEach(cleanup)

describe('SeedReviewSheet — axe', () => {
  it('a fresh seed has no violations', async () => {
    render(<SeedReviewSheet project={project} priorSeeded={[]} actor={actor} onClose={() => {}} onSeeded={() => {}} />)
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('a re-seed (with already-on-board rows) has no violations', async () => {
    const prior = GTM_PROCESS_TEMPLATE.slice(0, 20).map((t, i) => seededTask({ id: `gtm-${i}`, seedRefId: seedRefIdFor(t) }))
    render(<SeedReviewSheet project={project} priorSeeded={prior} actor={actor} onClose={() => {}} onSeeded={() => {}} />)
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('the deadline-too-tight resolution has no violations', async () => {
    // A past deadline can never fit the forward-only chain → the resolution banner renders.
    const tight = { ...project, targetLaunchDate: '2020-01-01' } as ProjectDoc
    render(<SeedReviewSheet project={tight} priorSeeded={[]} actor={actor} onClose={() => {}} onSeeded={() => {}} />)
    expect(await axeViolations(document.body)).toEqual([])
  })
})
