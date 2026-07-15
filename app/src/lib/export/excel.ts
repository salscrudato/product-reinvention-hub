// excel.ts — client-side workbook export (exceljs). Apple-inspired, premium finish:
// a cover "Overview" sheet with a gradient accent banner + at-a-glance stat strip,
// then four cleanly banded, borderless-gridline data sheets mirroring the DOMAIN_HO
// structures (Framework, Rules + L&D, Rating + RT, Forms + Dynamic). Works for a
// single product or a whole portfolio (rows carry a Product column).
//
// Literal ARGB is required here (and only here): exceljs writes a binary .xlsx and
// cannot read the CSS tokens in index.css, so this palette mirrors those tokens.
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

// Palette mirroring app/src/index.css @theme tokens.
const C = {
  accent: 'FF8B1FE0', bright: 'FFA100FF', strong: 'FF7A00E6',
  text: 'FF131318', dim: 'FF5B5C6B', faint: 'FF8E90A0',
  white: 'FFFFFFFF', onAccent: 'FFF1E6FF',
  band: 'FFFAF9FC', soft: 'FFF3ECFB', border: 'FFE9E9EF',
}
const MONO = 'Consolas'
const GRAD_ACCENT: ExcelJS.Fill = {
  type: 'gradient', gradient: 'angle', degree: 135,
  stops: [{ position: 0, color: { argb: C.bright } }, { position: 1, color: { argb: C.strong } }],
}
const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const HAIR = { style: 'thin' as const, color: { argb: C.border } }

// ─── Column model ────────────────────────────────────────────────────────────────

export interface Col { header: string; width: number; mono?: boolean; money?: boolean; align?: 'left' | 'right' | 'center' }
export type Cell = string | number | null

/** Neutralize spreadsheet formula / CSV injection: a cell STRING beginning with = + - @
 *  (or a leading tab/CR) is interpreted as a formula by Excel/Sheets and, worse, executes
 *  when the sheet is re-exported to CSV. Prefix such a value with an apostrophe so it stays
 *  LITERAL text. Numbers pass through untouched (money/number formats still apply). Every
 *  data cell written by table() below goes through this, so no exported cell can execute. */
export function safeCellValue(v: Cell): Cell {
  if (typeof v !== 'string') return v
  return /^[=+\-@\t\r\n]/.test(v) ? `'${v}` : v
}

/** Section title with an accent keyline beneath — the visual rhythm of every sheet. */
export function title(ws: ExcelJS.Worksheet, r: number, label: string, span: number): number {
  const cell = ws.getCell(r, 1)
  cell.value = label
  cell.font = { bold: true, size: 12, color: { argb: C.accent } }
  ws.getRow(r).height = 22
  const line = ws.getRow(r + 1)
  for (let c = 1; c <= span; c++) line.getCell(c).border = { bottom: { style: 'medium', color: { argb: C.accent } } }
  line.height = 4
  return r + 2
}

/** Styled header + banded, bordered, formatted data rows. Returns the next free row.
 *  Every data cell is passed through safeCellValue so a formula-injection string stays literal. */
export function table(ws: ExcelJS.Worksheet, startRow: number, cols: Col[], rows: Cell[][]): number {
  const head = ws.getRow(startRow)
  head.height = 22
  cols.forEach((col, i) => {
    const c = head.getCell(i + 1)
    c.value = col.header
    c.font = { bold: true, size: 10, color: { argb: C.white } }
    c.fill = solid(C.accent)
    c.alignment = { vertical: 'middle', horizontal: col.align ?? 'left', indent: 1 }
  })
  rows.forEach((row, ri) => {
    const r = ws.getRow(startRow + 1 + ri)
    r.height = 18
    const banded = ri % 2 === 1
    cols.forEach((col, ci) => {
      const c = r.getCell(ci + 1)
      c.value = safeCellValue(row[ci] ?? '')
      if (banded) c.fill = solid(C.band)
      c.border = { bottom: HAIR }
      c.font = { size: 10, color: { argb: C.text }, ...(col.mono ? { name: MONO, size: 9.5 } : {}) }
      c.alignment = {
        vertical: 'top', horizontal: col.align ?? 'left', indent: 1,
        wrapText: typeof row[ci] === 'string' && (row[ci] as string).length > 44,
      }
      if (col.money && typeof row[ci] === 'number') c.numFmt = '$#,##0'
    })
  })
  cols.forEach((col, i) => { ws.getColumn(i + 1).width = col.width })
  return startRow + rows.length + 3
}

export function newSheet(wb: ExcelJS.Workbook, name: string, freezeRows = 0): ExcelJS.Worksheet {
  return wb.addWorksheet(name, {
    views: [{ showGridLines: false, ...(freezeRows ? { state: 'frozen', ySplit: freezeRows } : {}) }],
    properties: { defaultRowHeight: 16 },
  })
}

// ─── Overview (cover) sheet ──────────────────────────────────────────────────────

const SPAN = 7
function totals(items: ProductExport[]) {
  return {
    products:   items.length,
    coverages:  items.reduce((n, it) => n + it.coverages.length, 0),
    forms:      new Set(items.flatMap(it => it.forms.map(f => f.number))).size,
    rules:      items.reduce((n, it) => n + it.rules.length, 0),
    steps:      items.reduce((n, it) => n + (it.ratingProgram?.steps.length ?? 0), 0),
    rtTables:   new Set(items.flatMap(it => Object.keys(it.rtTables))).size,
    ldTables:   new Set(items.flatMap(it => Object.keys(it.ldTables))).size,
  }
}

function overviewSheet(wb: ExcelJS.Workbook, items: ProductExport[], heading: string, subtitle: string) {
  const ws = newSheet(wb, 'Overview')
  for (let c = 1; c <= SPAN; c++) ws.getColumn(c).width = c === 1 ? 4 : 20

  // Gradient banner.
  ws.mergeCells(1, 1, 4, SPAN)
  const banner = ws.getCell(1, 1)
  banner.fill = GRAD_ACCENT
  banner.value = {
    richText: [
      { text: `${heading}\n`, font: { size: 22, bold: true, color: { argb: C.white } } },
      { text: subtitle,       font: { size: 11, color: { argb: C.onAccent } } },
    ],
  }
  banner.alignment = { vertical: 'middle', horizontal: 'left', indent: 2, wrapText: true }
  for (let r = 1; r <= 4; r++) ws.getRow(r).height = 20

  // At-a-glance stat strip.
  const t = totals(items)
  const tiles: [string, number][] = [
    ['Coverages', t.coverages], ['Forms', t.forms], ['Rules', t.rules],
    ['Rating steps', t.steps], ['RT tables', t.rtTables], ['LD tables', t.ldTables],
  ]
  const numRow = ws.getRow(6), labRow = ws.getRow(7)
  numRow.height = 30; labRow.height = 16
  tiles.forEach(([label, value], i) => {
    const col = i + 2
    const n = numRow.getCell(col)
    n.value = value
    n.font = { size: 20, bold: true, color: { argb: C.accent } }
    n.alignment = { vertical: 'middle', horizontal: 'center' }
    n.fill = solid(C.soft)
    const l = labRow.getCell(col)
    l.value = label
    l.font = { size: 9, color: { argb: C.faint } }
    l.alignment = { vertical: 'middle', horizontal: 'center' }
    l.fill = solid(C.soft)
  })

  // Detail: single-product metadata, or a portfolio roster.
  let r = 9
  if (items.length === 1) {
    const p = items[0]!.product
    const meta: [string, string][] = [
      ['Reference ID', p.refId ?? '—'],
      ['Line of business', p.lob?.name ?? '—'],
      ['Market segment', p.marketSegment ?? '—'],
      ['Status', `${p.status} · ${p.lifecycle}`],
      ['States', p.allStates ? 'All states' : (p.states ?? []).join(', ') || '—'],
      ['Generated', new Date().toLocaleString()],
    ]
    r = title(ws, r, 'Product', SPAN)
    for (const [k, v] of meta) {
      const row = ws.getRow(r++)
      const kc = row.getCell(2); kc.value = k; kc.font = { size: 10, color: { argb: C.faint } }
      ws.mergeCells(row.number, 3, row.number, SPAN)
      const vc = row.getCell(3); vc.value = v; vc.font = { size: 10, color: { argb: C.text } }
      vc.alignment = { indent: 1, wrapText: true }
      row.height = 18
    }
  } else {
    r = title(ws, r, 'Products', SPAN)
    const cols: Col[] = [
      { header: 'Product', width: 30 }, { header: 'RefId', width: 16, mono: true },
      { header: 'LOB', width: 22 }, { header: 'Coverages', width: 12, align: 'right' },
      { header: 'Forms', width: 10, align: 'right' }, { header: 'Status', width: 14 },
    ]
    const rows: Cell[][] = items.map(it => [
      it.product.name, it.product.refId ?? '', it.product.lob?.name ?? '',
      it.coverages.length, it.forms.length, it.product.lifecycle,
    ])
    table(ws, r, cols, rows)
  }
}

// ─── Data sheets ─────────────────────────────────────────────────────────────────

function frameworkSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = newSheet(wb, 'Framework', 2)
  const cols: Col[] = [
    { header: 'Product', width: 24 }, { header: 'RefId', width: 16, mono: true },
    { header: 'Coverage', width: 28 }, { header: 'Parent', width: 16, mono: true },
    { header: 'Requirement', width: 13 }, { header: 'Prem-Gen', width: 10, align: 'center' },
    { header: 'Claims Basis', width: 14 }, { header: 'Source', width: 12 },
    { header: 'Form Numbers', width: 20, mono: true }, { header: 'States', width: 18 },
    { header: 'Terms', width: 44 },
  ]
  const rows: Cell[][] = []
  for (const it of items) {
    for (const c of [...it.coverages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      rows.push([
        it.product.name, c.refId ?? '', c.name, c.parentId ?? '(top-level)', c.requirement,
        // null = the source never stated premium treatment (F14) — exporting
        // 'No' would fabricate a fact in a data-egress artifact.
        c.premiumGenerating == null ? 'Unknown' : c.premiumGenerating ? 'Yes' : 'No',
        c.claimsBasis ?? '', c.source ?? '',
        (c.formNumbers ?? []).join(', '),
        c.allStates ? 'All' : (c.states ?? []).join(', '),
        (c.terms ?? []).map(t => `${t.label} (${t.kind}=${t.default})`).join('; '),
      ])
    }
  }
  const start = title(ws, 1, 'Product framework', cols.length)
  table(ws, start, cols, rows)
}

function rulesSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = newSheet(wb, 'Rules + L&D')
  const ruleCols: Col[] = [
    { header: 'Product', width: 22 }, { header: 'RefId', width: 16, mono: true },
    { header: 'Category', width: 12 }, { header: 'Sub-Category', width: 20 },
    { header: 'Condition', width: 34 }, { header: 'Outcome', width: 34 },
    { header: 'Coverage Refs', width: 20, mono: true }, { header: 'Form Numbers', width: 18, mono: true },
  ]
  const ruleRows: Cell[][] = []
  for (const it of items) for (const r of it.rules) {
    ruleRows.push([it.product.name, r.refId ?? '', r.category, r.subCategory ?? '', r.condition ?? '', r.outcome ?? '', (r.coverageRefIds ?? []).join(', '), (r.formNumbers ?? []).join(', ')])
  }
  let next = title(ws, 1, 'Rules', ruleCols.length)
  next = table(ws, next, ruleCols, ruleRows)

  const ldCols: Col[] = [
    { header: 'Table RefId', width: 16, mono: true }, { header: 'Name', width: 34 },
    { header: 'Label', width: 16 }, { header: 'Value', width: 14, money: true }, { header: 'Constraint', width: 40 },
  ]
  const ldRows: Cell[][] = []
  for (const it of items) for (const [ref, tbl] of Object.entries(it.ldTables)) {
    for (const r of tbl.rows ?? []) ldRows.push([ref, tbl.name, r.label, r.value, r.constraintNote ?? ''])
  }
  next = title(ws, next, 'Limits & deductibles', ldCols.length)
  table(ws, next, ldCols, ldRows)
}

function ratingSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = newSheet(wb, 'Rating + RT')
  const stepCols: Col[] = [
    { header: 'Program', width: 16, mono: true }, { header: 'Step', width: 10, mono: true },
    { header: 'Order', width: 8, align: 'right' }, { header: 'Label', width: 32 },
    { header: 'Op', width: 10 }, { header: 'Source', width: 32, mono: true }, { header: 'Round', width: 8, align: 'right' },
  ]
  const stepRows: Cell[][] = []
  for (const it of items) {
    const p = it.ratingProgram
    if (!p) continue
    for (const s of [...(p.steps ?? [])].sort((a, b) => a.order - b.order)) {
      const src = s.source.type === 'CONST'
        ? `CONST(${s.source.value})`
        : `${s.source.type}(${s.source.ref ?? ''}${s.source.keys ? ' ' + s.source.keys.join(',') : ''})`
      stepRows.push([p.refId, s.id, s.order, s.label, s.op, src, s.roundTo ?? ''])
    }
  }
  let next = title(ws, 1, 'Rating steps', stepCols.length)
  next = table(ws, next, stepCols, stepRows)

  for (const it of items) for (const [ref, tbl] of Object.entries(it.rtTables)) {
    next = title(ws, next, `${ref} — ${tbl.name}`, Math.max(tbl.columns?.length ?? 1, 1))
    const rtCols: Col[] = (tbl.columns?.length ? tbl.columns : ['(no columns)']).map(h => ({ header: h, width: 18 }))
    const rtRows: Cell[][] = (tbl.rows ?? []).map(row =>
      (tbl.columns ?? []).map(c => { const v = (row as Record<string, unknown>)[c]; return typeof v === 'number' ? v : String(v ?? '') }))
    next = table(ws, next, rtCols, rtRows)
  }
}

function formsSheet(wb: ExcelJS.Workbook, items: ProductExport[]) {
  const ws = newSheet(wb, 'Forms + Dynamic')
  const formCols: Col[] = [
    { header: 'Number', width: 14, mono: true }, { header: 'Name', width: 32 },
    { header: 'Edition', width: 10, mono: true }, { header: 'Category', width: 16 },
    { header: 'Mandatory', width: 11, align: 'center' }, { header: 'Attachment', width: 14 },
    { header: 'Coverage Parts', width: 22 }, { header: 'Description', width: 44 },
  ]
  const formRows: Cell[][] = []
  const dynRows: Cell[][] = []
  const seen = new Set<string>()
  for (const it of items) for (const f of it.forms) {
    if (seen.has(f.number)) continue
    seen.add(f.number)
    formRows.push([f.number, f.name, f.edition ?? '', f.category, f.mandatoryDefault ? 'Yes' : 'No', f.attachmentCondition, (f.coverageParts ?? []).join(', '), f.description ?? ''])
    for (const d of f.dynamicFields ?? []) dynRows.push([f.number, d.name, d.dataType, d.repeating ? 'Yes' : 'No', (d.options ?? []).join(', ')])
  }
  let next = title(ws, 1, 'Forms', formCols.length)
  next = table(ws, next, formCols, formRows)

  const dynCols: Col[] = [
    { header: 'Form', width: 14, mono: true }, { header: 'Field', width: 26 },
    { header: 'Type', width: 12 }, { header: 'Repeating', width: 11, align: 'center' }, { header: 'Options', width: 40 },
  ]
  next = title(ws, next, 'Dynamic data', dynCols.length)
  table(ws, next, dynCols, dynRows)
}

// ─── Public API ─────────────────────────────────────────────────────────────────

export async function download(wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function buildWorkbook(items: ProductExport[], heading: string, subtitle: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Product Reinvention Hub'
  wb.created = new Date()
  overviewSheet(wb, items, heading, subtitle)
  frameworkSheet(wb, items)
  rulesSheet(wb, items)
  ratingSheet(wb, items)
  formsSheet(wb, items)
  return wb
}

export async function exportProductExcel(data: ProductExport): Promise<void> {
  const name = (data.product.refId ?? data.product.name ?? 'product').replace(/[^A-Za-z0-9.-]+/g, '_')
  const subtitle = [data.product.refId, data.product.lob?.name, data.product.marketSegment].filter(Boolean).join('  ·  ')
  await download(buildWorkbook([data], data.product.name, subtitle), `${name}.xlsx`)
}

export async function exportPortfolioExcel(items: ProductExport[]): Promise<void> {
  const subtitle = `${items.length} product${items.length !== 1 ? 's' : ''}  ·  ${new Date().toLocaleDateString()}`
  await download(buildWorkbook(items, 'Portfolio export', subtitle), `portfolio_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
