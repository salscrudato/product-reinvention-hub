// Builder — the Drafts workbench. This is where products are AUTHORED: draft products
// live here (lifecycle ≠ LAUNCHED) and only leave for the published Products portfolio
// via an explicit, typed-confirmation promotion. Four grounded ways to start a draft —
// AI scaffold, import (any format: XLSX, PDF, SERFF auto-detected by magic bytes),
// clone an existing product, or a blank shell — each captures provenance (lineage) that
// every draft then shows. A draft can never reach Products without promotion.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { usePortfolioInventory } from '../lib/usePortfolioInventory'
import { Skeleton, EmptyState, Button } from '../components/ui'
import {
  IconUpload, IconCopy, IconPlus, IconWand, IconChat, IconChevronDown, IconCheck, type IconType,
} from '../components/ui/icons'
import { NewProductModal } from '../components/product/NewProductModal'
import { UnifiedImportModal } from '../import/UnifiedImportModal'
import { CloneProductModal } from '../components/product/CloneProductModal'
import { ScaffoldProductModal } from '../components/product/ScaffoldProductModal'
import { PromoteDraftDialog } from '../components/product/PromoteDraftDialog'
import { DeleteDraftDialog } from '../components/product/DeleteDraftDialog'
import { DraftCard, type DraftRow } from '../components/builder/DraftCard'
import { draftTitle } from '../components/builder/draftPresentation'
import { ChatComposer } from '../components/chat/ChatComposer'
import { StreamRenderer } from '../components/ai/StreamRenderer'
import { WaveformLoader } from '../components/ai/WaveformLoader'
import { canI } from '../lib/canI'

type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool'; name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'notice'; level: string; message: string }
  | { t: 'json'; key: string; value: unknown }
  | { t: 'error'; message: string }
  | { t: 'done' }

interface ToolChip { name: string; done: boolean; summary?: string }
interface ChatMessage { role: 'user' | 'assistant'; text: string; tools: ToolChip[] }

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

  // ── Chat panel ──────────────────────────────────────────────────────────────
  const [chatOpen,    setChatOpen]    = useState(false)
  const [messages,    setMessages]    = useState<ChatMessage[]>([])
  const [chatInput,   setChatInput]   = useState('')
  const [streaming,   setStreaming]   = useState(false)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const abortRef   = useRef<AbortController | null>(null)
  const textBufRef = useRef('')
  const rafRef     = useRef<number | null>(null)
  const [sessionId] = useState(() => `s_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`)

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])

  async function ask(text: string) {
    const q = text.trim()
    if (!q || streaming) return
    setChatInput('')
    const history: ChatMessage[] = [...messages, { role: 'user', text: q, tools: [] }]
    setMessages([...history, { role: 'assistant', text: '', tools: [] }])
    setStreaming(true)
    textBufRef.current = ''

    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages(prev => { const n = [...prev]; const i = n.length - 1; if (i >= 0 && n[i]!.role === 'assistant') n[i] = fn(n[i]!); return n })

    abortRef.current?.abort()
    const ctrl = new AbortController(); abortRef.current = ctrl
    try {
      await adapter.fns.stream('chat', { messages: history.map(m => ({ role: m.role, content: m.text })), sessionId, regenerate: false }, (chunk) => {
        let ev: StreamEvent
        try { ev = JSON.parse(chunk) as StreamEvent } catch { return }
        if (ev.t === 'token') {
          textBufRef.current += ev.v
          if (rafRef.current === null) rafRef.current = requestAnimationFrame(() => { rafRef.current = null; const t = textBufRef.current; patch(m => ({ ...m, text: t })) })
        } else if (ev.t === 'tool') {
          patch(m => {
            const tools = [...m.tools]
            if (ev.phase === 'start') tools.push({ name: ev.name, done: false })
            else { const i = [...tools].reverse().findIndex(t => t.name === ev.name && !t.done); if (i >= 0) tools[tools.length - 1 - i] = { name: ev.name, done: true, summary: ev.summary } }
            return { ...m, tools }
          })
        } else if (ev.t === 'error') {
          patch(m => ({ ...m, text: m.text + `\n\n⚠️ ${ev.message}` }))
        }
      }, ctrl.signal)
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') patch(m => ({ ...m, text: m.text || `⚠️ ${err instanceof Error ? err.message : 'Request failed.'}` }))
    } finally {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; const t = textBufRef.current; if (t) patch(m => ({ ...m, text: t })) }
      if (abortRef.current === ctrl) setStreaming(false)
    }
  }

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

      {modal === 'new'      && <NewProductModal onClose={() => setModal(null)} onCreated={openDraft} />}
      {modal === 'unified'  && <UnifiedImportModal onClose={() => setModal(null)} onImported={openDraft} />}
      {modal === 'clone'    && <CloneProductModal onClose={() => setModal(null)} onCloned={openDraft} />}
      {modal === 'scaffold' && <ScaffoldProductModal onClose={() => setModal(null)} onCreated={openDraft} />}
      {promoteFor && user && (
        <PromoteDraftDialog
          product={promoteFor}
          actor={{ uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }}
          onClose={() => setPromoteFor(null)}
          // Promotion lands on the portfolio CARD view with the new card highlighted.
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

      {/* Chat panel — collapsible assistant for Builder-context Q&A */}
      <section aria-label="Builder assistant">
        <button
          type="button"
          onClick={() => setChatOpen(o => !o)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-[10px] text-sm font-medium text-dim hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{ border: '1px solid var(--color-border)' }}
          aria-expanded={chatOpen}
        >
          <IconChat size={15} aria-hidden="true" />
          Chat
          <IconChevronDown size={13} className={`transition-transform duration-200 ${chatOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>

        {chatOpen && (
          <div className="mt-3 rounded-[16px] flex flex-col overflow-hidden"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
            <div ref={scrollRef} className="overflow-y-auto max-h-[420px] p-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <IconChat size={28} className="text-faint" aria-hidden="true" />
                  <p className="text-sm text-dim">Ask anything about your drafts, coverages, or product rules.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4" role="log" aria-live="off" aria-label="Conversation">
                  {messages.map((m, i) => (
                    <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                      <div
                        className={m.role === 'user'
                          ? 'max-w-[85%] rounded-[14px] px-4 py-2.5 text-sm text-white'
                          : 'max-w-[92%] flex flex-col gap-2'}
                        style={m.role === 'user' ? { background: 'var(--gradient-accent)' } : undefined}
                      >
                        {m.role === 'assistant' && m.tools.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                            {m.tools.map((t, ti) => (
                              <span key={ti}
                                className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-[10.5px] font-medium transition-colors"
                                style={{
                                  background: t.done ? 'var(--color-good-soft)' : 'var(--color-accent-soft)',
                                  border: `1px solid ${t.done ? 'var(--color-good-line)' : 'var(--color-accent-line)'}`,
                                  color: t.done ? 'var(--color-good)' : 'var(--color-accent)',
                                }}>
                                {t.done
                                  ? <IconCheck size={9} aria-hidden="true" />
                                  : <WaveformLoader size="xs" label="" className="text-accent" />}
                                <span className="font-mono">{t.name}</span>
                                {t.done && t.summary && <span className="opacity-60 font-sans">· {t.summary}</span>}
                              </span>
                            ))}
                          </div>
                        )}
                        {m.role === 'assistant'
                          ? <div className="text-sm text-text"><StreamRenderer text={m.text} streaming={streaming && i === messages.length - 1} /></div>
                          : m.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <ChatComposer
                value={chatInput}
                onChange={setChatInput}
                onSubmit={() => void ask(chatInput)}
                onAutoSubmit={ask}
                streaming={streaming}
              />
            </div>
          </div>
        )}
      </section>
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
