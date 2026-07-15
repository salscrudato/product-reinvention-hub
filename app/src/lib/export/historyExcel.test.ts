// historyExcel.test.ts — H3 / HI-03: lock the History XLSX shape.
// One sheet, row-per-diff, fixed column order, formula-injection neutralized, and an empty
// history yields a header + note row (never a zero-byte file). Builds the workbook in-process
// (no download / no jsdom) and reads the cells back.
import { describe, it, expect } from 'vitest'
import { buildHistoryWorkbook } from './historyExcel'
import type { Version } from '@pf/shared'

function ver(over: Partial<Version> = {}): Version & { id: string } {
  return {
    id: 'v', entityType: 'coverage', entityPath: 'products/PH.PROD.001/coverages/PH-COV-001',
    productId: 'PH.PROD.001', snapshot: null, diff: [], actor: { uid: 'u', name: 'Ada' },
    at: '2026-07-15T00:00:00.000Z', op: 'update', rev: 2, ...over,
  } as Version & { id: string }
}

const HEADERS = ['Rev', 'When', 'Actor', 'Action', 'Entity type', 'Entity path', 'Field', 'Before', 'After']
// title row 1, keyline row 2, column header row 3, data rows 4+.
const HEADER_ROW = 3

describe('buildHistoryWorkbook — shape lock', () => {
  it('has one History sheet with the fixed column order (frozen header row 3)', () => {
    const ws = buildHistoryWorkbook([ver()], 'PH.PROD.001').getWorksheet('Change history')!
    expect(ws).toBeTruthy()
    HEADERS.forEach((h, i) => expect(ws.getCell(HEADER_ROW, i + 1).value).toBe(h))
    expect(ws.views?.[0]?.state).toBe('frozen')
  })

  it('emits ONE ROW PER FIELD DIFF, with A–F repeated across a rev', () => {
    const v = ver({ rev: 4, op: 'update', diff: [
      { field: 'limit', before: 100, after: 200 },
      { field: 'name', before: 'A', after: 'B' },
    ] })
    const ws = buildHistoryWorkbook([v], 'PH.PROD.001').getWorksheet('Change history')!
    // Row 4 — first diff
    expect(ws.getCell(4, 1).value).toBe(4)                 // Rev
    expect(ws.getCell(4, 4).value).toBe('Updated')         // Action
    expect(ws.getCell(4, 6).value).toBe(v.entityPath)      // Entity path
    expect(ws.getCell(4, 7).value).toBe('limit')           // Field
    expect(ws.getCell(4, 8).value).toBe(100)               // Before (number stays a number)
    expect(ws.getCell(4, 9).value).toBe(200)               // After
    // Row 5 — second diff repeats Rev/Action/Path (A–F)
    expect(ws.getCell(5, 1).value).toBe(4)
    expect(ws.getCell(5, 6).value).toBe(v.entityPath)
    expect(ws.getCell(5, 7).value).toBe('name')
    expect(ws.getCell(5, 8).value).toBe('A')
    expect(ws.getCell(5, 9).value).toBe('B')
  })

  it('labels a restore row Restored and a create row Created', () => {
    const rows = [ver({ op: 'restore', diff: [{ field: 'limit', before: 200, after: 100 }] }),
                  ver({ op: 'create', diff: [{ field: 'limit', before: undefined, after: 100 }] })]
    const ws = buildHistoryWorkbook(rows, 'PH.PROD.001').getWorksheet('Change history')!
    expect(ws.getCell(4, 4).value).toBe('Restored')
    expect(ws.getCell(5, 4).value).toBe('Created')
  })

  it('NEUTRALIZES formula injection — a leading = + - @ stays LITERAL text, never a formula', () => {
    const evil = ver({ diff: [{ field: '=cmd()', before: '=SUM(1+1)', after: '@HYPERLINK("x")' }] })
    const ws = buildHistoryWorkbook([evil], 'PH.PROD.001').getWorksheet('Change history')!
    for (const col of [7, 8, 9]) {
      const cell = ws.getCell(4, col)
      expect(String(cell.value).startsWith("'")).toBe(true)   // apostrophe-prefixed → literal
      expect(cell.formula).toBeUndefined()                    // never stored as a formula
      expect(cell.type).not.toBe(6)                           // ExcelJS ValueType.Formula === 6
    }
  })

  it('empty history → header + a note row, never a zero-byte file', () => {
    const ws = buildHistoryWorkbook([], 'PH.PROD.001').getWorksheet('Change history')!
    HEADERS.forEach((h, i) => expect(ws.getCell(HEADER_ROW, i + 1).value).toBe(h))
    let noted = false
    ws.eachRow((row) => { if (/No changes/i.test(String(row.getCell(1).value))) noted = true })
    expect(noted).toBe(true)
  })

  it('builds without throwing for a messy productId (filename is sanitized)', () => {
    expect(() => buildHistoryWorkbook([ver()], 'PH/PROD 001')).not.toThrow()
  })
})
