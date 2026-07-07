// Pricing worksheet — live rating evaluation via the shared engine. The rating kit
// (getters + worked example + input worksheet) is resolved from the product's LOB, so
// Homeowners renders its bespoke panel and every other line (GL, imported) renders the
// data-driven panel — both trace through the same evaluator. Changing an input animates
// the premium counting to its new value and flashes the step(s) that moved (reduced-motion
// safe). A table-based step opens the Excel-like grid editor, which persists through
// mutate() so the trace + premium update live. Line-agnostic, not HO-only.
import { useState, useMemo, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { IconDownload, IconRefresh, IconRule, IconTable, IconClose, IconPricing } from '../../components/ui/icons'
import { evaluate, resolveLob, resolveRatingKit, deriveGridModel } from '@pf/shared'
import type { RatingInputs, RatingInputMap, TraceEntry, RatingStep, RTTable, LDTable, RatingProgram, Coverage } from '@pf/shared'
import { linkCoverageToPricing } from '../../lib/insurance/pricingLinks'
import { useProductCtx } from '../../context/useProductCtx'
import type { WithId } from '../../context/ProductContext'
import { useUser } from '../../context/useUser'
import { Button, Badge, Skeleton, RefChip } from '../../components/ui'
import { HomeownersRatingPanel } from '../../components/product/HomeownersRatingPanel'
import { GenericRatingPanel } from '../../components/product/GenericRatingPanel'
import { RatingTableEditor } from '../../components/product/RatingTableEditor'
import { RatingFlow } from '../../lib/svg/ratingFlow'

// ─── Pricing linkage — the rating steps + tables that reference a coverage ──────

const OP_COLOR: Record<RatingStep['op'], 'purple' | 'good' | 'blue' | 'warn'> = {
  MUL: 'purple', ADD: 'good', SET: 'blue', MIN_FLOOR: 'warn',
}

function PricingLinkagePanel({ cov, program, rtTables, ldTables, onClear }: {
  cov: WithId<Coverage>
  program: WithId<RatingProgram> | null
  rtTables: Record<string, RTTable>
  ldTables: Record<string, LDTable>
  onClear: () => void
}) {
  const { steps, tables } = linkCoverageToPricing(cov, program, rtTables, ldTables)
  return (
    <div className="bg-surface rounded-[14px] p-4 flex flex-col gap-3" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-[10px] flex items-center justify-center text-accent bg-accent-soft shrink-0"><IconPricing size={18} /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">Pricing linkage</p>
            <p className="text-xs text-dim truncate">
              {steps.length} rating step{steps.length === 1 ? '' : 's'} reference <span className="text-accent font-medium">{cov.name}</span>
            </p>
          </div>
        </div>
        <button onClick={onClear} aria-label="Clear coverage filter"
          className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-text hover:bg-raised transition-colors shrink-0"><IconClose size={15} /></button>
      </div>

      {steps.length === 0 ? (
        <p className="text-sm text-faint px-1 py-2">No rating steps reference this coverage yet.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {steps.map(s => (
              <div key={s.id} className="flex items-center gap-2.5 px-3 py-2 rounded-[9px] bg-raised">
                <Badge label={s.op} color={OP_COLOR[s.op]} />
                <span className="text-sm text-text flex-1 min-w-0 truncate">{s.label}</span>
                {s.source.ref && <RefChip id={s.source.ref} title={rtTables[s.source.ref]?.name ?? ldTables[s.source.ref]?.name} />}
              </div>
            ))}
          </div>
          {tables.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mr-0.5">Tables</span>
              {tables.map(t => <RefChip key={t.ref} id={t.ref} tone="accent" title={t.name} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Reduced-motion + spring-animated premium ─────────────────────────────────

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Animate a number toward `target` with a lightly under-damped spring — it settles in
 *  ~280ms with a barely-perceptible overshoot, so a changed input reads as a live, physical
 *  nudge against the premium rather than a linear tween. The spring chases a MOVING target:
 *  rapid input changes retarget the in-flight animation instead of restarting it, keeping
 *  motion continuous. Snaps instantly under reduced motion. */
function useSpringNumber(target: number): number {
  const [display, setDisplay] = useState(target)
  const motion = useRef({ value: target, velocity: 0 })
  const goalRef = useRef(target)
  const rafRef  = useRef<number | null>(null)

  useEffect(() => {
    goalRef.current = target
    if (prefersReducedMotion()) {
      motion.current = { value: target, velocity: 0 }
      setDisplay(target)
      return
    }
    // A loop is already chasing goalRef → let it converge on the new target. And if we're
    // already at rest on target, there's nothing to animate (also the mount case).
    if (rafRef.current !== null) return
    if (Math.abs(motion.current.value - target) < 0.5 && Math.abs(motion.current.velocity) < 0.5) {
      motion.current.value = target; setDisplay(target); return
    }
    // Tuned for a lively 200–400ms settle: ω₀ ≈ 19.5 rad/s, ζ ≈ 0.74 → ~3% overshoot.
    const STIFFNESS = 380, DAMPING = 29, MASS = 1
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30); last = now   // clamp dt (tab defocus)
      const m = motion.current
      const accel = (-STIFFNESS * (m.value - goalRef.current) - DAMPING * m.velocity) / MASS
      m.velocity += accel * dt
      m.value    += m.velocity * dt
      if (Math.abs(m.velocity) < 0.5 && Math.abs(m.value - goalRef.current) < 0.5) {
        m.value = goalRef.current; m.velocity = 0
        setDisplay(goalRef.current); rafRef.current = null; return
      }
      setDisplay(m.value)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [target])

  // Cancel any in-flight frame on unmount.
  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  return display
}

// ─── Trace: animated flow diagram + detailed table + clean SVG export ─────────

interface EditableStep { step: RatingStep; table: RTTable & { id: string; rev?: number } }

function TracePanel({ trace, finalPremium, changedStepIds, editableFor, onEditTable }: {
  trace: TraceEntry[]
  finalPremium: number
  changedStepIds: Set<string>
  /** Returns the editable step + table for a trace row, or null when not grid-editable. */
  editableFor: (stepId: string) => EditableStep | null
  onEditTable: (e: EditableStep) => void
}) {
  const [view, setView] = useState<'flow' | 'table'>('flow')
  const flowRef = useRef<HTMLDivElement>(null)
  const animatedPremium = useSpringNumber(finalPremium)
  const shownPremium = Math.round(animatedPremium)

  // Export the on-screen flow SVG verbatim (adds a page-background rect for a
  // self-contained file). Serialising the rendered node keeps export == on-screen.
  function exportSVG() {
    const svg = flowRef.current?.querySelector('svg')
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#F7F7FA')
    clone.insertBefore(bg, clone.firstChild)
    const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone)
    const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' }))
    const a = document.createElement('a'); a.href = url; a.download = 'rating-flow.svg'; a.click()
    URL.revokeObjectURL(url)
  }

  // Real tab semantics (role="tab" + aria-selected) — the parent is a role="tablist",
  // so a screen reader announces "tab, selected" rather than the mismatched "button, pressed".
  const seg = (v: 'flow' | 'table', icon: React.ReactNode, label: string) => (
    <button onClick={() => setView(v)} role="tab" aria-selected={view === v}
      className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-[7px] text-xs font-medium transition-colors cursor-pointer ${view === v ? 'bg-surface text-accent shadow-[var(--shadow-card)]' : 'text-dim hover:text-text'}`}>
      {icon}{label}
    </button>
  )

  return (
    <div className="flex flex-col gap-0 h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-text">Rating trace</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-[9px] bg-raised" role="tablist" aria-label="Trace view">
            {seg('flow', <IconRule size={13} />, 'Flow')}
            {seg('table', <IconTable size={13} />, 'Table')}
          </div>
          <Button variant="ghost" size="sm" onClick={exportSVG} aria-label="Export rating flow as SVG"><IconDownload size={13} />SVG</Button>
        </div>
      </div>

      {view === 'flow' ? (
        <div ref={flowRef} className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
          <RatingFlow trace={trace} finalPremium={finalPremium} displayPremium={shownPremium} changedStepIds={changedStepIds} />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-faint uppercase tracking-wide" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Step','Op','Source','Factor / $','Running total',''].map((h, i) => <th key={i} className="text-left px-3 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {trace.map(t => {
                  const editable = editableFor(t.stepId)
                  return (
                    <tr key={t.stepId} className={changedStepIds.has(t.stepId) ? 'flow-changed' : 'hover:bg-raised'} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="px-3 py-2 font-mono text-text">{t.stepId}</td>
                      <td className="px-3 py-2"><Badge label={t.op} color={t.op === 'MUL' ? 'purple' : t.op === 'ADD' ? 'good' : t.op === 'SET' ? 'blue' : 'warn'} /></td>
                      <td className="px-3 py-2 font-mono text-dim truncate max-w-[140px]">{t.sourceRef}</td>
                      <td className="px-3 py-2 font-mono text-text">
                        {t.op === 'MUL' ? `×${t.factorOrAmount}` : t.op === 'ADD' ? `+$${t.factorOrAmount.toFixed(2)}` : t.op === 'SET' ? `$${t.factorOrAmount}` : `≥$${t.factorOrAmount}`}
                      </td>
                      <td className="px-3 py-2 font-mono font-bold text-text">
                        ${t.runningTotal.toLocaleString(undefined, { minimumFractionDigits: t.rounded ? 0 : 2, maximumFractionDigits: 2 })}
                        {t.rounded && <span className="text-faint text-[10px] ml-1">rounded</span>}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {editable && (
                          <button onClick={() => onEditTable(editable)} title={`Edit ${editable.table.id} as a grid`}
                            aria-label={`Edit table ${editable.table.id}`}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-faint hover:text-accent hover:bg-accent-soft transition-colors cursor-pointer">
                            <IconTable size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Final premium — counts up to its new value */}
          <div
            className="flex items-center justify-between px-5 py-4 rounded-[12px] mt-3"
            style={{ background: 'var(--gradient-accent-soft)', border: '1px solid var(--color-accent-line)' }}
          >
            <span className="text-sm font-semibold text-text">Final premium</span>
            <span className="text-2xl font-bold tabular-nums gradient-text">${shownPremium.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main route ───────────────────────────────────────────────────────────────

// Friendly labels for the rating-input keys a PM can pick as grid dimensions.
const DIM_LABELS: Record<string, string> = {
  territory: 'Territory', pc: 'Protection class', construction: 'Construction',
  covA: 'Coverage A', allPerilDed: 'All-peril deductible', covCPct: 'Coverage C %',
  covELimit: 'Coverage E limit', covFLimit: 'Coverage F limit', tier: 'Tier',
  deviceCredit: 'Device credit', waterBackupLimit: 'Water back-up limit', windHailPct: 'Wind/hail %',
}
function humanize(key: string) {
  return DIM_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim()
}

export default function ProductPricing() {
  const { product, coverages, ratingProgram, ldTables, rtTables, loading } = useProductCtx()
  const [params, setParams] = useSearchParams()
  // A coverage deep link from its Pricing tile (…/pricing?cov=<refId>) surfaces the
  // rating steps that reference that coverage, with a clearable panel.
  const covFilter = coverages.find(c => c.refId === params.get('cov') || c.id === params.get('cov'))
  const clearCov = () => { const p = new URLSearchParams(params); p.delete('cov'); setParams(p, { replace: true }) }
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const lob  = useMemo(() => resolveLob(product), [product])
  const kit  = useMemo(() => resolveRatingKit(lob.prefix), [lob.prefix])
  const isHO = lob.prefix === 'HO'
  const coastal = useMemo(() => new Set<string>(lob.peril.eligibleStates), [lob])
  const [inputs, setInputs]       = useState<RatingInputMap>(() => ({ ...kit.workedExample }))
  const [riskState, setRiskState] = useState('OH')
  const [editing, setEditing]     = useState<EditableStep | null>(null)

  // Reset to this line's worked example whenever the line changes (mount + product load).
  useEffect(() => { setInputs({ ...kit.workedExample }) }, [lob.prefix, kit])

  const upd = (patch: RatingInputMap) => setInputs(prev => ({ ...prev, ...patch }))

  const result = useMemo(() => {
    if (!ratingProgram || !Object.keys(rtTables).length || !Object.keys(ldTables).length) return null
    try {
      return evaluate(ratingProgram, inputs, kit.makeRtGetter(rtTables), kit.makeLdGetter(ldTables))
    } catch { return null }
  }, [ratingProgram, rtTables, ldTables, inputs, kit])

  // Detect which step factors moved since the last change → transient highlight.
  const [changedStepIds, setChangedStepIds] = useState<Set<string>>(new Set())
  const prevRef = useRef<{ factors: Map<string, number>; final: number } | null>(null)
  useEffect(() => {
    if (!result) return
    const factors = new Map(result.trace.map(t => [t.stepId, t.factorOrAmount]))
    const prev = prevRef.current
    const changed = new Set<string>()
    if (prev) {
      for (const [id, f] of factors) if (!prev.factors.has(id) || prev.factors.get(id) !== f) changed.add(id)
      for (const id of prev.factors.keys()) if (!factors.has(id)) changed.add(id)
      if (prev.final !== result.finalPremium) changed.add('__final__')
    }
    prevRef.current = { factors, final: result.finalPremium }
    if (prev && changed.size) {
      setChangedStepIds(changed)
      const to = setTimeout(() => setChangedStepIds(new Set()), 1200)
      return () => clearTimeout(to)
    }
  }, [result])

  // Candidate grid dimensions: scalar rating inputs a PM can pick as lookup keys.
  const candidateDimensions = useMemo(() => Object.entries(inputs)
    .filter(([k, v]) => (typeof v === 'number' || typeof v === 'string') && !k.endsWith('Elected'))
    .map(([k]) => ({ key: k, label: humanize(k) })), [inputs])

  // A trace step is grid-editable when it (EDITOR+) resolves to a grid-representable RT
  // table. Precomputed once per program/table change so cell rows don't re-derive on every
  // render (e.g. during the premium count-up). VIEWER gets an empty map → no edit buttons.
  const editableByStepId = useMemo(() => {
    const m = new Map<string, EditableStep>()
    if (!canEdit) return m
    for (const step of ratingProgram?.steps ?? []) {
      const ref = step.source.ref
      if (!ref) continue
      const table = rtTables[ref] as (RTTable & { id: string; rev?: number }) | undefined
      if (table && deriveGridModel(table)) m.set(step.id, { step, table })
    }
    return m
  }, [ratingProgram, rtTables, canEdit])
  const editableFor = (stepId: string): EditableStep | null => editableByStepId.get(stepId) ?? null

  // Whether the rating tables have actually arrived — lets the trace pane tell "loading"
  // apart from "evaluation failed" (both leave result === null).
  const tablesReady = Object.keys(rtTables).length > 0 && Object.keys(ldTables).length > 0

  if (loading) return <div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><Skeleton className="h-[500px]" /><Skeleton className="h-[500px]" /></div>

  return (
    <div className="flex flex-col gap-5">
      {covFilter && (
        <PricingLinkagePanel cov={covFilter} program={ratingProgram} rtTables={rtTables} ldTables={ldTables} onClear={clearCov} />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Left — inputs (bespoke Homeowners worksheet, else the data-driven panel) */}
      <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-text">Rating inputs</span>
          <Button variant="ghost" size="sm" onClick={() => setInputs({ ...kit.workedExample })}>
            <IconRefresh size={13} />Reset to worked example
          </Button>
        </div>

        {isHO ? (
          <HomeownersRatingPanel
            inputs={inputs as RatingInputs} onChange={upd}
            riskState={riskState} setRiskState={setRiskState}
            coastal={coastal} ldTables={ldTables} />
        ) : (
          <GenericRatingPanel spec={kit.inputSpec} inputs={inputs} ldTables={ldTables} onChange={upd} />
        )}
      </div>

      {/* Right — trace */}
      <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
        {!ratingProgram ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-faint">
            <IconRefresh size={24} />
            <span className="text-sm">No rating program found</span>
          </div>
        ) : !result ? (
          // Tables still loading vs. a genuine evaluation failure are different states — the
          // spinner only spins while data is in-flight; a failed evaluate() says so honestly
          // instead of a forever-spinner that implies "still loading".
          <div className="flex flex-col items-center justify-center h-full gap-2 text-faint">
            <IconRefresh size={24} className={tablesReady ? '' : 'animate-spin'} />
            <span className="text-sm">{tablesReady ? 'Couldn’t evaluate these inputs — adjust and retry' : 'Loading tables…'}</span>
          </div>
        ) : (
          <TracePanel trace={result.trace} finalPremium={result.finalPremium}
            changedStepIds={changedStepIds} editableFor={editableFor} onEditTable={setEditing} />
        )}
      </div>

      {editing && (
        <RatingTableEditor step={editing.step} table={editing.table}
          candidateDimensions={candidateDimensions} seedInputs={inputs}
          onClose={() => setEditing(null)} />
      )}
      </div>
    </div>
  )
}
