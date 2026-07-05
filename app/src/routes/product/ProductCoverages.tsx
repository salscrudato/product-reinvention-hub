// Coverages — the product's coverages as a browsable collection (cards ⇄ list).
// Every coverage is a hub whose tiles drill into focused editors: Limits and
// Deductibles (typed standard options), States (US map), and the Forms/Pricing/
// Rules tabs — filtered to that coverage so the relationships stay navigable both
// ways. Create / edit / delete keep the hierarchy consistent.
import { useMemo, useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { toast } from 'sonner'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Button, Skeleton, EmptyState, ViewToggle, type ViewMode } from '../../components/ui'
import { IconPlus, IconSearch, IconCoverage } from '../../components/ui/icons'
import { CoverageHubCard } from '../../components/product/CoverageHubCard'
import { CoverageRow } from '../../components/product/CoverageRow'
import { BaseFormExtract } from '../../components/product/BaseFormExtract'
import type { CoverageAspect } from '../../components/product/coverageAspects'
import { TermOptionsDialog } from '../../components/product/TermOptionsDialog'
import { CoverageStatesDialog } from '../../components/product/CoverageStatesDialog'
import { CoverageEditDialog } from '../../components/product/CoverageEditDialog'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const VIEW_KEY = 'pf.coverages.view'
const byOrder = (a: WithId<Coverage>, b: WithId<Coverage>) => (a.order ?? 0) - (b.order ?? 0)

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[.09em] text-faint">{label}</h3>
      <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
      <span className="text-[11px] text-faint tnum">{count}</span>
    </div>
  )
}

export default function ProductCoverages() {
  const { pid, product, coverages, loading } = useProductCtx()
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) || 'cards')
  const setViewPersist = (m: ViewMode) => { setView(m); localStorage.setItem(VIEW_KEY, m) }
  const [query, setQuery] = useState('')

  // Aspect editors (dialogs) + coverage create/edit.
  const [dialog, setDialog] = useState<{ kind: 'limits' | 'deductibles' | 'states'; cov: WithId<Coverage> } | null>(null)
  const [editCov, setEditCov] = useState<WithId<Coverage> | 'new' | null>(null)

  const fuse = useMemo(() => new Fuse(coverages, { keys: ['name', 'refId', 'claimsBasis'], threshold: 0.4 }), [coverages])
  const filtered = query ? fuse.search(query).map(r => r.item) : coverages
  const roots = filtered.filter(c => !c.parentId).sort(byOrder)
  const endorsements = filtered.filter(c => c.parentId).sort(byOrder)
  const parentName = (refId?: string | null) => coverages.find(c => c.refId === refId)?.name

  // A deep link (?cov=<id|refId>) auto-opens that coverage's Limits editor once,
  // after coverages have loaded (guarded so closing it doesn't reopen).
  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current) return
    const target = params.get('cov')
    if (!target || !coverages.length) return
    const cov = coverages.find(c => c.id === target || c.refId === target)
    if (cov) { setDialog({ kind: 'limits', cov }); deepLinkDone.current = true }
  }, [coverages, params])

  function onTile(aspect: CoverageAspect, cov: WithId<Coverage>) {
    if (aspect === 'limits' || aspect === 'deductibles' || aspect === 'states') setDialog({ kind: aspect, cov })
    else navigate(`/app/products/${pid}/${aspect}?cov=${encodeURIComponent(cov.refId ?? cov.id)}`)
  }

  async function onDelete(cov: WithId<Coverage>) {
    if (!canEdit) return
    const children = coverages.filter(c => c.parentId === cov.refId)
    if (children.length) { toast.error(`Reassign or remove its ${children.length} endorsement${children.length === 1 ? '' : 's'} first.`); return }
    if (!window.confirm(`Delete "${cov.name}"? This cannot be undone.`)) return
    try {
      await adapter.db.mutate({ op: 'delete', path: `products/${pid}/coverages/${cov.id}`, entityType: 'coverage', productId: pid, actor })
      toast.success('Coverage deleted')
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — please refresh.' : err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const hubProps = (cov: WithId<Coverage>) => ({ cov, canEdit, onTile, onEdit: setEditCov, onDelete })

  if (loading) return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-44 rounded-[16px]" />)}
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-dim tnum shrink-0">{coverages.length} coverage{coverages.length === 1 ? '' : 's'}</span>
        <div className="relative flex-1 min-w-[200px]">
          <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search coverages by name or code…"
            className="w-full h-9 pl-9 pr-3 rounded-[9px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent" />
        </div>
        <ViewToggle mode={view} onChange={setViewPersist} />
        {product && <BaseFormExtract product={product} coverages={coverages} canEdit={canEdit} actor={actor} />}
        {canEdit && <Button variant="primary" size="sm" onClick={() => setEditCov('new')}><IconPlus size={14} />Add coverage</Button>}
      </div>

      {coverages.length === 0 ? (
        <EmptyState icon={<IconCoverage size={32} />} title="No coverages yet"
          description={canEdit ? 'Add the first coverage to start building this product.' : undefined}
          action={canEdit ? <Button variant="primary" size="sm" onClick={() => setEditCov('new')}><IconPlus size={14} />Add coverage</Button> : undefined} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<IconSearch size={32} />} title={`No coverages match "${query}"`} />
      ) : (
        <div className="flex flex-col gap-6">
          {roots.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader label="Coverages" count={roots.length} />
              {view === 'cards' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {roots.map(cov => <CoverageHubCard key={cov.id} {...hubProps(cov)} />)}
                </div>
              ) : (
                <div className="rounded-[14px] overflow-hidden bg-surface" style={{ border: '1px solid var(--color-border)' }}>
                  {roots.map(cov => <CoverageRow key={cov.id} {...hubProps(cov)} />)}
                </div>
              )}
            </section>
          )}

          {endorsements.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader label="Endorsements" count={endorsements.length} />
              {view === 'cards' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {endorsements.map(cov => <CoverageHubCard key={cov.id} parentName={parentName(cov.parentId)} {...hubProps(cov)} />)}
                </div>
              ) : (
                <div className="rounded-[14px] overflow-hidden bg-surface" style={{ border: '1px solid var(--color-border)' }}>
                  {endorsements.map(cov => <CoverageRow key={cov.id} isEndorsement {...hubProps(cov)} />)}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Aspect editors */}
      {dialog?.kind === 'limits' && <TermOptionsDialog cov={dialog.cov} mode="LIMIT" onClose={() => setDialog(null)} />}
      {dialog?.kind === 'deductibles' && <TermOptionsDialog cov={dialog.cov} mode="DEDUCTIBLE" onClose={() => setDialog(null)} />}
      {dialog?.kind === 'states' && <CoverageStatesDialog cov={dialog.cov} onClose={() => setDialog(null)} />}
      {editCov !== null && <CoverageEditDialog cov={editCov === 'new' ? null : editCov} onClose={() => setEditCov(null)} />}
    </div>
  )
}
