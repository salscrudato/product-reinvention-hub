// Products list — realtime portfolio with three views: Cards (the portfolio grid),
// Table (the flattened coverage/form inventory) and Hierarchy (the product-framework
// tree). Segmentation (Personal/Commercial, Property/Casualty, market segment) is
// driven entirely by the LOB registry, so it extends automatically as lines are
// registered. Cards need only the product docs; the inventory + hierarchy lazily load
// per-product coverages and forms.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { toast } from 'sonner'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { usePortfolioInventory } from '../lib/usePortfolioInventory'
import { Button, Skeleton, EmptyState, Tabs } from '../components/ui'
import { IconPlus, IconDownload, IconUpload, IconProduct, IconSearch, IconCards, IconTable, IconLayers } from '../components/ui/icons'
import { ProductCard } from '../components/product/ProductCard'
import { SegmentFilter } from '../components/product/SegmentFilter'
import { InventoryTable } from '../components/product/InventoryTable'
import { ProductHierarchy } from '../components/product/ProductHierarchy'
import { NewProductModal } from '../components/product/NewProductModal'
import { ImportWorkbookModal } from '../components/product/ImportWorkbookModal'
import { exportPortfolioExcel, type ProductExport } from '../lib/export/excel'
import {
  deriveSegmentAxes, matchesSegments,
  type Product, type Coverage, type Rule, type Form, type LDTable, type RTTable, type RatingProgram,
  type SegmentSelection, type SegmentAxisId,
} from '@pf/shared'
import type { WithId } from '../context/ProductContext'

type ProductView = 'cards' | 'table' | 'tree'
const VIEW_KEY = 'pf.products.view'
const FWID_KEY = 'pf.products.fwid'

const TABS = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'drafts',    label: 'Drafts'    },
]

const VIEWS: { id: ProductView; label: string; Icon: typeof IconCards }[] = [
  { id: 'cards', label: 'Cards',     Icon: IconCards  },
  { id: 'table', label: 'Table',     Icon: IconTable  },
  { id: 'tree',  label: 'Hierarchy', Icon: IconLayers },
]

// Migrate the legacy 'list' value (2-way cards/list toggle) to the new 'table' view.
function readView(): ProductView {
  const v = localStorage.getItem(VIEW_KEY)
  return v === 'table' || v === 'tree' ? v : v === 'list' ? 'table' : 'cards'
}

export default function Products() {
  const navigate   = useNavigate()
  const { user }   = useUser()
  const canEdit    = user?.role === 'EDITOR' || user?.role === 'ADMIN'

  const [products, setProducts] = useState<WithId<Product>[]>([])
  const [loading,  setLoading]  = useState(true)
  const [query,    setQuery]    = useState('')
  const [tab,      setTab]      = useState('portfolio')
  const [selection, setSelection] = useState<SegmentSelection>({})
  const [groupBy,  setGroupBy]  = useState<SegmentAxisId | 'none'>('none')
  const [newOpen,  setNewOpen]  = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [view, setView] = useState<ProductView>(readView)
  const [showFwId, setShowFwId] = useState<boolean>(() => localStorage.getItem(FWID_KEY) !== '0')

  const setViewPersist = (m: ProductView) => { setView(m); localStorage.setItem(VIEW_KEY, m) }
  const setFwIdPersist = (b: boolean) => { setShowFwId(b); localStorage.setItem(FWID_KEY, b ? '1' : '0') }

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

  // Portfolio (LAUNCHED) vs drafts, then registry-driven segmentation, then search.
  const tabbed = useMemo(() => (
    tab === 'portfolio'
      ? products.filter(p => p.lifecycle === 'LAUNCHED')
      : products.filter(p => p.lifecycle !== 'LAUNCHED')
  ), [products, tab])

  const segmented = useMemo(() => tabbed.filter(p => matchesSegments(p, selection)), [tabbed, selection])

  const fuse = useMemo(() => new Fuse(segmented, { keys: ['name', 'refId', 'marketSegment'], threshold: 0.4 }), [segmented])
  const visible = query ? fuse.search(query).map(r => r.item) : segmented

  // Facet axes + per-value counts (within the current tab) — all from the registry.
  const axes = useMemo(() => deriveSegmentAxes(), [])
  const counts = useMemo(() => {
    const out: Partial<Record<SegmentAxisId, Record<string, number>>> = {}
    for (const a of axes) {
      out[a.id] = Object.fromEntries(a.values.map(v => [v, tabbed.filter(p => matchesSegments(p, { [a.id]: v })).length]))
    }
    return out
  }, [axes, tabbed])

  // Inventory data (coverages + forms) — loaded only while table/hierarchy is active.
  const needsInventory = view !== 'cards'
  const inventory = usePortfolioInventory(visible, needsInventory)

  const groupOptions: { value: SegmentAxisId | 'none'; label: string }[] =
    [{ value: 'none', label: 'No grouping' }, ...axes.map(a => ({ value: a.id, label: `Group: ${a.label}` }))]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Products</h1>
          <p className="text-sm text-dim mt-0.5 tnum">{products.length} product{products.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {products.length > 0 && (
            <Button variant="ghost" size="sm" onClick={exportPortfolio} disabled={exporting}>
              <IconDownload size={14} />{exporting ? 'Exporting…' : 'Export'}
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>
              <IconUpload size={14} />Import
            </Button>
          )}
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
              <IconPlus size={14} />New product
            </Button>
          )}
        </div>
      </div>

      {/* Tabs · search · view switch */}
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
        <ViewSwitch view={view} onChange={setViewPersist} />
      </div>

      {/* Segmentation facets + (inventory-only) grouping / column controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentFilter axes={axes} selection={selection} onChange={setSelection} counts={counts} />
        {needsInventory && (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="pf-groupby">Group products by segment</label>
            <select id="pf-groupby" value={groupBy} onChange={e => setGroupBy(e.target.value as SegmentAxisId | 'none')}
              className="h-8 px-2.5 rounded-[8px] bg-surface border border-border-strong text-[13px] text-dim focus:outline-none focus:ring-2 focus:ring-accent/25">
              {groupOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {view === 'table' && (
              <button type="button" onClick={() => setFwIdPersist(!showFwId)} aria-pressed={showFwId}
                title="Show or hide the Product Framework ID column"
                className={`h-8 px-2.5 rounded-[8px] text-[13px] font-medium border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                  showFwId ? 'bg-accent-soft text-accent border-accent-line' : 'bg-surface text-dim border-border-strong hover:text-text'}`}>
                Framework ID
              </button>
            )}
          </div>
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
        <EmptyState icon={<IconProduct size={32} />} title={query ? `No results for "${query}"` : 'No products match these filters'}
          description={canEdit ? 'Adjust the filters, or create a new product.' : 'Adjust the filters to see products.'}
          action={canEdit && !query ? <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}><IconPlus size={14} />New product</Button> : undefined}
        />
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(p => <ProductCard key={p.id} p={p} />)}
        </div>
      ) : view === 'table' ? (
        <InventoryTable products={visible} byProduct={inventory.byProduct} loading={inventory.loading} error={inventory.error} showFrameworkId={showFwId} groupBy={groupBy} />
      ) : (
        <ProductHierarchy products={visible} byProduct={inventory.byProduct} loading={inventory.loading} error={inventory.error} groupBy={groupBy} />
      )}

      {newOpen && <NewProductModal onClose={() => setNewOpen(false)} onCreated={id => { setNewOpen(false); navigate(`/app/products/${id}`) }} />}
      {importOpen && <ImportWorkbookModal onClose={() => setImportOpen(false)} onImported={id => { setImportOpen(false); navigate(`/app/products/${id}`) }} />}
    </div>
  )
}

// Three-way view switch (Cards · Table · Hierarchy) — keeps the cards/table toggle
// and adds the framework hierarchy, mirroring the shared ViewToggle's look.
function ViewSwitch({ view, onChange }: { view: ProductView; onChange: (v: ProductView) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-[10px] bg-raised" role="group" aria-label="View mode">
      {VIEWS.map(({ id, label, Icon }) => {
        const active = view === id
        return (
          <button key={id} type="button" onClick={() => onChange(id)} aria-pressed={active} aria-label={`${label} view`}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
              active ? 'bg-surface text-accent shadow-[0_1px_2px_rgba(19,19,26,.06)]' : 'text-dim hover:text-text'}`}
            style={active ? { border: '1px solid var(--color-border)' } : undefined}>
            <Icon size={15} strokeWidth={active ? 1.9 : 1.6} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
