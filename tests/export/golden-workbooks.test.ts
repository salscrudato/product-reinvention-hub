// X2 — Unity workbook producer byte-lockstep against the committed structural
// goldens (ledger XE-03/RE-04): docs/export-templates/PA_PROD_001_{CoverageConfig,
// TableConfig} (1).xlsx. The TableConfig golden is a PH-then-PA concatenation
// (sheets 1–10 = the PH product's rating tables, 11–21 = PA's — verified against
// shared/src/seed), so the full-pair lockstep feeds the producer both table sets.
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { buildCoverageConfig } from '../../shared/src/export/duckcreek/coverageConfig'
import { buildTableConfig } from '../../shared/src/export/duckcreek/tableConfig'
import { safeCellValue } from '../../shared/src/export/duckcreek/cells'
import type { CellValue, WorkbookModel } from '../../shared/src/export/duckcreek/types'
import { paExportInput } from '../../shared/src/export/duckcreek/paFixture'
import { LOB_BASE_MANUSCRIPTS } from '../../shared/src/export/duckcreek/spec'
import { PA_RT_TABLES, PA_FOOTPRINT_STATES } from '../../shared/src/seed/personalAuto'
import { PH_RT_TABLES } from '../../shared/src/seed/personalHome'

const GOLDEN_DIR = path.resolve(process.cwd(), 'docs/export-templates')
const PA_BASE = LOB_BASE_MANUSCRIPTS['PA.LOB.001']!

/**
 * The single observed hand-authoring anomaly in the golden pair: the PA MedPay
 * coverage appears as "Medical Payments Coverage T" (Coverage!B5 and its
 * derivations) — the seed has "Part B — Medical Payments Coverage" and no source
 * for the trailing "T". The comparison normalizes exactly that token; every other
 * cell must match byte-for-byte. Inventing a rule to reproduce the "T" would be a
 * fabrication.
 */
function normalizeGoldenAnomaly(v: CellValue): CellValue {
  if (typeof v !== 'string') return v
  return v
    .replace(/MedicalPaymentsCoverageT(?![a-z])/g, 'MedicalPaymentsCoverage')
    .replace(/Medical Payments Coverage T(?![a-zA-Z])/g, 'Medical Payments Coverage')
}

function cellVal(c: ExcelJS.Cell): CellValue {
  const v = c.value
  if (v === null || v === undefined) return null
  if (typeof v === 'object') {
    if ((v as { richText?: { text: string }[] }).richText) {
      return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('')
    }
    if (v instanceof Date) return v.toISOString()
    return String(v)
  }
  return v as CellValue
}

async function readGolden(file: string): Promise<Map<string, Map<string, CellValue>>> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(GOLDEN_DIR, file))
  const out = new Map<string, Map<string, CellValue>>()
  wb.eachSheet((ws) => {
    const cells = new Map<string, CellValue>()
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        const v = cellVal(cell)
        if (v !== null && v !== '') cells.set(`${rn}:${cn}`, normalizeGoldenAnomaly(v))
      })
    })
    out.set(ws.name, cells)
  })
  return out
}

function modelCells(wb: WorkbookModel): Map<string, Map<string, CellValue>> {
  const out = new Map<string, Map<string, CellValue>>()
  for (const s of wb.sheets) {
    const cells = new Map<string, CellValue>()
    for (const [rn, row] of s.rows) for (const [cn, v] of row) cells.set(`${rn}:${cn}`, v)
    out.set(s.name, cells)
  }
  return out
}

function expectLockstep(produced: Map<string, Map<string, CellValue>>, golden: Map<string, Map<string, CellValue>>) {
  expect([...produced.keys()]).toEqual([...golden.keys()])
  for (const [sheet, gCells] of golden) {
    const pCells = produced.get(sheet)!
    for (const [addr, gv] of gCells) {
      expect(pCells.get(addr), `${sheet}!${addr}`).toBe(gv)
    }
    for (const [addr, pv] of pCells) {
      expect(gCells.get(addr), `${sheet}!${addr} (extra cell)`).toBe(pv)
    }
  }
}

describe('X2 Unity workbook producer — golden lockstep', () => {
  it('CoverageConfig matches the golden pair cell-for-cell (3 sheets, 12 coverages, 12 term inputs)', async () => {
    const input = paExportInput()
    const produced = modelCells(buildCoverageConfig(input, PA_BASE))
    const golden = await readGolden('PA_PROD_001_CoverageConfig (1).xlsx')
    expectLockstep(produced, golden)
  })

  it('TableConfig matches the golden pair cell-for-cell (TOC + 21 tables + Config LAST, 23 sheets)', async () => {
    const statesJoined = PA_FOOTPRINT_STATES.join(', ')
    const produced = modelCells(buildTableConfig({
      tables: [...Object.values(PH_RT_TABLES), ...Object.values(PA_RT_TABLES)],
      baseManuscriptId: PA_BASE,
      statesJoined,
    }))
    const golden = await readGolden('PA_PROD_001_TableConfig (1).xlsx')
    expectLockstep(produced, golden)
  })

  it('pins the observed shape rules: Config manifest LAST, TOC first, preamble rows 4-7, header row 8', () => {
    const wb = buildTableConfig({
      tables: Object.values(PA_RT_TABLES),
      baseManuscriptId: PA_BASE,
      statesJoined: PA_FOOTPRINT_STATES.join(', '),
    })
    expect(wb.sheets[0]!.name).toBe('TOC')
    expect(wb.sheets.at(-1)!.name).toBe('Config')
    expect(wb.sheets).toHaveLength(2 + 11)
    const first = wb.sheets[1]!
    expect(first.name).toBe('TerritoryBaseRate_1')
    expect(first.rows.get(4)!.get(1)).toBe(`MS Physical Path: C:\\DuckCreek\\Suite\\Policy\\ManuScripts\\DCTTemplates\\${PA_BASE}.xml.xml`)
    expect(first.rows.get(5)!.get(1)).toBe(`Manuscript ID: ${PA_BASE}.xml`)
    expect(first.rows.get(7)!.get(1)).toBe('Territory Base Rate — Table Type: Rating Table')
    expect(first.rows.get(8)!.get(1)).toBe('territory')
    expect(first.rows.get(8)!.get(2)).toBe('rate')
    expect(first.rows.get(9)!.get(2)).toBe(350)
    // The 31-char SheetName truncation (spec §3.4) — the ordinal may be eaten.
    const wbPh = buildTableConfig({
      tables: Object.values(PH_RT_TABLES),
      baseManuscriptId: PA_BASE,
      statesJoined: '',
    })
    expect(wbPh.sheets[2]!.name).toBe('ProtectionClassConstructionFact')
    expect(wbPh.sheets[2]!.name).toHaveLength(31)
  })
})

describe('X2 workbook cell hygiene — malicious strings stay literal', () => {
  it('neutralizes formula-shaped strings at the model layer and keeps them literal through a real xlsx round-trip', async () => {
    const hostile = ['=HYPERLINK("http://evil","x")', '+CMD|9', '-2+3', '@SUM(A1)', '\tX', '\rY']
    for (const h of hostile) {
      expect(safeCellValue(h)).toBe(`'${h}`)
    }
    expect(safeCellValue('$20_600')).toBe('$20_600')
    expect(safeCellValue(350)).toBe(350)

    const wb = buildTableConfig({
      tables: [{
        name: 'Hostile Table',
        columns: ['key', 'value'],
        rows: [{ key: '=HYPERLINK("http://evil","x")', value: 1 }],
      }],
      baseManuscriptId: PA_BASE,
      statesJoined: '',
    })
    // Serialize with the real exceljs and read back: the cell must be a literal
    // string (no formula object), still carrying the apostrophe neutralization.
    const x = new ExcelJS.Workbook()
    for (const s of wb.sheets) {
      const ws = x.addWorksheet(s.name)
      for (const [rn, row] of s.rows) for (const [cn, v] of row) ws.getCell(rn, cn).value = v as ExcelJS.CellValue
    }
    const buf = await x.xlsx.writeBuffer()
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(buf as ArrayBuffer)
    const cell = back.getWorksheet('HostileTable_1')!.getCell(9, 1)
    expect(cell.formula).toBeUndefined()
    expect(cell.value).toBe(`'=HYPERLINK("http://evil","x")`)
  })
})
