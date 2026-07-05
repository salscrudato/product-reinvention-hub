// Product workspace — loads product context, renders hero header + tab outlet.
import { useParams, useNavigate, useLocation, Outlet, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ProductProvider } from '../../context/ProductContext'
import { useProductCtx } from '../../context/useProductCtx'
import { adapter } from '../../lib/backend'
import { Skeleton, StatusPill, LifecyclePill, Badge, Button } from '../../components/ui'
import { IconShare, IconRecent, IconChat, IconUsers } from '../../components/ui/icons'
import { computeProductFindings, healthScore, healthColor } from '../../lib/productHealth'
import { HistoryDrawer } from '../../components/product/HistoryDrawer'
import { CommentsPanel } from '../../components/product/CommentsPanel'
import { ShareModal } from '../../components/product/ShareModal'
import { ExportMenu } from '../../components/product/ExportMenu'

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
  const activeTab    = TABS.find(t => pathname.includes(t.id))?.id ?? 'overview'
  const [historyOpen, setHistoryOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [shareOpen,    setShareOpen]    = useState(false)
  const [viewers, setViewers] = useState<string[]>([])

  // Presence
  useEffect(() => {
    const leavePresence = adapter.presence.join(pid)
    // Dedupe by uid — one avatar per person even with multiple open tabs/sessions.
    const unwatch = adapter.presence.watch(pid, uids => setViewers([...new Set(uids)]))
    return () => { leavePresence(); unwatch() }
  }, [pid])

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
              {product.refId && (
                <span className="text-sm font-mono text-dim">{product.refId}</span>
              )}
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
              <Button variant="ghost" size="sm" onClick={() => setCommentsOpen(true)}>
                <IconChat size={14} aria-hidden="true" />Comments
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                <IconRecent size={14} aria-hidden="true" />History
              </Button>
              <ExportMenu data={{ product, coverages, rules, forms, ldTables, rtTables, ratingProgram }} />
              <Button variant="ghost" size="sm" onClick={() => setShareOpen(true)}>
                <IconShare size={14} aria-hidden="true" />Share
              </Button>
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
      {shareOpen    && <ShareModal     onClose={() => setShareOpen(false)}    productId={pid} productName={product.name} />}
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
