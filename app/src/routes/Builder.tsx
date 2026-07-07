// Builder — the Drafts workbench. This is where products are AUTHORED: draft products
// live here (lifecycle ≠ LAUNCHED) and only leave for the published Products portfolio
// via an explicit, typed-confirmation promotion. Four grounded ways to start a draft —
// AI scaffold, import an ISO workbook, clone an existing product, or a blank shell —
// each captures provenance (lineage) that every draft then shows. A draft can never
// reach Products without promotion: Products renders only LAUNCHED, and the promote
// dialog is the sole surface that writes lifecycle:'LAUNCHED'.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { usePortfolioInventory } from '../lib/usePortfolioInventory'
import { Skeleton, EmptyState, RefChip, LifecyclePill } from '../components/ui'
import {
  IconSparkle, IconUpload, IconCopy, IconPlus, IconArrowUp, IconArrowRight,
  IconWand, IconCoverage, IconForm, type IconType,
} from '../components/ui/icons'
import { NewProductModal } from '../components/product/NewProductModal'
import { ImportWorkbookModal } from '../components/product/ImportWorkbookModal'
import { CloneProductModal } from '../components/product/CloneProductModal'
import { ScaffoldProductModal } from '../components/product/ScaffoldProductModal'
import { PromoteDraftDialog } from '../components/product/PromoteDraftDialog'
import { LineageBadge } from '../components/product/LineageBadge'
import type { Product } from '@pf/shared'
import type { WithId } from '../context/ProductContext'

type Modal = 'new' | 'import' | 'clone' | 'scaffold' | null

export default function Builder() {
  const navigate = useNavigate()
  const { user } = useUser()
  const canEdit  = user?.role === 'EDITOR' || user?.role === 'ADMIN'

  const [products, setProducts] = useState<WithId<Product>[]>([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState<Modal>(null)
  const [promoteFor, setPromoteFor] = useState<WithId<Product> | null>(null)

  useEffect(() => {
    const unsub = adapter.db.subscribe<WithId<Product>>('products', d => {
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

  const openDraft = (id: string) => { setModal(null); navigate(`/app/products/${id}/overview`) }

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StartCard featured Icon={IconSparkle} title="Scaffold with AI"
            desc="Describe it — grounded in your real portfolio, never invented." onClick={() => setModal('scaffold')} />
          <StartCard Icon={IconUpload} title="Import workbook"
            desc="Upload the ISO framework/forms/rating/rules workbooks." onClick={() => setModal('import')} />
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
                onOpen={() => navigate(`/app/products/${p.id}/overview`)}
                onPromote={() => setPromoteFor(p)}
              />
            ))}
          </div>
        )}
      </div>

      {modal === 'new'      && <NewProductModal onClose={() => setModal(null)} onCreated={openDraft} />}
      {modal === 'import'   && <ImportWorkbookModal onClose={() => setModal(null)} onImported={openDraft} />}
      {modal === 'clone'    && <CloneProductModal onClose={() => setModal(null)} onCloned={openDraft} />}
      {modal === 'scaffold' && <ScaffoldProductModal onClose={() => setModal(null)} onCreated={openDraft} />}
      {promoteFor && user && (
        <PromoteDraftDialog
          product={promoteFor}
          actor={{ uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }}
          onClose={() => setPromoteFor(null)}
          onPromoted={id => navigate(`/app/products/${id}/overview`)}
        />
      )}
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

// ─── Draft card ─────────────────────────────────────────────────────────────────

function DraftCard({ p, covCount, formCount, canEdit, onOpen, onPromote }: {
  p: WithId<Product>
  covCount?: number; formCount?: number
  canEdit: boolean
  onOpen: () => void; onPromote: () => void
}) {
  return (
    <div className="group relative bg-surface rounded-[16px] overflow-hidden flex flex-col"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      <span aria-hidden="true" className="block h-[3px] w-full opacity-70"
        style={{ background: 'linear-gradient(90deg, var(--color-accent-bright) 0%, var(--color-accent-strong) 55%, transparent 100%)' }} />
      <div className="p-5 flex flex-col gap-3 flex-1">
        <button onClick={onOpen} aria-label={`Open ${p.name}`}
          className="flex flex-col gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[8px]">
          <span className="font-semibold text-[15px] text-text leading-snug group-hover:text-accent transition-colors">{p.name}</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {p.refId && <RefChip id={p.refId} />}
            <LifecyclePill lifecycle={p.lifecycle} />
            {p.lob?.name && <span className="text-[11px] text-faint">{p.lob.name}</span>}
          </div>
        </button>

        {p.lineage && <LineageBadge lineage={p.lineage} />}

        <div className="flex items-center gap-3 text-xs text-dim pt-3 mt-auto" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="inline-flex items-center gap-1"><IconCoverage size={13} aria-hidden="true" />{covCount ?? '—'}</span>
          <span className="inline-flex items-center gap-1"><IconForm size={13} aria-hidden="true" />{formCount ?? '—'}</span>
          <span className="truncate">{p.owner?.name ?? '—'}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={onOpen}
              className="inline-flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-[7px] text-[11px] font-medium text-dim hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              Open <IconArrowRight size={12} aria-hidden="true" />
            </button>
            {canEdit && (
              <button onClick={onPromote} title={`Promote ${p.name} to the published portfolio`}
                className="inline-flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-[7px] text-[11px] font-medium text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                <IconArrowUp size={12} aria-hidden="true" />Promote
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
