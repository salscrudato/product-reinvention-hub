// Worked-example canary, PER REGISTERED LINE — the deterministic guarantee behind the
// Pricing "Worked example" button: clicking it fills the LOB kit's worked example and the
// rendered premium must equal that line's canary. This proves it THROUGH the same seam the
// UI uses — resolveRatingKit(prefix).workedExample fed to evaluate() with the kit's getters —
// so a regression in a kit, its worked example, a getter, or the evaluator trips here, in the
// gate, without needing the emulator. The registry-completeness test makes adding a new line
// without a canary a hard failure, so the guarantee can never silently lapse.
import { describe, it, expect } from 'vitest'
import { evaluate } from './evaluator'
import { resolveRatingKit } from './kits'
import { LOB_REGISTRY } from '../insurance/lobRegistry'
import { PH_RATING_PROGRAM, PH_RT_TABLES, PH_LD_TABLES } from '../seed/personalHome'
import { PA_RATING_PROGRAM, PA_RT_TABLES, PA_LD_TABLES } from '../seed/personalAuto'
import { GL_RATING_PROGRAM, GL_RT_TABLES, GL_LD_TABLES } from '../seed/generalLiability'

// The exact program shape evaluate() accepts (each seed program is a governance-stripped
// literal); typing the map to it avoids per-line casts.
type Program = Parameters<typeof evaluate>[0]

interface LineCanary {
  canary:  number
  program: Program
  rt:      Parameters<ReturnType<typeof resolveRatingKit>['makeRtGetter']>[0]
  ld:      Parameters<ReturnType<typeof resolveRatingKit>['makeLdGetter']>[0]
}

// Keyed by LOB refId prefix — the same key resolveRatingKit and the registry use.
const LINE_CANARIES: Record<string, LineCanary> = {
  PH: { canary: 1528, program: PH_RATING_PROGRAM, rt: PH_RT_TABLES, ld: PH_LD_TABLES },
  PA: { canary: 1002, program: PA_RATING_PROGRAM, rt: PA_RT_TABLES, ld: PA_LD_TABLES },
  GL: { canary: 2635, program: GL_RATING_PROGRAM, rt: GL_RT_TABLES, ld: GL_LD_TABLES },
}

describe('worked example = canary, per registered line', () => {
  it('every registered LOB has a worked-example canary (register a line → register its canary)', () => {
    for (const lob of Object.values(LOB_REGISTRY)) {
      expect(
        LINE_CANARIES[lob.prefix],
        `no worked-example canary registered for LOB "${lob.prefix}" (${lob.name})`,
      ).toBeDefined()
    }
  })

  for (const [prefix, { canary, program, rt, ld }] of Object.entries(LINE_CANARIES)) {
    it(`${prefix}: the kit worked example prices to $${canary}`, () => {
      const kit = resolveRatingKit(prefix)
      const result = evaluate(program, kit.workedExample, kit.makeRtGetter(rt), kit.makeLdGetter(ld))
      // The headline: the on-screen worked example equals the line's canary.
      expect(result.finalPremium).toBe(canary)
      // …and the premium the card renders IS the final trace step's running total (no drift
      // between the number shown and the trace the PM reads step by step).
      expect(result.finalPremium).toBe(result.trace[result.trace.length - 1]!.runningTotal)
    })
  }
})
