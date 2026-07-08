// SegmentFilter — the portfolio segmentation toolbar. Every facet (Vertical,
// Coverage family, Market segment) and every value in it is derived from the LOB
// registry via `deriveSegmentAxes()`, so registering a new line extends the filter
// automatically — nothing here is hard-coded to Homeowners or Personal Auto. Selecting a value
// filters; clicking it again (or "All") clears that axis.
import type { SegmentAxis, SegmentAxisId, SegmentSelection } from '@pf/shared'

interface SegmentFilterProps {
  axes:        SegmentAxis[]
  selection:   SegmentSelection
  onChange:    (next: SegmentSelection) => void
  /** Per-axis, per-value product counts (optional) — shown as a trailing tally. */
  counts?:     Partial<Record<SegmentAxisId, Record<string, number>>>
}

export function SegmentFilter({ axes, selection, onChange, counts }: SegmentFilterProps) {
  // A line-agnostic guard: only render axes that actually offer a choice.
  const usable = axes.filter(a => a.values.length > 1)
  if (usable.length === 0) return null

  function pick(axis: SegmentAxisId, value: string | null) {
    const next = { ...selection }
    if (value == null) delete next[axis]
    else next[axis] = value
    onChange(next)
  }

  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
      active ? 'bg-surface text-accent shadow-[var(--shadow-chip)]' : 'text-dim hover:text-text'
    }`

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {usable.map(axis => {
        const chosen = selection[axis.id]
        return (
          <div key={axis.id} role="group" aria-label={axis.label}
            className="inline-flex items-center gap-1 p-0.5 rounded-[9px] bg-raised">
            <span className="pl-1.5 pr-1 text-[10px] font-semibold uppercase tracking-[.07em] text-faint select-none">{axis.label}</span>
            <button type="button" onClick={() => pick(axis.id, null)} aria-pressed={!chosen}
              className={pill(!chosen)}>All</button>
            {axis.values.map(v => {
              const active = chosen === v
              const n = counts?.[axis.id]?.[v]
              return (
                <button key={v} type="button" aria-pressed={active}
                  onClick={() => pick(axis.id, active ? null : v)} className={pill(active)}>
                  {v}
                  {n !== undefined && <span className="tnum text-[10px] text-faint">{n}</span>}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
