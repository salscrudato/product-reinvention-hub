// RatingAlgorithm — the editable left side of the Pricing worksheet: the rating program
// as an ordered stack of step cards a PM can reorder by drag, edit, delete, and extend.
// Each card shows its operation, its source, and (from the live evaluation) its running
// total, flashing when it moves. Steps are joined by a connector with a slow downward
// pulse so the flow reads as a running calculation. A step backed by a rate table opens
// the 1-3D grid editor; a step's coverage linkage opens a list of the coverages it prices.
// All structural edits persist through the atomic, optimistic-locked mutate.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { Badge, Button, Dialog, RefChip } from '../ui'
import { IconPlus, IconEdit, IconTrash, IconTable, IconCoverage, IconDrag, IconPricing } from '../ui/icons'
import { deriveGridModel } from '@pf/shared'
import { linkCoverageToPricing } from '../../lib/insurance/pricingLinks'
import type { RatingProgram, RatingStep, RTTable, LDTable, TraceEntry, Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

export interface EditableStep { step: RatingStep; table: RTTable & { id: string; rev?: number } }

const OP_META: Record<RatingStep['op'], { label: string; color: 'purple' | 'good' | 'blue' | 'warn' }> = {
  MUL: { label: '×', color: 'purple' }, ADD: { label: '+', color: 'good' },
  SET: { label: 'set', color: 'blue' }, MIN_FLOOR: { label: '≥', color: 'warn' },
}

// The source of a step's factor as a compact token: a table ref (RT/LD/SPP), an input
// name, or a constant value. Rendered as a navigable chip in the card (an RT grid table
// opens the grid editor) — see SourceToken.
function sourceLabel(s: RatingStep): string {
  if (s.source.type === 'CONST') return `const ${s.source.value ?? ''}`
  if (s.source.type === 'INPUT') return s.source.ref ?? 'input'
  return s.source.ref ?? '—'
}

// The step's factor, prefixed with its operator glyph so the trace reads as arithmetic:
// "= 700", "× 1.05", "+ 24", "≥ 500". Trimmed to ≤4 decimals (no float dust).
function fmtFactor(op: RatingStep['op'], f: number): string {
  const n = Number.isInteger(f) ? String(f) : String(Number(f.toFixed(4)))
  return op === 'SET' ? `= ${n}` : op === 'MUL' ? `× ${n}` : op === 'ADD' ? `+ ${n}` : `≥ ${n}`
}

function fmtTotal(t: TraceEntry | undefined): string {
  if (!t) return '—'
  return `$${t.runningTotal.toLocaleString(undefined, { minimumFractionDigits: t.rounded ? 0 : 2, maximumFractionDigits: 2 })}`
}

// The navigable source-ref chip. A grid-editable RT table renders as a purple, clickable
// chip that opens the grid editor (the "navigable refId chip"); every other source (LD,
// INPUT, CONST, or a non-grid RT table) is a neutral, static token.
function SourceToken({ step, gridEditable, onOpen }: { step: RatingStep; gridEditable: boolean; onOpen: () => void }) {
  const label = sourceLabel(step)
  const base = 'inline-flex items-center gap-1 h-5 px-1.5 rounded-[6px] font-mono text-[11px] leading-none max-w-[220px]'
  if (gridEditable) {
    return (
      <button type="button" onClick={onOpen} title={`Open ${label} — edit this rate table`}
        className={`${base} bg-accent-soft text-accent hover:bg-accent-soft/70 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent`}>
        <IconTable size={11} aria-hidden="true" /><span className="truncate">{label}</span>
      </button>
    )
  }
  return <span className={`${base} bg-raised text-dim`} title={label}><span className="truncate">{label}</span></span>
}

// ─── One sortable step card ─────────────────────────────────────────────────────

function StepCard({ step, index, total, changed, canEdit, gridEditable, hasTable, covCount, onEdit, onDelete, onTable, onCoverages }: {
  step: RatingStep; index: number; total: TraceEntry | undefined; changed: boolean; canEdit: boolean
  gridEditable: boolean; hasTable: boolean; covCount: number
  onEdit: () => void; onDelete: () => void; onTable: () => void; onCoverages: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id, disabled: !canEdit })
  const op = OP_META[step.op]
  // Inline transform (avoids importing @dnd-kit/utilities, which isn't hoisted to the app).
  const style = { transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }
  return (
    <div ref={setNodeRef}
      style={style}
      className={`group relative bg-surface rounded-[12px] flex items-center gap-3 px-3 py-2.5 border ${changed ? 'flow-changed' : ''} ${isDragging ? 'shadow-[var(--shadow-card-hover)] z-10' : 'shadow-[var(--shadow-card)]'}`}>
      {/* Drag handle */}
      {canEdit && (
        <button {...attributes} {...listeners} aria-label={`Reorder ${step.label}`}
          className="shrink-0 w-6 h-6 -ml-1 rounded-[6px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft cursor-grab active:cursor-grabbing transition-colors">
          <IconDrag size={14} aria-hidden="true" />
        </button>
      )}
      <span className="shrink-0 w-6 h-6 rounded-full bg-accent-soft text-accent text-[11px] font-bold flex items-center justify-center tnum">{index + 1}</span>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <Badge label={op.label} color={op.color} />
          <span className="text-sm font-medium text-text truncate">{step.label}</span>
        </div>
        {/* Source ref (navigable chip) · factor · rounding — the worked step, read as arithmetic */}
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <SourceToken step={step} gridEditable={gridEditable} onOpen={onTable} />
          {total && <span className="font-mono text-[11px] text-dim tnum">{fmtFactor(step.op, total.factorOrAmount)}</span>}
          {total?.rounded && step.roundTo !== undefined && (
            <span className="inline-flex items-center h-5 px-1.5 rounded-[6px] bg-raised text-faint font-mono text-[10px] leading-none"
              title={`Running total rounded to ${step.roundTo} decimal place${step.roundTo === 1 ? '' : 's'}`}>
              round {step.roundTo}
            </span>
          )}
        </div>
      </div>

      {/* Live running total */}
      <span className="shrink-0 text-[13px] font-mono font-semibold text-text tnum">{fmtTotal(total)}</span>

      {/* Per-step actions */}
      <div className="shrink-0 flex items-center gap-0.5">
        {hasTable && (
          <button onClick={onTable} title="Open in table mode — view its dimensions as an editable grid" aria-label={`Open ${step.label} in table mode`}
            className="inline-flex items-center justify-center w-6 h-6 rounded-[6px] text-dim hover:text-accent hover:bg-accent-soft transition-colors">
            <IconTable size={14} aria-hidden="true" />
          </button>
        )}
        {covCount > 0 && (
          <button onClick={onCoverages} title={`${covCount} coverage${covCount === 1 ? '' : 's'} priced by this step`}
            className="inline-flex items-center gap-1 h-6 px-1.5 rounded-[6px] text-[11px] text-dim hover:text-accent hover:bg-accent-soft transition-colors">
            <IconCoverage size={12} aria-hidden="true" />{covCount}
          </button>
        )}
        {canEdit && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <button onClick={onEdit} title="Edit step" aria-label={`Edit ${step.label}`}
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors">
              <IconEdit size={14} aria-hidden="true" />
            </button>
            <button onClick={onDelete} title="Delete step" aria-label={`Delete ${step.label}`}
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-faint hover:text-danger hover:bg-[var(--color-danger-hover)] transition-colors">
              <IconTrash size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Panel ──────────────────────────────────────────────────────────────────────

export function RatingAlgorithm({ program, pid, trace, changedStepIds, rtTables, ldTables, coverages, canEdit, actor, onAdd, onEdit, onEditTable }: {
  program:        WithId<RatingProgram>
  pid:            string
  trace:          TraceEntry[]
  changedStepIds: Set<string>
  rtTables:       Record<string, RTTable>
  ldTables:       Record<string, LDTable>
  coverages:      WithId<Coverage>[]
  canEdit:        boolean
  actor:          { uid: string; name: string }
  onAdd:          () => void
  onEdit:         (s: RatingStep) => void
  onEditTable:    (e: EditableStep) => void
}) {
  const navigate = useNavigate()
  const [covModal, setCovModal] = useState<{ step: RatingStep; covs: WithId<Coverage>[] } | null>(null)
  const [filterGroup, setFilterGroup] = useState<string>('')
  const [filterText,  setFilterText]  = useState<string>('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const steps = useMemo(() => [...program.steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [program.steps])
  const traceById = useMemo(() => new Map(trace.map(t => [t.stepId, t])), [trace])

  // Unique group names (coverage-name groups set by the CORE importer via D5 concept-linker).
  const groups = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const s of steps) { if (s.groupName && !seen.has(s.groupName)) { seen.add(s.groupName); out.push(s.groupName) } }
    return out
  }, [steps])

  const filteredSteps = useMemo(() => {
    let s = steps
    if (filterGroup) s = s.filter(x => x.groupName === filterGroup)
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase()
      s = s.filter(x => x.label.toLowerCase().includes(q) || (x.groupName ?? '').toLowerCase().includes(q))
    }
    return s
  }, [steps, filterGroup, filterText])

  // Reverse coverage linkage: for each step, the coverages it helps price.
  const covsByStep = useMemo(() => {
    const m = new Map<string, WithId<Coverage>[]>()
    for (const cov of coverages) {
      if (!cov.premiumGenerating) continue
      for (const s of linkCoverageToPricing(cov, program, rtTables, ldTables).steps) {
        const arr = m.get(s.id) ?? []; arr.push(cov); m.set(s.id, arr)
      }
    }
    return m
  }, [coverages, program, rtTables, ldTables])

  const gridEditable = (s: RatingStep): EditableStep | null => {
    const ref = s.source.ref
    const table = ref ? (rtTables[ref] as (RTTable & { id: string; rev?: number }) | undefined) : undefined
    return table && deriveGridModel(table) ? { step: s, table } : null
  }

  // Any step whose source resolves to a loaded RT table can be opened in table mode —
  // the Excel-like grid editor (add up to 3 dimensions as rows/columns/pages) when the
  // layout is grid-shaped, or a read-only summary otherwise. Broader than gridEditable,
  // which gates only the fully-editable grid; this drives the step card's table icon.
  const tableFor = (s: RatingStep): EditableStep | null => {
    if (s.source.type !== 'RT' && s.source.type !== 'SPP') return null
    const ref = s.source.ref
    const table = ref ? (rtTables[ref] as (RTTable & { id: string; rev?: number }) | undefined) : undefined
    return table ? { step: s, table } : null
  }

  async function persist(nextSteps: RatingStep[]) {
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/ratingPrograms/${program.id}`,
        data: { steps: nextSteps }, entityType: 'ratingProgram', productId: pid, actor, expectedRev: program.rev,
      })
    } catch (err) {
      if (err instanceof MutationConflictError) conflictToast({})
      else toast.error('Could not save the change')
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = steps.findIndex(s => s.id === active.id)
    const to   = steps.findIndex(s => s.id === over.id)
    if (from < 0 || to < 0) return
    const reordered = arrayMove(steps, from, to).map((s, i) => ({ ...s, order: i + 1 }))
    void persist(reordered)
  }

  function deleteStep(s: RatingStep) {
    void persist(steps.filter(x => x.id !== s.id).map((x, i) => ({ ...x, order: i + 1 })))
    toast.success('Step removed')
  }

  return (
    <div className="bg-surface rounded-[14px] p-5 flex flex-col gap-4" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-[9px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}>
            <IconPricing size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text truncate">Rating algorithm</h2>
            <p className="text-[11px] text-faint">
              {filteredSteps.length !== steps.length
                ? `${filteredSteps.length} of ${steps.length} step${steps.length === 1 ? '' : 's'}`
                : `${steps.length} step${steps.length === 1 ? '' : 's'}`}
              {canEdit && !filterGroup && !filterText ? ' · drag to reorder' : ''}
            </p>
          </div>
        </div>
        {canEdit && <Button variant="primary" size="sm" onClick={onAdd}><IconPlus size={14} aria-hidden="true" />Add step</Button>}
      </div>

      {/* Filter bar — shown when steps have coverage groups (e.g. CORE import) or the list is long */}
      {(groups.length > 1 || steps.length > 20) && (
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="search" value={filterText} onChange={e => setFilterText(e.target.value)}
            placeholder="Search steps…"
            className="h-7 px-2.5 rounded-[8px] text-xs bg-raised text-text placeholder:text-faint focus:outline-2 focus:outline-accent"
            style={{ border: '1px solid var(--color-border)', minWidth: '140px' }}
            aria-label="Search rating steps"
          />
          {groups.length > 1 && (
            <select
              value={filterGroup}
              onChange={e => setFilterGroup(e.target.value)}
              className="h-7 px-2 rounded-[8px] text-xs bg-raised text-text focus:outline-2 focus:outline-accent"
              style={{ border: '1px solid var(--color-border)' }}
              aria-label="Filter by product group"
            >
              <option value="">All groups ({steps.length})</option>
              {groups.map(g => {
                const count = steps.filter(s => s.groupName === g).length
                return <option key={g} value={g}>{g} ({count})</option>
              })}
            </select>
          )}
          {(filterGroup || filterText) && (
            <button
              onClick={() => { setFilterGroup(''); setFilterText('') }}
              className="h-7 px-2 rounded-[8px] text-xs text-dim hover:text-text bg-raised transition-colors"
              style={{ border: '1px solid var(--color-border)' }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={filteredSteps.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col">
            {filteredSteps.length === 0 && (filterGroup || filterText) ? (
              <p className="text-sm text-faint text-center py-6">No steps match this filter.</p>
            ) : filteredSteps.map((s, i) => {
              const editable = tableFor(s)
              return (
              <div key={s.id}>
                <StepCard
                  step={s} index={i} total={traceById.get(s.id)} changed={changedStepIds.has(s.id)}
                  canEdit={canEdit && !filterGroup && !filterText} gridEditable={!!gridEditable(s)} hasTable={!!editable} covCount={covsByStep.get(s.id)?.length ?? 0}
                  onEdit={() => onEdit(s)} onDelete={() => deleteStep(s)}
                  onTable={() => { if (editable) onEditTable(editable) }}
                  onCoverages={() => setCovModal({ step: s, covs: covsByStep.get(s.id) ?? [] })}
                />
                {/* Connector with a slow downward pulse between steps */}
                {i < filteredSteps.length - 1 && (
                  <div className="relative h-5 flex justify-center" aria-hidden="true">
                    <span className="w-px h-full" style={{ background: 'var(--color-border-strong)' }} />
                    <span className="algo-pulse absolute top-0 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)' }} />
                  </div>
                )}
              </div>
              )
            })}
            {steps.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm text-faint">No rating steps yet.</p>
                {canEdit && (
                  <Button variant="primary" size="sm" onClick={onAdd}>
                    <IconPlus size={14} aria-hidden="true" />Add first step
                  </Button>
                )}
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {/* Coverage-linkage list for a step */}
      {covModal && (
        <Dialog open onClose={() => setCovModal(null)} title={`Coverages priced by “${covModal.step.label}”`}>
          {covModal.covs.length === 0 ? (
            <p className="text-sm text-faint">No coverages reference this step.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {covModal.covs.map(c => (
                <button key={c.id}
                  onClick={() => { navigate(`/app/products/${pid}/coverages?cov=${encodeURIComponent(c.refId ?? c.id)}`); setCovModal(null) }}
                  className="flex items-center gap-2 px-3 py-2 rounded-[9px] bg-raised hover:bg-accent-soft text-left transition-colors">
                  <IconCoverage size={14} className="text-accent shrink-0" aria-hidden="true" />
                  <span className="text-sm text-text flex-1 truncate">{c.name}</span>
                  {c.formNumbers?.[0] && <RefChip id={c.formNumbers[0]} tone="accent" />}
                </button>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </div>
  )
}
