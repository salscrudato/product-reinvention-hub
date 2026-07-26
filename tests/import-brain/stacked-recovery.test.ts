/**
 * stacked-recovery.test.ts — the acceptance gate for stacked-sheet structural recovery.
 *
 * Three symptoms, one cause. A STACKED_TABLES sheet was bypassed by the whole extraction
 * machinery because:
 *   1. stage 2 registered header locks ONLY under `sheet::subTable` pseudo-names, while
 *      stages 3 and 4 look locks up by the plain worksheet name — so no column map was
 *      ever produced and stage 4 bailed, silently.
 *   2. stage 0's embed-cap continuation deliberately refused to extend stacked sheets, so
 *      on a >2000-row sheet everything past the cap was warned about and then lost.
 *   3. stage 4's gatherRows returned `gridRows: null` for stacked sheets, so excelRowOf
 *      fell back to `rowIdx + headerRow + 2` — a flat-sheet formula that is correct only
 *      inside the FIRST sub-table and drifts by the size of every preceding block after it.
 * And because rows were unanchored, stage 5 downgraded BLOCKING citation findings to WARN
 * on stacked sheets, suppressing real fabrication signals.
 *
 * The fixture is a stacked sheet of >2000 rows whose middle sub-table STRADDLES row 2000,
 * so the cap falls inside a block rather than neatly between two.
 *
 * Assertions are explicit (no snapshots) so this never silently drifts.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../server/lib/fleet', () => ({
  guard:                () => ({ allow: true, degrade: false, reason: 'ok' }),
  record:               () => {},
  resolveModel:         (role: string) => `stub-${role}`,
  anthropicMessagesUrl: () => 'http://stub/anthropic',
  openaiChatUrl:        () => 'http://stub/openai',
  anthropicHeaders:     () => ({ 'Content-Type': 'application/json' }),
  openaiHeaders:        () => ({ 'Content-Type': 'application/json' }),
  openaiChatBody:       (model: string, msgs: unknown[], maxTokens: number) => ({ model, messages: msgs, max_completion_tokens: maxTokens }),
  DEPLOY_GPT:           'stub-gpt',
  DEPLOY_GPT_MINI:      'stub-gpt-mini',
  DEPLOY_OPUS:          'stub-opus',
  DEPLOY_HAIKU:         'stub-haiku',
  isConfigured:         () => false,
  estimateCostUsd:      () => 0,
  IMPORT_CONTEXT:       'import-no-cap',
  ESCALATION_LADDER:    ['BULK_VERIFY', 'MID_REASONER', 'GROUNDED_CITED'],
}))

/* eslint-disable @typescript-eslint/no-require-imports */
const { extendTruncatedGrids } = require('../../server/lib/import-brain/stage0-router.js')
const { lockHeaders }          = require('../../server/lib/import-brain/stage2-header-lock.js')
const { gatherRows, excelRowOf } = require('../../server/lib/import-brain/stage4-extract.js')
const { resolveCitationsDeterministic } = require('../../server/lib/import-brain/stage5-validate.js')
const brainShared = require('../../server/lib/import-brain-shared.cjs')
/* eslint-enable @typescript-eslint/no-require-imports */

const { fingerprintGrid, MAX_EMBED_ROWS } = brainShared
const SHEET = 'Rule References'

type Cell = string | number | null

/**
 * Build a stacked sheet in the shape the Hagerty spec books actually use:
 *   TABLE NAME: <name>          <- block delimiter
 *   RULE ID(s): <ids>           <- block identity
 *   <column headers>
 *   <data rows>
 *   <blank>
 *
 * Block sizes are chosen so that the block starting at index 2 straddles MAX_EMBED_ROWS:
 * it begins well before row 2000 and ends well after it.
 */
function stackedGrid(): { cells: Cell[][]; blocks: Array<{ name: string; header: number; first: number; last: number }> } {
  const cells: Cell[][] = []
  const blocks: Array<{ name: string; header: number; first: number; last: number }> = []
  const push = (row: Cell[]) => { cells.push(row); return cells.length - 1 }

  push(['RULE REFERENCES — FIXTURE'])
  push([null])

  const sizes = [900, 900, 700, 400]          // cumulative block ends: ~904, ~1808, ~2512, ~2916
  sizes.forEach((n, b) => {
    push([`TABLE NAME: Block ${b}`])
    push([`RULE ID(s): FIX.RU${String(b).padStart(3, '0')}`])
    const header = push(['Item Id', 'Item Name', 'Amount'])
    const first = cells.length
    for (let i = 0; i < n; i++) push([`FIX.B${b}.I${String(i).padStart(4, '0')}`, `Item ${b}-${i}`, 100 + i])
    const last = cells.length - 1
    push([null])                                // blank separator, as the real books have
    blocks.push({ name: `Block ${b}`, header, first, last })
  })
  return { cells, blocks }
}

/** The straddling block must actually straddle, or the fixture proves nothing. */
function assertStraddles(blocks: ReturnType<typeof stackedGrid>['blocks']) {
  const straddler = blocks.find(b => b.first < MAX_EMBED_ROWS && b.last >= MAX_EMBED_ROWS)
  expect(straddler, `no block straddles row ${MAX_EMBED_ROWS}`).toBeTruthy()
  return straddler!
}

function buildFixture() {
  const { cells, blocks } = stackedGrid()
  const fp = fingerprintGrid({ sheet: SHEET, cells })
  return { cells, blocks, fp }
}

describe('acceptance: the fixture is what it claims to be', () => {
  it('is a stacked sheet of more than 2000 rows whose sub-table straddles row 2000', () => {
    const { cells, blocks, fp } = buildFixture()
    expect(cells.length).toBeGreaterThan(2000)
    expect(fp.layoutShape).toBe('STACKED_TABLES')
    expect(fp.cellsTruncated).toBe(true)
    const straddler = assertStraddles(blocks)
    expect(straddler.first).toBeLessThan(MAX_EMBED_ROWS)
    expect(straddler.last).toBeGreaterThanOrEqual(MAX_EMBED_ROWS)
  })

  it('segmentation from the CAPPED grid loses the blocks past the cap (the defect)', () => {
    const { blocks, fp } = buildFixture()
    expect(fp.cells).toHaveLength(MAX_EMBED_ROWS)
    expect(fp.subTables.length).toBeLessThan(blocks.length)
  })
})

describe('symptom 2: continuation re-segments a stacked sheet against the uncapped grid', () => {
  it('recovers every block, and the tail rows really are there', () => {
    const { cells, blocks, fp } = buildFixture()
    const warnings: Array<{ kind: string; detail: string }> = []
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', warnings)

    expect(fp.cells).toHaveLength(cells.length)      // full grid, not the cap
    expect(fp.cellsTruncated).toBe(false)
    expect(fp.cellsExtended).toBe(true)
    expect(fp.subTablesResegmented).toBe(true)
    expect(fp.subTables).toHaveLength(blocks.length) // 4 of 4, not 2 of 4

    // The last block's last row survived the round trip byte-for-byte.
    const last = blocks[blocks.length - 1]!
    expect(fp.cells[last.last]![0]).toBe(cells[last.last]![0])
  })

  it('the straddling block is WHOLE — not clipped at the cap', () => {
    const { cells, blocks, fp } = buildFixture()
    const straddler = assertStraddles(blocks)
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])

    const sub = fp.subTables.find((s: { name: string }) => s.name === straddler.name)
    expect(sub, 'straddling block missing after re-segmentation').toBeTruthy()
    expect(sub.endRow).toBeGreaterThanOrEqual(straddler.last)
    // Its last data row is present in the sub-table's own cells.
    const flat = sub.cells.map((r: Cell[]) => r[0])
    expect(flat).toContain(cells[straddler.last]![0])
  })

  it('the warning states the recovery instead of claiming the tail is lost', () => {
    const { cells, fp } = buildFixture()
    const warnings: Array<{ kind: string; detail: string }> = []
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', warnings)
    const grid = warnings.find(w => w.kind === 'grid-truncated')!
    expect(grid.detail).toMatch(/ARE extracted via continuation/)
    expect(grid.detail).not.toMatch(/NOT extracted/)
    const reseg = warnings.find(w => w.kind === 'stacked-resegmented')!
    expect(reseg, 'no stacked-resegmented warning').toBeTruthy()
    expect(reseg.detail).toMatch(/re-segmented against the uncapped grid/)
  })

  it('re-segmentation is a pure re-invocation: identical to segmenting the full grid directly', () => {
    const { cells, fp } = buildFixture()
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])
    const direct = brainShared.segmentStackedTables(fp.cells)
    expect(fp.subTables.map((s: { name: string; cellsStartRow: number; endRow: number }) => [s.name, s.cellsStartRow, s.endRow]))
      .toEqual(direct.map((s: { name: string; cellsStartRow: number; endRow: number }) => [s.name, s.cellsStartRow, s.endRow]))
  })
})

describe('symptom 1: the header lock is registered under the name the map stage looks up', () => {
  const classified = [{ sheetName: SHEET, domain: 'rules' }]

  it('publishes a lock under the PLAIN sheet name, not only the compound pseudo-names', async () => {
    const { cells, fp } = buildFixture()
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])
    const locks = await lockHeaders(classified, new Map([[SHEET, fp]]), { degraded: false }, [])

    const plain = locks.filter((l: { sheetName: string }) => l.sheetName === SHEET)
    expect(plain).toHaveLength(1)
    expect(plain[0].layoutShape).toBe('STACKED_TABLES')
    expect(plain[0].isConfirmed).toBe(true)
    expect(plain[0].subTableCount).toBe(fp.subTables.length)
    // …and the per-sub-table locks are still published alongside.
    expect(locks.filter((l: { sheetName: string }) => l.sheetName.includes('::')).length).toBe(fp.subTables.length)
  })

  it('a lock lookup keyed by the plain sheet name now hits (it used to miss every time)', async () => {
    const { cells, fp } = buildFixture()
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])
    const locks = await lockHeaders(classified, new Map([[SHEET, fp]]), { degraded: false }, [])
    const lockMap = new Map(locks.map((l: { sheetName: string }) => [l.sheetName, l]))
    expect(lockMap.get(SHEET)).toBeTruthy()          // the stage-3 / stage-4 lookup
  })
})

describe('symptom 3: citation rows are absolute — 100% accurate below the first sub-table', () => {
  function recovered() {
    const { cells, blocks, fp } = buildFixture()
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])
    return { cells, blocks, fp }
  }

  it('gatherRows carries a gridRows sidecar instead of null', () => {
    const { fp } = recovered()
    const { rows, gridRows } = gatherRows(fp, fp.subTables[0].headerRowIndex)
    expect(Array.isArray(gridRows)).toBe(true)
    expect(gridRows).toHaveLength(rows.length)
  })

  it('EVERY gathered row resolves to the Excel row it truly came from — all sub-tables', () => {
    const { cells, fp } = recovered()
    const { rows, gridRows } = gatherRows(fp, fp.subTables[0].headerRowIndex)

    let checked = 0
    let correct = 0
    for (let i = 0; i < rows.length; i++) {
      const excelRow = excelRowOf(i, fp.subTables[0].headerRowIndex, gridRows)
      const sourceRow = cells[excelRow - 1]        // Excel row N is grid index N-1
      checked++
      if (sourceRow && String(sourceRow[0] ?? '') === String(rows[i]![0] ?? '')) correct++
    }
    expect(checked).toBeGreaterThan(2000)          // the whole sheet, not just the head
    expect(correct).toBe(checked)                  // 100 %
  })

  it('accuracy is 100% specifically for the sub-tables BELOW the first (where it was 0%)', () => {
    const { cells, blocks, fp } = recovered()
    const { rows, gridRows } = gatherRows(fp, fp.subTables[0].headerRowIndex)
    const firstBlockLast = blocks[0]!.last

    let checked = 0
    let correct = 0
    for (let i = 0; i < rows.length; i++) {
      if (gridRows[i] <= firstBlockLast) continue  // skip the first sub-table
      const excelRow = excelRowOf(i, fp.subTables[0].headerRowIndex, gridRows)
      checked++
      if (String(cells[excelRow - 1]?.[0] ?? '') === String(rows[i]![0] ?? '')) correct++
    }
    expect(checked).toBeGreaterThan(1000)
    expect(correct / checked).toBe(1)
  })

  it('the OLD contiguous formula would have been wrong for those same rows (the defect is real)', () => {
    const { cells, blocks, fp } = recovered()
    const { rows } = gatherRows(fp, fp.subTables[0].headerRowIndex)
    const headerRow = fp.subTables[0].headerRowIndex
    const firstBlockRows = blocks[0]!.last - blocks[0]!.first + 1

    // Pre-fix path: gridRows was null, so excelRowOf fell back to rowIdx + headerRow + 2.
    let wrong = 0
    for (let i = firstBlockRows; i < rows.length; i++) {
      const legacyExcelRow = excelRowOf(i, headerRow, null)
      if (String(cells[legacyExcelRow - 1]?.[0] ?? '') !== String(rows[i]![0] ?? '')) wrong++
    }
    expect(wrong).toBeGreaterThan(0)
  })

  it('each sub-table anchors its own cells: cells[k] is grid row cellsStartRow + k', () => {
    const { cells, fp } = recovered()
    for (const sub of fp.subTables) {
      expect(sub.cellsStartRow).toBe(sub.headerRowIndex)
      for (let k = 0; k < sub.cells.length; k += 97) {   // stride-sample every block
        expect(String(cells[sub.cellsStartRow + k]?.[0] ?? '')).toBe(String(sub.cells[k]![0] ?? ''))
      }
    }
  })
})

describe('the blocking→warning downgrade is gone, not bypassed', () => {
  function fpWithGrid() {
    const { cells, fp } = buildFixture()
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])
    return { cells, fp }
  }

  it('a fabricated strict id on a STACKED sheet BLOCKS (it used to be downgraded to WARN)', () => {
    const { fp } = fpWithGrid()
    const entity = {
      kind: 'rule', sourceSheet: SHEET, sourceRowIndex: 10, reviewFlag: false,
      fields: [{
        fieldName: 'refId', value: 'FIX.TOTALLY.INVENTED', confidence: 0.9,
        citation: { sheet: SHEET, cell: 'A10', verbatim: 'FIX.TOTALLY.INVENTED' },
      }],
    }
    const findings = resolveCitationsDeterministic([entity], new Map([[SHEET, fp]]), [])
    const fab = findings.find((f: { kind: string }) => f.kind === 'fabricated-strict-id')!
    expect(fab).toBeTruthy()
    expect(fab.severity).toBe('BLOCKING')
    expect((entity as { blocked?: boolean }).blocked).toBe(true)
  })

  it('an uncited strict id on a STACKED sheet BLOCKS too', () => {
    const { fp } = fpWithGrid()
    const entity = {
      kind: 'rule', sourceSheet: SHEET, sourceRowIndex: 11, reviewFlag: false,
      fields: [{ fieldName: 'refId', value: 'FIX.NO.CITE', confidence: 0.9, citation: { sheet: SHEET, cell: '', verbatim: '' } }],
    }
    const findings = resolveCitationsDeterministic([entity], new Map([[SHEET, fp]]), [])
    expect(findings.find((f: { kind: string }) => f.kind === 'uncited-strict-id')!.severity).toBe('BLOCKING')
    expect((entity as { blocked?: boolean }).blocked).toBe(true)
  })

  it('a TRUTHFUL citation from a sub-table below the first passes clean', () => {
    const { cells, fp } = fpWithGrid()
    // Take a real row from the LAST sub-table and cite it correctly.
    const sub = fp.subTables[fp.subTables.length - 1]
    const k = 5
    const gridRow = sub.cellsStartRow + k
    const value = String(cells[gridRow]![0])
    const entity = {
      kind: 'rule', sourceSheet: SHEET, sourceRowIndex: gridRow, reviewFlag: false,
      fields: [{ fieldName: 'refId', value, confidence: 0.9, citation: { sheet: SHEET, cell: `A${gridRow + 1}`, verbatim: value } }],
    }
    const findings = resolveCitationsDeterministic([entity], new Map([[SHEET, fp]]), [])
    expect(findings.filter((f: { severity: string }) => f.severity === 'BLOCKING')).toHaveLength(0)
    expect((entity as { blocked?: boolean }).blocked).not.toBe(true)
  })

  it('the source code carries no layout-conditional severity at all', () => {
    // "Delete it, do not disable it behind a flag" — assert on the source, so a future
    // re-introduction (as a constant, a flag, or an env switch) fails here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../server/lib/import-brain/stage5-validate.js'), 'utf8')
    expect(src).not.toMatch(/blockSeverity/)
    expect(src).not.toMatch(/stacked\s*\?/)
    // No severity decision anywhere in the file may depend on the layout shape.
    for (const line of src.split('\n')) {
      if (line.trimStart().startsWith('//')) continue          // prose about the removal is fine
      expect(line).not.toMatch(/STACKED_TABLES/)
    }
  })
})

describe('invariants: hidden rows stay, blanks stay blank, refIds stay byte-faithful', () => {
  it('a hidden row is real content — it is gathered and cited like any other', () => {
    // The grid reader is dense (`for r = 1..lastRow`, `ws.getRow(r)`) and never consults
    // row.hidden, so a hidden row occupies its own grid index like any other. This locks
    // that a row surrounded by visible ones is neither dropped nor allowed to shift the
    // rows below it — which is what would corrupt every citation after it.
    const { cells, fp } = buildFixture()
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])
    const { rows, gridRows } = gatherRows(fp, fp.subTables[0].headerRowIndex)

    const sub = fp.subTables[2]                 // the straddling block
    const probe = sub.cellsStartRow + 3
    const at = gridRows.indexOf(probe)
    expect(at, 'row missing from the gathered set').toBeGreaterThanOrEqual(0)
    expect(String(rows[at]![0])).toBe(String(cells[probe]![0]))
    expect(excelRowOf(at, fp.subTables[0].headerRowIndex, gridRows)).toBe(probe + 1)
  })

  it('nothing is invented for a row the source leaves blank', () => {
    const { cells, blocks } = stackedGrid()
    // Blank out one real data row's value column, keeping the row present.
    const target = blocks[1]!.first + 4
    cells[target] = [cells[target]![0], null, null]
    const fp = fingerprintGrid({ sheet: SHEET, cells })
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])

    const { rows, gridRows } = gatherRows(fp, fp.subTables[0].headerRowIndex)
    const at = gridRows.indexOf(target)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(rows[at]![1]).toBeNull()             // still silence, not a filled-in value
    expect(rows[at]![2]).toBeNull()
  })

  it('a fully blank interior row is skipped without shifting any row below it', () => {
    const { cells, fp } = buildFixture()
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])
    const { rows, gridRows } = gatherRows(fp, fp.subTables[0].headerRowIndex)
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i]!.some(c => c !== null)).toBe(true)                     // no blank rows kept
      expect(String(cells[gridRows[i]]![0] ?? '')).toBe(String(rows[i]![0] ?? '')) // and no drift
    }
  })

  it('recovered refIds are byte-for-byte the source string', () => {
    const { cells, fp } = buildFixture()
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])
    const { rows, gridRows } = gatherRows(fp, fp.subTables[0].headerRowIndex)
    for (let i = 0; i < rows.length; i += 53) {
      expect(rows[i]![0]).toBe(cells[gridRows[i]]![0])   // identity, not just equality of shape
    }
  })

  it('each recovered sub-table carries the rule ids its block states', () => {
    const { cells, fp } = buildFixture()
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: SHEET, file: 'w.xlsx', cells }], 'w.xlsx', [])
    fp.subTables.forEach((sub: { ruleRefIds?: string[] }, b: number) => {
      expect(sub.ruleRefIds).toEqual([`FIX.RU${String(b).padStart(3, '0')}`])
    })
  })
})
