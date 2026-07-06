// rating/kits.ts — the line-agnostic bridge between a product's LOB and the concrete
// rating machinery it needs: the RT/LD getters, the default worked-example inputs, and
// (optionally) the data-driven input worksheet. Surfaces that price a product resolve a
// kit by the LOB prefix instead of hard-coding the Homeowners getter — so HO-3 and GL
// (and any future line) both compute a live trace through the same shared evaluator.
// Pure TypeScript; imports only other pure seed/rating modules.
import type { RTTable, LDTable, RatingInputMap, RatingInputField } from '../types'
import type { RtGetter, LdGetter } from './evaluator'
import { makeHO3RtGetter, makeHO3LdGetter, HO3_WORKED_EXAMPLE } from '../seed/ho3'
import { makeGLRtGetter, makeGLLdGetter, GL_WORKED_EXAMPLE, GL_RATING_INPUT_SPEC } from '../seed/gl'

/** Everything a pricing surface needs to evaluate one line's rating program. */
export interface RatingKit {
  makeRtGetter:  (tables: Record<string, RTTable>) => RtGetter
  makeLdGetter:  (tables: Record<string, LDTable>) => LdGetter
  workedExample: RatingInputMap
  /** Data-driven worksheet fields; absent for the bespoke HO-3 worksheet. */
  inputSpec?:    RatingInputField[]
}

// Keyed by LOB refId prefix (HO, GL, …) — the same prefix the LOB registry resolves.
const KITS: Record<string, RatingKit> = {
  HO: {
    makeRtGetter:  makeHO3RtGetter,
    makeLdGetter:  makeHO3LdGetter,
    workedExample: { ...HO3_WORKED_EXAMPLE },
  },
  GL: {
    makeRtGetter:  makeGLRtGetter,
    makeLdGetter:  makeGLLdGetter,
    workedExample: { ...GL_WORKED_EXAMPLE },
    inputSpec:     GL_RATING_INPUT_SPEC,
  },
}

/** Resolve the rating kit for a LOB prefix; falls back to Homeowners (the reference
 *  line) so an unrecognised line still renders a trace rather than crashing. */
export function resolveRatingKit(lobPrefix: string): RatingKit {
  return KITS[lobPrefix] ?? KITS['HO']!
}
