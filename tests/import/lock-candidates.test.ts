/**
 * lock-candidates.test.ts — CE1-S8: the BACKLOG_SEED section-3 pinning locks.
 *
 * The diagnostic proved these defenses ALREADY EXIST in code; each gets a
 * regression lock so a refactor cannot silently un-fix it. L4 (used-range
 * bounding) lives in tests/import-brain/parser-armor.test.ts with the armor.
 *
 *   L1  splitList multi-value semantics
 *   L2  header discovery window (first 20 rows, >=3 alias hits)
 *   L3  sentinel filter at BOTH layers (mapper PLACEHOLDER + stage7 PLACEHOLDER_RE)
 *   L5  stacked-table segmentation (two RT tables + an LD table)
 *   L6  multi-refId cells expand deterministically, ids byte-identical
 *   L7  CSV path carries NO isoGrids (the R1 trigger condition, documented)
 */
import { describe, it, expect, vi } from 'vitest'
import { mapIsoWorkbook, splitList, isPlaceholder, type IsoGrid } from '../../shared/src/insurance/isoImport'

// Fleet stub BEFORE any CJS require that reaches ai-call (L7's router). Mirrors
// tests/import-brain/brain-routing.test.ts.
vi.mock('../../server/lib/fleet', () => ({
  guard: () => ({ allow: true, degrade: false, reason: 'ok' }),
  record: () => {},
  resolveModel: (role: string) => `stub-${role}`,
  anthropicMessagesUrl: () => 'http://stub/anthropic',
  openaiChatUrl: () => 'http://stub/openai',
  anthropicHeaders: () => ({ 'Content-Type': 'application/json' }),
  openaiHeaders: () => ({ 'Content-Type': 'application/json' }),
  openaiChatBody: (model: string, msgs: unknown[], maxTokens: number) => ({ model, messages: msgs, max_completion_tokens: maxTokens }),
  DEPLOY_GPT: 'stub-gpt', DEPLOY_GPT_MINI: 'stub-gpt-mini', DEPLOY_OPUS: 'stub-opus', DEPLOY_HAIKU: 'stub-haiku',
  isConfigured: () => false,
  estimateCostUsd: () => 0,
  IMPORT_CONTEXT: 'import-no-cap',
  ESCALATION_LADDER: ['BULK_VERIFY', 'MID_REASONER', 'GROUNDED_CITED'],
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { splitMultiRefId, REFID_TOKEN } = require('../../server/lib/import-brain/constants.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildImportPlan } = require('../../server/lib/import-brain/stage7-plan.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { routeArtifacts } = require('../../server/lib/import-brain/stage0-router.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require('exceljs')

const grid = (sheet: string, cells: (string | number | null)[][]): IsoGrid => ({ sheet, file: 'fixture', cells })

describe('L1: splitList multi-value semantics (isoImport)', () => {
  const cases: Array<{ input: string; expected: string[]; note: string }> = [
    { input: 'GL.COV.002\nGL.COV.003', expected: ['GL.COV.002', 'GL.COV.003'], note: 'newline split' },
    { input: 'CG 21 70\nCG 21 87', expected: ['CG 21 70', 'CG 21 87'], note: 'form-number internal spaces preserved' },
    { input: 'AC 900; AC 00 01', expected: ['AC 900', 'AC 00 01'], note: 'semicolon split' },
    { input: 'GL.COV.001, GL.COV.002', expected: ['GL.COV.001', 'GL.COV.002'], note: 'comma split' },
    { input: 'CG 21 70 CG 21 87', expected: ['CG 21 70 CG 21 87'], note: 'DOCUMENTED: bare-space lists are NOT split (protects form numbers)' },
    { input: 'N/A\nGL.COV.001', expected: ['GL.COV.001'], note: 'placeholders dropped' },
    { input: '<placeholder>', expected: [], note: 'placeholder-only cell yields nothing' },
  ]
  for (const c of cases) {
    it(`${c.note}: ${JSON.stringify(c.input)}`, () => {
      expect(splitList(c.input)).toEqual(c.expected)
    })
  }
})

describe('L2: header discovery window (first 20 rows, >=3 alias hits)', () => {
  const HEADER = ['PRODUCT FRAMEWORK ID', 'COVERAGE NAME', 'PRODUCT', 'STATUS']
  const DATA = [
    ['GL.PROD.001', null, 'CGL Product', 'Active'],
    ['GL.COV.001', 'Premises Liability', 'CGL Product', 'Active'],
  ]
  const padRows = (n: number): (string | null)[][] => Array.from({ length: n }, () => [null, null, null, null])

  it('headers on row 5 (inside the window) parse', () => {
    const plan = mapIsoWorkbook([grid('GL Product Framework', [...padRows(5), HEADER, ...DATA])])
    expect(plan.coverages.map(c => c.refId)).toEqual(['GL.COV.001'])
  })

  it('headers on row 21 (outside the window) are a DOCUMENTED skip with a warning', () => {
    const plan = mapIsoWorkbook([grid('GL Product Framework', [...padRows(21), HEADER, ...DATA])])
    expect(plan.coverages).toHaveLength(0)
    expect(plan.summary.warnings.some(w => /no recognizable header row/i.test(w))).toBe(true)
  })
})

describe('L3: sentinel filter at both layers', () => {
  it('mapper layer (PLACEHOLDER): pins the EXACT vocabulary, including what it does NOT match', () => {
    // Matches:
    expect(isPlaceholder('<Placeholder>')).toBe(true)
    expect(isPlaceholder('<Intentionally Left Blank>')).toBe(true)
    expect(isPlaceholder('N/A')).toBe(true)
    expect(isPlaceholder('na')).toBe(true)
    expect(isPlaceholder('not applicable')).toBe(true)
    expect(isPlaceholder('')).toBe(true)
    // DOCUMENTED DIVERGENCE (do not "align" without a canary sweep): the mapper
    // keeps TBD/xxx/... alive — mapReview keys on TBD -> IN_PROGRESS, and the
    // brain path nulls them earlier in structure/sentinels.normalizeCellValue.
    expect(isPlaceholder('TBD')).toBe(false)
    expect(isPlaceholder('xxx')).toBe(false)
    expect(isPlaceholder('...')).toBe(false)
    // Real values never match:
    expect(isPlaceholder('GL.COV.001')).toBe(false)
    expect(isPlaceholder('CG 21 70')).toBe(false)
  })

  it('stage-7 layer (PLACEHOLDER_RE): placeholder-only rows route to unresolved, never planned', () => {
    const tokens = ['<Placeholder>', '<Intentionally Left Blank>', 'N/A', 'TBD', 'xxx', '...']
    const entities = tokens.map((t, i) => ({
      kind: 'coverage', sourceRowIndex: i, sourceSheet: 'FW', reviewFlag: false, needsRefIdSynthesis: false,
      overallConfidence: 0.9,
      fields: [{ fieldName: 'name', value: t, confidence: 0.9, citation: { sheet: 'FW', cell: `B${i + 2}`, verbatim: t } }],
    }))
    const bundle = buildImportPlan({ entities, importWarnings: [], classifiedSheets: [], columnMaps: [] }, { sourceName: 'fixture.xlsx' })
    expect(bundle.plan.coverages).toHaveLength(0)
    const placeholderUnresolved = bundle.unresolved.filter((u: { reason: string }) => /placeholder-only row/.test(u.reason))
    expect(placeholderUnresolved).toHaveLength(tokens.length)
  })
})

describe('L5: stacked-table segmentation (two RT tables + an LD table)', () => {
  it('segments exactly two RT tables with correct row attribution', () => {
    const rt = grid('Rating Tables', [
      ['RATE TABLE NAME:', 'Base Rates'],
      ['RATE TABLE ID:', 'RTTable.001'],
      ['tier', 'factor'],
      ['A', 1.0],
      ['B', 1.1],
      ['RATE TABLE NAME:', 'Territory Factors'],
      ['RATE TABLE ID:', 'RTTable.002'],
      ['territory', 'factor'],
      ['T1', 0.9],
      ['T2', 1.2],
      ['T3', 1.5],
    ])
    const plan = mapIsoWorkbook([rt])
    expect(plan.rtTables.map(t => t.refId)).toEqual(['RTTable.001', 'RTTable.002'])
    const t1 = plan.rtTables[0]!.data as { rows: Record<string, unknown>[] }
    const t2 = plan.rtTables[1]!.data as { rows: Record<string, unknown>[] }
    // Row attribution is exact: no row bleeds across the marker boundary.
    expect(t1.rows).toEqual([{ tier: 'A', factor: 1 }, { tier: 'B', factor: 1.1 }])
    expect(t2.rows).toEqual([{ territory: 'T1', factor: 0.9 }, { territory: 'T2', factor: 1.2 }, { territory: 'T3', factor: 1.5 }])
  })

  it('parses the LD sheet alongside without cross-contamination', () => {
    const ld = grid('Limits and Deductibles', [
      ['LDTable.001', 'TABLE NAME', 'Occurrence Limits'],
      [null, null, null, 'AVAILABLE LIMITS', 'COMMENT'],
      [null, null, null, 1000000, null],
      [null, null, null, 2000000, 'default'],
      ['LDTable.002', 'TABLE NAME', 'Aggregate Limits'],
      [null, null, null, 'AVAILABLE LIMITS', 'COMMENT'],
      [null, null, null, 3000000, null],
    ])
    const plan = mapIsoWorkbook([ld])
    expect(plan.ldTables.map(t => t.refId)).toEqual(['LDTable.001', 'LDTable.002'])
    const d1 = plan.ldTables[0]!.data as { rows: { value: number }[]; defaultValue?: number }
    const d2 = plan.ldTables[1]!.data as { rows: { value: number }[] }
    expect(d1.rows.map(r => r.value)).toEqual([1000000, 2000000])
    expect(d1.defaultValue).toBe(2000000)
    expect(d2.rows.map(r => r.value)).toEqual([3000000])
  })
})

describe('L6: multi-refId cells expand deterministically (constants.splitMultiRefId)', () => {
  it('one cell, three refIds -> three byte-identical ids', () => {
    expect(splitMultiRefId('GL.COV.001 GL.COV.002 GL.COV.003')).toEqual(['GL.COV.001', 'GL.COV.002', 'GL.COV.003'])
  })
  it('a single refId passes through byte-for-byte', () => {
    expect(splitMultiRefId('GL.COV.001')).toEqual(['GL.COV.001'])
  })
  it('a non-refId cell stays whole (trimmed), never invented', () => {
    expect(splitMultiRefId('  Premises Liability  ')).toEqual(['Premises Liability'])
  })
  it('DOCUMENTED: REFID_TOKEN needs dot-separated segments (dash ids do not tokenize)', () => {
    expect('GL-COV-001 GL-COV-002'.match(new RegExp(REFID_TOKEN.source, 'gi'))).toBeNull()
  })
})

describe('L7: CSV path carries NO isoGrids — the R1 trigger condition', () => {
  it('routes a CSV without isoGrids and an XLSX with them (flips red if CSV is ever wired into the oracle)', async () => {
    // XLSX artifact built in-test.
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('GL Product Framework')
    ws.getCell('A1').value = 'PRODUCT FRAMEWORK ID'
    ws.getCell('A2').value = 'GL.COV.001'
    const xlsxB64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')

    const csvText = 'PRODUCT FRAMEWORK ID,COVERAGE NAME\nGL.COV.001,Premises\nGL.COV.001.001,Child'
    const routed = await routeArtifacts({
      documents: [
        { name: 'two-row.csv', text: csvText },
        { name: 'framework.xlsx', base64: xlsxB64 },
      ],
      extractPdfText: () => null,
    })

    const csv = routed.workbooks.find((w: { name: string }) => w.name === 'two-row.csv')
    const xlsx = routed.workbooks.find((w: { name: string }) => w.name === 'framework.xlsx')
    expect(csv).toBeTruthy()
    expect(xlsx).toBeTruthy()
    // THE documented gate (unified-import.js oracle runs only when isoGrids is a
    // non-empty array): CSV pushes carry NO isoGrids. The day this assertion
    // flips, R1's masking is total and the retired lowercase minters are dead
    // code to delete (BACKLOG_SEED L7).
    expect(csv.isoGrids).toBeUndefined()
    expect(Array.isArray(xlsx.isoGrids)).toBe(true)
    expect(xlsx.isoGrids.length).toBeGreaterThan(0)
  }, 60_000)
})
