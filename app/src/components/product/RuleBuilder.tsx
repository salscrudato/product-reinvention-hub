// RuleBuilder — how P&C product managers read and author rules.
//  • RuleFlowCard renders a rule as a logical IF → THEN flow with clickable
//    refId / coverage / form links (rules link to everything).
//  • RuleComposer is a guided, type-ahead builder: pick a subject, operator and
//    value, then an outcome; it assembles the condition/outcome + links and
//    hands a complete rule up to be persisted via mutate().
import { useMemo, useState } from 'react'
import { ArrowRight, Plus, X } from 'lucide-react'
import { Badge, Button, RefChip } from '../ui'
import type { Rule, RuleCategory } from '@pf/shared'

// ─── Domain vocabulary for type-ahead ─────────────────────────────────────────

const SUBJECTS: { label: string; covRefId?: string }[] = [
  { label: 'Coverage A limit', covRefId: 'HO.COV.001' },
  { label: 'Coverage B limit', covRefId: 'HO.COV.002' },
  { label: 'Coverage C percentage', covRefId: 'HO.COV.003' },
  { label: 'Coverage D limit', covRefId: 'HO.COV.004' },
  { label: 'Coverage E limit', covRefId: 'HO.COV.005' },
  { label: 'Coverage F limit', covRefId: 'HO.COV.006' },
  { label: 'All-peril deductible' }, { label: 'Wind/hail deductible' }, { label: 'Risk state' },
  { label: 'Replacement Cost' }, { label: 'Scheduled Personal Property' }, { label: 'Water back-up' },
  { label: 'Protective device' }, { label: 'Home day-care' },
]
const OPERATORS = ['is at least', 'is at most', 'is', 'is one of', 'is elected', 'is not elected', 'requires']
const VALUE_SUGGESTIONS = [
  '$100,000', '$300,000', '$500,000', '$1,000', '$2,000', '$5,000', '1%', '2%', '5%', '50%', '70%', '75%',
  'AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA',
]
const OUTCOMES: { id: string; label: string; needsTarget: boolean; phrase: (t: string) => string }[] = [
  { id: 'attach',     label: 'Attach form',     needsTarget: true,  phrase: t => `Attach ${t}` },
  { id: 'block',      label: 'Block option',    needsTarget: true,  phrase: t => `Block ${t}` },
  { id: 'require',    label: 'Require',         needsTarget: true,  phrase: t => `Require ${t}` },
  { id: 'setDefault', label: 'Set default',     needsTarget: true,  phrase: t => `Set default to ${t}` },
  { id: 'ineligible', label: 'Make ineligible', needsTarget: false, phrase: () => 'Ineligible' },
]

// ─── Rule flow card (display) ─────────────────────────────────────────────────

export interface RuleLike {
  id?: string; refId: string | null; category: RuleCategory; subCategory?: string
  condition: string; outcome: string; ldTableRef?: string; coverageRefIds?: string[]; formNumbers?: string[]
}
const CAT_COLOR: Record<RuleCategory, 'purple'|'blue'|'warn'> = { PRODUCT: 'purple', RATING: 'blue', FORMS: 'warn' }

export function RuleFlowCard({ rule, onOpenCoverage, onOpenForm }: {
  rule: RuleLike; onOpenCoverage?: (refId: string) => void; onOpenForm?: (num: string) => void
}) {
  return (
    <div className="bg-surface rounded-[12px] p-4 flex flex-col gap-3" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        {rule.refId && <RefChip id={rule.refId} tone="accent" />}
        <Badge label={rule.category} color={CAT_COLOR[rule.category] ?? 'default'} />
        {rule.subCategory && <span className="text-xs text-faint">{rule.subCategory}</span>}
        {rule.ldTableRef && <RefChip id={rule.ldTableRef} />}
      </div>

      {/* IF → THEN flow */}
      <div className="flex flex-col sm:flex-row items-stretch rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <div className="flex-1 bg-raised px-3 py-2 min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-faint mb-0.5">If</span>
          <p className="text-sm text-text leading-snug">{rule.condition}</p>
        </div>
        <div className="flex items-center justify-center px-1.5 bg-raised shrink-0" aria-hidden="true">
          <ArrowRight size={15} className="text-accent rotate-90 sm:rotate-0" />
        </div>
        <div className="flex-1 px-3 py-2 min-w-0" style={{ background: 'var(--color-accent-soft)' }}>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-accent mb-0.5">Then</span>
          <p className="text-sm text-text leading-snug">{rule.outcome}</p>
        </div>
      </div>

      {((rule.coverageRefIds?.length ?? 0) > 0 || (rule.formNumbers?.length ?? 0) > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {rule.coverageRefIds?.map(r => <RefChip key={r} id={r} onClick={onOpenCoverage ? () => onOpenCoverage(r) : undefined} title={`Open ${r}`} />)}
          {rule.formNumbers?.map(f => <RefChip key={f} id={f} tone="accent" onClick={onOpenForm ? () => onOpenForm(f) : undefined} title={`Open ${f}`} />)}
        </div>
      )}
    </div>
  )
}

// ─── Rule composer (guided authoring) ─────────────────────────────────────────

export type NewRule = Pick<Rule, 'category' | 'subCategory' | 'condition' | 'outcome' | 'coverageRefIds' | 'formNumbers'>

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 flex-1 min-w-[120px]"><span className="text-[11px] font-medium text-faint">{label}</span>{children}</label>
}
const inputCls = 'h-8 px-2.5 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25'

export function RuleComposer({ forms, onCreate, onCancel }: {
  forms: string[]; onCreate: (r: NewRule) => Promise<void> | void; onCancel: () => void
}) {
  const [category, setCategory] = useState<RuleCategory>('PRODUCT')
  const [subject, setSubject]   = useState('')
  const [operator, setOperator] = useState(OPERATORS[0]!)
  const [value, setValue]       = useState('')
  const [outcomeId, setOutcomeId] = useState('attach')
  const [target, setTarget]     = useState('')
  const [saving, setSaving]     = useState(false)

  const outcome = OUTCOMES.find(o => o.id === outcomeId)!
  const subjectMeta = SUBJECTS.find(s => s.label.toLowerCase() === subject.toLowerCase())

  const condition = useMemo(() => {
    if (!subject) return ''
    const op = operator === 'is elected' || operator === 'is not elected' ? operator : `${operator} ${value}`.trim()
    return `${subject} ${op}`.trim()
  }, [subject, operator, value])
  const outcomeText = outcome.needsTarget ? (target ? outcome.phrase(target) : '') : outcome.phrase('')
  const valid = !!subject && (operator === 'is elected' || operator === 'is not elected' || !!value) && (!outcome.needsTarget || !!target)

  async function submit() {
    if (!valid || saving) return
    setSaving(true)
    const coverageRefIds = subjectMeta?.covRefId ? [subjectMeta.covRefId] : []
    const formNumbers = outcomeId === 'attach' && /HO\s?\d/.test(target) ? [target.trim()] : []
    try {
      await onCreate({ category, subCategory: 'Authored', condition, outcome: outcomeText, coverageRefIds, formNumbers })
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-surface rounded-[14px] p-5 flex flex-col gap-4" style={{ border: '1px solid var(--color-accent-line)', boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text">New rule</p>
        <button onClick={onCancel} className="text-faint hover:text-text" aria-label="Cancel"><X size={16} /></button>
      </div>

      <datalist id="rc-subjects">{SUBJECTS.map(s => <option key={s.label} value={s.label} />)}</datalist>
      <datalist id="rc-values">{VALUE_SUGGESTIONS.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="rc-forms">{forms.map(f => <option key={f} value={f} />)}</datalist>

      {/* Category */}
      <div className="flex items-center gap-0.5 p-0.5 rounded-[9px] bg-raised self-start" role="tablist">
        {(['PRODUCT', 'RATING', 'FORMS'] as RuleCategory[]).map(c => (
          <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
            className={`px-3 h-7 rounded-[7px] text-xs font-medium transition-colors ${category === c ? 'bg-surface text-accent shadow-[var(--shadow-card)]' : 'text-dim hover:text-text'}`}>{c}</button>
        ))}
      </div>

      {/* IF row */}
      <div className="flex flex-wrap items-end gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint pb-2">If</span>
        <Field label="Subject"><input list="rc-subjects" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Coverage E limit" className={inputCls} /></Field>
        <Field label="Operator">
          <select value={operator} onChange={e => setOperator(e.target.value)} className={inputCls}>{OPERATORS.map(o => <option key={o}>{o}</option>)}</select>
        </Field>
        {operator !== 'is elected' && operator !== 'is not elected' && (
          <Field label="Value"><input list="rc-values" value={value} onChange={e => setValue(e.target.value)} placeholder="$300,000" className={inputCls} /></Field>
        )}
      </div>

      {/* THEN row */}
      <div className="flex flex-wrap items-end gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent pb-2">Then</span>
        <Field label="Outcome">
          <select value={outcomeId} onChange={e => setOutcomeId(e.target.value)} className={inputCls}>{OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </Field>
        {outcome.needsTarget && (
          <Field label={outcomeId === 'attach' ? 'Form' : 'Target'}>
            <input list={outcomeId === 'attach' ? 'rc-forms' : 'rc-values'} value={target} onChange={e => setTarget(e.target.value)} placeholder={outcomeId === 'attach' ? 'HO 04 90' : '$5,000'} className={inputCls} />
          </Field>
        )}
      </div>

      {/* Live preview */}
      {(condition || outcomeText) && (
        <div className="flex items-center gap-2 text-sm rounded-[8px] bg-page px-3 py-2" style={{ border: '1px solid var(--color-border)' }}>
          <span className="text-dim">{condition || '…'}</span>
          <ArrowRight size={14} className="text-accent shrink-0" />
          <span className="text-text font-medium">{outcomeText || '…'}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={submit} disabled={!valid || saving}>
          <Plus size={14} />{saving ? 'Creating…' : 'Create rule'}
        </Button>
      </div>
    </div>
  )
}
