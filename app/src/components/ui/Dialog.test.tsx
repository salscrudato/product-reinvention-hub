// @vitest-environment jsdom
// Behaviour lock for the shared Dialog primitive after the scrollable-modal restructure (the outer
// container scrolls so tall modals stay usable on mobile; the panel keeps overflow visible so
// in-panel dropdowns are never clipped). These invariants back EVERY *Modal built on Dialog:
// it renders a labelled modal, closes on Escape, closes on an outside click, does NOT close on an
// inside click, and closes via the header button.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Dialog } from './Dialog'

afterEach(() => cleanup())

describe('Dialog', () => {
  it('renders children in a labelled, modal dialog', () => {
    render(<Dialog open onClose={() => {}} title="Export"><p>Body content</p></Dialog>)
    const dlg = screen.getByRole('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText('Body content')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Export' })).toBeTruthy()
  })

  it('renders nothing when closed', () => {
    render(<Dialog open={false} onClose={() => {}}><p>hidden</p></Dialog>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose}><p>x</p></Dialog>)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on an outside click but NOT on a click inside the panel', () => {
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose}><button>Inside</button></Dialog>)
    fireEvent.click(screen.getByRole('button', { name: 'Inside' }))
    expect(onClose).not.toHaveBeenCalled()          // inner click is swallowed
    const panel = screen.getByRole('dialog')
    fireEvent.click(panel.parentElement!)            // the centring/scroll wrapper = "outside"
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes via the header close button', () => {
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose} title="T"><p>x</p></Dialog>)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
