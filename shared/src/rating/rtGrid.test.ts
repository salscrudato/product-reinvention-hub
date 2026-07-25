// rtGrid tests — lock the ADDITIVE, backward-compatible contract of the grid model:
// (1) seeded tables carry no dimensions → genericRtLookup defers to the bespoke getter;
// (2) a 1-D table round-trips losslessly through derive→serialise; (3) a grid-managed
// table resolves through the generic lookup and, when it reproduces the seed, the
// evaluator still computes exactly $1,528; (4) editing a cell moves the premium.
import { describe, it, expect } from 'vitest'
import {
  deriveGridModel, gridModelToTable, genericRtLookup, joinKey, gridCellStats,
  inferValueColumn, detectBandPairs,
} from './rtGrid'
import { evaluate } from './evaluator'
import {
  PH_RATING_PROGRAM, PH_RT_TABLES, PH_LD_TABLES,
  PH_WORKED_EXAMPLE, makePHRtGetter, makePHLdGetter,
} from '../seed/personalHome'
import type { RTTable } from '../types'

const ldGetter = makePHLdGetter(PH_LD_TABLES)

describe('rtGrid — additive, backward-compatible grid model', () => {
  it('genericRtLookup defers (returns null) for every seeded table (no dimensions)', () => {
    for (const [, t] of Object.entries(PH_RT_TABLES)) {
      expect(genericRtLookup(t, { territory: 'T002', pc: 5, covA: 400000 })).toBeNull()
    }
  })

  it('derives a 1-D grid model from the territory table and round-trips it losslessly', () => {
    const model = deriveGridModel(PH_RT_TABLES['PH.RT.001']!)!
    expect(model).not.toBeNull()
    expect(model.dimensions).toHaveLength(1)
    expect(model.dimensions[0]!.key).toBe('territory')
    expect(model.valueColumn).toBe('rate')
    expect(model.cells[joinKey(['T002'])]).toBe(700)

    const back = gridModelToTable(model, PH_RT_TABLES['PH.RT.001']!)
    expect(back.dimensions).toEqual([{ key: 'territory', label: 'territory', values: ['T001','T002','T003','T004','T005'] }])
    // Rebuilt rows preserve the original territory→rate pairs (native number type).
    expect(back.rows).toContainEqual({ territory: 'T002', rate: 700 })
    expect(back.rows).toHaveLength(5)
  })

  it('refuses range tables (PH.RT.002 pcMin/pcMax + two value columns)', () => {
    expect(deriveGridModel(PH_RT_TABLES['PH.RT.002']!)).toBeNull()
  })

  it('a grid-managed territory table still computes exactly $1,528', () => {
    // Convert the seed territory table to a grid-managed one (adds dimensions metadata)
    // WITHOUT changing any value — the canary must stay exact through the generic path.
    const gridTerritory = gridModelToTable(deriveGridModel(PH_RT_TABLES['PH.RT.001']!)!, PH_RT_TABLES['PH.RT.001']!)
    expect(gridTerritory.dimensions).toBeDefined()

    const tables: Record<string, RTTable> = { ...PH_RT_TABLES, 'PH.RT.001': gridTerritory }
    const rtGetter = makePHRtGetter(tables)
    // The generic path now serves step s1 (query {territory}), returning 700 as before.
    expect(rtGetter('PH.RT.001', { territory: 'T002' })).toBe(700)

    const result = evaluate(PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, rtGetter, ldGetter)
    expect(result.finalPremium).toBe(1528)
  })

  it('editing a grid cell moves the premium live through the same evaluator', () => {
    const model = deriveGridModel(PH_RT_TABLES['PH.RT.001']!)!
    model.cells[joinKey(['T002'])] = 800   // raise the base rate for T002
    const edited = gridModelToTable(model, PH_RT_TABLES['PH.RT.001']!)

    const tables: Record<string, RTTable> = { ...PH_RT_TABLES, 'PH.RT.001': edited }
    const rtGetter = makePHRtGetter(tables)
    const result = evaluate(PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, rtGetter, ldGetter)
    // Base rate up 100/700 ≈ +14.3% flows through every multiplicative step.
    expect(result.finalPremium).toBeGreaterThan(1528)
  })

  it('reports cell stats (total vs filled) for empty-cell warnings', () => {
    const model = deriveGridModel(PH_RT_TABLES['PH.RT.001']!)!
    const stats = gridCellStats(model)
    expect(stats).toEqual({ total: 5, filled: 5 })
    delete model.cells[joinKey(['T003'])]
    expect(gridCellStats(model)).toEqual({ total: 5, filled: 4 })
  })
})

// ─── Ledger #6 / #15 / #16 ────────────────────────────────────────────────────
// The "refuses range tables" case above passes only because PH.RT.002's value columns
// (F / M) are unrecognized — NOT because band logic exists. These lock the real rules.

describe('#6 an interval table is refused, not forced into an exact-match grid', () => {
  const bandTable: RTTable = {
    name: 'Coverage A band factor',
    columns: ['covMin', 'covMax', 'factor'],
    rows: [
      { covMin: 0,      covMax: 100000, factor: 0.90 },
      { covMin: 100001, covMax: 250000, factor: 1.00 },
      { covMin: 250001, covMax: 500000, factor: 1.25 },
    ],
  }

  it('refuses a [min, max, value] table even though its value column IS recognized', () => {
    // Pre-fix this produced a 2-D exact-match grid: a risk at covA=175,000 matched no
    // coordinate and never priced, while the worked example landed on a boundary row, so
    // the UI reported the table as green and priceable.
    expect(inferValueColumn(bandTable)).toBe('factor')   // the refusal is NOT a value-column miss
    expect(deriveGridModel(bandTable)).toBeNull()
  })

  it('detects the band pair structurally across naming conventions', () => {
    expect(detectBandPairs(['covMin', 'covMax', 'factor'])).toEqual([['covMin', 'covMax']])
    expect(detectBandPairs(['pcMin', 'pcMax', 'F', 'M'])).toEqual([['pcMin', 'pcMax']])
    expect(detectBandPairs(['ageFrom', 'ageTo', 'rate'])).toEqual([['ageFrom', 'ageTo']])
    expect(detectBandPairs(['min', 'max', 'factor'])).toEqual([['min', 'max']])
  })

  it('does NOT mistake ordinary key columns for a band', () => {
    expect(detectBandPairs(['territory', 'rate'])).toEqual([])
    expect(detectBandPairs(['classCode', 'exposureBasis'])).toEqual([])
    // A lone min with no matching max is not an interval.
    expect(detectBandPairs(['covMin', 'territory'])).toEqual([])
    // Different stems must not pair up.
    expect(detectBandPairs(['covMin', 'ageMax'])).toEqual([])
  })

  it('PH.RT.002 is now refused for the RIGHT reason as well as the old one', () => {
    expect(detectBandPairs(PH_RT_TABLES['PH.RT.002']!.columns)).toEqual([['pcMin', 'pcMax']])
  })
})

describe('#15 value-column inference reads real-world headers', () => {
  const withValueCol = (c: string): RTTable => ({ name: 't', columns: ['territory', c], rows: [] })

  it('recognizes unit-carrying and multi-word value headers', () => {
    for (const c of ['Rate per $100', 'Loss Cost', 'Rate/1000', 'Base Premium', 'Base Rate', 'Rating Factor']) {
      expect(inferValueColumn(withValueCol(c))).toBe(c)
    }
  })

  it('still refuses when a table has NO value column or SEVERAL', () => {
    expect(inferValueColumn({ name: 't', columns: ['territory', 'classCode'], rows: [] })).toBeNull()
    expect(inferValueColumn({ name: 't', columns: ['territory', 'rate', 'factor'], rows: [] })).toBeNull()
  })

  it('does not mistake a lookup KEY for a value', () => {
    for (const c of ['territory', 'classCode', 'covMin', 'vehicleSymbol', 'limit', 'tier']) {
      expect(inferValueColumn(withValueCol(c))).toBeNull()
    }
  })
})

describe('#16 duplicate coordinates resolve the same way everywhere', () => {
  // Two rows share coordinate T001. genericRtLookup uses rows.find (FIRST wins); the grid
  // model built for the editor used to assign unconditionally (LAST won), so a reviewer
  // approved — and the serializer round-tripped — a factor the engine never reads.
  const dupTable: RTTable = {
    name: 'dup', columns: ['territory', 'rate'],
    dimensions: [{ key: 'territory', label: 'territory', values: ['T001', 'T002'] }],
    valueColumn: 'rate',
    rows: [
      { territory: 'T001', rate: 700 },
      { territory: 'T001', rate: 999 },
      { territory: 'T002', rate: 800 },
    ],
  }

  it('the grid model shows exactly what the rating engine will use', () => {
    const model = deriveGridModel(dupTable)!
    expect(model.cells[joinKey(['T001'])]).toBe(700)
    expect(genericRtLookup(dupTable, { territory: 'T001' })).toBe(700)
    expect(model.cells[joinKey(['T001'])]).toBe(genericRtLookup(dupTable, { territory: 'T001' }))
  })

  it('serializing the grid keeps the engine-visible value', () => {
    const back = gridModelToTable(deriveGridModel(dupTable)!, dupTable)
    expect(back.rows).toContainEqual({ territory: 'T001', rate: 700 })
    expect(back.rows.filter(r => r['territory'] === 'T001')).toHaveLength(1)
  })
})
