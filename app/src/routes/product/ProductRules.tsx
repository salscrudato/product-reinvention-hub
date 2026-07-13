// Rules tab — IF → THEN flow cards grouped by ISO category → sub-category, a live
// Simulate panel that runs the SHARED rules engine (every rule's outcome shown on its
// own card, derived from the engine's result — never re-decided), and a grounded AI
// composer to draft or edit a rule (server-side, cited, persisted via mutate()).
import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { evaluateRules, resolveLob } from '@pf/shared'
import type { RuleCategory, SelectionContext, PASelectionContext, GLSelectionContext, PaVehicleUse, RulesResult, HoOccupancy } from '@pf/shared'
import { useProductCtx } from '../../context/useProductCtx'
import type { WithId } from '../../context/ProductContext'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { Badge, Skeleton, EmptyState } from '../../components/ui'
import { Button } from '../../components/ui/Button'
import { IconPlus, IconClose, IconCheckCircle } from '../../components/ui/icons'
import { RuleFlowCard, RuleComposer, type NewRule } from '../../components/product/RuleBuilder'
import { simulateRule, type RuleLike } from '../../components/product/ruleSim'
import { useEntityFilters } from '../../features/search/useEntityFilters'
import { FacetPanel } from '../../features/search/FacetPanel'
import { CommandBar } from '../../features/search/CommandBar'
import { ActiveFilters } from '../../features/search/ActiveFilters'
import { rulesSchema } from '../../features/search/schemas/rulesSchema'
import { SavedViews } from '../../features/search/SavedViews'
import type { Rule } from '@pf/shared'

const CAT_COLOR: Record<RuleCategory, 'purple'|'blue'|'warn'> = { PRODUCT: 'purple', RATING: 'blue', FORMS: 'warn' }
const CAT_ORDER: RuleCategory[] = ['PRODUCT', 'RATING', 'FORMS']

// ── Shared helpers ────────────────────────────────────────────────────────────

const selectCls = 'h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-accent/25'
const usd = (n: number) => `$${n.toLocaleString()}`

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="text-xs text-dim w-36 shrink-0">{label}</span>{children}</div>
}

/** Engine result column — shared by both Simulate panels (violations, forms, blocked options). */
function EngineResultPanel({ result }: { result: RulesResult | null }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-text">Engine result</p>
      {!result ? <Skeleton className="h-32" /> : (
        <>
          {result.violations.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-faint uppercase tracking-wide">Violations</p>
              {result.violations.map((v, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-[8px] text-sm"
                  style={{ background: v.severity === 'warning'
                    ? 'color-mix(in srgb, var(--color-warn) 8%, var(--color-surface))'
                    : 'color-mix(in srgb, var(--color-danger) 6%, var(--color-surface))' }}>
                  <span className={`text-xs ${v.severity === 'warning' ? 'text-warn' : 'text-danger'}`}>{v.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-good"><IconCheckCircle size={14} />No violations — this submission is valid</div>
          )}

          <div>
            <p className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Forms that attach ({result.formsThatAttach.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {result.formsThatAttach.map(fn => <Badge key={fn} label={fn} color="blue" mono />)}
            </div>
          </div>

          {Object.entries(result.availableOptions).map(([tableRef, opts]) => {
            const blocked = opts.filter(o => !o.available)
            if (!blocked.length) return null
            return (
              <div key={tableRef}>
                <p className="text-xs font-medium text-faint uppercase tracking-wide mb-1">{tableRef} — blocked options</p>
                {blocked.map(o => (
                  <div key={o.value} className="text-xs text-warn leading-snug">{o.label}: {o.violationReason}</div>
                ))}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// ── Personal Home Simulate panel ──────────────────────────────────────────────

const DEFAULT_SEL: SelectionContext = {
  riskState: 'TX', covELimit: 300000, covFLimit: 1000, allPerilDed: 1000,
  windHailElected: false, windHailPct: 1, covA: 400000,
  rcElected: true, deviceCredit: 'none',
  waterBackupElected: false, sppElected: true,
  dayCareCoverage: false, otherStructuresInc: false,
  occupancy: 'PRIMARY_OWNER', companionPolicy: false,
}

const OCCUPANCY: { value: HoOccupancy; label: string }[] = [
  { value: 'PRIMARY_OWNER',   label: 'Owner-occupied primary' },
  { value: 'TENANT_NONOWNER', label: 'Tenant / non-owner' },
  { value: 'SEASONAL',        label: 'Seasonal' },
  { value: 'SECONDARY',       label: 'Secondary' },
]
const COVA   = [200000, 300000, 400000, 500000, 750000]
const COVE   = [100000, 300000, 500000]
const COVF   = [1000, 2000, 5000]
const DED    = [500, 1000, 2500, 5000]
const WHPCT  = [1, 2, 5]
const DEVICE = [{ v: 'none', l: 'None' }, { v: 'local', l: 'Local alarm' }, { v: 'central', l: 'Central station' }]

function PHSimulatePanel({ sel, onChange, result, coastal, states }: {
  sel: SelectionContext
  onChange: (p: Partial<SelectionContext>) => void
  result: RulesResult | null
  coastal: Set<string>
  states: readonly string[]
}) {
  const seasonal = sel.occupancy === 'SEASONAL' || sel.occupancy === 'SECONDARY'
  const checks: { key: keyof SelectionContext; label: string }[] = [
    { key: 'rcElected', label: 'Replacement Cost (HO 04 90)' },
    { key: 'sppElected', label: 'Scheduled Personal Property (HO 04 61)' },
    { key: 'waterBackupElected', label: 'Water Back-Up (HO 04 95)' },
    { key: 'otherStructuresInc', label: 'Other Structures increased (HO 04 48)' },
    { key: 'dayCareCoverage', label: 'Home day-care exclusion (HO 04 96)' },
  ]
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="flex flex-col gap-2.5">
        <p className="text-sm font-semibold text-text">Sample submission</p>

        <Row label="Occupancy">
          <select className={selectCls} value={sel.occupancy} onChange={e => onChange({ occupancy: e.target.value as HoOccupancy })}>
            {OCCUPANCY.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Row>
        {seasonal && (
          <div className="flex items-center gap-2 pl-[9.5rem]">
            <input type="checkbox" id="companion" checked={!!sel.companionPolicy} onChange={e => onChange({ companionPolicy: e.target.checked })} className="accent-accent" />
            <label htmlFor="companion" className="text-xs text-dim">Companion primary policy in force</label>
          </div>
        )}

        <Row label="Risk state">
          <select className={selectCls} value={sel.riskState} onChange={e => onChange({ riskState: e.target.value })}>
            {states.map(s => <option key={s}>{s}{coastal.has(s) ? ' · coastal' : ''}</option>)}
          </select>
        </Row>
        <Row label="Coverage A (dwelling)">
          <select className={selectCls} value={sel.covA} onChange={e => onChange({ covA: Number(e.target.value) })}>
            {COVA.map(v => <option key={v} value={v}>{usd(v)}</option>)}
          </select>
        </Row>
        <Row label="Coverage E limit">
          <select className={selectCls} value={sel.covELimit} onChange={e => onChange({ covELimit: Number(e.target.value) })}>
            {COVE.map(v => <option key={v} value={v}>{usd(v)}</option>)}
          </select>
        </Row>
        <Row label="Coverage F limit">
          <select className={selectCls} value={sel.covFLimit} onChange={e => onChange({ covFLimit: Number(e.target.value) })}>
            {COVF.map(v => <option key={v} value={v}>{usd(v)}</option>)}
          </select>
        </Row>
        <Row label="All-peril deductible">
          <select className={selectCls} value={sel.allPerilDed} onChange={e => onChange({ allPerilDed: Number(e.target.value) })}>
            {DED.map(v => <option key={v} value={v}>{usd(v)}</option>)}
          </select>
        </Row>
        <Row label="Protective device">
          <select className={selectCls} value={sel.deviceCredit} onChange={e => onChange({ deviceCredit: e.target.value })}>
            {DEVICE.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
          </select>
        </Row>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="windHail" checked={sel.windHailElected} onChange={e => onChange({ windHailElected: e.target.checked })} className="accent-accent" />
          <label htmlFor="windHail" className="text-xs text-dim">Wind/Hail % deductible ({coastal.has(sel.riskState) ? 'coastal ✓' : 'non-coastal'})</label>
          {sel.windHailElected && (
            <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs ml-auto" value={sel.windHailPct} onChange={e => onChange({ windHailPct: Number(e.target.value) })}>
              {WHPCT.map(v => <option key={v} value={v}>{v}%</option>)}
            </select>
          )}
        </div>

        {checks.map(({ key, label }) => (
          <div key={String(key)} className="flex items-center gap-2">
            <input type="checkbox" id={String(key)} checked={Boolean(sel[key])} onChange={e => onChange({ [key]: e.target.checked })} className="accent-accent" />
            <label htmlFor={String(key)} className="text-xs text-dim">{label}</label>
          </div>
        ))}
      </div>

      <EngineResultPanel result={result} />
    </div>
  )
}

// ── General Liability Simulate panel ─────────────────────────────────────────

const DEFAULT_GL_SEL: GLSelectionContext = {
  riskState:            'IL',
  classCode:            '41677',
  occLimit:             1000000,
  genAggregate:         2000000,
  occDeductible:        0,
  pcoElected:           false,
  pcoAggregate:         2000000,
  additionalInsuredReq: false,
}

const GL_OCC_LIMITS  = [{ label: '$100,000', value: 100000 }, { label: '$300,000', value: 300000 }, { label: '$500,000', value: 500000 }, { label: '$1,000,000', value: 1000000 }]
const GL_GEN_AGGS    = [{ label: '$200,000', value: 200000 }, { label: '$600,000', value: 600000 }, { label: '$1,000,000', value: 1000000 }, { label: '$2,000,000', value: 2000000 }]
const GL_PCO_AGGS    = GL_GEN_AGGS
const GL_DEDS        = [{ label: '$0 (none)', value: 0 }, { label: '$500', value: 500 }, { label: '$1,000', value: 1000 }, { label: '$2,500', value: 2500 }]
const GL_CLASS_CODES = [
  { label: '41677 — Contractors, Residential Remodeling', value: '41677' },
  { label: '11011 — Restaurants', value: '11011' },
  { label: '45191 — Retail Stores — NEC', value: '45191' },
  { label: '61110 — Office — Clerical', value: '61110' },
  { label: '16811 — Building Operations — NEC', value: '16811' },
]

function GLSimulatePanel({ sel, onChange, result, states }: {
  sel: GLSelectionContext
  onChange: (p: Partial<GLSelectionContext>) => void
  result: RulesResult | null
  states: readonly string[]
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="flex flex-col gap-2.5">
        <p className="text-sm font-semibold text-text">Sample submission</p>

        <Row label="Risk state">
          <select className={selectCls} value={sel.riskState} onChange={e => onChange({ riskState: e.target.value })}>
            {states.map(s => <option key={s}>{s}</option>)}
          </select>
        </Row>

        <Row label="Class code">
          <select className={selectCls} value={sel.classCode} onChange={e => onChange({ classCode: e.target.value })}>
            {GL_CLASS_CODES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Row>

        <Row label="Per-occurrence limit">
          <select className={selectCls} value={sel.occLimit} onChange={e => onChange({ occLimit: Number(e.target.value) })}>
            {GL_OCC_LIMITS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Row>

        <Row label="General aggregate">
          <select className={selectCls} value={sel.genAggregate} onChange={e => onChange({ genAggregate: Number(e.target.value) })}>
            {GL_GEN_AGGS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Row>

        <Row label="BI/PD deductible">
          <select className={selectCls} value={sel.occDeductible} onChange={e => onChange({ occDeductible: Number(e.target.value) })}>
            {GL_DEDS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Row>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="gl-pco" checked={sel.pcoElected} onChange={e => onChange({ pcoElected: e.target.checked })} className="accent-accent" />
          <label htmlFor="gl-pco" className="text-xs text-dim">Products-Completed-Operations (CG 20 33)</label>
        </div>

        {sel.pcoElected && (
          <Row label="PCO aggregate">
            <select className={selectCls} value={sel.pcoAggregate ?? 2000000} onChange={e => onChange({ pcoAggregate: Number(e.target.value) })}>
              {GL_PCO_AGGS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Row>
        )}

        <div className="flex items-center gap-2">
          <input type="checkbox" id="gl-ai" checked={sel.additionalInsuredReq} onChange={e => onChange({ additionalInsuredReq: e.target.checked })} className="accent-accent" />
          <label htmlFor="gl-ai" className="text-xs text-dim">Additional insured required by contract (CG 20 10)</label>
        </div>
      </div>

      <EngineResultPanel result={result} />
    </div>
  )
}

// ── Personal Auto Simulate panel ──────────────────────────────────────────────

const DEFAULT_PA_SEL: PASelectionContext = {
  riskState:        'OH',
  vehicleUse:       'personal',
  biLimit:          100000,
  pdLimit:          100000,
  medPayElected:    true,
  medPayLimit:      5000,
  umElected:        true,
  umLimit:          100000,
  collisionElected: true,
  collisionDed:     500,
  compElected:      true,
  compDed:          250,
  rentalElected:    false,
  towingElected:    false,
  loanLeaseGapElected: false,
  namedNonOwner:    false,
}

const PA_BI_LIMITS  = [{ label: '25/50', value: 25000 }, { label: '50/100', value: 50000 }, { label: '100/300', value: 100000 }, { label: '250/500', value: 250000 }]
const PA_PD_LIMITS  = [{ label: '$25,000', value: 25000 }, { label: '$50,000', value: 50000 }, { label: '$100,000', value: 100000 }, { label: '$300,000', value: 300000 }]
const PA_UM_LIMITS  = PA_BI_LIMITS  // same scale as BI
const PA_COLL_DEDS  = [{ label: '$100', value: 100 }, { label: '$250', value: 250 }, { label: '$500', value: 500 }, { label: '$1,000', value: 1000 }]
const PA_COMP_DEDS  = PA_COLL_DEDS

function PASimulatePanel({ sel, onChange, result, states }: {
  sel: PASelectionContext
  onChange: (p: Partial<PASelectionContext>) => void
  result: RulesResult | null
  states: readonly string[]
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="flex flex-col gap-2.5">
        <p className="text-sm font-semibold text-text">Sample submission</p>

        <Row label="Vehicle use">
          <select className={selectCls} value={sel.vehicleUse} onChange={e => onChange({ vehicleUse: e.target.value as PaVehicleUse })}>
            <option value="personal">Personal use</option>
            <option value="commercial">Commercial use</option>
          </select>
        </Row>

        <Row label="Risk state">
          <select className={selectCls} value={sel.riskState} onChange={e => onChange({ riskState: e.target.value })}>
            {states.map(s => <option key={s}>{s}</option>)}
          </select>
        </Row>

        <Row label="BI limit (per person)">
          <select className={selectCls} value={sel.biLimit} onChange={e => onChange({ biLimit: Number(e.target.value) })}>
            {PA_BI_LIMITS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Row>

        <Row label="PD limit">
          <select className={selectCls} value={sel.pdLimit} onChange={e => onChange({ pdLimit: Number(e.target.value) })}>
            {PA_PD_LIMITS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Row>

        {/* Part B — Medical Payments */}
        <div className="flex items-center gap-2">
          <input type="checkbox" id="pa-medPay" checked={sel.medPayElected} onChange={e => onChange({ medPayElected: e.target.checked })} className="accent-accent" />
          <label htmlFor="pa-medPay" className="text-xs text-dim flex-1">Medical Payments (Part B)</label>
        </div>

        {/* Part C — UM/UIM */}
        <div className="flex items-center gap-2">
          <input type="checkbox" id="pa-um" checked={sel.umElected} onChange={e => onChange({ umElected: e.target.checked })} className="accent-accent" />
          <label htmlFor="pa-um" className="text-xs text-dim">UM/UIM (Part C)</label>
          {sel.umElected && (
            <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs ml-auto" value={sel.umLimit} onChange={e => onChange({ umLimit: Number(e.target.value) })}>
              {PA_UM_LIMITS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>

        {/* Part D — Physical Damage */}
        <div className="flex items-center gap-2">
          <input type="checkbox" id="pa-collision" checked={sel.collisionElected} onChange={e => onChange({ collisionElected: e.target.checked })} className="accent-accent" />
          <label htmlFor="pa-collision" className="text-xs text-dim">Collision (Part D)</label>
          {sel.collisionElected && (
            <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs ml-auto" value={sel.collisionDed} onChange={e => onChange({ collisionDed: Number(e.target.value) })}>
              {PA_COLL_DEDS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="pa-comp" checked={sel.compElected} onChange={e => onChange({ compElected: e.target.checked })} className="accent-accent" />
          <label htmlFor="pa-comp" className="text-xs text-dim">Comprehensive (Part D)</label>
          {sel.compElected && (
            <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs ml-auto" value={sel.compDed} onChange={e => onChange({ compDed: Number(e.target.value) })}>
              {PA_COMP_DEDS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>

        {/* Optional endorsements */}
        {([
          { key: 'rentalElected',       label: 'Rental Reimbursement (PP 13 01)' },
          { key: 'towingElected',        label: 'Towing and Labor (PP 03 28)' },
          { key: 'loanLeaseGapElected',  label: 'Loan/Lease Gap (PP 04 46)' },
          { key: 'namedNonOwner',        label: 'Named Non-Owner (PP 03 01)' },
        ] as { key: keyof PASelectionContext; label: string }[]).map(({ key, label }) => (
          <div key={String(key)} className="flex items-center gap-2">
            <input type="checkbox" id={`pa-${String(key)}`} checked={Boolean(sel[key])} onChange={e => onChange({ [key]: e.target.checked })} className="accent-accent" />
            <label htmlFor={`pa-${String(key)}`} className="text-xs text-dim">{label}</label>
          </div>
        ))}
      </div>

      <EngineResultPanel result={result} />
    </div>
  )
}

// ── Main route ────────────────────────────────────────────────────────────────

export default function ProductRules() {
  const ctx = useProductCtx()
  const { pid, product, rules, formRules, coverages, forms, ldTables, loading } = ctx
  const lob = resolveLob(product)
  const lobPrefix = lob.prefix   // refId prefix is line-driven (PH, PA…)
  // The Simulate panel runs the line's rules engine; only lines whose LOB definition
  // sets supportsRulesSimulation:true have an evaluateRules() implementation.
  const canSimulate = lob.supportsRulesSimulation
  const coastal = useMemo(() => new Set<string>(lob.peril.eligibleStates), [lob])
  const { user } = useUser()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const canEdit  = canI(user, 'product:write')
  const [simOpen, setSimOpen] = useState(false)
  // PH selection state
  const [sel,   setSel]   = useState<SelectionContext>(DEFAULT_SEL)
  // PA selection state (kept separate; only one is active at a time based on lob)
  const [paSel, setPaSel] = useState<PASelectionContext>(DEFAULT_PA_SEL)
  // GL selection state
  const [glSel, setGlSel] = useState<GLSelectionContext>(DEFAULT_GL_SEL)
  const [composerOpen, setComposerOpen] = useState(false)
  const [editing, setEditing] = useState<WithId<Rule> | null>(null)

  const result = useMemo<RulesResult | null>(() => {
    if (!canSimulate || !Object.keys(ldTables).length) return null
    if (lob.prefix === 'PA') return evaluateRules({ ldTables, lob: 'PA', selection: paSel })
    if (lob.prefix === 'GL') return evaluateRules({ ldTables, lob: 'GL', selection: glSel })
    return evaluateRules({ ldTables, selection: sel })
  }, [canSimulate, ldTables, sel, paSel, glSel, lob.prefix])

  const simActive = simOpen && canSimulate && !!result
  const simFor = (r: RuleLike) => (simActive ? simulateRule(r, result!) : undefined)

  // Coverage deep link from its Rules tile (…/rules?cov=<refId>) — show only rules
  // that govern that coverage, with a clearable chip.
  const covFilter = coverages.find(c => c.refId === params.get('cov') || c.id === params.get('cov'))
  const covRef = covFilter?.refId ?? null

  // The generic filter engine, driven by the Rules facet schema. The coverage deep-link
  // scopes the entity set first, so facet counts reflect the coverage-scoped view.
  const entities = useMemo(() => (covRef ? rules.filter(r => r.coverageRefIds?.includes(covRef)) : rules), [rules, covRef])
  const filters = useEntityFilters(entities, rulesSchema)

  // Announce reconciliation (e.g. deselecting a category dropped orphaned sub-categories).
  useEffect(() => {
    const n = filters.reconciliation.dropped.length
    if (n) toast.info(`Adjusted ${n} filter${n === 1 ? '' : 's'} that no longer applied`)
  }, [filters.reconciliation])

  // Deep-link helpers so a rule links to the coverages / forms it governs.
  const openCoverage = (refId: string) => {
    const c = coverages.find(x => x.refId === refId)
    navigate(`/app/products/${pid}/coverages?cov=${c?.id ?? refId}`)
  }
  const openForm = (num: string) => navigate(`/app/products/${pid}/forms?form=${encodeURIComponent(num)}`)

  const actor = user ? { uid: user.uid, name: user.name ?? user.email ?? 'User' } : null

  function openComposer(rule?: WithId<Rule>) {
    setEditing(rule ?? null)
    setComposerOpen(true)
  }

  async function persist(nr: NewRule, mode: 'create' | 'edit') {
    if (!actor) return
    // Final grounding guard: no reference reaches mutate() unless it resolves to a real
    // entity on THIS product. This holds regardless of how the draft was produced — the
    // server verifies the AI path, and this re-checks the manually-edited path too.
    const validCov = new Set(coverages.map(c => c.refId).filter(Boolean) as string[])
    const validForm = new Set(forms.map(f => f.number))
    const coverageRefIds = (nr.coverageRefIds ?? []).filter(r => validCov.has(r))
    const formNumbers    = (nr.formNumbers ?? []).filter(f => validForm.has(f))
    const ldTableRef     = nr.ldTableRef && ldTables[nr.ldTableRef] ? nr.ldTableRef : undefined
    try {
      if (mode === 'edit' && editing) {
        await adapter.db.mutate({
          op: 'update', path: `products/${pid}/rules/${editing.id}`,
          data: {
            category: nr.category, subCategory: nr.subCategory, condition: nr.condition, outcome: nr.outcome,
            coverageRefIds, formNumbers, ldTableRef: ldTableRef ?? null,
          },
          entityType: 'rule', productId: pid, actor, expectedRev: editing.rev,
        })
        toast.success('Rule updated')
      } else {
        const ruleRe = new RegExp(`^${lobPrefix}\\.RU\\.(\\d+)`)
        const next = Math.max(10, ...rules.map(r => Number(ruleRe.exec(r.refId ?? '')?.[1] ?? 0))) + 1
        const refId = `${lobPrefix}.RU.${String(next).padStart(3, '0')}`
        await adapter.db.mutate({
          op: 'create', path: `products/${pid}/rules/${crypto.randomUUID()}`,
          data: {
            category: nr.category, subCategory: nr.subCategory, condition: nr.condition, outcome: nr.outcome,
            coverageRefIds, formNumbers,
            ...(ldTableRef ? { ldTableRef } : {}),   // omit when absent — Firestore rejects undefined
            refId, allStates: true, states: [], status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
          entityType: 'rule', productId: pid, actor,
        })
        toast.success('Rule created')
      }
      setComposerOpen(false); setEditing(null)
    } catch (err) {
      if (err instanceof MutationConflictError) {
        conflictToast({ discard: () => { setComposerOpen(false); setEditing(null) } })
      } else {
        toast.error('Could not save rule.')
      }
    }
  }

  // Group the engine's filtered results by category → sub-category (raw seed labels),
  // preserving order within each bucket. The facet counts use the canonical taxonomy;
  // the section headers show the source sub-category the rule actually carries.
  const grouped = useMemo(() => {
    const byCat: Record<string, Record<string, WithId<Rule>[]>> = {}
    for (const rule of filters.results) {
      const cat = rule.category ?? 'PRODUCT'
      const sub = rule.subCategory || 'Other'
      ;(byCat[cat] ??= {})[sub] ??= []
      byCat[cat]![sub]!.push(rule)
    }
    return byCat
  }, [filters.results])

  const orderedCats = CAT_ORDER.filter(c => grouped[c])

  const covOptions = useMemo(
    () => coverages.filter(c => c.refId).map(c => ({ refId: c.refId as string, name: c.name })),
    [coverages],
  )
  const formOptions = useMemo(() => forms.map(f => f.number), [forms])

  if (loading && rules.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {[1,2,3,4].map(i => (
          <div key={i} className="bg-surface rounded-[12px] p-4 flex items-start gap-3" style={{ border: '1px solid var(--color-border)' }}>
            <Skeleton className="w-5 h-5 rounded shrink-0 mt-0.5" />
            <div className="flex-1 flex flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {covFilter && (
        <div className="flex items-center gap-2 self-start pl-3 pr-1.5 py-1.5 rounded-[9px] bg-accent-soft text-sm">
          <span className="text-dim">Rules governing</span>
          <span className="font-medium text-accent">{covFilter.name}</span>
          <button onClick={() => { const p = new URLSearchParams(params); p.delete('cov'); setParams(p, { replace: true }) }}
            aria-label="Clear coverage filter" className="w-6 h-6 rounded-[6px] flex items-center justify-center text-accent hover:bg-surface transition-colors"><IconClose size={14} /></button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px] max-w-xl">
          <CommandBar schema={rulesSchema} state={filters.state} applyState={filters.applyState}
            placeholder="Search rules, or filter: category:Product status:Active" />
        </div>
        <SavedViews scope={`rules:${pid}`} state={filters.state} onApply={filters.applyState} />
        <div className="flex items-center gap-2 ml-auto">
          {canSimulate && (
            <Button variant="ghost" size="sm" onClick={() => setSimOpen(s => !s)} aria-pressed={simOpen}>
              {simOpen ? 'Hide simulate' : 'Simulate…'}
            </Button>
          )}
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => (composerOpen ? (setComposerOpen(false), setEditing(null)) : openComposer())}>
              <IconPlus size={14} />New rule
            </Button>
          )}
        </div>
      </div>

      <ActiveFilters chips={filters.activeChips} onRemove={filters.removeChip} onClearAll={filters.clearAll}
        resultCount={filters.results.length} total={filters.total} />

      {composerOpen && canEdit && (
        <RuleComposer
          productId={pid} lobPrefix={lobPrefix}
          coverages={covOptions} forms={formOptions}
          existingRule={editing ? {
            id: editing.id, refId: editing.refId, category: editing.category, subCategory: editing.subCategory,
            condition: editing.condition, outcome: editing.outcome, ldTableRef: editing.ldTableRef,
            coverageRefIds: editing.coverageRefIds, formNumbers: editing.formNumbers,
          } : undefined}
          onSubmit={persist}
          onCancel={() => { setComposerOpen(false); setEditing(null) }}
        />
      )}

      {simOpen && canSimulate && (
        <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
          <p className="text-sm font-semibold text-text mb-1">Simulate — run the shared rules engine against a sample submission</p>
          <p className="text-xs text-faint mb-4">Every card below shows its own live outcome from this same engine run.</p>
          {lob.prefix === 'PA'
            ? <PASimulatePanel sel={paSel} onChange={p => setPaSel(prev => ({ ...prev, ...p }))} result={result} states={lob.footprintStates} />
            : lob.prefix === 'GL'
            ? <GLSimulatePanel sel={glSel} onChange={p => setGlSel(prev => ({ ...prev, ...p }))} result={result} states={lob.footprintStates} />
            : <PHSimulatePanel sel={sel} onChange={p => setSel(prev => ({ ...prev, ...p }))} result={result} coastal={coastal} states={lob.footprintStates} />
          }
        </div>
      )}

      {!canSimulate && (
        <p className="text-xs text-faint">The {lob.name} line documents its rules here; live simulation is available on lines with a rating/rules engine.</p>
      )}

      <div className="grid lg:grid-cols-[236px_1fr] gap-5 items-start">
        <div className="lg:sticky lg:top-4">
          <FacetPanel schema={rulesSchema} counts={filters.counts} state={filters.state}
            unknownValues={filters.unknownValues}
            onToggleEnum={filters.toggleEnum} onToggleParent={filters.toggleParent}
            onToggleChild={filters.toggleChild} onSetDateRange={filters.setDateRange} />
        </div>

        <div className="flex flex-col gap-5 min-w-0">
      {/* Product / rating rules — IF → THEN flows grouped by category → sub-category */}
      {orderedCats.map(cat => {
        const subs = grouped[cat]!
        const count = Object.values(subs).reduce((n, arr) => n + arr.length, 0)
        return (
          <div key={cat} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge label={cat} color={CAT_COLOR[cat as RuleCategory] ?? 'default'} />
              <span className="text-xs text-faint">{count} rule{count !== 1 ? 's' : ''}</span>
            </div>
            {Object.entries(subs).map(([sub, subRules]) => (
              <div key={sub} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 pl-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-dim">{sub}</span>
                  <span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
                  <span className="text-[11px] text-faint">{subRules.length}</span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                  {subRules.map(rule => (
                    <RuleFlowCard key={rule.id} rule={rule} sim={simFor(rule)}
                      onOpenCoverage={openCoverage} onOpenForm={openForm}
                      onEdit={canEdit ? () => openComposer(rule) : undefined} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      })}

      {/* Form-attachment rules — the default browse view only (hidden under a coverage
          scope or any active filter, since they are a separate collection from the
          facet-filtered rules). */}
      {!covRef && !filters.hasActiveFilters && formRules.length > 0 && (() => {
        const mandatory = formRules.filter(f => f.mandatory)
        const optional  = formRules.filter(f => !f.mandatory)
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge label="FORM ATTACHMENT" color="warn" />
              <span className="text-xs text-faint">{formRules.length} rule{formRules.length !== 1 ? 's' : ''}</span>
            </div>
            {([['Mandatory', mandatory], ['Optional', optional]] as const).map(([label, list]) => list.length === 0 ? null : (
              <div key={label} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 pl-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-dim">{label}</span>
                  <span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
                  <span className="text-[11px] text-faint">{list.length}</span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                  {list.map(fr => {
                    const asRule: RuleLike = { id: fr.id, refId: fr.refId, category: 'FORMS', subCategory: fr.mandatory ? 'Mandatory' : 'Optional', condition: fr.condition, outcome: fr.outcome, formNumbers: fr.formNumbers }
                    return <RuleFlowCard key={fr.id} rule={asRule} sim={simFor(asRule)} onOpenForm={openForm} />
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {orderedCats.length === 0 && (
        <EmptyState
          title={covRef ? `No rules governing ${covFilter?.name}` : filters.hasActiveFilters ? 'No rules match these filters' : 'No rules yet'}
          description={
            covRef || filters.hasActiveFilters ? undefined
              : canEdit ? 'Draft the first rule with AI, or write one manually — every reference is verified against this product.'
              : 'Rules will appear here once the product is seeded or an editor drafts one.'}
          action={canEdit && !covRef && !filters.hasActiveFilters
            ? <Button variant="primary" size="sm" onClick={() => openComposer()}><IconPlus size={14} />Draft rule</Button>
            : undefined}
          compact />
      )}
        </div>
      </div>
    </div>
  )
}
