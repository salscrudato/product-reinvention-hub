'use strict'
// external/newsdata.js — NewsData.io industry-news client (deterministic complement to
// the model-driven refresh-news web_search path). Key: NEWSDATA_API_KEY env (server-side
// only; stored in kv-prodhub-dev-1r99/newsdata-key). Free tier: metadata + description;
// full article content requires a paid plan.

const BASE = 'https://newsdata.io/api/1/latest'

const isConfigured = () => Boolean(process.env.NEWSDATA_API_KEY)

/** Latest news articles for a query. Throws { status: 503 } when the key is unset.
 *  @param {object} [opts]
 *  @param {string} [opts.q='insurance']  - search query
 *  @param {number} [opts.size=10]        - max articles (free tier caps at 10)
 *  @param {string} [opts.country='us']
 *  @returns {Promise<Array<{ title, link, description, pubDate, source, imageUrl }>>} */
async function latest(opts = {}) {
  if (!isConfigured()) { const e = new Error('newsdata_not_configured'); e.status = 503; throw e }
  const params = new URLSearchParams({
    apikey: process.env.NEWSDATA_API_KEY,
    q: opts.q ?? 'insurance',
    size: String(opts.size ?? 10),
    country: opts.country ?? 'us',
    language: 'en',
  })
  const res = await fetch(`${BASE}?${params}`)
  if (!res.ok) { const e = new Error(`newsdata_${res.status}`); e.status = res.status; throw e }
  const j = await res.json()
  return (j.results || []).map(a => ({
    title: a.title, link: a.link, description: a.description || null,
    pubDate: a.pubDate || null, source: a.source_id || null, imageUrl: a.image_url || null,
  }))
}

module.exports = { isConfigured, latest }
