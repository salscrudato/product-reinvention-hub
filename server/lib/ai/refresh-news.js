'use strict'
// refresh-news.js — POST /api/ai/refreshNews
// The market-news agent, ported from the reference functions/src/news.ts to the
// deployed Express host — and REAL: the model uses the Anthropic web_search
// server tool to find genuine, recent P&C items; every returned URL passes a
// shape gate + liveness probe (verifyItems) before anything is stored. Nothing
// is ever fabricated: if web search is unavailable upstream, the run fails
// honestly with `web_search_unavailable` and stores NOTHING.
//
// Request body (all optional):
//   { day?: 'YYYY-MM-DD' }  — target one specific day within the past 7 for
//     backfill: the search scopes to items PUBLISHED that day and stored items
//     carry that date. A 5-day backfill = five runs, one per day (idempotent —
//     items dedup by sha1(url) at path `news/${urlHash}`).
//
// Images: og:image → twitter:image → first plausible inline <img> from the real
// article page (deterministic parse, no AI). A resolved image is persisted to
// Azure Blob (`news-images/${urlHash}`) with long-lived cache headers and served
// via GET /api/news/image/:hash; if blob is unconfigured the original remote URL
// is stored instead; if no image resolves, the client's branded gradient renders
// (no image-generation deployment exists in the fleet — see EXECUTION-R0.md).

const crypto     = require('crypto')
const net        = require('net')
const dns        = require('dns').promises
const fleet      = require('../fleet')
const metering   = require('../metering')
const { resolveTenantForPrincipal } = require('../auth')
const dataRouter = require('../data')
const { loadTenantProfile } = require('../tenant-profile')

// Bundled shared helpers (pnpm build:news → news-shared.cjs). Lazy so the server
// boots even on a fresh clone before `pnpm build`.
let _news = null
function newsShared() {
  if (!_news) { try { _news = require('../news-shared.cjs') } catch { _news = {} } }
  return _news
}

const sha1 = (str) => crypto.createHash('sha1').update(str).digest('hex')

// ─── SSRF guard (F11) ─────────────────────────────────────────────────────────
// Every URL fetched by this module is UNTRUSTED: the article URL is model output and
// the image URL is scraped from a remote page. Before any fetch we require the target
// to be a PUBLIC http(s) endpoint — no non-http scheme, no credentials-in-URL, no IP
// literal in a private/reserved/link-local/loopback range, and no cloud-metadata host.
// Bare hostnames are resolved through DNS and EVERY resolved address is re-checked, so a
// public name that points at an internal IP (127.0.0.1, 169.254.169.254, …) is rejected.
// Redirects are followed MANUALLY (safeFetch) with each hop re-validated, so an external
// page can never 302 us onto an internal target. Fail-closed on parse/DNS failure.
// Residual gap: fetch re-resolves DNS after our check (a classic TOCTOU / DNS-rebinding
// race); per-hop re-validation closes the redirect vector but not a racing rebind.
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.azure.com'])

function ipv4ToBytes(s) {
  const parts = String(s).split('.')
  if (parts.length !== 4) return null
  const b = parts.map(p => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  if (b.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return b
}

function isPrivateV4(b) {
  const [a, c] = b
  if (a === 0) return true                             // 0.0.0.0/8
  if (a === 127) return true                           // 127.0.0.0/8 loopback
  if (a === 10) return true                            // 10.0.0.0/8
  if (a === 172 && c >= 16 && c <= 31) return true     // 172.16.0.0/12
  if (a === 192 && c === 168) return true              // 192.168.0.0/16
  if (a === 169 && c === 254) return true              // 169.254.0.0/16 link-local (+ metadata IP)
  if (a === 100 && c >= 64 && c <= 127) return true    // 100.64.0.0/10 CGNAT
  if (a >= 224) return true                            // 224.0.0.0/3 multicast + reserved
  return false
}

function ipv6ToBytes(str) {
  let s = String(str)
  const v4m = s.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/)   // IPv4-mapped/embedded tail
  if (v4m) {
    const v4 = ipv4ToBytes(v4m[2])
    if (!v4) return null
    s = `${v4m[1]}${(((v4[0] << 8) | v4[1]) >>> 0).toString(16)}:${(((v4[2] << 8) | v4[3]) >>> 0).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : []
  let groups
  if (halves.length === 2) {
    const missing = 8 - (head.length + tail.length)
    if (missing < 1) return null
    groups = [...head, ...Array(missing).fill('0'), ...tail]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  const bytes = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null
    const n = parseInt(g, 16)
    bytes.push((n >> 8) & 0xff, n & 0xff)
  }
  return bytes
}

function isPrivateV6(b) {
  if (b.every((x, i) => (i < 15 ? x === 0 : x === 1))) return true   // ::1 loopback
  if (b.every(x => x === 0)) return true                            // :: unspecified
  if ((b[0] & 0xfe) === 0xfc) return true                          // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true         // fe80::/10 link-local
  if (b.slice(0, 10).every(x => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isPrivateV4(b.slice(12, 16))                            // ::ffff:0:0/96 IPv4-mapped
  }
  return false
}

function isPrivateIp(ip) {
  const fam = net.isIP(ip)
  if (fam === 4) { const b = ipv4ToBytes(ip); return b ? isPrivateV4(b) : true }
  if (fam === 6) { const b = ipv6ToBytes(ip); return b ? isPrivateV6(b) : true }
  return true   // not a parseable IP literal → treat as unsafe
}

async function hostResolvesPublic(host) {
  let timer
  try {
    const results = await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('dns_timeout')), 2000) }),
    ])
    if (!Array.isArray(results) || results.length === 0) return false
    return results.every(r => !isPrivateIp(r.address))
  } catch { return false } finally { clearTimeout(timer) }
}

// Async so the DNS re-check fits the existing await style. Returns true only when the
// target is provably a public http(s) endpoint.
async function isPublicHttpUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password) return false                  // no credentials-in-URL
  let host = u.hostname.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)   // unwrap IPv6 literal
  if (!host) return false
  if (METADATA_HOSTS.has(host)) return false
  if (net.isIP(host)) return !isPrivateIp(host)               // IP literal — check directly
  return hostResolvesPublic(host)                             // name — resolve + re-check all A/AAAA
}

// fetch with MANUAL redirect handling: re-validate every hop's target through the SSRF
// guard before following (bounded to maxHops). Returns null when the target — or any
// redirect hop — fails the guard, or the redirect budget is exceeded. Callers treat a
// null result exactly like a failed/dead fetch.
async function safeFetch(url, init = {}, maxHops = 5) {
  let current = String(url)
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!(await isPublicHttpUrl(current))) return null
    const res = await fetch(current, { ...init, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      try { current = new URL(loc, current).href } catch { return null }
      continue
    }
    return res
  }
  return null   // redirect budget exceeded
}

// ─── Scout prompt (mirrors the reference agent's grounding rules) ─────────────
const NEWS_SYSTEM = `You are a P&C insurance news scout for a product manager. Use the web_search tool to find recent, real, relevant news items matching the user's instruction. Prefer primary sources (regulator sites, carrier newsrooms, trade press). Return ONLY a JSON array (max 8 items) — no prose before or after — where each item is:
{"url": string, "source": string, "title": string, "summary": string (1-2 sentence card lead), "bullets": [string, string, string], "tags": string[] (2-4 short topical labels), "publishedAt": string (the article's publication date as YYYY-MM-DD, ONLY if the source states it — omit otherwise)}.

Each bullet is ONE concrete sentence grounded only in content the web_search returned — never invent figures, dates, carrier names, coverages, forms, rules, or rate numbers:
  Bullet 1 — What happened: the concrete development (filing, product launch, endorsement, statute, catastrophe, M&A).
  Bullet 2 — Who and what it touches: affected line(s) of business, state(s), market segment.
  Bullet 3 — Why it matters to a product manager: rate pressure, coverage trend, filing precedent, or competitive move; market context only, never assert an internal product/coverage/form fact.
If only 2 bullets can be substantiated from the article, return 2. Drop rather than pad with unsubstantiated content.
If you find nothing relevant, return [].`

const DEFAULT_INSTRUCTION =
  'Recent U.S. property & casualty insurance market news: rate filings, regulatory changes, catastrophe losses, reinsurance moves, and competitor product launches across personal and commercial lines.'

// ─── JSON-array extraction (tolerant of prose + citations) ────────────────────
function extractJsonArray(text) {
  const candidates = []
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) candidates.push(fence[1])
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

// Normalise a URL to host+path (drop protocol/www/query/hash/trailing-slash) so the model's
// emitted URL can be matched against the web_search tool's actual result URLs despite cosmetic
// differences (tracking params, redirects to canonical). Used by the grounding gate below.
function normUrl(u) {
  try {
    const p = new URL(String(u))
    return (p.host.replace(/^www\./, '') + p.pathname.replace(/\/+$/, '')).toLowerCase()
  } catch { return String(u || '').toLowerCase() }
}

// ─── Web-search scout ─────────────────────────────────────────────────────────
// Raw Anthropic messages call with the web_search server tool + pause_turn loop.
// Throws Error with .code='web_search_unsupported' when the upstream rejects the
// tool type (e.g. a Foundry surface without server-tool support).
async function webSearchScout(deployment, instruction) {
  const messages = [{ role: 'user', content: instruction }]
  let finalText = ''
  let truncated = false
  const resultUrls = new Set()   // URLs the web_search tool ACTUALLY returned (grounding gate, S17)
  for (let turn = 0; turn < 6; turn++) {
    const upstream = await fetch(fleet.anthropicMessagesUrl(), {
      method: 'POST',
      headers: fleet.anthropicHeaders(),
      body: JSON.stringify({
        model: deployment,
        // 8 rich items × (title + lead + 3 bullets + tags) overruns 2048 and truncates the JSON
        // array to zero news silently — give it headroom and flag any remaining truncation (S30).
        max_tokens: 4096,
        system: [{ type: 'text', text: NEWS_SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages,
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400)
      const err = new Error(`Foundry ${upstream.status}: ${detail}`)
      // A 4xx complaining about the tool/type means the surface can't web-search.
      if (upstream.status >= 400 && upstream.status < 500 && /web_search|tool|type/i.test(detail)) {
        err.code = 'web_search_unsupported'
      }
      throw err
    }
    const json = await upstream.json()
    fleet.record(deployment, json.usage?.input_tokens, json.usage?.output_tokens)
    metering.meterCurrent(deployment, json.usage?.input_tokens, json.usage?.output_tokens)
    // Harvest the real result URLs the search tool returned this turn.
    for (const b of json.content || []) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) { if (r && r.type === 'web_search_result' && r.url) resultUrls.add(normUrl(r.url)) }
      }
    }
    const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    if (text.trim()) finalText = text
    if (json.stop_reason === 'max_tokens') truncated = true
    if (json.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: json.content }); continue }
    break
  }
  if (truncated) console.warn('[refreshNews] scout output hit max_tokens — some items may have been dropped')
  let items = extractJsonArray(finalText)
    .filter(x => x && typeof x === 'object' && x.url && x.title)
    .map(x => ({
      url:         String(x.url),
      source:      String(x.source || ''),
      title:       String(x.title),
      summary:     String(x.summary || ''),
      bullets:     Array.isArray(x.bullets) ? x.bullets.filter(b => typeof b === 'string').slice(0, 3) : [],
      tags:        Array.isArray(x.tags) ? x.tags.filter(t => typeof t === 'string').slice(0, 5) : [],
      publishedAt: /^\d{4}-\d{2}-\d{2}/.test(String(x.publishedAt || '')) ? String(x.publishedAt).slice(0, 10) : null,
    }))
  // Grounding gate (S17): keep only items whose URL matches one the web_search tool actually
  // returned — a hallucinated-but-live URL must not slip past the downstream liveness probe.
  // Fallback: if this surface returned no harvestable result blocks, defer to liveness alone.
  if (resultUrls.size > 0) {
    const before = items.length
    items = items.filter(it => resultUrls.has(normUrl(it.url)))
    if (items.length < before) console.warn(`[refreshNews] grounding gate dropped ${before - items.length} ungrounded URL(s)`)
  }
  return items
}

// ─── Liveness probe (C2 — drop dead/hallucinated URLs) ────────────────────────
async function headIsAlive(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    // safeFetch guards the URL (and every redirect hop) against SSRF; null = blocked/dead.
    const res = await safeFetch(url, { method: 'HEAD', signal: ctrl.signal })
    return !!res && res.status !== 404 && res.status !== 410
  } catch { return false } finally { clearTimeout(timer) }
}

// ─── Image resolution (deterministic parse of the real article page) ─────────
async function resolveImage(articleUrl, title, source) {
  const N = newsShared()
  const fallback = () => ({ kind: 'generated', dominantColor: N.deterministicColor ? N.deterministicColor(source) : undefined, alt: title })
  if (!N.extractOgImage) return fallback()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await safeFetch(articleUrl, {
      method: 'GET', signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
    })
    if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'blocked'}`)
    const html = (await res.text()).slice(0, 16384)
    const ogCandidate = N.extractOgImage(html)
    const rawCandidate = ogCandidate ?? N.extractInlineImage(html)
    if (!rawCandidate) throw new Error('no image candidate')
    let kind = 'inline'
    if (ogCandidate) kind = /<meta\s+[^>]*property=["']og:image["']/i.test(html) ? 'og' : 'twitter'
    const absoluteUrl = N.resolveImageUrl(rawCandidate, articleUrl)
    const validUrl = absoluteUrl ? N.sanitizeNewsUrl(absoluteUrl) : null
    if (!validUrl) throw new Error('image URL failed sanitize')
    const headCtrl = new AbortController()
    const headTimer = setTimeout(() => headCtrl.abort(), 3000)
    try {
      const headRes = await safeFetch(validUrl, { method: 'HEAD', signal: headCtrl.signal })
      if (!headRes || !headRes.ok) throw new Error(`HEAD ${headRes ? headRes.status : 'blocked'}`)
      const ct = (headRes.headers.get('content-type') || '').toLowerCase()
      if (!ct.startsWith('image/')) throw new Error('not an image content-type')
    } finally { clearTimeout(headTimer) }
    return { url: validUrl, kind, alt: title }
  } catch {
    return fallback()
  } finally { clearTimeout(timer) }
}

// ─── Blob persistence (cacheable, served via /api/news/image/:hash) ──────────
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
async function persistImageToBlob(image, urlHash) {
  if (!image?.url || !process.env.AZURE_BLOB_CONNECTION) return image
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    let buf, contentType
    try {
      const res = await safeFetch(image.url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
      })
      if (!res || !res.ok) throw new Error(`GET ${res ? res.status : 'blocked'}`)
      contentType = (res.headers.get('content-type') || '').toLowerCase().split(';')[0]
      if (!contentType.startsWith('image/') || contentType === 'image/svg+xml') throw new Error('bad content-type')
      const ab = await res.arrayBuffer()
      if (ab.byteLength === 0 || ab.byteLength > MAX_IMAGE_BYTES) throw new Error('bad size')
      buf = Buffer.from(ab)
    } finally { clearTimeout(timer) }

    const { BlobServiceClient } = require('@azure/storage-blob')
    const container = process.env.AZURE_BLOB_CONTAINER || 'uploads'
    const client = BlobServiceClient.fromConnectionString(process.env.AZURE_BLOB_CONNECTION)
      .getContainerClient(container).getBlockBlobClient(`news-images/${urlHash}`)
    await client.upload(buf, buf.length, {
      blobHTTPHeaders: {
        blobContentType: contentType,
        // Immutable by address: the hash IS the article URL, so cache hard.
        blobCacheControl: 'public, max-age=604800, immutable',
      },
    })
    // Same-origin serving path — the browser never needs the third-party host again.
    return { ...image, url: `/api/news/image/${urlHash}`, originUrl: image.url }
  } catch {
    return image   // keep the remote URL; the client's onError → gradient fallback
  }
}

// ─── Portfolio relevance (Why-this-matched) ───────────────────────────────────
const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut',
  DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa',
  KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan',
  MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire',
  NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio',
  OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota',
  TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia',
  WI:'Wisconsin', WY:'Wyoming', DC:'District of Columbia',
}
const LOB_EXTRA = {
  HO: ['homeowners', 'homeowner', 'ho-3', 'ho3', 'dwelling', 'renters', 'property insurance', 'home insurance'],
  PA: ['personal auto', 'auto insurance', 'automobile', 'private passenger auto', 'car insurance', 'motor'],
  GL: ['general liability', 'cgl', 'commercial liability'],
  IM: ['inland marine'],
  PR: ['professional liability', 'e&o', 'errors and omissions'],
}

async function loadProducts(tid) {
  try {
    const { docs } = require('../cosmos').resolveTenantStore(tid)
    const sql = "SELECT TOP 200 c.data, c.path FROM c WHERE c.kind='entity' AND c.coll='products' AND c.tenantId=@tid"
    const { resources } = await docs.items.query(
      { query: sql, parameters: [{ name: '@tid', value: tid }] }, { maxItemCount: 200 },
    ).fetchAll()
    return resources.map(r => {
      const d = r.data || {}
      const lobRefId = d.lob?.refId || ''
      return {
        id: String(r.path || '').split('/').filter(Boolean).at(-1),
        name: d.name || '', lobName: d.lob?.name || '', lobPrefix: lobRefId.split('.')[0] || '',
        allStates: !!d.allStates, states: Array.isArray(d.states) ? d.states : [],
      }
    })
  } catch { return [] }
}

// ─── Tenant-profile-first scope (BR-04 / NEWS_TENANT_SPEC §2–3) ────────────────
// The scope the scout searches with. ABSENT profile → the two historical literals,
// byte-for-byte (pinned by refresh-news.test.ts) — personalization may only ADD
// signal, never narrow. Present profile → the unchanged base sentence FIRST, then an
// appended tenant-focus paragraph (carrier → aliases → LOB captions → market →
// states → watch topics → product names capped at 12) closed with an explicit
// anti-narrowing instruction.
const SCOPE_PRODUCT_CAP = 12

// LOB display captions come from the shared registry bundle when present (lazy, same
// pattern as newsShared) — a raw prefix like "PH" resolves to "Personal Home"; unknown
// keys fall back to themselves rather than being dropped.
let _lobReg = null
function lobCaption(key) {
  if (_lobReg === null) {
    try { _lobReg = Object.values(require('../import-brain-shared.cjs').LOB_REGISTRY || {}) } catch { _lobReg = [] }
  }
  return _lobReg.find(l => l.prefix === key)?.name || key
}

function buildScope({ day, todayStr }, profile, products) {
  const base = day
    ? `Find REAL P&C insurance market news PUBLISHED ON ${day} (U.S. market). Today is ${todayStr}. Only include items you can verify were published on or about that date; include publishedAt when the source states it.`
    : `Today is ${todayStr}. Find REAL P&C insurance market news from the past 7 days.`
  if (!profile?.carrierName) return base

  const focus = [`Tenant focus — the reader is a product manager at the carrier "${profile.carrierName}".`]
  if (profile.aliases?.length)     focus.push(`The carrier is also known as ${profile.aliases.join(', ')}.`)
  if (profile.lobs?.length)        focus.push(`Lines of business: ${profile.lobs.map(lobCaption).join(', ')}.`)
  if (profile.market)              focus.push(`Market: ${profile.market} lines.`)
  if (profile.states?.length)      focus.push(`Operating states: ${profile.states.join(', ')}.`)
  if (profile.watchTopics?.length) focus.push(`Watch topics: ${profile.watchTopics.join(', ')}.`)
  const names = (products || []).map(p => p?.name).filter(Boolean).slice(0, SCOPE_PRODUCT_CAP)
  if (names.length)                focus.push(`Portfolio products: ${names.join(', ')}.`)
  focus.push('This tenant focus ADDS signal on top of the general scope; do not narrow the general P&C market coverage below it.')

  return `${base}\n${focus.join(' ')}`
}

// ─── Carrier tagging (matchedCarrier — "about you") ───────────────────────────
// Case-insensitive, WORD-BOUNDED carrierName/alias match over title+summary+tags:
// an alias like "ATM" must never tag "atmosphere" (boundary check both sides, plain
// string scan — no regex construction from user data). Degenerate short names
// (<3 chars) are ignored so a stray initial can never tag the feed.
const _isAlnum = (c) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
function _wordBoundedIncludes(hay, needle) {
  let i = hay.indexOf(needle)
  while (i !== -1) {
    const before = i > 0 ? hay[i - 1] : ' '
    const after = i + needle.length < hay.length ? hay[i + needle.length] : ' '
    if (!_isAlnum(before) && !_isAlnum(after)) return true
    i = hay.indexOf(needle, i + 1)
  }
  return false
}
function matchesCarrier(item, profile) {
  if (!profile?.carrierName) return false
  const hay = `${item.title || ''} ${item.summary || ''} ${(item.tags || []).join(' ')}`.toLowerCase()
  return [profile.carrierName, ...(profile.aliases || [])]
    .map(n => String(n).trim().toLowerCase())
    .filter(n => n.length >= 3)
    .some(n => _wordBoundedIncludes(hay, n))
}

function matchToProductIds(item, products) {
  const raw = `${item.title} ${item.summary} ${item.tags.join(' ')}`
  const lower = raw.toLowerCase()
  const ids = []
  for (const p of products) {
    const lobLower = p.lobName.toLowerCase()
    const extras = LOB_EXTRA[p.lobPrefix] ?? []
    const lobHit = !!lobLower && (lower.includes(lobLower) || extras.some(kw => lower.includes(kw)))
    let stateHit = false
    if (!p.allStates) {
      for (const code of p.states) {
        const fullName = (STATE_NAMES[code] || '').toLowerCase()
        if ((fullName && lower.includes(fullName)) || new RegExp(`\\b${code}\\b`).test(raw)) { stateHit = true; break }
      }
    }
    if (lobHit || stateHit) ids.push(p.id)
  }
  return ids
}

// ─── Handler ──────────────────────────────────────────────────────────────────
async function refreshNews(req, res) {
  const tid = resolveTenantForPrincipal(req.user)

  const g = fleet.guard()
  if (!g.allow) return res.status(429).json({ error: 'AI budget ceiling reached — try again shortly.' })

  // Optional day targeting (backfill): must be a real date within the past 7 days.
  const todayStr = new Date().toISOString().slice(0, 10)
  let day = null
  const rawDay = req.body?.day
  if (rawDay !== undefined && rawDay !== null && rawDay !== '') {
    day = String(rawDay).slice(0, 10)
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > todayStr || day < weekAgo) {
      return res.status(400).json({ error: 'invalid_day', detail: 'day must be YYYY-MM-DD within the past 7 days' })
    }
  }

  // Per-user tracking instruction (same doc the News page edits), plus day scoping.
  let instruction = DEFAULT_INSTRUCTION
  try {
    const { docs } = require('../cosmos').resolveTenantStore(tid)
    const sql = "SELECT TOP 1 c.data FROM c WHERE c.kind='entity' AND c.coll='newsPrefs' AND c.tenantId=@tid AND c.path=@p"
    const { resources } = await docs.items.query(
      { query: sql, parameters: [{ name: '@tid', value: tid }, { name: '@p', value: `newsPrefs/${req.user.uid}` }] },
      { maxItemCount: 1 },
    ).fetchAll()
    const custom = String(resources[0]?.data?.instruction || '').trim()
    if (custom) instruction = custom
  } catch { /* default instruction */ }

  // Profile-first scope (BR-04): the tenant-carrier profile + portfolio products fold
  // into the search scope; absent profile → the historical scope byte-for-byte. The
  // per-user newsPrefs `instruction` keeps its append precedence untouched below.
  const profile = await loadTenantProfile(tid)
  const products = await loadProducts(tid)
  const scope = buildScope({ day, todayStr }, profile, products)

  const deployment = fleet.resolveModel('BULK_VERIFY', g.degrade)
  const N = newsShared()

  let items
  try {
    items = await webSearchScout(deployment, `${scope}\n\n${instruction}`)
  } catch (err) {
    console.error('[refreshNews] scout error:', err.message)
    if (err.code === 'web_search_unsupported') {
      // HONEST failure — never fall back to fabricated articles.
      return res.status(501).json({
        error: 'web_search_unavailable',
        detail: 'The AI endpoint rejected the web_search tool; real news requires it. Nothing was stored.',
      })
    }
    return res.status(502).json({ error: 'ai_upstream', detail: String(err.message || err).slice(0, 200) })
  }

  // Existence gate: shape-check + liveness-probe every URL; drop the dead.
  const live = N.verifyItems ? await N.verifyItems(items, headIsAlive) : []

  const actor = { uid: req.user.uid || 'system', name: req.user.name || 'News Bot' }
  let stored = 0

  for (const it of live) {
    try {
      const urlHash = sha1(it.url)
      let image = await resolveImage(it.url, it.title, it.source)
      if (image.url) image = await persistImageToBlob(image, urlHash)

      // The article's date: the source's stated publishedAt, else the targeted
      // backfill day, else now. Never model-invented (publishedAt is schema-gated).
      const articleDate = it.publishedAt || day || todayStr
      const data = {
        urlHash,
        url: it.url,
        source: it.source || 'Web',
        title: it.title,
        summary: it.summary,
        bullets: it.bullets,
        tags: it.tags,
        image,
        publishedAt: it.publishedAt,
        relatedProductIds: matchToProductIds(it, products),
        matchedCarrier: matchesCarrier(it, profile),
        fetchedAt: `${articleDate}T12:00:00.000Z`,
      }
      await dataRouter.mutateInternal(tid, { op: 'update', path: `news/${urlHash}`, data, entityType: 'news' }, actor, '/api/ai/refreshNews')
      stored++
    } catch (err) {
      console.warn('[refreshNews] skipping item:', err?.message || err)
    }
  }

  return res.json({ found: items.length, verified: live.length, stored, day })
}

module.exports = {
  refreshNews,
  _internals: { extractJsonArray, matchToProductIds, webSearchScout, buildScope, matchesCarrier },
}
