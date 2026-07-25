// Deductible columns must be READ, not discarded.
//
// A reference-table block states its column roles in its header row
// ("Sub-Coverage | Limit ($) | Deductible ($)"), but the parser only ever read ONE value
// column (index 1) and stamped ONE `kindHint` per table taken from the table's NAME. A block
// stating both could therefore surface at most one of them, so every deductible in the Hagerty
// CORE book was read by nobody and every coverage card showed "—".
//
// Shapes below are taken verbatim from "Product Specifications _Core.xlsx" (sheet
// "Rule References"), where 12 of 237 blocks carry both a limit and a deductible column.
import { describe, it, expect } from 'vitest'
import { mapIsoWorkbook, type IsoGrid, type IsoCell } from './isoImport'
import type { LDTable } from '../types'

const g = (sheet: string, cells: IsoCell[][]): IsoGrid => ({ sheet, cells })

const framework = g('Core Framework', [
  ['PRODUCT FRAMEWORK - CORE'],
  ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'SUB- COVERAGE', 'ALL STATES'],
  ['Active', 'CORE.PRD.001', 'Core', '<Intentionally Blank>', '<Intentionally Blank>', '<Intentionally Blank>', 'X'],
  ['Active', 'CORE.COV.001', 'Core', 'Personal Auto', 'Limited Mail Coverage', '<Intentionally Blank>', 'X'],
  ['Active', 'CORE.COV.002', 'Core', 'Personal Auto', 'Automotive Tools Coverage', '<Intentionally Blank>', 'X'],
])

/** Two "TABLE NAME:" blocks — the signature gate for reference-table detection. */
const refs = g('Rule References', [
  // Shape A — the common one: label | Limit | Deductible.
  // Named so the linker's row-label branch fires (/SUB-?COVERAGE.*LIMIT/), the same way
  // the real "Sub-Coverage Name | Limit ($) | Deductible ($)" blocks link in the CORE book.
  ['TABLE NAME: Sub-Coverage Limits'],
  ['RULE ID:', 'CORE.RU300'],
  ['Coverage', 'Limit ($)', 'Deductible ($)'],
  ['Limited Mail Coverage', '1000', 'N/A'],
  ['Automotive Tools Coverage', '750', '25'],
  ['Display Property Coverage', '250', '100'],
  [],
  // Shape B — a CROSS-PRODUCT of allowed pairs. Column 0 is itself a value, not a label, so
  // this is a different beast and must parse exactly as it always has.
  ['TABLE NAME: PIP Limits & Deductibles - HI'],
  ['RULE ID:', 'CORE.RU301'],
  ['Limit Options ($)', 'Deductible Options ($)'],
  ['10000', '100'],
  ['10000', '300'],
])

const plan = mapIsoWorkbook([framework, refs])
const tables = plan.ldTables.map(t => t.data as unknown as LDTable)
const byName = (frag: string) => tables.find(t => (t.name ?? '').includes(frag))!

describe('a deductible column beside a limit column is read', () => {
  it('captures the deductible series from the column the header NAMES', () => {
    const t = byName('Sub-Coverage Limits')
    expect(t).toBeDefined()
    // "N/A" is a placeholder, not a $0 deductible — it must not enter the series.
    expect(t.deductibleValues).toEqual([25, 100])
    expect(t.deductibleHeader).toBe('Deductible ($)')
  })

  it('leaves the LIMIT series exactly as it parsed before', () => {
    const t = byName('Sub-Coverage Limits')
    expect(t.optionValues).toEqual([1000, 750, 250])
    expect(t.rows?.map(r => r.value)).toEqual([1000, 750, 250])
  })

  it('records that the header row named the value column a limit', () => {
    expect(byName('Sub-Coverage Limits').limitHeaderSeen).toBe(true)
  })
})

describe('a cross-product options table is NOT reinterpreted', () => {
  it('does not harvest a deductible series from column 1', () => {
    // Its deductible header sits at index 1 — the very column the existing parse reads as the
    // value — so treating it as a second series would double-count. Behaviour unchanged.
    const t = byName('PIP Limits')
    expect(t).toBeDefined()
    expect(t.deductibleValues).toBeUndefined()
    expect(t.limitHeaderSeen).toBeUndefined()
  })
})

describe('the derived terms reach the coverages', () => {
  const termsOf = (refId: string) => {
    const cov = plan.coverages.find(c => c.refId === refId)
    return ((cov?.data as Record<string, unknown>)?.['terms'] ?? []) as { kind: string; options?: unknown[]; label: string }[]
  }

  it('a linked coverage now carries a DEDUCTIBLE term, not just a LIMIT', () => {
    const linked = plan.coverages.filter(c => {
      const ts = ((c.data as Record<string, unknown>)['terms'] ?? []) as { kind: string }[]
      return ts.some(t => t.kind === 'DEDUCTIBLE')
    })
    // Whether linkage lands on one coverage or both depends on the linker; the invariant that
    // matters is that a DEDUCTIBLE term now exists at all, where before there were none.
    expect(linked.length).toBeGreaterThan(0)
    const ded = termsOf(linked[0]!.refId as string).find(t => t.kind === 'DEDUCTIBLE')!
    expect(ded.options).toEqual([25, 100])
    expect(ded.label).toContain('Deductible')
  })

  it('a deductible term never duplicates a limit term id', () => {
    for (const c of plan.coverages) {
      const ts = ((c.data as Record<string, unknown>)['terms'] ?? []) as { id: string }[]
      expect(new Set(ts.map(t => t.id)).size).toBe(ts.length)
    }
  })
})
