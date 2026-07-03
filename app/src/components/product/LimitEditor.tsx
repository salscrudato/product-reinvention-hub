// LimitEditor — a P&C-friendly editor for a coverage term's limit/deductible:
// a visual range track showing where the selected default sits, the standard
// options as selectable chips (add your own, remove custom ones), and editable
// min/max bounds. Emits partial term patches; the parent persists via mutate().
import { useState, useId } from 'react'
import { Plus, X, Check } from 'lucide-react'
import type { CoverageTerm, LDTable } from '@pf/shared'
import { LIMIT_AMOUNTS, PERCENT_OPTIONS } from '../../lib/insurance/vocab'

function fmt(n: number, pct: boolean): string {
  if (pct) return `${n}%`
  if (n >= 1000) return `$${n.toLocaleString()}`
  return `$${n}`
}
const compact = (n: number, pct: boolean) => pct ? `${n}%` : n >= 1000 ? `$${(n / 1000).toLocaleString()}k` : `$${n}`

interface Props {
  term: CoverageTerm
  ldTable?: LDTable
  isBlocked?: (value: number) => string | undefined  // returns a reason if this value is blocked
  canEdit: boolean
  onChange: (patch: Partial<CoverageTerm>) => void
}

export function LimitEditor({ term, ldTable, isBlocked, canEdit, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft]   = useState('')
  const listId = useId()

  const pct = term.unit === '%' || term.basis?.toLowerCase().includes('percent')
  const numericDefault = typeof term.default === 'number'

  // Options: explicit term options win; otherwise seed from the LD table.
  const options = ((term.options?.filter(o => typeof o === 'number') as number[] | undefined)
    ?? ldTable?.rows.map(r => r.value) ?? [])
    .slice().sort((a, b) => a - b)
  const termOwned = !!term.options?.length  // once edited, options live on the term

  const lo = term.min ?? (options.length ? options[0] : undefined)
  const hi = term.max ?? (options.length ? options[options.length - 1] : undefined)
  const def = numericDefault ? (term.default as number) : undefined
  const showTrack = numericDefault && lo !== undefined && hi !== undefined && hi > lo
  const position = showTrack ? Math.min(1, Math.max(0, (def! - lo!) / (hi! - lo!))) : 0

  function selectDefault(v: number) { if (canEdit) onChange({ default: v }) }
  function addOption() {
    const v = Number(draft.replace(/[,$%\s]/g, ''))
    if (!Number.isFinite(v) || v <= 0) return
    const next = Array.from(new Set([...(termOwned ? options : options), v])).sort((a, b) => a - b)
    onChange({ options: next })
    setDraft(''); setAdding(false)
  }
  function removeOption(v: number) {
    if (!canEdit) return
    onChange({ options: options.filter(o => o !== v), ...(term.default === v ? { default: options.find(o => o !== v) ?? v } : {}) })
  }
  function setBound(which: 'min' | 'max', raw: string) {
    const v = Number(raw.replace(/[,$%\s]/g, ''))
    onChange({ [which]: Number.isFinite(v) ? v : undefined } as Partial<CoverageTerm>)
  }

  // Non-numeric limit (e.g. "10% of Coverage A"): show the value plainly.
  if (!numericDefault && !options.length) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-dim">{term.label}</span>
        <span className="font-mono text-sm text-text">{String(term.default)}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-dim">{term.label}</span>
        {def !== undefined && <span className="font-mono text-sm font-semibold text-text tnum">{fmt(def, pct)}<span className="text-faint font-normal text-[11px] ml-1">default</span></span>}
      </div>

      {/* Range track */}
      {showTrack && (
        <div className="flex flex-col gap-1">
          <div className="relative h-1.5 rounded-full" style={{ background: 'var(--color-raised)' }}>
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${position * 100}%`, background: 'var(--gradient-accent)' }} />
            <div className="absolute top-1/2 w-3 h-3 rounded-full bg-surface" style={{ left: `${position * 100}%`, transform: 'translate(-50%,-50%)', border: '2px solid var(--color-accent)', boxShadow: '0 1px 3px var(--glow-accent)' }} />
          </div>
          {canEdit ? (
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <input aria-label={`${term.label} minimum`} defaultValue={String(lo)} onBlur={e => setBound('min', e.target.value)}
                className="w-16 h-6 px-1.5 rounded-[5px] bg-surface border border-border-strong font-mono text-[10px] text-dim text-center focus:outline-none focus:ring-2 focus:ring-accent/25" />
              <span className="text-faint">range</span>
              <input aria-label={`${term.label} maximum`} defaultValue={String(hi)} onBlur={e => setBound('max', e.target.value)}
                className="w-16 h-6 px-1.5 rounded-[5px] bg-surface border border-border-strong font-mono text-[10px] text-dim text-center focus:outline-none focus:ring-2 focus:ring-accent/25" />
            </div>
          ) : (
            <div className="flex justify-between text-[10px] text-faint font-mono">
              <span>{compact(lo!, pct)}</span><span>{compact(hi!, pct)}</span>
            </div>
          )}
        </div>
      )}

      {/* Standard options */}
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map(v => {
          const selected = term.default === v
          const blockReason = isBlocked?.(v)
          return (
            <span key={v} className="group/opt relative inline-flex">
              <button
                disabled={!canEdit || !!blockReason}
                onClick={() => selectDefault(v)}
                title={blockReason}
                className={`inline-flex items-center gap-1 pl-2.5 ${termOwned && canEdit ? 'pr-1.5' : 'pr-2.5'} py-1 rounded-[7px] text-xs font-medium font-mono border transition-colors
                  ${selected ? 'bg-accent text-white border-accent' : 'bg-surface border-border-strong text-dim hover:border-accent hover:text-accent'}
                  ${blockReason ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {selected && <Check size={11} aria-hidden="true" />}
                {fmt(v, pct)}
                {termOwned && canEdit && !selected && (
                  <span role="button" tabIndex={-1} aria-label={`Remove ${fmt(v, pct)}`}
                    onClick={e => { e.stopPropagation(); removeOption(v) }}
                    className="ml-0.5 text-faint hover:text-danger"><X size={11} /></span>
                )}
              </button>
            </span>
          )
        })}

        {canEdit && (adding ? (
          <span className="inline-flex items-center gap-1">
            <datalist id={listId}>{(pct ? PERCENT_OPTIONS : LIMIT_AMOUNTS).map(v => <option key={v} value={String(v)} />)}</datalist>
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} list={listId}
              onKeyDown={e => { if (e.key === 'Enter') addOption(); if (e.key === 'Escape') { setAdding(false); setDraft('') } }}
              placeholder={pct ? '10' : '25000'} aria-label="New option value" autoComplete="off"
              className="w-20 h-7 px-2 rounded-[7px] bg-surface border border-accent font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent/25" />
            <button onClick={addOption} className="w-6 h-6 rounded-[6px] bg-accent text-white flex items-center justify-center" aria-label="Add option"><Check size={13} /></button>
          </span>
        ) : (
          <button onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[7px] text-xs font-medium text-dim border border-dashed border-border-strong hover:border-accent hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
            <Plus size={12} />Add option
          </button>
        ))}
      </div>
    </div>
  )
}
