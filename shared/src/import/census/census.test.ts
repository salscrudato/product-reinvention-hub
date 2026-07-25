// census.test.ts — CE1-S4 locks: cell census build, merge normalization,
// gap segmentation, and the conservation ledger math.
import { describe, it, expect } from 'vitest'
import { fnv1a64 } from './hash'
import { buildSheetCensus, colLabel, cellRef, rawVerbatim, classifyCellType, VERBATIM_CAP, DENSE_CELL_CEILING, DENSE_MAX_COLS } from './buildCensus'
import { segmentTableRegions } from './regions'
import { createAccounting, post, postSpan, rollupSheet, rollupWorkbook } from './accounting'
import type { RawCensusCell, RawCensusSheet } from './types'

const C = (v: unknown, extra: Partial<RawCensusCell> = {}): RawCensusCell => ({ v, ...extra })

function sheet(cells: (RawCensusCell | null)[][], over: Partial<RawCensusSheet> = {}): RawCensusSheet {
  return { name: 'S', hidden: false, cells, merges: [], ...over }
}

describe('fnv1a64 — stable identity pins', () => {
  it('pins the digest definition (regression vectors)', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325')            // FNV-1a offset basis
    expect(fnv1a64('a')).toBe('089be207b544f1e4')           // this impl hashes both UTF-16 bytes
    expect(fnv1a64('GL.COV.001')).toBe('a9649dabf90fc535')
    expect(fnv1a64('GL.COV.001')).not.toBe(fnv1a64('gl.cov.001'))  // case-sensitive
  })
})

describe('cell addressing', () => {
  it('colLabel covers single and double letters', () => {
    expect(colLabel(0)).toBe('A')
    expect(colLabel(25)).toBe('Z')
    expect(colLabel(26)).toBe('AA')
    expect(colLabel(147)).toBe('ER')   // Client Master PCM width (148 cols, 0-based 147)
  })
  it('cellRef is Sheet!A1-style, 1-based rows', () => {
    expect(cellRef('PCM', 0, 0)).toBe('PCM!A1')
    expect(cellRef('PCM', 9, 27)).toBe('PCM!AB10')
  })
})

describe('rawVerbatim / classifyCellType — raw fidelity', () => {
  it('keeps strings untrimmed and byte-faithful', () => {
    expect(rawVerbatim('  CG 21 70  ')).toBe('  CG 21 70  ')
  })
  it('formula cells contribute their cached result and type formula', () => {
    const f = { formula: 'A1*2', result: 42 }
    expect(rawVerbatim(f)).toBe('42')
    expect(classifyCellType(f)).toBe('formula')
  })
  it('rich text concatenates; dates go ISO; errors surface their token', () => {
    expect(rawVerbatim({ richText: [{ text: 'CG ' }, { text: '20 10' }] })).toBe('CG 20 10')
    expect(rawVerbatim(new Date(Date.UTC(2026, 0, 2)))).toBe('2026-01-02T00:00:00.000Z')
    expect(classifyCellType(new Date(0))).toBe('date')
    expect(rawVerbatim({ error: '#REF!' })).toBe('#REF!')
    expect(classifyCellType(true)).toBe('bool')
    expect(classifyCellType(1.5)).toBe('number')
  })
})

describe('buildSheetCensus', () => {
  it('trims trailing empties, counts nonEmpty, keeps whitespace-only substance', () => {
    const s = buildSheetCensus(sheet([
      [C('refId'), C('name'), null],
      [C('GL.COV.001'), C('   '), C('')],   // '   ' is substance; '' is empty
      [null, null, null],
    ]))
    expect(s.dims).toEqual({ rows: 2, cols: 2 })
    expect(s.nonEmpty).toBe(4)   // refId, name, GL.COV.001, and the whitespace cell
    const ws = s.cells.find(c => c.ref === 'S!B2')
    expect(ws?.verbatim).toBe('   ')
  })

  it('caps verbatim at 512 with a truncation flag; hash covers the FULL value', () => {
    const long = 'x'.repeat(600)
    const s = buildSheetCensus(sheet([[C(long)], [C(long + '!')]]))
    const [a, b] = s.cells
    expect(a!.verbatim).toHaveLength(VERBATIM_CAP)
    expect(a!.verbatimTruncated).toBe(true)
    // Capped verbatims are equal, but the hash sees the uncapped difference.
    expect(a!.verbatim.slice(0, VERBATIM_CAP)).toBe(b!.verbatim.slice(0, VERBATIM_CAP))
    expect(a!.valueHash).not.toBe(b!.valueHash)
  })

  it('merge normalization: anchor + shadows recorded with anchor/span', () => {
    // 2x3 merge anchored at A1; ExcelJS-style: covered cells share the value.
    const s = buildSheetCensus(sheet(
      [
        [C('BANNER'), C('BANNER'), C('BANNER')],
        [C('BANNER'), C('BANNER'), C('BANNER')],
        [C('data'), C(1), C(2)],
      ],
      { merges: [{ top: 0, left: 0, bottom: 1, right: 2 }] },
    ))
    const anchor = s.cells.find(c => c.ref === 'S!A1')
    const shadow = s.cells.find(c => c.ref === 'S!C2')
    expect(anchor?.merged).toEqual({ anchor: 'S!A1', span: [2, 3] })
    expect(shadow?.merged).toEqual({ anchor: 'S!A1', span: [2, 3] })
    expect(s.nonEmpty).toBe(9)
  })

  it('hidden sheets are censused FULLY with hidden:true (policy stays elsewhere)', () => {
    const s = buildSheetCensus(sheet([[C('secret'), C(1)]], { name: 'Forms View - MTG', hidden: true }))
    expect(s.hidden).toBe(true)
    expect(s.nonEmpty).toBe(2)
    expect(s.cells.every(c => c.hidden)).toBe(true)
  })

  it('fingerprints: same header + same values => same sig; different values => different sampleHash', () => {
    const rows = [[C('REF ID'), C('NAME')], [C('GL.COV.001'), C('Premises')]]
    const a = buildSheetCensus(sheet(rows, { name: 'A' }))
    const b = buildSheetCensus(sheet(rows, { name: 'B' }))
    const c = buildSheetCensus(sheet([[C('REF ID'), C('NAME')], [C('GL.COV.002'), C('Ops')]], { name: 'C' }))
    expect(a.fingerprint.headerSig).toBe(b.fingerprint.headerSig)
    expect(a.fingerprint.sampleHash).toBe(b.fingerprint.sampleHash)
    expect(c.fingerprint.headerSig).toBe(a.fingerprint.headerSig)
    expect(c.fingerprint.sampleHash).not.toBe(a.fingerprint.sampleHash)
  })
})

describe('gap segmentation (TableRegions)', () => {
  const occ = (rows: string[]): boolean[][] => rows.map(r => [...r].map(ch => ch === 'x'))
  const norm = (rows: string[]) => rows.map(r => [...r].map(ch => (ch === 'x' ? 'v' : null)))

  it('a SINGLE blank row does not split; a run of 2+ does', () => {
    const rows = ['xxx', '', 'xxx', '', '', 'xxx']
    const regions = segmentTableRegions(occ(rows), norm(rows))
    expect(regions.map(r => [r.rowStart, r.rowEnd])).toEqual([[0, 2], [5, 5]])
  })

  it('a 16-row blank run splits (SECURA Ref Connect Pull stacking)', () => {
    const rows = ['xxxx', 'xxxx', ...Array.from({ length: 16 }, () => ''), 'xxxx', 'xxxx']
    const regions = segmentTableRegions(occ(rows), norm(rows))
    expect(regions).toHaveLength(2)
    expect(regions[1]!.rowStart).toBe(18)
  })

  it('a disjoint column-band shift splits even without a blank gap', () => {
    const rows = ['xxx......', 'xxx......', '......xxx', '......xxx']
    const regions = segmentTableRegions(occ(rows), norm(rows))
    expect(regions.map(r => [r.rowStart, r.rowEnd, r.colStart, r.colEnd])).toEqual([
      [0, 1, 0, 2],
      [2, 3, 6, 8],
    ])
  })

  it('an overlapping band widens the region instead of splitting', () => {
    const rows = ['xx....', '.xxx..', '..xxxx']
    const regions = segmentTableRegions(occ(rows), norm(rows))
    expect(regions).toHaveLength(1)
    expect(regions[0]).toMatchObject({ rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 5 })
  })

  it('finds per-region headers with the EXISTING scorer', () => {
    const occupied = [
      [true, true], [true, true], [true, true],
      [], [],
      [true, true], [true, true], [true, true],
    ]
    const normalized = [
      ['REF ID', 'LIMIT'], ['GL.RT.001', 100], ['GL.RT.002', 250],
      [], [],
      ['STATE', 'FACTOR'], ['TX', 1.1], ['OH', 0.9],
    ]
    const regions = segmentTableRegions(occupied, normalized as never)
    expect(regions).toHaveLength(2)
    expect(regions[0]!.headerRow).toBe(0)
    expect(regions[1]!.headerRow).toBe(5)
    expect(regions[1]!.headerConfidence).toBeGreaterThan(0.25)
  })

  it('segmentation is deterministic under re-run', () => {
    const rows = ['xx..', '', 'xx..', '', '', '..xx', '..xx']
    const a = segmentTableRegions(occ(rows), norm(rows))
    const b = segmentTableRegions(occ(rows), norm(rows))
    expect(b).toEqual(a)
  })
})

describe('accounting — conservation ledger math', () => {
  const census = () => buildSheetCensus(sheet(
    [
      [C('TITLE'), C('TITLE'), null],        // merged banner: anchor + 1 shadow
      [C('REF'), C('NAME'), C('LIMIT')],     // header row
      [C('GL.COV.001'), C('Premises'), C(100)],
      [C('GL.COV.002'), C('Ops'), C(250)],
    ],
    { merges: [{ top: 0, left: 0, bottom: 0, right: 1 }] },
  ))

  it('opens with every censused cell accounted: shadows auto, rest UNACCOUNTED', () => {
    const acc = createAccounting(census())
    const roll = rollupSheet(acc)
    expect(roll.nonEmpty).toBe(11)
    expect(roll.byDisposition.MERGE_SHADOW).toBe(1)
    expect(roll.byDisposition.UNACCOUNTED).toBe(10)
    expect(roll.substanceCoverage).toBe(0)
  })

  it('merge double-count pin: the 2-wide banner is ONE substance cell + ONE shadow', () => {
    // (hostile-review Q3) The banner must contribute exactly one accountable
    // cell to the denominator: nonEmpty 11 - 1 shadow - 3 header - 1 noise = 6.
    const acc = createAccounting(census())
    post(acc, 'S!A1', 'NOISE', 'code', 'banner')
    expect(post(acc, 'S!B1', 'FACT', 'code')).toBe(false)   // shadow is immutable
    for (const ref of ['S!A2', 'S!B2', 'S!C2']) post(acc, ref, 'HEADER', 'code', 'census-header')
    for (const ref of ['S!A3', 'S!B3', 'S!C3', 'S!A4', 'S!B4', 'S!C4']) post(acc, ref, 'FACT', 'code', 'framework-rows')
    const roll = rollupSheet(acc)
    expect(roll.byDisposition).toMatchObject({ FACT: 6, HEADER: 3, NOISE: 1, MERGE_SHADOW: 1, UNACCOUNTED: 0 })
    expect(roll.substanceCoverage).toBe(1)   // 6 / (11 - 1 - 3 - 1) = 6/6
  })

  it('posts to refs outside the census are rejected — never phantom entries', () => {
    const acc = createAccounting(census())
    expect(post(acc, 'S!Z99', 'FACT', 'code')).toBe(false)
    expect(rollupSheet(acc).nonEmpty).toBe(11)
  })

  it('substanceCoverage is an honest fraction and unaccounted cells are listed', () => {
    const acc = createAccounting(census())
    post(acc, 'S!A3', 'FACT', 'code')
    const roll = rollupSheet(acc)
    // denominator = 11 - 1 shadow = 10; FACT+SCHEMA = 1.
    expect(roll.substanceCoverage).toBeCloseTo(0.1, 10)
    expect(roll.unaccounted).toContain('S!C4')
    expect(roll.unaccounted).toHaveLength(9)
  })

  it('postSpan posts a rectangle and reports how many cells it really hit', () => {
    const acc = createAccounting(census())
    const n = postSpan(acc, { sheet: 'S', rowStart: 2, rowEnd: 3, colStart: 0, colEnd: 2, reason: 'rows' }, 'FACT', 'code', 'mapper')
    expect(n).toBe(6)
    expect(rollupSheet(acc).byDisposition.FACT).toBe(6)
  })

  it('workbook rollup aggregates sheets', () => {
    const acc1 = createAccounting(census())
    postSpan(acc1, { sheet: 'S', rowStart: 0, rowEnd: 3, colStart: 0, colEnd: 2, reason: 'all' }, 'FACT', 'code')
    const roll = rollupWorkbook('wb.xlsx', [rollupSheet(acc1)])
    expect(roll.nonEmpty).toBe(11)
    expect(roll.byDisposition.FACT).toBe(10)  // 11 minus the immutable shadow
    expect(roll.substanceCoverage).toBe(1)
  })
})

// ─── Ledger #18 ───────────────────────────────────────────────────────────────
// The two dense scratch grids (occupied / normalized) were sized to the FURTHEST
// occupied cell with no sparsity clamp, so one stray leftover value far from the data
// allocated tens of millions of entries for a sheet holding a handful of values.

describe('#18 a far-flung stray cell must not allocate a dense grid to match', () => {
  // 20,001 x 2,001 = ~40M cells of extent for exactly two real values.
  const sparseSheet = (): RawCensusSheet => {
    const cells: (RawCensusCell | null)[][] = Array.from({ length: 20001 }, () => [])
    cells[0] = [C('Coverage'), C('Limit')]
    cells[1] = [C('Premises'), C(500000)]
    const far: (RawCensusCell | null)[] = Array.from({ length: 2001 }, () => null)
    far[2000] = C('leftover')
    cells[20000] = far
    return sheet(cells)
  }

  it('clamps the dense window and REPORTS it (never silently)', () => {
    const c = buildSheetCensus(sparseSheet())
    expect(c.dims).toEqual({ rows: 20001, cols: 2001 })   // true extent still reported
    expect(c.denseClamped).toBeDefined()
    expect(c.denseClamped!.cols).toBe(DENSE_MAX_COLS)
    expect(c.denseClamped!.rows * c.denseClamped!.cols).toBeLessThanOrEqual(DENSE_CELL_CEILING)
    expect(c.denseClamped!.reason).toMatch(/20001x2001/)
  })

  it('CONSERVATION: every substantive cell is still recorded, including the stray', () => {
    const c = buildSheetCensus(sparseSheet())
    expect(c.nonEmpty).toBe(5)
    expect(c.cells.map(x => x.verbatim)).toContain('leftover')
    expect(c.cells.find(x => x.verbatim === 'leftover')!.ref).toBe(cellRef('S', 20000, 2000))
  })

  it('an ordinary sheet is untouched — no clamp, no new field', () => {
    const c = buildSheetCensus(sheet([
      [C('Coverage'), C('Limit')],
      [C('Premises'), C(500000)],
    ]))
    expect(c.denseClamped).toBeUndefined()
    expect(c.dims).toEqual({ rows: 2, cols: 2 })
    expect(c.tables.length).toBeGreaterThan(0)
  })
})
