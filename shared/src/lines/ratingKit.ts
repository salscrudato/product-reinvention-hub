// lines/ratingKit.ts — the generic ratingKitGenerator that converts any LineArchetype
// into a working RatingKit without line-specific code. Uses genericRtLookup + makeLdGetter
// so the getters work for ANY line whose RT tables carry explicit `dimensions` metadata.
//
// DATA-FIRST CLAIM: a new line needs only a LineArchetype (data) + ArchetypeFixture (data)
// to produce a verified canary. No new code is required in kits.ts or anywhere else, UNLESS
// the line's RT-table lookup is non-simple (e.g. GL's PCO step computes pcoRate ×
// pcoExposureThousands rather than a plain table lookup — that still needs a bespoke getter).
//
// Pure TypeScript; zero platform imports.
import type { RTTable, LDTable, RatingInputMap, RatingInputField, RatingProgram } from '../types'
import type { RtGetter, LdGetter } from '../rating/evaluator'
import { genericRtLookup } from '../rating/rtGrid'
import { makeLdGetter } from '../rating/ldGetter'
import type { LineArchetype, ExposureBase, RatingStageArchetype } from './types'

// ─── ArchetypeFixture ─────────────────────────────────────────────────────────

// A minimal but realistic fixture sufficient to auto-derive a per-line canary.
// Each golden file exports one of these alongside its LineArchetype.
export interface ArchetypeFixture {
  rt:             Record<string, RTTable>   // RT tables used by the fixture's program
  ld:             Record<string, LDTable>   // LD tables used by the fixture's program
  program:        RatingProgram             // the rating program (governance-minimal)
  workedExample:  RatingInputMap            // inputs that reproduce expectedPremium
  expectedPremium: number                   // the canary value this fixture locks
}

// ─── ArchetypeRatingKit ───────────────────────────────────────────────────────

// Extends RatingKit with a required inputSpec (generic derivation always produces one)
// and the archetype that produced it.
export interface ArchetypeRatingKit {
  makeRtGetter:  (tables: Record<string, RTTable>) => RtGetter
  makeLdGetter:  (tables: Record<string, LDTable>) => LdGetter
  workedExample: RatingInputMap
  inputSpec:     RatingInputField[]
  archetype:     LineArchetype
}

// ─── Generic RT getter ────────────────────────────────────────────────────────

// Works for any table that declares `dimensions` metadata (the grid-managed format).
// Throws on missing table or failed lookup so programming errors are loud in tests.
// Tables that lack `dimensions` would return null from genericRtLookup → this getter
// throws — callers MUST supply fully-dimensioned tables for the generic path.
function makeGenericRtGetter(tables: Record<string, RTTable>): RtGetter {
  return (tableRef: string, queryInputs: Record<string, unknown>): number => {
    const t = tables[tableRef]
    if (!t) throw new Error(`RT table not found: ${tableRef}`)
    const v = genericRtLookup(t, queryInputs)
    if (v === null) throw new Error(`${tableRef}: no match for ${JSON.stringify(queryInputs)} (table must declare dimensions)`)
    return v
  }
}

// ─── Input spec derivation ────────────────────────────────────────────────────

// Maps ExposureBase → a minimal RatingInputField.  Callers may augment or replace
// these fields in the fixture's own workedExample; the spec drives the data-driven
// DynamicRatingForm for any registered archetype line.
function exposureBaseToField(base: ExposureBase): RatingInputField {
  switch (base) {
    case 'COVERAGE_A_AMOUNT':     return { key: 'coverageA_per100',    label: 'Coverage A (÷$100)',       kind: 'number', min: 0 }
    case 'PAYROLL_PER_100':       return { key: 'payroll_per100',       label: 'Payroll (÷$100)',          kind: 'number', min: 0 }
    case 'GROSS_SALES_PER_1000':  return { key: 'grossSales_per1000',   label: 'Gross Sales (÷$1,000)',    kind: 'number', min: 0 }
    case 'PER_VEHICLE':           return { key: 'numVehicles',          label: 'Number of Vehicles',       kind: 'number', min: 1 }
    case 'PER_UNIT':              return { key: 'numUnits',             label: 'Number of Units',          kind: 'number', min: 1 }
    case 'AREA':                  return { key: 'areaSqFt',             label: 'Area (sq ft)',             kind: 'number', min: 0 }
    case 'REVENUE':               return { key: 'revenueBand',          label: 'Revenue Band',             kind: 'text' }
    case 'PER_LOCATION':          return { key: 'numLocations',         label: 'Number of Locations',      kind: 'number', min: 1 }
    case 'REPLACEMENT_COST_VALUE': return { key: 'tiv_per100',          label: 'Total Insured Value (÷$100)', kind: 'number', min: 0 }
    case 'FLAT':                  return { key: 'flatPremium',          label: 'Flat Premium',             kind: 'number', min: 0 }
  }
}

// ─── Rating stage lowering map (documentation + verification) ─────────────────

// Authoritative table proving every RatingStageArchetype lowers to existing ops
// and sources. This is the machine-readable version of the comment block in types.ts.
export const RATING_STAGE_LOWERING: Record<
  RatingStageArchetype,
  { description: string; ops: Array<{ op: 'SET'|'MUL'|'ADD'|'MIN_FLOOR'; source: 'RT'|'LD'|'INPUT'|'CONST'|'SPP' }> }
> = {
  LOSS_COST_TIMES_LCM: {
    description: 'ISO base loss cost per $100 (territory RT table) × carrier loss cost multiplier (CONST scalar) → manual rate base premium.',
    ops: [{ op: 'SET', source: 'RT' }, { op: 'MUL', source: 'CONST' }],
  },
  BASE_RATE_RELATIVITY_CHAIN: {
    description: 'SET base rate from a class/territory RT table, then MUL a chain of relativity RT tables (construction, age, tier, …).',
    ops: [{ op: 'SET', source: 'RT' }, { op: 'MUL', source: 'RT' }, { op: 'MUL', source: 'RT' }],
  },
  KEY_FACTOR_CURVE: {
    description: 'MUL the key-factor curve RT table keyed by coverage-A amount band. Converts base loss cost × exposure to a keyed premium.',
    ops: [{ op: 'MUL', source: 'RT' }],
  },
  ILF_STEP: {
    description: 'MUL the increased-limits factor RT table keyed by per-occurrence or per-claim limit. Converts base-limit premium to requested limit.',
    ops: [{ op: 'MUL', source: 'RT' }],
  },
  EXPERIENCE_MOD: {
    description: 'MUL the experience modification factor (e-mod). Source is RT (keyed by e-mod string) or INPUT (direct numeric e-mod).',
    ops: [{ op: 'MUL', source: 'RT' }],
  },
  SCHEDULE_RATING_CAPPED: {
    description: 'MUL a discretionary schedule credit/debit factor from an RT table (typically capped at ±15% per NCCI; ±25% for ISO GL).',
    ops: [{ op: 'MUL', source: 'RT' }],
  },
  PREMIUM_CAPPING: {
    description: 'MUL the renewal premium cap factor (CONST or RT) gated by a condition on whether the prior-year premium triggers the cap.',
    ops: [{ op: 'MUL', source: 'CONST' }],
  },
  MINIMUM_PREMIUM_FLOOR: {
    description: 'MIN_FLOOR the minimum premium CONST. Always the final step; running total ≥ the filed minimum.',
    ops: [{ op: 'MIN_FLOOR', source: 'CONST' }],
  },
  ADDITIVE_SCHEDULED_PREMIUMS: {
    description: 'ADD flat scheduled premiums: optional coverages (equipment breakdown, water backup) or SPP items rated per $100.',
    ops: [{ op: 'ADD', source: 'INPUT' }, { op: 'ADD', source: 'RT' }],
  },
  CLAIMS_MADE_STEP_FACTOR: {
    description: 'MUL the claims-made maturity step factor RT table keyed by policy year (1–5+). Ramps from ~38–60% in year 1 to 100% at maturity.',
    ops: [{ op: 'MUL', source: 'RT' }],
  },
  PACKAGE_MODIFICATION: {
    description: 'MUL a package discount/surcharge factor (RT or CONST). Applied after all coverage-part premiums are assembled.',
    ops: [{ op: 'MUL', source: 'RT' }],
  },
}

// ─── ratingKitGenerator ───────────────────────────────────────────────────────

/**
 * Convert a LineArchetype into a working ArchetypeRatingKit.
 *
 * The returned kit uses genericRtLookup + makeLdGetter for ALL table access —
 * no line-specific code. This is sufficient for any line whose RT tables carry
 * explicit `dimensions` metadata (the grid-managed format used by all fixture files).
 *
 * Limits: when a rating step combines multiple table lookups or an input value
 * within a single step (e.g. GL's PCO step: pcoRate × pcoExposureThousands), the
 * generic getter cannot express it and a bespoke makeRtGetter override is needed.
 * That is the ONE remaining place a new line requires a code change.
 */
export function ratingKitGenerator(archetype: LineArchetype): ArchetypeRatingKit {
  const inputSpec = archetype.exposureBases.map(exposureBaseToField)

  return {
    makeRtGetter: makeGenericRtGetter,
    makeLdGetter: makeLdGetter,
    workedExample: {},    // skeleton; fixture's workedExample is the actual canary input
    inputSpec,
    archetype,
  }
}

// ─── Governance helper for fixtures ──────────────────────────────────────────

// Minimal governance block for fixture RatingProgram objects.  These are pure
// data fixtures — governance metadata is not load-bearing for rating.
export function fixtureGov(): {
  status: 'ACTIVE'; lifecycle: 'LAUNCHED'; reviewStatus: 'APPROVED'
  reviewer: string; createdAt: null; updatedAt: null; updatedBy: string; rev: number
} {
  return {
    status: 'ACTIVE', lifecycle: 'LAUNCHED', reviewStatus: 'APPROVED',
    reviewer: 'seed', createdAt: null, updatedAt: null, updatedBy: 'seed', rev: 1,
  }
}
