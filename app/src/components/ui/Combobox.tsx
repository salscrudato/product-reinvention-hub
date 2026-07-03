// Combobox — instant Fuse.js typeahead with keyboard nav and match highlighting.
import { useState, useRef, useEffect, useId } from 'react'
import Fuse from 'fuse.js'
import { ChevronDown, X, Loader2 } from 'lucide-react'

interface ComboboxProps<T> {
  items:       T[]
  value:       T | null
  onChange:    (item: T | null) => void
  getLabel:    (item: T) => string
  getValue:    (item: T) => string
  placeholder?: string
  loading?:    boolean
  clearable?:  boolean
  className?:  string
}

function highlight(text: string, ranges: readonly [number, number][]): React.ReactNode {
  if (!ranges.length) return text
  const parts: React.ReactNode[] = []
  let last = 0
  for (const [start, end] of ranges) {
    if (start > last) parts.push(text.slice(last, start))
    parts.push(<mark key={start} className="bg-accent-soft text-accent font-medium not-italic rounded-[2px]">{text.slice(start, end + 1)}</mark>)
    last = end + 1
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function Combobox<T>({ items, value, onChange, getLabel, getValue, placeholder = 'Search…', loading, clearable = true, className = '' }: ComboboxProps<T>) {
  const [query, setQuery]       = useState('')
  const [open, setOpen]         = useState(false)
  const [active, setActive]     = useState(0)
  const id                      = useId()
  const inputRef                = useRef<HTMLInputElement>(null)
  const listRef                 = useRef<HTMLUListElement>(null)

  const fuse = new Fuse(items, { keys: [{ name: 'label', getFn: getLabel }], threshold: 0.4, includeMatches: true })
  const results = query ? fuse.search(query) : items.map(item => ({ item, matches: [] }))

  const displayValue = value ? getLabel(value) : ''

  useEffect(() => { if (!open) setQuery('') }, [open])
  useEffect(() => { setActive(0) }, [query])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); if (results[active]) select(results[active].item) }
    if (e.key === 'Escape')    { setOpen(false) }
  }

  function select(item: T) {
    onChange(item)
    setOpen(false)
    inputRef.current?.blur()
  }

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div className={`relative ${className}`}>
      <div
        className={`flex items-center gap-2 h-9 px-3 rounded-[10px] bg-surface border cursor-text
          ${open ? 'border-accent ring-2 ring-accent/25' : 'border-border-strong hover:border-[rgba(19,19,26,.22)]'}`}
        onClick={() => { setOpen(true); inputRef.current?.focus() }}
      >
        <input
          ref={inputRef}
          id={id}
          className="flex-1 min-w-0 bg-transparent text-sm text-text placeholder:text-faint outline-none"
          placeholder={open ? placeholder : (displayValue || placeholder)}
          value={open ? query : displayValue}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={`${id}-list`}
          autoComplete="off"
        />
        {loading && <Loader2 size={14} className="animate-spin text-faint shrink-0" />}
        {clearable && value && !loading && (
          <button type="button" className="text-faint hover:text-text shrink-0" onClick={e => { e.stopPropagation(); onChange(null) }} aria-label="Clear">
            <X size={14} />
          </button>
        )}
        {!value && <ChevronDown size={14} className="text-faint shrink-0" />}
      </div>

      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-surface rounded-[10px] overflow-hidden overflow-y-auto max-h-56 text-sm"
          style={{ boxShadow: '0 8px 24px rgba(19,19,26,.12)', border: '1px solid var(--color-border)' }}
          onMouseLeave={() => setActive(0)}
        >
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-faint">No results</li>
          )}
          {results.map(({ item, matches }, i) => {
            const label = getLabel(item)
            const match = matches?.find(m => m.key === 'label' || m.key === undefined)
            return (
              <li
                key={getValue(item)}
                role="option"
                aria-selected={value ? getValue(value) === getValue(item) : false}
                className={`px-3 py-2 cursor-pointer transition-colors
                  ${i === active ? 'bg-accent-soft' : 'hover:bg-raised'}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => { e.preventDefault(); select(item) }}
              >
                {match?.indices ? highlight(label, match.indices as [number,number][]) : label}
              </li>
            )
          })}
        </ul>
      )}

      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />}
    </div>
  )
}
