// tests/fixtures/import/expected.pr.ts — EXPECTED canonical snapshot for Commercial Property.
// AUTHORED FROM THE DOCUMENTED VARIANCE (the Property rating repository + Property RF .xlsm
// are not in the repo): the "PROPERTY ROC"/"ROC" rating sheets, the "Product Component Model"
// / "Forms Library" / "Rules Repository" sheets, and the PR.COV###.# / PR.ROC.### refId
// schemes — including the headline TBD-id case (Property ROC ships blank step ids → the
// synthesizer mints PR.ROC.###). Real ISO CP form numbers. The rating canary runs an authored
// Property ROC program through the REAL evaluator.
import {
  evaluate, type HarnessEntity, type ExpectedSnapshot, type RatingStep,
} from '@pf/shared'
import type { LineExpected } from './types'
import { miniRatingProgram, throwingRt, throwingLd } from './ratingHelpers'

const entities: HarnessEntity[] = [
  { entityType: 'product', key: 'product:commercial-property', refId: 'PR.PROD001',
    fields: { status: 'ACTIVE' } },

  // Coverages — one-digit tail ("PR.COV001.0") + a sub ("PR.COV001.1").
  { entityType: 'coverage', key: 'cov:building', refId: 'PR.COV001.0', parentRefId: null,
    fields: { requirement: 'MANDATORY', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:ordinance-or-law', refId: 'PR.COV001.1', parentRefId: 'PR.COV001.0',
    fields: { requirement: 'OPTIONAL', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:business-personal-property', refId: 'PR.COV002.0', parentRefId: null,
    fields: { requirement: 'MANDATORY', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:business-income', refId: 'PR.COV003.0', parentRefId: null,
    fields: { requirement: 'OPTIONAL', source: 'BUREAU', status: 'ACTIVE' } },

  // Forms — real ISO Commercial Property numbers (Causes of Loss folds onto ENDORSEMENT).
  { entityType: 'form', key: 'form:CP 00 10', refId: null,
    fields: { category: 'BASE_COVERAGE', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'form', key: 'form:CP 10 30', refId: null,
    fields: { category: 'ENDORSEMENT', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'form', key: 'form:CP 00 90', refId: null,
    fields: { category: 'ENDORSEMENT', source: 'BUREAU', status: 'ACTIVE' } },

  { entityType: 'rule', key: 'rule:coinsurance', refId: 'PR.RU.001',
    fields: { category: 'PRODUCT', status: 'ACTIVE' } },
]

const snapshot: ExpectedSnapshot = { line: 'PR', entities }

// Authored Property ROC (Rate Order of Calculations): rate/$100 of TIV × coastal wind load,
// floored. 0.42 × 5000 ($500,000 ÷ $100) = 2100; × 1.10 = 2310; MIN_FLOOR(500) → 2310.
// Step ids are minted in the PR.ROC.### shape — the synthesizer's job for TBD source ids.
const PR_STEPS: RatingStep[] = [
  { id: 'PR.ROC.001', order: 1, label: 'Building rate per $100 TIV', op: 'SET', source: { type: 'CONST', value: 0.42 } },
  { id: 'PR.ROC.002', order: 2, label: 'Apply TIV (÷$100)', op: 'MUL', source: { type: 'INPUT', ref: 'tivHundreds' }, roundTo: 2 },
  { id: 'PR.ROC.003', order: 3, label: 'Coastal wind load', op: 'MUL', source: { type: 'CONST', value: 1.10 }, roundTo: 2 },
  { id: 'PR.ROC.004', order: 4, label: 'Minimum premium', op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 },
]
const PR_PROGRAM = miniRatingProgram('PR.ROC', 'Property Rate Order of Calculations', PR_STEPS, 500)

export const PR_EXPECTED: LineExpected = {
  line: 'PR',
  workbookIds: ['pr-rating', 'pr-rf'],
  groundedInRepo: false,
  snapshot,
  ratingCanary: {
    line: 'PR',
    expectedPremium: 2310,
    run: () => evaluate(PR_PROGRAM, { tivHundreds: 5000 }, throwingRt, throwingLd).finalPremium,
  },
}
