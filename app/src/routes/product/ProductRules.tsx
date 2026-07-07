// Rules tab — grouped product rules + live Simulate panel (form attachment + violations).
import { useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { evaluateRules } from '@pf/shared'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Badge, Skeleton, EmptyState } from '../../components/ui'
import { IconPlus, IconClose, IconCheckCircle, IconWarning, IconAlertCircle } from '../../components/ui/icons'
import { Button } from '../../components/ui/Button'
import { RuleFlowCard, RuleComposer, type NewRule } from '../../components/product/RuleBuilder'
import type { RuleCategory, SelectionContext } from '@pf/shared'
import { resolveLob } from '@pf/shared'

const CAT_COLOR: Record<RuleCategory, 'purple'|'blue'|'warn'> = { PRODUCT: 'purple', RATING: 'blue', FORMS: 'warn' }

// ─── Simulate panel ───────────────────────────────────────────────────────────

const DEFAULT_SEL: SelectionContext = {
  riskState: 'TX', covELimit: 300000, covFLimit: 1000, allPerilDed: 1000,
  windHailElected: false, covA: 400000,
  rcElected: true, deviceCredit: 'none',
  waterBackupElected: false, sppElected: true,
  dayCareCoverage: false, otherStructuresInc: false,
}

function SimulatePanel() {
  const { product, ldTables } = useProductCtx()
  const coastal = new Set<string>(resolveLob(product).peril.eligibleStates)
  const [sel, setSel] = useState<SelectionContext>(DEFAULT_SEL)
  const upd = (p: Partial<SelectionContext>) => setSel(prev => ({ ...prev, ...p }))

  const result = useMemo(() => {
    if (!Object.keys(ldTables).length) return null
    return evaluateRules({ ldTables, selection: sel })
  }, [ldTables, sel])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Inputs */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">Simulate selections</p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-dim w-36">Risk state</span>
            <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs flex-1"
              value={sel.riskState} onChange={e => upd({ riskState: e.target.value })}>
              {['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-dim w-36">Coverage E limit</span>
            <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs flex-1"
              value={sel.covELimit} onChange={e => upd({ covELimit: Number(e.target.value) })}>
              {[{l:'$100k',v:100000},{l:'$300k',v:300000},{l:'$500k',v:500000}].map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-dim w-36">Coverage F limit</span>
            <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs flex-1"
              value={sel.covFLimit} onChange={e => upd({ covFLimit: Number(e.target.value) })}>
              {[{l:'$1k',v:1000},{l:'$2k',v:2000},{l:'$5k',v:5000}].map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          {[
            { key: 'rcElected' as const, label: 'Replacement Cost (HO 04 90)' },
            { key: 'sppElected' as const, label: 'Scheduled Personal Property (HO 04 61)' },
            { key: 'waterBackupElected' as const, label: 'Water Back-Up (HO 04 95)' },
            { key: 'windHailElected' as const, label: `Wind/Hail % deductible (${coastal.has(sel.riskState) ? 'coastal ✓' : 'non-coastal'})` },
            { key: 'dayCareCoverage' as const, label: 'Home day-care exclusion (HO 04 96)' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <input type="checkbox" id={key} checked={Boolean(sel[key])}
                onChange={e => upd({ [key]: e.target.checked })} className="accent-accent" />
              <label htmlFor={key} className="text-xs text-dim">{label}</label>
            </div>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">Result</p>
        {!result ? <Skeleton className="h-32" /> : (
          <>
            {/* Violations */}
            {result.violations.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-faint uppercase tracking-wide">Violations</p>
                {result.violations.map((v, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-[8px] bg-[rgba(220,38,38,.06)] text-sm">
                    <IconAlertCircle size={14} className="text-danger shrink-0 mt-0.5" />
                    <span className="text-danger text-xs">{v.message} <span className="font-mono">[{v.ruleRefId}]</span></span>
                  </div>
                ))}
              </div>
            )}
            {result.violations.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-good">
                <IconCheckCircle size={14} />No violations
              </div>
            )}

            {/* Forms that attach */}
            <div>
              <p className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Forms that attach</p>
              <div className="flex flex-wrap gap-1.5">
                {result.formsThatAttach.map(fn => <Badge key={fn} label={fn} color="blue" mono />)}
              </div>
            </div>

            {/* Available options summary */}
            {Object.entries(result.availableOptions).map(([tableRef, opts]) => {
              const blocked = opts.filter(o => !o.available)
              if (!blocked.length) return null
              return (
                <div key={tableRef}>
                  <p className="text-xs font-medium text-faint uppercase tracking-wide mb-1">{tableRef} constraints</p>
                  {blocked.map(o => (
                    <div key={o.value} className="flex items-center gap-2 text-xs text-warn">
                      <IconWarning size={10} />{o.label}: {o.violationReason}
                    </div>
                  ))}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main route ───────────────────────────────────────────────────────────────

export default function ProductRules() {
  const ctx = useProductCtx()
  const { pid, product, rules, formRules, coverages, loading } = ctx
  const lob = resolveLob(product)
  const lobPrefix = lob.prefix   // refId prefix is line-driven (HO, GL…)
  // The Simulate panel runs the line's rules engine; only lines whose LOB definition
  // sets supportsRulesSimulation:true have an evaluateRules() implementation.
  const canSimulate = lob.supportsRulesSimulation
  const { user } = useUser()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const canEdit  = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const [query,  setQuery]  = useState('')
  const [simOpen, setSimOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)

  // Coverage deep link from its Rules tile (…/rules?cov=<refId>) — show only rules
  // that govern that coverage, with a clearable chip.
  const covFilter = coverages.find(c => c.refId === params.get('cov') || c.id === params.get('cov'))
  const covRef = covFilter?.refId ?? null

  // Deep-link helpers so a rule links to the coverages / forms it governs.
  const openCoverage = (refId: string) => {
    const c = coverages.find(x => x.refId === refId)
    navigate(`/app/products/${pid}/coverages?cov=${c?.id ?? refId}`)
  }
  const openForm = (num: string) => navigate(`/app/products/${pid}/forms?form=${encodeURIComponent(num)}`)

  async function createRule(nr: NewRule) {
    if (!user) return
    const ruleRe = new RegExp(`^${lobPrefix}\\.RU\\.(\\d+)`)
    const next = Math.max(10, ...rules.map(r => Number(ruleRe.exec(r.refId ?? '')?.[1] ?? 0))) + 1
    const refId = `${lobPrefix}.RU.${String(next).padStart(3, '0')}`
    try {
      await adapter.db.mutate({
        op: 'create', path: `products/${pid}/rules/${crypto.randomUUID()}`,
        data: { ...nr, refId, allStates: true, states: [], status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED' },
        entityType: 'rule', productId: pid, actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
      })
      toast.success(`Rule ${refId} created`)
      setComposerOpen(false)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Could not create rule.')
    }
  }

  const grouped = useMemo(() => {
    let filtered = query ? rules.filter(r => `${r.refId} ${r.condition} ${r.outcome}`.toLowerCase().includes(query.toLowerCase())) : rules
    if (covRef) filtered = filtered.filter(r => r.coverageRefIds?.includes(covRef))
    const map: Record<string, typeof filtered> = {}
    for (const rule of filtered) {
      const cat = rule.category ?? 'PRODUCT'
      if (!map[cat]) map[cat] = []
      map[cat]!.push(rule)
    }
    return map
  }, [rules, query, covRef])

  if (loading) return <Skeleton className="h-64 rounded-[14px]" />

  return (
    <div className="flex flex-col gap-5">
      {covFilter && (
        <div className="flex items-center gap-2 self-start pl-3 pr-1.5 py-1.5 rounded-[9px] bg-accent-soft text-sm">
          <span className="text-dim">Rules governing</span>
          <span className="font-medium text-accent">{covFilter.name}</span>
          <button onClick={() => { const p = new URLSearchParams(params); p.delete('cov'); setParams(p, { replace: true }) }}
            aria-label="Clear coverage filter" className="w-6 h-6 rounded-[6px] flex items-center justify-center text-accent hover:bg-surface transition-colors"><IconClose size={14} /></button>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <input className="flex-1 max-w-sm h-8 px-3 rounded-[8px] bg-surface border border-border-strong text-sm placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
          placeholder="Search rules..." value={query} onChange={e => setQuery(e.target.value)} />
        <div className="flex items-center gap-2 ml-auto">
          {canSimulate && (
            <Button variant="ghost" size="sm" onClick={() => setSimOpen(s => !s)}>
              {simOpen ? 'Hide simulate' : 'Simulate…'}
            </Button>
          )}
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => setComposerOpen(o => !o)}>
              <IconPlus size={14} />New rule
            </Button>
          )}
        </div>
      </div>

      {composerOpen && canEdit && (
        <RuleComposer forms={ctx.forms.map(f => f.number)} onCreate={createRule} onCancel={() => setComposerOpen(false)} />
      )}

      {simOpen && canSimulate && (
        <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
          <p className="text-sm font-semibold text-text mb-4">Simulate panel — enter selections to see which forms attach and what violations fire</p>
          <SimulatePanel />
        </div>
      )}

      {/* Product rules — rendered as logical IF → THEN flows */}
      {Object.entries(grouped).map(([cat, catRules]) => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-2">
            <Badge label={cat} color={CAT_COLOR[cat as RuleCategory] ?? 'default'} />
            <span className="text-xs text-faint">{catRules.length} rule{catRules.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
            {catRules.map(rule => (
              <RuleFlowCard key={rule.id} rule={rule} onOpenCoverage={openCoverage} onOpenForm={openForm} />
            ))}
          </div>
        </div>
      ))}

      {/* Form attachment rules (hidden when scoped to a single coverage) */}
      {!covRef && formRules.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge label="FORM ATTACHMENT" color="warn" />
            <span className="text-xs text-faint">{formRules.length} rule{formRules.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
            {formRules.map(fr => (
              <RuleFlowCard key={fr.id}
                rule={{ id: fr.id, refId: fr.refId, category: 'FORMS', subCategory: fr.mandatory ? 'Mandatory' : undefined, condition: fr.condition, outcome: fr.outcome, formNumbers: fr.formNumbers }}
                onOpenForm={openForm} />
            ))}
          </div>
        </div>
      )}

      {Object.keys(grouped).length === 0 && (covRef || !formRules.length) && (
        <EmptyState
          title={covRef ? `No rules governing ${covFilter?.name}` : 'No rules'}
          description={covRef ? undefined : 'Rules will appear here once the product is seeded.'} compact />
      )}
    </div>
  )
}
