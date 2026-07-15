// @vitest-environment jsdom
// H6 a11y: the History drawer's newly-activated restore control + the XLSX export button carry
// no structural accessibility violations (accessible names, roles, aria-expanded, labelled
// controls). jsdom can't compute layout, so color-contrast is checked separately; every
// structural axe rule runs. Backend + context are mocked so nothing touches Cosmos.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { axe } from 'vitest-axe'
import type { Version } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const PID = 'PH.PROD.001'
const COV = `products/${PID}/coverages/PH-COV-001`
const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }

const h = vi.hoisted(() => ({ restore: vi.fn().mockResolvedValue({ rev: 3, restoredFrom: 1 }) }))
vi.mock('../../lib/backend', () => { class MutationConflictError extends Error {}; return { MutationConflictError, adapter: { db: { restore: h.restore } } } })
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../lib/conflict', () => ({ conflictToast: vi.fn() }))
vi.mock('../../lib/canI', () => ({ canI: () => true }))
vi.mock('../../context/useUser', () => ({ useUser: () => ({ user: { uid: 'u1', name: 'Ada', role: 'EDITOR' } }) }))
vi.mock('../../context/useProductCtx', () => ({
  useProductCtx: () => ({
    pid: PID,
    versions: [
      { id: `${COV}:2`, entityType: 'coverage', entityPath: COV, productId: PID, snapshot: null, canRestore: true, rev: 2, op: 'update', diff: [{ field: 'limit', before: 100, after: 200 }], actor: { uid: 'u1', name: 'Ada' }, at: '2026-07-15T00:00:00.000Z' },
      { id: `${COV}:1`, entityType: 'coverage', entityPath: COV, productId: PID, snapshot: null, canRestore: true, rev: 1, op: 'create', diff: [{ field: 'limit', before: undefined, after: 100 }], actor: { uid: 'u1', name: 'Ada' }, at: '2026-07-15T00:00:00.000Z' },
    ] as WithId<Version>[],
  }),
}))

import { HistoryDrawer } from './HistoryDrawer'

async function axeViolations(el: Element): Promise<string[]> {
  const { violations } = await axe(el, AXE_OPTS)
  return violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`)
}

afterEach(cleanup)

describe('a11y (axe) — HistoryDrawer restore + export', () => {
  it('is clean on open (search, filters, export button, timeline)', async () => {
    render(<HistoryDrawer onClose={() => {}} entityPath={COV} />)
    expect(screen.getByRole('button', { name: /Export change history as XLSX/ })).toBeTruthy()
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('is clean with a row expanded and the restore confirm armed', async () => {
    render(<HistoryDrawer onClose={() => {}} entityPath={COV} />)
    fireEvent.click(screen.getByRole('button', { name: /Created/ }))                 // expand rev 1 (restorable)
    fireEvent.click(screen.getByRole('button', { name: /Restore to this version/ })) // arm the inline confirm
    expect(await axeViolations(document.body)).toEqual([])
  })
})
