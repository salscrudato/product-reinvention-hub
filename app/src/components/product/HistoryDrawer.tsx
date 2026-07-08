// History drawer — a product-wide AUDIT TRAIL. Every recorded change to the product and
// its child entities (coverages, rules, pricing, forms) shows as a timeline entry with
// who · what · when and the exact field-level before → after diff. EDITOR/ADMIN can
// restore any versioned entity to a prior snapshot. Entries are the `versions` written
// atomically by adapter.db.mutate() (entity + audit + version, one transaction), scoped
// to this product via productId.
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconRestore, IconChevronDown, IconChevronRight, IconSearch } from '../ui/icons'
import { Drawer } from '../ui/Drawer'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import type { WithId } from '../../context/ProductContext'
import type { Version } from '@pf/shared'

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

// Version rows don't carry `action`, but it's inferable: a null snapshot is a delete; a
// diff whose every `before` is null is a create; anything else is an update.
function inferAction(v: WithId<Version>): 'create' | 'update' | 'delete' {
  if (v.snapshot == null) return 'delete'
  const diff = v.diff ?? []
  if (diff.length > 0 && diff.every(d => d.before == null || d.before === undefined)) return 'create'
  return 'update'
}
const ACTION_META: Record<string, { label: string; color: 'good' | 'blue' | 'danger' }> = {
  create: { label: 'Created', color: 'good' },
  update: { label: 'Updated', color: 'blue' },
  delete: { label: 'Deleted', color: 'danger' },
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
  const { versions, pid } = useProductCtx()
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const [expanded, setExpanded] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [q, setQ] = useState('')

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

  async function handleRestore(v: WithId<Version>) {
    if (!v.snapshot) { toast.error('No snapshot available for this version'); return }
    const confirmed = window.confirm(`Restore ${ENTITY_META[v.entityType]?.label ?? v.entityType} "${entityName(v)}" to the version from ${timeAgo(v.at)}? This overwrites current values.`)
    if (!confirmed) return
    setRestoring(v.id)
    try {
      // Restore targets the version's OWN entity — not the product doc — so restoring a
      // coverage/rule change writes back to that child entity.
      await adapter.db.mutate({
        op: 'update', path: v.entityPath,
        data: v.snapshot as Record<string, unknown>,
        entityType: v.entityType, productId: v.productId ?? pid, actor,
      })
      toast.success('Restored to selected version')
    } catch (err) {
      if (err instanceof MutationConflictError) toast.error('Conflict — refresh and try again.')
      else toast.error('Restore failed')
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
                    className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium transition-colors ${active ? 'bg-accent text-white' : 'bg-raised text-dim hover:text-text'}`}>
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
            {shown.map(v => {
              const action = inferAction(v)
              const am = ACTION_META[action]
              const em = ENTITY_META[v.entityType] ?? { label: v.entityType, color: 'default' as const }
              const isOpen = expanded === v.id
              return (
                <div key={v.id} className="rounded-[12px] bg-raised overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                  <button
                    className="w-full flex items-start gap-2.5 px-3.5 py-3 text-sm text-left hover:bg-[rgba(19,19,26,.02)]"
                    onClick={() => setExpanded(e => e === v.id ? null : v.id)}
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
                      {canEdit && v.snapshot != null && (
                        <Button variant="ghost" size="sm" disabled={restoring === v.id}
                          onClick={() => handleRestore(v)}>
                          <IconRestore size={12} />
                          {restoring === v.id ? 'Restoring…' : 'Restore to this version'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Drawer>
  )
}
