// historyExcel.ts — export a product's change history to a clean, single-sheet XLSX per
// HISTORY_SPEC §4: one ROW PER FIELD DIFF (Rev · When · Actor · Action · Entity type ·
// Entity path · Field · Before · After). Reuses the excel.ts plumbing (banded rows, frozen
// header, token palette) and routes every cell through safeCellValue so a formula-injection
// string stays literal. The caller passes the drawer's CURRENTLY FILTERED versions, so what
// you see is what you export. Empty history yields a header + note row, never a zero-byte file.
import ExcelJS from 'exceljs'
import type { Version } from '@pf/shared'
import { newSheet, title, table, download, type Cell, type Col } from './excel'

type HistoryVersion = Version & { id?: string }

const HISTORY_COLS: Col[] = [
  { header: 'Rev', width: 8, align: 'right' },
  { header: 'When', width: 20, mono: true },
  { header: 'Actor', width: 22 },
  { header: 'Action', width: 12 },
  { header: 'Entity type', width: 14 },
  { header: 'Entity path', width: 44, mono: true },
  { header: 'Field', width: 22, mono: true },
  { header: 'Before', width: 30 },
  { header: 'After', width: 30 },
]

const ACTION_LABEL: Record<string, string> = { create: 'Created', update: 'Updated', delete: 'Deleted', restore: 'Restored' }

function fmtWhen(at: unknown): string {
  if (!at) return ''
  const ts = at instanceof Object && 'toDate' in (at as object) ? (at as { toDate(): Date }).toDate() : new Date(String(at))
  return Number.isNaN(ts.getTime()) ? '' : ts.toISOString().replace('T', ' ').slice(0, 19)
}
function fmtValue(v: unknown): Cell {
  if (v == null || v === '') return ''
  if (typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return String(v) }
}
const sanitize = (s: string) => (s || 'product').replace(/[^A-Za-z0-9.-]+/g, '_')

/** Build (but do not download) the History workbook — one row per field diff. Pure + testable. */
export function buildHistoryWorkbook(versions: HistoryVersion[], productId: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Product Reinvention Hub'
  wb.created = new Date()
  // Freeze the title + keyline + column header (rows 1-3) so the header stays while scrolling.
  // ("History" is a protected worksheet name in Excel — use "Change history".)
  const ws = newSheet(wb, 'Change history', 3)
  const start = title(ws, 1, `Change history — ${productId}`, HISTORY_COLS.length)

  const rows: Cell[][] = []
  for (const v of versions) {
    const meta: Cell[] = [
      v.rev ?? '', fmtWhen(v.at), v.actor?.name ?? '—',
      ACTION_LABEL[v.op ?? ''] ?? (v.op ?? ''), v.entityType, v.entityPath,
    ]
    const diffs = v.diff ?? []
    // One row per field diff (a rev spanning 4 fields = 4 rows, A-F repeated). A rev with
    // no field changes still gets one row so the change itself is never dropped.
    if (diffs.length === 0) rows.push([...meta, '', '', ''])
    else for (const d of diffs) rows.push([...meta, d.field, fmtValue(d.before), fmtValue(d.after)])
  }

  if (rows.length === 0) {
    const next = table(ws, start, HISTORY_COLS, [])   // header-only, never a zero-byte file
    ws.getCell(next, 1).value = 'No changes recorded for this product / filter.'
  } else {
    table(ws, start, HISTORY_COLS, rows)
  }
  return wb
}

/** Export the (filter-scoped) history as `<productId>-history-<yyyy-mm-dd>.xlsx`. */
export async function exportHistoryExcel(versions: HistoryVersion[], productId: string): Promise<void> {
  const wb = buildHistoryWorkbook(versions, productId)
  const today = new Date().toISOString().slice(0, 10)
  await download(wb, `${sanitize(productId)}-history-${today}.xlsx`)
}
