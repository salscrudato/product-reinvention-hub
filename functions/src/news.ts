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
import { anthropic, MODEL_FAST, ANTHROPIC_API_KEY } from './runtime'

const DEFAULT_INSTRUCTION =
  'Recent U.S. homeowners insurance rate filings, regulatory changes, and competitor HO-3 product launches.'

interface NewsItem { url: string; source: string; title: string; summary: string; tags: string[] }

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
  GL: ['general liability', 'cgl', 'commercial general liability', 'business liability'],
}

const NEWS_SYSTEM = `You are a P&C insurance news scout for a product manager. Use the web_search tool to find recent, real, relevant news items matching the user's instruction. Prefer primary sources (regulator sites, carrier newsrooms, trade press). Return ONLY a JSON array (max 8 items) — no prose before or after — where each item is:
{"url": string, "source": string, "title": string, "summary": string (1–2 sentences), "tags": string[] (2–4 short topical labels)}.
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
 *  Handles the server-tool `pause_turn` continuation loop. */
async function fetchForInstruction(instruction: string, portfolioCtx: string): Promise<NewsItem[]> {
  const client      = anthropic()
  const userContent = portfolioCtx ? `${instruction}\n\n${portfolioCtx}` : instruction
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }]
  let finalText = ''
  for (let turn = 0; turn < 6; turn++) {
    const res = await client.messages.create({
      model:       MODEL_FAST,
      max_tokens:  2048,
      temperature: 0,   // grounded extraction → deterministic, low-variance output
      system:      NEWS_SYSTEM,
      // Basic web-search variant — supported on the fast (Haiku) tier; the parser
      // only reads final text, so it is agnostic to the result-block shape.
      tools:       [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] as unknown as Anthropic.Tool[],
      messages,
    })
    const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
    if (text.trim()) finalText = text
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue }
    break
  }
  return extractJsonArray(finalText)
    .map(x => x as Partial<NewsItem>)
    .filter(x => x.url && x.title)
    .map(x => ({ url: x.url!, source: x.source ?? '', title: x.title!, summary: x.summary ?? '', tags: x.tags ?? [] }))
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

/** Store items, deduped by a hash of the URL. Returns how many were newly stored.
 *  relatedProductIds is populated on each new item via LOB + state matching. */
async function storeItems(items: NewsItem[], products: ProductInfo[]): Promise<number> {
  const db = getFirestore()
  let stored = 0
  for (const it of items) {
    const urlHash = createHash('sha1').update(it.url).digest('hex')
    const ref     = db.doc(`news/${urlHash}`)
    if ((await ref.get()).exists) continue
    const relatedProductIds = matchToProductIds(it, products)
    await ref.set({
      urlHash, url: it.url, source: it.source, title: it.title, summary: it.summary,
      tags: it.tags, relatedProductIds, fetchedAt: Timestamp.now(),
    })
    stored++
  }
  return stored
}

// ─── Manual refresh (dev / on-demand) ─────────────────────────────────────────

export const refreshNews = onCall(
  { secrets: [ANTHROPIC_API_KEY], maxInstances: 3, timeoutSeconds: 180 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in to refresh news.')
    const db           = getFirestore()
    const prefDoc      = await db.doc(`newsPrefs/${req.auth.uid}`).get()
    const instruction  = (prefDoc.data()?.instruction as string | undefined)?.trim() || DEFAULT_INSTRUCTION
    const products     = await loadProducts()
    const portfolioCtx = buildPortfolioContext(products)
    try {
      const items  = await fetchForInstruction(instruction, portfolioCtx)
      const stored = await storeItems(items, products)
      return { found: items.length, stored }
    } catch (err) {
      return { found: 0, stored: 0, error: err instanceof Error ? err.message : 'News fetch failed' }
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
    for (const instruction of unique) {
      try {
        const items = await fetchForInstruction(instruction, portfolioCtx)
        await storeItems(items, products)
      } catch { /* one bad instruction shouldn't fail the whole run */ }
    }
  },
)
