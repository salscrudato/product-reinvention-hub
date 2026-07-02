// Explorer — unified entity browser: products, coverages, forms, rules, LD/RT tables, dictionary.
import { useState, useMemo } from 'react'
import { adapter } from '../lib/backend'
import { useEffect } from 'react'
import { Tabs, Badge, Skeleton, EmptyState } from '../components/ui'
import { Input } from '../components/ui/Input'
import { Search, Database, FileText, Hash, BookOpen, CheckSquare, Package } from 'lucide-react'
import Fuse from 'fuse.js'
import type { SearchIndexEntry, SearchEntityType } from '@pf/shared'
import { useNavigate } from 'react-router-dom'

const TYPES: Array<{ id: SearchEntityType | 'all'; label: string }> = [
  { id: 'all',        label: 'All'        },
  { id: 'product',    label: 'Products'   },
  { id: 'coverage',   label: 'Coverages'  },
  { id: 'form',       label: 'Forms'      },
  { id: 'rule',       label: 'Rules'      },
  { id: 'ldTable',    label: 'LD Tables'  },
  { id: 'rtTable',    label: 'RT Tables'  },
  { id: 'dictionary', label: 'Dictionary' },
]

const TYPE_ICON: Partial<Record<SearchEntityType, React.FC<{ size?: number; className?: string }>>> = {
  product:    Package,
  coverage:   Hash,
  form:       FileText,
  rule:       CheckSquare,
  ldTable:    Database,
  rtTable:    Database,
  dictionary: BookOpen,
}

function toRoute(entry: SearchIndexEntry): string {
  const parts = entry.path.split('/')
  const pid   = parts[1] ?? 'HO.PROD.001'
  switch (entry.type) {
    case 'product':    return `/app/products/${pid}`
    case 'coverage':   return `/app/products/${pid}/coverages`
    case 'form':       return `/app/products/HO.PROD.001/forms`
    case 'rule':       return `/app/products/${pid}/rules`
    case 'ldTable':
    case 'rtTable':    return `/app/explorer`
    case 'dictionary': return `/app/dictionary`
    default:           return '/app'
  }
}

export default function Explorer() {
  const navigate  = useNavigate()
  const [entries, setEntries] = useState<SearchIndexEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query,   setQuery]   = useState('')
  const [tab,     setTab]     = useState<SearchEntityType | 'all'>('all')

  useEffect(() => {
    const unsub = adapter.db.subscribe<SearchIndexEntry>('searchIndex', (data) => {
      if (Array.isArray(data)) { setEntries(data); setLoading(false) }
    })
    return unsub
  }, [])

  const fuse = useMemo(() => new Fuse(entries, {
    keys: ['title', 'subtitle', 'keywords'],
    threshold: 0.4,
    includeMatches: false,
  }), [entries])

  const visible = useMemo(() => {
    const base = query ? fuse.search(query).map(r => r.item) : entries
    return tab === 'all' ? base : base.filter(e => e.type === tab)
  }, [query, tab, entries, fuse])

  const tabs = TYPES.map(t => ({
    id: t.id,
    label: t.label,
    count: t.id === 'all' ? entries.length : entries.filter(e => e.type === t.id).length,
  }))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold text-text">Explorer</h1>
        <p className="text-sm text-dim">Browse every entity in the Product Factory.</p>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search all entities…"
          leftIcon={<Search size={14} />}
          className="max-w-md"
        />
        <div className="overflow-x-auto pb-1">
          <Tabs
            tabs={tabs}
            active={tab}
            onChange={v => setTab(v as SearchEntityType | 'all')}
          />
        </div>
      </div>

      {/* Results grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="bg-surface rounded-[14px] p-4 flex flex-col gap-2" style={{ border: '1px solid var(--color-border)' }}>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={query ? `No results for "${query}"` : 'No entities found'}
          description={query ? 'Try a different search term.' : 'Run pnpm seed to populate the explorer.'}
          compact
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map(entry => {
            const Icon = TYPE_ICON[entry.type]
            return (
              <button
                key={entry.path}
                onClick={() => navigate(toRoute(entry))}
                className="bg-surface rounded-[14px] p-4 text-left hover:shadow-[var(--shadow-card-hover)] transition-all duration-200 group flex flex-col gap-2"
                style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm text-text group-hover:text-accent transition-colors line-clamp-2">{entry.title}</span>
                  {Icon && <Icon size={14} className="text-faint shrink-0 mt-0.5" aria-hidden="true" />}
                </div>
                {entry.subtitle && (
                  <span className="text-xs font-mono text-faint truncate">{entry.subtitle}</span>
                )}
                <div className="mt-auto pt-1">
                  <Badge
                    label={entry.type}
                    color={entry.type === 'form' ? 'blue' : entry.type === 'product' ? 'accent' : entry.type === 'rule' ? 'warn' : 'default'}
                  />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
