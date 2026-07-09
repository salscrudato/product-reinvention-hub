// Guards the WSJF priority helper: base value/size ratio with no votes, vote heat
// that decays with age, and the monotonicity + defensive clamping the backlog relies on.
import { describe, it, expect } from 'vitest'
import { priorityScore, PRIORITY_HALF_LIFE_DAYS } from './priority'

describe('priorityScore (WSJF)', () => {
  it('reduces to impact / effort when there are no votes', () => {
    expect(priorityScore(3, 1, 0, 0)).toBe(3)      // (3 + 0) / 1
    expect(priorityScore(2, 2, 0, 0)).toBe(1)      // (2 + 0) / 2
    expect(priorityScore(1, 3, 0, 0)).toBe(0.3333) // (1 + 0) / 3, rounded 4 dp
  })

  it('adds fresh vote heat at full weight (ageDays 0 ⇒ e^0 = 1)', () => {
    expect(priorityScore(3, 1, 10, 0)).toBe(13)    // (3 + 10) / 1
    expect(priorityScore(1, 2, 4, 0)).toBe(2.5)    // (1 + 4) / 2
  })

  it('decays vote heat on a 14-day time constant', () => {
    // At exactly one half-life the vote weight is e^-1 ≈ 0.3679.
    expect(priorityScore(1, 1, 10, PRIORITY_HALF_LIFE_DAYS)).toBeCloseTo(1 + 10 * Math.exp(-1), 4)
    // A very old item's votes have essentially decayed away — it approaches raw impact/effort.
    expect(priorityScore(2, 2, 10, 400)).toBeCloseTo(1, 3)
  })

  it('is monotonic: more impact / fewer effort / more votes / less age all raise it', () => {
    const base = priorityScore(2, 2, 2, 7)
    expect(priorityScore(3, 2, 2, 7)).toBeGreaterThan(base) // ↑ impact
    expect(priorityScore(2, 1, 2, 7)).toBeGreaterThan(base) // ↓ effort
    expect(priorityScore(2, 2, 5, 7)).toBeGreaterThan(base) // ↑ votes
    expect(priorityScore(2, 2, 2, 1)).toBeGreaterThan(base) // ↓ age
  })

  it('clamps the 1..3 scales, floors negatives, and never divides by zero', () => {
    expect(priorityScore(9, 0, -5, -3)).toBe(3)      // impact→3, effort→1, votes→0, age→0 ⇒ 3/1
    expect(priorityScore(NaN, NaN, NaN, NaN)).toBe(1) // all collapse to defaults ⇒ (1 + 0) / 1
  })
})
