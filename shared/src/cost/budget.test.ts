import { describe, it, expect } from 'vitest'
import { decideBudget, featureCap, DEFAULT_BUDGET } from './budget'
import type { BudgetPolicy, SpendSnapshot } from './budget'

const policy: BudgetPolicy = {
  globalDailyUsd: 10,
  perSessionUsd: 2,
  perFeatureDefaultUsd: 3,
  perFeatureDailyUsd: { chat: 5 },
}
const zero: SpendSnapshot = { globalDayUsd: 0, sessionUsd: 0, featureDayUsd: 0 }

describe('featureCap', () => {
  it('uses the per-feature cap when set, else the default', () => {
    expect(featureCap(policy, 'chat')).toBe(5)
    expect(featureCap(policy, 'analyzeClaim')).toBe(3)
  })
})

describe('decideBudget', () => {
  it('allows a call comfortably within every window', () => {
    expect(decideBudget(policy, 'chat', zero, 0.02).action).toBe('allow')
  })

  it('DENIES (hard) when the global daily ceiling would be exceeded — checked first', () => {
    const spend = { globalDayUsd: 9.99, sessionUsd: 0, featureDayUsd: 0 }
    const d = decideBudget(policy, 'chat', spend, 0.02)
    expect(d.action).toBe('deny')
    expect(d.scope).toBe('global')
  })

  it('DEGRADES (soft) on the per-session cap', () => {
    const spend = { globalDayUsd: 0, sessionUsd: 1.99, featureDayUsd: 0 }
    const d = decideBudget(policy, 'chat', spend, 0.02)
    expect(d.action).toBe('degrade')
    expect(d.scope).toBe('session')
  })

  it('DEGRADES (soft) on the per-feature daily cap', () => {
    const spend = { globalDayUsd: 0, sessionUsd: 0, featureDayUsd: 4.99 }
    const d = decideBudget(policy, 'chat', spend, 0.02)
    expect(d.action).toBe('degrade')
    expect(d.scope).toBe('feature')
  })

  it('global deny takes precedence over a session breach', () => {
    const spend = { globalDayUsd: 10, sessionUsd: 5, featureDayUsd: 5 }
    expect(decideBudget(policy, 'chat', spend, 0.02).action).toBe('deny')
  })

  it('the estimated cost pushes a near-cap call over the edge (cap bites before overspend)', () => {
    const spend = { globalDayUsd: 0, sessionUsd: 1.9, featureDayUsd: 0 }
    expect(decideBudget(policy, 'chat', spend, 0.05).action).toBe('allow')   // 1.95 ≤ 2
    expect(decideBudget(policy, 'chat', spend, 0.2).action).toBe('degrade')  // 2.10 > 2
  })

  it('ships sensible non-zero defaults', () => {
    expect(DEFAULT_BUDGET.globalDailyUsd).toBeGreaterThan(0)
    expect(DEFAULT_BUDGET.perSessionUsd).toBeGreaterThan(0)
    expect(featureCap(DEFAULT_BUDGET, 'chat')).toBeGreaterThan(0)
  })
})
