// ScaffoldProductModal — grounded AI scaffolding of a NEW draft product. The PM
// describes what they want; the server (scaffoldProduct) reads the REAL portfolio and
// streams back a cited scaffold (product shell + coverages + rules + referenced forms),
// having dropped anything it couldn't ground against Firestore. The PM reviews/deselects,
// then confirms — and every confirmed item is written through adapter.db.mutate() into a
// freshly-minted, isolated DRAFT: forms namespaced to the draft, coverage/rule refIds
// allocated HERE (never by the model), unresolved references dropped. Nothing invented
// reaches the portfolio, and nothing is published without a later promotion.
// EDITOR/ADMIN only (guarded here + server-side + by the Firestore product-write rule).
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter } from '../../lib/backend'
import { useUser } from '../../context/useUser'
import { Dialog, Button, Badge, RefChip } from '../ui'
import {
  IconSparkle, IconSpinner, IconCoverage, IconForm, IconRule, IconArrowRight, IconWarning,
} from '../ui/icons'
import { resolveLobByRefId, DEFAULT_LOB } from '@pf/shared'
import type {
  ScaffoldPlan, ProposedCoverage, ProposedForm, ProposedRule, LineageSource,
} from '@pf/shared'
import { newDraftId, scaffoldLineage } from '../../lib/draft/draft'
import { BaseFormField } from './BaseFormField'
import { uploadAndIdentifyBaseForm } from '../../lib/product/baseForm'

interface Props { onClose: () => void; onCreated: (id: string) => void }
type Phase = 'input' | 'streaming' | 'review' | 'creating' | 'error'

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const EXAMPLES = [
  'A coastal Homeowners HO-3 focused on wind/hail states',
  'A usage-based telematics Personal Auto product modelled on our PP 00 01',
  'A landlord dwelling product modelled on our HO-3',
]

export function ScaffoldProductModal({ onClose, onCreated }: Props) {
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'

  const [phase, setPhase]         = useState<Phase>('input')
  const [instruction, setInstr]   = useState('')
  const [file, setFile]           = useState<File | null>(null)
  const [status, setStatus]       = useState('')
  const [plan, setPlan]           = useState<ScaffoldPlan | null>(null)
  const [name, setName]           = useState('')
  const [checked, setChecked]     = useState<Set<string>>(new Set())
  const [error, setError]         = useState('')
  const [progress, setProgress]   = useState<{ done: number; total: number; label: string } | null>(null)

  const key = (k: string, i: number) => `${k}:${i}`
  const isOn = (k: string, i: number) => checked.has(key(k, i))
  const toggle = (k: string, i: number) => setChecked(prev => {
    const n = new Set(prev); const kk = key(k, i)
    if (n.has(kk)) n.delete(kk); else n.add(kk)
    return n
  })

  async function run() {
    const instr = instruction.trim()
    if (!instr) return
    setPhase('streaming'); setStatus('Reading the portfolio…'); setError('')
    try {
      let got: ScaffoldPlan | null = null
      let streamErr = ''
      await adapter.fns.stream('scaffoldProduct', { instruction: instr }, chunk => {
        let ev: { t: string; key?: string; value?: unknown; message?: string; name?: string; phase?: string; summary?: string }
        try { ev = JSON.parse(chunk) } catch { return }
        if (ev.t === 'tool' && ev.phase === 'start') setStatus(ev.name === 'emit_product_scaffold' ? 'Composing the scaffold…' : 'Reading the portfolio…')
        if (ev.t === 'json' && ev.key === 'scaffold') got = ev.value as ScaffoldPlan
        if (ev.t === 'error') streamErr = ev.message ?? 'Scaffold failed'
      })
      if (streamErr) throw new Error(streamErr)
      if (!got || !(got as ScaffoldPlan).product) throw new Error('The assistant could not ground a product for that request — try naming a line (e.g. Homeowners or Personal Auto).')

      const p = got as ScaffoldPlan
      setPlan(p)
      setName(p.product!.name)
      // Pre-select every surviving proposal; the PM deselects what they don't want.
      const next = new Set<string>()
      p.coverages.items.forEach((_, i) => next.add(key('cov', i)))
      p.forms.items.forEach((_, i) => next.add(key('form', i)))
      p.rules.items.forEach((_, i) => next.add(key('rule', i)))
      setChecked(next)
      setPhase('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scaffold failed.')
      setPhase('error')
    }
  }

  async function create() {
    if (!plan?.product || !user || !file) return
    const shell = plan.product
    const actor = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
    const prefix = shell.lobPrefix || DEFAULT_LOB.prefix
    const lob = resolveLobByRefId(`${prefix}.LOB.001`) ?? DEFAULT_LOB
    const draftId = newDraftId(name || shell.name)

    const chosenCovs  = plan.coverages.items.filter((_, i) => isOn('cov', i))
    const chosenForms = plan.forms.items.filter((_, i) => isOn('form', i))
    const chosenRules = plan.rules.items.filter((_, i) => isOn('rule', i))
    const total = 1 + chosenForms.length + chosenCovs.length + chosenRules.length

    // Lineage cites every grounded source the scaffold leveraged.
    const sources: LineageSource[] = [
      { type: 'product', ref: shell.citation, name: 'reference product' },
      ...chosenCovs.map(c => ({ type: 'coverage' as const, ref: c.citation })),
      ...chosenForms.map(f => ({ type: 'form' as const, ref: f.number })),
    ]

    setPhase('creating'); setProgress({ done: 0, total, label: 'Uploading base form…' })
    let done = 0
    const tick = (label: string) => setProgress({ done, total, label })
    try {
      // 0) A base coverage form is required — upload + identify before writing the shell.
      const baseForm = await uploadAndIdentifyBaseForm(file, actor, draftId)

      // 1) Product shell — a DRAFT, provenance stamped, grounded on the base form.
      await adapter.db.mutate({
        op: 'create', path: `products/${draftId}`, entityType: 'product', productId: draftId, actor,
        data: {
          refId: null, name: name.trim() || shell.name,
          lob: { refId: lob.refId, name: lob.name },
          description: shell.description, marketSegment: shell.marketSegment || `${lob.vertical} / ${lob.family}`,
          owner: actor, health: { score: 100, findingCount: 0, updatedAt: null },
          allStates: false, states: [], baseForm,
          lineage: scaffoldLineage(instruction, dedupeSources(sources), actor),
          status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED', reviewer: '',
        },
      })
      done++; tick(shell.name)

      // 2) Forms — draft-namespaced so they never touch the shared library.
      const validForms = new Set<string>()
      for (const f of chosenForms) {
        await adapter.db.mutate({
          op: 'create', path: `forms/${draftId}__${f.number.replace(/\s+/g, '-')}`, entityType: 'form', actor,
          data: {
            number: f.number, name: f.name || f.number, edition: f.edition,
            category: f.category, claimsBasis: 'Occurrence', dynamic: false,
            mandatoryDefault: f.mandatoryDefault, attachmentCondition: f.attachmentCondition,
            source: f.number.includes(' ') ? 'BUREAU' : 'PROPRIETARY',
            admitted: true, displayOnSchedule: true, multiUse: false,
            transactions: [], coverageParts: [], productRefIds: [draftId],
            description: '', dynamicFields: [], allStates: true, states: [],
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
        })
        validForms.add(f.number)
        done++; tick(f.number)
      }

      // 3) Coverages — refIds allocated HERE (never by the model); keep only grounded forms.
      const covByName = new Map<string, string>()
      let covNum = 0, order = 0
      for (const c of chosenCovs) {
        covNum++; order++
        const refId = `${prefix}.COV.${String(covNum).padStart(3, '0')}`
        await adapter.db.mutate({
          op: 'create', path: `products/${draftId}/coverages/${crypto.randomUUID()}`,
          entityType: 'coverage', productId: draftId, actor,
          data: {
            refId, name: c.name, parentId: null, order,
            requirement: c.requirement, claimsBasis: '', premiumGenerating: c.premiumGenerating,
            source: c.formNumbers.some(n => validForms.has(n)) ? 'BUREAU' : 'PROPRIETARY',
            formNumbers: c.formNumbers.filter(n => validForms.has(n)), terms: [],
            allStates: false, states: [],
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
        })
        covByName.set(normName(c.name), refId)
        done++; tick(c.name)
      }

      // 4) Rules — resolve coverage names → the refIds we just allocated; drop the rest.
      let ruNum = 10
      for (const r of chosenRules) {
        ruNum++
        const refId = `${prefix}.RU.${String(ruNum).padStart(3, '0')}`
        const coverageRefIds = [...new Set(r.coverageNames.map(n => covByName.get(normName(n))).filter((x): x is string => Boolean(x)))]
        await adapter.db.mutate({
          op: 'create', path: `products/${draftId}/rules/${crypto.randomUUID()}`,
          entityType: 'rule', productId: draftId, actor,
          data: {
            refId, category: r.category, subCategory: r.subCategory, condition: r.condition, outcome: r.outcome,
            coverageRefIds, formNumbers: r.formNumbers.filter(n => validForms.has(n)),
            allStates: true, states: [],
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
        })
        done++; tick(r.condition)
      }

      toast.success(`Scaffolded a draft with ${done} item${done === 1 ? '' : 's'}`)
      onCreated(draftId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the draft.')
      setPhase('error')
    }
  }

  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Dialog open title="Scaffold a product with AI" onClose={onClose} width="max-w-2xl">
      {!canEdit ? (
        <p className="text-sm text-danger">You need editor access to scaffold products.</p>
      ) : phase === 'input' ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Describe the product. The assistant reads your <span className="font-medium text-text">real portfolio</span> and
            proposes a starting structure modelled on it — every coverage, form and rule cited to what it&apos;s based on.
            It never invents a coverage, form or line. You review before anything is written, and it lands as a draft.
          </p>
          <textarea
            value={instruction} onChange={e => setInstr(e.target.value)}
            rows={3} autoFocus aria-label="Describe the product to scaffold"
            placeholder="e.g. A coastal Homeowners HO-3 for wind/hail states, modelled on our HO-3"
            className="w-full px-3 py-2.5 rounded-[10px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent resize-none"
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map(ex => (
              <button key={ex} type="button" onClick={() => setInstr(ex)}
                className="text-[11px] px-2 py-1 rounded-full bg-raised text-dim hover:text-accent hover:bg-accent-soft transition-colors">
                {ex}
              </button>
            ))}
          </div>
          <BaseFormField file={file} onFile={setFile} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void run()} disabled={!instruction.trim() || !file}>
              <IconSparkle size={14} aria-hidden="true" />Scaffold
            </Button>
          </div>
        </div>
      ) : phase === 'streaming' ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <IconSpinner size={26} className="animate-spin text-accent" aria-hidden="true" />
          <p className="text-sm text-dim">{status}</p>
          <p className="text-xs text-faint">Grounding every proposal in real portfolio data…</p>
        </div>
      ) : phase === 'creating' ? (
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-center gap-2 text-sm text-text">
            <IconSpinner size={16} className="animate-spin text-accent" aria-hidden="true" />
            Creating draft — {progress?.done} of {progress?.total}…
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-raised" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--color-accent-bright), var(--color-accent-strong))' }} />
          </div>
          <p className="text-xs text-faint truncate">{progress?.label}</p>
        </div>
      ) : phase === 'error' ? (
        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-start gap-2.5 rounded-[12px] p-3.5 bg-danger/10" style={{ border: '1px solid var(--color-border)' }}>
            <IconWarning size={16} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm text-dim">{error || 'Something went wrong.'}</div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => { setPhase('input'); setError('') }}>Try again</Button>
          </div>
        </div>
      ) : plan?.product ? (
        <ScaffoldReview
          plan={plan} name={name} setName={setName}
          isOn={isOn} toggle={toggle}
          onCancel={onClose} onCreate={() => void create()}
        />
      ) : null}
    </Dialog>
  )
}

function dedupeSources(sources: LineageSource[]): LineageSource[] {
  const seen = new Set<string>()
  return sources.filter(s => { const k = `${s.type}:${s.ref}`; if (seen.has(k)) return false; seen.add(k); return true })
}

// ─── Review body ────────────────────────────────────────────────────────────────

function ScaffoldReview({ plan, name, setName, isOn, toggle, onCancel, onCreate }: {
  plan: ScaffoldPlan
  name: string; setName: (s: string) => void
  isOn: (k: string, i: number) => boolean
  toggle: (k: string, i: number) => void
  onCancel: () => void; onCreate: () => void
}) {
  const shell = plan.product!
  const count = (k: 'cov' | 'form' | 'rule', n: number) => {
    let c = 0
    for (let i = 0; i < n; i++) if (isOn(k, i)) c++
    return c
  }
  const selected = count('cov', plan.coverages.items.length) + count('form', plan.forms.items.length) + count('rule', plan.rules.items.length)

  const row = (on: boolean, ariaLabel: string, k: string, i: number, body: React.ReactNode, cited: string) => (
    <div key={`${k}-${i}`} onClick={() => toggle(k, i)}
      className={`flex items-start gap-3 rounded-[12px] p-3 cursor-pointer transition-colors ${on ? 'bg-accent-soft' : 'bg-raised hover:bg-hover'}`}
      style={{ border: `1px solid ${on ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}>
      <input type="checkbox" checked={on} onChange={() => toggle(k, i)} onClick={e => e.stopPropagation()}
        className="mt-1 w-4 h-4 accent-[var(--color-accent)] shrink-0" aria-label={ariaLabel} />
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        {body}
        <p className="text-[11px] text-faint truncate" title={cited}><span className="text-dim">Modelled on:</span> {cited}</p>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Product shell */}
      <div className="flex items-center gap-3 rounded-[12px] p-3.5" style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-border)' }}>
        <span className="flex items-center justify-center w-9 h-9 rounded-[10px] shrink-0" style={{ background: 'var(--gradient-accent)' }}>
          <IconSparkle size={18} className="text-white" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <input value={name} onChange={e => setName(e.target.value)} aria-label="Product name"
            className="w-full font-semibold text-[15px] text-text bg-transparent rounded-[4px] px-1 -mx-1 hover:bg-hover focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40" />
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge label={shell.lobPrefix} color="blue" />
            <span className="text-[11px] text-faint truncate">{shell.marketSegment}</span>
          </div>
        </div>
      </div>
      {shell.description && <p className="text-sm text-dim px-0.5">{shell.description}</p>}

      {plan.warnings.length > 0 && (
        <details className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer text-sm text-text hover:bg-raised">
            <IconWarning size={15} className="text-warn" aria-hidden="true" />
            {plan.warnings.length} ungrounded proposal{plan.warnings.length === 1 ? '' : 's'} dropped
          </summary>
          <ul className="max-h-40 overflow-y-auto px-3.5 pb-3 pt-1 flex flex-col gap-1 text-xs text-dim">
            {plan.warnings.map((w, i) => <li key={i} className="flex gap-1.5"><span className="text-faint">•</span>{w}</li>)}
          </ul>
        </details>
      )}

      <div className="flex flex-col gap-5 max-h-[46vh] overflow-y-auto -mx-1 px-1">
        <Section icon={IconCoverage} label="Coverages" n={plan.coverages.items.length} note={plan.coverages.note}>
          {plan.coverages.items.map((c: ProposedCoverage, i) => row(isOn('cov', i), `Include ${c.name}`, 'cov', i, (
            <>
              <span className="font-semibold text-[14px] text-text">{c.name}</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge label={c.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional'} color={c.requirement === 'MANDATORY' ? 'purple' : 'default'} />
                {c.premiumGenerating && <Badge label="Rated" color="good" />}
                {c.formNumbers.map(fn => <RefChip key={fn} id={fn} tone="accent" />)}
              </div>
            </>
          ), c.citation))}
        </Section>

        <Section icon={IconForm} label="Referenced forms" n={plan.forms.items.length} note={plan.forms.note}>
          {plan.forms.items.map((f: ProposedForm, i) => row(isOn('form', i), `Include ${f.number}`, 'form', i, (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <RefChip id={f.number} tone="accent" />
                <span className="font-semibold text-[14px] text-text truncate">{f.name}</span>
              </div>
              <Badge label={f.category.replace('_', ' ')} color="blue" />
            </>
          ), f.citation))}
        </Section>

        <Section icon={IconRule} label="Rules" n={plan.rules.items.length} note={plan.rules.note}>
          {plan.rules.items.map((r: ProposedRule, i) => row(isOn('rule', i), `Include rule ${r.condition}`, 'rule', i, (
            <>
              <div className="flex items-center gap-1.5">
                <Badge label={r.category} color={r.category === 'FORMS' ? 'warn' : 'purple'} />
                <span className="text-[11px] text-faint">{r.subCategory}</span>
              </div>
              <span className="text-[13px] font-medium text-text">{r.condition}</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-faint shrink-0">then</span>
                <span className="text-[13px] text-dim">{r.outcome}</span>
              </div>
            </>
          ), r.citation))}
        </Section>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-faint">{selected} of {plan.coverages.items.length + plan.forms.items.length + plan.rules.items.length} selected</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onCreate} disabled={!name.trim()}>
            Create draft <IconArrowRight size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function Section({ icon: Icon, label, n, note, children }: {
  icon: typeof IconCoverage; label: string; n: number; note?: string; children: React.ReactNode
}) {
  if (n === 0 && !note) return null
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-dim shrink-0" aria-hidden="true" />
        <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-dim">{label}</h4>
        <span className="text-[11px] text-faint tnum">{n}</span>
        <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
      </div>
      {note && <p className="text-xs text-faint italic px-0.5">{note}</p>}
      {children}
    </section>
  )
}
