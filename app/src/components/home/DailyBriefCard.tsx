// DailyBriefCard — the Home "First Prompt" daily brief (BR-02 / HOME_BRIEF_SPEC §3–4).
// Pills are the quick-scan layer (closed taxonomy, server-ordered, max 6); the AI
// headline + grounded task paragraph are the narrative; news and metrics close the
// loop. Every AI-authored sentence arrives already cited (the server strips uncited
// text); every non-deterministic block carries an explicit status and the enrichment
// stub is labeled, never a broken widget. Served through the cost-guarded
// POST /api/ai/dailyBrief, cached per tenant per UTC day server-side and per session
// here (a successful fetch also feeds PriorityRail's summary cache so the rail never
// spends a second model call). The card keeps ONE reserved min-height across
// skeleton/error/empty/ready — no layout shift.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adapter } from '../../lib/backend'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { Badge, Button } from '../ui'
import { IconSparkle, IconRefresh, IconArrowRight } from '../ui/icons'
import { StreamRenderer } from '../ai/StreamRenderer'
import { WaveformLoader } from '../ai/WaveformLoader'
import type { Task, Product, SearchIndexEntry } from '@pf/shared'

type TaskDoc    = Task & { id: string }
type ProductDoc = Product & { id: string }

// ─── The endpoint contract (frozen in orchestration.md CONTRACTS at wave close) ──
export interface BriefBlockStatus { status: 'ok' | 'empty' | 'error' | 'unavailable'; detail?: string }
export interface BriefPayload {
  day: string
  generatedAt: string
  headline: { text: string; citations: string[]; source: 'ai' | 'deterministic' }
  pills: Array<{ kind: string; label: string; count?: number; tone: 'info' | 'warn' | 'good'; target: string; citations: string[] }>
  tasks: BriefBlockStatus & { paragraph: string | null; citations: string[]; buckets?: { open: number; overdue: number; next7: number; dueToday: number } }
  news: BriefBlockStatus & { items: Array<{ urlHash: string; title: string; source: string; publishedAt: string | null; matchedProducts: string[]; matchedCarrier: boolean }> }
  metrics: BriefBlockStatus & {
    deterministic: { products: number | null; coverages: number | null; openTasks: number | null; versions7d: number | null } | null
    enrichment: BriefBlockStatus & { items: Array<{ text: string; url: string | null }> }
  }
}

const BRIEF_CACHE_KEY = 'pf.home.dailyBrief'
const RAIL_SUMMARY_KEY = 'pf.home.taskSummary'   // PriorityRail's cache — fed, never read

const todayUTC = () => new Date().toISOString().slice(0, 10)

function readBriefCache(): BriefPayload | null {
  try {
    const raw = sessionStorage.getItem(BRIEF_CACHE_KEY)
    if (!raw) return null
    const { day, payload } = JSON.parse(raw) as { day: string; payload: BriefPayload }
    return day === todayUTC() ? payload : null
  } catch { return null }
}

const TONE_BADGE: Record<string, 'blue' | 'warn' | 'good'> = { info: 'blue', warn: 'warn', good: 'good' }

/** Headline provenance chips: namespaced citations fold into ≤3 kind-level sources
 *  (tasks board / news feed / a named metric), each routed where it can honestly go. */
function headlineSources(citations: string[]): Array<{ label: string; title: string; target: string | null }> {
  const out = new Map<string, { label: string; title: string; target: string | null }>()
  for (const c of citations) {
    if (c.startsWith('task:')) out.set('tasks', { label: 'tasks board', title: `Cited tasks: ${citations.filter(x => x.startsWith('task:')).map(x => x.slice(5)).join(', ')}`, target: '/app/tasks' })
    else if (c.startsWith('news:')) out.set('news', { label: 'news feed', title: `Cited stories: ${citations.filter(x => x.startsWith('news:')).map(x => x.slice(5, 13)).join(', ')}`, target: '/app/news' })
    else if (c.startsWith('metric:')) out.set(c, { label: c.slice(7), title: `Deterministic portfolio count: ${c.slice(7)}`, target: null })
  }
  return [...out.values()].slice(0, 3)
}

export function DailyBriefCard({ products, tasks }: { products: ProductDoc[]; tasks: TaskDoc[] }) {
  const navigate = useNavigate()
  const { profile } = useUser()
  const canForce = canI(profile, 'product:write')

  const [brief, setBrief]     = useState<BriefPayload | null>(readBriefCache)
  const [loading, setLoading] = useState(brief === null)
  const [error, setError]     = useState<string | null>(null)

  async function fetchBrief(force = false) {
    setLoading(true); setError(null)
    try {
      const out = await adapter.fns.call<{ force?: boolean }, BriefPayload>('dailyBrief', force ? { force: true } : {})
      setBrief(out)
      try {
        sessionStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({ day: out.day, payload: out }))
        // Feed the rail's summary cache from the brief's tasks block — one model call a day.
        if (out.tasks?.status === 'ok' && out.tasks.paragraph) {
          sessionStorage.setItem(RAIL_SUMMARY_KEY, JSON.stringify({
            summary: out.tasks.paragraph, counts: out.tasks.buckets, generatedAt: out.generatedAt,
          }))
        }
      } catch { /* private mode */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Brief unavailable right now.')
    } finally { setLoading(false) }
  }

  useEffect(() => { if (brief === null) void fetchBrief() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Citation hover cards for the task paragraph — same recipe as PriorityRail.
  const citationIndex = useMemo<SearchIndexEntry[]>(() => {
    const productById = new Map(products.map(p => [p.id, p.name]))
    return tasks.flatMap(t => {
      const entry: SearchIndexEntry = {
        type: 'task', refId: t.id, title: t.title,
        subtitle: [t.productId ? productById.get(t.productId) : null, typeof t.dueAt === 'string' ? `due ${t.dueAt.slice(0, 10)}` : null].filter(Boolean).join(' · '),
        path: `tasks/${t.id}`, keywords: t.seedRefId ? [t.seedRefId] : [],
      }
      return t.seedRefId ? [entry, { ...entry, refId: t.seedRefId }] : [entry]
    })
  }, [tasks, products])

  const emptyTenant = !loading && !error && brief !== null
    && (brief.metrics.deterministic?.products ?? products.length) === 0
    && brief.tasks.status !== 'ok'
    && brief.news.items.length === 0

  return (
    <section
      aria-label="Daily brief"
      className="glass w-full max-w-2xl mx-auto rounded-[16px] p-5 text-left flex flex-col gap-3 min-h-[196px]"
      style={{ border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* Header row — constant across every state. */}
      <div className="flex items-center gap-2">
        <IconSparkle size={15} className="text-accent" aria-hidden="true" />
        <h2 className="text-[13px] font-semibold text-text">Your daily brief</h2>
        <span className="text-[10.5px] text-faint ml-1">AI-composed · every claim cites its source</span>
        {canForce && !loading && (
          <button
            type="button" onClick={() => void fetchBrief(true)} title="Recompute today's brief"
            aria-label="Refresh the daily brief"
            className="ml-auto p-1 rounded-[6px] text-faint hover:text-dim transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
            <IconRefresh size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Pill row — fixed height in every state (skeleton chips ↔ ≤6 real pills). */}
      <div className="flex items-center flex-wrap gap-1.5 min-h-7" aria-label="Brief highlights">
        {loading
          ? [0, 1, 2].map(i => (
              <span key={i} className="inline-block h-6 w-24 rounded-full animate-pulse" style={{ background: 'var(--color-chip)' }} aria-hidden="true" />
            ))
          : (brief?.pills ?? []).map((p, i) => (
              <button key={i} type="button" onClick={() => navigate(p.target)}
                className="focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-full"
                aria-label={`${p.label} — open ${p.target.replace('/app/', '')}`}>
                <Badge label={p.label} color={TONE_BADGE[p.tone] ?? 'default'} className="cursor-pointer" />
              </button>
            ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2.5 flex-1">
          <WaveformLoader size="sm" label="" className="text-accent" />
          <span className="text-xs text-dim">Composing your brief from tasks, news and portfolio data…</span>
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 flex-1 text-[12.5px] text-dim" title={error}>
          <span>Your brief couldn’t be composed right now.</span>
          <button type="button" onClick={() => void fetchBrief()} className="font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
            Retry
          </button>
        </div>
      ) : emptyTenant ? (
        <div className="flex flex-col gap-2.5 flex-1">
          <p className="text-[13px] text-dim">Your brief starts when the portfolio does.</p>
          <div>
            <Button variant="primary" size="sm" onClick={() => navigate('/app/builder')}>
              <IconArrowRight size={13} aria-hidden="true" />Import or author your first product
            </Button>
          </div>
        </div>
      ) : brief ? (
        <div className="flex flex-col gap-3">
          {/* Headline — the lead. Clean prose; its sources render as chips below.
              Deterministic fallbacks are visibly labeled. */}
          <div className="flex flex-col gap-1">
            <p className="text-[14px] leading-relaxed text-text font-medium">
              {brief.headline.text}
              {brief.headline.source === 'deterministic' && (
                <span className="ml-1.5 align-middle text-[9.5px] font-bold uppercase tracking-[.05em] text-faint rounded-[4px] px-1 py-0.5" style={{ border: '1px solid var(--color-border)' }}
                  title="Computed directly from portfolio counts — the AI lead was unavailable">
                  computed
                </span>
              )}
            </p>
            {brief.headline.citations.length > 0 && (
              <span className="flex items-center gap-1 flex-wrap" aria-label="Headline sources">
                <span className="text-[9.5px] font-semibold uppercase tracking-[.05em] text-faint">Sources</span>
                {headlineSources(brief.headline.citations).map(s => s.target ? (
                  <button key={s.label} type="button" onClick={() => navigate(s.target!)}
                    className="text-[10px] font-mono text-dim rounded-[5px] px-1.5 py-0.5 bg-raised hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                    style={{ border: '1px solid var(--color-border)' }} title={s.title}>
                    {s.label}
                  </button>
                ) : (
                  <span key={s.label} className="text-[10px] font-mono text-faint rounded-[5px] px-1.5 py-0.5 bg-raised"
                    style={{ border: '1px solid var(--color-border)' }} title={s.title}>
                    {s.label}
                  </span>
                ))}
              </span>
            )}
          </div>

          {/* Tasks — the grounded paragraph, verbatim from the task-summary core. */}
          {brief.tasks.status === 'ok' && brief.tasks.paragraph && (
            <div className="text-[13px] leading-relaxed text-dim">
              <StreamRenderer text={brief.tasks.paragraph} streaming={false} citationIndex={citationIndex} onCite={() => navigate('/app/tasks')} />
            </div>
          )}
          {brief.tasks.status === 'error' && (
            <p className="text-[12px] text-faint italic" title={brief.tasks.detail}>Task synthesis unavailable right now.</p>
          )}

          {/* News — top matched stories. */}
          {brief.news.items.length > 0 && (
            <ul className="flex flex-col gap-1">
              {brief.news.items.map(n => (
                <li key={n.urlHash} className="flex items-center gap-2 text-[12.5px] min-w-0">
                  <span aria-hidden="true" className="w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--color-accent)' }} />
                  <button type="button" onClick={() => navigate('/app/news')}
                    className="truncate text-left text-dim hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
                    {n.title}
                  </button>
                  {n.matchedCarrier && <Badge label="About you" color="purple" className="text-[9.5px] shrink-0" />}
                  <span className="text-[10.5px] text-faint shrink-0 ml-auto">{n.source}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Metrics + enrichment — deterministic counts; the stub is labeled, never broken. */}
          <div className="flex flex-col gap-1 text-[11.5px] text-faint">
            {brief.metrics.deterministic && (
              <span>
                {[
                  brief.metrics.deterministic.products !== null ? `${brief.metrics.deterministic.products} products` : null,
                  brief.metrics.deterministic.coverages !== null ? `${brief.metrics.deterministic.coverages} coverages` : null,
                  brief.metrics.deterministic.openTasks !== null ? `${brief.metrics.deterministic.openTasks} open tasks` : null,
                  brief.metrics.deterministic.versions7d !== null ? `${brief.metrics.deterministic.versions7d} edits this week` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            )}
            {brief.metrics.enrichment.status === 'ok' ? (
              <ul className="flex flex-col gap-0.5">
                {brief.metrics.enrichment.items.map((it, i) => (
                  <li key={i} className="truncate">
                    {it.url
                      ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="hover:text-dim hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">{it.text}</a>
                      : it.text}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="italic" title={brief.metrics.enrichment.detail}>
                Public carrier signal: no public source resolved.
              </span>
            )}
          </div>

          <span className="text-[10px] text-faint">Generated {new Date(brief.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · cached for today</span>
        </div>
      ) : null}
    </section>
  )
}
