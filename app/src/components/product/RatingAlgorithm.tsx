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

function sourceSummary(s: RatingStep): string {
  if (s.source.type === 'CONST') return `constant ${s.source.value ?? ''}`
  if (s.source.type === 'INPUT') return `input · ${s.source.ref ?? '—'}`
  return `${s.source.type} · ${s.source.ref ?? '—'}${s.source.keys?.length ? ` [${s.source.keys.join(', ')}]` : ''}`
}

function fmtTotal(t: TraceEntry | undefined): string {
  if (!t) return '—'
  return `$${t.runningTotal.toLocaleString(undefined, { minimumFractionDigits: t.rounded ? 0 : 2, maximumFractionDigits: 2 })}`
}

// ─── One sortable step card ─────────────────────────────────────────────────────

function StepCard({ step, index, total, changed, canEdit, gridEditable, covCount, onEdit, onDelete, onTable, onCoverages }: {
  step: RatingStep; index: number; total: TraceEntry | undefined; changed: boolean; canEdit: boolean
  gridEditable: boolean; covCount: number
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
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <Badge label={op.label} color={op.color} />
          <span className="text-sm font-medium text-text truncate">{step.label}</span>
        </div>
        <span className="text-[11px] text-faint font-mono truncate">{sourceSummary(step)}</span>
      </div>

      {/* Live running total */}
      <span className="shrink-0 text-[13px] font-mono font-semibold text-text tnum">{fmtTotal(total)}</span>

      {/* Per-step actions */}
      <div className="shrink-0 flex items-center gap-0.5">
        {covCount > 0 && (
          <button onClick={onCoverages} title={`${covCount} coverage${covCount === 1 ? '' : 's'} priced by this step`}
            className="inline-flex items-center gap-1 h-6 px-1.5 rounded-[6px] text-[11px] text-dim hover:text-accent hover:bg-accent-soft transition-colors">
            <IconCoverage size={12} aria-hidden="true" />{covCount}
          </button>
        )}
        {gridEditable && (
          <button onClick={onTable} title="Edit rate table (grid)" aria-label={`Edit ${step.label} table`}
            className="w-7 h-7 rounded-[6px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors">
            <IconTable size={14} aria-hidden="true" />
          </button>
        )}
        {canEdit && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <button onClick={onEdit} title="Edit step" aria-label={`Edit ${step.label}`}
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors">
              <IconEdit size={14} aria-hidden="true" />
            </button>
            <button onClick={onDelete} title="Delete step" aria-label={`Delete ${step.label}`}
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-faint hover:text-danger hover:bg-[rgba(220,38,38,.08)] transition-colors">
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const steps = useMemo(() => [...program.steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [program.steps])
  const traceById = useMemo(() => new Map(trace.map(t => [t.stepId, t])), [trace])

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

  async function persist(nextSteps: RatingStep[]) {
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/ratingPrograms/${program.id}`,
        data: { steps: nextSteps }, entityType: 'ratingProgram', productId: pid, actor, expectedRev: program.rev,
      })
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Could not save the change')
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
            <p className="text-[11px] text-faint">{steps.length} step{steps.length === 1 ? '' : 's'}{canEdit ? ' · drag to reorder' : ''}</p>
          </div>
        </div>
        {canEdit && <Button variant="primary" size="sm" onClick={onAdd}><IconPlus size={14} aria-hidden="true" />Add step</Button>}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col">
            {steps.map((s, i) => (
              <div key={s.id}>
                <StepCard
                  step={s} index={i} total={traceById.get(s.id)} changed={changedStepIds.has(s.id)}
                  canEdit={canEdit} gridEditable={!!gridEditable(s)} covCount={covsByStep.get(s.id)?.length ?? 0}
                  onEdit={() => onEdit(s)} onDelete={() => deleteStep(s)}
                  onTable={() => { const e = gridEditable(s); if (e) onEditTable(e) }}
                  onCoverages={() => setCovModal({ step: s, covs: covsByStep.get(s.id) ?? [] })}
                />
                {/* Connector with a slow downward pulse between steps */}
                {i < steps.length - 1 && (
                  <div className="relative h-5 flex justify-center" aria-hidden="true">
                    <span className="w-px h-full" style={{ background: 'var(--color-border-strong)' }} />
                    <span className="algo-pulse absolute top-0 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)' }} />
                  </div>
                )}
              </div>
            ))}
            {steps.length === 0 && (
              <p className="text-sm text-faint text-center py-8">No rating steps yet.{canEdit ? ' Add the first step to build the algorithm.' : ''}</p>
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
