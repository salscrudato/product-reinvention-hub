// CoverageStack — a legible replacement for the Landing A–F coverage bubbles.
// The insight-graph bubbles render coverage letters at ~8.5px SVG text; this
// component says the same thing as stacked, labeled bars readable at 100% zoom.
// Presentation-only: parents pass the coverages in; no fetching, no adapter.
//
// Tokens only; the bars stay in the accent family (one accent per surface) with
// the code chip carrying the accent-on-accent-soft badge pair the contrast gate
// validates. The whole stack is one role="img" with a summary aria-label;
// internals are decorative.

export interface CoverageStackItem {
  id: string
  /** Short coverage code (e.g. "A"). */
  code: string
  /** Human name (e.g. "Dwelling"). */
  label: string
  /** Relative bar weight, 0..1. Defaults to a tapering ramp by position. */
  weight?: number
}

interface CoverageStackProps {
  items: CoverageStackItem[]
  /** Accessible name prefix for the summary label. */
  title?: string
}

/** Default taper so an unweighted stack still reads as a hierarchy. */
function weightFor(item: CoverageStackItem, index: number, count: number): number {
  if (item.weight !== undefined) return Math.max(0, Math.min(1, item.weight))
  return count <= 1 ? 1 : 1 - (index * 0.6) / (count - 1)
}

export function CoverageStack({ items, title = 'Coverages' }: CoverageStackProps) {
  const label = `${title}: ${items.map((i) => `${i.code} ${i.label}`).join(', ')}`
  return (
    <div role="img" aria-label={label} className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={item.id} aria-hidden="true" className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-bold leading-none px-1.5 py-1 rounded-[5px] bg-accent-soft text-accent w-6 text-center shrink-0">
            {item.code}
          </span>
          <span className="text-[12.5px] leading-none text-dim w-32 truncate shrink-0">{item.label}</span>
          <svg aria-hidden="true" className="flex-1" height="8" role="presentation">
            <rect
              x="0" y="0" height="8" rx="4"
              width={`${Math.round(weightFor(item, i, items.length) * 100)}%`}
              fill="var(--color-accent-soft)"
              stroke="var(--color-accent-line)"
              strokeWidth="1"
            />
          </svg>
        </div>
      ))}
    </div>
  )
}
