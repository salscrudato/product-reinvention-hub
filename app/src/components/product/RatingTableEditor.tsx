// RatingTableEditor — the Excel-like, keyboard-first grid for a table-based rating step.
// The PM defines the lookup by choosing up to 3 dimensions (drawn from the rating inputs)
// and fills a grid of every combination: 1-D → a column, 2-D → a matrix, 3-D → tabbed
// matrices. Values persist as the step's RT table via adapter.db.mutate() (entity + audit
// + version + searchIndex + rev) so the shared evaluator + live trace pick them up at once.
// For a "clean" table whose dimensions are rating-input keys, saving also aligns the step's
// source.keys so the generic lookup resolves; ragged/internal tables (subTable/limType) stay
// cell-editable only and keep their bespoke getter. VIEWER is read-only (rules + UI).
import { useMemo, useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  deriveGridModel, gridModelToTable, joinKey, splitKey,
  type RatingStep, type RTTable, type RatingInputMap, type GridDimension,
} from '@pf/shared'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { Dialog, Button, RefChip } from '../ui'
import {
  IconPlus, IconTrash, IconClose, IconChevronUp, IconChevronDown, IconTable, IconInfo, IconCheck,
} from '../ui/icons'

interface Props {
  step: RatingStep
  table: RTTable & { id: string; rev?: number }
  /** Rating-input keys the PM may add as dimensions (from the worked example / dictionary). */
  candidateDimensions: { key: string; label: string }[]
  /** Current worked-example inputs — seeds a sensible first value when adding a dimension. */
  seedInputs: RatingInputMap
  onClose: () => void
}

type Dim = GridDimension

export function RatingTableEditor({ step, table, candidateDimensions, seedInputs, onClose }: Props) {
  const { pid, ratingProgram } = useProductCtx()
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }

  const model = useMemo(() => deriveGridModel(table), [table])

  if (!model) {
    return (
      <Dialog open onClose={onClose} width="max-w-lg">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-[11px] bg-raised flex items-center justify-center text-faint shrink-0"><IconTable size={20} /></span>
          <div>
            <h2 className="text-base font-semibold text-text">{table.name}</h2>
            <p className="text-sm text-dim mt-1">This table uses a custom layout (e.g. value ranges or several value columns) that isn't grid-editable yet. Edit it as a bureau import instead.</p>
          </div>
        </div>
        <div className="flex justify-end mt-6"><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
      </Dialog>
    )
  }

  return (
    <GridEditor step={step} table={table} model0={model} candidateDimensions={candidateDimensions}
      seedInputs={seedInputs} pid={pid} ratingProgram={ratingProgram} canEdit={canEdit} actor={actor} onClose={onClose} />
  )
}

// The stateful editor is split out so hooks run only once a valid grid model exists.
function GridEditor({ step, table, model0, candidateDimensions, seedInputs, pid, ratingProgram, canEdit, actor, onClose }: {
  step: RatingStep
  table: RTTable & { id: string; rev?: number }
  model0: NonNullable<ReturnType<typeof deriveGridModel>>
  candidateDimensions: { key: string; label: string }[]
  seedInputs: RatingInputMap
  pid: string
  ratingProgram: ReturnType<typeof useProductCtx>['ratingProgram']
  canEdit: boolean
  actor: { uid: string; name: string }
  onClose: () => void
}) {
  const valueColumn = model0.valueColumn
  const [dims, setDims] = useState<Dim[]>(model0.dimensions)
  // Cells as raw text (joinKey → string) so typing/paste/validation are simple; parsed on save.
  const [cells, setCells] = useState<Record<string, string>>(() => {
    const c: Record<string, string> = {}
    for (const [k, v] of Object.entries(model0.cells)) c[k] = String(v)
    return c
  })
  const [page, setPage] = useState(0)          // active 3rd-dimension index (3-D only)
  const [saving, setSaving] = useState(false)
  const [dimMenuOpen, setDimMenuOpen] = useState(false)

  const isSpp = step.source.type === 'SPP'
  const candidateKeys = useMemo(() => new Set(candidateDimensions.map(d => d.key)), [candidateDimensions])
  // Structural edits (dimension + value CRUD, source.keys alignment) are only safe when every
  // dimension is a real rating-input key; ragged/internal tables stay cell-editable only.
  const structuralEdit = canEdit && !isSpp && dims.every(d => candidateKeys.has(d.key))

  const rowDim = dims[0]!
  const colDim = dims.length >= 2 ? dims[1]! : undefined
  const pageDim = dims.length === 3 ? dims[2]! : undefined
  const nRows = rowDim.values.length
  const nCols = colDim ? colDim.values.length : 1
  const activePage = Math.min(page, (pageDim?.values.length ?? 1) - 1)

  const keyOf = useCallback((r: number, c: number): string => {
    const coords: string[] = [dims[0]!.values[r]!]
    if (dims.length >= 2) coords.push(dims[1]!.values[c]!)
    if (dims.length === 3) coords.push(dims[2]!.values[activePage]!)
    return joinKey(coords)
  }, [dims, activePage])

  // ── Cell stats across the FULL cross-product (all pages) — header + warnings ──
  const allKeys = useMemo(() => {
    let acc: string[][] = [[]]
    for (const d of dims) { const nx: string[][] = []; for (const p of acc) for (const v of d.values) nx.push([...p, v]); acc = nx }
    return acc.map(joinKey)
  }, [dims])
  const totalCells = allKeys.length
  const emptyCells = allKeys.filter(k => (cells[k] ?? '').trim() === '').length
  const invalidCells = allKeys.filter(k => { const t = (cells[k] ?? '').trim(); return t !== '' && !Number.isFinite(Number(t)) }).length

  // ── Cell editing + keyboard grid ──────────────────────────────────────────────
  const cellRefs = useRef<(HTMLInputElement | null)[][]>([])
  function focusCell(r: number, c: number) {
    const rr = Math.max(0, Math.min(nRows - 1, r))
    const cc = Math.max(0, Math.min(nCols - 1, c))
    const el = cellRefs.current[rr]?.[cc]
    if (el) { el.focus(); el.select() }
  }
  function onCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    const el = e.currentTarget
    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); focusCell(r - 1, c); break
      case 'ArrowDown':
      case 'Enter':      e.preventDefault(); focusCell(r + 1, c); break
      case 'ArrowLeft':  if (el.selectionStart === 0) { e.preventDefault(); focusCell(r, c - 1) } break
      case 'ArrowRight': if (el.selectionStart === el.value.length) { e.preventDefault(); focusCell(r, c + 1) } break
      case 'Tab': {
        // Spreadsheet Tab: walk cells left→right, wrapping across row ends; Shift+Tab walks
        // back. At the grid's first/last cell we let the browser move focus OUT (to the
        // dialog's Cancel/Save) rather than trapping keyboard users inside the grid.
        const flat = r * nCols + c
        const next = flat + (e.shiftKey ? -1 : 1)
        if (next >= 0 && next < nRows * nCols) {
          e.preventDefault()
          focusCell(Math.floor(next / nCols), next % nCols)
        }
        break
      }
    }
  }
  function onCellPaste(e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) {
    const text = e.clipboardData.getData('text/plain')
    if (!text || !/[\t\n]/.test(text)) return   // single value → let the browser paste normally
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n')
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    setCells(prev => {
      const next = { ...prev }
      lines.forEach((line, dr) => line.split('\t').forEach((v, dc) => {
        const rr = r + dr, cc = c + dc
        if (rr < nRows && cc < nCols) next[keyOf(rr, cc)] = v.trim()
      }))
      return next
    })
  }
  function setCell(r: number, c: number, v: string) { setCells(prev => ({ ...prev, [keyOf(r, c)]: v })) }

  // ── Dimension VALUE CRUD (structural tables only) ─────────────────────────────
  function addValue(di: number) {
    const dim = dims[di]!
    // Compute the new value name once (unique), used for both the dims + cells updates.
    const base = `New ${dim.label || dim.key}`
    let name = `${base} ${dim.values.length + 1}`, n = dim.values.length + 1
    while (dim.values.includes(name)) { n++; name = `${base} ${n}` }
    setDims(prev => prev.map((d, i) => i === di ? { ...d, values: [...d.values, name] } : d))
    // Seed the new value's plane by copying the first value's cells (neutral expansion).
    setCells(prev => {
      const first = dim.values[0]
      if (first === undefined) return prev
      const next = { ...prev }
      for (const [k, v] of Object.entries(prev)) {
        const parts = splitKey(k)
        if (parts[di] === first) { parts[di] = name; next[joinKey(parts)] = v }
      }
      return next
    })
  }
  function renameValue(di: number, j: number, newVal: string) {
    const oldVal = dims[di]!.values[j]!
    if (newVal === oldVal) return
    setDims(prev => prev.map((d, i) => i === di ? { ...d, values: d.values.map((v, k) => k === j ? newVal : v) } : d))
    setCells(prev => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) {
        const parts = splitKey(k)
        if (parts[di] === oldVal) parts[di] = newVal
        next[joinKey(parts)] = v
      }
      return next
    })
  }
  function moveValue(di: number, j: number, dir: -1 | 1) {
    const to = j + dir
    setDims(prev => prev.map((d, i) => {
      if (i !== di || to < 0 || to >= d.values.length) return d
      const values = [...d.values]; const t = values[j]!; values[j] = values[to]!; values[to] = t
      return { ...d, values }
    }))
  }
  function removeValue(di: number, j: number) {
    const dim = dims[di]!
    if (dim.values.length <= 1) { toast.error('A dimension needs at least one value'); return }
    const gone = dim.values[j]!
    setDims(prev => prev.map((d, i) => i === di ? { ...d, values: d.values.filter((_, k) => k !== j) } : d))
    setCells(prev => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) { if (splitKey(k)[di] !== gone) next[k] = v }
      return next
    })
  }

  // ── Dimension ADD / REMOVE (structural tables only) ───────────────────────────
  const usedKeys = new Set(dims.map(d => d.key))
  const addableDims = candidateDimensions.filter(d => !usedKeys.has(d.key))
  function addDimension(key: string, label: string) {
    if (dims.length >= 3) return
    // Seed the new dimension with one value = the worked-example input (keeps the grid
    // neutral: existing cells copy across, so a just-added dimension changes nothing).
    const seed = seedInputs[key]
    const seedVal = seed === undefined || seed === null ? label : String(seed)
    const numeric = typeof seed === 'number'
    setDims(prev => [...prev, { key, label, values: [seedVal], numeric }])
    setCells(prev => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) next[joinKey([...splitKey(k), seedVal])] = v
      return next
    })
    setDimMenuOpen(false)
  }
  function removeDimension(di: number) {
    if (dims.length <= 1) return
    const keepVal = dims[di]!.values[0]
    setCells(prev => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) {
        const parts = splitKey(k)
        if (parts[di] !== keepVal) continue
        parts.splice(di, 1); next[joinKey(parts)] = v
      }
      return next
    })
    setDims(prev => prev.filter((_, i) => i !== di))
    setPage(0)
  }

  // ── Persist ───────────────────────────────────────────────────────────────────
  async function save() {
    if (!canEdit) return
    if (invalidCells > 0) { toast.error(`${invalidCells} cell${invalidCells === 1 ? '' : 's'} not a valid number`); return }
    setSaving(true)
    try {
      const numericCells: Record<string, number> = {}
      for (const k of allKeys) { const t = (cells[k] ?? '').trim(); if (t !== '') numericCells[k] = Number(t) }
      const nextTable = gridModelToTable({ valueColumn, dimensions: dims, cells: numericCells }, table)

      await adapter.db.mutate({
        op: 'update', path: `rtTables/${table.id}`,
        data: { name: nextTable.name, columns: nextTable.columns, rows: nextTable.rows, dimensions: nextTable.dimensions, valueColumn: nextTable.valueColumn },
        entityType: 'rtTable', productId: pid, actor,
        expectedRev: table.rev,
      })

      // For a clean table, align the step's lookup keys with the chosen dimensions so the
      // generic lookup resolves. Skipped for SPP (no keys) and ragged/internal tables.
      if (structuralEdit && ratingProgram) {
        const wantKeys = dims.map(d => d.key)
        const cur = step.source.keys ?? []
        const changed = wantKeys.length !== cur.length || wantKeys.some((k, i) => k !== cur[i])
        if (changed) {
          const nextSteps = ratingProgram.steps.map(s =>
            s.id === step.id ? { ...s, source: { ...s.source, keys: wantKeys } } : s)
          await adapter.db.mutate({
            op: 'update', path: `products/${pid}/ratingPrograms/${ratingProgram.id}`,
            data: { steps: nextSteps }, entityType: 'ratingProgram', productId: pid, actor,
            expectedRev: ratingProgram.rev,
          })
        }
      }
      toast.success(`${table.name} saved`)
      onClose()
    } catch (err) {
      if (err instanceof MutationConflictError) {
        conflictToast({ discard: onClose })
      } else {
        toast.error(err instanceof Error ? err.message : 'Save failed')
      }
    } finally { setSaving(false) }
  }

  const dimsSummary = dims.map(d => `${d.label || d.key} (${d.values.length})`).join('  ×  ')

  return (
    <Dialog open onClose={onClose} width="max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}>
            <IconTable size={22} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-text truncate">{table.name}</h2>
              <RefChip id={table.id} tone="accent" />
            </div>
            <p className="text-sm text-dim mt-0.5 truncate">{dimsSummary} · {totalCells} cell{totalCells === 1 ? '' : 's'}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-faint hover:text-text rounded-[8px] p-1.5 hover:bg-raised transition-colors shrink-0"><IconClose size={18} /></button>
      </div>

      {/* Dimension bar */}
      <div className="flex flex-wrap items-start gap-2 mb-3">
        {dims.map((d, di) => (
          <DimensionChip key={d.key} dim={d} index={di} structural={structuralEdit}
            onRename={(j, v) => renameValue(di, j, v)} onMove={(j, dir) => moveValue(di, j, dir)}
            onRemoveValue={j => removeValue(di, j)} onAddValue={() => addValue(di)}
            onRemoveDim={dims.length > 1 ? () => removeDimension(di) : undefined} />
        ))}
        {structuralEdit && dims.length < 3 && addableDims.length > 0 && (
          <div className="relative">
            <Button variant="default" size="sm" onClick={() => setDimMenuOpen(o => !o)} aria-expanded={dimMenuOpen}>
              <IconPlus size={13} />Add dimension
            </Button>
            {dimMenuOpen && (
              <div className="absolute z-10 mt-1 w-56 rounded-[10px] bg-surface p-1 shadow-[var(--shadow-card-hover)]" style={{ border: '1px solid var(--color-border)' }} role="menu">
                {addableDims.map(d => (
                  <button key={d.key} role="menuitem" onClick={() => addDimension(d.key, d.label)}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-[7px] text-sm text-text hover:bg-raised text-left transition-colors">
                    {d.label}<span className="font-mono text-[11px] text-faint">{d.key}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Warnings */}
      {(emptyCells > 0 || invalidCells > 0) && (
        <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
          {emptyCells > 0 && (
            <span className="inline-flex items-center gap-1.5 text-warn"><IconInfo size={13} />{emptyCells} empty cell{emptyCells === 1 ? '' : 's'} (won't be looked up)</span>
          )}
          {invalidCells > 0 && (
            <span className="inline-flex items-center gap-1.5 text-danger"><IconInfo size={13} />{invalidCells} invalid value{invalidCells === 1 ? '' : 's'}</span>
          )}
        </div>
      )}

      {/* 3-D page tabs */}
      {pageDim && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <span className="text-[11px] text-faint mr-1">{pageDim.label || pageDim.key}:</span>
          {pageDim.values.map((v, i) => (
            <button key={v} onClick={() => setPage(i)} aria-pressed={i === activePage}
              className={`px-2.5 h-7 rounded-[7px] text-xs font-medium font-mono transition-colors ${i === activePage ? 'bg-accent text-on-accent' : 'bg-raised text-dim hover:text-text'}`}>
              {v}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="overflow-auto rounded-[12px] max-h-[52vh]" style={{ border: '1px solid var(--color-border)' }}>
        <table className="border-collapse text-sm" style={{ minWidth: colDim ? 'max-content' : undefined, width: colDim ? undefined : '100%' }}>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 bg-raised px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[.06em] text-faint" style={{ borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                {rowDim.label || rowDim.key}
              </th>
              {colDim ? colDim.values.map(cv => (
                <th key={cv} className="sticky top-0 z-10 bg-raised px-3 py-2 text-right text-xs font-semibold font-mono text-dim whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {cv}
                </th>
              )) : (
                <th className="sticky top-0 z-10 bg-raised px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[.06em] text-faint" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {valueColumn}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rowDim.values.map((rv, r) => (
              <tr key={rv} className="group">
                <th scope="row" className="sticky left-0 z-10 bg-surface group-hover:bg-raised px-3 py-1.5 text-left font-mono text-xs text-text whitespace-nowrap transition-colors" style={{ borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                  {rv}
                </th>
                {Array.from({ length: nCols }).map((_, c) => {
                  const k = keyOf(r, c)
                  const raw = cells[k] ?? ''
                  const invalid = raw.trim() !== '' && !Number.isFinite(Number(raw))
                  return (
                    <td key={c} className="p-0" style={{ borderBottom: '1px solid var(--color-border)', borderRight: c < nCols - 1 ? '1px solid var(--color-border)' : undefined }}>
                      <input
                        ref={el => { (cellRefs.current[r] ??= [])[c] = el }}
                        value={raw} disabled={!canEdit} inputMode="decimal"
                        aria-label={`${rowDim.label || rowDim.key} ${rv}${colDim ? `, ${colDim.label || colDim.key} ${colDim.values[c]}` : ''}`}
                        onChange={e => setCell(r, c, e.target.value)}
                        onKeyDown={e => onCellKeyDown(e, r, c)}
                        onPaste={e => onCellPaste(e, r, c)}
                        onFocus={e => e.currentTarget.select()}
                        className={`w-full min-w-[92px] h-9 px-3 text-right font-mono tabular-nums bg-transparent text-text outline-none focus:bg-accent-soft focus:ring-2 focus:ring-inset focus:ring-accent/40 transition-colors ${invalid ? 'text-danger bg-[var(--color-danger-soft)]' : ''} disabled:text-dim`}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Hint + footer */}
      <p className="text-[11px] text-faint mt-2 flex items-center gap-1.5">
        <IconInfo size={12} />Arrow keys, Tab or Enter to move · type to edit · paste TSV to fill a range
      </p>
      <div className="flex items-center justify-between gap-2 mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <span className="text-xs text-faint">{canEdit ? 'Saves through mutate() — audit + version recorded' : 'Read-only — your role can\'t edit rating tables'}</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          {canEdit && <Button variant="primary" size="sm" onClick={save} disabled={saving || invalidCells > 0}>{saving ? 'Saving…' : <><IconCheck size={14} />Save table</>}</Button>}
        </div>
      </div>
    </Dialog>
  )
}

// ─── One dimension's value editor (rename / reorder / add / remove) ─────────────

function DimensionChip({ dim, index, structural, onRename, onMove, onRemoveValue, onAddValue, onRemoveDim }: {
  dim: Dim; index: number; structural: boolean
  onRename: (j: number, v: string) => void
  onMove: (j: number, dir: -1 | 1) => void
  onRemoveValue: (j: number) => void
  onAddValue: () => void
  onRemoveDim?: () => void
}) {
  const [open, setOpen] = useState(false)
  const axis = ['Rows', 'Columns', 'Pages'][index] ?? 'Dim'
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[8px] bg-raised text-dim hover:text-text text-xs font-medium transition-colors" style={{ border: '1px solid var(--color-border)' }}>
        <span className="text-[10px] uppercase tracking-wide text-faint">{axis}</span>
        <span className="text-text">{dim.label || dim.key}</span>
        <span className="font-mono text-faint">{dim.values.length}</span>
        <IconChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute z-20 mt-1 w-64 rounded-[11px] bg-surface p-2 shadow-[var(--shadow-card-hover)]" style={{ border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between px-1 pb-2 mb-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="text-xs font-semibold text-text">{dim.label || dim.key} values</span>
              {structural && onRemoveDim && (
                <button onClick={() => { onRemoveDim(); setOpen(false) }} className="text-[11px] text-danger hover:underline">Remove dimension</button>
              )}
            </div>
            <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
              {dim.values.map((v, j) => (
                <div key={j} className="flex items-center gap-1">
                  <input value={v} disabled={!structural} onChange={e => onRename(j, e.target.value)}
                    className="flex-1 h-7 px-2 rounded-[6px] bg-surface border border-border-strong font-mono text-xs text-text focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-raised disabled:text-dim" />
                  {structural && (
                    <>
                      <button onClick={() => onMove(j, -1)} disabled={j === 0} aria-label="Move up" className="w-6 h-7 rounded-[6px] flex items-center justify-center text-faint hover:text-text hover:bg-raised disabled:opacity-30 transition-colors"><IconChevronUp size={13} /></button>
                      <button onClick={() => onMove(j, 1)} disabled={j === dim.values.length - 1} aria-label="Move down" className="w-6 h-7 rounded-[6px] flex items-center justify-center text-faint hover:text-text hover:bg-raised disabled:opacity-30 transition-colors"><IconChevronDown size={13} /></button>
                      <button onClick={() => onRemoveValue(j)} aria-label="Remove value" className="w-6 h-7 rounded-[6px] flex items-center justify-center text-faint hover:text-danger hover:bg-[var(--color-danger-hover)] transition-colors"><IconTrash size={12} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {structural
              ? <button onClick={onAddValue} className="mt-1.5 w-full inline-flex items-center justify-center gap-1.5 h-7 rounded-[7px] text-xs font-medium text-accent bg-accent-soft hover:bg-accent-soft/70 transition-colors"><IconPlus size={12} />Add value</button>
              : <p className="mt-1 px-1 text-[11px] text-faint leading-snug">This table's dimensions come from its bureau layout — edit the cell values above.</p>}
          </div>
        </>
      )}
    </div>
  )
}
