// SavedViews — a compact dropdown to save the current filters as a named preset and
// recall or delete presets. Entity-agnostic: it just serializes the FilterState it is
// handed and applies one back. Scoped + per-user via savedViews.ts.

import { useEffect, useRef, useState } from 'react'
import { useUser } from '../../context/useUser'
import { IconStar, IconClose, IconChevronDown } from '../../components/ui/icons'
import type { FilterState } from './facetTypes'
import { hasActiveFilters } from './filterEngine'
import { type SavedView, deleteView, listSavedViews, saveView } from './savedViewsStore'

interface SavedViewsProps {
  scope:   string
  state:   FilterState
  onApply: (state: FilterState) => void
}

export function SavedViews({ scope, state, onApply }: SavedViewsProps) {
  const { user } = useUser()
  const uid = user?.uid ?? ''
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [views, setViews] = useState<SavedView[]>([])
  const ref = useRef<HTMLDivElement>(null)

  const refresh = () => setViews(listSavedViews(uid, scope))
  useEffect(() => { if (open) refresh() }, [open, uid, scope]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const canSave = hasActiveFilters(state) && name.trim().length > 0

  function onSave() {
    if (!canSave) return
    saveView(uid, scope, name, state)
    setName(''); refresh()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu" aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[9px] bg-raised text-dim hover:text-text text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <IconStar size={14} aria-hidden="true" />
        Views
        <IconChevronDown size={13} className="transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="glass absolute z-30 right-0 mt-1.5 w-72 rounded-[12px] p-2 facet-reveal"
          style={{ border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-dropdown)' }}
        >
          <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
            {views.length === 0 ? (
              <p className="text-xs text-faint italic px-2 py-2">No saved views yet. Filter, then save the combination below.</p>
            ) : (
              views.map((v) => (
                <div key={v.id} role="menuitem" className="group flex items-center gap-1 rounded-[8px] hover:bg-accent-soft transition-colors">
                  <button onClick={() => { onApply(v.state); setOpen(false) }} className="flex-1 min-w-0 text-left px-2.5 py-1.5 text-sm text-text truncate">
                    {v.name}
                  </button>
                  <button
                    onClick={() => { deleteView(uid, v.id); refresh() }}
                    aria-label={`Delete view ${v.name}`}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity w-6 h-6 mr-1 rounded-[6px] flex items-center justify-center text-faint hover:text-danger shrink-0"
                  >
                    <IconClose size={12} aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-2 pt-2 flex items-center gap-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSave() }}
              placeholder={hasActiveFilters(state) ? 'Name this view…' : 'Apply filters first'}
              disabled={!hasActiveFilters(state)}
              aria-label="Name for the new saved view"
              className="flex-1 min-w-0 h-8 px-2.5 rounded-[8px] bg-surface border border-border text-sm placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50"
            />
            <button
              onClick={onSave} disabled={!canSave}
              className="h-8 px-3 rounded-[8px] text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ background: 'var(--gradient-accent)' }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
