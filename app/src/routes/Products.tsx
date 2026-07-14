// Products list — the PUBLISHED portfolio only (lifecycle LAUNCHED). Drafts live in
// the Builder workbench and reach this surface solely through an explicit promotion,
// so a draft can never leak into the portfolio here. Two views: Cards (the portfolio
// grid) and Hierarchy (the product-framework tree), defaulting to Hierarchy. A smart,
// realtime search filters by name + the metadata a PM actually types (line of business,
// market segment, vertical, coverage family, state, id), and two registry-driven facet
// rows — Personal/Commercial and Market segment — narrow the grid by segment. Both facet
// value sets come from deriveSegmentAxes(), so registering a new line in the LOB registry
// extends the facets automatically; nothing here is hard-coded.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { toast } from 'sonner'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { canI } from '../lib/canI'
import { usePortfolioInventory } from '../lib/usePortfolioInventory'
import { useDebounce } from '../lib/useDebounce'
import { Button, Skeleton, EmptyState } from '../components/ui'
import { IconPlus, IconDownload, IconProduct, IconSearch, IconCards, IconLayers, IconRefresh } from '../components/ui/icons'
import { ProductCard } from '../components/product/ProductCard'
import { DeleteProductDialog } from '../components/product/DeleteProductDialog'
import { RetireProductDialog } from '../components/product/RetireProductDialog'
import { PageHero } from '../components/ui/PageHero'
import { ProductHierarchy } from '../components/product/ProductHierarchy'
import { exportPortfolioExcel, type ProductExport } from '../lib/export/excel'
import {
  deriveSegmentAxes, matchesSegments,
  type Product, type Coverage, type Rule, type Form, type LDTable, type RTTable, type RatingProgram,
  type SegmentSelection, type SegmentAxisId,
} from '@pf/shared'
import type { WithId } from '../context/ProductContext'

type ProductView = 'cards' | 'tree'
const VIEW_KEY = 'pf.products.view'

const VIEWS: { id: ProductView; label: string; Icon: typeof IconCards }[] = [
  { id: 'cards', label: 'Cards',     Icon: IconCards  },
  { id: 'tree',  label: 'Hierarchy', Icon: IconLayers },
]

// Default to the Hierarchy view. Migrate any legacy value ('list'/'table') that isn't a
// current view id to 'tree'; only an explicit 'cards' opts out of the framework tree.
function readView(): ProductView {
  return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'tree'
}

// The searchable haystack for one product — everything a PM would actually type to find a
// product: its name, id, line of business, market segment, and every registry-derived
// segment value (vertical, coverage family), plus its state footprint.
function searchTextFor(p: WithId<Product>, axes: ReturnType<typeof deriveSegmentAxes>): string {
  const segValues = axes.flatMap((a) => a.values.filter((v) => matchesSegments(p, { [a.id]: v })))
  return [
    p.name, p.refId ?? '', p.marketSegment ?? '', p.lob?.name ?? '', p.lob?.refId ?? '', p.lifecycle ?? '',
    ...segValues,
    p.allStates ? 'all states nationwide' : (p.states ?? []).join(' '),
  ].join(' ')
}

export default function Products() {
  const navigate   = useNavigate()
  const { user }   = useUser()
  const canEdit    = canI(user, 'product:write')

  const [products, setProducts] = useState<WithId<Product>[]>([])
  const [loading,  setLoading]  = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [query,    setQuery]    = useState('')
  const debouncedQuery = useDebounce(query, 200)
  const [seg,      setSeg]      = useState<SegmentSelection>({})
  const [exporting, setExporting] = useState(false)
  const [view, setView] = useState<ProductView>(readView)
  const [deleteFor,  setDeleteFor]  = useState<WithId<Product> | null>(null)
  const [retireFor,  setRetireFor]  = useState<WithId<Product> | null>(null)
  const [showRetired, setShowRetired] = useState(false)
  // Keyboard cursor over the visible results — driven from the search field
  // (↑/↓ move, Enter opens, Esc clears). -1 = no card selected.
  const [focusIdx, setFocusIdx] = useState(-1)

  const setViewPersist = (m: ProductView) => { setView(m); localStorage.setItem(VIEW_KEY, m) }

  async function exportPortfolio() {
    const launchedProducts = products.filter(p => p.lifecycle === 'LAUNCHED')
    if (!launchedProducts.length) return
    setExporting(true)
    try {
      const [forms, ldList, rtList] = await Promise.all([
        adapter.db.list<Form & { id: string }>('forms'),
        adapter.db.list<LDTable & { id: string }>('ldTables'),
        adapter.db.list<RTTable & { id: string }>('rtTables'),
      ])
      const ldTables = Object.fromEntries(ldList.map(t => [t.id, t])) as Record<string, LDTable>
      const rtTables = Object.fromEntries(rtList.map(t => [t.id, t])) as Record<string, RTTable>
      const items: ProductExport[] = await Promise.all(launchedProducts.map(async p => {
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
    setLoadError(false)
    const unsub = adapter.db.subscribe<WithId<Product>>('products', (data) => {
      if (Array.isArray(data)) { setProducts(data); setLoading(false); setLoadError(false) }
    }, () => { setLoadError(true); setLoading(false) })
    return unsub
  }, [reloadKey])

  // Published portfolio only (LAUNCHED); drafts are authored + promoted in the Builder.
  const launched = useMemo(() => products.filter(p => p.lifecycle === 'LAUNCHED'), [products])
  const retired  = useMemo(() => products.filter(p => p.lifecycle === 'RETIRED'),  [products])

  // Registry-driven facet axes — drive both the search haystack and the facet-chip rows.
  const axes = useMemo(() => deriveSegmentAxes(), [])
  const facetValues = (id: SegmentAxisId) => axes.find(a => a.id === id)?.values ?? []
  const activeSeg = Object.values(seg).filter(Boolean).length
  const toggleSeg = (id: SegmentAxisId, v: string) =>
    setSeg(prev => ({ ...prev, [id]: prev[id] === v ? undefined : v }))

  // Segment facets narrow the portfolio first; search then runs over the narrowed set.
  const segFiltered = useMemo(() => launched.filter(p => matchesSegments(p, seg)), [launched, seg])
  const searchable = useMemo(() => segFiltered.map(p => ({ p, text: searchTextFor(p, axes) })), [segFiltered, axes])
  const fuse = useMemo(() => new Fuse(searchable, { keys: ['text'], threshold: 0.4, ignoreLocation: true }), [searchable])
  const visible = useMemo(
    () => (debouncedQuery.trim() ? fuse.search(debouncedQuery).map(r => r.item.p) : segFiltered),
    [debouncedQuery, fuse, segFiltered],
  )

  // Reset the keyboard cursor whenever the result set changes shape.
  useEffect(() => { setFocusIdx(-1) }, [debouncedQuery, seg])

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(i + 1, visible.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(i - 1, -1)) }
    else if (e.key === 'Enter') {
      const target = visible[focusIdx] ?? (visible.length === 1 ? visible[0] : undefined)
      if (target) { e.preventDefault(); navigate(`/app/products/${target.id}/overview`) }
    } else if (e.key === 'Escape') { setQuery(''); setFocusIdx(-1) }
  }

  // Portfolio at-a-glance KPIs for the hero stat line.
  const kpis = useMemo(() => {
    const lines    = new Set(launched.map(p => p.lob?.name).filter(Boolean)).size
    const segments = new Set(launched.map(p => p.marketSegment).filter(Boolean)).size
    const allStates = launched.some(p => p.allStates)
    const states = new Set<string>()
    launched.forEach(p => (p.states ?? []).forEach(s => states.add(s)))
    return { lines, segments, statesCovered: allStates ? 'All' as const : states.size }
  }, [launched])

  // Inventory data (coverages + forms) — loaded only while the hierarchy view is active.
  const needsInventory = view !== 'cards'
  const inventory = usePortfolioInventory(visible, needsInventory)

  return (
    <div className="flex flex-col gap-5">
      {/* Apple-inspired page hero — animated glowing "Products" glyph + at-a-glance stats. */}
      <PageHero
        glyph="products"
        title="Products"
        subtitle={`${launched.length} published product${launched.length !== 1 ? 's' : ''}`}
        stats={!loading && launched.length > 0 ? (
          <div className="flex items-center gap-2 mt-1.5 text-xs text-dim tnum flex-wrap">
            <span>{kpis.lines} line{kpis.lines !== 1 ? 's' : ''} of business</span>
            <span className="text-faint" aria-hidden="true">·</span>
            <span>{kpis.segments} market segment{kpis.segments !== 1 ? 's' : ''}</span>
            <span className="text-faint" aria-hidden="true">·</span>
            <span>{kpis.statesCovered === 'All' ? 'All states' : `${kpis.statesCovered} states covered`}</span>
          </div>
        ) : undefined}
        actions={
          <>
            {launched.length > 0 && (
              <Button variant="ghost" size="sm" onClick={exportPortfolio} disabled={exporting}>
                <IconDownload size={14} />{exporting ? 'Exporting…' : 'Export'}
              </Button>
            )}
            {canEdit && (
              <Button variant="primary" size="sm" onClick={() => navigate('/app/builder')}>
                <IconPlus size={14} />New draft
              </Button>
            )}
          </>
        }
      />

      {/* Smart realtime search · view switch */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            className="w-full h-9 pl-9 pr-3 rounded-[10px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent"
            placeholder="Search products by name, line, segment, state, or refId…"
            aria-label="Search products (↑↓ to select, Enter to open)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>
        <ViewSwitch view={view} onChange={setViewPersist} />
      </div>

      {/* Registry-driven segment facets — Personal/Commercial + Market segment. Rendered only
          when a facet actually has something to narrow (>1 value across the portfolio). */}
      {!loading && launched.length > 0 && (facetValues('personalOrCommercial').length > 1 || facetValues('marketSegment').length > 1) && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Segment filters">
          {facetValues('personalOrCommercial').length > 1 && (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint">Type</span>
              {facetValues('personalOrCommercial').map(v => (
                <FacetChip key={v} active={seg.personalOrCommercial === v} onClick={() => toggleSeg('personalOrCommercial', v)}>{v}</FacetChip>
              ))}
            </>
          )}
          {facetValues('personalOrCommercial').length > 1 && facetValues('marketSegment').length > 1 && (
            <span className="w-px h-4 mx-0.5 shrink-0" style={{ background: 'var(--color-border)' }} aria-hidden="true" />
          )}
          {facetValues('marketSegment').length > 1 && (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint">Segment</span>
              {facetValues('marketSegment').map(v => (
                <FacetChip key={v} active={seg.marketSegment === v} onClick={() => toggleSeg('marketSegment', v)}>{v}</FacetChip>
              ))}
            </>
          )}
          {activeSeg > 0 && (
            <button onClick={() => setSeg({})}
              className="h-7 px-2.5 rounded-[8px] text-xs text-dim hover:text-danger transition-colors"
              style={{ border: '1px solid var(--color-border)' }}>
              Clear {activeSeg}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface rounded-[14px] p-5 flex flex-col gap-3" style={{ border: '1px solid var(--color-border)' }}>
              <Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <EmptyState icon={<IconProduct size={32} />} title="Couldn't load products"
          description="Check your connection or permissions and try again."
          action={<Button variant="primary" size="sm" onClick={() => { setLoading(true); setReloadKey(k => k + 1) }}><IconRefresh size={14} />Retry</Button>}
        />
      ) : visible.length === 0 ? (
        launched.length === 0 && !query ? (
          <EmptyState icon={<IconProduct size={32} />} title="No published products yet"
            description={canEdit ? 'Author a product in the Builder, then promote it here.' : 'Products appear here once a draft is promoted.'}
            action={canEdit ? <Button variant="primary" size="sm" onClick={() => navigate('/app/builder')}><IconPlus size={14} />Create a product</Button> : undefined}
          />
        ) : (
          <EmptyState icon={<IconProduct size={32} />}
            title={query ? `No results for "${query}"` : (activeSeg > 0 ? 'No products match these filters' : 'No published products')}
            description={query || activeSeg > 0 ? 'Adjust your search or segment filters to see published products.' : 'Adjust your search to see published products.'}
            action={(query || activeSeg > 0)
              ? <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setSeg({}) }}>Clear search & filters</Button>
              : undefined}
          />
        )
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Entrance stagger, matching the Coverage card grid so both surfaces share
              one motion language. Capped + reduced-motion-neutralised (see index.css). */}
          {visible.map((p, i) => (
            <div key={p.id} className="rise-in h-full" style={{ '--rise-delay': `${Math.min(i, 8) * 40}ms` } as React.CSSProperties}>
              <ProductCard p={p} canEdit={canEdit} onDelete={() => setDeleteFor(p)} onRetire={() => setRetireFor(p)}
                highlight={debouncedQuery} focused={i === focusIdx} />
            </div>
          ))}
        </div>
      ) : (
        <ProductHierarchy products={visible} byProduct={inventory.byProduct} loading={inventory.loading} error={inventory.error} groupBy="none" />
      )}

      {/* Retired products — shown when the toggle is open and at least one exists */}
      {canEdit && retired.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setShowRetired(r => !r)}
            className="inline-flex items-center gap-2 self-start text-xs text-dim hover:text-text transition-colors"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              style={{ transform: showRetired ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
            {showRetired ? 'Hide' : 'Show'} retired ({retired.length})
          </button>
          {showRetired && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
              {retired.map(p => (
                <div key={p.id} className="h-full">
                  <ProductCard p={p} canEdit={canEdit} onDelete={() => setDeleteFor(p)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {deleteFor && user && (
        <DeleteProductDialog
          product={deleteFor}
          actor={{ uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }}
          onClose={() => setDeleteFor(null)}
          onDeleted={() => setDeleteFor(null)}
        />
      )}
      {retireFor && user && (
        <RetireProductDialog
          product={retireFor}
          actor={{ uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }}
          onClose={() => setRetireFor(null)}
          onRetired={() => setRetireFor(null)}
        />
      )}
    </div>
  )
}

// A single segment-facet toggle chip. Mirrors the Tasks board FilterChip treatment so the
// two filtering surfaces read as one system (accent-soft when active, subtle otherwise).
function FacetChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`px-2.5 py-1 rounded-[8px] text-xs font-medium transition-colors ${active ? 'bg-accent-soft text-accent' : 'bg-surface text-dim hover:text-text'}`}
      style={{ border: `1px solid ${active ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}>
      {children}
    </button>
  )
}

// Two-way view switch (Cards · Hierarchy) — mirrors the shared ViewToggle's look.
function ViewSwitch({ view, onChange }: { view: ProductView; onChange: (v: ProductView) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-[10px] bg-raised" role="group" aria-label="View mode">
      {VIEWS.map(({ id, label, Icon }) => {
        const active = view === id
        return (
          <button key={id} type="button" onClick={() => onChange(id)} aria-pressed={active} aria-label={`${label} view`}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
              active ? 'bg-surface text-accent shadow-[var(--shadow-chip)]' : 'text-dim hover:text-text'}`}
            style={active ? { border: '1px solid var(--color-border)' } : undefined}>
            <Icon size={15} strokeWidth={active ? 1.9 : 1.6} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
