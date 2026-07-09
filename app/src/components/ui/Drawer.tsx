// Drawer — right-side panel with backdrop; slides in from the edge.
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './icons'

interface DrawerProps {
  open:     boolean
  onClose:  () => void
  title?:   string
  children: ReactNode
  width?:   string
}

export function Drawer({ open, onClose, title, children, width = 'w-96' }: DrawerProps) {
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

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--color-overlay-light)' }} onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative ${width} max-w-full h-full bg-surface flex flex-col shadow-2xl`}
        style={{ borderLeft: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {title && <h2 className="text-base font-semibold text-text">{title}</h2>}
          <button onClick={onClose} className="text-faint hover:text-text rounded-[6px] p-1 ml-auto transition-colors" aria-label="Close">
            <IconClose size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
