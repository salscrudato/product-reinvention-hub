// seedIntegrity.test.ts — data-truth guards for the two seeded lines (P6 / D2–D6).
// These lock the rating seams the $1,528 (Personal Home) and $1,002 (Personal Auto) canaries
// depend on, so a future edit that reintroduces a stale literal, a dual minimum-premium source,
// a non-uniform refId, or a dead LD path fails the gate:
//   • D2 — editing a factor table actually moves the premium (no factor is a stale literal),
//          and the Coverage A extrapolation reads the top table row, not a hard-coded base;
//   • D3 — one minimum-premium mechanism: the field equals the MIN_FLOOR step's constant;
//   • D5 — every seeded refId is line-prefixed and uniform across both products;
//   • D6 — the shared LD-source getter is wired (not a throwing stub) and evaluates end-to-end.
import { describe, it, expect } from 'vitest'
import { evaluate } from '../rating/evaluator'
import type { RTTable, RatingProgram, RatingStep } from '../types'
import {
  PH_RATING_PROGRAM, PH_RT_TABLES, PH_LD_TABLES, PH_WORKED_EXAMPLE,
  PH_COVERAGES, PH_RULES, PH_FORM_RULES, PH_DICTIONARY, PH_PRODUCT,
  makePHRtGetter, makePHLdGetter,
} from './personalHome'
import {
  PA_RATING_PROGRAM, PA_RT_TABLES, PA_LD_TABLES, PA_WORKED_EXAMPLE,
  PA_COVERAGES, PA_RULES, PA_FORM_RULES, PA_DICTIONARY, PA_PRODUCT,
  makePARtGetter, makePALdGetter,
} from './personalAuto'

// Deep-clone so a table edit in one test never leaks into another (or into the seed module).
const clone = (t: Record<string, RTTable>): Record<string, RTTable> =>
  JSON.parse(JSON.stringify(t)) as Record<string, RTTable>

describe('D2 — editing a factor table moves the premium (no stale literals)', () => {
  it('PH: bumping the tier-B factor raises the final premium', () => {
    const base = evaluate(PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, makePHRtGetter(PH_RT_TABLES), makePHLdGetter(PH_LD_TABLES))
    expect(base.finalPremium).toBe(1528)

    const edited = clone(PH_RT_TABLES)
    const tierB = edited['PH.RT.009']!.rows.find(r => r['tier'] === 'B')!
    tierB['factor'] = 1.20 // was 1.10 — a real edit must reach the trace, not a hard-coded copy
    const after = evaluate(PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, makePHRtGetter(edited), makePHLdGetter(PH_LD_TABLES))
    expect(after.finalPremium).toBeGreaterThan(base.finalPremium)
  })

  it('PH: Coverage A extrapolation reads the top table row, not a hard-coded base', () => {
    // covA above the top tabulated row ($600k) exercises the extrapolation path.
    const base = makePHRtGetter(PH_RT_TABLES)('PH.RT.003', { covA: 700000 })   // 1.94 + 1×0.32 = 2.26
    expect(base).toBeCloseTo(2.26, 2)

    const edited = clone(PH_RT_TABLES)
    const top = edited['PH.RT.003']!.rows.find(r => r['covA'] === 600000)!
    top['factor'] = 2.00 // move the top tabulated factor; the extrapolation base must move with it
    const bumped = makePHRtGetter(edited)('PH.RT.003', { covA: 700000 })       // 2.00 + 0.32 = 2.32
    expect(bumped).not.toBe(base)
    expect(bumped).toBeCloseTo(2.32, 2)

    // …and it flows through to the premium for a >$600k dwelling.
    const inputs = { ...PH_WORKED_EXAMPLE, covA: 700000 }
    const before = evaluate(PH_RATING_PROGRAM, inputs, makePHRtGetter(PH_RT_TABLES), makePHLdGetter(PH_LD_TABLES))
    const afterE = evaluate(PH_RATING_PROGRAM, inputs, makePHRtGetter(edited), makePHLdGetter(PH_LD_TABLES))
    expect(afterE.finalPremium).toBeGreaterThan(before.finalPremium)
  })

  it('PA: bumping the driver-class factor raises the final premium', () => {
    const base = evaluate(PA_RATING_PROGRAM, PA_WORKED_EXAMPLE, makePARtGetter(PA_RT_TABLES), makePALdGetter(PA_LD_TABLES))
    expect(base.finalPremium).toBe(1002)

    const edited = clone(PA_RT_TABLES)
    const dc2 = edited['PA.RT.002']!.rows.find(r => r['driverClass'] === 'DC2')!
    dc2['factor'] = 1.10 // was 1.00
    const after = evaluate(PA_RATING_PROGRAM, PA_WORKED_EXAMPLE, makePARtGetter(edited), makePALdGetter(PA_LD_TABLES))
    expect(after.finalPremium).toBeGreaterThan(base.finalPremium)
  })
})

describe('D3 — one minimum-premium mechanism per product', () => {
  it('PH: minimumPremium field equals the MIN_FLOOR step constant', () => {
    const step = PH_RATING_PROGRAM.steps.find(s => s.op === 'MIN_FLOOR')!
    expect(step.source.type).toBe('CONST')
    expect(step.source.value).toBe(PH_RATING_PROGRAM.minimumPremium)
  })
  it('PA: minimumPremium field equals the MIN_FLOOR step constant', () => {
    const step = PA_RATING_PROGRAM.steps.find(s => s.op === 'MIN_FLOOR')!
    expect(step.source.type).toBe('CONST')
    expect(step.source.value).toBe(PA_RATING_PROGRAM.minimumPremium)
  })
})

describe('D5 — refIds are line-prefixed and uniform across both products', () => {
  // Forms are intentionally excluded: they carry ISO form numbers (HO 00 03 / PP 00 01),
  // a deliberately separate, load-bearing scheme (form-number chips) — not PH./PA. refIds.
  function seededRefIds(
    prod: { refId: string | null },
    rt: Record<string, unknown>,
    ld: Record<string, unknown>,
    prog: { refId: string | null },
    ...groups: ReadonlyArray<{ refId: string | null }>[]
  ): (string | null)[] {
    return [
      prod.refId,
      ...Object.keys(rt),
      ...Object.keys(ld),
      prog.refId,
      ...groups.flatMap(g => g.map(x => x.refId)),
    ]
  }

  it('every Personal Home refId starts with "PH."', () => {
    const ids = seededRefIds(PH_PRODUCT, PH_RT_TABLES, PH_LD_TABLES, PH_RATING_PROGRAM, PH_COVERAGES, PH_RULES, PH_FORM_RULES, PH_DICTIONARY)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(typeof id === 'string' && id.startsWith('PH.')).toBe(true)
  })

  it('every Personal Auto refId starts with "PA."', () => {
    const ids = seededRefIds(PA_PRODUCT, PA_RT_TABLES, PA_LD_TABLES, PA_RATING_PROGRAM, PA_COVERAGES, PA_RULES, PA_FORM_RULES, PA_DICTIONARY)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(typeof id === 'string' && id.startsWith('PA.')).toBe(true)
  })
})

describe('D6 — the LD-source getter is wired (not a throwing stub)', () => {
  it('PH LD getter returns the selected option value, matched by value or label', () => {
    const g = makePHLdGetter(PH_LD_TABLES)
    expect(g('PH.LD.003', 1000)).toBe(1000)     // All-Peril Deductible $1,000 (by value)
    expect(g('PH.LD.003', '$2,500')).toBe(2500) // …matched by display label
  })

  it('PA LD getter resolves against its own tables', () => {
    const g = makePALdGetter(PA_LD_TABLES)
    expect(g('PA.LD.005', 500)).toBe(500)       // Collision Deductible $500
  })

  it('an LD-source step evaluates end-to-end through the shared engine', () => {
    // A minimal one-step program proving the evaluator's LD branch is reachable + correct.
    const steps: RatingStep[] = [
      { id: 'x', order: 1, label: 'LD echo', op: 'SET', source: { type: 'LD', ref: 'PH.LD.003', keys: ['allPerilDed'] } },
    ]
    const program: RatingProgram = { ...PH_RATING_PROGRAM, steps }
    const res = evaluate(program, { ...PH_WORKED_EXAMPLE, allPerilDed: 2500 }, makePHRtGetter(PH_RT_TABLES), makePHLdGetter(PH_LD_TABLES))
    expect(res.finalPremium).toBe(2500)
    expect(res.trace[0]!.sourceRef).toBe('PH.LD.003[2500]')
  })

  it('throws a clear error for an unknown option (never returns a silent wrong value)', () => {
    expect(() => makePHLdGetter(PH_LD_TABLES)('PH.LD.003', 99999)).toThrow(/no option/)
  })
})

describe('engine — every advertised source type is implemented and exercised', () => {
  // CONST (min-floor + RC), RT (most steps) and SPP (jewelry) are covered by the two canary
  // trace tests; LD is covered above. INPUT is a valid contract type + a rating-step editor
  // option, but neither current seed uses it — this proves the branch is live (not dead) so it
  // can't silently rot the way the LD stub had.
  it('INPUT source reads a numeric input directly', () => {
    const steps: RatingStep[] = [
      { id: 'i', order: 1, label: 'input echo', op: 'SET', source: { type: 'INPUT', ref: 'covA' } },
    ]
    const program: RatingProgram = { ...PH_RATING_PROGRAM, steps }
    const res = evaluate(program, { ...PH_WORKED_EXAMPLE, covA: 400000 }, makePHRtGetter(PH_RT_TABLES), makePHLdGetter(PH_LD_TABLES))
    expect(res.finalPremium).toBe(400000)
    expect(res.trace[0]!.sourceRef).toBe('INPUT(covA)')
  })
})
