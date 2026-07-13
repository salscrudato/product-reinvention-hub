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
  buildStructuralModel: () => buildStructuralModel,
  fingerprintGrid: () => fingerprintGrid,
  inferLob: () => inferLob,
  normalizeCellValue: () => normalizeCellValue,
  pickBestHeaderRow: () => pickBestHeaderRow,
  resolveLobByRefId: () => resolveLobByRefId,
  scoreHeaderCandidates: () => scoreHeaderCandidates,
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
    const row = cells[r] ?? [];
    const textCells = [];
    for (let c = 0; c < colCount; c++) {
      const v = row[c];
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
    const row = cells[r] ?? [];
    let filled = 0;
    for (let c = 0; c < effective; c++) {
      const v = row[c];
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
        examples: ["GL.COV.002", "GL.COV.001.001", "IM.COV044.00", "PR.COV001.0"],
        aliases: ["PRODUCT FRAMEWORK ID", "FRAMEWORK ID", "ID"]
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
        type: "'MANDATORY' | 'OPTIONAL'",
        enumValues: ["MANDATORY", "OPTIONAL"],
        description: "Whether the coverage is mandatory or optional.",
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
        type: "boolean",
        description: 'Whether the coverage generates premium. Header may or may not carry a trailing "?".',
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
    description: "A policy form / endorsement. Identity is its form number (forms are a shared library).",
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
        description: "Human label for the step (from the algorithm-step / rating-rules text).",
        examples: ["Base Rate", "Increased Limit Factor"],
        aliases: ["ALGORITHM STEP", "RATING RULES", "RATING GROUPING"]
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
      const text = o["richText"].map((t) => t.text ?? "").join("");
      return normalizeCellValue(text);
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
function rowMatchesStackedMarker(row) {
  for (let c = 0; c < Math.min(row.length, 3); c++) {
    const v = row[c];
    if (typeof v === "string" && v.trim().length > 0) {
      if (STACKED_MARKER_PATTERNS.some((p) => p.test(v.trim()))) return true;
    }
  }
  return false;
}
function hasStackedTableMarkers(cells) {
  let count = 0;
  for (const row of cells) {
    if (rowMatchesStackedMarker(row)) {
      if (++count >= 2) return true;
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
    const row = cells[r] ?? [];
    const hasAny = row.some((v) => v !== null && v !== "" && v !== void 0);
    if (!hasAny) continue;
    total++;
    const col0Empty = row[0] === null || row[0] === "" || row[0] === void 0;
    const col1Filled = typeof row[1] === "string" && (row[1]?.trim().length ?? 0) > 0;
    if (col0Empty && col1Filled) indented++;
  }
  return total >= 4 && indented / total >= 0.2;
}
function detectLayoutShape(cells, bestHeaderRow) {
  if (hasStackedTableMarkers(cells)) return "STACKED_TABLES";
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
    for (const row of dataRows) {
      const v = row[c];
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
    const row = cells[r] ?? [];
    let ft = -1, fd = -1, fe = -1;
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v !== "string") continue;
      const upper = v.trim().toUpperCase();
      if (TERM_LABELS.has(upper) && ft < 0) ft = c;
      if (DESC_LABELS.has(upper) && fd < 0) fd = c;
      if (EXAMPLE_LABELS.has(upper) && fe < 0) fe = c;
    }
    if (ft >= 0 && fd < 0 && fe >= 0) {
      for (let c = 0; c < row.length; c++) {
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
    const row = cells[r] ?? [];
    const term = row[termCol];
    const desc = row[descCol];
    if (typeof term !== "string" || !term.trim()) continue;
    if (typeof desc !== "string" || !desc.trim()) continue;
    const entry = {
      columnName: term.trim(),
      description: desc.trim()
    };
    if (exampleCol >= 0) {
      const ex = row[exampleCol];
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
function extractRefId(row) {
  for (let c = 0; c < Math.min(row.length, 3); c++) {
    const v = row[c];
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    for (const p of REF_ID_PATTERNS) {
      const m = trimmed.match(p);
      if (m?.[1]) return m[1];
    }
  }
  return void 0;
}
function extractTableName(row) {
  for (const v of row) {
    if (typeof v !== "string") continue;
    const m = v.trim().match(TABLE_NAME_PATTERN);
    if (m?.[1]) return m[1].trim();
  }
  return void 0;
}
function parseMetaBlock(rows) {
  const meta = {};
  for (const row of rows) {
    for (const v of row) {
      if (typeof v !== "string") continue;
      const m = v.trim().match(META_KEY_VALUE_PATTERN);
      if (m?.[1] && m[2]?.trim()) {
        meta[m[1].trim().toUpperCase()] = m[2].trim();
      }
    }
    for (let c = 0; c < row.length - 1; c++) {
      const keyCell = row[c];
      if (typeof keyCell !== "string") continue;
      if (!/:\s*$/.test(keyCell.trim())) continue;
      const key = keyCell.trim().replace(/:\s*$/, "").trim().toUpperCase();
      if (!key) continue;
      const valCell = row[c + 1];
      if (typeof valCell === "string" && valCell.trim()) {
        meta[key] = valCell.trim();
      } else if (typeof valCell === "number") {
        meta[key] = String(valCell);
      }
    }
  }
  return meta;
}
function segmentStackedTables(cells) {
  const markerRows = [];
  for (let r = 0; r < cells.length; r++) {
    if (rowMatchesStackedMarker(cells[r] ?? [])) markerRows.push(r);
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
      const row = cells[r] ?? [];
      const rowIsEmpty = row.every((v) => v === null || v === "" || v === void 0);
      if (rowIsEmpty) continue;
      const tName = extractTableName(row);
      if (tName) {
        name = tName;
        metaRows.push(row);
        dataStart = r + 1;
        continue;
      }
      const firstCell = row[0];
      if (typeof firstCell === "string" && META_KEY_VALUE_PATTERN.test(firstCell.trim())) {
        metaRows.push(row);
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
    (row) => (row ?? []).map((v) => normalizeCellValue(v))
  );
  let lastRow = -1;
  let lastCol = -1;
  for (let r = 0; r < normalized.length; r++) {
    const row = normalized[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== null) {
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
    const row = new Array(colLimit).fill(null);
    for (let c = 0; c < colLimit; c++) row[c] = src[c] ?? null;
    cells.push(row);
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
  footprintStates: ["AZ", "CA", "CO", "FL", "GA", "IL", "IN", "MI", "NC", "OH", "PA", "SC", "TN", "TX", "VA"],
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
function lobByPrefix(refId) {
  if (!refId) return void 0;
  const prefix = refId.split(".")[0];
  return Object.values(LOB_REGISTRY).find((l) => l.prefix === prefix);
}
function resolveLobByRefId(refId) {
  return lobByPrefix(refId);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CANONICAL_MAP,
  LOB_REGISTRY,
  MAX_EMBED_COLS,
  MAX_EMBED_ROWS,
  SURFACED_COLUMNS,
  buildStructuralModel,
  fingerprintGrid,
  inferLob,
  normalizeCellValue,
  pickBestHeaderRow,
  resolveLobByRefId,
  scoreHeaderCandidates,
  synthesizeRefId
});
