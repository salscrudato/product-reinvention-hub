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
import { IconNews, IconRefresh, IconExternalLink, IconSparkle, IconProduct, IconStates } from '../components/ui/icons'
import { adapter } from '../lib/backend'
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
  const [instruction, setInstr]       = useState('')
  const [savedInstr, setSaved]        = useState('')
  const [refreshing, setRefreshing]   = useState(false)
  const [saving, setSaving]           = useState(false)

  const products = useLiveCollection<Product>('products')

  useEffect(() => {
    const u1 = adapter.db.subscribe<NewsDoc>('news', d => { if (Array.isArray(d)) setItems(d) })
    let u2: (() => void) | undefined
    if (user) {
      u2 = adapter.db.subscribe<NewsPrefs>(`newsPrefs/${user.uid}`, d => {
        if (d && !Array.isArray(d)) { setInstr(d.instruction ?? ''); setSaved(d.instruction ?? '') }
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

  async function savePrefs() {
    if (!user) return
    setSaving(true)
    try {
      await adapter.db.mutate({
        op:         savedInstr ? 'update' : 'create',
        path:       `newsPrefs/${user.uid}`,
        data:       { instruction: instruction.trim() },
        entityType: 'newsPrefs',
        actor:      { uid: user.uid, name: user.name ?? user.email ?? 'User' },
      })
      setSaved(instruction.trim())
      toast.success('Tracking preference saved')
    } catch {
      toast.error('Could not save preference')
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
    <div className="flex flex-col gap-5 max-w-3xl">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Market News</h1>
          <p className="text-sm text-dim">Curated nightly by an AI agent and ranked against your portfolio.</p>
        </div>
        <Button variant="default" size="sm" onClick={refresh} disabled={refreshing} aria-label="Refresh news feed now">
          <IconRefresh size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          {refreshing ? 'Fetching…' : 'Refresh now'}
        </Button>
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
            Used alongside your portfolio ({products.items.length} product{products.items.length === 1 ? '' : 's'}) to tailor each fetch.
          </p>
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

      {/* Feed */}
      {items === null ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : ranked.length === 0 ? (
        <EmptyState
          icon={<IconNews size={28} />}
          title="No news yet"
          description={'A nightly agent (06:00 ET) searches the web for your tracking instruction and files what it finds here. Set a preference above, then use “Refresh now” to fetch immediately.'}
        />
      ) : (
        <div className="flex flex-col gap-3" role="feed" aria-label="Market news feed">
          {ranked.map(n => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="group bg-surface rounded-[14px] p-4 flex flex-col gap-2 transition-all hover:shadow-[var(--shadow-card-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
              aria-label={`${n.title} — ${n.source || 'Web'}`}
            >
              {/* Meta row: source · date · portfolio-match badge · external-link icon */}
              <div className="flex items-center gap-2 text-xs text-faint">
                <span className="font-medium text-dim">{n.source || 'Web'}</span>
                {n.fetchedAt
                  ? <><span aria-hidden="true">·</span><time dateTime={new Date(toMillis(n.fetchedAt)).toISOString()}>{new Date(toMillis(n.fetchedAt)).toLocaleDateString()}</time></>
                  : null}
                {n.rel.score > 0 && (
                  <span
                    className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] text-[10px] font-medium"
                    style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
                    title="Matches your portfolio"
                  >
                    <IconProduct size={9} aria-hidden="true" />
                    Portfolio match
                  </span>
                )}
                <IconExternalLink size={12} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
              </div>

              {/* Title */}
              <h3 className="text-sm font-semibold text-text group-hover:text-accent transition-colors leading-snug">
                {n.title}
              </h3>

              {/* Summary */}
              {n.summary && (
                <p className="text-sm text-dim leading-relaxed">{n.summary}</p>
              )}

              {/* Provenance row — which LOBs and states in the portfolio triggered this match */}
              {(n.rel.lobs.length > 0 || n.rel.states.length > 0) && (
                <div
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5"
                  role="list"
                  aria-label="Portfolio match reasons"
                >
                  {n.rel.lobs.length > 0 && (
                    <span
                      role="listitem"
                      className="inline-flex items-center gap-1 text-[10px] text-faint"
                    >
                      <IconProduct size={9} aria-hidden="true" />
                      {n.rel.lobs.join(', ')}
                    </span>
                  )}
                  {n.rel.lobs.length > 0 && n.rel.states.length > 0 && (
                    <span className="text-[10px] text-faint" aria-hidden="true">·</span>
                  )}
                  {n.rel.states.length > 0 && (
                    <span
                      role="listitem"
                      className="inline-flex items-center gap-1 text-[10px] text-faint"
                    >
                      <IconStates size={9} aria-hidden="true" />
                      {n.rel.states.join(' · ')}
                    </span>
                  )}
                </div>
              )}

              {/* Tags */}
              {(n.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {n.tags.map(t => <Badge key={t} label={t} color="purple" />)}
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
