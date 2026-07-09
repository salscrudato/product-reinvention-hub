// priority.ts — WSJF-style priority score for the feedback backlog.
// Pure + deterministic: zero platform imports, no Date.now(). The caller passes
// ageDays, so the same inputs always yield the same score and it unit-tests cleanly.
//
// Formula — a Weighted-Shortest-Job-First blend of value, demand and size:
//
//   score = (impact + votes · e^(−ageDays / HALF_LIFE_DAYS)) / effort
//
//   • impact (1..3)  — intrinsic value of shipping the item: the base cost of delay.
//   • votes · e^(−ageDays/14) — demand pressure. This is the SAME "heat" the Feedback
//     board already sorts by (votes decayed on a 14-day time constant), so fresh upvotes
//     raise priority while staleness bleeds it back off. Added to impact ⇒ total cost of
//     delay.
//   • effort (1..3)  — job size. Dividing by it is the WSJF normalization: cheap wins
//     outrank expensive ones of equal value.
//
// So a high-impact, low-effort, freshly-upvoted idea floats to the top; a stale,
// high-effort, low-value one sinks. The result is monotonic in every input, which keeps
// the backlog ordering intuitive.

/** Time constant (days) over which a vote's contribution decays — matches the board's heat. */
export const PRIORITY_HALF_LIFE_DAYS = 14

/** Clamp to [lo, hi]; a non-finite input collapses to `lo` (safe, never NaN out). */
const clamp = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo

/**
 * WSJF priority score for one feedback item. Higher = do sooner.
 * @param impact  intrinsic value / severity, 1 (low) … 3 (high) — clamped to that range.
 * @param effort  estimated build size, 1 (small) … 3 (large) — clamped; never divides by 0.
 * @param votes   upvote count (≥ 0; negatives floored to 0).
 * @param ageDays days since the item was created (≥ 0; negatives floored to 0).
 * @returns the score, rounded to 4 dp for a stable, index-friendly value.
 */
export function priorityScore(impact: number, effort: number, votes: number, ageDays: number): number {
  const i   = clamp(impact, 1, 3)
  const e   = clamp(effort, 1, 3)
  const v   = Math.max(0, Number.isFinite(votes) ? votes : 0)
  const age = Math.max(0, Number.isFinite(ageDays) ? ageDays : 0)
  const heat  = v * Math.exp(-age / PRIORITY_HALF_LIFE_DAYS)
  const score = (i + heat) / e
  return Math.round(score * 10_000) / 10_000
}
