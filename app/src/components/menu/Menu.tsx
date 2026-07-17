// Menu — minimal accessible menu-button primitive (WAI-ARIA menu pattern).
//
// P3 task-5 FALLBACK: recon proved design-hardening UX2 never landed a Menu
// primitive (ExportMenu and friends are ad-hoc, mouse-only dropdowns with no
// keyboard support). This one is keyboard-complete and must be reconciled with
// the design-hardening ledger when that wave lands:
//   • trigger: Enter/Space/ArrowDown open + focus first item, ArrowUp opens + last
//   • menu: ArrowUp/Down roving focus with wrap, Home/End jump, Esc closes
//   • closing (Esc, select, outside click) RETURNS focus to the trigger
//   • portal-rendered so an overflow-hidden ancestor (e.g. a card) never clips it;
//     scroll/resize while open just closes it (position never goes stale)
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label:        string
  onSelect:     () => void
  icon?:        ReactNode
  destructive?: boolean
}

interface MenuProps {
  /** Accessible name for the trigger button (e.g. "More actions for HO3 draft"). */
  label:             string
  items:             MenuItem[]
  /** Trigger CONTENT (an icon, usually IconMore). The button chrome is Menu's. */
  children:          ReactNode
  triggerClassName?: string
}

export function Menu({ label, items, children, triggerClassName = '' }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs   = useRef<(HTMLButtonElement | null)[]>([])
  const initialIndex = useRef(0)
  const menuId = useId()

  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  const openAt = useCallback((index: number) => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    initialIndex.current = index
    // Estimate the menu height (items × row height + padding) and flip above the
    // trigger when the space below can't fit it — the menu must never open offscreen
    // (scrolling closes it, so an offscreen menu would be unreachable).
    const est = items.length * 34 + 10
    const below = r.bottom + 4
    const top = below + est > window.innerHeight && r.top - est - 4 > 0 ? r.top - est - 4 : below
    setPos({ top, right: Math.max(8, window.innerWidth - r.right) })
    setOpen(true)
  }, [items.length])

  // Focus the initial item once the portal has painted.
  useEffect(() => {
    if (!open) return
    const idx = initialIndex.current
    itemRefs.current[idx >= 0 ? idx : 0]?.focus()
  }, [open])

  // Outside interaction / viewport movement closes (outside click does NOT steal
  // focus back to the trigger — the user clicked somewhere else on purpose).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (itemRefs.current.some((el) => el?.contains(t))) return
      close(false)
    }
    // Scroll/resize invalidates the fixed position, so close — but if focus is
    // INSIDE the menu (keyboard user), return it to the trigger; dropping focus to
    // <body> would strand keyboard navigation (P3 hostile-review fix).
    const onMove = () => {
      const a = document.activeElement
      close(itemRefs.current.some((el) => el && el === a))
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, close])

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAt(0) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openAt(items.length - 1) }
  }

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const focused = itemRefs.current.findIndex((el) => el === document.activeElement)
    const move = (to: number) => { e.preventDefault(); itemRefs.current[(to + items.length) % items.length]?.focus() }
    if (e.key === 'ArrowDown') move(focused + 1)
    else if (e.key === 'ArrowUp') move(focused - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(items.length - 1)
    else if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'Tab') close()   // per the ARIA menu pattern: Tab dismisses
  }

  return (
    <>
      <button
        ref={triggerRef} type="button" aria-label={label}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openAt(0))} onKeyDown={onTriggerKeyDown}
        className={triggerClassName || 'inline-flex items-center justify-center w-6 h-6 rounded-[7px] text-faint hover:text-text hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'}
      >
        {children}
      </button>
      {open && pos && createPortal(
        <div
          id={menuId} role="menu" aria-label={label} onKeyDown={onMenuKeyDown}
          className="min-w-[200px] rounded-[10px] py-1 bg-surface"
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 60, border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card-hover)' }}
        >
          {items.map((item, i) => (
            <button
              key={item.label} role="menuitem" type="button" tabIndex={-1}
              ref={(el) => { itemRefs.current[i] = el }}
              onClick={() => { close(); item.onSelect() }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus:bg-raised ${
                item.destructive ? 'text-danger hover:bg-danger/10 focus:bg-danger/10' : 'text-text hover:bg-raised'}`}
            >
              {item.icon && <span aria-hidden="true" className="shrink-0 inline-flex">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
