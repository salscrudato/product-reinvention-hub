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

const path = require('path')
const express = require('express')
const auth = require('./lib/auth')

const app = express()
const PORT = process.env.PORT || 8080
const PUBLIC = path.join(__dirname, 'public')

app.disable('x-powered-by')
app.use(express.json({ limit: '25mb' }))
app.use(auth.attachUser)

// ─── health ─────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: 'ok' })
})

// ─── auth ─────────────────────────────────────────────────────────────────
app.post('/api/auth/login', auth.login)
app.get('/api/auth/me', auth.requireAuth, auth.me)
app.post('/api/auth/logout', (_req, res) => res.json({ ok: true })) // token is client-held; nothing server-side to revoke
app.post('/api/auth/change-password', auth.requireAuth, auth.changePassword)

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

// ─── static SPA + client-router fallback ────────────────────────────────────
app.use(express.static(PUBLIC, {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
    else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  },
}))

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found', path: req.path })
  res.sendFile(path.join(PUBLIC, 'index.html'))
})

app.listen(PORT, () => console.log(`[prodhub-host] listening on :${PORT} — serving ${PUBLIC}`))
