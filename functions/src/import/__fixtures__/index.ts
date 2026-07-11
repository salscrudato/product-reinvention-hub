// import/__fixtures__/index.ts — torture-test fixture matrix for structural validators.
//
// Each fixture is one named scenario. The naming scheme:
//   PATHOLOGY_DESCRIPTION  — a table or curve that exercises a specific validator failure path
//   PASSING_DESCRIPTION    — a well-formed table that all validators accept
//   UPLOAD_LINE            — UploadDoc fixtures for real-world line scenarios
//
// None of these call any AI; they are pure data for deterministic validator tests.

import type { UploadDoc } from '@pf/shared'

// ─── Numeric matrix fixtures ──────────────────────────────────────────────────

export interface TableFixture {
  name:       string
  headerRow:  unknown[]
  sampleRows: unknown[][]
  cells?:     number[][]     // the data matrix (row-major)
  rowTotals?: number[]
  colTotals?: number[]
  values?:    number[]       // for monotonicity tests
  labels?:    string[]       // for monotonicity tests
}

// ─── Pathological: merged header grid ─────────────────────────────────────────
// Simulates a 3-column ISO territory table where col 0 has the territory label
// and cols 1–2 are under a single merged "Factors" header. exceljs returns null
// for merged-continuation cells, so cols 1 and 2 appear headerless.

export const MERGED_HEADER_GRID: TableFixture = {
  name:      'MERGED_HEADER_GRID',
  headerRow: ['Territory', 'Factors', null],   // col 2 is null — merged artifact
  sampleRows: [
    ['1A',  1.000, 0.950],
    ['1B',  0.975, 0.925],
    ['2',   1.025, 0.975],
  ],
}

// ─── Pathological: transposed factor table ─────────────────────────────────────
// Carrier has pivoted the table: each ROW is a deductible amount, each COLUMN is
// a territory. Read straight, the territory codes (1, 2, 3) look like header factors.

export const TRANSPOSED_FACTOR_TABLE: TableFixture = {
  name:      'TRANSPOSED_FACTOR_TABLE',
  headerRow: [500, 1000, 2500, 5000, 10000],   // these are deductible amounts, not labels
  sampleRows: [
    ['Territory 1', 1.000, 0.970, 0.940, 0.910, 0.880],
    ['Territory 2', 1.030, 0.998, 0.966, 0.934, 0.902],
    ['Territory 3', 1.060, 1.025, 0.992, 0.960, 0.927],
  ],
}

// ─── Pathological: non-monotone factor curve ──────────────────────────────────
// An increased-limits factor table that drops and then rises — indicates a
// mis-mapped row or a hidden-sheet row inserted out of order.

export const NON_MONOTONE_FACTOR_CURVE: TableFixture = {
  name:   'NON_MONOTONE_FACTOR_CURVE',
  values: [1.000, 1.050, 1.100, 1.080, 1.200, 1.250],  // 1.080 < 1.100 — violation
  labels: ['$100K', '$200K', '$300K', '$400K', '$500K', '$1M'],
  headerRow:  ['Coverage Amount', 'ILF'],
  sampleRows: [
    ['$100K', 1.000],
    ['$200K', 1.050],
    ['$300K', 1.100],
    ['$400K', 1.080],   // out of order
    ['$500K', 1.200],
    ['$1M',   1.250],
  ],
}

// ─── Pathological: cross-foot error table ─────────────────────────────────────
// A 3×3 premium table where row 1 sum doesn't match its declared total.

export const CROSS_FOOT_ERROR_TABLE: TableFixture = {
  name:      'CROSS_FOOT_ERROR_TABLE',
  headerRow: ['Class', 'Cov A', 'Cov B', 'Cov C', 'Total'],
  sampleRows: [
    ['HO-3-1', 800, 120, 80,  1000],
    ['HO-3-2', 900, 130, 95,  1099],   // actual sum = 1125, declared = 1099
    ['HO-3-3', 750, 110, 75,   935],
  ],
  cells:     [[800, 120, 80], [900, 130, 95], [750, 110, 75]],
  rowTotals: [1000,          1099,            935],   // row 1 declared wrong
}

// ─── Passing: well-formed monotone factor curve ────────────────────────────────

export const PASSING_FACTOR_CURVE: TableFixture = {
  name:   'PASSING_FACTOR_CURVE',
  values: [1.000, 1.050, 1.100, 1.150, 1.200, 1.250],
  labels: ['$100K', '$200K', '$300K', '$400K', '$500K', '$1M'],
  headerRow:  ['Coverage Amount', 'ILF'],
  sampleRows: [
    ['$100K', 1.000],
    ['$200K', 1.050],
    ['$300K', 1.100],
    ['$400K', 1.150],
    ['$500K', 1.200],
    ['$1M',   1.250],
  ],
}

// ─── Passing: well-formed cross-foot table ─────────────────────────────────────

export const PASSING_CROSS_FOOT_TABLE: TableFixture = {
  name:      'PASSING_CROSS_FOOT_TABLE',
  headerRow: ['Class', 'Cov A', 'Cov B', 'Cov C', 'Total'],
  sampleRows: [
    ['HO-3-1', 800, 120, 80,  1000],
    ['HO-3-2', 900, 130, 95,  1125],
    ['HO-3-3', 750, 110, 75,   935],
  ],
  cells:     [[800, 120, 80], [900, 130, 95], [750, 110, 75]],
  rowTotals: [1000, 1125, 935],
}

// ─── UploadDoc fixtures (per line family) ─────────────────────────────────────
// These simulate the `UploadDoc` objects the real pipeline receives from the client.
// Sheet names are extracted client-side; base64 and text can be absent for unit tests.

export const HO_WORKBOOK: UploadDoc = {
  name:       'HO_Rate_Manual_2025.xlsx',
  sheetNames: ['Framework', 'HO-3 Rates', 'HO-5 Rates', 'HO-4 Rates', 'Territory Table',
               'ILF Table', 'Deductible Table', 'Age of Home', 'Construction Type'],
}

export const HO_MULTI_FORM_WORKBOOK: UploadDoc = {
  name:       'Homeowners_All_Forms_Q12025.xlsx',
  sheetNames: ['HO-2', 'HO-3', 'HO-4', 'HO-5', 'HO-6', 'HO-8', 'Common Tables'],
}

export const PA_WORKBOOK: UploadDoc = {
  name:       'PA_PP0001_Rate_Manual.xlsx',
  sheetNames: ['Framework', 'Liability Rates', 'PIP Rates', 'Comp Rates',
               'Coll Rates', 'Territory', 'Symbol Table', 'Driver Class'],
}

export const DP_WORKBOOK: UploadDoc = {
  name:       'Dwelling_Fire_DP123_Manual.xlsx',
  sheetNames: ['DP-1 Rates', 'DP-2 Rates', 'DP-3 Rates', 'Deductible', 'Territory'],
}

export const GL_WORKBOOK: UploadDoc = {
  name:       'CGL_CG0001_Rate_Manual_2025.xlsx',
  sheetNames: ['Framework', 'Premises Ops Rates', 'Products CO Rates',
               'Class Codes', 'Territory', 'ILF Schedule', 'Experience Mod'],
}

export const GL_CM_WORKBOOK: UploadDoc = {
  name:       'CGL_CG0002_Claims_Made_2025.xlsx',
  sheetNames: ['CM Base Rates', 'Step Factors', 'Retroactive Date Table',
               'Class Codes', 'Territory'],
}

export const CP_WORKBOOK: UploadDoc = {
  name:       'Commercial_Property_CP0010.xlsx',
  sheetNames: ['Framework', 'Building Rates', 'Contents Rates', 'BIM Rates',
               'Causes of Loss', 'Territory', 'Protection Class', 'Construction'],
}

export const BOP_WORKBOOK: UploadDoc = {
  name:       'BOP_BP0003_Rate_Manual.xlsx',
  sheetNames: ['Property Rates', 'Liability Rates', 'Territory', 'Class Codes',
               'Package Mod', 'ILF'],
}

export const WC_WORKBOOK: UploadDoc = {
  name:       'WorkersComp_NCCI_2025.xlsx',
  sheetNames: ['Loss Costs', 'ELR Table', 'D Ratio', 'Class Codes',
               'Experience Mod', 'Schedule Rating', 'Premium Discount'],
}

export const CA_WORKBOOK: UploadDoc = {
  name:       'Commercial_Auto_CA0001.xlsx',
  sheetNames: ['Liability Rates', 'Physical Damage', 'Symbol Table',
               'Vehicle Classification', 'Fleet Credit Table', 'Territory'],
}

export const UMBRELLA_WORKBOOK: UploadDoc = {
  name:       'Personal_Umbrella_2025.xlsx',
  sheetNames: ['Base Rate Table', 'Underlying Coverage Requirements',
               'Household Member Schedule', 'Residence Type Factor'],
}

export const INLAND_MARINE_WORKBOOK: UploadDoc = {
  name:       'Inland_Marine_Scheduled_2025.xlsx',
  sheetNames: ['Jewelry Rates', 'Fine Arts Rates', 'Cameras Rates',
               'Musical Instruments', 'Sports Equipment', 'Blanket Rates'],
}

export const FLOOD_WORKBOOK: UploadDoc = {
  name:       'Private_Flood_RiskRating2_2025.xlsx',
  sheetNames: ['Building Rates', 'Contents Rates', 'Elevation Certificate Factors',
               'Territory', 'Flood Zone', 'Mitigation Credit'],
}

export const CYBER_WORKBOOK: UploadDoc = {
  name:       'Cyber_EPL_DO_2025.xlsx',
  sheetNames: ['Cyber Rates', 'EPL Rates', 'DO Rates', 'Revenue Bands',
               'Industry Class', 'Retention Schedule', 'Step Factors'],
}

export const CPP_WORKBOOK: UploadDoc = {
  name:       'Commercial_Package_CPP_2025.xlsx',
  sheetNames: ['Property Part', 'GL Part', 'Auto Part',
               'Package Mod', 'Common Territory', 'Class Index'],
}

// ─── Merged-header pathology with real-world column layout ────────────────────
// Simulates an HO-3 territory table where "Building" and "Contents" factors
// share a merged header "Rate Factors". exceljs yields null for the 3rd column.

export const HO3_MERGED_TERRITORY_FIXTURE: UploadDoc = {
  name: 'HO3_Territory_MergedHeaders.xlsx',
  text: [
    'Territory\tRate Factors\t',   // header row; col 2 is blank (merged artifact)
    '1A\t1.000\t0.950',
    '1B\t0.975\t0.925',
    '2\t1.025\t0.975',
    '3\t1.075\t1.025',
  ].join('\n'),
  sheetNames: ['Territory'],
}

// ─── Transposed pathology: per-state tab workbook ─────────────────────────────
// Simulates a PA manual where each state is a separate sheet and the factor
// table within each sheet has rows as deductible breakpoints, columns as territory.

export const PA_PER_STATE_TRANSPOSED: UploadDoc = {
  name: 'PA_PerState_TransposedFactors.xlsx',
  text: [
    '500\t1000\t2500\t5000',   // deductible amounts look like header "factors"
    'Territory 1\t1.000\t0.970\t0.940',
    'Territory 2\t1.030\t0.998\t0.966',
  ].join('\n'),
  sheetNames: ['AL', 'AZ', 'FL', 'GA', 'TX', 'VA'],
}

// ─── All fixtures as a named map for easy lookup ──────────────────────────────

export const FIXTURE_MATRIX: Record<string, TableFixture> = {
  MERGED_HEADER_GRID,
  TRANSPOSED_FACTOR_TABLE,
  NON_MONOTONE_FACTOR_CURVE,
  CROSS_FOOT_ERROR_TABLE,
  PASSING_FACTOR_CURVE,
  PASSING_CROSS_FOOT_TABLE,
}

export const UPLOAD_FIXTURES: Record<string, UploadDoc> = {
  HO_WORKBOOK,
  HO_MULTI_FORM_WORKBOOK,
  PA_WORKBOOK,
  DP_WORKBOOK,
  GL_WORKBOOK,
  GL_CM_WORKBOOK,
  CP_WORKBOOK,
  BOP_WORKBOOK,
  WC_WORKBOOK,
  CA_WORKBOOK,
  UMBRELLA_WORKBOOK,
  INLAND_MARINE_WORKBOOK,
  FLOOD_WORKBOOK,
  CYBER_WORKBOOK,
  CPP_WORKBOOK,
  HO3_MERGED_TERRITORY_FIXTURE,
  PA_PER_STATE_TRANSPOSED,
}
