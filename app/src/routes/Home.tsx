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
import { IconSparkle, IconCheck, IconSpinner, IconWarning } from '../components/ui/icons'
import { adapter } from '../lib/backend'
import { ChatComposer } from '../components/chat/ChatComposer'
import { Markdown } from '../components/chat/Markdown'
import { HeroMark } from '../components/home/HeroMark'
import { PriorityRail } from '../components/home/PriorityRail'
import { PortfolioMetrics } from '../components/home/PortfolioMetrics'
import { useLiveCollection, combineStatus } from '../lib/useLiveCollection'
import type { SearchIndexEntry, Task, Product } from '@pf/shared'

// ─── Stream protocol (mirror of functions/src/runtime.ts StreamEvent) ───────────

type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }
  | { t: 'notice'; level: 'info' | 'warn'; message: string; refs?: string[] }
  | { t: 'error'; message: string }
  | { t: 'done' }

interface ToolChip { name: string; done: boolean; summary?: string }
interface ChatMessage { role: 'user' | 'assistant'; text: string; tools: ToolChip[]; notice?: string }

// Short pill labels around the composer, each carrying the full prompt it sends.
const SUGGESTIONS: Array<{ label: string; prompt: string }> = [
  { label: 'Trace HO-3 premium',     prompt: 'Trace the premium for the default HO-3 example.' },
  { label: 'SPP forms · Texas',      prompt: 'Which forms attach if I add Scheduled Personal Property on a Texas risk?' },
  { label: 'Trace GL premium',       prompt: 'Trace the GL premium for a retail store with $300,000 in gross sales.' },
  { label: 'Mandatory GL coverages', prompt: 'What GL coverages are mandatory under CG 00 01?' },
]


// ─── Cockpit ────────────────────────────────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate()
  const [messages, setMessages]   = useState<ChatMessage[]>([])
  const [input, setInput]         = useState('')
  const [streaming, setStreaming] = useState(false)
  const [indexEntries, setIndexEntries] = useState<SearchIndexEntry[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef  = useRef<AbortController | null>(null)   // cancels the in-flight SSE stream

  // Abort any in-flight chat on unmount so it doesn't keep consuming tokens/network.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Cockpit data — realtime, with genuine loading / error states (see useLiveCollection).
  const tasks    = useLiveCollection<Task>('tasks')
  const products = useLiveCollection<Product>('products')
  // Fixed at mount so streaming chat tokens don't re-sort the rail on every keystroke.
  const now = useMemo(() => Date.now(), [])

  // Search index powers citation → entity navigation (best-effort; not a rendered panel).
  useEffect(() => {
    const unsub = adapter.db.subscribe<SearchIndexEntry>('searchIndex', d => { if (Array.isArray(d)) setIndexEntries(d) })
    return unsub
  }, [])

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])

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

  async function ask(text: string) {
    const question = text.trim()
    if (!question || streaming) return
    setInput('')

    const history: ChatMessage[] = [...messages, { role: 'user', text: question, tools: [] }]
    // Placeholder assistant message we stream into.
    setMessages([...history, { role: 'assistant', text: '', tools: [] }])
    setStreaming(true)

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
      await adapter.fns.stream('chat', { messages: wire }, (chunk) => {
        let ev: StreamEvent
        try { ev = JSON.parse(chunk) as StreamEvent } catch { return }
        switch (ev.t) {
          case 'token':
            patchAssistant(m => ({ ...m, text: m.text + ev.v })); break
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
            // C1: the answer streamed, but the server couldn't verify one or more cited
            // references against the catalog — surface that so a chip is never read as
            // confirmed. Non-fatal; the prose stays.
            patchAssistant(m => ({ ...m, notice: ev.message })); break
          case 'error':
            patchAssistant(m => ({ ...m, text: m.text + `\n\n⚠️ ${ev.message}` })); break
          case 'done': break
          case 'json': break
        }
      }, controller.signal)
    } catch (err) {
      // An intentional abort (unmount) is not an error — leave state as-is.
      if ((err as { name?: string })?.name === 'AbortError') return
      patchAssistant(m => ({ ...m, text: m.text || `⚠️ ${err instanceof Error ? err.message : 'Request failed.'}` }))
    } finally {
      if (abortRef.current === controller) setStreaming(false)
    }
  }

  const empty = messages.length === 0

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:h-full lg:min-h-0">
      {/* Assistant — grounded portfolio Q&A */}
      <section className="flex flex-col min-h-[60vh] lg:min-h-0" aria-label="Portfolio assistant">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="max-w-3xl w-full mx-auto h-full">
            {empty ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-6 py-10">
                <HeroMark size={76} />
                <div className="flex flex-col gap-1.5">
                  <h1 className="text-2xl font-bold text-text tracking-tight">Ask your product portfolio</h1>
                  <p className="text-sm text-dim max-w-md">Grounded in your coverages, forms, rules and rating tables — every answer cites its source.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5 py-4" role="log" aria-live="polite" aria-label="Conversation">
                {messages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div className={m.role === 'user'
                      ? 'max-w-[85%] rounded-[14px] px-4 py-2.5 text-sm text-white'
                      : 'max-w-[92%] flex flex-col gap-2'}
                      style={m.role === 'user' ? { background: 'var(--gradient-accent)' } : undefined}>
                      {m.role === 'assistant' && m.tools.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {m.tools.map((t, ti) => (
                            <span key={ti} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-raised text-[11px] text-dim font-mono">
                              {t.done ? <IconCheck size={10} className="text-good" aria-hidden="true" /> : <IconSpinner size={10} className="animate-spin text-accent" aria-hidden="true" />}
                              {t.name}{t.done && t.summary ? ` · ${t.summary}` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.role === 'assistant'
                        ? <div className="text-sm text-text"><Markdown text={m.text} onCite={openCitation} />{streaming && i === messages.length - 1 && <span aria-hidden="true" className="inline-block w-1.5 h-4 ml-0.5 bg-accent align-middle animate-pulse" />}</div>
                        : m.text}
                      {m.role === 'assistant' && m.notice && (
                        <div className="flex items-start gap-1.5 text-[12px] text-warn" role="note">
                          <IconWarning size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{m.notice}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Composer — with one-tap starter pills around it while the thread is empty */}
        <div className="mt-3 max-w-3xl w-full mx-auto">
          {empty && (
            <div className="flex flex-wrap justify-center gap-2 mb-3">
              {SUGGESTIONS.map(s => (
                <button
                  key={s.label} onClick={() => ask(s.prompt)} title={s.prompt}
                  className="group inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-1.5 text-[12.5px] text-dim bg-surface hover:text-text transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  <IconSparkle size={12} className="text-accent opacity-70 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <ChatComposer value={input} onChange={setInput} onSubmit={() => ask(input)} streaming={streaming} />
        </div>
      </section>

      {/* Cockpit rail */}
      <aside className="flex flex-col gap-4 lg:overflow-y-auto lg:min-h-0 pb-1" aria-label="Portfolio cockpit">
        <PriorityRail
          status={combineStatus(tasks.status, products.status)}
          tasks={tasks.items} products={products.items} now={now}
        />
        <PortfolioMetrics products={products.items} />
      </aside>
    </div>
  )
}

// Map a search-index hit to its in-app route (mirrors Explorer's toRoute).
function routeFor(entry: SearchIndexEntry): string {
  const pid = entry.path.split('/')[1] ?? 'HO.PROD.001'
  switch (entry.type) {
    case 'product':    return `/app/products/${pid}/overview`
    case 'coverage':   return `/app/products/${pid}/coverages`
    case 'form':       return `/app/products/${pid}/forms`
    case 'rule':       return `/app/products/${pid}/rules`
    case 'dictionary': return entry.refId ? `/app/dictionary?term=${encodeURIComponent(entry.refId)}` : `/app/dictionary`
    default:           return `/app/explorer`
  }
}
