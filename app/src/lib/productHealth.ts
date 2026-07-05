// Product health — derives readiness "findings" (dangling table refs, missing
// terms, unattached forms, unset states) and a 0–100 score from a product's live
// data. Shared by the workspace header pill and the Overview finding banner so
// the number and the top finding always agree. Errors are listed before warnings
// so `findings[0]` is the single most important thing to fix.
import type { Coverage, Rule, FormRule, RatingProgram, LDTable, RTTable } from '@pf/shared'

export interface Finding {
  severity: 'error' | 'warning'
  message: string
  route: string
}

export interface HealthInput {
  pid: string
  coverages: (Coverage & { id: string })[]
  rules: Rule[]
  ratingProgram: RatingProgram | null
  ldTables: Record<string, LDTable>
  rtTables: Record<string, RTTable>
  formRules: FormRule[]
}

export function computeProductFindings(
  { pid, coverages, rules, ratingProgram, ldTables, rtTables, formRules }: HealthInput,
): Finding[] {
  const findings: Finding[] = []
  const to = (sub: string) => `/app/products/${pid}/${sub}`

  // ── Errors (dangling references) ──
  rules.forEach(rule => {
    if (rule.ldTableRef && !ldTables[rule.ldTableRef]) {
      findings.push({ severity: 'error', message: `Rule ${rule.refId} references missing LD table ${rule.ldTableRef}`, route: to('rules') })
    }
  })
  ratingProgram?.steps?.forEach(step => {
    if (step.source.type === 'RT' && step.source.ref && !rtTables[step.source.ref]) {
      findings.push({ severity: 'error', message: `Rating step "${step.label}" references missing RT table ${step.source.ref}`, route: to('pricing') })
    }
  })

  // ── Warnings (incomplete authoring) ──
  coverages.forEach(cov => {
    if (cov.premiumGenerating && !cov.terms?.length) {
      findings.push({ severity: 'warning', message: `${cov.name} has no terms defined`, route: to('coverages') })
    }
  })
  coverages.filter(c => c.requirement === 'OPTIONAL').forEach(cov => {
    const hasRule = formRules.some(fr => fr.formNumbers?.some(fn => cov.formNumbers?.includes(fn)))
    if (!hasRule && cov.formNumbers?.length) {
      findings.push({ severity: 'warning', message: `${cov.name} has no form attachment rule`, route: to('forms') })
    }
  })
  coverages.forEach(cov => {
    if (!cov.allStates && (!cov.states || cov.states.length === 0)) {
      findings.push({ severity: 'warning', message: `${cov.name} has no states configured`, route: to('states') })
    }
  })

  return findings
}

export function healthScore(findings: Finding[]): number {
  if (!findings.length) return 100
  const errors   = findings.filter(f => f.severity === 'error').length
  const warnings = findings.filter(f => f.severity === 'warning').length
  return Math.max(0, 100 - errors * 20 - warnings * 5)
}

export function healthColor(score: number): string {
  return score >= 80 ? 'var(--color-good)' : score >= 60 ? 'var(--color-warn)' : 'var(--color-danger)'
}
