// detectors.test.ts — CE1-S5 locks: every deterministic detector is a pure
// function with table-driven cases mirroring the live corpus patterns.
import { describe, it, expect } from 'vitest'
import { buildSheetCensus } from './buildCensus'
import { scoreHeaderCandidates } from '../structure/headerScore'
import {
  headerLockV2Signals, augmentHeaderCandidates,
  repeatingParentRuns, staircaseHierarchy,
  formTokenCensus, stateLexicon, idColumnProfile,
  nearDuplicateSheetClusters, harvestAliasOverlay, hiddenSheetSubstance,
} from './detectors'
import type { RawCensusCell, RawCensusSheet, WorkbookCensus } from './types'

const C = (v: unknown, extra: Partial<RawCensusCell> = {}): RawCensusCell => ({ v, ...extra })
const sheet = (cells: (RawCensusCell | null)[][], over: Partial<RawCensusSheet> = {}): RawCensusSheet =>
  ({ name: 'S', hidden: false, cells, merges: [], ...over })

describe('(a) header lock v2 signals — feed the existing scorer, never replace it', () => {
  const raw = sheet([
    [C('REF ID', { bold: true }), C('LIMIT', { bold: true }), C('STATE', { bold: true })],
    [C('GL.COV.001'), C(100), C(1.5)],
    [C('GL.COV.002'), C(250), C(2.5)],
    [C('GL.COV.003'), C(500), C(3.5)],
  ])
  const census = buildSheetCensus(raw)

  it('detects the formatting shift (bold row over non-bold block)', () => {
    const signals = headerLockV2Signals(census)
    expect(signals.find(s => s.row === 0)?.formattingShift).toBe(true)
    expect(signals.find(s => s.row === 1)?.formattingShift).toBe(false)
  })

  it('detects the type shift (string row over numeric block)', () => {
    expect(headerLockV2Signals(census).find(s => s.row === 0)?.typeShift).toBe(true)
  })

  it('counts alias hits against a caller-supplied squished alias set', () => {
    const signals = headerLockV2Signals(census, new Set(['REFID', 'LIMIT']))
    expect(signals.find(s => s.row === 0)?.aliasHits).toBe(2)
  })

  it('augments the EXISTING scorer output with bounded bonuses (clamped, re-sorted)', () => {
    // Sparse header (one unlabeled column) so the base score sits below 1 and
    // the bonus is observable; the clamp still bounds it at 1.
    const sparseRaw = sheet([
      [C('REF ID', { bold: true }), C('LIMIT', { bold: true }), null, C('STATE', { bold: true })],
      [C('GL.COV.001'), C(100), C('x'), C(1.5)],
      [C('GL.COV.002'), C(250), C('y'), C(2.5)],
      [C('GL.COV.003'), C(500), C('z'), C(3.5)],
    ])
    const sparseCensus = buildSheetCensus(sparseRaw)
    const normalized = [
      ['REF ID', 'LIMIT', null, 'STATE'],
      ['GL.COV.001', 100, 'x', 1.5],
      ['GL.COV.002', 250, 'y', 2.5],
      ['GL.COV.003', 500, 'z', 3.5],
    ]
    const base = scoreHeaderCandidates(normalized as never)
    const row0Base = base.find(c => c.rowIndex === 0)!
    expect(row0Base.score).toBeLessThan(1)   // fixture precondition
    const augmented = augmentHeaderCandidates(base, headerLockV2Signals(sparseCensus, new Set(['REFID'])))
    const row0Aug = augmented.find(c => c.rowIndex === 0)!
    expect(row0Aug.score).toBeGreaterThan(row0Base.score)
    expect(row0Aug.score).toBeLessThanOrEqual(1)
    expect(augmented[0]!.rowIndex).toBe(0)
  })
})

describe('(b) repeating-parent runs (PCM StatPlan / SECURA PCM group columns)', () => {
  it('flags a column whose consecutive values repeat >= 35%', () => {
    const rows = ['Liability', 'Liability', 'Liability', 'Property', 'Property', 'Property']
      .map((parent, i) => [C(parent), C(`GL.COV.00${i}`), C(i)])
    const found = repeatingParentRuns(buildSheetCensus(sheet(rows)))
    expect(found.map(f => f.col)).toEqual([0])
    expect(found[0]!.repeatFraction).toBeCloseTo(4 / 5, 10)
  })
  it('does not flag distinct-valued columns', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((v, i) => [C(v), C(i)])
    expect(repeatingParentRuns(buildSheetCensus(sheet(rows)))).toEqual([])
  })
})

describe('(c) staircase / indent hierarchy', () => {
  it('detects real cell-indent ladders', () => {
    const rows = [
      [C('Coverage A', { indent: 0 })],
      [C('Sub 1', { indent: 1 })],
      [C('Sub 2', { indent: 1 })],
      [C('Coverage B', { indent: 0 })],
      [C('Sub 3', { indent: 2 })],
    ]
    const found = staircaseHierarchy(buildSheetCensus(sheet(rows)))
    expect(found).toEqual([{ col: 0, kind: 'indent', levels: 3, laddered: 3 }])
  })
  it('falls back to leading-space ladders (verbatim is untrimmed)', () => {
    const rows = [[C('Coverage A')], [C('  Sub 1')], [C('  Sub 2')], [C('Coverage B')], [C('    Sub 3')]]
    const found = staircaseHierarchy(buildSheetCensus(sheet(rows)))
    expect(found).toEqual([{ col: 0, kind: 'leading-space', levels: 3, laddered: 3 }])
  })
})

describe('(d) form-token grammar (counting-invariant lower bounds)', () => {
  it('matches the corpus grammar classes and dedupes', () => {
    const rows = [
      [C('CG 20 10 04 13')],            // form + edition (4 groups)
      [C('HO 00 03')],                  // classic 2-group
      [C('CG DS 01')],                  // alphabetic middle group
      [C('PN HO 01')],                  // alphabetic middle group, notice
      [C('AC 900')],                    // 3-digit single block
      [C('Attach CG 20 10 04 13 here')],// embedded, dedupes with row 0
      [C('no tokens 12 34 here')],      // lowercase prefix — not a token
    ]
    const { distinct, count } = formTokenCensus(buildSheetCensus(sheet(rows)))
    expect(distinct).toContain('CG 20 10 04 13')
    expect(distinct).toContain('HO 00 03')
    expect(distinct).toContain('CG DS 01')
    expect(distinct).toContain('PN HO 01')
    expect(distinct).toContain('AC 900')
    expect(count).toBe(distinct.length)
    expect(distinct.filter(t => t.startsWith('CG 20 10'))).toHaveLength(1)
  })
})

describe('(e) state lexicon orientation', () => {
  it('classifies a state-COLUMNS matrix (GL Product Framework 50-col band)', () => {
    const rows = [
      [C('REF ID'), C('AL'), C('AK'), C('AZ'), C('AR')],
      [C('GL.COV.001'), C('X'), null, C('X'), null],
      [C('GL.COV.002'), null, C('X'), C('X'), C('X')],
    ]
    const census = buildSheetCensus(sheet(rows))
    const normalized = rows.map(r => r.map(c => (c ? String(c.v) : null)))
    const sig = stateLexicon(census, normalized as never)
    expect(sig.orientation).toBe('STATE_COLUMNS')
    expect(sig.stateColumnsRow).toBe(0)
  })
  it('classifies a state LIST column', () => {
    const rows = ['TX', 'OH', 'CA', 'NY', 'FL', 'WA'].map((st, i) => [C(`row${i}`), C(st)])
    const census = buildSheetCensus(sheet(rows))
    const sig = stateLexicon(census, rows.map(r => r.map(c => String(c!.v))) as never)
    expect(sig.orientation).toBe('STATE_LIST')
    expect(sig.stateListCols).toEqual([1])
  })
})

describe('(f) id-column profiler', () => {
  it('profiles dot-grammar columns across line-owned schemes and censuses prefixes', () => {
    const rows = [
      [C('GL.COV.001'), C('Premises'), C('IM.COV044.00')],
      [C('GL.COV.002'), C('Ops'), C('PR.COV001.0')],
      [C('GL.RU.001'), C('Rule'), C('CORE.COV.001.001')],
      [C('GL.RT.001'), C('Table'), C('not an id')],
    ]
    const { columns, prefixes } = idColumnProfile(buildSheetCensus(sheet(rows)))
    expect(columns.map(c => c.col)).toEqual([0, 2])
    expect(columns.find(c => c.col === 0)?.refIdRatio).toBe(1)
    expect(columns.find(c => c.col === 2)?.refIdRatio).toBeCloseTo(0.75, 10)
    expect(prefixes).toMatchObject({ GL: 4, IM: 1, PR: 1, CORE: 1 })
  })
})

describe('(g) near-duplicate sheet clusters (PCM Coverages live case)', () => {
  const mk = (name: string, rows: number, hidden = false): RawCensusSheet =>
    sheet([
      [C('REF ID'), C('COVERAGE NAME'), C('LIMIT')],
      ...Array.from({ length: rows }, (_, i) => [C(`GL.COV.${i}`), C(`Cov ${i}`), C(i)]),
    ], { name, hidden })

  it('clusters same-header version copies and reports sizes; policy is NOT ours', () => {
    const wb: WorkbookCensus = {
      sourceName: 'pcm.xlsx',
      sheets: [
        buildSheetCensus(mk('Coverages', 100)),
        buildSheetCensus(mk('Coverages Hacked', 99)),
        buildSheetCensus(mk('Coverages OLD', 20)),
        buildSheetCensus(sheet([[C('TOTALLY'), C('DIFFERENT')], [C(1), C(2)]], { name: 'Other' })),
      ],
    }
    const clusters = nearDuplicateSheetClusters(wb)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.basis).toBe('headerSig')
    expect(clusters[0]!.sheets.map(s => s.name).sort()).toEqual(['Coverages', 'Coverages Hacked', 'Coverages OLD'])
    // Sizes ride along so CE3 can fold with evidence.
    expect(clusters[0]!.sheets.map(s => s.nonEmpty).sort((a, b) => b - a)[0]).toBe(303)
  })

  it('clusters " (2)"-suffixed copies by name when headers drifted', () => {
    const a = buildSheetCensus(sheet([[C('A'), C('B')], [C(1), C(2)]], { name: 'Rating' }))
    const b = buildSheetCensus(sheet([[C('C'), C('D'), C('E')], [C(1), C(2), C(3)]], { name: 'Rating (2)' }))
    const clusters = nearDuplicateSheetClusters({ sourceName: 'x', sheets: [a, b] })
    expect(clusters.some(c => c.basis === 'name' && c.sheets.length === 2)).toBe(true)
  })
})

describe('(h) Definitions + Data Validation harvest (AliasOverlay groundwork)', () => {
  it('harvests definitions rows as SCHEMA and inline validation lists as enum domains', () => {
    const defsRaw = sheet([
      [C('COLUMN NAME'), C('DESCRIPTION'), C('EXAMPLE')],
      [C('REF ID'), C('The framework id'), C('GL.COV.001')],
      [C('COVERAGE EFFECT'), C('What the endorsement does'), C('Adds')],
    ], { name: 'Definitions' })
    const dataRaw = sheet([[C('x')]], {
      name: 'Data Validation',
      validations: [
        { ref: 'E5:E9', type: 'list', formulae: ['"Adds,Replaces,Removes"'] },
        { ref: 'F2', type: 'list', formulae: ['Definitions!$B$2:$B$9'] },
        { ref: 'G2', type: 'whole', formulae: ['1'] },
      ],
    })
    const censuses = [buildSheetCensus(defsRaw), buildSheetCensus(dataRaw)]
    const overlay = harvestAliasOverlay([defsRaw, dataRaw], censuses)

    expect(overlay.definitions.map(d => d.columnName)).toEqual(['REF ID', 'COVERAGE EFFECT'])
    expect(overlay.definitions[0]).toMatchObject({ sheet: 'Definitions', description: 'The framework id' })
    // SECURA IM live case shape: Data Validation!E5:E9 -> coverageEffect domain.
    const domain = overlay.enumDomains.find(d => d.ref === 'E5:E9')
    expect(domain?.values).toEqual(['Adds', 'Replaces', 'Removes'])
    const ranged = overlay.enumDomains.find(d => d.ref === 'F2')
    expect(ranged?.values).toEqual([])
    expect(ranged?.sourceRange).toBe('Definitions!$B$2:$B$9')
    expect(overlay.enumDomains.some(d => d.ref === 'G2')).toBe(false)  // non-list skipped
    // Every non-empty Definitions cell is consumed as SCHEMA.
    expect(overlay.schemaCellRefs).toContain('Definitions!A2')
    expect(overlay.schemaCellRefs).toHaveLength(9)
  })
})

describe('(i) hidden-sheet substance (SECURA Forms View - MTG live case)', () => {
  it('reports hidden sheets with substance; censuses them fully', () => {
    const wb: WorkbookCensus = {
      sourceName: 'secura.xlsx',
      sheets: [
        buildSheetCensus(sheet([[C('visible')]], { name: 'Main' })),
        buildSheetCensus(sheet([[C('a'), C('b')], [C('c'), null]], { name: 'Forms View - MTG', hidden: true })),
        buildSheetCensus(sheet([], { name: 'Empty Hidden', hidden: true })),
      ],
    }
    expect(hiddenSheetSubstance(wb)).toEqual([{ name: 'Forms View - MTG', nonEmpty: 3 }])
  })
})
