// Products list — realtime portfolio with card + list views, facet filters,
// typeahead, and New Product.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { toast } from 'sonner'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Button, Skeleton, EmptyState, Tabs, ViewToggle, type ViewMode } from '../components/ui'
import { IconPlus, IconDownload, IconProduct, IconSearch } from '../components/ui/icons'
import { ProductCard } from '../components/product/ProductCard'
import { ProductRow } from '../components/product/ProductRow'
import { NewProductModal } from '../components/product/NewProductModal'
import { exportPortfolioExcel, type ProductExport } from '../lib/export/excel'
import type { Product, Coverage, Rule, Form, LDTable, RTTable, RatingProgram } from '@pf/shared'
import type { WithId } from '../context/ProductContext'

const VIEW_KEY = 'pf.products.view'

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
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) || 'cards')
  const setViewPersist = (m: ViewMode) => { setView(m); localStorage.setItem(VIEW_KEY, m) }

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
              <IconDownload size={14} />{exporting ? 'Exporting…' : 'Export'}
            </Button>
          )}
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
              <IconPlus size={14} />New product
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <div className="relative flex-1 min-w-[200px]">
          <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            className="w-full h-8 pl-9 pr-3 rounded-[8px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent"
            placeholder="Search products…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        {lobs.length > 1 && (
          <select
            className="h-8 px-3 rounded-[8px] bg-surface border border-border-strong text-sm text-dim focus:outline-none focus:ring-2 focus:ring-accent/25"
            value={lobFilter}
            onChange={e => setLobFilter(e.target.value)}
          >
            <option value="">All LOBs</option>
            {lobs.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <ViewToggle mode={view} onChange={setViewPersist} />
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
        <EmptyState icon={<IconProduct size={32} />} title={query ? `No results for "${query}"` : `No ${tab === 'portfolio' ? 'launched' : 'draft'} products`}
          description={canEdit ? 'Create a new product to get started.' : undefined}
          action={canEdit ? <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}><IconPlus size={14} />New product</Button> : undefined}
        />
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(p => <ProductCard key={p.id} p={p} />)}
        </div>
      ) : (
        <div className="rounded-[14px] overflow-hidden bg-surface" style={{ border: '1px solid var(--color-border)' }}>
          {visible.map(p => <ProductRow key={p.id} p={p} />)}
        </div>
      )}

      {newOpen && <NewProductModal onClose={() => setNewOpen(false)} onCreated={id => { setNewOpen(false); navigate(`/app/products/${id}`) }} />}
    </div>
  )
}
