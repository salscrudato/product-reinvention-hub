// Rules tab — grouped product rules + live Simulate panel (form attachment + violations).
import { useState, useMemo } from 'react'
import { CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react'
import { evaluateRules } from '@pf/shared'
import { useProductCtx } from '../../context/useProductCtx'
import { Badge, Skeleton, EmptyState } from '../../components/ui'
import { Button } from '../../components/ui/Button'
import type { RuleCategory, SelectionContext } from '@pf/shared'
import { HO3_COASTAL_STATES } from '@pf/shared'

const COASTAL = new Set<string>(HO3_COASTAL_STATES)
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
  const { ldTables } = useProductCtx()
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
            { key: 'windHailElected' as const, label: `Wind/Hail % deductible (${COASTAL.has(sel.riskState) ? 'coastal ✓' : 'non-coastal'})` },
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
                    <AlertCircle size={14} className="text-danger shrink-0 mt-0.5" />
                    <span className="text-danger text-xs">{v.message} <span className="font-mono">[{v.ruleRefId}]</span></span>
                  </div>
                ))}
              </div>
            )}
            {result.violations.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-good">
                <CheckCircle size={14} />No violations
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
                      <AlertTriangle size={10} />{o.label}: {o.violationReason}
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
  const rules = ctx.rules
  const formRules = ctx.formRules
  const loading = ctx.loading
  const [query,  setQuery]  = useState('')
  const [simOpen, setSimOpen] = useState(false)

  const grouped = useMemo(() => {
    const filtered = query ? rules.filter(r => `${r.refId} ${r.condition} ${r.outcome}`.toLowerCase().includes(query.toLowerCase())) : rules
    const map: Record<string, typeof filtered> = {}
    for (const rule of filtered) {
      const cat = rule.category ?? 'PRODUCT'
      if (!map[cat]) map[cat] = []
      map[cat]!.push(rule)
    }
    return map
  }, [rules, query])

  if (loading) return <Skeleton className="h-64 rounded-[14px]" />

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <input className="flex-1 max-w-sm h-8 px-3 rounded-[8px] bg-surface border border-border-strong text-sm placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
          placeholder="Search rules..." value={query} onChange={e => setQuery(e.target.value)} />
        <Button variant="primary" size="sm" onClick={() => setSimOpen(s => !s)}>
          {simOpen ? 'Hide simulate' : 'Simulate...'}
        </Button>
      </div>

      {simOpen && (
        <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
          <p className="text-sm font-semibold text-text mb-4">Simulate panel — enter selections to see which forms attach and what violations fire</p>
          <SimulatePanel />
        </div>
      )}

      {/* Product rules */}
      {Object.entries(grouped).map(([cat, catRules]) => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-2">
            <Badge label={cat} color={CAT_COLOR[cat as RuleCategory] ?? 'default'} />
            <span className="text-xs text-faint">{catRules.length} rule{catRules.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex flex-col gap-2">
            {catRules.map(rule => (
              <div key={rule.id} className="bg-surface rounded-[12px] px-4 py-3" style={{ border: '1px solid var(--color-border)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 flex-1">
                    <div className="flex items-center gap-2">
                      {rule.refId && <span className="text-xs font-mono text-accent">{rule.refId}</span>}
                      {rule.ldTableRef && <Badge label={rule.ldTableRef} color="blue" mono />}
                    </div>
                    <p className="text-sm text-text"><span className="text-dim">If</span> {rule.condition}</p>
                    <p className="text-sm text-text"><span className="text-dim">Then</span> {rule.outcome}</p>
                    {rule.formNumbers?.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1">
                        {rule.formNumbers.map(fn => <Badge key={fn} label={fn} color="default" mono />)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Form attachment rules */}
      {formRules.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge label="FORM ATTACHMENT" color="warn" />
            <span className="text-xs text-faint">{formRules.length} rule{formRules.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex flex-col gap-2">
            {formRules.map(fr => (
              <div key={fr.id} className="bg-surface rounded-[12px] px-4 py-3" style={{ border: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-2 mb-1">
                  {fr.refId && <span className="text-xs font-mono text-accent">{fr.refId}</span>}
                  {fr.mandatory && <Badge label="Mandatory" color="purple" />}
                </div>
                <p className="text-sm text-text"><span className="text-dim">If</span> {fr.condition}</p>
                <p className="text-sm text-text"><span className="text-dim">Then</span> {fr.outcome}</p>
                <div className="flex gap-1 flex-wrap mt-1">
                  {fr.formNumbers?.map(fn => <Badge key={fn} label={fn} color="blue" mono />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!rules.length && !formRules.length && (
        <EmptyState title="No rules" description="Rules will appear here once the product is seeded." compact />
      )}
    </div>
  )
}
