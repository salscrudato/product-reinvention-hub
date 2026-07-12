// tests/fixtures/import/ratingHelpers.ts — tiny helpers for the IM/PR rating canaries.
// The seeded lines (HO, GL) run their real seed programs; the two authored lines (IM, PR)
// need a minimal-but-valid RatingProgram to price through the REAL evaluator. These helpers
// keep the authored programs free of governance boilerplate. Pure TS; only @pf/shared.
import type { RatingProgram, RatingStep, RtGetter, LdGetter } from '@pf/shared'

/** Build a governance-complete RatingProgram from just its refId/name/steps. */
export function miniRatingProgram(
  refId: string, name: string, steps: RatingStep[], minimumPremium = 0,
): RatingProgram {
  return {
    refId, name, minimumPremium, steps,
    allStates: true, states: [],
    status: 'ACTIVE', lifecycle: 'LAUNCHED', reviewStatus: 'APPROVED',
    reviewer: 'fixture', createdAt: null, updatedAt: null, updatedBy: 'fixture', rev: 1,
  }
}

// Getters that throw if called — the authored IM/PR programs use only CONST/INPUT sources,
// so a table lookup here would signal an authoring mistake, not silently return 0.
export const throwingRt: RtGetter = (ref) => { throw new Error(`unexpected RT lookup: ${ref}`) }
export const throwingLd: LdGetter = (ref) => { throw new Error(`unexpected LD lookup: ${ref}`) }
