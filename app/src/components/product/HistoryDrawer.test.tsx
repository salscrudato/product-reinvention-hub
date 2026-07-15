// @vitest-environment jsdom
// H2 — HistoryDrawer restore, activated. The dormant restore UI (gated on the always-null
// snapshot) is now driven by canRestore (rev > 0) and refined in-drawer to hide the current
// version (a no-op the server rejects). Restore calls adapter.db.restore(path, targetRev,
// currentRev) — the SERVER reconstructs; a 409 shows the conflict toast, a 422 explains
// honestly. Backend + context are mocked so nothing touches Cosmos.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { Version } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const PID = 'PH.PROD.001'
const COV_PATH = `products/${PID}/coverages/PH-COV-001`

// Shared, hoisted mock state (vi.mock factories are hoisted above top-level consts, so
// everything they reference must be hoisted too).
const h = vi.hoisted(() => ({
  restore: vi.fn(),
  successToast: vi.fn(),
  errorToast: vi.fn(),
  conflictToast: vi.fn(),
  USER: { uid: 'u1', name: 'Ada', role: 'EDITOR' } as { uid: string; name: string; role: string },
  VERSIONS: [] as unknown[],
}))

vi.mock('../../lib/backend', () => {
  class MutationConflictError extends Error {}
  return { MutationConflictError, adapter: { db: { restore: h.restore } } }
})
vi.mock('sonner', () => ({ toast: { success: h.successToast, error: h.errorToast } }))
vi.mock('../../lib/conflict', () => ({ conflictToast: h.conflictToast }))
// canEdit follows role; restore gating is what we exercise (server enforces the real matrix).
vi.mock('../../lib/canI', () => ({ canI: (u: { role?: string } | null) => u?.role !== 'VIEWER' }))
vi.mock('../../context/useUser', () => ({ useUser: () => ({ user: h.USER }) }))
vi.mock('../../context/useProductCtx', () => ({ useProductCtx: () => ({ versions: h.VERSIONS, pid: PID }) }))

import { HistoryDrawer } from './HistoryDrawer'
import { MutationConflictError } from '../../lib/backend'

function v(rev: number, op: Version['op'], overrides: Partial<WithId<Version>> = {}): WithId<Version> {
  return {
    id: `ver:${COV_PATH}:${rev}`, entityType: 'coverage', entityPath: COV_PATH, productId: PID,
    snapshot: null, canRestore: rev > 0, rev, op,
    diff: [{ field: 'limit', before: rev * 100, after: (rev + 1) * 100 }],
    actor: { uid: 'u1', name: 'Ada' }, at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  }
}

// Newest-first, as ProductContext delivers. rev 2 is the current (latest) version.
function twoRevs() { return [v(2, 'update'), v(1, 'create')] }

beforeEach(() => { h.USER = { uid: 'u1', name: 'Ada', role: 'EDITOR' }; h.VERSIONS = twoRevs(); h.restore.mockReset(); h.successToast.mockReset(); h.errorToast.mockReset(); h.conflictToast.mockReset(); h.restore.mockResolvedValue({ rev: 3, restoredFrom: 1 }) })
afterEach(cleanup)

// Expand a row by its action badge label (Created row = rev 1, Updated row = rev 2 current).
function expandRow(label: 'Created' | 'Updated') {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
}

describe('HistoryDrawer restore gating', () => {
  it('offers restore on an OLDER version but NOT on the current version', () => {
    render(<HistoryDrawer onClose={() => {}} entityPath={COV_PATH} />)
    expandRow('Created')                 // rev 1 — older than current rev 2
    expect(screen.getByRole('button', { name: /Restore to this version/ })).toBeTruthy()
    // Collapse & expand the current version — no restore affordance (nothing to rewind to).
    expandRow('Created')                 // toggle closed
    expandRow('Updated')                 // rev 2 — the current version
    expect(screen.queryByRole('button', { name: /Restore to this version/ })).toBeNull()
  })

  it('a VIEWER never sees a restore control', () => {
    h.USER = { uid: 'u2', name: 'Val', role: 'VIEWER' }
    render(<HistoryDrawer onClose={() => {}} entityPath={COV_PATH} />)
    expandRow('Created')
    expect(screen.queryByRole('button', { name: /Restore to this version/ })).toBeNull()
  })
})

describe('HistoryDrawer restore action', () => {
  it('confirms then calls adapter.db.restore(path, targetRev, currentRev) and toasts success', async () => {
    render(<HistoryDrawer onClose={() => {}} entityPath={COV_PATH} />)
    expandRow('Created')
    fireEvent.click(screen.getByRole('button', { name: /Restore to this version/ }))  // arm confirm
    fireEvent.click(screen.getByRole('button', { name: /^Restore$/ }))                // confirm
    await waitFor(() => expect(h.restore).toHaveBeenCalledTimes(1))
    // targetRev = 1 (the version chosen), expectedRev = 2 (the entity's current rev)
    expect(h.restore).toHaveBeenCalledWith(COV_PATH, 1, 2)
    await waitFor(() => expect(h.successToast).toHaveBeenCalled())
    expect(h.errorToast).not.toHaveBeenCalled()
  })

  it('a 409 (stale rev) shows the conflict toast, not a generic error', async () => {
    h.restore.mockRejectedValueOnce(new MutationConflictError())
    render(<HistoryDrawer onClose={() => {}} entityPath={COV_PATH} />)
    expandRow('Created')
    fireEvent.click(screen.getByRole('button', { name: /Restore to this version/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Restore$/ }))
    await waitFor(() => expect(h.conflictToast).toHaveBeenCalled())
    expect(h.successToast).not.toHaveBeenCalled()
  })

  it('a 422 (unreconstructable) explains the gap honestly', async () => {
    h.restore.mockRejectedValueOnce(new Error('unreconstructable'))
    render(<HistoryDrawer onClose={() => {}} entityPath={COV_PATH} />)
    expandRow('Created')
    fireEvent.click(screen.getByRole('button', { name: /Restore to this version/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Restore$/ }))
    await waitFor(() => expect(h.errorToast).toHaveBeenCalled())
    expect(h.errorToast.mock.calls[0][0]).toMatch(/gap/i)
    expect(h.conflictToast).not.toHaveBeenCalled()
  })
})
