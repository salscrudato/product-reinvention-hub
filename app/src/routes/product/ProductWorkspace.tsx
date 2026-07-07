// Product workspace — loads product context, renders hero header + tab outlet.
import { useParams, useNavigate, useLocation, Outlet, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ProductProvider } from '../../context/ProductContext'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter } from '../../lib/backend'
import { Skeleton, StatusPill, LifecyclePill, Badge, Button } from '../../components/ui'
import { IconRecent, IconChat, IconUsers, IconBack, IconChevronDown, IconArrowUp, IconShare } from '../../components/ui/icons'
import { computeProductFindings, healthScore, healthColor } from '../../lib/productHealth'
import { HistoryDrawer } from '../../components/product/HistoryDrawer'
import { CommentsPanel } from '../../components/product/CommentsPanel'
import { ExportMenu } from '../../components/product/ExportMenu'
import { PromoteDraftDialog } from '../../components/product/PromoteDraftDialog'
import { LineageBadge } from '../../components/product/LineageBadge'
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
  const { pid, product, coverages, rules, formRules, forms, ldTables, rtTables, ratingProgram, loading } = useProductCtx()
  const navigate     = useNavigate()
  const { pathname } = useLocation()
  const { user }     = useUser()
  const canEdit      = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const activeTab    = TABS.find(t => pathname.includes(t.id))?.id ?? 'overview'
  const [historyOpen, setHistoryOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [viewers, setViewers] = useState<string[]>([])
  const [siblings, setSiblings] = useState<{ id: string; name: string }[]>([])

  // Presence
  useEffect(() => {
    const leavePresence = adapter.presence.join(pid)
    // Dedupe by uid — one avatar per person even with multiple open tabs/sessions.
    const unwatch = adapter.presence.watch(pid, uids => setViewers([...new Set(uids)]))
    return () => { leavePresence(); unwatch() }
  }, [pid])

  // Sibling products — powers the "switch product" control in the back bar so a PM
  // can hop between products without returning to the hub first.
  useEffect(() => {
    const unsub = adapter.db.subscribe<{ id: string; name: string }>('products', (d) => {
      if (Array.isArray(d)) setSiblings(d.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)))
    })
    return unsub
  }, [])

  async function handleShare() {
    if (!user || (user.role !== 'EDITOR' && user.role !== 'ADMIN')) {
      toast.error('EDITOR or ADMIN role required to create share links.')
      return
    }
    setSharing(true)
    try {
      const { shareId } = await adapter.fns.call<{ productId: string }, { shareId: string }>(
        'createShare', { productId: pid },
      )
      const url = `${location.origin}/share/${shareId}`
      await navigator.clipboard.writeText(url)
      toast.success('Share link copied to clipboard')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create share link')
    } finally {
      setSharing(false)
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

  if (!product) return <Navigate to="/app/products" replace />

  // Readiness pill — same source as the Overview finding banner, so they agree.
  const findings = computeProductFindings({ pid, coverages, rules, ratingProgram, ldTables, rtTables, formRules })
  const score  = healthScore(findings)
  const hColor = healthColor(score)

  return (
    <div className="flex flex-col gap-0">
      {/* Hero header */}
      <div
        className="rounded-[16px] p-6 mb-5 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, rgba(139,31,224,.08) 0%, rgba(122,0,230,.06) 100%)', border: '1px solid var(--color-border)' }}
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

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusPill status={product.status} />
                <LifecyclePill lifecycle={product.lifecycle} />
                {product.lob?.name && <Badge label={product.lob.name} color="blue" />}
                <span
                  className="inline-flex items-center gap-1.5 rounded-full pl-2 pr-2.5 py-0.5 text-xs font-medium tnum"
                  style={{ background: `color-mix(in srgb, ${hColor} 12%, transparent)`, color: hColor }}
                  title={findings.length ? `${findings.length} readiness finding${findings.length !== 1 ? 's' : ''}` : 'No issues found'}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: hColor }} aria-hidden="true" />
                  {score}{findings.length ? ` · ${findings.length} finding${findings.length !== 1 ? 's' : ''}` : ' · Healthy'}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-text">{product.name}</h1>
              <div className="flex items-center gap-2 flex-wrap">
                {product.refId && (
                  <span className="text-sm font-mono text-dim">{product.refId}</span>
                )}
                {product.lineage && <LineageBadge lineage={product.lineage} />}
              </div>
              <p className="text-sm text-dim mt-1">
                {coverages.length} coverage{coverages.length !== 1 ? 's' : ''}
                {' · '}{product.states?.length ?? 0} state{(product.states?.length ?? 0) !== 1 ? 's' : ''}
                {' · '}{product.marketSegment}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Presence avatars */}
              {viewers.length > 0 && (
                <div className="flex items-center gap-1 mr-2">
                  <IconUsers size={12} className="text-faint" aria-hidden="true" />
                  <div className="flex -space-x-1">
                    {viewers.slice(0,4).map((uid, i) => (
                      <div key={uid} className="w-6 h-6 rounded-full bg-accent-soft border-2 border-surface flex items-center justify-center text-[9px] font-bold text-accent" title={uid}>
                        {String.fromCharCode(65 + i)}
                      </div>
                    ))}
                    {viewers.length > 4 && <div className="w-6 h-6 rounded-full bg-raised border-2 border-surface flex items-center justify-center text-[9px] text-dim">+{viewers.length-4}</div>}
                  </div>
                </div>
              )}
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
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => void handleShare()} disabled={sharing}>
                  <IconShare size={14} aria-hidden="true" />{sharing ? 'Sharing…' : 'Share'}
                </Button>
              )}
              <ExportMenu data={{ product, coverages, rules, forms, ldTables, rtTables, ratingProgram }} />
            </div>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-0 mb-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => navigate(`/app/products/${pid}/${tab.id}`)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              activeTab === tab.id
                ? 'text-accent border-accent'
                : 'text-dim border-transparent hover:text-text hover:border-[rgba(19,19,26,.2)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pt-5">
        <Outlet />
      </div>

      {historyOpen  && <HistoryDrawer  onClose={() => setHistoryOpen(false)}  entityPath={`products/${pid}`} />}
      {commentsOpen && <CommentsPanel  onClose={() => setCommentsOpen(false)} entityPath={`products/${pid}`} />}
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
