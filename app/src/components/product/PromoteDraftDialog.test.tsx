// @vitest-environment jsdom
// P3 task 4 — promotion is a SERVER verdict: the dialog calls the promote seam
// (never a client-side lifecycle mutate), and a 409-blocked promote renders the
// server's blockers verbatim. The typed-name gate stays.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  promote: vi.fn(),
  successToast: vi.fn(),
  errorToast: vi.fn(),
  conflictToast: vi.fn(),
}))

vi.mock('../../lib/backend', () => {
  class MutationConflictError extends Error {}
  class PromoteBlockedError extends Error {
    readonly blockers: string[]
    constructor(blockers: string[] = []) { super('blocked'); this.blockers = blockers }
  }
  return { MutationConflictError, PromoteBlockedError, adapter: { db: { promoteDraft: h.promote } } }
})
vi.mock('sonner', () => ({ toast: { success: h.successToast, error: h.errorToast } }))
vi.mock('../../lib/conflict', () => ({ conflictToast: h.conflictToast }))

import { PromoteDraftDialog } from './PromoteDraftDialog'
import { PromoteBlockedError } from '../../lib/backend'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const PRODUCT = { id: 'draft-ho-1', name: 'HO3 Draft', rev: 4, lifecycle: 'DRAFT' } as unknown as WithId<Product>
const ACTOR = { uid: 'u1', name: 'Admin' }

beforeEach(() => { h.promote.mockReset(); h.promote.mockResolvedValue({ rev: 5 }); h.successToast.mockReset(); h.errorToast.mockReset() })
afterEach(cleanup)

function renderDialog() {
  const onClose = vi.fn(); const onPromoted = vi.fn()
  render(<PromoteDraftDialog product={PRODUCT} actor={ACTOR} onClose={onClose} onPromoted={onPromoted} />)
  return { onClose, onPromoted }
}

function typeNameAndPromote() {
  fireEvent.change(screen.getByLabelText(/Type the product name/), { target: { value: 'HO3 Draft' } })
  fireEvent.click(screen.getByRole('button', { name: /Promote to published/ }))
}

describe('PromoteDraftDialog', () => {
  it('promotes through the server-verdict seam with the optimistic rev', async () => {
    const { onPromoted } = renderDialog()
    typeNameAndPromote()
    await waitFor(() => expect(onPromoted).toHaveBeenCalledWith('draft-ho-1'))
    expect(h.promote).toHaveBeenCalledWith('draft-ho-1', 4)
  })

  it('the typed-name gate still blocks: no call until the exact name is typed', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /Promote to published/ }))
    expect(h.promote).not.toHaveBeenCalled()
  })

  it('a 409-blocked promote renders the SERVER blockers verbatim and keeps the dialog open', async () => {
    h.promote.mockRejectedValue(new PromoteBlockedError([
      'Coverage "CA-EQ" cites sheet row 44 which was dropped',
      'Rating step 9: ungrounded-field factor',
    ]))
    const { onClose } = renderDialog()
    typeNameAndPromote()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The server refused this promotion')
    expect(alert.textContent).toContain('Coverage "CA-EQ" cites sheet row 44 which was dropped')
    expect(alert.textContent).toContain('Rating step 9: ungrounded-field factor')
    expect(onClose).not.toHaveBeenCalled()
    expect(h.successToast).not.toHaveBeenCalled()
  })
})
