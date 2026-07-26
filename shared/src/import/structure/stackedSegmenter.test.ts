/**
 * stackedSegmenter.test.ts — the stacked marker grammar, locked against the real corpus.
 *
 * Marker census over the first 3 columns of every row of the four stacked sheets that
 * actually exist in this repo (counted with ExcelJS, not assumed):
 *
 *   samples/iso/sample-GL-pricing.xlsx  "GL Rating Tables"        RATE TABLE ID: 7   RTTable.N 7
 *   samples/iso/sample-GL-rules.xlsx    "Limits and Deductibles"  LDTable.N 37       TABLE NAME: 34
 *   latest_samples/…_Core.xlsx          "Rule References"         TABLE NAME: 237    RULE ID: 361
 *   latest_samples/…_E+.xlsx            "E+ Rule References"      TABLE NAME: 40     RULE ID(s): 40
 *
 * Two facts drive these tests. First, the Hagerty spec books emit ZERO RATE/LD markers —
 * they delimit on TABLE NAME and identify on RULE ID — so the segmenter must not depend
 * on a primary marker being present. Second, the two books spell the same rule-id marker
 * differently (CORE singular, E+ parenthesized plural), so the grammar must accept both
 * and canonicalize them to one key, or every reader written against one spelling sees the
 * other book as stating nothing.
 *
 * Assertions are explicit (no snapshots) so this never silently drifts.
 */
import { describe, it, expect } from 'vitest'
import { segmentStackedTables } from './stackedSegmenter'
import {
  detectLayoutShape, canonicalMetaKey, rowMatchesRuleIdMarker, RULE_ID_MARKER_PATTERN,
} from './layoutDetector'
import { scoreHeaderCandidates, pickBestHeaderRow } from './headerScore'
import type { NormalizedCell } from './types'

const shapeOf = (cells: NormalizedCell[][]) =>
  detectLayoutShape(cells, pickBestHeaderRow(scoreHeaderCandidates(cells)))

/** The CORE "Rule References" block shape: TABLE NAME row, RULE ID row, header, data. */
function coreBlock(name: string, ruleIds: string, rows: NormalizedCell[][]): NormalizedCell[][] {
  return [[`TABLE NAME: ${name}`], [`RULE ID: ${ruleIds}`], ['Category', 'Amount ($)'], ...rows]
}
/** The E+ "E+ Rule References" block shape — identical but for the marker spelling. */
function eplusBlock(name: string, ruleIds: string, rows: NormalizedCell[][]): NormalizedCell[][] {
  return [[`TABLE NAME: ${name}`], [`RULE ID(s): ${ruleIds}`], ['Category', 'Amount ($)'], ...rows]
}

describe('rule-id marker: both spellings are grammar', () => {
  it('accepts the CORE singular, the E+ parenthesized plural, and the bare/possessive plurals', () => {
    for (const s of ['RULE ID: X', 'RULE ID(s): X', 'RULE ID(S): X', 'RULE IDS: X', "RULE ID'S: X", 'rule id: X']) {
      expect(RULE_ID_MARKER_PATTERN.test(s), s).toBe(true)
    }
  })

  it('does not match a plain "RULE ID" column header or an unrelated key', () => {
    expect(RULE_ID_MARKER_PATTERN.test('RULE ID')).toBe(false)      // header cell, no colon
    expect(RULE_ID_MARKER_PATTERN.test('TABLE NAME: Fees')).toBe(false)
    expect(RULE_ID_MARKER_PATTERN.test('RULE IDENTIFIER: X')).toBe(false)
  })

  it('canonicalMetaKey folds every spelling onto the single key "RULE ID"', () => {
    for (const k of ['RULE ID', 'RULE ID(S)', 'RULE IDS', "RULE ID'S"]) {
      expect(canonicalMetaKey(k), k).toBe('RULE ID')
    }
    expect(canonicalMetaKey('TABLE NAME')).toBe('TABLE NAME')   // untouched
  })

  it('rowMatchesRuleIdMarker scans the first 3 columns, not just column 0', () => {
    expect(rowMatchesRuleIdMarker([null, null, 'RULE ID(s): EPLS.RU019'])).toBe(true)
    expect(rowMatchesRuleIdMarker([null, null, null, 'RULE ID: CORE.RU018'])).toBe(false)  // col 4
  })
})

describe('segmentStackedTables — the CORE and E+ books reach the SAME shape', () => {
  const core = [
    ...coreBlock('Minimum Premiums', 'CORE.RU018; CORE.RU019', [['Minimum Annual Written Premium', 125]]),
    [null],
    ...coreBlock('Fees', 'CORE.RU022', [['Late Fee', 10]]),
  ]
  const eplus = [
    ...eplusBlock('Minimum Premiums', 'EPLS.RU019; EPLS.RU033', [['Minimum Annual Written Premium', 125]]),
    [null],
    ...eplusBlock('Fees', 'EPLS.RU021', [['Late Fee', 10]]),
  ]

  it('both books detect as STACKED_TABLES on TABLE NAME alone — no primary marker present', () => {
    expect(shapeOf(core)).toBe('STACKED_TABLES')
    expect(shapeOf(eplus)).toBe('STACKED_TABLES')
  })

  it('both segment into the same two named blocks', () => {
    for (const [label, cells] of [['CORE', core], ['E+', eplus]] as const) {
      const t = segmentStackedTables(cells)
      expect(t.map(s => s.name), label).toEqual(['Minimum Premiums', 'Fees'])
    }
  })

  it('the rule ids land under ONE canonical meta key regardless of spelling', () => {
    expect(segmentStackedTables(core)[0]!.metaBlock['RULE ID']).toBe('CORE.RU018; CORE.RU019')
    expect(segmentStackedTables(eplus)[0]!.metaBlock['RULE ID']).toBe('EPLS.RU019; EPLS.RU033')
    // The odd spelling must NOT survive as its own key — that is the E+ data-loss bug.
    expect(segmentStackedTables(eplus)[0]!.metaBlock['RULE ID(S)']).toBeUndefined()
  })

  it('stated rule ids are carried byte-for-byte, in source order, split only on ";"', () => {
    expect(segmentStackedTables(core)[0]!.ruleRefIds).toEqual(['CORE.RU018', 'CORE.RU019'])
    expect(segmentStackedTables(eplus)[0]!.ruleRefIds).toEqual(['EPLS.RU019', 'EPLS.RU033'])
    // Single-id blocks stay a one-element list, not a bare string.
    expect(segmentStackedTables(core)[1]!.ruleRefIds).toEqual(['CORE.RU022'])
  })

  it('refId stays undefined — a rule-id marker names rules served, never the table\'s own id', () => {
    for (const s of segmentStackedTables(core)) expect(s.refId).toBeUndefined()
    for (const s of segmentStackedTables(eplus)) expect(s.refId).toBeUndefined()
  })

  it('a block stating no rule ids carries no ruleRefIds key at all (silence, not [])', () => {
    const t = segmentStackedTables([
      ['TABLE NAME: Alpha'], ['Category', 'Amount'], ['a', 1],
      [null],
      ['TABLE NAME: Beta'], ['Category', 'Amount'], ['b', 2],
    ])
    expect(t).toHaveLength(2)
    expect(t[0]!.ruleRefIds).toBeUndefined()
  })

  it('the rule-id row is meta even when it sits past column 0', () => {
    const t = segmentStackedTables([
      ['TABLE NAME: Shifted'],
      [null, null, 'RULE ID(s): EPLS.RU070'],
      ['Category', 'Amount'],
      ['x', 1],
      [null],
      ['TABLE NAME: Second'], ['Category', 'Amount'], ['y', 2],
    ])
    expect(t[0]!.ruleRefIds).toEqual(['EPLS.RU070'])
    // …and it did not become the block's header row.
    expect(t[0]!.cells[0]).toContain('Category')
  })
})

describe('the primary tier follows what the sheet emits in QUANTITY, not a single hit', () => {
  // A sheet delimited by many TABLE NAME: rows that happens to contain ONE stray
  // "RATE TABLE ID:" cell. Pre-fix, `cells.some(rowMatchesStackedMarker)` flipped the whole
  // sheet onto the primary tier and it collapsed to a single sub-table — every other block
  // silently lost. detectLayoutShape has always required >= 2; the segmenter now agrees.
  const strayCells: NormalizedCell[][] = [
    ...coreBlock('Alpha', 'CORE.RU001', [['a', 1]]),
    [null],
    ...coreBlock('Beta', 'CORE.RU002', [['b', 2]]),
    [null],
    ['RATE TABLE ID: RTTable.900'],        // ONE stray primary marker
    ['note', 'incidental'],
    [null],
    ...coreBlock('Gamma', 'CORE.RU003', [['c', 3]]),
  ]

  it('one stray primary marker does not collapse a TABLE NAME-delimited sheet', () => {
    const t = segmentStackedTables(strayCells)
    expect(t.map(s => s.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('segmentation agrees with detectLayoutShape about which tier is in play', () => {
    expect(shapeOf(strayCells)).toBe('STACKED_TABLES')
    expect(segmentStackedTables(strayCells).length).toBeGreaterThan(1)
  })

  it('>= 2 real primary markers still take precedence over TABLE NAME (ISO GL corpus shape)', () => {
    // sample-GL-rules.xlsx "Limits and Deductibles" emits BOTH LDTable.N (37) and
    // TABLE NAME: (34) — the LD id is the delimiter, TABLE NAME is meta within the block.
    const t = segmentStackedTables([
      ['LDTable.001'], ['TABLE NAME:', 'Occurrence Limits'], ['LIMIT', 'X'], [300000, 'X'],
      [null],
      ['LDTable.002'], ['TABLE NAME:', 'General Aggregate Limits'], ['LIMIT', 'X'], [600000, 'X'],
    ])
    expect(t).toHaveLength(2)                       // 2 blocks, not 4
    expect(t[0]!.refId).toBe('LDTable.001')         // the table's OWN id survives
    expect(t[0]!.name).toBe('Occurrence Limits')
    expect(t[1]!.refId).toBe('LDTable.002')
  })
})
