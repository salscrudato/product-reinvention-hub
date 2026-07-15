// filing/reconcile.ts — the pure, deterministic RECONCILE stage. It joins the three
// extractions (rate order, manual, policy form) into ONE reviewable, governed bundle:
//
//   • product shell   — name, inferred LOB, state applicability (the filing's state), base
//                        form number + edition;
//   • coverage tree   — the policy form's Coverage A–F (+ sub-coverages), with a deductible
//                        term whose option set comes from the manual's deductible rule;
//   • RT / LD tables  — one per manual factor table the rate order actually references, built
//                        in the GRID shape (dimensions + valueColumn) so they price through the
//                        shared evaluator's generic lookup with no bespoke getter;
//   • rules           — the manual's eligibility drafts + the policy form's product/forms rules;
//   • a RatingProgram — the rate order walked in order, each variable mapped onto an engine op:
//                        SET the base loss cost, MUL every resolved factor, ADD every flat
//                        premium, MIN_FLOOR the minimum-premium rule, and creditFloor the
//                        maximum-credit rule (evaluator.ts extension).
//
// The join is by normalized-name + the concept registry (filing/registry.ts). Every
// multiplicative step must resolve to an RT/LD source or a scalar factor; every additive step
// to a rate schedule or flat premium. Anything that cannot be resolved is emitted as an
// UNRESOLVED item WITH its reason and citation — never guessed, never silently dropped. The
// `counts` field proves the conservation law proposed === accepted + unresolved.
//
// Emits the SAME ImportPlan/PlannedEntity shape the workbook importer produces, so the app
// persists a filing exactly as it persists a workbook. Pure TypeScript; deterministic.
import type {
  Status, ReviewStatus, Lifecycle, RatingStep, RTTable, LDTable,
} from '../../types'
import type { ImportPlan, PlannedEntity, ImportSummary } from '../isoImport'
import type {
  FilingExtraction, FilingImportPlan, RateOrderVariable, ManualRule,
  UnresolvedItem, FilingReviewItem, FilingReviewSection,
} from './types'
import { matchConcept } from './registry'
import { parseFactorTable, type ParsedTable } from './tableParser'
import { LOB_REGISTRY, resolveLobByRefId, DEFAULT_LOB } from '../lobRegistry'

// ─── options + small helpers ────────────────────────────────────────────────────────

export interface ReconcileOptions {
  /** Which rate-order form column to build the product for. Defaults to the FILING'S OWN
   *  base form number (F22) — cross-notation matched by numeric form code, the same bridge
   *  pickFormScalar uses ("HO3" and "LEM 03" both resolve to code 3). 'HO3' is only the
   *  last-resort fallback when the extraction carries no base form, and it is warned. */
  targetForm?: string
  /** Namespace token for globally-unique table + product refIds (default derived from the base
   *  form + state, e.g. "LEM03NJ"). RT/LD tables are a global collection, so this keeps a
   *  filing's tables from clobbering the seeded PH/PA/GL tables or another filing's. */
  productToken?: string
  /** Stage-0's content-derived LOB (e.g. 'PA.LOB.001') — F18: the router already
   *  derives the line; reconciliation must not re-hard-code Personal Home.
   *  Unset/unresolvable → the platform DEFAULT_LOB with an explicit warning. */
  lobRefIdHint?: string
}

const dashId = (refId: string): string => refId.replace(/\./g, '-')
const gov = {
  status: 'ACTIVE' as Status, lifecycle: 'DRAFT' as Lifecycle,
  reviewStatus: 'NOT_STARTED' as ReviewStatus, reviewer: '',
}
function tokenOf(baseFormNumber: string, state: string): string {
  return `${baseFormNumber}${state}`.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'FILING'
}

/** Build an RTTable (grid shape) from a parsed factor table: dimensions = the lookup keys
 *  (default every non-value column), values = the distinct display strings observed, valueColumn
 *  set explicitly so the shared genericRtLookup resolves it without a bespoke getter. A
 *  descriptive key (not in `lookupKeys`) stays as a row column but is NOT a query dimension. */
function toGridTable(name: string, parsed: ParsedTable, valueColumn: string, lookupKeys?: string[]): RTTable {
  const allKeys = parsed.columns.filter(c => c !== valueColumn)
  const dimKeys = lookupKeys && lookupKeys.length ? allKeys.filter(k => lookupKeys.includes(k)) : allKeys
  const dimensions = dimKeys.map(key => {
    const values: string[] = []
    for (const r of parsed.rows) { const d = String(r[key] ?? ''); if (d !== '' && !values.includes(d)) values.push(d) }
    return { key, label: key, values }
  })
  return { name, columns: parsed.columns, rows: parsed.rows, dimensions, valueColumn }
}

// ─── the reconcile ────────────────────────────────────────────────────────────────

export function reconcileFiling(ex: FilingExtraction, opts: ReconcileOptions = {}): FilingImportPlan {
  // F22: the target form is the filing's own base form, never a hard-coded line
  // assumption. 'HO3' survives only as a warned last resort (no caller value, no
  // extracted base form) — the same warned-default pattern as the LOB fallback.
  const targetForm = (opts.targetForm ?? ex.baseFormNumber ?? '').trim() || 'HO3'
  const targetFormDefaulted = !(opts.targetForm ?? '').trim() && !(ex.baseFormNumber ?? '').trim()
  const state = (ex.filingState || 'NJ').toUpperCase()
  const token = opts.productToken ?? tokenOf(ex.baseFormNumber, state)
  // F18: the line comes from the stage-0 router's content-derived hint,
  // resolved against the LOB registry — never re-hard-coded. No hint (or an
  // unresolvable one) falls back to the platform DEFAULT_LOB (Personal Home),
  // which downstream resolveLob() would apply anyway — but as a WARNED default,
  // never a silent one.
  const hintedLob = opts.lobRefIdHint ? (LOB_REGISTRY[opts.lobRefIdHint] ?? resolveLobByRefId(opts.lobRefIdHint)) : undefined
  const lobDef = hintedLob ?? DEFAULT_LOB
  const lobDefaulted = !hintedLob
  const prefix = lobDef.refIdPrefix || lobDef.code || 'PH'
  // F15: a filing's source documents assign NO ids, so every id here is MINTED —
  // it must follow the platform's one synthesis convention (registry prefix +
  // SYNTH marker, kind token in segment 2 so refIdSegmentKind parses it). The
  // globally-unique filing token stays as a LATER segment where the collection
  // is global (product, RT/LD tables, rating program).
  const productRefId = `${prefix}.PROD.SYNTH.${token}`
  const productId = productRefId

  const unresolved: UnresolvedItem[] = []
  const ratingItems: FilingReviewItem[] = []
  const tableItems:  FilingReviewItem[] = []
  const rtTables: PlannedEntity[] = []
  const ldTables: PlannedEntity[] = []

  // Index the manual rules by concept, and pick out the two program-level rules.
  const manualByConcept = new Map<string, ManualRule>()
  for (const r of ex.manual.rules) if (r.concept && !manualByConcept.has(r.concept)) manualByConcept.set(r.concept, r)
  const creditCapRule = ex.manual.rules.find(r => r.kind === 'CREDIT_CAP')
  const minPremRule   = ex.manual.rules.find(r => r.kind === 'MIN_PREMIUM')

  // Table cache — a manual rule's table is parsed at most once and reused across steps.
  const builtTables = new Map<string, { refId: string; valueColumn: string; dimKeys: string[]; parsed: ParsedTable }>()
  function ensureTable(rule: ManualRule): { refId: string; valueColumn: string; dimKeys: string[]; parsed: ParsedTable } | null {
    if (builtTables.has(rule.concept)) return builtTables.get(rule.concept)!
    if (!rule.table) return null
    const parsed = parseFactorTable(rule.table)
    if (parsed.rows.length === 0) return null
    const refId = `${prefix}.RT.SYNTH.${token}.${rule.concept}`
    const grid = toGridTable(`${rule.title}`, parsed, rule.table.valueColumn, rule.table.lookupKeys)
    rtTables.push({ docId: dashId(refId), refId, label: `${refId} — ${rule.title}`, data: { ...grid } })
    tableItems.push({ section: 'tables', label: `${rule.title} (${parsed.rows.length} rows${parsed.skipped ? `, ${parsed.skipped} skipped` : ''})`, refId, docId: dashId(refId), confidence: rule.confidence, citation: rule.citation, detail: `${rule.table.layout} · value=${rule.table.valueColumn}` })
    const built = { refId, valueColumn: rule.table.valueColumn, dimKeys: grid.dimensions!.map(d => d.key), parsed }
    builtTables.set(rule.concept, built)
    return built
  }

  // ── Walk the rate order, in order, for the target form → rating steps + unresolved ──
  // F22: the form filter runs INSIDE the conservation ledger. A variable whose
  // form columns don't cover the target form becomes an UNRESOLVED item with its
  // citation — visible, counted, never silently dropped.
  const steps: RatingStep[] = []
  let order = 0
  const vars: RateOrderVariable[] = []
  for (const v of ex.rateOrder.variables) {
    if (v.forms.some(f => formMatchesTarget(f, targetForm))) { vars.push(v); continue }
    unresolved.push(unres(v, `Applies to form(s) ${v.forms.join(', ') || '(none listed)'} — not the target form "${targetForm}"${opts.targetForm ? '' : ` (the filing's base form)`}; excluded from this product's rating program.`))
  }

  for (const v of vars) {
    const concept = matchConcept(v.name)
    const rule = concept ? manualByConcept.get(concept.key) : undefined

    // Base loss cost seeds the chain as a SET (additive "+" in the rate order, but the engine
    // starts at 0). It must resolve to the base-loss-cost territory table — matched by CONCEPT
    // first (the concept join is authoritative), falling back to the kind if the model didn't
    // set a concept, so an LCMF table (also base-loss-cost KIND) can never be mistaken for it.
    if (concept?.key === 'baseLossCost') {
      const blcRule = (rule && rule.table) ? rule : ex.manual.rules.find(r => r.kind === 'BASE_LOSS_COST' && r.table)
      const built = blcRule ? ensureTable(blcRule) : null
      if (built) {
        order++; steps.push({ id: `s${order}`, order, label: v.name, op: 'SET', source: { type: 'RT', ref: built.refId, keys: built.dimKeys } })
        ratingItems.push(stepReview(v, `SET ${built.refId}[${built.dimKeys.join(',')}]`))
      } else {
        unresolved.push(unres(v, 'No base-loss-cost table could be parsed from the manual.'))
      }
      continue
    }

    if (v.op === 'MUL') {
      // Prefer a parsed factor table; fall back to a single scalar factor; else UNRESOLVED.
      const built = rule && rule.table ? ensureTable(rule) : null
      if (built) {
        order++; steps.push({ id: `s${order}`, order, label: v.name, op: 'MUL', source: { type: 'RT', ref: built.refId, keys: built.dimKeys }, ...(concept?.isCredit ? { isCredit: true } : {}) })
        ratingItems.push(stepReview(v, `MUL ${built.refId}[${built.dimKeys.join(',')}]${concept?.isCredit ? ' · credit' : ''}`))
      } else if (rule && rule.scalars && rule.scalars.length === 1 && Number.isFinite(rule.scalars[0]!.value)) {
        order++; steps.push({ id: `s${order}`, order, label: v.name, op: 'MUL', source: { type: 'CONST', value: rule.scalars[0]!.value }, ...(concept?.isCredit ? { isCredit: true } : {}) })
        ratingItems.push(stepReview(v, `MUL CONST(${rule.scalars[0]!.value})${concept?.isCredit ? ' · credit' : ''}`))
      } else {
        unresolved.push(unres(v, rule ? 'Manual rule found but no parseable factor table or single scalar factor.' : 'No manual factor table or scalar resolves this multiplicative variable.'))
      }
      continue
    }

    // op === 'ADD' — a flat premium / rate schedule.
    if (rule && rule.scalars && rule.scalars.length === 1 && Number.isFinite(rule.scalars[0]!.value)) {
      order++; steps.push({ id: `s${order}`, order, label: v.name, op: 'ADD', source: { type: 'CONST', value: rule.scalars[0]!.value } })
      ratingItems.push(stepReview(v, `ADD CONST(${rule.scalars[0]!.value})`))
    } else {
      unresolved.push(unres(v, rule ? 'Additive variable has no single flat premium in the manual (a per-item/scheduled rate needs its own worksheet).' : 'No manual rate schedule or flat premium resolves this additive variable.'))
    }
  }

  // ── Minimum premium (MIN_FLOOR) from the min-premium rule, for the target form ──
  let minimumPremium = 0
  let minPremResolved = false
  if (minPremRule) {
    const scalar = pickFormScalar(minPremRule, targetForm)
    if (scalar != null) {
      minPremResolved = true
      minimumPremium = scalar
      order++; steps.push({ id: `s${order}`, order, label: `Minimum premium (Rule ${minPremRule.ruleNumber})`, op: 'MIN_FLOOR', source: { type: 'CONST', value: scalar }, roundTo: 0 })
      ratingItems.push({ section: 'rating', label: `Minimum premium → MIN_FLOOR $${scalar}`, confidence: minPremRule.confidence, citation: minPremRule.citation, detail: `MIN_FLOOR CONST(${scalar})` })
    } else {
      unresolved.push({ stage: 'manual', kind: 'min-premium', name: minPremRule.title, reason: `No minimum-premium floor stated for form ${targetForm}.`, citation: minPremRule.citation })
    }
  }

  // ── Maximum-credit cap (creditFloor) from the max-credit rule, for the target form ──
  let creditFloor: number | undefined
  if (creditCapRule) {
    const pct = pickFormScalar(creditCapRule, targetForm)   // e.g. 50 → floor 0.50
    if (pct != null && pct > 0 && pct < 100) {
      creditFloor = 1 - pct / 100
      ratingItems.push({ section: 'rating', label: `Maximum credit ${pct}% → creditFloor ${creditFloor.toFixed(2)}`, confidence: creditCapRule.confidence, citation: creditCapRule.citation, detail: `creditFloor=${creditFloor}` })
    } else {
      unresolved.push({ stage: 'manual', kind: 'credit-cap', name: creditCapRule.title, reason: `No maximum-credit percentage stated for form ${targetForm}.`, citation: creditCapRule.citation })
    }
  }

  const ratingProgramRefId = `${prefix}.RAT.SYNTH.${token}.1`
  const ratingProgram: PlannedEntity | null = steps.length > 0 ? {
    docId: dashId(ratingProgramRefId), refId: ratingProgramRefId, label: `${ratingProgramRefId} — rating program`,
    data: {
      refId: ratingProgramRefId, name: `${ex.productName || 'Imported'} Rating Program`,
      minimumPremium, steps, ...(creditFloor !== undefined ? { creditFloor } : {}),
      allStates: false, states: [state], ...gov,
    },
  } : null

  // ── Deductible option LD table + Coverage A deductible term ──
  const dedRule = ex.manual.rules.find(r => r.kind === 'DEDUCTIBLE' && r.table)
  let dedLdRefId: string | undefined
  if (dedRule?.table) {
    const parsed = parseFactorTable(dedRule.table)
    const dedValues = distinctColumnValues(parsed, dedRule.table.columnKeys ? (dedRule.table.keyColumns[1] ?? 'deductible') : (dedRule.table.valueColumn))
    const opts2 = (dedRule.table.columnKeys ?? dedValues).map(Number).filter(Number.isFinite)
    if (opts2.length) {
      dedLdRefId = `${prefix}.LD.SYNTH.${token}.DEDUCTIBLE`
      ldTables.push({
        docId: dashId(dedLdRefId), refId: dedLdRefId, label: `${dedLdRefId} — All-perils deductible options`,
        data: { name: 'All-perils deductible options', defaultValue: opts2.includes(500) ? 500 : opts2[0], rows: opts2.map(v => ({ label: `$${v.toLocaleString()}`, value: v })) } satisfies Omit<LDTable, never>,
      })
      tableItems.push({ section: 'tables', label: `All-perils deductible options (${opts2.length})`, refId: dedLdRefId, docId: dashId(dedLdRefId), confidence: dedRule.confidence, citation: dedRule.citation, detail: 'LD · deductible option set' })
    }
  }

  // ── Coverage tree from the policy form ──
  const coverages: PlannedEntity[] = []
  const coverageItems: FilingReviewItem[] = []
  let covNum = 0
  for (const c of ex.policyForm.coverages.items) {
    covNum++
    const refId = `${prefix}.COV.SYNTH${String(covNum).padStart(3, '0')}`
    const isDwelling = /coverage a\b|dwelling/i.test(c.name)
    const terms = isDwelling && dedLdRefId
      ? [{ id: 'ded-allperil', kind: 'DEDUCTIBLE' as const, label: 'All-perils deductible', ldTableRef: dedLdRefId, default: 500, basis: 'per occurrence', notes: 'Section I deductible (manual Rule 406)' }]
      : []
    coverages.push({
      docId: dashId(refId), refId, label: `${refId} — ${c.name}`,
      data: {
        refId, name: c.name, parentId: null, order: covNum,
        requirement: c.requirement, claimsBasis: '', premiumGenerating: c.premiumGenerating,
        source: c.formNumbers.length ? 'BUREAU' : 'PROPRIETARY',
        formNumbers: c.formNumbers, terms,
        allStates: false, states: [state], ...gov,
      },
    })
    coverageItems.push({ section: 'coverages', label: c.name, refId, docId: dashId(refId), confidence: c.confidence, citation: c.citation })
  }

  // ── Forms from the policy form ──
  // Form identity is (number, edition) — F12. Blank edition degrades to the
  // number-only id (filing extraction often has no edition).
  const forms: PlannedEntity[] = ex.policyForm.forms.items.map(f => ({
    docId: (f.edition ? `${f.number.replace(/\s+/g, '-')}__${f.edition.replace(/\s+/g, '-')}` : f.number.replace(/\s+/g, '-')), refId: null, label: `${f.number} — ${f.name}`,
    data: {
      number: f.number, name: f.name, edition: f.edition, category: f.category,
      claimsBasis: '', dynamic: false, mandatoryDefault: f.mandatoryDefault, attachmentCondition: f.attachmentCondition,
      source: f.number.includes(' ') ? 'BUREAU' : 'PROPRIETARY', admitted: true, displayOnSchedule: true, multiUse: false,
      transactions: [], coverageParts: [], productRefIds: [productId], description: '', dynamicFields: [],
      allStates: false, states: [state], ...gov,
    },
  }))

  // ── Rules: policy-form product/forms rules + manual eligibility drafts ──
  const rules: PlannedEntity[] = []
  const ruleItems: FilingReviewItem[] = []
  let ruNum = 0
  const pushRule = (category: 'PRODUCT' | 'FORMS' | 'RATING', subCategory: string, condition: string, outcome: string, formNumbers: string[], citation: string, confidence: number) => {
    ruNum++
    const refId = `${prefix}.RU.SYNTH${String(ruNum).padStart(3, '0')}`
    rules.push({
      docId: dashId(refId), refId, label: `${refId} — ${subCategory}`,
      data: { refId, category, subCategory, condition, outcome, coverageRefIds: [], formNumbers, allStates: false, states: [state], ...gov },
    })
    ruleItems.push({ section: 'rules', label: `${condition} → ${outcome}`, refId, docId: dashId(refId), confidence, citation })
  }
  for (const r of ex.policyForm.rules.items) pushRule(r.category, r.subCategory, r.condition, r.outcome, r.formNumbers, r.citation, r.confidence)
  for (const r of ex.manual.rules) if (r.ruleDraft) pushRule('PRODUCT', `Rule ${r.ruleNumber}`, r.ruleDraft.condition, r.ruleDraft.outcome, [], r.citation, r.confidence)

  // ── Product shell ──
  const product: PlannedEntity = {
    docId: productId, refId: productRefId, label: `${productRefId} — ${ex.productName}`,
    data: {
      refId: productRefId, name: ex.productName || `${ex.baseFormNumber} (${state})`,
      lob: { refId: lobDef.refId, name: lobDef.name },
      description: `Imported from a ${state} rate filing (${ex.baseFormNumber} ${ex.baseFormEdition}).`,
      marketSegment: `${lobDef.vertical} / ${lobDef.family}`,
      owner: { uid: '', name: '' },   // stamped by the writer
      baseForm: { path: '', url: '', name: `${ex.baseFormNumber} ${ex.baseFormEdition}`, uploadedAt: null, uploadedBy: '', formNumber: ex.baseFormNumber, edition: ex.baseFormEdition, lob: lobDef.name },
      allStates: false, states: [state], ...gov,
    },
  }

  const summary: ImportSummary = {
    productName: product.data['name'] as string,
    productRefId,
    lobName: lobDef.name,
    counts: {
      products: 1, coverages: coverages.length, forms: forms.length, rules: rules.length,
      formRules: 0, ratingSteps: steps.length, rtTables: rtTables.length, ldTables: ldTables.length,
    },
    warnings: [
      // A defaulted line is a WARNED default, never a silent one (F18).
      ...(lobDefaulted ? [`LOB undetected${opts.lobRefIdHint ? ` (hint "${opts.lobRefIdHint}" matched no registry line)` : ''} — defaulted to ${DEFAULT_LOB.name} (the platform default); verify the product line.`] : []),
      // A defaulted target form is a WARNED default too (F22).
      ...(targetFormDefaulted && ex.rateOrder.variables.length > 0 ? [`No base form number extracted — the rate order was read for the "${targetForm}" column (the platform fallback); verify the target form.`] : []),
      ...unresolved.map(u => `UNRESOLVED [${u.stage}/${u.kind}] ${u.name}: ${u.reason} (cited: ${u.citation})`),
    ],
    unmappedColumns: [],
    sheetsRecognized: [`rate order · ${ex.rateOrder.variables.length} variables`, `manual · ${ex.manual.rules.length} rules`, `policy form · ${ex.baseFormNumber}`],
    sheetsSkipped: [],
    defects: [],
    notices: [],
  }

  const plan: ImportPlan = {
    productId, product, products: [product], coverages, forms, rules, formRules: [],
    ratingProgram, ldTables, rtTables, summary,
  }

  // ── Review sections + the conservation count ──
  const review = {
    product:   sectionOf([{ section: 'product', label: product.data['name'] as string, refId: productRefId, docId: productId, confidence: 0.9, citation: `Base form ${ex.baseFormNumber} ${ex.baseFormEdition}; ${state} filing` }]),
    coverages: sectionOf(coverageItems, ex.policyForm.coverages.note),
    tables:    sectionOf(tableItems),
    rules:     sectionOf(ruleItems),
    rating:    sectionOf(ratingItems),
  }

  // Conservation: EVERY rate-order variable became a step or an unresolved item (the
  // target-form filter runs inside the ledger — F22), and every policy-form
  // coverage/form/rule + manual eligibility draft landed as an entity.
  // The appended MIN_FLOOR is a manual-rule product-level attribute (not a rate-order variable),
  // so it is excluded from both sides of the ledger. proposed === accepted + unresolved.
  // The two program-level manual rules (minimum premium, maximum credit) are proposals
  // too: accepted when they produce the MIN_FLOOR step / creditFloor attribute,
  // unresolved otherwise — they must not sit outside the ledger (a min-premium rule
  // with no floor for the target form used to break proposed === accepted + unresolved).
  const proposed =
    ex.rateOrder.variables.length +
    ex.policyForm.coverages.items.length +
    ex.policyForm.forms.items.length +
    ex.policyForm.rules.items.length +
    ex.manual.rules.filter(r => r.ruleDraft).length +
    (minPremRule ? 1 : 0) +
    (creditCapRule ? 1 : 0)
  const stepsFromVars = steps.filter(s => s.op !== 'MIN_FLOOR').length
  const acceptedProgramRules = (minPremRule && minPremResolved ? 1 : 0) + (creditCapRule && creditFloor !== undefined ? 1 : 0)
  const counts = { proposed, accepted: stepsFromVars + coverages.length + forms.length + rules.length + acceptedProgramRules, unresolved: unresolved.length }

  return { plan, filingState: state, baseFormNumber: ex.baseFormNumber, baseFormEdition: ex.baseFormEdition, review, unresolved, counts }
}

// ─── tiny helpers ────────────────────────────────────────────────────────────────

function stepReview(v: RateOrderVariable, detail: string): FilingReviewItem {
  return { section: 'rating', label: v.name, confidence: v.confidence, citation: v.citation, detail }
}
function unres(v: RateOrderVariable, reason: string): UnresolvedItem {
  return { stage: 'rateOrder', kind: v.op === 'MUL' ? 'multiplicative-step' : 'additive-step', name: v.name, reason, citation: v.citation }
}
function sectionOf(items: FilingReviewItem[], note?: string): FilingReviewSection { return note ? { items, note } : { items } }

/** The numeric form code shared across a filing's naming conventions — the rate order writes
 *  "HO3", the manual writes "LEM 03", the policy form footer writes "LEM 03 05 23"
 *  (number + edition glued): all resolve to code 3. The code is the FIRST NON-ZERO digit
 *  run — leading "00" runs are ISO padding ("PP 00 01" → 1) and trailing runs are edition
 *  dates ("05 23"), never the form family. */
function formCode(s: string): number | null {
  const m = s.match(/\d+/g)
  if (!m) return null
  for (const run of m) { const n = parseInt(run, 10); if (n !== 0) return n }
  return 0
}

/** Whether a rate-order variable's form label covers the target form: exact match
 *  (case-insensitive) first, then the numeric form-code bridge — the same
 *  cross-notation join pickFormScalar uses ("HO3" ↔ "LEM 03" ↔ "HO 00 03"). */
function formMatchesTarget(form: string, target: string): boolean {
  const f = form.trim().toUpperCase()
  const t = target.trim().toUpperCase()
  if (!f || !t) return false
  if (f === t) return true
  const fc = formCode(f), tc = formCode(t)
  return fc !== null && tc !== null && fc === tc
}

/** Pick a manual scalar for a specific form (min premium per form / max-credit per form),
 *  matching on the numeric form code so "HO3" finds the "LEM 03" row. Falls back to a form-less
 *  scalar, then to the sole scalar. */
function pickFormScalar(rule: ManualRule, form: string): number | null {
  const scalars = rule.scalars ?? []
  const target = formCode(form)
  if (target !== null) {
    const byForm = scalars.find(s => s.form && formCode(s.form) === target)
    if (byForm) return byForm.value
  }
  const formless = scalars.find(s => !s.form)
  if (formless) return formless.value
  return scalars.length === 1 ? scalars[0]!.value : null
}

function distinctColumnValues(parsed: ParsedTable, col: string): string[] {
  const out: string[] = []
  for (const r of parsed.rows) { const d = String(r[col] ?? ''); if (d !== '' && !out.includes(d)) out.push(d) }
  return out
}
