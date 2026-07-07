// ruleSim — the shape of a rule as the Rules surface reads it, and the pure mapping
// from the shared engine's result to a single rule's live status. This lives apart
// from RuleBuilder.tsx so the component file exports only components (Fast Refresh),
// and so the derivation stays trivially testable: it re-decides nothing, it only
// reads what evaluateRules() already returned.
import type { RuleCategory, RulesResult } from '@pf/shared'

export interface RuleLike {
  id?: string; refId: string | null; category: RuleCategory; subCategory?: string
  condition: string; outcome: string; ldTableRef?: string; coverageRefIds?: string[]; formNumbers?: string[]
}

export interface RuleSim {
  evaluated:      boolean   // the engine actually reasons about this rule
  fired:          boolean   // a hard violation is currently active for it
  message?:       string    // the violation message (when fired)
  attachedForms:  string[]  // this rule's forms that attach under the current inputs
  blockedOptions: { label: string; reason: string }[]  // LD options this rule's table blocks
}

/** Derive one rule's live status from the engine's RulesResult. No rule logic is
 *  re-implemented here: violations come from `violations`, attachment from
 *  `formsThatAttach`, constraints from `availableOptions`, and whether the engine
 *  evaluates the rule at all from `evaluatedRuleRefIds` (or the presence of a table
 *  it populated / a form it attaches). Anything else is documented-only. */
export function simulateRule(rule: RuleLike, result: RulesResult): RuleSim {
  const violation = rule.refId ? result.violations.find(v => v.ruleRefId === rule.refId) : undefined
  const opts = rule.ldTableRef ? result.availableOptions[rule.ldTableRef] ?? [] : []
  const blockedOptions = opts.filter(o => !o.available).map(o => ({ label: o.label, reason: o.violationReason ?? '' }))
  const forms = rule.formNumbers ?? []
  const attachedForms = forms.filter(f => result.formsThatAttach.includes(f))
  const evaluated =
    (rule.refId != null && result.evaluatedRuleRefIds.includes(rule.refId)) ||
    (!!rule.ldTableRef && rule.ldTableRef in result.availableOptions) ||
    forms.length > 0
  return { evaluated, fired: !!violation, message: violation?.message, attachedForms, blockedOptions }
}
