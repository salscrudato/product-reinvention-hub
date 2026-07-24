// Home (/app) — the portfolio cockpit + assistant. The assistant is a tool-grounded
// chat over the whole portfolio (reusing the server-side `chat` agent): every answer
// cites a [refId] or form number and says "not found" when a tool returns nothing.
// Alongside it, a cockpit rail: a prioritised task list (due → criticality) with a
// daily/weekly window, and a Portfolio Pulse panel (readiness gauge, lifecycle mix,
// composition counts, 14-day change activity) — all derived from real product / version
// / search-index data. The whole surface is inquiry-only — no mutations happen here,
// so a VIEWER sees exactly what everyone else does (no edit affordances to hide).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconCheck, IconRecent, IconLayers, IconInfo } from '../components/ui/icons'
import { NoticeBanner, Tooltip, RefChip } from '../components/ui'
import { isCacheNotice, type NoticeEvent, type NoticeKind } from '../lib/ai/notices'
import { adapter } from '../lib/backend'
import { ChatComposer } from '../components/chat/ChatComposer'
import { StreamRenderer } from '../components/ai/StreamRenderer'
import { WaveformLoader } from '../components/ai/WaveformLoader'
import { HeroMark } from '../components/home/HeroMark'
import { useUser } from '../context/useUser'
import { IconChevronLeft, IconChevronRight } from '../components/ui/icons'
import { PriorityRail } from '../components/home/PriorityRail'
import { PortfolioMetrics } from '../components/home/PortfolioMetrics'
import { useLiveCollection, combineStatus } from '../lib/useLiveCollection'
import { reportWebVitals } from '../lib/perf/reportWebVitals'
import type { SearchIndexEntry, Task, Product } from '@pf/shared'

// ─── Stream protocol (mirror of functions/src/runtime.ts StreamEvent) ───────────

type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }
  | { t: 'notice'; level: 'info' | 'warn'; message: string; refs?: string[]; kind?: NoticeKind }
  | { t: 'error'; message: string }
  | { t: 'done' }

interface ToolChip { name: string; done: boolean; summary?: string }
interface ChatCard { citations: string[]; allCitations: string[]; contextHits: number; inputTokens: number; outputTokens: number }
interface ChatMessage { role: 'user' | 'assistant'; text: string; tools: ToolChip[]; notice?: NoticeEvent; chatCard?: ChatCard }

// ─── Chat response card — structured provenance panel rendered below each assistant
// turn. Shows the deduplicated data citations (cited refIds) as clickable chips and a
// quiet provenance badge ("Grounded in N sources"). Mirrors DeterminationCard's style.
function ChatResponseCard({ card, onCite }: { card: ChatCard; onCite: (cite: string) => void }) {
  const hasCitations = card.citations.length > 0
  if (!hasCitations && card.contextHits === 0) return null
  return (
    <div
      className="rounded-[12px] flex flex-col gap-2.5 px-3.5 py-3 mt-1"
      style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}
    >
      {hasCitations && (
        <div className="flex flex-col gap-1.5">
          <h4 className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[.07em] text-faint">
            <IconLayers size={12} aria-hidden="true" />
            Data citations
            <span className="text-faint/70 font-normal normal-case tracking-normal tabular-nums">· {card.citations.length}</span>
          </h4>
          <div className="flex items-center gap-1.5 flex-wrap">
            {card.citations.map((id, i) => (
              <button key={i} onClick={() => onCite(id)} title={`Navigate to ${id}`}
                className="focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[5px]">
                <RefChip id={id} />
              </button>
            ))}
          </div>
        </div>
      )}
      {card.contextHits > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-faint">
          <IconInfo size={12} aria-hidden="true" />
          <span>Grounded in {card.contextHits} portfolio source{card.contextHits !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  )
}

// ─── Product catalog — fixed taxonomy used by the filter dropdowns ───────────────
const BUS_UNITS = ['Personal Lines', 'Small Commercial', 'Middle Market', 'E&S'] as const

const PRODUCT_CATALOG: { name: string; busUnit: string }[] = [
  { name: 'Homeowners',                    busUnit: 'Personal Lines'   },
  { name: 'Personal Auto',                 busUnit: 'Personal Lines'   },
  { name: 'Personal Umbrella',             busUnit: 'Personal Lines'   },
  { name: 'Personal Floater',              busUnit: 'Personal Lines'   },
  { name: 'Commercial Property',           busUnit: 'Small Commercial' },
  { name: 'Commercial General Liability',  busUnit: 'Small Commercial' },
  { name: 'Inland Marine',                 busUnit: 'Small Commercial' },
  { name: 'Commercial Auto',               busUnit: 'Small Commercial' },
]

// ─── Cockpit ────────────────────────────────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate()
  const { user } = useUser()
  const [messages, setMessages]   = useState<ChatMessage[]>([])
  const [input, setInput]         = useState('')
  const [streaming, setStreaming] = useState(false)
  const [indexEntries, setIndexEntries] = useState<SearchIndexEntry[]>([])
  // Stable per-session id → the server's per-session cost-cap bucket + semantic-cache scope.
  // Persisted for the browser session so it survives route remounts.
  const [sessionId] = useState(() => {
    try { const s = sessionStorage.getItem('prh:aiSessionId'); if (s) return s } catch { /* private mode */ }
    const id = `s_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
    try { sessionStorage.setItem('prh:aiSessionId', id) } catch { /* private mode */ }
    return id
  })
  const scrollRef     = useRef<HTMLDivElement>(null)
  const abortRef      = useRef<AbortController | null>(null)   // cancels the in-flight SSE stream
  // RAF token batching: buffer tokens so we flush to React state at most once per animation
  // frame (≤60 Hz) instead of triggering a re-render on every single chunk from the SSE stream.
  const textBufferRef = useRef<string>('')
  const rafRef        = useRef<number | null>(null)
  // G1: single "Response ready" polite announcement when streaming ends.
  // The log uses aria-live="off" to suppress per-token noise; this element announces once.
  const [srAnnounce, setSrAnnounce] = useState('')

  // Cockpit rail collapse — COLLAPSED by default, persisted per user. The chat
  // reflows into the freed width; an edge affordance reopens the rail.
  const railKey = user?.uid ? `pf.home.rail.${user.uid}` : 'pf.home.rail'
  const [railOpen, setRailOpen] = useState(false)
  useEffect(() => {
    try { setRailOpen(localStorage.getItem(railKey) === 'open') } catch { /* private mode */ }
  }, [railKey])
  function toggleRail() {
    setRailOpen(o => {
      const next = !o
      try { localStorage.setItem(railKey, next ? 'open' : 'closed') } catch { /* private mode */ }
      return next
    })
  }

  // Abort any in-flight chat on unmount so it doesn't keep consuming tokens/network.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Route-level paint diagnostic for the cockpit surface.
  useEffect(() => { reportWebVitals('home') }, [])

  // Cockpit data — realtime, with genuine loading / error states (see useLiveCollection).
  const tasks    = useLiveCollection<Task>('tasks')
  const products = useLiveCollection<Product>('products')
  const now = useMemo(() => Date.now(), [])

  const [busUnit,     setBusUnit]     = useState('')
  const [productName, setProductName] = useState('')

  const productOptions = useMemo(() =>
    !busUnit ? PRODUCT_CATALOG.map(c => c.name) : PRODUCT_CATALOG.filter(c => c.busUnit === busUnit).map(c => c.name)
  , [busUnit])

  const filteredProducts = useMemo(() => products.items.filter(p =>
    (!busUnit     || PRODUCT_CATALOG.some(c => c.name === p.name && c.busUnit === busUnit)) &&
    (!productName || p.name === productName)
  ), [products.items, busUnit, productName])

  // Search index powers citation → entity navigation (best-effort; not a rendered panel).
  // Drop deleted-entity tombstones: a delete UPSERTS its searchIndex row with `deleted:true`
  // (server envelope) rather than removing it, so an unfiltered index still surfaces products
  // that no longer exist. Filter them out so nothing old is ever pulled in here.
  useEffect(() => {
    const unsub = adapter.db.subscribe<SearchIndexEntry>('searchIndex', d => {
      if (Array.isArray(d)) setIndexEntries(d.filter(e => !(e as SearchIndexEntry & { deleted?: boolean }).deleted))
    })
    return unsub
  }, [])

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])

  // Announce once when the stream settles; clear after a short hold so the region resets.
  useEffect(() => {
    if (streaming) return
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && last.text.trim()) {
      setSrAnnounce('Response ready')
      const t = setTimeout(() => setSrAnnounce(''), 1500)
      return () => clearTimeout(t)
    }
  }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve a cited refId / form number to an entity route and navigate there.
  function openCitation(cite: string) {
    const norm = cite.toLowerCase().replace(/\s+/g, ' ').trim()
    const hit = indexEntries.find(e =>
      (e.refId ?? '').toLowerCase() === norm ||
      e.subtitle?.toLowerCase() === norm ||
      e.title.toLowerCase().includes(norm) ||
      (e.keywords ?? []).some(k => k.toLowerCase() === norm.replace(/\s/g, '-') || k.toLowerCase() === norm),
    )
    navigate(hit ? routeFor(hit) : `/app/explorer`)
  }

  // Stream one turn. `history` ends at the user turn to answer; a fresh assistant placeholder
  // is appended and streamed into. `regenerate` tells the server to BYPASS the semantic cache
  // READ (force a fresh answer) — the per-session regenerate bypass (Part A).
  async function runChat(history: ChatMessage[], regenerate: boolean) {
    setMessages([...history, { role: 'assistant', text: '', tools: [] }])
    setStreaming(true)
    textBufferRef.current = ''   // reset accumulator for this new turn

    const wire = history.map(m => ({ role: m.role, content: m.text }))

    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages(prev => {
        const next = [...prev]
        const idx = next.length - 1
        if (idx >= 0 && next[idx]!.role === 'assistant') next[idx] = fn(next[idx]!)
        return next
      })

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await adapter.fns.stream('chat', { messages: wire, sessionId, regenerate }, (chunk) => {
        let ev: StreamEvent
        try { ev = JSON.parse(chunk) as StreamEvent } catch { return }
        switch (ev.t) {
          case 'token':
            // Accumulate in a ref and schedule at most one flush per animation frame.
            textBufferRef.current += ev.v
            if (rafRef.current === null) {
              rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null
                const txt = textBufferRef.current
                patchAssistant(m => ({ ...m, text: txt }))
              })
            }
            break
          case 'tool':
            patchAssistant(m => {
              const tools = [...m.tools]
              if (ev.phase === 'start') tools.push({ name: ev.name, done: false })
              else {
                const i = [...tools].reverse().findIndex(t => t.name === ev.name && !t.done)
                if (i >= 0) tools[tools.length - 1 - i] = { name: ev.name, done: true, summary: ev.summary }
              }
              return { ...m, tools }
            }); break
          case 'notice':
            // Non-fatal advisory: an unverified citation (warn), a cache hit or a cost-saver
            // degradation (info). Surface it so a chip is never read as confirmed and the
            // user knows when an answer came from cache (and can Regenerate for a fresh one).
            patchAssistant(m => ({ ...m, notice: { level: ev.level, message: ev.message, kind: ev.kind, refs: ev.refs } })); break
          case 'error':
            patchAssistant(m => ({ ...m, text: m.text + `\n\n⚠️ ${ev.message}` })); break
          case 'done': break
          case 'json':
            if (ev.key === 'chatCard') patchAssistant(m => ({ ...m, chatCard: ev.value as ChatCard }))
            break
        }
      }, controller.signal)
    } catch (err) {
      // An intentional abort (unmount) is not an error — leave state as-is.
      if ((err as { name?: string })?.name === 'AbortError') return
      patchAssistant(m => ({ ...m, text: m.text || `⚠️ ${err instanceof Error ? err.message : 'Request failed.'}` }))
    } finally {
      // Cancel any pending RAF and do one final flush so no tokens are dropped.
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
        const txt = textBufferRef.current
        if (txt) patchAssistant(m => ({ ...m, text: txt }))
      }
      if (abortRef.current === controller) setStreaming(false)
    }
  }

  async function ask(text: string) {
    const question = text.trim()
    if (!question || streaming) return
    setInput('')
    await runChat([...messages, { role: 'user', text: question, tools: [] }], false)
  }

  // Regenerate the last answer, bypassing the semantic cache (per-session bypass).
  async function regenerate() {
    if (streaming) return
    let lastUser = -1
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') { lastUser = i; break }
    if (lastUser < 0) return
    await runChat(messages.slice(0, lastUser + 1), true)
  }

  const empty = messages.length === 0

  const selectCls = "h-9 pl-3 pr-8 rounded-[10px] bg-surface border border-border-strong text-sm text-text appearance-none focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent"

  return (
    <div className="flex flex-col gap-4">

    {/* Filter bar */}
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <select value={busUnit} onChange={e => { setBusUnit(e.target.value); setProductName('') }}
          aria-label="Filter by business unit" className={selectCls}>
          <option value="">All business units</option>
          {BUS_UNITS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div className="relative">
        <select value={productName} onChange={e => setProductName(e.target.value)}
          aria-label="Filter by product" className={selectCls} disabled={productOptions.length === 0}>
          <option value="">All products</option>
          {productOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      {(busUnit || productName) && (
        <button onClick={() => { setBusUnit(''); setProductName('') }}
          className="h-9 px-3 rounded-[10px] text-sm text-dim hover:text-danger transition-colors"
          style={{ border: '1px solid var(--color-border)' }}>
          Clear filters
        </button>
      )}
    </div>

    <div
      className="flex flex-col gap-6 lg:grid lg:h-full lg:min-h-0"
      // The rail column springs between full width and a slim edge affordance;
      // the chat reflows into the freed space. Neutralised by reduced-motion.
      style={{ gridTemplateColumns: railOpen ? 'minmax(0,1fr) 340px' : 'minmax(0,1fr) 30px', transition: 'grid-template-columns .3s var(--ease-spring)' }}
    >
      {/* Assistant — grounded portfolio Q&A */}
      <section className="flex flex-col min-h-[60vh] lg:min-h-0" aria-label="Portfolio assistant">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className={`${railOpen ? 'max-w-3xl' : 'max-w-4xl'} w-full mx-auto h-full transition-all duration-300`}>
            {empty ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-6 py-10">
                <HeroMark size={76} />
                <div className="flex flex-col gap-1.5">
                  <h1 className="text-2xl font-bold text-text tracking-tight">Ask your product portfolio</h1>
                  <p className="text-sm text-dim max-w-md">Grounded in your coverages, forms, rules and rating tables — every answer cites its source.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5 py-4" role="log" aria-live="off" aria-label="Conversation">
                {/* aria-live="off" overrides the implicit polite from role="log" so token-by-token
                    streaming is not announced; the sr-only region below fires once on completion. */}
                {messages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div className={m.role === 'user'
                      ? 'max-w-[85%] rounded-[14px] px-4 py-2.5 text-sm text-white'
                      : 'max-w-[92%] flex flex-col gap-2'}
                      style={m.role === 'user' ? { background: 'var(--gradient-accent)' } : undefined}>
                      {m.role === 'assistant' && m.tools.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                          {m.tools.map((t, ti) => (
                            <span key={ti} className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-[10.5px] font-medium transition-colors"
                              style={{
                                background: t.done ? 'var(--color-good-soft)' : 'var(--color-accent-soft)',
                                border: `1px solid ${t.done ? 'var(--color-good-line)' : 'var(--color-accent-line)'}`,
                                color: t.done ? 'var(--color-good)' : 'var(--color-accent)',
                              }}>
                              {t.done ? (
                                <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                                  style={{ background: 'var(--color-good-soft)' }}>
                                  <IconCheck size={9} aria-hidden="true" />
                                </span>
                              ) : (
                                <WaveformLoader size="xs" label="" className="text-accent" />
                              )}
                              <span className="font-mono">{t.name}</span>
                              {t.done && t.summary && <span className="opacity-60 font-sans">· {t.summary}</span>}
                            </span>
                          ))}
                          {/* connecting dots between steps */}
                          {m.tools.length > 1 && (
                            <div className="absolute left-0 top-2.5 flex gap-1 pointer-events-none" aria-hidden="true" />
                          )}
                        </div>
                      )}
                      {m.role === 'assistant'
                        ? (
                          <>
                            <div className="text-sm text-text"><StreamRenderer text={m.text} streaming={streaming && i === messages.length - 1} onCite={openCitation} citationIndex={indexEntries} /></div>
                            {m.chatCard && !streaming && <ChatResponseCard card={m.chatCard} onCite={openCitation} />}
                          </>
                        )
                        : m.text}
                      {/* Degrade / deny / breaker / unverified → the shared honest-status banner.
                          A cache HIT is NOT a banner — it's the quiet badge in the footer row below. */}
                      {m.role === 'assistant' && m.notice && !isCacheNotice(m.notice) && (
                        <NoticeBanner notice={m.notice} />
                      )}
                      {/* Footer: a quiet Cached badge (with tooltip) beside Regenerate. Regenerate is
                          offered whenever the turn produced text OR a notice — so a DENY is a
                          first-class, recoverable state, not a vanished toast. */}
                      {m.role === 'assistant' && i === messages.length - 1 && !streaming && (m.text.trim() || m.notice) && (
                        <div className="flex items-center gap-2 self-start">
                          {isCacheNotice(m.notice) && (
                            <Tooltip content="Reused a near-identical cached answer to save budget. Regenerate for a fresh, full-depth one.">
                              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded-full bg-raised text-faint" style={{ border: '1px solid var(--color-border)' }}>
                                <IconRecent size={10} aria-hidden="true" /> Cached
                              </span>
                            </Tooltip>
                          )}
                          <button
                            onClick={regenerate}
                            title="Regenerate a fresh answer (bypass the cached response)"
                            className="inline-flex items-center gap-1 text-[11px] text-faint hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[6px] px-1"
                          >↻ Regenerate</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Single polite announcement on stream completion — replaces per-token noise (G1) */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{srAnnounce}</div>

        {/* Composer */}
        <div className={`mt-3 ${railOpen ? 'max-w-3xl' : 'max-w-4xl'} w-full mx-auto transition-all duration-300`}>
          <ChatComposer value={input} onChange={setInput} onSubmit={() => ask(input)} onAutoSubmit={ask} streaming={streaming} />
        </div>
      </section>

      {/* Cockpit rail — collapsible, collapsed by default, persisted per user */}
      <aside className="relative lg:h-full lg:min-h-0" aria-label="Portfolio cockpit">
        {railOpen ? (
          <>
            {/* Edge handle on the rail's seam — collapses it back */}
            <button
              onClick={toggleRail}
              aria-expanded="true"
              aria-label="Hide priorities & portfolio metrics"
              className="hidden lg:flex absolute -left-3 top-5 z-10 w-6 h-6 items-center justify-center rounded-full bg-surface text-dim hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
            >
              <IconChevronRight size={13} aria-hidden="true" />
            </button>
            <div className="flex flex-col gap-4 lg:h-full lg:overflow-y-auto lg:min-h-0 pb-1 slide-in-right">
              <button
                onClick={toggleRail}
                aria-expanded="true"
                className="lg:hidden self-end inline-flex items-center gap-1 text-xs text-dim hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[6px] px-1"
              >
                Hide panel <IconChevronRight size={12} aria-hidden="true" />
              </button>
              <PriorityRail
                status={combineStatus(tasks.status, products.status)}
                tasks={tasks.items} products={filteredProducts} now={now}
              />
              <PortfolioMetrics products={filteredProducts} />
            </div>
          </>
        ) : (
          // Collapsed → an elegant edge affordance: a slim full-height rail on
          // desktop (vertical wordmark + chevron), a quiet row on mobile.
          <button
            onClick={toggleRail}
            aria-expanded="false"
            aria-label="Show priorities & portfolio metrics"
            className="group flex w-full items-center justify-center gap-1.5 rounded-[12px] px-2 py-2 lg:h-full lg:w-[30px] lg:flex-col lg:px-0 lg:py-4 bg-surface hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <IconChevronLeft size={13} className="text-faint group-hover:text-accent transition-colors shrink-0" aria-hidden="true" />
            <span className="lg:hidden text-xs text-dim group-hover:text-text transition-colors">Priorities & metrics</span>
            <span
              className="hidden lg:block text-[9.5px] font-semibold uppercase tracking-[.14em] text-faint group-hover:text-accent transition-colors select-none"
              style={{ writingMode: 'vertical-rl' }}
              aria-hidden="true"
            >
              Priorities · Metrics
            </span>
          </button>
        )}
      </aside>
    </div>
    </div>
  )
}

// Map a search-index hit to its in-app route (mirrors Explorer's toRoute).
function routeFor(entry: SearchIndexEntry): string {
  const pid = entry.path.split('/')[1] ?? 'PH.PROD.001'
  switch (entry.type) {
    case 'product':    return `/app/products/${pid}/overview`
    case 'coverage':   return `/app/products/${pid}/coverages`
    case 'form':       return `/app/products/${pid}/forms`
    case 'rule':       return `/app/products/${pid}/rules`
    case 'dictionary': return entry.refId ? `/app/dictionary?term=${encodeURIComponent(entry.refId)}` : `/app/dictionary`
    default:           return `/app/explorer`
  }
}
