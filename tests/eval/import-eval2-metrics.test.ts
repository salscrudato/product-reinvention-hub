/**
 * import-eval2-metrics.test.ts — the CE2 eval-v2 lock suite.
 *
 * The FILE ALLOWLIST for lane ce2 names exactly one test file, so every CE2 lock lives
 * here as its own describe block:
 *   1. golden2 schema validators + canonicalization + A1 helpers
 *   2. cell-enum PURE logic (windows / digest / sheet disposition / distinct floors)
 *   3. cell-enum readWorkbookCells against the tiny authored fixture (merge + hidden)
 *   4. eval-v2 gated metrics (accounting / recall / numeric / citation / fabrication /
 *      linkage / counting invariants / needsReview band / census reconcile)
 *   5. ANTI-LEAKAGE: goldens2 may never appear in a pipeline prompt or module
 *
 * These lock the SEMANTICS as code (green). The BASELINE RUN of eval2 is expected RED —
 * that lives in docs/import-census/BASELINE_EVAL2.md, not here.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import {
  DISPOSITIONS, KINDS, NOISE_RULES, validateCell, validateGolden2File, canonicalizeNumeric,
  isSubstance, accountingClassOf, colToNum, numToCol, refToRC, rcToRef, splitCitation,
  type Golden2File, type Golden2Cell,
} from '../../scripts/lib/golden2-schema.mts'
import {
  buildWindows, sheetDigest, classifySheet, distinctRefIds, distinctFormTokens,
  readWorkbookCells, isNonEmpty, type EnumSheet, type EnumCell,
} from '../../scripts/lib/cell-enum.mts'
import {
  accountingMetrics, goldenEntityRecall, goldenNumericFidelity, resolveCitations,
  fabricationMetrics, linkage2, countingInvariants, needsReviewBand, reconcileCensus,
  isSourceShapedRefId, type EvalEntity2,
} from '../../scripts/lib/import-eval2-metrics.mts'

// ─── helpers ──────────────────────────────────────────────────────────────────

const cell = (row: number, col: number, value: EnumCell['value'], mergeRange: string | null = null): EnumCell =>
  ({ ref: rcToRef(row, col), row, col, value, mergeRange })

function makeSheet(name: string, rows: (EnumCell['value'])[][], hidden = false): EnumSheet {
  const cells: EnumCell[] = []
  let maxRow = -1, maxCol = -1
  rows.forEach((r, ri) => r.forEach((v, ci) => {
    if (v === null || v === '') return
    cells.push(cell(ri, ci, v)); if (ri > maxRow) maxRow = ri; if (ci > maxCol) maxCol = ci
  }))
  return { name, hidden, maxRow, maxCol, cells }
}

const g2cell = (ref: string, disposition: Golden2Cell['disposition'], kind: Golden2Cell['kind'] = null, noiseRule: Golden2Cell['noiseRule'] = null): Golden2Cell =>
  ({ ref, disposition, kind, ofEntity: null, noiseRule })

// ─── 1. schema ─────────────────────────────────────────────────────────────────

describe('golden2-schema: enums, canonicalization, A1', () => {
  it('enums are the pinned sets', () => {
    expect(DISPOSITIONS).toEqual(['ENTITY', 'ATTR', 'NOISE', 'SCHEMA', 'LOG', 'HEADER'])
    expect(KINDS).toContain('subCoverage')
    expect(NOISE_RULES).toContain('NOISE.DROPDOWN_SRC')
    expect(NOISE_RULES).toContain('NOISE.ARCHIVE_SHEET')
  })
  it('numeric canonicalization folds formatting (1,528 === 1528 === $1,528.00)', () => {
    expect(canonicalizeNumeric('1,528')).toBe('1528')
    expect(canonicalizeNumeric(1528)).toBe('1528')
    expect(canonicalizeNumeric('$1,528.00')).toBe('1528')
    expect(canonicalizeNumeric('  Premises  Liability ')).toBe('premises liability')
    expect(canonicalizeNumeric('')).toBeNull()
    expect(canonicalizeNumeric(null)).toBeNull()
  })
  it('A1 helpers round-trip', () => {
    expect(colToNum('A')).toBe(1); expect(colToNum('Z')).toBe(26); expect(colToNum('AA')).toBe(27); expect(colToNum('AZ')).toBe(52)
    expect(numToCol(1)).toBe('A'); expect(numToCol(27)).toBe('AA'); expect(numToCol(52)).toBe('AZ')
    expect(refToRC('B2')).toEqual({ row: 1, col: 1 })
    expect(rcToRef(1, 1)).toBe('B2')
    expect(refToRC('nonsense')).toBeNull()
    expect(splitCitation('Rules Repository!AA10')).toEqual({ sheet: 'Rules Repository', ref: 'AA10' })
    expect(splitCitation('no-bang')).toBeNull()
  })
  it('validateCell enforces NOISE<->noiseRule coupling', () => {
    expect(validateCell(g2cell('A1', 'NOISE', null, 'NOISE.TOC'), 'x')).toEqual([])
    expect(validateCell(g2cell('A1', 'NOISE'), 'x').length).toBe(1)               // NOISE needs a rule
    expect(validateCell(g2cell('A1', 'ENTITY', 'coverage', 'NOISE.TOC'), 'x').length).toBe(1) // non-NOISE must not
    expect(validateCell({ ref: 'zzz', disposition: 'ENTITY', kind: 'coverage', ofEntity: null, noiseRule: null }, 'x').length).toBe(1) // bad ref
  })
  it('validateGolden2File demands sha256 + a citation per entity', () => {
    const good: Golden2File = {
      file: 'x.xlsx', sha256: 'a'.repeat(64), annotatedAt: '2026-07-16T00:00:00Z',
      annotators: { a: 'GROUNDED_CITED', b: 'VISION', adjudicator: 'DEEP_REASONER' },
      sheets: [{ name: 'S', hidden: false, cells: [g2cell('A1', 'ENTITY', 'coverage')],
        entities: [{ kind: 'coverage', refId: 'GL.COV.001', name: 'Premises', parentRef: null, citations: ['S!A1'] }], edges: [] }],
      counts: { products: 0, coverages: 1, forms: 0, distinctFormTokens: 0, distinctRefIds: 1 },
    }
    expect(validateGolden2File(good).ok).toBe(true)
    const noCite = structuredClone(good); noCite.sheets[0]!.entities[0]!.citations = []
    expect(validateGolden2File(noCite).ok).toBe(false)
    const badSha = structuredClone(good); badSha.sha256 = 'nope'
    expect(validateGolden2File(badSha).ok).toBe(false)
  })
  it('isSubstance / accountingClassOf map dispositions correctly', () => {
    expect(isSubstance('ENTITY')).toBe(true); expect(isSubstance('ATTR')).toBe(true)
    expect(isSubstance('NOISE')).toBe(false); expect(isSubstance('SCHEMA')).toBe(false)
    expect(isSubstance('LOG')).toBe(false); expect(isSubstance('HEADER')).toBe(false)
    expect(accountingClassOf('SCHEMA')).toBe('structural')
    expect(accountingClassOf('LOG')).toBe('ignorable')
  })
})

// ─── 2. cell-enum pure ──────────────────────────────────────────────────────────

describe('cell-enum: windows / digest / disposition / floors', () => {
  it('buildWindows tiles with a 2-row overlap and drops empty windows', () => {
    // 100 rows x 1 col, one value per row.
    const rows: (EnumCell['value'])[][] = Array.from({ length: 100 }, (_, i) => [`r${i}`])
    const sh = makeSheet('S', rows)
    const ws = buildWindows(sh, { maxRows: 40, maxCols: 40, rowOverlap: 2 })
    expect(ws[0]!.rowStart).toBe(0); expect(ws[0]!.rowEnd).toBe(39)
    expect(ws[1]!.rowStart).toBe(38)                 // step = 40 - 2 = 38 -> 2-row overlap
    expect(ws[ws.length - 1]!.rowEnd).toBe(99)
    for (const w of ws) expect(w.cells.length).toBeGreaterThan(0)
    // window never exceeds 40x40
    for (const w of ws) { expect(w.rowEnd - w.rowStart).toBeLessThanOrEqual(39); expect(w.colEnd - w.colStart).toBeLessThanOrEqual(39) }
  })
  it('sheetDigest finds the header row by type-shift', () => {
    const sh = makeSheet('S', [
      ['ID', 'Coverage', 'Limit'],    // row 0: all strings -> header
      ['GL.COV.001', 'Premises', 1528],
      ['GL.COV.002', 'Products', 2635],
    ])
    const d = sheetDigest(sh)
    expect(d.headerRow).toBe(0)
    expect(d.sampleRows[0]!.values).toContain('GL.COV.001')
  })
  it('classifySheet is deterministic; Definitions/Data Validation are SCHEMA not NOISE', () => {
    expect(classifySheet('Table of Contents')?.noiseRule).toBe('NOISE.TOC')
    expect(classifySheet('Revision History')?.disposition).toBe('LOG')
    expect(classifySheet('Version History')?.disposition).toBe('LOG')
    expect(classifySheet('Question & Observation Log')?.disposition).toBe('LOG')
    expect(classifySheet('Product Contacts')?.noiseRule).toBe('NOISE.CONTACTS')
    expect(classifySheet('Definitions')?.disposition).toBe('SCHEMA')
    expect(classifySheet('Definitions-Product Framework')?.disposition).toBe('SCHEMA')
    expect(classifySheet('Data Validation')?.disposition).toBe('SCHEMA')
    expect(classifySheet('PCM Dropdowns (HIDE)')?.noiseRule).toBe('NOISE.DROPDOWN_SRC')
    expect(classifySheet('Product Matrix - Archive')?.noiseRule).toBe('NOISE.ARCHIVE_SHEET')
    expect(classifySheet('GL Product Framework')).toBeNull()   // substance -> needs annotation
  })
  it('distinct floors are conservative lower bounds', () => {
    const sh = makeSheet('S', [
      ['GL.COV.001', 'Premises Liability', 'CG 00 01'],
      ['GL.COV.001', 'dup id, counted once', 'CG 00 01'],
      ['LDTable.122', 'a table', 'CP 10 30'],
      ['not an id', 'prose without ids', 'also prose'],
    ])
    const ids = distinctRefIds(sh)
    expect(ids.has('GL.COV.001')).toBe(true)
    expect(ids.has('LDTable.122')).toBe(true)
    expect(ids.size).toBe(2)                         // dup id counted once; prose excluded
    const forms = distinctFormTokens(sh)
    expect(forms.has('CG 00 01')).toBe(true)
    expect(forms.has('CP 10 30')).toBe(true)
    expect(forms.size).toBe(2)
  })
  it('isNonEmpty drops null and whitespace-only', () => {
    expect(isNonEmpty(null)).toBe(false); expect(isNonEmpty('   ')).toBe(false)
    expect(isNonEmpty('x')).toBe(true); expect(isNonEmpty(0)).toBe(true); expect(isNonEmpty(false)).toBe(true)
  })
})

// ─── 3. cell-enum readWorkbookCells against the authored fixture ────────────────

describe('cell-enum: readWorkbookCells (tiny.xlsx fixture)', () => {
  const fixture = resolve(process.cwd(), 'samples/goldens2/__fixtures__/tiny.xlsx')
  it('anchors merges, includes hidden sheets, drops empties', async () => {
    const wb = await readWorkbookCells(fixture)
    const data = wb.sheets.find(s => s.name === 'Data')!
    const hidden = wb.sheets.find(s => /Dropdowns/.test(s.name))!
    expect(data).toBeTruthy(); expect(hidden).toBeTruthy()
    // Hidden sheet is INCLUDED and flagged hidden.
    expect(hidden.hidden).toBe(true)
    expect(data.hidden).toBe(false)
    // Merge A1:C1 -> only the anchor A1 carries the title; B1/C1 are not emitted.
    const a1 = data.cells.find(c => c.ref === 'A1')!
    expect(a1.value).toBe('GL Product Framework')
    expect(a1.mergeRange).toBe('A1:C1')
    expect(data.cells.find(c => c.ref === 'B1')).toBeUndefined()
    expect(data.cells.find(c => c.ref === 'C1')).toBeUndefined()
    // Data survived with the numeric limit intact.
    expect(data.cells.find(c => c.ref === 'A3')!.value).toBe('GL.COV.001')
    expect(data.cells.find(c => c.ref === 'C3')!.value).toBe(1528)
    // The floors read the fixture.
    expect(distinctRefIds(data).has('GL.COV.001')).toBe(true)
    expect(distinctFormTokens(data).has('CG 00 01')).toBe(true)
  })
})

// ─── 4. eval-v2 gated metrics ───────────────────────────────────────────────────

const goldenFixture = (): Golden2File => ({
  file: 'gl.xlsx', sha256: 'b'.repeat(64), annotatedAt: '2026-07-16T00:00:00Z',
  annotators: { a: 'GROUNDED_CITED', b: 'VISION', adjudicator: 'DEEP_REASONER' },
  sheets: [{
    name: 'GL Product Framework', hidden: false,
    cells: [
      g2cell('A3', 'ENTITY', 'coverage'), g2cell('B3', 'ATTR', 'coverage'), g2cell('C3', 'ATTR', 'limit'),
      g2cell('A4', 'ENTITY', 'coverage'), g2cell('C4', 'ATTR', 'limit'),
      g2cell('A1', 'NOISE', null, 'NOISE.DECORATION'),
    ],
    entities: [
      { kind: 'coverage', refId: 'GL.COV.001', name: 'Premises', parentRef: null, citations: ['GL Product Framework!A3'] },
      { kind: 'coverage', refId: 'GL.COV.002', name: 'Products', parentRef: null, citations: ['GL Product Framework!A4'] },
    ],
    edges: [],
  }],
  counts: { products: 0, coverages: 2, forms: 0, distinctFormTokens: 1, distinctRefIds: 2 },
})

describe('eval2: accounting (the core loss gate)', () => {
  const golden = goldenFixture()
  it('full accounting -> zero unaccounted, coverage 1.0', () => {
    const acc = new Set(['GL Product Framework!A3', 'GL Product Framework!B3', 'GL Product Framework!C3', 'GL Product Framework!A4', 'GL Product Framework!C4'])
    const m = accountingMetrics(golden, acc)
    expect(m.unaccountedEntityCells).toBe(0)
    expect(m.substanceCoverage).toBe(1)
  })
  it('a dropped entity-anchor cell is caught with zero tolerance', () => {
    const acc = new Set(['GL Product Framework!B3', 'GL Product Framework!C3', 'GL Product Framework!C4']) // A3, A4 (entity anchors) missing
    const m = accountingMetrics(golden, acc)
    expect(m.entityCells).toBe(2)
    expect(m.unaccountedEntityCells).toBe(2)
    expect(m.sampleUnaccounted.some(s => s.locus === 'GL Product Framework!A3')).toBe(true)
  })
  it('NOISE cells are never counted as substance', () => {
    const m = accountingMetrics(golden, new Set())
    expect(m.substanceCells).toBe(5)   // 2 ENTITY + 3 ATTR; the NOISE A1 excluded
  })
  it('collision-suffixed sheet names still match', () => {
    const acc = new Set(['GL Product Framework (gl.xlsx)!A3', 'GL Product Framework (gl.xlsx)!A4'])
    const m = accountingMetrics(golden, acc)
    expect(m.entityAccounted).toBe(2)
  })
})

describe('eval2: entity recall / numeric / citation', () => {
  const golden = goldenFixture()
  it('goldenEntityRecall matches by refId', () => {
    const ex: EvalEntity2[] = [{ kind: 'coverage', refId: 'GL.COV.001', fields: { name: 'Premises' } }]
    const r = goldenEntityRecall(golden, ex)
    expect(r.golden).toBe(2); expect(r.found).toBe(1); expect(r.recall).toBe(0.5)
    expect(r.missing[0]!.refId).toBe('GL.COV.002')
  })
  it('goldenNumericFidelity folds 1,528 == 1528; a changed value misses', () => {
    const ex: EvalEntity2[] = [{ kind: 'coverage', refId: 'GL.COV.001', fields: { limit: '1,528' } }]
    const ok = goldenNumericFidelity([{ entityRef: 'GL.COV.001', value: '1528' }], ex)
    expect(ok.fidelity).toBe(1)
    const bad = goldenNumericFidelity([{ entityRef: 'GL.COV.001', value: '9999' }], ex)
    expect(bad.fidelity).toBe(0)
  })
  it('resolveCitations byte-verifies against cell text; placeholders skipped', () => {
    const text = (s: string, ref: string) => (s === 'GL Product Framework' && ref === 'A3' ? 'GL.COV.001' : null)
    const good = resolveCitations([{ citation: 'GL Product Framework!A3', verbatim: 'GL.COV.001' }], text)
    expect(good.rate).toBe(1)
    const wrong = resolveCitations([{ citation: 'GL Product Framework!A3', verbatim: 'WRONG' }], text)
    expect(wrong.rate).toBe(0)
    const placeholder = resolveCitations([{ citation: 'x!A1', verbatim: '(synthesized)' }], text)
    expect(placeholder.rate).toBeNull()  // nothing checkable
  })
})

describe('eval2: fabrication / linkage / counting / band / reconcile', () => {
  it('fabricationMetrics flags a source-shaped id absent from the source; SYNTH excluded', () => {
    const src = new Set(['GL.COV.001', 'GL.COV.002'])
    const ex: EvalEntity2[] = [
      { kind: 'coverage', refId: 'GL.COV.001', fields: {} },        // real
      { kind: 'coverage', refId: 'GL.COV.999', fields: {} },        // fabricated (source-shaped, absent)
      { kind: 'rule', refId: 'XX.RULE.SYNTH001', fields: {} },      // minted -> excluded
      { kind: 'note', refId: 'freeform text', fields: {} },         // not source-shaped -> ignored
    ]
    const m = fabricationMetrics(ex, src)
    // SYNTH ids and non-source-shaped freeform are excluded up front, so sourceShaped
    // counts only the two GL.COV ids; one of them (GL.COV.999) is absent from the source.
    expect(m.sourceShaped).toBe(2)
    expect(m.fabricated).toBe(1)
    expect(m.sample[0]!.refId).toBe('GL.COV.999')
  })
  it('isSourceShapedRefId recognises the platform id grammar', () => {
    expect(isSourceShapedRefId('GL.COV.001')).toBe(true)
    expect(isSourceShapedRefId('LDTable.122')).toBe(true)
    expect(isSourceShapedRefId('Premises Liability')).toBe(false)
  })
  it('linkage2 catches a dangling parent and an unresolved table pointer', () => {
    const ex: EvalEntity2[] = [
      { kind: 'coverage', refId: 'C1', fields: {} },
      { kind: 'coverage', refId: 'C2', fields: { parentId: 'C1' } },
      { kind: 'coverage', refId: 'C3', fields: { parentId: 'GHOST' } },
      { kind: 'rule', refId: 'R1', fields: { ldTableRef: 'LDTable.1' } },
      { kind: 'ldTable', refId: 'LDTable.1', fields: {} },
      { kind: 'rule', refId: 'R2', fields: { ldTableRef: 'MISSING' } },
    ]
    const m = linkage2(ex)
    expect(m.parentResolutionRate).toBe(0.5)
    expect(m.ldTableRefResolutionRate).toBe(0.5)
  })
  it('countingInvariants fails when extracted < floor (bulk loss)', () => {
    const floors = [{ kind: 'coverage', floor: 137, source: 'distinctRefIds' }, { kind: 'form', floor: 10, source: 'distinctFormTokens' }]
    expect(countingInvariants(floors, { coverage: 137, form: 12 }).ok).toBe(true)
    const bad = countingInvariants(floors, { coverage: 40, form: 12 })
    expect(bad.ok).toBe(false)
    expect(bad.violations[0]!.kind).toBe('coverage')
  })
  it('needsReviewBand: >0.10 warns, exactly 0 on a real master is suspicious', () => {
    expect(needsReviewBand(1000, 50, true).band).toBe('ok')      // 5%
    expect(needsReviewBand(1000, 200, true).band).toBe('warn')   // 20%
    expect(needsReviewBand(1000, 0, true).band).toBe('suspicious')
    expect(needsReviewBand(1000, 0, false).band).toBe('ok')      // non-master: 0 is fine
  })
  it('reconcileCensus flags a nonEmpty disagreement between CE1 and CE2', () => {
    const ok = reconcileCensus({ S1: 100, S2: 50 }, { S1: 100, S2: 50 })
    expect(ok.ok).toBe(true)
    const bad = reconcileCensus({ S1: 100, 'Forms View - MTG': 2072 }, { S1: 100 })  // CE1 missed the hidden sheet
    expect(bad.ok).toBe(false)
    expect(bad.disagreements[0]!.sheet).toBe('Forms View - MTG')
  })
})

// ─── 5. ANTI-LEAKAGE lock ────────────────────────────────────────────────────────
// goldens2 are TRUTH labels. If the string "goldens2" appears anywhere under the import
// pipeline, a golden could be feeding a prompt or a module — overfitting the eval. This
// walks every file under the two pipeline roots and fails on any occurrence.

describe('anti-leakage: goldens2 never enters the pipeline', () => {
  const roots = ['server/lib/import-brain', 'shared/src/import'].map(r => resolve(process.cwd(), r))
  function walk(dir: string): string[] {
    const out: string[] = []
    let entries: string[] = []
    try { entries = readdirSync(dir) } catch { return out }
    for (const name of entries) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) out.push(...walk(p))
      else out.push(p)
    }
    return out
  }
  it('no pipeline file mentions "goldens2"', () => {
    const offenders: string[] = []
    for (const root of roots) {
      for (const file of walk(root)) {
        const body = readFileSync(file, 'utf8')
        if (body.includes('goldens2')) offenders.push(file)
      }
    }
    expect(offenders, `goldens2 leaked into: ${offenders.join(', ')}`).toEqual([])
  })
})
