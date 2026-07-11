// VersionWatcher — detects a new deploy and prompts a one-tap reload, with NO stale-bundle trap.
// The build stamps a unique __BUILD_ID__ (the deploy git hash) and emits /version.json (served
// no-cache by the Azure host). This polls it (on an interval and on tab focus); when the deployed
// build id differs from the running one it:
//   1. tells the service worker to pull the new sw.js and activate it — the new SW's cache name is
//      versioned by the same build id, so its `activate` evicts every prior cache; and
//   2. shows a single persistent toast offering a one-tap reload (which also flushes any waiting SW).
// Because the SW serves HTML network-first and versions its cache per deploy, the reload always
// lands on the fresh bundle — a running client (including an installed PWA) is never stranded on a
// stale bundle after a push-to-main auto-deploy, and never on stale data (the SW caches none).
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

declare const __BUILD_ID__: string

// Pull the newest service worker so its versioned-cache `activate` runs promptly (evicting the
// prior deploy's caches) rather than waiting for the browser's periodic update check.
async function refreshServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    await reg?.update()
  } catch { /* best-effort — a failed update never blocks the reload prompt */ }
}

// Reload to the latest bundle. If a new SW is already installed and waiting, flush it first so the
// reload is controlled by the fresh worker; the reload itself fetches fresh HTML (network-first).
function reloadToLatest(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration()
      .then((reg) => { reg?.waiting?.postMessage({ type: 'SKIP_WAITING' }) })
      .catch(() => {})
      .finally(() => window.location.reload())
  } else {
    window.location.reload()
  }
}

export function VersionWatcher() {
  const notified = useRef(false)

  useEffect(() => {
    let alive = true

    async function check() {
      if (notified.current) return
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const { buildId } = (await res.json()) as { buildId?: string }
        if (alive && buildId && buildId !== __BUILD_ID__) {
          notified.current = true
          void refreshServiceWorker()
          toast('A new version is available', {
            description: 'Reload to get the latest.',
            duration: Infinity,
            action: { label: 'Reload', onClick: reloadToLatest },
          })
        }
      } catch {
        // Offline / transient — try again next tick.
      }
    }

    const iv = setInterval(check, 5 * 60_000)   // every 5 minutes
    const onFocus = () => { void check() }
    window.addEventListener('focus', onFocus)
    void check()

    return () => { alive = false; clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [])

  return null
}
