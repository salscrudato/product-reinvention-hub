// canonicalMap.ts — the canonical field dictionary for the format-agnostic importer.
//
// This is GROUNDING DATA for the model-driven mapping pipeline, NOT a hard string
// matcher. Real source workbooks describe the same concept with different words, shapes,
// and packaging: a coverage's traceability id is "PRODUCT FRAMEWORK ID" in an ISO GL
// book but just "ID" in a Property "Component Model"; a sub-coverage column is
// "SUB-COVERAGE" / "SUB COVERAGE" / "SUB- COVERAGE"; the source flag is "BUREAU" here and
// "RATING BUREAU" there. Some columns are genuinely AMBIGUOUS across sources — "COVERAGE
// FORM(S)" holds form TITLES in ISO GL but form NUMBERS in some IM/PR books — so no header
// string can be trusted as logic; the model must disambiguate by cell CONTENT. This map
// gives the model (a) the canonical target schema, (b) every field's type/enum + ≥2 real
// example values, and (c) the set of header aliases actually observed in shipped workbooks.
//
// For each canonical entity (product; coverage with parentId; form + dynamicField;
// ratingProgram + ratingStep; rtTable; ldTable; rule; formRule) EVERY field is recorded
// with: canonical name, role, type/enum, a one-line description, ≥2 examples, and the
// KNOWN SOURCE ALIASES. Aliases below are grounded in the shipped ISO GL workbooks
// (samples/iso/sample-GL-*.xlsx) and the observed component-model Inland Marine / Property ROC /
// Property RF variance. Zero platform imports.

// ─── Shapes ──────────────────────────────────────────────────────────────────────

export type CanonicalEntityKind =
  | 'product' | 'coverage' | 'form' | 'dynamicField'
  | 'ratingProgram' | 'ratingStep' | 'rtTable' | 'ldTable'
  | 'rule' | 'formRule'

/** How a canonical field relates to the source cells:
 *  - stored:  a persisted field on the entity, usually read from a single column.
 *  - source:  a source-only column that FEEDS a stored field (records `mapsTo`).
 *  - derived: computed by the mapper from other cells/structure (parentId, order, steps).
 *  - system:  stamped by the write seam / AI, never taken from the source (owner, timestamps). */
export type CanonicalFieldRole = 'stored' | 'source' | 'derived' | 'system'

export interface CanonicalFieldDef {
  field:       string
  role:        CanonicalFieldRole
  type:        string                    // TS / enum descriptor
  description: string
  examples:    readonly unknown[]        // ≥2 real example values (scalars or arrays)
  aliases:     readonly string[]         // observed source header/value aliases
  enumValues?: readonly string[]         // closed enum, when applicable
  mapsTo?:     string                    // role 'source': the stored field it resolves onto
  ambiguous?:  boolean                   // header collides across sources; disambiguate by content
}

export interface CanonicalEntityDef {
  entity:      CanonicalEntityKind
  description: string
  /** The persisted identity field, when the entity has one. The id SHAPE is line-specific
   *  and owned by the LOB registry's RefIdScheme — never hard-coded per format. */
  idField?:    string
  fields:      readonly CanonicalFieldDef[]
}

// ─── Reusable field fragments ──────────────────────────────────────────────────────

// Governance enums (present on product/coverage/form/rule/formRule). Source workbooks
// carry Status + a "Review Status" whose column name varies by author team; Lifecycle is
// set to DRAFT by the importer (sources don't express it).
const STATUS_FIELD: CanonicalFieldDef = {
  field: 'status', role: 'stored', type: "'ACTIVE' | 'INACTIVE' | 'FUTURE'",
  enumValues: ['ACTIVE', 'INACTIVE', 'FUTURE'],
  description: 'Governance status; source values normalise to the canonical enum.',
  examples: ['Active', 'Inactive - No Longer in Use', 'Future'],
  aliases: ['STATUS', 'PRODUCT STATUS'],
}
const LIFECYCLE_FIELD: CanonicalFieldDef = {
  field: 'lifecycle', role: 'derived', type: "'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'LAUNCHED'",
  enumValues: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'LAUNCHED'],
  description: 'Editorial lifecycle; the importer always lands an import as DRAFT (sources omit it).',
  examples: ['DRAFT', 'LAUNCHED'],
  aliases: ['LIFECYCLE'],
}
const REVIEW_FIELD: CanonicalFieldDef = {
  field: 'reviewStatus', role: 'stored', type: 'ReviewStatus',
  enumValues: ['NOT_STARTED', 'IN_PROGRESS', 'BUSINESS_REVIEW', 'APPROVED', 'REJECTED'],
  description: 'Client-team review state; the column name varies by author/team.',
  examples: ['Not Started', 'Business Review - In Progress', 'Approved - Completed'],
  aliases: [
    'REVIEW STATUS', 'REVIEW STATUS (CLIENT TEAM)', 'REVIEW STATUS (<CLIENT NAME>)',
    'FORM STATUS (ACCENTURE TEAM)', 'RULE STATUS (ACCENTURE TEAM)', 'RATING ITEM STATUS (ACCENTURE TEAM)',
  ],
}
const STATE_SCOPE_FIELDS: readonly CanonicalFieldDef[] = [
  {
    field: 'allStates', role: 'stored', type: 'boolean',
    description: 'True when the row is marked applicable in every active state.',
    examples: [true, false],
    aliases: ['ALL ACTIVE STATES', 'ALL STATES', 'STATE APPLICABILITY'],
  },
  {
    field: 'states', role: 'stored', type: 'string[]',
    description: 'Two-letter state codes marked "X" in per-state applicability columns (when not all-states).',
    examples: [['CA', 'TX'], ['FL', 'GA', 'NC', 'SC']],
    aliases: ['AL', 'AZ', 'CA', 'FL', 'TX', 'NY'],
  },
]

// Source-side flags that fold into the canonical `source` enum. In ISO books these are two
// Yes/No columns (BUREAU + PROPRIETARY); in Property ROC a single "RATING BUREAU" column.
const SOURCE_FIELD: CanonicalFieldDef = {
  field: 'source', role: 'stored', type: "'BUREAU' | 'PROPRIETARY'",
  enumValues: ['BUREAU', 'PROPRIETARY'],
  description: 'Whether the item is a bureau (ISO/AAIS/NCCI) item or carrier-proprietary. Derived from the BUREAU/PROPRIETARY flags or a single RATING BUREAU column.',
  examples: ['BUREAU', 'PROPRIETARY'],
  aliases: ['BUREAU', 'RATING BUREAU', 'PROPRIETARY', 'SOURCE'],
}
const BUREAU_FLAG_FIELD: CanonicalFieldDef = {
  field: 'bureauFlag', role: 'source', type: 'boolean (Yes/No)', mapsTo: 'source',
  description: 'Yes/No "is this a bureau item" flag; Yes → source=BUREAU.',
  examples: ['Yes', 'No'],
  aliases: ['BUREAU', 'RATING BUREAU'],
}
const PROPRIETARY_FLAG_FIELD: CanonicalFieldDef = {
  field: 'proprietaryFlag', role: 'source', type: 'boolean (Yes/No)', mapsTo: 'source',
  description: 'Yes/No "is this carrier-proprietary" flag; Yes → source=PROPRIETARY.',
  examples: ['Yes', 'No'],
  aliases: ['PROPRIETARY'],
}

// ─── The canonical map ───────────────────────────────────────────────────────────

export const CANONICAL_MAP: Record<CanonicalEntityKind, CanonicalEntityDef> = {
  product: {
    entity: 'product', idField: 'refId',
    description: 'The top product record (the .PROD.* row in a product hierarchy sheet).',
    fields: [
      {
        field: 'refId', role: 'stored', type: 'string | null',
        description: 'Product traceability id (the .PROD row). Preserved verbatim; shape is line-specific.',
        examples: ['GL.PROD.001', 'PR.PROD001', 'IM.PROD044'],
        aliases: ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID', 'ID', 'PRODUCT ID'],
      },
      {
        field: 'name', role: 'stored', type: 'string',
        description: 'Product display name.',
        examples: ['Monoline General Liability Product', 'HO-3 Special Form'],
        aliases: ['PRODUCT', 'PRODUCT NAME'],
      },
      {
        field: 'lob.name', role: 'source', type: 'string', mapsTo: 'lob',
        description: 'Line-of-business name from the .LOB row.',
        examples: ['Commercial General Liability', 'Personal Home', 'Inland Marine'],
        aliases: ['LINE OF BUSINESS', 'LOB'],
      },
      {
        field: 'lob.refId', role: 'derived', type: 'string', mapsTo: 'lob',
        description: 'LOB refId — read from the .LOB row id column, else resolved via the inferred line.',
        examples: ['GL.LOB.001', 'PR.LOB001'],
        aliases: ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID', 'ID'],
      },
      {
        field: 'description', role: 'stored', type: 'string',
        description: 'Plain-English product description.',
        examples: ['ISO-style Special Form homeowners policy.', 'Monoline CGL occurrence form.'],
        aliases: ['DESCRIPTION', 'PRODUCT DESCRIPTION'],
      },
      {
        field: 'marketSegment', role: 'stored', type: 'string',
        description: 'Free-text market-segment label; defaults to "<vertical> / <family>".',
        examples: ['Commercial Lines / Casualty', 'Personal Lines / Property', 'Middle Market'],
        aliases: ['MARKET SEGMENT', 'SEGMENT', 'MIDDLE MARKET'],
      },
      STATUS_FIELD, LIFECYCLE_FIELD, REVIEW_FIELD, ...STATE_SCOPE_FIELDS,
      {
        field: 'owner', role: 'system', type: '{ uid: string; name: string }',
        description: 'Stamped with the importing user by the write seam; never from the source.',
        examples: [{ uid: 'u1', name: 'Importer' }, { uid: 'seed', name: 'Seed' }],
        aliases: [],
      },
    ],
  },

  coverage: {
    entity: 'coverage', idField: 'refId',
    description: 'A coverage or (when a sub-coverage column is populated) a sub-coverage linked by parentId.',
    fields: [
      {
        field: 'refId', role: 'stored', type: 'string | null',
        description: 'Coverage traceability id; preserved verbatim. Sub-coverages carry a parent segment.',
        examples: ['GL.COV.002', 'GL.COV.001.001', 'IM.COV044.00', 'PR.COV001.0', 'CORE.COV.001'],
        aliases: ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID', 'ID', 'REQUIREMENT ID', 'REQUIREMENTID', 'COV ID', 'COVERAGE ID'],
      },
      {
        field: 'description', role: 'stored', type: 'string | undefined',
        description: 'Plain-English description of the coverage; free text.',
        examples: ['Covers bodily injury liability to third parties.', 'Covers direct physical loss to covered property.'],
        aliases: ['DESCRIPTION', 'COVERAGE DESCRIPTION'],
      },
      {
        field: 'name', role: 'stored', type: 'string',
        description: 'Coverage name (the sub-coverage name when a sub-coverage column is populated).',
        examples: ['Bodily Injury (Premises Operations)', 'Coverage A — Dwelling'],
        aliases: ['COVERAGE', 'COVERAGE NAME', 'SUB-COVERAGE', 'SUB COVERAGE', 'SUB- COVERAGE', 'SUBCOVERAGE'],
      },
      {
        field: 'coverageName', role: 'source', type: 'string', mapsTo: 'name',
        description: 'Top-level coverage name column.',
        examples: ['Wrongful Acts Coverage', 'Coverage C — Personal Property'],
        aliases: ['COVERAGE', 'COVERAGE NAME'],
      },
      {
        field: 'subCoverageName', role: 'source', type: 'string', mapsTo: 'name',
        description: 'Sub-coverage name column; when populated the row is a child and implies a parentId. Header punctuation varies wildly.',
        examples: ['Terrorism Coverage', 'Scheduled Personal Property'],
        aliases: ['SUB-COVERAGE', 'SUB COVERAGE', 'SUB- COVERAGE', 'SUBCOVERAGE'],
      },
      {
        field: 'parentId', role: 'derived', type: 'string | null',
        description: 'null for top-level; for a sub-coverage, the parent coverage refId (the id minus its last dot-segment).',
        examples: ['GL.COV.001', 'PH.COV.003', null],
        aliases: [],
      },
      {
        field: 'order', role: 'derived', type: 'number',
        description: 'Sibling display order, assigned in source-row order within each parent.',
        examples: [1, 2],
        aliases: [],
      },
      {
        field: 'requirement', role: 'stored', type: "'MANDATORY' | 'OPTIONAL' | 'UNKNOWN'",
        enumValues: ['MANDATORY', 'OPTIONAL', 'UNKNOWN'],
        description: 'Whether the coverage is mandatory or optional. UNKNOWN when the source does not establish it (F14) — never a guessed value.',
        examples: ['Mandatory', 'Optional'],
        aliases: ['COVERAGE REQUIREMENT', 'REQUIREMENT', 'MANDATORY/ OPTIONAL', 'MANDATORY / OPTIONAL'],
      },
      {
        field: 'claimsBasis', role: 'stored', type: 'string',
        description: 'Coverage trigger basis; normalised to Occurrence / Claims-made.',
        examples: ['Occurrence', 'Claims-made', 'Claims - Made'],
        aliases: ['CLAIMS BASIS', 'CLAIMS\nBASIS', 'TRIGGER'],
      },
      {
        field: 'premiumGenerating', role: 'stored', type: 'boolean | null',
        description: 'Whether the coverage generates premium. Header may or may not carry a trailing "?". null when the source does not state premium treatment (F14) — never a guessed boolean.',
        examples: ['Yes', 'No'],
        aliases: ['PREMIUM GENERATING', 'PREMIUM GENERATING?'],
      },
      SOURCE_FIELD, BUREAU_FLAG_FIELD, PROPRIETARY_FLAG_FIELD,
      {
        field: 'formNumbers', role: 'stored', type: 'string[]',
        description: 'Form numbers attaching this coverage. AMBIGUOUS: "COVERAGE FORM(S)" holds form TITLES in ISO GL but form NUMBERS in some IM/PR books — disambiguate by cell content (form-number pattern vs prose title), not header.',
        examples: [['CG 21 70', 'CG 21 87'], ['HO 00 03']],
        aliases: ['FORM NUMBER(S)', 'FORM NUMBER', 'FORM NUMBERS', 'COVERAGE FORM', 'COVERAGE FORM(S)'],
        ambiguous: true,
      },
      {
        field: 'coverageFormTitles', role: 'source', type: 'string (surfaced, not stored)',
        description: 'Form TITLE column that sits alongside the form-number column in ISO books; surfaced as unmapped and NEVER merged into formNumbers.',
        examples: ['Cap On Losses From Certified Acts Of Terrorism', 'Commercial General Liability'],
        aliases: ['COVERAGE FORM(S)', 'COVERAGE FORM'],
        ambiguous: true,
      },
      {
        field: 'terms', role: 'derived', type: 'CoverageTerm[]',
        description: 'Limit / deductible / option terms, assembled from the coverage row plus the LD tables and rules that reference it.',
        examples: [{ kind: 'LIMIT', label: 'Each Occurrence Limit' }, { kind: 'DEDUCTIBLE', label: 'BI/PD Deductible' }],
        aliases: ['LIMIT', 'DEDUCTIBLE', 'AVAILABLE LIMITS'],
      },
      STATUS_FIELD, LIFECYCLE_FIELD, REVIEW_FIELD, ...STATE_SCOPE_FIELDS,
    ],
  },

  form: {
    entity: 'form', idField: 'number',
    description: 'A policy form / endorsement. Identity is (form number, edition date when stated) — first principles §5.2: distinct editions are legally distinct documents. Number-only references (coverage/rule formNumbers) resolve to ALL editions of that number (attachment semantics). Forms are a shared library.',
    fields: [
      {
        field: 'number', role: 'stored', type: 'string',
        description: 'Form number; preserved verbatim including embedded spaces.',
        examples: ['CG 00 01', 'HO 00 03', 'CP 00 10'],
        aliases: ['FORM NUMBER', 'FORM NUMBER(S)', 'FORM NO', 'FORM #'],
      },
      {
        field: 'name', role: 'stored', type: 'string',
        description: 'Form / endorsement name.',
        examples: ['Commercial General Liability Coverage Form', 'Homeowners 3 – Special Form'],
        aliases: ['FORM NAME', 'NAME'],
      },
      {
        field: 'edition', role: 'stored', type: 'string',
        description: 'Form edition date (typically MM YY).',
        examples: ['04 13', '05 11'],
        aliases: ['FORM EDITION DATE (MM YY)', 'FORM EDITION DATE', 'EDITION DATE', 'EDITION'],
      },
      {
        field: 'effectiveDate', role: 'stored', type: 'string | undefined',
        description: 'Date the form version becomes effective.',
        examples: ['10 25', '01 01 2024'],
        aliases: ['FORM EFFECTIVE DATE', 'EFFECTIVE DATE'],
      },
      {
        field: 'expirationDate', role: 'stored', type: 'string | undefined',
        description: 'Date the form version expires.',
        examples: ['12 31 9999', '12 99'],
        aliases: ['FORM EXPIRATION DATE', 'EXPIRATION DATE'],
      },
      {
        field: 'category', role: 'stored', type: 'FormCategory',
        enumValues: ['BASE_COVERAGE', 'DECLARATIONS', 'ENDORSEMENT', 'EXCLUSION', 'AMENDATORY', 'POLICY_NOTICE'],
        description: 'Form category; the many GL sub-types (Other Coverage Form, Causes Of Loss Form, …) fold onto ENDORSEMENT.',
        examples: ['Base Coverage Form', 'Declarations - Primary', 'Endorsement'],
        aliases: ['FORM CATEGORY', 'CATEGORY'],
      },
      {
        field: 'claimsBasis', role: 'stored', type: 'string',
        description: 'Trigger basis for the form.',
        examples: ['Occurrence', 'Claims - Made'],
        aliases: ['CLAIMS BASIS'],
      },
      {
        field: 'dynamic', role: 'stored', type: 'boolean',
        description: 'Whether the form carries fillable dynamic fields.',
        examples: ['Dynamic', 'Static'],
        aliases: ['DYNAMIC / STATIC', 'DYNAMIC/STATIC'],
      },
      {
        field: 'mandatoryDefault', role: 'stored', type: 'boolean',
        description: 'Whether the form attaches mandatorily by default.',
        examples: ['Mandatory', 'Optional'],
        aliases: ['MANDATORY/ OPTIONAL', 'MANDATORY / OPTIONAL', 'MANDATORY/OPTIONAL'],
      },
      {
        field: 'attachmentCondition', role: 'stored', type: "'RULE' | 'NONE'",
        enumValues: ['RULE', 'NONE'],
        description: 'Whether attachment is governed by a rule or has no additional condition.',
        examples: ['Defined by Rule', 'No Additional Conditions'],
        aliases: ['ATTACHMENT CONDITION'],
      },
      SOURCE_FIELD, BUREAU_FLAG_FIELD, PROPRIETARY_FLAG_FIELD,
      {
        field: 'admitted', role: 'stored', type: 'boolean',
        description: 'Admitted vs non-admitted (surplus lines) filing.',
        examples: ['Admitted', 'Non-Admitted'],
        aliases: ['ADMITTED / NON-ADMITTED', 'ADMITTED/NON-ADMITTED', 'ADMITTED'],
      },
      {
        field: 'displayOnSchedule', role: 'stored', type: 'boolean',
        description: 'Whether the form shows on the forms schedule.',
        examples: ['Yes', 'No'],
        aliases: ['DISPLAY ON FORMS SCHEDULE', 'DISPLAY ON SCHEDULE'],
      },
      {
        field: 'multiUse', role: 'stored', type: 'boolean',
        description: 'Single-use vs multi-use form.',
        examples: ['Single Use', 'Multi Use'],
        aliases: ['SINGLE OR MULTI-USE', 'SINGLE OR MULTI USE'],
      },
      {
        field: 'transactions', role: 'stored', type: 'string[]',
        description: 'Transaction types the form applies to (grouped "X" columns under a TRANSACTIONS band).',
        examples: [['SUBMISSION', 'RENEWAL'], ['ENDORSEMENT']],
        aliases: ['TRANSACTIONS', 'SUBMISSION', 'RENEWAL', 'ENDORSEMENT', 'CANCELLATION'],
      },
      {
        field: 'coverageParts', role: 'stored', type: 'string[]',
        description: 'Coverage parts the form belongs to (grouped "X" columns under a COVERAGE PART band).',
        examples: [['COMMERCIAL GENERAL LIABILITY'], ['LIQUOR LIABILITY']],
        aliases: ['COVERAGE PART', 'COMMERCIAL GENERAL LIABILITY', 'LIQUOR LIABILITY', 'POLLUTION'],
      },
      {
        field: 'productRefIds', role: 'derived', type: 'string[]',
        description: 'The product(s)/coverage refIds this form links back to (from the id column).',
        examples: [['GL.PROD.001'], ['GL.COV.002', 'GL.COV.003']],
        aliases: ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID'],
      },
      {
        field: 'description', role: 'system', type: 'string',
        description: 'AI-generated plain-English description; cached, never taken from the source.',
        examples: ['', 'Extends coverage to certified acts of terrorism.'],
        aliases: [],
      },
      {
        field: 'dynamicFields', role: 'derived', type: 'DynamicField[]',
        description: 'Dynamic fields assembled from the Dynamic Data sheet, keyed by form number.',
        examples: [[], [{ name: 'Rating Date', dataType: 'DATE' }]],
        aliases: ['DYNAMIC DATA'],
      },
      STATUS_FIELD, LIFECYCLE_FIELD, REVIEW_FIELD, ...STATE_SCOPE_FIELDS,
    ],
  },

  dynamicField: {
    entity: 'dynamicField',
    description: 'One fillable field on a dynamic form, from the "Dynamic Data" sheet.',
    fields: [
      {
        field: 'formNumber', role: 'source', type: 'string', mapsTo: 'form.number',
        description: 'The form number this dynamic field belongs to.',
        examples: ['CG 01 13', 'CG 01 39'],
        aliases: ['FORM NUMBER'],
      },
      {
        field: 'name', role: 'stored', type: 'string',
        description: 'Dynamic field name.',
        examples: ['Rating Date', 'Residential Fuel Tank Aggregate Limit'],
        aliases: ['DYNAMIC FIELD NAME', 'FIELD NAME'],
      },
      {
        field: 'dataType', role: 'stored', type: 'DynamicFieldType',
        enumValues: ['TEXT', 'CURRENCY', 'DATE', 'LIST', 'PERCENT'],
        description: 'Field data type; Number/Alphanumeric/Address fold onto TEXT.',
        examples: ['Date', 'Currency', 'Number'],
        aliases: ['DATA TYPE'],
      },
      {
        field: 'repeating', role: 'stored', type: 'boolean',
        description: 'Whether the field repeats (a list of entries).',
        examples: ['Yes', 'No'],
        aliases: ['REPEATING FIELD', 'REPEATING'],
      },
      {
        field: 'options', role: 'stored', type: 'string[]',
        description: 'Allowed values for a LIST-type field (empty when none).',
        examples: [[], ['Named Perils', 'Special Form']],
        aliases: ['ALLOWED VALUES', 'OPTIONS', 'LIST VALUES'],
      },
      {
        field: 'notes', role: 'stored', type: 'string | undefined',
        description: 'Free-text note on the dynamic field.',
        examples: ['', 'Bound to declarations.'],
        aliases: ['NOTES', 'COMMENTS'],
      },
      {
        field: 'effectiveDate', role: 'stored', type: 'string | undefined',
        description: 'Date the dynamic field becomes active on the form.',
        examples: ['10 25', '01 24'],
        aliases: ['EFFECTIVE DATE OF DYNAMIC FIELD', 'FIELD EFFECTIVE DATE', 'EFFECTIVE DATE'],
      },
      {
        field: 'expirationDate', role: 'stored', type: 'string | undefined',
        description: 'Date the dynamic field expires on the form.',
        examples: ['12 99', '12 31 9999'],
        aliases: ['EXPIRATION DATE OF DYNAMIC FIELD', 'FIELD EXPIRATION DATE', 'EXPIRATION DATE'],
      },
    ],
  },

  ratingProgram: {
    entity: 'ratingProgram', idField: 'refId',
    description: 'The rating program (algorithm) for a line, assembled from the rating specification sheet.',
    fields: [
      {
        field: 'refId', role: 'derived', type: 'string',
        description: 'Program refId, collapsed from the rating step ids (e.g. "GL.RAT.1.05" → "GL.RAT.1"; Property → "PR.ROC").',
        examples: ['GL.RAT.1', 'PR.ROC'],
        aliases: ['PRODUCT FRAMEWORK ID', 'RATING STEP ID'],
      },
      {
        field: 'name', role: 'derived', type: 'string',
        description: 'Program name; defaults to "<line> Rating Program".',
        examples: ['Commercial General Liability Rating Program', 'Property Rate Order of Calculations'],
        aliases: ['RATING GROUPING', 'RATING CATEGORY'],
      },
      {
        field: 'minimumPremium', role: 'stored', type: 'number',
        description: 'Program minimum premium (0 when the source states none).',
        examples: [500, 0],
        aliases: ['MINIMUM PREMIUM', 'MIN PREMIUM', 'POLICY MINIMUM PREMIUM'],
      },
      {
        field: 'steps', role: 'derived', type: 'RatingStep[]',
        description: 'Ordered rating steps built from the rating rows.',
        examples: [{ id: 'GL.RAT.1.00', op: 'SET' }, { id: 'GL.RAT.1.05', op: 'MUL' }],
        aliases: ['ALGORITHM STEP', 'RATING RULES'],
      },
      {
        field: 'creditFloor', role: 'stored', type: 'number | undefined',
        description: 'Optional maximum-credit cap (e.g. a filing\'s "Rule 92 maximum total credit 50%"); floors the cumulative credit product.',
        examples: [0.5, 0.6],
        aliases: ['MAXIMUM CREDIT', 'MAXIMUM CREDITS', 'MAX CREDITS', 'RULE 92'],
      },
      ...STATE_SCOPE_FIELDS,
    ],
  },

  ratingStep: {
    entity: 'ratingStep', idField: 'id',
    description: 'One step of a rating algorithm. Property ROC ships blank/"TBD" step ids → synthesized via the LOB RefIdScheme.',
    fields: [
      {
        field: 'id', role: 'stored', type: 'string',
        description: 'Step id, verbatim; synthesized in the line shape when the source ships "TBD".',
        examples: ['GL.RAT.1.00', 'GL.RAT.1.05', 'PR.ROC.001'],
        aliases: ['RATING STEP ID', 'STEP ID'],
      },
      {
        field: 'order', role: 'derived', type: 'number',
        description: 'Execution order, assigned in source-row order.',
        examples: [1, 5],
        aliases: [],
      },
      {
        field: 'label', role: 'stored', type: 'string',
        description: 'Human label for the step (from the algorithm-step / rating-rules text). Present on sheets that have an "ALGORITHM STEP" column.',
        examples: ['Base Rate', 'Increased Limit Factor'],
        aliases: ['ALGORITHM STEP', 'RATING RULES', 'RATING GROUPING'],
      },
      {
        field: 'description', role: 'stored', type: 'string | undefined',
        description: 'Plain-English description of the step, from a "Rule Description" or "Description" column alongside the Algorithm Step column. Observed in Core-format rating sheets.',
        examples: ['Apply the base rate from the territory table', 'Multiply by the increased limit factor'],
        aliases: ['RULE DESCRIPTION', 'DESCRIPTION', 'STEP DESCRIPTION', 'ALGORITHM DESCRIPTION'],
      },
      {
        field: 'coverageRef', role: 'source', type: 'string | undefined', mapsTo: 'coverageRef',
        description: 'Coverage name / grouping label for this step, from the "Coverage" or "Coverage Group" column in Core-format rating sheets. Groups steps by coverage (e.g. "Bodily Injury", "Property Damage").',
        examples: ['Bodily Injury', 'Property Damage', 'Personal Property'],
        aliases: ['COVERAGE', 'COVERAGE NAME', 'COVERAGE GROUP', 'COVERAGE GROUPING'],
      },
      {
        field: 'op', role: 'stored', type: "'SET' | 'MUL' | 'ADD' | 'MIN_FLOOR'",
        enumValues: ['SET', 'MUL', 'ADD', 'MIN_FLOOR'],
        description: 'The arithmetic operation, from the calculation operator ("="→SET, "+"/"-"→ADD, "*"/"/"→MUL).',
        examples: ['=', '*', '+'],
        aliases: ['CALCULATION', 'OPERATION', 'OPERATOR'],
      },
      {
        field: 'source.ref', role: 'source', type: 'string', mapsTo: 'source',
        description: 'Rate reference — resolves onto an RT table refId (by name when a free-text label is given).',
        examples: ['RTTable.001', 'Increase Limit Factor Table'],
        aliases: ['RATE REFERENCE', 'RATE TABLE', 'RATE REFERENCE ID'],
      },
      {
        field: 'roundTo', role: 'stored', type: 'number | undefined',
        description: 'Decimal places to round the running total after this step ("Nearest dollar" → 0).',
        examples: [0, 4],
        aliases: ['ROUNDING NUMBER OF DIGITS', 'ROUNDING', 'ROUNDING NUMBER OF DIGITIS'],
      },
      {
        field: 'condition', role: 'stored', type: 'string | undefined',
        description: 'Name of a boolean input that gates the step (falsy → skipped).',
        examples: ['pcoElected', 'windHailElected'],
        aliases: ['RATING RULES', 'CONDITION'],
      },
      {
        field: 'isCredit', role: 'stored', type: 'boolean | undefined',
        description: 'Marks the step as a credit factor for the program-level maximum-credit cap.',
        examples: [true, false],
        aliases: ['CREDIT', 'IS CREDIT'],
      },
      {
        field: 'manualRuleId', role: 'source', type: 'string (surfaced)',
        description: 'State-manual rule/step reference; surfaced for provenance, not stored on the step.',
        examples: ['Rule 4.1, Step 3', 'Base Rate'],
        aliases: ['RATING MANUAL RULE/ STEP ID', 'RATING MANUAL RULE/STEP ID', 'MANUAL RULE/ STEP ID'],
      },
    ],
  },

  rtTable: {
    entity: 'rtTable', idField: 'refId',
    description: 'A rate table (layout preserved as-is; lookup logic lives in the line getter).',
    fields: [
      {
        field: 'refId', role: 'stored', type: 'string',
        description: 'Rate table id, verbatim.',
        examples: ['RTTable.001', 'RTTable.008'],
        aliases: ['RATE TABLE ID', 'RT TABLE ID'],
      },
      {
        field: 'name', role: 'stored', type: 'string',
        description: 'Rate table name.',
        examples: ['INCREASE LIMIT FACTOR', 'Territory Base Rates'],
        aliases: ['RATE TABLE NAME', 'TABLE NAME'],
      },
      {
        field: 'columns', role: 'derived', type: 'string[]',
        description: 'Column headers, in order.',
        examples: [['COVERAGE', 'PER OCCURRENCE', 'AGGREGATE', 'ILF'], ['Territory', 'Base Rate']],
        aliases: ['COLUMN HEADERS'],
      },
      {
        field: 'rows', role: 'derived', type: 'Record<string, unknown>[]',
        description: 'Row records keyed by column header; numbers coerced.',
        examples: [{ COVERAGE: 'Prem/Ops', ILF: 1.0 }, { Territory: 'T001', 'Base Rate': 700 }],
        aliases: [],
      },
      {
        field: 'dimensions', role: 'derived', type: 'RTTableDimension[] | undefined',
        description: 'Optional grid-editor lookup-key descriptors (additive; absent on legacy tables).',
        examples: [{ key: 'occLimit' }, { key: 'territory' }],
        aliases: ['DIMENSION', 'LOOKUP KEY'],
      },
      {
        field: 'valueColumn', role: 'derived', type: 'string | undefined',
        description: 'The column holding the factor/rate (inferred when absent).',
        examples: ['ILF', 'Base Rate'],
        aliases: ['ILF', 'RATE', 'FACTOR', 'VALUE'],
      },
    ],
  },

  ldTable: {
    entity: 'ldTable', idField: 'refId',
    description: 'A limits & deductibles option table (stacked blocks under a "Limits and Deductibles" sheet).',
    fields: [
      {
        field: 'refId', role: 'stored', type: 'string',
        description: 'LD table id, verbatim (the "LDTable.NNN" marker cell).',
        examples: ['LDTable.001', 'LDTable.008'],
        aliases: ['LD TABLE ID', 'LDTABLE', 'RULE ID'],
      },
      {
        field: 'name', role: 'stored', type: 'string',
        description: 'LD table name (the cell after "TABLE NAME:").',
        examples: ['Occurrence Limits', 'Policy Claims Basis'],
        aliases: ['TABLE NAME'],
      },
      {
        field: 'defaultValue', role: 'derived', type: 'number | undefined',
        description: 'The default option, detected from a "Default" comment on a row.',
        examples: [300000, 1000],
        aliases: ['DEFAULT', 'DEFAULT VALUE'],
      },
      {
        field: 'rows.value', role: 'derived', type: 'number', mapsTo: 'rows',
        description: 'Each available limit / deductible option value.',
        examples: [25000, 300000],
        aliases: ['AVAILABLE LIMITS', 'AVAILABLE DEDUCTIBLES', 'LIMITS', 'DEDUCTIBLES', 'TYPE', 'VALUE'],
      },
      {
        field: 'rows.constraintNote', role: 'derived', type: 'string | undefined', mapsTo: 'rows',
        description: 'Per-row comment / constraint note.',
        examples: ['Default', 'Available when higher'],
        aliases: ['COMMENTS', 'COMMENT', 'NOTES'],
      },
    ],
  },

  rule: {
    entity: 'rule', idField: 'refId',
    description: 'A product / rating / forms rule (condition → outcome), from the rules specification sheet.',
    fields: [
      {
        field: 'refId', role: 'stored', type: 'string | null',
        description: 'Rule id, verbatim. The rule token is line-specific (GL "RU", IM "RL").',
        examples: ['GL.RU.001', 'GL.RU.006', 'IM.RL.001', 'PR.RU.001'],
        aliases: ['RULE ID'],
      },
      {
        field: 'category', role: 'stored', type: 'RuleCategory',
        enumValues: ['PRODUCT', 'RATING', 'FORMS'],
        description: 'Rule category.',
        examples: ['Product', 'Rating', 'Forms'],
        aliases: ['RULE CATEGORY'],
      },
      {
        field: 'subCategory', role: 'stored', type: 'string',
        description: 'Rule sub-category.',
        examples: ['Base Coverage (Default)', 'Limit Ranges and Defaults'],
        aliases: ['RULE SUB-CATEGORY', 'RULE SUB CATEGORY', 'SUB-CATEGORY'],
      },
      {
        field: 'condition', role: 'stored', type: 'string',
        description: 'The rule condition ("If …").',
        examples: ['If Monoline Commercial General Liability is selected', 'If Condominiums is selected'],
        aliases: ['RULE CONDITION', 'CONDITION'],
      },
      {
        field: 'outcome', role: 'stored', type: 'string',
        description: 'The rule outcome ("Then …").',
        examples: ['Then Bodily Injury/Property Damage Coverage is available and mandatory', 'Then available and mandatory'],
        aliases: ['RULE OUTCOME', 'OUTCOME'],
      },
      {
        field: 'ldTableRef', role: 'derived', type: 'string | undefined',
        description: 'LD/RT table ref pulled from the free-text rule-reference cell.',
        examples: ['LDTable.008', 'LDTable.001'],
        aliases: ['RULE REFERENCE', 'RATE REFERENCE', 'REFERENCE'],
      },
      {
        field: 'coverageRefIds', role: 'source', type: 'string[]', mapsTo: 'coverageRefIds',
        description: 'Coverage refIds the rule applies to (multi-line id cell splits on newlines).',
        examples: [['GL.COV.002', 'GL.COV.003'], ['PH.COV.005', 'PH.COV.006']],
        aliases: ['PRODUCT FRAMEWORK ID', 'COVERAGE'],
      },
      {
        field: 'formNumbers', role: 'stored', type: 'string[]',
        description: 'Form numbers referenced by the rule.',
        examples: [['CG 00 01'], ['HO 04 48']],
        aliases: ['FORM NUMBER', 'FORM NUMBER(S)'],
      },
      STATUS_FIELD, LIFECYCLE_FIELD, REVIEW_FIELD, ...STATE_SCOPE_FIELDS,
    ],
  },

  formRule: {
    entity: 'formRule', idField: 'refId',
    description: 'A forms-attachment rule (from the optional forms rules sheet).',
    fields: [
      {
        field: 'refId', role: 'stored', type: 'string | null',
        description: 'Form-rule id, verbatim.',
        examples: ['GL.FORM.RU.001', 'GL.FORM.RU.007'],
        aliases: ['FORM RULE ID', 'RULE ID'],
      },
      {
        field: 'condition', role: 'stored', type: 'string',
        description: 'The attachment condition ("If …").',
        examples: ['If Pollution Liability Coverage Form Designated Sites is selected', 'If Condominiums is selected'],
        aliases: ['RULE CONDITION', 'CONDITION'],
      },
      {
        field: 'outcome', role: 'stored', type: 'string',
        description: 'The attachment outcome ("Then …").',
        examples: ['Then "…" is available and mandatory', 'Then available and optional'],
        aliases: ['RULE OUTCOME', 'OUTCOME'],
      },
      {
        field: 'formNumbers', role: 'stored', type: 'string[]',
        description: 'Form numbers the rule governs (duplicate ids merge their form sets).',
        examples: [['CG 00 39'], ['CG 01 27', 'CG 01 28']],
        aliases: ['FORM NUMBER', 'FORM NUMBER(S)'],
      },
      {
        field: 'mandatory', role: 'derived', type: 'boolean',
        description: 'Whether the outcome makes the form mandatory (derived from the outcome text).',
        examples: [true, false],
        aliases: ['MANDATORY', 'MANDATORY/ OPTIONAL'],
      },
      STATUS_FIELD, LIFECYCLE_FIELD, REVIEW_FIELD,
    ],
  },
}

// ─── Surfaced-but-unmapped columns ─────────────────────────────────────────────────
// Columns real sources add that the canonical model does NOT persist. The importer must
// SURFACE these (report them as unmapped) rather than drop them silently — the same
// transparency discipline the deterministic parser already follows. Grounded in the
// shipped ISO GL books and the observed IM/PR variance.
export const SURFACED_COLUMNS: readonly { column: string; note: string }[] = [
  { column: 'COVERAGE SCOPE',                    note: 'IM/PR extra: descriptive coverage scope text.' },
  { column: 'COVERAGE EFFECT',                   note: 'IM/PR extra: coverage effect classification.' },
  { column: 'SOURCE',                            note: 'Provenance column distinct from bureau/proprietary flags.' },
  { column: 'RULE EFFECTIVE DATE',               note: 'Rule effectivity window; not modelled on Rule.' },
  { column: 'RULE EXPIRATION DATE',              note: 'Rule expiry window; not modelled on Rule.' },
  { column: 'FORM EFFECTIVE DATE',               note: 'Form effectivity window; not modelled on Form.' },
  { column: 'FORM EXPIRATION DATE',              note: 'Form expiry window; not modelled on Form.' },
  { column: 'EFFECTIVE DATE OF DYNAMIC FIELD',   note: 'Dynamic-field effectivity; not modelled on DynamicField.' },
  { column: 'EXPIRATION DATE OF DYNAMIC FIELD',  note: 'Dynamic-field expiry; not modelled on DynamicField.' },
  { column: 'MARKET SEGMENT',                    note: 'Forms-sheet band; captured on product.marketSegment only.' },
  { column: 'MIDDLE MARKET',                     note: 'Forms-sheet market band flag.' },
  { column: 'INTERLINE FORM',                    note: 'Forms-sheet interline flag.' },
  { column: 'RATING MANUAL RULE/ STEP ID',       note: 'State-manual reference surfaced for provenance.' },
  { column: 'RULES REVIEWER',                    note: 'Reviewer name; workflow metadata.' },
  { column: 'DATE REVIEW COMPLETED',             note: 'Review completion date; workflow metadata.' },
]

// ─── Helpers (grounding lookups; NOT a production matcher) ──────────────────────────

export const CANONICAL_ENTITY_KINDS: readonly CanonicalEntityKind[] =
  Object.keys(CANONICAL_MAP) as CanonicalEntityKind[]

/** Every field definition for an entity. */
export function fieldsOf(entity: CanonicalEntityKind): readonly CanonicalFieldDef[] {
  return CANONICAL_MAP[entity].fields
}

/** The known source aliases for one canonical field. */
export function aliasesFor(entity: CanonicalEntityKind, field: string): readonly string[] {
  return CANONICAL_MAP[entity].fields.find(f => f.field === field)?.aliases ?? []
}

/** Punctuation/whitespace-insensitive header key (matches the deterministic parser's squish). */
function squish(s: string): string { return s.toUpperCase().replace(/[^A-Z0-9]/g, '') }

/** Grounding lookup: which canonical field(s) an observed header could map to. Returns ALL
 *  candidates (a header like "COVERAGE FORM" is genuinely ambiguous across sources), so
 *  callers/models disambiguate by cell content — this is deliberately not a 1:1 matcher. */
export function candidateFields(entity: CanonicalEntityKind, header: string): CanonicalFieldDef[] {
  const key = squish(header)
  if (!key) return []
  return CANONICAL_MAP[entity].fields.filter(f => f.aliases.some(a => squish(a) === key))
}
