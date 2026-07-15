// Unity TableConfig workbook producer (spec §3.4, XE-03 — BUILT here).
//
// The 23-sheet shape of the golden: TOC first, one sheet per rating table
// (preamble rows 4–7 repeated across every used column, header row 8, data 9+),
// Config manifest LAST with the TableName | EffectiveDate | EffectiveDateRenewal |
// IsVersion | ManuscriptID | SheetName | State Applicable columns. Effective-date
// cells stay BLANK as observed (spec §5 row 4). Rates ride HERE — the overlay
// only references (spec §3.6).

import type { RTTable } from '../../types'
import type { CellValue, SheetModel, WorkbookModel } from './types'
import { manuscriptFileName, manuscriptPhysicalPath, tableSheetName } from './ids'
import { newSheet, setCell, setRow } from './cells'
import { MS_PHYSICAL_PATH_ROOT } from './spec'

export interface TableConfigInput {
  /** Tables in workbook order — sheet ordinals are 1-based positions. */
  tables: RTTable[]
  baseManuscriptId: string
  /** The `State Applicable` cell, one list for the whole bundle (observed shape). */
  statesJoined: string
}

function tableSheet(t: RTTable, ordinal: number, baseManuscriptId: string): SheetModel {
  const sheet = newSheet(tableSheetName(t.name, ordinal))
  const width = t.columns.length
  const preamble: [number, string][] = [
    [4, `MS Physical Path: ${manuscriptPhysicalPath(baseManuscriptId, MS_PHYSICAL_PATH_ROOT)}`],
    [5, `Manuscript ID: ${manuscriptFileName(baseManuscriptId)}`],
    [6, 'Comments:'],
    [7, `${t.name} — Table Type: Rating Table`],
  ]
  for (const [row, text] of preamble) {
    for (let c = 1; c <= width; c++) setCell(sheet, row, c, text)
  }
  setRow(sheet, 8, t.columns)
  let r = 8
  for (const row of t.rows) {
    r++
    setRow(sheet, r, t.columns.map((col) => (row[col] ?? null) as CellValue))
  }
  return sheet
}

export function buildTableConfig(input: TableConfigInput): WorkbookModel {
  const fileName = manuscriptFileName(input.baseManuscriptId)

  const toc = newSheet('TOC')
  setRow(toc, 2, ['Manuscript ID', 'Table Name', 'Complexity', 'State Applicable', 'Comment'], 4)

  const config = newSheet('Config')
  setRow(config, 1, [
    'TableName', 'EffectiveDate', 'EffectiveDateRenewal', 'IsVersion',
    'ManuscriptID', 'SheetName', 'State Applicable',
  ])

  const sheets: SheetModel[] = [toc]
  let ordinal = 0
  for (const t of input.tables) {
    ordinal++
    sheets.push(tableSheet(t, ordinal, input.baseManuscriptId))
    setRow(toc, 2 + ordinal, [fileName, t.name, 'Simple', input.statesJoined, null], 4)
    setRow(config, 1 + ordinal, [
      t.name, null, null, 'no', fileName, tableSheetName(t.name, ordinal), input.statesJoined,
    ])
  }
  sheets.push(config)
  return { sheets }
}
