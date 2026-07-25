// Coverages — the product's coverages as a browsable collection (cards ⇄ tree,
// cards by default). Every coverage is a hub whose tiles drill into focused editors:
// Limits and Deductibles (typed standard options), States (US map), Forms (edition +
// scope), and the Pricing/Rules tabs. Create / edit / delete keep the hierarchy consistent.
//
// Hierarchy of the page (most → least prominent):
//   1. the ONE smart search (fuzzy typeahead + tokens) + the coverage read  (primary)
//   2. the collapsible filter rail — closed by default, only axes with >1 choice (secondary)
//   3. per-card metadata (chips + aspect counts)                            (tertiary)
// The cards view shows TOP-LEVEL coverages only; a parent's sub-coverages stay tucked
// away behind a "Sub-Coverage" caret and expand into a tree in place, dimming the rest.
import { Fragment, useMemo, useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { useCapture } from '../../context/useCapture'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { Button, Skeleton, EmptyState, ViewToggle, Dialog, type ViewMode } from '../../components/ui'
import { IconPlus, IconSearch, IconCoverage, IconFilter, IconClose, IconEndorsement, IconChevronDown } from '../../components/ui/icons'
import { useEntityFilters } from '../../features/search/useEntityFilters'
import { FacetPanel } from '../../features/search/FacetPanel'
import { CommandBar } from '../../features/search/CommandBar'
import { ActiveFilters } from '../../features/search/ActiveFilters'
import { makeCoveragesFilterSchema } from '../../features/coverages/coveragesSchema'
import { CoverageHubCard } from '../../components/product/CoverageHubCard'
import { CoverageTree } from '../../components/product/CoverageTree'
import type { CoverageAspect } from '../../components/product/coverageAspects'
import { TermOptionsDialog } from '../../components/product/TermOptionsDialog'
import { CoverageStatesDialog } from '../../components/product/CoverageStatesDialog'

import { CoverageEditDialog } from '../../components/product/CoverageEditDialog'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const byOrder = (a: WithId<Coverage>, b: WithId<Coverage>) => (a.order ?? 0) - (b.order ?? 0)

export default function ProductCoverages() {
  const { pid, product, coverages, loading } = useProductCtx()
  const { user } = useUser()
  const canEdit = canI(user, 'product:write')
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // Cards are the default read; the toggle is session-only (no persistence).
  const [view, setView] = useState<ViewMode>('cards')

  // Filter rail is collapsible — CLOSED by default so the coverage read leads.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const toggleFilters = () => setFiltersOpen((o) => !o)

  // Page-scoped, product-shape-agnostic filter engine. The schema drops the coverage-group
  // ("Part A/B…") axis — not every product has groups — and keeps only dimensions that
  // exist for any coverage. getText is enriched so the single search matches name + metadata.
  // An enum axis where every coverage shares one value offers no real choice — hidden.
  const schema = useMemo(() => {
    const base = makeCoveragesFilterSchema(coverages, product?.lob?.name)
    const facets = base.facets.filter((f) => {
      if (f.kind !== 'enum') return true
      const distinct = new Set<string>()
      for (const c of coverages) {
        const v = f.accessor(c)
        for (const one of Array.isArray(v) ? v : [v]) if (one != null && one !== '') distinct.add(String(one))
      }
      return distinct.size > 1
    })
    return { ...base, facets }
  }, [coverages, product?.lob?.name])
  const filters = useEntityFilters(coverages, schema)
  useEffect(() => {
    const n = filters.reconciliation.dropped.length
    if (n) toast.info(`Adjusted ${n} filter${n === 1 ? '' : 's'} that no longer applied`)
  }, [filters.reconciliation])

  // Aspect editors (dialogs) + coverage create/edit.
  const [dialog, setDialog] = useState<{ kind: 'limits' | 'deductibles' | 'options' | 'states'; cov: WithId<Coverage> } | null>(null)
  const [editCov, setEditCov] = useState<WithId<Coverage> | 'new' | null>(null)
  const [deletePending, setDeletePending] = useState<WithId<Coverage> | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Which parent cards' sub-coverage trees are expanded (cards view only). Multiple at a time.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Feedback capture context: publish the coverage whose detail/editor is open as the focused
  // entity, so ⌘. attaches that exact coverage + its refId. Cleared when nothing specific is open.
  const { setFocus } = useCapture()
  const focusCov = dialog?.cov ?? (editCov && editCov !== 'new' ? editCov : null)
  useEffect(() => {
    setFocus(focusCov ? { entityPath: `products/${pid}/coverages/${focusCov.id}`, refId: focusCov.refId ?? undefined, label: focusCov.name } : null)
    return () => setFocus(null)
  }, [focusCov, pid, setFocus])

  const filtered = filters.results
  const passing = useMemo(() => new Set(filtered.map((c) => c.id)), [filtered])
  // The page's selected states (state facet) cascade into the per-coverage limit/deductible/
  // option editors, so filtering on a state also narrows the limits shown to that state.
  const selectedStates = filters.state.enums.state ?? []
  const parentName = (refId?: string | null) => coverages.find((c) => c.refId === refId)?.name

  // Sub-coverages grouped by their parent's refId, and the set of parent refIds that
  // actually resolve to a top-level coverage (so an orphan with a dangling parentId is
  // treated as top-level rather than vanishing).
  const { subsByParent, topLevel } = useMemo(() => {
    const refIds = new Set(coverages.map((c) => c.refId).filter(Boolean) as string[])
    const subs = new Map<string, WithId<Coverage>[]>()
    for (const c of coverages) {
      if (c.parentId && refIds.has(c.parentId)) {
        const arr = subs.get(c.parentId) ?? []
        arr.push(c)
        subs.set(c.parentId, arr)
      }
    }
    for (const arr of subs.values()) arr.sort(byOrder)
    const roots = coverages.filter((c) => !c.parentId || !refIds.has(c.parentId)).sort(byOrder)
    return { subsByParent: subs, topLevel: roots }
  }, [coverages])

  // Top-level cards to render: a root shows if it matches the filters itself OR any of its
  // sub-coverages match — so filtering never hides a matching sub behind a hidden parent.
  const cards = useMemo(
    () => topLevel.filter((r) => passing.has(r.id) || (subsByParent.get(r.refId ?? '') ?? []).some((s) => passing.has(s.id))),
    [topLevel, subsByParent, passing],
  )

  // Keep the expansion honest: collapse any card no longer on screen, or clear all if view leaves cards.
  useEffect(() => {
    if (expandedIds.size === 0) return
    if (view !== 'cards') { setExpandedIds(new Set()); return }
    const cardIds = new Set(cards.map(c => c.id))
    setExpandedIds(prev => {
      const filtered = new Set([...prev].filter(id => cardIds.has(id)))
      return filtered.size === prev.size ? prev : filtered
    })
  }, [cards, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc collapses all open sub-coverage trees.
  useEffect(() => {
    if (expandedIds.size === 0) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedIds(new Set()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandedIds.size])

  // A deep link (?cov=<id|refId>) auto-opens that coverage's Limits editor once,
  // after coverages have loaded (guarded so closing it doesn't reopen).
  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current) return
    const target = params.get('cov')
    if (!target || !coverages.length) return
    const cov = coverages.find((c) => c.id === target || c.refId === target)
    if (cov) { setDialog({ kind: 'limits', cov }); deepLinkDone.current = true }
  }, [coverages, params])

  function onTile(aspect: CoverageAspect, cov: WithId<Coverage>) {
    if (aspect === 'limits' || aspect === 'deductibles' || aspect === 'options' || aspect === 'states') {
      setDialog({ kind: aspect, cov })
    } else {
      navigate(`/app/products/${pid}/${aspect}?cov=${encodeURIComponent(cov.refId ?? cov.id)}`)
    }
  }

  function onDelete(cov: WithId<Coverage>) {
    if (!canEdit) return
    const children = coverages.filter((c) => c.parentId === cov.refId)
    if (children.length) { toast.error(`Reassign or remove its ${children.length} endorsement${children.length === 1 ? '' : 's'} first.`); return }
    setDeletePending(cov)
  }

  async function confirmDelete() {
    if (!deletePending) return
    setDeleting(true)
    try {
      // Delete is last-write-wins: a concurrent delete is idempotent, so no expectedRev needed.
      await adapter.db.mutate({ op: 'delete', path: `products/${pid}/coverages/${deletePending.id}`, entityType: 'coverage', productId: pid, actor })
      toast.success('Coverage deleted')
      setDeletePending(null)
    } catch (err) {
      if (err instanceof MutationConflictError) {
        // Delete already succeeded server-side or was idempotent; close the dialog.
        conflictToast({ discard: () => setDeletePending(null) })
      } else {
        toast.error(err instanceof Error ? err.message : 'Delete failed')
      }
    } finally {
      setDeleting(false)
    }
  }

  const hubProps = (cov: WithId<Coverage>) => ({ cov, canEdit, onTile, onEdit: setEditCov, onDelete, filterStates: selectedStates })
  const activeFilterCount = filters.activeChips.length

  if (loading && coverages.length === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1,2,3,4,5,6].map(i => (
          <div key={i} className="bg-surface rounded-[14px] p-5 flex flex-col gap-3" style={{ border: '1px solid var(--color-border)' }}>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar — layout options lead on the left, then filters, then the ONE smart
          search (fuzzy typeahead + structured tokens + live text filtering). */}
      <div className="flex flex-wrap items-center gap-2.5">
        <ViewToggle mode={view} onChange={setView} modes={['cards', 'tree']} />

        <button
          type="button"
          onClick={toggleFilters}
          aria-pressed={filtersOpen}
          aria-label={filtersOpen ? 'Hide filters' : 'Show filters'}
          className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] text-[13px] font-medium border transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
            filtersOpen || activeFilterCount ? 'text-accent bg-accent-soft border-[color:var(--color-accent-line)]' : 'text-dim bg-surface border-[color:var(--color-border)] hover:text-text'
          }`}
        >
          <IconFilter size={15} />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="tnum tabular-nums min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold text-white inline-flex items-center justify-center" style={{ background: 'var(--gradient-accent)' }}>
              {activeFilterCount}
            </span>
          )}
        </button>

        <div className="flex-1 min-w-[220px] max-w-2xl">
          <CommandBar schema={schema} state={filters.state} applyState={filters.applyState}
            placeholder="Search coverages by name, code, status, or type…" />
        </div>

        {canEdit && <Button variant="primary" size="sm" onClick={() => setEditCov('new')}><IconPlus size={14} />Add coverage</Button>}
      </div>

      {coverages.length === 0 ? (
        <EmptyState icon={<IconCoverage size={32} />} title="No coverages yet"
          description={canEdit ? 'Add the first coverage to start building this product.' : undefined}
          action={canEdit ? <Button variant="primary" size="sm" onClick={() => setEditCov('new')}><IconPlus size={14} />Add coverage</Button> : undefined} />
      ) : (
        <div className={filtersOpen ? 'grid lg:grid-cols-[240px_1fr] gap-5 items-start' : 'block'}>
          {/* Secondary: collapsible filter rail. */}
          {filtersOpen && (
            <div className="lg:sticky lg:top-4 flex flex-col gap-2">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-faint">Refine</span>
                <button type="button" onClick={toggleFilters} aria-label="Hide filters"
                  className="w-6 h-6 rounded-[6px] flex items-center justify-center text-faint hover:text-text hover:bg-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                  <IconClose size={13} />
                </button>
              </div>
              <FacetPanel schema={schema} counts={filters.counts} state={filters.state} unknownValues={filters.unknownValues}
                onToggleEnum={filters.toggleEnum} onToggleParent={filters.toggleParent}
                onToggleChild={filters.toggleChild} onSetDateRange={filters.setDateRange} />
            </div>
          )}

          {/* Primary: search results / card grid. */}
          <div className="min-w-0 flex flex-col gap-3">
            <ActiveFilters chips={filters.activeChips} onRemove={filters.removeChip} onClearAll={filters.clearAll}
              resultCount={filtered.length} total={filters.total} />

            {filtered.length === 0 ? (
              <EmptyState icon={<IconSearch size={32} />} title="No coverages match these filters"
                description="Try clearing a filter or broadening your search." />
            ) : view === 'cards' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                {cards.map((cov, i) => {
                  const subs = subsByParent.get(cov.refId ?? '') ?? []
                  const isExpanded = expandedIds.has(cov.id)
                  const dimmed = false
                  return (
                    <Fragment key={cov.id}>
                      <div
                        className={`rise-in h-full transition-all duration-300 ${dimmed ? 'opacity-35 blur-[1px] pointer-events-none' : ''}`}
                        style={{ '--rise-delay': `${Math.min(i, 10) * 40}ms` } as React.CSSProperties}
                        aria-hidden={dimmed || undefined}
                      >
                        <CoverageHubCard
                          parentName={cov.parentId ? parentName(cov.parentId) : undefined}
                          subCount={subs.length}
                          expanded={isExpanded}
                          onToggleSubs={subs.length ? () => setExpandedIds(prev => { const n = new Set(prev); isExpanded ? n.delete(cov.id) : n.add(cov.id); return n }) : undefined}
                          {...hubProps(cov)}
                        />
                      </div>

                      {isExpanded && (
                        <div className="col-span-full facet-reveal">
                          <section
                            aria-label={`Sub-coverages of ${cov.name}`}
                            className="rounded-[16px] p-4 mt-0.5"
                            style={{ border: '1px solid var(--color-accent-line)', background: 'var(--color-raised)' }}
                          >
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <IconEndorsement size={15} className="text-accent shrink-0" />
                                <span className="text-[13px] font-semibold text-text truncate">Sub-coverages of {cov.name}</span>
                                <span className="tnum tabular-nums text-xs text-faint shrink-0">{subs.length}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setExpandedIds(prev => { const n = new Set(prev); n.delete(cov.id); return n })}
                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[8px] text-[12px] font-medium text-dim hover:text-text hover:bg-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                              >
                                <IconChevronDown size={13} className="rotate-180" />Collapse
                              </button>
                            </div>
                            {/* Tree: sub-coverages left-to-right, top-to-bottom, off a shared spine. */}
                            <div
                              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pl-3.5"
                              style={{ borderLeft: '2px solid var(--color-accent-line)' }}
                            >
                              {subs.map((sub, si) => (
                                <div key={sub.id} className="rise-in h-full" style={{ '--rise-delay': `${Math.min(si, 10) * 35}ms` } as React.CSSProperties}>
                                  <CoverageHubCard parentName={cov.name} {...hubProps(sub)} />
                                </div>
                              ))}
                            </div>
                          </section>
                        </div>
                      )}
                    </Fragment>
                  )
                })}
              </div>
            ) : (
              <CoverageTree coverages={filtered} canEdit={canEdit} onTile={onTile} onEdit={setEditCov} onDelete={onDelete} filterStates={selectedStates} />
            )}
          </div>
        </div>
      )}

      {/* Aspect editors */}
      {dialog?.kind === 'limits' && <TermOptionsDialog cov={dialog.cov} mode="LIMIT" filterStates={selectedStates} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'deductibles' && <TermOptionsDialog cov={dialog.cov} mode="DEDUCTIBLE" filterStates={selectedStates} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'options' && <TermOptionsDialog cov={dialog.cov} mode="OPTION" filterStates={selectedStates} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'states' && <CoverageStatesDialog cov={dialog.cov} onClose={() => setDialog(null)} />}
      {editCov !== null && <CoverageEditDialog cov={editCov === 'new' ? null : editCov} onClose={() => setEditCov(null)} />}

      {/* Delete confirmation — replaces the native window.confirm (A5) */}
      <Dialog open={!!deletePending} onClose={() => { if (!deleting) setDeletePending(null) }} title="Delete coverage" width="max-w-sm">
        <p className="text-sm text-dim mb-5">
          Delete <span className="font-semibold text-text">{deletePending?.name}</span>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDeletePending(null)} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={confirmDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
