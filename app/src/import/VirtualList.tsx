// VirtualList — a tiny fixed-row-height windowing list (no dependency). Renders
// only the rows inside the scrollport (+ overscan), so a 1,707-entity import
// review scrolls at 60fps. Deliberately minimal: fixed rowHeight, single column,
// no dynamic measurement — exactly what the import review's uniform rows need.
import { useRef, useState, type ReactNode } from 'react'

const OVERSCAN = 6

export function VirtualList<T>({ items, rowHeight, maxHeight, renderRow, className = '' }: {
  items: readonly T[]
  rowHeight: number
  /** The scrollport's max height in px; shorter lists shrink to fit. */
  maxHeight: number
  renderRow: (item: T, index: number) => ReactNode
  className?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const totalHeight = items.length * rowHeight
  const viewH = Math.min(totalHeight, maxHeight)
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
  const last = Math.min(items.length, Math.ceil((scrollTop + viewH) / rowHeight) + OVERSCAN)

  return (
    <div
      ref={scrollRef}
      onScroll={e => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      className={`overflow-y-auto ${className}`}
      style={{ maxHeight }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {items.slice(first, last).map((item, i) => (
          <div key={first + i} style={{ position: 'absolute', top: (first + i) * rowHeight, left: 0, right: 0, height: rowHeight }}>
            {renderRow(item, first + i)}
          </div>
        ))}
      </div>
    </div>
  )
}
