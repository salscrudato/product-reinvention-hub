// @vitest-environment jsdom
// P3 directive 09 — delete safety, locked: TWO-step confirmation, LIVE child counts
// in the consequence copy, honest permanence wording (the server hard-deletes; there
// is no recovery window), and no delete until the second step commits.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  del: vi.fn(),
  successToast: vi.fn(),
  errorToast: vi.fn(),
}))

vi.mock('../../lib/product/deleteDraft', () => ({ deleteDraftProduct: h.del }))
vi.mock('sonner', () => ({ toast: { success: h.successToast, error: h.errorToast } }))

import { DeleteDraftDialog } from './DeleteDraftDialog'

const PRODUCT = { id: 'draft-ho-1', name: 'HO3_Countrywide_2026 - PH - Jul 15', lifecycle: 'DRAFT' }
const ACTOR = { uid: 'u1', name: 'Admin' }

beforeEach(() => { h.del.mockReset(); h.del.mockResolvedValue(undefined); h.successToast.mockReset(); h.errorToast.mockReset() })
afterEach(cleanup)

function renderDialog(counts?: { coverages?: number; forms?: number }) {
  const onClose = vi.fn(); const onDeleted = vi.fn()
  render(<DeleteDraftDialog product={PRODUCT} actor={ACTOR} counts={counts} onClose={onClose} onDeleted={onDeleted} />)
  return { onClose, onDeleted }
}

describe('DeleteDraftDialog', () => {
  it('step 1 states the real consequence with LIVE counts and honest permanence — and offers no delete button yet', () => {
    renderDialog({ coverages: 12, forms: 1359 })
    const copy = screen.getByRole('dialog').textContent ?? ''
    expect(copy).toContain('1,359 extracted forms')
    expect(copy).toContain('12 coverages')
    expect(copy).toContain('permanent')
    expect(copy).toContain('no recovery window')
    expect(screen.queryByRole('button', { name: /Delete draft/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeTruthy()
    expect(h.del).not.toHaveBeenCalled()
  })

  it('unknown counts degrade honestly instead of inventing numbers', () => {
    renderDialog(undefined)
    const copy = screen.getByRole('dialog').textContent ?? ''
    expect(copy).toContain('its extracted forms')
    expect(copy).toContain('its coverages')
    expect(copy).not.toMatch(/\b0 extracted forms\b/)
  })

  it('step 2 commits: Continue → Delete draft → cascade runs once and onDeleted fires', async () => {
    const { onDeleted } = renderDialog({ coverages: 12, forms: 1359 })
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    const del = screen.getByRole('button', { name: /Delete draft/ })
    expect((screen.getByRole('dialog').textContent ?? '')).toContain('Last confirmation')
    fireEvent.click(del)
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(h.del).toHaveBeenCalledTimes(1)
    expect(h.del).toHaveBeenCalledWith(PRODUCT, ACTOR)
  })

  it('Back returns to step 1 without deleting', () => {
    renderDialog({ coverages: 1, forms: 1 })
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByRole('button', { name: /Continue/ })).toBeTruthy()
    expect(h.del).not.toHaveBeenCalled()
  })
})
