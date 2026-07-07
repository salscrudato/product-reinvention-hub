// useLiveCollection — a small loading/ready/error + realtime collection hook for the
// Home cockpit panels. It does one awaited list() so a hard failure (permission /
// network) surfaces as a genuine ERROR state instead of a silent empty list, then
// keeps the data live via subscribe(). All access goes through the adapter seam.
import { useEffect, useState } from 'react'
import { adapter } from './backend'
import type { Query } from './backend'

export type LoadStatus = 'loading' | 'ready' | 'error'

/** Fold several collection states into one for a panel that reads from more than one
 *  collection: any error wins, then any still-loading, otherwise ready. */
export function combineStatus(...statuses: LoadStatus[]): LoadStatus {
  if (statuses.includes('error'))   return 'error'
  if (statuses.includes('loading')) return 'loading'
  return 'ready'
}

export interface LiveCollection<T> {
  items:  (T & { id: string })[]
  status: LoadStatus
}

/** Subscribe to a collection with real state handling.
 *  `q` (used only for the one-shot error probe) MUST be a stable reference — pass a
 *  module-level constant, not an inline object, so the effect doesn't re-run. */
export function useLiveCollection<T>(path: string, q?: Query): LiveCollection<T> {
  const [items, setItems]   = useState<(T & { id: string })[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')

  useEffect(() => {
    let live = true
    let delivered = false

    // Realtime data. The adapter degrades listener errors to [] (and logs), so this
    // path alone can't tell "empty" from "failed" — hence the awaited probe below.
    const unsub = adapter.db.subscribe<T & { id: string }>(path, (d) => {
      if (!live || !Array.isArray(d)) return
      delivered = true
      setItems(d)
      setStatus('ready')
    })

    // One awaited read purely to detect a hard failure. Ignored once realtime has
    // delivered — a working listener always wins over a probe race.
    adapter.db.list<T & { id: string }>(path, q)
      .then(() => { if (live && !delivered) setStatus('ready') })
      .catch(() => { if (live && !delivered) setStatus('error') })

    return () => { live = false; unsub() }
  }, [path, q])

  return { items, status }
}
