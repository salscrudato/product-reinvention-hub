// news.ts — the market-news agent. A nightly onSchedule run (06:00 ET) and a
// manual refresh callable both ask Claude (with the web-search tool) to find
// recent items matching each user's natural-language instruction, then dedup by
// urlHash and store. Portfolio context (LOBs + states from the product catalogue)
// is injected into the Claude prompt so results are portfolio-relevant;
// relatedProductIds is populated on each new item by matching its text against
// the full product catalogue via LOB keywords + state names/codes.
// AWS-SWAP: EventBridge Scheduler → Lambda; same web search.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL_FAST, ANTHROPIC_API_KEY, requireRole, CACHE_1H } from './runtime'
import { verifyItems, sanitizeNewsUrl, extractOgImage } from '@pf/shared'
import { emptyUsage, addUsage, recordUsage } from './telemetry'
import type { UsageAccum } from './telemetry'

const DEFAULT_INSTRUCTION =
  'Recent U.S. homeowners insurance rate filings, regulatory changes, and competitor HO-3 product launches.'

interface NewsItem {
  url:       string
  source:    string
  title:     string
  summary:   string
  bullets:   string[]    // 3 structured PM takeaways (What/Who/Why); 2 when only 2 substantiated
  imageUrl?: string      // absolute https hero image, populated by enrichWithImage post-verify
  imageAlt?: string      // alt text for the hero image
  tags:      string[]
}

/** Minimal product projection — only what the matching + prompt logic needs. */
interface ProductInfo {
  id:        string
  name:      string
  lobName:   string   // e.g. "Homeowners"
  lobPrefix: string   // e.g. "HO" — the first segment of lob.refId
  allStates: boolean
  states:    string[] // 2-letter codes; empty when allStates is true
}

// US state code → full name for broad text matching in news bodies.
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
const LOB_EXTRA: Record<string, string[]> = {
  HO: ['homeowners', 'homeowner', 'ho-3', 'ho3', 'dwelling', 'renters', 'property insurance', 'home insurance'],
  PA: ['personal auto', 'auto insurance', 'automobile', 'private passenger auto', 'car insurance', 'pp 00 01', 'motor'],
}

const NEWS_SYSTEM = `You are a P&C insurance news scout for a product manager. Use the web_search tool to find recent, real, relevant news items matching the user's instruction. Prefer primary sources (regulator sites, carrier newsrooms, trade press). Return ONLY a JSON array (max 8 items) — no prose before or after — where each item is:
{"url": string, "source": string, "title": string, "summary": string (1–2 sentence card lead), "bullets": [string, string, string], "tags": string[] (2–4 short topical labels)}.

Each bullet is ONE concrete sentence grounded only in content the web_search returned — never invent figures, dates, carrier names, coverages, forms, rules, or rate numbers:
  Bullet 1 — What happened: the concrete development (filing, product launch, endorsement, statute, catastrophe, M&A).
  Bullet 2 — Who and what it touches: affected line(s) of business, state(s), market segment.
  Bullet 3 — Why it matters to a product manager: rate pressure, coverage trend, filing precedent, or competitive move; market context only, never assert an internal product/coverage/form fact.
If only 2 bullets can be substantiated from the article, return 2. Drop rather than pad with unsubstantiated content.
If you find nothing relevant, return [].`

/** Pull the first balanced JSON array out of text (tolerant of prose + [1] citations). */
function extractJsonArray(text: string): unknown[] {
  const candidates: string[] = []
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) candidates.push(fence[1]!)
  const start = text.indexOf('[')
  if (start >= 0) {
    let depth = 0
    for (let i = start; i < text.length; i++) {
      if (text[i] === '[') depth++
      else if (text[i] === ']' && --depth === 0) { candidates.push(text.slice(start, i + 1)); break }
    }
  }
  candidates.push(text.trim())
  for (const c of candidates) {
    try { const a = JSON.parse(c.trim()); if (Array.isArray(a)) return a } catch { /* try next */ }
  }
  return []
}

/** Build a brief portfolio context string to inject alongside the user's instruction. */
function buildPortfolioContext(products: ProductInfo[]): string {
  if (products.length === 0) return ''
  const lines = products.map(p => {
    const stateStr = p.allStates ? 'nationwide' : (p.states.length ? p.states.join(', ') : 'no states listed')
    return `${p.name} (${p.lobName}; ${stateStr})`
  })
  return `Current portfolio: ${lines.join(' | ')}`
}

/** Run one instruction through Claude + web search and parse the JSON items.
 *  portfolioCtx is appended to the user message so Claude can tailor the search.
 *  Handles the server-tool `pause_turn` continuation loop.
 *  When usageAccum is provided, per-turn API usage is accumulated into it. */
async function fetchForInstruction(instruction: string, portfolioCtx: string, usageAccum?: UsageAccum): Promise<NewsItem[]> {
  const client      = anthropic()
  const userContent = portfolioCtx ? `${instruction}\n\n${portfolioCtx}` : instruction
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }]
  let finalText = ''
  for (let turn = 0; turn < 6; turn++) {
    const res = await client.messages.create({
      model:       MODEL_FAST,
      max_tokens:  2048,
      temperature: 0,   // grounded extraction → deterministic, low-variance output (Haiku allows sampling)
      // Cache the stable web_search tool def + scout instruction (1h TTL) so it is reused
      // across the pause_turn continuation turns AND across each nightly instruction; only
      // the per-instruction user message (below) is volatile. (Under Haiku's 4096 cache
      // floor today — a no-op that activates for free once the prefix grows past it.)
      system:      [{ type: 'text', text: NEWS_SYSTEM, cache_control: CACHE_1H }],
      tools:       [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 } satisfies Anthropic.WebSearchTool20250305],
      messages,
    }, { timeout: 60_000 })
    if (usageAccum) addUsage(usageAccum, res.usage)
    const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
    if (text.trim()) finalText = text
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue }
    break
  }
  return extractJsonArray(finalText)
    .map(x => x as Partial<NewsItem>)
    .filter(x => x.url && x.title)
    .map(x => ({
      url:     x.url!,
      source:  x.source ?? '',
      title:   x.title!,
      summary: x.summary ?? '',
      bullets: Array.isArray(x.bullets) ? x.bullets.filter((b): b is string => typeof b === 'string') : [],
      tags:    x.tags ?? [],
    }))
}

/** Return the product IDs whose LOB or state footprint overlaps with the item text.
 *  Uses LOB name/keyword matching and state full-name / uppercase-code matching. */
function matchToProductIds(item: NewsItem, products: ProductInfo[]): string[] {
  const raw   = `${item.title} ${item.summary} ${item.tags.join(' ')}`
  const lower = raw.toLowerCase()
  const ids: string[] = []

  for (const p of products) {
    const lobLower = p.lobName.toLowerCase()
    const extras   = LOB_EXTRA[p.lobPrefix] ?? []
    const lobHit   = lower.includes(lobLower) || extras.some(kw => lower.includes(kw))

    let stateHit = false
    if (!p.allStates) {
      for (const code of p.states) {
        const fullName = STATE_NAMES[code]?.toLowerCase() ?? ''
        // Match full state name (unambiguous) OR the uppercase code as a word boundary
        // in the original-case text (avoids false positives on common English words).
        if (
          (fullName && lower.includes(fullName)) ||
          new RegExp(`\\b${code}\\b`).test(raw)
        ) { stateHit = true; break }
      }
    }

    if (lobHit || stateHit) ids.push(p.id)
  }
  return ids
}

/** Load all products from Firestore, projecting to ProductInfo. */
async function loadProducts(): Promise<ProductInfo[]> {
  const snap = await getFirestore().collection('products').get()
  return snap.docs.map(d => {
    const data = d.data() as {
      name?:      string
      lob?:       { name?: string; refId?: string }
      allStates?: boolean
      states?:    string[]
    }
    const lobRefId = data.lob?.refId ?? ''
    return {
      id:        d.id,
      name:      data.name ?? d.id,
      lobName:   data.lob?.name ?? '',
      lobPrefix: lobRefId.split('.')[0] ?? '',
      allStates: data.allStates ?? false,
      states:    data.states ?? [],
    }
  })
}

/** Best-effort liveness probe for a source URL: a short-timeout HEAD (C2). A returned
 *  news item only needs url+title, so nothing has confirmed the URL resolves — a
 *  hallucinated/dead source would otherwise be persisted as real news. We treat a
 *  definitive "not found" (404/410) or a network/timeout failure (a fabricated domain,
 *  typically) as dead; a gated (401/403), method-refused (405) or transient (5xx) reply
 *  still means the resource exists, so we keep it rather than drop a real source on a
 *  blip. The shape gate + this probe both run inside verifyItems (@pf/shared). */
async function headIsAlive(url: string): Promise<boolean> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal })
    return res.status !== 404 && res.status !== 410
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Best-effort hero-image extraction: fetches article HTML (first 10 KB), parses
 *  og:image / twitter:image, validates URL shape + liveness, then attaches imageUrl
 *  and imageAlt. Returns the item unchanged on any error or timeout. Never throws. */
async function enrichWithImage(item: NewsItem): Promise<NewsItem> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch(item.url, { method: 'GET', redirect: 'follow', signal: ctrl.signal })
    if (!res.ok) return item
    const html      = (await res.text()).slice(0, 10240)
    const candidate = extractOgImage(html)
    if (!candidate) return item
    const validUrl  = sanitizeNewsUrl(candidate)
    if (!validUrl) return item
    const live = await headIsAlive(validUrl)
    if (!live) return item
    return { ...item, imageUrl: validUrl, imageAlt: item.title }
  } catch {
    return item
  } finally {
    clearTimeout(timer)
  }
}

/** Store items, deduped by a hash of the URL. Returns how many were newly stored.
 *  relatedProductIds is populated on each new item via LOB + state matching. */
async function storeItems(items: NewsItem[], products: ProductInfo[]): Promise<number> {
  const db = getFirestore()
  let stored = 0
  for (const it of items) {
    const urlHash = createHash('sha1').update(it.url).digest('hex')
    const ref     = db.doc(`news/${urlHash}`)
    const relatedProductIds = matchToProductIds(it, products)   // pure; safe to compute before the tx
    // B4: dedup as an atomic check-and-set. The previous get-then-set could let two concurrent
    // runs (a manual refresh racing the nightly agent) both see "not present" and both write —
    // the transactional read+write closes that window (a duplicate simply no-ops).
    const created = await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return false
      tx.set(ref, {
        urlHash, url: it.url, source: it.source, title: it.title, summary: it.summary,
        bullets: it.bullets,
        ...(it.imageUrl ? { imageUrl: it.imageUrl, imageAlt: it.imageAlt ?? it.title } : {}),
        tags: it.tags, relatedProductIds, fetchedAt: Timestamp.now(),
      })
      return true
    })
    if (created) stored++
  }
  return stored
}

// ─── Manual refresh (dev / on-demand) ─────────────────────────────────────────

export const refreshNews = onCall(
  { secrets: [ANTHROPIC_API_KEY], maxInstances: 3, timeoutSeconds: 180 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in to refresh news.')
    // Mirror firestore.rules: news/{id} write requires isAdmin().
    requireRole(req.auth, 'ADMIN')
    const db           = getFirestore()
    const prefDoc      = await db.doc(`newsPrefs/${req.auth.uid}`).get()
    const instruction  = (prefDoc.data()?.instruction as string | undefined)?.trim() || DEFAULT_INSTRUCTION
    const products     = await loadProducts()
    const portfolioCtx = buildPortfolioContext(products)
    const usageAccum   = emptyUsage()
    const t0 = Date.now()
    let ok = true
    try {
      const items    = await fetchForInstruction(instruction, portfolioCtx, usageAccum)
      const live     = await verifyItems(items, headIsAlive)   // C2: drop dead / hallucinated source URLs
      const enriched = await Promise.all(live.map(enrichWithImage))  // best-effort hero images, parallel
      const stored   = await storeItems(enriched, products)
      return { found: items.length, verified: live.length, stored }
    } catch (err) {
      ok = false
      console.error('[refreshNews] internal error:', err)
      return { found: 0, stored: 0, error: 'News fetch failed.' }
    } finally {
      void recordUsage({ feature: 'refreshNews', model: MODEL_FAST, usage: usageAccum, latencyMs: Date.now() - t0, ok })
    }
  },
)

// ─── Nightly agent (06:00 America/New_York) ───────────────────────────────────

export const nightlyNews = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'America/New_York', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540 },
  async () => {
    const prefs        = await getFirestore().collection('newsPrefs').get()
    const products     = await loadProducts()
    const portfolioCtx = buildPortfolioContext(products)
    const instructions = prefs.docs
      .map(d => (d.data().instruction as string | undefined)?.trim())
      .filter((s): s is string => !!s)
    const unique = [...new Set(instructions.length ? instructions : [DEFAULT_INSTRUCTION])]
    // Accumulate usage across all instructions; one record per nightly run.
    const usageAccum = emptyUsage()
    const t0 = Date.now()
    let ok = true
    for (const instruction of unique) {
      try {
        const items    = await fetchForInstruction(instruction, portfolioCtx, usageAccum)
        const live     = await verifyItems(items, headIsAlive)   // C2: drop dead / hallucinated source URLs
        const enriched = await Promise.all(live.map(enrichWithImage))  // best-effort hero images, parallel
        await storeItems(enriched, products)
      } catch { ok = false /* one bad instruction shouldn't fail the whole run */ }
    }
    void recordUsage({ feature: 'nightlyNews', model: MODEL_FAST, usage: usageAccum, latencyMs: Date.now() - t0, ok })
  },
)
