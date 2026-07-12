// tests/fixtures/import/expected.gl.ts — EXPECTED canonical snapshot for General Liability.
// Grounded in cells physically extracted from the four ISO GL workbooks (samples/iso/*.xlsx):
//   • "GL Product Framework"  → GL.PROD.001 "Monoline General Liability Product".
//   • "GL Rules Specifications" row → coverages GL.COV.002/003/004 (BI/PD Premises + PCO).
//   • "GL Forms Specifications" → CG 00 01 (Base, Occurrence) + CG 00 02 (Base, Claims-Made),
//      and the sub-coverage refId GL.COV.004.009 (the coverage CG 00 02 links to).
//   • "GL Rules Specifications"/"GL Optional Forms Rules" → GL.RU.001/002, GL.FORM.RU.001/002.
//   • "Limits and Deductibles" → LDTable.001 (Occurrence Limits), LDTable.008 (Policy Claims Basis).
// The rating canary runs the REAL GL seed program through the REAL evaluator ($2,635).
import {
  evaluate, GL_RATING_PROGRAM, GL_RT_TABLES, GL_LD_TABLES, GL_WORKED_EXAMPLE,
  makeGLRtGetter, makeGLLdGetter, type HarnessEntity, type ExpectedSnapshot,
} from '@pf/shared'
import type { LineExpected } from './types'

const entities: HarnessEntity[] = [
  { entityType: 'product', key: 'product:monoline-gl', refId: 'GL.PROD.001',
    fields: { status: 'ACTIVE' } },

  // Coverages: three top-level + one sub-coverage (GL.COV.004.009 → parent GL.COV.004).
  { entityType: 'coverage', key: 'cov:bi-premises', refId: 'GL.COV.002', parentRefId: null,
    fields: { requirement: 'MANDATORY', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:pd-premises', refId: 'GL.COV.003', parentRefId: null,
    fields: { requirement: 'MANDATORY', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:bi-products', refId: 'GL.COV.004', parentRefId: null,
    fields: { requirement: 'MANDATORY', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'coverage', key: 'cov:pco-claims-made', refId: 'GL.COV.004.009', parentRefId: 'GL.COV.004',
    fields: { requirement: 'OPTIONAL', source: 'BUREAU', status: 'ACTIVE' } },

  // Forms (refId null; number is the natural key). Form numbers preserved verbatim incl. spaces.
  { entityType: 'form', key: 'form:CG 00 01', refId: null,
    fields: { category: 'BASE_COVERAGE', source: 'BUREAU', status: 'ACTIVE' } },
  { entityType: 'form', key: 'form:CG 00 02', refId: null,
    fields: { category: 'BASE_COVERAGE', source: 'BUREAU', status: 'ACTIVE' } },

  // Rules + form rules.
  { entityType: 'rule', key: 'rule:base-coverage', refId: 'GL.RU.001',
    fields: { category: 'PRODUCT', status: 'ACTIVE' } },
  { entityType: 'rule', key: 'rule:claims-basis', refId: 'GL.RU.002',
    fields: { category: 'PRODUCT', status: 'ACTIVE' } },
  { entityType: 'formRule', key: 'formrule:pollution-designated', refId: 'GL.FORM.RU.001',
    fields: { status: 'ACTIVE' } },
  { entityType: 'formRule', key: 'formrule:pollution-limited', refId: 'GL.FORM.RU.002',
    fields: { status: 'ACTIVE' } },

  // LD tables (global "LDTable.NNN" scheme — NOT line-prefixed).
  { entityType: 'ldTable', key: 'ld:occurrence-limits', refId: 'LDTable.001' },
  { entityType: 'ldTable', key: 'ld:policy-claims-basis', refId: 'LDTable.008' },
]

const snapshot: ExpectedSnapshot = { line: 'GL', entities }

export const GL_EXPECTED: LineExpected = {
  line: 'GL',
  workbookIds: ['gl-framework', 'gl-forms', 'gl-rules', 'gl-pricing'],
  groundedInRepo: true,
  snapshot,
  ratingCanary: {
    line: 'GL',
    expectedPremium: 2635,
    run: () => evaluate(
      GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES),
    ).finalPremium,
  },
}
