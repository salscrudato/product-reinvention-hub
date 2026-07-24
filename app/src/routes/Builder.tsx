// Builder — the Drafts workbench. This is where products are AUTHORED: draft products
// live here (lifecycle ≠ LAUNCHED) and only leave for the published Products portfolio
// via an explicit, typed-confirmation promotion. Four grounded ways to start a draft —
// AI scaffold, import (any format: XLSX, PDF, SERFF auto-detected by magic bytes),
// clone an existing product, or a blank shell — each captures provenance (lineage) that
// every draft then shows. A draft can never reach Products without promotion.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { usePortfolioInventory } from '../lib/usePortfolioInventory'
import { Skeleton, EmptyState, Button } from '../components/ui'
import {
  IconUpload, IconCopy, IconPlus, IconWand, type IconType,
} from '../components/ui/icons'
import { DraftCard, type DraftRow } from '../components/builder/DraftCard'
import { draftTitle } from '../components/builder/draftPresentation'
import { canI } from '../lib/canI'

const BuilderChat       = lazy(() => import('../components/builder/BuilderChat').then(m => ({ default: m.BuilderChat })))
const NewProductModal   = lazy(() => import('../components/product/NewProductModal').then(m => ({ default: m.NewProductModal })))
const UnifiedImportModal = lazy(() => import('../import/UnifiedImportModal').then(m => ({ default: m.UnifiedImportModal })))
const CloneProductModal  = lazy(() => import('../components/product/CloneProductModal').then(m => ({ default: m.CloneProductModal })))
const ScaffoldProductModal = lazy(() => import('../components/product/ScaffoldProductModal').then(m => ({ default: m.ScaffoldProductModal })))
const PromoteDraftDialog = lazy(() => import('../components/product/PromoteDraftDialog').then(m => ({ default: m.PromoteDraftDialog })))
const DeleteDraftDialog  = lazy(() => import('../components/product/DeleteDraftDialog').then(m => ({ default: m.DeleteDraftDialog })))

type Modal = 'new' | 'unified' | 'clone' | 'scaffold' | null

export default function Builder() {
  const navigate = useNavigate()
  const { user } = useUser()
  const canEdit  = canI(user, 'product:write')

  const [products, setProducts] = useState<DraftRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState<Modal>(null)
  const [promoteFor, setPromoteFor] = useState<DraftRow | null>(null)
  const [deleteFor, setDeleteFor]   = useState<DraftRow | null>(null)
  const [clearPhase, setClearPhase] = useState<'idle' | 'confirm' | 'running'>('idle')

  const handleClearAll = async () => {
    if (clearPhase === 'idle') { setClearPhase('confirm'); return }
    if (clearPhase !== 'confirm') return
    setClearPhase('running')
    try {
      const r = await adapter.db.clearProducts('CLEAR_ALL_PRODUCTS')
      toast.success(`Cleared ${r.products} product${r.products !== 1 ? 's' : ''} (${r.deleted} entities deleted)`)
    } catch (e) {
      toast.error(`Clear failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setClearPhase('idle')
    }
  }

  useEffect(() => {
    const unsub = adapter.db.subscribe<DraftRow>('products', d => {
      if (Array.isArray(d)) { setProducts(d); setLoading(false) }
    })
    return unsub
  }, [])

  // Drafts = everything not yet launched, newest-looking first (drafts sort after
  // launched everywhere else, so here we just show the non-launched set).
  const drafts = useMemo(
    () => products.filter(p => p.lifecycle !== 'LAUNCHED').sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  )
  const inventory = usePortfolioInventory(drafts, drafts.length > 0)

  const openDraft = (id: string) => { setModal(null); navigate(`/app/builder/${id}/overview`) }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-text">Builder</h1>
        <p className="text-sm text-dim mt-0.5">
          Draft products live here — author them, then promote to the published portfolio.
          <span className="tnum"> {drafts.length} draft{drafts.length !== 1 ? 's' : ''}.</span>
        </p>
      </div>

      {/* Start a draft — four grounded entry points (author-only) */}
      {canEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <StartCard featured Icon={IconUpload} title="Import"
            desc="ISO workbook (XLSX), filing PDF, SERFF, or ERC — auto-detected by content." onClick={() => setModal('unified')} />
          <StartCard Icon={IconCopy} title="Clone a product"
            desc="Start from an existing product's structure." onClick={() => setModal('clone')} />
          <StartCard Icon={IconPlus} title="Blank draft"
            desc="A fresh shell with the standard task set." onClick={() => setModal('new')} />
        </div>
      )}

      {/* Drafts */}
      <div className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[.07em] text-dim">Drafts in progress</h2>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-44 rounded-[16px]" />)}
          </div>
        ) : drafts.length === 0 ? (
          <EmptyState icon={<IconWand size={30} />} title="No drafts yet"
            description={canEdit ? 'Start one above — scaffold with AI, import a workbook, clone a product, or begin blank.' : 'Drafts appear here once an editor starts one.'} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {drafts.map(p => (
              <DraftCard
                key={p.id} p={p}
                covCount={inventory.byProduct.get(p.id)?.coverages.length}
                formCount={inventory.byProduct.get(p.id)?.forms.length}
                canEdit={canEdit}
                onOpen={() => navigate(`/app/builder/${p.id}/overview`)}
                onPromote={() => setPromoteFor(p)}
                onDelete={() => setDeleteFor(p)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Danger zone — clear all products (dev/admin reset) */}
      {canEdit && (
        <div className="mt-4 border border-[var(--color-border)] rounded-xl p-4 flex flex-col gap-2"
          style={{ borderColor: clearPhase === 'confirm' ? 'var(--color-danger, #e53e3e)' : undefined }}>
          <p className="text-xs font-semibold uppercase tracking-wide text-dim">Danger zone</p>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium text-text">Delete all products</p>
              <p className="text-xs text-dim">
                {clearPhase === 'confirm'
                  ? 'This will permanently delete every product and all its data. Click again to confirm.'
                  : 'Permanently removes every product, coverage, form, rule, and rating program in this workspace. Cannot be undone.'}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {clearPhase === 'confirm' && (
                <Button variant="ghost" size="sm" onClick={() => setClearPhase('idle')}>
                  Cancel
                </Button>
              )}
              <Button
                variant={clearPhase === 'confirm' ? 'destructive' : 'default'}
                size="sm"
                onClick={handleClearAll}
                disabled={clearPhase === 'running'}
              >
                {clearPhase === 'running' ? 'Deleting…' : clearPhase === 'confirm' ? 'Yes, delete all' : 'Delete all products'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        {modal === 'new'      && <NewProductModal onClose={() => setModal(null)} onCreated={openDraft} />}
        {modal === 'unified'  && <UnifiedImportModal onClose={() => setModal(null)} onImported={openDraft} />}
        {modal === 'clone'    && <CloneProductModal onClose={() => setModal(null)} onCloned={openDraft} />}
        {modal === 'scaffold' && <ScaffoldProductModal onClose={() => setModal(null)} onCreated={openDraft} />}
        {promoteFor && user && (
          <PromoteDraftDialog
            product={promoteFor}
            actor={{ uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }}
            onClose={() => setPromoteFor(null)}
            onPromoted={id => navigate(`/app/products?view=cards&promoted=${encodeURIComponent(id)}`)}
          />
        )}
        {deleteFor && user && (
          <DeleteDraftDialog
            product={{ id: deleteFor.id, name: draftTitle(deleteFor), lifecycle: deleteFor.lifecycle }}
            counts={{
              coverages: inventory.byProduct.get(deleteFor.id)?.coverages.length,
              forms:     inventory.byProduct.get(deleteFor.id)?.forms.length,
            }}
            actor={{ uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }}
            onClose={() => setDeleteFor(null)}
            onDeleted={() => setDeleteFor(null)}
          />
        )}
        <BuilderChat />
      </Suspense>
    </div>
  )
}

// ─── Start card ─────────────────────────────────────────────────────────────────

function StartCard({ Icon, title, desc, onClick, featured }: {
  Icon: IconType; title: string; desc: string; onClick: () => void; featured?: boolean
}) {
  return (
    <button
      type="button" onClick={onClick}
      className={`group flex flex-col items-start gap-2 p-4 rounded-[14px] text-left transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        featured ? 'text-white' : 'bg-surface hover:shadow-[var(--shadow-card-hover)]'}`}
      style={featured
        ? { background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-card)' }
        : { border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <span className={`flex items-center justify-center w-9 h-9 rounded-[10px] ${featured ? 'bg-white/20' : 'bg-accent-soft text-accent'}`}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className={`text-sm font-semibold ${featured ? 'text-white' : 'text-text'}`}>{title}</span>
      <span className={`text-xs leading-snug ${featured ? 'text-white/85' : 'text-dim'}`}>{desc}</span>
    </button>
  )
}

// The draft card itself lives in components/builder/DraftCard.tsx (P3) — identity,
// labeled telemetry, readiness lights, armed Promote, and the overflow kebab.
