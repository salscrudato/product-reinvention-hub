'use strict'
// Product Hub — Azure App Service host (compute-on-Azure, data-on-Firebase).
//
// Zero runtime dependencies on purpose: this file + ./public (the built Vite
// SPA) is the entire deploy artifact, so App Service needs no `npm install`.
//
// Responsibilities:
//   1. Serve the built SPA from ./public with a client-side-router fallback.
//   2. Honor the health contract  GET /api/health -> {"status":"ok"}.
//
// It intentionally does NOT proxy the AI API. Per docs/DEPLOY_AZURE.md the
// browser reaches Firestore, Firebase Auth and the Cloud Functions AI surface
// (https://us-central1-productreinvention.cloudfunctions.net/*) directly, so
// data/auth/AI stay on Firebase while compute (SPA serving) moves to Azure.
// Relocating the Functions onto this host is a documented follow-up.

const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

const PORT = process.env.PORT || 8080
const ROOT = path.join(__dirname, 'public')
const INDEX = path.join(ROOT, 'index.html')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function send(res, status, body, headers = {}) {
  if (res.headersSent) { res.end(); return }
  res.writeHead(status, headers)
  res.end(body)
}

function streamFile(res, filePath, forcedType) {
  const ext = path.extname(filePath).toLowerCase()
  const type = forcedType || TYPES[ext] || 'application/octet-stream'
  const isIndex = path.basename(filePath) === 'index.html'
  // Hashed Vite assets are immutable; index.html must never serve stale.
  const cache = isIndex
    ? 'no-cache'
    : filePath.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600'
  const stream = fs.createReadStream(filePath)
  stream.on('open', () => res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache }))
  stream.on('error', () => send(res, 500, 'Internal Server Error'))
  stream.pipe(res)
}

const server = http.createServer((req, res) => {
  let pathname = '/'
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    return send(res, 400, 'Bad Request')
  }

  // Health contract — exact shape existing monitors/pipeline expect.
  if (pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ status: 'ok' }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
  }

  // Everything else under /api is Firebase's, not this host's — be honest.
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return send(res, 404, JSON.stringify({
      error: 'not_found',
      detail: 'API is served by Firebase Cloud Functions; see docs/DEPLOY_AZURE.md',
    }), { 'Content-Type': 'application/json; charset=utf-8' })
  }

  // Static resolution with a path-traversal guard.
  const rel = pathname.replace(/^\/+/, '')
  const filePath = path.normalize(path.join(ROOT, rel))
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden')
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) return streamFile(res, filePath)
    // SPA fallback: the client-side router owns non-file routes.
    return streamFile(res, INDEX, 'text/html; charset=utf-8')
  })
})

server.listen(PORT, () => {
  console.log(`[prodhub-host] listening on :${PORT} — serving ${ROOT}`)
})
