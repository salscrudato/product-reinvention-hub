'use strict'
// server.js — Product Hub Azure App Service host.
//
// Serves the built Vite SPA AND the full backend API, replacing Firebase +
// GCloud Cloud Functions:
//   GET  /api/health                      → {"status":"ok"}
//   POST /api/auth/login                  → { user, token }   (opaque session id)
//   GET  /api/auth/me                     → { user }          (Bearer)
//   POST /api/auth/change-password        → { ok }            (Bearer)
//   /api/db/*                             → Cosmos-backed data (role-enforced)
//   /api/ai/*                             → AI (Foundry Claude, SSE)
//
// Data + AI routers are mounted only if their modules load (so the host still
// boots for auth/health while later phases land). See docs/DEPLOY_AZURE.md.
//
// [arch] startup banner (banner.js) removed v4.1.0 — commit 3f98282.
//        Restore:  git show 3f98282:server/lib/banner.js > server/lib/banner.js
//        Toggle:   SHOW_BANNER=1  (disabled by default; not needed in prod)

const path = require('path')
const express = require('express')
const compression = require('compression')
const auth = require('./lib/auth')

const app = express()
const PORT = process.env.PORT || 8080
const PUBLIC = path.join(__dirname, 'public')

// ─── Auth endpoint rate limiter (token bucket, per-IP, in-process) ──────────
// RISK-003: protect /api/auth/login from brute-force and credential stuffing.
// RISK-007: protect /api/auth/tenants from tenant enumeration scraping.
// Implementation mirrors homecheck.js guest rate limiter (no new dependencies).
const _authBuckets = new Map()
function authRateLimit(name, cap, refillPerSec) {
  return (req, res, next) => {
    const fwd = req.headers['x-forwarded-for'] || ''
    const ip = (fwd ? fwd.split(',')[0] : (req.socket?.remoteAddress || 'unknown')).trim()
    const key = `${name}:${ip}`
    const now = Date.now()
    let b = _authBuckets.get(key)
    if (!b) { b = { tokens: cap - 1, lastMs: now }; _authBuckets.set(key, b); return next() }
    b.tokens = Math.min(cap, b.tokens + (now - b.lastMs) / 1000 * refillPerSec)
    b.lastMs = now
    if (b.tokens >= 1) { b.tokens -= 1; return next() }
    const retryAfter = Math.ceil((1 - b.tokens) / refillPerSec)
    res.set('Retry-After', String(retryAfter))
    return res.status(429).json({ error: 'rate_limit_exceeded', retryAfter })
  }
}
// 10 login attempts per hour per IP (cap=10, refill=10/3600 tokens/s)
const loginRateLimit = authRateLimit('login', 10, 10 / 3600)
// 60 tenant list fetches per hour per IP
const tenantsRateLimit = authRateLimit('tenants', 60, 60 / 3600)

// ─── cold-start probe (App Insights startup telemetry) ──────────────────────
try { require('./lib/sys-diag').init() } catch (_) { /* non-fatal; host still boots */ }

app.disable('x-powered-by')
// Compression buffers streamed responses — SSE (text/event-stream) must bypass it
// or stage-by-stage import/chat progress arrives as one burst at stream end.
app.use(compression({ filter: (req, res) => {
  if (String(res.getHeader('Content-Type') || '').includes('text/event-stream')) return false
  if (req.headers.accept === 'text/event-stream') return false
  return compression.filter(req, res)
} }))
app.use(express.json({ limit: '25mb' }))
app.use(auth.attachUser)

// ─── Per-tenant request telemetry (count / errors / latency) ─────────────────
// Records every /api request against its tenant for the ops dashboard. In-process,
// single-instance; never affects the response (fire-on-finish).
const metering = require('./lib/metering')
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next()
  const start = Date.now()
  res.on('finish', () => {
    const tid = req.user && req.user.tenantId
    if (tid) metering.recordRequest(tid, res.statusCode, Date.now() - start)
  })
  next()
})

// ─── Global auth + write gates (defense-in-depth) ────────────────────────────
// 1. requireAuth on ALL /api/* except the public surface (health, login, guest
//    HomeCheck). Individual routers keep their own guards; this is the floor.
// 2. Default-deny write gate: every non-GET /api/* requires product:write unless
//    whitelisted below, so a VIEWER can never reach a mutation even if a route
//    forgot its own guard. Read-shaped POSTs and the read-only AI surface are
//    whitelisted; write-shaped AI calls (import, reindex) are NOT.
const { hasCapability } = require('./lib/authz')
const PUBLIC_API = [
  '/api/health',
  '/api/auth/otp/request', '/api/auth/otp/verify', '/api/auth/otp/magic', '/api/auth/bootstrap', '/api/auth/tenants', '/api/auth/resolve',
  '/api/auth/passkey/options', '/api/auth/passkey/verify',  // usernameless WebAuthn sign-in (pre-auth by definition)
  '/api/homecheck/',  // guest consumer surface — rate-limited, zero portfolio access
]
const isPublicApi = (p) => PUBLIC_API.some((pub) => (pub.endsWith('/') ? p.startsWith(pub) : p === pub))
// Routers that enforce their own capability gates with pinned error contracts
// (platform gates, member:manage, filing:generate) — exempt from the generic
// product:write check so their specific `need` codes keep reaching clients.
const WRITE_EXEMPT_PREFIX = ['/api/auth/', '/api/admin', '/api/tenant-admin', '/api/filing', '/api/serff', '/api/portal']
const WRITE_EXEMPT_EXACT = ['/api/db/list', '/api/db/presence/watch']  // read-shaped POSTs
const AI_WRITE = new Set(['unifiedImport', 'reindexProduct'])          // write-shaped AI calls

app.use((req, res, next) => {
  const p = req.path
  if (!p.startsWith('/api/')) return next()
  if (isPublicApi(p)) return next()
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' })
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
  if (WRITE_EXEMPT_EXACT.includes(p) || WRITE_EXEMPT_PREFIX.some((x) => p.startsWith(x))) return next()
  if (p.startsWith('/api/ai/')) {
    const name = p.slice('/api/ai/'.length).split('/')[0]
    if (!AI_WRITE.has(name)) return next()  // read-only AI (chat, analyze, …) — ai:invoke gate applies per-route
  }
  if (!hasCapability(req.user, 'product:write')) {
    return res.status(403).json({ error: 'forbidden', need: 'product:write', have: req.user.role })
  }
  next()
})

// ─── Per-tenant rate limiter (token bucket, in-process) ──────────────────────
// Runs BEFORE the flag lookup so a rate-limited request is shed without extra work.
// Layered ON TOP of the per-IP auth limiter AND the global AI cost breaker (both stay
// intact): this caps how fast ONE tenant can hit the expensive AI / write / filing
// surfaces, so a single tenant cannot exhaust the instance for everyone. Keyed by tenant.
const _tenantBuckets = new Map()
const TENANT_RL_CAP = Number(process.env.TENANT_RL_CAP) || 120          // burst
const TENANT_RL_PER_SEC = Number(process.env.TENANT_RL_PER_SEC) || 2    // sustained (~120/min)
const RL_PATHS = ['/api/ai/', '/api/filing', '/api/db/mutate', '/api/db/mutateBatch']
app.use((req, res, next) => {
  const p = req.path
  if (!req.user || req.method === 'GET' || req.method === 'HEAD') return next()
  if (!RL_PATHS.some((x) => (x.endsWith('/') ? p.startsWith(x) : p === x || p.startsWith(x + '/')))) return next()
  const tid = req.user.tenantId || 'default'
  const now = Date.now()
  let b = _tenantBuckets.get(tid)
  if (!b) { b = { tokens: TENANT_RL_CAP - 1, lastMs: now }; _tenantBuckets.set(tid, b); return next() }
  b.tokens = Math.min(TENANT_RL_CAP, b.tokens + (now - b.lastMs) / 1000 * TENANT_RL_PER_SEC)
  b.lastMs = now
  if (b.tokens >= 1) { b.tokens -= 1; return next() }
  const retryAfter = Math.ceil((1 - b.tokens) / TENANT_RL_PER_SEC)
  res.set('Retry-After', String(retryAfter))
  return res.status(429).json({ error: 'tenant_rate_limited', retryAfter })
})

// ─── Feature-flag enforcement (server-side, authoritative) ───────────────────
// The client hides disabled surfaces from nav; THIS is the authoritative deny. Each
// mapped path is checked against the tenant's EFFECTIVE flags (global default + tenant
// override, global-disable-is-a-floor). A disabled surface → 403 feature_disabled.
// Fail-OPEN on infra error (flags are a management convenience, not the security boundary
// — capability gates are). The import path (/api/ai/unifiedImport) is deliberately NOT
// flag-gated (import no-cap invariant).
const FLAG_ROUTES = [
  { match: '/api/ai/chat',            flag: 'feature.agenticCopilot' },
  { match: '/api/ai/scaffoldProduct', flag: 'feature.scaffoldProduct' },
  { match: '/api/ai/draftRule',       flag: 'feature.draftRule' },
  { match: '/api/ai/refreshNews',     flag: 'feature.newsRefresh' },
  { match: '/api/ai/analyzeClaim',    flag: 'page.claims' },
  { match: '/api/filing/generate',    flag: 'feature.filingGeneration' },
  { prefix: '/api/filing',            flag: 'page.filing' },
]
app.use(async (req, res, next) => {
  const p = req.path
  if (!p.startsWith('/api/') || !req.user) return next()
  const rules = FLAG_ROUTES.filter((r) => (r.match ? p === r.match : p.startsWith(r.prefix)))
  if (!rules.length) return next()
  try {
    const pc = require('./lib/platform-config')
    const tid = auth.resolveTenantForPrincipal(req.user)
    const flags = await pc.getEffectiveFlags(tid)
    for (const r of rules) if (flags[r.flag] === false) return res.status(403).json({ error: 'feature_disabled', flag: r.flag })
  } catch { /* fail-open */ }
  next()
})

// ─── health ─────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: 'ok' })
})

// ─── auth ─────────────────────────────────────────────────────────────────
// OTP flow: request → verify (regular email users); the same email carries a
// single-use magic link that lands on /api/auth/otp/magic (one-click sign-in).
app.post('/api/auth/otp/request', loginRateLimit, auth.requestOtp)
app.post('/api/auth/otp/verify',  loginRateLimit, auth.verifyOtp)
app.post('/api/auth/otp/magic',   loginRateLimit, auth.verifyMagicLink)
// Passkeys (WebAuthn): usernameless sign-in is public; enrollment requires a session.
try {
  const passkeys = require('./lib/passkeys')
  app.post('/api/auth/passkey/options',          loginRateLimit, passkeys.authOptions)
  app.post('/api/auth/passkey/verify',           loginRateLimit, passkeys.authVerify)
  app.post('/api/auth/passkey/register/options', auth.requireAuth, passkeys.registerOptions)
  app.post('/api/auth/passkey/register/verify',  auth.requireAuth, passkeys.registerVerify)
  app.get('/api/auth/passkey/mine',              auth.requireAuth, passkeys.listMine)
  console.log('[prodhub-host] /api/auth/passkey mounted (WebAuthn)')
} catch (err) {
  console.warn('[prodhub-host] /api/auth/passkey NOT mounted:', err.message)
}
// Bootstrap login: username+password for SUPER_ADMIN break-glass accounts only
app.post('/api/auth/bootstrap',   loginRateLimit, auth.loginBootstrap)
app.get('/api/auth/tenants', tenantsRateLimit, auth.publicTenants) // login-page dropdown (ids + names only)
// Pre-auth login resolve: { mode, tenantHint } from server config ONLY — uniform for
// known and unknown domains (no account/tenant enumeration). P4 removes the legacy
// /api/auth/tenants enumeration atomically with the client flip to this endpoint.
app.post('/api/auth/resolve', tenantsRateLimit, auth.resolveLogin)
app.get('/api/auth/me', auth.requireAuth, auth.me)
app.get('/api/auth/memberships', auth.requireAuth, auth.myMemberships) // caller's own tenants (multi-tenant chooser)
app.post('/api/auth/logout', auth.revokeToken, (req, res) => { auth.clearSessionCookie(req, res); res.json({ ok: true }) }) // RISK-006: destroy the server-side session + clear its cookie before responding
app.post('/api/auth/change-password', auth.requireAuth, auth.changePassword)

// ─── platform administration (SUPER_ADMIN + SUPPORT only) ───────────────────
try {
  app.use('/api/admin', require('./lib/admin'))
  console.log('[prodhub-host] /api/admin mounted (platform: tenants + users + impersonation)')
} catch (err) {
  console.warn('[prodhub-host] /api/admin NOT mounted:', err.message)
}

// ─── tenant self-service administration (TENANT_ADMIN, own org only) ─────────
try {
  app.use('/api/tenant-admin', require('./lib/tenant-admin'))
  console.log('[prodhub-host] /api/tenant-admin mounted (member management)')
} catch (err) {
  console.warn('[prodhub-host] /api/tenant-admin NOT mounted:', err.message)
}

// ─── data (Cosmos) — mounted if the module loads ────────────────────────────
try {
  app.use('/api/db', require('./lib/data'))
  console.log('[prodhub-host] /api/db mounted (Cosmos)')
} catch (err) {
  console.warn('[prodhub-host] /api/db NOT mounted:', err.message)
}

// ─── Portfolio pulse + suggested queries (read-only, deterministic, zero AI) ──
try {
  app.use('/api/portfolio', require('./lib/portfolio'))
  console.log('[prodhub-host] /api/portfolio mounted (pulse + suggested queries)')
} catch (err) {
  console.warn('[prodhub-host] /api/portfolio NOT mounted:', err.message)
}

// ─── AI (Foundry Claude) — mounted if the module loads ──────────────────────
try {
  app.use('/api/ai', require('./lib/ai'))
  console.log('[prodhub-host] /api/ai mounted (Foundry Claude)')
} catch (err) {
  console.warn('[prodhub-host] /api/ai NOT mounted:', err.message)
}

// ─── News images — cacheable thumbnail stream from Blob (auth via /api floor) ─
try {
  app.get('/api/news/image/:hash', require('./lib/news-image').newsImage)
  console.log('[prodhub-host] /api/news/image mounted (Blob thumbnails)')
} catch (err) {
  console.warn('[prodhub-host] /api/news/image NOT mounted:', err.message)
}

// ─── Storage (Azure Blob) — mounted if the module loads ─────────────────────
try {
  app.use('/api/storage', require('./lib/storage'))
  console.log('[prodhub-host] /api/storage mounted (Azure Blob)')
} catch (err) {
  console.warn('[prodhub-host] /api/storage NOT mounted:', err.message)
}

// ─── SERFF filing bundle API ────────────────────────────────────────────────
// POST /api/serff/v1/bundle  — diff + assemble Texas SERFF bundle + DOI reviewer lens
// GET  /api/serff/v1/states  — state filing matrix (file-and-use / prior-approval / etc.)
try {
  app.use('/api/serff/v1', require('./lib/serff'))
  console.log('[prodhub-host] /api/serff/v1 mounted (SERFF filing bundle API)')
} catch (err) {
  console.warn('[prodhub-host] /api/serff/v1 NOT mounted:', err.message)
}

// ─── Regulatory filing generation API ───────────────────────────────────────
// POST /api/filing/generate  — authority-gated 5-step filing: SCOPE/RESOLVE/BUILD/VERIFY/FREEZE
// GET  /api/filing           — list frozen filings for the authenticated tenant
// GET  /api/filing/:filingId — retrieve one immutable filing record
// Requires filing:generate capability (EDITOR+); read endpoints require product:read (VIEWER+).
try {
  app.use('/api/filing', require('./lib/filing'))
  console.log('[prodhub-host] /api/filing mounted (regulatory filing generation)')
} catch (err) {
  console.warn('[prodhub-host] /api/filing NOT mounted:', err.message)
}

// ─── Policyholder portal (POLICYHOLDER persona only — portal:read / portal:upload) ──
// POST /api/portal/upload  — one-time PDF upload → grounded extraction → audited record
// POST /api/portal/summary — judged, catalog-grounded HTML summary (deterministic fallback)
// GET  /api/portal/me      — own policy record only (uid + tenant from the JWT, never params)
// In WRITE_EXEMPT_PREFIX because every route enforces its own portal:* capability gate
// (a capability no staff role holds) — the generic product:write check would mask that
// pinned error contract. POLICYHOLDER holds NO other capability, so /api/db, /api/ai and
// every staff surface still reject it.
try {
  app.use('/api/portal', require('./lib/portal'))
  console.log('[prodhub-host] /api/portal mounted (policyholder portal)')
} catch (err) {
  console.warn('[prodhub-host] /api/portal NOT mounted:', err.message)
}

// ─── Duck Creek Author XML export (P3 — XE-01..06/08) ───────────────────────
// POST /api/export/duckcreek — overlay + Unity workbook pair + manifest bundle;
// gap-report gated (MISSING blocks), OVERLAY-DELTA LINT hard gate, audited run
// record, page.dictionary reveal on first success. EDITOR+ (product:write).
try {
  app.use('/api/export', require('./lib/export-duckcreek'))
  console.log('[prodhub-host] /api/export mounted (Duck Creek Author XML export)')
} catch (err) {
  console.warn('[prodhub-host] /api/export NOT mounted:', err.message)
}

// ─── HomeCheck consumer surface (guest-accessible, rate-limited, zero portfolio access) ──
// POST /api/homecheck/v1/risk               — address risk report (Census+FEMA+USGS+NOAA+WHP)
// POST /api/homecheck/v1/report-html        — saveable single-file HTML risk report
// POST /api/homecheck/v1/inventory          — photo digital-twin inventory (GPT-5.1 vision)
// GET  /api/homecheck/v1/inventory/:id      — retrieve session
// DELETE /api/homecheck/v1/inventory/:id    — delete session (privacy/retention)
// GET  /api/homecheck/v1/inventory/:id/export — exportable proof-of-condition HTML
// POST /api/homecheck/v1/twin-diff          — digital-twin diff (new vs prior session)
//
// ZERO PORTFOLIO ACCESS: homecheck.js never imports ./cosmos or ./data.
// Rate limited by IP (no auth required — guest surface).
try {
  app.use('/api/homecheck/v1', require('./lib/homecheck'))
  console.log('[prodhub-host] /api/homecheck/v1 mounted (HomeCheck consumer surface)')
} catch (err) {
  console.warn('[prodhub-host] /api/homecheck/v1 NOT mounted:', err.message)
}

// ─── static SPA + client-router fallback ────────────────────────────────────
app.use(express.static(PUBLIC, {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('version.json')) res.setHeader('Cache-Control', 'no-cache')
    else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  },
}))

// A request for a hashed static asset that reaches this fallback means the file is MISSING
// — almost always a stale chunk hash requested by a client still running an older index.html
// after a redeploy (Vite fingerprints every chunk, so old hashes vanish on each build).
// Serving index.html here returns text/html for a `<script type=module>`, which the browser
// refuses to parse ("Expected a JavaScript-or-Wasm module script but the server responded
// with a MIME type of text/html") and the app fails to load. Return a real 404 instead so
// the dynamic import rejects cleanly and the client can self-heal (see the vite:preloadError
// handler in app/src/main.tsx, which reloads once onto fresh index.html + current hashes).
const ASSET_PATH = /^\/assets\//
const STATIC_EXT = /\.(?:js|mjs|cjs|css|map|json|wasm|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|txt|xml|webmanifest)$/i
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found', path: req.path })
  if (ASSET_PATH.test(req.path) || STATIC_EXT.test(req.path)) {
    // Missing static asset — 404 (never the SPA shell). client routes carry no file
    // extension and don't live under /assets/, so they still fall through to index.html.
    return res.status(404).type('text/plain').send('Not found')
  }
  res.sendFile(path.join(PUBLIC, 'index.html'))
})

// RISK-012: global error handler -- must have exactly 4 parameters for Express to treat it as
// error middleware. Catches unhandled throws from async route handlers. Returns 500 without
// leaking stack traces; the full error is logged for App Insights log-stream visibility.
// eslint-disable-next-line no-unused-vars
app.use(function (err, req, res, next) {
  console.error('[prodhub-host] unhandled error:', err?.message || String(err))
  if (res.headersSent) return
  // Honest status for body-parser failures (upload root-cause fix): an oversized JSON
  // body (413 entity.too.large — e.g. a base64 PDF past the 25 MB cap) or malformed
  // JSON (400 entity.parse.failed) previously surfaced as an opaque 500, so the client
  // could only say "upload failed". Preserve the parser's status + a actionable detail.
  const status = Number(err?.status || err?.statusCode)
  if (status === 413) {
    return res.status(413).json({
      error: 'payload_too_large',
      detail: 'Request body exceeds the 25 MB transport limit. Uploaded files must be under ~15 MB (base64 encoding adds ~33%).',
    })
  }
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: err?.type || 'bad_request' })
  }
  res.status(500).json({ error: 'internal_server_error' })
})

if (require.main === module) {
  app.listen(PORT, () => console.log(`[prodhub-host] listening on :${PORT} -- serving ${PUBLIC}`))
}
module.exports = { app }
