// tests/fixtures/import/types.ts — fixture descriptor types for the format-agnostic
// importer's offline test harness. A WorkbookFixture REGISTERS a real source workbook (its
// files, observed sheet names, and whether it physically ships in the repo). A LineExpected
// pairs a hand-authored canonical snapshot (scored by validateAgainstExpected) with a rating
// canary that runs through the REAL evaluator. Pure TS; the only import is @pf/shared.
import type { ExpectedSnapshot } from '@pf/shared'

/** A registered source workbook. Sheet names are recorded verbatim because they are exactly
 *  the cross-source variance the pipeline must survive (e.g. "GL Product Framework" vs
 *  "Product Component Model"). `presentInRepo` is asserted against the filesystem by the
 *  harness for the workbooks that physically ship. */
export interface WorkbookFixture {
  id:            string
  line:          'GL' | 'HO' | 'IM' | 'PR'
  files:         readonly string[]   // repo-relative paths
  presentInRepo: boolean
  sheetNames:    readonly string[]
  provenance:    string
}

/** A rating canary computed through the REAL shared evaluator (never re-implemented here). */
export interface RatingCanarySpec {
  line:            string
  expectedPremium: number
  /** Runs evaluate() and returns the final premium. */
  run:             () => number
}

/** A per-line expected snapshot + its rating canary, tied back to the workbook(s) it grounds in. */
export interface LineExpected {
  line:         'GL' | 'HO' | 'IM' | 'PR'
  workbookIds:  readonly string[]
  /** true when the snapshot is grounded in cells physically extracted from a shipped
   *  workbook (GL) or the canonical seed (HO); false when authored from the DOCUMENTED
   *  cross-source variance because the binary is not in the repo (IM, PR). */
  groundedInRepo: boolean
  snapshot:     ExpectedSnapshot
  ratingCanary: RatingCanarySpec
}
