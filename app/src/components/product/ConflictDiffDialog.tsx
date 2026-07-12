// ConflictDiffDialog — shows both sides of a 409 MutationConflictError instead of a bare toast.
// Fetches the current remote version via adapter.db.get(path), then renders a side-by-side
// property-level diff of the local (attempted) data vs. the remote (winning) data.
// Actions: "Discard my changes" (close without write) or "Reload latest" (full page reload).
import { useEffect, useState } from 'react'
import { Dialog, Button } from '../ui'
import { adapter } from '../../lib/backend'

interface Props {
  /** Entity path that conflicted (e.g. "products/PH.PROD.001"). */
  path: string
  /** The data payload the current user was trying to write. */
  localData: Record<string, unknown>
  onClose: () => void
}

type RemoteDoc = Record<string, unknown> & { data?: Record<string, unknown>; rev?: number }

// ─── Diff helpers ─────────────────────────────────────────────────────────────

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}

interface DiffRow { key: string; local: string; remote: string; changed: boolean }

function buildDiff(local: Record<string, unknown>, remote: Record<string, unknown>): DiffRow[] {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)])
  return [...keys].sort().map(key => {
    const lv = formatValue(local[key])
    const rv = formatValue(remote[key])
    return { key, local: lv, remote: rv, changed: lv !== rv }
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConflictDiffDialog({ path, localData, onClose }: Props) {
  const [remoteData, setRemoteData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    adapter.db.get<RemoteDoc>(path).then(doc => {
      setRemoteData(doc?.data ?? {})
    }).catch(() => {
      setRemoteData(null)
    }).finally(() => setLoading(false))
  }, [path])

  const diff = remoteData ? buildDiff(localData, remoteData) : []
  const changedRows = diff.filter(r => r.changed)

  return (
    <Dialog open={true} title="Edit conflict" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-dim leading-relaxed">
          Another user saved changes to this document while you were editing.
          Your changes were not saved.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-faint">
            Loading current version…
          </div>
        ) : remoteData === null ? (
          <div className="text-sm text-dim py-4">
            Could not load the current version — check your connection and reload.
          </div>
        ) : changedRows.length === 0 ? (
          <div className="text-sm text-dim py-2">
            No differences detected — the document may have already converged.
          </div>
        ) : (
          <div className="rounded-[12px] overflow-hidden text-[12px]"
            style={{ border: '1px solid var(--color-border)' }}>
            {/* Column headers */}
            <div className="grid grid-cols-[minmax(80px,1fr)_1fr_1fr] gap-0"
              style={{ borderBottom: '1.5px solid var(--color-border)', background: 'var(--color-raised)' }}>
              <div className="px-3 py-2 font-semibold text-text">Field</div>
              <div className="px-3 py-2 font-semibold text-text" style={{ borderLeft: '1px solid var(--color-border)' }}>
                Your changes
              </div>
              <div className="px-3 py-2 font-semibold text-text" style={{ borderLeft: '1px solid var(--color-border)' }}>
                Current version
              </div>
            </div>

            {changedRows.map((row, i) => (
              <div
                key={row.key}
                className="grid grid-cols-[minmax(80px,1fr)_1fr_1fr]"
                style={{
                  borderTop: i > 0 ? '1px solid var(--color-border)' : undefined,
                  background: 'var(--color-surface)',
                }}
              >
                <div className="px-3 py-2 font-mono text-faint truncate">{row.key}</div>
                <div
                  className="px-3 py-2 font-mono truncate"
                  style={{
                    borderLeft: '1px solid var(--color-border)',
                    color: 'var(--color-warn)',
                    background: 'var(--color-warn-soft)',
                  }}
                  title={row.local}
                >
                  {row.local}
                </div>
                <div
                  className="px-3 py-2 font-mono truncate"
                  style={{
                    borderLeft: '1px solid var(--color-border)',
                    color: 'var(--color-good)',
                    background: 'var(--color-good-soft)',
                  }}
                  title={row.remote}
                >
                  {row.remote}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Discard my changes
          </Button>
          <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
            Reload latest
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
