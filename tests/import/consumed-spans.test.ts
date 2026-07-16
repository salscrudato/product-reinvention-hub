/**
 * consumed-spans.test.ts — CE1-S6 lock: mapper consumption instrumentation is
 * PURELY OBSERVATIONAL.
 *
 * mapIsoWorkbook (and the stacked ld/rt + reference-table parsers inside it) can
 * emit consumedSpans into an optional collector. The law this suite pins: the
 * returned ImportPlan is BYTE-IDENTICAL (serialized) with and without a
 * collector, on all four real eval formats (GL/IM/PR/CORE) — and the spans are
 * deterministic under re-run. Grids come from the REAL server reader
 * (workbook.js readWorkbookToStructural -> isoGrids), i.e. the exact feed the
 * live stage-7 oracle join consumes. (The eval-style rowCount flatten is NOT
 * used here: CORE's phantom used-range makes it walk ~286s of empty cells;
 * the true-extent server reader does it in seconds. Same lock, same grids into
 * both calls.)
 */
import { describe, it, expect } from 'vitest'
import path from 'path'
import { readFileSync } from 'fs'
import { mapIsoWorkbook, type IsoGrid, type ConsumedSpanRec } from '../../shared/src/insurance/isoImport'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readWorkbookToStructural } = require('../../server/lib/import-brain/workbook.js')

const ISO = path.resolve(__dirname, '..', '..', 'samples', 'iso')

const FORMATS: Record<string, string[]> = {
  GL: ['sample-GL-framework.xlsx', 'sample-GL-forms.xlsx', 'sample-GL-rules.xlsx', 'sample-GL-pricing.xlsx'],
  IM: ['sample-IM-framework.xlsx', 'sample-IM-rules.xlsx'],
  PR: ['sample-PR-framework.xlsx', 'sample-PR-rating.xlsx'],
  CORE: ['Product_Specifications_Core_07_13_2026.xlsx'],
}

async function readGrids(files: string[]): Promise<IsoGrid[]> {
  const all: IsoGrid[] = []
  for (const f of files) {
    const { isoGrids } = await readWorkbookToStructural(readFileSync(path.join(ISO, f)), f, 'XLSX')
    all.push(...(isoGrids as IsoGrid[]))
  }
  return all
}

describe('S6: consumedSpans instrumentation changes NOTHING', () => {
  for (const [fmt, files] of Object.entries(FORMATS)) {
    it(`${fmt}: plan bytes identical with/without collector; spans deterministic, sane, non-empty`, async () => {
      const grids = await readGrids(files)

      const bare = mapIsoWorkbook(grids)
      const spans1: ConsumedSpanRec[] = []
      const instrumented = mapIsoWorkbook(grids, undefined, spans1)
      const spans2: ConsumedSpanRec[] = []
      mapIsoWorkbook(grids, undefined, spans2)

      // THE lock: serialized plans are byte-identical (diff empty).
      expect(JSON.stringify(instrumented)).toBe(JSON.stringify(bare))
      // Spans exist and are deterministic under re-run.
      expect(spans1.length).toBeGreaterThan(0)
      expect(spans2).toEqual(spans1)
      // Every span is a sane rectangle on a real sheet.
      const sheetNames = new Set(grids.map(g => g.sheet))
      for (const s of spans1) {
        expect(sheetNames.has(s.sheet), `span on unknown sheet ${s.sheet}`).toBe(true)
        expect(s.rowEnd).toBeGreaterThanOrEqual(s.rowStart)
        expect(s.colEnd).toBeGreaterThanOrEqual(s.colStart)
        expect(s.reason).toBeTruthy()
      }
      // Per-format grain: the parsers that fire on this format leave their marks.
      const reasons = spans1.map(s => s.reason)
      expect(reasons).toContain('framework-sheet')
      if (fmt === 'GL') {
        expect(reasons.some(r => r.startsWith('ld-table:'))).toBe(true)
        expect(reasons.some(r => r.startsWith('rt-table:'))).toBe(true)
        expect(reasons).toContain('rating-sheet')
      }
      if (fmt === 'CORE') {
        expect(reasons.some(r => r.startsWith('reference-table:'))).toBe(true)
      }
    }, 180_000)
  }
})
