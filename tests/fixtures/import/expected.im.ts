// tests/fixtures/import/expected.im.ts — EXPECTED canonical snapshot for Inland Marine.
// AUTHORED FROM THE DOCUMENTED VARIANCE (the component-model IM workbooks are not in the repo): the
// "Product Component Model" / "Forms Library" / "Rules Repository" sheet names, the "ID"
// column, and the IM.COV###.## / IM.RL.### refId schemes. refIds are in the line's exact
// shape (see lobRegistry IM_REFIDS). The rating canary prices a small authored program
// through the REAL evaluator, proving the generic engine computes an IM premium.
import {
  evaluate, type HarnessEntity, type ExpectedSnapshot, type RatingStep,
} from '@pf/shared'
import type { LineExpected } from './types'
import { miniRatingProgram, throwingRt, throwingLd } from './ratingHelpers'

const entities: HarnessEntity[] = [
  { entityType: 'product', key: 'product:secura-im', refId: 'IM.PROD001',
    fields: { status: 'ACTIVE' } },

  // Coverages — note the concatenated shape "IM.COV044.00" and a sub "IM.COV044.01".
  { entityType: 'coverage', key: 'cov:contractors-equipment', refId: 'IM.COV044.00', parentRefId: null,
    fields: { requirement: 'MANDATORY', source: 'PROPRIETARY', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:rented-leased-equipment', refId: 'IM.COV044.01', parentRefId: 'IM.COV044.00',
    fields: { requirement: 'OPTIONAL', source: 'PROPRIETARY', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:installation-floater', refId: 'IM.COV045.00', parentRefId: null,
    fields: { requirement: 'OPTIONAL', source: 'PROPRIETARY', status: 'ACTIVE' } },

  // Forms — a Sample Mutual-proprietary form + an AAIS/ISO bureau conditions form.
  { entityType: 'form', key: 'form:IM 7000', refId: null,
    fields: { category: 'BASE_COVERAGE', source: 'PROPRIETARY', status: 'ACTIVE' } },
  { entityType: 'form', key: 'form:CM 00 01', refId: null,
    fields: { category: 'ENDORSEMENT', source: 'BUREAU', status: 'ACTIVE' } },

  // Rule — note the "RL" rule token (not "RU").
  { entityType: 'rule', key: 'rule:scheduled-eligibility', refId: 'IM.RL.001',
    fields: { category: 'PRODUCT', status: 'ACTIVE' } },
]

const snapshot: ExpectedSnapshot = { line: 'IM', entities }

// Authored rating program: base rate/$100 of scheduled value, floored at a minimum premium.
// 0.85 × 2000 (i.e. $200,000 ÷ $100) = 1700; MIN_FLOOR(250) → 1700.
const IM_STEPS: RatingStep[] = [
  { id: 'IM.RAT.001', order: 1, label: 'Scheduled equipment base rate', op: 'SET', source: { type: 'CONST', value: 0.85 } },
  { id: 'IM.RAT.002', order: 2, label: 'Apply scheduled value (÷$100)', op: 'MUL', source: { type: 'INPUT', ref: 'scheduledValueHundreds' }, roundTo: 0 },
  { id: 'IM.RAT.003', order: 3, label: 'Minimum premium', op: 'MIN_FLOOR', source: { type: 'CONST', value: 250 }, roundTo: 0 },
]
const IM_PROGRAM = miniRatingProgram('IM.RAT.001', 'Inland Marine Scheduled Equipment', IM_STEPS, 250)

export const IM_EXPECTED: LineExpected = {
  line: 'IM',
  workbookIds: ['im-framework', 'im-rules'],
  groundedInRepo: false,
  snapshot,
  ratingCanary: {
    line: 'IM',
    expectedPremium: 1700,
    run: () => evaluate(IM_PROGRAM, { scheduledValueHundreds: 2000 }, throwingRt, throwingLd).finalPremium,
  },
}
