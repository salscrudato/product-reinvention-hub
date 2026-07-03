// EmptyState — premium designed placeholder for not-yet-built views.
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?:        ReactNode
  title:        string
  description?: string
  action?:      ReactNode
  compact?:     boolean
}

// Subtle generative dot grid as a micro-illustration
function DotGrid() {
  return (
    <svg width="80" height="56" viewBox="0 0 80 56" fill="none" aria-hidden="true">
      {Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 8 }, (_, col) => (
          <circle
            key={`${row}-${col}`}
            cx={col * 10 + 5}
            cy={row * 11 + 6}
            r={1.5}
            fill="var(--color-accent-line)"
            // Deterministic scatter (stable across renders — no Math.random flicker).
            style={{ opacity: ((row * 8 + col) * 37) % 11 > 4 ? 1 : 0.28 }}
          />
        ))
      )}
    </svg>
  )
}

export function EmptyState({ icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center gap-3 ${compact ? 'py-10' : 'py-20'}`}>
      <DotGrid />
      {icon && <div className="text-faint mb-1">{icon}</div>}
      <h3 className="text-base font-semibold text-text">{title}</h3>
      {description && <p className="text-sm text-dim max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
