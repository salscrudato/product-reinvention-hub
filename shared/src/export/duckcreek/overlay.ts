// The ManuScript OVERLAY emitter (spec §1–§4, XE-01).
//
// The overlay is a DELTA on the inherited base chain — abstract scaffolding is
// re-declared (no override attribute, per the observed SP3 shape), restatements of
// ids the bundle's own CoverageConfig generates carry override="1" (spec §5 row 10
// "override of the generated input"), and everything else is net-new and traced in
// the export manifest. Rates NEVER ride here: the overlay only emits the lookup
// wiring that consumes the TableConfig workbook tables (spec §3.6).

import type { Coverage, CoverageTerm, Form, FormRule, RatingStep } from '../../types'
import type { ExportInput, ManifestHitlNote } from './types'
import { el, serialize, type XmlNode } from './xml'
import {
  coverageDisplayName, fieldId, isoDate, overlayManuscriptId, pascalCase, tableDcId,
} from './ids'
import { CULTURE, DEFAULT_STATE_KEY, ENGINE_FLAGS, PRODUCT_CODE, RULES, SCAFFOLD_CHAIN } from './spec'

// ─── Result ───────────────────────────────────────────────────────────────────

export interface OverlayResult {
  xml:      string
  root:     XmlNode
  fileName: string
  manuscriptID: string
  /** Every net-new id → the Hub refId (or `<refId>#<part>` synthetic role) it traces to. */
  ids:      Record<string, string>
  /** CoverageConfig-generated ids the overlay restates with override="1". */
  overriddenGeneratedIds: string[]
  hitl:     ManifestHitlNote[]
}

interface Ctx {
  input: ExportInput
  baseManuscriptId: string
  ids: Record<string, string>
  overridden: string[]
  hitl: ManifestHitlNote[]
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function dcScalarType(values: unknown[]): 'int' | 'float' | 'string' {
  if (values.length > 0 && values.every((v) => typeof v === 'number')) {
    return values.every((v) => Number.isInteger(v)) ? 'int' : 'float'
  }
  return 'string'
}

function coveragePath(displayName: string): string {
  return `coverage[Type="${displayName}"]`
}

/** Alnum-lowercase identity normalization for term-id ↔ rating-input-key matching. */
function normId(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '').toLowerCase()
}

function comment(text: string): XmlNode {
  return { name: '#comment', attrs: {}, children: [], text }
}

// ─── Term inputs (the CoverageConfig-generated set C) ─────────────────────────

interface TermInput {
  coverage: Coverage
  term: CoverageTerm
  displayName: string
  dcId: string
  type: 'int' | 'float' | 'string' | 'boolean'
  /** Full canonical option list (LD rows or term.options) — beyond the default. */
  options: { value: string | number; caption: string }[] | null
}

function termInputs(input: ExportInput): TermInput[] {
  const out: TermInput[] = []
  for (const cov of input.coverages) {
    const displayName = coverageDisplayName(cov.name)
    for (const term of cov.terms) {
      const dcId = fieldId(displayName, term.label)
      const ld = term.ldTableRef ? input.ldTables[term.ldTableRef] : undefined
      let options: TermInput['options'] = null
      if (ld && ld.rows.length > 0) {
        options = ld.rows.map((r) => ({ value: r.value, caption: r.label }))
      } else if (term.options && term.options.length > 1) {
        options = term.options.map((o) => ({ value: o, caption: String(o) }))
      }
      const type: TermInput['type'] =
        typeof term.default === 'boolean' ? 'boolean'
        : options ? dcScalarType(options.map((o) => o.value))
        : typeof term.default === 'number' ? (Number.isInteger(term.default) ? 'int' : 'float')
        : 'string'
      out.push({ coverage: cov, term, displayName, dcId, type, options })
    }
  }
  return out
}

// ─── properties + keys (spec §3.1) ────────────────────────────────────────────

function buildProperties(ctx: Ctx): XmlNode {
  const { input } = ctx
  const manuscriptID = overlayManuscriptId(input.tenantName, input.product.refId ?? 'PRODUCT')
  const date = isoDate(input.now)
  const props = el('properties', {
    manuscriptID,
    versionID: manuscriptID,
    versionDate: date,
    version: '1',
    boolean: ENGINE_FLAGS.boolean,
    fieldCache: ENGINE_FLAGS.fieldCache,
    shortCircuitCond: ENGINE_FLAGS.shortCircuitCond,
    cultureCode: CULTURE.cultureCode,
    cultureName: CULTURE.cultureName,
    caption: input.product.name,
    inherited: ctx.baseManuscriptId,
    image: '',
    dataSchema: '',
  })
  // inheritedPage is deliberately ABSENT: pages inherit from the same parent
  // (spec §1.1 MUST — the Hub overlay does not hand-author presentation).
  props.children.push(el('notes'))
  const keys = el('keys')
  const keyInfo = (name: string, value: string) => keys.children.push(el('keyInfo', { name, value }))
  keyInfo('family', pascalCase(input.tenantName))
  keyInfo('lob', pascalCase(input.product.lob.name))
  keyInfo('state', DEFAULT_STATE_KEY)
  keyInfo('version', '1.0.0.0')
  keyInfo('effectiveDateNew', date)
  keyInfo('effectiveDateRenewal', date)
  keyInfo('masterID', 'None')
  keyInfo('productCode', PRODUCT_CODE)
  props.children.push(keys)
  return props
}

// ─── Coverage term-option overrides (spec §3.3 + §5 row 10) ───────────────────

function buildCoverageOverrides(ctx: Ctx): XmlNode[] {
  const out: XmlNode[] = []
  for (const ti of termInputs(ctx.input)) {
    if (!ti.options) continue // default-only terms ride the workbook alone
    const covObjId = pascalCase(ti.displayName)
    const inputObjId = `${covObjId}Input`
    const fieldPath = ti.dcId.slice(ti.dcId.indexOf('.') + 1)

    const definition = el('definition')
    definition.children.push(el('caption', { value: `${ti.displayName} ${ti.term.label}` }))
    const options = el('options')
    for (const o of ti.options) {
      const attrs: Record<string, string> = { value: String(o.value), caption: o.caption }
      if (String(o.value) === String(ti.term.default)) attrs.default = '1'
      options.children.push(el('option', attrs))
    }
    definition.children.push(options)

    const rules = el('rules')
    rules.children.push(el('default', { value: String(ti.term.default) }))
    if (ti.term.min !== undefined) rules.children.push(el('minimum', { value: String(ti.term.min) }))
    if (ti.term.max !== undefined) rules.children.push(el('maximum', { value: String(ti.term.max) }))

    // Conservative full restatement of the generated input (spec §1.2 Open Q2 binding).
    const pub = el('public', {
      id: ti.dcId, path: fieldPath, type: ti.type, override: '1',
      comment: ti.coverage.refId ?? '',
    }, [definition, rules])

    const inputObj = el('object', { id: inputObjId, override: '1' }, [pub])
    const covObj = el('object', { id: covObjId, path: coveragePath(ti.displayName) }, [inputObj])
    ctx.ids[covObjId] = ti.coverage.refId ?? ''
    ctx.overridden.push(inputObjId, ti.dcId)
    out.push(covObj)
  }
  return out
}

// ─── Rating chain (spec §3.5) ─────────────────────────────────────────────────

interface RatingIdMap {
  /** rating-input key → resolvable dc id (C member or net-new overlay input). */
  byKey: Map<string, { id: string; type: 'int' | 'float' | 'string' | 'boolean' }>
}

function buildRatingInputs(ctx: Ctx, productPascal: string): { node: XmlNode | null; map: RatingIdMap } {
  const map: RatingIdMap = { byKey: new Map() }
  const { input } = ctx
  const container = el('object', { id: `${productPascal}Input` })
  const termsByNorm = new Map<string, TermInput>()
  for (const ti of termInputs(input)) termsByNorm.set(normId(ti.term.id), ti)

  for (const spec of input.ratingInputSpec) {
    const matched = termsByNorm.get(normId(spec.key))
    if (matched) {
      // The Hub links this rating driver to a coverage term — reuse the
      // CoverageConfig-generated input id rather than duplicating the field.
      map.byKey.set(spec.key, { id: matched.dcId, type: matched.type })
      continue
    }
    // Net-new overlay input, traced to the rating program's canonical input spec.
    const id = `${productPascal}Input.${pascalCase(spec.label)}`
    const type: 'int' | 'float' | 'string' | 'boolean' =
      spec.kind === 'boolean' ? 'boolean'
      : spec.options ? dcScalarType(spec.options.map((o) => o.value))
      : spec.kind === 'number' ? 'float' : 'string'
    const definition = el('definition', {}, [el('caption', { value: spec.label })])
    if (spec.options && spec.options.length > 0) {
      const options = el('options')
      for (const o of spec.options) options.children.push(el('option', { value: String(o.value), caption: o.label }))
      definition.children.push(options)
    }
    const pub = el('public', { id, path: id.slice(id.indexOf('.') + 1), type, comment: `rating-input:${spec.key}` }, [definition])
    if (type === 'boolean') pub.children.push(el('rules', {}, [el('default', { idref: 'False' })]))
    container.children.push(pub)
    ctx.ids[id] = `${ctx.input.ratingProgram?.refId ?? 'RATING'}#input.${spec.key}`
    ctx.hitl.push({
      kind: 'rating-input-binding', target: id, note: RULES.ratingInputBinding, specRow: 1,
    })
    map.byKey.set(spec.key, { id, type })
  }
  if (container.children.length === 0) return { node: null, map }
  ctx.ids[`${productPascal}Input`] = `${ctx.input.ratingProgram?.refId ?? 'RATING'}#inputs`
  return { node: container, map }
}

function lookupFor(ctx: Ctx, step: RatingStep, inputMap: RatingIdMap): XmlNode {
  const table = step.source.ref ? ctx.input.rtTables[step.source.ref] : undefined
  if (!table || !step.source.ref) throw new Error(`rating step ${step.id}: RT source without a table`)
  const valueColumn = table.valueColumn ?? table.columns[table.columns.length - 1]!
  const lookup = el('lookup', {}, [
    el('tableRef', { value: tableDcId(table.name) }),
    el('fieldRef', { value: valueColumn }),
  ])
  for (const key of step.source.keys ?? []) {
    const driver = inputMap.byKey.get(key)
    if (!driver) throw new Error(`rating step ${step.id}: driver input "${key}" has no resolvable id`)
    const colValues = table.rows.map((r) => r[key])
    lookup.children.push(el('keyRef', { idref: driver.id, type: dcScalarType(colValues), name: key }))
  }
  return lookup
}

function electionCondition(electionId: string): XmlNode {
  return el('condition', {}, [
    el('comparison', { compare: 'eq' }, [
      el('operand', { idref: electionId, type: 'boolean' }),
      el('operand', { idref: 'True', type: 'boolean' }),
    ]),
  ])
}

/** Rounding = multiply-by-1 with round/roundType, the observed corpus shape. */
function roundingArgument(roundTo: number, ctx: Ctx, target: string): XmlNode {
  const nearest = roundTo === 0 ? '1' : String(10 ** -roundTo)
  if (roundTo !== 0) {
    ctx.hitl.push({ kind: 'rounding-semantics', target, note: RULES.roundNearest })
  }
  return el('argument', { op: 'multiply', round: nearest, roundType: 'round', type: 'int', value: '1' })
}

function buildRatingChain(ctx: Ctx, productPascal: string, inputMap: RatingIdMap): XmlNode[] {
  const program = ctx.input.ratingProgram
  if (!program) return []
  const privId = `${productPascal}Private`
  const outId = `${productPascal}Output`
  const subId = `${productPascal}Subtotals`
  const privObj = el('object', { id: privId })
  ctx.ids[privId] = `${program.refId}#privates`

  const steps = [...program.steps].sort((a, b) => a.order - b.order)
  let prevRun: string | null = null
  let nn = 0
  for (const step of steps) {
    nn++
    const tag = String(nn).padStart(2, '0')
    const stepId = `${privId}.Step${tag}_${pascalCase(step.label)}`
    const runId = `${privId}.Run${tag}`

    // 1. The step's own producer (lookup / const), possibly gated by an election.
    let producer: XmlNode
    if (step.source.type === 'RT') {
      producer = el('value', {}, [lookupFor(ctx, step, inputMap)])
    } else if (step.source.type === 'CONST') {
      producer = el('value', { value: String(step.source.value ?? 0) })
    } else if (step.source.type === 'LD') {
      // LD-backed step: the selected value IS the driver input's value.
      const driver = inputMap.byKey.get(step.source.keys?.[0] ?? '')
      if (!driver) throw new Error(`rating step ${step.id}: LD driver unresolved`)
      producer = el('value', { idref: driver.id })
    } else if (step.source.type === 'INPUT') {
      const driver = inputMap.byKey.get(step.source.ref ?? '')
      if (!driver) throw new Error(`rating step ${step.id}: INPUT driver unresolved`)
      producer = el('value', { idref: driver.id })
    } else {
      throw new Error(`rating step ${step.id}: source type ${step.source.type} is not emittable (spec §3.5)`)
    }

    let stepNode: XmlNode
    if (step.condition) {
      const driver = inputMap.byKey.get(step.condition)
      if (!driver) throw new Error(`rating step ${step.id}: condition input "${step.condition}" unresolved`)
      // Conditional step: Amount private + gate private (value-XOR-idref keeps the
      // lookup out of <then>, so the amount gets its own private).
      const amountId = `${stepId}_Amount`
      privObj.children.push(el('private', { id: amountId, caption: '', type: 'float', comment: `${program.refId}#${step.id}.amount` }, [producer]))
      ctx.ids[amountId] = `${program.refId}#${step.id}.amount`
      stepNode = el('private', { id: stepId, caption: '', type: 'float', comment: `${program.refId}#${step.id}` }, [
        el('value', {}, [
          el('if', {}, [
            electionCondition(driver.id),
            el('then', { idref: amountId }),
            el('else', { value: '0', type: 'float' }),
          ]),
        ]),
        el('worksheet', {}, [el('caption', { value: step.label })]),
      ])
    } else {
      stepNode = el('private', { id: stepId, caption: '', type: 'float', comment: `${program.refId}#${step.id}` }, [
        producer,
        el('worksheet', {}, [el('caption', { value: step.label })]),
      ])
    }
    privObj.children.push(stepNode)
    ctx.ids[stepId] = `${program.refId}#${step.id}`

    // 2. The running total — each run consumes its predecessor, preserving the
    // ROC order as a dependency chain (spec §3.5 "dependency-driven").
    let runNode: XmlNode
    if (step.op === 'SET' || prevRun === null) {
      const calc = el('calculation', {}, [el('argument', { op: 'eq', idref: stepId, type: 'float' })])
      if (step.roundTo !== undefined) calc.children.push(roundingArgument(step.roundTo, ctx, runId))
      runNode = el('private', { id: runId, caption: '', type: 'float', comment: `${program.refId}#${step.id} running total` }, [el('value', {}, [calc])])
    } else if (step.op === 'MIN_FLOOR') {
      // max(prev, floor): if prev > floor then prev else floor (compare="gt" is
      // the observed comparison vocabulary; "lt" is not observed in the corpus).
      const ifNode = el('if', {}, [
        el('condition', {}, [
          el('comparison', { compare: 'gt' }, [
            el('operand', { idref: prevRun, type: 'float' }),
            el('operand', { idref: stepId, type: 'float' }),
          ]),
        ]),
        el('then', { idref: prevRun }),
        el('else', { idref: stepId }),
      ])
      runNode = el('private', { id: runId, caption: '', type: 'float', comment: `${program.refId}#${step.id} running total` }, [el('value', {}, [ifNode])])
      if (step.roundTo !== undefined) {
        // if-shaped runs cannot carry a rounding argument — chain a rounded head.
        privObj.children.push(runNode)
        ctx.ids[runId] = `${program.refId}#${step.id}.run`
        const roundedId = `${runId}Rounded`
        const calc = el('calculation', {}, [
          el('argument', { op: 'eq', idref: runId, type: 'float' }),
          roundingArgument(step.roundTo, ctx, roundedId),
        ])
        const rounded = el('private', { id: roundedId, caption: '', type: 'float', comment: `${program.refId}#${step.id} rounded` }, [el('value', {}, [calc])])
        privObj.children.push(rounded)
        ctx.ids[roundedId] = `${program.refId}#${step.id}.rounded`
        prevRun = roundedId
        continue
      }
    } else {
      const opWord = step.op === 'MUL' ? 'multiply' : 'add'
      const calc = el('calculation', {}, [
        el('argument', { op: 'eq', idref: prevRun, type: 'float' }),
        el('argument', { op: opWord, idref: stepId, type: 'float' }),
      ])
      if (step.roundTo !== undefined) calc.children.push(roundingArgument(step.roundTo, ctx, runId))
      runNode = el('private', { id: runId, caption: '', type: 'float', comment: `${program.refId}#${step.id} running total` }, [el('value', {}, [calc])])
    }
    privObj.children.push(runNode)
    ctx.ids[runId] = `${program.refId}#${step.id}.run`
    prevRun = runId
  }

  const nodes: XmlNode[] = [privObj]

  // Per-line premium output referencing the chain head (spec §3.5).
  if (prevRun) {
    const premiumId = `${outId}.Premium`
    const outObj = el('object', { id: outId }, [
      el('public', { id: premiumId, path: 'Premium', type: 'float', comment: program.refId }, [
        el('rules', {}, [el('value', { idref: prevRun })]),
      ]),
    ])
    ctx.ids[outId] = `${program.refId}#output`
    ctx.ids[premiumId] = program.refId
    nodes.push(outObj)

    // Roll-up (spec §5 row 12, GUESSED: emit own roll-up mirroring SP3:2288).
    const subPremId = `${subId}.Premium`
    const subObj = el('object', { id: subId }, [
      el('private', { id: subPremId, caption: '', type: 'float', comment: `${program.refId}#rollup HITL:GUESSED` }, [
        el('value', {}, [
          el('iterator', { type: 'float', scope: 'all', action: 'sum', includeDeleted: '1', idref: 'Line' }, [
            el('reference', { idref: premiumId, type: 'float' }),
          ]),
        ]),
        el('worksheet', {}, [el('caption', { value: `Total ${ctx.input.product.name} Premium` })]),
      ]),
    ])
    ctx.ids[subId] = `${program.refId}#rollup`
    ctx.ids[subPremId] = `${program.refId}#rollup.premium`
    ctx.hitl.push({ kind: 'base-rollup', target: subPremId, note: RULES.baseRollup, specRow: 12 })
    nodes.push(subObj)
  }
  return nodes
}

// ─── Forms (spec §3.8) ────────────────────────────────────────────────────────

function formDocName(form: Form): string {
  return `${form.number.replace(/\s+/g, '')}_${form.edition.replace(/\s+/g, '')}`
}

/**
 * Compile a form rule's attachment condition when it is the mechanical
 * coverage-elected case; otherwise return null (GUESSED stub, spec §3.8).
 */
function compileFormCondition(ctx: Ctx, rule: FormRule): { electionId: string } | null {
  const m = rule.condition.match(/^(.*?)\s+elected\b/i)
  if (!m) return null
  const needle = m[1]!.trim().toLowerCase()
  for (const ti of termInputs(ctx.input)) {
    if (ti.term.kind !== 'OPTION' || !/elected/i.test(ti.term.label)) continue
    const dn = ti.displayName.toLowerCase()
    if (dn.includes(needle) || needle.includes(dn)) return { electionId: ti.dcId }
  }
  return null
}

function buildForms(ctx: Ctx): { formsPrivate: XmlNode | null; documents: XmlNode | null } {
  const { input } = ctx
  if (input.forms.length === 0) return { formsPrivate: null, documents: null }
  const formsPrivate = el('object', { id: 'FormsPrivate' })
  const documents = el('documents')

  const rulesByForm = new Map<string, FormRule>()
  for (const fr of input.formRules) {
    for (const num of fr.formNumbers) if (!rulesByForm.has(num)) rulesByForm.set(num, fr)
  }

  for (const form of input.forms) {
    const setName = formDocName(form)
    const formKey = form.number.replace(/\s+/g, '')
    const printDefault = form.mandatoryDefault ? 'Mandatory' : 'Selected'

    let condition = ''
    if (!form.mandatoryDefault && form.attachmentCondition === 'RULE') {
      const showId = `FormsPrivate.Show_${formKey}`
      const rule = rulesByForm.get(form.number)
      const compiled = rule ? compileFormCondition(ctx, rule) : null
      if (compiled) {
        formsPrivate.children.push(el('private', { id: showId, caption: '', type: 'int', comment: rule?.refId ?? '' }, [
          el('value', {}, [
            el('if', {}, [
              electionCondition(compiled.electionId),
              el('then', { value: '1', type: 'int' }),
              el('else', { value: '0', type: 'int' }),
            ]),
          ]),
        ]))
      } else {
        // Free-text (or absent) condition: GUESSED stub returning 1 — flagged, never compiled.
        formsPrivate.children.push(comment(`HITL:GUESSED attachment condition for ${form.number} — ${rule ? `"${rule.condition}"` : 'no form rule found'} is not mechanically compilable (${RULES.formCondition})`))
        formsPrivate.children.push(el('private', { id: showId, caption: '', type: 'int', comment: `${rule?.refId ?? form.number} HITL:GUESSED` }, [
          el('value', { value: '1' }),
        ]))
        ctx.hitl.push({ kind: 'form-condition', target: showId, note: `${RULES.formCondition} — condition: ${rule ? JSON.stringify(rule.condition) : '(none)'}` })
      }
      ctx.ids[showId] = rule?.refId ?? `${form.number}#condition`
      condition = showId
    }

    const attrs: Record<string, string> = { name: setName, paperBinNum: '0', printDefault, prevPage: '' }
    if (condition) attrs.condition = condition
    const docSet = el('documentSet', attrs)
    docSet.children.push(el('scope', { name: 'Line', increment: '1', startIter: '1', endIter: '*' }))
    // Physical template + merge map are HITL (spec §5 rows 6–7) — GUESSED stubs.
    docSet.children.push(comment(`HITL:GUESSED physical template for ${form.number} (${RULES.formTemplates})`))
    docSet.children.push(el('document', {}, [el('subdoc', { name: `${form.number}.doc`, path: '' })]))
    docSet.children.push(el('merge', {}, [
      el('mergeField', { name: 'AccountName', idref: 'AccountInput.Name', iter: '1', formatValue: '' }),
      el('mergeField', { name: 'PolicyNumber', idref: 'PolicyOutput.PolicyNumber', iter: '1', formatValue: '' }),
    ]))
    documents.children.push(docSet)
    ctx.ids[setName] = form.number
    ctx.hitl.push({ kind: 'form-template', target: setName, note: `${RULES.formTemplates} — ${form.number} ed. ${form.edition}`, specRow: 6 })
    ctx.hitl.push({ kind: 'merge-fields', target: setName, note: RULES.mergeFields, specRow: 7 })
  }
  ctx.ids['FormsPrivate'] = 'forms#conditions'
  return {
    formsPrivate: formsPrivate.children.length > 0 ? formsPrivate : null,
    documents: documents.children.length > 0 ? documents : null,
  }
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

export function buildOverlay(input: ExportInput, baseManuscriptId: string): OverlayResult {
  const ctx: Ctx = {
    input, baseManuscriptId,
    ids: {}, overridden: [], hitl: [],
  }
  const productPascal = pascalCase(input.product.name)

  const properties = buildProperties(ctx)
  const coverageNodes = buildCoverageOverrides(ctx)
  const { node: ratingInputs, map: inputMap } = buildRatingInputs(ctx, productPascal)
  const ratingNodes = buildRatingChain(ctx, productPascal, inputMap)
  const { formsPrivate, documents } = buildForms(ctx)

  // The abstract scaffold chain, re-declared exactly as observed (SP3:956-959 +
  // 1738): model → data → Policy → Line → LineCoverages. Abstract restatements
  // carry NO override attribute (the observed SP3 shape; lint clause 3).
  const lineChildren: XmlNode[] = []
  if (coverageNodes.length > 0) {
    lineChildren.push(el('object', { id: 'LineCoverages', abstract: '1' }, coverageNodes))
  }
  if (ratingInputs) lineChildren.push(ratingInputs)
  lineChildren.push(...ratingNodes)
  if (formsPrivate) lineChildren.push(formsPrivate)

  const model = el('model', {}, [
    el('object', { id: SCAFFOLD_CHAIN[0], abstract: '1' }, [
      el('object', { id: SCAFFOLD_CHAIN[1], abstract: '1' }, [
        el('object', { id: SCAFFOLD_CHAIN[2], abstract: '1' }, lineChildren),
      ]),
    ]),
  ])

  const root = el('ManuScript', {}, [properties, model])
  if (documents) root.children.push(documents)

  const manuscriptID = properties.attrs.manuscriptID!
  return {
    xml: serialize(root),
    root,
    fileName: `${manuscriptID}.xml`,
    manuscriptID,
    ids: ctx.ids,
    overriddenGeneratedIds: ctx.overridden,
    hitl: ctx.hitl,
  }
}

/** The CoverageConfig-generated id set C: input-object containers + field ids. */
export function coverageConfigIds(input: ExportInput): Set<string> {
  const c = new Set<string>()
  for (const cov of input.coverages) {
    const dn = coverageDisplayName(cov.name)
    for (const term of cov.terms) {
      const id = fieldId(dn, term.label)
      c.add(id)
      c.add(id.slice(0, id.indexOf('.')))
    }
  }
  return c
}
