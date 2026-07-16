// census.property.test.ts — CE1-S9: property fuzz over the conservation layer.
//
// Generators throw hostile-but-plausible workbooks at the census: random gaps,
// shuffled sheet order, synonym headers, injected blank rows, phantom used-range
// tails, random merges, sentinel strings, whitespace values. Invariants:
//   1. the census NEVER throws;
//   2. accounting ALWAYS sums to nonEmpty (conservation), even after arbitrary
//      span posts, and coverage stays in [0,1];
//   3. segmentation (and the whole census) is deterministic under re-run.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildSheetCensus, buildWorkbookCensus } from './buildCensus'
import { segmentTableRegions, rowBands } from './regions'
import { createAccounting, postSpan, rollupSheet, rollupWorkbook } from './accounting'
import {
  headerLockV2Signals, repeatingParentRuns, staircaseHierarchy, formTokenCensus,
  stateLexicon, idColumnProfile, nearDuplicateSheetClusters, hiddenSheetSubstance,
} from './detectors'
import type { NormalizedCell } from '../structure/types'
import type { Disposition, RawCensusCell, RawCensusSheet } from './types'

// ── Arbitraries ───────────────────────────────────────────────────────────────

const HEADER_SYNONYMS = ['REF ID', 'REFERENCE ID', 'PRODUCT FRAMEWORK ID', 'COVERAGE NAME', 'COVERAGE', 'LIMIT', 'STATE', 'STATUS', 'FORM NUMBER(S)']
const SENTINELS = ['N/A', 'TBD', '-', '--', '(none)', '<Placeholder>', '9999-12-31']

const cellValue = fc.oneof(
  { weight: 4, arbitrary: fc.string({ maxLength: 20 }) },
  { weight: 2, arbitrary: fc.integer({ min: -1_000_000, max: 1_000_000 }) },
  { weight: 1, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.constantFrom(...SENTINELS) },
  { weight: 1, arbitrary: fc.constantFrom(...HEADER_SYNONYMS) },
  { weight: 1, arbitrary: fc.constantFrom('   ', ' x ', 'GL.COV.001', 'CG 21 70', 'TX', 'OH') },
  { weight: 1, arbitrary: fc.string({ minLength: 500, maxLength: 600 }) },  // verbatim-cap territory
)

const rawCell: fc.Arbitrary<RawCensusCell | null> = fc.oneof(
  { weight: 2, arbitrary: fc.constant(null) },  // gap
  {
    weight: 3,
    arbitrary: fc.record({
      v: cellValue,
      bold: fc.boolean(),
      filled: fc.boolean(),
      indent: fc.integer({ min: 0, max: 4 }),
      topBorder: fc.boolean(),
    }),
  },
)

const rawSheet: fc.Arbitrary<RawCensusSheet> = fc
  .record({
    name: fc.constantFrom('Framework', 'Coverages', 'Coverages (2)', 'Rating OLD', 'Definitions', 'S1', 'S2'),
    hidden: fc.boolean(),
    rows: fc.integer({ min: 0, max: 18 }),
    cols: fc.integer({ min: 0, max: 10 }),
    blankRowsAt: fc.array(fc.integer({ min: 0, max: 17 }), { maxLength: 4 }),   // injected blank rows
    phantomTail: fc.integer({ min: 0, max: 40 }),                               // phantom used-range
    cellSeed: fc.array(fc.array(rawCell, { maxLength: 11 }), { maxLength: 19 }),
    merge: fc.option(
      fc.record({
        top: fc.integer({ min: 0, max: 15 }),
        left: fc.integer({ min: 0, max: 8 }),
        h: fc.integer({ min: 1, max: 4 }),
        w: fc.integer({ min: 1, max: 4 }),
      }),
      { nil: undefined },
    ),
  })
  .map(({ name, hidden, rows, cols, blankRowsAt, phantomTail, cellSeed, merge }) => {
    const cells: (RawCensusCell | null)[][] = []
    for (let r = 0; r < rows; r++) {
      if (blankRowsAt.includes(r)) { cells.push(new Array(cols).fill(null)); continue }
      const seedRow = cellSeed[r % Math.max(1, cellSeed.length)] ?? []
      const row: (RawCensusCell | null)[] = []
      for (let c = 0; c < cols; c++) row.push(seedRow[c % Math.max(1, seedRow.length)] ?? null)
      cells.push(row)
    }
    for (let p = 0; p < phantomTail; p++) cells.push(new Array(cols).fill(null))
    const merges = merge
      ? [{ top: merge.top, left: merge.left, bottom: merge.top + merge.h - 1, right: merge.left + merge.w - 1 }]
      : []
    return { name, hidden, cells, merges }
  })

const DISPOSITIONS: Array<Exclude<Disposition, 'UNACCOUNTED' | 'MERGE_SHADOW'>> = ['FACT', 'SCHEMA', 'NOISE', 'HEADER', 'NEEDS_REVIEW']

describe('S9 property fuzz — conservation layer invariants', () => {
  it('census never throws; accounting always sums to nonEmpty; coverage in [0,1]', () => {
    fc.assert(
      fc.property(
        rawSheet,
        fc.array(
          fc.record({
            rowStart: fc.integer({ min: 0, max: 20 }),
            rows: fc.integer({ min: 0, max: 6 }),
            colStart: fc.integer({ min: 0, max: 10 }),
            cols: fc.integer({ min: 0, max: 6 }),
            disposition: fc.constantFrom(...DISPOSITIONS),
          }),
          { maxLength: 6 },
        ),
        (raw, posts) => {
          const census = buildSheetCensus(raw)     // invariant 1: no throw
          expect(census.nonEmpty).toBe(census.cells.length)
          expect(new Set(census.cells.map(c => c.ref)).size).toBe(census.cells.length)

          const acc = createAccounting(census)
          for (const p of posts) {
            postSpan(acc, {
              sheet: raw.name, rowStart: p.rowStart, rowEnd: p.rowStart + p.rows,
              colStart: p.colStart, colEnd: p.colStart + p.cols, reason: 'fuzz',
            }, p.disposition, 'code', 'fuzz')
          }
          const roll = rollupSheet(acc)            // invariant 2: throws on conservation break
          const total = Object.values(roll.byDisposition).reduce((s, n) => s + n, 0)
          expect(total).toBe(census.nonEmpty)
          expect(roll.substanceCoverage).toBeGreaterThanOrEqual(0)
          expect(roll.substanceCoverage).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('segmentation and the full census are deterministic under re-run', () => {
    fc.assert(
      fc.property(rawSheet, (raw) => {
        const a = buildSheetCensus(raw)
        const b = buildSheetCensus(raw)
        expect(JSON.stringify(b)).toBe(JSON.stringify(a))    // invariant 3
        // Segmentation re-run over the same occupancy is identical.
        const occupied: boolean[][] = []
        const normalized: NormalizedCell[][] = []
        for (let r = 0; r < a.dims.rows; r++) {
          occupied.push(new Array(a.dims.cols).fill(false))
          normalized.push(new Array(a.dims.cols).fill(null))
        }
        for (const c of a.cells) { occupied[c.row]![c.col] = true; normalized[c.row]![c.col] = c.verbatim }
        expect(segmentTableRegions(occupied, normalized)).toEqual(segmentTableRegions(occupied, normalized))
        expect(rowBands(occupied)).toEqual(rowBands(occupied))
        // Regions never overlap rows and stay inside the trimmed extent.
        let prevEnd = -1
        for (const t of a.tables) {
          expect(t.rowStart).toBeGreaterThan(prevEnd)
          expect(t.rowEnd).toBeLessThan(a.dims.rows)
          expect(t.colEnd).toBeLessThan(a.dims.cols)
          prevEnd = t.rowEnd
        }
      }),
      { numRuns: 200 },
    )
  })

  it('workbook rollup + every detector survive arbitrary workbooks (shuffled sheet order)', () => {
    fc.assert(
      fc.property(
        fc.array(rawSheet, { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 0, max: 3 }),
        (sheets, rotate) => {
          const shuffled = [...sheets.slice(rotate), ...sheets.slice(0, rotate)]
          const wb = buildWorkbookCensus(shuffled, 'fuzz.xlsx')
          const rollups = wb.sheets.map(s => rollupSheet(createAccounting(s)))
          const roll = rollupWorkbook('fuzz.xlsx', rollups)
          expect(roll.nonEmpty).toBe(wb.sheets.reduce((n, s) => n + s.nonEmpty, 0))

          for (const s of wb.sheets) {
            const normalized: NormalizedCell[][] = []
            for (let r = 0; r < s.dims.rows; r++) normalized.push(new Array(s.dims.cols).fill(null))
            for (const c of s.cells) normalized[c.row]![c.col] = c.verbatim
            headerLockV2Signals(s, new Set(['REFID', 'LIMIT']))
            repeatingParentRuns(s)
            staircaseHierarchy(s)
            formTokenCensus(s)
            stateLexicon(s, normalized)
            idColumnProfile(s)
          }
          nearDuplicateSheetClusters(wb)
          hiddenSheetSubstance(wb)
        },
      ),
      { numRuns: 100 },
    )
  })
})
