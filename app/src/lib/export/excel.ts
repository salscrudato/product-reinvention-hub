// excel.ts — client-side workbook export (exceljs). One workbook whose four
// sheets mirror the DOMAIN_HO structures: Framework, Rules + Limits/Deductibles,
// Rating + Rate Tables, Forms + Dynamic Data. Styled headers, mono refIds.
// Works for a single product or a whole portfolio (rows carry a Product column).
import ExcelJS from 'exceljs'
import type { Product, Coverage, Rule, Form, LDTable, RTTable, RatingProgram } from '@pf/shared'

export interface ProductExport {
  product:       Product & { id: string }
  coverages:     Coverage[]
  rules:         Rule[]
  forms:         Form[]
  ldTables:      Record<string, LDTable>
  rtTables:      Record<string, RTTable>
  ratingProgram: RatingProgram | null
}

const ACCENT = 'FFC026D3'
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } }
const MONO = 'Consolas'

/** Add a styled header row + data rows; return the next free row number. */
function addTable(ws: ExcelJS.Worksheet, startRow: number, headers: string[], rows: (string | number)[][], monoCols: number[] = []): number {
  const head = ws.getRow(startRow)
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    c.fill = HEADER_FILL
    c.alignment = { vertical: 'middle' }
  })
  head.height = 20
  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + 1 + ri)
    r.forEach((v, ci) => {
      const c = row.getCell(ci + 1)
      c.value = v
      c.alignment = { vertical: 'top', wrapText: typeof v === 'string' && v.length > 40 }
      if (monoCols.includes(ci)) c.font = { name: MONO, size: 10 }
    })
  })
  return startRow + rows.length + 2
}

function autoWidth(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
}

// ─── Sheets ───────────────────────────────────────────────────────────────────

function frameworkSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = wb.addWorksheet('Framework', { views: [{ state: 'frozen', ySplit: 1 }] })
  const rows: (string | number)[][] = []
  for (const it of items) {
    for (const c of [...it.coverages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      rows.push([
        it.product.name, c.refId ?? '', c.name, c.parentId ?? '(top-level)', c.requirement,
        c.premiumGenerating ? 'Yes' : 'No', c.claimsBasis ?? '', c.source ?? '',
        (c.formNumbers ?? []).join(', '),
        c.allStates ? 'All' : (c.states ?? []).join(', '),
        (c.terms ?? []).map(t => `${t.label} (${t.kind}=${t.default})`).join('; '),
      ])
    }
  }
  autoWidth(ws, [22, 16, 26, 18, 12, 8, 14, 12, 20, 18, 44])
  addTable(ws, 1, ['Product', 'RefId', 'Coverage', 'Parent', 'Requirement', 'Prem-Gen', 'Claims Basis', 'Source', 'Form Numbers', 'States', 'Terms'], rows, [1])
}

function rulesSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = wb.addWorksheet('Rules + L&D')
  autoWidth(ws, [22, 16, 12, 18, 34, 34, 18, 18])
  const ruleRows: (string | number)[][] = []
  for (const it of items) for (const r of it.rules) {
    ruleRows.push([it.product.name, r.refId ?? '', r.category, r.subCategory ?? '', r.condition ?? '', r.outcome ?? '', (r.coverageRefIds ?? []).join(', '), (r.formNumbers ?? []).join(', ')])
  }
  ws.getCell('A1').value = 'RULES'; ws.getCell('A1').font = { bold: true, size: 12, color: { argb: ACCENT } }
  let next = addTable(ws, 2, ['Product', 'RefId', 'Category', 'Sub-Category', 'Condition', 'Outcome', 'Coverage Refs', 'Form Numbers'], ruleRows, [1])

  const ldRows: (string | number)[][] = []
  for (const it of items) for (const [ref, t] of Object.entries(it.ldTables)) {
    for (const row of t.rows ?? []) ldRows.push([ref, t.name, row.label, row.value, row.constraintNote ?? ''])
  }
  ws.getCell(`A${next}`).value = 'LIMITS & DEDUCTIBLES'; ws.getCell(`A${next}`).font = { bold: true, size: 12, color: { argb: ACCENT } }
  addTable(ws, next + 1, ['Table RefId', 'Name', 'Label', 'Value', 'Constraint'], ldRows, [0])
}

function ratingSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = wb.addWorksheet('Rating + RT')
  autoWidth(ws, [22, 10, 8, 28, 10, 30, 10])
  const stepRows: (string | number)[][] = []
  for (const it of items) {
    const p = it.ratingProgram
    if (!p) continue
    for (const s of [...(p.steps ?? [])].sort((a, b) => a.order - b.order)) {
      const src = s.source.type === 'CONST' ? `CONST(${s.source.value})` : `${s.source.type}(${s.source.ref ?? ''}${s.source.keys ? ' ' + s.source.keys.join(',') : ''})`
      stepRows.push([p.refId, s.id, s.order, s.label, s.op, src, s.roundTo ?? ''])
    }
  }
  ws.getCell('A1').value = 'RATING STEPS'; ws.getCell('A1').font = { bold: true, size: 12, color: { argb: ACCENT } }
  let next = addTable(ws, 2, ['Program', 'Step', 'Order', 'Label', 'Op', 'Source', 'Round'], stepRows, [0, 1])

  for (const it of items) for (const [ref, t] of Object.entries(it.rtTables)) {
    ws.getCell(`A${next}`).value = `${ref} — ${t.name}`; ws.getCell(`A${next}`).font = { bold: true, size: 11, color: { argb: ACCENT } }
    const cols = t.columns ?? []
    const rtRows = (t.rows ?? []).map(r => cols.map(c => { const v = (r as Record<string, unknown>)[c]; return typeof v === 'number' ? v : String(v ?? '') }))
    next = addTable(ws, next + 1, cols.length ? cols : ['(no columns)'], rtRows)
  }
}

function formsSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = wb.addWorksheet('Forms + Dynamic')
  autoWidth(ws, [14, 30, 10, 16, 10, 14, 18, 40])
  const formRows: (string | number)[][] = []
  const dynRows: (string | number)[][] = []
  for (const it of items) for (const f of it.forms) {
    formRows.push([f.number, f.name, f.edition ?? '', f.category, f.mandatoryDefault ? 'Yes' : 'No', f.attachmentCondition, (f.coverageParts ?? []).join(', '), f.description ?? ''])
    for (const d of f.dynamicFields ?? []) dynRows.push([f.number, d.name, d.dataType, d.repeating ? 'Yes' : 'No', (d.options ?? []).join(', ')])
  }
  ws.getCell('A1').value = 'FORMS'; ws.getCell('A1').font = { bold: true, size: 12, color: { argb: ACCENT } }
  const next = addTable(ws, 2, ['Number', 'Name', 'Edition', 'Category', 'Mandatory', 'Attachment', 'Coverage Parts', 'Description'], formRows, [0])
  ws.getCell(`A${next}`).value = 'DYNAMIC DATA'; ws.getCell(`A${next}`).font = { bold: true, size: 12, color: { argb: ACCENT } }
  addTable(ws, next + 1, ['Form', 'Field', 'Type', 'Repeating', 'Options'], dynRows, [0])
}

// ─── Public API ─────────────────────────────────────────────────────────────

async function download(wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function buildWorkbook(items: ProductExport[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Product Reinvention Hub'
  wb.created = new Date()
  frameworkSheet(wb, items)
  rulesSheet(wb, items)
  ratingSheet(wb, items)
  formsSheet(wb, items)
  return wb
}

export async function exportProductExcel(data: ProductExport): Promise<void> {
  const name = (data.product.refId ?? data.product.name ?? 'product').replace(/[^A-Za-z0-9.-]+/g, '_')
  await download(buildWorkbook([data]), `${name}.xlsx`)
}

export async function exportPortfolioExcel(items: ProductExport[]): Promise<void> {
  await download(buildWorkbook(items), `portfolio_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
