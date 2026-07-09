// cost/breaker.ts — a pure circuit breaker for the AI provider. A run of provider faults
// (timeouts, 5xx, connection drops) must NOT keep hammering the upstream and burning the
// function-timeout budget on doomed calls. After `failureThreshold` consecutive failures the
// breaker OPENS for `cooldownMs`; while open, callers degrade gracefully (cached answer /
// clear message) instead of calling the provider. A single success CLOSES it and resets.
//
// State is persisted by functions/src/costGuard.ts (a Firestore counter doc); this module is
// the platform-free state machine so the transitions are unit-tested in the gate. It is a
// SEPARATE concern from the spend budget: a tripped breaker degrades the request, it does not
// touch the budget — "a stalled/erroring provider trips a breaker, not the budget."

export interface BreakerConfig {
  /** Consecutive failures that open the breaker. */
  failureThreshold: number
  /** How long the breaker stays open before allowing traffic again (ms). */
  cooldownMs:       number
}

/** Trip after 4 consecutive faults; stay open for 60s (matches the per-turn timeout window). */
export const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 4, cooldownMs: 60_000 }

/** Persisted state. `openUntil` is an epoch-ms deadline; 0 (or past) means closed. */
export interface BreakerState {
  consecutiveFailures: number
  openUntil:           number
}

export const CLOSED_BREAKER: BreakerState = { consecutiveFailures: 0, openUntil: 0 }

/** True while the breaker is open (now is before the cooldown deadline). */
export function isBreakerOpen(state: BreakerState, now: number): boolean {
  return state.openUntil > now
}

/**
 * Fold one call outcome into the breaker state.
 *   • success → fully reset (closed, zero failures) — the provider is healthy again.
 *   • failure → increment the streak; once it reaches the threshold, open for cooldownMs.
 * A failure below the threshold leaves the breaker closed (openUntil cleared if it had
 * lapsed) so a slow drip of isolated faults never trips it — only a genuine run does.
 */
export function nextBreakerState(
  state: BreakerState,
  ok: boolean,
  now: number,
  config: BreakerConfig = DEFAULT_BREAKER,
): BreakerState {
  if (ok) return { consecutiveFailures: 0, openUntil: 0 }
  const consecutiveFailures = state.consecutiveFailures + 1
  if (consecutiveFailures >= config.failureThreshold) {
    return { consecutiveFailures, openUntil: now + config.cooldownMs }
  }
  // Keep an already-open deadline if it is still in the future; otherwise stay closed.
  return { consecutiveFailures, openUntil: state.openUntil > now ? state.openUntil : 0 }
}
