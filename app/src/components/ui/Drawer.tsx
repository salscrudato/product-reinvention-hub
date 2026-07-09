// Drawer — right-side panel with backdrop; slides in from the edge.
// Accessible dialog: labelled by its title, closes on Escape / backdrop click, moves
// focus into the panel on open, TRAPS Tab/Shift+Tab within it, and restores focus to
// the previously focused element on close.
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './icons'

interface DrawerProps {
  open:     boolean
  onClose:  () => void
  title?:   string
  children: ReactNode
  width?:   string
}

// Selector for the elements Tab can reach inside the panel.
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Drawer({ open, onClose, title, children, width = 'w-96' }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId  = useId()

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

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
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--color-overlay-light)' }} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`relative ${width} max-w-full h-full bg-surface flex flex-col shadow-2xl slide-in-right outline-none`}
        style={{ borderLeft: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {title && <h2 id={titleId} className="text-base font-semibold text-text">{title}</h2>}
          <button onClick={onClose} className="text-faint hover:text-text rounded-[6px] p-1 ml-auto transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="Close">
            <IconClose size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
