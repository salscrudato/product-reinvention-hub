// rating/kits.ts — the line-agnostic bridge between a product's LOB and the concrete
// rating machinery it needs: the RT/LD getters, the default worked-example inputs, and
// (optionally) the data-driven input worksheet. Surfaces that price a product resolve a
// kit by the LOB prefix instead of hard-coding the getter — so Personal Home and Personal
// Auto (and any future line) both compute a live trace through the same shared evaluator.
// Pure TypeScript; imports only other pure seed/rating modules.
import type { RTTable, LDTable, RatingInputMap, RatingInputField } from '../types'
import type { RtGetter, LdGetter } from './evaluator'
import { makePHRtGetter, makePHLdGetter, PH_WORKED_EXAMPLE } from '../seed/personalHome'
import { makePARtGetter, makePALdGetter, PA_WORKED_EXAMPLE, PA_RATING_INPUT_SPEC } from '../seed/personalAuto'

/** Everything a pricing surface needs to evaluate one line's rating program. */
export interface RatingKit {
  makeRtGetter:  (tables: Record<string, RTTable>) => RtGetter
  makeLdGetter:  (tables: Record<string, LDTable>) => LdGetter
  workedExample: RatingInputMap
  /** Data-driven worksheet fields; absent for the bespoke PH worksheet. */
  inputSpec?:    RatingInputField[]
}

// Keyed by LOB refId prefix (PH, PA, …) — the same prefix the LOB registry resolves.
const KITS: Record<string, RatingKit> = {
  PH: {
    makeRtGetter:  makePHRtGetter,
    makeLdGetter:  makePHLdGetter,
    workedExample: { ...PH_WORKED_EXAMPLE },
  },
  PA: {
    makeRtGetter:  makePARtGetter,
    makeLdGetter:  makePALdGetter,
    workedExample: { ...PA_WORKED_EXAMPLE },
    inputSpec:     PA_RATING_INPUT_SPEC,
  },
}

/** Resolve the rating kit for a LOB prefix; falls back to Personal Home (the reference
 *  line) so an unrecognised line still renders a trace rather than crashing. */
export function resolveRatingKit(lobPrefix: string): RatingKit {
  return KITS[lobPrefix] ?? KITS['PH']!
}
