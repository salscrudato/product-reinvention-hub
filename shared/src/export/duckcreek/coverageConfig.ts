// Unity CoverageConfig workbook producer (spec §3.2–§3.3, XE-03 — BUILT here;
// no prior transform ever existed in code or git history).
//
// Structural golden: docs/export-templates/PA_PROD_001_CoverageConfig (1).xlsx —
// three sheets (Coverage, Config, InputFields); the byte-lockstep test in
// tests/export/golden-workbooks.test.ts pins every cell.

import type { ExportInput, WorkbookModel } from './types'
import { coverageDisplayName, fieldId, manuscriptFileName } from './ids'
import { newSheet, setRow } from './cells'
import { EXPRESS_CONFIG } from './spec'

export function buildCoverageConfig(input: ExportInput, baseManuscriptId: string): WorkbookModel {
  const fileName = manuscriptFileName(baseManuscriptId)

  // ── Coverage sheet ───────────────────────────────────────────────────────────
  const coverage = newSheet('Coverage')
  setRow(coverage, 1, [
    'RequirementID', 'CoverageName', 'Description', 'Path', 'CoverageType',
    'ShowCondition', 'SubCoverages', 'State', 'Transaction',
  ])
  const byRefId = new Map(input.coverages.map((c) => [c.refId, c]))
  let r = 1
  for (const cov of input.coverages) {
    r++
    const display = coverageDisplayName(cov.name)
    const children = input.coverages.filter((c) => c.parentId === cov.refId)
    setRow(coverage, r, [
      cov.refId,
      display,
      null,
      `coverage[Type="${display}"]`,
      cov.parentId === null ? 'LineCoverages' : 'SubCoverage',
      null,
      children.length > 0 ? children.map((c) => coverageDisplayName(c.name)).join('; ') : null,
      cov.states.join(', '),
      null,
    ])
    if (cov.parentId !== null && !byRefId.has(cov.parentId)) {
      throw new Error(`coverage ${cov.refId}: parentId ${cov.parentId} not in the export set`)
    }
  }

  // ── Config sheet ─────────────────────────────────────────────────────────────
  const config = newSheet('Config')
  setRow(config, 1, ['Component', 'Description', 'Value'])
  setRow(config, 2, ['LOB', null, input.product.lob.name])
  setRow(config, 3, ['ManuscriptID', null, fileName])
  setRow(config, 4, ['ParentGroupID'])
  setRow(config, 5, ['ImplementRuleInThisManuScript'])
  setRow(config, 6, ['ImplementRuleInThisGroup'])
  setRow(config, 7, ['TriggeringManuScript'])
  setRow(config, 8, ['Widget', null, EXPRESS_CONFIG.widget])
  setRow(config, 9, ['ExpressVersion', null, EXPRESS_CONFIG.expressVersion])

  // ── InputFields sheet — one row per coverage term ────────────────────────────
  const inputFields = newSheet('InputFields')
  setRow(inputFields, 1, [
    'CoverageID', 'PageSet', 'PageID', 'FieldName', 'FieldID', 'FieldCaption',
    'Author', 'PublicOrPrivate', 'FieldValue', 'ValueType', 'ControlType',
    'FieldDefault', 'GroupType', 'HideCondition', 'Rules', 'ReadOnly',
  ])
  r = 1
  for (const cov of input.coverages) {
    const display = coverageDisplayName(cov.name)
    for (const term of cov.terms) {
      r++
      setRow(inputFields, r, [
        display,
        'MainInterview',
        display,
        term.label,
        fieldId(display, term.label),
        `${display} ${term.label}`,
        null,
        'Public',
        null,
        'Constant',
        term.kind === 'OPTION' ? 'Dropdown' : 'Textbox',
        String(term.default),
        'Input',
        null,
        null,
        null,
      ])
    }
  }

  return { sheets: [coverage, config, inputFields] }
}
