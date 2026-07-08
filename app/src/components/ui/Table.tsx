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
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="sticky top-0 z-10 bg-raised" style={{ borderBottom: '1px solid var(--color-border)' }}>
            {columns.map(col => (
              <th
                key={col.key}
                className={`text-left px-4 py-3 text-xs font-medium text-dim uppercase tracking-wide ${col.width ?? ''} ${col.sortable ? 'cursor-pointer hover:text-text select-none' : ''}`}
                onClick={() => col.sortable && onSort?.(col.key)}
              >
                <span className="flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    sortKey === col.key
                      ? sortDir === 'asc' ? <IconChevronUp size={12} aria-hidden="true" /> : <IconChevronDown size={12} aria-hidden="true" />
                      : <IconSort size={12} className="opacity-40" aria-hidden="true" />
                  )}
                </span>
              </th>
            ))}
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
