// Pricing worksheet — the rating ALGORITHM on the left (an editable, drag-to-reorder
// stack of steps that shows each step's live running total), and the scenario INPUTS +
// calculated premium on the right. Everything traces through the shared evaluator, so a
// changed input animates the premium and flashes the step(s) that moved. A table-backed
// step opens the 1-3D grid editor; steps persist through the atomic mutate. Line-agnostic.
import { useState, useMemo, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { IconRefresh, IconClose, IconPricing } from '../../components/ui/icons'
import { evaluate, resolveLob, resolveRatingKit } from '@pf/shared'
import type { RatingInputs, RatingInputMap, RatingStep, RTTable, LDTable, RatingProgram, Coverage } from '@pf/shared'
import { linkCoverageToPricing } from '../../lib/insurance/pricingLinks'
import { useProductCtx } from '../../context/useProductCtx'
import type { WithId } from '../../context/ProductContext'
import { useUser } from '../../context/useUser'
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
      <div className="text-3xl font-bold tabular-nums mt-1.5">{premium == null ? '—' : `$${shown.toLocaleString()}`}</div>
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
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'User' }
  const lob  = useMemo(() => resolveLob(product), [product])
  const kit  = useMemo(() => resolveRatingKit(lob.prefix), [lob.prefix])
  const isHO = lob.prefix === 'PH'
  const coastal = useMemo(() => new Set<string>(lob.peril.eligibleStates), [lob])
  const [inputs, setInputs]       = useState<RatingInputMap>(() => ({ ...kit.workedExample }))
  const [riskState, setRiskState] = useState('OH')
  const [editing, setEditing]     = useState<EditableStep | null>(null)
  const [stepDialog, setStepDialog] = useState<{ step: RatingStep | null } | null>(null)

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

  const tablesReady = Object.keys(rtTables).length > 0 && Object.keys(ldTables).length > 0

  if (loading) return <div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><Skeleton className="h-[500px]" /><Skeleton className="h-[500px]" /></div>

  return (
    <div className="flex flex-col gap-5">
      {covFilter && (
        <PricingLinkagePanel cov={covFilter} program={ratingProgram} rtTables={rtTables} ldTables={ldTables} onClear={clearCov} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-5 items-start">
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

        {/* Right — calculated premium + scenario inputs */}
        <div className="flex flex-col gap-5">
          <PremiumCard premium={result?.finalPremium ?? (tablesReady ? null : null)} minimum={ratingProgram?.minimumPremium} />

          <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-text">Scenario inputs</span>
              <Button variant="ghost" size="sm" onClick={() => setInputs({ ...kit.workedExample })}>
                <IconRefresh size={13} />Reset
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
            {ratingProgram && !result && (
              <p className="text-[12px] text-faint pt-3 mt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                {tablesReady ? 'Couldn’t evaluate these inputs — adjust and retry.' : 'Loading rating tables…'}
              </p>
            )}
          </div>
        </div>
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
