// Tasks (/app/tasks) — kanban (board/list/project) of the product lifecycle.
// Project view groups tasks by product with a per-column breakdown.
// Filters: mine, overdue, product, assignee, column, due window.
// Drag-and-drop (board only) is audited via adapter.mutate (EDITOR+ only).
import { useEffect, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCorners,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { toast } from 'sonner'
import { IconCards, IconList, IconLayers, IconCheckSquare, IconFilter, IconPlus, IconCheck, IconEdit, IconUsers } from '../components/ui/icons'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Button, Skeleton, EmptyState } from '../components/ui'
import { TaskEditDialog } from '../components/tasks/TaskEditDialog'
import type { Task, Product, TaskColumn } from '@pf/shared'

type TaskDoc    = Task & { id: string }
type ProductDoc = Product & { id: string }
type ViewMode   = 'board' | 'list' | 'project' | 'people'
type DueWindow  = 'any' | 'today' | 'week' | 'month'

// Completed tasks sort to the bottom of any list, then by their manual order.
const byDoneThenOrder = (a: TaskDoc, b: TaskDoc) =>
  Number(!!a.done) - Number(!!b.done) || (a.order ?? 0) - (b.order ?? 0)

const COLUMNS: { id: TaskColumn; label: string }[] = [
  { id: 'IDEATION',       label: 'Ideation & Design' },
  { id: 'BUILD_FILE',     label: 'Build & File' },
  { id: 'TEST_APPROVE',   label: 'Test & Approve' },
  { id: 'LAUNCH_MONITOR', label: 'Launch & Monitor' },
]

const DUE_WINDOWS: { id: DueWindow; label: string }[] = [
  { id: 'any',   label: 'Any time' },
  { id: 'today', label: 'Due today' },
  { id: 'week',  label: 'Due this week' },
  { id: 'month', label: 'Due this month' },
]

// ─── Date helpers ────────────────────────────────────────────────────────────

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

/** Returns an { from, to } millis range for a due window, or null for 'any'. */
function dueWindowRange(w: DueWindow): { from: number; to: number } | null {
  if (w === 'any') return null
  const now = Date.now()
  if (w === 'today') return { from: now, to: now + 86_400_000 }
  if (w === 'week')  return { from: now, to: now + 7 * 86_400_000 }
  return { from: now, to: now + 30 * 86_400_000 }
}

// ─── Card ────────────────────────────────────────────────────────────────────

// Stop pointer events from starting a drag when interacting with a card control.
const stopDrag = (e: React.PointerEvent) => e.stopPropagation()

function CompleteToggle({ task, onToggle }: { task: TaskDoc; onToggle: (t: TaskDoc) => void }) {
  return (
    <button onPointerDown={stopDrag} onClick={() => onToggle(task)}
      aria-pressed={!!task.done} title={task.done ? 'Mark not done' : 'Mark done'}
      className={`mt-0.5 w-[18px] h-[18px] rounded-[6px] flex items-center justify-center shrink-0 border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${task.done ? 'text-white' : 'text-transparent hover:border-accent'}`}
      style={{ background: task.done ? 'var(--gradient-accent)' : 'transparent', borderColor: task.done ? 'transparent' : 'var(--color-border-strong)' }}>
      <IconCheck size={11} aria-hidden="true" />
    </button>
  )
}

function CardBody({ task, productName, canEdit, onToggle, onEdit }: {
  task: TaskDoc; productName?: string; canEdit?: boolean
  onToggle?: (t: TaskDoc) => void; onEdit?: (t: TaskDoc) => void
}) {
  const due  = sla(toMillis(task.dueAt))
  const done  = task.checklist?.filter(c => c.done).length ?? 0
  const total = task.checklist?.length ?? 0
  return (
    <>
      <div className="flex items-start gap-2">
        {canEdit && onToggle && <CompleteToggle task={task} onToggle={onToggle} />}
        <span className={`text-sm font-medium leading-snug flex-1 ${task.done ? 'text-faint line-through' : 'text-text'}`}>{task.title}</span>
        {task.assignee && (
          <span className="shrink-0 w-6 h-6 rounded-full text-[10px] font-semibold text-white flex items-center justify-center"
            style={{ background: 'var(--gradient-accent)' }} title={task.assignee.name}>
            {initials(task.assignee.name)}
          </span>
        )}
        {canEdit && onEdit && (
          <button onPointerDown={stopDrag} onClick={() => onEdit(task)} title="Edit task" aria-label={`Edit ${task.title}`}
            className="shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors">
            <IconEdit size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="flex items-center flex-wrap gap-1.5">
        {productName && <Badge label={productName} color="purple" />}
        {task.durationDays != null && <Badge label={`${task.durationDays}d`} />}
        {task.done ? <Badge label="Done" color="good" /> : due && <Badge label={due.label} color={due.color} />}
      </div>
      {total > 0 && !task.done && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${(done / total) * 100}%`, background: 'linear-gradient(90deg, var(--color-accent-bright), var(--color-accent-strong))' }} />
          </div>
          <span className="text-[10px] text-faint tabular-nums">{done}/{total}</span>
        </div>
      )}
    </>
  )
}

function DraggableCard({ task, productName, canEdit, onToggle, onEdit }: {
  task: TaskDoc; productName?: string; canEdit: boolean
  onToggle: (t: TaskDoc) => void; onEdit: (t: TaskDoc) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !canEdit })
  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      className={`bg-surface rounded-[12px] p-3 flex flex-col gap-2 transition-opacity ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''} ${task.done ? 'opacity-60' : ''}`}
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <CardBody task={task} productName={productName} canEdit={canEdit} onToggle={onToggle} onEdit={onEdit} />
    </div>
  )
}

// ─── Board column ────────────────────────────────────────────────────────────

function BoardColumn({ id, label, tasks, nameFor, canEdit, onToggle, onEdit }: {
  id: TaskColumn; label: string; tasks: TaskDoc[]; nameFor: (t: TaskDoc) => string | undefined; canEdit: boolean
  onToggle: (t: TaskDoc) => void; onEdit: (t: TaskDoc) => void
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
        {tasks.map(t => <DraggableCard key={t.id} task={t} productName={nameFor(t)} canEdit={canEdit} onToggle={onToggle} onEdit={onEdit} />)}
        {tasks.length === 0 && <div className="text-xs text-faint text-center py-6">Nothing here</div>}
      </div>
    </div>
  )
}

// ─── People view — monitor tasks by assignee ───────────────────────────────────

function PeopleView({ tasks, nameFor }: { tasks: TaskDoc[]; nameFor: (t: TaskDoc) => string | undefined }) {
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; tasks: TaskDoc[] }>()
    for (const t of tasks) {
      const key = t.assignee?.uid ?? '__unassigned__'
      const name = t.assignee?.name ?? 'Unassigned'
      if (!map.has(key)) map.set(key, { name, tasks: [] })
      map.get(key)!.tasks.push(t)
    }
    return [...map.values()].sort((a, b) =>
      a.name === 'Unassigned' ? 1 : b.name === 'Unassigned' ? -1 : a.name.localeCompare(b.name))
  }, [tasks])

  if (groups.length === 0) return null
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {groups.map(g => {
        const doneCount = g.tasks.filter(t => t.done).length
        const pct = Math.round((doneCount / g.tasks.length) * 100)
        return (
          <section key={g.name} className="bg-surface rounded-[14px] overflow-hidden flex flex-col" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
            <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="w-8 h-8 rounded-full text-[11px] font-semibold text-white flex items-center justify-center shrink-0" style={{ background: 'var(--gradient-accent)' }}>
                {initials(g.name)}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-text truncate">{g.name}</span>
                <span className="text-[11px] text-faint tabular-nums">{doneCount}/{g.tasks.length} done · {pct}%</span>
              </div>
            </div>
            <div className="flex flex-col">
              {[...g.tasks].sort(byDoneThenOrder).map(t => {
                const due = sla(toMillis(t.dueAt))
                return (
                  <div key={t.id} className={`flex items-center gap-2 px-4 py-2 ${t.done ? 'opacity-60' : ''}`} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <span className={`flex-1 text-[13px] truncate ${t.done ? 'text-faint line-through' : 'text-text'}`}>{t.title}</span>
                    {nameFor(t) && <Badge label={nameFor(t)!} color="purple" />}
                    {t.done ? <Badge label="Done" color="good" /> : due && <Badge label={due.label} color={due.color} />}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ─── List view ───────────────────────────────────────────────────────────────

function ListView({ byColumn, nameFor }: {
  byColumn: Record<TaskColumn, TaskDoc[]>; nameFor: (t: TaskDoc) => string | undefined
}) {
  return (
    <div className="flex flex-col gap-6">
      {COLUMNS.map(col => byColumn[col.id].length > 0 && (
        <div key={col.id} className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-dim uppercase tracking-wide">{col.label}</span>
          <div className="flex flex-col rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {byColumn[col.id].map(t => {
              const due   = sla(toMillis(t.dueAt))
              const done  = t.checklist?.filter(c => c.done).length ?? 0
              const total = t.checklist?.length ?? 0
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 bg-surface"
                  style={{ borderBottom: '1px solid var(--color-border)' }}>
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

// ─── Project view ────────────────────────────────────────────────────────────
// Tasks grouped by product, each product section showing a lifecycle breakdown.

function ProjectView({ products, tasks }: { products: ProductDoc[]; tasks: TaskDoc[] }) {
  const byProduct = useMemo(() => {
    const map = new Map<string, TaskDoc[]>()
    for (const t of tasks) {
      const key = t.productId ?? '__unassigned__'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    return map
  }, [tasks])

  const sortedKeys = useMemo(() => (
    [...byProduct.keys()].sort((a, b) => {
      if (a === '__unassigned__') return 1
      if (b === '__unassigned__') return -1
      const pa = products.find(p => p.id === a)?.name ?? a
      const pb = products.find(p => p.id === b)?.name ?? b
      return pa.localeCompare(pb)
    })
  ), [byProduct, products])

  if (sortedKeys.length === 0) return null

  return (
    <div className="flex flex-col gap-8">
      {sortedKeys.map(pid => {
        const ptasks = byProduct.get(pid) ?? []
        const pname  = pid === '__unassigned__'
          ? 'Unassigned'
          : (products.find(p => p.id === pid)?.name ?? pid)

        const launched = ptasks.filter(t => t.column === 'LAUNCH_MONITOR').length
        const pct      = ptasks.length > 0 ? Math.round((launched / ptasks.length) * 100) : 0

        return (
          <section key={pid} aria-label={pname}>
            {/* Project header */}
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-semibold text-text">{pname}</h2>
              <span className="text-xs text-faint">{ptasks.length} task{ptasks.length !== 1 ? 's' : ''}</span>
              {/* Lifecycle progress strip — segments correspond to the 4 columns */}
              <div className="flex flex-1 gap-0.5 h-1.5 max-w-[200px]" aria-label={`${pct}% at Launch & Monitor`}>
                {COLUMNS.map((col, i) => {
                  const n = ptasks.filter(t => t.column === col.id).length
                  const opacity = [0.3, 0.5, 0.75, 1][i]!
                  return (
                    <div key={col.id} className="flex-1 rounded-full overflow-hidden bg-raised"
                      title={`${col.label}: ${n}`}>
                      {n > 0 && (
                        <div className="h-full w-full rounded-full"
                          style={{ background: 'var(--color-accent)', opacity }} />
                      )}
                    </div>
                  )
                })}
              </div>
              <span className="text-[11px] text-faint tabular-nums shrink-0">{pct}% launched</span>
            </div>

            {/* Per-column task rows */}
            <div className="flex flex-col gap-3">
              {COLUMNS.map(col => {
                const colTasks = ptasks
                  .filter(t => t.column === col.id)
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                if (colTasks.length === 0) return null
                return (
                  <div key={col.id} className="pl-4" style={{ borderLeft: '2px solid var(--color-border)' }}>
                    <span className="text-[11px] font-semibold text-dim uppercase tracking-wide block mb-1.5">
                      {col.label}
                    </span>
                    <div className="flex flex-col rounded-[10px] overflow-hidden"
                      style={{ border: '1px solid var(--color-border)' }}>
                      {colTasks.map(t => {
                        const due   = sla(toMillis(t.dueAt))
                        const done  = t.checklist?.filter(c => c.done).length ?? 0
                        const total = t.checklist?.length ?? 0
                        return (
                          <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 bg-surface"
                            style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <span className="flex-1 text-sm text-text truncate">{t.title}</span>
                            {total > 0 && (
                              <span className="text-xs text-faint tabular-nums">{done}/{total}</span>
                            )}
                            {due && <Badge label={due.label} color={due.color} />}
                            {t.assignee && (
                              <span className="text-xs text-dim truncate max-w-[100px]" title={t.assignee.name}>
                                {t.assignee.name}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`px-2.5 py-1 rounded-[8px] text-xs font-medium transition-colors ${active ? 'bg-accent-soft text-accent' : 'bg-surface text-dim hover:text-text'}`}
      style={{ border: `1px solid ${active ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}>
      {children}
    </button>
  )
}

const VIEWS: { id: ViewMode; label: string; Icon: typeof IconCards }[] = [
  { id: 'board',   label: 'Board',   Icon: IconCards  },
  { id: 'list',    label: 'List',    Icon: IconList   },
  { id: 'project', label: 'Project', Icon: IconLayers },
  { id: 'people',  label: 'People',  Icon: IconUsers  },
]

function ViewSwitch({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex items-center rounded-[9px] p-0.5 bg-raised" role="tablist" aria-label="View">
      {VIEWS.map(({ id, label, Icon }) => (
        <button key={id} role="tab" aria-selected={view === id} onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-xs font-medium transition-colors ${view === id ? 'bg-surface text-text shadow-sm' : 'text-dim hover:text-text'}`}>
          <Icon size={13} />
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── Route ───────────────────────────────────────────────────────────────────

export default function Tasks() {
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'
  const actor = user ? { uid: user.uid, name: user.name ?? user.email ?? 'User' } : null

  const [tasks,    setTasks]    = useState<TaskDoc[] | null>(null)
  const [products, setProducts] = useState<ProductDoc[]>([])
  const [view,     setView]     = useState<ViewMode>('board')
  const [editor,   setEditor]   = useState<{ task: TaskDoc | null } | null>(null)

  // ── filter state ──
  const [query,       setQuery]       = useState('')
  const [mine,        setMine]        = useState(false)
  const [overdue,     setOverdue]     = useState(false)
  const [productId,   setProductId]   = useState('')
  const [assigneeUid, setAssigneeUid] = useState('')
  const [colFilter,   setColFilter]   = useState<TaskColumn | ''>('')
  const [dueWindow,   setDueWindow]   = useState<DueWindow>('any')

  // ── drag ──
  const [dragId, setDragId] = useState<string | null>(null)

  useEffect(() => {
    const u1 = adapter.db.subscribe<TaskDoc>('tasks',    d => { if (Array.isArray(d)) setTasks(d) })
    const u2 = adapter.db.subscribe<ProductDoc>('products', d => { if (Array.isArray(d)) setProducts(d) })
    return () => { u1(); u2() }
  }, [])

  const nameFor = (t: TaskDoc) => products.find(p => p.id === t.productId)?.name

  // Unique assignees present in the loaded task set.
  const assignees = useMemo(() => {
    if (!tasks) return []
    const seen = new Map<string, string>()
    for (const t of tasks) {
      if (t.assignee && !seen.has(t.assignee.uid)) seen.set(t.assignee.uid, t.assignee.name)
    }
    return [...seen.entries()].map(([uid, name]) => ({ uid, name }))
  }, [tasks])

  const filtered = useMemo(() => {
    let list = tasks ?? []
    if (query)         { const q = query.toLowerCase(); list = list.filter(t => t.title.toLowerCase().includes(q)) }
    if (mine && user)  list = list.filter(t => t.assignee?.uid === user.uid)
    if (productId)     list = list.filter(t => t.productId === productId)
    if (assigneeUid)   list = list.filter(t => t.assignee?.uid === assigneeUid)
    if (colFilter)     list = list.filter(t => t.column === colFilter)
    const win = dueWindowRange(dueWindow)
    if (win) {
      list = list.filter(t => { const m = toMillis(t.dueAt); return m != null && m >= win.from && m < win.to })
    }
    if (overdue) list = list.filter(t => { const m = toMillis(t.dueAt); return m != null && m < Date.now() })
    return list
  }, [tasks, query, mine, productId, assigneeUid, colFilter, dueWindow, overdue, user])

  const byColumn = useMemo(() => {
    const map: Record<TaskColumn, TaskDoc[]> = { IDEATION: [], BUILD_FILE: [], TEST_APPROVE: [], LAUNCH_MONITOR: [] }
    for (const t of filtered) (map[t.column] ?? map.IDEATION).push(t)
    for (const col of COLUMNS) map[col.id].sort(byDoneThenOrder)   // completed tasks fall to the bottom
    return map
  }, [filtered])

  // Toggle completion — done tasks grey out and sort to the bottom of their column.
  async function toggleDone(task: TaskDoc) {
    if (!actor) return
    try {
      await adapter.db.mutate({
        op: 'update', path: `tasks/${task.id}`, data: { done: !task.done },
        entityType: 'task', productId: task.productId, actor, expectedRev: task.rev,
      })
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Update failed')
    }
  }

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

  const activeFilterCount = [!!query, mine, overdue, !!productId, !!assigneeUid, !!colFilter, dueWindow !== 'any']
    .filter(Boolean).length

  function clearFilters() {
    setQuery(''); setMine(false); setOverdue(false); setProductId('')
    setAssigneeUid(''); setColFilter(''); setDueWindow('any')
  }

  return (
    <div className="flex flex-col gap-5 h-full min-h-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Tasks</h1>
          <p className="text-sm text-dim">Every product from ideation to launch.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewSwitch view={view} onChange={setView} />
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => setEditor({ task: null })}>
              <IconPlus size={14} aria-hidden="true" />New task
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Task filters">
        <IconFilter size={14} className="text-faint" aria-hidden="true" />

        {/* Title typeahead */}
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks by title"
            className="h-7 pl-2.5 pr-7 rounded-[8px] bg-surface border text-xs text-text placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 w-40"
            style={{ borderColor: query ? 'var(--color-accent)' : 'var(--color-border)' }}
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-faint hover:text-text transition-colors">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 1l8 8M9 1L1 9"/></svg>
            </button>
          )}
        </div>

        <FilterChip active={mine} onClick={() => setMine(m => !m)}>Mine</FilterChip>
        <FilterChip active={overdue} onClick={() => setOverdue(o => !o)}>Overdue</FilterChip>

        {/* Product */}
        <select value={productId} onChange={e => setProductId(e.target.value)}
          className="h-7 px-2 rounded-[8px] bg-surface border text-xs text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
          style={{ borderColor: productId ? 'var(--color-accent)' : 'var(--color-border)' }}
          aria-label="Filter by product">
          <option value="">All products</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Assignee — only rendered when at least one task has an assignee */}
        {assignees.length > 0 && (
          <select value={assigneeUid} onChange={e => setAssigneeUid(e.target.value)}
            className="h-7 px-2 rounded-[8px] bg-surface border text-xs text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            style={{ borderColor: assigneeUid ? 'var(--color-accent)' : 'var(--color-border)' }}
            aria-label="Filter by assignee">
            <option value="">All assignees</option>
            {assignees.map(a => <option key={a.uid} value={a.uid}>{a.name}</option>)}
          </select>
        )}

        {/* Column */}
        <select value={colFilter} onChange={e => setColFilter(e.target.value as TaskColumn | '')}
          className="h-7 px-2 rounded-[8px] bg-surface border text-xs text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
          style={{ borderColor: colFilter ? 'var(--color-accent)' : 'var(--color-border)' }}
          aria-label="Filter by column">
          <option value="">All columns</option>
          {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>

        {/* Due window */}
        <select value={dueWindow} onChange={e => setDueWindow(e.target.value as DueWindow)}
          className="h-7 px-2 rounded-[8px] bg-surface border text-xs text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
          style={{ borderColor: dueWindow !== 'any' ? 'var(--color-accent)' : 'var(--color-border)' }}
          aria-label="Filter by due date window">
          {DUE_WINDOWS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>

        {/* Clear all — only shown when at least one filter is active */}
        {activeFilterCount > 0 && (
          <button onClick={clearFilters}
            className="h-7 px-2.5 rounded-[8px] text-xs text-dim hover:text-danger transition-colors"
            style={{ border: '1px solid var(--color-border)' }}
            aria-label={`Clear ${activeFilterCount} active filter${activeFilterCount !== 1 ? 's' : ''}`}>
            Clear {activeFilterCount}
          </button>
        )}
      </div>

      {/* Body */}
      {tasks === null ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {COLUMNS.map(c => <Skeleton key={c.id} className="h-64" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<IconCheckSquare size={28} />}
          title="No tasks match"
          description="Adjust your filters, or create a product to seed its default task set."
        />
      ) : view === 'board' ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-2 flex-1 min-h-0">
            {COLUMNS.map(col => (
              <BoardColumn key={col.id} id={col.id} label={col.label}
                tasks={byColumn[col.id]} nameFor={nameFor} canEdit={canEdit}
                onToggle={toggleDone} onEdit={t => setEditor({ task: t })} />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? (
              <div className="bg-surface rounded-[12px] p-3 flex flex-col gap-2 rotate-2"
                style={{ border: '1px solid var(--color-accent)', boxShadow: 'var(--shadow-card-hover)' }}>
                <CardBody task={activeTask} productName={nameFor(activeTask)} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : view === 'list' ? (
        <ListView byColumn={byColumn} nameFor={nameFor} />
      ) : view === 'people' ? (
        <PeopleView tasks={filtered} nameFor={nameFor} />
      ) : (
        <ProjectView products={products} tasks={filtered} />
      )}

      {editor && actor && (
        <TaskEditDialog
          task={editor.task}
          products={products.map(p => ({ id: p.id, name: p.name }))}
          assignees={assignees}
          actor={actor}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
