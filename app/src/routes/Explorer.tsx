// Explorer — a left-to-right cascading column browser (Miller columns) for the
// product hierarchy: Products → Coverages → Sub-coverages → a peek panel. It is
// line-agnostic: HO-3 and Personal Auto cascade through the exact same model because the
// hierarchy is pure data — a coverage's `parentId` holds its parent's refId, so
// top-level = (parentId === null) and children = (parentId === parent.refId).
//
// Reads only: the whole surface is a browser, so it subscribes through the adapter
// and never mutates. Keyboard model (a11y first): ↑/↓ move within a column, →/Enter
// descend into the next, ← steps back, Home/End jump. Selection in each column is the
// keyboard "highlight"; moving it live-updates the downstream columns and the peek.
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { adapter } from '../lib/backend'
import { MillerColumn, type ColumnItem } from '../components/explorer/MillerColumn'
import { PeekPanel, type PeekNode } from '../components/explorer/PeekPanel'
import { IconSearch, IconProduct, IconCoverage, IconEndorsement, IconChevronRight, type IconType } from '../components/ui/icons'
import type { WithId } from '../context/ProductContext'
import type { Product, Coverage, Form } from '@pf/shared'

type ColKind = 'product' | 'coverage' | 'sub'
interface Sel { product: string | null; coverage: string | null; sub: string | null }

const byOrder = (a: WithId<Coverage>, b: WithId<Coverage>) => (a.order ?? 0) - (b.order ?? 0)

// Case-insensitive substring match over name + refId. Substring (not fuzzy) keeps the
// filtered order stable, which the keyboard nav depends on.
function makeMatcher(q: string) {
  const needle = q.trim().toLowerCase()
  return (c: { name: string; refId?: string | null }) =>
    !needle || c.name.toLowerCase().includes(needle) || (c.refId ?? '').toLowerCase().includes(needle)
}

export default function Explorer() {
  // ── Data (adapter subscriptions; reads only) ──────────────────────────────
  const [products, setProducts]               = useState<WithId<Product>[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [forms, setForms]                     = useState<WithId<Form>[]>([])
  const [coverages, setCoverages]             = useState<WithId<Coverage>[]>([])
  const [coveragesLoading, setCovLoading]     = useState(false)

  // ── Selection + focus state machine ───────────────────────────────────────
  const [sel, setSel]           = useState<Sel>({ product: null, coverage: null, sub: null })
  const [focusCol, setFocusCol] = useState(0)
  const [query, setQuery]       = useState('')

  // Roving-focus plumbing: option elements register here; a nav action parks a key
  // in `pendingFocus` and a layout effect moves DOM focus there (never on search typing).
  const optionRefs   = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<string | null>(null)
  const searchRef    = useRef<HTMLInputElement>(null)

  const registerRef = useCallback((key: string, el: HTMLButtonElement | null) => {
    if (el) optionRefs.current.set(key, el)
    else optionRefs.current.delete(key)
  }, [])

  // Products + forms: subscribed once. Forms enrich the peek's attached-form chips.
  useEffect(() => {
    const unsubP = adapter.db.subscribe<WithId<Product>>('products', (d) => {
      if (Array.isArray(d)) { setProducts([...d].sort((a, b) => a.name.localeCompare(b.name))); setProductsLoading(false) }
    })
    const unsubF = adapter.db.subscribe<WithId<Form>>('forms', (d) => { if (Array.isArray(d)) setForms(d) })
    return () => { unsubP(); unsubF() }
  }, [])

  // Auto-select the first product once so the cascade is alive on arrival (no focus grab).
  const autoPicked = useRef(false)
  useEffect(() => {
    if (autoPicked.current || sel.product || !products.length) return
    autoPicked.current = true
    setSel({ product: products[0].id, coverage: null, sub: null })
  }, [products, sel.product])

  // Coverages for the selected product; cleared on switch so stale data never leaks
  // into another product's columns or counts.
  useEffect(() => {
    if (!sel.product) { setCoverages([]); setCovLoading(false); return }
    setCoverages([]); setCovLoading(true)
    const unsub = adapter.db.subscribe<WithId<Coverage>>(`products/${sel.product}/coverages`, (d) => {
      if (Array.isArray(d)) { setCoverages(d); setCovLoading(false) }
    })
    return () => unsub()
  }, [sel.product])

  // ── Derived views ─────────────────────────────────────────────────────────
  const match         = makeMatcher(query)
  const childrenOf    = (refId?: string | null) => coverages.filter((c) => c.parentId === refId)
  const topCoverages  = coverages.filter((c) => !c.parentId).sort(byOrder)
  const selProduct    = products.find((p) => p.id === sel.product) ?? null
  const selCoverage   = coverages.find((c) => c.id === sel.coverage) ?? null
  const selSub        = coverages.find((c) => c.id === sel.sub) ?? null
  const subCoverages  = selCoverage ? childrenOf(selCoverage.refId).sort(byOrder) : []

  // Meta replaces the old internal refId sub-line with something a PM actually scans:
  // a product's line, a coverage's requirement.
  const toProdItem = (p: WithId<Product>): ColumnItem => ({ id: p.id, title: p.name, meta: p.lob?.name, hasChildren: true })
  const toCovItem  = (c: WithId<Coverage>, canDescend: boolean): ColumnItem => ({
    id: c.id, title: c.name, meta: c.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional', hasChildren: canDescend,
  })

  // Columns are always a prefix: Products, then Coverages (once a product is picked),
  // then Sub-coverages (once a coverage is picked — even if it has none, so its empty
  // state shows beside the peek rather than leaving a dead end).
  interface Col { kind: ColKind; label: string; icon: IconType; items: ColumnItem[]; total: number; selId: string | null; loading: boolean; emptyTitle: string; emptyHint?: string }
  const columns: Col[] = [
    {
      kind: 'product', label: 'Products', icon: IconProduct,
      items: products.filter(match).map(toProdItem), total: products.length,
      selId: sel.product, loading: productsLoading,
      emptyTitle: 'No products', emptyHint: 'Run pnpm seed to populate the hub.',
    },
  ]
  if (sel.product) columns.push({
    kind: 'coverage', label: 'Coverages', icon: IconCoverage,
    items: topCoverages.filter(match).map((c) => toCovItem(c, childrenOf(c.refId).length > 0)), total: topCoverages.length,
    selId: sel.coverage, loading: coveragesLoading,
    emptyTitle: 'No coverages', emptyHint: 'This product has no coverages yet.',
  })
  if (selCoverage) columns.push({
    kind: 'sub', label: 'Sub-coverages', icon: IconEndorsement,
    items: subCoverages.filter(match).map((c) => toCovItem(c, false)), total: subCoverages.length,
    selId: sel.sub, loading: coveragesLoading,
    emptyTitle: 'No sub-coverages', emptyHint: 'This is a leaf coverage — see its details on the right.',
  })

  const activeIndex = Math.min(focusCol, columns.length - 1)
  const focusedCol  = columns[activeIndex]

  // The peek previews the focused column's selected node.
  let peek: PeekNode | null = null
  if (focusedCol?.kind === 'product' && selProduct) {
    peek = { kind: 'product', product: selProduct, coverageCount: topCoverages.length, subCount: coverages.length - topCoverages.length }
  } else if (focusedCol?.kind === 'coverage' && selCoverage && sel.product) {
    peek = { kind: 'coverage', cov: selCoverage, pid: sel.product, forms, isSub: false }
  } else if (focusedCol?.kind === 'sub' && selSub && sel.product) {
    peek = { kind: 'coverage', cov: selSub, pid: sel.product, forms, isSub: true }
  }

  // ── Nav primitives ─────────────────────────────────────────────────────────
  // Move real DOM focus to an option and bring it into view (reduced-motion aware).
  function focusOption(key: string) {
    const el = optionRefs.current.get(key)
    if (!el) return
    el.focus({ preventScroll: true })
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' })
  }
  // Park a focus request for after the next render (used whenever a nav action also
  // changes state — the layout effect below consumes it once the target has mounted).
  const focusKey = (key: string) => { pendingFocus.current = key }

  function selectAt(kind: ColKind, id: string) {
    setSel((prev) =>
      kind === 'product'  ? { product: id, coverage: null, sub: null }
      : kind === 'coverage' ? { ...prev, coverage: id, sub: null }
      : { ...prev, sub: id },
    )
  }

  function moveWithin(colIndex: number, to: number | 'first' | 'last' | 'next' | 'prev') {
    const col = columns[colIndex]
    if (!col || col.items.length === 0) return
    const cur = col.items.findIndex((i) => i.id === col.selId)
    const last = col.items.length - 1
    let next: number
    if (to === 'first') next = 0
    else if (to === 'last') next = last
    else if (to === 'next') next = cur < 0 ? 0 : Math.min(last, cur + 1)
    else if (to === 'prev') next = cur < 0 ? last : Math.max(0, cur - 1)
    else next = to
    const target = col.items[next]
    selectAt(col.kind, target.id)
    setFocusCol(colIndex)
    focusKey(`${col.kind}:${target.id}`)
  }

  // Reveal the children of (kind,id) in the next column and focus its first item.
  // Returns false when there's nothing to descend into (leaf) — never traps focus.
  function revealChildren(kind: ColKind, id: string): boolean {
    if (kind === 'product') {
      if (id !== sel.product) { setSel({ product: id, coverage: null, sub: null }); setFocusCol(0); focusKey(`product:${id}`); return true }
      const first = topCoverages.filter(match)[0]
      if (!first) return false
      setSel({ product: id, coverage: first.id, sub: null }); setFocusCol(1); focusKey(`coverage:${first.id}`); return true
    }
    if (kind === 'coverage') {
      const parent = coverages.find((c) => c.id === id)
      if (!parent) return false
      const first = childrenOf(parent.refId).sort(byOrder).filter(match)[0]
      if (!first) return false
      setSel((prev) => ({ ...prev, coverage: id, sub: first.id })); setFocusCol(2); focusKey(`sub:${first.id}`); return true
    }
    return false // sub-coverage is a leaf in this cascade
  }

  function ascend(colIndex: number) {
    if (colIndex <= 0) return
    const prev = columns[colIndex - 1]
    setFocusCol(colIndex - 1)
    if (prev?.selId) focusKey(`${prev.kind}:${prev.selId}`)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const idx = activeIndex
    const col = columns[idx]
    switch (e.key) {
      case 'ArrowDown':  e.preventDefault(); moveWithin(idx, 'next'); break
      case 'ArrowUp':    e.preventDefault(); moveWithin(idx, 'prev'); break
      case 'Home':       e.preventDefault(); moveWithin(idx, 'first'); break
      case 'End':        e.preventDefault(); moveWithin(idx, 'last'); break
      case 'ArrowRight':
      case 'Enter':      e.preventDefault(); if (col?.selId) revealChildren(col.kind, col.selId); break
      case 'ArrowLeft':  e.preventDefault(); ascend(idx); break
    }
  }

  // ArrowDown from the search box drops focus into the active column's selection
  // (or its first visible row when the query has filtered the selection away).
  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setQuery(''); return }
    if (e.key !== 'ArrowDown') return
    const col = columns[activeIndex]
    if (!col || col.items.length === 0) return
    e.preventDefault()
    const stillVisible = col.selId && col.items.some((i) => i.id === col.selId)
    if (stillVisible) {
      // No state change — the option is already mounted, so focus it directly rather
      // than parking a key that no re-render would ever consume.
      focusOption(`${col.kind}:${col.selId}`)
    } else {
      const targetId = col.items[0].id
      selectAt(col.kind, targetId)
      focusKey(`${col.kind}:${targetId}`)
    }
  }

  // Consume a parked focus request after the DOM settles — respects reduced motion.
  useLayoutEffect(() => {
    const key = pendingFocus.current
    if (!key) return
    pendingFocus.current = null
    focusOption(key)
  })

  // ── Breadcrumb ──────────────────────────────────────────────────────────────
  interface Crumb { key: string; label: string; onClick: () => void }
  const crumbs: Crumb[] = [{
    key: 'root', label: 'Explorer',
    onClick: () => { setSel({ product: null, coverage: null, sub: null }); setFocusCol(0) },
  }]
  if (selProduct) crumbs.push({
    key: 'product', label: selProduct.name,
    onClick: () => { setSel({ product: selProduct.id, coverage: null, sub: null }); setFocusCol(0); focusKey(`product:${selProduct.id}`) },
  })
  if (selCoverage) crumbs.push({
    key: 'coverage', label: selCoverage.name,
    onClick: () => { setSel((p) => ({ ...p, sub: null })); setFocusCol(1); focusKey(`coverage:${selCoverage.id}`) },
  })
  if (selSub) crumbs.push({
    key: 'sub', label: selSub.name,
    onClick: () => { setFocusCol(2); focusKey(`sub:${selSub.id}`) },
  })

  return (
    <div className="h-full flex flex-col gap-4 min-h-0">
      {/* Header — title + search */}
      <div className="flex flex-col gap-3 shrink-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold text-text">Explorer</h1>
            <p className="text-sm text-dim">Cascade from product to coverage to sub-coverage, then peek the details.</p>
          </div>
          <div className="relative w-full max-w-xs">
            <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Filter every column…"
              aria-label="Filter explorer columns"
              className="w-full h-9 pl-9 pr-3 rounded-[9px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </div>
        </div>

        {/* Breadcrumb path */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 flex-wrap min-h-[1.5rem]">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1
            return (
              <span key={c.key} className="flex items-center gap-1 min-w-0">
                {i > 0 && <IconChevronRight size={13} className="text-faint shrink-0" aria-hidden="true" />}
                <button
                  onClick={c.onClick}
                  aria-current={isLast ? 'page' : undefined}
                  className={`text-sm truncate max-w-[220px] rounded-[6px] px-1.5 py-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent
                    ${isLast ? 'font-semibold text-text' : 'text-dim hover:text-accent hover:bg-accent-soft'}`}
                >
                  {c.label}
                </button>
              </span>
            )
          })}
        </nav>
      </div>

      {/* Cascade — columns + peek. Horizontal scroll when they exceed the width.
          Keyboard is delegated here from the roving-focus options that live within. */}
      <div
        role="group"
        aria-label="Explorer columns"
        onKeyDown={onKeyDown}
        className="flex-1 min-h-0 flex gap-3 overflow-x-auto pb-2"
      >
        {columns.map((col, idx) => (
          <MillerColumn
            key={col.kind}
            label={col.label}
            icon={col.icon}
            colKind={col.kind}
            items={col.items}
            totalCount={col.total}
            selectedId={col.selId}
            focused={idx === activeIndex}
            loading={col.loading}
            query={query}
            emptyTitle={col.emptyTitle}
            emptyHint={col.emptyHint}
            onSelect={(id) => { selectAt(col.kind, id); setFocusCol(idx); focusKey(`${col.kind}:${id}`) }}
            onActivate={(id) => { selectAt(col.kind, id); setFocusCol(idx); revealChildren(col.kind, id) }}
            registerRef={registerRef}
          />
        ))}
        <PeekPanel node={peek} />
      </div>

      {/* Keyboard legend */}
      <div className="shrink-0 flex items-center gap-4 text-xs text-faint">
        <span><kbd className="font-mono text-dim">↑↓</kbd> move</span>
        <span><kbd className="font-mono text-dim">→ / ↵</kbd> descend</span>
        <span><kbd className="font-mono text-dim">←</kbd> back</span>
        <span><kbd className="font-mono text-dim">Home/End</kbd> jump</span>
      </div>
    </div>
  )
}
