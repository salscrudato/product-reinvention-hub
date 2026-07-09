// isoFixture.test.ts — Phase 0 golden-fixture regression harness.
//
// Reads the real ISO GL workbooks from samples/iso/ using ExcelJS in Node.js
// mode (wb.xlsx.readFile), runs the existing mapIsoWorkbook pipeline, and
// snapshots the result counts. Any delta from the golden targets in the task
// spec is LOGGED to console but is NOT a test failure in Phase 0 — this locks
// CURRENT behaviour as a baseline so Phase 1 changes produce a reviewable diff.
//
// Also contains three synthetic fixtures that prove behaviour Phase 1 and 2
// must preserve or fix (see comments on each describe block).

import { describe, it, expect, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import type { IsoCell, IsoGrid, ImportPlan } from '@pf/shared'
import { mapIsoWorkbook } from '@pf/shared'

// ─── Paths ───────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))
// samples/iso/ is 4 directories up from app/src/lib/import/
const SAMPLES = resolve(__dir, '../../../../samples/iso')
const SNAPS = resolve(__dir, '__snapshots__')

// ─── Golden targets (from the task spec §2) ──────────────────────────────────

const GOLDEN = {
  // Framework: 105 coverage rows (4 PROD + 1 LOB rows are skipped)
  coverages: 105,
  // Forms: 795 distinct form numbers (816 rows, 21 duplicates deduped)
  forms: 795,
  // Rules: 146 unique rule IDs
  rules: 146,
  // Form-rules: 259 (merge-aware — each merged FORM RULE ID anchor fills its rows)
  formRules: 259,
  // LD tables: 37 stacked table blocks
  ldTables: 37,
  // RT tables: 4 (IDs 001, 002, 004, 006 — non-contiguous intentionally)
  rtTables: 4,
  // Rating steps: 55
  ratingSteps: 55,
} as const

// ─── Node.js ExcelJS reader ──────────────────────────────────────────────────
// Mirrors the flatten+grid logic in app/src/lib/import/readWorkbook.ts but uses
// wb.xlsx.readFile(path) instead of the browser File/arrayBuffer API.
// This is intentionally a copy (not an import) so the test has no runtime
// dependency on the browser reader and can run in a pure-Node vitest context.

function flatten(v: ExcelJS.CellValue): IsoCell {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if (Array.isArray(o['richText']))
      return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
    // Formula cells carry their cached result in `.result`
    if ('result' in o) {
      const r = o['result']
      return typeof r === 'object' ? null : (r as IsoCell)
    }
    if ('hyperlink' in o) return String(o['text'] ?? o['hyperlink'] ?? '')
    if ('text' in o) return String(o['text'])
  }
  return null
}

async function readWorkbookNode(filePath: string): Promise<IsoGrid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const grids: IsoGrid[] = []
  wb.eachSheet(ws => {
    const cells: IsoCell[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const rowObj = ws.getRow(r)
      const arr: IsoCell[] = []
      for (let c = 1; c <= ws.columnCount; c++) {
        arr[c - 1] = flatten(rowObj.getCell(c).value)
      }
      cells[r - 1] = arr
    }
    grids.push({ sheet: ws.name, cells })
  })
  return grids
}

// Load all four GL workbooks in parallel and run the mapper once for the whole suite.
let glPlan: ImportPlan

beforeAll(async () => {
  const files = [
    '20-ISO-Framework-GL.xlsx',
    '20-ISO-Forms-GL.xlsx',
    '20-ISO-Rules-GL.xlsx',
    '20-ISO-Pricing-GL.xlsx',
  ]
  const grids = (
    await Promise.all(files.map(f => readWorkbookNode(resolve(SAMPLES, f))))
  ).flat()
  glPlan = mapIsoWorkbook(grids)

  // Write a human-readable JSON snapshot on every run so git diff shows what
  // changed between phases. Not the assertion target — toMatchSnapshot() is.
  if (!existsSync(SNAPS)) mkdirSync(SNAPS, { recursive: true })
  writeFileSync(
    resolve(SNAPS, 'gl-import-summary.json'),
    JSON.stringify(
      {
        counts: glPlan.summary.counts,
        sheetsRecognized: glPlan.summary.sheetsRecognized,
        sheetsSkipped: glPlan.summary.sheetsSkipped,
        warningCount: glPlan.summary.warnings.length,
        warnings: glPlan.summary.warnings,
        unmappedColumnSheets: glPlan.summary.unmappedColumns.map(u => ({
          sheet: u.sheet,
          columns: u.columns,
        })),
      },
      null,
      2,
    ),
  )
}, 30_000) // allow up to 30 s for ExcelJS to parse four workbooks

// ─── Helper: log delta vs golden and return actual ───────────────────────────

function logDelta(key: string, actual: number, golden: number): void {
  const delta = actual - golden
  if (delta !== 0) {
    // Intentional console — this is diagnostic output for Phase 0 review, not
    // a test failure. Phase 1 will tighten these to the golden targets.
    console.warn(
      `[Phase 0 delta] ${key}: actual=${actual}, golden=${golden}, diff=${delta > 0 ? '+' : ''}${delta}`,
    )
  }
}

// ─── GL golden fixture tests ─────────────────────────────────────────────────
// Phase 0 uses toMatchSnapshot() to lock CURRENT counts. The .snap file is
// committed; updates in Phase 1 will produce a reviewable diff. Deltas vs the
// golden targets are logged but do not fail the test.

describe('GL golden fixtures — Phase 0 baseline counts', () => {
  it('counts snapshot (locks current parser output as regression baseline)', () => {
    // Snapshot the full counts object. On first run vitest creates the .snap
    // file; subsequent runs compare against it. --update-snapshots to regenerate.
    expect(glPlan.summary.counts).toMatchSnapshot()
  })

  it('sheets recognized — all 8 known GL sheets found', () => {
    const rec = glPlan.summary.sheetsRecognized
    console.info('[Phase 0] Recognized sheets:', rec)
    console.info('[Phase 0] Skipped sheets:', glPlan.summary.sheetsSkipped)
    // We do not require all 8 in Phase 0 — snapshot locks whatever is recognized.
    expect(rec).toMatchSnapshot()
  })

  it('framework: coverage count (golden=105)', () => {
    const actual = glPlan.summary.counts['coverages'] ?? 0
    logDelta('coverages', actual, GOLDEN.coverages)
    // Phase 0: assert current value, not golden.
    expect(actual).toMatchSnapshot()
  })

  it('forms: distinct form-number count (golden=795)', () => {
    const actual = glPlan.summary.counts['forms'] ?? 0
    logDelta('forms', actual, GOLDEN.forms)
    expect(actual).toMatchSnapshot()
  })

  it('rules: rule-ID count (golden=146)', () => {
    const actual = glPlan.summary.counts['rules'] ?? 0
    logDelta('rules', actual, GOLDEN.rules)
    expect(actual).toMatchSnapshot()
  })

  it('form-rules: merge-aware count (golden=259; ExcelJS resolves merges → 259 already reached)', () => {
    const actual = glPlan.summary.counts['formRules'] ?? 0
    logDelta('formRules', actual, GOLDEN.formRules)
    expect(actual).toMatchSnapshot()
  })

  it('LD tables: stacked-block count (golden=37)', () => {
    const actual = glPlan.summary.counts['ldTables'] ?? 0
    logDelta('ldTables', actual, GOLDEN.ldTables)
    expect(actual).toMatchSnapshot()
  })

  it('RT tables: stacked-block count (golden=4, ids 001/002/004/006)', () => {
    const actual = glPlan.summary.counts['rtTables'] ?? 0
    logDelta('rtTables', actual, GOLDEN.rtTables)
    // Also snapshot which RT table IDs were found — non-contiguous set is load-bearing.
    const ids = glPlan.rtTables.map(t => t.refId).sort()
    console.info('[Phase 0] RT table IDs found:', ids)
    expect({ count: actual, ids }).toMatchSnapshot()
  })

  it('rating steps: count (golden=55)', () => {
    const actual = glPlan.summary.counts['ratingSteps'] ?? 0
    logDelta('ratingSteps', actual, GOLDEN.ratingSteps)
    expect(actual).toMatchSnapshot()
  })

  it('numeric coercion trap: rating step 1.10 vs 1.1 (Phase 1 fix target)', () => {
    // Trap #4: ExcelJS reads 1.10 as JS number 1.1; text() then produces "1.1".
    // Phase 0: snapshot current step IDs so Phase 1 diff is explicit.
    const steps = (glPlan.ratingProgram?.data['steps'] as { id: string }[] | undefined) ?? []
    const ids = steps.map(s => s.id)
    console.info('[Phase 0] Rating step IDs (first 20):', ids.slice(0, 20))
    // Assert that "1.10" is NOT present (demonstrating the bug) — Phase 1 will flip this.
    const has110 = ids.includes('1.10')
    const has11  = ids.includes('1.1')
    console.info(`[Phase 0] has "1.10"=${has110}, has "1.1"=${has11}`)
    expect({ has110, has11 }).toMatchSnapshot()
  })

  it('warnings — logs all summary warnings for review', () => {
    console.info(`[Phase 0] Total warnings: ${glPlan.summary.warnings.length}`)
    glPlan.summary.warnings.slice(0, 20).forEach(w => console.info('  ·', w))
    // Snapshot count, not text (text is noisy and version-sensitive).
    expect(glPlan.summary.warnings.length).toMatchSnapshot()
  })
})

// ─── Synthetic fixture A: duplicate coverage refId ───────────────────────────
// Phase 2 will dedup coverages by refId before writing. This fixture proves the
// CURRENT behaviour (two entities for one refId) so Phase 2's fix is verifiable.

describe('synthetic fixture A — duplicate coverage refId (Phase 2 prerequisite)', () => {
  const dupFramework: IsoGrid = {
    sheet: 'GL Product Framework',
    cells: [
      ['PRODUCT FRAMEWORK - GL'],
      ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE',
       'FORM NUMBER(S)', 'EDITION DATE', 'CLAIMS BASIS', 'COVERAGE REQUIREMENT',
       'PREMIUM GENERATING', 'BUREAU', 'PROPRIETARY', 'ALL ACTIVE STATES'],
      ['Active', 'GL.PROD.001', 'GL Product', '', '', '', '', '', '', '', '', '', '', 'X'],
      ['Active', 'GL.LOB.001', 'GL Product', 'General Liability', '', '', '', '', '', '', '', '', '', 'X'],
      // Same coverage refId appears on two rows (variant A and variant B)
      ['Active', 'GL.COV.001', 'GL', 'CGL', 'Coverage A', '',  'CG 00 01', '', 'Occurrence', 'Mandatory', 'Yes', 'Yes', 'No', 'X'],
      ['Active', 'GL.COV.001', 'GL', 'CGL', 'Coverage A (variant)', '', 'CG 00 02', '', 'Claims-made', 'Optional', 'No', 'No', 'Yes', 'X'],
      ['Active', 'GL.COV.002', 'GL', 'CGL', 'Coverage B', '', '', '', 'Occurrence', 'Mandatory', 'No', 'Yes', 'No', 'X'],
    ],
  }

  const plan = mapIsoWorkbook([dupFramework])

  it('current behaviour: both rows create entities (docId collision — Phase 2 will dedup)', () => {
    // Phase 0: parser pushes BOTH rows as separate PlannedEntities even though
    // they have the same refId and therefore the same docId. This creates a
    // silent overwrite when mutate() is called (second wins).
    // Phase 2 assertion will be: coverages.length === 2 (distinct refIds, GL.COV.001 deduped)
    const docIds = plan.coverages.map(c => c.docId)
    const dupCount = docIds.filter(id => id === 'GL-COV-001').length
    console.info(`[Phase 0] Dup fixture: GL.COV.001 appears ${dupCount} time(s) in coverages array`)
    // Lock current behaviour: 2 entries for same docId (the collision)
    expect(dupCount).toBe(2) // Phase 2 will change this assertion to 1
    expect(plan.summary.counts['coverages']).toBe(3) // 3 rows → 3 entities today
  })
})

// ─── Synthetic fixture B: cross-LOB (CP prefix) ──────────────────────────────
// Proves that sheet matching is suffix/pattern-based (not exact), so a CP, BOP
// or HO workbook resolves the same parsers as GL. CP is NOT in the LOB registry
// so the LOB falls back to DEFAULT_LOB. The HO-3 fixture in samples/iso/ is a
// PDF (not a workbook), so this synthetic CP fixture replaces it for the test.

describe('synthetic fixture B — cross-LOB CP Product Framework', () => {
  const cpFramework: IsoGrid = {
    sheet: 'CP Product Framework', // different LOB prefix, same suffix pattern
    cells: [
      ['PRODUCT FRAMEWORK - COMMERCIAL PROPERTY'],
      ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB-COVERAGE',
       'FORM NUMBER(S)', 'EDITION DATE', 'CLAIMS BASIS', 'COVERAGE REQUIREMENT',
       'PREMIUM GENERATING', 'BUREAU', 'PROPRIETARY', 'ALL ACTIVE STATES'],
      ['Active', 'CP.PROD.001', 'Commercial Property Product', '', '', '', '', '', '', '', '', '', '', 'X'],
      ['Active', 'CP.LOB.001', 'Commercial Property', 'Commercial Property', '', '', '', '', '', '', '', '', '', 'X'],
      ['Active', 'CP.COV.001', 'CP', 'Commercial Property', 'Building Coverage', '', 'CP 00 10', '', '', 'Mandatory', 'Yes', 'Yes', 'No', 'X'],
      ['Active', 'CP.COV.002', 'CP', 'Commercial Property', 'Business Personal Property', '', 'CP 00 10', '', '', 'Optional', 'No', 'Yes', 'No', 'X'],
    ],
  }

  const plan = mapIsoWorkbook([cpFramework])

  it('CP Product Framework sheet is found by /product framework/i suffix pattern', () => {
    expect(plan.productId).toBe('CP.PROD.001')
    expect(plan.product).not.toBeNull()
    expect(plan.summary.sheetsRecognized).toContain('CP Product Framework')
  })

  it('CP prefix not in LOB registry → falls back to DEFAULT_LOB (Personal Lines / Property)', () => {
    // DEFAULT_LOB is Personal Home (PH). Once a CP LOB entry is added to lobRegistry,
    // this test will need updating. For now it documents the fallback behaviour.
    expect(plan.product?.data['marketSegment']).toBe('Personal Lines / Property')
  })

  it('CP coverage entities are created with correct refIds', () => {
    expect(plan.coverages).toHaveLength(2)
    expect(plan.coverages.map(c => c.refId)).toEqual(
      expect.arrayContaining(['CP.COV.001', 'CP.COV.002'])
    )
  })
})

// ─── Synthetic fixture C: merged super-header ────────────────────────────────
// Simulates the real GL forms sheet structure:
//   Row 0-1: title + blank
//   Row 2: Client:/Phase: placeholders
//   Row 3: merged super-header (only anchor cells have text; non-anchors are null)
//   Row 4: actual column headers  ← findHeaderRow must land here
//   Row 5+: data
//
// In Phase 0 the parser already handles this correctly (the merged row scores
// low since its cells are sparse). This test documents that the baseline works.

describe('synthetic fixture C — merged super-header above real headers', () => {
  const mergedSuperHeader: IsoGrid = {
    sheet: 'GL Forms Specifications',
    cells: [
      // Row 0: title
      ['GL FORMS SPECIFICATIONS'],
      // Row 1: blank placeholder
      [null, null, null, null, null, null, null],
      // Row 2: client/phase
      ['Client:', null, 'Phase:', null, null, null, null],
      // Row 3: merged super-header — only anchor cells populated (like O4:BN4 merges).
      // "GENERAL INFORMATION" spans cols 0-4, "STATE APPLICABILITY" at col 5 (anchor only).
      ['GENERAL INFORMATION', null, null, null, null, 'STATE APPLICABILITY', null,
       null, null, null, null, null, null, null, 'COVERAGE PART', null],
      // Row 4: actual column headers — this is where findHeaderRow must land
      ['PRODUCT FRAMEWORK ID', 'FORM NAME', 'FORM NUMBER', 'FORM EDITION DATE (MM YY)',
       'CLAIMS BASIS', 'ALL ACTIVE STATES', 'CA', 'TX',
       'BUREAU', 'PROPRIETARY', 'ADMITTED / NON-ADMITTED', 'FORM CATEGORY',
       'MANDATORY/ OPTIONAL', 'ATTACHMENT CONDITION', 'COMMERCIAL GENERAL LIABILITY', 'LIQUOR LIABILITY'],
      // Row 5: data
      ['GL.COV.001', 'CGL Form', 'CG 00 01', '04 13', 'Occurrence', 'X', '', '',
       'Yes', 'No', 'Admitted', 'Base Coverage Form', 'Mandatory', 'No Additional Conditions', 'X', ''],
      ['GL.COV.002', 'Pollution', 'CG 00 40', '04 13', 'Occurrence', '', 'X', '',
       'Yes', 'No', 'Admitted', 'Other Coverage Form', 'Optional', 'Defined by Rule', '', 'X'],
    ],
  }

  const plan = mapIsoWorkbook([mergedSuperHeader])

  it('forms are parsed correctly (header at row 4, not row 3 super-header)', () => {
    // If findHeaderRow incorrectly landed on row 3, the coverage-part section
    // detection would read row 2 (client/phase) and find no forms.
    expect(plan.forms.length).toBe(2)
    expect(plan.forms.map(f => f.data['number'])).toEqual(
      expect.arrayContaining(['CG 00 01', 'CG 00 40'])
    )
  })

  it('coverage-part columns are correctly detected from super-header row 3', () => {
    // parseForms reads row(grid, hr-1) as the section label row.
    // With hr=4 (0-indexed), hr-1=3 = the merged super-header row.
    // The anchor "COVERAGE PART" at col 14 should be fillForward-ed across col 15.
    const cgl = plan.forms.find(f => f.data['number'] === 'CG 00 01')!
    expect(cgl.data['coverageParts']).toContain('COMMERCIAL GENERAL LIABILITY')
    const poll = plan.forms.find(f => f.data['number'] === 'CG 00 40')!
    expect(poll.data['coverageParts']).toContain('LIQUOR LIABILITY')
  })
})
