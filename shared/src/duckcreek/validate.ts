// duckcreek/validate.ts — validates a serialized Duck Creek document against the PDM it
// came from and produces a machine-readable report. Three layers, matching the task:
//   (a) well-formedness — the emitted XML re-parses cleanly (parseXml is strict);
//   (b) structural consistency — the sample's vocabulary + namespace are present and every
//       id carries the correct type-prefix letter, with no duplicate ids;
//   (c) round-trip — parse the XML back and assert the SAME coverage / limit / deductible /
//       option / form / rating-program / step / table / rule set and refIds as the PDM,
//       so nothing was silently dropped.
// Pure — no platform imports.
import type { PdmProduct } from '../pdm/types'
import { flattenCoverages, allTerms } from '../pdm/types'
import { parseXml, findAll, attr, everyNode, type XmlNode } from './xml'
import { DEFAULT_DUCKCREEK_MAPPING, type DuckCreekMapping, type DcNodeType } from './mapping'

export interface SectionCount {
  section:  string
  expected: number
  emitted:  number
  ok:       boolean
}

export interface RefMismatch {
  section: string
  refId:   string
}

export interface ValidationIssue {
  severity: 'error' | 'warning'
  code:     string
  message:  string
}

export interface ValidationReport {
  ok:                  boolean
  wellFormed:          boolean
  namespaceDeclared:   boolean
  idPrefixesValid:     boolean
  crossRefsValid:      boolean   // every options.cid points at a real coverage id
  roundTripOk:         boolean
  requiredFieldsPresent: boolean // mandatory elements/attributes per the mapping are present
  enumsValid:          boolean   // coded attributes carry values from their allowed set
  numericFormatsValid: boolean   // premiums, limits and factors parse as numbers
  counts:              SectionCount[]
  missingRefIds:       RefMismatch[]   // in the PDM but absent from the XML (dropped)
  extraRefIds:         RefMismatch[]   // in the XML but not in the PDM (invented)
  duplicateIds:        string[]        // GUID collisions
  issues:              ValidationIssue[]
}

// ─── Allowed value sets (mirror the PDM union types) ──────────────────────────
const ENUM_REQUIREMENT  = new Set(['MANDATORY', 'OPTIONAL'])
const ENUM_RATING_OP    = new Set(['SET', 'MUL', 'ADD', 'MIN_FLOOR'])
const ENUM_SOURCE_TYPE  = new Set(['RT', 'LD', 'INPUT', 'CONST', 'SPP'])
const ENUM_RULE_TYPE    = new Set(['ELIGIBILITY', 'COVERAGE', 'RATING', 'FORM_ATTACH'])
const ENUM_VALUE_TYPE   = new Set(['FLAT', 'PERCENT', 'SPLIT', 'CSL', 'SCHEDULED', 'WAITING_PERIOD', 'FLAG'])
const ENUM_BOOL         = new Set(['0', '1'])
// Value types whose emitted <value> text must be a finite number (SPLIT is "a/b"; FLAG is empty).
const NUMERIC_VALUE_TYPES = new Set(['FLAT', 'PERCENT', 'CSL', 'WAITING_PERIOD'])

/** A finite number in plain (non-exponential-required) decimal form. */
function isNumeric(s: string | undefined): boolean {
  if (s === undefined || s.trim() === '') return false
  return Number.isFinite(Number(s))
}

// The element that anchors each id-bearing node type, for the prefix-letter audit.
const ID_BEARING: Array<{ type: DcNodeType; elementKey: keyof DuckCreekMapping['elements'] }> = [
  { type: 'product',       elementKey: 'product' },
  { type: 'line',          elementKey: 'line' },
  { type: 'risk',          elementKey: 'risk' },
  { type: 'coverage',      elementKey: 'coverage' },
  { type: 'limit',         elementKey: 'limit' },
  { type: 'deductible',    elementKey: 'deductible' },
  { type: 'option',        elementKey: 'options' },
  { type: 'statCode',      elementKey: 'statCode' },
  { type: 'exposure',      elementKey: 'exposure' },
  { type: 'indicator',     elementKey: 'indicator' },
  { type: 'form',          elementKey: 'form' },
  { type: 'ratingProgram', elementKey: 'program' },
  { type: 'ratingStep',    elementKey: 'step' },
  { type: 'factorTable',   elementKey: 'table' },
  { type: 'rule',          elementKey: 'rule' },
  { type: 'validValue',    elementKey: 'value' },
]

// Sample-vocabulary elements we require to be present (structural consistency).
const REQUIRED_VOCAB: Array<keyof DuckCreekMapping['elements']> = [
  'manuscript', 'product', 'line', 'risk', 'coverage', 'statCode', 'limit',
  'validValues', 'value', 'options', 'forms', 'form', 'formNumber', 'rating',
  'program', 'step', 'factorTables', 'table', 'rules', 'rule', 'states',
]

/** Collect refId attributes for every element with the given tag name. */
function refIdsFor(root: XmlNode, tag: string, refAttr: string): string[] {
  return findAll(root, tag).map(n => attr(n, refAttr)).filter((r): r is string => r !== undefined)
}

function diff(section: string, expected: string[], emitted: string[]): {
  count: SectionCount; missing: RefMismatch[]; extra: RefMismatch[]
} {
  const eSet = new Set(emitted)
  const xSet = new Set(expected)
  const missing = expected.filter(r => !eSet.has(r)).map(refId => ({ section, refId }))
  const extra   = emitted.filter(r => !xSet.has(r)).map(refId => ({ section, refId }))
  return {
    count: { section, expected: expected.length, emitted: emitted.length, ok: missing.length === 0 && extra.length === 0 },
    missing,
    extra,
  }
}

/** Validate a serialized document against its source PDM. Never throws on a bad document —
 *  a malformed doc is reported as `wellFormed: false` with the parse error captured. */
export function validateDuckCreek(
  product: PdmProduct,
  xml: string,
  mapping: DuckCreekMapping = DEFAULT_DUCKCREEK_MAPPING,
): ValidationReport {
  const E = mapping.elements
  const A = mapping.attrs
  const issues: ValidationIssue[] = []

  // (a) well-formedness
  let root: XmlNode
  try {
    root = parseXml(xml)
  } catch (err) {
    return {
      ok: false, wellFormed: false, namespaceDeclared: false, idPrefixesValid: false,
      crossRefsValid: false, roundTripOk: false,
      requiredFieldsPresent: false, enumsValid: false, numericFormatsValid: false,
      counts: [], missingRefIds: [], extraRefIds: [],
      duplicateIds: [],
      issues: [{ severity: 'error', code: 'not-well-formed', message: String((err as Error).message) }],
    }
  }

  // (b1) namespace declared on the root
  const nsAttr = `xmlns:${mapping.namespace.prefix}`
  const namespaceDeclared = attr(root, nsAttr) === mapping.namespace.uri
  if (!namespaceDeclared) {
    issues.push({ severity: 'error', code: 'namespace-missing', message: `Root is missing ${nsAttr}="${mapping.namespace.uri}".` })
  }

  // (b2) required sample vocabulary present
  for (const key of REQUIRED_VOCAB) {
    if (findAll(root, E[key]).length === 0) {
      issues.push({ severity: 'error', code: 'vocab-missing', message: `Expected element <${E[key]}> is absent.` })
    }
  }

  // (b3) id-prefix conventions + duplicate ids
  let idPrefixesValid = true
  const allIds: string[] = []
  for (const { type, elementKey } of ID_BEARING) {
    const letter = mapping.idPrefix[type]
    for (const node of findAll(root, E[elementKey])) {
      const idVal = attr(node, A.id)
      if (idVal === undefined) continue
      allIds.push(idVal)
      if (!idVal.startsWith(letter)) {
        idPrefixesValid = false
        issues.push({
          severity: 'error', code: 'id-prefix',
          message: `<${E[elementKey]}> id "${idVal}" should start with "${letter}".`,
        })
      }
    }
  }
  // Duplicate ids across the whole document (GUID collisions).
  const everyId = everyNode(root).map(n => attr(n, A.id)).filter((v): v is string => v !== undefined)
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const idv of everyId) { if (seen.has(idv)) dupes.add(idv); else seen.add(idv) }
  const duplicateIds = [...dupes]
  for (const d of duplicateIds) issues.push({ severity: 'error', code: 'duplicate-id', message: `Duplicate id "${d}".` })

  // (b4) options.cid referential integrity — every cid must point at a real coverage id.
  const coverageIds = new Set(
    findAll(root, E.coverage).map(n => attr(n, A.id)).filter((v): v is string => v !== undefined),
  )
  let crossRefsValid = true
  for (const opt of findAll(root, E.options)) {
    const cid = attr(opt, A.cid)
    if (cid !== undefined && !coverageIds.has(cid)) {
      crossRefsValid = false
      issues.push({ severity: 'error', code: 'cid-dangling', message: `<${E.options}> cid "${cid}" matches no coverage id.` })
    }
  }

  // (c) round-trip: expected (PDM) vs emitted (parsed XML) sets, by refId
  const covs   = flattenCoverages(product.coverages)
  const terms  = allTerms(product)
  const steps  = product.ratingPrograms.flatMap(p => p.steps)

  const sections: Array<{ section: string; expected: string[]; emittedTag: string }> = [
    { section: 'coverages',      expected: covs.map(c => c.refId),                                   emittedTag: E.coverage },
    { section: 'limits',         expected: terms.filter(t => t.kind === 'LIMIT').map(t => t.refId),  emittedTag: E.limit },
    { section: 'deductibles',    expected: terms.filter(t => t.kind === 'DEDUCTIBLE').map(t => t.refId), emittedTag: E.deductible },
    { section: 'options',        expected: terms.filter(t => t.kind === 'OPTION').map(t => t.refId), emittedTag: E.options },
    { section: 'forms',          expected: product.forms.map(f => f.refId),                          emittedTag: E.form },
    { section: 'rules',          expected: product.rules.map(r => r.refId),                          emittedTag: E.rule },
    { section: 'ratingPrograms', expected: product.ratingPrograms.map(p => p.refId),                 emittedTag: E.program },
    { section: 'ratingSteps',    expected: steps.map(s => s.refId),                                  emittedTag: E.step },
    { section: 'ratingTables',   expected: product.ratingTables.map(t => t.refId),                   emittedTag: E.table },
  ]

  const counts: SectionCount[] = []
  const missingRefIds: RefMismatch[] = []
  const extraRefIds: RefMismatch[] = []
  for (const s of sections) {
    const emitted = refIdsFor(root, s.emittedTag, A.refId)
    const d = diff(s.section, s.expected, emitted)
    counts.push(d.count)
    missingRefIds.push(...d.missing)
    extraRefIds.push(...d.extra)
  }

  const roundTripOk = counts.every(c => c.ok) && missingRefIds.length === 0 && extraRefIds.length === 0
  for (const m of missingRefIds) issues.push({ severity: 'error', code: 'dropped-node', message: `${m.section}: refId "${m.refId}" was dropped (in PDM, not in XML).` })
  for (const x of extraRefIds) issues.push({ severity: 'error', code: 'extra-node', message: `${x.section}: refId "${x.refId}" is in the XML but not the PDM.` })

  // (d) FAIL-CLOSED field validation — required presence, enum membership, numeric format.
  //     Every violation is a field-level error the ExportMenu surfaces; a single one flips
  //     ok=false so the modal never lets silently-invalid XML download.
  const req = (cond: boolean, code: string, message: string): void => {
    if (!cond) issues.push({ severity: 'error', code, message })
  }

  // (d1) required top-level identity
  const msPattern = /^[A-Za-z]+(_[A-Za-z]+)*_[A-Z]{2}_\d+_\d+_\d+_\d+$/
  const rootMs = attr(root, A.manuScriptID)
  req(rootMs !== undefined && msPattern.test(rootMs), 'missing-manuscriptid',
    `Root <${E.manuscript}> must carry a well-formed ${A.manuScriptID}.`)
  req(findAll(root, E.lineOfBusiness).some(n => (n.text ?? '').trim() !== ''), 'missing-lob',
    `Expected a non-empty <${E.lineOfBusiness}> (line of business).`)
  const riskTableIds = findAll(root, E.riskTableManuScriptId)
  req(riskTableIds.length > 0, 'missing-risk-tables',
    `Expected at least one <${E.riskTableManuScriptId}> (state-scoped tables manuscript).`)
  for (const rt of riskTableIds) {
    req(msPattern.test((rt.text ?? '').trim()), 'bad-risk-table-id',
      `<${E.riskTableManuScriptId}> "${(rt.text ?? '').trim()}" is not a well-formed manuScriptID.`)
  }

  // (d2) coverages — caption present, requirement enum, boolean indicators well-formed
  for (const cov of findAll(root, E.coverage)) {
    const ref = attr(cov, A.refId) ?? attr(cov, A.id) ?? '?'
    const caption = cov.children.find(c => c.name === E.caption)
    req(!!caption && (caption.text ?? '').trim() !== '', 'missing-caption',
      `Coverage "${ref}" is missing a non-empty <${E.caption}>.`)
    const reqVal = attr(cov, A.req)
    if (reqVal !== undefined) {
      req(ENUM_REQUIREMENT.has(reqVal), 'enum-requirement',
        `Coverage "${ref}" has ${A.req}="${reqVal}" (not MANDATORY|OPTIONAL).`)
    }
    for (const b of [A.ind, A.premiumGenerating]) {
      const v = attr(cov, b)
      if (v !== undefined) req(ENUM_BOOL.has(v), 'enum-bool', `Coverage "${ref}" ${b}="${v}" must be 0 or 1.`)
    }
  }

  // (d3) endorsement indicators — ismandatory boolean
  for (const ind of findAll(root, E.indicator)) {
    const v = attr(ind, A.endorsementMandatory)
    if (v !== undefined) req(ENUM_BOOL.has(v), 'enum-bool', `<${E.indicator}> ${A.endorsementMandatory}="${v}" must be 0 or 1.`)
  }

  // (d4) eligible values — valueType enum + numeric where the type is a scalar number
  for (const v of findAll(root, E.value)) {
    const vt = attr(v, A.valueType)
    if (vt !== undefined) {
      req(ENUM_VALUE_TYPE.has(vt), 'enum-valuetype', `<${E.value}> ${A.valueType}="${vt}" is not a known value type.`)
      if (NUMERIC_VALUE_TYPES.has(vt)) {
        req(isNumeric(v.text), 'nonnumeric-value',
          `<${E.value}> of type ${vt} must be numeric (got "${v.text ?? ''}").`)
      }
    }
  }

  // (d5) rating steps — op + sourceType enums, numeric const/roundTo when present
  for (const step of findAll(root, E.step)) {
    const ref = attr(step, A.refId) ?? '?'
    const op = attr(step, A.op)
    req(op !== undefined && ENUM_RATING_OP.has(op), 'enum-op', `Rating step "${ref}" op="${op ?? ''}" is not SET|MUL|ADD|MIN_FLOOR.`)
    const st = attr(step, A.sourceType)
    req(st !== undefined && ENUM_SOURCE_TYPE.has(st), 'enum-sourcetype', `Rating step "${ref}" ${A.sourceType}="${st ?? ''}" is not RT|LD|INPUT|CONST|SPP.`)
    const cv = attr(step, A.constValue)
    if (cv !== undefined) req(isNumeric(cv), 'nonnumeric-const', `Rating step "${ref}" ${A.constValue}="${cv}" must be numeric.`)
    const rt2 = attr(step, A.roundTo)
    if (rt2 !== undefined) req(isNumeric(rt2), 'nonnumeric-roundto', `Rating step "${ref}" ${A.roundTo}="${rt2}" must be numeric.`)
  }

  // (d6) rating programs — minimumPremium numeric
  for (const prog of findAll(root, E.program)) {
    const mp = attr(prog, A.minimumPremium)
    if (mp !== undefined) req(isNumeric(mp), 'nonnumeric-minpremium', `Program "${attr(prog, A.refId) ?? '?'}" ${A.minimumPremium}="${mp}" must be numeric.`)
  }

  // (d7) rules — ruleType enum
  for (const rule of findAll(root, E.rule)) {
    const rtv = attr(rule, A.ruleType)
    req(rtv !== undefined && ENUM_RULE_TYPE.has(rtv), 'enum-ruletype', `Rule "${attr(rule, A.refId) ?? '?'}" ${A.ruleType}="${rtv ?? ''}" is not a known rule type.`)
  }

  // (d8) forms — non-empty form number
  for (const form of findAll(root, E.form)) {
    const fn = form.children.find(c => c.name === E.formNumber)
    req(!!fn && (fn.text ?? '').trim() !== '', 'missing-formnumber',
      `Form "${attr(form, A.refId) ?? '?'}" is missing a non-empty <${E.formNumber}>.`)
  }

  // (d9) premium quintet — every emitted premium child must be numeric
  for (const cov of findAll(root, E.coverage)) {
    for (const child of cov.children) {
      if (mapping.premiumChildren.includes(child.name)) {
        req(isNumeric(child.text), 'nonnumeric-premium',
          `Coverage "${attr(cov, A.refId) ?? '?'}" <${child.name}> must be numeric (got "${child.text ?? ''}").`)
      }
    }
  }

  // Bucket the field-validation issues by category so each dimension reports independently.
  const codeCat = (code: string): 'required' | 'enum' | 'numeric' | 'other' =>
    code.startsWith('missing-') || code === 'bad-risk-table-id' ? 'required'
    : code.startsWith('enum-') ? 'enum'
    : code.startsWith('nonnumeric-') ? 'numeric'
    : 'other'
  const codes = issues.map(i => i.code)
  const requiredFieldsPresent = !codes.some(c => codeCat(c) === 'required')
  const enumsValid            = !codes.some(c => codeCat(c) === 'enum')
  const numericFormatsValid   = !codes.some(c => codeCat(c) === 'numeric')

  const ok =
    namespaceDeclared && idPrefixesValid && crossRefsValid && roundTripOk &&
    requiredFieldsPresent && enumsValid && numericFormatsValid &&
    duplicateIds.length === 0 &&
    !issues.some(i => i.severity === 'error')

  return {
    ok,
    wellFormed: true,
    namespaceDeclared,
    idPrefixesValid,
    crossRefsValid,
    roundTripOk,
    requiredFieldsPresent,
    enumsValid,
    numericFormatsValid,
    counts,
    missingRefIds,
    extraRefIds,
    duplicateIds,
    issues,
  }
}

/** Convenience: build a one-line human summary of a report (for logs / CLI). */
export function summarizeReport(report: ValidationReport): string {
  const total = report.counts.reduce((n, c) => n + c.emitted, 0)
  const status = report.ok ? 'PASS' : 'FAIL'
  const sect = report.counts.map(c => `${c.section}=${c.emitted}/${c.expected}`).join(' ')
  return `[${status}] wellFormed=${report.wellFormed} ns=${report.namespaceDeclared} ids=${report.idPrefixesValid} cids=${report.crossRefsValid} roundTrip=${report.roundTripOk} required=${report.requiredFieldsPresent} enums=${report.enumsValid} numeric=${report.numericFormatsValid} nodes=${total} · ${sect}`
}
