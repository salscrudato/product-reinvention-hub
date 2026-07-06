// rtGrid tests — lock the ADDITIVE, backward-compatible contract of the grid model:
// (1) seeded tables carry no dimensions → genericRtLookup defers to the bespoke getter;
// (2) a 1-D table round-trips losslessly through derive→serialise; (3) a grid-managed
// table resolves through the generic lookup and, when it reproduces the seed, the
// evaluator still computes exactly $1,528; (4) editing a cell moves the premium.
import { describe, it, expect } from 'vitest'
import {
  deriveGridModel, gridModelToTable, genericRtLookup, joinKey, gridCellStats,
} from './rtGrid'
import { evaluate } from './evaluator'
import {
  HO3_RATING_PROGRAM, HO3_RT_TABLES, HO3_LD_TABLES,
  HO3_WORKED_EXAMPLE, makeHO3RtGetter, makeHO3LdGetter,
} from '../seed/ho3'
import type { RTTable } from '../types'

const ldGetter = makeHO3LdGetter(HO3_LD_TABLES)

describe('rtGrid — additive, backward-compatible grid model', () => {
  it('genericRtLookup defers (returns null) for every seeded table (no dimensions)', () => {
    for (const [, t] of Object.entries(HO3_RT_TABLES)) {
      expect(genericRtLookup(t, { territory: 'T002', pc: 5, covA: 400000 })).toBeNull()
    }
  })

  it('derives a 1-D grid model from the territory table and round-trips it losslessly', () => {
    const model = deriveGridModel(HO3_RT_TABLES['HO.RT.001']!)!
    expect(model).not.toBeNull()
    expect(model.dimensions).toHaveLength(1)
    expect(model.dimensions[0]!.key).toBe('territory')
    expect(model.valueColumn).toBe('rate')
    expect(model.cells[joinKey(['T002'])]).toBe(700)

    const back = gridModelToTable(model, HO3_RT_TABLES['HO.RT.001']!)
    expect(back.dimensions).toEqual([{ key: 'territory', label: 'territory', values: ['T001','T002','T003','T004','T005'] }])
    // Rebuilt rows preserve the original territory→rate pairs (native number type).
    expect(back.rows).toContainEqual({ territory: 'T002', rate: 700 })
    expect(back.rows).toHaveLength(5)
  })

  it('refuses range tables (HO.RT.002 pcMin/pcMax + two value columns)', () => {
    expect(deriveGridModel(HO3_RT_TABLES['HO.RT.002']!)).toBeNull()
  })

  it('a grid-managed territory table still computes exactly $1,528', () => {
    // Convert the seed territory table to a grid-managed one (adds dimensions metadata)
    // WITHOUT changing any value — the canary must stay exact through the generic path.
    const gridTerritory = gridModelToTable(deriveGridModel(HO3_RT_TABLES['HO.RT.001']!)!, HO3_RT_TABLES['HO.RT.001']!)
    expect(gridTerritory.dimensions).toBeDefined()

    const tables: Record<string, RTTable> = { ...HO3_RT_TABLES, 'HO.RT.001': gridTerritory }
    const rtGetter = makeHO3RtGetter(tables)
    // The generic path now serves step s1 (query {territory}), returning 700 as before.
    expect(rtGetter('HO.RT.001', { territory: 'T002' })).toBe(700)

    const result = evaluate(HO3_RATING_PROGRAM, HO3_WORKED_EXAMPLE, rtGetter, ldGetter)
    expect(result.finalPremium).toBe(1528)
  })

  it('editing a grid cell moves the premium live through the same evaluator', () => {
    const model = deriveGridModel(HO3_RT_TABLES['HO.RT.001']!)!
    model.cells[joinKey(['T002'])] = 800   // raise the base rate for T002
    const edited = gridModelToTable(model, HO3_RT_TABLES['HO.RT.001']!)

    const tables: Record<string, RTTable> = { ...HO3_RT_TABLES, 'HO.RT.001': edited }
    const rtGetter = makeHO3RtGetter(tables)
    const result = evaluate(HO3_RATING_PROGRAM, HO3_WORKED_EXAMPLE, rtGetter, ldGetter)
    // Base rate up 100/700 ≈ +14.3% flows through every multiplicative step.
    expect(result.finalPremium).toBeGreaterThan(1528)
  })

  it('reports cell stats (total vs filled) for empty-cell warnings', () => {
    const model = deriveGridModel(HO3_RT_TABLES['HO.RT.001']!)!
    const stats = gridCellStats(model)
    expect(stats).toEqual({ total: 5, filled: 5 })
    delete model.cells[joinKey(['T003'])]
    expect(gridCellStats(model)).toEqual({ total: 5, filled: 4 })
  })
})
