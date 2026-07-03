// news.ts — the market-news agent. A nightly onSchedule run (06:00 ET) and a
// manual refresh callable both ask Claude (with the web-search tool) to find
// recent items matching each user's natural-language instruction, then dedup by
// urlHash and store. AWS-SWAP: EventBridge Scheduler → Lambda; same web search.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL, ANTHROPIC_API_KEY } from './runtime'

const DEFAULT_INSTRUCTION =
  'Recent U.S. homeowners insurance rate filings, regulatory changes, and competitor HO-3 product launches.'

interface NewsItem { url: string; source: string; title: string; summary: string; tags: string[] }

const NEWS_SYSTEM = `You are a P&C insurance news scout for a product manager. Use the web_search tool to find recent, real, relevant news items matching the user's instruction. Prefer primary sources (regulator sites, carrier newsrooms, trade press). Return ONLY a JSON array (max 8 items) — no prose before or after — where each item is:
{"url": string, "source": string, "title": string, "summary": string (1–2 sentences), "tags": string[] (2–4 short topical labels)}.
If you find nothing relevant, return [].`

/** Run one instruction through Claude + web search and parse the JSON items. */
async function fetchForInstruction(instruction: string): Promise<NewsItem[]> {
  const res = await anthropic().messages.create({
    model:      MODEL,
    max_tokens: 2048,
    system:     NEWS_SYSTEM,
    tools:      [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] as unknown as Anthropic.Tool[],
    messages:   [{ role: 'user', content: instruction }],
  })
  const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const arr = JSON.parse(match[0]) as unknown[]
    return (Array.isArray(arr) ? arr : [])
      .map(x => x as Partial<NewsItem>)
      .filter(x => x.url && x.title)
      .map(x => ({ url: x.url!, source: x.source ?? '', title: x.title!, summary: x.summary ?? '', tags: x.tags ?? [] }))
  } catch { return [] }
}

/** Store items, deduped by a hash of the URL. Returns how many were newly stored. */
async function storeItems(items: NewsItem[]): Promise<number> {
  const db = getFirestore()
  let stored = 0
  for (const it of items) {
    const urlHash = createHash('sha1').update(it.url).digest('hex')
    const ref = db.doc(`news/${urlHash}`)
    if ((await ref.get()).exists) continue
    await ref.set({
      urlHash, url: it.url, source: it.source, title: it.title, summary: it.summary,
      tags: it.tags, relatedProductIds: [], fetchedAt: Timestamp.now(),
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
    const prefDoc     = await getFirestore().doc(`newsPrefs/${req.auth.uid}`).get()
    const instruction = (prefDoc.data()?.instruction as string | undefined)?.trim() || DEFAULT_INSTRUCTION
    try {
      const items  = await fetchForInstruction(instruction)
      const stored = await storeItems(items)
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
    const prefs = await getFirestore().collection('newsPrefs').get()
    const instructions = prefs.docs
      .map(d => (d.data().instruction as string | undefined)?.trim())
      .filter((s): s is string => !!s)
    const unique = [...new Set(instructions.length ? instructions : [DEFAULT_INSTRUCTION])]
    for (const instruction of unique) {
      try {
        const items = await fetchForInstruction(instruction)
        await storeItems(items)
      } catch { /* one bad instruction shouldn't fail the whole run */ }
    }
  },
)
