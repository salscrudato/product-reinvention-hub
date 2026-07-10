// rating/kits.ts — the line-agnostic bridge between a product's LOB and the concrete
// rating machinery it needs: the RT/LD getters, the default worked-example inputs, and
// (optionally) the data-driven input worksheet. Surfaces that price a product resolve a
// kit by the LOB prefix instead of hard-coding the getter — so Personal Home and Personal
// Auto (and any future line) both compute a live trace through the same shared evaluator.
//
// DATA-FIRST EXTENSION: resolveRatingKit now falls back to ratingKitGenerator for any
// prefix registered in LINE_INTELLIGENCE_REGISTRY but lacking a bespoke kit. This means
// a new line registered as data (LobDefinition + LineArchetype) automatically gets a
// working kit without any change to this file. Bespoke kits still take priority so PH/PA/GL
// canaries are untouched.
// Pure TypeScript; imports only other pure seed/rating modules.
import type { RTTable, LDTable, RatingInputMap, RatingInputField } from '../types'
import type { RtGetter, LdGetter } from './evaluator'
import { makePHRtGetter, makePHLdGetter, PH_WORKED_EXAMPLE } from '../seed/personalHome'
import { makePARtGetter, makePALdGetter, PA_WORKED_EXAMPLE, PA_RATING_INPUT_SPEC } from '../seed/personalAuto'
import { makeGLRtGetter, makeGLLdGetter, GL_WORKED_EXAMPLE, GL_RATING_INPUT_SPEC } from '../seed/generalLiability'
import { ratingKitGenerator } from '../lines/ratingKit'
import { resolveLineArchetypeByPrefix } from '../lines/registry'

/** Everything a pricing surface needs to evaluate one line's rating program. */
export interface RatingKit {
  makeRtGetter:  (tables: Record<string, RTTable>) => RtGetter
  makeLdGetter:  (tables: Record<string, LDTable>) => LdGetter
  workedExample: RatingInputMap
  /** Data-driven worksheet fields; absent for the bespoke PH worksheet. */
  inputSpec?:    RatingInputField[]
}

// Keyed by LOB refId prefix (PH, PA, GL, …) — the same prefix the LOB registry resolves.
// Bespoke kits take priority over the generic ratingKitGenerator fallback.
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
  GL: {
    makeRtGetter:  makeGLRtGetter,
    makeLdGetter:  makeGLLdGetter,
    workedExample: { ...GL_WORKED_EXAMPLE },
    inputSpec:     GL_RATING_INPUT_SPEC,
  },
}

/** Resolve the rating kit for a LOB prefix.
 *  Priority order:
 *  1. Bespoke kit (PH/PA/GL — hand-crafted getters for non-simple table shapes).
 *  2. Generic kit via ratingKitGenerator for any prefix in LINE_INTELLIGENCE_REGISTRY
 *     (data-first: adding a LineArchetype is sufficient, no code change needed here).
 *  3. Personal Home fallback (so an unrecognised line renders a trace rather than crashing). */
export function resolveRatingKit(lobPrefix: string): RatingKit {
  if (KITS[lobPrefix]) return KITS[lobPrefix]!
  // DATA-FIRST FALLBACK: check the Line Intelligence Registry.
  const archetype = resolveLineArchetypeByPrefix(lobPrefix)
  if (archetype) return ratingKitGenerator(archetype)
  // Ultimate fallback: Personal Home (the reference line).
  return KITS['PH']!
}
