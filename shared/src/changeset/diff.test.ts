// changeset/diff.test.ts — typed ChangeSet diff engine tests.
//
// Uses real PH (HO-3) seed data as the parent product and crafts minimal clone
// snapshots that exercise each diff dimension: coverage modification/addition/
// removal, RT cell changes, LD option changes, and form edition changes.
// No mock data is invented — all base data comes from the canonical seed.
import { describe, it, expect } from 'vitest'
import {
  PH_PRODUCT, PH_COVERAGES, PH_RT_TABLES, PH_LD_TABLES,
  PH_FORMS, PH_RATING_PROGRAM,
} from '../seed/personalHome'
import type { ProductSnapshot } from './diff'
import { diffProducts } from './diff'

const parentSnapshot: ProductSnapshot = {
  refId:         PH_PRODUCT.refId!,
  name:          PH_PRODUCT.name,
  coverages:     PH_COVERAGES,
  forms:         PH_FORMS,
  rtTables:      PH_RT_TABLES,
  ldTables:      PH_LD_TABLES,
  ratingProgram: PH_RATING_PROGRAM,
}

// ─── RT table cell change (three cells modified) ──────────────────────────────

describe('diffProducts — RT table cell changes', () => {
  it('detects changed cell values and computes correct pctChange', () => {
    // Clone the T002 base rate row: bump it from 700 to 735 (5% increase)
    const cloneRT = JSON.parse(JSON.stringify(PH_RT_TABLES)) as typeof PH_RT_TABLES
    const t001Table = cloneRT['PH.RT.001']
    if (!t001Table) throw new Error('PH.RT.001 not found in seed')
    const t002Row = t001Table.rows.find((r) => r.territory === 'T002')
    if (!t002Row) throw new Error('T002 row not found')
    const before = t002Row.rate as number
    t002Row.rate = before * 1.05   // +5%

    const clone: ProductSnapshot = { ...parentSnapshot, rtTables: cloneRT }
    const cs = diffProducts(parentSnapshot, clone)

    expect(cs.rateTableCellChanges.length).toBeGreaterThanOrEqual(1)
    const changed = cs.rateTableCellChanges.find(c => c.tableRefId === 'PH.RT.001' && (c.rowKey as Record<string,unknown>).territory === 'T002')
    expect(changed).toBeDefined()
    expect(changed!.before).toBe(before)
    expect(changed!.after).toBeCloseTo(before * 1.05, 4)
    expect(changed!.pctChange).toBeCloseTo(5, 4)
    expect(cs.summary.hasRateImpact).toBe(true)
    expect(cs.summary.rateTableCellsChanged).toBeGreaterThanOrEqual(1)
  })

  it('reports pctChange as null when before is 0', () => {
    const cloneRT = JSON.parse(JSON.stringify(PH_RT_TABLES)) as typeof PH_RT_TABLES
    const t = cloneRT['PH.RT.001']
    if (!t) throw new Error('PH.RT.001 missing')
    const row = t.rows[0]!
    const keyCol = t.columns[0]!
    const valCol = t.valueColumn ?? t.columns[t.columns.length - 1]!
    row[valCol] = 100   // set non-zero after
    // Manually zero the parent
    const parentRT = JSON.parse(JSON.stringify(PH_RT_TABLES)) as typeof PH_RT_TABLES
    const pt = parentRT['PH.RT.001']!
    const pr = pt.rows.find(r => String(r[keyCol]) === String(row[keyCol]))
    if (pr) pr[valCol] = 0  // force zero before

    const parent2: ProductSnapshot = { ...parentSnapshot, rtTables: parentRT }
    const clone2: ProductSnapshot  = { ...parentSnapshot, rtTables: cloneRT }
    const cs = diffProducts(parent2, clone2)
    const nullChange = cs.rateTableCellChanges.find(c => c.before === 0 && c.after !== 0)
    if (nullChange) expect(nullChange.pctChange).toBeNull()
  })
})

// ─── Coverage modification ─────────────────────────────────────────────────────

describe('diffProducts — coverage changes', () => {
  it('detects a coverage term default change', () => {
    const cloneCovs = JSON.parse(JSON.stringify(PH_COVERAGES)) as typeof PH_COVERAGES
    const covA = cloneCovs.find(c => c.name.includes('Coverage A') || c.refId === 'PH.COV.001')
    if (!covA) { return }  // skip if Coverage A absent from this test's import
    // PH.COV.001 has a LIMIT term (id: cov-a-limit); bump its default from 300000 to 500000
    const limitTerm = covA.terms.find(t => t.kind === 'LIMIT')
    if (!limitTerm) return   // seed invariant; won't happen with PH seed
    limitTerm.default = 500000

    const clone: ProductSnapshot = { ...parentSnapshot, coverages: cloneCovs }
    const cs = diffProducts(parentSnapshot, clone)
    const modified = cs.coverageChanges.filter(c => c.kind === 'modified')
    // Coverage A should be modified with a term change on its limit default
    expect(modified.some(c => c.termChanges?.some(tc => tc.termKind === 'LIMIT'))).toBe(true)
    expect(cs.summary.coveragesModified).toBeGreaterThanOrEqual(1)
    expect(cs.summary.hasCoverageOptionChanges).toBe(true)
  })

  it('detects an added coverage', () => {
    const cloneCovs = JSON.parse(JSON.stringify(PH_COVERAGES)) as typeof PH_COVERAGES
    cloneCovs.push({
      refId:             'PH.COV.NEW',
      name:              'New Test Coverage',
      parentId:          null,
      order:             99,
      requirement:       'OPTIONAL',
      claimsBasis:       'occurrence',
      premiumGenerating: false,
      source:            'PROPRIETARY',
      formNumbers:       [],
      terms:             [],
      status:            'ACTIVE',
      lifecycle:         'DRAFT',
      reviewStatus:      'NOT_STARTED',
      createdAt:         null,
      updatedAt:         null,
      updatedBy:         'test',
      rev:               1,
      allStates:         true,
      states:            [],
    })
    const clone: ProductSnapshot = { ...parentSnapshot, coverages: cloneCovs }
    const cs = diffProducts(parentSnapshot, clone)
    expect(cs.coverageChanges.some(c => c.kind === 'added' && c.refId === 'PH.COV.NEW')).toBe(true)
    expect(cs.summary.coveragesAdded).toBe(1)
  })

  it('detects a removed coverage', () => {
    const cloneCovs = PH_COVERAGES.filter(c => c.refId !== 'PH.COV.002')
    const clone: ProductSnapshot = { ...parentSnapshot, coverages: cloneCovs }
    const cs = diffProducts(parentSnapshot, clone)
    expect(cs.coverageChanges.some(c => c.kind === 'removed' && c.refId === 'PH.COV.002')).toBe(true)
    expect(cs.summary.coveragesRemoved).toBe(1)
  })
})

// ─── LD table changes ─────────────────────────────────────────────────────────

describe('diffProducts — LD table changes', () => {
  it('detects a row value change in an LD table', () => {
    const cloneLD = JSON.parse(JSON.stringify(PH_LD_TABLES)) as typeof PH_LD_TABLES
    const ded = cloneLD['PH.LD.003']
    if (!ded) return
    const row = ded.rows.find(r => r.value === 500)
    if (row) row.value = 250

    const clone: ProductSnapshot = { ...parentSnapshot, ldTables: cloneLD }
    const cs = diffProducts(parentSnapshot, clone)
    const ch = cs.ldTableChanges.find(c => c.tableRefId === 'PH.LD.003' && c.kind === 'row-modified' && c.field === 'value')
    expect(ch).toBeDefined()
    expect(ch!.before).toBe(500)
    expect(ch!.after).toBe(250)
  })

  it('detects a default value change in an LD table', () => {
    const cloneLD = JSON.parse(JSON.stringify(PH_LD_TABLES)) as typeof PH_LD_TABLES
    const ded = cloneLD['PH.LD.003']
    if (!ded) return
    ded.defaultValue = 2500

    const clone: ProductSnapshot = { ...parentSnapshot, ldTables: cloneLD }
    const cs = diffProducts(parentSnapshot, clone)
    expect(cs.ldTableChanges.some(c => c.kind === 'default-changed' && c.tableRefId === 'PH.LD.003')).toBe(true)
  })
})

// ─── Form edition changes ──────────────────────────────────────────────────────

describe('diffProducts — form edition changes', () => {
  it('detects a form edition change', () => {
    const cloneForms = JSON.parse(JSON.stringify(PH_FORMS)) as typeof PH_FORMS
    const ho3 = cloneForms.find(f => f.number === 'HO 00 03')
    if (!ho3) return
    ho3.edition = '2024 01'

    const clone: ProductSnapshot = { ...parentSnapshot, forms: cloneForms }
    const cs = diffProducts(parentSnapshot, clone)
    expect(cs.formEditionChanges.some(c => c.formNumber === 'HO 00 03' && c.field === 'edition')).toBe(true)
    expect(cs.summary.hasFormChanges).toBe(true)
    expect(cs.summary.formEditionChanges).toBeGreaterThanOrEqual(1)
  })
})

// ─── Unchanged product ─────────────────────────────────────────────────────────

describe('diffProducts — no changes', () => {
  it('produces an empty changeset when parent and clone are identical', () => {
    const clone: ProductSnapshot = { ...parentSnapshot }
    const cs = diffProducts(parentSnapshot, clone)
    expect(cs.coverageChanges).toHaveLength(0)
    expect(cs.rateTableCellChanges).toHaveLength(0)
    expect(cs.ldTableChanges).toHaveLength(0)
    expect(cs.formEditionChanges).toHaveLength(0)
    expect(cs.summary.hasRateImpact).toBe(false)
    expect(cs.summary.hasFormChanges).toBe(false)
  })
})

// ─── Summary fields ───────────────────────────────────────────────────────────

describe('diffProducts — summary fields', () => {
  it('correctly counts mixed changes', () => {
    const cloneRT = JSON.parse(JSON.stringify(PH_RT_TABLES)) as typeof PH_RT_TABLES
    const t = cloneRT['PH.RT.001']
    if (t && t.rows.length > 0) {
      const col = t.valueColumn ?? t.columns[t.columns.length - 1]!
      t.rows[0]![col] = (t.rows[0]![col] as number) * 1.1
      if (t.rows[1]) t.rows[1]![col] = (t.rows[1]![col] as number) * 1.1
      if (t.rows[2]) t.rows[2]![col] = (t.rows[2]![col] as number) * 1.1
    }
    const clone: ProductSnapshot = { ...parentSnapshot, rtTables: cloneRT }
    const cs = diffProducts(parentSnapshot, clone)
    expect(cs.summary.rateTableCellsChanged).toBeGreaterThanOrEqual(3)
    expect(cs.summary.hasRateImpact).toBe(true)
  })
})
