// modelBuilder.test.ts — grid → StructuralModel builder (server-side fingerprinting).
// Covers the real-world layouts the sample corpus exhibits: banner-row-4/header-row-5
// spec sheets, header-on-row-1 flat exports, phantom trailing extents, sentinel
// normalization, and the embed caps (truncation must FLAG, never silently drop).

import { describe, it, expect } from 'vitest'
import { buildStructuralModel, fingerprintGrid, MAX_EMBED_ROWS, MAX_EMBED_COLS } from './modelBuilder'

describe('fingerprintGrid', () => {
  it('detects the r5-header spec-template layout and embeds real cells', () => {
    const cells: unknown[][] = [
      ['PRODUCT SPECIFICATIONS', null, null],
      ['Client: Sample Mutual', null, null],
      ['Phase: 2', null, null],
      ['PRODUCT HIERARCHY', null, null],                       // banner row
      ['REF ID', 'NAME', 'REQUIREMENT'],                       // true header (0-based row 4)
      ['GL.COV.001', 'Premises Liability', 'MANDATORY'],
      ['GL.COV.002', 'Products Liability', 'OPTIONAL'],
    ]
    const fp = fingerprintGrid({ sheet: 'GL Product Framework', cells })
    expect(fp.bestHeaderRow).toBe(4)
    expect(fp.cells).toHaveLength(7)
    expect(fp.cells![5]![0]).toBe('GL.COV.001')
    expect(fp.cellsTruncated).toBe(false)
    expect(fp.dataRowCount).toBe(7)
    expect(fp.dataColCount).toBe(3)
  })

  it('detects a header-on-row-1 flat export (PR ROC convention)', () => {
    const cells: unknown[][] = [
      ['PRODUCT FRAMEWORK ID', 'STEP ID', 'ALGORITHM STEP', 'CALCULATION'],
      ['PR.PROD.1', 'TBD', 'Base Premium', 'A x B'],
      ['PR.PROD.1', 'TBD', 'Deductible Factor', 'C x D'],
    ]
    const fp = fingerprintGrid({ sheet: 'ROC', cells })
    expect(fp.bestHeaderRow).toBe(0)
    expect(fp.cells![1]![0]).toBe('PR.PROD.1')
  })

  it('clamps phantom trailing extents to the true data extent', () => {
    const cells: unknown[][] = [
      ['REF ID', 'NAME'],
      ['IM.COV.100', 'Contractors Equipment'],
    ]
    // Simulate a phantom used-range: thousands of all-null rows after the data.
    for (let i = 0; i < 5_000; i++) cells.push([null, null])
    const fp = fingerprintGrid({ sheet: 'Rules Repository', cells })
    expect(fp.dataRowCount).toBe(2)
    expect(fp.cells).toHaveLength(2)
    expect(fp.cellsTruncated).toBe(false)
  })

  it('normalizes sentinels (TBD/N/A → null, 9999-12-31 → NO_EXPIRY)', () => {
    const fp = fingerprintGrid({ sheet: 'S', cells: [
      ['REF ID', 'EXPIRES'],
      ['TBD', '9999-12-31'],
    ] })
    expect(fp.cells![1]![0]).toBeNull()
    expect(fp.cells![1]![1]).toBe('NO_EXPIRY')
  })

  it('flags truncation at the embed caps instead of silently dropping rows', () => {
    const wide = Array.from({ length: MAX_EMBED_COLS + 10 }, (_, i) => `H${i}`)
    const cells: unknown[][] = [wide]
    for (let r = 0; r < MAX_EMBED_ROWS + 5; r++) {
      cells.push(wide.map((_, c) => `v${r}-${c}`))
    }
    const fp = fingerprintGrid({ sheet: 'Big', cells })
    expect(fp.cellsTruncated).toBe(true)
    expect(fp.cells).toHaveLength(MAX_EMBED_ROWS)
    expect(fp.cells![0]).toHaveLength(MAX_EMBED_COLS)
    // The true extent is still reported so warnings can state what was cut.
    expect(fp.dataRowCount).toBe(MAX_EMBED_ROWS + 6)
  })

  it('returns an empty fingerprint for an all-empty grid', () => {
    const fp = fingerprintGrid({ sheet: 'Empty', cells: [[null, null], [null, null]] })
    expect(fp.dataRowCount).toBe(0)
    expect(fp.bestHeaderRow).toBe(-1)
    expect(fp.cells).toEqual([])
  })
})

describe('buildStructuralModel', () => {
  it('assembles multi-sheet models and indexes definitions sheets', () => {
    const model = buildStructuralModel([
      { sheet: 'GL Product Framework', cells: [['REF ID', 'NAME'], ['GL.COV.001', 'Premises']] },
      { sheet: 'Definitions', cells: [['COLUMN', 'DESCRIPTION'], ['REF ID', 'The traceability id']] },
    ], 'wb.xlsm', 'XLSM')
    expect(model.sourceType).toBe('XLSM')
    expect(model.sheets).toHaveLength(2)
    expect(model.sheets[1]!.isDefinitionsSheet).toBe(true)
  })
})
