// Pricing worksheet — the rating ALGORITHM on the left (an editable, drag-to-reorder
// stack of steps that shows each step's live running total), and the scenario INPUTS +
// calculated premium on the right. Everything traces through the shared evaluator, so a
// changed input animates the premium and flashes the step(s) that moved. A table-backed
// step opens the 1-3D grid editor; steps persist through the atomic mutate. Line-agnostic.
import { useState, useMemo, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { IconRefresh, IconClose, IconPricing, IconChevronLeft, IconChevronRight } from '../../components/ui/icons'
import { evaluate, resolveLob, resolveRatingKit, deriveGridInputSpec } from '@pf/shared'
import type { RatingInputs, RatingInputMap, RatingStep, RTTable, LDTable, RatingProgram, Coverage, EvaluatorResult } from '@pf/shared'
import { linkCoverageToPricing } from '../../lib/insurance/pricingLinks'
import { useProductCtx } from '../../context/useProductCtx'
import type { WithId } from '../../context/ProductContext'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { Button, Badge, Skeleton, RefChip } from '../../components/ui'
import { HomeownersRatingPanel } from '../../components/product/HomeownersRatingPanel'
import { GenericRatingPanel } from '../../components/product/GenericRatingPanel'
import { RatingTableEditor } from '../../components/product/RatingTableEditor'
import { RatingAlgorithm, type EditableStep } from '../../components/product/RatingAlgorithm'
import { RatingStepDialog } from '../../components/product/RatingStepDialog'

// ─── Pricing linkage — the rating steps that reference a deep-linked coverage ──────

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

/** Debounce a rapidly-changing value so an expensive downstream recompute (here the full
 *  rating evaluation) runs at most once per quiet window — not on every keystroke or pasted
 *  grid cell. Settles ~90ms after the last change; the premium spring smooths the rest. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

/** Animate a number toward `target` with a lightly under-damped spring (settles ~280ms).
 *  Chases a moving target so rapid input changes retarget rather than restart. Snaps under
 *  reduced motion. */
function useSpringNumber(target: number): number {
  const [display, setDisplay] = useState(target)
  const motion = useRef({ value: target, velocity: 0 })
  const goalRef = useRef(target)
  const rafRef  = useRef<number | null>(null)

  useEffect(() => {
    goalRef.current = target
    if (prefersReducedMotion()) { motion.current = { value: target, velocity: 0 }; setDisplay(target); return }
    if (rafRef.current !== null) return
    if (Math.abs(motion.current.value - target) < 0.5 && Math.abs(motion.current.velocity) < 0.5) {
      motion.current.value = target; setDisplay(target); return
    }
    const STIFFNESS = 380, DAMPING = 29, MASS = 1
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30); last = now
      const m = motion.current
      const accel = (-STIFFNESS * (m.value - goalRef.current) - DAMPING * m.velocity) / MASS
      m.velocity += accel * dt
      m.value    += m.velocity * dt
      if (Math.abs(m.velocity) < 0.5 && Math.abs(m.value - goalRef.current) < 0.5) {
        m.value = goalRef.current; m.velocity = 0; setDisplay(goalRef.current); rafRef.current = null; return
      }
      setDisplay(m.value)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [target])

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])
  return display
}

function PremiumCard({ premium, minimum }: { premium: number | null; minimum?: number }) {
  const animated = useSpringNumber(premium ?? 0)
  const shown = Math.round(animated)
  return (
    <div className="rounded-[16px] p-5 text-white relative overflow-hidden" style={{ background: 'var(--gradient-accent)', boxShadow: '0 12px 30px -10px var(--glow-accent)' }}>
      <div className="flex items-center gap-1.5 text-white/80 text-[11px] font-semibold uppercase tracking-[.08em]">
        <IconPricing size={13} aria-hidden="true" /> Calculated premium
      </div>
      <div className="text-3xl font-bold tabular-nums mt-1.5" data-testid="calculated-premium">{premium == null ? '—' : `$${shown.toLocaleString()}`}</div>
      {minimum != null && <div className="text-white/70 text-[11px] mt-1 tnum">Minimum premium ${minimum.toLocaleString()}</div>}
    </div>
  )
}

// ─── Grid-dimension labels ─────────────────────────────────────────────────────

const DIM_LABELS: Record<string, string> = {
  territory: 'Territory', pc: 'Protection class', construction: 'Construction',
  covA: 'Coverage A', allPerilDed: 'All-peril deductible', covCPct: 'Coverage C %',
  covELimit: 'Coverage E limit', covFLimit: 'Coverage F limit', tier: 'Tier',
  deviceCredit: 'Device credit', waterBackupLimit: 'Water back-up limit', windHailPct: 'Wind/hail %',
}
function humanize(key: string) {
  return DIM_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim()
}

// ─── Main route ───────────────────────────────────────────────────────────────

export default function ProductPricing() {
  const { pid, product, coverages, ratingProgram, ldTables, rtTables, loading } = useProductCtx()
  const [params, setParams] = useSearchParams()
  const covFilter = coverages.find(c => c.refId === params.get('cov') || c.id === params.get('cov'))
  const clearCov = () => { const p = new URLSearchParams(params); p.delete('cov'); setParams(p, { replace: true }) }
  const { user } = useUser()
  const canEdit = canI(user, 'product:write')
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'User' }
  const lob  = useMemo(() => resolveLob(product), [product])
  const kit  = useMemo(() => resolveRatingKit(lob.prefix), [lob.prefix])
  // An imported / grid-table product (e.g. from the filing importer) reads GRID tables the
  // bespoke line panel can't drive. Derive a data-driven worksheet + a guaranteed-resolvable
  // worked example from the program's own table dimensions; null for the seeded PH/PA/GL lines
  // (their tables carry no `dimensions`), which keep their bespoke panels untouched.
  const gridWorksheet = useMemo(() => deriveGridInputSpec(ratingProgram, rtTables), [ratingProgram, rtTables])
  const useGrid = gridWorksheet !== null
  const isHO = lob.prefix === 'PH' && !useGrid
  const coastal = useMemo(() => new Set<string>(lob.peril.eligibleStates), [lob])
  const [inputs, setInputs]       = useState<RatingInputMap>(() => ({ ...(gridWorksheet?.workedExample ?? kit.workedExample) }))
  const [riskState, setRiskState] = useState('OH')
  const [editing, setEditing]     = useState<EditableStep | null>(null)
  const [stepDialog, setStepDialog] = useState<{ step: RatingStep | null } | null>(null)
  // The rating-calculation rail (premium + scenario inputs) — collapsed by default.
  const [calcOpen, setCalcOpen] = useState(false)

  useEffect(() => { setInputs({ ...(gridWorksheet?.workedExample ?? kit.workedExample) }) }, [lob.prefix, kit, gridWorksheet])
  const upd = (patch: RatingInputMap) => setInputs(prev => ({ ...prev, ...patch }))

  // One deterministic path to a premium: memoized getters (rebuilt only when the kit or the
  // loaded tables change), a debounced input snapshot (a burst of edits recomputes once), and
  // a precise inline error when a step points at a rate table that isn't loaded.
  const rtGetter = useMemo(() => kit.makeRtGetter(rtTables), [kit, rtTables])
  const ldGetter = useMemo(() => kit.makeLdGetter(ldTables), [kit, ldTables])
  const debouncedInputs = useDebounced(inputs, 90)
  const tablesReady = Object.keys(rtTables).length > 0 && Object.keys(ldTables).length > 0

  // Table refs a step needs that aren't loaded (a step points at a deleted/renamed table).
  // RT/SPP resolve in rtTables; LD in ldTables. Distinct, in first-seen order.
  const missingRefs = useMemo(() => {
    if (!ratingProgram) return [] as string[]
    const miss: string[] = []
    for (const s of ratingProgram.steps) {
      const ref = s.source.ref
      if (!ref) continue
      if ((s.source.type === 'RT' || s.source.type === 'SPP') && !rtTables[ref]) miss.push(ref)
      else if (s.source.type === 'LD' && !ldTables[ref]) miss.push(ref)
    }
    return [...new Set(miss)]
  }, [ratingProgram, rtTables, ldTables])

  const evaluation = useMemo<{ result: EvaluatorResult | null; error: string | null }>(() => {
    if (!ratingProgram || !tablesReady) return { result: null, error: null }
    if (missingRefs.length > 0)
      return { result: null, error: `Missing rate table${missingRefs.length === 1 ? '' : 's'}: ${missingRefs.join(', ')}` }
    try {
      return { result: evaluate(ratingProgram, debouncedInputs, rtGetter, ldGetter), error: null }
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : 'Could not evaluate these inputs.' }
    }
  }, [ratingProgram, tablesReady, missingRefs, debouncedInputs, rtGetter, ldGetter])
  const result = evaluation.result

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
    }
    prevRef.current = { factors, final: result.finalPremium }
    if (prev && changed.size) {
      setChangedStepIds(changed)
      const to = setTimeout(() => setChangedStepIds(new Set()), 1200)
      return () => clearTimeout(to)
    }
  }, [result])

  // Candidate grid dimensions / step inputs: scalar rating inputs a PM can pick.
  const candidateDimensions = useMemo(() => Object.entries(inputs)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
    .map(([k]) => ({ key: k, label: humanize(k) })), [inputs])

  if (loading && !ratingProgram) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-48" />
        <div className="flex flex-col gap-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="bg-surface rounded-[12px] p-4 flex items-center gap-3" style={{ border: '1px solid var(--color-border)' }}>
              <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              <div className="flex-1 flex flex-col gap-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {covFilter && (
        <PricingLinkagePanel cov={covFilter} program={ratingProgram} rtTables={rtTables} ldTables={ldTables} onClear={clearCov} />
      )}

      <div
        className="grid grid-cols-1 lg:grid lg:items-start gap-5"
        // The rating-calculation rail springs between full width and a slim edge
        // affordance — COLLAPSED by default so the algorithm read leads. The strip
        // still whispers the live premium, so the calculation is never out of mind.
        style={{ gridTemplateColumns: calcOpen ? 'minmax(0,1.3fr) minmax(0,1fr)' : 'minmax(0,1fr) 34px', transition: 'grid-template-columns .3s var(--ease-spring)' }}
      >
        {/* Left — the editable rating algorithm */}
        {!ratingProgram ? (
          <div className="bg-surface rounded-[14px] p-5 flex flex-col items-center justify-center gap-2 text-faint min-h-[300px]" style={{ border: '1px solid var(--color-border)' }}>
            <IconRefresh size={24} />
            <span className="text-sm">No rating program found</span>
          </div>
        ) : (
          <RatingAlgorithm
            program={ratingProgram} pid={pid} trace={result?.trace ?? []} changedStepIds={changedStepIds}
            rtTables={rtTables} ldTables={ldTables} coverages={coverages} canEdit={canEdit} actor={actor}
            onAdd={() => setStepDialog({ step: null })} onEdit={s => setStepDialog({ step: s })} onEditTable={setEditing}
          />
        )}

        {/* Right — the rating calculation (premium + scenario inputs), collapsible */}
        {calcOpen ? (
          <div className="relative flex flex-col gap-5">
            <button
              onClick={() => setCalcOpen(false)}
              aria-expanded="true"
              aria-label="Hide the rating calculation"
              className="hidden lg:flex absolute -left-3 top-5 z-10 w-6 h-6 items-center justify-center rounded-full bg-surface text-dim hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
            >
              <IconChevronRight size={13} aria-hidden="true" />
            </button>
            <button
              onClick={() => setCalcOpen(false)}
              aria-expanded="true"
              className="lg:hidden self-end inline-flex items-center gap-1 text-xs text-dim hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[6px] px-1"
            >
              Hide calculator <IconChevronRight size={12} aria-hidden="true" />
            </button>
            <PremiumCard premium={result?.finalPremium ?? null} minimum={ratingProgram?.minimumPremium} />

            <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-text">Scenario inputs</span>
                <Button variant="ghost" size="sm"
                  title="Load the worked example — prices to this line’s reference premium"
                  onClick={() => setInputs({ ...(gridWorksheet?.workedExample ?? kit.workedExample) })}>
                  <IconRefresh size={13} />Worked example
                </Button>
              </div>
              {isHO ? (
                <HomeownersRatingPanel
                  inputs={inputs as RatingInputs} onChange={upd}
                  riskState={riskState} setRiskState={setRiskState}
                  coastal={coastal} ldTables={ldTables} />
              ) : (
                <GenericRatingPanel spec={gridWorksheet?.inputSpec ?? kit.inputSpec} inputs={inputs} ldTables={ldTables} onChange={upd} />
              )}
              {ratingProgram && !result && (
                <p className={`text-[12px] pt-3 mt-3 ${evaluation.error ? 'text-warn' : 'text-faint'}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                  {!tablesReady ? 'Loading rating tables…' : (evaluation.error ?? 'Couldn’t evaluate these inputs — adjust and retry.')}
                </p>
              )}
            </div>
          </div>
        ) : (
          // Collapsed → a slim edge affordance carrying the live premium.
          <button
            onClick={() => setCalcOpen(true)}
            aria-expanded="false"
            aria-label={`Show the rating calculation${result?.finalPremium != null ? ` — current premium $${result.finalPremium.toLocaleString()}` : ''}`}
            className="group flex w-full items-center justify-center gap-1.5 rounded-[12px] px-2 py-2 lg:h-full lg:min-h-[300px] lg:w-[34px] lg:flex-col lg:px-0 lg:py-4 bg-surface hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <IconChevronLeft size={13} className="text-faint group-hover:text-accent transition-colors shrink-0" aria-hidden="true" />
            <span className="lg:hidden text-xs text-dim group-hover:text-text transition-colors">
              Rating calculation{result?.finalPremium != null ? ` · $${result.finalPremium.toLocaleString()}` : ''}
            </span>
            <span
              className="hidden lg:block text-[9.5px] font-semibold uppercase tracking-[.14em] text-faint group-hover:text-accent transition-colors select-none"
              style={{ writingMode: 'vertical-rl' }}
              aria-hidden="true"
            >
              {result?.finalPremium != null ? `Premium $${result.finalPremium.toLocaleString()}` : 'Rating calculation'}
            </span>
          </button>
        )}
      </div>

      {editing && (
        <RatingTableEditor step={editing.step} table={editing.table}
          candidateDimensions={candidateDimensions} seedInputs={inputs}
          onClose={() => setEditing(null)} />
      )}
      {stepDialog && ratingProgram && (
        <RatingStepDialog program={ratingProgram} pid={pid} step={stepDialog.step}
          rtTables={rtTables} ldTables={ldTables} inputs={candidateDimensions}
          actor={actor} onClose={() => setStepDialog(null)} />
      )}
    </div>
  )
}
