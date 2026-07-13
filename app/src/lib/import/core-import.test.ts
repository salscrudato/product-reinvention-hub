// core-import.test.ts — regression anchor for the ISO Core workbook (CORE.PRD dialect).
// STEP 1: written as a FAILING test to lock the root causes before the fix.
// Asserts mapIsoWorkbook handles Product_Specifications_Core_07_13_2026.xlsx correctly.

import { describe, it, expect, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import type { IsoCell, IsoGrid } from '@pf/shared'
import { mapIsoWorkbook } from '@pf/shared'

const __dir   = dirname(fileURLToPath(import.meta.url))
const REPO    = resolve(__dir, '../../../../')
const FIXTURE = resolve(REPO, 'samples/iso/Product_Specifications_Core_07_13_2026.xlsx')

function flatten(v: ExcelJS.CellValue): IsoCell {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if (Array.isArray(o['richText']))
      return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
    if ('result' in o) { const r = o['result']; return typeof r === 'object' ? null : (r as IsoCell) }
    if ('hyperlink' in o) return String(o['text'] ?? o['hyperlink'] ?? '')
    if ('text' in o) return String(o['text'])
  }
  return null
}

// Same phantom-cell guard as readWorkbook.ts: ws.rowCount/columnCount include
// style-only phantom cells (some ISO books format whole columns, inflating rowCount
// to 1,048,576). We find the true data bounds first, then materialize only that region.
async function readWorkbookNode(filePath: string): Promise<IsoGrid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const grids: IsoGrid[] = []
  wb.eachSheet(ws => {
    let maxRow = 0, maxCol = 0
    ws.eachRow({ includeEmpty: false }, (rowObj, rowNumber) => {
      let lastCol = 0
      rowObj.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
        if (colNumber > lastCol) lastCol = colNumber
      })
      if (lastCol > 0) {
        if (rowNumber > maxRow) maxRow = rowNumber
        if (lastCol > maxCol) maxCol = lastCol
      }
    })
    const cells: IsoCell[][] = []
    for (let r = 1; r <= maxRow; r++) {
      const rowObj = ws.getRow(r)
      const arr: IsoCell[] = []
      for (let c = 1; c <= maxCol; c++) arr[c - 1] = flatten(rowObj.getCell(c).value)
      cells[r - 1] = arr
    }
    grids.push({ sheet: ws.name, file: filePath, cells })
  })
  return grids
}

let grids: IsoGrid[] = []

beforeAll(async () => {
  grids = await readWorkbookNode(FIXTURE)
}, 60_000)

describe('Core workbook import — CORE.PRD dialect (STEP 1 regression anchor)', () => {
  it('mapIsoWorkbook does NOT throw', () => {
    expect(() => mapIsoWorkbook(grids)).not.toThrow()
  })

  it('returns a well-formed ImportPlan with all arrays defined (never undefined)', () => {
    const plan = mapIsoWorkbook(grids)
    expect(Array.isArray(plan.coverages)).toBe(true)
    expect(Array.isArray(plan.forms)).toBe(true)
    expect(Array.isArray(plan.rules)).toBe(true)
    expect(Array.isArray(plan.formRules)).toBe(true)
    expect(Array.isArray(plan.ldTables)).toBe(true)
    expect(Array.isArray(plan.rtTables)).toBe(true)
  })

  it('product is not null (>= 1 product identified)', () => {
    const plan = mapIsoWorkbook(grids)
    expect(plan.product).not.toBeNull()
  })

  it('product refId is CORE.PRD.001 verbatim (CORE.PRD dialect, not synthesized)', () => {
    const plan = mapIsoWorkbook(grids)
    expect(plan.product?.refId).toBe('CORE.PRD.001')
  })

  it('"Core Framework" sheet recognized (authoritative over "<Name> Product Framework" decoy)', () => {
    const plan = mapIsoWorkbook(grids)
    expect(plan.summary.sheetsRecognized).toContain('Core Framework')
  })

  it('coverages extracted from Core Framework (>= 1)', () => {
    const plan = mapIsoWorkbook(grids)
    expect(plan.coverages.length).toBeGreaterThan(0)
  })
})
