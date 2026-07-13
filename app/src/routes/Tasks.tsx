// Tasks (/app/tasks) — the insurance GTM launch tracker. A PM creates a PROJECT with a
// launch DEADLINE, seeds the board from the generic L1–L4 insurance product process
// (dates back-scheduled from the deadline), adds one-off tasks, and completes tasks that
// drop into a Completed section below the board. A "launch runway" timeline shows the
// phases converging on the deadline. Board is scoped to the selected project.
//
// Every write (project + task creates/edits/completes + the whole seed batch) goes through
// the adapter's atomic mutate()/mutateBatch(). VIEWER (or any role-less session) sees a
// read-only board: no create/seed/complete controls, enforced here AND in firestore.rules.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../lib/backend'
import { conflictToast } from '../lib/conflict'
import { useUser } from '../context/useUser'
import { canI } from '../lib/canI'
import { Badge, Button, Skeleton, EmptyState } from '../components/ui'
import {
  IconPlus, IconChart, IconChevronDown, IconTasks, IconWarning,
} from '../components/ui/icons'
import { businessDaysBetween } from '@pf/shared'
import type { Product, TypeOfWork } from '@pf/shared'
import {
  GTM_COLUMNS, GTM_PHASES, WORK_TYPES, DISPOSITIONS, DISPOSITION_META, byDueThenOrder,
  isOverdue, startOfTodayMs, todayISO, fmtShort, toMillis, doneFields,
  type BoardDisposition, type TaskDoc, type ProjectDoc,
} from '../components/tasks/gtm/gtm'
import { LaunchRunway } from '../components/tasks/gtm/LaunchRunway'
import { TaskCard, CompletedRow } from '../components/tasks/gtm/TaskCard'
import { ProjectDialog } from '../components/tasks/gtm/ProjectDialog'
import { SeedProcessDialog } from '../components/tasks/gtm/SeedProcessDialog'
import { AdhocTaskDialog } from '../components/tasks/gtm/AdhocTaskDialog'
import { TaskDetailDrawer } from '../components/tasks/gtm/TaskDetailDrawer'

type ProductDoc = Product & { id: string }
type Dialog = 'project' | 'seed' | 'task' | null

const STORE_KEY = 'pf.gtm.project'
const STATUS_COLOR: Record<string, 'default' | 'purple' | 'good' | 'blue'> = {
  planning: 'blue', active: 'purple', launched: 'good', archived: 'default',
}
const isMine = (t: TaskDoc, uid?: string) =>
  (!!t.ownerRole && /product\s*m(gr|anager)/i.test(t.ownerRole)) || (!!uid && t.assignee?.uid === uid)

export default function Tasks() {
  const { user, profile } = useUser()
  const canEdit = canI(profile, 'product:write')
  const actor = user ? { uid: user.uid, name: user.name ?? user.email ?? 'User' } : null

  const [projects, setProjects] = useState<ProjectDoc[] | null>(null)
  const [tasks,    setTasks]    = useState<TaskDoc[] | null>(null)
  const [products, setProducts] = useState<ProductDoc[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [completedOpen, setCompletedOpen] = useState(true)
  const [params, setParams] = useSearchParams()

  // Filters
  const [mine, setMine]       = useState(false)
  const [overdue, setOverdue] = useState(false)
  const [typeFilter, setType] = useState<'' | TypeOfWork>('')
  const [phaseFilter, setPhase] = useState('')
  const [dispFilter, setDisp] = useState<'' | BoardDisposition>('')

  useEffect(() => {
    const u1 = adapter.db.subscribe<ProjectDoc>('projects', d => { if (Array.isArray(d)) setProjects(d) })
    const u2 = adapter.db.subscribe<TaskDoc>('tasks',       d => { if (Array.isArray(d)) setTasks(d) })
    const u3 = adapter.db.subscribe<ProductDoc>('products', d => { if (Array.isArray(d)) setProducts(d) })
    return () => { u1(); u2(); u3() }
  }, [])

  // Resolve the selected project: ?project= → localStorage → first. Runs when the set loads
  // or the current selection falls out of the list (e.g. after a switch).
  useEffect(() => {
    if (!projects) return
    if (currentId && projects.some(p => p.id === currentId)) return
    const fromQuery = params.get('project')
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null
    const pick = [fromQuery, stored].find(id => id && projects.some(p => p.id === id))
    setCurrentId(pick ?? projects[0]?.id ?? null)
  }, [projects, currentId, params])

  function switchProject(id: string) {
    setCurrentId(id)
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, id)
    if (params.get('project')) { params.delete('project'); setParams(params, { replace: true }) }
    setMine(false); setOverdue(false); setType(''); setPhase(''); setDisp('')
  }

  // After creating a project, select it and immediately offer to seed its board.
  function onProjectCreated(id: string) { switchProject(id); setDialog('seed') }

  const current = projects?.find(p => p.id === currentId) ?? null
  // The task whose detail slide-over is open — resolved LIVE from the subscription so the
  // panel always edits against the freshest revision (and closes if the task disappears).
  const detailTask = detailId ? (tasks ?? []).find(t => t.id === detailId) ?? null : null
  const nowMs = startOfTodayMs()
  const today = todayISO()

  const projectTasks = useMemo(
    () => (tasks ?? []).filter(t => t.projectId === currentId),
    [tasks, currentId],
  )
  const done   = useMemo(() => projectTasks.filter(t => t.done), [projectTasks])
  const active = useMemo(() => projectTasks.filter(t => !t.done), [projectTasks])
  const seeded = useMemo(() => projectTasks.filter(t => t.origin === 'seeded'), [projectTasks])

  const filteredActive = useMemo(() => active.filter(t => {
    if (mine && !isMine(t, user?.uid)) return false
    if (overdue && !isOverdue(t, today)) return false
    if (typeFilter && t.typeOfWork !== typeFilter) return false
    if (phaseFilter && t.phaseL2 !== phaseFilter) return false
    if (dispFilter && t.disposition !== dispFilter) return false
    return true
  }), [active, mine, overdue, typeFilter, phaseFilter, dispFilter, user?.uid, today])

  const byColumn = useMemo(() => {
    const map = Object.fromEntries(GTM_COLUMNS.map(c => [c.id, [] as TaskDoc[]]))
    for (const t of filteredActive) (map[t.column] ?? map.IDEATION!).push(t)
    for (const c of GTM_COLUMNS) map[c.id]!.sort(byDueThenOrder)
    return map
  }, [filteredActive])

  const completedRows = useMemo(
    () => [...done].sort((a, b) => (toMillis(b.completedAt) ?? 0) - (toMillis(a.completedAt) ?? 0)),
    [done],
  )

  // Launch metrics
  const launched = current ? current.targetLaunchDate < todayISO() : false
  const daysToLaunch = current ? businessDaysBetween(todayISO(), current.targetLaunchDate) : 0
  const overdueCount = active.filter(t => isOverdue(t, today)).length
  const neededPre = seeded.filter(t => (t.phaseOrder ?? 0) <= 4).reduce((s, t) => s + (t.slaDays ?? 0), 0)
  const availPre  = current ? businessDaysBetween(todayISO(), current.targetLaunchDate) : 0
  const compressed = neededPre > 0 && availPre < neededPre

  async function toggleDone(task: TaskDoc) {
    if (!actor) return
    const nowDone = !task.done
    if (nowDone) setCompletedOpen(true)
    // Optimistic update — flip the task immediately so the board feels instant.
    // pokeAll() after a successful mutate() will reconcile with the server value.
    setTasks(prev => prev ? prev.map(t => t.id === task.id ? { ...t, ...doneFields(nowDone) } : t) : prev)
    try {
      await adapter.db.mutate({
        op: 'update', path: `tasks/${task.id}`, data: doneFields(nowDone),
        entityType: 'task', productId: task.productId, actor, expectedRev: task.rev,
      })
    } catch (err) {
      // Roll back the optimistic flip on failure.
      setTasks(prev => prev ? prev.map(t => t.id === task.id ? { ...t, done: task.done } : t) : prev)
      if (err instanceof MutationConflictError) conflictToast({})
      else toast.error('Update failed')
    }
  }

  const activeFilters = [mine, overdue, !!typeFilter, !!phaseFilter, !!dispFilter].filter(Boolean).length

  // ── Loading ──
  if (projects === null || tasks === null) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-24" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
          {GTM_COLUMNS.map(c => <Skeleton key={c.id} className="h-64" />)}
        </div>
      </div>
    )
  }

  // ── No project ── (empty state + the reachable create dialog)
  if (!current) {
    return (
      <>
        <EmptyState
          icon={<IconTasks size={28} />}
          title="No project yet"
          description={canEdit
            ? 'Create a project, give it a launch deadline, then seed the board from the insurance product process.'
            : 'No launch projects have been created yet. Ask an editor to create one.'}
          action={canEdit ? (
            <Button variant="primary" size="sm" onClick={() => setDialog('project')}>
              <IconPlus size={14} aria-hidden="true" />Create your first project
            </Button>
          ) : undefined}
        />
        {dialog === 'project' && canEdit && actor && (
          <ProjectDialog products={products.map(p => ({ id: p.id, name: p.name }))} actor={actor}
            onClose={() => setDialog(null)} onCreated={onProjectCreated} />
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Project selector + create */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-2 h-9 px-3 rounded-[11px] bg-surface font-semibold"
          style={{ border: '1px solid var(--color-border)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)' }} aria-hidden="true" />
          <select value={currentId ?? ''} onChange={e => switchProject(e.target.value)}
            aria-label="Select project"
            className="bg-transparent font-semibold text-text text-sm max-w-[240px] truncate focus:outline-none cursor-pointer">
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </span>
        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-[6px] bg-raised text-dim" title="Project id">
          {current.refId ?? '—'}
        </span>
        {canEdit && (
          <Button variant="primary" size="sm" className="ml-auto" onClick={() => setDialog('project')}>
            <IconPlus size={14} aria-hidden="true" />New project
          </Button>
        )}
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold text-text tracking-tight">{current.name}</h1>
            <Badge label={current.status} color={STATUS_COLOR[current.status] ?? 'default'} className="capitalize" />
          </div>
          <p className="text-[13px] text-dim mt-1">
            {current.productId && products.find(p => p.id === current.productId)
              ? <>{products.find(p => p.id === current.productId)!.name} · </> : null}
            Launch {fmtShort(current.targetLaunchDate)}
            {current.description ? ` · ${current.description}` : ''}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="default" size="sm" onClick={() => setDialog('task')}>
              <IconPlus size={14} aria-hidden="true" />New task
            </Button>
            <Button variant="default" size="sm" onClick={() => setDialog('seed')}>
              <IconChart size={14} aria-hidden="true" />Seed from process
            </Button>
          </div>
        )}
      </div>

      {/* Metrics */}
      <div className="flex flex-wrap gap-7">
        <Metric value={launched ? 'Live' : String(daysToLaunch)} unit={launched ? '' : 'business days'}
          label={launched ? 'Launched' : 'To launch'} accent />
        <Metric value={String(done.length)} unit={`/ ${projectTasks.length}`} label="Tasks done" />
        <Metric value={String(overdueCount)} label="Overdue" danger={overdueCount > 0} />
        <Metric value={String(active.length)} label="Open" />
      </div>

      {/* Compression banner */}
      {compressed && (
        <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-[12px] text-[13px] font-medium text-danger"
          style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-line)' }}>
          <IconWarning size={18} className="shrink-0" aria-hidden="true" />
          <span>Compressed timeline. This process needs <b>{neededPre} business days</b> before launch,
            but only <b>{availPre}</b> remain. Tasks below start today and overlap — consider moving the deadline out.</span>
        </div>
      )}

      {/* Launch runway (only once seeded) */}
      {seeded.length > 0 && (
        <LaunchRunway seeded={seeded} deadlineMs={toMillis(current.targetLaunchDate) ?? nowMs} todayMs={nowMs} />
      )}

      {/* Body */}
      {projectTasks.length === 0 ? (
        <EmptyState
          icon={<IconChart size={28} />}
          title="Empty board"
          description={canEdit
            ? 'Seed generic tasks from the L1–L4 product process, back-scheduled from your deadline, or add a one-off task.'
            : 'This project has no tasks yet.'}
          action={canEdit ? (
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={() => setDialog('seed')}>Seed from process</Button>
              <Button variant="default" size="sm" onClick={() => setDialog('task')}>Add a one-off task</Button>
            </div>
          ) : undefined}
        />
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Task filters">
            <FilterChip active={overdue} onClick={() => setOverdue(v => !v)} danger>Overdue</FilterChip>
            <FilterChip active={mine} onClick={() => setMine(v => !v)}>Mine</FilterChip>
            <select value={typeFilter} onChange={e => setType(e.target.value as '' | TypeOfWork)}
              aria-label="Filter by work type"
              className="h-7 px-2 rounded-[8px] bg-surface border text-xs text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              style={{ borderColor: typeFilter ? 'var(--color-accent)' : 'var(--color-border)' }}>
              <option value="">All work types</option>
              {WORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={phaseFilter} onChange={e => setPhase(e.target.value)}
              aria-label="Filter by phase"
              className="h-7 px-2 rounded-[8px] bg-surface border text-xs text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              style={{ borderColor: phaseFilter ? 'var(--color-accent)' : 'var(--color-border)' }}>
              <option value="">All phases</option>
              {GTM_PHASES.map(p => <option key={p.name} value={p.name}>{p.short}</option>)}
            </select>
            {/* 4E disposition chips — toggle a single disposition; token-tinted when active. */}
            <span className="mx-0.5 w-px h-4 shrink-0" style={{ background: 'var(--color-border)' }} aria-hidden="true" />
            {DISPOSITIONS.map(d => {
              const on = dispFilter === d
              const meta = DISPOSITION_META[d]
              return (
                <button key={d} aria-pressed={on} onClick={() => setDisp(prev => prev === d ? '' : d)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-medium transition-colors"
                  style={{
                    background: on ? meta.soft : 'var(--color-surface)',
                    color: on ? meta.token : 'var(--color-dim)',
                    border: `1px solid ${on ? meta.token : 'var(--color-border)'}`,
                  }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.token }} aria-hidden="true" />
                  {d}
                </button>
              )
            })}
            {activeFilters > 0 && (
              <button onClick={() => { setMine(false); setOverdue(false); setType(''); setPhase(''); setDisp('') }}
                className="h-7 px-2.5 rounded-[8px] text-xs text-dim hover:text-danger transition-colors"
                style={{ border: '1px solid var(--color-border)' }}>
                Clear {activeFilters}
              </button>
            )}
          </div>

          {/* Board */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5 items-start">
            {GTM_COLUMNS.map(col => {
              const items = byColumn[col.id]!
              return (
                <section key={col.id} className="rounded-[14px] p-1.5 min-h-[120px]"
                  style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}
                  aria-label={col.label}>
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <span className="w-5 h-[3px] rounded-full" style={{ background: col.bar }} aria-hidden="true" />
                    <span className="text-[11px] font-semibold uppercase tracking-[.05em] text-dim">{col.label}</span>
                    <span className="ml-auto text-[11px] font-semibold text-faint tabular-nums px-1.5 rounded-[7px] bg-surface"
                      style={{ border: '1px solid var(--color-border)' }}>{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-2 px-1.5 pb-1.5">
                    {items.length > 0
                      ? items.map(t => <TaskCard key={t.id} task={t} canEdit={canEdit} todayIso={today} onToggle={toggleDone} onOpen={t => setDetailId(t.id)} />)
                      : <div className="text-xs text-faint text-center italic py-4">Nothing here</div>}
                  </div>
                </section>
              )
            })}
          </div>

          {/* Completed */}
          <div className="mt-2 pt-4" style={{ borderTop: '1px dashed var(--color-border)' }}>
            <button onClick={() => setCompletedOpen(o => !o)}
              className="flex items-center gap-2.5 w-full text-left" aria-expanded={completedOpen}>
              <IconChevronDown size={15} className="transition-transform" style={{ transform: completedOpen ? 'none' : 'rotate(-90deg)' }} aria-hidden="true" />
              <h3 className="text-[13px] font-bold text-text">Completed</h3>
              <span className="text-[11px] font-semibold text-faint px-2 rounded-[7px] bg-raised" style={{ border: '1px solid var(--color-border)' }}>
                {done.length}
              </span>
              <span className="ml-auto text-[11px] text-faint">{done.length ? 'Newest first' : 'Finished tasks land here'}</span>
            </button>
            {completedOpen && (
              <div className="flex flex-col gap-1.5 mt-3">
                {completedRows.length > 0
                  ? completedRows.map(t => <CompletedRow key={t.id} task={t} canEdit={canEdit} onToggle={toggleDone} onOpen={t => setDetailId(t.id)} />)
                  : <p className="text-[12.5px] text-faint italic px-0.5">No completed tasks yet. Check off a card above and it will move here.</p>}
              </div>
            )}
          </div>
        </>
      )}

      {/* Dialogs */}
      {dialog === 'project' && canEdit && actor && (
        <ProjectDialog products={products.map(p => ({ id: p.id, name: p.name }))} actor={actor}
          onClose={() => setDialog(null)} onCreated={onProjectCreated} />
      )}
      {dialog === 'seed' && canEdit && actor && (
        <SeedProcessDialog project={current} priorSeeded={seeded} actor={actor} onClose={() => setDialog(null)} />
      )}
      {dialog === 'task' && canEdit && actor && (
        <AdhocTaskDialog project={current} actor={actor} onClose={() => setDialog(null)} />
      )}
      {/* Task-detail slide-over — keyed by task id so switching tasks remounts with a fresh
          edit baseline. Opens for every role; VIEWER sees the identical panel read-only. */}
      {detailTask && (
        <TaskDetailDrawer key={detailTask.id} task={detailTask} project={current}
          canEdit={canEdit} actor={actor} onClose={() => setDetailId(null)} />
      )}
    </div>
  )
}

// ─── Small presentational bits ─────────────────────────────────────────────────

function Metric({ value, unit, label, accent, danger }: {
  value: string; unit?: string; label: string; accent?: boolean; danger?: boolean
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[26px] font-bold tracking-tight tabular-nums"
          style={{ color: danger ? 'var(--color-danger)' : accent ? 'var(--color-accent-strong)' : 'var(--color-text)' }}>
          {value}
        </span>
        {unit && <span className="text-xs font-semibold text-faint">{unit}</span>}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint mt-0.5">{label}</div>
    </div>
  )
}

function FilterChip({ active, onClick, danger, children }: {
  active: boolean; onClick: () => void; danger?: boolean; children: React.ReactNode
}) {
  const on = active
    ? (danger ? 'bg-[var(--color-danger-badge)] text-danger' : 'bg-accent-soft text-accent')
    : 'bg-surface text-dim hover:text-text'
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`px-2.5 py-1 rounded-[8px] text-xs font-medium transition-colors ${on}`}
      style={{ border: `1px solid ${active ? (danger ? 'var(--color-danger-line)' : 'var(--color-accent-line)') : 'var(--color-border)'}` }}>
      {children}
    </button>
  )
}
