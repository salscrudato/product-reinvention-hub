import { describe, it, expect } from 'vitest'
import {
  checkSumConsistency,
  checkMonotonicity,
  checkRateOrderCompleteness,
  checkCrossFootTotals,
  detectTranspose,
  detectMergedHeaders,
  checkVariableResolution,
} from './validators'
import {
  MERGED_HEADER_GRID,
  TRANSPOSED_FACTOR_TABLE,
  NON_MONOTONE_FACTOR_CURVE,
  CROSS_FOOT_ERROR_TABLE,
  PASSING_FACTOR_CURVE,
  PASSING_CROSS_FOOT_TABLE,
} from './__fixtures__'

// ─── checkSumConsistency ──────────────────────────────────────────────────────

describe('checkSumConsistency', () => {
  it('passes when row sum matches declared total', () => {
    const rows = [
      { label: 'Cov A', value: 800 },
      { label: 'Cov B', value: 120 },
      { label: 'Cov C', value: 80  },
    ]
    const result = checkSumConsistency(rows, 1000)
    expect(result.ok).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('passes with an empty row list', () => {
    expect(checkSumConsistency([], 0).ok).toBe(true)
  })

  it('fails when sum differs from declared total beyond tolerance', () => {
    const rows = [
      { label: 'A', value: 500 },
      { label: 'B', value: 600 },
    ]
    const result = checkSumConsistency(rows, 1000)  // actual = 1100
    expect(result.ok).toBe(false)
    expect(result.violations[0]?.severity).toBe('error')
    expect(result.violations[0]?.message).toContain('1100')
  })

  it('respects custom tolerance', () => {
    const rows = [{ label: 'A', value: 1000.005 }]
    expect(checkSumConsistency(rows, 1000, 0.01).ok).toBe(true)
    expect(checkSumConsistency(rows, 1000, 0.001).ok).toBe(false)
  })
})

// ─── checkMonotonicity ────────────────────────────────────────────────────────

describe('checkMonotonicity', () => {
  it('passes a strictly increasing curve', () => {
    const { values, labels } = PASSING_FACTOR_CURVE
    const result = checkMonotonicity(values!, 'increasing', labels)
    expect(result.ok).toBe(true)
  })

  it('detects violation in NON_MONOTONE_FACTOR_CURVE', () => {
    const { values, labels } = NON_MONOTONE_FACTOR_CURVE
    const result = checkMonotonicity(values!, 'increasing', labels)
    expect(result.ok).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations[0]?.check).toBe('checkMonotonicity')
    expect(result.violations[0]?.message).toContain('1.08')
  })

  it('passes a strictly decreasing curve', () => {
    const result = checkMonotonicity([1.0, 0.95, 0.90, 0.85], 'decreasing')
    expect(result.ok).toBe(true)
  })

  it('fails a decreasing curve that has an increase', () => {
    const result = checkMonotonicity([1.0, 0.95, 0.97, 0.90], 'decreasing')
    expect(result.ok).toBe(false)
    expect(result.violations[0]?.severity).toBe('error')
  })

  it('auto-detects direction', () => {
    // auto-increasing
    expect(checkMonotonicity([1.0, 1.1, 1.2], 'auto').ok).toBe(true)
    // auto-decreasing
    expect(checkMonotonicity([1.2, 1.1, 1.0], 'auto').ok).toBe(true)
    // auto-increasing but has decrease
    expect(checkMonotonicity([1.0, 1.1, 1.05, 1.2], 'auto').ok).toBe(false)
  })

  it('passes for a single-element array', () => {
    expect(checkMonotonicity([1.0], 'increasing').ok).toBe(true)
  })
})

// ─── checkRateOrderCompleteness ───────────────────────────────────────────────

describe('checkRateOrderCompleteness', () => {
  it('passes a complete rate order', () => {
    const steps = [
      { op: 'SET' as const, label: 'Base Rate' },
      { op: 'MUL' as const, label: 'Territory Factor' },
      { op: 'MUL' as const, label: 'Age of Home' },
      { op: 'MIN_FLOOR' as const, label: 'Minimum Premium' },
    ]
    expect(checkRateOrderCompleteness(steps).ok).toBe(true)
  })

  it('fails an empty program', () => {
    const result = checkRateOrderCompleteness([])
    expect(result.ok).toBe(false)
    expect(result.violations[0]?.message).toContain('no steps')
  })

  it('fails when MIN_FLOOR is missing', () => {
    const steps = [
      { op: 'SET' as const, label: 'Base Rate' },
      { op: 'MUL' as const, label: 'Territory' },
    ]
    const result = checkRateOrderCompleteness(steps)
    expect(result.ok).toBe(false)
    expect(result.violations.some(v => v.message.includes('MIN_FLOOR'))).toBe(true)
  })

  it('fails when SET is missing', () => {
    const steps = [
      { op: 'MUL' as const, label: 'Territory' },
      { op: 'MIN_FLOOR' as const, label: 'Min' },
    ]
    const result = checkRateOrderCompleteness(steps)
    expect(result.ok).toBe(false)
    expect(result.violations.some(v => v.message.includes('"SET"'))).toBe(true)
  })

  it('accepts a custom required-op set', () => {
    const steps = [{ op: 'ADD' as const, label: 'Flat Charge' }]
    expect(checkRateOrderCompleteness(steps, ['ADD']).ok).toBe(true)
  })
})

// ─── checkCrossFootTotals ─────────────────────────────────────────────────────

describe('checkCrossFootTotals', () => {
  it('passes a correct cross-foot table', () => {
    const { cells, rowTotals } = PASSING_CROSS_FOOT_TABLE
    expect(checkCrossFootTotals(cells!, rowTotals).ok).toBe(true)
  })

  it('detects row sum error in CROSS_FOOT_ERROR_TABLE', () => {
    const { cells, rowTotals } = CROSS_FOOT_ERROR_TABLE
    const result = checkCrossFootTotals(cells!, rowTotals)
    expect(result.ok).toBe(false)
    // row 1 (index 1) has the error
    expect(result.violations.some(v => v.location === 'row:1')).toBe(true)
  })

  it('passes when no totals are provided', () => {
    const cells = [[100, 200], [300, 400]]
    expect(checkCrossFootTotals(cells).ok).toBe(true)
  })

  it('detects column sum error', () => {
    const cells     = [[100, 200], [300, 400]]
    const colTotals = [400, 601]   // col 1 should be 600
    const result    = checkCrossFootTotals(cells, undefined, colTotals)
    expect(result.ok).toBe(false)
    expect(result.violations.some(v => v.location === 'col:1')).toBe(true)
  })
})

// ─── detectTranspose ─────────────────────────────────────────────────────────

describe('detectTranspose', () => {
  it('flags TRANSPOSED_FACTOR_TABLE', () => {
    const { headerRow, sampleRows } = TRANSPOSED_FACTOR_TABLE
    const result = detectTranspose(headerRow, sampleRows)
    expect(result.likelyTransposed).toBe(true)
    expect(result.reason).toContain('transposed')
  })

  it('does not flag PASSING_FACTOR_CURVE (string header)', () => {
    const { headerRow, sampleRows } = PASSING_FACTOR_CURVE
    const result = detectTranspose(headerRow, sampleRows)
    expect(result.likelyTransposed).toBe(false)
  })

  it('does not flag an empty header', () => {
    expect(detectTranspose([], []).likelyTransposed).toBe(false)
  })

  it('does not flag a table where the first column is numeric', () => {
    // First-column numeric means it is NOT a label column — no transpose signal
    const headerRow  = ['Factor A', 'Factor B']
    const sampleRows = [[1.0, 1.1], [1.2, 1.3]]
    expect(detectTranspose(headerRow, sampleRows).likelyTransposed).toBe(false)
  })
})

// ─── detectMergedHeaders ──────────────────────────────────────────────────────

describe('detectMergedHeaders', () => {
  it('detects merged header in MERGED_HEADER_GRID', () => {
    const result = detectMergedHeaders([MERGED_HEADER_GRID.headerRow])
    expect(result.hasMergedHeaders).toBe(true)
    expect(result.affectedColumns).toContain(2)
  })

  it('returns clean for a fully-labelled header', () => {
    const result = detectMergedHeaders([['Col A', 'Col B', 'Col C']])
    expect(result.hasMergedHeaders).toBe(false)
    expect(result.affectedColumns).toHaveLength(0)
  })

  it('handles null/empty rows gracefully', () => {
    const result = detectMergedHeaders([null, [], ['A', null, 'C']])
    expect(result.hasMergedHeaders).toBe(true)
    expect(result.affectedColumns).toContain(1)
  })

  it('handles a single-column header', () => {
    const result = detectMergedHeaders([['Only Col']])
    expect(result.hasMergedHeaders).toBe(false)
  })

  it('detects multi-column merged spans', () => {
    // 5-column header with cols 2, 3, 4 merged under col 1's value
    const result = detectMergedHeaders([['A', 'B', null, null, null]])
    expect(result.hasMergedHeaders).toBe(true)
    expect(result.affectedColumns).toEqual([2, 3, 4])
  })
})

// ─── checkVariableResolution ──────────────────────────────────────────────────

describe('checkVariableResolution', () => {
  it('passes when all variables are resolved', () => {
    const resolved = new Set(['baseRate', 'territoryFactor', 'ageFactor', 'minPremium'])
    const result   = checkVariableResolution(
      ['baseRate', 'territoryFactor', 'ageFactor', 'minPremium'],
      resolved,
    )
    expect(result.ok).toBe(true)
  })

  it('fails on an unresolved variable', () => {
    const resolved = new Set(['baseRate', 'territoryFactor'])
    const result   = checkVariableResolution(
      ['baseRate', 'territoryFactor', 'protectionClassFactor'],
      resolved,
    )
    expect(result.ok).toBe(false)
    expect(result.violations[0]?.location).toBe('protectionClassFactor')
    expect(result.violations[0]?.message).toContain('silently suppresses premium')
  })

  it('passes for an empty variable list', () => {
    expect(checkVariableResolution([], new Set()).ok).toBe(true)
  })

  it('reports all unresolved variables', () => {
    const result = checkVariableResolution(
      ['a', 'b', 'c'],
      new Set(['a']),
    )
    expect(result.violations.map(v => v.location)).toEqual(['b', 'c'])
  })
})

// ─── Structural veto integration ──────────────────────────────────────────────

describe('structural validator veto (integration)', () => {
  it('a non-monotone curve vetoes even when AI reports high confidence', () => {
    // Simulate what the pipeline does: AI says confidence = 0.95, but
    // the monotonicity check returns ok = false → import is blocked.
    const aiConfidence = 0.95
    const { values, labels } = NON_MONOTONE_FACTOR_CURVE
    const structural = checkMonotonicity(values!, 'increasing', labels)

    const shouldAccept = aiConfidence >= 0.8 && structural.ok
    expect(shouldAccept).toBe(false)
    expect(structural.violations.length).toBeGreaterThan(0)
  })

  it('a passing curve is accepted when AI confidence is also high', () => {
    const aiConfidence = 0.90
    const { values, labels } = PASSING_FACTOR_CURVE
    const structural = checkMonotonicity(values!, 'increasing', labels)

    const shouldAccept = aiConfidence >= 0.8 && structural.ok
    expect(shouldAccept).toBe(true)
  })
})
