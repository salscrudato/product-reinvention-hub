// Table — sticky sortable header, alternating row shading, keyboard accessible.
import type { ReactNode } from 'react'
import { IconChevronUp, IconChevronDown, IconSort } from './icons'

export interface Column<T> {
  key:       string
  header:    string
  width?:    string
  sortable?: boolean
  render:    (row: T) => ReactNode
}

interface TableProps<T> {
  columns:   Column<T>[]
  rows:      T[]
  rowKey:    (row: T) => string
  sortKey?:  string
  sortDir?:  'asc' | 'desc'
  onSort?:   (key: string) => void
  empty?:    ReactNode
}

export function Table<T>({ columns, rows, rowKey, sortKey, sortDir, onSort, empty }: TableProps<T>) {
  return (
    <div className="overflow-auto rounded-[14px] bg-surface" style={{ border: '1px solid var(--color-border)' }}>
      {/* tabular-nums on the whole table: any numeric cell (premiums, counts, dates) aligns in
          columns without each consumer opting in; letters are unaffected. */}
      <table className="w-full text-sm border-collapse tabular-nums">
        <thead>
          <tr className="sticky top-0 z-10 bg-raised" style={{ borderBottom: '1px solid var(--color-border)' }}>
            {columns.map(col => {
              const sorted = sortKey === col.key
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={col.sortable ? (sorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                  className={`text-left px-4 py-3 text-xs font-medium text-dim uppercase tracking-wide ${col.width ?? ''}`}
                >
                  {col.sortable ? (
                    // A real button so header sort is keyboard-operable (Enter/Space) with a
                    // visible focus ring — not a click-only div.
                    <button
                      type="button"
                      onClick={() => onSort?.(col.key)}
                      className="flex items-center gap-1 uppercase tracking-wide hover:text-text select-none rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      {col.header}
                      {sorted
                        ? sortDir === 'asc' ? <IconChevronUp size={12} aria-hidden="true" /> : <IconChevronDown size={12} aria-hidden="true" />
                        : <IconSort size={12} className="opacity-40" aria-hidden="true" />}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1">{col.header}</span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="text-center py-10 text-faint">{empty ?? 'No records'}</td></tr>
          )}
          {rows.map((row, i) => (
            <tr
              key={rowKey(row)}
              className={`transition-colors hover:bg-raised ${i % 2 === 1 ? 'bg-[var(--color-stripe)]' : ''}`}
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              {columns.map(col => (
                <td key={col.key} className="px-4 py-3">{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
