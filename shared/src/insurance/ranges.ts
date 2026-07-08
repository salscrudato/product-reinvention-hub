// ranges.ts — pure helpers that turn a simple [min, max] into a logical, human-friendly
// ladder of "round" values, the way an underwriter would actually offer them. Used by the
// limit/deductible editor's Range Builder so a PM enters only two numbers and gets a sensible
// set of in-between options (e.g. $25k → $1M becomes $25k · $50k · $100k · $250k · $500k · $1M).
//
// The ladder walks a 1–2.5–5 mantissa progression across decades — the standard insurance
// "round limits" scheme — so the rungs land on the values markets use, not arbitrary linear
// steps. Density controls how many rungs appear between the endpoints. Zero platform imports.

export type RangeDensity = 'coarse' | 'standard' | 'fine'

// Mantissas per density. 'standard' reproduces the classic limit ladder
// (1, 2.5, 5 × 10ⁿ → …100k, 250k, 500k, 1M…); coarse thins it, fine adds the 2× rung.
const MANTISSAS: Record<RangeDensity, number[]> = {
  coarse:   [1, 5],
  standard: [1, 2.5, 5],
  fine:     [1, 2, 2.5, 5],
}

/**
 * A logical ascending ladder of round values between `min` and `max`, inclusive of both
 * endpoints. `percent` keeps two decimals of precision (so 2.5% survives); otherwise values
 * are whole numbers. Returns `[min, max]` (deduped, sorted) when the range is degenerate.
 */
export function niceLadder(min: number, max: number, density: RangeDensity = 'standard', percent = false): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= min) {
    return [...new Set([min, max].filter(v => Number.isFinite(v) && v >= 0))].sort((a, b) => a - b)
  }
  const round = (v: number) => (percent ? Math.round(v * 100) / 100 : Math.round(v))
  const vals = new Set<number>([round(min), round(max)])
  const lo = min > 0 ? min : 1
  const startExp = Math.floor(Math.log10(lo))
  const endExp   = Math.floor(Math.log10(max))
  for (let e = startExp; e <= endExp; e++) {
    const base = Math.pow(10, e)
    for (const m of MANTISSAS[density]) {
      const v = round(m * base)
      if (v > min && v < max) vals.add(v)
    }
  }
  return [...vals].sort((a, b) => a - b)
}

/**
 * A sensible default [min, max] to seed the Range Builder, based on context: reuse the
 * coverage's own offered values when it already has two or more, otherwise fall back to
 * line-typical bounds for the term kind (limits are large, deductibles small, percentages 1–10).
 */
export function suggestRange(
  mode: 'LIMIT' | 'DEDUCTIBLE' | 'OPTION',
  percent: boolean,
  existing: number[] = [],
): { min: number; max: number } {
  const nums = existing.filter(n => Number.isFinite(n) && n > 0)
  if (nums.length >= 2) return { min: Math.min(...nums), max: Math.max(...nums) }
  if (percent) return { min: 1, max: 10 }
  if (mode === 'DEDUCTIBLE') return { min: 250, max: 10_000 }
  return { min: 25_000, max: 1_000_000 } // LIMIT / OPTION dollars
}
