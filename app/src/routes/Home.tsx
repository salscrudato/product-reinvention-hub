// Home (/app) — the portfolio's front door: a centered, tool-grounded chat over
// the whole product portfolio, plus a "Today's Focus" rail (SLA tasks, reviews
// awaiting me, health findings, latest news). Streaming tokens, live tool-status
// chips, and citations that link straight to the cited entity.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Send, Sparkles, Wrench, CheckSquare, ClipboardCheck, Activity, Newspaper, Loader2,
} from 'lucide-react'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge } from '../components/ui'
import type { SearchIndexEntry, Task, Product, News } from '@pf/shared'

// ─── Stream protocol (mirror of functions/src/runtime.ts StreamEvent) ───────────

type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }
  | { t: 'error'; message: string }
  | { t: 'done' }

interface ToolChip { name: string; done: boolean; summary?: string }
interface ChatMessage { role: 'user' | 'assistant'; text: string; tools: ToolChip[] }

const SUGGESTIONS = [
  'Which forms attach if I add Scheduled Personal Property on a Texas risk?',
  'Trace the premium for the default HO-3 example.',
  'What are the eligibility rules that reference Coverage F medical payments?',
  'Show the wind/hail percentage deductible options and their constraints.',
]

// ─── Citation linkifying ────────────────────────────────────────────────────────

// Match bracketed refIds / form numbers: [HO.RU.006], [HO 04 90], [HO.LD.002].
const CITE_RE = /\[(HO[\s.][A-Z0-9][A-Z0-9.\s]*?)\]/g

/** Render assistant text with clickable citation chips. */
function RichText({ text, onCite }: { text: string; onCite: (cite: string) => void }) {
  const nodes: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  CITE_RE.lastIndex = 0
  let i = 0
  while ((m = CITE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const cite = m[1]!.trim()
    nodes.push(
      <button
        key={`c${i++}`}
        onClick={() => onCite(cite)}
        className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-[5px] bg-accent-soft text-accent font-mono text-[11px] font-medium hover:bg-[rgba(192,38,211,.14)] transition-colors align-baseline"
        title={`Open ${cite}`}
      >
        {cite}
      </button>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return <span className="whitespace-pre-wrap leading-relaxed">{nodes}</span>
}

// ─── Timestamp helper (Firestore Timestamp | ISO | millis → millis) ─────────────

function toMillis(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t }
  const o = v as { toDate?: () => Date; seconds?: number }
  if (typeof o.toDate === 'function') return o.toDate().getTime()
  if (typeof o.seconds === 'number') return o.seconds * 1000
  return null
}

function relativeDue(ms: number | null): { label: string; overdue: boolean } {
  if (ms == null) return { label: 'no date', overdue: false }
  const days = Math.round((ms - Date.now()) / 86_400_000)
  if (days < 0)  return { label: `${-days}d overdue`, overdue: true }
  if (days === 0) return { label: 'due today', overdue: true }
  if (days === 1) return { label: 'due tomorrow', overdue: false }
  return { label: `in ${days}d`, overdue: false }
}

// ─── Today's Focus data ─────────────────────────────────────────────────────────

interface WithId { id?: string }

function useFocusData(uid: string | undefined) {
  const [tasks, setTasks]       = useState<(Task & WithId)[]>([])
  const [products, setProducts] = useState<(Product & WithId)[]>([])
  const [news, setNews]         = useState<(News & WithId)[]>([])

  useEffect(() => {
    const u1 = adapter.db.subscribe<Task & WithId>('tasks',    d => Array.isArray(d) && setTasks(d))
    const u2 = adapter.db.subscribe<Product & WithId>('products', d => Array.isArray(d) && setProducts(d))
    const u3 = adapter.db.subscribe<News & WithId>('news',      d => Array.isArray(d) && setNews(d))
    return () => { u1(); u2(); u3() }
  }, [])

  const myTasks = useMemo(() => tasks
    .filter(t => t.column !== 'LAUNCH_MONITOR')
    .filter(t => !uid || !t.assignee || t.assignee.uid === uid)
    .sort((a, b) => (toMillis(a.dueAt) ?? Infinity) - (toMillis(b.dueAt) ?? Infinity))
    .slice(0, 5), [tasks, uid])

  const awaitingReview = useMemo(() =>
    products.filter(p => p.reviewStatus === 'BUSINESS_REVIEW' || p.reviewStatus === 'IN_PROGRESS').slice(0, 4),
    [products])

  const healthFindings = useMemo(() =>
    [...products].sort((a, b) => (a.health?.score ?? 100) - (b.health?.score ?? 100)).slice(0, 3),
    [products])

  const latestNews = useMemo(() =>
    [...news].sort((a, b) => (toMillis(b.fetchedAt) ?? 0) - (toMillis(a.fetchedAt) ?? 0)).slice(0, 3),
    [news])

  return { myTasks, awaitingReview, healthFindings, latestNews }
}

function FocusSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-faint">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide">{title}</span>
      </div>
      {children}
    </section>
  )
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate()
  const { user } = useUser()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput]       = useState('')
  const [streaming, setStreaming] = useState(false)
  const [indexEntries, setIndexEntries] = useState<SearchIndexEntry[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const { myTasks, awaitingReview, healthFindings, latestNews } = useFocusData(user?.uid)

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
          case 'error':
            patchAssistant(m => ({ ...m, text: m.text + `\n\n⚠️ ${ev.message}` })); break
          case 'done': break
          case 'json': break
        }
      })
    } catch (err) {
      patchAssistant(m => ({ ...m, text: m.text || `⚠️ ${err instanceof Error ? err.message : 'Request failed.'}` }))
    } finally {
      setStreaming(false)
    }
  }

  const empty = messages.length === 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 h-full min-h-0">
      {/* Chat column */}
      <div className="flex flex-col min-h-0 max-w-3xl w-full mx-auto">
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 pr-1">
          {empty ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-6 py-10">
              <div className="w-14 h-14 rounded-[16px] flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg,#C026D3,#EC4899)' }}>
                <Sparkles size={26} className="text-white" />
              </div>
              <div className="flex flex-col gap-1.5">
                <h1 className="text-xl font-bold text-text">Ask your product portfolio</h1>
                <p className="text-sm text-dim max-w-md">Grounded in your coverages, forms, rules and rating tables — every answer cites the exact refId or form number.</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-2.5 w-full max-w-xl">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => ask(s)}
                    className="text-left text-sm text-dim bg-surface rounded-[12px] px-4 py-3 hover:text-text hover:shadow-[var(--shadow-card-hover)] transition-all"
                    style={{ border: '1px solid var(--color-border)' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5 py-4">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={m.role === 'user'
                    ? 'max-w-[85%] rounded-[14px] px-4 py-2.5 text-sm text-white'
                    : 'max-w-[92%] flex flex-col gap-2'}
                    style={m.role === 'user' ? { background: 'linear-gradient(135deg,#C026D3,#EC4899)' } : undefined}>
                    {m.role === 'assistant' && m.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.tools.map((t, ti) => (
                          <span key={ti} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-raised text-[11px] text-dim font-mono">
                            {t.done ? <Wrench size={10} className="text-good" /> : <Loader2 size={10} className="animate-spin text-accent" />}
                            {t.name}{t.done && t.summary ? ` · ${t.summary}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.role === 'assistant'
                      ? <div className="text-sm text-text"><RichText text={m.text} onCite={openCitation} />{streaming && i === messages.length - 1 && <span className="inline-block w-1.5 h-4 ml-0.5 bg-accent align-middle animate-pulse" />}</div>
                      : m.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={e => { e.preventDefault(); ask(input) }}
          className="mt-3 flex items-end gap-2 bg-surface rounded-[14px] p-2"
          style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) } }}
            placeholder="Ask your product portfolio…"
            rows={1}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-faint focus:outline-none max-h-32"
          />
          <button type="submit" disabled={streaming || !input.trim()}
            className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white disabled:opacity-40 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#C026D3,#EC4899)' }} aria-label="Send">
            {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
      </div>

      {/* Today's Focus rail */}
      <aside className="hidden lg:flex flex-col gap-6 overflow-y-auto min-h-0 pl-1">
        <h2 className="text-sm font-semibold text-text">Today's Focus</h2>

        <FocusSection icon={<CheckSquare size={13} />} title="My open tasks">
          {myTasks.length === 0 ? <EmptyLine text="No open tasks assigned." /> : myTasks.map(t => {
            const due = relativeDue(toMillis(t.dueAt))
            return (
              <button key={t.id} onClick={() => navigate('/app/tasks')} className="flex items-center justify-between gap-2 text-left w-full group">
                <span className="text-xs text-dim group-hover:text-text truncate">{t.title}</span>
                <Badge label={due.label} color={due.overdue ? 'danger' : 'default'} />
              </button>
            )
          })}
        </FocusSection>

        <FocusSection icon={<ClipboardCheck size={13} />} title="Awaiting review">
          {awaitingReview.length === 0 ? <EmptyLine text="Nothing awaiting review." /> : awaitingReview.map(p => (
            <button key={p.id} onClick={() => navigate(`/app/products/${p.id}/overview`)} className="flex items-center justify-between gap-2 text-left w-full group">
              <span className="text-xs text-dim group-hover:text-text truncate">{p.name}</span>
              <Badge label={p.reviewStatus.replace(/_/g, ' ')} color="warn" />
            </button>
          ))}
        </FocusSection>

        <FocusSection icon={<Activity size={13} />} title="Health findings">
          {healthFindings.length === 0 ? <EmptyLine text="No products yet." /> : healthFindings.map(p => (
            <button key={p.id} onClick={() => navigate(`/app/products/${p.id}/overview`)} className="flex items-center justify-between gap-2 text-left w-full group">
              <span className="text-xs text-dim group-hover:text-text truncate">{p.name}</span>
              <span className="flex items-center gap-1.5">
                {(p.health?.findingCount ?? 0) > 0 && <span className="text-[11px] text-warn">{p.health.findingCount}</span>}
                <Badge label={`${p.health?.score ?? '—'}`} color={(p.health?.score ?? 100) < 70 ? 'danger' : (p.health?.score ?? 100) < 90 ? 'warn' : 'good'} />
              </span>
            </button>
          ))}
        </FocusSection>

        <FocusSection icon={<Newspaper size={13} />} title="Latest news">
          {latestNews.length === 0 ? <EmptyLine text="No news items yet." /> : latestNews.map(n => (
            <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="flex flex-col gap-0.5 group">
              <span className="text-xs text-dim group-hover:text-text line-clamp-2">{n.title}</span>
              <span className="text-[10px] text-faint">{n.source}</span>
            </a>
          ))}
        </FocusSection>
      </aside>
    </div>
  )
}

function EmptyLine({ text }: { text: string }) {
  return <span className="text-xs text-faint italic">{text}</span>
}

// Map a search-index hit to its in-app route (mirrors Explorer's toRoute).
function routeFor(entry: SearchIndexEntry): string {
  const pid = entry.path.split('/')[1] ?? 'HO.PROD.001'
  switch (entry.type) {
    case 'product':    return `/app/products/${pid}/overview`
    case 'coverage':   return `/app/products/${pid}/coverages`
    case 'form':       return `/app/products/${pid}/forms`
    case 'rule':       return `/app/products/${pid}/rules`
    case 'dictionary': return `/app/dictionary`
    default:           return `/app/explorer`
  }
}
