// Card — white surface with the soft purple-haze glow from the design system.
import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: boolean
}

export function Card({ className = '', padding = true, children, style, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={`bg-surface rounded-[14px] ${padding ? 'p-5' : ''} ${className}`}
      style={{
        boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--color-border)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
