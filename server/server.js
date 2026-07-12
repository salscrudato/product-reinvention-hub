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

// ─── cold-start probe (App Insights startup telemetry) ──────────────────────
try { require('./lib/sys-diag').init() } catch (_) { /* non-fatal; host still boots */ }

app.disable('x-powered-by')
app.use(compression())
app.use(express.json({ limit: '25mb' }))
app.use(auth.attachUser)

// ─── health ─────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: 'ok' })
})

// ─── auth ─────────────────────────────────────────────────────────────────
app.post('/api/auth/login', auth.login)
app.get('/api/auth/tenants', auth.publicTenants) // login-page dropdown (ids + names only)
app.get('/api/auth/me', auth.requireAuth, auth.me)
app.post('/api/auth/logout', (_req, res) => res.json({ ok: true })) // token is client-held; nothing server-side to revoke
app.post('/api/auth/change-password', auth.requireAuth, auth.changePassword)

// ─── tenant + user administration (ADMIN) ───────────────────────────────────
try {
  app.use('/api/admin', require('./lib/admin'))
  console.log('[prodhub-host] /api/admin mounted (tenants + users)')
} catch (err) {
  console.warn('[prodhub-host] /api/admin NOT mounted:', err.message)
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

// ─── Duck Creek Author export REST API v1 ───────────────────────────────────
// Protected by Entra ID (App Service auth V2, outer) + platform JWT (inner, EDITOR+).
// POST /api/duckcreek/v1/author/generate  — build + validate, store bundle
// POST /api/duckcreek/v1/author/validate  — fail-closed validate only
// GET  /api/duckcreek/v1/author/bundle/:id/download — download stored bundle
try {
  app.use('/api/duckcreek/v1', require('./lib/duckcreek'))
  console.log('[prodhub-host] /api/duckcreek/v1 mounted (Duck Creek Author export API)')
} catch (err) {
  console.warn('[prodhub-host] /api/duckcreek/v1 NOT mounted:', err.message)
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

// ─── ONE-SHOT CORPUS SEED (ADMIN only — remove after seeding) ────────────────
// Runs on the App Service (already inside the Cosmos DB firewall) so seed data
// can be written regardless of the caller's network location. Protected by the
// platform ADMIN role check — no unauthenticated access possible.
// Remove this route once all tenant corpora (hackensack-insurance, hagerty,
// testco) are populated.
app.post('/api/admin/seed-corpus', auth.requireRole('ADMIN'), async (req, res) => {
  const tenant = String(req.body?.tenant || 'default').replace(/[^a-z0-9-]/gi, '')
  if (!tenant) return res.status(400).json({ error: 'tenant required' })
  try {
    const { seedForTenant } = require('./lib/seed-shared.cjs')
    const result = await seedForTenant(tenant)
    res.json({ ok: true, tenant, ...result })
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500)
    res.status(500).json({ error: 'seed_failed', message: msg })
  }
})
console.log('[prodhub-host] /api/admin/seed-corpus mounted (ADMIN only)')

// ─── static SPA + client-router fallback ────────────────────────────────────
app.use(express.static(PUBLIC, {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('version.json')) res.setHeader('Cache-Control', 'no-cache')
    else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  },
}))

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found', path: req.path })
  res.sendFile(path.join(PUBLIC, 'index.html'))
})

app.listen(PORT, () => console.log(`[prodhub-host] listening on :${PORT} — serving ${PUBLIC}`))
