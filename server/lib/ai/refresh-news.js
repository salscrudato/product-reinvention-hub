'use strict'
// refresh-news.js — POST /api/ai/refreshNews
// Generates a batch of high-quality, recent P&C insurance news articles via AI
// (haiku BULK_VERIFY role), then persists each one as a tenant-scoped news entity
// in Cosmos via mutateInternal. Returns { found, stored }.
//
// News items are written to path `news/${urlHash}` (SHA-1 of URL), same partition
// as all other tenant data. The client reads them via adapter.db.subscribe('news').
//
// Article freshness window: 7 days. Each run generates ~10 articles spread over the
// window. Existing items (by urlHash) are skipped — not double-written.

const crypto     = require('crypto')
const fleet      = require('../fleet')
const { _forcedToolCall } = require('./_shared')
const dataRouter = require('../data')

// System prompt: instructs the model to produce realistic, grounded P&C insurance
// industry news articles. The model does NOT browse the web; it draws on training
// knowledge of the P&C insurance domain. Dates are set relative to the current date.
const NEWS_SYSTEM = [
  'You are a senior P&C insurance industry analyst with encyclopedic knowledge of the U.S.',
  'property and casualty insurance market through 2025.',
  'Generate realistic, specific, grounded P&C insurance industry news articles — rate filings,',
  'regulatory bulletins, catastrophe loss updates, reinsurance market moves, carrier strategic',
  'announcements, InsurTech deals, and actuarial/legal developments — as they would appear in',
  'Insurance Journal, AM Best, or Claims Journal.',
  'Each article must be specific: real-sounding carrier names, state dept names, dollar figures,',
  'date context, and 3 structured PM-takeaway bullets (What/Who/Why format).',
  'Spread article dates evenly across the past 7 days.',
  'Vary the line of business: include personal lines (HO, auto), commercial (GL, BOP, E&O,',
  'Cyber, Inland Marine), specialty, and reinsurance.',
  'Do NOT fabricate URLs — use plausible publication-style slugs.',
  'Do NOT reference real-world events after your knowledge cutoff.',
].join(' ')

const _NEWS_TOOL = {
  name: 'emit_news_batch',
  description: 'Emit a batch of P&C insurance news articles for the past 7 days.',
  input_schema: {
    type: 'object',
    properties: {
      articles: {
        type: 'array',
        minItems: 8,
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            url:     { type: 'string', description: 'Plausible article URL (https://publication.example/slug).' },
            source:  { type: 'string', description: 'Publication name (e.g. "Insurance Journal", "AM Best News").' },
            title:   { type: 'string', description: 'Article headline — specific, informative, under 120 chars.' },
            summary: { type: 'string', description: 'One-paragraph article summary (3-5 sentences).' },
            bullets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Exactly 3 PM takeaways, each starting with "What:", "Who:", or "Why:" (in that order).',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Up to 5 lowercase topic tags (e.g. "homeowners", "rate-filing", "florida", "reinsurance").',
            },
            daysAgo: {
              type: 'number',
              description: 'How many days ago this article was published (0=today, 1=yesterday … 6=6 days ago).',
            },
          },
          required: ['url', 'source', 'title', 'summary', 'bullets', 'tags', 'daysAgo'],
        },
      },
    },
    required: ['articles'],
  },
}

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex')
}

async function refreshNews(req, res) {
  const tid = req.user?.tenantId
  if (!tid) return res.status(401).json({ error: 'tenant_required' })

  const g = fleet.guard()
  if (!g.allow) return res.status(429).json({ error: 'AI budget ceiling reached — try again shortly.' })

  const deployment = fleet.resolveModel('BULK_VERIFY', g.degrade)

  const now = Date.now()
  const todayStr = new Date(now).toISOString().slice(0, 10)

  const instruction = [
    `Today's date is ${todayStr}.`,
    'Generate 10 high-quality P&C insurance news articles dated across the past 7 days.',
    'Cover: HO rate approvals, auto combined-ratio trends, GL coverage disputes, catastrophe',
    'reserve updates, reinsurance treaty announcements, InsurTech funding rounds, state DOI',
    'bulletins, court decisions affecting coverage, and industry M&A.',
    'Make each article specific with real-sounding entities, figures, and regulatory detail.',
  ].join(' ')

  // 10 detailed articles (summary + 3 bullets + tags each) can exceed a small
  // max_tokens budget; a truncated forced-tool response yields an incomplete JSON
  // input that parses to zero articles. Give it ample room (8192) and retry once
  // if the first pass still comes back empty, so a user "Refresh" never silently
  // returns nothing.
  async function callOnce() {
    const raw = await _forcedToolCall(deployment, NEWS_SYSTEM, [_NEWS_TOOL], 'emit_news_batch',
      [], instruction, 8192)
    return Array.isArray(raw?.articles) ? raw.articles : []
  }

  let articles = []
  try {
    articles = await callOnce()
    if (articles.length === 0) articles = await callOnce()   // one retry on empty
  } catch (err) {
    console.error('[refreshNews] AI error:', err)
    return res.status(500).json({ error: `AI call failed: ${String(err.message || err).slice(0, 200)}` })
  }
  let stored = 0
  const actor = { uid: req.user.uid || 'system', name: req.user.name || 'News Bot' }

  for (const a of articles) {
    try {
      const url = String(a.url || '').trim()
      if (!url) continue
      const urlHash = sha1(url)
      const daysAgo = Math.min(Math.max(Number(a.daysAgo) || 0, 0), 6)
      const fetchedAt = new Date(now - daysAgo * 86_400_000).toISOString()

      const bullets = Array.isArray(a.bullets) ? a.bullets.slice(0, 3) : []
      const tags    = Array.isArray(a.tags)    ? a.tags.slice(0, 5)    : []

      const data = {
        urlHash,
        url,
        source:            String(a.source  || 'Insurance Journal'),
        title:             String(a.title   || ''),
        summary:           String(a.summary || ''),
        bullets,
        tags,
        relatedProductIds: [],
        fetchedAt,
      }

      const path = `news/${urlHash}`
      await dataRouter.mutateInternal(tid, { op: 'update', path, data, entityType: 'news' }, actor, '/api/ai/refreshNews')
      stored++
    } catch (err) {
      console.warn('[refreshNews] skipping article:', err?.message || err)
    }
  }

  return res.json({ found: articles.length, stored })
}

module.exports = { refreshNews }
