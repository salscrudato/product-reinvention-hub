// money.ts — integer-cents money invariant behind the adapter seam.
//
// Storage reality (DEF-0004): money is stored as 2-decimal dollar numbers, with the
// rating evaluator enforcing a per-step roundTo:2 discipline so no intermediate value
// carries more precision than a cent. This module is the INVARIANT layer on top:
//
//   toCents(dollars)   — exact integer cents; THROWS on any value that does not
//                        represent a whole number of cents (sub-cent drift = a bug,
//                        never something to silently round away).
//   fromCents(cents)   — exact 2-decimal dollars; throws on non-integer cents.
//   assertMoney(v)     — round-trip guard: v must survive dollars→cents→dollars
//                        byte-exactly.
//
// Every stored money value must round-trip losslessly (see money.test.ts, which
// sweeps the canonical seed data and the three rating canaries). Any future storage
// migration to raw integer cents can adopt these helpers as-is — the invariant and
// canary land now; the physical representation stays 2-decimal dollars until a
// dedicated migration.

/** Largest dollar amount whose cents fit exactly in a double (2^53-1 cents). */
export const MAX_MONEY_DOLLARS = Number.MAX_SAFE_INTEGER / 100

/** Convert a dollar amount to exact integer cents. Throws if the value carries
 *  sub-cent precision (e.g. 10.005) or is not a finite number in range. */
export function toCents(dollars: number): number {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars)) {
    throw new Error(`money: not a finite number: ${String(dollars)}`)
  }
  if (Math.abs(dollars) > MAX_MONEY_DOLLARS) {
    throw new Error(`money: out of exact integer-cent range: ${dollars}`)
  }
  const cents = Math.round(dollars * 100)
  // Reject sub-cent drift: the rounded cents must reproduce the input exactly.
  // Values produced by the evaluator's roundTo:2 discipline (Math.round(x*100)/100)
  // are by construction the double nearest to cents/100, so they pass; anything
  // carrying genuine sub-cent precision (e.g. 10.005, or an unrounded intermediate
  // like 1147.6999999999998) fails.
  if (cents / 100 !== dollars) {
    throw new Error(`money: sub-cent precision (not a whole number of cents): ${dollars}`)
  }
  return cents
}

/** Convert integer cents back to a 2-decimal dollar amount. */
export function fromCents(cents: number): number {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`money: cents must be a safe integer: ${String(cents)}`)
  }
  return cents / 100
}

/** True when a dollar value round-trips losslessly through integer cents. */
export function isExactMoney(dollars: number): boolean {
  try { return fromCents(toCents(dollars)) === dollars } catch { return false }
}

/** Assert the round-trip invariant; returns the value for inline use. */
export function assertMoney(dollars: number, label?: string): number {
  if (!isExactMoney(dollars)) {
    throw new Error(`money round-trip violation${label ? ` (${label})` : ''}: ${dollars}`)
  }
  return dollars
}
