'use strict'
// server.js — Product Hub Azure App Service host.
//
// Serves the built Vite SPA AND the full backend API, replacing Firebase +
// GCloud Cloud Functions:
//   GET  /api/health                      → {"status":"ok"}
//   POST /api/auth/login                  → { user, token }   (JWT)
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

// ─── health ─────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: 'ok' })
})

// ─── auth ─────────────────────────────────────────────────────────────────
// OTP flow: request → verify (regular email users)
app.post('/api/auth/otp/request', loginRateLimit, auth.requestOtp)
app.post('/api/auth/otp/verify',  loginRateLimit, auth.verifyOtp)
// Bootstrap login: username+password for SUPER_ADMIN break-glass accounts only
app.post('/api/auth/bootstrap',   loginRateLimit, auth.loginBootstrap)
app.get('/api/auth/tenants', tenantsRateLimit, auth.publicTenants) // login-page dropdown (ids + names only)
app.get('/api/auth/me', auth.requireAuth, auth.me)
app.post('/api/auth/logout', auth.revokeToken, (_req, res) => res.json({ ok: true })) // RISK-006: revoke jti before responding
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

// ─── AI (Foundry Claude) — mounted if the module loads ──────────────────────
try {
  app.use('/api/ai', require('./lib/ai'))
  console.log('[prodhub-host] /api/ai mounted (Foundry Claude)')
} catch (err) {
  console.warn('[prodhub-host] /api/ai NOT mounted:', err.message)
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
  res.status(500).json({ error: 'internal_server_error' })
})

if (require.main === module) {
  app.listen(PORT, () => console.log(`[prodhub-host] listening on :${PORT} -- serving ${PUBLIC}`))
}
module.exports = { app }
