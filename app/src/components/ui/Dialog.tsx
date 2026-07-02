// Dialog — accessible modal with backdrop blur and spring entrance.
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface DialogProps {
  open:       boolean
  onClose:    () => void
  title?:     string
  children:   ReactNode
  width?:     string
}

export function Dialog({ open, onClose, title, children, width = 'max-w-lg' }: DialogProps) {
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

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[rgba(19,19,26,.5)] backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'dialog-title' : undefined}
        className={`relative w-full ${width} bg-surface rounded-[16px] p-6 shadow-2xl`}
        style={{ border: '1px solid var(--color-border)' }}
      >
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h2 id="dialog-title" className="text-base font-semibold text-text">{title}</h2>
            <button onClick={onClose} className="text-faint hover:text-text rounded-[6px] p-1 transition-colors" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
