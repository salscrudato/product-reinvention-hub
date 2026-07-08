// News (/app/news) — a market-news feed curated by the nightly agent, plus a
// natural-language preference box (stored per user as newsPrefs) and a manual
// "Refresh now" for on-demand fetches.
//
// Items are ranked by portfolio relevance: LOB name/keyword matches score +3,
// each matching state scores +2, and server-assigned relatedProductIds score +4.
// Within the same score tier, more-recent items appear first.
// Provenance badges on each card show which LOBs and states triggered the match.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconNews, IconRefresh, IconExternalLink, IconSparkle, IconProduct, IconStates, IconFilter } from '../components/ui/icons'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Button, Skeleton, EmptyState } from '../components/ui'
import { useLiveCollection } from '../lib/useLiveCollection'
import type { News as NewsType, NewsPrefs, Product } from '@pf/shared'

type NewsDoc = NewsType & { id: string }

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v
  const o = v as { toDate?: () => Date; seconds?: number }
  if (o && typeof o.toDate === 'function') return o.toDate().getTime()
  if (o && typeof o.seconds === 'number') return o.seconds * 1000
  return 0
}

// ─── Portfolio-aware relevance scoring ──────────────────────────────────────

// US state code → full name for unambiguous text matching in news bodies.
const STATE_NAMES: Record<string, string> = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia',
  HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa',
  KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland',
  MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri',
  MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey',
  NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio',
  OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont',
  VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming',
  DC:'District of Columbia',
}

// LOB keyword expansions beyond the bare LOB name (keyed by the refId prefix).
const LOB_KEYWORDS: Record<string, string[]> = {
  HO: ['homeowners', 'homeowner', 'ho-3', 'ho3', 'dwelling', 'renters', 'property insurance', 'home insurance'],
  GL: ['general liability', 'cgl', 'commercial general liability', 'business liability'],
}

// The shared baseline every user starts from — what the agent should always pull. A
// user's own edit refines it, but everyone begins from the same instruction.
const BASE_NEWS_INSTRUCTION =
  'Track U.S. P&C insurance market developments: rate filings and approvals, competitor product and endorsement launches, regulatory and legislative changes, catastrophe and reinsurance trends, and distribution / insurtech moves — with emphasis on Homeowners (HO) and commercial General Liability (GL).'

// Natural-language article filter: keep items containing every significant word in the
// phrase (case-insensitive, stop-words dropped). Empty phrase → keep everything.
const STOP = new Set(['the','a','an','and','or','for','to','of','in','on','with','is','are','by','at','about','me','show','only','news','article','articles','that'])
function nlMatch(text: string, phrase: string): boolean {
  const terms = phrase.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOP.has(w))
  if (terms.length === 0) return true
  const hay = text.toLowerCase()
  return terms.every(t => hay.includes(t))
}

interface RelevanceResult {
  score:  number
  lobs:   string[]  // matched LOB names shown in provenance row
  states: string[]  // matched state codes shown in provenance row
}

/** Score a news item against the PM's product portfolio.
 *  Returns the score and the reasons (LOBs + states) that contributed to it. */
function computeRelevance(
  item: NewsDoc,
  products: (Product & { id: string })[],
): RelevanceResult {
  if (products.length === 0) return { score: 0, lobs: [], states: [] }

  const rawText = `${item.title} ${item.summary} ${(item.tags ?? []).join(' ')}`
  const lower   = rawText.toLowerCase()
  let score = 0
  const matchedLobs   = new Set<string>()
  const matchedStates = new Set<string>()

  for (const product of products) {
    const lobName   = product.lob.name.toLowerCase()
    const lobPrefix = (product.lob.refId ?? '').split('.')[0] ?? ''
    const extras    = LOB_KEYWORDS[lobPrefix] ?? []

    // LOB match: the bare LOB name or any known expansion keyword appears in the text.
    if (lower.includes(lobName) || extras.some(kw => lower.includes(kw))) {
      score += 3
      matchedLobs.add(product.lob.name)
    }

    // State match: full state name (unambiguous) OR uppercase word-boundary code.
    const productStates = product.allStates ? [] : (product.states ?? [])
    for (const code of productStates) {
      const fullName = STATE_NAMES[code]?.toLowerCase() ?? ''
      if (
        (fullName && lower.includes(fullName)) ||
        new RegExp(`\\b${code}\\b`).test(rawText)
      ) {
        score += 2
        matchedStates.add(code)
      }
    }

    // Server-assigned relatedProductIds — the nightly agent already matched this item
    // to a specific product via LOB/state analysis; a direct hit is the strongest signal.
    if ((item.relatedProductIds ?? []).includes(product.id)) {
      score += 4
      matchedLobs.add(product.lob.name)
    }
  }

  return { score, lobs: [...matchedLobs], states: [...matchedStates] }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function News() {
  const { user } = useUser()
  const [items, setItems]             = useState<NewsDoc[] | null>(null)
  const [instruction, setInstr]       = useState(BASE_NEWS_INSTRUCTION)
  const [savedInstr, setSaved]        = useState(BASE_NEWS_INSTRUCTION)
  const [refreshing, setRefreshing]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [savedRev, setSavedRev]       = useState<number | undefined>(undefined)   // B9: rev of the stored pref
  const [query, setQuery]             = useState('')
  const [nlFilter, setNlFilter]       = useState('')

  const products = useLiveCollection<Product>('products')

  useEffect(() => {
    const u1 = adapter.db.subscribe<NewsDoc>('news', d => { if (Array.isArray(d)) setItems(d) })
    let u2: (() => void) | undefined
    if (user) {
      u2 = adapter.db.subscribe<NewsPrefs & { rev?: number }>(`newsPrefs/${user.uid}`, d => {
        // Fall back to the shared baseline so everyone starts from the same instruction.
        if (d && !Array.isArray(d)) {
          const instr = d.instruction?.trim() ? d.instruction : BASE_NEWS_INSTRUCTION
          setInstr(instr); setSaved(instr)
          setSavedRev(d.rev)   // B9: track rev so the next save can guard against a lost update
        }
      })
    }
    return () => { u1(); u2?.() }
  }, [user])

  // Rank by portfolio relevance score (desc), then recency (desc) as tiebreaker.
  // Re-runs whenever products load so the initial empty-portfolio pass (score=0,
  // pure recency order) is replaced by a scored sort as soon as products arrive.
  const ranked = useMemo(() => {
    return (items ?? [])
      .map(item => ({ ...item, rel: computeRelevance(item, products.items) }))
      .sort((a, b) =>
        b.rel.score !== a.rel.score
          ? b.rel.score - a.rel.score
          : toMillis(b.fetchedAt) - toMillis(a.fetchedAt),
      )
  }, [items, products.items])

  const displayed = useMemo(() => {
    let list = ranked
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(n =>
        n.title.toLowerCase().includes(q) ||
        (n.summary ?? '').toLowerCase().includes(q) ||
        (n.source ?? '').toLowerCase().includes(q) ||
        (n.tags ?? []).some((t: string) => t.toLowerCase().includes(q)),
      )
    }
    if (nlFilter.trim()) {
      list = list.filter(n => nlMatch(`${n.title} ${n.summary ?? ''} ${(n.tags ?? []).join(' ')}`, nlFilter))
    }
    return list
  }, [ranked, query, nlFilter])

  async function savePrefs() {
    if (!user) return
    setSaving(true)
    try {
      await adapter.db.mutate({
        op:          savedInstr ? 'update' : 'create',
        path:        `newsPrefs/${user.uid}`,
        data:        { instruction: instruction.trim() },
        entityType:  'newsPrefs',
        actor:       { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        expectedRev: savedRev,   // B9: guard the update against a lost update (undefined on first save → no-op)
      })
      setSaved(instruction.trim())
      toast.success('Tracking preference saved')
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Could not save preference')
    } finally {
      setSaving(false)
    }
  }

  async function refresh() {
    setRefreshing(true)
    try {
      const r = await adapter.fns.call<Record<string, never>, { found: number; stored: number; error?: string }>('refreshNews', {})
      if (r.error) toast.error(r.error)
      else toast.success(`Found ${r.found}, added ${r.stored} new item${r.stored === 1 ? '' : 's'}`)
    } catch {
      toast.error('Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  const unsaved = instruction.trim() !== savedInstr

  return (
    <div className="flex flex-col gap-5">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Market News</h1>
          <p className="text-sm text-dim">Curated nightly by an AI agent and ranked against your portfolio.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Title / summary typeahead */}
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search news…"
              aria-label="Search news by title, summary, or tag"
              className="h-8 pl-3 pr-7 rounded-[9px] bg-surface border text-sm text-text placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 w-48"
              style={{ borderColor: query ? 'var(--color-accent)' : 'var(--color-border-strong)' }}
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-text transition-colors">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 1l8 8M9 1L1 9"/></svg>
              </button>
            )}
          </div>
          <Button variant="default" size="sm" onClick={refresh} disabled={refreshing} aria-label="Refresh news feed now">
            <IconRefresh size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            {refreshing ? 'Fetching…' : 'Refresh now'}
          </Button>
        </div>
      </div>

      {/* Preference box */}
      <div
        className="bg-surface rounded-[14px] p-4 flex flex-col gap-2"
        style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      >
        <label htmlFor="news-instr" className="flex items-center gap-1.5 text-sm font-medium text-text">
          <IconSparkle size={14} className="text-accent" aria-hidden="true" />
          What should the agent track?
        </label>
        <textarea
          id="news-instr"
          value={instruction}
          onChange={e => setInstr(e.target.value)}
          rows={2}
          placeholder="e.g. Track competitor HO-3 launches and GL rate filings in TX and FL"
          className="rounded-[10px] bg-surface border text-sm text-text p-3 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none"
          style={{ borderColor: 'var(--color-border-strong)' }}
          aria-label="News tracking instruction"
          aria-describedby="news-instr-hint"
        />
        <div className="flex items-center justify-between gap-2">
          <p id="news-instr-hint" className="text-xs text-faint">
            Starts from a shared baseline — your edits refine what the nightly agent pulls, alongside your portfolio ({products.items.length} product{products.items.length === 1 ? '' : 's'}).
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {instruction.trim() !== BASE_NEWS_INSTRUCTION && (
              <button onClick={() => setInstr(BASE_NEWS_INSTRUCTION)} className="text-xs text-dim hover:text-accent transition-colors">Reset to baseline</button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={savePrefs}
              disabled={!instruction.trim() || !unsaved || saving}
              aria-label="Save news tracking preference"
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        {/* Natural-language article filter — narrows the feed below without re-fetching */}
        <div className="flex flex-col gap-1.5 pt-3 mt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
          <label htmlFor="news-nl-filter" className="flex items-center gap-1.5 text-sm font-medium text-text">
            <IconFilter size={14} className="text-accent" aria-hidden="true" />
            Filter articles (natural language)
          </label>
          <input
            id="news-nl-filter"
            value={nlFilter}
            onChange={e => setNlFilter(e.target.value)}
            placeholder="e.g. Florida rate hikes and reinsurance"
            className="h-9 rounded-[10px] bg-surface border text-sm text-text px-3 focus:outline-none focus:ring-2 focus:ring-accent/25"
            style={{ borderColor: nlFilter ? 'var(--color-accent)' : 'var(--color-border-strong)' }}
            aria-describedby="news-nl-hint"
          />
          <p id="news-nl-hint" className="text-xs text-faint">
            {nlFilter.trim()
              ? `Showing ${displayed.length} of ${ranked.length} articles matching “${nlFilter.trim()}”.`
              : 'Type a phrase — only articles mentioning every key word are shown.'}
          </p>
        </div>
      </div>

      {/* Feed */}
      {items === null ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : displayed.length === 0 ? (
        <EmptyState
          icon={<IconNews size={28} />}
          title={query ? 'No results' : 'No news yet'}
          description={query ? `No items match "${query}".` : 'A nightly agent (06:00 ET) searches the web for your tracking instruction and files what it finds here. Set a preference above, then use "Refresh now" to fetch immediately.'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" role="feed" aria-label="Market news feed">
          {displayed.map(n => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="group relative bg-surface rounded-[16px] overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 border border-[color:var(--color-border)] shadow-[var(--shadow-card)] hover:border-[color:var(--color-accent-line)] hover:shadow-[0_16px_36px_-14px_var(--glow-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label={`${n.title} — ${n.source || 'Web'}`}
            >
              {/* Brand rail */}
              <span aria-hidden="true" className="block h-[3px] w-full opacity-70 group-hover:opacity-100 transition-opacity"
                style={{ background: 'linear-gradient(90deg, var(--color-accent-bright) 0%, var(--color-accent-strong) 60%, transparent 100%)' }} />

              <div className="p-4 flex flex-col gap-2 flex-1">
                {/* Meta row: source · date · portfolio-match · external-link */}
                <div className="flex items-center gap-2 text-xs text-faint">
                  <span className="font-medium text-dim truncate max-w-[45%]">{n.source || 'Web'}</span>
                  {n.fetchedAt ? (
                    <><span aria-hidden="true">·</span><time dateTime={new Date(toMillis(n.fetchedAt)).toISOString()}>{new Date(toMillis(n.fetchedAt)).toLocaleDateString()}</time></>
                  ) : null}
                  {n.rel.score > 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                      style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }} title="Matches your portfolio">
                      <IconProduct size={9} aria-hidden="true" /> Match
                    </span>
                  )}
                  <IconExternalLink size={12} className={`${n.rel.score > 0 ? '' : 'ml-auto'} opacity-0 group-hover:opacity-100 transition-opacity shrink-0`} aria-hidden="true" />
                </div>

                {/* Title */}
                <h3 className="text-[15px] font-semibold text-text group-hover:text-accent transition-colors leading-snug line-clamp-2">
                  {n.title}
                </h3>

                {/* Summary — clamped so cards stay even */}
                {n.summary && (
                  <p className="text-[13px] text-dim leading-relaxed line-clamp-3">{n.summary}</p>
                )}

                {/* Footer — just-enough metadata: match reasons + up to 3 tags */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mt-auto pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                  {n.rel.lobs.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-faint">
                      <IconProduct size={9} aria-hidden="true" />{n.rel.lobs.join(', ')}
                    </span>
                  )}
                  {n.rel.states.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-faint">
                      <IconStates size={9} aria-hidden="true" />{n.rel.states.slice(0, 3).join(' · ')}{n.rel.states.length > 3 ? '…' : ''}
                    </span>
                  )}
                  {(n.tags ?? []).slice(0, 3).map((t: string) => <Badge key={t} label={t} color="purple" />)}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
