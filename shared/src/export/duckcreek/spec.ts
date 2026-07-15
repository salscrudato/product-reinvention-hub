// Spec-pinned constants (XML_EXPORT_SPEC.md). Every value here is grounded in the
// committed corpus under docs/export-templates/ — nothing is invented at runtime.

/**
 * Per-LOB base-manuscript binding (spec §1.1 + §5 row 1). The PA binding is pinned
 * verbatim by the spec MUST ("the Hub overlay sets
 * inherited="Carrier_ProductBase_PersonalAuto_1_0_0_0" for the PA product") and by
 * the golden workbooks (CoverageConfig·Config!C3, TableConfig·Config!E2:E22).
 * Any LOB absent here has NO safe default — spec row 1: "no default — export
 * blocks". Tenant-specific base mapping memory is deliberately out of scope
 * (BACKLOG: HITL capture UI + override persistence + tenant mapping memory).
 */
export const LOB_BASE_MANUSCRIPTS: Readonly<Record<string, string>> = {
  'PA.LOB.001': 'Carrier_ProductBase_PersonalAuto_1_0_0_0',
}

/** Observed `MS Physical Path:` root (golden TableConfig, every table sheet row 4). */
export const MS_PHYSICAL_PATH_ROOT = 'C:\\DuckCreek\\Suite\\Policy\\ManuScripts\\DCTTemplates\\'

/** Engine flags copied verbatim from the observed base (spec §5 row 14, GUESSED). */
export const ENGINE_FLAGS = { boolean: '1', fieldCache: '1', shortCircuitCond: '1' } as const

/** Culture block, byte-identical to the Carrier base (spec §3.1). */
export const CULTURE = { cultureCode: 'en-US', cultureName: 'United States [english]' } as const

/** Express widget/version (spec §5 row 16, GUESSED as observed — CoverageConfig·Config!C8/C9). */
export const EXPRESS_CONFIG = { widget: 'Coverages', expressVersion: '2' } as const

/**
 * Abstract scaffold chain from the model root down to the coverage collection,
 * as observed in SP3 (lines 956-959, 1738-1739): model → data → Policy → Line →
 * LineCoverages (→ ManuScriptCoverage). These ids exist in the base chain
 * (BaseProduct.xml carries `data`:19 and `LineCoverages`:541); re-declaring them
 * abstract is legal scaffolding under lint clause 3.
 */
export const SCAFFOLD_CHAIN = ['data', 'Policy', 'Line', 'LineCoverages'] as const

/** Default `state` keyInfo when one overlay covers the whole footprint (spec §5 row 5). */
export const DEFAULT_STATE_KEY = 'US'

/** productCode for a model-layer overlay (presentation is Express-generated, spec §3.1). */
export const PRODUCT_CODE = 'Data'

/** Names of the spec §5 default rules, quoted where a value is DEFAULTED. */
export const RULES = {
  versionBlock:    'SPEC §5 row 2: version block defaults to 1_0_0_0 / export date',
  family:          'SPEC §5 row 3: family defaults to tenant name PascalCase (GUESSED)',
  effectiveDates:  'SPEC §5 row 4: effective dates default to the export date; workbook cells stay blank as observed (GUESSED)',
  statePolicy:     'SPEC §5 row 5: single overlay; state keyInfo defaults to US',
  formTemplates:   'SPEC §5 row 6: physical template defaults to <FormNumber>.doc with empty path (GUESSED)',
  mergeFields:     'SPEC §5 row 7: mergeField map defaults to the AccountName/PolicyNumber pair only (GUESSED)',
  taxBinding:      'SPEC §5 row 8: tax manuscript wiring omitted entirely — a DC-side task',
  handAuthoredPages: 'SPEC §5 row 9: no pages emitted; Express generates presentation (§3.7)',
  cultures:        'SPEC §5 row 11: multiLanguages absent — en-US, single currency (GUESSED)',
  baseRollup:      'SPEC §5 row 12: base roll-up behavior unknown — emit own roll-up (GUESSED)',
  classVocab:      'SPEC §5 row 13: class vocabularies never emitted',
  engineFlags:     'SPEC §5 row 14: engine flags copied from the observed base byte-for-byte (GUESSED)',
  dataSchema:      'SPEC §5 row 15: dataSchema defaults to "" as the base has (GUESSED)',
  expressWidget:   'SPEC §5 row 16: Express widget/version default Coverages / 2 as observed (GUESSED)',
  ruleFreeText:    'SPEC §5 row 17: free-text rules are never compiled — text rides annotations + HITL',
  formCondition:   'SPEC §3.8: free-text attachment condition — GUESSED stub returning 1',
  roundNearest:    'SPEC §3.5 + observed corpus: argument round="N" = round to nearest N (integers observed; fractional N inferred)',
  ratingInputBinding: 'SPEC §3.5: rating driver input has no CoverageConfig row — emitted as a net-new overlay input public; wire to the base risk field at DC integration',
} as const
