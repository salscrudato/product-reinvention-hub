import { describe, it, expect } from 'vitest'
import { isBreakerOpen, nextBreakerState, CLOSED_BREAKER } from './breaker'
import type { BreakerConfig } from './breaker'

const cfg: BreakerConfig = { failureThreshold: 3, cooldownMs: 1000 }

describe('nextBreakerState', () => {
  it('stays closed while failures are below the threshold', () => {
    let s = CLOSED_BREAKER
    s = nextBreakerState(s, false, 0, cfg)
    s = nextBreakerState(s, false, 0, cfg)
    expect(s.consecutiveFailures).toBe(2)
    expect(isBreakerOpen(s, 0)).toBe(false)
  })

  it('opens for cooldownMs once the failure streak reaches the threshold', () => {
    let s = CLOSED_BREAKER
    s = nextBreakerState(s, false, 100, cfg)
    s = nextBreakerState(s, false, 100, cfg)
    s = nextBreakerState(s, false, 100, cfg)
    expect(isBreakerOpen(s, 100)).toBe(true)
    expect(isBreakerOpen(s, 1099)).toBe(true)   // within cooldown
    expect(isBreakerOpen(s, 1101)).toBe(false)  // cooldown lapsed
  })

  it('a single success fully resets and closes the breaker', () => {
    let s = CLOSED_BREAKER
    s = nextBreakerState(s, false, 0, cfg)
    s = nextBreakerState(s, false, 0, cfg)
    s = nextBreakerState(s, false, 0, cfg)
    expect(isBreakerOpen(s, 0)).toBe(true)
    s = nextBreakerState(s, true, 500, cfg)
    expect(s.consecutiveFailures).toBe(0)
    expect(isBreakerOpen(s, 500)).toBe(false)
  })

  it('an isolated late failure after the deadline does not keep the breaker open', () => {
    // Open at t=0, then a lone failure at t=5000 (deadline long past): streak resets was not
    // triggered (no success), but the stale deadline must not linger as "open".
    let s = { consecutiveFailures: 3, openUntil: 1000 }
    s = nextBreakerState(s, false, 5000, cfg)     // 4th failure, but past cooldown
    // threshold reached again → re-opens from now; but with a fresh window
    expect(s.openUntil).toBe(6000)
  })
})
