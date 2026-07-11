// Offline-capable service worker (PWA) for the authenticated B2B SPA.
// Dependency-free; same-origin GETs only. Safe by construction: it NEVER caches
// authenticated data or any sensitive/tenant response — those pass straight through
// to the server. See the hostile-review note at the bottom.
//
// Cache strategy BY REQUEST CLASS:
//   • hashed static assets (/assets/…)  — cache-first (immutable, content-hashed URLs)
//   • HTML navigations                  — network-first, offline fallback to cached shell
//   • public static (icons/manifest/fonts) — stale-while-revalidate
//   • public, non-sensitive API JSON    — stale-while-revalidate, EXPLICIT ALLOWLIST only
//   • everything else under /api/*       — PASS THROUGH (never cached)
//   • version.json                       — PASS THROUGH (must stay fresh for VersionWatcher)
//   • any other same-origin GET          — PASS THROUGH (fail-closed default)
//
// SECRETS: none here. The cache name is versioned per deploy by the build git hash
// (__BUILD_ID__ is stamped in by vite.config.ts at build time), so a new deploy produces a
// byte-different sw.js → the browser installs it → its `activate` evicts every prior cache.
// A stale bundle can therefore never survive a deploy.
const BUILD_ID   = '__BUILD_ID__'          // replaced at build time with the git-hash build id
const CACHE_NAME  = `prh-${BUILD_ID}`

// The app shell (HTML + public entry points). Precached so the app opens offline. This is the
// SAME index.html the SPA serves for every route — NOT authenticated data.
const APP_SHELL = ['/', '/home-check', '/favicon.svg', '/manifest.webmanifest']

// The ONLY /api endpoint safe to cache: the login-page tenant dropdown (ids + names), served
// WITHOUT auth by design (server.js → auth.publicTenants). Everything else under /api/* is
// authenticated or session-scoped PII (e.g. /api/homecheck/v1/inventory/:id) and is never cached.
const PUBLIC_API_SWR = new Set(['/api/auth/tenants'])

// Public static assets safe to stale-while-revalidate (bundled fonts live under /assets/ and are
// handled by the cache-first branch instead).
const STATIC_RE = /\.(?:svg|png|jpe?g|ico|webmanifest|woff2?)$/

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(APP_SHELL))
      .catch(() => {})            // non-fatal if offline during install
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Message channel: the page can force activation of a waiting SW (VersionWatcher) or wipe every
// cache on logout so no cached shell/asset survives a session change.
self.addEventListener('message', (event) => {
  const type = event.data && event.data.type
  if (type === 'SKIP_WAITING') self.skipWaiting()
  else if (type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))))
  }
})

// Minimal offline fallback so respondWith() always receives a Response (never undefined).
const OFFLINE_HTML = '<!doctype html><meta charset=utf-8><title>Offline</title>' +
  '<body style="font:16px system-ui;padding:2rem">You are offline. Reconnect and reload.</body>'
const offlineResponse = () =>
  new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

// Cache a response WITHOUT touching the body returned to the page: clone synchronously (before the
// body is consumed), then put the clone asynchronously. Calling .clone() inside a later microtask
// (e.g. after caches.open resolves) throws "Response body is already used".
function cachePut(req, res) {
  if (!res || !res.ok) return
  const copy = res.clone()
  caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {})
}

// stale-while-revalidate: serve cached immediately (if present), refresh in the background.
// Never resolves to undefined — falls back to the cached copy, then a network-error Response.
function staleWhileRevalidate(req) {
  return caches.match(req).then((cached) => {
    const network = fetch(req)
      .then((res) => { cachePut(req, res); return res })
      .catch(() => cached || Response.error())
    return cached || network
  })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return                         // never touch mutations
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return          // leave cross-origin (CDN, etc.) alone

  // version.json MUST stay fresh — VersionWatcher relies on it to detect new deploys. Never cache.
  if (url.pathname === '/version.json') return

  // /api/*: fail-closed. Only the explicit public allowlist is cached (SWR); everything else —
  // all authenticated data, all tenant/portfolio responses, all session PII — passes through.
  if (url.pathname.startsWith('/api/')) {
    if (PUBLIC_API_SWR.has(url.pathname)) { event.respondWith(staleWhileRevalidate(req)); return }
    return
  }

  // HTML navigations: network-first (fresh bundle on every online load), offline fallback to the
  // cached route shell, then the root shell, then a minimal offline page (never undefined).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { cachePut(req, res); return res })
        .catch(async () => {
          const shell = (await caches.match(req)) || (await caches.match('/')) || (await caches.match('/home-check'))
          return shell || offlineResponse()
        }),
    )
    return
  }

  // Hashed assets (Vite injects a content hash in the filename): cache-first, immutable.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req)
          .then((res) => { cachePut(req, res); return res })
          .catch(() => Response.error())
      }),
    )
    return
  }

  // Public static assets (icons, manifest, fonts served from root): stale-while-revalidate.
  if (STATIC_RE.test(url.pathname)) { event.respondWith(staleWhileRevalidate(req)); return }

  // Fail-closed default: anything else passes straight through to the network, uncached.
})

// ── Hostile self-review ────────────────────────────────────────────────────────────────────
// Q: After a push-to-main deploy, can a logged-in user be stranded on an old bundle or ever be
//    served a cached authenticated/portfolio response?
// A: No. (1) Old bundle: HTML navigations are network-first, so an online reload always fetches
//    the fresh index.html and its content-hashed assets; the deploy also changes __BUILD_ID__ →
//    CACHE_NAME, so the new SW's activate wipes every prior cache. VersionWatcher additionally
//    prompts a reload. (2) Authenticated data: the ONLY cached /api path is /api/auth/tenants
//    (public, unauthenticated by design); every other /api/* — including /api/db/*, /api/serff/*,
//    /api/duckcreek/*, /api/storage/*, and /api/homecheck/v1/inventory/:id session PII — is passed
//    straight through and never enters a cache. On logout the page also posts CLEAR_ALL_CACHES.
