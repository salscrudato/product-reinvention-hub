// registry/stateFilingMatrix.ts — State filing-type matrix for rate and form filings.
//
// Texas is fully populated (file-and-use under Insurance Code Chapter 2251) and serves
// as the reference implementation for the SERFF bundle assembler. All other states are
// stubbed with their filing type so the matrix is queryable today and can be enriched
// incrementally as each state's rules are confirmed.
//
// Illinois note: SB714/HB4273 (effective July 1, 2027) may alter the IL filing regime;
// the stub is annotated accordingly. Check the DOI bulletin when legislating nearer to
// that date.
//
// Source: NAIC regulatory resource map + state DOI websites (accessed 2026-07).
// Pure TypeScript; zero platform imports.

/** How a state treats rate/form filings relative to approval timing. */
export type FilingType =
  | 'prior-approval'       // rates must be approved before use
  | 'file-and-use'         // file, then use immediately; DOI may disapprove later
  | 'use-and-file'         // use first, file within N days
  | 'no-file'              // no filing required
  | 'competitive'          // competitive rating; prior approval for non-competitive classes

/** What SERFF tabs are expected for a state. */
export interface SerffTabRequirements {
  /** Supporting Documentation tab includes marked (redline) copies. */
  requiresMarkedCopies: boolean
  /** Supporting Documentation tab includes an actuarial memorandum. */
  requiresActuarialMemo: boolean
  /** Supporting Documentation tab includes a rate relativity analysis. */
  requiresRelativities: boolean
  /** Form Schedule includes filed (clean) copies of every changed form. */
  requiresCleanForms: boolean
  /** Rate/Rule Schedule includes before-and-after rate exhibits. */
  requiresRateExhibits: boolean
}

/** One state's filing profile. `source` cites the authoritative reference. */
export interface StateFilingProfile {
  stateCode:     string
  stateName:     string
  filingType:    FilingType
  /** SERFF-enabled for this state (all 50 states + DC now use SERFF). */
  serffEnabled:  boolean
  /** Authoritative statute / regulation reference. */
  source:        string
  /** Human-readable note, e.g. pending legislation or special conditions. */
  note?:         string
  /** Effective-date constraint expressed in plain language. */
  effectiveDateConstraint?: string
  /** Populated only when filingType requires detailed SERFF tab guidance. */
  serffTabs?:    SerffTabRequirements
  /** IL SB714/HB4273 effective date (ISO date) when pending legislation applies. */
  pendingLegislationEffective?: string
}

// ─── Texas — fully populated ──────────────────────────────────────────────────
//
// Texas Insurance Code Chapter 2251 (File-and-Use).
// §2251.101: insurer files rate and rule changes; use is permitted immediately on filing.
// §2251.102: the commissioner may disapprove within 30 days.
// 28 Tex. Admin. Code §5.9327: marked copies of changed forms required.
// 28 Tex. Admin. Code §5.9334: filing memorandum with overall rate impact required.
// 28 Tex. Admin. Code §5.9334(d): rate indication and relativity analysis required
//   when rate level changes exceed de minimis thresholds.
// SERFF: required for all filings in Texas (SERFF Filings Made Easy guide, TDI edition).

export const TEXAS_FILING_PROFILE: StateFilingProfile = {
  stateCode:  'TX',
  stateName:  'Texas',
  filingType: 'file-and-use',
  serffEnabled: true,
  source:     'Texas Insurance Code §2251.101; 28 Tex. Admin. Code §§5.9327, 5.9334',
  note:       'File-and-use under Chapter 2251. Rates become effective upon filing. Commissioner may disapprove within 30 days under §2251.102. Supporting Documentation tab must include marked copies and filing memorandum per 28 TAC §5.9334.',
  effectiveDateConstraint: 'Rates may be used immediately upon filing. The filing must be received by TDI before the effective date of the change.',
  serffTabs: {
    requiresMarkedCopies:   true,   // 28 TAC §5.9327
    requiresActuarialMemo:  false,  // not required for non-commercial lines unless requested
    requiresRelativities:   true,   // 28 TAC §5.9334(d) — rate indication and relativity analysis
    requiresCleanForms:     true,   // SERFF Form Schedule tab
    requiresRateExhibits:   true,   // 28 TAC §5.9334(d) — before-and-after exhibits
  },
}

// ─── Stub states — filing type recorded; details TBD ─────────────────────────

const STUB_TABS: SerffTabRequirements = {
  requiresMarkedCopies:   true,
  requiresActuarialMemo:  false,
  requiresRelativities:   false,
  requiresCleanForms:     true,
  requiresRateExhibits:   false,
}

/** All 50 states + DC. Texas is fully populated; all others are stubs. */
export const STATE_FILING_MATRIX: Record<string, StateFilingProfile> = {
  TX: TEXAS_FILING_PROFILE,

  // ── Prior-approval states ────────────────────────────────────────────────
  AL: { stateCode: 'AL', stateName: 'Alabama',              filingType: 'prior-approval', serffEnabled: true, source: 'Ala. Code §27-13-1 et seq.',       serffTabs: STUB_TABS },
  AK: { stateCode: 'AK', stateName: 'Alaska',               filingType: 'prior-approval', serffEnabled: true, source: 'AS §21.39.080',                    serffTabs: STUB_TABS },
  DC: { stateCode: 'DC', stateName: 'District of Columbia', filingType: 'prior-approval', serffEnabled: true, source: 'D.C. Code §31-2703',               serffTabs: STUB_TABS },
  FL: { stateCode: 'FL', stateName: 'Florida',              filingType: 'prior-approval', serffEnabled: true, source: 'Fla. Stat. §627.062',              note: 'Prior approval; OIR review within 90 days.', serffTabs: STUB_TABS },
  GA: { stateCode: 'GA', stateName: 'Georgia',              filingType: 'file-and-use',   serffEnabled: true, source: 'O.C.G.A. §33-9-21',               serffTabs: STUB_TABS },
  HI: { stateCode: 'HI', stateName: 'Hawaii',               filingType: 'prior-approval', serffEnabled: true, source: 'Haw. Rev. Stat. §431:14-104',      serffTabs: STUB_TABS },
  ID: { stateCode: 'ID', stateName: 'Idaho',                filingType: 'file-and-use',   serffEnabled: true, source: 'Idaho Code §41-1408',              serffTabs: STUB_TABS },
  IL: { stateCode: 'IL', stateName: 'Illinois',             filingType: 'prior-approval', serffEnabled: true, source: '215 ILCS 5/155.04',
    note:                       'Prior approval. SB714/HB4273 may alter the regime effective July 1, 2027 — verify with Illinois DOI before that date.',
    pendingLegislationEffective: '2027-07-01',
    serffTabs: STUB_TABS },
  IN: { stateCode: 'IN', stateName: 'Indiana',              filingType: 'file-and-use',   serffEnabled: true, source: 'Ind. Code §27-1-22-2',             serffTabs: STUB_TABS },
  IA: { stateCode: 'IA', stateName: 'Iowa',                 filingType: 'file-and-use',   serffEnabled: true, source: 'Iowa Code §515.72',                serffTabs: STUB_TABS },
  KS: { stateCode: 'KS', stateName: 'Kansas',               filingType: 'file-and-use',   serffEnabled: true, source: 'Kan. Stat. §40-955',               serffTabs: STUB_TABS },
  KY: { stateCode: 'KY', stateName: 'Kentucky',             filingType: 'file-and-use',   serffEnabled: true, source: 'Ky. Rev. Stat. §304.13-051',       serffTabs: STUB_TABS },
  LA: { stateCode: 'LA', stateName: 'Louisiana',            filingType: 'prior-approval', serffEnabled: true, source: 'La. R.S. §22:1452',                serffTabs: STUB_TABS },
  ME: { stateCode: 'ME', stateName: 'Maine',                filingType: 'file-and-use',   serffEnabled: true, source: 'Me. Rev. Stat. tit. 24-A §2303',   serffTabs: STUB_TABS },
  MD: { stateCode: 'MD', stateName: 'Maryland',             filingType: 'prior-approval', serffEnabled: true, source: 'Md. Code Ins. §11-307',            serffTabs: STUB_TABS },
  MA: { stateCode: 'MA', stateName: 'Massachusetts',        filingType: 'prior-approval', serffEnabled: true, source: 'Mass. Gen. Laws ch. 175A §4',      serffTabs: STUB_TABS },
  MI: { stateCode: 'MI', stateName: 'Michigan',             filingType: 'prior-approval', serffEnabled: true, source: 'Mich. Comp. Laws §500.2111',       serffTabs: STUB_TABS },
  MN: { stateCode: 'MN', stateName: 'Minnesota',            filingType: 'file-and-use',   serffEnabled: true, source: 'Minn. Stat. §70A.04',              serffTabs: STUB_TABS },
  MS: { stateCode: 'MS', stateName: 'Mississippi',          filingType: 'file-and-use',   serffEnabled: true, source: 'Miss. Code §83-2-5',               serffTabs: STUB_TABS },
  MO: { stateCode: 'MO', stateName: 'Missouri',             filingType: 'file-and-use',   serffEnabled: true, source: 'Mo. Rev. Stat. §379.318',          serffTabs: STUB_TABS },
  MT: { stateCode: 'MT', stateName: 'Montana',              filingType: 'prior-approval', serffEnabled: true, source: 'Mont. Code §33-16-107',            serffTabs: STUB_TABS },
  NE: { stateCode: 'NE', stateName: 'Nebraska',             filingType: 'file-and-use',   serffEnabled: true, source: 'Neb. Rev. Stat. §44-7501',         serffTabs: STUB_TABS },
  NV: { stateCode: 'NV', stateName: 'Nevada',               filingType: 'prior-approval', serffEnabled: true, source: 'Nev. Rev. Stat. §681B.090',        serffTabs: STUB_TABS },
  NH: { stateCode: 'NH', stateName: 'New Hampshire',        filingType: 'file-and-use',   serffEnabled: true, source: 'N.H. Rev. Stat. §412:15',          serffTabs: STUB_TABS },
  NJ: { stateCode: 'NJ', stateName: 'New Jersey',           filingType: 'prior-approval', serffEnabled: true, source: 'N.J. Stat. §17:29A-6',             serffTabs: STUB_TABS },
  NM: { stateCode: 'NM', stateName: 'New Mexico',           filingType: 'file-and-use',   serffEnabled: true, source: 'N.M. Stat. §59A-17-9',             serffTabs: STUB_TABS },
  NY: { stateCode: 'NY', stateName: 'New York',             filingType: 'prior-approval', serffEnabled: true, source: 'N.Y. Ins. Law §2305',              serffTabs: STUB_TABS },
  NC: { stateCode: 'NC', stateName: 'North Carolina',       filingType: 'prior-approval', serffEnabled: true, source: 'N.C. Gen. Stat. §58-40-10',        serffTabs: STUB_TABS },
  ND: { stateCode: 'ND', stateName: 'North Dakota',         filingType: 'file-and-use',   serffEnabled: true, source: 'N.D. Cent. Code §26.1-25-08',      serffTabs: STUB_TABS },
  OH: { stateCode: 'OH', stateName: 'Ohio',                 filingType: 'file-and-use',   serffEnabled: true, source: 'Ohio Rev. Code §3937.01',          serffTabs: STUB_TABS },
  OK: { stateCode: 'OK', stateName: 'Oklahoma',             filingType: 'prior-approval', serffEnabled: true, source: 'Okla. Stat. tit. 36 §921',         serffTabs: STUB_TABS },
  OR: { stateCode: 'OR', stateName: 'Oregon',               filingType: 'file-and-use',   serffEnabled: true, source: 'Or. Rev. Stat. §737.310',          serffTabs: STUB_TABS },
  PA: { stateCode: 'PA', stateName: 'Pennsylvania',         filingType: 'file-and-use',   serffEnabled: true, source: '40 Pa. Stat. §1008.31',            serffTabs: STUB_TABS },
  RI: { stateCode: 'RI', stateName: 'Rhode Island',         filingType: 'prior-approval', serffEnabled: true, source: 'R.I. Gen. Laws §27-9-21',          serffTabs: STUB_TABS },
  SC: { stateCode: 'SC', stateName: 'South Carolina',       filingType: 'prior-approval', serffEnabled: true, source: 'S.C. Code §38-73-10',              serffTabs: STUB_TABS },
  SD: { stateCode: 'SD', stateName: 'South Dakota',         filingType: 'file-and-use',   serffEnabled: true, source: 'S.D. Codified Laws §58-17-12',     serffTabs: STUB_TABS },
  TN: { stateCode: 'TN', stateName: 'Tennessee',            filingType: 'file-and-use',   serffEnabled: true, source: 'Tenn. Code §56-5-106',             serffTabs: STUB_TABS },
  UT: { stateCode: 'UT', stateName: 'Utah',                 filingType: 'file-and-use',   serffEnabled: true, source: 'Utah Code §31A-19a-204',           serffTabs: STUB_TABS },
  VT: { stateCode: 'VT', stateName: 'Vermont',              filingType: 'prior-approval', serffEnabled: true, source: '8 V.S.A. §4684',                   serffTabs: STUB_TABS },
  VA: { stateCode: 'VA', stateName: 'Virginia',             filingType: 'file-and-use',   serffEnabled: true, source: 'Va. Code §38.2-1916',              serffTabs: STUB_TABS },
  WA: { stateCode: 'WA', stateName: 'Washington',           filingType: 'prior-approval', serffEnabled: true, source: 'Wash. Rev. Code §48.18.100',        serffTabs: STUB_TABS },
  WV: { stateCode: 'WV', stateName: 'West Virginia',        filingType: 'prior-approval', serffEnabled: true, source: 'W. Va. Code §33-20-3',             serffTabs: STUB_TABS },
  WI: { stateCode: 'WI', stateName: 'Wisconsin',            filingType: 'file-and-use',   serffEnabled: true, source: 'Wis. Stat. §625.11',               serffTabs: STUB_TABS },
  WY: { stateCode: 'WY', stateName: 'Wyoming',              filingType: 'file-and-use',   serffEnabled: true, source: 'Wyo. Stat. §26-6-102',             serffTabs: STUB_TABS },
  AR: { stateCode: 'AR', stateName: 'Arkansas',             filingType: 'file-and-use',   serffEnabled: true, source: 'Ark. Code §23-67-217',             serffTabs: STUB_TABS },
  AZ: { stateCode: 'AZ', stateName: 'Arizona',              filingType: 'file-and-use',   serffEnabled: true, source: 'Ariz. Rev. Stat. §20-386',         serffTabs: STUB_TABS },
  CA: { stateCode: 'CA', stateName: 'California',           filingType: 'prior-approval', serffEnabled: true, source: 'Cal. Ins. Code §1861.01 (Prop 103)',note: 'Prior approval under Prop 103; CDI review required.', serffTabs: STUB_TABS },
  CO: { stateCode: 'CO', stateName: 'Colorado',             filingType: 'file-and-use',   serffEnabled: true, source: 'Colo. Rev. Stat. §10-4-403',       serffTabs: STUB_TABS },
  CT: { stateCode: 'CT', stateName: 'Connecticut',          filingType: 'file-and-use',   serffEnabled: true, source: 'Conn. Gen. Stat. §38a-688',        serffTabs: STUB_TABS },
  DE: { stateCode: 'DE', stateName: 'Delaware',             filingType: 'file-and-use',   serffEnabled: true, source: 'Del. Code tit. 18 §2504',          serffTabs: STUB_TABS },
}

/** Look up a state's filing profile by 2-letter code. Returns null when the state
 *  code is not in the matrix (should not happen with any US state or DC). */
export function getStateProfile(stateCode: string): StateFilingProfile | null {
  return STATE_FILING_MATRIX[stateCode.toUpperCase()] ?? null
}

/** Returns true when the state requires marked copies in its filing. */
export function requiresMarkedCopies(stateCode: string): boolean {
  return getStateProfile(stateCode)?.serffTabs?.requiresMarkedCopies ?? true
}

/** Returns true when the state requires before/after rate exhibits. */
export function requiresRateExhibits(stateCode: string): boolean {
  return getStateProfile(stateCode)?.serffTabs?.requiresRateExhibits ?? false
}
