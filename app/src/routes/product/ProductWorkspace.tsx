// Product workspace — loads product context, renders hero header + tab outlet.
import { useParams, useNavigate, useLocation, Outlet, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ProductProvider } from '../../context/ProductContext'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { useCapture } from '../../context/useCapture'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { Skeleton, ProductStatusPill, Badge, Button, EmptyState } from '../../components/ui'
import { IconRecent, IconChat, IconBack, IconChevronDown, IconArrowUp, IconEdit, IconCheck, IconClose, IconRefresh, IconProduct } from '../../components/ui/icons'
import { HistoryDrawer } from '../../components/product/HistoryDrawer'
import { HeroGlyph, type HeroGlyphName } from '../../components/ui/heroGlyphs'
import { GlobalCommandBar } from '../../features/search/GlobalCommandBar'
import { CommentsPanel } from '../../components/product/CommentsPanel'
import { ExportMenu } from '../../components/product/ExportMenu'
import { PromoteDraftDialog } from '../../components/product/PromoteDraftDialog'
import { LineageBadge } from '../../components/product/LineageBadge'
import { PresenceAvatars } from '../../components/product/PresenceAvatars'
import { ConflictDiffDialog } from '../../components/product/ConflictDiffDialog'
import { toast } from 'sonner'

const TABS = [
  { id: 'overview',  label: 'Overview'  },
  { id: 'coverages', label: 'Coverages' },
  { id: 'forms',     label: 'Forms'     },
  { id: 'pricing',   label: 'Pricing'   },
  { id: 'states',    label: 'States'    },
  { id: 'rules',     label: 'Rules'     },
]

function WorkspaceInner() {
  const { pid, product, coverages, rules, formRules, forms, ldTables, rtTables, ratingProgram, loading, error, retry } = useProductCtx()
  const navigate     = useNavigate()
  const { pathname } = useLocation()
  const { user }     = useUser()
  const canEdit      = canI(user, 'product:write')
  const activeTab    = TABS.find(t => pathname.includes(t.id))?.id ?? 'overview'
  const [historyOpen, setHistoryOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [conflictCtx, setConflictCtx] = useState<{ path: string; localData: Record<string, unknown> } | null>(null)
  const [siblings, setSiblings] = useState<{ id: string; name: string }[]>([])
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const { setBase } = useCapture()
  const tabLabel = TABS.find(t => t.id === activeTab)?.label ?? 'Overview'

  // Sibling products — powers the "switch product" control in the back bar so a PM
  // can hop between products without returning to the hub first.
  useEffect(() => {
    const unsub = adapter.db.subscribe<{ id: string; name: string }>('products', (d) => {
      if (Array.isArray(d)) setSiblings(d.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)))
    })
    return unsub
  }, [])

  // Publish the product + active tab as the feedback drawer's DEFAULT context, so ⌘. anywhere
  // in this workspace auto-links to the real product entity + its refId (from ProductContext).
  // Detail surfaces refine this with a specific entity via setFocus; cleared when we unmount.
  useEffect(() => {
    if (!product) return
    setBase({ entityPath: `products/${pid}`, refId: product.refId ?? undefined, label: `${product.name} · ${tabLabel}` })
    return () => setBase(null)
  }, [pid, product?.refId, product?.name, tabLabel, setBase, product])

  // Inline product rename — optimistic-locked through the adapter (atomic mutate).
  async function saveName() {
    const name = nameDraft.trim()
    if (!name || !user || name === product?.name) { setEditingName(false); return }
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}`, data: { name },
        entityType: 'product', productId: pid,
        actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        expectedRev: (product as { rev?: number }).rev,
      })
      toast.success('Product renamed')
      setEditingName(false)
    } catch (err) {
      if (err instanceof MutationConflictError && err.conflictPath && err.localData) {
        setConflictCtx({ path: err.conflictPath, localData: err.localData })
        setEditingName(false)
      } else if (err instanceof MutationConflictError) {
        conflictToast({ discard: () => setEditingName(false) })
      } else {
        toast.error('Rename failed')
      }
    }
  }

  if (loading && !product) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 rounded-[16px]" /><Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-[16px]" />
      </div>
    )
  }

  // A listener error (permission / offline) on the product doc — recoverable, not a redirect.
  if (error && !product) {
    return (
      <EmptyState
        icon={<IconProduct size={32} />}
        title="Couldn't load this product"
        description="Check your connection or permissions and try again."
        action={
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={retry}><IconRefresh size={14} />Retry</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/app/products')}><IconBack size={14} />Products</Button>
          </div>
        }
      />
    )
  }

  if (!product) return <Navigate to="/app/products" replace />

  return (
    <div className="flex flex-col gap-0">
      {/* Hero header */}
      <div
        className="rounded-[16px] p-6 mb-5 relative overflow-hidden"
        style={{ background: 'var(--gradient-hero)', border: '1px solid var(--color-border)' }}
      >
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl opacity-30"
            style={{ background: 'radial-gradient(circle, var(--color-accent), var(--color-accent-strong))' }} />
        </div>

        <div className="relative">
          {/* Back bar — consistent on every detail tab: return to the hub, or jump
              straight to a sibling product without going back first. */}
          <div className="flex items-center gap-2 mb-4 text-sm">
            <button onClick={() => navigate('/app/products')}
              className="inline-flex items-center gap-1.5 -ml-1.5 px-1.5 py-1 rounded-[7px] text-dim hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <IconBack size={15} aria-hidden="true" /> Products
            </button>
            <span className="text-faint" aria-hidden="true">/</span>
            <div className="relative">
              <label htmlFor="pf-sibling-switch" className="sr-only">Switch to another product</label>
              <select id="pf-sibling-switch" value={pid}
                onChange={e => { if (e.target.value !== pid) navigate(`/app/products/${e.target.value}/${activeTab}`) }}
                className="max-w-[280px] h-8 pl-2.5 pr-8 rounded-[8px] bg-surface border border-border-strong text-sm font-medium text-text truncate appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/25">
                {(siblings.length ? siblings : [{ id: pid, name: product.name }]).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <IconChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
            <HeroGlyph name={activeTab as HeroGlyphName} size={56} className="hero-bob-slow mt-0.5" />
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <ProductStatusPill lifecycle={product.lifecycle} />
                {product.lob?.name && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint">LOB</span>
                    <Badge label={product.lob.name} color="blue" />
                  </span>
                )}
              </div>
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setEditingName(false) }}
                    aria-label="Product name"
                    className="text-2xl font-bold text-text bg-surface rounded-[8px] px-2 py-0.5 min-w-[280px] focus:outline-none focus:ring-2 focus:ring-accent/25"
                    style={{ border: '1px solid var(--color-border-strong)' }}
                  />
                  <button onClick={() => void saveName()} title="Save name" aria-label="Save name"
                    className="w-8 h-8 rounded-[8px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}>
                    <IconCheck size={15} aria-hidden="true" />
                  </button>
                  <button onClick={() => setEditingName(false)} title="Cancel" aria-label="Cancel rename"
                    className="w-8 h-8 rounded-[8px] flex items-center justify-center text-faint hover:text-text hover:bg-hover shrink-0">
                    <IconClose size={15} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="group/name flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-text">{product.name}</h1>
                  {canEdit && (
                    <button onClick={() => { setNameDraft(product.name); setEditingName(true) }}
                      title="Rename product" aria-label="Rename product"
                      className="opacity-0 group-hover/name:opacity-100 focus:opacity-100 transition-opacity w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                      <IconEdit size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
              {product.lineage && (
                <div className="flex items-center gap-2 flex-wrap">
                  <LineageBadge lineage={product.lineage} />
                </div>
              )}
              <p className="text-sm text-dim mt-1">
                {coverages.length} coverage{coverages.length !== 1 ? 's' : ''}
                {' · '}{product.states?.length ?? 0} state{(product.states?.length ?? 0) !== 1 ? 's' : ''}
                {' · '}{product.marketSegment}
              </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <PresenceAvatars pid={pid} />
              {product.lifecycle !== 'LAUNCHED' && canEdit && (
                <Button variant="primary" size="sm" onClick={() => setPromoteOpen(true)}>
                  <IconArrowUp size={14} aria-hidden="true" />Promote
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setCommentsOpen(true)}>
                <IconChat size={14} aria-hidden="true" />Comments
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                <IconRecent size={14} aria-hidden="true" />History
              </Button>
              <ExportMenu data={{ product, coverages, rules, formRules, forms, ldTables, rtTables, ratingProgram }} />
            </div>
          </div>
        </div>
      </div>

      {/* Tab strip — horizontally scrollable on mobile so all tabs stay accessible */}
      <div className="flex gap-0 mb-0 overflow-x-auto scrollbar-none" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => navigate(`/app/products/${pid}/${tab.id}`)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              activeTab === tab.id
                ? 'text-accent border-accent'
                : 'text-dim border-transparent hover:text-text hover:border-[var(--color-border-hover)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Global cross-entity command bar — searches Coverages + Forms + Rules together.
          Shown only on the in-scope tabs (the others are out of scope for search). */}
      {(activeTab === 'coverages' || activeTab === 'forms' || activeTab === 'rules') && (
        <div className="pt-4">
          <GlobalCommandBar pid={pid} rules={rules} coverages={coverages} forms={forms} />
        </div>
      )}

      {/* Tab content */}
      <div className="pt-5">
        <Outlet />
      </div>

      {historyOpen  && <HistoryDrawer  onClose={() => setHistoryOpen(false)}  entityPath={`products/${pid}`} />}
      {commentsOpen && <CommentsPanel  onClose={() => setCommentsOpen(false)} entityPath={`products/${pid}`} />}
      {conflictCtx && (
        <ConflictDiffDialog
          path={conflictCtx.path}
          localData={conflictCtx.localData}
          onClose={() => setConflictCtx(null)}
        />
      )}
      {promoteOpen && user && (
        <PromoteDraftDialog
          product={product}
          actor={{ uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }}
          onClose={() => setPromoteOpen(false)}
          onPromoted={() => setPromoteOpen(false)}
        />
      )}
    </div>
  )
}

export default function ProductWorkspace() {
  const { id } = useParams<{ id: string }>()
  if (!id) return <Navigate to="/app/products" replace />
  return (
    <ProductProvider pid={id}>
      <WorkspaceInner />
    </ProductProvider>
  )
}
