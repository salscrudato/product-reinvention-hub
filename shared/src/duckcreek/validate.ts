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
  ok:                boolean
  wellFormed:        boolean
  namespaceDeclared: boolean
  idPrefixesValid:   boolean
  crossRefsValid:    boolean   // every options.cid points at a real coverage id
  roundTripOk:       boolean
  counts:            SectionCount[]
  missingRefIds:     RefMismatch[]   // in the PDM but absent from the XML (dropped)
  extraRefIds:       RefMismatch[]   // in the XML but not in the PDM (invented)
  duplicateIds:      string[]        // GUID collisions
  issues:            ValidationIssue[]
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
      crossRefsValid: false, roundTripOk: false, counts: [], missingRefIds: [], extraRefIds: [],
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

  const ok =
    namespaceDeclared && idPrefixesValid && crossRefsValid && roundTripOk &&
    duplicateIds.length === 0 &&
    !issues.some(i => i.severity === 'error')

  return {
    ok,
    wellFormed: true,
    namespaceDeclared,
    idPrefixesValid,
    crossRefsValid,
    roundTripOk,
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
  return `[${status}] wellFormed=${report.wellFormed} ns=${report.namespaceDeclared} ids=${report.idPrefixesValid} cids=${report.crossRefsValid} roundTrip=${report.roundTripOk} nodes=${total} · ${sect}`
}
