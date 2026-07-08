// RuleBuilder — how P&C product managers read, simulate and author rules.
//  • RuleFlowCard renders a rule as a logical IF → THEN flow with clickable
//    refId / coverage / form links, and — when the Simulate panel is running —
//    the rule's LIVE outcome derived from the shared engine's result.
//  • simulateRule derives that per-rule status PURELY from the engine's output
//    (violations, formsThatAttach, availableOptions, evaluatedRuleRefIds); it
//    re-decides nothing, so what a card shows always matches the engine.
//  • RuleComposer is a GROUNDED composer: the product manager describes a rule,
//    the draftRule Cloud Function reads the product's real data server-side and
//    returns a cited draft (every refId/form verified to exist), which the PM
//    edits and saves. The draft is handed up to be persisted via mutate().
import { useMemo, useState } from 'react'
import { IconArrowRight, IconPlus, IconClose, IconSparkle, IconWand, IconSpinner, IconCheck, IconEdit, IconWarning, IconAlertCircle, IconCheckCircle } from '../ui/icons'
import { Badge, Button, RefChip } from '../ui'
import { adapter } from '../../lib/backend'
import type { Rule, RuleCategory } from '@pf/shared'
import type { RuleLike, RuleSim } from './ruleSim'

const CAT_COLOR: Record<RuleCategory, 'purple'|'blue'|'warn'> = { PRODUCT: 'purple', RATING: 'blue', FORMS: 'warn' }

// The single status pill + detail for a simulated rule. Precedence: violation → attaches
// → constrains → clear → documented. Colour is always token-driven.
function SimStatus({ sim }: { sim: RuleSim }) {
  if (!sim.evaluated) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-faint pt-1" style={{ borderTop: '1px dashed var(--color-border)' }}>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-raised text-dim font-medium">Documented</span>
        <span>Not gated by the simulator — this rule is a documented determination.</span>
      </div>
    )
  }
  const pill = sim.fired
    ? { label: 'Violation', cls: 'text-danger', bg: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-surface))', Icon: IconAlertCircle }
    : sim.attachedForms.length
      ? { label: 'Attaches', cls: 'text-accent', bg: 'var(--color-accent-soft)', Icon: IconCheckCircle }
      : sim.blockedOptions.length
        ? { label: 'Constrains', cls: 'text-warn', bg: 'color-mix(in srgb, var(--color-warn) 12%, var(--color-surface))', Icon: IconWarning }
        : { label: 'Clear', cls: 'text-good', bg: 'color-mix(in srgb, var(--color-good) 12%, var(--color-surface))', Icon: IconCheck }
  return (
    <div className="flex flex-col gap-1.5 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${pill.cls}`} style={{ background: pill.bg }}>
          <pill.Icon size={11} aria-hidden="true" />{pill.label}
        </span>
        {sim.attachedForms.map(f => <RefChip key={f} id={f} tone="accent" />)}
      </div>
      {sim.fired && sim.message && <p className="text-[12px] text-danger leading-snug">{sim.message}</p>}
      {!sim.fired && sim.blockedOptions.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {sim.blockedOptions.map((b, i) => (
            <li key={i} className="text-[11px] text-warn leading-snug">{b.label} — {b.reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Rule flow card (display) ─────────────────────────────────────────────────

export function RuleFlowCard({ rule, sim, onOpenCoverage, onOpenForm, onEdit }: {
  rule: RuleLike; sim?: RuleSim
  onOpenCoverage?: (refId: string) => void; onOpenForm?: (num: string) => void; onEdit?: () => void
}) {
  return (
    <div className="bg-surface rounded-[12px] p-4 flex flex-col gap-3 group" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        {rule.refId && <RefChip id={rule.refId} tone="accent" />}
        <Badge label={rule.category} color={CAT_COLOR[rule.category] ?? 'default'} />
        {rule.subCategory && <span className="text-xs text-faint">{rule.subCategory}</span>}
        {rule.ldTableRef && <RefChip id={rule.ldTableRef} />}
        {onEdit && (
          <button onClick={onEdit} title={`Edit ${rule.refId ?? 'rule'}`} aria-label={`Edit ${rule.refId ?? 'rule'}`}
            className="ml-auto w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
            <IconEdit size={14} />
          </button>
        )}
      </div>

      {/* IF → THEN flow */}
      <div className="flex flex-col sm:flex-row items-stretch rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <div className="flex-1 bg-raised px-3 py-2 min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-faint mb-0.5">If</span>
          <p className="text-sm text-text leading-snug">{rule.condition}</p>
        </div>
        <div className="flex items-center justify-center px-1.5 bg-raised shrink-0" aria-hidden="true">
          <IconArrowRight size={15} className="text-accent rotate-90 sm:rotate-0" />
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

      {sim && <SimStatus sim={sim} />}
    </div>
  )
}

// ─── Grounded rule composer ─────────────────────────────────────────────────────

export type NewRule = Pick<Rule, 'category' | 'subCategory' | 'condition' | 'outcome' | 'coverageRefIds' | 'formNumbers'> & { ldTableRef?: string }

// The structured draft the draftRule Function emits (mirror of emit_rule_draft +
// server-verification warnings). Every ref here has been verified to exist server-side.
interface RuleDraft {
  category:       RuleCategory
  subCategory:    string
  condition:      string
  outcome:        string
  coverageRefIds: string[]
  formNumbers:    string[]
  ldTableRef?:    string
  rationale?:     string[]
  citations?:     string[]
  notes?:         string
  warnings?:      string[]
}

type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }
  | { t: 'error'; message: string }
  | { t: 'done' }

const TOOL_LABELS: Record<string, string> = {
  search_entities: 'Searching the product', get_product_tree: 'Reading the product',
  get_coverage: 'Reading coverage', get_rules: 'Reading existing rules',
  get_forms: 'Checking forms', get_ld_table: 'Checking limit tables',
  get_dictionary: 'Checking the dictionary', emit_rule_draft: 'Drafting the rule',
}

const EXAMPLES = [
  'Require the Water Back-Up endorsement whenever a finished basement is insured.',
  'Block the $5,000 Coverage F limit unless Coverage E is at least $300,000.',
  'Attach the wind/hail percentage deductible form only in coastal states.',
]

interface ToolChip { name: string; done: boolean; summary?: string }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="text-[11px] font-medium text-faint">{label}</span>{children}</label>
}
const inputCls = 'h-8 px-2.5 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25'
const areaCls  = 'px-2.5 py-1.5 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none'

// A grounded chip editor: chips are removable; new chips may only be ADDED from the
// known set (real coverage refIds / form numbers), so manual editing can't invent a
// reference either — the datalist is the guard.
function ChipEditor({ label, values, options, tone, onChange }: {
  label: string; values: string[]; options: string[]; tone: 'default' | 'accent'; onChange: (next: string[]) => void
}) {
  const [entry, setEntry] = useState('')
  const listId = `ce-${label.replace(/\s+/g, '-').toLowerCase()}`
  const add = () => {
    const v = entry.trim()
    if (v && options.includes(v) && !values.includes(v)) { onChange([...values, v]); setEntry('') }
  }
  return (
    <Field label={label}>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map(v => (
          <span key={v} className={`inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] font-medium ${tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-raised text-dim'}`}>
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Remove ${v}`} className="hover:opacity-70"><IconClose size={11} /></button>
          </span>
        ))}
        <input list={listId} value={entry} onChange={e => setEntry(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          onBlur={add} placeholder="add…" className="h-6 w-24 px-1.5 rounded-[6px] bg-surface border border-border-strong text-[11px] focus:outline-none focus:ring-2 focus:ring-accent/25" />
        <datalist id={listId}>{options.filter(o => !values.includes(o)).map(o => <option key={o} value={o} />)}</datalist>
      </div>
    </Field>
  )
}

export function RuleComposer({ productId, lobPrefix, coverages, forms, existingRule, onSubmit, onCancel }: {
  productId: string
  lobPrefix: string
  coverages: { refId: string; name: string }[]
  forms: string[]
  existingRule?: RuleLike
  onSubmit: (r: NewRule, mode: 'create' | 'edit') => Promise<void> | void
  onCancel: () => void
}) {
  const mode: 'create' | 'edit' = existingRule ? 'edit' : 'create'
  const covRefIds = useMemo(() => coverages.map(c => c.refId).filter(Boolean), [coverages])

  const [instruction, setInstruction] = useState('')
  const [streaming, setStreaming]     = useState(false)
  const [editorOpen, setEditorOpen]   = useState(mode === 'edit')  // manual authoring visible in edit mode
  const [tools, setTools]             = useState<ToolChip[]>([])
  const [rationale, setRationale]     = useState<string[]>([])
  const [warnings, setWarnings]       = useState<string[]>([])
  const [citations, setCitations]     = useState<string[]>([])
  const [error, setError]             = useState<string | null>(null)
  const [saving, setSaving]           = useState(false)

  // Editable draft fields — seeded from the existing rule in edit mode, and overwritten
  // by an AI draft when one arrives. A human can also fill these directly.
  const [category, setCategory]     = useState<RuleCategory>(existingRule?.category ?? 'PRODUCT')
  const [subCategory, setSubCategory] = useState(existingRule?.subCategory ?? 'Authored')
  const [condition, setCondition]   = useState(existingRule?.condition ?? '')
  const [outcome, setOutcome]       = useState(existingRule?.outcome ?? '')
  const [covRefs, setCovRefs]       = useState<string[]>(existingRule?.coverageRefIds ?? [])
  const [formNums, setFormNums]     = useState<string[]>(existingRule?.formNumbers ?? [])
  const [ldTableRef, setLdTableRef] = useState<string | undefined>(existingRule?.ldTableRef)

  const showEditor = editorOpen || !!condition || !!outcome
  const valid = !!condition.trim() && !!outcome.trim() && !!subCategory.trim()

  function applyDraft(d: RuleDraft) {
    setEditorOpen(true)
    setCategory(d.category ?? 'PRODUCT')
    setSubCategory(d.subCategory || 'Authored')
    setCondition(d.condition ?? '')
    setOutcome(d.outcome ?? '')
    setCovRefs(d.coverageRefIds ?? [])
    setFormNums(d.formNumbers ?? [])
    setLdTableRef(d.ldTableRef)
    setRationale(d.rationale ?? [])
    setCitations(d.citations ?? [])
    setWarnings(d.warnings ?? [])
  }

  async function draft() {
    const text = instruction.trim()
    if (!text || streaming) return
    setStreaming(true); setError(null); setTools([]); setRationale([]); setWarnings([]); setCitations([])
    let gotDraft = false
    let sawError = false
    const payload = {
      instruction: text, productId, lobPrefix,
      ...(existingRule ? { existingRule: { refId: existingRule.refId, category: existingRule.category, subCategory: existingRule.subCategory, condition: existingRule.condition, outcome: existingRule.outcome, coverageRefIds: existingRule.coverageRefIds, formNumbers: existingRule.formNumbers, ldTableRef: existingRule.ldTableRef } } : {}),
    }
    try {
      await adapter.fns.stream('draftRule', payload, chunk => {
        let ev: StreamEvent
        try { ev = JSON.parse(chunk) as StreamEvent } catch { return }
        switch (ev.t) {
          case 'tool':
            setTools(prev => {
              if (ev.phase === 'start') return [...prev, { name: ev.name, done: false }]
              const next = [...prev]
              const i = [...next].reverse().findIndex(t => t.name === ev.name && !t.done)
              if (i >= 0) next[next.length - 1 - i] = { name: ev.name, done: true, summary: ev.summary }
              return next
            })
            break
          case 'json':
            if (ev.key === 'rule_draft') { gotDraft = true; applyDraft(ev.value as RuleDraft) }
            break
          case 'error': sawError = true; setError(ev.message); break
          case 'token': case 'done': break
        }
      })
      // The server now forces a final draft when the model doesn't commit to one, so a
      // missing draft here means the stream ended abnormally. Don't clobber a specific
      // server error message with the generic fallback.
      if (!gotDraft && !sawError) setError('The assistant didn’t return a draft. Try rephrasing, or write it manually below.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft failed.')
    } finally {
      setStreaming(false)
    }
  }

  async function submit() {
    if (!valid || saving) return
    setSaving(true)
    try {
      await onSubmit({ category, subCategory: subCategory.trim(), condition: condition.trim(), outcome: outcome.trim(), coverageRefIds: covRefs, formNumbers: formNums, ldTableRef }, mode)
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-surface rounded-[14px] p-5 flex flex-col gap-4" style={{ border: '1px solid var(--color-accent-line)', boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-[8px] flex items-center justify-center" style={{ background: 'var(--gradient-accent)' }}><IconSparkle size={14} className="text-white" aria-hidden="true" /></span>
          <p className="text-sm font-semibold text-text">{mode === 'edit' ? 'Edit rule' : 'Compose a rule'}</p>
        </div>
        <button onClick={onCancel} className="text-faint hover:text-text" aria-label="Cancel"><IconClose size={16} /></button>
      </div>

      {/* Grounded instruction */}
      <div className="flex flex-col gap-2">
        <Field label={mode === 'edit' ? 'Ask AI to refine this rule (grounded in the product)' : 'Describe the rule in plain English (grounded in the product)'}>
          <textarea rows={2} value={instruction} onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void draft() } }}
            placeholder={mode === 'edit' ? 'e.g. also require it in coastal states only' : 'e.g. require Coverage E ≥ $300,000 before the $5,000 Coverage F limit can be selected'}
            className={areaCls} />
        </Field>
        {!showEditor && mode === 'create' && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map(ex => (
              <button key={ex} onClick={() => setInstruction(ex)} disabled={streaming}
                className="text-left text-[11px] text-dim bg-raised rounded-[8px] px-2.5 py-1.5 hover:text-text transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                <span className="inline-flex items-start gap-1.5"><IconSparkle size={11} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />{ex}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="default" size="sm" onClick={() => void draft()} disabled={streaming || !instruction.trim()}>
            {streaming ? <><IconSpinner size={14} className="animate-spin" />Drafting…</> : <><IconWand size={14} />{mode === 'edit' ? 'Refine with AI' : 'Draft with AI'}</>}
          </Button>
          {!showEditor && (
            <Button variant="ghost" size="sm" onClick={() => setEditorOpen(true)}>Write it manually</Button>
          )}
          <span className="text-[11px] text-faint">Reads the product server-side · every reference verified · ⌘↵</span>
        </div>
        {tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-raised text-[11px] text-dim">
                {t.done ? <IconCheck size={10} className="text-good" aria-hidden="true" /> : <IconSpinner size={10} className="animate-spin text-accent" aria-hidden="true" />}
                {TOOL_LABELS[t.name] ?? t.name}{t.done && t.summary ? ` · ${t.summary}` : ''}
              </span>
            ))}
          </div>
        )}
        {error && <p className="text-[12px] text-danger">{error}</p>}
      </div>

      {/* Editable, cited draft */}
      {showEditor && (
        <div className="flex flex-col gap-3 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-0.5 p-0.5 rounded-[9px] bg-raised self-start" role="tablist" aria-label="Rule category">
            {(['PRODUCT', 'RATING', 'FORMS'] as RuleCategory[]).map(c => (
              <button key={c} onClick={() => setCategory(c)} role="tab" aria-selected={category === c}
                className={`px-3 h-7 rounded-[7px] text-xs font-medium transition-colors ${category === c ? 'bg-surface text-accent shadow-[var(--shadow-card)]' : 'text-dim hover:text-text'}`}>{c}</button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Sub-category"><input value={subCategory} onChange={e => setSubCategory(e.target.value)} className={inputCls} /></Field>
            <Field label="Limit/Deductible table (optional)"><input value={ldTableRef ?? ''} onChange={e => setLdTableRef(e.target.value.trim() || undefined)} placeholder="HO.LD.002" className={`${inputCls} font-mono`} /></Field>
          </div>

          <div className="flex items-stretch rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="flex-1 flex flex-col bg-raised px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-faint mb-1">If (condition)</span>
              <textarea rows={2} value={condition} onChange={e => setCondition(e.target.value)} className="bg-transparent text-sm text-text resize-none focus:outline-none" placeholder="Coverage F $5,000 limit selected" />
            </div>
            <div className="flex items-center px-1.5 bg-raised shrink-0" aria-hidden="true"><IconArrowRight size={15} className="text-accent" /></div>
            <div className="flex-1 flex flex-col px-3 py-2" style={{ background: 'var(--color-accent-soft)' }}>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-accent mb-1">Then (outcome)</span>
              <textarea rows={2} value={outcome} onChange={e => setOutcome(e.target.value)} className="bg-transparent text-sm text-text resize-none focus:outline-none" placeholder="Requires Coverage E ≥ $300,000" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ChipEditor label="Coverages governed" values={covRefs} options={covRefIds} tone="default" onChange={setCovRefs} />
            <ChipEditor label="Forms referenced" values={formNums} options={forms} tone="accent" onChange={setFormNums} />
          </div>

          {rationale.length > 0 && (
            <div className="flex flex-col gap-1 rounded-[10px] bg-page px-3 py-2.5" style={{ border: '1px solid var(--color-border)' }}>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Why (grounded)</span>
              {rationale.map((r, i) => <p key={i} className="text-[12px] text-dim leading-relaxed">{r}</p>)}
              {citations.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-faint">Verified refs:</span>
                  {citations.map(c => <RefChip key={c} id={c} />)}
                </div>
              )}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="flex gap-2 rounded-[10px] px-3 py-2" style={{ background: 'color-mix(in srgb, var(--color-warn) 8%, var(--color-surface))', border: '1px solid color-mix(in srgb, var(--color-warn) 22%, transparent)' }}>
              <IconWarning size={14} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex flex-col gap-0.5 text-[12px] text-warn">
                {warnings.map((w, i) => <span key={i}>{w}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={() => void submit()} disabled={!valid || saving}>
          <IconPlus size={14} />{saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create rule'}
        </Button>
      </div>
    </div>
  )
}
