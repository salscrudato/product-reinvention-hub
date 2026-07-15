#!/usr/bin/env tsx
// Phase G diagnostic: parse a holdout (or source) workbook set and print entity
// counts, warnings, and per-sheet header rows. Read-only; not part of any gate.
import ExcelJS from 'exceljs'
import { mapIsoWorkbook } from '@pf/shared'
import type { IsoCell, IsoGrid } from '@pf/shared'

function flatten(v: ExcelJS.CellValue): IsoCell {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if (Array.isArray(o['richText'])) return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
    if ('result' in o) { const r = o['result']; return typeof r === 'object' ? null : (r as IsoCell) }
    if ('hyperlink' in o) return String(o['text'] ?? o['hyperlink'] ?? '')
    if ('text' in o) return String(o['text'])
  }
  return null
}
async function readGrids(filePath: string): Promise<IsoGrid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const grids: IsoGrid[] = []
  wb.eachSheet(ws => {
    const cells: IsoCell[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const rowObj = ws.getRow(r)
      const arr: IsoCell[] = []
      for (let c = 1; c <= ws.columnCount; c++) arr[c - 1] = flatten(rowObj.getCell(c).value)
      cells[r - 1] = arr
    }
    grids.push({ sheet: ws.name, file: filePath, cells })
  })
  return grids
}

const files = process.argv.slice(2).filter(a => !a.startsWith('--'))
const grids = (await Promise.all(files.map(readGrids))).flat()
if (process.argv.includes('--headers')) {
  for (const g of grids) {
    console.log(`\n== ${g.sheet} (${g.cells.length} rows) ==`)
    for (let r = 0; r < Math.min(6, g.cells.length); r++) {
      console.log(` r${r}:`, JSON.stringify((g.cells[r] ?? []).slice(0, 14)).slice(0, 220))
    }
  }
}
const plan = mapIsoWorkbook(grids)
console.log('\nproducts:', plan.products.length, '| coverages:', plan.coverages.length, '| forms:', plan.forms.length,
  '| rules:', plan.rules.length, '| formRules:', plan.formRules.length, '| ld:', plan.ldTables.length, '| rt:', plan.rtTables.length)
console.log('recognized:', plan.summary.sheetsRecognized)
console.log('skipped:', plan.summary.sheetsSkipped)
console.log('warnings:', plan.summary.warnings.slice(0, 8))
console.log('coverage sample:', plan.coverages.slice(0, 4).map(c => `${c.refId} req=${String(c.data['requirement'])}`))
