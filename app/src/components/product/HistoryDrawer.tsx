// History drawer — a product-wide AUDIT TRAIL. Every recorded change to the product
// doc and its subtree (coverages, rules, form rules, rating programs — the entities in
// the product's partition) shows as a timeline entry with who · what · when and the
// exact field-level before → after diff. Entries are the version docs written
// atomically by adapter.db.mutate() (entity + audit + version, one transaction), read
// via /db/versions (PCM-B). Server version docs carry no snapshot, so the restore
// action only appears for legacy rows that have one — never invented.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconRestore, IconChevronDown, IconChevronRight, IconSearch } from '../ui/icons'
import { Drawer } from '../ui/Drawer'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import type { WithId } from '../../context/ProductContext'
import type { Version } from '@pf/shared'
import { versionAction } from '../../lib/backend/versionRead'

interface Props { onClose: () => void; entityPath: string }

// Friendly label + accent for each entity type surfaced in the trail.
const ENTITY_META: Record<string, { label: string; color: 'purple' | 'blue' | 'good' | 'warn' | 'default' }> = {
  product:        { label: 'Product',    color: 'purple'  },
  coverage:       { label: 'Coverage',   color: 'blue'    },
  rule:           { label: 'Rule',       color: 'good'     },
  formRule:       { label: 'Form rule',  color: 'good'     },
  ratingProgram:  { label: 'Pricing',    color: 'warn'    },
  form:           { label: 'Form',       color: 'default' },
}

function timeAgo(at: unknown): string {
  if (!at) return '—'
  const ts = at instanceof Object && 'toDate' in (at as object) ? (at as { toDate(): Date }).toDate() : new Date(String(at))
  const diff = Math.round((Date.now() - ts.getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return ts.toLocaleDateString()
}

function exactTime(at: unknown): string {
  if (!at) return ''
  const ts = at instanceof Object && 'toDate' in (at as object) ? (at as { toDate(): Date }).toDate() : new Date(String(at))
  return Number.isNaN(ts.getTime()) ? '' : ts.toLocaleString()
}

// Action comes from the recorded op (PCM-B) with the legacy snapshot heuristic
// as fallback — see versionAction in lib/backend/versionRead.ts.
const ACTION_META: Record<string, { label: string; color: 'good' | 'blue' | 'danger' | 'purple' }> = {
  create:  { label: 'Created',  color: 'good' },
  update:  { label: 'Updated',  color: 'blue' },
  delete:  { label: 'Deleted',  color: 'danger' },
  restore: { label: 'Restored', color: 'purple' },
}

// A readable name for the changed entity, drawn from its snapshot then its path.
function entityName(v: WithId<Version>): string {
  const s = v.snapshot as Record<string, unknown> | null
  const fromSnap = s && (s.name ?? s.label ?? s.title ?? s.refId)
  if (typeof fromSnap === 'string' && fromSnap.trim()) return fromSnap
  const seg = v.entityPath.split('/').filter(Boolean).pop() ?? ''
  return seg
}

// Humanise a field key ("marketSegment" → "Market segment") and format a value for display.
function humanField(field: string): string {
  const spaced = field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
function fmtValue(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : 'empty'
  try { return JSON.stringify(v) } catch { return String(v) }
}
function truncate(s: string, n = 64): string { return s.length > n ? s.slice(0, n) + '…' : s }

function DiffView({ diff }: { diff: WithId<Version>['diff'] }) {
  if (!diff?.length) return <p className="text-xs text-faint">No field changes recorded.</p>
  return (
    <div className="flex flex-col gap-1.5">
      {diff.map((d, i) => (
        <div key={i} className="flex flex-col gap-0.5 rounded-[8px] bg-page px-2.5 py-1.5" style={{ border: '1px solid var(--color-border)' }}>
          <span className="font-mono text-[11px] text-dim">{humanField(d.field)}</span>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-danger line-through break-all" title={fmtValue(d.before)}>{truncate(fmtValue(d.before))}</span>
            <span className="text-faint shrink-0">→</span>
            <span className="text-good break-all" title={fmtValue(d.after)}>{truncate(fmtValue(d.after))}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function HistoryDrawer({ onClose }: Props) {
  const { versions } = useProductCtx()
  const { user } = useUser()
  const canEdit = canI(user, 'product:write')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null)   // A5: inline restore confirm (no native window.confirm)
  const [filter, setFilter] = useState<string>('all')
  const [q, setQ] = useState('')
  const PAGE = 50
  const [limit, setLimit] = useState(PAGE)
  // Reset pagination window when the filter or search query changes.
  useEffect(() => { setLimit(PAGE) }, [filter, q])

  // The whole product's change history (versions are already scoped to this product by
  // productId in ProductContext), newest first.
  const all = versions as WithId<Version>[]

  // Entity-type facets present in the trail (for the filter chips).
  const facets = useMemo(() => {
    const set = new Set(all.map(v => v.entityType))
    return ['all', ...[...set].sort()]
  }, [all])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter(v => {
      if (filter !== 'all' && v.entityType !== filter) return false
      if (!needle) return true
      return (
        entityName(v).toLowerCase().includes(needle) ||
        (v.actor?.name ?? '').toLowerCase().includes(needle) ||
        (v.diff ?? []).some(d => d.field.toLowerCase().includes(needle))
      )
    })
  }, [all, filter, q])

  // The entity's CURRENT rev = the highest rev recorded for that path (the drawer shows the
  // whole product's trail). Sent as the optimistic-concurrency token so a concurrent edit → 409.
  function currentRevOf(entityPath: string): number {
    return all.reduce((m, x) => (x.entityPath === entityPath ? Math.max(m, x.rev ?? 0) : m), 0)
  }
  // A row is restorable when it is a real version (rev > 0) AND not already the entity's
  // current state (restoring to the latest rev is a no-op the server rejects). versionRead
  // maps canRestore = rev > 0; the "not current" refinement lives here where currentRev is known.
  function isRestorable(v: WithId<Version>): boolean {
    return !!v.canRestore && v.rev != null && v.rev < currentRevOf(v.entityPath)
  }

  // Restore is gated by an inline confirm (A5: no native window.confirm). `askRestore`
  // arms the confirm on a row; `doRestore` performs the forward restore once confirmed.
  function askRestore(v: WithId<Version>) {
    if (!isRestorable(v)) { toast.error('This version can’t be restored'); return }
    setConfirmRestoreId(v.id)
  }

  async function doRestore(v: WithId<Version>) {
    if (!isRestorable(v) || v.rev == null) return
    setRestoring(v.id)
    try {
      // Restore targets the version's OWN entity — not the product doc — so restoring a
      // coverage/rule change rewinds that child entity. The SERVER reconstructs the state at
      // this rev and commits it forward (new rev + version + hash-chained audit event); we send
      // only the target rev and the entity's current rev as the optimistic-concurrency token.
      await adapter.db.restore(v.entityPath, v.rev, currentRevOf(v.entityPath))
      toast.success('Restored to selected version')
      setConfirmRestoreId(null)
    } catch (err) {
      // 409 stale rev → conflict toast; the write already poked the pollers, so history refreshes.
      if (err instanceof MutationConflictError) conflictToast({})
      // 422 unreconstructable (a gap or a delete in this entity's history) → explain honestly,
      // never a silent failure or a best-guess restore.
      else if (err instanceof Error && /unreconstructable/.test(err.message)) {
        toast.error('Can’t restore — this entity’s change history has a gap.')
      } else toast.error('Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  return (
    <Drawer open title="Change history" onClose={onClose} width="w-[480px]">
      <div className="flex flex-col gap-3">
        {/* Search + entity filter */}
        {all.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <div className="relative">
              <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search changes, fields, people…"
                aria-label="Search change history"
                className="w-full h-8 pl-8 pr-3 rounded-[8px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25" />
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {facets.map(f => {
                const active = filter === f
                const label = f === 'all' ? 'All' : (ENTITY_META[f]?.label ?? f)
                return (
                  <button key={f} onClick={() => setFilter(f)} aria-pressed={active}
                    className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium transition-colors ${active ? 'bg-accent text-on-accent' : 'bg-raised text-dim hover:text-text'}`}>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {all.length === 0 ? (
          <p className="text-sm text-faint">No changes recorded for this product yet. Edits appear here as they happen.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-faint">No changes match your search.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.slice(0, limit).map(v => {
              const action = versionAction(v)
              const am = ACTION_META[action]
              const em = ENTITY_META[v.entityType] ?? { label: v.entityType, color: 'default' as const }
              const isOpen = expanded === v.id
              return (
                <div key={v.id} className="rounded-[12px] bg-raised overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                  <button
                    className="w-full flex items-start gap-2.5 px-3.5 py-3 text-sm text-left hover:bg-[var(--color-ghost)]"
                    onClick={() => { setExpanded(e => e === v.id ? null : v.id); setConfirmRestoreId(null) }}
                    aria-expanded={isOpen}
                  >
                    <span className="mt-0.5 text-faint shrink-0">{isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</span>
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge label={am.label} color={am.color} />
                        <Badge label={em.label} color={em.color} />
                        <span className="text-[13px] font-medium text-text truncate">{entityName(v)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-faint">
                        <span>{v.actor?.name ?? '—'}</span>
                        <span aria-hidden="true">·</span>
                        <span title={exactTime(v.at)}>{timeAgo(v.at)}</span>
                        {(v.diff?.length ?? 0) > 0 && action === 'update' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{v.diff!.length} field{v.diff!.length === 1 ? '' : 's'}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-3.5 pb-3.5 flex flex-col gap-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <div className="pt-3"><DiffView diff={v.diff ?? []} /></div>
                      {canEdit && isRestorable(v) && (
                        confirmRestoreId === v.id ? (
                          // Inline restore confirmation — on-brand replacement for the native
                          // window.confirm (A5), kept in-drawer to avoid a modal-on-modal. Warn
                          // (not danger) tokens: a restore overwrites, it doesn't destroy.
                          <div className="flex flex-col gap-2 rounded-[9px] bg-surface p-3" style={{ border: '1px solid var(--color-warn-line)' }}>
                            <p className="text-[12px] text-warn">
                              Restore to the version from {timeAgo(v.at)}? This overwrites the current values.
                            </p>
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setConfirmRestoreId(null)} disabled={restoring === v.id}>Cancel</Button>
                              <Button variant="primary" size="sm" onClick={() => doRestore(v)} disabled={restoring === v.id}>
                                <IconRestore size={12} />
                                {restoring === v.id ? 'Restoring…' : 'Restore'}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => askRestore(v)}>
                            <IconRestore size={12} />
                            Restore to this version
                          </Button>
                        )
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {shown.length > limit && (
              <button
                onClick={() => setLimit(l => l + PAGE)}
                className="w-full py-2 text-sm text-dim hover:text-text transition-colors rounded-[10px] hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                Load {Math.min(PAGE, shown.length - limit)} more… ({shown.length - limit} remaining)
              </button>
            )}
          </div>
        )}
      </div>
    </Drawer>
  )
}
