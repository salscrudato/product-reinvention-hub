// ⌘K command palette — fuzzy search over searchIndex + action shortcuts.
// Opens via keyboard shortcut or the topbar search field click.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse, { type FuseResultMatch, type FuseResult } from 'fuse.js'
import { createPortal } from 'react-dom'
import {
  IconSearch, IconArrowRight, IconRecent, IconProduct, IconForm,
  IconBook, IconInfo, IconTable, IconRule, IconTasks, IconCoverage, IconLayers, type IconType,
} from '../ui/icons'
import { adapter } from '../../lib/backend'
import { Badge } from '../ui/Badge'
import type { SearchIndexEntry, SearchEntityType } from '@pf/shared'

// ─── Routing helper ───────────────────────────────────────────────────────────

function toRoute(entry: SearchIndexEntry): string {
  const parts = entry.path.split('/')
  // For product-scoped entities use the product segment; for global entities (forms)
  // fall back to the owning product stored as entry.refId by the seed.
  const productId = entry.path.includes('products/') ? (parts[1] ?? 'PH.PROD.001') : (entry.refId ?? 'PH.PROD.001')
  switch (entry.type) {
    case 'product':    return `/app/products/${parts[1]}`
    case 'coverage':   return `/app/products/${productId}/coverages`
    case 'rule':       return `/app/products/${productId}/rules`
    case 'form':       return `/app/products/${productId}/forms`
    case 'ldTable':
    case 'rtTable':    return `/app/explorer`
    case 'dictionary': return `/app/dictionary`
    case 'task':       return `/app/tasks`
    case 'project':    return `/app/tasks?project=${parts[1]}`
    default:           return '/app'
  }
}

const TYPE_ICON: Record<SearchEntityType, IconType> = {
  product:    IconProduct,
  coverage:   IconCoverage,
  rule:       IconRule,
  form:       IconForm,
  ldTable:    IconTable,
  rtTable:    IconTable,
  dictionary: IconBook,
  task:       IconTasks,
  project:    IconLayers,
}

const TYPE_LABEL: Record<SearchEntityType, string> = {
  product: 'Product', coverage: 'Coverage', rule: 'Rule', form: 'Form',
  ldTable: 'LD Table', rtTable: 'RT Table', dictionary: 'Dictionary', task: 'Task', project: 'Project',
}

const ACTIONS = [
  { id: 'new-product',  label: 'New product',          subtitle: 'Create a new insurance product',    route: '/app/products?new=1' },
  { id: 'go-tasks',     label: 'Go to Tasks',           subtitle: 'View the task board',               route: '/app/tasks' },
  { id: 'go-explorer',  label: 'Go to Explorer',        subtitle: 'Browse all entities',               route: '/app/explorer' },
  { id: 'go-admin',     label: 'Go to Settings',        subtitle: 'Admin console',                     route: '/app/admin' },
]

const RECENT_KEY = 'pf:palette:recent'
const MAX_RECENT  = 5

type Recent = { id: string; title: string; subtitle: string; route: string }

function loadRecents(): Recent[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}
function saveRecent(r: Recent) {
  const prev = loadRecents().filter(x => x.id !== r.id)
  localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...prev].slice(0, MAX_RECENT)))
}

// ─── Highlight matches ────────────────────────────────────────────────────────

function Highlight({ text, matches }: { text: string; matches?: readonly FuseResultMatch[] }) {
  const match = matches?.find(m => m.key === 'title' || m.key === 'keywords')
  if (!match?.indices?.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let last = 0
  const indices = [...match.indices].sort((a, b) => a[0] - b[0])
  for (const [s, e] of indices) {
    if (s > last) parts.push(text.slice(last, s))
    parts.push(<mark key={s} className="bg-accent-soft text-accent not-italic rounded-[2px]">{text.slice(s, e + 1)}</mark>)
    last = e + 1
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// ─── Main component ───────────────────────────────────────────────────────────

interface CommandPaletteProps { open: boolean; onClose: () => void }

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query,   setQuery]   = useState('')
  const [entries, setEntries] = useState<SearchIndexEntry[]>([])
  const [cursor,  setCursor]  = useState(0)
  const inputRef    = useRef<HTMLInputElement>(null)
  const dialogRef   = useRef<HTMLDivElement>(null)
  const navigate    = useNavigate()

  // Focus trap: Tab/Shift+Tab cycle within the dialog (keyboard completeness).
  const handleDialogKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]!
    const last  = focusable[focusable.length - 1]!
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus() }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus() }
    }
  }, [])

  // Subscribe to searchIndex while open
  useEffect(() => {
    if (!open) return
    const unsub = adapter.db.subscribe<SearchIndexEntry>('searchIndex', (data) => {
      if (Array.isArray(data)) setEntries(data)
    })
    return () => { unsub(); setEntries([]) }
  }, [open])

  // Focus input on open
  useEffect(() => {
    if (open) { setQuery(''); setCursor(0); setTimeout(() => inputRef.current?.focus(), 30) }
  }, [open])

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const fuse = useMemo(() => new Fuse(entries, {
    keys: [
      { name: 'title',    weight: 0.7 },
      { name: 'subtitle', weight: 0.3 },
      { name: 'keywords', weight: 0.5 },
    ],
    threshold: 0.4,
    includeMatches: true,
    minMatchCharLength: 2,
  }), [entries])

  const fuseResults = useMemo(
    () => (query.length >= 1 ? fuse.search(query, { limit: 12 }) : []),
    [fuse, query],
  )

  // Build flat result list for keyboard nav
  type ResultItem =
    | { kind: 'recent'; data: Recent }
    | { kind: 'entry';  data: FuseResult<SearchIndexEntry> }
    | { kind: 'action'; data: typeof ACTIONS[number] }

  const allResults: ResultItem[] = useMemo(() => {
    if (query) {
      return [
        ...fuseResults.map(r => ({ kind: 'entry' as const, data: r })),
        ...ACTIONS.filter(a => a.label.toLowerCase().includes(query.toLowerCase())).map(a => ({ kind: 'action' as const, data: a })),
      ]
    }
    const recents = loadRecents()
    return [
      ...recents.map(r => ({ kind: 'recent' as const, data: r })),
      ...ACTIONS.map(a => ({ kind: 'action' as const, data: a })),
    ]
  }, [query, fuseResults])

  const total = allResults.length

  function goTo(route: string, recent: Recent) {
    saveRecent(recent)
    onClose()
    navigate(route)
  }

  function activate(item: ResultItem) {
    if (item.kind === 'recent') { goTo(item.data.route, item.data); return }
    if (item.kind === 'action') { goTo(item.data.route, { id: item.data.id, title: item.data.label, subtitle: item.data.subtitle, route: item.data.route }); return }
    const entry = item.data.item
    const route = toRoute(entry)
    goTo(route, { id: entry.path, title: entry.title, subtitle: entry.subtitle, route })
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % Math.max(total, 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => (c - 1 + Math.max(total, 1)) % Math.max(total, 1)) }
    if (e.key === 'Enter' && allResults[cursor]) activate(allResults[cursor])
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--color-overlay)' }} onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        ref={dialogRef}
        onKeyDown={handleDialogKeyDown}
        className="relative w-full max-w-xl bg-surface rounded-[16px] overflow-hidden"
        style={{ boxShadow: 'var(--shadow-overlay)', border: '1px solid var(--color-border)' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <IconSearch size={16} className="text-faint shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-text placeholder:text-faint outline-none"
            placeholder="Search products, forms, rules… or type a command"
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0) }}
            onKeyDown={handleKey}
            aria-autocomplete="list"
            autoComplete="off"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-faint hover:text-text text-xs">Clear</button>
          )}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {!query && (
            <p className="px-4 py-1 text-xs font-medium text-faint uppercase tracking-wide">
              {loadRecents().length ? 'Recent' : 'Quick actions'}
            </p>
          )}
          {query && fuseResults.length > 0 && (
            <p className="px-4 py-1 text-xs font-medium text-faint uppercase tracking-wide">Results</p>
          )}

          {allResults.map((item, i) => {
            const active = i === cursor

            if (item.kind === 'recent') {
              return (
                <button
                  key={item.data.id}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-raised'}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => activate(item)}
                >
                  <IconRecent size={14} className="text-faint shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-text truncate">{item.data.title}</span>
                    <span className="text-xs text-dim truncate">{item.data.subtitle}</span>
                  </span>
                </button>
              )
            }

            if (item.kind === 'action') {
              return (
                <button
                  key={item.data.id}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-raised'}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => activate(item)}
                >
                  <IconArrowRight size={14} className="text-faint shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-text">{item.data.label}</span>
                    <span className="text-xs text-dim">{item.data.subtitle}</span>
                  </span>
                </button>
              )
            }

            // entry
            const entry    = item.data.item
            const entryType = entry.type as SearchEntityType
            const Icon     = TYPE_ICON[entryType] ?? IconInfo
            return (
              <button
                key={entry.path}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-raised'}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => activate(item)}
              >
                <Icon size={14} className="text-faint shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-text truncate">
                    <Highlight text={entry.title} matches={item.data.matches} />
                  </span>
                  <span className="text-xs text-dim font-mono truncate">{entry.subtitle}</span>
                </span>
                <Badge label={TYPE_LABEL[entryType] ?? entryType} color="default" />
              </button>
            )
          })}

          {query && !fuseResults.length && (
            <p className="px-4 py-8 text-center text-faint text-sm">No results for "{query}"</p>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 text-xs text-faint" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
