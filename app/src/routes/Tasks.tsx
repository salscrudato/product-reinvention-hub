// Tasks (/app/tasks) — a 4-column Kanban of the product lifecycle. Drag between
// columns is audited via adapter.mutate (EDITOR+ only). Cards show product,
// assignee, an SLA badge coloured by urgency, and checklist progress. Filters
// (mine / product / overdue) and a board/list toggle. Realtime throughout.
import { useEffect, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCorners,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { toast } from 'sonner'
import { IconCards, IconList, IconCheckSquare, IconFilter } from '../components/ui/icons'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Skeleton, EmptyState } from '../components/ui'
import type { Task, Product, TaskColumn } from '@pf/shared'

type TaskDoc = Task & { id: string }
type ProductDoc = Product & { id: string }

const COLUMNS: { id: TaskColumn; label: string }[] = [
  { id: 'IDEATION',       label: 'Ideation & Design' },
  { id: 'BUILD_FILE',     label: 'Build & File' },
  { id: 'TEST_APPROVE',   label: 'Test & Approve' },
  { id: 'LAUNCH_MONITOR', label: 'Launch & Monitor' },
]

// ─── date helpers ───────────────────────────────────────────────────────────

function toMillis(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t }
  const o = v as { toDate?: () => Date; seconds?: number }
  if (typeof o.toDate === 'function') return o.toDate().getTime()
  if (typeof o.seconds === 'number') return o.seconds * 1000
  return null
}

function sla(ms: number | null): { label: string; color: 'danger' | 'warn' | 'default' } | null {
  if (ms == null) return null
  const days = Math.round((ms - Date.now()) / 86_400_000)
  if (days < 0)  return { label: `${-days}d overdue`, color: 'danger' }
  if (days === 0) return { label: 'due today', color: 'warn' }
  if (days <= 3)  return { label: `due in ${days}d`, color: 'warn' }
  const d = new Date(ms)
  return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), color: 'default' }
}

function initials(name?: string): string {
  if (!name) return '·'
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

// ─── Card ───────────────────────────────────────────────────────────────────

function CardBody({ task, productName }: { task: TaskDoc; productName?: string }) {
  const due  = sla(toMillis(task.dueAt))
  const done = task.checklist?.filter(c => c.done).length ?? 0
  const total = task.checklist?.length ?? 0
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-text leading-snug">{task.title}</span>
        {task.assignee && (
          <span className="shrink-0 w-6 h-6 rounded-full text-[10px] font-semibold text-white flex items-center justify-center"
            style={{ background: 'var(--gradient-accent)' }} title={task.assignee.name}>
            {initials(task.assignee.name)}
          </span>
        )}
      </div>
      <div className="flex items-center flex-wrap gap-1.5">
        {productName && <Badge label={productName} color="purple" />}
        {due && <Badge label={due.label} color={due.color} />}
      </div>
      {total > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(done / total) * 100}%`, background: 'linear-gradient(90deg, var(--color-accent-bright), var(--color-accent-strong))' }} />
          </div>
          <span className="text-[10px] text-faint tabular-nums">{done}/{total}</span>
        </div>
      )}
    </>
  )
}

function DraggableCard({ task, productName, canEdit }: { task: TaskDoc; productName?: string; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !canEdit })
  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      className={`bg-surface rounded-[12px] p-3 flex flex-col gap-2 ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''}`}
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <CardBody task={task} productName={productName} />
    </div>
  )
}

// ─── Column ─────────────────────────────────────────────────────────────────

function Column({ id, label, tasks, nameFor, canEdit }: {
  id: TaskColumn; label: string; tasks: TaskDoc[]; nameFor: (t: TaskDoc) => string | undefined; canEdit: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div className="flex flex-col min-w-[260px] flex-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs font-semibold text-dim uppercase tracking-wide">{label}</span>
        <span className="text-[11px] text-faint tabular-nums">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 rounded-[14px] p-2 min-h-[120px] flex-1 transition-colors ${isOver ? 'bg-accent-soft' : 'bg-raised/50'}`}
        style={{ border: isOver ? '1px dashed var(--color-accent)' : '1px solid transparent' }}
      >
        {tasks.map(t => <DraggableCard key={t.id} task={t} productName={nameFor(t)} canEdit={canEdit} />)}
        {tasks.length === 0 && <div className="text-xs text-faint text-center py-6">Nothing here</div>}
      </div>
    </div>
  )
}

// ─── Route ──────────────────────────────────────────────────────────────────

export default function Tasks() {
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'

  const [tasks, setTasks]       = useState<TaskDoc[] | null>(null)
  const [products, setProducts] = useState<ProductDoc[]>([])
  const [view, setView]         = useState<'board' | 'list'>('board')
  const [mine, setMine]         = useState(false)
  const [overdue, setOverdue]   = useState(false)
  const [productId, setProductId] = useState('')
  const [dragId, setDragId]     = useState<string | null>(null)

  useEffect(() => {
    const u1 = adapter.db.subscribe<TaskDoc>('tasks',    d => { if (Array.isArray(d)) setTasks(d) })
    const u2 = adapter.db.subscribe<ProductDoc>('products', d => { if (Array.isArray(d)) setProducts(d) })
    return () => { u1(); u2() }
  }, [])

  const nameFor = (t: TaskDoc) => products.find(p => p.id === t.productId)?.name

  const filtered = useMemo(() => {
    let list = tasks ?? []
    if (mine && user)   list = list.filter(t => t.assignee?.uid === user.uid)
    if (productId)      list = list.filter(t => t.productId === productId)
    if (overdue)        list = list.filter(t => { const m = toMillis(t.dueAt); return m != null && m < Date.now() })
    return list
  }, [tasks, mine, productId, overdue, user])

  const byColumn = useMemo(() => {
    const map: Record<TaskColumn, TaskDoc[]> = { IDEATION: [], BUILD_FILE: [], TEST_APPROVE: [], LAUNCH_MONITOR: [] }
    for (const t of filtered) (map[t.column] ?? map.IDEATION).push(t)
    for (const col of COLUMNS) map[col.id].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    return map
  }, [filtered])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  function onDragStart(e: DragStartEvent) { setDragId(String(e.active.id)) }

  async function onDragEnd(e: DragEndEvent) {
    setDragId(null)
    const overId = e.over?.id as TaskColumn | undefined
    if (!overId || !tasks || !user) return
    const task = tasks.find(t => t.id === e.active.id)
    if (!task || task.column === overId) return

    const maxOrder = Math.max(0, ...(byColumn[overId]?.map(t => t.order ?? 0) ?? []))
    const { id, ...rest } = task
    try {
      await adapter.db.mutate({
        op: 'update', path: `tasks/${id}`,
        data: { ...rest, column: overId, order: maxOrder + 1 },
        entityType: 'task', productId: task.productId,
        actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        expectedRev: task.rev,
      })
      toast.success(`Moved to ${COLUMNS.find(c => c.id === overId)?.label}`)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Move failed')
    }
  }

  const activeTask = dragId ? tasks?.find(t => t.id === dragId) : null

  return (
    <div className="flex flex-col gap-5 h-full min-h-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Tasks</h1>
          <p className="text-sm text-dim">Every product from ideation to launch.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-[9px] p-0.5 bg-raised" role="tablist" aria-label="View">
            <button onClick={() => setView('board')} aria-pressed={view === 'board'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-xs font-medium transition-colors ${view === 'board' ? 'bg-surface text-text shadow-sm' : 'text-dim'}`}>
              <IconCards size={13} /> Board
            </button>
            <button onClick={() => setView('list')} aria-pressed={view === 'list'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-xs font-medium transition-colors ${view === 'list' ? 'bg-surface text-text shadow-sm' : 'text-dim'}`}>
              <IconList size={13} /> List
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <IconFilter size={14} className="text-faint" aria-hidden="true" />
        <FilterChip active={mine} onClick={() => setMine(m => !m)}>Mine</FilterChip>
        <FilterChip active={overdue} onClick={() => setOverdue(o => !o)}>Overdue</FilterChip>
        <select
          value={productId} onChange={e => setProductId(e.target.value)}
          className="h-7 px-2 rounded-[8px] bg-surface border text-xs text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
          style={{ borderColor: 'var(--color-border)' }} aria-label="Filter by product"
        >
          <option value="">All products</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Body */}
      {tasks === null ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {COLUMNS.map(c => <Skeleton key={c.id} className="h-64" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<IconCheckSquare size={28} />} title="No tasks match" description="Adjust your filters, or create a product to seed its default task set." />
      ) : view === 'board' ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-2 flex-1 min-h-0">
            {COLUMNS.map(col => (
              <Column key={col.id} id={col.id} label={col.label} tasks={byColumn[col.id]} nameFor={nameFor} canEdit={canEdit} />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? (
              <div className="bg-surface rounded-[12px] p-3 flex flex-col gap-2 rotate-2" style={{ border: '1px solid var(--color-accent)', boxShadow: 'var(--shadow-card-hover)' }}>
                <CardBody task={activeTask} productName={nameFor(activeTask)} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <ListView columns={COLUMNS} byColumn={byColumn} nameFor={nameFor} />
      )}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`px-2.5 py-1 rounded-[8px] text-xs font-medium transition-colors ${active ? 'bg-accent-soft text-accent' : 'bg-surface text-dim hover:text-text'}`}
      style={{ border: '1px solid var(--color-border)' }}>
      {children}
    </button>
  )
}

function ListView({ columns, byColumn, nameFor }: {
  columns: typeof COLUMNS; byColumn: Record<TaskColumn, TaskDoc[]>; nameFor: (t: TaskDoc) => string | undefined
}) {
  return (
    <div className="flex flex-col gap-6">
      {columns.map(col => byColumn[col.id].length > 0 && (
        <div key={col.id} className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-dim uppercase tracking-wide">{col.label}</span>
          <div className="flex flex-col rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {byColumn[col.id].map(t => {
              const due = sla(toMillis(t.dueAt)); const done = t.checklist?.filter(c => c.done).length ?? 0; const total = t.checklist?.length ?? 0
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <span className="flex-1 text-sm text-text truncate">{t.title}</span>
                  {nameFor(t) && <Badge label={nameFor(t)!} color="purple" />}
                  {total > 0 && <span className="text-xs text-faint tabular-nums">{done}/{total}</span>}
                  {due && <Badge label={due.label} color={due.color} />}
                  {t.assignee && <span className="text-xs text-dim">{t.assignee.name}</span>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
