// readWorkbook.ts — the platform (browser) side of the ISO importer: turns uploaded
// .xlsx File objects into the plain 2-D cell grids that the pure @pf/shared mapper
// consumes. This is the only part of the import path that touches exceljs / the DOM;
// all mapping logic stays platform-free in shared/src/insurance/isoImport.ts.
import ExcelJS from 'exceljs'
import type { IsoCell, IsoGrid } from '@pf/shared'

/** Flatten an exceljs cell value (which may be rich text, a formula result, a
 *  hyperlink or a date) into a scalar the mapper can reason about. */
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

/** Read one workbook into a grid per worksheet. */
async function readOne(file: File): Promise<IsoGrid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const grids: IsoGrid[] = []
  wb.eachSheet(ws => {
    const cells: IsoCell[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const rowObj = ws.getRow(r)
      const arr: IsoCell[] = []
      for (let c = 1; c <= ws.columnCount; c++) arr[c - 1] = flatten(rowObj.getCell(c).value)
      cells[r - 1] = arr
    }
    grids.push({ sheet: ws.name, file: file.name, cells })
  })
  return grids
}

/** Read one or more ISO template workbooks into a single flat list of sheet grids
 *  (the mapper locates the sheets it needs by name, so file order is irrelevant). */
export async function readWorkbooks(files: File[] | FileList): Promise<IsoGrid[]> {
  const list = Array.from(files)
  const perFile = await Promise.all(list.map(readOne))
  return perFile.flat()
}
