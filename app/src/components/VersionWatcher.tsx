// VersionWatcher — seamless deploy updates without cache clearing. The build stamps a
// unique __BUILD_ID__ and emits /version.json (served no-cache). This polls it (on an
// interval and on tab focus); when the deployed build id differs from the running one it
// shows a single persistent toast offering a one-tap reload. Combined with the Firebase
// cache headers (immutable hashed assets + no-cache HTML/version.json), a new deploy is
// picked up automatically — users never have to hard-refresh or clear their cache.
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

declare const __BUILD_ID__: string

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
          toast('A new version is available', {
            description: 'Reload to get the latest.',
            duration: Infinity,
            action: { label: 'Reload', onClick: () => window.location.reload() },
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
