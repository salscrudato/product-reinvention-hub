import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Self-heal a stale-chunk load failure. After a push-to-main redeploy, a client still
// running an OLD index.html requests fingerprinted chunk hashes that no longer exist; the
// host now 404s those (server/server.js) so the dynamic import rejects with Vite's
// `vite:preloadError` (rather than a text/html MIME error that hard-fails the app). Reload
// ONCE per session onto fresh index.html + current hashes. The sessionStorage guard means a
// persistent (non-stale) failure never loops — it falls through to the ErrorBoundary's
// manual recovery screen instead. Complements VersionWatcher (which only prompts on a poll).
const PRELOAD_RELOAD_GUARD = 'pf:preload-reloaded'
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem(PRELOAD_RELOAD_GUARD)) return // already auto-reloaded this session
  sessionStorage.setItem(PRELOAD_RELOAD_GUARD, '1')
  event.preventDefault() // suppress the default re-throw; we recover by reloading
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: register the service worker in production only (dev keeps HMR untouched).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is best-effort */ })
  })
}
