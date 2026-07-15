// The GAP REPORT (spec §5 — the 17-row completeness & HITL inventory), X3.
//
// Non-interactive replacement for the cut HITL capture UI: every field a valid
// overlay needs is classified MAPPED (canonical source named), DEFAULTED (the
// spec's documented default rule applied — the rule is NAMED on each row, never
// invented), or MISSING (no value and no safe spec default). Any MISSING required
// field BLOCKS the export: flagged-not-dropped — nothing silently omitted,
// nothing silently fabricated.

import type { ExportInput, GapReport, GapRow } from './types'
import { isoDate, pascalCase } from './ids'
import { LOB_BASE_MANUSCRIPTS, RULES } from './spec'

export function buildGapReport(input: ExportInput): GapReport {
  const rows: GapRow[] = []
  const date = isoDate(input.now)
  const base = LOB_BASE_MANUSCRIPTS[input.product.lob.refId]

  // Row 1 — the one field that CANNOT be guessed (spec: "no default — export blocks").
  if (base) {
    rows.push({
      specRow: 1, field: 'Base manuscript id (properties@inherited + workbook ManuscriptID + MS Physical Path)',
      status: 'MAPPED', value: base,
      source: `spec §1.1 MUST per-LOB binding for ${input.product.lob.refId} (golden CoverageConfig·Config!C3 / TableConfig·Config!E2)`,
    })
  } else {
    rows.push({
      specRow: 1, field: 'Base manuscript id (properties@inherited + workbook ManuscriptID + MS Physical Path)',
      status: 'MISSING',
      detail: `no spec-pinned base manuscript for LOB ${input.product.lob.refId} (${input.product.lob.name}); tenant base-mapping memory is out of scope (BACKLOG) — spec §5 row 1: no default, export blocks`,
    })
  }

  rows.push({
    specRow: 2, field: 'Manuscript version block (versionID / version / versionDate)',
    status: 'DEFAULTED', rule: RULES.versionBlock, value: `1_0_0_0 / ${date}`,
    detail: 'the Hub Product model carries no version field',
  })
  rows.push({
    specRow: 3, field: 'family routing key', status: 'DEFAULTED', rule: RULES.family,
    value: pascalCase(input.tenantName),
  })
  rows.push({
    specRow: 4, field: 'Effective dates (keyInfo effectiveDateNew/Renewal; workbook EffectiveDate columns)',
    status: 'DEFAULTED', rule: RULES.effectiveDates, value: date,
    detail: 'the Hub Product model carries no effectiveDate; workbook cells left blank as observed',
  })
  rows.push({
    specRow: 5, field: 'State routing policy (one overlay vs per-state)',
    status: 'DEFAULTED', rule: RULES.statePolicy, value: 'US',
    source: `Hub states list (${input.product.states.length} states) MAPPED into the workbook State columns`,
  })

  const hasForms = input.forms.length > 0
  rows.push({
    specRow: 6, field: 'Forms physical templates (subdoc@name/@path)',
    status: hasForms ? 'DEFAULTED' : 'MAPPED',
    ...(hasForms
      ? { rule: RULES.formTemplates, detail: `${input.forms.length} form(s) stubbed <FormNumber>.doc with empty path` }
      : { source: 'no forms on the product — nothing to stub' }),
  })
  rows.push({
    specRow: 7, field: 'mergeField placeholder maps',
    status: hasForms ? 'DEFAULTED' : 'MAPPED',
    ...(hasForms
      ? { rule: RULES.mergeFields }
      : { source: 'no forms on the product' }),
  })
  rows.push({ specRow: 8, field: 'Tax binding', status: 'DEFAULTED', rule: RULES.taxBinding })
  rows.push({ specRow: 9, field: 'Hand-authored pages', status: 'DEFAULTED', rule: RULES.handAuthoredPages })

  const optionTermCount = input.coverages.reduce((n, c) => n + c.terms.filter((t) =>
    (t.ldTableRef && input.ldTables[t.ldTableRef]?.rows.length) || (t.options && t.options.length > 1)).length, 0)
  rows.push({
    specRow: 10, field: 'Full option sets exceeding CoverageConfig cells',
    status: 'MAPPED',
    source: `coverage term value lists (LD tables / term options) → overlay definition/options on ${optionTermCount} generated input(s)`,
  })
  rows.push({ specRow: 11, field: 'Cultures / multiCurrency', status: 'DEFAULTED', rule: RULES.cultures, value: 'absent (en-US, single currency)' })
  rows.push({ specRow: 12, field: 'Base roll-up behavior (model@defaultValue)', status: 'DEFAULTED', rule: RULES.baseRollup })
  rows.push({ specRow: 13, field: 'class vocabularies (class/fldClass/capClass)', status: 'DEFAULTED', rule: RULES.classVocab, value: '(never emitted)' })
  rows.push({ specRow: 14, field: 'Properties engine flags (boolean/fieldCache/shortCircuitCond)', status: 'DEFAULTED', rule: RULES.engineFlags, value: 'boolean=1 fieldCache=1 shortCircuitCond=1' })
  rows.push({ specRow: 15, field: 'dataSchema', status: 'DEFAULTED', rule: RULES.dataSchema, value: '""' })
  rows.push({ specRow: 16, field: 'Express widget/version (CoverageConfig Config!C8/C9)', status: 'DEFAULTED', rule: RULES.expressWidget, value: 'Coverages / 2' })

  const freeTextRules = input.rules.length + input.formRules.length
  rows.push({
    specRow: 17, field: 'Rule free-text compilation',
    status: freeTextRules > 0 ? 'DEFAULTED' : 'MAPPED',
    ...(freeTextRules > 0
      ? { rule: RULES.ruleFreeText, detail: `${input.rules.length} product rule(s) + ${input.formRules.length} form rule(s) ride as text/HITL — never compiled to logic` }
      : { source: 'no governed rules on the product' }),
  })

  const missing = rows.filter((r) => r.status === 'MISSING')
  return {
    productRefId: input.product.refId ?? '(unsaved product)',
    rows,
    missing,
    blocked: missing.length > 0,
    counts: {
      mapped: rows.filter((r) => r.status === 'MAPPED').length,
      defaulted: rows.filter((r) => r.status === 'DEFAULTED').length,
      missing: missing.length,
    },
  }
}
