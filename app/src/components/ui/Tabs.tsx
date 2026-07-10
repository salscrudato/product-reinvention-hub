// Tabs — pill-style tab strip with animated active indicator.
import type { ReactNode } from 'react'

interface Tab { id: string; label: string; count?: number }

interface TabsProps {
  tabs:     Tab[]
  active:   string
  onChange: (id: string) => void
  children?: ReactNode
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div
      className="flex gap-1 p-1 rounded-[10px] bg-raised"
      role="tablist"
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-sm font-medium transition-all duration-150
            ${active === tab.id
              ? 'bg-surface text-text shadow-sm'
              : 'text-dim hover:text-text'
            }`}
          style={active === tab.id ? { boxShadow: 'var(--shadow-card)' } : undefined}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`text-xs tabular-nums rounded-full px-1.5 py-0.5 ${active === tab.id ? 'bg-accent-soft text-accent' : 'bg-[var(--color-chip)] text-faint'}`}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
