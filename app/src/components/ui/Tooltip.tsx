// Tooltip — CSS-only hover label; no JS needed for this simple variant.
import type { ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

const sideStyles: Record<NonNullable<TooltipProps['side']>, string> = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left:   'right-full top-1/2 -translate-y-1/2 mr-2',
  right:  'left-full top-1/2 -translate-y-1/2 ml-2',
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <div className="relative inline-flex group">
      {children}
      <div
        role="tooltip"
        className={`absolute z-50 px-2 py-1 text-xs text-white bg-text rounded-[6px]
          whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100
          transition-opacity duration-150 ${sideStyles[side]}`}
      >
        {content}
      </div>
    </div>
  )
}
