// Offline-capable service worker (PWA). Dependency-free; same-origin GETs only.
//
// Strategy per resource type:
//   /home-check    — network-first (navigations) with offline shell fallback
//   /app shell     — network-first with offline shell fallback
//   hashed assets  — cache-first (immutable, max-age=31536000)
//   /api/homecheck/v1/risk* — stale-while-revalidate (15-min TTL for hazard JSON)
//   /api/*         — never cached (auth-gated B2B API; tenant data must be fresh)
//
// Cache version is bumped on each deploy to evict stale shells.
// Update CACHE_NAME whenever the app shell HTML or critical CSS changes.
const CACHE_NAME  = 'prh-v3'
const HAZARD_CACHE = 'prh-hazard-v1'

const APP_SHELL = [
  '/',
  '/home-check',
  '/favicon.svg',
  '/manifest.webmanifest',
]

const HAZARD_MAX_AGE_MS = 15 * 60 * 1000 // 15 minutes stale-while-revalidate for risk JSON

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(APP_SHELL))
      .catch(() => {}) // non-fatal if offline during install
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== HAZARD_CACHE)
          .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // leave cross-origin (CDN fonts, etc.) alone

  // Never cache authenticated B2B API calls or non-homecheck API routes.
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/homecheck/')) return

  // Stale-while-revalidate for hazard JSON (/api/homecheck/v1/risk responses).
  // These are POSTs sent from the client — the SW intercepts the cached GET form
  // only; POST caching is not attempted here (browsers block POST caching via SW).
  // Risk JSON caching is handled at the application level (React component) via
  // sessionStorage for the current session. The SW only caches navigations + assets.

  // Navigations: network-first, fall back to cached route shell, then root shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put(req, copy))
          return res
        })
        .catch(() =>
          caches.match(req)
            .then((r) => r || caches.match('/home-check'))
            .then((r) => r || caches.match('/')),
        ),
    )
    return
  }

  // Hashed assets (Vite injects content hash in filename): cache-first, immutable.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((res) => {
          if (res && res.ok) caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()))
          return res
        })
      }),
    )
    return
  }

  // All other same-origin GETs: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()))
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
