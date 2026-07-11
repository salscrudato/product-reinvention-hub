// Dialog — accessible modal with backdrop blur and spring entrance.
// Accessible dialog: labelled by its title, closes on Escape / backdrop click, moves
// focus into the panel on open, TRAPS Tab/Shift+Tab within it, and restores focus to
// the previously focused element on close. (Same focus model as Drawer — fixed once
// here so every *Dialog / *Modal built on this primitive inherits it.)
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './icons'

interface DialogProps {
  open:       boolean
  onClose:    () => void
  title?:     string
  children:   ReactNode
  width?:     string
}

// Selector for the elements Tab can reach inside the panel.
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({ open, onClose, title, children, width = 'max-w-lg' }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId  = useId()

  // Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Focus management + trap. Runs once per open; restores focus on close/unmount.
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const visibleFocusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(el => el.offsetParent !== null)

    // Move focus into the panel (first control, else the panel itself).
    ;(visibleFocusables()[0] ?? panel)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = visibleFocusables()
      if (items.length === 0) { e.preventDefault(); panel?.focus(); return }
      const first = items[0], last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    panel?.addEventListener('keydown', onKeyDown)
    return () => {
      panel?.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()   // restore focus to the trigger on close
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop — fixed so it always covers the viewport while a tall panel scrolls behind it.
          Purely visual; the click-to-close handler lives on the centring wrapper above it. */}
      <div
        className="fixed inset-0 backdrop-blur-sm"
        style={{ background: 'var(--color-overlay)' }}
        aria-hidden="true"
      />
      {/* Centering / scroll wrapper: `min-h-full` + `items-center` centres short modals and lets a
          modal taller than the viewport scroll as a whole (mobile) — so the header/close button is
          always reachable. The panel itself keeps `overflow: visible`, so an in-panel dropdown or
          popover is never clipped. A click on this wrapper (outside the panel) closes the dialog. */}
      <div className="relative flex min-h-full items-center justify-center p-4" onClick={onClose}>
        {/* Panel — spring entrance; neutralised under prefers-reduced-motion via index.css */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className={`relative w-full ${width} bg-surface rounded-[16px] p-4 sm:p-6 shadow-2xl rise-in outline-none`}
          style={{ border: '1px solid var(--color-border)' }}
        >
          {title && (
            <div className="flex items-center justify-between mb-4">
              <h2 id={titleId} className="text-base font-semibold text-text">{title}</h2>
              <button onClick={onClose} className="text-faint hover:text-text rounded-[6px] p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="Close">
                <IconClose size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
