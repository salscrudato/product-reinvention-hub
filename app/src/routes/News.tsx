// News (/app/news) — a single-column, X-style intelligence feed for insurance product
// managers. The nightly agent (06:00 ET) curates market items; a "Refresh now" (ADMIN)
// fetches on demand. Items are RANKED against the PM's portfolio: LOB name/keyword
// matches score +3, each matching state +2, server-assigned relatedProductIds +4; within
// a score tier the more-recent item wins. That scoring drives the "For You" tab and the
// per-card relevance indicator + "Why this matched" affordance.
//
// Three tabs: For You (portfolio relevance desc), Latest (recency desc), Pinned. Pins are
// PERSONAL content — they persist to newsPrefs.pinnedHashes via a narrow owner write
// (adapter.db.setNewsPins), NOT the mutate() envelope. The agent instruction lives in the
// same newsPrefs doc and still saves via mutate() (its long-standing path). All backend
// access goes through the adapter seam — the app never imports firebase/* directly.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  IconNews, IconRefresh, IconExternalLink, IconSparkle, IconProduct, IconStates,
  IconSearch, IconClose, IconSettings, IconStar, IconCopy, IconInfo, IconPricing,
  IconForm, IconPeril, IconLayers, IconHome, IconRule, IconEndorsement,
  type IconType,
} from '../components/ui/icons'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Button, Card, Drawer, RefChip, Skeleton, EmptyState, Tabs } from '../components/ui'
import { useLiveCollection } from '../lib/useLiveCollection'
import type { News as NewsType, NewsPrefs, Product } from '@pf/shared'

type NewsDoc  = NewsType & { id: string }
type ProductDoc = Product & { id: string }

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v
  const o = v as { toDate?: () => Date; seconds?: number }
  if (o && typeof o.toDate === 'function') return o.toDate().getTime()
  if (o && typeof o.seconds === 'number') return o.seconds * 1000
  return 0
}

// ─── Portfolio-aware relevance scoring (preserved verbatim) ─────────────────────

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
  PA: ['personal auto', 'auto insurance', 'automobile', 'private passenger auto', 'car insurance', 'pp 00 01', 'motor'],
}

// The shared baseline every user starts from — what the agent should always pull. A
// user's own edit refines it, but everyone begins from the same instruction.
const BASE_NEWS_INSTRUCTION =
  'Track U.S. P&C insurance market developments: rate filings and approvals, competitor product and endorsement launches, regulatory and legislative changes, catastrophe and reinsurance trends, and distribution / insurtech moves — with emphasis on Homeowners (HO) and Personal Auto (PA).'

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
  products: ProductDoc[],
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

// ─── Feed helpers ───────────────────────────────────────────────────────────────

// An item enriched with its portfolio relevance + the names of any directly-linked
// products (for the grounded "Why this matched" panel).
type FeedItem = NewsDoc & { rel: RelevanceResult; matchedProducts: string[] }

const byScoreThenRecency = (a: FeedItem, b: FeedItem) =>
  b.rel.score !== a.rel.score ? b.rel.score - a.rel.score : toMillis(b.fetchedAt) - toMillis(a.fetchedAt)
const byRecency = (a: FeedItem, b: FeedItem) => toMillis(b.fetchedAt) - toMillis(a.fetchedAt)

// Stable per-item pin key — the SHA-1 url hash (which is also the doc id).
const pinKey = (n: NewsDoc) => n.urlHash || n.id

/** Relative timestamp: "2h", "yesterday", then an absolute date past a week. */
function relTime(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR
  if (diff < MIN)      return 'now'
  if (diff < HR)       return `${Math.floor(diff / MIN)}m`
  if (diff < DAY)      return `${Math.floor(diff / HR)}h`
  if (diff < 2 * DAY)  return 'yesterday'
  if (diff < 7 * DAY)  return `${Math.floor(diff / DAY)}d`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Coarse relevance tier for the subtle per-card indicator. */
function relevanceTier(score: number): 'High' | 'Med' | 'Low' | null {
  if (score >= 6) return 'High'
  if (score >= 3) return 'Med'
  if (score > 0)  return 'Low'
  return null
}

// Token-only brand gradients for the generated hero (no raw hex; keyed by source hash).
const HERO_GRADIENTS = [
  'linear-gradient(135deg, var(--color-gtm-phase-1) 0%, var(--color-accent-strong) 100%)',
  'linear-gradient(135deg, var(--color-gtm-phase-2) 0%, var(--color-accent) 100%)',
  'linear-gradient(135deg, var(--color-accent-bright) 0%, var(--color-gtm-phase-3) 100%)',
  'linear-gradient(135deg, var(--color-gtm-phase-3) 0%, var(--color-accent-strong) 100%)',
  'linear-gradient(135deg, var(--color-accent) 0%, var(--color-gtm-phase-2) 100%)',
  'linear-gradient(135deg, var(--color-gtm-phase-4) 0%, var(--color-gtm-phase-3) 100%)',
]

// Deterministic, order-independent string hash for a stable fallback visual per source.
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Leading-tag → category glyph for the generated hero. Falls back to the news mark.
const CATEGORY_GLYPHS: { test: RegExp; Icon: IconType }[] = [
  { test: /rate|filing|pricing|premium/i,                        Icon: IconPricing },
  { test: /regul|legis|complian|bulletin|statut|law/i,           Icon: IconForm },
  { test: /cat|wind|hail|hurricane|storm|flood|wildfire|climate/i, Icon: IconPeril },
  { test: /reinsur|capital|capacity/i,                           Icon: IconLayers },
  { test: /home|property|dwelling|roof/i,                        Icon: IconHome },
  { test: /rule|underwrit|eligib/i,                              Icon: IconRule },
  { test: /insurtech|tech|digital|platform|distribut/i,          Icon: IconSparkle },
  { test: /product|launch|endorse|coverage|auto|vehicle/i,       Icon: IconEndorsement },
]
function glyphForTag(tag?: string): IconType {
  if (tag) for (const g of CATEGORY_GLYPHS) if (g.test.test(tag)) return g.Icon
  return IconNews
}

// ISO form number (HO 04 90, PP 00 01) — the load-bearing display token that stays a
// monospaced chip even when it surfaces as a news tag. (Distinct from plain word tags.)
const FORM_NUMBER = /^[A-Z]{1,4}(?:\s\d{2}){2,3}$/

// ─── Hero media (image with a never-broken generated fallback) ──────────────────

function HeroMedia({ item }: { item: FeedItem }) {
  const [failed, setFailed] = useState(false)
  const alt = item.imageAlt || item.title

  if (item.imageUrl && !failed) {
    return (
      <img
        src={item.imageUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="w-full aspect-video max-h-[360px] object-cover bg-raised"
      />
    )
  }

  // Deterministic fallback: a brand gradient keyed to the source + a category glyph.
  const Glyph = glyphForTag(item.tags?.[0])
  const grad  = HERO_GRADIENTS[hashString(item.source || item.title) % HERO_GRADIENTS.length]
  return (
    <div
      role="img"
      aria-label={alt}
      className="w-full aspect-video max-h-[360px] flex flex-col items-center justify-center gap-2 select-none"
      style={{ background: grad }}
    >
      <Glyph size={46} strokeWidth={1.3} className="text-white" aria-hidden="true" />
      {item.source && (
        <span className="text-white opacity-80 text-xs font-medium tracking-wide px-6 text-center line-clamp-1">
          {item.source}
        </span>
      )}
    </div>
  )
}

// ─── News card ──────────────────────────────────────────────────────────────────

const ACTION_BTN =
  'inline-flex items-center gap-1.5 text-xs font-medium text-dim hover:text-accent rounded-[8px] px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

function NewsCard({
  item, pinned, onTogglePin, onCopy,
}: {
  item: FeedItem
  pinned: boolean
  onTogglePin: (hash: string) => void
  onCopy: (url: string) => void
}) {
  const [whyOpen, setWhyOpen] = useState(false)
  const whyId = useId()
  const headingId = useId()
  const hash  = pinKey(item)
  const ms    = toMillis(item.fetchedAt)
  const tier  = relevanceTier(item.rel.score)
  const bullets = (item.bullets ?? []).filter(b => b && b.trim())
  const tags = (item.tags ?? []).slice(0, 5)

  return (
    <article
      aria-labelledby={headingId}
      className="group bg-surface rounded-[16px] overflow-hidden flex flex-col border border-[color:var(--color-border)] shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--color-accent-line)] hover:shadow-[var(--shadow-card-hover)]"
    >
      <HeroMedia item={item} />

      <div className="p-4 sm:p-5 flex flex-col gap-2.5">
        {/* Header row: source · relative time · relevance · pin */}
        <div className="flex items-center gap-2 text-xs text-faint">
          <span className="font-semibold text-dim truncate max-w-[45%]">{item.source || 'Web'}</span>
          {ms > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={new Date(ms).toISOString()} title={new Date(ms).toLocaleString()}>{relTime(ms)}</time>
            </>
          )}
          {tier && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
              title={`Portfolio relevance: ${tier} (score ${item.rel.score})`}
            >
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent" />
              {tier}
            </span>
          )}
          <button
            onClick={() => onTogglePin(hash)}
            aria-pressed={pinned}
            aria-label={pinned ? 'Unpin article' : 'Pin article'}
            title={pinned ? 'Unpin' : 'Pin'}
            className="ml-auto shrink-0 p-1 rounded-[8px] hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <IconStar size={16} className={pinned ? 'text-accent fill-current' : 'text-faint'} aria-hidden="true" />
          </button>
        </div>

        {/* Headline — the primary open-source link */}
        <h3 id={headingId} className="text-[17px] font-bold leading-tight tracking-[-.014em]">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]"
          >
            {item.title}
          </a>
        </h3>

        {/* Three structured takeaways — legacy fallback to the summary paragraph */}
        {bullets.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-dim leading-relaxed">
                <span aria-hidden="true" className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-accent-line)' }} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : item.summary ? (
          <p className="text-[13px] text-dim leading-relaxed">{item.summary}</p>
        ) : null}

        {/* Applicability — LOB (accent) + state (neutral) chips; visually distinct from tags */}
        {(item.rel.lobs.length > 0 || item.rel.states.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {item.rel.lobs.map(lob => (
              <span key={lob} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
                <IconProduct size={11} aria-hidden="true" />{lob}
              </span>
            ))}
            {item.rel.states.slice(0, 6).map(code => (
              <span key={code} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-raised text-dim">
                <IconStates size={11} aria-hidden="true" />{code}
              </span>
            ))}
            {item.rel.states.length > 6 && (
              <span className="text-[11px] text-faint">+{item.rel.states.length - 6}</span>
            )}
          </div>
        )}

        {/* Topical tags — secondary weight; a form-number tag keeps its mono chip */}
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map(t =>
              FORM_NUMBER.test(t)
                ? <RefChip key={t} id={t} />
                : <Badge key={t} label={t} color="default" />,
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-1 mt-1 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <a href={item.url} target="_blank" rel="noopener noreferrer" className={ACTION_BTN} aria-label={`Open source at ${item.source || 'the publisher'} (opens in a new tab)`}>
            <IconExternalLink size={13} aria-hidden="true" />Open source
          </a>
          <button onClick={() => onTogglePin(hash)} className={ACTION_BTN} aria-pressed={pinned} aria-label={pinned ? 'Unpin article' : 'Pin article'}>
            <IconStar size={13} className={pinned ? 'fill-current' : ''} aria-hidden="true" />{pinned ? 'Pinned' : 'Pin'}
          </button>
          <button onClick={() => onCopy(item.url)} className={ACTION_BTN} aria-label="Copy article link">
            <IconCopy size={13} aria-hidden="true" />Copy link
          </button>
          {item.rel.score > 0 && (
            <button
              onClick={() => setWhyOpen(o => !o)}
              className={`${ACTION_BTN} ml-auto`}
              aria-expanded={whyOpen}
              aria-controls={whyId}
            >
              <IconInfo size={13} aria-hidden="true" />Why this matched
            </button>
          )}
        </div>

        {/* Why this matched — the grounded signal breakdown */}
        {whyOpen && item.rel.score > 0 && (
          <div id={whyId} className="flex flex-col gap-1.5 rounded-[10px] bg-page p-3 text-[12px]" style={{ border: '1px solid var(--color-border)' }}>
            {item.rel.lobs.length > 0 && (
              <div className="flex items-start gap-2 text-dim">
                <IconProduct size={13} className="mt-0.5 text-accent shrink-0" aria-hidden="true" />
                <span><span className="font-medium text-text">Lines of business:</span> {item.rel.lobs.join(', ')}</span>
              </div>
            )}
            {item.rel.states.length > 0 && (
              <div className="flex items-start gap-2 text-dim">
                <IconStates size={13} className="mt-0.5 text-accent shrink-0" aria-hidden="true" />
                <span><span className="font-medium text-text">Footprint states:</span> {item.rel.states.join(', ')}</span>
              </div>
            )}
            {item.matchedProducts.length > 0 && (
              <div className="flex items-start gap-2 text-dim">
                <IconSparkle size={13} className="mt-0.5 text-accent shrink-0" aria-hidden="true" />
                <span><span className="font-medium text-text">Linked product{item.matchedProducts.length === 1 ? '' : 's'}:</span> {item.matchedProducts.join(', ')}</span>
              </div>
            )}
            <p className="text-faint pt-0.5">Relevance score {item.rel.score} · ranks this item in your For You feed.</p>
          </div>
        )}
      </div>
    </article>
  )
}

// ─── Loading skeleton (mirrors the card silhouette) ─────────────────────────────

function FeedSkeleton() {
  return (
    <div className="bg-surface rounded-[16px] overflow-hidden border border-[color:var(--color-border)] shadow-[var(--shadow-card)]">
      <Skeleton className="w-full aspect-video max-h-[360px]" rounded="rounded-none" />
      <div className="p-5 flex flex-col gap-2.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  )
}

// ─── Feed-settings drawer ────────────────────────────────────────────────────────

function FeedSettingsDrawer({
  open, onClose, instruction, onInstrChange, onSave, saving, unsaved, onBaseline,
  portfolio, topTags, onPickTopic, isAdmin, onRefresh, refreshing, canSave,
}: {
  open: boolean
  onClose: () => void
  instruction: string
  onInstrChange: (v: string) => void
  onSave: () => void
  saving: boolean
  unsaved: boolean
  onBaseline: () => void
  portfolio: { productCount: number; lobs: string[]; stateCount: number; allStates: boolean }
  topTags: string[]
  onPickTopic: (t: string) => void
  isAdmin: boolean
  onRefresh: () => void
  refreshing: boolean
  canSave: boolean
}) {
  return (
    <Drawer open={open} onClose={onClose} title="Feed settings" width="w-[400px]">
      <div className="flex flex-col gap-6">
        {/* Agent tracking instruction — saved via mutate() (its long-standing path) */}
        <section className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
              <IconSparkle size={14} className="text-accent" aria-hidden="true" />
              Agent tracking
            </h3>
            <p className="text-xs text-faint">Plain-English brief for the nightly agent.</p>
          </div>
          <textarea
            id="news-instr"
            value={instruction}
            onChange={e => onInstrChange(e.target.value)}
            rows={6}
            placeholder="e.g. Track competitor HO-3 launches and personal auto rate filings in TX and FL"
            className="rounded-[10px] bg-surface border text-[13px] leading-relaxed text-text p-3 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none"
            style={{ borderColor: unsaved ? 'var(--color-accent)' : 'var(--color-border-strong)' }}
            aria-label="News tracking instruction"
            aria-describedby="news-instr-hint"
          />
          <p id="news-instr-hint" className="text-xs text-faint">
            Refines the shared baseline alongside your portfolio.
          </p>
          <div className="flex items-center justify-between gap-2">
            {instruction.trim() !== BASE_NEWS_INSTRUCTION
              ? <button onClick={onBaseline} className="text-xs text-dim hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">Reset to baseline</button>
              : <span className="text-xs text-faint">{unsaved ? 'Unsaved changes' : 'On baseline'}</span>}
            <Button variant="primary" size="sm" onClick={onSave} disabled={!canSave || !instruction.trim() || !unsaved || saving} aria-label="Save news tracking preference">
              {saving ? 'Saving…' : unsaved ? 'Save' : 'Saved'}
            </Button>
          </div>
        </section>

        {/* Portfolio context — what your feed is ranked against */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text">Portfolio context</h3>
          <div className="rounded-[10px] bg-page p-3 text-[13px] text-dim flex flex-col gap-1.5" style={{ border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2">
              <IconProduct size={13} className="text-accent shrink-0" aria-hidden="true" />
              {portfolio.productCount} product{portfolio.productCount === 1 ? '' : 's'}
              {portfolio.lobs.length > 0 && <span className="text-faint">· {portfolio.lobs.length} line{portfolio.lobs.length === 1 ? '' : 's'}</span>}
            </div>
            <div className="flex items-center gap-2">
              <IconStates size={13} className="text-accent shrink-0" aria-hidden="true" />
              {portfolio.allStates ? 'Nationwide footprint' : `${portfolio.stateCount} state${portfolio.stateCount === 1 ? '' : 's'} in scope`}
            </div>
          </div>
        </section>

        {/* Popular topics — one tap populates the feed filter */}
        {topTags.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-text">Popular topics</h3>
            <div className="flex flex-wrap gap-1.5">
              {topTags.map(t => (
                <button
                  key={t}
                  onClick={() => onPickTopic(t)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium text-accent transition-colors hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  style={{ background: 'var(--color-accent-soft)' }}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ADMIN — on-demand fetch (mirrors the nightly agent) */}
        {isAdmin && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-text">Admin</h3>
            <Button variant="default" size="sm" onClick={onRefresh} disabled={refreshing} className="w-full" aria-label="Refresh news feed now">
              <IconRefresh size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
              {refreshing ? 'Fetching…' : 'Refresh now'}
            </Button>
            <p className="text-xs text-faint">Runs the scout immediately against your brief.</p>
          </section>
        )}
      </div>
    </Drawer>
  )
}

// ─── Right rail (lg+ context sidebar — the X-style companion column) ─────────────

function FeedRail({
  portfolio, matchCount, topTags, onPickTopic,
}: {
  portfolio: { productCount: number; lobs: string[]; stateCount: number; allStates: boolean }
  matchCount: number
  topTags: string[]
  onPickTopic: (t: string) => void
}) {
  return (
    <aside className="hidden lg:flex flex-col gap-4 lg:sticky lg:top-1 lg:self-start lg:pt-1 lg:pb-8" aria-label="Feed context">
      {/* Portfolio context — what the feed is ranked against */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text">Your portfolio</h2>
        <div className="flex flex-col gap-2 text-[13px] text-dim">
          <div className="flex items-center gap-2">
            <IconProduct size={14} className="text-accent shrink-0" aria-hidden="true" />
            {portfolio.productCount} product{portfolio.productCount === 1 ? '' : 's'}
            {portfolio.lobs.length > 0 && <span className="text-faint">· {portfolio.lobs.length} line{portfolio.lobs.length === 1 ? '' : 's'}</span>}
          </div>
          <div className="flex items-center gap-2">
            <IconStates size={14} className="text-accent shrink-0" aria-hidden="true" />
            {portfolio.allStates ? 'Nationwide footprint' : `${portfolio.stateCount} state${portfolio.stateCount === 1 ? '' : 's'} in scope`}
          </div>
        </div>
        {matchCount > 0 && <p className="text-xs text-faint">{matchCount} article{matchCount === 1 ? '' : 's'} match your portfolio.</p>}
      </Card>

      {/* Popular topics — one tap filters the feed */}
      {topTags.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text">Popular topics</h2>
          <div className="flex flex-wrap gap-1.5">
            {topTags.map(t => (
              <button
                key={t}
                onClick={() => onPickTopic(t)}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium text-accent transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                style={{ background: 'var(--color-accent-soft)' }}
              >
                {t}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* How the feed works */}
      <Card className="flex flex-col gap-1.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <IconSparkle size={14} className="text-accent" aria-hidden="true" />
          About this feed
        </h2>
        <p className="text-xs text-faint leading-relaxed">
          A nightly agent (06:00 ET) scans the market against your brief, then ranks it against your portfolio. Tune the brief in Feed settings.
        </p>
      </Card>
    </aside>
  )
}

// ─── Route ─────────────────────────────────────────────────────────────────────

type Tab = 'foryou' | 'latest' | 'pinned'
const PAGE = 24   // initial render cap; long feeds reveal more on demand

export default function News() {
  const { user } = useUser()
  const isAdmin = user?.role === 'ADMIN'

  const [items, setItems]           = useState<NewsDoc[] | null>(null)
  const [instruction, setInstr]     = useState(BASE_NEWS_INSTRUCTION)
  const [savedInstr, setSaved]      = useState(BASE_NEWS_INSTRUCTION)
  const [savedRev, setSavedRev]     = useState<number | undefined>(undefined)
  const [pinnedHashes, setPinned]   = useState<string[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [filter, setFilter]         = useState('')
  const [tab, setTab]               = useState<Tab>('foryou')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [visible, setVisible]       = useState(PAGE)
  // Mirrors savedInstr for the subscription closure (which captures stale state otherwise),
  // so a pin write — which also lands on newsPrefs — never wipes an unsaved instruction draft.
  const savedInstrRef = useRef(BASE_NEWS_INSTRUCTION)

  const products = useLiveCollection<Product>('products')

  useEffect(() => {
    const u1 = adapter.db.subscribe<NewsDoc>('news', d => { if (Array.isArray(d)) setItems(d) })
    let u2: (() => void) | undefined
    if (user) {
      u2 = adapter.db.subscribe<NewsPrefs & { rev?: number }>(`newsPrefs/${user.uid}`, d => {
        if (d && !Array.isArray(d)) {
          // Fall back to the shared baseline so everyone starts from the same instruction.
          const stored = d.instruction?.trim() ? d.instruction : BASE_NEWS_INSTRUCTION
          // Adopt the remote instruction only when there is no unsaved local edit — a pin
          // toggle fires this same listener, and it must not stomp a draft in the drawer.
          // Capture the prior saved value first: the setInstr updater runs after this block,
          // by which point the ref has already advanced to `stored`.
          const prevSaved = savedInstrRef.current
          setInstr(cur => (cur === prevSaved ? stored : cur))
          savedInstrRef.current = stored
          setSaved(stored)
          setSavedRev(d.rev)                 // rev guards the next instruction save
          setPinned(d.pinnedHashes ?? [])    // personal pins, mirrored live
        }
      })
    }
    return () => { u1(); u2?.() }
  }, [user])

  const pinnedSet = useMemo(() => new Set(pinnedHashes), [pinnedHashes])

  // Memoized scoring pass — enrich every item with relevance + linked-product names once.
  const enriched = useMemo<FeedItem[]>(() => {
    return (items ?? []).map(item => ({
      ...item,
      rel: computeRelevance(item, products.items),
      matchedProducts: products.items
        .filter(p => (item.relatedProductIds ?? []).includes(p.id))
        .map(p => p.name),
    }))
  }, [items, products.items])

  // Three orderings from the same enriched set (scoring weights preserved).
  const forYou = useMemo(() => [...enriched].sort(byScoreThenRecency), [enriched])
  const latest = useMemo(() => [...enriched].sort(byRecency), [enriched])
  const pinnedList = useMemo(
    () => enriched.filter(n => pinnedSet.has(pinKey(n))).sort(byRecency),
    [enriched, pinnedSet],
  )

  const activeList = tab === 'latest' ? latest : tab === 'pinned' ? pinnedList : forYou

  // Natural-language filter over title + summary + bullets + source + tags (within tab).
  const displayed = useMemo(() => {
    if (!filter.trim()) return activeList
    return activeList.filter(n =>
      nlMatch(`${n.title} ${n.summary ?? ''} ${(n.bullets ?? []).join(' ')} ${n.source ?? ''} ${(n.tags ?? []).join(' ')}`, filter),
    )
  }, [activeList, filter])

  // Reset the render cap whenever the view or filter changes.
  useEffect(() => { setVisible(PAGE) }, [tab, filter])
  const shown = displayed.slice(0, visible)
  const hasMore = displayed.length > visible

  const matchCount = useMemo(() => enriched.filter(n => n.rel.score > 0).length, [enriched])

  // Popular tags across the feed → one-tap topic chips in the drawer.
  const topTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const it of enriched) for (const t of it.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t)
  }, [enriched])

  const portfolio = useMemo(() => {
    const lobs = new Set<string>(), states = new Set<string>()
    let allStates = false
    for (const p of products.items) {
      lobs.add(p.lob.name)
      if (p.allStates) allStates = true
      for (const s of p.states ?? []) states.add(s)
    }
    return { productCount: products.items.length, lobs: [...lobs], stateCount: states.size, allStates }
  }, [products.items])

  async function savePrefs() {
    if (!user) return
    setSaving(true)
    try {
      // Instruction save keeps its long-standing mutate() path (audited pref change).
      await adapter.db.mutate({
        op:          savedInstr ? 'update' : 'create',
        path:        `newsPrefs/${user.uid}`,
        data:        { instruction: instruction.trim() },
        entityType:  'newsPrefs',
        actor:       { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        expectedRev: savedRev,
      })
      setSaved(instruction.trim())
      toast.success('Tracking preference saved')
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Could not save preference')
    } finally {
      setSaving(false)
    }
  }

  async function togglePin(hash: string) {
    if (!user) { toast.error('Sign in to pin articles'); return }
    const prev = pinnedHashes
    const next = prev.includes(hash) ? prev.filter(h => h !== hash) : [...prev, hash]
    setPinned(next)   // optimistic — the live subscription echoes the same value back
    try {
      // Personal content — a narrow owner write to newsPrefs.pinnedHashes, NOT mutate().
      await adapter.db.setNewsPins(user.uid, next)
    } catch {
      setPinned(prev)   // revert on failure
      toast.error('Could not update pin')
    }
  }

  async function copyLink(url: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy link')
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

  function pickTopic(t: string) {
    setTab('foryou')
    setFilter(t)
    setDrawerOpen(false)
  }

  const unsaved = instruction.trim() !== savedInstr

  const tabs = [
    { id: 'foryou', label: 'For You', count: forYou.length },
    { id: 'latest', label: 'Latest', count: latest.length },
    { id: 'pinned', label: 'Pinned', count: pinnedList.length },
  ]

  // Live count line under the tabs.
  const countLine = items === null
    ? 'Loading…'
    : filter.trim()
      ? `${displayed.length} of ${activeList.length} shown · “${filter.trim()}”`
      : tab === 'foryou'
        ? `${forYou.length} article${forYou.length === 1 ? '' : 's'}${matchCount > 0 ? ` · ${matchCount} match your portfolio` : ''}`
        : tab === 'pinned'
          ? `${pinnedList.length} pinned`
          : `${latest.length} article${latest.length === 1 ? '' : 's'}`

  return (
    <>
    {/* X-style layout: a primary feed column + a sticky context rail on large screens.
        Below lg the rail drops away and the feed goes full single-column. */}
    <div className="mx-auto w-full max-w-[1160px] lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 lg:items-start">
      {/* Feed column */}
      <div className="flex flex-col min-w-0">
      {/* Sticky command bar */}
      <header className="sticky top-0 z-30 bg-page flex flex-col gap-3 pb-3 pt-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid place-items-center w-9 h-9 rounded-[11px] shrink-0"
            style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
            <IconNews size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-text leading-tight">Market news</h1>
            <p className="text-xs text-faint">Curated nightly · ranked against your portfolio</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {isAdmin && (
              <Button variant="default" size="sm" onClick={refresh} disabled={refreshing} aria-label="Refresh news feed now">
                <IconRefresh size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
                <span className="hidden sm:inline">{refreshing ? 'Fetching…' : 'Refresh'}</span>
              </Button>
            )}
            <Button variant="default" size="sm" onClick={() => setDrawerOpen(true)} aria-label="Open feed settings" aria-haspopup="dialog">
              <IconSettings size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Feed settings</span>
            </Button>
          </div>
        </div>

        {/* Natural-language filter */}
        <div className="relative">
          <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter the feed — e.g. Florida rate hikes and reinsurance"
            className="w-full h-10 rounded-[12px] bg-surface border text-sm text-text pl-9 pr-9 focus:outline-none focus:ring-2 focus:ring-accent/25"
            style={{ borderColor: filter ? 'var(--color-accent)' : 'var(--color-border-strong)' }}
            aria-label="Filter articles by natural-language phrase"
          />
          {filter && (
            <button onClick={() => setFilter('')} aria-label="Clear filter"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-text transition-colors rounded-[6px] p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <IconClose size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Tabs — horizontal-scroll fallback so the strip never breaks a narrow layout */}
        <div className="overflow-x-auto">
          <Tabs tabs={tabs} active={tab} onChange={id => setTab(id as Tab)} />
        </div>
        <p className="text-xs text-dim px-0.5" aria-live="polite">{countLine}</p>
      </header>

      {/* Feed */}
      <div className="pt-4">
        {items === null ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, i) => <FeedSkeleton key={i} />)}
          </div>
        ) : enriched.length === 0 ? (
          <EmptyState
            icon={<IconNews size={28} />}
            title="No news yet"
            description="A nightly agent (06:00 ET) searches the web for your tracking brief and files what it finds here. Set a brief in Feed settings — and, if you're an admin, use Refresh to fetch immediately."
            action={isAdmin
              ? <Button variant="primary" size="sm" onClick={refresh} disabled={refreshing}>
                  <IconRefresh size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
                  {refreshing ? 'Fetching…' : 'Refresh now'}
                </Button>
              : undefined}
          />
        ) : displayed.length === 0 ? (
          tab === 'pinned' && !filter.trim() ? (
            <EmptyState
              icon={<IconStar size={28} />}
              title="No pinned articles"
              description="Pin an article with the star to save it here for later."
              action={<Button variant="default" size="sm" onClick={() => setTab('foryou')}>Browse For You</Button>}
            />
          ) : (
            <EmptyState
              icon={<IconSearch size={28} />}
              title="No matching articles"
              description={filter.trim()
                ? `Nothing in ${tab === 'pinned' ? 'your pinned items' : 'this feed'} matches “${filter.trim()}”. Try fewer or different words.`
                : 'Nothing to show in this view yet.'}
              action={filter.trim() ? <Button variant="default" size="sm" onClick={() => setFilter('')}>Clear filter</Button> : undefined}
            />
          )
        ) : (
          <>
            {/* key={tab} replays the entrance on tab switch (not on each filter keystroke).
                Each card is a self-labelled <article> region; no role="feed" (that ARIA
                pattern promises a keyboard model — Page Up/Down between articles — we don't
                implement, so claiming it would mislead AT users). */}
            <div key={tab} className="flex flex-col gap-4 page-in">
              {shown.map(n => (
                <NewsCard
                  key={n.id}
                  item={n}
                  pinned={pinnedSet.has(pinKey(n))}
                  onTogglePin={togglePin}
                  onCopy={copyLink}
                />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center pt-5">
                <Button variant="default" size="sm" onClick={() => setVisible(v => v + PAGE)}>
                  Show more ({displayed.length - visible})
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* Context rail — large screens only */}
      <FeedRail portfolio={portfolio} matchCount={matchCount} topTags={topTags} onPickTopic={pickTopic} />

      <FeedSettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        instruction={instruction}
        onInstrChange={setInstr}
        onSave={savePrefs}
        saving={saving}
        unsaved={unsaved}
        onBaseline={() => setInstr(BASE_NEWS_INSTRUCTION)}
        portfolio={portfolio}
        topTags={topTags}
        onPickTopic={pickTopic}
        isAdmin={!!isAdmin}
        onRefresh={refresh}
        refreshing={refreshing}
        canSave={!!user}
      />
    </div>
    </>
  )
}
