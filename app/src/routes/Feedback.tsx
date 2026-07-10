// Feedback (/app/feedback) — "JIRA, but extremely simple": a three-lane board that
// reactivates the real feedback statuses.
//
//   Inbox        → NEW
//   In progress  → REVIEWING + PLANNED   (the two intermediate statuses finally live)
//   Done         → SHIPPED
//   Archived     → DECLINED   (not a lane; a filter toggle in the toolbar)
//
// Editors (EDITOR/ADMIN) move a card two ways — pointer DRAG between lanes, and a
// keyboard-operable ← / → move control on every card — and each move writes `status`
// through adapter.db.mutate() one atomic step along the pipeline
// (NEW → REVIEWING → PLANNED → SHIPPED). Shipping always goes through the completion-note
// step. Declining archives; the Archived view offers Restore or a permanent Delete.
// VIEWERs see the lanes read-only but may still vote (the narrow, rules-legal vote path).
//
// Story cards render the shaped user story: canonical title, type chip, affected surface +
// refId chip (monospace), collapsible acceptance criteria, a vote button + count, the live
// WSJF priorityScore, and the heat bar. Inbox sorts by priorityScore (desc), then heat.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  pointerWithin, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  IconArrowUp, IconLink, IconCheckCircle, IconCheck, IconTrash, IconCamera, IconExpand, IconCopy,
  IconDrag, IconChevronLeft, IconChevronRight, IconChevronDown, IconSearch, IconClose, IconArchive,
  IconRestore, IconActivity, IconIdea, IconBug, IconHeart, type IconType,
} from '../components/ui/icons'
import { adapter, MutationConflictError } from '../lib/backend'
import { conflictToast } from '../lib/conflict'
import { useUser } from '../context/useUser'
import { Skeleton, Dialog, Button } from '../components/ui'
import { priorityScore, type Feedback, type FeedbackStatus, type FeedbackType } from '@pf/shared'

type FeedbackDoc = Feedback & { id: string; rev?: number }
type LaneId = 'inbox' | 'progress' | 'done'
type Actor  = { uid: string; name: string }

// ─── Status pipeline + lane model ─────────────────────────────────────────────

// The ordered backlog pipeline. DECLINED sits OFF this line (it is the archive).
const PIPELINE: FeedbackStatus[] = ['NEW', 'REVIEWING', 'PLANNED', 'SHIPPED']

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  NEW: 'New', REVIEWING: 'Reviewing', PLANNED: 'Planned', SHIPPED: 'Shipped', DECLINED: 'Archived',
}

// Toast shown after a successful lane/status move (SHIPPED is handled by the completion step).
const MOVE_TOAST: Record<FeedbackStatus, string> = {
  NEW: 'Moved to Inbox', REVIEWING: 'Moved to In progress', PLANNED: 'Marked as Planned',
  SHIPPED: 'Shipped', DECLINED: 'Archived',
}

interface LaneDef { id: LaneId; label: string; tint: string; emptyText: string }
const LANES: LaneDef[] = [
  { id: 'inbox',    label: 'Inbox',       tint: 'var(--color-accent)', emptyText: 'No new feedback. Press ⌘. to capture some.' },
  { id: 'progress', label: 'In progress', tint: 'var(--color-warn)',   emptyText: 'Nothing in progress. Drag a card here (or press →) to start work.' },
  { id: 'done',     label: 'Done',        tint: 'var(--color-good)',   emptyText: 'Nothing shipped yet.' },
]

/** Which lane a status renders in (DECLINED → null, i.e. archived, never on the board). */
const laneOf = (s: FeedbackStatus): LaneId | null =>
  s === 'NEW' ? 'inbox' : s === 'SHIPPED' ? 'done'
    : (s === 'REVIEWING' || s === 'PLANNED') ? 'progress' : null

/** Target status when a card is DROPPED into a lane. Entering "In progress" starts at
 *  REVIEWING (fresh pickup); reopening a shipped card lands at PLANNED. Dropping inside the
 *  same lane keeps the card's status (a no-op move). */
function statusForLane(cur: FeedbackStatus, lane: LaneId): FeedbackStatus {
  if (lane === 'inbox') return 'NEW'
  if (lane === 'done')  return 'SHIPPED'
  if (cur === 'REVIEWING' || cur === 'PLANNED') return cur
  return cur === 'SHIPPED' ? 'PLANNED' : 'REVIEWING'
}

/** One STATUS step along the pipeline (the keyboard ← / → control), or null at the ends. */
const stepStatus = (s: FeedbackStatus, dir: 1 | -1): FeedbackStatus | null => {
  const i = PIPELINE.indexOf(s)
  if (i < 0) return null
  const j = i + dir
  return j >= 0 && j < PIPELINE.length ? PIPELINE[j]! : null
}

const TYPE_META: Record<FeedbackType, { icon: IconType; label: string; fg: string; bg: string }> = {
  IDEA:   { icon: IconIdea,  label: 'Idea',   fg: 'var(--color-accent)', bg: 'var(--color-accent-soft)' },
  ISSUE:  { icon: IconBug,   label: 'Issue',  fg: 'var(--color-danger)', bg: 'var(--color-danger-soft)' },
  PRAISE: { icon: IconHeart, label: 'Praise', fg: 'var(--color-good)',   bg: 'var(--color-good-soft)' },
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v
  const o = v as { toDate?: () => Date; seconds?: number }
  if (o && typeof o.toDate === 'function') return o.toDate().getTime()
  if (o && typeof o.seconds === 'number') return o.seconds * 1000
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t }
  return 0
}

const ageDays = (fb: FeedbackDoc): number => Math.max(0, (Date.now() - toMillis(fb.createdAt)) / 86_400_000)

// Vote-decayed heat (14-day half-life) — the visual bar + the sort tiebreak.
function heatOf(fb: FeedbackDoc): number {
  const decay = Math.exp(-ageDays(fb) / 14)
  return (fb.votes?.count ?? 0) * decay + 0.15 * decay
}

// Live WSJF priority via the shared helper — reflects CURRENT votes + age decay, so the
// backlog re-ranks as items are upvoted or go stale (unlike the value frozen at submit time).
const priorityOf = (fb: FeedbackDoc): number =>
  priorityScore(fb.impact ?? 2, fb.effort ?? 2, fb.votes?.count ?? 0, ageDays(fb))

// Free-text haystack for the instant typeahead filter.
function matchesQuery(fb: FeedbackDoc, q: string): boolean {
  if (!q) return true
  const ctx = fb.context as { label?: string; refId?: string } | undefined
  const hay = [
    fb.title, fb.detail, TYPE_META[fb.type]?.label, ctx?.label, ctx?.refId,
    ...(fb.acceptanceCriteria ?? []), ...(fb.reproSteps ?? []), ...(fb.likelyFiles ?? []),
  ].filter(Boolean).join(' ').toLowerCase()
  return hay.includes(q.toLowerCase())
}

// ─── Per-card Claude Code prompt (ADMIN-only builder affordance) ───────────────

const GUARDRAILS = `## Binding invariants (never violate)

| Invariant | Rule |
|---|---|
| **Adapter seam** | All app reads/writes go through \`adapter\` (\`app/src/lib/backend/\`). Never import Firebase SDK directly in components. |
| **Atomic mutations** | Every entity write uses \`adapter.db.mutate()\`. It batches entity + auditEvent + version + searchIndex atomically. No bare Firestore writes. |
| **Role enforcement** | \`VIEWER\` is read-only. Enforced in Firestore security rules **and** in every Function — both sides, always. |
| **AI server-side** | All Anthropic calls live in \`functions/\`. The browser never calls the Anthropic API. |
| **AI grounded + cited** | AI responses must cite their source documents. Free invention is a bug. |
| **refId / form chips** | \`refId\` and form-number chips are load-bearing display elements. Never strip them. |
| **HO-3 $1,528 canary** | \`shared/src/rating/evaluator.test.ts\` must produce exactly $1,528. |
| **Design tokens** | No hard-coded hex outside \`app/src/index.css\`. Use \`var(--color-*)\` in browser-rendered code. SVG files exported to disk are the only exception. |
| **Model IDs** | \`claude-sonnet-5\` (reasoning) and \`claude-haiku-4-5\` (bulk/simple), defined once in \`functions/src/runtime.ts\`. Never \`claude-fable-5\`. |`

function buildCardPrompt(fb: FeedbackDoc): string {
  const ctx     = fb.context as { route?: string; label?: string; refId?: string } | undefined
  const surface = ctx?.label ?? ctx?.route ?? 'the affected surface'
  const refId   = ctx?.refId ?? ''
  const refLine = refId ? `${surface} · \`${refId}\`` : surface

  const ac    = fb.acceptanceCriteria ?? []
  const repro = fb.type === 'ISSUE' ? (fb.reproSteps  ?? []) : []
  const files = fb.type === 'ISSUE' ? (fb.likelyFiles ?? []) : []

  const lines: string[] = [
    'Ultrathink.',
    '',
    'You are a principal product engineer in the "Product Reinvention Hub" monorepo (AI-native P&C insurance product management; one persona: the insurance product manager). Solo monorepo on master. Do NOT create branches. Commit locally only; do NOT push or deploy.',
    '',
    'Set /model to claude-opus-4-8. Never select claude-fable-5.',
    '',
    `READ FIRST: ${refLine}`,
  ]

  if (files.length > 0) files.forEach(f => lines.push(`  - ${f}`))

  lines.push('', GUARDRAILS, '', '---', '', `TASK: ${fb.title}`)

  if (fb.detail) lines.push('', fb.detail)

  if (repro.length > 0) {
    lines.push('', '**Steps to reproduce:**')
    repro.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  }

  if (files.length > 0) {
    lines.push('', '**Likely files (start here):**')
    files.forEach(f => lines.push(`- \`${f}\``))
  }

  lines.push('', 'DONE WHEN')
  if (ac.length > 0) {
    ac.forEach(c => lines.push(`- [ ] ${c}`))
  } else {
    lines.push(`- [ ] ${fb.title} is implemented as described.`)
  }
  lines.push('- [ ] Gate green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. $1,528 intact.')

  lines.push('', 'FINISH: hostile self-review; re-run the gate; commit locally.')

  return lines.join('\n')
}

// ─── Board ────────────────────────────────────────────────────────────────────

export default function Feedback() {
  const navigate = useNavigate()
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'
  const isAdmin = profile?.role === 'ADMIN'
  const actor: Actor | null = user ? { uid: user.uid, name: user.name ?? user.email ?? 'User' } : null

  const [items, setItems] = useState<FeedbackDoc[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())

  // Filters
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | FeedbackType>('')
  const [showArchived, setShowArchived] = useState(false)

  // Drag + dialogs
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FeedbackDoc | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [completingFor, setCompletingFor] = useState<FeedbackDoc | null>(null)
  const [completionNote, setCompletionNote] = useState('')
  const [completing, setCompleting] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    setItems(null); setLoadError(false)
    let unsub = () => {}
    try {
      unsub = adapter.db.subscribe<FeedbackDoc>('feedback', d => { if (Array.isArray(d)) setItems(d) })
    } catch { setLoadError(true) }
    return () => unsub()
  }, [reloadKey])

  // Prune optimistic-hide ids once the deletion is confirmed by the live snapshot.
  useEffect(() => {
    if (!items) return
    setHiddenIds(prev => {
      if (prev.size === 0) return prev
      const present = new Set(items.map(i => i.id))
      const next = new Set<string>()
      prev.forEach(id => { if (present.has(id)) next.add(id) })
      return next.size === prev.size ? prev : next
    })
  }, [items])

  const visible = useMemo(
    () => (items ?? []).filter(f => !hiddenIds.has(f.id) && matchesQuery(f, query) && (!typeFilter || f.type === typeFilter)),
    [items, hiddenIds, query, typeFilter],
  )
  const itemsById = useMemo(() => new Map(visible.map(f => [f.id, f])), [visible])

  // Partition into lanes; DECLINED items form the archive.
  const lanes = useMemo(() => {
    const map: Record<LaneId, FeedbackDoc[]> = { inbox: [], progress: [], done: [] }
    for (const f of visible) { const l = laneOf(f.status); if (l) map[l].push(f) }
    const byPriority = (a: FeedbackDoc, b: FeedbackDoc) => priorityOf(b) - priorityOf(a) || heatOf(b) - heatOf(a)
    const byRecent   = (a: FeedbackDoc, b: FeedbackDoc) => toMillis(b.updatedAt) - toMillis(a.updatedAt)
    map.inbox.sort(byPriority)      // Inbox: priorityScore desc, then heat
    map.progress.sort(byPriority)   // keep the most actionable in-flight work on top
    map.done.sort(byRecent)         // most recently shipped first
    return map
  }, [visible])

  const archived = useMemo(
    () => visible.filter(f => f.status === 'DECLINED').sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)),
    [visible],
  )
  const maxHeat = useMemo(
    () => Math.max(0.001, ...[...lanes.inbox, ...lanes.progress].map(heatOf)),
    [lanes],
  )
  const activeItem = activeId ? itemsById.get(activeId) ?? null : null
  const activeFilters = (query ? 1 : 0) + (typeFilter ? 1 : 0)

  // ── Mutations ──

  async function vote(fb: FeedbackDoc) {
    if (!user) return
    if ((fb.votes?.voters ?? []).includes(user.uid)) { toast.info('You already voted'); return }
    try { await adapter.db.vote(`feedback/${fb.id}`, user.uid) }
    catch { toast.error('Vote failed') }
  }

  // Write a new status through the atomic envelope. The FULL doc (minus id) is passed so the
  // version field-diff records only the changed keys (mirrors the completion / vote-append paths).
  async function writeStatus(fb: FeedbackDoc, next: FeedbackStatus, opts?: { extra?: Record<string, unknown>; success?: string }) {
    if (!actor) return
    const { id, ...rest } = fb
    try {
      await adapter.db.mutate({
        op: 'update', path: `feedback/${id}`,
        data: { ...rest, status: next, ...(opts?.extra ?? {}) },
        entityType: 'feedback', actor, expectedRev: fb.rev,
      })
      toast.success(opts?.success ?? MOVE_TOAST[next])
    } catch (err) {
      if (err instanceof MutationConflictError) conflictToast({})
      else toast.error('Could not move the card')
    }
  }

  // The single entry point for every lane/status change. Any path to SHIPPED routes through
  // the completion-note dialog first (drag-to-Done included).
  function moveTo(fb: FeedbackDoc, next: FeedbackStatus) {
    if (!canEdit || next === fb.status) return
    if (next === 'SHIPPED') { setCompletingFor(fb); setCompletionNote(''); return }
    void writeStatus(fb, next)
  }

  async function confirmComplete() {
    if (!completingFor) return
    setCompleting(true)
    const note = completionNote.trim()
    await writeStatus(completingFor, 'SHIPPED', {
      extra: note ? { completionNote: note } : undefined,
      success: 'Marked done — nice work',
    })
    setCompleting(false)
    setCompletingFor(null); setCompletionNote('')
  }

  async function remove(fb: FeedbackDoc) {
    if (!actor) return
    setPendingDelete(null)
    setHiddenIds(prev => new Set(prev).add(fb.id))
    try {
      await adapter.db.mutate({
        op: 'delete', path: `feedback/${fb.id}`, entityType: 'feedback', actor, expectedRev: fb.rev,
      })
      toast.success('Feedback deleted')
    } catch (err) {
      setHiddenIds(prev => { const n = new Set(prev); n.delete(fb.id); return n })
      // Delete is last-write-wins: a concurrent delete is idempotent.
      if (err instanceof MutationConflictError) conflictToast({})
      else toast.error('Delete failed')
    }
  }

  // ── Drag handlers (pointer). Keyboard moves go through the card ← / → controls. ──

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const overId = e.over?.id
    if (typeof overId !== 'string') return
    const fb = itemsById.get(String(e.active.id))
    if (!fb) return
    const next = statusForLane(fb.status, overId as LaneId)
    if (next !== fb.status) moveTo(fb, next)
  }

  const cardProps = { canEdit, isAdmin, uid: user?.uid, maxHeat, onVote: vote, onMove: moveTo, onDelete: setPendingDelete, onViewScreenshot: setLightboxUrl, navigate }

  // ── Loading ──
  if (items === null && !loadError) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {LANES.map(l => <Skeleton key={l.id} className="h-72" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-text">Feedback</h1>
          <p className="text-sm text-dim">
            Capture with ⌘. · {canEdit ? 'Drag or use ← → to move cards · ' : ''}Vote to surface priorities.
          </p>
        </div>
      </div>

      {/* Toolbar — instant typeahead + type + archived */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Feedback filters">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
          <input
            type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Filter cards…" aria-label="Filter feedback cards"
            className="w-full h-8 pl-8 pr-8 rounded-[9px] bg-surface text-sm text-text placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            style={{ border: '1px solid var(--color-border)' }}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear filter"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-[6px] text-faint hover:text-danger transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              <IconClose size={13} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="inline-flex rounded-[9px] bg-raised p-0.5" role="group" aria-label="Filter by type">
          {([['', 'All'], ['IDEA', 'Ideas'], ['ISSUE', 'Issues'], ['PRAISE', 'Praise']] as const).map(([val, label]) => {
            const on = typeFilter === val
            return (
              <button key={val || 'all'} type="button" aria-pressed={on} onClick={() => setTypeFilter(val)}
                className={`px-2.5 h-7 rounded-[7px] text-[12px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${on ? 'bg-surface text-accent' : 'text-dim hover:text-text'}`}
                style={on ? { boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : undefined}>
                {label}
              </button>
            )
          })}
        </div>

        <button type="button" aria-pressed={showArchived} onClick={() => setShowArchived(v => !v)}
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[9px] text-[12px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${showArchived ? 'bg-accent-soft text-accent' : 'bg-surface text-dim hover:text-text'}`}
          style={{ border: `1px solid ${showArchived ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}>
          <IconArchive size={13} aria-hidden="true" /> Archived
          <span className="tabular-nums text-faint">{archived.length}</span>
        </button>

        {activeFilters > 0 && (
          <button type="button" onClick={() => { setQuery(''); setTypeFilter('') }}
            className="h-8 px-2.5 rounded-[9px] text-[12px] text-dim hover:text-danger transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            style={{ border: '1px solid var(--color-border)' }}>
            Clear {activeFilters}
          </button>
        )}
      </div>

      {/* Load error (subscription setup failed) — designed, retryable */}
      {loadError && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[12px] text-sm text-danger"
          style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-line)' }}>
          <span className="flex-1">Couldn't load the feedback board.</span>
          <Button variant="ghost" size="sm" onClick={() => setReloadKey(k => k + 1)}>Retry</Button>
        </div>
      )}

      {/* Three-lane board */}
      <DndContext sensors={sensors} collisionDetection={pointerWithin}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          {LANES.map(lane => {
            const laneItems = lanes[lane.id]
            return (
              <Lane key={lane.id} lane={lane} count={laneItems.length} canEdit={canEdit}>
                {laneItems.length > 0
                  ? laneItems.map(fb => <Card key={fb.id} fb={fb} lane={lane.id} {...cardProps} />)
                  : <p className="text-xs text-faint italic px-2 py-6 text-center leading-relaxed">{lane.emptyText}</p>}
              </Lane>
            )
          })}
        </div>

        {/* Archived (DECLINED) — revealed by the toolbar toggle. Inside the DndContext so
            its (drag-disabled) cards resolve the same dnd hooks the board cards use. */}
        {showArchived && (
          <section className="pt-4" style={{ borderTop: '1px dashed var(--color-border)' }} aria-label="Archived feedback">
            <div className="flex items-center gap-2 mb-3">
              <IconArchive size={15} className="text-faint" aria-hidden="true" />
              <h2 className="text-[13px] font-bold text-text">Archived</h2>
              <span className="text-[11px] font-semibold text-faint px-2 rounded-[7px] bg-raised" style={{ border: '1px solid var(--color-border)' }}>
                {archived.length}
              </span>
            </div>
            {archived.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {archived.map(fb => <Card key={fb.id} fb={fb} lane="archived" {...cardProps} />)}
              </div>
            ) : (
              <p className="text-xs text-faint italic px-0.5">Nothing archived. Decline a card to set it aside here.</p>
            )}
          </section>
        )}

        <DragOverlay dropAnimation={null}>
          {activeItem ? <DragPreview fb={activeItem} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Completion-note dialog (the SHIPPED step) */}
      <Dialog open={completingFor !== null} onClose={() => { setCompletingFor(null); setCompletionNote('') }} title="Mark as done" width="max-w-sm">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Shipping <span className="font-medium text-text">"{completingFor?.title}"</span>. Add a note about what you did (optional).
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text" htmlFor="completion-note">What did you do?</label>
            <textarea
              id="completion-note" value={completionNote} onChange={e => setCompletionNote(e.target.value)} rows={3}
              placeholder="e.g. Fixed the deductible save error in TermOptionsDialog" autoFocus
              className="rounded-[10px] bg-surface border border-border-strong text-sm text-text p-3 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setCompletingFor(null); setCompletionNote('') }} disabled={completing}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void confirmComplete()} disabled={completing}>
              {completing ? 'Saving…' : 'Mark done'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Screenshot lightbox */}
      <Dialog open={lightboxUrl !== null} onClose={() => setLightboxUrl(null)} width="max-w-4xl">
        {lightboxUrl && <img src={lightboxUrl} alt="Feedback screenshot" className="w-full rounded-[10px] object-contain max-h-[80vh]" />}
      </Dialog>

      {/* Delete confirmation (permanent — from the Archived view) */}
      <Dialog open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete feedback?" width="max-w-sm">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Permanently removes <span className="font-medium text-text">"{pendingDelete?.title}"</span> and its votes. This can't be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => pendingDelete && remove(pendingDelete)}>Delete</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

// ─── Lane (droppable) ─────────────────────────────────────────────────────────

function Lane({ lane, count, canEdit, children }: { lane: LaneDef; count: number; canEdit: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id, disabled: !canEdit })
  const hot = isOver && canEdit
  return (
    <section
      ref={setNodeRef}
      aria-label={`${lane.label} — ${count} item${count === 1 ? '' : 's'}`}
      className="rounded-[14px] p-1.5 min-h-[160px] transition-colors"
      style={{
        background: hot ? 'var(--color-accent-soft)' : 'var(--color-raised)',
        border: `1px solid ${hot ? 'var(--color-accent-line)' : 'var(--color-border)'}`,
      }}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="w-5 h-[3px] rounded-full" style={{ background: lane.tint }} aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[.05em] text-dim">{lane.label}</span>
        <span className="ml-auto text-[11px] font-semibold text-faint tabular-nums px-1.5 rounded-[7px] bg-surface"
          style={{ border: '1px solid var(--color-border)' }}>{count}</span>
      </div>
      <div className="flex flex-col gap-2 px-1.5 pb-1.5">{children}</div>
    </section>
  )
}

// ─── Drag preview (follows the cursor) ────────────────────────────────────────

function DragPreview({ fb }: { fb: FeedbackDoc }) {
  const meta = TYPE_META[fb.type]
  const Icon = meta.icon
  return (
    <div className="flex items-center gap-2 w-[280px] bg-surface rounded-[12px] px-3 py-2.5 rotate-[1.5deg] cursor-grabbing"
      style={{ border: '1px solid var(--color-accent-line)', boxShadow: 'var(--shadow-card-hover)' }}>
      <Icon size={15} style={{ color: meta.fg }} aria-hidden="true" />
      <span className="text-sm font-medium text-text truncate">{fb.title}</span>
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  fb: FeedbackDoc
  lane: LaneId | 'archived'
  canEdit: boolean
  isAdmin: boolean
  uid?: string
  maxHeat: number
  onVote: (fb: FeedbackDoc) => void
  onMove: (fb: FeedbackDoc, next: FeedbackStatus) => void
  onDelete: (fb: FeedbackDoc) => void
  onViewScreenshot: (url: string) => void
  navigate: (to: string) => void
}

function Card({ fb, lane, canEdit, isAdmin, uid, maxHeat, onVote, onMove, onDelete, onViewScreenshot, navigate }: CardProps) {
  const [open, setOpen] = useState(false)
  const draggable = canEdit && lane !== 'archived'
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: fb.id, disabled: !draggable })

  const meta   = TYPE_META[fb.type]
  const Icon   = meta.icon
  const voted  = uid ? (fb.votes?.voters ?? []).includes(uid) : false
  const ctx    = fb.context as { route?: string; label?: string; refId?: string } | undefined
  const surface = ctx?.label ?? ctx?.route
  const isDone  = lane === 'done'
  const isArchived = lane === 'archived'
  const canVote = !isDone && !isArchived

  const prev = stepStatus(fb.status, -1)
  const next = stepStatus(fb.status, 1)
  const ac    = fb.acceptanceCriteria ?? []
  const repro = fb.type === 'ISSUE' ? (fb.reproSteps ?? []) : []
  const files = fb.type === 'ISSUE' ? (fb.likelyFiles ?? []) : []
  const hasDetails = ac.length > 0 || repro.length > 0 || files.length > 0

  const [copied, setCopied] = useState(false)
  function handleCopyPrompt() {
    const prompt = buildCardPrompt(fb)
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      ref={setNodeRef}
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)', opacity: isDragging ? 0.4 : 1 }}
      className="group bg-surface rounded-[12px] p-3 flex flex-col gap-2.5"
    >
      {/* Title row: drag handle · type · title · vote */}
      <div className="flex items-start gap-2">
        {draggable && (
          // Pointer-only affordance: keyboard users move with the ← / → controls below, so
          // the handle stays out of the tab order (no dead focus stop).
          <button {...attributes} {...listeners} type="button" tabIndex={-1}
            aria-label={`Drag "${fb.title}"`}
            className="shrink-0 w-6 h-6 -ml-0.5 -mt-0.5 rounded-[6px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft cursor-grab active:cursor-grabbing transition-colors touch-none">
            <IconDrag size={14} aria-hidden="true" />
          </button>
        )}
        <span className="shrink-0 inline-flex items-center gap-1 h-5 px-1.5 rounded-[6px] text-[10.5px] font-semibold uppercase tracking-[.04em] mt-px"
          style={{ color: meta.fg, background: meta.bg }}>
          <Icon size={11} aria-hidden="true" /> {meta.label}
        </span>
        <span className="flex-1 min-w-0 text-sm font-medium text-text leading-snug">{fb.title}</span>
        {canVote && (
          <button type="button" onClick={() => onVote(fb)} disabled={voted} aria-pressed={voted}
            title={voted ? 'You voted' : 'Vote'}
            className={`shrink-0 flex flex-col items-center rounded-[9px] px-2 py-1 transition-colors cursor-pointer disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${voted ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}>
            <IconArrowUp size={15} aria-hidden="true" />
            <span className="text-[11px] font-semibold tabular-nums">{fb.votes?.count ?? 0}</span>
          </button>
        )}
      </div>

      {/* Summary */}
      {fb.detail && <p className="text-xs text-dim leading-relaxed line-clamp-2">{fb.detail}</p>}

      {/* Screenshot thumbnail */}
      {fb.screenshotUrl && (
        <button type="button" onClick={() => onViewScreenshot(fb.screenshotUrl!)} aria-label="View screenshot"
          className="group/thumb relative w-full rounded-[8px] overflow-hidden cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          style={{ border: '1px solid var(--color-border)' }}>
          <img src={fb.screenshotUrl} alt="Feedback screenshot" className="w-full h-24 object-cover object-top" />
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.35)' }}>
            <IconExpand size={18} className="text-white drop-shadow" aria-hidden="true" />
          </span>
          <span className="absolute bottom-0 inset-x-0 px-2 py-1 flex items-center gap-1 text-[10px] text-white/70" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.4))' }}>
            <IconCamera size={10} aria-hidden="true" /> Screenshot
          </span>
        </button>
      )}

      {/* Meta chips: surface + refId · status (in-progress) · priority */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {surface && (
          <button type="button" onClick={() => ctx?.route && navigate(ctx.route)} disabled={!ctx?.route} title={ctx?.route}
            className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline max-w-[12rem] truncate cursor-pointer disabled:cursor-default disabled:text-dim disabled:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
            <IconLink size={10} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{ctx?.label ?? ctx?.route}</span>
          </button>
        )}
        {ctx?.refId && (
          <span className="inline-flex items-center rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none tracking-[-.01em] bg-accent-soft text-accent">
            {ctx.refId}
          </span>
        )}
        {lane === 'progress' && (
          <span className="inline-flex items-center h-5 px-1.5 rounded-[6px] text-[10.5px] font-semibold" style={{ color: 'var(--color-warn)', background: 'var(--color-warn-soft)' }}>
            {STATUS_LABEL[fb.status]}
          </span>
        )}
        {!isDone && !isArchived && (
          <span title="WSJF priority — (impact + decayed votes) ÷ effort"
            className="inline-flex items-center gap-1 h-5 px-1.5 rounded-[6px] bg-raised text-dim text-[10.5px] font-semibold tabular-nums">
            <IconActivity size={10} aria-hidden="true" /> {priorityOf(fb)}
          </span>
        )}
      </div>

      {/* Heat bar — active lanes only */}
      {!isDone && !isArchived && (
        <div className="h-1.5 rounded-full bg-raised overflow-hidden" title="Vote heat (14-day decay)">
          <div className="h-full rounded-full" style={{ width: `${Math.max(6, (heatOf(fb) / maxHeat) * 100)}%`, background: 'linear-gradient(90deg, var(--color-accent-bright), var(--color-accent-strong))' }} />
        </div>
      )}

      {/* Completion note — Done cards */}
      {isDone && fb.completionNote && (
        <div className="flex items-start gap-1.5 bg-good/10 rounded-[8px] px-2.5 py-2">
          <IconCheckCircle size={13} className="shrink-0 text-good mt-px" aria-hidden="true" />
          <span className="text-xs text-dim leading-relaxed">{fb.completionNote}</span>
        </div>
      )}

      {/* Collapsible acceptance criteria (+ repro / files for issues) */}
      {hasDetails && (
        <div>
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-dim hover:text-accent transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
            <IconChevronDown size={12} className="transition-transform" style={{ transform: open ? 'none' : 'rotate(-90deg)' }} aria-hidden="true" />
            {ac.length > 0 ? `${ac.length} acceptance criteri${ac.length === 1 ? 'on' : 'a'}` : 'Details'}
          </button>
          {open && (
            <div className="mt-2 flex flex-col gap-2 pl-1">
              {ac.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {ac.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12px] text-dim leading-snug">
                      <IconCheck size={12} className="shrink-0 mt-0.5 text-good" aria-hidden="true" />{c}
                    </li>
                  ))}
                </ul>
              )}
              {repro.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-faint mb-1">Steps to reproduce</p>
                  <ol className="flex flex-col gap-0.5 list-decimal pl-4 text-[12px] text-dim leading-snug">
                    {repro.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              )}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {files.map((f, i) => (
                    <span key={i} className="inline-flex items-center rounded-[6px] px-1.5 py-0.5 font-mono text-[10.5px] text-dim bg-raised">{f}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer actions */}
      {canEdit && (
        <div className="flex items-center gap-1 pt-0.5">
          {isArchived ? (
            <>
              <ActionBtn label="Restore to Inbox" icon={IconRestore} tone="accent" onClick={() => onMove(fb, 'NEW')}>Restore</ActionBtn>
              <span className="flex-1" />
              <IconBtn label="Delete permanently" icon={IconTrash} tone="danger" onClick={() => onDelete(fb)} />
            </>
          ) : (
            <>
              {prev && (
                <IconBtn
                  label={fb.status === 'SHIPPED' ? 'Reopen to Planned' : `Move to ${STATUS_LABEL[prev]}`}
                  icon={IconChevronLeft} tone="dim" onClick={() => onMove(fb, prev)} />
              )}
              {next && (
                next === 'SHIPPED'
                  ? <ActionBtn label="Mark as done" icon={IconCheckCircle} tone="good" onClick={() => onMove(fb, next)}>Done</ActionBtn>
                  : <IconBtn label={`Move to ${STATUS_LABEL[next]}`} icon={IconChevronRight} tone="dim" onClick={() => onMove(fb, next)} />
              )}
              <span className="flex-1" />
              {!isDone && (
                <IconBtn label="Decline (archive)" icon={IconArchive} tone="warn" onClick={() => onMove(fb, 'DECLINED')} />
              )}
            </>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={handleCopyPrompt}
              title="Copy a Claude Code prompt scoped to this story (ADMIN only)"
              aria-label={copied ? 'Prompt copied to clipboard' : 'Copy prompt for Claude Code'}
              className={`h-7 inline-flex items-center gap-1 px-2 rounded-[7px] text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${copied ? 'text-good bg-[var(--color-good-soft)]' : 'bg-raised text-dim hover:text-accent hover:bg-accent-soft'}`}
            >
              {copied
                ? <><IconCheck size={12} aria-hidden="true" /> Copied</>
                : <><IconCopy size={12} aria-hidden="true" /> Copy prompt</>
              }
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Small action primitives (tokens only) ────────────────────────────────────

type Tone = 'dim' | 'good' | 'warn' | 'danger' | 'accent'
const TONE_HOVER: Record<Tone, string> = {
  dim:    'hover:text-text hover:bg-hover',
  good:   'hover:text-good hover:bg-[var(--color-good-soft)]',
  warn:   'hover:text-warn hover:bg-[var(--color-warn-badge)]',
  danger: 'hover:text-danger hover:bg-[var(--color-danger-hover)]',
  accent: 'hover:text-accent hover:bg-accent-soft',
}

function IconBtn({ label, icon: Icon, tone, onClick }: { label: string; icon: IconType; tone: Tone; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className={`w-7 h-7 rounded-[7px] flex items-center justify-center bg-raised text-dim transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${TONE_HOVER[tone]}`}>
      <Icon size={14} aria-hidden="true" />
    </button>
  )
}

function ActionBtn({ label, icon: Icon, tone, onClick, children }: { label: string; icon: IconType; tone: Tone; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className={`h-7 inline-flex items-center gap-1 px-2 rounded-[7px] bg-raised text-dim text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${TONE_HOVER[tone]}`}>
      <Icon size={13} aria-hidden="true" /> {children}
    </button>
  )
}
