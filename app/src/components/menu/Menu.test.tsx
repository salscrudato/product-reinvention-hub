// @vitest-environment jsdom
// P3 task 5 — the Menu primitive's keyboard contract (WAI-ARIA menu pattern):
// open/rove/wrap/Home/End, Esc + select restore focus to the trigger, outside
// click dismisses without stealing focus. Built as the recon-proven fallback
// (no UX2 Menu primitive exists) — reconcile with the design-hardening ledger.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Menu } from './Menu'

afterEach(cleanup)

function renderMenu() {
  const onA = vi.fn(); const onB = vi.fn(); const onC = vi.fn()
  render(
    <Menu label="More actions" items={[
      { label: 'Alpha', onSelect: onA },
      { label: 'Beta', onSelect: onB },
      { label: 'Delete', onSelect: onC, destructive: true },
    ]}>
      …
    </Menu>,
  )
  return { trigger: screen.getByRole('button', { name: 'More actions' }), onA, onB, onC }
}

describe('Menu', () => {
  it('is closed by default and opens on click with correct ARIA wiring', () => {
    const { trigger } = renderMenu()
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })

  it('ArrowDown opens focusing the first item; ArrowUp opens focusing the last', () => {
    const { trigger } = renderMenu()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0])
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Escape' })
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[2])
  })

  it('roving focus wraps in both directions; Home/End jump', () => {
    const { trigger } = renderMenu()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const items = screen.getAllByRole('menuitem')
    fireEvent.keyDown(items[0]!, { key: 'ArrowUp' })      // wrap backward
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2]!, { key: 'ArrowDown' })    // wrap forward
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0]!, { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2]!, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('Escape closes and RETURNS focus to the trigger', () => {
    const { trigger } = renderMenu()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('selecting an item fires onSelect, closes, and returns focus to the trigger', () => {
    const { trigger, onB } = renderMenu()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }))
    expect(onB).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('outside mousedown dismisses without stealing focus back', () => {
    const { trigger } = renderMenu()
    fireEvent.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).not.toBe(trigger)
  })
})
