// DictionaryPicker — a typeahead over the data dictionary. Drop into any editor
// (coverage terms, a form's dynamic fields) to insert a canonical field
// definition instead of re-typing name/type/format by hand.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { adapter } from '../../lib/backend'
import { Badge } from '../ui'
import type { DictionaryEntry } from '@pf/shared'

type DictDoc = DictionaryEntry & { id: string }

export function DictionaryPicker({ onSelect, placeholder = 'Insert a dictionary field…' }: {
  onSelect: (entry: DictDoc) => void
  placeholder?: string
}) {
  const [entries, setEntries] = useState<DictDoc[]>([])
  const [query, setQuery]     = useState('')
  const [open, setOpen]       = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = adapter.db.subscribe<DictDoc>('dictionary', d => { if (Array.isArray(d)) setEntries(d) })
    return unsub
  }, [])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const matches = useMemo(() => {
    const q = query.toLowerCase()
    return entries
      .filter(e => !q || `${e.name} ${(e.tags ?? []).join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [entries, query])

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <BookOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label="Insert dictionary field"
          className="w-full h-9 rounded-[10px] bg-surface border border-border-strong pl-9 pr-3 text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-surface rounded-[12px] py-1"
          style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }} role="listbox">
          {matches.map(e => (
            <button key={e.id} type="button" role="option" aria-selected={false}
              onClick={() => { onSelect(e); setQuery(''); setOpen(false) }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-raised transition-colors">
              <span className="flex flex-col min-w-0">
                <span className="text-sm text-text truncate">{e.name}</span>
                {e.description && <span className="text-xs text-faint truncate">{e.description}</span>}
              </span>
              <Badge label={e.type} color="default" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
