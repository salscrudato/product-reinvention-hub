// Workbook cell hygiene: every cell that touches a workbook passes safeCellValue.
//
// Formula-injection guard: a string beginning with =, +, -, @ (or an embedded
// control prefix) is neutralized with a leading apostrophe — the standard
// spreadsheet convention for "literal text". Numbers, booleans and null pass
// through untouched; nothing in the golden pair trips the guard (proven by the
// byte-lockstep test), so lockstep and safety coexist.

import type { CellValue, SheetModel, WorkbookModel } from './types'

const FORMULA_PREFIX = /^[=+\-@\t\r]/

export function safeCellValue(v: CellValue): CellValue {
  if (typeof v !== 'string') return v
  return FORMULA_PREFIX.test(v) ? `'${v}` : v
}

export function newSheet(name: string): SheetModel {
  return { name, rows: new Map() }
}

export function setCell(sheet: SheetModel, row: number, col: number, value: CellValue): void {
  if (value === null || value === '') return
  let r = sheet.rows.get(row)
  if (!r) {
    r = new Map()
    sheet.rows.set(row, r)
  }
  r.set(col, safeCellValue(value))
}

export function setRow(sheet: SheetModel, row: number, values: CellValue[], startCol = 1): void {
  values.forEach((v, i) => setCell(sheet, row, startCol + i, v))
}

export function getCell(wb: WorkbookModel, sheetName: string, row: number, col: number): CellValue {
  const sheet = wb.sheets.find((s) => s.name === sheetName)
  return sheet?.rows.get(row)?.get(col) ?? null
}
