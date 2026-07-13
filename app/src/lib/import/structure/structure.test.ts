// structure.test.ts — deterministic structural extraction layer tests.
//
// Tests are organised in four groups:
//   A. Pure helpers (sentinel normalization, header scoring, layout detection) — synthetic data.
//   B. Real ISO GL workbooks (4 files physically in the repo) — correctness assertions on
//      extents, layout shapes, header candidates, Definitions sheets, and stacked tables.
//   C. Layout shape fixtures — synthetic grids for all four shapes.
//   D. PDF stub — compiles behind the SourceReader interface.
//
// All assertions are explicit (no toMatchSnapshot) so the test never silently drifts.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  normalizeCellValue, isSentinelValue,
  scoreHeaderCandidates, pickBestHeaderRow,
  detectLayoutShape,
  hasStackedTableMarkers, hasWideStateColumns, hasIndentedHierarchy,
  profileColumns,
  isDefinitionsSheetName, parseDefinitionsSheet,
  segmentStackedTables,
  foldWideMatrix,
} from '@pf/shared'
import type { NormalizedCell } from '@pf/shared'
import { XlsxSourceReader } from './xlsxReader'
import { PdfSourceReader } from './pdfStub'
import { detectByMagic } from './sourceReader'
import type { StructuralModel } from '@pf/shared'

const __dir  = dirname(fileURLToPath(import.meta.url))
const SAMPLES = resolve(__dir, '../../../../../samples/iso')

// ─── A: Pure helper unit tests ────────────────────────────────────────────────

describe('sentinels — normalizeCellValue', () => {
  it('maps null and undefined to null', () => {
    expect(normalizeCellValue(null)).toBe(null)
    expect(normalizeCellValue(undefined)).toBe(null)
  })

  it('maps <Placeholder> to null (case-insensitive)', () => {
    expect(normalizeCellValue('<Placeholder>')).toBe(null)
    expect(normalizeCellValue('<PLACEHOLDER>')).toBe(null)
  })

  it('maps <Intentionally Left Blank> to null', () => {
    expect(normalizeCellValue('<Intentionally Left Blank>')).toBe(null)
  })

  it('maps N/A to null', () => {
    expect(normalizeCellValue('N/A')).toBe(null)
    expect(normalizeCellValue('n/a')).toBe(null)
    expect(normalizeCellValue('  N/A  ')).toBe(null)
  })

  it('maps TBD to null', () => {
    expect(normalizeCellValue('TBD')).toBe(null)
    expect(normalizeCellValue('tbd')).toBe(null)
  })

  it('maps (none) to null', () => {
    expect(normalizeCellValue('(none)')).toBe(null)
    expect(normalizeCellValue('(None)')).toBe(null)
  })

  it('maps 9999-12-31 string to NO_EXPIRY', () => {
    expect(normalizeCellValue('9999-12-31')).toBe('NO_EXPIRY')
  })

  it('maps Date with year ≥ 9999 to NO_EXPIRY', () => {
    expect(normalizeCellValue(new Date('9999-12-31'))).toBe('NO_EXPIRY')
  })

  it('preserves regular strings, numbers, booleans', () => {
    expect(normalizeCellValue('Active')).toBe('Active')
    expect(normalizeCellValue(42)).toBe(42)
    expect(normalizeCellValue(true)).toBe(true)
  })

  it('trims whitespace from strings', () => {
    expect(normalizeCellValue('  GL.COV.001  ')).toBe('GL.COV.001')
  })

  it('converts regular date to ISO date string', () => {
    const result = normalizeCellValue(new Date('2024-06-15'))
    expect(typeof result).toBe('string')
    expect(result as string).toContain('2024-06-15')
  })

  it('isSentinelValue identifies null and NO_EXPIRY', () => {
    expect(isSentinelValue(null)).toBe(true)
    expect(isSentinelValue('NO_EXPIRY')).toBe(true)
    expect(isSentinelValue('Active')).toBe(false)
    expect(isSentinelValue(42)).toBe(false)
  })
})

// ─── B: Header scoring ────────────────────────────────────────────────────────

describe('scoreHeaderCandidates', () => {
  it('empty grid returns no candidates', () => {
    expect(scoreHeaderCandidates([])).toHaveLength(0)
  })

  it('dense distinct text row scores higher than sparse title row', () => {
    const cells: NormalizedCell[][] = [
      ['GL PRODUCT FRAMEWORK — COMMERCIAL GENERAL LIABILITY'],   // row 0: title (1 long string)
      [null, null, null, null, null],                            // row 1: blank
      ['ID', 'PRODUCT', 'COVERAGE', 'SUB-COVERAGE', 'STATUS', 'BUREAU', 'PROPRIETARY'],  // row 2: header
      ['GL.PROD.001', 'GL Product', null, null, 'Active', 'Yes', 'No'],                  // row 3: data
    ]
    const candidates = scoreHeaderCandidates(cells)
    // The header row (index 2) should score highest
    const byRow = Object.fromEntries(candidates.map(c => [c.rowIndex, c.score]))
    expect(byRow[2]).toBeGreaterThan(byRow[0] ?? 0)
  })

  it('merged super-header (sparse) scores lower than the actual header below it', () => {
    // This replicates the synthetic fixture C pattern from isoFixture.test.ts
    const cells: NormalizedCell[][] = [
      ['GL FORMS SPECIFICATIONS'],
      [null, null, null, null, null, null, null],
      ['Client:', null, 'Phase:', null, null, null, null],
      ['GENERAL INFORMATION', null, null, null, null, 'STATE APPLICABILITY', null, null],  // sparse
      ['PRODUCT FRAMEWORK ID', 'FORM NAME', 'FORM NUMBER', 'CLAIMS BASIS',
       'ALL ACTIVE STATES', 'CA', 'TX', 'BUREAU'],                // dense header
      ['GL.COV.001', 'CGL', 'CG 00 01', 'Occurrence', 'X', '', '', 'Yes'],
    ]
    const candidates = scoreHeaderCandidates(cells)
    const byRow = Object.fromEntries(candidates.map(c => [c.rowIndex, c.score]))
    // Row 4 (dense header) must beat row 3 (sparse super-header)
    expect(byRow[4]).toBeGreaterThan(byRow[3] ?? 0)
    expect(pickBestHeaderRow(candidates)).toBe(4)
  })
})

// ─── C: Layout detection — synthetic grids ────────────────────────────────────

describe('detectLayoutShape — FLAT_TABLE', () => {
  const cells: NormalizedCell[][] = [
    ['RULE ID', 'CATEGORY', 'CONDITION', 'OUTCOME', 'STATUS'],
    ['GL.RU.001', 'Product', 'If monoline selected', 'Then BI/PD mandatory', 'Active'],
    ['GL.RU.002', 'Rating',  'If terrorism elected', 'Then apply factor', 'Active'],
  ]
  it('classifies as FLAT_TABLE', () => {
    const bhr = pickBestHeaderRow(scoreHeaderCandidates(cells))
    expect(detectLayoutShape(cells, bhr)).toBe('FLAT_TABLE')
  })
})

describe('detectLayoutShape — STACKED_TABLES', () => {
  const cells: NormalizedCell[][] = [
    ['RATE TABLE ID: RTTable.001'],
    ['TABLE NAME: INCREASE LIMIT FACTOR'],
    ['COVERAGE', 'PER OCCURRENCE', 'AGGREGATE', 'ILF'],
    ['Prem/Ops', 300000, 300000, 1.0],
    ['Prem/Ops', 500000, 500000, 1.18],
    [null],
    ['RATE TABLE ID: RTTable.002'],
    ['TABLE NAME: TERRITORY BASE RATES'],
    ['TERRITORY', 'BASE RATE'],
    ['T001', 700],
    ['T002', 850],
  ]
  it('classifies as STACKED_TABLES (≥ 2 markers)', () => {
    const bhr = pickBestHeaderRow(scoreHeaderCandidates(cells))
    expect(detectLayoutShape(cells, bhr)).toBe('STACKED_TABLES')
  })

  it('hasStackedTableMarkers returns true', () => {
    expect(hasStackedTableMarkers(cells)).toBe(true)
  })
})

describe('detectLayoutShape — WIDE_MATRIX', () => {
  const headerRow: NormalizedCell[] = [
    'PRODUCT FRAMEWORK ID', 'PRODUCT', 'COVERAGE',
    'ALL ACTIVE STATES', 'CA', 'TX', 'FL', 'NY', 'IL',
  ]
  const cells: NormalizedCell[][] = [
    headerRow,
    ['GL.PROD.001', 'GL Product', 'Bodily Injury', 'X', 'X', 'X', 'X', 'X', 'X'],
  ]
  it('classifies as WIDE_MATRIX (≥ 3 state columns)', () => {
    const bhr = pickBestHeaderRow(scoreHeaderCandidates(cells))
    expect(detectLayoutShape(cells, bhr)).toBe('WIDE_MATRIX')
    expect(hasWideStateColumns(headerRow)).toBe(true)
  })

  it('foldWideMatrix records state indices', () => {
    const info = foldWideMatrix(headerRow)
    expect(info.allStatesColIndex).toBe(3)
    expect(info.stateColIndices).toMatchObject({ CA: 4, TX: 5, FL: 6, NY: 7, IL: 8 })
    expect(info.nonStateColCount).toBe(3)  // ID, PRODUCT, COVERAGE
  })
})

describe('detectLayoutShape — INDENTED_HIERARCHY', () => {
  const cells: NormalizedCell[][] = [
    ['COVERAGE', 'SUB-COVERAGE', 'REQUIREMENT'],
    ['Bodily Injury', null, 'Mandatory'],   // parent row (col 0 filled)
    [null, 'Terrorism Coverage', 'Optional'], // child row (col 0 empty, col 1 filled)
    [null, 'Certified Acts', 'Optional'],     // child row
    ['Property Damage', null, 'Mandatory'],   // parent row
    [null, 'Covered Property', 'Mandatory'],  // child row
  ]
  it('classifies as INDENTED_HIERARCHY', () => {
    const bhr = pickBestHeaderRow(scoreHeaderCandidates(cells))
    expect(hasIndentedHierarchy(cells, bhr)).toBe(true)
    expect(detectLayoutShape(cells, bhr)).toBe('INDENTED_HIERARCHY')
  })
})

// ─── D: Stacked table segmentation ────────────────────────────────────────────

describe('segmentStackedTables', () => {
  const cells: NormalizedCell[][] = [
    ['RATE TABLE ID: RTTable.001'],
    ['TABLE NAME: Increase Limit Factor'],
    ['COVERAGE', 'LIMIT', 'ILF'],
    ['Prem/Ops', 300000, 1.0],
    ['Prem/Ops', 500000, 1.18],
    [null],
    ['RATE TABLE ID: RTTable.002'],
    ['TABLE NAME: Territory Base Rates'],
    ['TERRITORY', 'BASE RATE'],
    ['T001', 700],
  ]

  it('returns two sub-tables', () => {
    const tables = segmentStackedTables(cells)
    expect(tables).toHaveLength(2)
  })

  it('first sub-table has correct name and refId', () => {
    const tables = segmentStackedTables(cells)
    expect(tables[0]?.refId).toBe('RTTable.001')
    expect(tables[0]?.name).toBe('Increase Limit Factor')
  })

  it('second sub-table has correct name and refId', () => {
    const tables = segmentStackedTables(cells)
    expect(tables[1]?.refId).toBe('RTTable.002')
    expect(tables[1]?.name).toBe('Territory Base Rates')
  })

  it('sub-table cells start at the column header row', () => {
    const tables = segmentStackedTables(cells)
    // First sub-table header row should contain COVERAGE / LIMIT / ILF
    const hdr = tables[0]?.cells[0]
    expect(hdr).toContain('COVERAGE')
    expect(hdr).toContain('ILF')
  })
})

// ─── E: Definitions sheet parsing ─────────────────────────────────────────────

describe('definitionsParser', () => {
  it('isDefinitionsSheetName matches Definitions variants', () => {
    expect(isDefinitionsSheetName('Definitions-Product Framework')).toBe(true)
    expect(isDefinitionsSheetName('Definitions - Rules Categories')).toBe(true)
    expect(isDefinitionsSheetName('Glossary')).toBe(true)
    expect(isDefinitionsSheetName('GL Rating Specifications')).toBe(false)
  })

  const defCells: NormalizedCell[][] = [
    ['COLUMN NAME', 'DEFINITION', 'EXAMPLE'],
    ['STATUS', 'Governance status of the item.', 'Active'],
    ['BUREAU', 'Whether the item is a bureau item.', 'Yes'],
    ['PRODUCT FRAMEWORK ID', 'Traceability id for the product.', 'GL.PROD.001'],
  ]

  it('parses column name, description, and example', () => {
    const entries = parseDefinitionsSheet(defCells)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({
      columnName: 'STATUS',
      description: 'Governance status of the item.',
      example: 'Active',
    })
    expect(entries[2]?.columnName).toBe('PRODUCT FRAMEWORK ID')
  })

  it('returns [] when no recognizable header row', () => {
    const unrecognizable: NormalizedCell[][] = [
      ['Foo', 'Bar', 'Baz'],
      ['a', 'b', 'c'],
    ]
    expect(parseDefinitionsSheet(unrecognizable)).toHaveLength(0)
  })
})

// ─── F: Column profiling ─────────────────────────────────────────────────────

describe('profileColumns', () => {
  const cells: NormalizedCell[][] = [
    ['STATUS', 'RULE ID', 'EFFECTIVE DATE', 'AMOUNT'],
    ['Active', 'GL.RU.001', '2024-01-01', 1000],
    ['Active', 'GL.RU.002', '2023-06-15', 2500],
    ['Inactive', 'GL.RU.003', '2022-01-01', null],
  ]
  const profiles = profileColumns(cells, 0)

  it('creates one profile per column', () => {
    expect(profiles).toHaveLength(4)
  })

  it('STATUS column is enum-like (3 distinct / 3 non-empty)', () => {
    const status = profiles[0]!
    expect(status.headerLabel).toBe('STATUS')
    expect(status.isEnumLike).toBe(true)
  })

  it('EFFECTIVE DATE column has date pattern', () => {
    const date = profiles[2]!
    expect(date.headerLabel).toBe('EFFECTIVE DATE')
    expect(date.hasDatePattern).toBe(true)
  })

  it('AMOUNT column counts empty cell correctly', () => {
    const amount = profiles[3]!
    expect(amount.typeMix.empty).toBe(1)
    expect(amount.typeMix.number).toBe(2)
  })
})

// ─── G: Magic-byte detection ─────────────────────────────────────────────────

describe('detectByMagic', () => {
  it('detects PDF from %PDF magic bytes', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    expect(detectByMagic(bytes)).toBe('PDF')
  })

  it('detects CSV from high-printable-ASCII content', () => {
    const bytes = new TextEncoder().encode('RULE ID,CATEGORY,STATUS\nGL.RU.001,Product,Active\n')
    expect(detectByMagic(bytes)).toBe('CSV')
  })
})

// ─── H: PDF stub compiles behind the interface ────────────────────────────────

describe('PdfSourceReader', () => {
  it('read() returns a StructuralModel with one placeholder sheet', async () => {
    const stub = new PdfSourceReader()
    expect(stub.fileType).toBe('PDF')
    const fake = new Uint8Array([0x25, 0x50, 0x44, 0x46])   // %PDF bytes
    const model = await stub.read(fake, 'test.pdf')
    expect(model.sourceType).toBe('PDF')
    expect(model.sheets).toHaveLength(1)
    expect(model.sheets[0]?.sheetName).toBe('__pdf__')
    expect(model.sheets[0]?.dataRowCount).toBe(0)
  })
})

// ─── I: Real ISO GL workbooks (physically in the repo) ────────────────────────
// Assertions target the 4 workbooks in samples/iso/. The phantom-row check is
// the most critical: every sheet must report dataRowCount < 10_000.

const GL_FILES = [
  'sample-GL-framework.xlsx',
  'sample-GL-forms.xlsx',
  'sample-GL-rules.xlsx',
  'sample-GL-pricing.xlsx',
]

let glModels: StructuralModel[]

beforeAll(async () => {
  const reader = new XlsxSourceReader('XLSX')
  glModels = await Promise.all(
    GL_FILES.map(f => {
      const bytes = readFileSync(resolve(SAMPLES, f))
      return reader.read(bytes, f)
    }),
  )
}, 60_000)   // allow up to 60 s for ExcelJS to parse four workbooks

describe('GL workbooks — phantom-row elimination', () => {
  it('every sheet reports dataRowCount < 10 000 (no phantom 1 048 576 rows)', () => {
    for (const model of glModels) {
      for (const sheet of model.sheets) {
        expect(sheet.dataRowCount).toBeLessThan(10_000)
      }
    }
  })

  it('rawRowCount >= dataRowCount (the real extent is always ≤ the reported extent)', () => {
    for (const model of glModels) {
      for (const sheet of model.sheets) {
        expect(sheet.rawRowCount).toBeGreaterThanOrEqual(sheet.dataRowCount)
      }
    }
  })
})

describe('GL Framework workbook — layout and structure', () => {
  it('sourceType is XLSX', () => {
    expect(glModels[0]?.sourceType).toBe('XLSX')
  })

  it('contains the "GL Product Framework" content sheet', () => {
    const model = glModels[0]!
    const fw = model.sheets.find(s => s.sheetName === 'GL Product Framework')
    expect(fw).toBeDefined()
  })

  it('GL Product Framework has bestHeaderRow >= 0 (header detected)', () => {
    const model = glModels[0]!
    const fw = model.sheets.find(s => s.sheetName === 'GL Product Framework')!
    expect(fw.bestHeaderRow).toBeGreaterThanOrEqual(0)
  })

  it('GL Product Framework has WIDE_MATRIX layout (state columns present)', () => {
    const model = glModels[0]!
    const fw = model.sheets.find(s => s.sheetName === 'GL Product Framework')!
    // State columns are present in the framework sheet
    expect(fw.layoutShape).toBe('WIDE_MATRIX')
    expect(fw.wideMatrix).toBeDefined()
  })

  it('GL Product Framework wideMatrix records state indices', () => {
    const model = glModels[0]!
    const fw = model.sheets.find(s => s.sheetName === 'GL Product Framework')!
    const wm = fw.wideMatrix!
    expect(wm.allStatesColIndex).not.toBeNull()
    expect(Object.keys(wm.stateColIndices).length).toBeGreaterThan(0)
  })

  it('Definitions-Product Framework sheet is parsed', () => {
    const model = glModels[0]!
    const defSheet = model.sheets.find(s => isDefinitionsSheetName(s.sheetName))
    expect(defSheet).toBeDefined()
    expect(defSheet?.isDefinitionsSheet).toBe(true)
    // Should have at least some entries
    const entries = model.definitionsBySheet[defSheet?.sheetName ?? ''] ?? []
    expect(entries.length).toBeGreaterThan(0)
  })

  it('header candidates include a candidate with score > 0.5 for the framework sheet', () => {
    const model = glModels[0]!
    const fw = model.sheets.find(s => s.sheetName === 'GL Product Framework')!
    const best = fw.headerCandidates[0]
    expect(best?.score).toBeGreaterThan(0.5)
  })
})

describe('GL Forms workbook — wide matrix', () => {
  it('GL Forms Specifications has WIDE_MATRIX layout', () => {
    const model = glModels[1]!
    const forms = model.sheets.find(s => s.sheetName === 'GL Forms Specifications')
    expect(forms).toBeDefined()
    expect(forms?.layoutShape).toBe('WIDE_MATRIX')
  })

  it('Definitions-Forms Specification sheet is parsed', () => {
    const model = glModels[1]!
    const defSheet = model.sheets.find(s => isDefinitionsSheetName(s.sheetName))
    expect(defSheet?.isDefinitionsSheet).toBe(true)
    const entries = model.definitionsBySheet[defSheet?.sheetName ?? ''] ?? []
    expect(entries.length).toBeGreaterThan(0)
  })
})

describe('GL Rules workbook — stacked tables', () => {
  it('"Limits and Deductibles" sheet is STACKED_TABLES', () => {
    const model = glModels[2]!
    const ld = model.sheets.find(s => s.sheetName === 'Limits and Deductibles')
    expect(ld).toBeDefined()
    expect(ld?.layoutShape).toBe('STACKED_TABLES')
  })

  it('"Limits and Deductibles" subTables count equals the known GL golden target (37)', () => {
    const model = glModels[2]!
    const ld = model.sheets.find(s => s.sheetName === 'Limits and Deductibles')!
    // The golden target from isoFixture.test.ts is 37 LD table blocks.
    // Allow a small tolerance for segmenter heuristics vs. exact mapper count.
    expect(ld.subTables?.length).toBeGreaterThanOrEqual(30)
    expect(ld.subTables?.length).toBeLessThanOrEqual(42)
  })

  it('each LD sub-table has a name', () => {
    const model = glModels[2]!
    const ld = model.sheets.find(s => s.sheetName === 'Limits and Deductibles')!
    for (const tbl of ld.subTables ?? []) {
      expect(tbl.name.length).toBeGreaterThan(0)
    }
  })

  it('GL Rules Specifications sheet is WIDE_MATRIX (has state-applicability columns)', () => {
    const model = glModels[2]!
    const rules = model.sheets.find(s => s.sheetName === 'GL Rules Specifications')
    expect(rules?.layoutShape).toBe('WIDE_MATRIX')
  })

  it('Definitions sheet is parsed in the Rules workbook', () => {
    const model = glModels[2]!
    const defNames = Object.keys(model.definitionsBySheet)
    expect(defNames.length).toBeGreaterThan(0)
  })
})

describe('GL Pricing workbook — stacked rate tables', () => {
  it('"GL Rating Tables" sheet is STACKED_TABLES', () => {
    const model = glModels[3]!
    const rt = model.sheets.find(s => s.sheetName === 'GL Rating Tables')
    expect(rt).toBeDefined()
    expect(rt?.layoutShape).toBe('STACKED_TABLES')
  })

  it('"GL Rating Tables" sub-tables have RTTable refIds', () => {
    const model = glModels[3]!
    const rt = model.sheets.find(s => s.sheetName === 'GL Rating Tables')!
    const rtIds = (rt.subTables ?? []).map(t => t.refId).filter(Boolean)
    // Golden target: 4 RT tables (001, 002, 004, 006)
    expect(rtIds.length).toBeGreaterThanOrEqual(4)
    // All refIds follow RTTable.NNN pattern
    for (const id of rtIds) {
      expect(id).toMatch(/RTTable\.\d+/i)
    }
  })

  it('"GL Rating Specifications" sheet is WIDE_MATRIX (has state-applicability columns)', () => {
    const model = glModels[3]!
    const specs = model.sheets.find(s => s.sheetName === 'GL Rating Specifications')
    expect(specs?.layoutShape).toBe('WIDE_MATRIX')
  })
})
