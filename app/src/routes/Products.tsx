// Products list — realtime card grid with facet filters, typeahead, and New Product.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { toast } from 'sonner'
import { Plus, Package, Download } from 'lucide-react'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Button, Badge, Skeleton, EmptyState, StatusPill, LifecyclePill, Tabs } from '../components/ui'
import { NewProductModal } from '../components/product/NewProductModal'
import { exportPortfolioExcel, type ProductExport } from '../lib/export/excel'
import type { Product, Coverage, Rule, Form, LDTable, RTTable, RatingProgram } from '@pf/shared'
import type { WithId } from '../context/ProductContext'

function ProductCard({ p, onClick }: { p: WithId<Product>; onClick: () => void }) {
  const score = p.health?.score ?? 100
  const scoreColor = score >= 80 ? '#059669' : score >= 60 ? '#B45309' : '#DC2626'

  return (
    <button
      onClick={onClick}
      className="bg-surface rounded-[14px] p-5 text-left flex flex-col gap-3 group hover:shadow-[var(--shadow-card-hover)] transition-all duration-200"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <span className="font-semibold text-text group-hover:text-accent transition-colors truncate">{p.name}</span>
          {p.refId && <span className="text-xs font-mono text-faint">{p.refId}</span>}
        </div>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: `${scoreColor}18`, color: scoreColor }}
          title={`Health: ${score}`}
        >
          {score}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusPill status={p.status} />
        <LifecyclePill lifecycle={p.lifecycle} />
        {p.lob?.name && <Badge label={p.lob.name} color="blue" />}
      </div>

      <div className="flex items-center gap-4 text-xs text-dim pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
        <span>{p.states?.length ?? 0} states</span>
        <span>{p.marketSegment ?? '—'}</span>
        <span className="ml-auto">{p.owner?.name ?? '—'}</span>
      </div>
    </button>
  )
}

const TABS = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'drafts',    label: 'Drafts'    },
]

export default function Products() {
  const navigate   = useNavigate()
  const { user }   = useUser()
  const canEdit    = user?.role === 'EDITOR' || user?.role === 'ADMIN'

  const [products, setProducts] = useState<WithId<Product>[]>([])
  const [loading,  setLoading]  = useState(true)
  const [query,    setQuery]    = useState('')
  const [tab,      setTab]      = useState('portfolio')
  const [lobFilter, setLobFilter] = useState('')
  const [newOpen,  setNewOpen]  = useState(false)
  const [exporting, setExporting] = useState(false)

  async function exportPortfolio() {
    if (!products.length) return
    setExporting(true)
    try {
      const [forms, ldList, rtList] = await Promise.all([
        adapter.db.list<Form & { id: string }>('forms'),
        adapter.db.list<LDTable & { id: string }>('ldTables'),
        adapter.db.list<RTTable & { id: string }>('rtTables'),
      ])
      const ldTables = Object.fromEntries(ldList.map(t => [t.id, t])) as Record<string, LDTable>
      const rtTables = Object.fromEntries(rtList.map(t => [t.id, t])) as Record<string, RTTable>
      const items: ProductExport[] = await Promise.all(products.map(async p => {
        const [coverages, rules, programs] = await Promise.all([
          adapter.db.list<Coverage>(`products/${p.id}/coverages`),
          adapter.db.list<Rule>(`products/${p.id}/rules`),
          adapter.db.list<RatingProgram>(`products/${p.id}/ratingPrograms`),
        ])
        return { product: p, coverages, rules, forms: forms.filter(f => (f.productRefIds ?? []).includes(p.id)), ldTables, rtTables, ratingProgram: programs[0] ?? null }
      }))
      await exportPortfolioExcel(items)
      toast.success('Portfolio exported')
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    const unsub = adapter.db.subscribe<WithId<Product>>('products', (data) => {
      if (Array.isArray(data)) { setProducts(data); setLoading(false) }
    })
    return unsub
  }, [])

  // Separate portfolio (LAUNCHED) from drafts (everything else)
  const tabbed = useMemo(() => {
    const base = tab === 'portfolio'
      ? products.filter(p => p.lifecycle === 'LAUNCHED')
      : products.filter(p => p.lifecycle !== 'LAUNCHED')
    return lobFilter ? base.filter(p => p.lob?.name === lobFilter) : base
  }, [products, tab, lobFilter])

  const fuse = useMemo(() => new Fuse(tabbed, { keys: ['name', 'refId', 'marketSegment'], threshold: 0.4 }), [tabbed])
  const visible = query ? fuse.search(query).map(r => r.item) : tabbed

  const lobs = [...new Set(products.map(p => p.lob?.name).filter(Boolean))] as string[]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Products</h1>
          <p className="text-sm text-dim mt-0.5">{products.length} product{products.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {products.length > 0 && (
            <Button variant="ghost" size="sm" onClick={exportPortfolio} disabled={exporting}>
              <Download size={14} />{exporting ? 'Exporting…' : 'Export'}
            </Button>
          )}
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
              <Plus size={14} />New product
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <input
          className="flex-1 min-w-[200px] h-8 px-3 rounded-[8px] bg-surface border border-[rgba(19,19,26,.12)] text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-[rgba(192,38,211,.25)] focus:border-accent"
          placeholder="Search products..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {lobs.length > 1 && (
          <select
            className="h-8 px-3 rounded-[8px] bg-surface border border-[rgba(19,19,26,.12)] text-sm text-dim focus:outline-none focus:ring-2 focus:ring-[rgba(192,38,211,.25)]"
            value={lobFilter}
            onChange={e => setLobFilter(e.target.value)}
          >
            <option value="">All LOBs</option>
            {lobs.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface rounded-[14px] p-5 flex flex-col gap-3" style={{ border: '1px solid var(--color-border)' }}>
              <Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<Package size={32} />} title={query ? `No results for "${query}"` : `No ${tab === 'portfolio' ? 'launched' : 'draft'} products`}
          description={canEdit ? 'Create a new product to get started.' : undefined}
          action={canEdit ? <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}><Plus size={14} />New product</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(p => (
            <ProductCard key={p.id} p={p} onClick={() => navigate(`/app/products/${p.id}`)} />
          ))}
        </div>
      )}

      {newOpen && <NewProductModal onClose={() => setNewOpen(false)} onCreated={id => { setNewOpen(false); navigate(`/app/products/${id}`) }} />}
    </div>
  )
}
