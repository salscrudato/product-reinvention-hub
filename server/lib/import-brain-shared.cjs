"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// shared/src/import/brain-server-entry.ts
var brain_server_entry_exports = {};
__export(brain_server_entry_exports, {
  CANONICAL_MAP: () => CANONICAL_MAP,
  LOB_REGISTRY: () => LOB_REGISTRY,
  MAX_EMBED_COLS: () => MAX_EMBED_COLS,
  MAX_EMBED_ROWS: () => MAX_EMBED_ROWS,
  SURFACED_COLUMNS: () => SURFACED_COLUMNS,
  augmentHeaderCandidates: () => augmentHeaderCandidates,
  buildSheetCensus: () => buildSheetCensus,
  buildStructuralModel: () => buildStructuralModel,
  buildWorkbookCensus: () => buildWorkbookCensus,
  createAccounting: () => createAccounting,
  dashId: () => dashId,
  fingerprintGrid: () => fingerprintGrid,
  fnv1a64: () => fnv1a64,
  formTokenCensus: () => formTokenCensus,
  harvestAliasOverlay: () => harvestAliasOverlay,
  headerLockV2Signals: () => headerLockV2Signals,
  hiddenSheetSubstance: () => hiddenSheetSubstance,
  idColumnProfile: () => idColumnProfile,
  inferLob: () => inferLob,
  isPlaceholder: () => isPlaceholder,
  mapIsoWorkbook: () => mapIsoWorkbook,
  nearDuplicateSheetClusters: () => nearDuplicateSheetClusters,
  normalizeCellValue: () => normalizeCellValue,
  pickBestHeaderRow: () => pickBestHeaderRow,
  post: () => post,
  postSpan: () => postSpan,
  refIdSegmentKind: () => refIdSegmentKind,
  refIdToDocId: () => refIdToDocId,
  repeatingParentRuns: () => repeatingParentRuns,
  resolveLobByRefId: () => resolveLobByRefId,
  rollupSheet: () => rollupSheet,
  rollupWorkbook: () => rollupWorkbook,
  scoreHeaderCandidates: () => scoreHeaderCandidates,
  segmentTableRegions: () => segmentTableRegions,
  staircaseHierarchy: () => staircaseHierarchy,
  stateLexicon: () => stateLexicon,
  synthesizeRefId: () => synthesizeRefId
});
module.exports = __toCommonJS(brain_server_entry_exports);

// shared/src/import/structure/headerScore.ts
var MAX_CANDIDATE_ROWS = 15;
function scoreHeaderCandidates(cells) {
  if (cells.length === 0) return [];
  const colCount = cells.reduce((m, r) => Math.max(m, r.length), 0);
  if (colCount === 0) return [];
  const candidates = [];
  const limit = Math.min(MAX_CANDIDATE_ROWS, cells.length);
  for (let r = 0; r < limit; r++) {
    const row2 = cells[r] ?? [];
    const textCells = [];
    for (let c = 0; c < colCount; c++) {
      const v = row2[c];
      if (typeof v === "string" && v.trim().length > 0) textCells.push(v.trim());
    }
    if (textCells.length === 0) continue;
    const textDensity = textCells.length / colCount;
    const distinctSet = new Set(textCells.map((t) => t.toUpperCase()));
    const distinctRatio = distinctSet.size / textCells.length;
    const capsCount = textCells.filter(
      (t) => t === t.toUpperCase() || /^[A-Z][A-Za-z0-9\s/()#.-]+$/.test(t)
    ).length;
    const capsRatio = capsCount / textCells.length;
    const isTitleLike = textCells.length === 1 && (textCells[0]?.length ?? 0) > 25;
    const followedByData = hasDataBelow(cells, r, colCount);
    const rawScore = textDensity * 0.45 + distinctRatio * 0.3 + capsRatio * 0.05 + (followedByData ? 0.2 : 0) - (isTitleLike ? 0.3 : 0);
    const score = Math.max(0, Math.min(1, rawScore));
    candidates.push({
      rowIndex: r,
      score,
      labels: textCells,
      distinctCount: distinctSet.size,
      followedByData
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}
function pickBestHeaderRow(candidates) {
  const best = candidates[0];
  return best && best.score > 0.25 ? best.rowIndex : -1;
}
function hasDataBelow(cells, headerRow, colCount) {
  const effective = Math.max(1, colCount);
  let totalFill = 0;
  let checkedRows = 0;
  for (let r = headerRow + 1; r < Math.min(headerRow + 4, cells.length); r++) {
    const row2 = cells[r] ?? [];
    let filled = 0;
    for (let c = 0; c < effective; c++) {
      const v = row2[c];
      if (v !== null && v !== void 0 && v !== "") filled++;
    }
    totalFill += filled / effective;
    checkedRows++;
  }
  return checkedRows > 0 && totalFill / checkedRows >= 0.25;
}

// shared/src/import/canonicalMap.ts
var STATUS_FIELD = {
  field: "status",
  role: "stored",
  type: "'ACTIVE' | 'INACTIVE' | 'FUTURE'",
  enumValues: ["ACTIVE", "INACTIVE", "FUTURE"],
  description: "Governance status; source values normalise to the canonical enum.",
  examples: ["Active", "Inactive - No Longer in Use", "Future"],
  aliases: ["STATUS", "PRODUCT STATUS"]
};
var LIFECYCLE_FIELD = {
  field: "lifecycle",
  role: "derived",
  type: "'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'LAUNCHED'",
  enumValues: ["DRAFT", "IN_REVIEW", "APPROVED", "LAUNCHED"],
  description: "Editorial lifecycle; the importer always lands an import as DRAFT (sources omit it).",
  examples: ["DRAFT", "LAUNCHED"],
  aliases: ["LIFECYCLE"]
};
var REVIEW_FIELD = {
  field: "reviewStatus",
  role: "stored",
  type: "ReviewStatus",
  enumValues: ["NOT_STARTED", "IN_PROGRESS", "BUSINESS_REVIEW", "APPROVED", "REJECTED"],
  description: "Client-team review state; the column name varies by author/team.",
  examples: ["Not Started", "Business Review - In Progress", "Approved - Completed"],
  aliases: [
    "REVIEW STATUS",
    "REVIEW STATUS (CLIENT TEAM)",
    "REVIEW STATUS (<CLIENT NAME>)",
    "FORM STATUS (ACCENTURE TEAM)",
    "RULE STATUS (ACCENTURE TEAM)",
    "RATING ITEM STATUS (ACCENTURE TEAM)"
  ]
};
var STATE_SCOPE_FIELDS = [
  {
    field: "allStates",
    role: "stored",
    type: "boolean",
    description: "True when the row is marked applicable in every active state.",
    examples: [true, false],
    aliases: ["ALL ACTIVE STATES", "ALL STATES", "STATE APPLICABILITY"]
  },
  {
    field: "states",
    role: "stored",
    type: "string[]",
    description: 'Two-letter state codes marked "X" in per-state applicability columns (when not all-states).',
    examples: [["CA", "TX"], ["FL", "GA", "NC", "SC"]],
    aliases: ["AL", "AZ", "CA", "FL", "TX", "NY"]
  }
];
var SOURCE_FIELD = {
  field: "source",
  role: "stored",
  type: "'BUREAU' | 'PROPRIETARY'",
  enumValues: ["BUREAU", "PROPRIETARY"],
  description: "Whether the item is a bureau (ISO/AAIS/NCCI) item or carrier-proprietary. Derived from the BUREAU/PROPRIETARY flags or a single RATING BUREAU column.",
  examples: ["BUREAU", "PROPRIETARY"],
  aliases: ["BUREAU", "RATING BUREAU", "PROPRIETARY", "SOURCE"]
};
var BUREAU_FLAG_FIELD = {
  field: "bureauFlag",
  role: "source",
  type: "boolean (Yes/No)",
  mapsTo: "source",
  description: 'Yes/No "is this a bureau item" flag; Yes \u2192 source=BUREAU.',
  examples: ["Yes", "No"],
  aliases: ["BUREAU", "RATING BUREAU"]
};
var PROPRIETARY_FLAG_FIELD = {
  field: "proprietaryFlag",
  role: "source",
  type: "boolean (Yes/No)",
  mapsTo: "source",
  description: 'Yes/No "is this carrier-proprietary" flag; Yes \u2192 source=PROPRIETARY.',
  examples: ["Yes", "No"],
  aliases: ["PROPRIETARY"]
};
var CANONICAL_MAP = {
  product: {
    entity: "product",
    idField: "refId",
    description: "The top product record (the .PROD.* row in a product hierarchy sheet).",
    fields: [
      {
        field: "refId",
        role: "stored",
        type: "string | null",
        description: "Product traceability id (the .PROD row). Preserved verbatim; shape is line-specific.",
        examples: ["GL.PROD.001", "PR.PROD001", "IM.PROD044"],
        aliases: ["PRODUCT FRAMEWORK ID", "FRAMEWORK ID", "ID", "PRODUCT ID"]
      },
      {
        field: "name",
        role: "stored",
        type: "string",
        description: "Product display name.",
        examples: ["Monoline General Liability Product", "HO-3 Special Form"],
        aliases: ["PRODUCT", "PRODUCT NAME"]
      },
      {
        field: "lob.name",
        role: "source",
        type: "string",
        mapsTo: "lob",
        description: "Line-of-business name from the .LOB row.",
        examples: ["Commercial General Liability", "Personal Home", "Inland Marine"],
        aliases: ["LINE OF BUSINESS", "LOB"]
      },
      {
        field: "lob.refId",
        role: "derived",
        type: "string",
        mapsTo: "lob",
        description: "LOB refId \u2014 read from the .LOB row id column, else resolved via the inferred line.",
        examples: ["GL.LOB.001", "PR.LOB001"],
        aliases: ["PRODUCT FRAMEWORK ID", "FRAMEWORK ID", "ID"]
      },
      {
        field: "description",
        role: "stored",
        type: "string",
        description: "Plain-English product description.",
        examples: ["ISO-style Special Form homeowners policy.", "Monoline CGL occurrence form."],
        aliases: ["DESCRIPTION", "PRODUCT DESCRIPTION"]
      },
      {
        field: "marketSegment",
        role: "stored",
        type: "string",
        description: 'Free-text market-segment label; defaults to "<vertical> / <family>".',
        examples: ["Commercial Lines / Casualty", "Personal Lines / Property", "Middle Market"],
        aliases: ["MARKET SEGMENT", "SEGMENT", "MIDDLE MARKET"]
      },
      STATUS_FIELD,
      LIFECYCLE_FIELD,
      REVIEW_FIELD,
      ...STATE_SCOPE_FIELDS,
      {
        field: "owner",
        role: "system",
        type: "{ uid: string; name: string }",
        description: "Stamped with the importing user by the write seam; never from the source.",
        examples: [{ uid: "u1", name: "Importer" }, { uid: "seed", name: "Seed" }],
        aliases: []
      }
    ]
  },
  coverage: {
    entity: "coverage",
    idField: "refId",
    description: "A coverage or (when a sub-coverage column is populated) a sub-coverage linked by parentId.",
    fields: [
      {
        field: "refId",
        role: "stored",
        type: "string | null",
        description: "Coverage traceability id; preserved verbatim. Sub-coverages carry a parent segment.",
        examples: ["GL.COV.002", "GL.COV.001.001", "IM.COV044.00", "PR.COV001.0", "CORE.COV.001"],
        aliases: ["PRODUCT FRAMEWORK ID", "FRAMEWORK ID", "ID", "REQUIREMENT ID", "REQUIREMENTID", "COV ID", "COVERAGE ID"]
      },
      {
        field: "description",
        role: "stored",
        type: "string | undefined",
        description: "Plain-English description of the coverage; free text.",
        examples: ["Covers bodily injury liability to third parties.", "Covers direct physical loss to covered property."],
        aliases: ["DESCRIPTION", "COVERAGE DESCRIPTION"]
      },
      {
        field: "name",
        role: "stored",
        type: "string",
        description: "Coverage name (the sub-coverage name when a sub-coverage column is populated).",
        examples: ["Bodily Injury (Premises Operations)", "Coverage A \u2014 Dwelling"],
        aliases: ["COVERAGE", "COVERAGE NAME", "SUB-COVERAGE", "SUB COVERAGE", "SUB- COVERAGE", "SUBCOVERAGE"]
      },
      {
        field: "coverageName",
        role: "source",
        type: "string",
        mapsTo: "name",
        description: "Top-level coverage name column.",
        examples: ["Wrongful Acts Coverage", "Coverage C \u2014 Personal Property"],
        aliases: ["COVERAGE", "COVERAGE NAME"]
      },
      {
        field: "subCoverageName",
        role: "source",
        type: "string",
        mapsTo: "name",
        description: "Sub-coverage name column; when populated the row is a child and implies a parentId. Header punctuation varies wildly.",
        examples: ["Terrorism Coverage", "Scheduled Personal Property"],
        aliases: ["SUB-COVERAGE", "SUB COVERAGE", "SUB- COVERAGE", "SUBCOVERAGE"]
      },
      {
        field: "parentId",
        role: "derived",
        type: "string | null",
        description: "null for top-level; for a sub-coverage, the parent coverage refId (the id minus its last dot-segment).",
        examples: ["GL.COV.001", "PH.COV.003", null],
        aliases: []
      },
      {
        field: "order",
        role: "derived",
        type: "number",
        description: "Sibling display order, assigned in source-row order within each parent.",
        examples: [1, 2],
        aliases: []
      },
      {
        field: "requirement",
        role: "stored",
        type: "'MANDATORY' | 'OPTIONAL' | 'UNKNOWN'",
        enumValues: ["MANDATORY", "OPTIONAL", "UNKNOWN"],
        description: "Whether the coverage is mandatory or optional. UNKNOWN when the source does not establish it (F14) \u2014 never a guessed value.",
        examples: ["Mandatory", "Optional"],
        aliases: ["COVERAGE REQUIREMENT", "REQUIREMENT", "MANDATORY/ OPTIONAL", "MANDATORY / OPTIONAL"]
      },
      {
        field: "claimsBasis",
        role: "stored",
        type: "string",
        description: "Coverage trigger basis; normalised to Occurrence / Claims-made.",
        examples: ["Occurrence", "Claims-made", "Claims - Made"],
        aliases: ["CLAIMS BASIS", "CLAIMS\nBASIS", "TRIGGER"]
      },
      {
        field: "premiumGenerating",
        role: "stored",
        type: "boolean | null",
        description: 'Whether the coverage generates premium. Header may or may not carry a trailing "?". null when the source does not state premium treatment (F14) \u2014 never a guessed boolean.',
        examples: ["Yes", "No"],
        aliases: ["PREMIUM GENERATING", "PREMIUM GENERATING?"]
      },
      SOURCE_FIELD,
      BUREAU_FLAG_FIELD,
      PROPRIETARY_FLAG_FIELD,
      {
        field: "formNumbers",
        role: "stored",
        type: "string[]",
        description: 'Form numbers attaching this coverage. AMBIGUOUS: "COVERAGE FORM(S)" holds form TITLES in ISO GL but form NUMBERS in some IM/PR books \u2014 disambiguate by cell content (form-number pattern vs prose title), not header.',
        examples: [["CG 21 70", "CG 21 87"], ["HO 00 03"]],
        aliases: ["FORM NUMBER(S)", "FORM NUMBER", "FORM NUMBERS", "COVERAGE FORM", "COVERAGE FORM(S)"],
        ambiguous: true
      },
      {
        field: "coverageFormTitles",
        role: "source",
        type: "string (surfaced, not stored)",
        description: "Form TITLE column that sits alongside the form-number column in ISO books; surfaced as unmapped and NEVER merged into formNumbers.",
        examples: ["Cap On Losses From Certified Acts Of Terrorism", "Commercial General Liability"],
        aliases: ["COVERAGE FORM(S)", "COVERAGE FORM"],
        ambiguous: true
      },
      {
        field: "terms",
        role: "derived",
        type: "CoverageTerm[]",
        description: "Limit / deductible / option terms, assembled from the coverage row plus the LD tables and rules that reference it.",
        examples: [{ kind: "LIMIT", label: "Each Occurrence Limit" }, { kind: "DEDUCTIBLE", label: "BI/PD Deductible" }],
        aliases: ["LIMIT", "DEDUCTIBLE", "AVAILABLE LIMITS"]
      },
      STATUS_FIELD,
      LIFECYCLE_FIELD,
      REVIEW_FIELD,
      ...STATE_SCOPE_FIELDS
    ]
  },
  form: {
    entity: "form",
    idField: "number",
    description: "A policy form / endorsement. Identity is (form number, edition date when stated) \u2014 first principles \xA75.2: distinct editions are legally distinct documents. Number-only references (coverage/rule formNumbers) resolve to ALL editions of that number (attachment semantics). Forms are a shared library.",
    fields: [
      {
        field: "number",
        role: "stored",
        type: "string",
        description: "Form number; preserved verbatim including embedded spaces.",
        examples: ["CG 00 01", "HO 00 03", "CP 00 10"],
        aliases: ["FORM NUMBER", "FORM NUMBER(S)", "FORM NO", "FORM #"]
      },
      {
        field: "name",
        role: "stored",
        type: "string",
        description: "Form / endorsement name.",
        examples: ["Commercial General Liability Coverage Form", "Homeowners 3 \u2013 Special Form"],
        aliases: ["FORM NAME", "NAME"]
      },
      {
        field: "edition",
        role: "stored",
        type: "string",
        description: "Form edition date (typically MM YY).",
        examples: ["04 13", "05 11"],
        aliases: ["FORM EDITION DATE (MM YY)", "FORM EDITION DATE", "EDITION DATE", "EDITION"]
      },
      {
        field: "effectiveDate",
        role: "stored",
        type: "string | undefined",
        description: "Date the form version becomes effective.",
        examples: ["10 25", "01 01 2024"],
        aliases: ["FORM EFFECTIVE DATE", "EFFECTIVE DATE"]
      },
      {
        field: "expirationDate",
        role: "stored",
        type: "string | undefined",
        description: "Date the form version expires.",
        examples: ["12 31 9999", "12 99"],
        aliases: ["FORM EXPIRATION DATE", "EXPIRATION DATE"]
      },
      {
        field: "category",
        role: "stored",
        type: "FormCategory",
        enumValues: ["BASE_COVERAGE", "DECLARATIONS", "ENDORSEMENT", "EXCLUSION", "AMENDATORY", "POLICY_NOTICE"],
        description: "Form category; the many GL sub-types (Other Coverage Form, Causes Of Loss Form, \u2026) fold onto ENDORSEMENT.",
        examples: ["Base Coverage Form", "Declarations - Primary", "Endorsement"],
        aliases: ["FORM CATEGORY", "CATEGORY"]
      },
      {
        field: "claimsBasis",
        role: "stored",
        type: "string",
        description: "Trigger basis for the form.",
        examples: ["Occurrence", "Claims - Made"],
        aliases: ["CLAIMS BASIS"]
      },
      {
        field: "dynamic",
        role: "stored",
        type: "boolean",
        description: "Whether the form carries fillable dynamic fields.",
        examples: ["Dynamic", "Static"],
        aliases: ["DYNAMIC / STATIC", "DYNAMIC/STATIC"]
      },
      {
        field: "mandatoryDefault",
        role: "stored",
        type: "boolean",
        description: "Whether the form attaches mandatorily by default.",
        examples: ["Mandatory", "Optional"],
        aliases: ["MANDATORY/ OPTIONAL", "MANDATORY / OPTIONAL", "MANDATORY/OPTIONAL"]
      },
      {
        field: "attachmentCondition",
        role: "stored",
        type: "'RULE' | 'NONE'",
        enumValues: ["RULE", "NONE"],
        description: "Whether attachment is governed by a rule or has no additional condition.",
        examples: ["Defined by Rule", "No Additional Conditions"],
        aliases: ["ATTACHMENT CONDITION"]
      },
      SOURCE_FIELD,
      BUREAU_FLAG_FIELD,
      PROPRIETARY_FLAG_FIELD,
      {
        field: "admitted",
        role: "stored",
        type: "boolean",
        description: "Admitted vs non-admitted (surplus lines) filing.",
        examples: ["Admitted", "Non-Admitted"],
        aliases: ["ADMITTED / NON-ADMITTED", "ADMITTED/NON-ADMITTED", "ADMITTED"]
      },
      {
        field: "displayOnSchedule",
        role: "stored",
        type: "boolean",
        description: "Whether the form shows on the forms schedule.",
        examples: ["Yes", "No"],
        aliases: ["DISPLAY ON FORMS SCHEDULE", "DISPLAY ON SCHEDULE"]
      },
      {
        field: "multiUse",
        role: "stored",
        type: "boolean",
        description: "Single-use vs multi-use form.",
        examples: ["Single Use", "Multi Use"],
        aliases: ["SINGLE OR MULTI-USE", "SINGLE OR MULTI USE"]
      },
      {
        field: "transactions",
        role: "stored",
        type: "string[]",
        description: 'Transaction types the form applies to (grouped "X" columns under a TRANSACTIONS band).',
        examples: [["SUBMISSION", "RENEWAL"], ["ENDORSEMENT"]],
        aliases: ["TRANSACTIONS", "SUBMISSION", "RENEWAL", "ENDORSEMENT", "CANCELLATION"]
      },
      {
        field: "coverageParts",
        role: "stored",
        type: "string[]",
        description: 'Coverage parts the form belongs to (grouped "X" columns under a COVERAGE PART band).',
        examples: [["COMMERCIAL GENERAL LIABILITY"], ["LIQUOR LIABILITY"]],
        aliases: ["COVERAGE PART", "COMMERCIAL GENERAL LIABILITY", "LIQUOR LIABILITY", "POLLUTION"]
      },
      {
        field: "productRefIds",
        role: "derived",
        type: "string[]",
        description: "The product(s)/coverage refIds this form links back to (from the id column).",
        examples: [["GL.PROD.001"], ["GL.COV.002", "GL.COV.003"]],
        aliases: ["PRODUCT FRAMEWORK ID", "FRAMEWORK ID"]
      },
      {
        field: "description",
        role: "system",
        type: "string",
        description: "AI-generated plain-English description; cached, never taken from the source.",
        examples: ["", "Extends coverage to certified acts of terrorism."],
        aliases: []
      },
      {
        field: "dynamicFields",
        role: "derived",
        type: "DynamicField[]",
        description: "Dynamic fields assembled from the Dynamic Data sheet, keyed by form number.",
        examples: [[], [{ name: "Rating Date", dataType: "DATE" }]],
        aliases: ["DYNAMIC DATA"]
      },
      STATUS_FIELD,
      LIFECYCLE_FIELD,
      REVIEW_FIELD,
      ...STATE_SCOPE_FIELDS
    ]
  },
  dynamicField: {
    entity: "dynamicField",
    description: 'One fillable field on a dynamic form, from the "Dynamic Data" sheet.',
    fields: [
      {
        field: "formNumber",
        role: "source",
        type: "string",
        mapsTo: "form.number",
        description: "The form number this dynamic field belongs to.",
        examples: ["CG 01 13", "CG 01 39"],
        aliases: ["FORM NUMBER"]
      },
      {
        field: "name",
        role: "stored",
        type: "string",
        description: "Dynamic field name.",
        examples: ["Rating Date", "Residential Fuel Tank Aggregate Limit"],
        aliases: ["DYNAMIC FIELD NAME", "FIELD NAME"]
      },
      {
        field: "dataType",
        role: "stored",
        type: "DynamicFieldType",
        enumValues: ["TEXT", "CURRENCY", "DATE", "LIST", "PERCENT"],
        description: "Field data type; Number/Alphanumeric/Address fold onto TEXT.",
        examples: ["Date", "Currency", "Number"],
        aliases: ["DATA TYPE"]
      },
      {
        field: "repeating",
        role: "stored",
        type: "boolean",
        description: "Whether the field repeats (a list of entries).",
        examples: ["Yes", "No"],
        aliases: ["REPEATING FIELD", "REPEATING"]
      },
      {
        field: "options",
        role: "stored",
        type: "string[]",
        description: "Allowed values for a LIST-type field (empty when none).",
        examples: [[], ["Named Perils", "Special Form"]],
        aliases: ["ALLOWED VALUES", "OPTIONS", "LIST VALUES"]
      },
      {
        field: "notes",
        role: "stored",
        type: "string | undefined",
        description: "Free-text note on the dynamic field.",
        examples: ["", "Bound to declarations."],
        aliases: ["NOTES", "COMMENTS"]
      },
      {
        field: "effectiveDate",
        role: "stored",
        type: "string | undefined",
        description: "Date the dynamic field becomes active on the form.",
        examples: ["10 25", "01 24"],
        aliases: ["EFFECTIVE DATE OF DYNAMIC FIELD", "FIELD EFFECTIVE DATE", "EFFECTIVE DATE"]
      },
      {
        field: "expirationDate",
        role: "stored",
        type: "string | undefined",
        description: "Date the dynamic field expires on the form.",
        examples: ["12 99", "12 31 9999"],
        aliases: ["EXPIRATION DATE OF DYNAMIC FIELD", "FIELD EXPIRATION DATE", "EXPIRATION DATE"]
      }
    ]
  },
  ratingProgram: {
    entity: "ratingProgram",
    idField: "refId",
    description: "The rating program (algorithm) for a line, assembled from the rating specification sheet.",
    fields: [
      {
        field: "refId",
        role: "derived",
        type: "string",
        description: 'Program refId, collapsed from the rating step ids (e.g. "GL.RAT.1.05" \u2192 "GL.RAT.1"; Property \u2192 "PR.ROC").',
        examples: ["GL.RAT.1", "PR.ROC"],
        aliases: ["PRODUCT FRAMEWORK ID", "RATING STEP ID"]
      },
      {
        field: "name",
        role: "derived",
        type: "string",
        description: 'Program name; defaults to "<line> Rating Program".',
        examples: ["Commercial General Liability Rating Program", "Property Rate Order of Calculations"],
        aliases: ["RATING GROUPING", "RATING CATEGORY"]
      },
      {
        field: "minimumPremium",
        role: "stored",
        type: "number",
        description: "Program minimum premium (0 when the source states none).",
        examples: [500, 0],
        aliases: ["MINIMUM PREMIUM", "MIN PREMIUM", "POLICY MINIMUM PREMIUM"]
      },
      {
        field: "steps",
        role: "derived",
        type: "RatingStep[]",
        description: "Ordered rating steps built from the rating rows.",
        examples: [{ id: "GL.RAT.1.00", op: "SET" }, { id: "GL.RAT.1.05", op: "MUL" }],
        aliases: ["ALGORITHM STEP", "RATING RULES"]
      },
      {
        field: "creditFloor",
        role: "stored",
        type: "number | undefined",
        description: `Optional maximum-credit cap (e.g. a filing's "Rule 92 maximum total credit 50%"); floors the cumulative credit product.`,
        examples: [0.5, 0.6],
        aliases: ["MAXIMUM CREDIT", "MAXIMUM CREDITS", "MAX CREDITS", "RULE 92"]
      },
      ...STATE_SCOPE_FIELDS
    ]
  },
  ratingStep: {
    entity: "ratingStep",
    idField: "id",
    description: 'One step of a rating algorithm. Property ROC ships blank/"TBD" step ids \u2192 synthesized via the LOB RefIdScheme.',
    fields: [
      {
        field: "id",
        role: "stored",
        type: "string",
        description: 'Step id, verbatim; synthesized in the line shape when the source ships "TBD".',
        examples: ["GL.RAT.1.00", "GL.RAT.1.05", "PR.ROC.001"],
        aliases: ["RATING STEP ID", "STEP ID"]
      },
      {
        field: "order",
        role: "derived",
        type: "number",
        description: "Execution order, assigned in source-row order.",
        examples: [1, 5],
        aliases: []
      },
      {
        field: "label",
        role: "stored",
        type: "string",
        description: 'Human label for the step (from the algorithm-step / rating-rules text). Present on sheets that have an "ALGORITHM STEP" column.',
        examples: ["Base Rate", "Increased Limit Factor"],
        aliases: ["ALGORITHM STEP", "RATING RULES", "RATING GROUPING"]
      },
      {
        field: "description",
        role: "stored",
        type: "string | undefined",
        description: 'Plain-English description of the step, from a "Rule Description" or "Description" column alongside the Algorithm Step column. Observed in Core-format rating sheets.',
        examples: ["Apply the base rate from the territory table", "Multiply by the increased limit factor"],
        aliases: ["RULE DESCRIPTION", "DESCRIPTION", "STEP DESCRIPTION", "ALGORITHM DESCRIPTION"]
      },
      {
        field: "coverageRef",
        role: "source",
        type: "string | undefined",
        mapsTo: "coverageRef",
        description: 'Coverage name / grouping label for this step, from the "Coverage" or "Coverage Group" column in Core-format rating sheets. Groups steps by coverage (e.g. "Bodily Injury", "Property Damage").',
        examples: ["Bodily Injury", "Property Damage", "Personal Property"],
        aliases: ["COVERAGE", "COVERAGE NAME", "COVERAGE GROUP", "COVERAGE GROUPING"]
      },
      {
        field: "op",
        role: "stored",
        type: "'SET' | 'MUL' | 'ADD' | 'MIN_FLOOR'",
        enumValues: ["SET", "MUL", "ADD", "MIN_FLOOR"],
        description: 'The arithmetic operation, from the calculation operator ("="\u2192SET, "+"/"-"\u2192ADD, "*"/"/"\u2192MUL).',
        examples: ["=", "*", "+"],
        aliases: ["CALCULATION", "OPERATION", "OPERATOR"]
      },
      {
        field: "source.ref",
        role: "source",
        type: "string",
        mapsTo: "source",
        description: "Rate reference \u2014 resolves onto an RT table refId (by name when a free-text label is given).",
        examples: ["RTTable.001", "Increase Limit Factor Table"],
        aliases: ["RATE REFERENCE", "RATE TABLE", "RATE REFERENCE ID"]
      },
      {
        field: "roundTo",
        role: "stored",
        type: "number | undefined",
        description: 'Decimal places to round the running total after this step ("Nearest dollar" \u2192 0).',
        examples: [0, 4],
        aliases: ["ROUNDING NUMBER OF DIGITS", "ROUNDING", "ROUNDING NUMBER OF DIGITIS"]
      },
      {
        field: "condition",
        role: "stored",
        type: "string | undefined",
        description: "Name of a boolean input that gates the step (falsy \u2192 skipped).",
        examples: ["pcoElected", "windHailElected"],
        aliases: ["RATING RULES", "CONDITION"]
      },
      {
        field: "isCredit",
        role: "stored",
        type: "boolean | undefined",
        description: "Marks the step as a credit factor for the program-level maximum-credit cap.",
        examples: [true, false],
        aliases: ["CREDIT", "IS CREDIT"]
      },
      {
        field: "manualRuleId",
        role: "source",
        type: "string (surfaced)",
        description: "State-manual rule/step reference; surfaced for provenance, not stored on the step.",
        examples: ["Rule 4.1, Step 3", "Base Rate"],
        aliases: ["RATING MANUAL RULE/ STEP ID", "RATING MANUAL RULE/STEP ID", "MANUAL RULE/ STEP ID"]
      }
    ]
  },
  rtTable: {
    entity: "rtTable",
    idField: "refId",
    description: "A rate table (layout preserved as-is; lookup logic lives in the line getter).",
    fields: [
      {
        field: "refId",
        role: "stored",
        type: "string",
        description: "Rate table id, verbatim.",
        examples: ["RTTable.001", "RTTable.008"],
        aliases: ["RATE TABLE ID", "RT TABLE ID"]
      },
      {
        field: "name",
        role: "stored",
        type: "string",
        description: "Rate table name.",
        examples: ["INCREASE LIMIT FACTOR", "Territory Base Rates"],
        aliases: ["RATE TABLE NAME", "TABLE NAME"]
      },
      {
        field: "columns",
        role: "derived",
        type: "string[]",
        description: "Column headers, in order.",
        examples: [["COVERAGE", "PER OCCURRENCE", "AGGREGATE", "ILF"], ["Territory", "Base Rate"]],
        aliases: ["COLUMN HEADERS"]
      },
      {
        field: "rows",
        role: "derived",
        type: "Record<string, unknown>[]",
        description: "Row records keyed by column header; numbers coerced.",
        examples: [{ COVERAGE: "Prem/Ops", ILF: 1 }, { Territory: "T001", "Base Rate": 700 }],
        aliases: []
      },
      {
        field: "dimensions",
        role: "derived",
        type: "RTTableDimension[] | undefined",
        description: "Optional grid-editor lookup-key descriptors (additive; absent on legacy tables).",
        examples: [{ key: "occLimit" }, { key: "territory" }],
        aliases: ["DIMENSION", "LOOKUP KEY"]
      },
      {
        field: "valueColumn",
        role: "derived",
        type: "string | undefined",
        description: "The column holding the factor/rate (inferred when absent).",
        examples: ["ILF", "Base Rate"],
        aliases: ["ILF", "RATE", "FACTOR", "VALUE"]
      }
    ]
  },
  ldTable: {
    entity: "ldTable",
    idField: "refId",
    description: 'A limits & deductibles option table (stacked blocks under a "Limits and Deductibles" sheet).',
    fields: [
      {
        field: "refId",
        role: "stored",
        type: "string",
        description: 'LD table id, verbatim (the "LDTable.NNN" marker cell).',
        examples: ["LDTable.001", "LDTable.008"],
        aliases: ["LD TABLE ID", "LDTABLE", "RULE ID"]
      },
      {
        field: "name",
        role: "stored",
        type: "string",
        description: 'LD table name (the cell after "TABLE NAME:").',
        examples: ["Occurrence Limits", "Policy Claims Basis"],
        aliases: ["TABLE NAME"]
      },
      {
        field: "defaultValue",
        role: "derived",
        type: "number | undefined",
        description: 'The default option, detected from a "Default" comment on a row.',
        examples: [3e5, 1e3],
        aliases: ["DEFAULT", "DEFAULT VALUE"]
      },
      {
        field: "rows.value",
        role: "derived",
        type: "number",
        mapsTo: "rows",
        description: "Each available limit / deductible option value.",
        examples: [25e3, 3e5],
        aliases: ["AVAILABLE LIMITS", "AVAILABLE DEDUCTIBLES", "LIMITS", "DEDUCTIBLES", "TYPE", "VALUE"]
      },
      {
        field: "rows.constraintNote",
        role: "derived",
        type: "string | undefined",
        mapsTo: "rows",
        description: "Per-row comment / constraint note.",
        examples: ["Default", "Available when higher"],
        aliases: ["COMMENTS", "COMMENT", "NOTES"]
      }
    ]
  },
  rule: {
    entity: "rule",
    idField: "refId",
    description: "A product / rating / forms rule (condition \u2192 outcome), from the rules specification sheet.",
    fields: [
      {
        field: "refId",
        role: "stored",
        type: "string | null",
        description: 'Rule id, verbatim. The rule token is line-specific (GL "RU", IM "RL").',
        examples: ["GL.RU.001", "GL.RU.006", "IM.RL.001", "PR.RU.001"],
        aliases: ["RULE ID"]
      },
      {
        field: "category",
        role: "stored",
        type: "RuleCategory",
        enumValues: ["PRODUCT", "RATING", "FORMS"],
        description: "Rule category.",
        examples: ["Product", "Rating", "Forms"],
        aliases: ["RULE CATEGORY"]
      },
      {
        field: "subCategory",
        role: "stored",
        type: "string",
        description: "Rule sub-category.",
        examples: ["Base Coverage (Default)", "Limit Ranges and Defaults"],
        aliases: ["RULE SUB-CATEGORY", "RULE SUB CATEGORY", "SUB-CATEGORY"]
      },
      {
        field: "condition",
        role: "stored",
        type: "string",
        description: 'The rule condition ("If \u2026").',
        examples: ["If Monoline Commercial General Liability is selected", "If Condominiums is selected"],
        aliases: ["RULE CONDITION", "CONDITION"]
      },
      {
        field: "outcome",
        role: "stored",
        type: "string",
        description: 'The rule outcome ("Then \u2026").',
        examples: ["Then Bodily Injury/Property Damage Coverage is available and mandatory", "Then available and mandatory"],
        aliases: ["RULE OUTCOME", "OUTCOME"]
      },
      {
        field: "ldTableRef",
        role: "derived",
        type: "string | undefined",
        description: "LD/RT table ref pulled from the free-text rule-reference cell.",
        examples: ["LDTable.008", "LDTable.001"],
        aliases: ["RULE REFERENCE", "RATE REFERENCE", "REFERENCE"]
      },
      {
        field: "coverageRefIds",
        role: "source",
        type: "string[]",
        mapsTo: "coverageRefIds",
        description: "Coverage refIds the rule applies to (multi-line id cell splits on newlines).",
        examples: [["GL.COV.002", "GL.COV.003"], ["PH.COV.005", "PH.COV.006"]],
        aliases: ["PRODUCT FRAMEWORK ID", "COVERAGE"]
      },
      {
        field: "formNumbers",
        role: "stored",
        type: "string[]",
        description: "Form numbers referenced by the rule.",
        examples: [["CG 00 01"], ["HO 04 48"]],
        aliases: ["FORM NUMBER", "FORM NUMBER(S)"]
      },
      STATUS_FIELD,
      LIFECYCLE_FIELD,
      REVIEW_FIELD,
      ...STATE_SCOPE_FIELDS
    ]
  },
  formRule: {
    entity: "formRule",
    idField: "refId",
    description: "A forms-attachment rule (from the optional forms rules sheet).",
    fields: [
      {
        field: "refId",
        role: "stored",
        type: "string | null",
        description: "Form-rule id, verbatim.",
        examples: ["GL.FORM.RU.001", "GL.FORM.RU.007"],
        aliases: ["FORM RULE ID", "RULE ID"]
      },
      {
        field: "condition",
        role: "stored",
        type: "string",
        description: 'The attachment condition ("If \u2026").',
        examples: ["If Pollution Liability Coverage Form Designated Sites is selected", "If Condominiums is selected"],
        aliases: ["RULE CONDITION", "CONDITION"]
      },
      {
        field: "outcome",
        role: "stored",
        type: "string",
        description: 'The attachment outcome ("Then \u2026").',
        examples: ['Then "\u2026" is available and mandatory', "Then available and optional"],
        aliases: ["RULE OUTCOME", "OUTCOME"]
      },
      {
        field: "formNumbers",
        role: "stored",
        type: "string[]",
        description: "Form numbers the rule governs (duplicate ids merge their form sets).",
        examples: [["CG 00 39"], ["CG 01 27", "CG 01 28"]],
        aliases: ["FORM NUMBER", "FORM NUMBER(S)"]
      },
      {
        field: "mandatory",
        role: "derived",
        type: "boolean",
        description: "Whether the outcome makes the form mandatory (derived from the outcome text).",
        examples: [true, false],
        aliases: ["MANDATORY", "MANDATORY/ OPTIONAL"]
      },
      STATUS_FIELD,
      LIFECYCLE_FIELD,
      REVIEW_FIELD
    ]
  }
};
var SURFACED_COLUMNS = [
  { column: "COVERAGE SCOPE", note: "IM/PR extra: descriptive coverage scope text." },
  { column: "COVERAGE EFFECT", note: "IM/PR extra: coverage effect classification." },
  { column: "SOURCE", note: "Provenance column distinct from bureau/proprietary flags." },
  { column: "RULE EFFECTIVE DATE", note: "Rule effectivity window; not modelled on Rule." },
  { column: "RULE EXPIRATION DATE", note: "Rule expiry window; not modelled on Rule." },
  { column: "FORM EFFECTIVE DATE", note: "Form effectivity window; not modelled on Form." },
  { column: "FORM EXPIRATION DATE", note: "Form expiry window; not modelled on Form." },
  { column: "EFFECTIVE DATE OF DYNAMIC FIELD", note: "Dynamic-field effectivity; not modelled on DynamicField." },
  { column: "EXPIRATION DATE OF DYNAMIC FIELD", note: "Dynamic-field expiry; not modelled on DynamicField." },
  { column: "MARKET SEGMENT", note: "Forms-sheet band; captured on product.marketSegment only." },
  { column: "MIDDLE MARKET", note: "Forms-sheet market band flag." },
  { column: "INTERLINE FORM", note: "Forms-sheet interline flag." },
  { column: "RATING MANUAL RULE/ STEP ID", note: "State-manual reference surfaced for provenance." },
  { column: "RULES REVIEWER", note: "Reviewer name; workflow metadata." },
  { column: "DATE REVIEW COMPLETED", note: "Review completion date; workflow metadata." }
];
var CANONICAL_ENTITY_KINDS = Object.keys(CANONICAL_MAP);

// shared/src/import/structure/sentinels.ts
var NULL_STRINGS = /* @__PURE__ */ new Set([
  "<placeholder>",
  "<intentionally left blank>",
  "n/a",
  "na",
  "tbd",
  "(none)",
  "none",
  "-",
  "--",
  ""
]);
function normalizeCellValue(value) {
  if (value === null || value === void 0) return null;
  if (value instanceof Date) {
    if (value.getFullYear() >= 9999) return "NO_EXPIRY";
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "9999-12-31") return "NO_EXPIRY";
    if (NULL_STRINGS.has(trimmed.toLowerCase())) return null;
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    const o = value;
    if (Array.isArray(o["richText"])) {
      const text2 = o["richText"].map((t) => t.text ?? "").join("");
      return normalizeCellValue(text2);
    }
    if ("result" in o) return normalizeCellValue(o["result"]);
    if ("text" in o && o["text"] !== void 0) return normalizeCellValue(String(o["text"]));
    if ("hyperlink" in o) return normalizeCellValue(String(o["text"] ?? o["hyperlink"] ?? ""));
    if ("error" in o) return null;
  }
  return null;
}

// shared/src/import/structure/layoutDetector.ts
var US_STATE_CODES = /* @__PURE__ */ new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DC",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY"
]);
var ALL_STATES_LABELS = /* @__PURE__ */ new Set([
  "ALL ACTIVE STATES",
  "ALL STATES",
  "STATE APPLICABILITY",
  "ALL"
]);
var STACKED_MARKER_PATTERNS = [
  /RATE\s+TABLE\s+ID\s*:/i,
  /^(RTTable)\.\d+$/i,
  /^LD\s*TABLE\s+ID\s*:/i,
  /^(LDTable)\.\d+$/i
];
var TABLE_NAME_SENTINEL_PATTERN = /^TABLE\s+NAME\s*:/i;
function rowMatchesStackedMarker(row2) {
  for (let c = 0; c < Math.min(row2.length, 3); c++) {
    const v = row2[c];
    if (typeof v === "string" && v.trim().length > 0) {
      if (STACKED_MARKER_PATTERNS.some((p) => p.test(v.trim()))) return true;
    }
  }
  return false;
}
function hasStackedTableMarkers(cells) {
  let count = 0;
  for (const row2 of cells) {
    if (rowMatchesStackedMarker(row2)) {
      if (++count >= 2) return true;
    }
  }
  return false;
}
function hasTableNameOnlyMarkers(cells) {
  if (hasStackedTableMarkers(cells)) return false;
  let count = 0;
  for (const row2 of cells) {
    for (let c = 0; c < Math.min(row2.length, 2); c++) {
      const v = row2[c];
      if (typeof v === "string" && TABLE_NAME_SENTINEL_PATTERN.test(v.trim())) {
        if (++count >= 2) return true;
        break;
      }
    }
  }
  return false;
}
function hasWideStateColumns(headerRow) {
  let count = 0;
  for (const v of headerRow) {
    if (typeof v !== "string") continue;
    const upper = v.trim().toUpperCase();
    if (US_STATE_CODES.has(upper) || ALL_STATES_LABELS.has(upper)) {
      if (++count >= 3) return true;
    }
  }
  return false;
}
function hasIndentedHierarchy(cells, bestHeaderRow) {
  const startRow = Math.max(0, bestHeaderRow + 1);
  let total = 0;
  let indented = 0;
  for (let r = startRow; r < cells.length; r++) {
    const row2 = cells[r] ?? [];
    const hasAny = row2.some((v) => v !== null && v !== "" && v !== void 0);
    if (!hasAny) continue;
    total++;
    const col0Empty = row2[0] === null || row2[0] === "" || row2[0] === void 0;
    const col1Filled = typeof row2[1] === "string" && (row2[1]?.trim().length ?? 0) > 0;
    if (col0Empty && col1Filled) indented++;
  }
  return total >= 4 && indented / total >= 0.2;
}
function detectLayoutShape(cells, bestHeaderRow) {
  if (hasStackedTableMarkers(cells) || hasTableNameOnlyMarkers(cells)) return "STACKED_TABLES";
  const headerRow = bestHeaderRow >= 0 ? cells[bestHeaderRow] ?? [] : [];
  if (hasWideStateColumns(headerRow)) return "WIDE_MATRIX";
  if (hasIndentedHierarchy(cells, bestHeaderRow)) return "INDENTED_HIERARCHY";
  return "FLAT_TABLE";
}

// shared/src/import/structure/columnProfiler.ts
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{2}\s+\d{2}$|^\d{1,2}-\d{1,2}-\d{2,4}$/;
var DOLLAR_PATTERN = /^\$[\d,]+(\.\d{0,2})?$|^[\d]{1,3}(,\d{3})+$/;
var MAX_DISTINCT_SAMPLE = 20;
var ENUM_MAX_DISTINCT = 20;
var ENUM_RATIO_CAP = 0.35;
function profileColumns(cells, bestHeaderRow) {
  if (cells.length === 0) return [];
  const headerRow = bestHeaderRow >= 0 ? cells[bestHeaderRow] ?? [] : [];
  const dataStart = bestHeaderRow >= 0 ? bestHeaderRow + 1 : 0;
  const dataRows = cells.slice(dataStart);
  if (dataRows.length === 0) return [];
  const colCount = cells.reduce((m, r) => Math.max(m, r.length), 0);
  const profiles = [];
  for (let c = 0; c < colCount; c++) {
    const headerLabel = typeof headerRow[c] === "string" ? headerRow[c].trim() || null : null;
    const typeMix = {
      text: 0,
      number: 0,
      date: 0,
      boolean: 0,
      empty: 0,
      sentinel: 0
    };
    const distinctSet = /* @__PURE__ */ new Set();
    const sample = [];
    let totalDataCells = 0;
    for (const row2 of dataRows) {
      const v = row2[c];
      totalDataCells++;
      if (v === null || v === void 0 || v === "") {
        typeMix.empty++;
        continue;
      }
      if (v === "NO_EXPIRY") {
        typeMix.sentinel++;
        continue;
      }
      if (typeof v === "boolean") {
        typeMix.boolean++;
      } else if (typeof v === "number") {
        typeMix.number++;
      } else if (typeof v === "string") {
        if (DATE_PATTERN.test(v)) typeMix.date++;
        else typeMix.text++;
      }
      if (!distinctSet.has(v)) {
        distinctSet.add(v);
        if (sample.length < MAX_DISTINCT_SAMPLE) sample.push(v);
      }
    }
    const nonEmpty = totalDataCells - typeMix.empty;
    const isEnumLike = distinctSet.size <= ENUM_MAX_DISTINCT && nonEmpty > 0 && (distinctSet.size <= 5 || distinctSet.size / nonEmpty <= ENUM_RATIO_CAP);
    const hasDatePattern = typeMix.date > 0 || sample.some((v) => typeof v === "string" && DATE_PATTERN.test(v));
    const hasDollarPattern = sample.some((v) => typeof v === "string" && DOLLAR_PATTERN.test(v)) || typeMix.number > 0 && sample.some((v) => typeof v === "number" && v >= 100 && v % 1 === 0);
    profiles.push({
      colIndex: c,
      headerLabel,
      typeMix,
      totalDataCells,
      distinctSample: sample,
      isEnumLike,
      hasDatePattern,
      hasDollarPattern
    });
  }
  return profiles;
}

// shared/src/import/structure/definitionsParser.ts
function isDefinitionsSheetName(name) {
  return /definition|glossary/i.test(name);
}
var TERM_LABELS = /* @__PURE__ */ new Set([
  "COLUMN NAME",
  "COLUMN HEADER",
  "FIELD NAME",
  "DATA ELEMENT",
  "TERM",
  "FIELD",
  "COLUMN",
  "NAME",
  "ITEM",
  "ATTRIBUTE"
]);
var DESC_LABELS = /* @__PURE__ */ new Set([
  "DEFINITION",
  "DESCRIPTION",
  "MEANING",
  "NOTES",
  "NOTE",
  "EXPLANATION",
  "COLUMN DESCRIPTION"
]);
var EXAMPLE_LABELS = /* @__PURE__ */ new Set([
  "EXAMPLE",
  "EXAMPLES",
  "SAMPLE",
  "SAMPLE VALUES",
  "POSSIBLE VALUES",
  "VALUES"
]);
function parseDefinitionsSheet(cells) {
  if (cells.length === 0) return [];
  let termCol = -1;
  let descCol = -1;
  let exampleCol = -1;
  let headerRow = -1;
  for (let r = 0; r < Math.min(10, cells.length); r++) {
    const row2 = cells[r] ?? [];
    let ft = -1, fd = -1, fe = -1;
    for (let c = 0; c < row2.length; c++) {
      const v = row2[c];
      if (typeof v !== "string") continue;
      const upper = v.trim().toUpperCase();
      if (TERM_LABELS.has(upper) && ft < 0) ft = c;
      if (DESC_LABELS.has(upper) && fd < 0) fd = c;
      if (EXAMPLE_LABELS.has(upper) && fe < 0) fe = c;
    }
    if (ft >= 0 && fd < 0 && fe >= 0) {
      for (let c = 0; c < row2.length; c++) {
        if (c !== ft && c !== fe) {
          fd = c;
          break;
        }
      }
    }
    if (ft >= 0 && fd >= 0) {
      headerRow = r;
      termCol = ft;
      descCol = fd;
      exampleCol = fe;
      break;
    }
  }
  if (headerRow < 0) return [];
  const entries = [];
  for (let r = headerRow + 1; r < cells.length; r++) {
    const row2 = cells[r] ?? [];
    const term = row2[termCol];
    const desc = row2[descCol];
    if (typeof term !== "string" || !term.trim()) continue;
    if (typeof desc !== "string" || !desc.trim()) continue;
    const entry = {
      columnName: term.trim(),
      description: desc.trim()
    };
    if (exampleCol >= 0) {
      const ex = row2[exampleCol];
      if (typeof ex === "string" && ex.trim()) {
        entry.example = ex.trim();
      } else if (typeof ex === "number") {
        entry.example = String(ex);
      }
    }
    entries.push(entry);
  }
  return entries;
}

// shared/src/import/structure/stackedSegmenter.ts
var REF_ID_PATTERNS = [
  /RATE\s+TABLE\s+ID\s*:\s*(RTTable\.\d+)/i,
  /LD\s*TABLE\s+ID\s*:\s*(LDTable\.\d+)/i,
  /^(RTTable\.\d+)$/i,
  /^(LDTable\.\d+)$/i
];
var TABLE_NAME_PATTERN = /TABLE\s+NAME\s*:\s*(.+)/i;
var META_KEY_VALUE_PATTERN = /^([^:]{1,60}):\s*(.*)$/;
function extractRefId(row2) {
  for (let c = 0; c < Math.min(row2.length, 3); c++) {
    const v = row2[c];
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    for (const p of REF_ID_PATTERNS) {
      const m = trimmed.match(p);
      if (m?.[1]) return m[1];
    }
  }
  return void 0;
}
function extractTableName(row2) {
  for (const v of row2) {
    if (typeof v !== "string") continue;
    const m = v.trim().match(TABLE_NAME_PATTERN);
    if (m?.[1]) return m[1].trim();
  }
  return void 0;
}
function parseMetaBlock(rows) {
  const meta = {};
  for (const row2 of rows) {
    for (const v of row2) {
      if (typeof v !== "string") continue;
      const m = v.trim().match(META_KEY_VALUE_PATTERN);
      if (m?.[1] && m[2]?.trim()) {
        meta[m[1].trim().toUpperCase()] = m[2].trim();
      }
    }
    for (let c = 0; c < row2.length - 1; c++) {
      const keyCell = row2[c];
      if (typeof keyCell !== "string") continue;
      if (!/:\s*$/.test(keyCell.trim())) continue;
      const key = keyCell.trim().replace(/:\s*$/, "").trim().toUpperCase();
      if (!key) continue;
      const valCell = row2[c + 1];
      if (typeof valCell === "string" && valCell.trim()) {
        meta[key] = valCell.trim();
      } else if (typeof valCell === "number") {
        meta[key] = String(valCell);
      }
    }
  }
  return meta;
}
function rowMatchesTableNameSentinel(row2) {
  for (let c = 0; c < Math.min(row2.length, 2); c++) {
    const v = row2[c];
    if (typeof v === "string" && TABLE_NAME_SENTINEL_PATTERN.test(v.trim())) return true;
  }
  return false;
}
function segmentStackedTables(cells) {
  const hasPrimary = cells.some((r) => rowMatchesStackedMarker(r ?? []));
  const isMarker = hasPrimary ? rowMatchesStackedMarker : rowMatchesTableNameSentinel;
  const markerRows = [];
  for (let r = 0; r < cells.length; r++) {
    if (isMarker(cells[r] ?? [])) markerRows.push(r);
  }
  if (markerRows.length === 0) return [];
  const subTables = [];
  for (let i = 0; i < markerRows.length; i++) {
    const blockStart = markerRows[i];
    const blockEnd = i + 1 < markerRows.length ? markerRows[i + 1] - 1 : cells.length - 1;
    const metaRows = [];
    let refId = extractRefId(cells[blockStart] ?? []);
    let name;
    metaRows.push(cells[blockStart] ?? []);
    let dataStart = blockStart + 1;
    for (let r = blockStart + 1; r <= blockEnd; r++) {
      const row2 = cells[r] ?? [];
      const rowIsEmpty = row2.every((v) => v === null || v === "" || v === void 0);
      if (rowIsEmpty) continue;
      const tName = extractTableName(row2);
      if (tName) {
        name = tName;
        metaRows.push(row2);
        dataStart = r + 1;
        continue;
      }
      const firstCell = row2[0];
      if (typeof firstCell === "string" && META_KEY_VALUE_PATTERN.test(firstCell.trim())) {
        metaRows.push(row2);
        dataStart = r + 1;
        continue;
      }
      dataStart = r;
      break;
    }
    const metaBlock = parseMetaBlock(metaRows);
    name = name ?? metaBlock["TABLE NAME"] ?? metaBlock["RATE TABLE NAME"] ?? metaBlock["LD TABLE NAME"];
    const dataSlice = cells.slice(dataStart, blockEnd + 1);
    const candidates = scoreHeaderCandidates(dataSlice);
    const subHdrOff = pickBestHeaderRow(candidates);
    const subHdrRow = subHdrOff >= 0 ? dataStart + subHdrOff : dataStart;
    const subCells = cells.slice(subHdrRow, blockEnd + 1);
    const colProfiles = profileColumns(subCells, 0);
    subTables.push({
      name: (name || void 0) ?? (refId || void 0) ?? `Table ${i + 1}`,
      refId,
      startRow: blockStart,
      endRow: blockEnd,
      headerRowIndex: subHdrRow,
      cells: subCells,
      columnProfiles: colProfiles,
      metaBlock
    });
  }
  return subTables;
}

// shared/src/import/structure/wideMatrixFolder.ts
function foldWideMatrix(headerRow) {
  let allStatesColIndex = null;
  const stateColIndices = {};
  let nonStateColCount = 0;
  for (let c = 0; c < headerRow.length; c++) {
    const v = headerRow[c];
    if (typeof v !== "string") {
      nonStateColCount++;
      continue;
    }
    const upper = v.trim().toUpperCase();
    if (ALL_STATES_LABELS.has(upper)) {
      allStatesColIndex = c;
    } else if (US_STATE_CODES.has(upper)) {
      stateColIndices[upper] = c;
    } else if (v.trim().length > 0) {
      nonStateColCount++;
    }
  }
  return { allStatesColIndex, stateColIndices, nonStateColCount };
}

// shared/src/import/structure/modelBuilder.ts
var MAX_EMBED_ROWS = 2e3;
var MAX_EMBED_COLS = 128;
function fingerprintGrid(grid) {
  const rawRowCount = grid.cells.length;
  const rawColCount = grid.cells.reduce((m, r) => Math.max(m, r?.length ?? 0), 0);
  const normalized = grid.cells.map(
    (row2) => (row2 ?? []).map((v) => normalizeCellValue(v))
  );
  let lastRow = -1;
  let lastCol = -1;
  for (let r = 0; r < normalized.length; r++) {
    const row2 = normalized[r];
    for (let c = 0; c < row2.length; c++) {
      if (row2[c] !== null) {
        if (r > lastRow) lastRow = r;
        if (c > lastCol) lastCol = c;
      }
    }
  }
  if (lastRow < 0) {
    return {
      sheetName: grid.sheet,
      rawRowCount,
      rawColCount,
      dataRowCount: 0,
      dataColCount: 0,
      mergedCells: grid.mergedCells ?? [],
      headerCandidates: [],
      bestHeaderRow: -1,
      layoutShape: "FLAT_TABLE",
      columnProfiles: [],
      isDefinitionsSheet: false,
      cells: [],
      cellsTruncated: false
    };
  }
  const cellsTruncated = lastRow + 1 > MAX_EMBED_ROWS || lastCol + 1 > MAX_EMBED_COLS;
  const rowLimit = Math.min(lastRow + 1, MAX_EMBED_ROWS);
  const colLimit = Math.min(lastCol + 1, MAX_EMBED_COLS);
  const cells = [];
  for (let r = 0; r < rowLimit; r++) {
    const src = normalized[r] ?? [];
    const row2 = new Array(colLimit).fill(null);
    for (let c = 0; c < colLimit; c++) row2[c] = src[c] ?? null;
    cells.push(row2);
  }
  const headerCandidates = scoreHeaderCandidates(cells);
  const bhr = pickBestHeaderRow(headerCandidates);
  const layoutShape = detectLayoutShape(cells, bhr);
  const columnProfiles = profileColumns(cells, bhr);
  let subTables;
  if (layoutShape === "STACKED_TABLES") subTables = segmentStackedTables(cells);
  let wideMatrix;
  if (layoutShape === "WIDE_MATRIX") {
    const headerRow = bhr >= 0 ? cells[bhr] ?? [] : [];
    wideMatrix = foldWideMatrix(headerRow);
  }
  const isDefinitionsSheet = isDefinitionsSheetName(grid.sheet);
  const definitions = isDefinitionsSheet ? parseDefinitionsSheet(cells) : void 0;
  return {
    sheetName: grid.sheet,
    rawRowCount,
    rawColCount,
    dataRowCount: lastRow + 1,
    dataColCount: lastCol + 1,
    mergedCells: grid.mergedCells ?? [],
    headerCandidates: headerCandidates.slice(0, 5),
    bestHeaderRow: bhr,
    layoutShape,
    columnProfiles,
    subTables,
    wideMatrix,
    definitions,
    isDefinitionsSheet,
    cells,
    cellsTruncated
  };
}
function buildStructuralModel(grids, sourceName, sourceType) {
  const sheets = [];
  const definitionsBySheet = {};
  for (const grid of grids) {
    const fp = fingerprintGrid(grid);
    sheets.push(fp);
    if (fp.definitions && fp.definitions.length > 0) {
      definitionsBySheet[fp.sheetName] = fp.definitions;
    }
  }
  return { sourceName, sourceType, sheets, definitionsBySheet };
}

// shared/src/insurance/lobRegistry.ts
var pad = (n, w) => String(Math.trunc(Math.abs(n))).padStart(w, "0");
function dottedScheme(code, nameSignals) {
  return {
    shapes: {
      product: `${code}.PROD.###`,
      lob: `${code}.LOB.###`,
      coverage: `${code}.COV.###`,
      subCoverage: `${code}.COV.###.###`,
      rule: `${code}.RU.###`,
      formRule: `${code}.FORM.RU.###`,
      ratingProgram: `${code}.RAT.#`,
      ratingStep: `${code}.RAT.#.##`
    },
    pattern: new RegExp(`^${code}\\.(PROD|LOB|COV|RU|FORM|RAT)`, "i"),
    nameSignals,
    synthesize(kind, seq, parentSeq = 1) {
      switch (kind) {
        case "product":
          return `${code}.PROD.${pad(seq, 3)}`;
        case "lob":
          return `${code}.LOB.${pad(seq, 3)}`;
        case "coverage":
          return `${code}.COV.${pad(seq, 3)}`;
        case "subCoverage":
          return `${code}.COV.${pad(parentSeq, 3)}.${pad(seq, 3)}`;
        case "rule":
          return `${code}.RU.${pad(seq, 3)}`;
        case "formRule":
          return `${code}.FORM.RU.${pad(seq, 3)}`;
        case "ratingProgram":
          return `${code}.RAT.${Math.trunc(seq) || 1}`;
        case "ratingStep":
          return `${code}.RAT.1.${pad(seq, 2)}`;
        default:
          return `${code}.${pad(seq, 3)}`;
      }
    }
  };
}
var PH_REFIDS = dottedScheme("PH", [/homeowners?/i, /personal home/i, /\bHO-?[2-8]\b/i, /dwelling/i]);
var PA_REFIDS = dottedScheme("PA", [/personal auto/i, /\bauto(mobile)?\b/i, /\bPAP\b/i, /\bPP 00 01\b/i]);
var GL_REFIDS = dottedScheme("GL", [/general liability/i, /\bC\.?G\.?L\b/i, /commercial general/i, /\bCG 00 0[12]\b/i]);
var IM_REFIDS = {
  shapes: {
    product: "IM.PROD###",
    lob: "IM.LOB###",
    coverage: "IM.COV###.##",
    subCoverage: "IM.COV###.##",
    rule: "IM.RL.###",
    formRule: "IM.FORM.RL.###",
    ratingProgram: "IM.RAT.###",
    ratingStep: "IM.RAT.###"
  },
  pattern: /^IM\.(PROD|LOB|COV|RL|RU|FORM|RAT)/i,
  nameSignals: [/inland marine/i, /scheduled (personal )?property/i, /contractors?.?equipment/i, /\bfloater\b/i],
  synthesize(kind, seq, parentSeq = seq) {
    switch (kind) {
      case "product":
        return `IM.PROD${pad(seq, 3)}`;
      case "lob":
        return `IM.LOB${pad(seq, 3)}`;
      case "coverage":
        return `IM.COV${pad(seq, 3)}.00`;
      case "subCoverage":
        return `IM.COV${pad(parentSeq, 3)}.${pad(seq, 2)}`;
      case "rule":
        return `IM.RL.${pad(seq, 3)}`;
      case "formRule":
        return `IM.FORM.RL.${pad(seq, 3)}`;
      case "ratingProgram":
        return `IM.RAT.${pad(seq, 3)}`;
      case "ratingStep":
        return `IM.RAT.${pad(seq, 3)}`;
      default:
        return `IM.${pad(seq, 3)}`;
    }
  }
};
var PR_REFIDS = {
  shapes: {
    product: "PR.PROD###",
    lob: "PR.LOB###",
    coverage: "PR.COV###.#",
    subCoverage: "PR.COV###.#",
    rule: "PR.RU.###",
    formRule: "PR.FORM.RU.###",
    ratingProgram: "PR.ROC",
    ratingStep: "PR.ROC.###"
  },
  pattern: /^PR\.(PROD|LOB|COV|RU|ROC|FORM|RAT)/i,
  nameSignals: [/commercial property/i, /property (framework|component|coverage part|roc|rating)/i, /building and (business )?personal property/i, /\bCP 00 10\b/i],
  synthesize(kind, seq, parentSeq = seq) {
    switch (kind) {
      case "product":
        return `PR.PROD${pad(seq, 3)}`;
      case "lob":
        return `PR.LOB${pad(seq, 3)}`;
      case "coverage":
        return `PR.COV${pad(seq, 3)}.0`;
      case "subCoverage":
        return `PR.COV${pad(parentSeq, 3)}.${Math.trunc(seq)}`;
      case "rule":
        return `PR.RU.${pad(seq, 3)}`;
      case "formRule":
        return `PR.FORM.RU.${pad(seq, 3)}`;
      case "ratingProgram":
        return "PR.ROC";
      case "ratingStep":
        return `PR.ROC.${pad(seq, 3)}`;
      default:
        return `PR.${pad(seq, 3)}`;
    }
  }
};
var isPHLiability = (name) => /liabilit|medical/i.test(name);
var PH_SECTIONS = [
  { label: "Section I \u2014 Property", shortName: "Section I", match: (n) => !isPHLiability(n) },
  { label: "Section II \u2014 Liability", shortName: "Section II", match: isPHLiability }
];
var PH_PERIL = {
  kind: "COASTAL_WIND_HAIL",
  eligibleStates: ["FL", "GA", "NC", "SC", "TX"],
  label: "Coastal wind/hail"
};
var PH_LOB = {
  refId: "PH.LOB.001",
  prefix: "PH",
  name: "Personal Home",
  vertical: "Personal Lines",
  family: "Property",
  sections: PH_SECTIONS,
  peril: PH_PERIL,
  footprintStates: [
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "DC",
    "FL",
    "GA",
    "HI",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY"
  ],
  // canonical additive fields
  code: "PH",
  displayName: "Personal Home",
  refIdPrefix: "PH",
  lineCategory: "PROPERTY",
  personalOrCommercial: "Personal",
  sectionTaxonomy: PH_SECTIONS,
  perilModel: PH_PERIL,
  supportsRulesSimulation: true,
  refIdScheme: PH_REFIDS,
  marketSegments: ["Personal Lines"]
};
var PA_SECTIONS = [
  { label: "Part A \u2014 Liability Coverage", shortName: "Part A", match: (n) => /liabilit/i.test(n) },
  { label: "Part B \u2014 Medical Payments Coverage", shortName: "Part B", match: (n) => /medical/i.test(n) },
  { label: "Part C \u2014 Uninsured Motorists Coverage", shortName: "Part C", match: (n) => /uninsured|underinsured|motorist/i.test(n) },
  { label: "Part D \u2014 Coverage for Damage to Your Auto", shortName: "Part D", match: () => true }
];
var PA_PERIL = {
  kind: "TERRITORY",
  eligibleStates: [],
  label: "Rating territory"
};
var PA_LOB = {
  refId: "PA.LOB.001",
  prefix: "PA",
  name: "Personal Auto",
  vertical: "Personal Lines",
  family: "Automobile",
  sections: PA_SECTIONS,
  peril: PA_PERIL,
  footprintStates: [
    "AL",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "DC",
    "FL",
    "GA",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NC",
    "ND",
    "OH",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI"
  ],
  // canonical additive fields
  code: "PA",
  displayName: "Personal Auto",
  refIdPrefix: "PA",
  lineCategory: "CASUALTY",
  personalOrCommercial: "Personal",
  sectionTaxonomy: PA_SECTIONS,
  perilModel: PA_PERIL,
  supportsRulesSimulation: true,
  refIdScheme: PA_REFIDS,
  marketSegments: ["Personal Lines"]
};
var GL_SECTIONS = [
  {
    label: "Coverage A \u2014 Bodily Injury & Property Damage Liability",
    shortName: "Coverage A",
    match: (n) => /bodily.injury|property.damage|BI.?PD|Coverage A/i.test(n)
  },
  {
    label: "Coverage B \u2014 Personal & Advertising Injury Liability",
    shortName: "Coverage B",
    match: (n) => /personal.*advertis|advertis.*injur|Coverage B/i.test(n)
  },
  {
    label: "Coverage C \u2014 Medical Payments",
    shortName: "Coverage C",
    match: () => true
  }
  // catch-all for Coverage C and unclassified
];
var GL_PERIL = {
  // Commercial casualty — no coastal peril deductible. Rate variation is by class
  // code and exposure base, not by territory in the base occurrence form.
  kind: "NONE",
  eligibleStates: [],
  label: "None"
};
var GL_LOB = {
  refId: "GL.LOB.001",
  prefix: "GL",
  name: "General Liability",
  vertical: "Commercial Lines",
  family: "Casualty",
  sections: GL_SECTIONS,
  peril: GL_PERIL,
  footprintStates: [
    "AL",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "DC",
    "FL",
    "GA",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY"
  ],
  // canonical additive fields
  code: "GL",
  displayName: "General Liability",
  refIdPrefix: "GL",
  lineCategory: "CASUALTY",
  personalOrCommercial: "Commercial",
  sectionTaxonomy: GL_SECTIONS,
  perilModel: GL_PERIL,
  supportsRulesSimulation: true,
  refIdScheme: GL_REFIDS,
  marketSegments: ["Commercial Lines", "Small Commercial", "Middle Market"]
};
var IM_SECTIONS = [
  { label: "Scheduled Property", shortName: "Scheduled", match: (n) => /schedul|itemized|valued|floater/i.test(n) },
  { label: "Blanket & Equipment Coverage", shortName: "Blanket", match: (n) => /blanket|equipment|installation|tool/i.test(n) },
  { label: "Coverage Extensions", shortName: "Extensions", match: () => true }
  // catch-all
];
var IM_PERIL = { kind: "NONE", eligibleStates: [], label: "None" };
var IM_LOB = {
  refId: "IM.LOB.001",
  prefix: "IM",
  name: "Inland Marine",
  vertical: "Commercial Lines",
  family: "Property",
  sections: IM_SECTIONS,
  peril: IM_PERIL,
  footprintStates: [
    "AL",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "DC",
    "FL",
    "GA",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY"
  ],
  code: "IM",
  displayName: "Inland Marine",
  refIdPrefix: "IM",
  lineCategory: "PROPERTY",
  personalOrCommercial: "Commercial",
  sectionTaxonomy: IM_SECTIONS,
  perilModel: IM_PERIL,
  supportsRulesSimulation: false,
  refIdScheme: IM_REFIDS,
  // Segments drawn from the existing registry set so the portfolio facets are unchanged.
  marketSegments: ["Commercial Lines", "Small Commercial"]
};
var PR_SECTIONS = [
  { label: "Building & Business Personal Property", shortName: "Property", match: (n) => /building|business personal|contents|stock/i.test(n) },
  { label: "Time Element", shortName: "Time Element", match: (n) => /business income|extra expense|rental value|time element/i.test(n) },
  { label: "Additional Coverages", shortName: "Additional", match: () => true }
  // catch-all (incl. causes of loss)
];
var PR_PERIL = {
  kind: "COASTAL_WIND_HAIL",
  eligibleStates: ["AL", "FL", "GA", "LA", "MS", "NC", "SC", "TX", "VA"],
  label: "Coastal wind/hail"
};
var PR_LOB = {
  refId: "PR.LOB.001",
  prefix: "PR",
  name: "Commercial Property",
  vertical: "Commercial Lines",
  family: "Property",
  sections: PR_SECTIONS,
  peril: PR_PERIL,
  footprintStates: [
    "AL",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "DC",
    "FL",
    "GA",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY"
  ],
  code: "PR",
  displayName: "Commercial Property",
  refIdPrefix: "PR",
  lineCategory: "PROPERTY",
  personalOrCommercial: "Commercial",
  sectionTaxonomy: PR_SECTIONS,
  perilModel: PR_PERIL,
  supportsRulesSimulation: false,
  refIdScheme: PR_REFIDS,
  // Segments drawn from the existing registry set so the portfolio facets are unchanged.
  marketSegments: ["Commercial Lines", "Middle Market"]
};
var LOB_REGISTRY = {
  [PH_LOB.refId]: PH_LOB,
  [PA_LOB.refId]: PA_LOB,
  [GL_LOB.refId]: GL_LOB,
  [IM_LOB.refId]: IM_LOB,
  [PR_LOB.refId]: PR_LOB
};
var DEFAULT_LOB = PH_LOB;
function lobByPrefix(refId) {
  if (!refId) return void 0;
  const prefix = refId.split(/[.\-_ \d]/)[0];
  return Object.values(LOB_REGISTRY).find((l) => l.prefix === prefix);
}
function resolveLobByRefId(refId) {
  return lobByPrefix(refId);
}
function resolveLobByName(name) {
  if (!name) return void 0;
  const n = name.trim().toLowerCase();
  return Object.values(LOB_REGISTRY).find(
    (l) => l.name.toLowerCase() === n || l.displayName.toLowerCase() === n || n.includes(l.name.toLowerCase()) || n.includes(l.code.toLowerCase())
  );
}
function refIdSegmentKind(refId) {
  if (typeof refId !== "string") return null;
  const m = /^[A-Z]{1,6}[.\-_ ]([A-Z]+)/i.exec(refId.trim());
  if (!m) return null;
  const token = m[1].toUpperCase();
  if (token.startsWith("PROD") || token === "PRD") return "product";
  if (token.startsWith("LOB")) return "lob";
  if (token.startsWith("SUBCOV") || token.startsWith("COV")) return "coverage";
  if (token === "RU" || token === "RL" || token.startsWith("RULE") || token === "FR") return "rule";
  if (token.startsWith("FORM")) return "form";
  if (token.startsWith("RAT") || token === "ROC" || token.startsWith("PROG") || token.startsWith("STEP") || token === "RT" || token === "LD") return "rating";
  return null;
}
function usableRefId(v) {
  if (!v) return null;
  const s = v.trim();
  if (!s || /^(tbd|n\/?a|none|<.*>)$/i.test(s)) return null;
  return s;
}
function inferLob(signals) {
  const tally = /* @__PURE__ */ new Map();
  for (const raw of signals.refIds ?? []) {
    const lob = lobByPrefix(usableRefId(raw));
    if (lob) tally.set(lob.refId, (tally.get(lob.refId) ?? 0) + 1);
  }
  if (tally.size) {
    let bestRefId = "";
    let bestCount = -1;
    for (const [refId, count] of tally) if (count > bestCount) {
      bestCount = count;
      bestRefId = refId;
    }
    return LOB_REGISTRY[bestRefId];
  }
  const hay = [signals.productName, signals.lobName, ...signals.sheetNames ?? []].filter(Boolean).join("  ");
  if (hay.trim()) {
    for (const lob of Object.values(LOB_REGISTRY)) {
      if (lob.refIdScheme.nameSignals.some((re) => re.test(hay))) return lob;
    }
  }
  return void 0;
}
function synthesizeRefId(lob, kind, seq, parentSeq) {
  return lob.refIdScheme.synthesize(kind, seq, parentSeq);
}

// shared/src/insurance/refId.ts
function refIdToDocId(refId) {
  return refId.replace(/\./g, "-");
}
var dashId = refIdToDocId;

// shared/src/import/census/hash.ts
var FNV_OFFSET = 0xcbf29ce484222325n;
var FNV_PRIME = 0x100000001b3n;
var MASK64 = 0xffffffffffffffffn;
function fnv1a64(s) {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i);
    h = (h ^ BigInt(cu & 255)) * FNV_PRIME & MASK64;
    h = (h ^ BigInt(cu >>> 8)) * FNV_PRIME & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}

// shared/src/import/census/regions.ts
function rowBands(occupied) {
  return occupied.map((row2) => {
    let min = -1, max = -1;
    for (let c = 0; c < row2.length; c++) {
      if (row2[c]) {
        if (min < 0) min = c;
        max = c;
      }
    }
    return min < 0 ? null : [min, max];
  });
}
var BLANK_RUN_SPLIT = 2;
function segmentTableRegions(occupied, normalized) {
  const bands = rowBands(occupied);
  const regions = [];
  let start = -1, end = -1, colMin = 0, colMax = 0, gapRun = 0;
  const close = () => {
    if (start < 0) return;
    regions.push(finishRegion(start, end, colMin, colMax, normalized));
    start = -1;
  };
  for (let r = 0; r < bands.length; r++) {
    const band = bands[r];
    if (band === null) {
      if (start >= 0) gapRun++;
      continue;
    }
    if (start < 0) {
      start = r;
      end = r;
      colMin = band[0];
      colMax = band[1];
      gapRun = 0;
      continue;
    }
    const bandDisjoint = band[1] < colMin || band[0] > colMax;
    if (gapRun >= BLANK_RUN_SPLIT || bandDisjoint) {
      close();
      start = r;
      end = r;
      colMin = band[0];
      colMax = band[1];
      gapRun = 0;
      continue;
    }
    end = r;
    gapRun = 0;
    if (band[0] < colMin) colMin = band[0];
    if (band[1] > colMax) colMax = band[1];
  }
  close();
  return regions;
}
function finishRegion(rowStart, rowEnd, colStart, colEnd, normalized) {
  const slice = [];
  for (let r = rowStart; r <= rowEnd; r++) {
    const row2 = normalized[r] ?? [];
    slice.push(row2.slice(colStart, colEnd + 1));
  }
  const candidates = scoreHeaderCandidates(slice);
  const best = pickBestHeaderRow(candidates);
  const headerRow = best >= 0 ? rowStart + best : null;
  const headerConfidence = best >= 0 ? candidates.find((c) => c.rowIndex === best)?.score ?? 0 : 0;
  return { rowStart, rowEnd, colStart, colEnd, headerRow, headerConfidence };
}

// shared/src/import/census/buildCensus.ts
var VERBATIM_CAP = 512;
var DENSE_CELL_CEILING = 2e6;
var DENSE_MAX_COLS = 1024;
function colLabel(col) {
  let n = col + 1, out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
function cellRef(sheet, row2, col) {
  return `${sheet}!${colLabel(col)}${row2 + 1}`;
}
function isFormulaShape(v) {
  return typeof v === "object" && v !== null && ("formula" in v || "sharedFormula" in v);
}
function rawVerbatim(v) {
  if (v === null || v === void 0) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v;
    if (isFormulaShape(v)) return rawVerbatim(o["result"]);
    if (Array.isArray(o["richText"])) return o["richText"].map((t) => t.text ?? "").join("");
    if ("error" in o) return String(o["error"] ?? "");
    if ("text" in o && o["text"] !== void 0) return rawVerbatim(o["text"]);
    if ("hyperlink" in o) return String(o["hyperlink"] ?? "");
  }
  return String(v);
}
function classifyCellType(v) {
  if (isFormulaShape(v)) return "formula";
  if (v instanceof Date) return "date";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "bool";
  return "string";
}
function mergeMap(raw) {
  const m = /* @__PURE__ */ new Map();
  for (const r of raw.merges ?? []) {
    const span = [r.bottom - r.top + 1, r.right - r.left + 1];
    for (let row2 = r.top; row2 <= r.bottom; row2++) {
      for (let col = r.left; col <= r.right; col++) {
        m.set(`${row2}:${col}`, { anchorRow: r.top, anchorCol: r.left, span });
      }
    }
  }
  return m;
}
function buildSheetCensus(raw) {
  const merges = mergeMap(raw);
  let lastRow = -1, lastCol = -1;
  const verbatims = raw.cells.map((row2) => (row2 ?? []).map((c) => {
    if (!c) return null;
    const s = rawVerbatim(c.v);
    return s === "" ? null : s;
  }));
  for (let r = 0; r < verbatims.length; r++) {
    const row2 = verbatims[r];
    for (let c = 0; c < row2.length; c++) {
      if (row2[c] !== null) {
        if (r > lastRow) lastRow = r;
        if (c > lastCol) lastCol = c;
      }
    }
  }
  const rows = lastRow + 1;
  const cols = lastCol + 1;
  const denseRows = rows * cols > DENSE_CELL_CEILING ? Math.max(1, Math.min(rows, Math.floor(DENSE_CELL_CEILING / Math.min(cols, DENSE_MAX_COLS)))) : rows;
  const denseCols = rows * cols > DENSE_CELL_CEILING ? Math.min(cols, DENSE_MAX_COLS) : cols;
  const denseClamped = denseRows !== rows || denseCols !== cols ? { rows: denseRows, cols: denseCols, reason: `sheet extent ${rows}x${cols} (${rows * cols} cells) exceeds the ${DENSE_CELL_CEILING}-cell dense ceiling; header scoring and region segmentation ran over the top-left ${denseRows}x${denseCols} window. All non-empty cells are still recorded.` } : void 0;
  const cells = [];
  const occupied = [];
  const normalized = [];
  for (let r = 0; r < rows; r++) {
    const inDenseRow = r < denseRows;
    const occRow = new Array(inDenseRow ? denseCols : 0).fill(false);
    const normRow = new Array(inDenseRow ? denseCols : 0).fill(null);
    for (let c = 0; c < cols; c++) {
      const rawCell = raw.cells[r]?.[c] ?? null;
      const verbatim = verbatims[r]?.[c] ?? null;
      const inDenseCell = inDenseRow && c < denseCols;
      if (rawCell && inDenseCell) normRow[c] = normalizeCellValue(rawCell.v);
      if (verbatim === null || rawCell === null) continue;
      if (inDenseCell) occRow[c] = true;
      const merge = merges.get(`${r}:${c}`);
      cells.push({
        ref: cellRef(raw.name, r, c),
        sheet: raw.name,
        row: r,
        col: c,
        type: classifyCellType(rawCell.v),
        valueHash: fnv1a64(verbatim),
        verbatim: verbatim.length > VERBATIM_CAP ? verbatim.slice(0, VERBATIM_CAP) : verbatim,
        verbatimTruncated: verbatim.length > VERBATIM_CAP,
        merged: merge ? { anchor: cellRef(raw.name, merge.anchorRow, merge.anchorCol), span: merge.span } : null,
        format: {
          bold: rawCell.bold === true,
          filled: rawCell.filled === true,
          indent: typeof rawCell.indent === "number" ? rawCell.indent : 0,
          topBorder: rawCell.topBorder === true
        },
        hidden: raw.hidden
      });
    }
    if (inDenseRow) {
      occupied.push(occRow);
      normalized.push(normRow);
    }
  }
  const candidates = scoreHeaderCandidates(normalized);
  const best = pickBestHeaderRow(candidates);
  const headerSig = best >= 0 ? fnv1a64((candidates.find((c) => c.rowIndex === best)?.labels ?? []).map((l) => l.toUpperCase().replace(/[^A-Z0-9]/g, "")).join("|")) : "";
  const step = Math.max(1, Math.floor(cells.length / 64));
  const sampled = [`${rows}x${cols}`];
  for (let i = 0; i < cells.length; i += step) sampled.push(cells[i].valueHash);
  const sampleHash = fnv1a64(sampled.join("|"));
  return {
    name: raw.name,
    hidden: raw.hidden,
    dims: { rows, cols },
    nonEmpty: cells.length,
    fingerprint: { headerSig, sampleHash },
    tables: segmentTableRegions(occupied, normalized),
    cells,
    ...denseClamped ? { denseClamped } : {}
  };
}
function buildWorkbookCensus(sheets, sourceName) {
  return { sourceName, sheets: sheets.map(buildSheetCensus) };
}

// shared/src/import/census/accounting.ts
var DISPOSITIONS = ["FACT", "SCHEMA", "NOISE", "HEADER", "MERGE_SHADOW", "NEEDS_REVIEW", "UNACCOUNTED"];
function createAccounting(census) {
  const entries = /* @__PURE__ */ new Map();
  for (const cell2 of census.cells) {
    const isShadow = cell2.merged !== null && cell2.merged.anchor !== cell2.ref;
    entries.set(cell2.ref, {
      ref: cell2.ref,
      disposition: isShadow ? "MERGE_SHADOW" : "UNACCOUNTED",
      by: "code",
      ruleId: isShadow ? "merge-normalization" : null,
      factRef: null,
      citations: []
    });
  }
  return { sheet: census.name, nonEmpty: census.nonEmpty, entries };
}
function post(acc, ref, disposition, by, ruleId = null, factRef = null, citations = []) {
  const cur = acc.entries.get(ref);
  if (!cur || cur.disposition === "MERGE_SHADOW") return false;
  acc.entries.set(ref, { ref, disposition, by, ruleId, factRef, citations });
  return true;
}
function postSpan(acc, span, disposition, by, ruleId = null) {
  let n = 0;
  for (let r = span.rowStart; r <= span.rowEnd; r++) {
    for (let c = span.colStart; c <= span.colEnd; c++) {
      if (post(acc, `${span.sheet}!${colLabel(c)}${r + 1}`, disposition, by, ruleId)) n++;
    }
  }
  return n;
}
function emptyCounts() {
  const out = {};
  for (const d of DISPOSITIONS) out[d] = 0;
  return out;
}
function rollupSheet(acc) {
  const byDisposition = emptyCounts();
  const unaccounted = [];
  for (const e of acc.entries.values()) {
    byDisposition[e.disposition]++;
    if (e.disposition === "UNACCOUNTED") unaccounted.push(e.ref);
  }
  const total = DISPOSITIONS.reduce((s, d) => s + byDisposition[d], 0);
  if (total !== acc.nonEmpty) {
    throw new Error(`accounting broke conservation on "${acc.sheet}": ${total} entries vs ${acc.nonEmpty} nonEmpty`);
  }
  const denominator = acc.nonEmpty - byDisposition.NOISE - byDisposition.HEADER - byDisposition.MERGE_SHADOW;
  const substanceCoverage = denominator <= 0 ? 1 : (byDisposition.FACT + byDisposition.SCHEMA) / denominator;
  return { sheet: acc.sheet, nonEmpty: acc.nonEmpty, byDisposition, substanceCoverage, unaccounted };
}
function rollupWorkbook(sourceName, sheets) {
  const byDisposition = emptyCounts();
  let nonEmpty = 0;
  for (const s of sheets) {
    nonEmpty += s.nonEmpty;
    for (const d of DISPOSITIONS) byDisposition[d] += s.byDisposition[d];
  }
  const denominator = nonEmpty - byDisposition.NOISE - byDisposition.HEADER - byDisposition.MERGE_SHADOW;
  const substanceCoverage = denominator <= 0 ? 1 : (byDisposition.FACT + byDisposition.SCHEMA) / denominator;
  return { sourceName, nonEmpty, byDisposition, substanceCoverage, sheets };
}

// shared/src/insurance/conceptMatch.ts
function norm(s) {
  return s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function squish(s) {
  return norm(s).replace(/ /g, "");
}
function stem(t) {
  return t.length > 3 ? t.replace(/S$/, "") : t;
}
var STOP = /* @__PURE__ */ new Set([
  "THE",
  "A",
  "AN",
  "OF",
  "VIA",
  "AND",
  "OR",
  "FOR",
  "TO",
  "BY",
  "WITH",
  "COVERAGE",
  "COVERAGES",
  "ENDORSEMENT",
  "TABLE",
  "MATRIX"
]);
function tokens(s) {
  return norm(s).split(" ").filter((t) => t && !STOP.has(t)).map(stem);
}
var FORM_TOKEN = /\b(?:AC|PP|EP|NC|CA|CORULES|CAM)\s?\d[\d ]{0,6}\d?\b|\bAC \d{3} [A-Z]{2}\b/g;
function formTokens(s) {
  return [...new Set((s.toUpperCase().match(FORM_TOKEN) || []).map((m) => m.replace(/\s+/g, " ").trim()))];
}
var ABBREV_FOLD = [
  [/ UNDER INSURED /g, " UNDERINSURED "],
  [/ UM /g, " UNINSURED MOTORISTS "],
  [/ UIM /g, " UNDERINSURED MOTORISTS "],
  [/ BI /g, " BODILY INJURY "],
  [/ PD /g, " PROPERTY DAMAGE "],
  [/ OTC /g, " OTHER THAN COLLISION "],
  [/ MED PAY /g, " MEDICAL PAYMENTS "],
  [/ MPL /g, " MOTORCYCLE PASSENGER LIABILITY "]
];
function foldSynonyms(nn) {
  let f = ` ${norm(nn)} `;
  for (const [re, rep] of ABBREV_FOLD) f = f.replace(re, rep);
  return f.replace(/\s+/g, " ").trim();
}
var COVERAGE_CODE_MAP = [
  { code: /^(BI PD CSL|CSL)$/, phrases: ["BODILY INJURY", "PROPERTY DAMAGE"] },
  { code: /^UM ?UIM BI$/, phrases: ["UNINSURED MOTORISTS BODILY INJURY", "UNDERINSURED MOTORISTS BODILY INJURY"] },
  { code: /^UM BI$/, phrases: ["UNINSURED MOTORISTS BODILY INJURY"] },
  { code: /^UM PD$/, phrases: ["UNINSURED MOTORISTS PROPERTY DAMAGE"] },
  { code: /^UIM BI$/, phrases: ["UNDERINSURED MOTORISTS BODILY INJURY"] },
  { code: /^UIM PD$/, phrases: ["UNDERINSURED MOTORISTS PROPERTY DAMAGE"] },
  { code: /^BI$/, phrases: ["BODILY INJURY"] },
  { code: /^PD$/, phrases: ["PROPERTY DAMAGE"] },
  { code: /^(MP|MED PAY|MEDICAL PAYMENTS?)$/, phrases: ["MEDICAL PAYMENTS"] },
  { code: /^MPL$/, phrases: ["MOTORCYCLE PASSENGER LIABILITY"] }
];
var PACKAGE_FORMS = [
  { re: /^VALUE ADDED/, formNum: "AC 400" },
  { re: /^VEHICLE UNDER CONSTRUCTION/, formNum: "AC 116" },
  { re: /^TRAVELING COLLECTOR/, formNum: "AC 113" },
  { re: /^LEGENDARY RIDE/, formNum: "AC 114" },
  { re: /^MOTORSPORTS ADVANTAGE/, formNum: "AC 115" }
];
function isNA(s) {
  return /^n\/?a\.?$/i.test(s) || s.trim() === "";
}
function matchCoverageByName(raw, coverages) {
  const stripped = raw.replace(/\(.*?\)/g, " ").replace(/excluding.*$/i, " ");
  const nn = norm(stripped);
  if (!nn) return null;
  for (const c of coverages) if (norm(c.name) === nn) return { refId: c.refId, how: "exact name" };
  const overlapBag = (s) => new Set(tokens(s).filter((t) => t !== "LIABILITY"));
  const bestOverlap = (inputTokens) => {
    let best = null;
    let bestScore = 0;
    for (const c of coverages) {
      const ct = overlapBag(c.name);
      let overlap = 0;
      for (const t of inputTokens) if (ct.has(t)) overlap++;
      const score = overlap / Math.max(1, Math.max(inputTokens.size, ct.size));
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best ? { c: best, score: bestScore } : null;
  };
  const folded = bestOverlap(overlapBag(foldSynonyms(nn)));
  if (folded && folded.score >= 0.6) return { refId: folded.c.refId, how: `name match (${Math.round(folded.score * 100)}%)` };
  const rawM = bestOverlap(overlapBag(nn));
  if (rawM && rawM.score >= 0.6) return { refId: rawM.c.refId, how: `name match (${Math.round(rawM.score * 100)}%)` };
  const inTokens = new Set(tokens(foldSynonyms(nn)));
  let cont = null;
  let contLen = 0;
  for (const c of coverages) {
    const ct = tokens(c.name).filter((t) => t !== "LIABILITY");
    if (ct.length >= 2 && ct.every((t) => inTokens.has(t)) && ct.length > contLen) {
      cont = c;
      contLen = ct.length;
    }
  }
  if (cont) return { refId: cont.refId, how: "containment" };
  return null;
}
function resolveCoverageCode(code, coverages) {
  const nc = norm(code);
  for (const { code: re, phrases } of COVERAGE_CODE_MAP) {
    if (!re.test(nc)) continue;
    const out = /* @__PURE__ */ new Set();
    for (const phrase of phrases) {
      const m = matchCoverageByName(phrase, coverages);
      if (m) out.add(m.refId);
    }
    return [...out];
  }
  return [];
}
function physicalDamageCoverages(coverages) {
  const out = [];
  for (const c of coverages) {
    if (/^collision/i.test(c.name) || /other than collision/i.test(c.name) || /\bcomprehensive\b/i.test(c.name) && !/liabilit|personal|medical|business/i.test(c.name)) out.push(c.refId);
  }
  return out;
}
function matchRuleReferenceToTables(ref, tables, ruleStates, ruleAll, coverages) {
  if (isNA(ref)) return { tableRefIds: [], how: "" };
  const refN = norm(ref);
  const refT = new Set(tokens(ref));
  const refF = formTokens(ref);
  let cands = tables.filter((t) => {
    const tn = norm(t.baseName);
    if (tn && (tn.includes(refN) || refN.includes(tn))) return true;
    const tt = tokens(t.baseName);
    const sig = [...refT].filter((x) => x.length > 2);
    if (sig.length && sig.every((x) => tt.includes(x))) return true;
    if (refF.length && formTokens(t.baseName).some((f) => refF.includes(f))) return true;
    return false;
  });
  if (!cands.length && /LIMIT/.test(refN) && /MATRIX/i.test(ref)) {
    cands = tables.filter((t) => /SUB-?COVERAGE.*LIMIT/i.test(t.baseName));
  }
  if (!cands.length) {
    const cm = matchCoverageByName(ref.replace(FORM_TOKEN, " "), coverages);
    if (cm) return { tableRefIds: [], how: `reference resolves to coverage ${cm.refId} \u2014 no table in source`, resolvedCoverageRefId: cm.refId };
    return { tableRefIds: [], how: "NO MATCHING TABLE IN SOURCE" };
  }
  const stateful = cands.filter((t) => t.state);
  if (stateful.length && !ruleAll && ruleStates.length) {
    const inScope = stateful.filter((t) => ruleStates.includes(t.state));
    cands = [...cands.filter((t) => !t.state), ...inScope.length ? inScope : stateful];
  }
  return { tableRefIds: cands.map((t) => t.refId), how: "concept match on reference name" };
}
var RATING_GROUP_CONCEPTS = [
  // Combined "Uninsured/Underinsured Motorists Combined Single Limit" must precede the
  // single-sided CSL entries (first-match-wins): "UNINSURED" is not a substring of
  // "UNDERINSURED", so without this the underinsured-only entry below would shadow it and drop
  // the uninsured coverages.
  { re: /\bUNINSURED\b.*\bUNDERINSURED MOTORISTS? COMBINED SINGLE LIMIT/, phrases: ["UNINSURED MOTORISTS BODILY INJURY", "UNINSURED MOTORISTS PROPERTY DAMAGE", "UNDERINSURED MOTORISTS BODILY INJURY", "UNDERINSURED MOTORISTS PROPERTY DAMAGE"] },
  { re: /\bUNINSURED MOTORISTS? COMBINED SINGLE LIMIT/, phrases: ["UNINSURED MOTORISTS BODILY INJURY", "UNINSURED MOTORISTS PROPERTY DAMAGE"] },
  { re: /\bUNDERINSURED MOTORISTS? COMBINED SINGLE LIMIT/, phrases: ["UNDERINSURED MOTORISTS BODILY INJURY", "UNDERINSURED MOTORISTS PROPERTY DAMAGE"] },
  { re: /\bCOMBINED SINGLE LIMIT/, phrases: ["BODILY INJURY", "PROPERTY DAMAGE"] },
  { re: /\bUNINSURED\b.*\bUNDERINSURED MOTORISTS/, phrases: ["UNINSURED MOTORISTS BODILY INJURY", "UNDERINSURED MOTORISTS BODILY INJURY"] },
  { re: /\bUNDERINSURED MOTORISTS\b/, phrases: ["UNDERINSURED MOTORISTS BODILY INJURY"] },
  { re: /\bUNINSURED MOTORISTS\b/, phrases: ["UNINSURED MOTORISTS BODILY INJURY"] },
  { re: /^(UN)?SCHEDULED$/, phrases: ["COLLECTIBLE PERSONAL PROPERTY", "PERSONAL PROPERTY"] }
];
function matchGroup(raw, coverages, covsByForm) {
  const base = norm(raw.replace(/\(.*?\)/g, " ").replace(/excluding.*$/i, " ").replace(/™/g, " "));
  for (const { re, formNum } of PACKAGE_FORMS) {
    if (!re.test(base)) continue;
    const via = covsByForm.get(squish(formNum)) ?? [];
    if (!via.length) break;
    return { covRefIds: [...new Set(via)].slice(0, 40), formNums: [formNum], how: `rates endorsement package ${formNum}`, matchBasis: "derived" };
  }
  const folded = foldSynonyms(base);
  for (const { re, phrases } of RATING_GROUP_CONCEPTS) {
    if (!re.test(folded)) continue;
    const ids = /* @__PURE__ */ new Set();
    for (const p of phrases) {
      const m2 = matchCoverageByName(p, coverages);
      if (m2) ids.add(m2.refId);
    }
    if (ids.size) return { covRefIds: [...ids], formNums: [], how: "domain concept", matchBasis: "derived" };
  }
  const m = matchCoverageByName(raw, coverages);
  if (m) return { covRefIds: [m.refId], formNums: [], how: m.how, matchBasis: "derived" };
  return { covRefIds: [], formNums: [], how: "NO MATCHING COVERAGE IN HIERARCHY", matchBasis: "unmatched" };
}

// shared/src/import/census/detectors.ts
function nonEmptyRows(census) {
  const rows = /* @__PURE__ */ new Map();
  for (const c of census.cells) {
    const list = rows.get(c.row);
    if (list) list.push(c);
    else rows.set(c.row, [c]);
  }
  return rows;
}
function headerLockV2Signals(census, aliasSquished, limit = 15) {
  const rows = nonEmptyRows(census);
  const out = [];
  const boldRatio = (r) => {
    const cells = rows.get(r) ?? [];
    return cells.length === 0 ? 0 : cells.filter((c) => c.format.bold).length / cells.length;
  };
  const stringRatio = (r) => {
    const cells = rows.get(r) ?? [];
    return cells.length === 0 ? 0 : cells.filter((c) => c.type === "string").length / cells.length;
  };
  const numericBelow = (r) => {
    let numeric = 0, total = 0;
    for (let rr = r + 1; rr <= r + 3; rr++) {
      for (const c of rows.get(rr) ?? []) {
        total++;
        if (c.type === "number" || c.type === "date" || c.type === "formula") numeric++;
      }
    }
    return total === 0 ? 0 : numeric / total;
  };
  const scanTo = Math.min(limit, census.dims.rows);
  for (let r = 0; r < scanTo; r++) {
    const cells = rows.get(r);
    if (!cells || cells.length === 0) continue;
    const formattingShift = boldRatio(r) >= 0.6 && boldRatio(r + 1) < 0.3;
    const typeShift = stringRatio(r) >= 0.8 && numericBelow(r) >= 0.5;
    let aliasHits = 0;
    if (aliasSquished && aliasSquished.size > 0) {
      for (const c of cells) {
        const sq = c.verbatim.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (sq && aliasSquished.has(sq)) aliasHits++;
      }
    }
    out.push({ row: r, formattingShift, typeShift, aliasHits });
  }
  return out;
}
function augmentHeaderCandidates(candidates, signals) {
  const byRow = new Map(signals.map((s) => [s.row, s]));
  return candidates.map((c) => {
    const s = byRow.get(c.rowIndex);
    if (!s) return c;
    const bonus = (s.formattingShift ? 0.1 : 0) + (s.typeShift ? 0.1 : 0) + Math.min(0.05 * s.aliasHits, 0.15);
    return { ...c, score: Math.min(1, c.score + bonus) };
  }).sort((a, b) => b.score - a.score);
}
var PARENT_RUN_THRESHOLD = 0.35;
function repeatingParentRuns(census) {
  const byCol = /* @__PURE__ */ new Map();
  for (const c of census.cells) {
    const list = byCol.get(c.col);
    if (list) list.push(c);
    else byCol.set(c.col, [c]);
  }
  const out = [];
  for (const [col, cells] of byCol) {
    if (cells.length < 4) continue;
    cells.sort((a, b) => a.row - b.row);
    let pairs = 0, repeats = 0;
    for (let i = 1; i < cells.length; i++) {
      pairs++;
      if (cells[i].valueHash === cells[i - 1].valueHash) repeats++;
    }
    const repeatFraction = pairs === 0 ? 0 : repeats / pairs;
    if (repeatFraction >= PARENT_RUN_THRESHOLD) out.push({ col, repeatFraction, nonEmpty: cells.length });
  }
  return out.sort((a, b) => a.col - b.col);
}
function staircaseHierarchy(census) {
  const byCol = /* @__PURE__ */ new Map();
  for (const c of census.cells) {
    if (c.type !== "string") continue;
    const list = byCol.get(c.col);
    if (list) list.push(c);
    else byCol.set(c.col, [c]);
  }
  const out = [];
  for (const [col, cells] of byCol) {
    if (cells.length < 4) continue;
    const indentLevels = /* @__PURE__ */ new Set();
    let indented = 0;
    for (const c of cells) {
      indentLevels.add(c.format.indent);
      if (c.format.indent > 0) indented++;
    }
    if (indentLevels.size >= 2 && indented >= 2) {
      out.push({ col, kind: "indent", levels: indentLevels.size, laddered: indented });
      continue;
    }
    const spaceLevels = /* @__PURE__ */ new Set();
    let spaced = 0;
    for (const c of cells) {
      const lead = (c.verbatim.match(/^ */) ?? [""])[0].length;
      spaceLevels.add(lead);
      if (lead > 0) spaced++;
    }
    if (spaceLevels.size >= 2 && spaced >= 2) {
      out.push({ col, kind: "leading-space", levels: spaceLevels.size, laddered: spaced });
    }
  }
  return out.sort((a, b) => a.col - b.col);
}
var FORM_TOKEN_GENERAL = /\b[A-Z]{2,3}(?: (?:\d{2}|[A-Z]{2}))(?: \d{2}){1,3}\b|\b[A-Z]{2,3} \d{3,4}\b/g;
function formTokenCensus(census) {
  const found = /* @__PURE__ */ new Set();
  for (const c of census.cells) {
    if (c.type !== "string") continue;
    const up = c.verbatim.toUpperCase().replace(/\s+/g, " ");
    for (const m of up.match(FORM_TOKEN_GENERAL) ?? []) found.add(m.trim());
    for (const m of up.match(FORM_TOKEN) ?? []) found.add(m.replace(/\s+/g, " ").trim());
  }
  const distinct = [...found].sort();
  return { distinct, count: distinct.length };
}
function stateLexicon(census, normalized) {
  let stateColumnsRow = null;
  for (let r = 0; r < Math.min(15, normalized.length); r++) {
    if (hasWideStateColumns(normalized[r] ?? [])) {
      stateColumnsRow = r;
      break;
    }
  }
  const byCol = /* @__PURE__ */ new Map();
  for (const c of census.cells) {
    if (c.type !== "string") continue;
    const s = byCol.get(c.col) ?? { total: 0, states: 0 };
    s.total++;
    if (US_STATE_CODES.has(c.verbatim.trim().toUpperCase())) s.states++;
    byCol.set(c.col, s);
  }
  const stateListCols = [...byCol.entries()].filter(([, s]) => s.total >= 5 && s.states / s.total >= 0.6).map(([col]) => col).sort((a, b) => a - b);
  const orientation = stateColumnsRow !== null ? "STATE_COLUMNS" : stateListCols.length > 0 ? "STATE_LIST" : "NONE";
  return { orientation, stateColumnsRow, stateListCols };
}
var REFID_SHAPE = /^[A-Z][A-Z0-9]{0,7}(?:\.[A-Z0-9]{1,10}){1,4}$/i;
function idColumnProfile(census) {
  const byCol = /* @__PURE__ */ new Map();
  const prefixes = {};
  for (const c of census.cells) {
    if (c.type !== "string") continue;
    const v = c.verbatim.trim();
    const s = byCol.get(c.col) ?? { total: 0, ids: 0 };
    s.total++;
    if (REFID_SHAPE.test(v) && /\d/.test(v)) {
      s.ids++;
      const prefix = v.split(".")[0].toUpperCase();
      prefixes[prefix] = (prefixes[prefix] ?? 0) + 1;
    }
    byCol.set(c.col, s);
  }
  const columns = [...byCol.entries()].map(([col, s]) => ({ col, refIdRatio: s.total === 0 ? 0 : s.ids / s.total, nonEmpty: s.total })).filter((p) => p.refIdRatio >= 0.5 && p.nonEmpty >= 3).sort((a, b) => a.col - b.col);
  return { columns, prefixes };
}
var VERSIONISH = /\s*\(\s*\d+\s*\)\s*$|\b(hacked|old|copy|backup|scratch|final|v\d+)\b/gi;
function nearDuplicateSheetClusters(workbook) {
  const clusters = [];
  const row2 = (s) => ({ name: s.name, nonEmpty: s.nonEmpty, sampleHash: s.fingerprint.sampleHash, hidden: s.hidden });
  const bySig = /* @__PURE__ */ new Map();
  for (const s of workbook.sheets) {
    if (!s.fingerprint.headerSig || s.nonEmpty === 0) continue;
    const list = bySig.get(s.fingerprint.headerSig);
    if (list) list.push(s);
    else bySig.set(s.fingerprint.headerSig, [s]);
  }
  const clustered = /* @__PURE__ */ new Set();
  for (const group of bySig.values()) {
    if (group.length < 2) continue;
    clusters.push({ basis: "headerSig", sheets: group.map(row2) });
    for (const s of group) clustered.add(s.name);
  }
  const byBase = /* @__PURE__ */ new Map();
  for (const s of workbook.sheets) {
    if (clustered.has(s.name) || s.nonEmpty === 0) continue;
    const base = s.name.replace(VERSIONISH, "").replace(/\s+/g, " ").trim().toUpperCase();
    if (!base || base === s.name.trim().toUpperCase()) continue;
    const list = byBase.get(base);
    if (list) list.push(s);
    else byBase.set(base, [s]);
  }
  for (const [base, group] of byBase) {
    const sibs = workbook.sheets.filter((s) => !group.includes(s) && s.name.replace(VERSIONISH, "").replace(/\s+/g, " ").trim().toUpperCase() === base);
    const all = [.../* @__PURE__ */ new Set([...group, ...sibs])];
    if (all.length >= 2) clusters.push({ basis: "name", sheets: all.map(row2) });
  }
  return clusters;
}
function harvestAliasOverlay(raws, censuses) {
  const definitions = [];
  const enumDomains = [];
  const schemaCellRefs = [];
  const censusByName = new Map(censuses.map((c) => [c.name, c]));
  for (const raw of raws) {
    const census = censusByName.get(raw.name);
    if (census && isDefinitionsSheetName(raw.name)) {
      const normalized = [];
      for (let r = 0; r < census.dims.rows; r++) normalized.push(new Array(census.dims.cols).fill(null));
      for (const c of census.cells) {
        const asNumber = Number(c.verbatim);
        normalized[c.row][c.col] = c.type === "number" && Number.isFinite(asNumber) ? asNumber : c.verbatim;
      }
      for (const d of parseDefinitionsSheet(normalized)) definitions.push({ ...d, sheet: raw.name });
      for (const c of census.cells) schemaCellRefs.push(c.ref);
    }
    for (const v of raw.validations ?? []) {
      if (v.type !== "list" || v.formulae.length === 0) continue;
      const f = String(v.formulae[0] ?? "");
      const inline = /^"(.*)"$/.exec(f.trim());
      enumDomains.push({
        sheet: raw.name,
        ref: v.ref,
        type: v.type,
        values: inline ? inline[1].split(",").map((s) => s.trim()).filter(Boolean) : [],
        sourceRange: inline ? null : f
      });
    }
  }
  return { definitions, enumDomains, schemaCellRefs };
}
function hiddenSheetSubstance(workbook) {
  return workbook.sheets.filter((s) => s.hidden && s.nonEmpty > 0).map((s) => ({ name: s.name, nonEmpty: s.nonEmpty }));
}

// shared/src/rating/rtGrid.ts
var VALUE_COLUMN_NAMES = [
  "factor",
  "rate",
  "charge",
  "value",
  "flatpremium",
  "rateperhundred",
  "premium",
  "amount",
  "ilf",
  "lcm",
  "minimumpremium"
];
var VALUE_COLUMN_PATTERNS = [
  // rate | baseRate | Rate per $100 | Rate/1000 | rate per hundred
  /^(base)?rate((per)?\$?\d+|per[a-z]+)?$/,
  /^losscost(multiplier)?$/,
  /^(base|flat|min(imum)?|max(imum)?)?premium$/,
  /^(rating|rate|dev|mod)?factor$/,
  /^(ilf|lcm|elf)$/
];
function squishColumn(c) {
  return c.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function isValueColumnName(c) {
  const s = squishColumn(c);
  return VALUE_COLUMN_NAMES.includes(s) || VALUE_COLUMN_PATTERNS.some((re) => re.test(s));
}
function inferValueColumn(t) {
  if (t.valueColumn && t.columns.includes(t.valueColumn)) return t.valueColumn;
  const matches = t.columns.filter(isValueColumnName);
  return matches.length === 1 ? matches[0] : null;
}
var BAND_LOW = /^(.*?)(min|from|low(er)?|start|ge|gt)$/;
var BAND_HIGH = /^(.*?)(max|to|high(er)?|end|le|lt)$/;
function detectBandPairs(columns) {
  const pairs = [];
  for (const lo of columns) {
    const ml = BAND_LOW.exec(squishColumn(lo));
    if (!ml) continue;
    const stem2 = ml[1];
    for (const hi of columns) {
      if (hi === lo) continue;
      const mh = BAND_HIGH.exec(squishColumn(hi));
      if (mh && mh[1] === stem2) {
        pairs.push([lo, hi]);
        break;
      }
    }
  }
  return pairs;
}
var SEP = "\0";
function joinKey(values) {
  return values.join(SEP);
}
function toDisplay(v) {
  return v === null || v === void 0 ? "" : String(v);
}
function deriveGridModel(t) {
  const valueColumn = inferValueColumn(t);
  if (!valueColumn) return null;
  const explicit = t.dimensions?.length ? t.dimensions : void 0;
  const dimKeys = explicit ? explicit.map((d) => d.key) : t.columns.filter((c) => c !== valueColumn);
  if (dimKeys.length < 1 || dimKeys.length > 3) return null;
  if (!dimKeys.every((k) => t.columns.includes(k))) return null;
  if (detectBandPairs(dimKeys).length > 0) return null;
  const dimensions = dimKeys.map((key) => {
    const seen = [];
    let numeric = true;
    for (const r of t.rows) {
      const raw = r[key];
      const disp = toDisplay(raw);
      if (disp !== "" && !seen.includes(disp)) seen.push(disp);
      if (raw !== null && raw !== void 0 && typeof raw !== "number") numeric = false;
    }
    const meta = explicit?.find((d) => d.key === key);
    const values = meta?.values?.length ? [...meta.values] : seen;
    return { key, label: meta?.label ?? key, values, numeric };
  });
  const cells = {};
  for (const r of t.rows) {
    const coords = dimensions.map((d) => toDisplay(r[d.key]));
    if (coords.some((c) => c === "")) continue;
    const v = r[valueColumn];
    if (typeof v === "number" && cells[joinKey(coords)] === void 0) cells[joinKey(coords)] = v;
  }
  return { valueColumn, dimensions, cells };
}

// shared/src/insurance/coverageHierarchy.ts
function nameKey(s) {
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}
function segs(refId) {
  return refId.split(".").filter(Boolean);
}
function isSegmentPrefix(prefix, candidate) {
  if (prefix.length >= candidate.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== candidate[i]) return false;
  return true;
}
function resolveCoverageHierarchy(rows) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const topLevelByName = /* @__PURE__ */ new Map();
  const known = [];
  let lastTopLevelRefId = null;
  let lastCoverageName = "";
  let topOrder = 0;
  const childOrder = /* @__PURE__ */ new Map();
  for (const raw of rows) {
    const refId = raw.refId.trim();
    if (!refId || seen.has(refId)) continue;
    let coverageName = raw.coverageName.trim();
    const subName = raw.subCoverageName.trim();
    if (coverageName) lastCoverageName = coverageName;
    else if (subName && lastCoverageName) coverageName = lastCoverageName;
    if (!coverageName && !subName) {
      const mySegs2 = segs(refId);
      let nestFallback = null;
      for (const k of known) {
        if (k.segs.length >= 3 && isSegmentPrefix(k.segs, mySegs2)) {
          if (!nestFallback || k.segs.length > segs(nestFallback).length) nestFallback = k.refId;
        }
      }
      if (!nestFallback) continue;
      coverageName = mySegs2[mySegs2.length - 1] ?? refId;
    }
    const mySegs = segs(refId);
    let nestParent = null;
    for (const k of known) {
      if (isSegmentPrefix(k.segs, mySegs)) {
        if (!nestParent || k.segs.length > segs(nestParent).length) nestParent = k.refId;
      }
    }
    const explicitSub = subName !== "" && nameKey(subName) !== nameKey(coverageName);
    const isSub = explicitSub || nestParent !== null;
    if (!isSub) {
      const name2 = coverageName || subName;
      topOrder += 1;
      out.push({ refId, name: name2, parentRefId: null, isSub: false, order: topOrder, parentSignal: "none" });
      if (coverageName) topLevelByName.set(nameKey(coverageName), refId);
      lastTopLevelRefId = refId;
      known.push({ refId, segs: mySegs });
      seen.add(refId);
      continue;
    }
    let parentRefId = null;
    let signal = "none";
    if (nestParent) {
      parentRefId = nestParent;
      signal = "refid-nesting";
    } else if (coverageName && topLevelByName.has(nameKey(coverageName))) {
      parentRefId = topLevelByName.get(nameKey(coverageName));
      signal = "group-name";
    } else if (!coverageName && lastTopLevelRefId) {
      parentRefId = lastTopLevelRefId;
      signal = "nearest-preceding";
    }
    const name = subName || coverageName;
    if (parentRefId) {
      const n = (childOrder.get(parentRefId) ?? 0) + 1;
      childOrder.set(parentRefId, n);
      out.push({ refId, name, parentRefId, isSub: true, order: n, parentSignal: signal });
    } else {
      topOrder += 1;
      out.push({ refId, name, parentRefId: null, isSub: false, order: topOrder, parentSignal: "orphan-promoted" });
      if (coverageName) topLevelByName.set(nameKey(coverageName), refId);
      lastTopLevelRefId = refId;
    }
    known.push({ refId, segs: mySegs });
    seen.add(refId);
  }
  return out;
}

// shared/src/import/mapper/conserve.ts
var MIN_SHEETS = 4;
var MAX_SPECIES = 2;
function speciesCount(sp) {
  return Object.values(sp).filter(Boolean).length;
}
function conservationEligible(grids, species, referenceTableCount) {
  if (grids.length < MIN_SHEETS) return false;
  const names = /* @__PURE__ */ new Set();
  for (const g of grids) {
    if (names.has(g.sheet)) return false;
    names.add(g.sheet);
  }
  if (speciesCount(species) > MAX_SPECIES) return false;
  if (referenceTableCount > 0) return false;
  return true;
}
function textOf(v) {
  if (v === null || v === void 0) return "";
  return String(v).trim();
}
var PLACEHOLDERISH = /^<.*>$|^n\/?a$|^not applicable$|^tbd$|^x{1,3}$|^-+$|^\.{2,}$|^…+$/i;
function isBlankish(s) {
  return s === "" || PLACEHOLDERISH.test(s);
}
function colLabel2(c) {
  let s = "";
  for (let n = c; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + n % 26) + s;
  return s;
}
function cellRefOf(sheet, r, c) {
  return `${sheet}!${colLabel2(c)}${r + 1}`;
}
var REFID_RE = /\b[A-Za-z]{2,12}(?:[.\-_][A-Za-z]{1,8})?[.\-_]\d{1,6}\b/g;
var FORM_RE = /\b[A-Z]{2,4}[ \-]?\d{2}(?:[ \-]?\d{2}){1,4}\b/g;
var SYNTH_MARK = /(^|\.)SYNTH(?:[^A-Za-z]|$)/i;
function sheetNameClass(name) {
  const n = name.trim().toLowerCase();
  if (/(^|\b)(table of contents|toc)(\b|$)/.test(n)) return "noise";
  if (/(revision|version)\s*history/.test(n)) return "log";
  if (/(observation|question).*log|log.*(observation|question)|question\s*&\s*observation/.test(n)) return "log";
  if (/product\s*contacts?|contacts?$/.test(n)) return "noise";
  if (/^definitions|definitions$|definitions-/.test(n)) return "schema";
  if (/data\s*validation/.test(n)) return "schema";
  if (/dropdown|\(hide\)/.test(n)) return "noise";
  if (/archive|\bold\b|- archive/.test(n)) return "noise";
  return null;
}
var BLANK_RUN_SPLIT2 = 2;
function detectRegions(grid) {
  const rows = grid.cells;
  const occupied = [];
  let maxCol = 0;
  for (let r = 0; r < rows.length; r++) {
    const row2 = rows[r] ?? [];
    let n = 0;
    for (let c = 0; c < row2.length; c++) {
      if (textOf(row2[c] ?? null) !== "") {
        n++;
        if (c > maxCol) maxCol = c;
      }
    }
    occupied.push(n);
  }
  const regions = [];
  let start = -1;
  let blanks = 0;
  const close = (end) => {
    if (start < 0) return;
    regions.push({ rowStart: start, rowEnd: end, colStart: 0, colEnd: maxCol, headerRow: headerRowOf(grid, start, end) });
    start = -1;
  };
  for (let r = 0; r < rows.length; r++) {
    if (occupied[r] > 0) {
      if (start < 0) start = r;
      blanks = 0;
    } else if (start >= 0 && ++blanks >= BLANK_RUN_SPLIT2) {
      close(r - blanks);
      blanks = 0;
    }
  }
  close(rows.length - 1);
  return regions.filter((rg) => rg.rowEnd >= rg.rowStart);
}
function headerRowOf(grid, rowStart, rowEnd) {
  let best = null;
  let bestValues = 0;
  for (let r = rowStart; r <= Math.min(rowStart + 8, rowEnd - 1); r++) {
    const row2 = grid.cells[r] ?? [];
    let strings = 0, values = 0;
    for (const v of row2) {
      const s = textOf(v ?? null);
      if (s === "") continue;
      values++;
      if (typeof v === "string" && !/^\d+([.,]\d+)?$/.test(s)) strings++;
    }
    if (values >= 2 && strings / values >= 0.6 && values > bestValues) {
      best = r;
      bestValues = values;
    }
  }
  return best;
}
function runConservationPass(input) {
  const res = {
    products: [],
    coverages: [],
    forms: [],
    rules: [],
    ldTables: [],
    rtTables: [],
    enumDomains: [],
    consumed: [],
    stats: {},
    unharvestedSheets: []
  };
  const prefix = /^[A-Za-z]{2,6}$/.test(input.refPrefix) ? input.refPrefix.toUpperCase() : "WB";
  const seenRefIds = new Set(input.existingRefIds);
  const synthSeq = {};
  const bump = (k) => {
    res.stats[k] = (res.stats[k] ?? 0) + 1;
  };
  const mintSynth = (kind) => {
    const n = synthSeq[kind] = (synthSeq[kind] ?? 0) + 1;
    return `${prefix}.SYNTH.${kind}.${String(n).padStart(3, "0")}`;
  };
  const entity = (refId, name, citation, mechanism, extra) => ({
    docId: refIdToDocId(refId),
    refId,
    label: `${refId} \u2014 ${name}`,
    data: {
      refId,
      name,
      conservation: mechanism,
      needsReview: true,
      citation,
      ...extra
    }
  });
  for (const g of input.grids) {
    for (let r = 0; r < g.cells.length; r++) {
      const row2 = g.cells[r] ?? [];
      for (let c = 0; c < row2.length; c++) {
        const v = row2[c] ?? null;
        if (typeof v !== "string" && typeof v !== "number") continue;
        const s = String(v);
        const matches = s.match(REFID_RE);
        if (!matches) continue;
        for (const tok of matches) {
          const key = tok.toLowerCase();
          if (seenRefIds.has(key) || SYNTH_MARK.test(tok)) continue;
          seenRefIds.add(key);
          const cite = cellRefOf(g.sheet, r, c);
          const kind = refIdSegmentKind(tok);
          const e = entity(tok, tok, cite, "refid-token");
          if (kind === "product") {
            res.products.push(e);
            bump("token.product");
          } else if (kind === "coverage" || kind === "lob") {
            res.coverages.push(e);
            bump("token.coverage");
          } else if (kind === "form") {
            res.forms.push(e);
            bump("token.form");
          } else if (kind === "rating") {
            if (/^LD/i.test(tok)) {
              res.ldTables.push(e);
              bump("token.ldTable");
            } else {
              res.rtTables.push(e);
              bump("token.rtTable");
            }
          } else {
            e.data["kindUnknown"] = true;
            res.rules.push(e);
            bump("token.rule");
          }
          res.consumed.push({ sheet: g.sheet, rowStart: r, rowEnd: r, colStart: c, colEnd: c, reason: "conserve:refid-token" });
        }
      }
    }
  }
  const formTokens2 = /* @__PURE__ */ new Set();
  for (const g of input.grids) {
    for (let r = 0; r < g.cells.length; r++) {
      const row2 = g.cells[r] ?? [];
      for (let c = 0; c < row2.length; c++) {
        const v = row2[c] ?? null;
        if (typeof v !== "string") continue;
        const matches = v.match(FORM_RE);
        if (!matches) continue;
        for (const raw of matches) {
          const tok = raw.replace(/[ \-]+/g, " ").trim();
          const key = tok.toLowerCase();
          if (formTokens2.has(key) || seenRefIds.has(key)) continue;
          formTokens2.add(key);
          seenRefIds.add(key);
          res.forms.push(entity(tok, tok, cellRefOf(g.sheet, r, c), "form-token", { formNumber: tok }));
          bump("form.token");
          res.consumed.push({ sheet: g.sheet, rowStart: r, rowEnd: r, colStart: c, colEnd: c, reason: "conserve:form-token" });
        }
      }
    }
  }
  const fwGrid = input.frameworkSheet ? input.grids.find((g) => g.sheet === input.frameworkSheet) : void 0;
  if (fwGrid) {
    const regions = detectRegions(fwGrid);
    for (const rg of regions) {
      if (rg.headerRow === null) continue;
      const header = fwGrid.cells[rg.headerRow] ?? [];
      const prodCols = header.map((v, c) => ({ c, h: textOf(v ?? null).replace(/\s+/g, " ").toUpperCase() })).filter((x) => x.h === "PRODUCT" || x.h === "PRODUCT NAME" || x.h === "PROGRAM").map((x) => x.c);
      const seenHere = /* @__PURE__ */ new Set();
      for (const c of prodCols) {
        for (let r = rg.headerRow + 1; r <= rg.rowEnd; r++) {
          const label = textOf(fwGrid.cells[r]?.[c] ?? null);
          if (isBlankish(label) || /^\d+([.,]\d+)?$/.test(label)) continue;
          const key = label.toLowerCase();
          if (seenHere.has(key)) continue;
          seenHere.add(key);
          res.products.push(entity(mintSynth("PROD"), label, cellRefOf(fwGrid.sheet, r, c), "framework-product-column"));
          bump("name.product");
          res.consumed.push({ sheet: fwGrid.sheet, rowStart: r, rowEnd: r, colStart: c, colEnd: c, reason: "conserve:framework-product-column" });
        }
      }
    }
  }
  const conservable = input.grids.filter((g) => !sheetNameClass(g.sheet) && (!input.consumedSheets.has(g.sheet) || g.sheet === input.frameworkSheet && input.frameworkCoverageCount === 0));
  for (const g of conservable) {
    const regions = detectRegions(g);
    if (regions.length === 0) {
      res.unharvestedSheets.push(g.sheet);
      continue;
    }
    const sheetLower = g.sheet.toLowerCase();
    const isProductSheet = /product\s*(inventory|overview)|program\s*version/.test(sheetLower);
    const isCoverageLike = /coverage|cvg|\bcov\b|product component model|product framework/.test(sheetLower) || g.sheet === input.frameworkSheet;
    const isDocumentSheet = /\bdocuments?\b|\bforms?\b/.test(sheetLower);
    let harvested = false;
    const seenProductsHere = /* @__PURE__ */ new Set();
    const seenCoveragesHere = /* @__PURE__ */ new Set();
    const seenFormsHere = /* @__PURE__ */ new Set();
    for (const rg of regions) {
      const dataStart = rg.headerRow !== null ? rg.headerRow + 1 : rg.rowStart;
      const header = rg.headerRow !== null ? g.cells[rg.headerRow] ?? [] : [];
      const headerText = (c) => textOf(header[c] ?? null).replace(/\s+/g, " ").toUpperCase();
      const colsMatching = (re) => {
        const out = [];
        for (let c = rg.colStart; c <= rg.colEnd; c++) if (re.test(headerText(c))) out.push(c);
        return out;
      };
      let coverageCols = isCoverageLike ? colsMatching(/^(SUB ?)?COVERAGE( NAME)?S?$/) : [];
      let productCols = isProductSheet || isCoverageLike ? colsMatching(/^PRODUCT( NAME)?$|^PROGRAM$/) : [];
      let formCols = isDocumentSheet ? colsMatching(/FORM|DOCUMENT|TITLE|NAME/) : [];
      const fallbackLabelCol = (() => {
        for (let c = rg.colStart; c <= rg.colEnd; c++) {
          const seen = /* @__PURE__ */ new Set();
          for (let r = dataStart; r <= rg.rowEnd; r++) {
            const v = g.cells[r]?.[c] ?? null;
            if (typeof v === "string" && !isBlankish(v.trim())) seen.add(v.trim().toLowerCase());
          }
          if (seen.size >= 2) return c;
        }
        return -1;
      })();
      if (isCoverageLike && coverageCols.length === 0 && fallbackLabelCol >= 0) coverageCols = [fallbackLabelCol];
      if (isProductSheet && productCols.length === 0 && fallbackLabelCol >= 0) productCols = [fallbackLabelCol];
      if (formCols.length === 0 && isDocumentSheet && fallbackLabelCol >= 0) formCols = [fallbackLabelCol];
      const harvestCols = (cols, seenHere, push, synthKind, mechanism, stat) => {
        for (const c of cols) {
          for (let r = dataStart; r <= rg.rowEnd; r++) {
            const row2 = g.cells[r] ?? [];
            const label = textOf(row2[c] ?? null);
            if (isBlankish(label) || /^\d+([.,]\d+)?$/.test(label)) continue;
            const key = label.toLowerCase();
            if (seenHere.has(key)) continue;
            seenHere.add(key);
            const residue = row2.map((v) => textOf(v ?? null)).filter((s, i) => i !== c && s !== "").slice(0, 24);
            push(entity(mintSynth(synthKind), label, cellRefOf(g.sheet, r, c), mechanism, { sourceValues: residue }));
            bump(stat);
            harvested = true;
          }
        }
        if (cols.length > 0) {
          res.consumed.push({ sheet: g.sheet, rowStart: rg.rowStart, rowEnd: rg.rowEnd, colStart: rg.colStart, colEnd: rg.colEnd, reason: "conserve:named-rows" });
        }
      };
      if (productCols.length > 0 || coverageCols.length > 0 || isDocumentSheet && formCols.length > 0) {
        harvestCols(productCols, seenProductsHere, (e) => res.products.push(e), "PROD", "product-sheet", "name.product");
        harvestCols(coverageCols, seenCoveragesHere, (e) => res.coverages.push(e), "COV", "coverage-sheet", "name.coverage");
        harvestCols(formCols, seenFormsHere, (e) => res.forms.push(e), "FORM", "document-sheet", "name.form");
      } else {
        const title = regionTitle(g, rg);
        const values = [];
        outer: for (let r = rg.rowStart; r <= rg.rowEnd; r++) {
          const row2 = g.cells[r] ?? [];
          for (let c = rg.colStart; c <= rg.colEnd; c++) {
            const s = textOf(row2[c] ?? null);
            if (s === "") continue;
            values.push(s);
            if (values.length >= 400) break outer;
          }
        }
        if (values.length === 0) continue;
        const scope = `${g.sheet} ${title}`;
        const rateish = /rate|factor|loss cost|premium/i.test(scope) && !/limit|deductible/i.test(scope);
        const e = entity(
          mintSynth(rateish ? "RTB" : "TBL"),
          title || `${g.sheet} region ${rg.rowStart + 1}-${rg.rowEnd + 1}`,
          cellRefOf(g.sheet, rg.rowStart, rg.colStart),
          "generic-region",
          { sourceValues: values, region: `${cellRefOf(g.sheet, rg.rowStart, rg.colStart)}:${colLabel2(rg.colEnd)}${rg.rowEnd + 1}` }
        );
        if (rateish) res.rtTables.push(e);
        else res.ldTables.push(e);
        bump(rateish ? "region.rt" : "region.ld");
        res.consumed.push({ sheet: g.sheet, rowStart: rg.rowStart, rowEnd: rg.rowEnd, colStart: rg.colStart, colEnd: rg.colEnd, reason: "conserve:generic-region" });
        harvested = true;
      }
    }
    if (!harvested) res.unharvestedSheets.push(g.sheet);
  }
  for (const g of input.grids) {
    if (!/data\s*validation/i.test(g.sheet)) continue;
    const regions = detectRegions(g);
    for (const rg of regions) {
      if (rg.headerRow === null) continue;
      const header = g.cells[rg.headerRow] ?? [];
      for (let c = rg.colStart; c <= rg.colEnd; c++) {
        const field = textOf(header[c] ?? null).replace(/\s+/g, " ").trim();
        if (field === "" || isBlankish(field)) continue;
        const values = [];
        let first = -1, last = -1;
        for (let r = rg.headerRow + 1; r <= rg.rowEnd; r++) {
          const s = textOf(g.cells[r]?.[c] ?? null);
          if (s === "") continue;
          values.push(s);
          if (first < 0) first = r;
          last = r;
        }
        if (values.length < 2) continue;
        const fieldKey = camelize(field);
        if (fieldKey === "") continue;
        res.enumDomains.push({
          field: fieldKey,
          values,
          range: `${g.sheet}!${colLabel2(c)}${first + 1}:${colLabel2(c)}${last + 1}`
        });
        bump("overlay.domain");
      }
      res.consumed.push({ sheet: g.sheet, rowStart: rg.rowStart, rowEnd: rg.rowEnd, colStart: rg.colStart, colEnd: rg.colEnd, reason: "conserve:enum-domains" });
    }
  }
  if (res.enumDomains.length > 0) enrichFromDomains(res);
  return res;
}
function camelize(header) {
  const words = header.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return words.map((w, i) => i === 0 ? w : w[0].toUpperCase() + w.slice(1)).join("");
}
function enrichFromDomains(res) {
  const byValue = /* @__PURE__ */ new Map();
  for (const d of res.enumDomains) {
    for (const v of d.values) {
      const key = v.toLowerCase();
      const cur = byValue.get(key);
      if (cur && cur.field !== d.field) cur.hits++;
      else if (!cur) byValue.set(key, { field: d.field, hits: 1 });
    }
  }
  const apply = (e) => {
    const residue = e.data["sourceValues"];
    if (!Array.isArray(residue)) return;
    for (const raw of residue) {
      const hit = byValue.get(String(raw).toLowerCase());
      if (!hit || hit.hits > 1) continue;
      if (e.data[hit.field] !== void 0) continue;
      e.data[hit.field] = String(raw);
    }
  };
  for (const arr of [res.products, res.coverages, res.forms, res.rules, res.ldTables, res.rtTables]) arr.forEach(apply);
}
function regionTitle(g, rg) {
  const row2 = g.cells[rg.rowStart] ?? [];
  for (let c = rg.colStart; c <= rg.colEnd; c++) {
    const s = textOf(row2[c] ?? null);
    if (s !== "" && !/^\d+([.,]\d+)?$/.test(s)) return s.slice(0, 120);
  }
  return "";
}

// shared/src/insurance/isoImport.ts
function text(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  return String(v);
}
function norm2(v) {
  return text(v).toUpperCase().replace(/\s+/g, " ").trim();
}
function squishStr(s) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function squish2(v) {
  return squishStr(text(v));
}
var PLACEHOLDER = /^<.*>$|^n\/?a$|^not applicable$|^intentionally left blank$/i;
function isPlaceholder(s) {
  return s === "" || PLACEHOLDER.test(s);
}
function clean(v) {
  const s = text(v);
  return isPlaceholder(s) ? "" : s;
}
function isX(v) {
  const s = text(v).toUpperCase();
  return s === "X" || s === "\u2713" || s === "YES" || s === "TRUE";
}
function isYes(v) {
  return /^(y|yes|true|x)$/i.test(text(v));
}
function parseNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = text(v).replace(/[$,%\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function splitList(v) {
  return text(v).split(/[\n;,]+/).map((s) => s.trim()).filter((s) => s && !isPlaceholder(s));
}
var US_STATES = /* @__PURE__ */ new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "PR",
  "GU",
  "VI"
]);
function mapStatus(v) {
  const s = norm2(v);
  if (s.startsWith("INACTIVE")) return "INACTIVE";
  if (s.startsWith("FUTURE")) return "FUTURE";
  return "ACTIVE";
}
function mapReview(v) {
  const s = norm2(v);
  if (s.startsWith("APPROV")) return "APPROVED";
  if (s.startsWith("REJECT")) return "REJECTED";
  if (s.startsWith("BUSINESS")) return "BUSINESS_REVIEW";
  if (s.startsWith("IN PROGRESS") || s.startsWith("INITIAL") || s.startsWith("READY") || s.startsWith("TBD")) return "IN_PROGRESS";
  return "NOT_STARTED";
}
function mapRequirement(v) {
  const t = text(v);
  if (t === "" || isPlaceholder(t)) return "UNKNOWN";
  return /optional/i.test(t) ? "OPTIONAL" : "MANDATORY";
}
function mapClaimsBasis(v) {
  const s = text(v);
  if (/claim/i.test(s)) return "Claims-made";
  if (/occur/i.test(s)) return "Occurrence";
  return "";
}
function mapSource(bureau, prop) {
  if (isYes(bureau)) return "BUREAU";
  if (isYes(prop)) return "PROPRIETARY";
  return "BUREAU";
}
function mapDynType(v) {
  const s = norm2(v);
  if (s.startsWith("CURRENCY")) return "CURRENCY";
  if (s.startsWith("DATE")) return "DATE";
  if (s.startsWith("LIST")) return "LIST";
  if (s.startsWith("PERCENT")) return "PERCENT";
  return "TEXT";
}
function mapRuleCategory(v) {
  const s = norm2(v);
  if (s.startsWith("RATING")) return "RATING";
  if (s.startsWith("FORM")) return "FORMS";
  return "PRODUCT";
}
var FORM_CATEGORY_CANONICAL = {
  "BASE COVERAGE FORM": "BASE_COVERAGE",
  "BASE COVERAGE": "BASE_COVERAGE",
  "DECLARATIONS": "DECLARATIONS",
  "DECLARATIONS - PRIMARY": "DECLARATIONS",
  "DECLARATIONS - SUPPLEMENTAL": "DECLARATIONS",
  "DECLARATIONS PRIMARY": "DECLARATIONS",
  "DECLARATIONS SUPPLEMENTAL": "DECLARATIONS",
  "ENDORSEMENT": "ENDORSEMENT",
  "ENDORSEMENTS": "ENDORSEMENT",
  "EXCLUSION": "EXCLUSION",
  "EXCLUSIONS": "EXCLUSION",
  "SCHEDULE": "SCHEDULE",
  "POLICY NOTICE": "POLICY_NOTICE",
  "POLICY NOTICES": "POLICY_NOTICE",
  "NOTICE": "POLICY_NOTICE",
  "POLICY CONDITIONS": "POLICY_CONDITIONS",
  "AMENDATORY": "AMENDATORY",
  "AMENDATORY ENDORSEMENT": "ENDORSEMENT",
  "OTHER POLICY DOCUMENTS": "OTHER",
  "MARKETING MATERIALS": "MARKETING",
  "MARKETING": "MARKETING"
};
var FORM_CATEGORY_OUTLIERS = /* @__PURE__ */ new Set([
  "ISO FILED",
  "POLICY"
]);
function mapFormCategory(v, overlay) {
  const s = norm2(v);
  if (overlay?.enumOverrides) {
    const ov = overlay.enumOverrides[s];
    if (ov) return { category: ov, exact: true, outlier: false };
  }
  if (s in FORM_CATEGORY_CANONICAL) {
    return { category: FORM_CATEGORY_CANONICAL[s], exact: true, outlier: false };
  }
  if (FORM_CATEGORY_OUTLIERS.has(s)) {
    return { category: null, exact: false, outlier: true };
  }
  if (s === "") return { category: "ENDORSEMENT", exact: false, outlier: false };
  return { category: "ENDORSEMENT", exact: false, outlier: false };
}
function refIdPrefix(refId) {
  const m = refId.match(/^([A-Za-z]{2,4})[.\-_ ]?(?:COV|PROD|LOB|RAT|RU|FORM)/i);
  if (m) return m[1].toUpperCase();
  return (refId.split(/[.\-_\d]/).filter(Boolean)[0] ?? "").toUpperCase();
}
var dashId2 = refIdToDocId;
function extractTableRef(v) {
  const m = text(v).match(/\b((?:LD|RT)Table\.\w+)/i);
  return m ? m[1] : void 0;
}
function row(grid, r) {
  return grid.cells[r] ?? [];
}
function cell(grid, r, c) {
  return grid.cells[r]?.[c] ?? null;
}
function findHeaderRow(grid, aliasGroups, limit = 20) {
  const groups = aliasGroups.map((a) => a.map(squishStr));
  let best = -1, bestScore = 0;
  for (let r = 0; r < Math.min(grid.cells.length, limit); r++) {
    const heads = row(grid, r).map(squish2);
    let score = 0;
    for (const g of groups) if (heads.some((h) => h !== "" && g.includes(h))) score++;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= 3 ? best : -1;
}
function mapColumns(header, fields, exclude) {
  const heads = header.map((h, i) => exclude?.has(i) ? "" : squish2(h));
  const map = {};
  for (const [key, aliases] of Object.entries(fields)) {
    for (const alias of aliases) {
      const sq = squishStr(alias);
      const idx = heads.findIndex((h) => h !== "" && h === sq);
      if (idx >= 0) {
        map[key] = idx;
        break;
      }
    }
  }
  const STOP2 = /* @__PURE__ */ new Set(["THE", "A", "AN", "OF", "OR", "AND", "TO", "IN", "IS", "FOR", "ON", "AT", "BY"]);
  function sigWords(s) {
    return s.replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !STOP2.has(w));
  }
  for (const [key, aliases] of Object.entries(fields)) {
    if (key in map) continue;
    let bestCol = -1, bestScore = 0;
    for (let i = 0; i < heads.length; i++) {
      if (!heads[i]) continue;
      const hw = sigWords(heads[i]);
      if (!hw.length) continue;
      for (const alias of aliases) {
        const aw = sigWords(squishStr(alias));
        if (!aw.length) continue;
        const shared = hw.filter((w) => aw.includes(w)).length;
        const score = shared / Math.min(hw.length, aw.length);
        if (score > bestScore && score >= 0.5) {
          bestScore = score;
          bestCol = i;
        }
      }
    }
    if (bestCol >= 0) map[key] = bestCol;
  }
  return map;
}
function stateColumns(header) {
  const cols = [];
  header.forEach((c, i) => {
    const h = norm2(c);
    if (US_STATES.has(h)) cols.push({ col: i, code: h });
  });
  const allCol = header.findIndex((c) => /\bALL( ACTIVE)? STATES\b/.test(norm2(c)));
  return { cols, allCol };
}
function stateMatrixExclusions(grid, hr, sc) {
  const out = /* @__PURE__ */ new Set();
  const limit = Math.min(grid.cells.length, hr + 1 + 400);
  for (const s of sc.cols) {
    let matrix = true;
    for (let r = hr + 1; r < limit; r++) {
      const v = text((grid.cells[r] ?? [])[s.col] ?? null);
      if (v !== "" && !isX(v)) {
        matrix = false;
        break;
      }
    }
    if (matrix) out.add(s.col);
  }
  if (sc.allCol >= 0) out.add(sc.allCol);
  return out;
}
function stateScope(r, sc) {
  if (sc.allCol >= 0 && isX(r[sc.allCol] ?? null)) return { allStates: true, states: [] };
  const states = sc.cols.filter((s) => isX(r[s.col] ?? null)).map((s) => s.code).sort();
  return states.length ? { allStates: false, states } : { allStates: true, states: [] };
}
function fillForward(r) {
  const out = [];
  let last = "";
  for (let i = 0; i < r.length; i++) {
    const t = text(r[i]);
    if (t) last = t;
    out[i] = last;
  }
  return out;
}
function groupColumns(section, header, re) {
  const out = [];
  header.forEach((c, i) => {
    const name = clean(c);
    if (name && re.test(section[i] ?? "")) out.push({ col: i, name });
  });
  return out;
}
var IGNORE_SHEET = /revision history|definition|data validation|categories/i;
var DECOY_SHEET = /(_|\b)arch\b|before\s*50|scratch|question|review$/i;
var VERSION_SUFFIX = /\s*\(\s*\d+\s*\)\s*$/;
var REAL_REF_ID = /^[A-Z][A-Z0-9]*\.[A-Z]{2,6}\.\d/i;
function countRefIdRows(grid) {
  let n = 0;
  for (const r of grid.cells) {
    if (r.some((c) => typeof c === "string" && REAL_REF_ID.test(c.trim()))) n++;
  }
  return n;
}
function selectFrameworkSheet(grids, ctx) {
  const FW_RE = /framework|product component model|component model|e\+\s*framework/i;
  const candidates = grids.filter(
    (g) => FW_RE.test(g.sheet) && !IGNORE_SHEET.test(g.sheet) && !DECOY_SHEET.test(g.sheet) && !VERSION_SUFFIX.test(g.sheet)
  );
  if (!candidates.length) return void 0;
  if (candidates.length === 1) return candidates[0];
  let best = candidates[0];
  let bestScore = countRefIdRows(best);
  for (let i = 1; i < candidates.length; i++) {
    const score = countRefIdRows(candidates[i]);
    if (score > bestScore) {
      best = candidates[i];
      bestScore = score;
    } else if (score === bestScore) {
      ctx.warnOnce("ambiguous_sheet", `Ambiguous framework sheet: "${best.sheet}" and "${candidates[i].sheet}" have equal refId scores (${bestScore}). Using "${best.sheet}".`);
    }
  }
  return best;
}
function findSheet(grids, re, exclude) {
  return grids.find(
    (g) => re.test(g.sheet) && !IGNORE_SHEET.test(g.sheet) && !DECOY_SHEET.test(g.sheet) && !VERSION_SUFFIX.test(g.sheet) && (!exclude || !exclude.test(g.sheet))
  );
}
var Ctx = class {
  warnings = [];
  unmapped = [];
  recognized = [];
  defects = [];
  notices = [];
  /** consumedSpans collector (CE1-S6): null = instrumentation off (default). */
  spans = null;
  warned = /* @__PURE__ */ new Set();
  /** De-duplicated warning (keeps the summary readable when a value recurs on 100s of rows). */
  warnOnce(key, msg) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.warnings.push(msg);
    }
  }
  warn(msg) {
    this.warnings.push(msg);
  }
  addDefect(d) {
    this.defects.push(d);
  }
  addNotice(n) {
    this.notices.push(n);
  }
  /** Record a consumed rectangle (no-op unless a collector was supplied). */
  consume(sheet, rowStart, rowEnd, colStart, colEnd, reason) {
    if (this.spans && rowEnd >= rowStart) this.spans.push({ sheet, rowStart, rowEnd, colStart, colEnd, reason });
  }
  recordUnmapped(sheet, header, handled) {
    const labels = [];
    header.forEach((c, i) => {
      const name = clean(c);
      if (name && !handled.has(i) && !US_STATES.has(norm2(c)) && !labels.includes(name)) labels.push(name);
    });
    if (labels.length) this.unmapped.push({ sheet, columns: labels.slice(0, 24) });
  }
};
var FW_FIELDS = {
  status: ["STATUS", "ACTIVE STATUS", "ITEM STATUS", "ROW STATUS"],
  id: [
    "PRODUCT FRAMEWORK ID",
    "FRAMEWORK ID",
    "ID",
    "REFERENCE ID",
    "REF ID",
    "ITEM ID",
    "COMPONENT ID",
    "COVERAGE ID",
    "COV ID"
  ],
  product: ["PRODUCT", "PRODUCT NAME", "PROGRAM", "POLICY PROGRAM", "PRODUCT LINE"],
  lob: [
    "LINE OF BUSINESS",
    "LOB",
    "LINE",
    "BUSINESS LINE",
    "COVERAGE LINE",
    "POLICY TYPE",
    "COVERAGE TYPE"
  ],
  coverage: [
    "COVERAGE",
    "COVERAGE NAME",
    "COVERAGE DESCRIPTION",
    "PERIL",
    "BENEFIT",
    "INSURING AGREEMENT",
    "RISK ITEM"
  ],
  subCoverage: [
    "SUB-COVERAGE",
    "SUB COVERAGE",
    "SUBCOVERAGE",
    "SUB-PERIL",
    "SUB PERIL",
    "COVERAGE OPTION",
    "OPTION",
    "SUBLIMIT ITEM",
    "COVERAGE PART",
    "ADDITIONAL COVERAGE",
    "COVERAGE DETAIL",
    "COVERAGE SPECIFICATION",
    "SPECIFICATION",
    "COMPONENT DETAIL",
    "DETAIL",
    "ITEM DETAIL",
    "COVERAGE COMPONENT",
    "ATTRIBUTE"
  ],
  forms: [
    "FORM NUMBER(S)",
    "FORM NUMBER",
    "FORM NUMBERS",
    "ASSOCIATED FORMS",
    "POLICY FORM",
    "FORM NO"
  ],
  edition: ["EDITION DATE", "EFFECTIVE DATE", "FORM EDITION"],
  claimsBasis: ["CLAIMS BASIS", "TRIGGER", "LOSS TRIGGER", "REPORTING BASIS"],
  requirement: [
    "COVERAGE REQUIREMENT",
    "REQUIREMENT",
    "MANDATORY/ OPTIONAL",
    "MANDATORY / OPTIONAL",
    "REQUIRED/OPTIONAL",
    "MANDATORY OR OPTIONAL",
    "OPTIONAL OR MANDATORY"
  ],
  premiumGen: [
    "PREMIUM GENERATING",
    "PREMIUM GENERATING?",
    "GENERATES PREMIUM",
    "RATING",
    "RATED",
    "PREMIUM BEARING"
  ],
  bureau: [
    "BUREAU",
    "RATING BUREAU",
    "RATING BUREAU?",
    "ISO",
    "BUREAU FORM",
    "FILED",
    "BUREAU FILED"
  ],
  proprietary: [
    "PROPRIETARY",
    "PROPRIETARY?",
    "CARRIER PROPRIETARY",
    "NON-BUREAU",
    "COMPANY SPECIFIC",
    "CARRIER SPECIFIC"
  ],
  review: [
    "REVIEW STATUS",
    "REVIEW",
    "STATUS (REVIEW)",
    "APPROVAL STATUS",
    "CLIENT REVIEW STATUS"
  ]
};
function finalizeCoverages(resolved, draftByRefId, at, sheetName, ctx) {
  for (const rc of resolved) {
    if (rc.parentSignal === "orphan-promoted") {
      ctx.warn(`Sheet "${sheetName}" coverage ${rc.refId} ("${rc.name}"): named a sub-coverage but no parent coverage was found \u2014 imported as a top-level coverage.`);
    }
  }
  const coverages = resolved.map((rc) => {
    const draft = draftByRefId.get(rc.refId);
    const cells = draft.cells;
    return {
      docId: dashId2(rc.refId),
      refId: rc.refId,
      label: `${rc.refId} \u2014 ${rc.name}`,
      data: {
        refId: rc.refId,
        name: rc.name,
        parentId: rc.parentRefId,
        order: rc.order,
        requirement: mapRequirement(at(cells, "requirement")),
        claimsBasis: mapClaimsBasis(at(cells, "claimsBasis")),
        premiumGenerating: isYes(at(cells, "premiumGen")),
        source: mapSource(at(cells, "bureau"), at(cells, "proprietary")),
        formNumbers: splitList(at(cells, "forms")),
        terms: [],
        ...draft.scope,
        status: mapStatus(at(cells, "status")),
        lifecycle: "DRAFT",
        reviewStatus: mapReview(at(cells, "review")),
        reviewer: ""
      }
    };
  });
  const byRefId = new Set(coverages.map((c) => c.refId));
  for (const cov of coverages) {
    const pid = cov.data["parentId"];
    if (pid && !byRefId.has(pid)) {
      ctx.warn(`Sheet "${sheetName}" coverage ${cov.refId}: parent "${pid}" not found \u2014 imported as top-level.`);
      cov.data["parentId"] = null;
    }
  }
  const depthOf = (refId) => {
    let d = 0;
    let cur = refId;
    const guard = /* @__PURE__ */ new Set();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const c = coverages.find((x) => x.refId === cur);
      const pid = c ? c.data["parentId"] : null;
      if (!pid) break;
      d += 1;
      cur = pid;
    }
    return d;
  };
  const depthCache = new Map(coverages.map((c) => [c.refId, depthOf(c.refId)]));
  coverages.sort((a, b) => (depthCache.get(a.refId) ?? 0) - (depthCache.get(b.refId) ?? 0));
  return coverages;
}
function assignDraftsByProduct(drafts, products) {
  const result = new Map(products.map((p) => [p.refId, []]));
  const prefixMap = new Map(products.map((p) => [refIdPrefix(p.refId).toUpperCase(), p.refId]));
  const nameMap = new Map(products.map((p) => [p.name.toUpperCase(), p.refId]));
  for (const draft of drafts) {
    const covPrefix = refIdPrefix(draft.refId).toUpperCase();
    let target = prefixMap.get(covPrefix);
    if (!target && draft.productHint) target = nameMap.get(draft.productHint.toUpperCase());
    if (!target) target = products[0].refId;
    result.get(target).push(draft);
  }
  return result;
}
function parseFramework(grid, ctx, overlay) {
  const effectiveFwFields = overlay?.columnAliases ? Object.fromEntries(
    Object.entries(FW_FIELDS).map(([k, v]) => [k, overlay.columnAliases[k] ? [...v, ...overlay.columnAliases[k]] : v])
  ) : FW_FIELDS;
  const hr = findHeaderRow(grid, Object.values(effectiveFwFields));
  if (hr < 0) {
    ctx.warn(`Framework sheet "${grid.sheet}": no recognizable header row \u2014 skipped.`);
    return null;
  }
  ctx.recognized.push(grid.sheet);
  const header = row(grid, hr);
  const sc = stateColumns(header);
  const col = mapColumns(header, effectiveFwFields, stateMatrixExclusions(grid, hr, sc));
  const at = (r, k) => k in col ? r[col[k]] ?? null : null;
  const productRows = /* @__PURE__ */ new Map();
  let lobRefId = null;
  let lobName = "";
  let productNameHint = "";
  let lobNameHint = "";
  const drafts = [];
  const draftByRefId = /* @__PURE__ */ new Map();
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r);
    const id = clean(at(cells, "id"));
    if (!id) continue;
    const covName = clean(at(cells, "coverage"));
    const subName = clean(at(cells, "subCoverage"));
    const prod = clean(at(cells, "product"));
    const lob = clean(at(cells, "lob"));
    if (/[.\-_ ](PROD|PRD|PRODUCT)(?:[.\-_ ]|\b)/i.test(id)) {
      if (!productRows.has(id)) productRows.set(id, { refId: id, name: prod || "" });
      continue;
    }
    if (/[.\-_ ]LOB(?:[.\-_ ]|\b)/i.test(id)) {
      if (!lobRefId) {
        lobRefId = id;
        lobName = lob || lobName;
      }
      continue;
    }
    if (!covName && !subName) {
      if (!productNameHint && prod) productNameHint = prod;
      if (!lobNameHint && lob) lobNameHint = lob;
      continue;
    }
    if (!productNameHint && prod) productNameHint = prod;
    if (!lobNameHint && lob) lobNameHint = lob;
    const draft = {
      refId: id,
      coverageName: covName,
      subCoverageName: subName,
      rowIndex: r,
      cells,
      scope: stateScope(cells, sc),
      productHint: prod
    };
    drafts.push(draft);
    const prior = draftByRefId.get(id);
    if (!prior) {
      draftByRefId.set(id, draft);
    } else if (prior.coverageName !== covName || prior.subCoverageName !== subName) {
      ctx.warnOnce(`dupcovid:${id}`, `Sheet "${grid.sheet}" col "ID": coverage id ${id} is reused for different coverages ("${prior.coverageName || prior.subCoverageName}" and "${covName || subName}") \u2014 kept the first; verify the source.`);
    }
  }
  let productList;
  if (productRows.size > 0) {
    const seenPrefixes = /* @__PURE__ */ new Map();
    for (const pd of productRows.values()) {
      const prefix = refIdPrefix(pd.refId).toUpperCase();
      if (!seenPrefixes.has(prefix)) seenPrefixes.set(prefix, pd);
    }
    productList = [...seenPrefixes.values()];
  } else {
    const derived = drafts.length > 0 ? refIdPrefix(drafts[0].refId) : "";
    const lobDef = resolveLobByRefId(`${derived}.LOB.001`);
    const prefix = lobDef?.refIdPrefix ?? DEFAULT_LOB.refIdPrefix;
    const synthRefId = `${prefix}.PROD.SYNTH001`;
    const synthName = productNameHint || "";
    if (!lobDef) {
      ctx.warnOnce("product_synth_prefix_defaulted", `Framework sheet "${grid.sheet}": coverage id prefix "${derived}" resolves to no registered line \u2014 synthesized product id uses the platform default line "${prefix}" (verify the line); code: product_synth_prefix_defaulted.`);
    }
    ctx.warnOnce("product_synthesized", `Framework sheet "${grid.sheet}": no explicit product (.PROD/.PRD) row \u2014 synthesized "${synthRefId}" from coverage id prefix "${prefix}"; code: product_synthesized.`);
    productList = [{ refId: synthRefId, name: synthName }];
  }
  if (!lobName) lobName = lobNameHint;
  const isMulti = productList.length > 1;
  const assignedDrafts = isMulti ? assignDraftsByProduct(drafts, productList) : /* @__PURE__ */ new Map([[productList[0].refId, drafts]]);
  const results = [];
  for (const pd of productList) {
    const myDrafts = assignedDrafts.get(pd.refId) ?? drafts;
    const uniqueDrafts = myDrafts.filter((d) => draftByRefId.get(d.refId) === d);
    const resolved = resolveCoverageHierarchy(uniqueDrafts.map((d) => ({
      refId: d.refId,
      coverageName: d.coverageName,
      subCoverageName: d.subCoverageName,
      rowIndex: d.rowIndex
    })));
    const coverages = finalizeCoverages(resolved, draftByRefId, at, grid.sheet, ctx);
    const scopes = myDrafts.map((d) => d.scope);
    const productScope = scopes.some((s) => s.allStates) || scopes.length === 0 ? { allStates: true, states: [] } : { allStates: false, states: [...new Set(scopes.flatMap((s) => s.states))].sort() };
    const pName = pd.name || productNameHint;
    results.push({ productRefId: pd.refId, productName: pName, lobRefId, lobName, coverages, productScope });
  }
  const handled = new Set(Object.values(col).concat(sc.cols.map((s) => s.col), sc.allCol));
  ctx.recordUnmapped(grid.sheet, header, handled);
  return results.length > 0 ? results : null;
}
var FORM_FIELDS = {
  ids: [
    "PRODUCT FRAMEWORK ID",
    "FRAMEWORK ID",
    "COVERAGE ID",
    "COVERAGE REF",
    "APPLICABLE COVERAGE",
    "COVERAGE"
  ],
  name: ["FORM NAME", "FORM TITLE", "DESCRIPTION", "FORM DESCRIPTION", "TITLE"],
  number: ["FORM NUMBER", "FORM NO", "FORM NO.", "POLICY FORM", "FORM", "FORM #"],
  edition: [
    "FORM EDITION DATE (MM YY)",
    "FORM EDITION DATE",
    "EDITION DATE",
    "EDITION",
    "EFFECTIVE DATE",
    "VERSION DATE"
  ],
  claimsBasis: ["CLAIMS BASIS", "TRIGGER", "LOSS TRIGGER"],
  bureau: ["BUREAU", "RATING BUREAU", "ISO", "FILED", "BUREAU FILED"],
  proprietary: ["PROPRIETARY", "CARRIER PROPRIETARY", "NON-BUREAU", "COMPANY SPECIFIC"],
  // "ADMITTED/NOT ADMITTED" is the PR/Property template; "FILING STATUS" is a common carrier variant.
  admitted: [
    "ADMITTED / NON-ADMITTED",
    "ADMITTED/NON-ADMITTED",
    "ADMITTED",
    "ADMITTED/NOT ADMITTED",
    "ADMITTED / NOT ADMITTED",
    "ADMITTED STATUS",
    "FILING STATUS",
    "ADMITTED NON-ADMITTED"
  ],
  category: ["FORM CATEGORY", "CATEGORY", "TYPE", "FORM TYPE", "DOCUMENT TYPE"],
  dynamic: ["DYNAMIC / STATIC", "DYNAMIC/STATIC", "DYNAMIC", "VARIABLE", "VARIABLE CONTENT"],
  mandatory: [
    "MANDATORY/ OPTIONAL",
    "MANDATORY / OPTIONAL",
    "MANDATORY/OPTIONAL",
    "REQUIRED",
    "MANDATORY OR OPTIONAL",
    "REQUIRED OR OPTIONAL",
    "APPLICABILITY"
  ],
  // "ATTACHMENT CONDITIONS" (plural) is the PR/Property template variant.
  attachment: [
    "ATTACHMENT CONDITION",
    "ATTACHMENT CONDITIONS",
    "CONDITION",
    "WHEN ATTACHED",
    "ATTACH WHEN"
  ],
  display: [
    "DISPLAY ON FORMS SCHEDULE",
    "DISPLAY ON SCHEDULE",
    "SCHEDULE DISPLAY",
    "SHOW ON SCHEDULE",
    "PRINT ON SCHEDULE"
  ],
  useCount: [
    "SINGLE OR MULTI-USE",
    "SINGLE OR MULTI USE",
    "USE COUNT",
    "USAGE",
    "SINGLE/MULTI USE"
  ],
  review: ["REVIEW STATUS", "REVIEW", "APPROVAL STATUS", "CLIENT REVIEW STATUS"]
};
var DYN_FIELDS = {
  number: ["FORM NUMBER"],
  fieldName: ["DYNAMIC FIELD NAME", "FIELD NAME"],
  dataType: ["DATA TYPE"],
  repeating: ["REPEATING FIELD", "REPEATING"],
  notes: ["NOTES"]
};
function parseDynamicFields(grid, ctx) {
  const out = {};
  if (!grid) return out;
  const hr = findHeaderRow(grid, Object.values(DYN_FIELDS));
  if (hr < 0) return out;
  ctx.recognized.push(grid.sheet);
  const header = row(grid, hr);
  const col = mapColumns(header, DYN_FIELDS);
  if (!("number" in col) || !("fieldName" in col)) return out;
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r);
    const number = clean(cells[col["number"]] ?? null);
    const fieldName = clean(cells[col["fieldName"]] ?? null);
    if (!number || !fieldName) continue;
    const key = number.replace(/\s+/g, "-");
    (out[key] ??= []).push({
      name: fieldName,
      dataType: mapDynType("dataType" in col ? cells[col["dataType"]] ?? null : null),
      repeating: isYes("repeating" in col ? cells[col["repeating"]] ?? null : null),
      // The ISO GL template carries no LIST-type fields and no options column; a
      // future template that does would map here. Empty ≠ dropped.
      options: [],
      notes: "notes" in col ? clean(cells[col["notes"]] ?? null) || void 0 : void 0
    });
  }
  ctx.recordUnmapped(grid.sheet, header, new Set(Object.values(col)));
  return out;
}
function parseForms(grid, dynByForm, productRefId, ctx, overlay) {
  const effectiveFormFields = overlay?.columnAliases ? Object.fromEntries(
    Object.entries(FORM_FIELDS).map(([k, v]) => [k, overlay.columnAliases[k] ? [...v, ...overlay.columnAliases[k]] : v])
  ) : FORM_FIELDS;
  const hr = findHeaderRow(grid, Object.values(effectiveFormFields));
  if (hr < 0) {
    ctx.warn(`Forms sheet "${grid.sheet}": no recognizable header row \u2014 skipped.`);
    return [];
  }
  ctx.recognized.push(grid.sheet);
  const header = row(grid, hr);
  const scEarly = stateColumns(header);
  const col = mapColumns(header, effectiveFormFields, stateMatrixExclusions(grid, hr, scEarly));
  if (!("number" in col)) {
    ctx.warn(`Forms sheet "${grid.sheet}": no Form Number column \u2014 skipped.`);
    return [];
  }
  const sc = stateColumns(header);
  const section = fillForward(row(grid, hr - 1));
  const partCols = groupColumns(section, header, /COVERAGE PART/i);
  const txnCols = groupColumns(section, header, /TRANSACTION/i);
  const at = (r, k) => k in col ? r[col[k]] ?? null : null;
  const byKey = /* @__PURE__ */ new Map();
  let dupFormRows = 0;
  const mergedFormKeys = /* @__PURE__ */ new Set();
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r);
    const number = clean(at(cells, "number"));
    if (!number || /^form number/i.test(number)) continue;
    const numKey = number.replace(/\s+/g, "-");
    const edition = clean(at(cells, "edition"));
    const key = edition ? `${numKey}__${edition.replace(/\s+/g, "-")}` : numKey;
    const scope = stateScope(cells, sc);
    const coverageParts = partCols.filter((p) => isX(cells[p.col] ?? null)).map((p) => p.name).sort();
    const transactions = txnCols.filter((t) => isX(cells[t.col] ?? null)).map((t) => t.name).sort();
    const existing = byKey.get(key);
    if (existing) {
      const d = existing.data;
      const uni = (a, b) => [.../* @__PURE__ */ new Set([...a, ...b])];
      d["coverageParts"] = uni(d["coverageParts"], coverageParts);
      d["transactions"] = uni(d["transactions"], transactions);
      if (!d["allStates"]) {
        if (scope.allStates) {
          d["allStates"] = true;
          d["states"] = [];
        } else d["states"] = uni(d["states"], scope.states);
      }
      ctx.warnOnce(`dupform:${key}`, `Sheet "${grid.sheet}" row ${r + 1} col "FORM NUMBER": form ${number} appears on multiple rows \u2014 applicability merged.`);
      dupFormRows++;
      mergedFormKeys.add(key);
      continue;
    }
    const cat = mapFormCategory(at(cells, "category"), overlay);
    if (cat.outlier) {
      ctx.addDefect({
        code: "unmapped_enum",
        field: "category",
        rawValue: clean(at(cells, "category")),
        rowRef: `${grid.sheet} row ${r + 1}`
      });
    } else if (!cat.exact) {
      if (clean(at(cells, "category")) === "") {
        ctx.warnOnce(
          `formcat:blank:${grid.sheet}`,
          `Sheet "${grid.sheet}": blank FORM CATEGORY cell(s) \u2014 defaulted to ENDORSEMENT (the source did not state a category); verify intent.`
        );
      } else {
        ctx.warnOnce(
          `formcat:${norm2(at(cells, "category"))}`,
          `Sheet "${grid.sheet}" row ${r + 1} col "FORM CATEGORY": value "${clean(at(cells, "category"))}" not recognised \u2014 mapped to ENDORSEMENT, verify intent.`
        );
      }
    }
    for (const [fieldKey, label] of [["mandatory", "MANDATORY/ OPTIONAL"], ["dynamic", "DYNAMIC / STATIC"], ["admitted", "ADMITTED / NON-ADMITTED"]]) {
      if (fieldKey in col && clean(at(cells, fieldKey)) === "") {
        ctx.warnOnce(
          `formblank:${fieldKey}:${grid.sheet}`,
          `Sheet "${grid.sheet}": blank ${label} cell(s) \u2014 defaulted (${fieldKey === "admitted" ? "admitted=true" : `${fieldKey}=false`}); the source did not state them.`
        );
      }
    }
    byKey.set(key, {
      docId: key,
      refId: null,
      label: `${number} \u2014 ${clean(at(cells, "name"))}`,
      data: {
        number,
        name: clean(at(cells, "name")),
        edition,
        // Outlier → write ENDORSEMENT as safe write-fallback (defect surfaced above).
        category: cat.category ?? "ENDORSEMENT",
        claimsBasis: mapClaimsBasis(at(cells, "claimsBasis")),
        dynamic: /dynamic/i.test(text(at(cells, "dynamic"))),
        mandatoryDefault: /mandat/i.test(text(at(cells, "mandatory"))),
        attachmentCondition: /rule/i.test(text(at(cells, "attachment"))) ? "RULE" : "NONE",
        source: mapSource(at(cells, "bureau"), at(cells, "proprietary")),
        admitted: !/non-admitted/i.test(text(at(cells, "admitted"))),
        displayOnSchedule: isYes(at(cells, "display")),
        multiUse: /multi/i.test(text(at(cells, "useCount"))),
        transactions,
        coverageParts,
        productRefIds: productRefId ? [productRefId] : [],
        description: "",
        // The Dynamic Data sheet carries no edition column — its rows apply to
        // every edition of the number, so the lookup stays number-keyed.
        dynamicFields: dynByForm[numKey] ?? [],
        ...scope,
        status: "ACTIVE",
        lifecycle: "DRAFT",
        reviewStatus: mapReview(at(cells, "review")),
        reviewer: ""
      }
    });
  }
  if (mergedFormKeys.size > 0) {
    ctx.addNotice({
      code: "forms_applicability_merged",
      message: `${mergedFormKeys.size} form number(s) appeared on multiple rows; state applicability, coverage parts, and transaction columns merged into single entities (${dupFormRows} extra rows collapsed).`,
      data: { mergedForms: mergedFormKeys.size, rowsCollapsed: dupFormRows }
    });
  }
  const handled = new Set(Object.values(col).concat(
    sc.cols.map((s) => s.col),
    sc.allCol,
    partCols.map((p) => p.col),
    txnCols.map((t) => t.col)
  ));
  ctx.recordUnmapped(grid.sheet, header, handled);
  return [...byKey.values()];
}
var RULE_FIELDS = {
  status: ["STATUS", "ACTIVE STATUS", "RULE STATUS"],
  ids: ["PRODUCT FRAMEWORK ID", "FRAMEWORK ID", "COVERAGE ID", "COVERAGE REF", "COVERAGE"],
  id: ["RULE ID", "ID", "RULE NO", "RULE NO.", "RULE #", "RULE NUMBER", "ITEM ID"],
  category: ["RULE CATEGORY", "CATEGORY", "TYPE", "RULE TYPE", "RULE CLASS"],
  subCategory: [
    "RULE SUB-CATEGORY",
    "RULE SUB CATEGORY",
    "SUB CATEGORY",
    "SUB-CATEGORY",
    "SUBCATEGORY",
    "TOPIC",
    "SUBJECT",
    "RULE TOPIC"
  ],
  forms: [
    "FORM NUMBER",
    "FORM NUMBER(S)",
    "ASSOCIATED FORM",
    "APPLICABLE FORM",
    "FORM REFERENCE",
    "RELATED FORM"
  ],
  condition: [
    "RULE CONDITION",
    "CONDITION",
    "WHEN",
    "APPLICABILITY",
    "TRIGGER",
    "IF",
    "CRITERIA",
    "RULE CRITERIA",
    "ELIGIBILITY"
  ],
  outcome: [
    "RULE OUTCOME",
    "OUTCOME",
    "RESULT",
    "EFFECT",
    "THEN",
    "APPLIES",
    "ACTION",
    "RULE ACTION",
    "APPLIES TO"
  ],
  reference: [
    "RULE REFERENCE",
    "REFERENCE",
    "TABLE REF",
    "LD TABLE",
    "SEE ALSO",
    "RATE TABLE",
    "FACTOR TABLE",
    "NOTES"
  ],
  review: [
    "REVIEW STATUS (CLIENT TEAM)",
    "REVIEW STATUS",
    "REVIEW",
    "APPROVAL STATUS",
    "CLIENT REVIEW STATUS"
  ]
};
function parseRules(grid, ctx) {
  const hr = findHeaderRow(grid, Object.values(RULE_FIELDS));
  if (hr < 0) {
    ctx.warn(`Rules sheet "${grid.sheet}": no recognizable header row \u2014 skipped.`);
    return [];
  }
  ctx.recognized.push(grid.sheet);
  const header = row(grid, hr);
  const scEarly = stateColumns(header);
  const col = mapColumns(header, RULE_FIELDS, stateMatrixExclusions(grid, hr, scEarly));
  if (!("id" in col)) {
    ctx.warn(`Rules sheet "${grid.sheet}": no Rule ID column \u2014 skipped.`);
    return [];
  }
  const sc = stateColumns(header);
  const at = (r, k) => k in col ? r[col[k]] ?? null : null;
  const byId = /* @__PURE__ */ new Map();
  let synthSeq = 0;
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r);
    let id = clean(at(cells, "id"));
    if (!id) {
      const hasContent = !!(clean(at(cells, "category")) || clean(at(cells, "subCategory")) || clean(at(cells, "condition")) || clean(at(cells, "outcome")));
      if (!hasContent) continue;
      synthSeq += 1;
      const fwBase = (clean(at(cells, "ids")) || "RULE").split(/[\s,;]+/)[0];
      id = `${fwBase}.RULE.SYNTH${String(synthSeq).padStart(3, "0")}`;
    }
    const forms = splitList(at(cells, "forms"));
    const existing = byId.get(id);
    if (existing) {
      existing.data["formNumbers"] = [.../* @__PURE__ */ new Set([...existing.data["formNumbers"], ...forms])];
      ctx.warnOnce(`duprule:${id}`, `Sheet "${grid.sheet}" row ${r + 1} col "RULE ID": rule ${id} appears on multiple rows \u2014 form numbers merged.`);
      continue;
    }
    byId.set(id, {
      docId: dashId2(id),
      refId: id,
      label: `${id} \u2014 ${clean(at(cells, "subCategory"))}`,
      data: {
        refId: id,
        category: mapRuleCategory(at(cells, "category")),
        subCategory: clean(at(cells, "subCategory")),
        condition: clean(at(cells, "condition")),
        outcome: clean(at(cells, "outcome")),
        ldTableRef: extractTableRef(at(cells, "reference")),
        // The raw reference cell, kept only when a table ref was extracted: real
        // workbooks carry stale numeric refs ("Policy Deductible Type (LDTable.122)"
        // where the parsed table is LDTABLE.119) — the same cell's NAME is the
        // authoritative recovery channel for the term fold (PCM-A).
        ldTableRefText: extractTableRef(at(cells, "reference")) ? clean(at(cells, "reference")) : void 0,
        // TRANSIENT: the raw RULE REFERENCE text, consumed + deleted by linkReferenceTables
        // (concept rule→table matching, D2). Never reaches a plan/golden — so GL/IM/PR rules
        // stay byte-identical whether or not their reference is a concept name.
        _referenceText: clean(at(cells, "reference")) || void 0,
        coverageRefIds: splitList(at(cells, "ids")),
        formNumbers: forms,
        ...stateScope(cells, sc),
        status: mapStatus(at(cells, "status")),
        lifecycle: "DRAFT",
        reviewStatus: mapReview(at(cells, "review")),
        reviewer: ""
      }
    });
  }
  const handled = new Set(Object.values(col).concat(sc.cols.map((s) => s.col), sc.allCol));
  ctx.recordUnmapped(grid.sheet, header, handled);
  return [...byId.values()];
}
var FORMRULE_FIELDS = {
  id: ["FORM RULE ID", "RULE ID"],
  forms: ["FORM NUMBER", "FORM NUMBER(S)"],
  condition: ["RULE CONDITION"],
  outcome: ["RULE OUTCOME"],
  review: ["REVIEW STATUS (<CLIENT NAME>)", "REVIEW STATUS"]
};
function parseFormRules(grid, ctx) {
  const hr = findHeaderRow(grid, Object.values(FORMRULE_FIELDS));
  if (hr < 0) {
    ctx.warn(`Optional forms rules sheet "${grid.sheet}": no recognizable header row \u2014 skipped.`);
    return [];
  }
  ctx.recognized.push(grid.sheet);
  const header = row(grid, hr);
  const col = mapColumns(header, FORMRULE_FIELDS);
  if (!("id" in col)) {
    ctx.warn(`Optional forms rules sheet "${grid.sheet}": no Form Rule ID column \u2014 skipped.`);
    return [];
  }
  const at = (r, k) => k in col ? r[col[k]] ?? null : null;
  const byId = /* @__PURE__ */ new Map();
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r);
    const id = clean(at(cells, "id"));
    if (!id) continue;
    const forms = splitList(at(cells, "forms"));
    const outcome = clean(at(cells, "outcome"));
    const existing = byId.get(id);
    if (existing) {
      existing.data["formNumbers"] = [.../* @__PURE__ */ new Set([...existing.data["formNumbers"], ...forms])];
      ctx.warnOnce(`dupformrule:${id}`, `Sheet "${grid.sheet}" row ${r + 1} col "FORM RULE ID": form rule ${id} appears on multiple rows \u2014 form numbers merged.`);
      continue;
    }
    byId.set(id, {
      docId: dashId2(id),
      refId: id,
      label: `${id} \u2014 ${clean(at(cells, "condition")).slice(0, 40)}`,
      data: {
        refId: id,
        condition: clean(at(cells, "condition")),
        outcome,
        formNumbers: forms,
        mandatory: /mandat/i.test(outcome),
        status: "ACTIVE",
        lifecycle: "DRAFT",
        reviewStatus: mapReview(at(cells, "review")),
        reviewer: ""
      }
    });
  }
  const handled = new Set(Object.values(col));
  ctx.recordUnmapped(grid.sheet, header, handled);
  return [...byId.values()];
}
function foldLdTermsIntoCoverages(coverages, rules, ldTables, ctx) {
  if (coverages.length === 0 || ldTables.length === 0) return;
  const covByRefId = new Map(coverages.map((c) => [c.refId, c]));
  const tableByRefId = new Map(ldTables.map((t) => [t.refId, t]));
  const foldKey = (s) => String(s ?? "").toLowerCase().replace(/\bcoverage\b/g, "").replace(/[^a-z0-9]+/g, "");
  const tablesByNameKey = /* @__PURE__ */ new Map();
  for (const t of ldTables) {
    const k = foldKey(t.data.name);
    if (!k) continue;
    const list = tablesByNameKey.get(k) ?? [];
    list.push(t);
    tablesByNameKey.set(k, list);
  }
  const attached = /* @__PURE__ */ new Set();
  const consumedTables = /* @__PURE__ */ new Set();
  let unknownCoverageRefs = 0;
  let danglingTableRefs = 0;
  let recoveredStaleRefs = 0;
  const attach = (cov, tableEntity, evidence) => {
    const tableRefId = tableEntity.refId;
    const dedupeKey = `${cov.refId}|${tableRefId}`;
    if (attached.has(dedupeKey)) return;
    attached.add(dedupeKey);
    consumedTables.add(tableRefId);
    const table = tableEntity.data;
    const hay = `${table.name ?? ""} ${table.valueHeader ?? ""} ${evidence}`;
    const kind = /deductible/i.test(hay) ? "DEDUCTIBLE" : /limit/i.test(hay) ? "LIMIT" : "OPTION";
    const term = {
      id: tableRefId.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      kind,
      label: table.name && String(table.name) || tableRefId,
      ldTableRef: tableRefId,
      // Default precedence: the row the source marks "Default", else the first
      // available value (the same fallback the UI's resolveTermOptions applies).
      default: table.defaultValue ?? table.rows?.[0]?.value ?? 0,
      basis: ""
    };
    cov.data["terms"].push(term);
  };
  for (const rule of rules) {
    const ref = rule.data["ldTableRef"];
    if (typeof ref !== "string" || !/^LD ?TABLE\./i.test(ref)) continue;
    let tableEntity = tableByRefId.get(ref);
    if (!tableEntity) {
      const cellText = String(rule.data["ldTableRefText"] ?? "");
      const nameKey2 = foldKey(cellText.replace(/\([^)]*\)/g, " "));
      const matches = nameKey2 ? tablesByNameKey.get(nameKey2) ?? [] : [];
      if (matches.length === 1) {
        tableEntity = matches[0];
        recoveredStaleRefs++;
      } else {
        danglingTableRefs++;
        continue;
      }
    }
    const covRefIds = Array.isArray(rule.data["coverageRefIds"]) ? rule.data["coverageRefIds"] : [];
    for (const covRefId of covRefIds) {
      const cov = covByRefId.get(covRefId);
      if (!cov) {
        unknownCoverageRefs++;
        continue;
      }
      attach(cov, tableEntity, `${String(rule.data["outcome"] ?? "")} ${String(rule.data["subCategory"] ?? "")}`);
    }
  }
  const covByName = /* @__PURE__ */ new Map();
  for (const c of coverages) {
    const k = foldKey(c.data["name"]);
    if (!k) continue;
    const list = covByName.get(k) ?? [];
    list.push(c);
    covByName.set(k, list);
  }
  for (const t of ldTables) {
    const refId = t.refId;
    if (consumedTables.has(refId)) continue;
    const k = foldKey(t.data.name);
    if (!k) continue;
    const matches = covByName.get(k);
    if (!matches || matches.length !== 1) continue;
    attach(matches[0], t, "");
  }
  if (attached.size > 0 || unknownCoverageRefs > 0 || danglingTableRefs > 0) {
    const unattachedCount = ldTables.filter((t) => !consumedTables.has(t.refId)).length;
    ctx.addNotice({
      code: "ld_terms_folded",
      message: `${attached.size} coverage term(s) assembled from ${consumedTables.size} LD table(s); ${unattachedCount} table(s) unattached${recoveredStaleRefs ? `; ${recoveredStaleRefs} stale table ref(s) recovered by name` : ""}${danglingTableRefs ? `; ${danglingTableRefs} table ref(s) resolve to no parsed table (no term emitted)` : ""}${unknownCoverageRefs ? `; ${unknownCoverageRefs} rule coverage ref(s) not in this workbook` : ""}.`,
      data: { termsAttached: attached.size, tablesConsumed: consumedTables.size, tablesUnattached: unattachedCount, recoveredStaleRefs, danglingTableRefs, unknownCoverageRefs }
    });
  }
}
var LD_MARKER_GL = /^LD ?TABLE\.\s*\w+/i;
var LD_MARKER_IM = /^LD\d+$/i;
var LD_MARKER = /^LD ?TABLE\.\s*\w+|^LD\d+$/i;
function parseLdTables(grid, ctx) {
  if (!grid) return [];
  ctx.recognized.push(grid.sheet);
  const tables = /* @__PURE__ */ new Map();
  const rows = grid.cells;
  let markerCol = 0;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    if (LD_MARKER_GL.test(norm2(cell(grid, r, 0)))) break;
    if (LD_MARKER_IM.test(norm2(cell(grid, r, 1)))) {
      markerCol = 1;
      break;
    }
  }
  for (let r = 0; r < rows.length; r++) {
    const first = norm2(cell(grid, r, markerCol));
    if (!LD_MARKER.test(first)) continue;
    const refId = text(cell(grid, r, markerCol));
    const markerRow = row(grid, r);
    const nameIdx = markerRow.findIndex((c) => /TABLE NAME/i.test(text(c)));
    let name = "";
    if (nameIdx >= 0) name = clean(markerRow.slice(nameIdx + 1).find((c) => clean(c)) ?? null);
    if (!name) name = clean(markerRow.slice(markerCol + 1).find((c) => clean(c) && !/TABLE NAME/i.test(text(c))) ?? null);
    let valueCol = -1, commentCol = -1, headerR = r;
    let valueHeader;
    for (let hr = r; hr <= r + 2 && hr < rows.length; hr++) {
      const hrow = row(grid, hr);
      const vi = hrow.findIndex((c) => /^AVAILABLE\b|^LIMITS?$|^DEDUCTIBLES?$|^TYPE$/i.test(text(c).trim()));
      if (vi >= 0) {
        valueCol = vi;
        headerR = hr;
        valueHeader = text(hrow[vi] ?? null).trim() || void 0;
        commentCol = hrow.findIndex((c) => /COMMENT/i.test(text(c)));
        break;
      }
    }
    if (valueCol < 0) {
      valueCol = markerCol + 3;
      commentCol = markerCol + 4;
      headerR = r;
    }
    const entry = tables.get(refId) ?? {
      name,
      rows: [],
      unpricedRows: [],
      optionValues: [],
      defaultValue: void 0,
      valueHeader
    };
    if (tables.has(refId)) ctx.warnOnce(`dupld:${refId}`, `Sheet "${grid.sheet}" row ${r + 1} (LD marker): table ${refId} appears more than once \u2014 rows merged.`);
    if (!entry.name) entry.name = name;
    if (!entry.valueHeader) entry.valueHeader = valueHeader;
    let dr = headerR + 1;
    for (; dr < rows.length; dr++) {
      if (LD_MARKER.test(norm2(cell(grid, dr, markerCol)))) break;
      const raw = cell(grid, dr, valueCol);
      const label = clean(raw);
      if (!label || /^available|^comment|^limit$|^deductible/i.test(label)) continue;
      const note = commentCol >= 0 ? clean(cell(grid, dr, commentCol)) : "";
      const num = parseNum(raw);
      if (num === null) {
        if (SPLIT_LIMIT_RE.test(label)) {
          if (!entry.optionValues.includes(label)) entry.optionValues.push(label);
          continue;
        }
        ctx.warnOnce(
          `ldnonnum:${refId}:${label}`,
          `Sheet "${grid.sheet}" row ${dr + 1} (table ${refId}): limit/deductible "${label}" is not numeric \u2014 no amount was assumed (it is NOT $0); set it by hand. Code: ld_value_non_numeric.`
        );
        entry.unpricedRows.push({ label, verbatim: label, constraintNote: note || void 0 });
        continue;
      }
      entry.rows.push({ label, value: num, constraintNote: note || void 0 });
      if (/default/i.test(note)) entry.defaultValue = num;
    }
    ctx.consume(grid.sheet, r, dr - 1, markerCol, Math.max(valueCol, commentCol, markerCol), `ld-table:${refId}`);
    tables.set(refId, entry);
  }
  return [...tables.entries()].map(([refId, t]) => ({
    docId: refId,
    refId,
    label: `${refId} \u2014 ${t.name}`,
    data: {
      name: t.name,
      defaultValue: t.defaultValue,
      rows: t.rows,
      valueHeader: t.valueHeader,
      ...t.optionValues.length ? { optionValues: [...t.rows.map((r) => r.value), ...t.optionValues] } : {},
      ...t.unpricedRows.length ? { unpricedRows: t.unpricedRows, needsReview: true } : {}
    }
  }));
}
var RT_ID_MARKER = /^RATE TABLE ID/i;
var RT_NAME_MARKER = /^RATE TABLE NAME/i;
function parseRtTables(grid, ctx) {
  if (!grid) return [];
  ctx.recognized.push(grid.sheet);
  const tables = /* @__PURE__ */ new Map();
  const rows = grid.cells;
  let pendingName = "";
  for (let r = 0; r < rows.length; r++) {
    const first = norm2(cell(grid, r, 0));
    if (RT_NAME_MARKER.test(first)) {
      pendingName = clean(row(grid, r).slice(1).find((c) => clean(c)) ?? null);
      continue;
    }
    if (!RT_ID_MARKER.test(first)) continue;
    const refId = clean(row(grid, r).slice(1).find((c) => clean(c)) ?? null);
    if (!refId) continue;
    let headerR = -1;
    for (let hr = r + 1; hr < rows.length && hr <= r + 3; hr++) {
      if (RT_NAME_MARKER.test(norm2(cell(grid, hr, 0))) || RT_ID_MARKER.test(norm2(cell(grid, hr, 0)))) break;
      if (row(grid, hr).filter((c) => clean(c)).length >= 2) {
        headerR = hr;
        break;
      }
    }
    if (headerR < 0) continue;
    const headerRow = row(grid, headerR);
    const colIdx = [];
    const columns = [];
    headerRow.forEach((c, i) => {
      const nm = clean(c);
      if (nm) {
        colIdx.push(i);
        columns.push(nm);
      }
    });
    const entry = tables.get(refId) ?? { name: pendingName, columns, rows: [], colIdx };
    if (tables.has(refId)) ctx.warnOnce(`duprt:${refId}`, `Sheet "${grid.sheet}" row ${r + 1} col "RATE TABLE ID": table ${refId} appears more than once \u2014 rows merged.`);
    if (!entry.name) entry.name = pendingName;
    let dr = headerR + 1;
    for (; dr < rows.length; dr++) {
      const f = norm2(cell(grid, dr, 0));
      if (RT_NAME_MARKER.test(f) || RT_ID_MARKER.test(f)) break;
      const cells = row(grid, dr);
      if (!entry.colIdx.some((ci) => clean(cells[ci] ?? null))) continue;
      const rec = {};
      entry.colIdx.forEach((ci, k) => {
        const raw = cells[ci] ?? null;
        const num = parseNum(raw);
        rec[entry.columns[k] ?? `col${k}`] = num !== null ? num : clean(raw);
      });
      entry.rows.push(rec);
    }
    ctx.consume(grid.sheet, r, dr - 1, 0, colIdx.length ? Math.max(...colIdx) : 0, `rt-table:${refId}`);
    tables.set(refId, entry);
  }
  return [...tables.entries()].map(([refId, t]) => {
    const model = deriveGridModel({ name: t.name, columns: t.columns, rows: t.rows });
    const grid2 = model ? { valueColumn: model.valueColumn, dimensions: model.dimensions.map((d) => ({ key: d.key, label: d.label, values: [...d.values] })) } : {};
    return {
      docId: refId,
      refId,
      label: `${refId} \u2014 ${t.name}`,
      data: { name: t.name, columns: t.columns, rows: t.rows, ...grid2 }
    };
  });
}
var RATE_FIELDS = {
  status: ["STATUS", "ACTIVE STATUS", "STEP STATUS"],
  ids: ["PRODUCT FRAMEWORK ID", "FRAMEWORK ID", "COVERAGE ID", "COVERAGE"],
  stepId: [
    "RATING STEP ID",
    "STEP ID",
    "STEP",
    "STEP NUMBER",
    "STEP NO",
    "ITEM",
    "ID",
    "SEQUENCE",
    "STEP #",
    "LINE NO",
    "LINE NUMBER"
  ],
  grouping: ["RATING GROUPING", "GROUPING", "GROUP", "SECTION", "ELEMENT", "CATEGORY"],
  // The coverage-name group column real carrier ROCs group their steps under (forward-filled;
  // one value per group). Distinct from `grouping` so it never shadows the step-label fallback.
  groupName: ["COVERAGE NAME", "COVERAGE GROUP", "RATING GROUP NAME"],
  manualId: [
    "RATING MANUAL RULE/ STEP ID",
    "RATING MANUAL RULE/STEP ID",
    "MANUAL RULE/ STEP ID",
    "MANUAL STEP",
    "MANUAL REF",
    "MANUAL RULE"
  ],
  // "RULES" is the ROC-template short form; broader synonyms for novel formats.
  rules: [
    "RATING RULES",
    "RULES",
    "RULE",
    "DESCRIPTION",
    "STEP DESCRIPTION",
    "LABEL",
    "RATING ELEMENT",
    "ELEMENT DESCRIPTION"
  ],
  algorithm: [
    "ALGORITHM STEP",
    "ALGORITHM",
    "FORMULA",
    "CALCULATION DESCRIPTION",
    "STEP DETAIL",
    "LOGIC"
  ],
  calc: ["CALCULATION", "OPERATOR", "OPERATION", "CALC", "MATH", "OP"],
  rounding: [
    "ROUNDING NUMBER OF DIGITS",
    "ROUNDING",
    "ROUND TO",
    "ROUNDING RULE",
    "DIGITS",
    "DECIMAL PLACES"
  ],
  // "TABLE REFERENCE" is the ROC-template equivalent of "RATE REFERENCE".
  reference: [
    "RATE REFERENCE",
    "TABLE REFERENCE",
    "RT TABLE",
    "RATE TABLE",
    "TABLE",
    "FACTOR TABLE",
    "LOOKUP TABLE",
    "RATE TABLE REFERENCE"
  ],
  review: ["REVIEW STATUS", "REVIEW", "APPROVAL STATUS"]
};
var GLOBAL_STEP = /\b(final premium|total (?:endorsement )?premium|premium subject to minimum|minimum premium|assessment|authority fee|fund fee|theft surcharge|taxe?s?)\b/i;
function mapOp(v) {
  const s = text(v).trim();
  if (s === "+" || s === "-") return "ADD";
  if (s === "=") return "SET";
  return "MUL";
}
function parseRating(grid, rtTables, productRefId, lobName, ctx) {
  const hr = findHeaderRow(grid, Object.values(RATE_FIELDS));
  if (hr < 0) {
    ctx.warn(`Rating sheet "${grid.sheet}": no recognizable header row \u2014 skipped.`);
    return null;
  }
  ctx.recognized.push(grid.sheet);
  const header = row(grid, hr);
  const scEarly = stateColumns(header);
  const col = mapColumns(header, RATE_FIELDS, stateMatrixExclusions(grid, hr, scEarly));
  if (!("stepId" in col) && !("algorithm" in col)) {
    ctx.warn(`Rating sheet "${grid.sheet}": no rating step columns \u2014 skipped.`);
    return null;
  }
  const sc = stateColumns(header);
  const at = (r, k) => k in col ? r[col[k]] ?? null : null;
  const rtByName = new Map(rtTables.map((t) => [norm2(t.data["name"] ?? ""), t.refId]));
  const resolveRef = (v) => {
    const s = norm2(v).replace(/ TABLE$/, "");
    if (!s) return void 0;
    for (const [name, refId2] of rtByName) if (name && (name === s || name.includes(s) || s.includes(name))) return refId2;
    return void 0;
  };
  const steps = [];
  const scopes = [];
  let programRefId = null;
  let order = 0;
  let lastGroupName = "";
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r);
    const stepId = clean(at(cells, "stepId"));
    const label = clean(at(cells, "algorithm")) || clean(at(cells, "rules")) || clean(at(cells, "grouping"));
    if (!stepId && !label) continue;
    const gn = clean(at(cells, "groupName"));
    if (gn) lastGroupName = gn;
    const stepGroupName = !gn && GLOBAL_STEP.test(label) ? "" : lastGroupName;
    if (!programRefId) {
      const full = [stepId, ...splitList(at(cells, "ids"))].find((s) => /\.RAT/i.test(s));
      if (full) {
        const m = full.match(/^(.*\.RAT\.\d+)/i);
        programRefId = m ? m[1] : full;
      }
    }
    const ref = resolveRef(at(cells, "reference"));
    const rounding = at(cells, "rounding");
    const roundTo = /nearest dollar/i.test(text(rounding)) ? 0 : parseNum(rounding) ?? void 0;
    const rawRef = clean(at(cells, "reference"));
    order += 1;
    steps.push({
      id: stepId || `step-${order}`,
      order,
      label: label || stepId,
      op: mapOp(at(cells, "calc")),
      source: ref ? { type: "RT", ref } : rawRef ? { type: "RT", ref: rawRef } : { type: "INPUT", ref: label || stepId },
      ...roundTo !== void 0 ? { roundTo } : {},
      ...stepGroupName ? { groupName: stepGroupName } : {}
    });
    scopes.push(stateScope(cells, sc));
  }
  if (!steps.length) return null;
  const refId = programRefId ?? `${productRefId ? refIdPrefix(productRefId) || "PROD" : "PROD"}.RAT.1`;
  const scope = scopes.some((s) => s.allStates) || !scopes.length ? { allStates: true, states: [] } : { allStates: false, states: [...new Set(scopes.flatMap((s) => s.states))].sort() };
  const handled = new Set(Object.values(col).concat(sc.cols.map((s) => s.col), sc.allCol));
  ctx.recordUnmapped(grid.sheet, header, handled);
  return {
    docId: dashId2(refId),
    refId,
    label: `${refId} \u2014 rating program`,
    data: {
      refId,
      name: `${lobName || "Imported"} Rating Program`,
      minimumPremium: 0,
      steps,
      ...scope,
      status: "ACTIVE",
      lifecycle: "DRAFT",
      reviewStatus: "NOT_STARTED",
      reviewer: ""
    }
  };
}
var SPLIT_LIMIT_RE = /^\d[\d.,]*\s*\/\s*\d/;
var TABLE_NAME_MARKER = /^TABLE NAME:/i;
var RULE_ID_MARKER = /^RULE ID:/i;
function detectReferenceTables(grids, consumed, ctx) {
  const drafts = [];
  for (const grid of grids) {
    if (consumed.has(grid.sheet)) continue;
    if (IGNORE_SHEET.test(grid.sheet) || DECOY_SHEET.test(grid.sheet) || VERSION_SUFFIX.test(grid.sheet)) continue;
    const markerRows = [];
    for (let r = 0; r < grid.cells.length; r++) {
      if (TABLE_NAME_MARKER.test(text(cell(grid, r, 0)))) markerRows.push(r);
    }
    if (markerRows.length < 2) continue;
    ctx.recognized.push(grid.sheet);
    const nameCount = /* @__PURE__ */ new Map();
    for (let i = 0; i < markerRows.length; i++) {
      const start = markerRows[i];
      const end = (markerRows[i + 1] ?? grid.cells.length) - 1;
      const baseName = text(cell(grid, start, 0)).replace(/^TABLE NAME:\s*/i, "").trim();
      if (!baseName) continue;
      const mrow = row(grid, start);
      const covCodes = [];
      for (let c = 2; c <= 33; c++) {
        const s = clean(mrow[c] ?? null);
        if (s && !covCodes.includes(s)) covCodes.push(s);
      }
      const ridRow = row(grid, start + 1);
      const hasRid = RULE_ID_MARKER.test(text(ridRow[0] ?? null));
      const backLinkWas = hasRid ? clean(ridRow[1] ?? null) : "";
      const dataStart = start + (hasRid ? 2 : 1);
      const state = (baseName.match(/-\s*([A-Z]{2})\s*$/) ?? [])[1];
      let group;
      const rows = [];
      const optionValues = [];
      const rowLabels = [];
      const seen = /* @__PURE__ */ new Set();
      const valueCols = /* @__PURE__ */ new Set();
      let lostRows = 0;
      for (let r = dataStart; r <= end && r < grid.cells.length; r++) {
        const label = clean(cell(grid, r, 0));
        const rawVal = cell(grid, r, 1);
        const valStr = clean(rawVal);
        let rightward = null;
        for (let c = 2; c <= 33; c++) {
          if (parseNum(cell(grid, r, c)) !== null) {
            valueCols.add(c);
            if (rightward === null) rightward = c;
          }
        }
        if (parseNum(rawVal) !== null) valueCols.add(1);
        if (valStr === "" && rightward !== null) lostRows++;
        if (!label && !valStr) continue;
        if (label && !rowLabels.includes(label)) rowLabels.push(label);
        if (!group) {
          const gm = label.match(/^GROUP \d[^:]*/i);
          if (gm) group = gm[0].trim();
        }
        const num = parseNum(rawVal);
        if (num !== null && !seen.has(String(num)) && rows.length < 40) {
          seen.add(String(num));
          rows.push({ label: label || String(num), value: num });
          if (!optionValues.includes(num)) optionValues.push(num);
        } else if (num === null && SPLIT_LIMIT_RE.test(valStr) && !seen.has(valStr) && optionValues.length < 60) {
          seen.add(valStr);
          optionValues.push(valStr);
        }
      }
      const hay = `${baseName} ${backLinkWas} ${covCodes.join(" ")}`.toUpperCase();
      const kindHint = /DEDUCTIBLE/.test(hay) ? "DEDUCTIBLE" : /\bLIMIT/.test(hay) ? "LIMIT" : "OPTION";
      let displayName = baseName + (group ? ` [${group.replace(/\s+/g, " ")}]` : "");
      const n = (nameCount.get(displayName) ?? 0) + 1;
      nameCount.set(displayName, n);
      if (n > 1) displayName = `${displayName} (v${n})`;
      const isMatrix = lostRows > 0 && valueCols.size >= 2;
      let refusalReason;
      if (isMatrix) {
        const hrow = row(grid, dataStart);
        const cols = [...valueCols].sort((a, b) => a - b).map((c) => (clean(mrow[c] ?? null) || clean(hrow[c] ?? null) || "").split("\n")[0]?.trim() || `column ${c + 1}`);
        refusalReason = `Values span ${valueCols.size} columns (${cols.join(", ")}) and ${lostRows} row(s) state no value in the first column \u2014 a limit matrix, not a single list. Values were NOT extracted; set the per-column limits by hand.`;
        ctx.warnOnce(
          `refmatrix:${displayName}`,
          `Sheet "${grid.sheet}" rows ${start + 1}-${end + 1} ("${baseName}"): ${refusalReason} Code: reference_table_matrix_refused.`
        );
      }
      const consumeTo = isMatrix || covCodes.length ? 33 : 1;
      ctx.consume(grid.sheet, start, Math.min(end, grid.cells.length - 1), 0, consumeTo, `reference-table:${displayName}`);
      drafts.push({
        baseName,
        displayName,
        state,
        group,
        covCodes,
        kindHint,
        sourceRows: `${start + 1}-${end + 1}`,
        rows: isMatrix ? [] : rows,
        optionValues: isMatrix ? [] : optionValues,
        rowLabels,
        backLinkWas,
        shape: isMatrix ? "MATRIX" : "FLAT",
        refusalReason
      });
    }
  }
  return drafts;
}
function mintReferenceTables(drafts, prefix) {
  return drafts.map((d, i) => {
    const refId = `${prefix}.TBL.${String(i + 1).padStart(3, "0")}`;
    const data = {
      name: d.displayName,
      rows: d.rows,
      defaultValue: d.rows[0]?.value,
      valueHeader: d.backLinkWas || void 0,
      kindHint: d.kindHint,
      state: d.state,
      coverageCodes: d.covCodes.length ? d.covCodes : void 0,
      coverageRefIds: [],
      ruleRefIds: [],
      backLinkWas: d.backLinkWas || void 0,
      optionValues: d.optionValues.length ? d.optionValues : void 0,
      mintedId: true,
      linkBasis: "derived",
      // A MATRIX draft carries no rows by design — surface WHY, so the review UI shows an
      // actionable refusal instead of an empty table that looks like a parse miss.
      ...d.shape === "MATRIX" ? { shape: "MATRIX", needsReview: true, refusalReason: d.refusalReason } : {}
    };
    return { docId: refId, refId, label: `${refId} \u2014 ${d.displayName}`, data };
  });
}
function buildCovsByForm(coverages) {
  const out = /* @__PURE__ */ new Map();
  for (const c of coverages) {
    for (const f of c.data["formNumbers"] ?? []) {
      const k = squishStr(f);
      if (!k) continue;
      const list = out.get(k) ?? [];
      if (!list.includes(c.refId)) list.push(c.refId);
      out.set(k, list);
    }
  }
  return out;
}
function linkReferenceTables(refDrafts, refTables, coverages, rules, overlay) {
  const refTexts = rules.map((r) => {
    const t = r.data["_referenceText"];
    delete r.data["_referenceText"];
    return typeof t === "string" ? t : "";
  });
  const tally = { backLinked: 0, covLinked: 0, rulesLinked: 0, resolvedToCoverage: 0, unresolved: 0, aiProposed: 0, resolvedRefs: [], unresolvedRefs: [] };
  if (!refTables.length) return tally;
  const namedCovs = coverages.map((c) => ({ refId: c.refId, name: String(c.data["name"] ?? "") }));
  const conceptTables = refTables.map((t, i) => ({ refId: t.refId, baseName: refDrafts[i].baseName, state: refDrafts[i].state }));
  const tableByRefId = new Map(refTables.map((t) => [t.refId, t]));
  const covsByForm = buildCovsByForm(coverages);
  const covRefIdSet = new Set(namedCovs.map((c) => c.refId));
  const tableRefIdSet = new Set(refTables.map((t) => t.refId));
  const validRefs = (proposed, ids) => (proposed ?? []).filter((id) => ids.has(id));
  refDrafts.forEach((d, i) => {
    const linked = /* @__PURE__ */ new Set();
    if (/LIABILITY LIMITS/i.test(d.baseName)) {
      for (const code of d.covCodes) for (const id of resolveCoverageCode(code, namedCovs)) linked.add(id);
    } else if (/PHYSICAL DAMAGE DEDUCTIBLE/i.test(d.baseName)) {
      for (const id of physicalDamageCoverages(namedCovs)) linked.add(id);
    } else if (/SUB-?COVERAGE.*LIMIT/i.test(d.baseName)) {
      for (const label of d.rowLabels) {
        const m = matchCoverageByName(label, namedCovs);
        if (m) linked.add(m.refId);
      }
    } else {
      const m = matchCoverageByName(d.baseName.replace(FORM_TOKEN, " "), namedCovs);
      if (m) linked.add(m.refId);
      for (const ftk of formTokens(d.baseName)) for (const id of covsByForm.get(squishStr(ftk)) ?? []) linked.add(id);
    }
    if (linked.size === 0 && overlay?.tableCoverageLinks) {
      const ai = validRefs(overlay.tableCoverageLinks[refTables[i].refId], covRefIdSet);
      if (ai.length) {
        ai.forEach((id) => linked.add(id));
        refTables[i].data["linkBasis"] = "ai-proposed";
        tally.aiProposed++;
      }
    }
    refTables[i].data["coverageRefIds"] = [...linked];
    if (linked.size) tally.covLinked++;
  });
  for (let i = 0; i < rules.length; i++) {
    const ref = refTexts[i];
    if (!ref) continue;
    const rule = rules[i];
    const states = rule.data["states"] ?? [];
    const allStates = rule.data["allStates"] === true;
    const m = matchRuleReferenceToTables(ref, conceptTables, states, allStates, namedCovs);
    if (m.tableRefIds.length) {
      rule.data["tableRefIds"] = m.tableRefIds;
      rule.data["tableLinkBasis"] = "derived";
      tally.rulesLinked++;
      for (const tid of m.tableRefIds) {
        const rr = tableByRefId.get(tid)?.data["ruleRefIds"];
        if (rr && !rr.includes(rule.refId)) rr.push(rule.refId);
      }
    } else if (m.resolvedCoverageRefId) {
      rule.data["resolvedCoverageRefId"] = m.resolvedCoverageRefId;
      tally.resolvedToCoverage++;
      if (!tally.resolvedRefs.includes(ref)) tally.resolvedRefs.push(ref);
    } else {
      const ai = overlay?.ruleReferenceLinks ? validRefs(overlay.ruleReferenceLinks[ref], tableRefIdSet) : [];
      if (ai.length) {
        rule.data["tableRefIds"] = ai;
        rule.data["tableLinkBasis"] = "ai-proposed";
        tally.rulesLinked++;
        tally.aiProposed++;
        for (const tid of ai) {
          const rr = tableByRefId.get(tid)?.data["ruleRefIds"];
          if (rr && !rr.includes(rule.refId)) rr.push(rule.refId);
        }
      } else if (m.how === "NO MATCHING TABLE IN SOURCE") {
        tally.unresolved++;
        if (!tally.unresolvedRefs.includes(ref)) tally.unresolvedRefs.push(ref);
      }
    }
  }
  tally.backLinked = refTables.filter((t) => t.data["ruleRefIds"].length > 0).length;
  return tally;
}
function deriveTermsFromReferenceTables(coverages, refTables, ctx) {
  if (!refTables.length) return 0;
  const covByRefId = new Map(coverages.map((c) => [c.refId, c]));
  const dedup = /* @__PURE__ */ new Set();
  let attached = 0;
  for (const table of refTables) {
    const data = table.data;
    if (data.kindHint !== "LIMIT" && data.kindHint !== "DEDUCTIBLE") continue;
    if (data.shape === "MATRIX") {
      const waiting = (data.coverageRefIds ?? []).length;
      if (waiting > 0) {
        ctx?.warnOnce(
          `refmatrixterms:${table.refId}`,
          `Reference table ${table.refId} ("${data.name}") is an unresolved limit matrix \u2014 ${waiting} linked coverage(s) have NO ${data.kindHint} term pending manual entry (no default was invented). Code: reference_table_matrix_terms_withheld.`
        );
      }
      continue;
    }
    const covIds = data.coverageRefIds ?? [];
    if (!covIds.length) continue;
    const tableRefId = table.refId;
    for (const covId of covIds) {
      const cov = covByRefId.get(covId);
      if (!cov) continue;
      const key = `${covId}|${tableRefId}`;
      if (dedup.has(key)) continue;
      dedup.add(key);
      const term = {
        id: tableRefId.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        kind: data.kindHint,
        label: data.name || tableRefId,
        ldTableRef: tableRefId,
        // resolves in the UI — CORE.TBL is in plan.ldTables
        options: data.optionValues ?? (data.rows ?? []).map((r) => r.value),
        default: data.defaultValue ?? data.rows?.[0]?.value ?? 0,
        basis: "",
        states: data.state ? [data.state] : [],
        allStates: !data.state,
        linkBasis: "derived"
      };
      cov.data["terms"].push(term);
      attached++;
    }
  }
  return attached;
}
function enrichRatingWithGroups(ratingProgram, coverages, refTablesPresent, prefix, overlay) {
  const empty = { groups: 0, matched: 0, aiProposed: 0, unmatchedNames: [] };
  if (!ratingProgram || !refTablesPresent) return empty;
  const steps = ratingProgram.data["steps"];
  if (!steps.some((s) => s.groupName)) return empty;
  const namedCovs = coverages.map((c) => ({ refId: c.refId, name: String(c.data["name"] ?? "") }));
  const covsByForm = buildCovsByForm(coverages);
  const covRefIdSet = new Set(namedCovs.map((c) => c.refId));
  let aiProposed = 0;
  const groups = [];
  const unmatchedNames = [];
  let cur = null;
  let gSeq = 0;
  for (const step of steps) {
    const gn = step.groupName;
    if (gn && (!cur || cur.name !== gn)) {
      gSeq += 1;
      const m = matchGroup(gn, namedCovs, covsByForm);
      let covRefIds = m.covRefIds;
      let matchBasis = m.matchBasis;
      if (m.matchBasis === "unmatched" && overlay?.ratingGroupLinks) {
        const ai = (overlay.ratingGroupLinks[gn] ?? []).filter((id) => covRefIdSet.has(id));
        if (ai.length) {
          covRefIds = ai;
          matchBasis = "ai-proposed";
          aiProposed++;
        }
      }
      cur = {
        refId: `${prefix}.RTG.${String(gSeq).padStart(3, "0")}`,
        name: gn,
        coverageRefIds: covRefIds,
        formNumbers: m.formNums,
        stepRefIds: [],
        matchBasis
      };
      groups.push(cur);
      if (matchBasis === "unmatched") unmatchedNames.push(gn);
    }
    if (cur && gn) {
      step.groupRefId = cur.refId;
      if (cur.coverageRefIds.length) step.groupCoverageRefIds = cur.coverageRefIds;
      if (cur.formNumbers.length) step.packageFormNumbers = cur.formNumbers;
      step.groupMatchBasis = cur.matchBasis;
      cur.stepRefIds.push(step.id);
    }
  }
  ratingProgram.data["ratingGroups"] = groups;
  return { groups: groups.length, matched: groups.filter((g) => g.matchBasis !== "unmatched").length, aiProposed, unmatchedNames };
}
function upgradeFormAnchors(forms, coverages, refTablesPresent) {
  if (!refTablesPresent) return 0;
  const covsByForm = buildCovsByForm(coverages);
  let upgraded = 0;
  for (const form of forms) {
    if (Array.isArray(form.data["coverageRefIds"]) && form.data["coverageRefIds"].length) continue;
    const num = squishStr(String(form.data["number"] ?? ""));
    if (!num) continue;
    const via = covsByForm.get(num);
    if (via && via.length) {
      form.data["coverageRefIds"] = [...via];
      form.data["anchorBasis"] = "derived: hierarchy form list";
      upgraded++;
    }
  }
  return upgraded;
}
function mintRatePlaceholders(ratingProgram, prefix, refTablesPresent) {
  if (!ratingProgram || !refTablesPresent) return [];
  const steps = ratingProgram.data["steps"];
  const byName = /* @__PURE__ */ new Map();
  for (const s of steps) {
    const n = String(s.label ?? "").replace(/\s+/g, " ").trim();
    if (!/factor|rate|charge|premium|credit|surcharge|discount/i.test(n)) continue;
    const k = n.toUpperCase();
    const entry = byName.get(k) ?? { name: n, stepIds: [] };
    entry.stepIds.push(s.id);
    byName.set(k, entry);
  }
  const placeholders = [];
  const stepToRtb = /* @__PURE__ */ new Map();
  let seq = 0;
  for (const { name, stepIds } of byName.values()) {
    const refId = `${prefix}.RTB.${String(++seq).padStart(3, "0")}`;
    for (const sid of stepIds) stepToRtb.set(sid, refId);
    placeholders.push({
      docId: refId,
      refId,
      label: `${refId} \u2014 ${name}`,
      data: {
        name,
        status: "PLACEHOLDER",
        note: "PLACEHOLDER \u2014 values not present in source; pull from the rate filings named in the rules SOURCE column",
        stepRefIds: stepIds,
        mintedId: true
      }
    });
  }
  for (const s of steps) {
    const rtb = stepToRtb.get(s.id);
    if (rtb) s.ratePlaceholderRef = rtb;
  }
  return placeholders;
}
function rateTableArtifacts(grid) {
  if (!grid) return [];
  const markers = [];
  for (let r = 0; r < grid.cells.length; r++) {
    if (RT_NAME_MARKER.test(norm2(cell(grid, r, 0)))) {
      markers.push({ row: r, name: clean(row(grid, r).slice(1).find((c) => clean(c)) ?? null) || "(blank skeleton)" });
    }
  }
  const artifacts = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].row;
    const end = markers[i + 1]?.row ?? grid.cells.length;
    let hasId = false;
    for (let r = start; r < end; r++) {
      if (RT_ID_MARKER.test(norm2(cell(grid, r, 0))) && clean(row(grid, r).slice(1).find((c) => clean(c)) ?? null)) {
        hasId = true;
        break;
      }
    }
    if (!hasId) artifacts.push(markers[i].name);
  }
  return artifacts;
}
function mapIsoWorkbook(grids, overlay, consumedSpans) {
  const ctx = new Ctx();
  ctx.spans = consumedSpans ?? null;
  const fwGrid = selectFrameworkSheet(grids, ctx);
  const formGrid = findSheet(grids, /forms specifications?|forms library|e\+\s*form specs?/i, /dynamic/i);
  const dynGrid = findSheet(grids, /forms dynamic|dynamic data/i);
  const ruleGrid = findSheet(grids, /rules specifications?|rules repository|rule references|e\+\s*rules?\s*specs?/i, /optional/i);
  const optGrid = findSheet(grids, /optional forms rules/i);
  const rateGrid = findSheet(grids, /rating specifications?|property roc|^roc$|e\+\s*rat/i);
  const rtGrid = findSheet(grids, /rating tables|rate tables|e\+\s*rating\s*tables?/i);
  const ldGrid = findSheet(grids, /limits and deductibles|limits & deductibles|e\+\s*limits?/i);
  const fwResults = fwGrid ? parseFramework(fwGrid, ctx, overlay) : null;
  const firstFw = fwResults?.[0] ?? null;
  const productRefId = firstFw?.productRefId ?? null;
  const lob = resolveLobByRefId(productRefId) ?? resolveLobByRefId(firstFw?.coverages[0]?.refId ?? null) ?? resolveLobByName(firstFw?.lobName) ?? DEFAULT_LOB;
  const lobRefId = firstFw?.lobRefId ?? `${lob.prefix}.LOB.001`;
  const lobName = firstFw?.lobName || lob.name;
  const productId = productRefId;
  const ldTables = parseLdTables(ldGrid, ctx);
  const rtTables = parseRtTables(rtGrid, ctx);
  const dynByForm = parseDynamicFields(dynGrid, ctx);
  const forms = formGrid ? parseForms(formGrid, dynByForm, productRefId, ctx, overlay) : [];
  const rules = ruleGrid ? parseRules(ruleGrid, ctx) : [];
  const formRules = optGrid ? parseFormRules(optGrid, ctx) : [];
  const ratingProgram = rateGrid ? parseRating(rateGrid, rtTables, productRefId, lobName, ctx) : null;
  const consumedSheets = new Set(
    [...ctx.recognized, ldGrid?.sheet, rtGrid?.sheet].filter((s) => !!s)
  );
  const refDrafts = detectReferenceTables(grids, consumedSheets, ctx);
  const refPrefix = refIdPrefix(productRefId ?? firstFw?.coverages[0]?.refId ?? "") || lob.prefix;
  const refTables = refDrafts.length ? mintReferenceTables(refDrafts, refPrefix) : [];
  if (ctx.spans) {
    const gridSpan = (g, used, reason) => {
      if (!g || !used || g.cells.length === 0) return;
      const cols = g.cells.reduce((m, r) => Math.max(m, r?.length ?? 0), 0);
      ctx.consume(g.sheet, 0, g.cells.length - 1, 0, Math.max(0, cols - 1), reason);
    };
    gridSpan(fwGrid, !!fwResults && fwResults.length > 0, "framework-sheet");
    gridSpan(formGrid, forms.length > 0, "forms-sheet");
    gridSpan(dynGrid, Object.keys(dynByForm).length > 0, "dynamic-fields-sheet");
    gridSpan(ruleGrid, rules.length > 0, "rules-sheet");
    gridSpan(optGrid, formRules.length > 0, "form-rules-sheet");
    gridSpan(rateGrid, !!ratingProgram, "rating-sheet");
  }
  const products = [];
  if (fwResults) {
    for (const fw of fwResults) {
      if (!fw.productRefId) continue;
      const pLobRefId = fw.lobRefId ?? lobRefId;
      const pLobName = fw.lobName || lobName;
      products.push({
        docId: fw.productRefId,
        refId: fw.productRefId,
        label: `${fw.productRefId} \u2014 ${fw.productName}`,
        data: {
          refId: fw.productRefId,
          name: fw.productName || `${pLobName} Product`,
          lob: { refId: pLobRefId, name: pLobName },
          description: "",
          marketSegment: `${lob.vertical} / ${lob.family}`,
          owner: { uid: "", name: "" },
          ...fw.productScope,
          status: "ACTIVE",
          lifecycle: "DRAFT",
          reviewStatus: "NOT_STARTED",
          reviewer: ""
        }
      });
    }
  }
  const product = products[0] ?? null;
  const allCoverages = fwResults ? fwResults.flatMap((fw) => fw.coverages.map((c) => {
    c.data["productRefId"] = fw.productRefId;
    return c;
  })) : [];
  const refLinks = linkReferenceTables(refDrafts, refTables, allCoverages, rules, overlay);
  foldLdTermsIntoCoverages(allCoverages, rules, ldTables, ctx);
  const derivedTerms = deriveTermsFromReferenceTables(allCoverages, refTables, ctx);
  if (derivedTerms > 0) {
    ctx.addNotice({
      code: "reference_table_terms_derived",
      message: `${derivedTerms} coverage term(s) derived from ${refTables.length} signature-detected reference table(s) (limits/deductibles the named LD parser never claimed).`,
      data: { terms: derivedTerms, tables: refTables.length }
    });
  }
  const ratingGroups = enrichRatingWithGroups(ratingProgram, allCoverages, refTables.length > 0, refPrefix, overlay);
  const formUpgrades = upgradeFormAnchors(forms, allCoverages, refTables.length > 0);
  const ratePlaceholders = mintRatePlaceholders(ratingProgram, refPrefix, refTables.length > 0);
  const excludedArtifacts = refTables.length > 0 ? rateTableArtifacts(rtGrid) : [];
  if (ratePlaceholders.length > 0) {
    ctx.addNotice({
      code: "rate_table_placeholders",
      message: `${ratePlaceholders.length} rate-table placeholder(s) minted \u2014 the rating algorithm names these factors but their VALUES are not in the source; pull them from the rate filings named in the rules SOURCE column.`,
      data: { count: ratePlaceholders.length }
    });
  }
  if (excludedArtifacts.length > 0) {
    ctx.addNotice({
      code: "template_artifacts_excluded",
      message: `${excludedArtifacts.length} rate-table template artifact(s) excluded (blank-name skeletons and/or a wrong-line example) \u2014 no factor values were fabricated from them.`,
      data: { count: excludedArtifacts.length, names: excludedArtifacts }
    });
    for (const name of excludedArtifacts) {
      ctx.addDefect({ code: "template_artifact_excluded", field: "rateTable", rawValue: name });
    }
  }
  if (refTables.length > 0) {
    ctx.addNotice({
      code: "reference_tables_linked",
      message: `${refTables.length} reference table(s) recovered by signature: ${refLinks.backLinked} back-linked to rules, ${refLinks.covLinked} linked to coverages, ${refLinks.rulesLinked} rule(s) carry table links, ${refLinks.resolvedToCoverage} reference(s) resolved to a coverage, ${refLinks.unresolved} unresolved.`,
      data: { tables: refTables.length, backLinked: refLinks.backLinked, covLinked: refLinks.covLinked, rulesTableLinked: refLinks.rulesLinked, resolvedToCoverage: refLinks.resolvedToCoverage, unresolved: refLinks.unresolved }
    });
    if (refLinks.resolvedToCoverage > 0) {
      ctx.addNotice({
        code: "rule_ref_resolved_to_coverage",
        message: `${refLinks.resolvedToCoverage} rule reference(s) named a coverage rather than a table \u2014 resolved to a coverage link, not a failed match (D8): ${refLinks.resolvedRefs.slice(0, 8).join("; ")}.`,
        data: { count: refLinks.resolvedToCoverage, refs: refLinks.resolvedRefs }
      });
    }
    if (refLinks.unresolved > 0) {
      ctx.addNotice({
        code: "unresolved_rule_refs",
        message: `${refLinks.unresolved} rule reference(s) matched no table or coverage in the source \u2014 pull the referenced tables from the filings named in the rules SOURCE column: ${refLinks.unresolvedRefs.slice(0, 8).join("; ")}.`,
        data: { count: refLinks.unresolved, refs: refLinks.unresolvedRefs }
      });
    }
  }
  if (ratingGroups.unmatchedNames.length > 0) {
    const clean0 = (s) => s.replace(/\s*\(Excluding[^)]*\)\s*/i, "").trim();
    ctx.addNotice({
      code: "rating_groups_unmatched",
      message: `${ratingGroups.unmatchedNames.length} rating group(s) name no coverage in the hierarchy \u2014 add these coverages: ${ratingGroups.unmatchedNames.map(clean0).join("; ")}.`,
      data: { count: ratingGroups.unmatchedNames.length, names: ratingGroups.unmatchedNames.map(clean0) }
    });
    for (const name of ratingGroups.unmatchedNames) {
      ctx.addDefect({ code: "rating_group_unmatched", field: "ratingGroup", rawValue: clean0(name) });
    }
  }
  const aiLinks = refLinks.aiProposed + ratingGroups.aiProposed;
  if (aiLinks > 0) {
    ctx.addNotice({
      code: "ai_proposed_links",
      message: `${aiLinks} link(s) resolved from an accepted, cited AI proposal (linkBasis: ai-proposed) \u2014 applied only where the deterministic pass was unresolved and only to entities that exist; review before accepting.`,
      data: { count: aiLinks }
    });
  }
  const allLdTables = [...ldTables, ...refTables];
  const speciesProduced = {
    framework: !!fwResults && fwResults.length > 0,
    forms: forms.length > 0,
    dynamic: Object.keys(dynByForm).length > 0,
    rules: rules.length > 0,
    formRules: formRules.length > 0,
    rating: !!ratingProgram,
    rtTables: rtTables.length > 0,
    ldTables: ldTables.length > 0
  };
  if (conservationEligible(grids, speciesProduced, refTables.length)) {
    const producedSheets = new Set(ctx.recognized);
    if (ldTables.length && ldGrid) producedSheets.add(ldGrid.sheet);
    if (rtTables.length && rtGrid) producedSheets.add(rtGrid.sheet);
    if (forms.length === 0 && formGrid) producedSheets.delete(formGrid.sheet);
    if (rules.length === 0 && ruleGrid) producedSheets.delete(ruleGrid.sheet);
    if (!ratingProgram && rateGrid) producedSheets.delete(rateGrid.sheet);
    const conserved = runConservationPass({
      grids,
      consumedSheets: producedSheets,
      existingRefIds: new Set(
        [...products, ...allCoverages, ...forms, ...rules, ...formRules, ...allLdTables, ...rtTables].map((e) => e.refId?.toLowerCase()).filter((s) => !!s)
      ),
      existingProductNames: new Set(products.map((p) => String(p.data["name"] ?? "").toLowerCase()).filter(Boolean)),
      existingCoverageNames: new Set(allCoverages.map((c) => String(c.data["name"] ?? "").toLowerCase()).filter(Boolean)),
      frameworkCoverageCount: allCoverages.length,
      frameworkSheet: fwGrid?.sheet ?? null,
      refPrefix
    });
    products.push(...conserved.products);
    allCoverages.push(...conserved.coverages);
    forms.push(...conserved.forms);
    rules.push(...conserved.rules);
    allLdTables.push(...conserved.ldTables);
    rtTables.push(...conserved.rtTables);
    if (ctx.spans) ctx.spans.push(...conserved.consumed);
    for (const span of conserved.consumed) {
      if (!ctx.recognized.includes(span.sheet)) ctx.recognized.push(span.sheet);
    }
    if (conserved.enumDomains.length > 0) {
      ctx.addNotice({
        code: "alias_overlay_harvested",
        message: `${conserved.enumDomains.length} per-workbook enum domain(s) harvested from Data Validation (schema-learning, item 15) and applied fill-only to conserved entities.`,
        data: { domains: conserved.enumDomains }
      });
    }
    const conservedTotal = conserved.products.length + conserved.coverages.length + conserved.forms.length + conserved.rules.length + conserved.ldTables.length + conserved.rtTables.length;
    if (conservedTotal > 0) {
      ctx.addNotice({
        code: "conservation_harvest",
        message: `${conservedTotal} review-flagged entit(ies) conserved from substance the named parsers left behind (byte-for-byte source tokens and cited sheet regions; nothing invented).`,
        data: { total: conservedTotal, byMechanism: conserved.stats }
      });
    }
    if (conserved.unharvestedSheets.length > 0) {
      ctx.addNotice({
        code: "conservation_unharvested",
        message: `${conserved.unharvestedSheets.length} substance sheet(s) could not be conserved and need review: ${conserved.unharvestedSheets.slice(0, 8).join("; ")}.`,
        data: { sheets: conserved.unharvestedSheets }
      });
    }
  }
  const dynFieldCount = forms.reduce((n, f) => n + (f.data["dynamicFields"]?.length ?? 0), 0);
  const stepCount = ratingProgram ? ratingProgram.data["steps"].length : 0;
  const counts = {
    products: products.length,
    coverages: allCoverages.length,
    forms: forms.length,
    dynamicFields: dynFieldCount,
    rules: rules.length,
    formRules: formRules.length,
    ratingSteps: stepCount,
    rtTables: rtTables.length,
    ldTables: allLdTables.length,
    // Concept-linker counts are added ONLY under the CORE signature, so a workbook with no
    // reference tables (GL/IM/PR) keeps a byte-identical `summary.counts` object.
    ...refTables.length > 0 ? {
      referenceTables: refTables.length,
      referenceTablesBackLinked: refLinks.backLinked,
      referenceTablesCovLinked: refLinks.covLinked,
      rulesTableLinked: refLinks.rulesLinked,
      rulesResolvedToCoverage: refLinks.resolvedToCoverage,
      ruleRefsUnresolved: refLinks.unresolved,
      ratingGroups: ratingGroups.groups,
      ratingGroupsMatched: ratingGroups.matched,
      ratingGroupsUnmatched: ratingGroups.unmatchedNames.length,
      formAnchorUpgrades: formUpgrades,
      ratePlaceholders: ratePlaceholders.length,
      rateTemplateArtifactsExcluded: excludedArtifacts.length,
      linksAiProposed: refLinks.aiProposed + ratingGroups.aiProposed
    } : {}
  };
  const knownSheets = new Set(ctx.recognized);
  const sheetsSkipped = grids.map((g) => g.sheet).filter((s) => !knownSheets.has(s));
  return {
    productId,
    product,
    products,
    coverages: allCoverages,
    forms,
    rules,
    formRules,
    ratingProgram,
    ldTables: allLdTables,
    rtTables,
    ratePlaceholders,
    summary: {
      productName: product ? product.data["name"] : null,
      productRefId,
      lobName,
      counts,
      warnings: ctx.warnings,
      unmappedColumns: ctx.unmapped,
      sheetsRecognized: ctx.recognized,
      sheetsSkipped,
      defects: ctx.defects,
      notices: ctx.notices
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CANONICAL_MAP,
  LOB_REGISTRY,
  MAX_EMBED_COLS,
  MAX_EMBED_ROWS,
  SURFACED_COLUMNS,
  augmentHeaderCandidates,
  buildSheetCensus,
  buildStructuralModel,
  buildWorkbookCensus,
  createAccounting,
  dashId,
  fingerprintGrid,
  fnv1a64,
  formTokenCensus,
  harvestAliasOverlay,
  headerLockV2Signals,
  hiddenSheetSubstance,
  idColumnProfile,
  inferLob,
  isPlaceholder,
  mapIsoWorkbook,
  nearDuplicateSheetClusters,
  normalizeCellValue,
  pickBestHeaderRow,
  post,
  postSpan,
  refIdSegmentKind,
  refIdToDocId,
  repeatingParentRuns,
  resolveLobByRefId,
  rollupSheet,
  rollupWorkbook,
  scoreHeaderCandidates,
  segmentTableRegions,
  staircaseHierarchy,
  stateLexicon,
  synthesizeRefId
});
