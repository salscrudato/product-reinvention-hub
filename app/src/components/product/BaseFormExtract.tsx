// BaseFormExtract — the base-form gate + grounded structured extraction (§8B/§10.1).
// An EDITOR uploads a base coverage form; until one exists the "Extract" action is
// disabled with a hint. Once present, a Cloud Function reads the form via Claude and
// proposes — via four forced tools — the product's coverages, forms, rules and rating
// hints. Each proposal carries a confidence and a citation to where in the document it
// was found; the server drops anything uncited or with an unverifiable form number, so
// nothing here is invented. The user reviews / edits / deselects per item, then adds:
// every confirmed proposal is written through adapter.db.mutate() (entity + audit +
// version + searchIndex), in dependency order (forms → coverages → rules → rating) so a
// rule's coverage/form references resolve to real refIds — refIds are allocated HERE,
// never by the model. VIEWER sees nothing.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Dialog, Button, Tooltip, RefChip, Badge } from '../ui'
import { IconUpload, IconFile, IconSparkle, IconTrash, IconSpinner, IconCoverage, IconForm, IconRule, IconPricing } from '../ui/icons'
import { resolveLob } from '@pf/shared'
import type {
  Coverage, Product, Form, Rule,
  ProposedCoverage, ProposedForm, ProposedRule, ProposedRatingHint, ExtractionSection,
} from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

interface Props {
  product:   WithId<Product>
  coverages: WithId<Coverage>[]
  forms:     WithId<Form>[]
  rules:     WithId<Rule>[]
  canEdit:   boolean
  actor:     { uid: string; name: string }
}

type Busy = 'upload' | 'extract' | 'add' | null
type Kind = 'coverages' | 'forms' | 'rules' | 'rating'

interface Sections {
  coverages: ExtractionSection<ProposedCoverage>
  forms:     ExtractionSection<ProposedForm>
  rules:     ExtractionSection<ProposedRule>
  rating:    ExtractionSection<ProposedRatingHint>
}
const EMPTY: Sections = { coverages: { items: [] }, forms: { items: [] }, rules: { items: [] }, rating: { items: [] } }

const KIND_META: Record<Kind, { label: string; Icon: typeof IconCoverage }> = {
  coverages: { label: 'Coverages',    Icon: IconCoverage },
  forms:     { label: 'Forms',        Icon: IconForm },
  rules:     { label: 'Rules',        Icon: IconRule },
  rating:    { label: 'Rating hints', Icon: IconPricing },
}

// Chunked base64 — avoids call-stack overflow on large PDFs.
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

function confidenceColor(c: number): string {
  return c >= 0.8 ? 'var(--color-good)' : c >= 0.5 ? 'var(--color-warn)' : 'var(--color-faint)'
}

// Normalize a coverage name for matching a rule's coverageNames → an existing/new refId.
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function BaseFormExtract({ product, coverages, forms, rules, canEdit, actor }: Props) {
  const [busy, setBusy] = useState<Busy>(null)
  const [sections, setSections] = useState<Sections>(EMPTY)
  const [checked, setChecked] = useState<Set<string>>(new Set())   // keys `${kind}:${index}`
  const [reviewOpen, setReviewOpen] = useState(false)
  const baseForm = product.baseForm ?? null
  const prefix = resolveLob(product).prefix

  if (!canEdit) return null

  const keyOf = (k: Kind, i: number) => `${k}:${i}`
  const isOn  = (k: Kind, i: number) => checked.has(keyOf(k, i))
  const toggle = (k: Kind, i: number) => setChecked(prev => {
    const n = new Set(prev); const key = keyOf(k, i)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })
  const countIn = (k: Kind) => sections[k].items.reduce((n, _, i) => n + (isOn(k, i) ? 1 : 0), 0)
  const totalSelected = (['coverages', 'forms', 'rules', 'rating'] as Kind[]).reduce((n, k) => n + countIn(k), 0)

  async function upload(file: File) {
    setBusy('upload')
    try {
      const path = `uploads/${actor.uid}/baseforms/${product.id}/${Date.now()}-${file.name}`
      const url = await adapter.storage.upload(path, file)
      await adapter.db.mutate({
        op: 'update', path: `products/${product.id}`,
        data: { baseForm: { path, url, name: file.name, uploadedAt: new Date().toISOString(), uploadedBy: actor.uid } },
        entityType: 'product', actor,
      })
      toast.success('Base form uploaded')
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — please refresh.' : 'Upload failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('upload')
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${product.id}`, data: { baseForm: null },
        entityType: 'product', actor,
      })
      toast.success('Base form removed')
    } catch { toast.error('Could not remove the base form') }
    finally { setBusy(null) }
  }

  async function extract() {
    if (!baseForm) return
    setBusy('extract')
    try {
      const resp = await fetch(baseForm.url)
      if (!resp.ok) throw new Error('Could not read the uploaded form')
      const blob = await resp.blob()
      const isPdf = blob.type === 'application/pdf' || baseForm.name.toLowerCase().endsWith('.pdf')
      const payload = isPdf
        ? { formBase64: toBase64(await blob.arrayBuffer()), mediaType: 'application/pdf', productName: product.name }
        : { formText: await blob.text(), productName: product.name }

      // Accumulate the four json sections off the stream. Loosely typed inside the
      // callback so TS doesn't narrow to the initializer.
      const acc: Sections = { coverages: { items: [] }, forms: { items: [] }, rules: { items: [] }, rating: { items: [] } }
      let streamErr = ''
      await adapter.fns.stream('extractCoverages', payload, chunk => {
        let ev: { t: string; key?: string; value?: unknown; message?: string }
        try { ev = JSON.parse(chunk) } catch { return }
        if (ev.t === 'json' && ev.key && ev.key in acc) {
          acc[ev.key as Kind] = (ev.value as ExtractionSection<never>) ?? { items: [] }
        }
        if (ev.t === 'error') streamErr = ev.message ?? 'Extraction failed'
      })
      if (streamErr) throw new Error(streamErr)

      const anything = (['coverages', 'forms', 'rules', 'rating'] as Kind[]).some(k => acc[k].items.length || acc[k].note)
      if (!anything) { toast.error('Nothing could be extracted from the form.'); return }

      // Pre-check every surviving proposal — the user deselects what they don't want.
      const next = new Set<string>()
      for (const k of ['coverages', 'forms', 'rules', 'rating'] as Kind[]) acc[k].items.forEach((_, i) => next.add(keyOf(k, i)))
      setSections(acc)
      setChecked(next)
      setReviewOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setBusy(null)
    }
  }

  // Immutable per-item edit helpers (one per kind — keeps types precise).
  const patchCov = (i: number, p: Partial<ProposedCoverage>) =>
    setSections(s => ({ ...s, coverages: { ...s.coverages, items: s.coverages.items.map((it, idx) => idx === i ? { ...it, ...p } : it) } }))
  const patchForm = (i: number, p: Partial<ProposedForm>) =>
    setSections(s => ({ ...s, forms: { ...s.forms, items: s.forms.items.map((it, idx) => idx === i ? { ...it, ...p } : it) } }))
  const patchRule = (i: number, p: Partial<ProposedRule>) =>
    setSections(s => ({ ...s, rules: { ...s.rules, items: s.rules.items.map((it, idx) => idx === i ? { ...it, ...p } : it) } }))
  const patchRate = (i: number, p: Partial<ProposedRatingHint>) =>
    setSections(s => ({ ...s, rating: { ...s.rating, items: s.rating.items.map((it, idx) => idx === i ? { ...it, ...p } : it) } }))

  async function addSelected() {
    const chosenForms  = sections.forms.items.filter((_, i) => isOn('forms', i))
    const chosenCovs   = sections.coverages.items.filter((_, i) => isOn('coverages', i))
    const chosenRules  = sections.rules.items.filter((_, i) => isOn('rules', i))
    const chosenRating = sections.rating.items.filter((_, i) => isOn('rating', i))
    if (!(chosenForms.length + chosenCovs.length + chosenRules.length + chosenRating.length)) return
    setBusy('add')

    // Reference sets seeded from what already exists, grown as we create — so a rule
    // can cite a coverage/form added in this same session. Nothing that fails to
    // resolve here reaches mutate(): no invented refId, no dangling form number.
    const validForms = new Set(forms.map(f => f.number))
    const covByName  = new Map<string, string>()
    for (const c of coverages) if (c.refId) covByName.set(normName(c.name), c.refId)

    // refId allocators — LOB-aware (HO.COV.NNN / GL.COV.NNN, HO.RU.NNN / GL.RU.NNN).
    const covRe = new RegExp(`^${prefix}\\.COV\\.(\\d+)$`)
    let covNum = Math.max(0, ...coverages.map(c => Number(covRe.exec(c.refId ?? '')?.[1] ?? 0)))
    let order  = Math.max(0, ...coverages.map(c => c.order ?? 0))
    const ruRe = new RegExp(`^${prefix}\\.RU\\.(\\d+)`)
    let ruNum  = Math.max(10, ...rules.map(r => Number(ruRe.exec(r.refId ?? '')?.[1] ?? 0)))

    let written = 0
    const errors: string[] = []
    const run = async (label: string, fn: () => Promise<void>) => {
      try { await fn(); written++ } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    // Product doc id === refId in this data model; forms filter by whichever is set.
    const productRef = product.refId ?? product.id
    // Forms already on file keep a stable, number-derived doc id — so a `create` would
    // OVERWRITE the existing (possibly richer, seeded) form. Skip those: the number is
    // already valid for coverage/rule references, so nothing is lost.
    const existingFormNums = new Set(forms.map(f => f.number))

    // 1) Forms — top-level, stable doc id derived from the number (matches the seed).
    for (const f of chosenForms) {
      if (existingFormNums.has(f.number)) { validForms.add(f.number); continue }
      await run(f.number, async () => {
        await adapter.db.mutate({
          op: 'create', path: `forms/${f.number.replace(/\s+/g, '-')}`, entityType: 'form', actor,
          data: {
            number: f.number, name: f.name, edition: f.edition,
            category: f.category, claimsBasis: 'Occurrence',
            dynamic: false, mandatoryDefault: f.mandatoryDefault, attachmentCondition: f.attachmentCondition,
            source: f.number.includes(' ') ? 'BUREAU' : 'PROPRIETARY',
            admitted: true, displayOnSchedule: true, multiUse: false,
            transactions: [], coverageParts: [], productRefIds: [productRef],
            description: '', dynamicFields: [],
            allStates: true, states: [],
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
        })
        validForms.add(f.number)
      })
    }

    // 2) Coverages — under the product; allocate the next refId; keep only grounded forms.
    for (const c of chosenCovs) {
      await run(c.name, async () => {
        covNum += 1; order += 1
        const refId = `${prefix}.COV.${String(covNum).padStart(3, '0')}`
        const formNumbers = c.formNumbers.filter(n => validForms.has(n))
        await adapter.db.mutate({
          op: 'create', path: `products/${product.id}/coverages/${crypto.randomUUID()}`,
          entityType: 'coverage', productId: product.id, actor,
          data: {
            refId, name: c.name, parentId: null, order,
            requirement: c.requirement, claimsBasis: '', premiumGenerating: c.premiumGenerating,
            source: formNumbers.length ? 'BUREAU' : 'PROPRIETARY',
            formNumbers, terms: [], allStates: false, states: [],
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
        })
        covByName.set(normName(c.name), refId)
      })
    }

    // 3+4) Rules and rating hints — both persist as Rule entities (RATING for hints).
    // References are resolved against real entities only; unresolved ones are dropped.
    const persistRule = (category: Rule['category'], subCategory: string, condition: string, outcome: string, coverageNames: string[], formNumbers: string[]) =>
      run(condition, async () => {
        ruNum += 1
        const refId = `${prefix}.RU.${String(ruNum).padStart(3, '0')}`
        const coverageRefIds = [...new Set(coverageNames.map(n => covByName.get(normName(n))).filter((r): r is string => Boolean(r)))]
        await adapter.db.mutate({
          op: 'create', path: `products/${product.id}/rules/${crypto.randomUUID()}`,
          entityType: 'rule', productId: product.id, actor,
          data: {
            refId, category, subCategory, condition, outcome,
            coverageRefIds, formNumbers: formNumbers.filter(n => validForms.has(n)),
            allStates: true, states: [],
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
        })
      })
    for (const r of chosenRules)  await persistRule(r.category, r.subCategory, r.condition, r.outcome, r.coverageNames, r.formNumbers)
    for (const h of chosenRating) await persistRule('RATING', h.subCategory, h.condition, h.outcome, h.coverageNames, h.formNumbers)

    setBusy(null)
    if (errors.length) toast.error(`Added ${written}; ${errors.length} failed — ${errors[0]}`)
    else toast.success(`Added ${written} item${written === 1 ? '' : 's'}`)
    if (written) { setReviewOpen(false); setSections(EMPTY); setChecked(new Set()) }
  }

  // stopPropagation wrapper so editing a field never toggles the row's selection.
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn() }
  const pill = (on: boolean) =>
    `text-[11px] px-2 py-0.5 rounded-[6px] font-medium transition-colors ${on ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`

  return (
    <>
      <div className="flex items-center gap-2">
        {baseForm ? (
          <span className="inline-flex items-center gap-2 h-9 pl-2.5 pr-1.5 rounded-[9px] bg-raised text-sm text-dim max-w-[220px]"
            style={{ border: '1px solid var(--color-border)' }}>
            <IconFile size={14} className="text-accent shrink-0" aria-hidden="true" />
            <span className="truncate" title={baseForm.name}>{baseForm.name}</span>
            <label className="shrink-0 rounded-[6px] p-1 hover:bg-hover hover:text-text transition-colors cursor-pointer" title="Replace form" aria-label="Replace base form">
              <IconUpload size={13} aria-hidden="true" />
              <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" className="hidden"
                disabled={busy !== null}
                onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
            </label>
            <button onClick={remove} disabled={busy !== null} title="Remove form" aria-label="Remove base form"
              className="shrink-0 rounded-[6px] p-1 hover:bg-hover hover:text-danger transition-colors">
              <IconTrash size={13} aria-hidden="true" />
            </button>
          </span>
        ) : (
          <label className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-[9px] text-sm font-medium transition-colors cursor-pointer ${busy === 'upload' ? 'opacity-60' : 'text-dim hover:text-text bg-raised hover:bg-hover'}`}
            style={{ border: '1px solid var(--color-border)' }}>
            {busy === 'upload' ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : <IconUpload size={14} aria-hidden="true" />}
            Upload base form
            <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" className="hidden"
              disabled={busy !== null}
              onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
          </label>
        )}

        <Tooltip content={baseForm ? '' : 'Upload a base coverage form to enable AI extraction'} side="bottom">
          <Button variant="primary" size="sm" disabled={!baseForm || busy !== null} onClick={() => void extract()}>
            {busy === 'extract' ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : <IconSparkle size={14} aria-hidden="true" />}
            {busy === 'extract' ? 'Reading form…' : 'Extract'}
          </Button>
        </Tooltip>
      </div>

      <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} title="Review extracted proposals" width="max-w-2xl">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Read from <span className="font-mono text-dim">{baseForm?.name}</span>. Every proposal is cited to the document —
            edit or deselect anything, then add. Nothing is written until you confirm.
          </p>

          <div className="flex flex-col gap-5 max-h-[58vh] overflow-y-auto -mx-1 px-1">
            {(['coverages', 'forms', 'rules', 'rating'] as Kind[]).map(kind => {
              const section = sections[kind]
              if (!section.items.length && !section.note) return null
              const { label, Icon } = KIND_META[kind]
              const selected = countIn(kind)
              const allOn = section.items.length > 0 && selected === section.items.length
              const setAll = (on: boolean) => setChecked(prev => {
                const n = new Set(prev)
                section.items.forEach((_, i) => { if (on) n.add(keyOf(kind, i)); else n.delete(keyOf(kind, i)) })
                return n
              })
              return (
                <section key={kind} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Icon size={15} className="text-dim shrink-0" aria-hidden="true" />
                    <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-dim">{label}</h4>
                    <span className="text-[11px] text-faint tnum">{section.items.length}</span>
                    <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                    {section.items.length > 0 && (
                      <button onClick={() => setAll(!allOn)} className="text-[11px] text-dim hover:text-accent transition-colors">
                        {allOn ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                  </div>

                  {/* Explicit "nothing found" / "dropped ungrounded" note — the model says so rather than guessing. */}
                  {section.note && (
                    <p className="text-xs text-faint italic px-0.5">{section.note}</p>
                  )}

                  {section.items.map((item, i) => {
                    const on = isOn(kind, i)
                    const shell = (confidence: number, ariaLabel: string, body: React.ReactNode) => (
                      <div key={i} onClick={() => toggle(kind, i)}
                        className={`flex items-start gap-3 rounded-[12px] p-3 cursor-pointer transition-colors ${on ? 'bg-accent-soft' : 'bg-raised hover:bg-hover'}`}
                        style={{ border: `1px solid ${on ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(kind, i)} onClick={e => e.stopPropagation()}
                          className="mt-1 w-4 h-4 accent-[var(--color-accent)] shrink-0" aria-label={ariaLabel} />
                        <div className="flex flex-col gap-1.5 min-w-0 flex-1">{body}</div>
                        <span className="text-[11px] font-mono tnum shrink-0 mt-0.5" style={{ color: confidenceColor(confidence) }} title="Extraction confidence">
                          {Math.round(confidence * 100)}%
                        </span>
                      </div>
                    )

                    if (kind === 'coverages') {
                      const c = item as ProposedCoverage
                      return shell(c.confidence, `Include ${c.name}`, (
                        <>
                          <input value={c.name} onChange={e => patchCov(i, { name: e.target.value })} onClick={e => e.stopPropagation()}
                            aria-label="Coverage name"
                            className="font-semibold text-[14px] text-text bg-transparent rounded-[4px] px-1 -mx-1 hover:bg-hover focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40" />
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button onClick={stop(() => patchCov(i, { requirement: c.requirement === 'MANDATORY' ? 'OPTIONAL' : 'MANDATORY' }))} className={pill(c.requirement === 'MANDATORY')}>
                              {c.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional'}
                            </button>
                            <button onClick={stop(() => patchCov(i, { premiumGenerating: !c.premiumGenerating }))} className={pill(c.premiumGenerating)}>Rated</button>
                            {c.formNumbers.map(fn => <RefChip key={fn} id={fn} tone="accent" />)}
                          </div>
                          {c.limitHint && <p className="text-xs text-dim">{c.limitHint}</p>}
                          <p className="text-[11px] text-faint truncate" title={c.citation}><span className="text-dim">Cited:</span> {c.citation}</p>
                        </>
                      ))
                    }
                    if (kind === 'forms') {
                      const f = item as ProposedForm
                      return shell(f.confidence, `Include ${f.number}`, (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <RefChip id={f.number} tone="accent" />
                            <input value={f.name} onChange={e => patchForm(i, { name: e.target.value })} onClick={e => e.stopPropagation()}
                              aria-label="Form name"
                              className="font-semibold text-[14px] text-text bg-transparent rounded-[4px] px-1 flex-1 min-w-0 hover:bg-hover focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40" />
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge label={f.category.replace('_', ' ')} color="blue" />
                            {f.edition && <Badge label={`Ed. ${f.edition}`} color="default" />}
                            <Badge label={f.attachmentCondition === 'NONE' ? 'Always attached' : 'Rule-driven'} color={f.mandatoryDefault ? 'purple' : 'default'} />
                          </div>
                          <p className="text-[11px] text-faint truncate" title={f.citation}><span className="text-dim">Cited:</span> {f.citation}</p>
                        </>
                      ))
                    }
                    if (kind === 'rules') {
                      const r = item as ProposedRule
                      return shell(r.confidence, `Include rule ${r.condition}`, (
                        <>
                          <div className="flex items-center gap-1.5">
                            <Badge label={r.category} color={r.category === 'FORMS' ? 'warn' : 'purple'} />
                            <span className="text-[11px] text-faint">{r.subCategory}</span>
                          </div>
                          <input value={r.condition} onChange={e => patchRule(i, { condition: e.target.value })} onClick={e => e.stopPropagation()}
                            aria-label="Rule condition"
                            className="text-[13px] font-medium text-text bg-transparent rounded-[4px] px-1 -mx-1 hover:bg-hover focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40" />
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[11px] text-faint shrink-0">then</span>
                            <input value={r.outcome} onChange={e => patchRule(i, { outcome: e.target.value })} onClick={e => e.stopPropagation()}
                              aria-label="Rule outcome"
                              className="text-[13px] text-dim bg-transparent rounded-[4px] px-1 flex-1 min-w-0 hover:bg-hover focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40" />
                          </div>
                          {(r.formNumbers.length > 0 || r.coverageNames.length > 0) && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {r.formNumbers.map(fn => <RefChip key={fn} id={fn} tone="accent" />)}
                              {r.coverageNames.map(cn => <Badge key={cn} label={cn} color="default" />)}
                            </div>
                          )}
                          <p className="text-[11px] text-faint truncate" title={r.citation}><span className="text-dim">Cited:</span> {r.citation}</p>
                        </>
                      ))
                    }
                    const h = item as ProposedRatingHint
                    return shell(h.confidence, `Include rating hint ${h.condition}`, (
                      <>
                        <div className="flex items-center gap-1.5">
                          <Badge label="RATING" color="blue" />
                          <span className="text-[11px] text-faint">{h.subCategory}</span>
                          {h.minimumPremium != null && <Badge label={`Min $${h.minimumPremium.toLocaleString()}`} color="good" />}
                        </div>
                        <input value={h.condition} onChange={e => patchRate(i, { condition: e.target.value })} onClick={e => e.stopPropagation()}
                          aria-label="Rating hint condition"
                          className="text-[13px] font-medium text-text bg-transparent rounded-[4px] px-1 -mx-1 hover:bg-hover focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40" />
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[11px] text-faint shrink-0">then</span>
                          <input value={h.outcome} onChange={e => patchRate(i, { outcome: e.target.value })} onClick={e => e.stopPropagation()}
                            aria-label="Rating hint outcome"
                            className="text-[13px] text-dim bg-transparent rounded-[4px] px-1 flex-1 min-w-0 hover:bg-hover focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40" />
                        </div>
                        {(h.formNumbers.length > 0 || h.coverageNames.length > 0) && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {h.formNumbers.map(fn => <RefChip key={fn} id={fn} tone="accent" />)}
                            {h.coverageNames.map(cn => <Badge key={cn} label={cn} color="default" />)}
                          </div>
                        )}
                        <p className="text-[11px] text-faint truncate" title={h.citation}><span className="text-dim">Cited:</span> {h.citation}</p>
                      </>
                    ))
                  })}
                </section>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-faint">{totalSelected} selected</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReviewOpen(false)} disabled={busy === 'add'}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => void addSelected()} disabled={busy === 'add' || totalSelected === 0}>
                {busy === 'add' && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
                Add selected{totalSelected ? ` (${totalSelected})` : ''}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  )
}
