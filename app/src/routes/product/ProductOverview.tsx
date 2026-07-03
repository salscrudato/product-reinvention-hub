// Overview — the product read at a glance: coverages presented as a logically
// organized collection (ISO Section I / II), plus a health panel and quick stats.
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react'
import { useProductCtx } from '../../context/useProductCtx'
import { Card, Skeleton } from '../../components/ui'
import { CoverageCollection } from '../../components/product/CoverageCollection'

// ─── Health panel ─────────────────────────────────────────────────────────────

function HealthPanel({ navigate: nav }: { navigate: ReturnType<typeof useNavigate> }) {
  const { pid, coverages, rules, ratingProgram, ldTables, rtTables, formRules } = useProductCtx()
  const findings: Array<{ severity: 'error'|'warning'; message: string; route: string }> = []

  coverages.forEach(cov => {
    if (cov.premiumGenerating && !cov.terms?.length) {
      findings.push({ severity: 'warning', message: `${cov.name} has no terms defined`, route: `/app/products/${pid}/coverages` })
    }
  })
  rules.forEach(rule => {
    if (rule.ldTableRef && !ldTables[rule.ldTableRef]) {
      findings.push({ severity: 'error', message: `Rule ${rule.refId} references missing LD table ${rule.ldTableRef}`, route: `/app/products/${pid}/rules` })
    }
  })
  ratingProgram?.steps?.forEach(step => {
    if (step.source.type === 'RT' && step.source.ref && !rtTables[step.source.ref]) {
      findings.push({ severity: 'error', message: `Rating step "${step.label}" references missing RT table ${step.source.ref}`, route: `/app/products/${pid}/pricing` })
    }
  })
  coverages.filter(c => c.requirement === 'OPTIONAL').forEach(cov => {
    const hasRule = formRules.some(fr => fr.formNumbers?.some(fn => cov.formNumbers?.includes(fn)))
    if (!hasRule && cov.formNumbers?.length) {
      findings.push({ severity: 'warning', message: `${cov.name} has no form attachment rule`, route: `/app/products/${pid}/forms` })
    }
  })
  coverages.forEach(cov => {
    if (!cov.allStates && (!cov.states || cov.states.length === 0)) {
      findings.push({ severity: 'warning', message: `${cov.name} has no states configured`, route: `/app/products/${pid}/states` })
    }
  })

  const score = findings.length === 0 ? 100 : Math.max(0, 100 - findings.filter(f => f.severity === 'error').length * 20 - findings.filter(f => f.severity === 'warning').length * 5)
  const scoreColor = score >= 80 ? 'var(--color-good)' : score >= 60 ? 'var(--color-warn)' : 'var(--color-danger)'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold tnum border-2"
          style={{ borderColor: scoreColor, color: scoreColor, background: `color-mix(in srgb, ${scoreColor} 10%, transparent)` }}>
          {score}
        </div>
        <div>
          <p className="text-sm font-semibold text-text">Health score</p>
          <p className="text-xs text-dim">{findings.length} finding{findings.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {findings.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-good"><CheckCircle size={14} />No issues found</div>
      ) : (
        <div className="flex flex-col gap-2">
          {findings.map((f, i) => (
            <button key={i} onClick={() => nav(f.route)}
              className="flex items-start gap-2 text-left px-3 py-2 rounded-[8px] bg-raised hover:bg-accent/5 transition-colors text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              {f.severity === 'error'
                ? <AlertCircle size={14} className="text-danger shrink-0 mt-0.5" />
                : <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />}
              <span className="text-dim">{f.message}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Overview route ───────────────────────────────────────────────────────────

export default function ProductOverview() {
  const navigate = useNavigate()
  const { pid, coverages, ratingProgram, loading, product } = useProductCtx()

  if (loading) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-5"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      {/* Left: coverage collection */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-text">Coverages</h2>
          <span className="text-xs text-dim tnum">{coverages.length} total</span>
        </div>
        <CoverageCollection coverages={coverages} onOpen={id => navigate(`/app/products/${pid}/coverages?cov=${id}`)} />
      </div>

      {/* Right: health + stats */}
      <div className="flex flex-col gap-4">
        <Card>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-3">Health</p>
          <HealthPanel navigate={navigate} />
        </Card>

        <Card>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-3">Quick stats</p>
          <div className="flex flex-col gap-2 text-sm">
            {[
              { label: 'Coverages',   value: coverages.length },
              { label: 'Rating steps', value: ratingProgram?.steps?.length ?? 0 },
              { label: 'Min premium',  value: ratingProgram?.minimumPremium ? `$${ratingProgram.minimumPremium.toLocaleString()}` : '—' },
              { label: 'Owner',        value: product?.owner?.name ?? '—' },
              { label: 'Market',       value: product?.marketSegment ?? '—' },
            ].map(s => (
              <div key={s.label} className="flex justify-between gap-3">
                <span className="text-dim">{s.label}</span>
                <span className="font-medium text-text tnum truncate">{s.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
