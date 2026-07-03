// Feedback & Backlog (/app/feedback) — the product's own PM loop. Left: the Inbox
// (NEW + REVIEWING) with a context chip that deep-links, a one-vote-per-user
// button, and a votes×recency heat bar. Right: the Backlog (PLANNED), drag-ranked
// by EDITOR+ with impact/effort chips. Below: a SHIPPED changelog; DECLINED
// collapsed. Status changes are EDITOR+ and audited. Realtime throughout.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { toast } from 'sonner'
import { Lightbulb, Bug, Heart, ArrowBigUp, Link2, GripVertical } from 'lucide-react'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Skeleton } from '../components/ui'
import type { Feedback, FeedbackType, FeedbackStatus } from '@pf/shared'

type FeedbackDoc = Feedback & { id: string }

const TYPE_META: Record<FeedbackType, { icon: typeof Lightbulb; color: 'blue' | 'danger' | 'good' }> = {
  IDEA:   { icon: Lightbulb, color: 'blue' },
  ISSUE:  { icon: Bug,       color: 'danger' },
  PRAISE: { icon: Heart,     color: 'good' },
}

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v
  const o = v as { toDate?: () => Date; seconds?: number }
  if (o && typeof o.toDate === 'function') return o.toDate().getTime()
  if (o && typeof o.seconds === 'number') return o.seconds * 1000
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t }
  return 0
}

// votes × recency decay (half-life ~14 days)
function heatOf(fb: FeedbackDoc): number {
  const ageDays = Math.max(0, (Date.now() - toMillis(fb.createdAt)) / 86_400_000)
  return (fb.votes?.count ?? 0) * Math.exp(-ageDays / 14) + 0.15 * Math.exp(-ageDays / 14)
}

export default function Feedback() {
  const navigate = useNavigate()
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'
  const [items, setItems] = useState<FeedbackDoc[] | null>(null)

  useEffect(() => {
    const unsub = adapter.db.subscribe<FeedbackDoc>('feedback', d => { if (Array.isArray(d)) setItems(d) })
    return unsub
  }, [])

  const maxHeat = useMemo(() => Math.max(0.001, ...(items ?? []).map(heatOf)), [items])
  const lanes = useMemo(() => {
    const by = (s: FeedbackStatus) => (items ?? []).filter(f => f.status === s)
    return {
      NEW:       by('NEW').sort((a, b) => heatOf(b) - heatOf(a)),
      REVIEWING: by('REVIEWING').sort((a, b) => heatOf(b) - heatOf(a)),
      PLANNED:   by('PLANNED').sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
      SHIPPED:   by('SHIPPED').sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)),
      DECLINED:  by('DECLINED'),
    }
  }, [items])

  async function vote(fb: FeedbackDoc) {
    if (!user) return
    if ((fb.votes?.voters ?? []).includes(user.uid)) { toast.info('You already voted'); return }
    try { await adapter.db.vote(`feedback/${fb.id}`, user.uid) }
    catch { toast.error('Vote failed') }
  }

  async function patch(fb: FeedbackDoc, changes: Partial<Feedback>, ok: string) {
    if (!user) return
    const { id, ...rest } = fb
    try {
      await adapter.db.mutate({
        op: 'update', path: `feedback/${id}`, data: { ...rest, ...changes },
        entityType: 'feedback', actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        expectedRev: (fb as { rev?: number }).rev,
      })
      toast.success(ok)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Update failed')
    }
  }

  async function reorderPlanned(ordered: FeedbackDoc[]) {
    // Persist new sequential ranks for any item whose rank changed (audited).
    await Promise.all(ordered.map((fb, i) => (fb.rank ?? -1) === i ? null : patch(fb, { rank: i }, 'Backlog reordered')).filter(Boolean) as Promise<void>[])
  }

  if (items === null) {
    return <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
  }

  const cardProps = { canEdit, uid: user?.uid, maxHeat, onVote: vote, onPatch: patch, navigate }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-text">Feedback &amp; Backlog</h1>
        <p className="text-sm text-dim">Capture with ⌘. anywhere. Vote to raise the heat. Plan what ships next.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inbox */}
        <div className="flex flex-col gap-4">
          <Lane title="New" count={lanes.NEW.length}>
            {lanes.NEW.length === 0 ? <LaneEmpty text="No new feedback. Press ⌘. to add some." /> : lanes.NEW.map(fb => <Card key={fb.id} fb={fb} {...cardProps} />)}
          </Lane>
          <Lane title="Reviewing" count={lanes.REVIEWING.length}>
            {lanes.REVIEWING.length === 0 ? <LaneEmpty text="Nothing under review." /> : lanes.REVIEWING.map(fb => <Card key={fb.id} fb={fb} {...cardProps} />)}
          </Lane>
        </div>

        {/* Backlog */}
        <Lane title="Backlog · Planned" count={lanes.PLANNED.length}>
          {lanes.PLANNED.length === 0 ? <LaneEmpty text="Nothing planned yet." /> : (
            <PlannedList items={lanes.PLANNED} canEdit={canEdit} onReorder={reorderPlanned}>
              {fb => <Card fb={fb} {...cardProps} sortable />}
            </PlannedList>
          )}
        </Lane>
      </div>

      {/* Shipped changelog */}
      {lanes.SHIPPED.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-good uppercase tracking-wide">Shipped</span>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {lanes.SHIPPED.map(fb => (
              <div key={fb.id} className="shrink-0 w-56 bg-surface rounded-[12px] p-3 flex flex-col gap-1" style={{ border: '1px solid var(--color-border)' }}>
                <span className="text-sm font-medium text-text truncate">{fb.title}</span>
                <span className="text-[11px] text-faint">{new Date(toMillis(fb.updatedAt)).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Declined (collapsed) */}
      {lanes.DECLINED.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-dim hover:text-text">Declined ({lanes.DECLINED.length})</summary>
          <div className="flex flex-col gap-2 mt-2 opacity-70">
            {lanes.DECLINED.map(fb => <Card key={fb.id} fb={fb} {...cardProps} />)}
          </div>
        </details>
      )}
    </div>
  )
}

// ─── Lane wrappers ──────────────────────────────────────────────────────────

function Lane({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-dim uppercase tracking-wide">{title}</span>
        <span className="text-[11px] text-faint tabular-nums">{count}</span>
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}
function LaneEmpty({ text }: { text: string }) { return <p className="text-xs text-faint italic px-1 py-3">{text}</p> }

function PlannedList({ items, canEdit, onReorder, children }: {
  items: FeedbackDoc[]; canEdit: boolean; onReorder: (o: FeedbackDoc[]) => void; children: (fb: FeedbackDoc) => React.ReactNode
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor))
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const oldI = items.findIndex(i => i.id === e.active.id)
    const newI = items.findIndex(i => i.id === e.over!.id)
    if (oldI < 0 || newI < 0) return
    onReorder(arrayMove(items, oldI, newI))
  }
  if (!canEdit) return <>{items.map(fb => <div key={fb.id}>{children(fb)}</div>)}</>
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
        {items.map(fb => <div key={fb.id}>{children(fb)}</div>)}
      </SortableContext>
    </DndContext>
  )
}

// ─── Card ───────────────────────────────────────────────────────────────────

const NEXT: Record<FeedbackStatus, FeedbackStatus[]> = {
  NEW:       ['REVIEWING', 'PLANNED', 'DECLINED'],
  REVIEWING: ['PLANNED', 'DECLINED', 'NEW'],
  PLANNED:   ['SHIPPED', 'REVIEWING', 'DECLINED'],
  SHIPPED:   ['PLANNED'],
  DECLINED:  ['NEW'],
}

interface CardProps {
  fb: FeedbackDoc
  canEdit: boolean
  uid?: string
  maxHeat: number
  onVote: (fb: FeedbackDoc) => void
  onPatch: (fb: FeedbackDoc, c: Partial<Feedback>, ok: string) => void
  navigate: (to: string) => void
  sortable?: boolean
}

function Card({ fb, canEdit, uid, maxHeat, onVote, onPatch, navigate, sortable }: CardProps) {
  const sort = useSortable({ id: fb.id, disabled: !sortable || !canEdit })
  const voted = uid ? (fb.votes?.voters ?? []).includes(uid) : false
  const heat  = heatOf(fb)
  const ctx   = fb.context as { route?: string; label?: string; refId?: string } | undefined
  const chipLabel = ctx?.refId ?? ctx?.label ?? ctx?.route

  const style = sortable && sort.transform
    ? { transform: `translate3d(${sort.transform.x}px, ${sort.transform.y}px, 0)`, transition: sort.transition }
    : undefined

  return (
    <div ref={sortable ? sort.setNodeRef : undefined}
      style={{ ...style, border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      className={`bg-surface rounded-[12px] p-3.5 flex flex-col gap-2.5 ${sort.isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start gap-2">
        {sortable && canEdit && (
          <button {...sort.attributes} {...sort.listeners} className="text-faint hover:text-dim cursor-grab active:cursor-grabbing mt-0.5" aria-label="Drag to reorder"><GripVertical size={14} /></button>
        )}
        <span className="mt-0.5"><Badge label={fb.type} color={TYPE_META[fb.type].color} /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-text">{fb.title}</span>
          {fb.detail && <span className="block text-xs text-dim leading-relaxed line-clamp-2 mt-0.5">{fb.detail}</span>}
        </span>
        {/* Vote */}
        <button onClick={() => onVote(fb)} disabled={voted}
          className={`shrink-0 flex flex-col items-center rounded-[9px] px-2 py-1 transition-colors ${voted ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}
          title={voted ? 'You voted' : 'Vote'} aria-pressed={voted}>
          <ArrowBigUp size={15} />
          <span className="text-[11px] font-semibold tabular-nums">{fb.votes?.count ?? 0}</span>
        </button>
      </div>

      {/* Heat bar */}
      <div className="h-1.5 rounded-full bg-raised overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(6, (heat / maxHeat) * 100)}%`, background: 'linear-gradient(90deg,#9333EA,#DB2777)' }} />
      </div>

      <div className="flex items-center flex-wrap gap-2">
        {chipLabel && (
          <button onClick={() => ctx?.route && navigate(ctx.route)}
            className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline max-w-full truncate" title={ctx?.route}>
            <Link2 size={10} className="shrink-0" /> <span className="font-mono truncate">{chipLabel}</span>
          </button>
        )}
        <span className="flex-1" />
        {(fb.status === 'PLANNED' || canEdit) && (
          <>
            <ImpactEffortChip label="Impact" value={fb.impact} canEdit={canEdit} onCycle={v => onPatch(fb, { impact: v }, 'Impact updated')} />
            <ImpactEffortChip label="Effort" value={fb.effort} canEdit={canEdit} onCycle={v => onPatch(fb, { effort: v }, 'Effort updated')} />
          </>
        )}
        {canEdit && (
          <select value="" onChange={e => e.target.value && onPatch(fb, { status: e.target.value as FeedbackStatus }, `Moved to ${e.target.value}`)}
            className="h-6 px-1.5 rounded-[7px] bg-raised border-0 text-[11px] text-dim focus:outline-none" aria-label="Change status">
            <option value="">Move…</option>
            {NEXT[fb.status].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}

function ImpactEffortChip({ label, value, canEdit, onCycle }: { label: string; value: 1 | 2 | 3; canEdit: boolean; onCycle: (v: 1 | 2 | 3) => void }) {
  const next = ((value % 3) + 1) as 1 | 2 | 3
  const dots = '●'.repeat(value) + '○'.repeat(3 - value)
  return (
    <button disabled={!canEdit} onClick={() => onCycle(next)}
      className={`text-[10px] px-1.5 py-0.5 rounded-[6px] bg-raised text-dim ${canEdit ? 'hover:text-text' : 'cursor-default'}`}
      title={`${label}: ${value}/3`}>
      {label[0]} {dots}
    </button>
  )
}
