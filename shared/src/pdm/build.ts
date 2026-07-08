// pdm/build.ts — the deterministic builder that projects our domain model into the PDM.
// Pure + reproducible: same bundle in ⇒ byte-identical PDM out (no clocks, no randomness,
// no Firebase). Reuses the canonical term logic (`resolveTermOptions`, `deriveStructure`,
// `deriveBasis`) and grid logic (`deriveGridModel`) already trusted by the app + rating
// stack, so the PDM's eligible-value lists and table dimensions match what the product
// actually offers — nothing invented.
import type {
  Product, Coverage, CoverageTerm, Form, Rule, FormRule,
  RatingProgram, RTTable, LDTable, StandardOption,
} from '../types'
import type { LobDefinition } from '../insurance/lobRegistry'
import { resolveTermOptions, formatOption, deriveStructure, deriveBasis } from '../insurance/terms'
import { deriveGridModel, inferValueColumn } from '../rating/rtGrid'
import type {
  PdmProduct, PdmCoverage, PdmTerm, PdmEligibleValue, PdmForm, PdmRule,
  PdmRatingProgram, PdmRatingStep, PdmRatingTable, PdmApplicability, PdmRuleType,
  PdmValueTypeKind,
} from './types'

// ─── Bundle: everything the builder needs for one product ─────────────────────
// The seed constants satisfy these base domain types structurally, so callers hand the
// builder the real seed data with no adapter shim.

export interface DomainProductBundle {
  product:       Product
  lob:           LobDefinition
  coverages:     Coverage[]
  forms:         Form[]
  rules:         Rule[]
  formRules:     FormRule[]
  ratingProgram: RatingProgram
  rtTables:      Record<string, RTTable>
  ldTables:      Record<string, LDTable>
}

export interface BuildPdmOptions {
  /** Optional policy effective date (ISO yyyy-mm-dd). When supplied it flows onto every
   *  node's applicability and is emitted downstream; when omitted, no date is fabricated. */
  effectiveDate?: string
}

// ─── Small pure helpers ────────────────────────────────────────────────────────

/** Applicability from a StateScope-shaped object (+ optional effective date). */
function toApplicability(
  scope: { allStates: boolean; states: string[] },
  effectiveDate?: string,
): PdmApplicability {
  return {
    allStates: scope.allStates,
    states:    [...scope.states],
    ...(effectiveDate ? { effectiveDate } : {}),
  }
}

/** A PascalCase semantic key for a coverage/term, mirroring the sample's `t` term keys
 *  ("CoverageA", "BodilyInjuryLiability"). Uses the designator before a dash separator
 *  when present ("Coverage A — Dwelling" → "CoverageA"), else the whole name. */
function pascalKey(name: string): string {
  const head = name.split(/\s[—–-]\s/)[0] ?? name
  const words = head.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  const key = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  return key || 'Term'
}

/** Which LOB section a coverage belongs to (first matching predicate, else the last). */
function resolveSection(lob: LobDefinition, coverageName: string): string {
  const idx = lob.sections.findIndex(s => s.match(coverageName))
  const section = idx >= 0 ? lob.sections[idx] : lob.sections[lob.sections.length - 1]
  return section?.label ?? ''
}

// ─── Terms + eligible values ────────────────────────────────────────────────────

function toEligibleValue(o: StandardOption): PdmEligibleValue {
  // OptionValueType ⊂ PdmValueTypeKind (the latter only adds FLAG, which options never carry).
  const valueType = o.type as PdmValueTypeKind
  return {
    id:            o.id,
    label:         formatOption(o),
    value:         o.type === 'SPLIT' ? null : o.value,
    ...(o.type === 'SPLIT' && o.parts ? { parts: [...o.parts] } : {}),
    valueType,
    isDefault:     o.isDefault,
    enabled:       o.enabled,
    applicability: { allStates: o.allStates, states: [...o.states] },
    ...(o.constraintNote ? { constraintNote: o.constraintNote } : {}),
  }
}

function buildTerm(coverageRefId: string, term: CoverageTerm, ldTables: Record<string, LDTable>): PdmTerm {
  const ld = term.ldTableRef ? ldTables[term.ldTableRef] : undefined
  const options = resolveTermOptions(term, ld)
  return {
    refId:          `${coverageRefId}#${term.id}`,
    key:            term.id,
    termKey:        pascalKey(term.label),
    kind:           term.kind,
    label:          term.label,
    structure:      deriveStructure(term),
    basis:          deriveBasis(term),
    ...(term.unit ? { unit: term.unit } : {}),
    ...(term.min !== undefined ? { min: term.min } : {}),
    ...(term.max !== undefined ? { max: term.max } : {}),
    defaultValue:   term.default,
    ...(term.ldTableRef ? { ldTableRef: term.ldTableRef } : {}),
    eligibleValues: options.map(toEligibleValue),
    ...(term.notes ? { notes: term.notes } : {}),
    ...(term.constraintNote ? { constraintNote: term.constraintNote } : {}),
  }
}

// ─── Coverages (flat nodes → nested tree) ───────────────────────────────────────

function buildCoverageNode(
  cov: Coverage, lob: LobDefinition, ldTables: Record<string, LDTable>, effectiveDate?: string,
): PdmCoverage {
  const refId = cov.refId ?? ''
  return {
    refId,
    name:              cov.name,
    termKey:           pascalKey(cov.name),
    parentRefId:       cov.parentId,
    order:             cov.order,
    requirement:       cov.requirement,
    claimsBasis:       cov.claimsBasis,
    premiumGenerating: cov.premiumGenerating,
    source:            cov.source,
    formNumbers:       [...cov.formNumbers],
    section:           resolveSection(lob, cov.name),
    applicability:     toApplicability(cov, effectiveDate),
    terms:             cov.terms.map(t => buildTerm(refId, t, ldTables)),
    children:          [],
  }
}

/** Nest sub-coverages under their parent by `parentRefId`, sorting siblings by `order`
 *  so the tree is stable and diff-friendly regardless of input array order. */
function buildCoverageTree(
  coverages: Coverage[], lob: LobDefinition, ldTables: Record<string, LDTable>, effectiveDate?: string,
): PdmCoverage[] {
  const nodes = coverages.map(c => buildCoverageNode(c, lob, ldTables, effectiveDate))
  const byRef = new Map<string, PdmCoverage>(nodes.map(n => [n.refId, n]))
  const roots: PdmCoverage[] = []
  for (const n of nodes) {
    const parent = n.parentRefId ? byRef.get(n.parentRefId) : undefined
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  const sortByOrder = (list: PdmCoverage[]): void => {
    list.sort((a, b) => a.order - b.order)
    for (const c of list) sortByOrder(c.children)
  }
  sortByOrder(roots)
  return roots
}

// ─── Forms ──────────────────────────────────────────────────────────────────────

function buildForm(form: Form, effectiveDate?: string): PdmForm {
  const applicability = toApplicability(form, effectiveDate)
  return {
    refId:               form.number,
    formNumber:          form.number,
    name:                form.name,
    edition:             form.edition,
    editions:            [{ edition: form.edition, applicability }],
    category:            form.category,
    source:              form.source,
    admitted:            form.admitted,
    mandatoryDefault:    form.mandatoryDefault,
    attachmentCondition: form.attachmentCondition,
    dynamic:             form.dynamic,
    coverageParts:       [...form.coverageParts],
    applicability,
    description:         form.description,
    dynamicFields:       form.dynamicFields.map(d => ({
      name:      d.name,
      dataType:  d.dataType,
      repeating: d.repeating,
      ...(d.options ? { options: [...d.options] } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
    })),
  }
}

// ─── Rules (product rules + form-attach rules, unified as IF/THEN) ───────────────

function ruleTypeOf(rule: Rule): PdmRuleType {
  if (rule.category === 'RATING') return 'RATING'
  if (rule.category === 'FORMS')  return 'FORM_ATTACH'
  return /eligib/i.test(rule.subCategory) ? 'ELIGIBILITY' : 'COVERAGE'
}

function buildRule(rule: Rule, effectiveDate?: string): PdmRule {
  return {
    refId:          rule.refId ?? '',
    ruleType:       ruleTypeOf(rule),
    category:       rule.category,
    ...(rule.subCategory ? { subCategory: rule.subCategory } : {}),
    condition:      rule.condition,
    actions:        [rule.outcome],
    coverageRefIds: [...rule.coverageRefIds],
    formNumbers:    [...rule.formNumbers],
    ...(rule.ldTableRef ? { ldTableRef: rule.ldTableRef } : {}),
    applicability:  toApplicability(rule, effectiveDate),
  }
}

function buildFormRule(fr: FormRule, effectiveDate?: string): PdmRule {
  // FormRule carries no StateScope — it attaches by its own condition, all states.
  return {
    refId:          fr.refId ?? '',
    ruleType:       'FORM_ATTACH',
    category:       'FORMS',
    condition:      fr.condition,
    actions:        [fr.outcome],
    coverageRefIds: [],
    formNumbers:    [...fr.formNumbers],
    mandatory:      fr.mandatory,
    applicability:  toApplicability({ allStates: true, states: [] }, effectiveDate),
  }
}

// ─── Rating program + factor tables ──────────────────────────────────────────────

function buildStep(programRefId: string, step: RatingProgram['steps'][number]): PdmRatingStep {
  const src = step.source
  return {
    refId:      `${programRefId}#${step.id}`,
    key:        step.id,
    order:      step.order,
    label:      step.label,
    op:         step.op,
    sourceType: src.type,
    ...(src.ref !== undefined ? { tableRef: src.ref } : {}),
    ...(src.keys ? { inputKeys: [...src.keys] } : {}),
    ...(src.value !== undefined ? { constValue: src.value } : {}),
    ...(step.condition ? { condition: step.condition } : {}),
    ...(step.roundTo !== undefined ? { roundTo: step.roundTo } : {}),
  }
}

function buildRatingProgram(program: RatingProgram, effectiveDate?: string): PdmRatingProgram {
  return {
    refId:          program.refId,
    name:           program.name,
    minimumPremium: program.minimumPremium,
    applicability:  toApplicability(program, effectiveDate),
    steps:          [...program.steps]
      .sort((a, b) => a.order - b.order)
      .map(s => buildStep(program.refId, s)),
  }
}

function buildTable(refId: string, table: RTTable, kind: 'RT' | 'LD', defaultValue?: number): PdmRatingTable {
  const grid = deriveGridModel(table)
  return {
    refId,
    name:        table.name,
    kind,
    columns:     [...table.columns],
    valueColumn: table.valueColumn ?? inferValueColumn(table),
    dimensions:  grid ? grid.dimensions.map(d => ({ key: d.key, label: d.label, values: [...d.values] })) : [],
    rows:        table.rows.map(r => ({ ...r })),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  }
}

/** RT tables then LD tables, each sorted by refId — a stable, diffable ordering. */
function buildTables(rtTables: Record<string, RTTable>, ldTables: Record<string, LDTable>): PdmRatingTable[] {
  const rt = Object.keys(rtTables).sort().map(ref => buildTable(ref, rtTables[ref]!, 'RT'))
  const ld = Object.keys(ldTables).sort().map(ref => {
    const t = ldTables[ref]!
    // An LDTable ({ name, rows:[{label,value}] }) presents as an RTTable with a `value` column.
    const asRt: RTTable = { name: t.name, columns: ['label', 'value'], rows: t.rows.map(r => ({ ...r })) }
    return buildTable(ref, asRt, 'LD', t.defaultValue)
  })
  return [...rt, ...ld]
}

// ─── The builder ──────────────────────────────────────────────────────────────

export function buildPdm(bundle: DomainProductBundle, options: BuildPdmOptions = {}): PdmProduct {
  const { product, lob } = bundle
  const eff = options.effectiveDate

  return {
    refId:         product.refId ?? '',
    name:          product.name,
    description:   product.description,
    marketSegment: product.marketSegment,
    line: {
      refId:                lob.refId,
      code:                 lob.prefix,
      name:                 lob.name,
      compactName:          lob.name.replace(/\s+/g, ''),
      displayName:          lob.displayName,
      vertical:             lob.vertical,
      family:               lob.family,
      lineCategory:         lob.lineCategory,
      personalOrCommercial: lob.personalOrCommercial,
      perilModel:           {
        kind:           lob.perilModel.kind,
        eligibleStates: [...lob.perilModel.eligibleStates],
        label:          lob.perilModel.label,
      },
      sections:             lob.sections.map(s => ({ label: s.label, shortName: s.shortName })),
      footprintStates:      [...lob.footprintStates],
    },
    applicability:  toApplicability(product, eff),
    coverages:      buildCoverageTree(bundle.coverages, lob, bundle.ldTables, eff),
    forms:          bundle.forms.map(f => buildForm(f, eff)),
    rules:          [
      ...bundle.rules.map(r => buildRule(r, eff)),
      ...bundle.formRules.map(fr => buildFormRule(fr, eff)),
    ],
    ratingPrograms: [buildRatingProgram(bundle.ratingProgram, eff)],
    ratingTables:   buildTables(bundle.rtTables, bundle.ldTables),
  }
}
