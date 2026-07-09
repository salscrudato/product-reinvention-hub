// TaskSelectList — a grouped, deselectable checklist of candidate lifecycle tasks.
// Shared by the New Product and AI Scaffold flows: every candidate is pre-selected
// and the PM deselects the ones that don't apply, then only the kept tasks are created.
// Grouped by lifecycle column → phase (TaskTemplate.group). Parent owns the checked
// Set (indices into `templates`); this component is purely presentational.
import { Badge } from '../ui'
import type { TaskTemplate, TaskColumn } from '@pf/shared'

const COLUMN_LABELS: Record<TaskColumn, string> = {
  IDEATION:       'Ideation & Design',
  BUILD_FILE:     'Build & File',
  TEST_APPROVE:   'Test & Approve',
  LAUNCH_MONITOR: 'Launch & Monitor',
}
const COLUMN_ORDER: TaskColumn[] = ['IDEATION', 'BUILD_FILE', 'TEST_APPROVE', 'LAUNCH_MONITOR']

interface Props {
  templates: TaskTemplate[]
  /** Indices (into `templates`) that are currently selected. */
  checked: Set<number>
  onToggle: (index: number) => void
  /** Optional bulk select/clear affordance. */
  onSetAll?: (on: boolean) => void
}

export function TaskSelectList({ templates, checked, onToggle, onSetAll }: Props) {
  // Preserve original order; index carries the identity used by the parent's Set.
  const indexed = templates.map((t, i) => ({ t, i }))
  const allOn = checked.size === templates.length && templates.length > 0

  return (
    <div className="flex flex-col gap-4">
      {onSetAll && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-faint tabular-nums">{checked.size} of {templates.length} selected</span>
          <button type="button" onClick={() => onSetAll(!allOn)}
            className="text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
            {allOn ? 'Clear all' : 'Select all'}
          </button>
        </div>
      )}

      {COLUMN_ORDER.map(col => {
        const rows = indexed.filter(({ t }) => t.column === col)
        if (rows.length === 0) return null
        // Distinct group labels in first-seen order, for a light phase subheading.
        const groups = [...new Set(rows.map(({ t }) => t.group ?? ''))]
        return (
          <section key={col} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-dim">{COLUMN_LABELS[col]}</h4>
              <span className="text-[11px] text-faint tabular-nums">{rows.filter(({ i }) => checked.has(i)).length}/{rows.length}</span>
              <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
            </div>
            {groups.map(g => (
              <div key={g || '_'} className="flex flex-col gap-1.5">
                {g && <p className="text-[11px] text-faint px-0.5">{g}</p>}
                {rows.filter(({ t }) => (t.group ?? '') === g).map(({ t, i }) => {
                  const on = checked.has(i)
                  return (
                    <div key={i} onClick={() => onToggle(i)}
                      className={`flex items-center gap-3 rounded-[10px] px-3 py-2 cursor-pointer transition-colors ${on ? 'bg-accent-soft' : 'bg-raised hover:bg-hover'}`}
                      style={{ border: `1px solid ${on ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}>
                      <input type="checkbox" checked={on} onChange={() => onToggle(i)} onClick={e => e.stopPropagation()}
                        className="w-4 h-4 accent-[var(--color-accent)] shrink-0" aria-label={`Include ${t.title}`} />
                      <span className={`flex-1 text-[13px] leading-snug ${on ? 'text-text' : 'text-dim'}`}>{t.title}</span>
                      <Badge label={t.slaLabel} />
                    </div>
                  )
                })}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
