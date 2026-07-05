// History drawer — versions list with field diffs and confirmed Restore.
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconRestore, IconChevronDown, IconChevronRight } from '../ui/icons'
import { Drawer } from '../ui/Drawer'
import { Button } from '../ui/Button'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import type { WithId } from '../../context/ProductContext'
import type { Version } from '@pf/shared'

interface Props { onClose: () => void; entityPath: string }

function timeAgo(at: unknown): string {
  if (!at) return '—'
  const ts = at instanceof Object && 'toDate' in (at as object) ? (at as { toDate(): Date }).toDate() : new Date(String(at))
  const diff = Math.round((Date.now() - ts.getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.round(diff/60)}m ago`
  if (diff < 86400) return `${Math.round(diff/3600)}h ago`
  return ts.toLocaleDateString()
}

function DiffView({ diff }: { diff: WithId<Version>['diff'] }) {
  if (!diff?.length) return <p className="text-xs text-faint">No field changes recorded.</p>
  return (
    <div className="flex flex-col gap-1">
      {diff.map((d, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className="font-mono text-faint w-32 shrink-0 truncate">{d.field}</span>
          <span className="text-danger line-through truncate max-w-[80px]">{String(d.before ?? '—').substring(0, 30)}</span>
          <span className="text-faint">→</span>
          <span className="text-good truncate max-w-[80px]">{String(d.after ?? '—').substring(0, 30)}</span>
        </div>
      ))}
    </div>
  )
}

export function HistoryDrawer({ onClose, entityPath }: Props) {
  const { versions, pid } = useProductCtx()
  const { user } = useUser()
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const [expanded, setExpanded] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  // Filter versions for this entity path
  const entityVersions = useMemo(() =>
    versions.filter(v => v.entityPath === entityPath)
  , [versions, entityPath])

  async function handleRestore(v: WithId<Version>) {
    if (!v.snapshot) { toast.error('No snapshot available for this version'); return }
    const confirmed = window.confirm(`Restore to version from ${timeAgo(v.at)}? This will overwrite current values.`)
    if (!confirmed) return
    setRestoring(v.id)
    try {
      await adapter.db.mutate({
        op: 'update', path: entityPath,
        data: v.snapshot as Record<string, unknown>,
        entityType: v.entityType, productId: pid, actor,
      })
      toast.success('Restored successfully')
    } catch (err) {
      if (err instanceof MutationConflictError) toast.error('Conflict — refresh and try again.')
      else toast.error('Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  return (
    <Drawer open title="Version history" onClose={onClose} width="w-[460px]">
      {entityVersions.length === 0 ? (
        <p className="text-sm text-faint">No versions recorded for this entity yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entityVersions.map(v => (
            <div key={v.id} className="rounded-[12px] bg-raised overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <button
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-left hover:bg-[rgba(19,19,26,.02)]"
                onClick={() => setExpanded(e => e === v.id ? null : v.id)}
              >
                {expanded === v.id ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-text capitalize">{v.entityType}</span>
                  <span className="text-dim"> · {v.actor?.name ?? '—'}</span>
                  <span className="float-right text-xs text-faint">{timeAgo(v.at)}</span>
                </div>
              </button>

              {expanded === v.id && (
                <div className="px-4 pb-3 flex flex-col gap-3">
                  <DiffView diff={v.diff ?? []} />
                  {(user?.role === 'EDITOR' || user?.role === 'ADMIN') && v.snapshot != null && (
                    <Button variant="ghost" size="sm" disabled={restoring === v.id}
                      onClick={() => handleRestore(v)}>
                      <IconRestore size={12} />
                      {restoring === v.id ? 'Restoring...' : 'Restore to this version'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}
