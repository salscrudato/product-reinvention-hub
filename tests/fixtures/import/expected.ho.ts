// tests/fixtures/import/expected.ho.ts — EXPECTED canonical snapshot for Personal Home (HO).
// Grounded in the canonical seed (shared/src/seed/personalHome.ts): refIds, form numbers,
// parentId links and enum values are copied verbatim from the seed the $1,528 canary is built
// on. The rating canary runs the REAL seed program through the REAL evaluator.
import {
  evaluate, PH_RATING_PROGRAM, PH_RT_TABLES, PH_LD_TABLES, PH_WORKED_EXAMPLE,
  makePHRtGetter, makePHLdGetter, type HarnessEntity, type ExpectedSnapshot,
} from '@pf/shared'
import type { LineExpected } from './types'

const entities: HarnessEntity[] = [
  { entityType: 'product', key: 'product:personal-home', refId: 'PH.PROD.001',
    fields: { status: 'ACTIVE' } },

  // Coverages — three top-level + two sub-coverages (parentId links).
  { entityType: 'coverage', key: 'cov:coverage-a-dwelling', refId: 'PH.COV.001', parentRefId: null,
    fields: { requirement: 'MANDATORY', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:coverage-c-personal-property', refId: 'PH.COV.003', parentRefId: null,
    fields: { requirement: 'MANDATORY', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:coverage-e-personal-liability', refId: 'PH.COV.005', parentRefId: null,
    fields: { requirement: 'MANDATORY', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:pp-replacement-cost', refId: 'PH.COV.003.001', parentRefId: 'PH.COV.003',
    fields: { requirement: 'OPTIONAL', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:water-backup', refId: 'PH.COV.001.001', parentRefId: 'PH.COV.001',
    fields: { requirement: 'OPTIONAL', source: 'BUREAU', status: 'ACTIVE' } },

  // Forms — refId is null (forms are keyed by number); the number is the natural key.
  { entityType: 'form', key: 'form:HO 00 03', refId: null,
    fields: { category: 'BASE_COVERAGE', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'form', key: 'form:HO 04 90', refId: null,
    fields: { category: 'ENDORSEMENT', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'form', key: 'form:HO 04 95', refId: null,
    fields: { category: 'ENDORSEMENT', source: 'BUREAU', status: 'ACTIVE' } },

  // Rules + one form rule.
  { entityType: 'rule', key: 'rule:eligibility', refId: 'PH.RU.001',
    fields: { category: 'PRODUCT', status: 'ACTIVE' } },
  { entityType: 'rule', key: 'rule:wind-hail-deductible', refId: 'PH.RU.007',
    fields: { category: 'RATING', status: 'ACTIVE' } },
  { entityType: 'formRule', key: 'formrule:rc-attach', refId: 'PH.FORM.RU.001',
    fields: { status: 'ACTIVE' } },
]

const snapshot: ExpectedSnapshot = { line: 'HO', entities }

export const HO_EXPECTED: LineExpected = {
  line: 'HO',
  workbookIds: [], // HO ships no ISO workbook here; grounded in the canonical seed instead.
  groundedInRepo: true,
  snapshot,
  ratingCanary: {
    line: 'HO',
    expectedPremium: 1528,
    run: () => evaluate(
      PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, makePHRtGetter(PH_RT_TABLES), makePHLdGetter(PH_LD_TABLES),
    ).finalPremium,
  },
}
