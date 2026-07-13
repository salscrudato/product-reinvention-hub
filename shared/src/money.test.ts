// money.test.ts — integer-cents round-trip canary (DEF-0004 follow-through).
//
// The invariant: every money value the platform stores or rates must represent a
// whole number of cents, and must survive dollars → cents → dollars byte-exactly.
// The sweep below walks the canonical PH/PA/GL seed data (the same dataset the
// $1,528 / $1,002 / $2,635 canaries rate against) and asserts the invariant over
// every money-keyed numeric field.
import { describe, it, expect } from 'vitest'
import { toCents, fromCents, isExactMoney, assertMoney } from './money'
import * as PH from './seed/personalHome'
import * as PA from './seed/personalAuto'
import * as GL from './seed/generalLiability'

describe('toCents / fromCents — exactness', () => {
  it('round-trips the three rating canaries byte-exactly', () => {
    for (const premium of [1528, 1002, 2635]) {
      expect(fromCents(toCents(premium))).toBe(premium)
    }
  })

  it('round-trips the HO-3 canary intermediate trace values (roundTo:2 discipline)', () => {
    for (const v of [1013.36, 1147.7, 1527.97]) {
      expect(fromCents(toCents(v))).toBe(v)
      expect(assertMoney(v)).toBe(v)
    }
  })

  it('round-trips every whole-cent value from $0.00 to $99.99', () => {
    for (let cents = 0; cents < 10000; cents++) {
      expect(toCents(fromCents(cents))).toBe(cents)
    }
  })

  it('rejects genuine sub-cent precision (float drift is an error, never rounded away)', () => {
    expect(() => toCents(10.005)).toThrow(/sub-cent/)
    expect(() => toCents(0.1 + 0.2)).toThrow(/sub-cent/) // 0.30000000000000004
    expect(isExactMoney(1147.6999999999998)).toBe(false)  // unrounded intermediate
    expect(isExactMoney(1147.7)).toBe(true)               // its roundTo:2 form
  })

  it('rejects non-finite and out-of-range values', () => {
    expect(() => toCents(NaN)).toThrow()
    expect(() => toCents(Infinity)).toThrow()
    expect(() => toCents(Number.MAX_SAFE_INTEGER)).toThrow(/range/)
    expect(() => fromCents(1.5)).toThrow(/integer/)
  })
})

// ─── Seed sweep: every stored money value is whole-cent exact ─────────────────
// Money-keyed fields; factors/rates are multipliers, not money, and are excluded.
const MONEY_KEY = /premium|limit|deductible|amount|price|fee|cost/i
const EXCLUDE_KEY = /factor|rate\b|type|label|unit|id$/i

function collectMoney(node: unknown, keyPath: string, out: Array<{ path: string; value: number }>): void {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectMoney(v, `${keyPath}[${i}]`, out))
    return
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === 'number' && MONEY_KEY.test(k) && !EXCLUDE_KEY.test(k)) {
        out.push({ path: `${keyPath}.${k}`, value: v })
      }
      collectMoney(v, `${keyPath}.${k}`, out)
    }
  }
}

describe('seed data money sweep — canonical PH/PA/GL dataset', () => {
  it('every money-keyed numeric field in the seed round-trips through integer cents', () => {
    const found: Array<{ path: string; value: number }> = []
    collectMoney(PH, 'PH', found)
    collectMoney(PA, 'PA', found)
    collectMoney(GL, 'GL', found)
    // The sweep must actually find money fields — an empty sweep would be theater.
    expect(found.length).toBeGreaterThan(30) // 44 at authoring time
    const violations = found.filter((f) => !isExactMoney(f.value))
    expect(violations).toEqual([])
  })
})
