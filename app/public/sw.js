// Minimal offline-capable service worker (PWA). Kept dependency-free and scoped to
// same-origin GETs so it never touches Firebase/API traffic. Navigations are
// network-first with a cached app-shell fallback; static assets are
// stale-while-revalidate so a repeat visit works offline. Registered in production
// only (see main.tsx) to avoid interfering with the Vite dev server / HMR.
const CACHE = 'prh-v1'
const APP_SHELL = ['/', '/favicon.svg', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {}).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // leave Firebase / cross-origin alone

  // Navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res })
        .catch(() => caches.match(req).then((r) => r || caches.match('/'))),
    )
    return
  }

  // Static assets: serve cache first, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) } return res })
        .catch(() => cached)
      return cached || network
    }),
  )
})
