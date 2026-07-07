// RatingStepDialog — create or edit one step of the rating algorithm. Mirrors the
// legacy Add-Rating-Step inputs (name, value source, rounding, upstream data code) with
// a cleaner, guided UI: the fields shown adapt to the chosen source (a constant asks for
// a value; a rate/limit table asks for the table + lookup keys; a user input asks for the
// field). Writes the whole step array back through the atomic, optimistic-locked mutate.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Dialog, Input, Button } from '../ui'
import type { RatingProgram, RatingStep, RTTable, LDTable } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

type SourceType = RatingStep['source']['type']

const OPS: { id: RatingStep['op']; label: string; hint: string }[] = [
  { id: 'SET',       label: 'Set',        hint: 'Start / replace the running total' },
  { id: 'MUL',       label: 'Multiply ×', hint: 'Apply a factor' },
  { id: 'ADD',       label: 'Add +',      hint: 'Add a flat amount' },
  { id: 'MIN_FLOOR', label: 'Min floor',  hint: 'Raise to a minimum' },
]

const SOURCES: { id: SourceType; label: string }[] = [
  { id: 'INPUT', label: 'User input — a rating field' },
  { id: 'CONST', label: 'Constant — a fixed number' },
  { id: 'RT',    label: 'Rate table (RT) lookup' },
  { id: 'LD',    label: 'Limit/deductible table (LD)' },
]

interface Props {
  program:  WithId<RatingProgram>
  pid:      string
  step:     RatingStep | null                 // null → create
  rtTables: Record<string, RTTable>
  ldTables: Record<string, LDTable>
  inputs:   { key: string; label: string }[]  // candidate INPUT fields / RT lookup keys
  actor:    { uid: string; name: string }
  onClose:  () => void
}

export function RatingStepDialog({ program, pid, step, rtTables, ldTables, inputs, actor, onClose }: Props) {
  const editing = !!step
  const [label, setLabel]   = useState(step?.label ?? '')
  const [op, setOp]         = useState<RatingStep['op']>(step?.op ?? 'MUL')
  const [srcType, setType]  = useState<SourceType>(step?.source.type ?? 'INPUT')
  const [ref, setRef]       = useState(step?.source.ref ?? '')
  const [value, setValue]   = useState<string>(step?.source.value != null ? String(step.source.value) : '')
  const [keys, setKeys]     = useState<string[]>(step?.source.keys ?? [])
  const [roundTo, setRound] = useState<string>(step?.roundTo != null ? String(step.roundTo) : '')
  const [condition, setCond]= useState(step?.condition ?? '')
  const [busy, setBusy]     = useState(false)

  const selectCls = 'h-9 w-full px-2.5 rounded-[8px] bg-surface border text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25'
  const tableRefs = srcType === 'RT' ? Object.keys(rtTables) : srcType === 'LD' ? Object.keys(ldTables) : []

  function toggleKey(k: string) {
    setKeys(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])
  }

  async function save() {
    const name = label.trim()
    if (!name) { toast.error('Name the step.'); return }
    const source: RatingStep['source'] =
      srcType === 'CONST' ? { type: 'CONST', value: Number(value) || 0 }
      : srcType === 'INPUT' ? { type: 'INPUT', ref: ref.trim() }
      : { type: srcType, ref: ref.trim(), ...(keys.length ? { keys } : {}) }

    const next: RatingStep = {
      id:    step?.id ?? `rs-${Date.now()}`,
      order: step?.order ?? (Math.max(0, ...program.steps.map(s => s.order ?? 0)) + 1),
      label: name, op, source,
      ...(roundTo.trim() ? { roundTo: Number(roundTo) } : {}),
      ...(condition.trim() ? { condition: condition.trim() } : {}),
    }
    const steps = editing
      ? program.steps.map(s => (s.id === next.id ? next : s))
      : [...program.steps, next]

    setBusy(true)
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/ratingPrograms/${program.id}`,
        data: { steps }, entityType: 'ratingProgram', productId: pid, actor, expectedRev: program.rev,
      })
      toast.success(editing ? 'Step updated' : 'Step added')
      onClose()
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Save failed')
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={editing ? 'Edit rating step' : 'Add rating step'}>
      <div className="flex flex-col gap-3.5">
        <Input label="Step name" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Territory base rate" autoFocus />

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-dim">Operation</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }} value={op} onChange={e => setOp(e.target.value as RatingStep['op'])}>
              {OPS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <span className="text-[11px] text-faint">{OPS.find(o => o.id === op)?.hint}</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-dim">Value source</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }} value={srcType} onChange={e => { setType(e.target.value as SourceType); setRef(''); setKeys([]) }}>
              {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>

        {/* Source-specific fields */}
        {srcType === 'CONST' && (
          <Input label="Constant value" type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 1.05" />
        )}
        {srcType === 'INPUT' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-dim">Rating field (upstream data code)</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }} value={ref} onChange={e => setRef(e.target.value)}>
              <option value="">Select a field…</option>
              {inputs.map(i => <option key={i.key} value={i.key}>{i.label} ({i.key})</option>)}
            </select>
          </label>
        )}
        {(srcType === 'RT' || srcType === 'LD') && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-dim">{srcType} table (upstream data code)</span>
              <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }} value={ref} onChange={e => setRef(e.target.value)}>
                <option value="">Select a table…</option>
                {tableRefs.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {srcType === 'RT' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-dim">Lookup keys (table dimensions)</span>
                <div className="flex flex-wrap gap-1.5">
                  {inputs.map(i => (
                    <button key={i.key} type="button" onClick={() => toggleKey(i.key)}
                      className={`px-2 py-1 rounded-[7px] text-[12px] border transition-colors ${keys.includes(i.key) ? 'bg-accent-soft text-accent border-accent-line' : 'bg-surface text-dim border-border-strong hover:text-text'}`}>
                      {i.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-dim">Rounding</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }} value={roundTo} onChange={e => setRound(e.target.value)}>
              <option value="">None</option>
              <option value="0">Whole dollar (0 dp)</option>
              <option value="2">Cents (2 dp)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-dim">Only when (optional)</span>
            <select className={selectCls} style={{ borderColor: 'var(--color-border-strong)' }} value={condition} onChange={e => setCond(e.target.value)}>
              <option value="">Always runs</option>
              {inputs.filter(i => i.key.endsWith('Elected')).map(i => <option key={i.key} value={i.key}>{i.label} is on</option>)}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>{editing ? 'Save step' : 'Add step'}</Button>
        </div>
      </div>
    </Dialog>
  )
}
