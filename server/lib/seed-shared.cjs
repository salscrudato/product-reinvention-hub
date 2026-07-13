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

// scripts/migrate-to-cosmos.ts
var migrate_to_cosmos_exports = {};
__export(migrate_to_cosmos_exports, {
  seedForTenant: () => seedForTenant
});
module.exports = __toCommonJS(migrate_to_cosmos_exports);
var import_cosmos = require("@azure/cosmos");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

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

// shared/src/seed/personalHome.ts
var PH_FOOTPRINT_STATES = PH_LOB.footprintStates;
var SEC_I = PH_LOB.sections[0].shortName;
var SEC_II = PH_LOB.sections[1].shortName;
var COASTAL_CONSTRAINT_NOTE = `Coastal states only (${PH_LOB.peril.eligibleStates.join(" ")}); dollar amount must be \u2265 all-peril deductible`;
var COASTAL_RULE_OUTCOME = `Coastal states only (${PH_LOB.peril.eligibleStates.join(" ")}); dollar amount \u2265 all-peril deductible`;
function gov(overrides = {}) {
  return {
    status: overrides.status ?? "ACTIVE",
    lifecycle: overrides.lifecycle ?? "LAUNCHED",
    reviewStatus: "APPROVED",
    reviewer: "system",
    createdAt: null,
    updatedAt: null,
    updatedBy: "seed",
    rev: 1
  };
}
var FOOTPRINT_SCOPE = { allStates: false, states: [...PH_FOOTPRINT_STATES] };
var COASTAL_SCOPE = { allStates: false, states: [...PH_LOB.peril.eligibleStates] };
var PH_PRODUCT = {
  refId: "PH.PROD.001",
  name: "Personal Home \u2014 HO-3 Special Form",
  lob: { refId: PH_LOB.refId, name: PH_LOB.name },
  description: "ISO-style Special Form homeowners policy covering dwelling, personal property, liability and medical payments on an open-peril basis.",
  marketSegment: "Personal Lines / Property",
  owner: { uid: "seed", name: "Product Factory Seed" },
  ...FOOTPRINT_SCOPE,
  ...gov()
};
var PH_LD_TABLES = {
  "PH.LD.001": {
    name: "Coverage E \u2014 Personal Liability Limits",
    defaultValue: 3e5,
    rows: [
      { label: "$100,000", value: 1e5 },
      { label: "$300,000", value: 3e5 },
      { label: "$500,000", value: 5e5 }
    ]
  },
  "PH.LD.002": {
    name: "Coverage F \u2014 Medical Payments Limits",
    defaultValue: 1e3,
    rows: [
      { label: "$1,000", value: 1e3 },
      { label: "$2,000", value: 2e3 },
      { label: "$5,000", value: 5e3, constraintNote: "Available only when Coverage E \u2265 300,000" }
    ]
  },
  "PH.LD.003": {
    name: "All-Peril Deductible",
    defaultValue: 1e3,
    rows: [
      { label: "$500", value: 500 },
      { label: "$1,000", value: 1e3 },
      { label: "$2,500", value: 2500 },
      { label: "$5,000", value: 5e3 }
    ]
  },
  "PH.LD.004": {
    name: "Wind/Hail Percentage Deductible",
    rows: [
      { label: "1%", value: 1, constraintNote: COASTAL_CONSTRAINT_NOTE },
      { label: "2%", value: 2, constraintNote: COASTAL_CONSTRAINT_NOTE },
      { label: "5%", value: 5, constraintNote: COASTAL_CONSTRAINT_NOTE }
    ]
  },
  "PH.LD.005": {
    name: "Coverage C \u2014 Personal Property % of Coverage A",
    defaultValue: 50,
    rows: [
      { label: "50%", value: 50 },
      { label: "70%", value: 70 },
      { label: "75%", value: 75 }
    ]
  },
  "PH.LD.006": {
    name: "Water Back-Up & Sump Overflow Limit",
    defaultValue: 5e3,
    rows: [
      { label: "$5,000", value: 5e3 },
      { label: "$10,000", value: 1e4 },
      { label: "$25,000", value: 25e3 }
    ]
  }
};
var PH_RT_TABLES = {
  "PH.RT.001": {
    name: "Territory Base Rate",
    columns: ["territory", "rate"],
    rows: [
      { territory: "T001", rate: 640 },
      { territory: "T002", rate: 700 },
      { territory: "T003", rate: 815 },
      { territory: "T004", rate: 905 },
      { territory: "T005", rate: 1040 }
    ]
  },
  "PH.RT.002": {
    name: "Protection Class \xD7 Construction Factor",
    columns: ["pcMin", "pcMax", "F", "M"],
    rows: [
      { pcMin: 1, pcMax: 3, F: 0.95, M: 0.9 },
      { pcMin: 4, pcMax: 6, F: 1.1, M: 1.05 },
      { pcMin: 7, pcMax: 8, F: 1.3, M: 1.2 },
      { pcMin: 9, pcMax: 10, F: 1.55, M: 1.45 }
    ]
  },
  "PH.RT.003": {
    // Exact lookup; covA > 600,000 extrapolates at +0.32 per additional 100k
    name: "Coverage A Key Factor",
    columns: ["covA", "factor"],
    rows: [
      { covA: 2e5, factor: 0.8 },
      { covA: 25e4, factor: 0.9 },
      { covA: 3e5, factor: 1 },
      { covA: 35e4, factor: 1.14 },
      { covA: 4e5, factor: 1.3 },
      { covA: 5e5, factor: 1.62 },
      { covA: 6e5, factor: 1.94 }
    ]
  },
  "PH.RT.004": {
    // subTable field distinguishes all-peril rows from wind/hail rows
    name: "Deductible Factors",
    columns: ["subTable", "key", "factor"],
    rows: [
      { subTable: "allPeril", key: 500, factor: 1.1 },
      { subTable: "allPeril", key: 1e3, factor: 1 },
      { subTable: "allPeril", key: 2500, factor: 0.88 },
      { subTable: "allPeril", key: 5e3, factor: 0.76 },
      { subTable: "windHail", key: 1, factor: 0.97 },
      { subTable: "windHail", key: 2, factor: 0.94 },
      { subTable: "windHail", key: 5, factor: 0.89 }
    ]
  },
  "PH.RT.005": {
    name: "Coverage C Percentage Factor",
    columns: ["covCPct", "factor"],
    rows: [
      { covCPct: 50, factor: 1 },
      { covCPct: 70, factor: 1.06 },
      { covCPct: 75, factor: 1.09 }
    ]
  },
  "PH.RT.006": {
    name: "Liability Increased-Limit Charges ($)",
    columns: ["limType", "limit", "charge"],
    rows: [
      { limType: "E", limit: 1e5, charge: 0 },
      { limType: "E", limit: 3e5, charge: 24 },
      { limType: "E", limit: 5e5, charge: 38 },
      { limType: "F", limit: 1e3, charge: 0 },
      { limType: "F", limit: 2e3, charge: 6 },
      { limType: "F", limit: 5e3, charge: 18 }
    ]
  },
  "PH.RT.007": {
    name: "Scheduled Personal Property Class Rates (per $100 of appraised value)",
    columns: ["itemClass", "ratePerHundred"],
    rows: [
      { itemClass: "Jewelry", ratePerHundred: 1.27 },
      { itemClass: "Furs", ratePerHundred: 0.55 },
      { itemClass: "Cameras", ratePerHundred: 1.1 },
      { itemClass: "Fine Arts", ratePerHundred: 0.85 },
      { itemClass: "Silverware", ratePerHundred: 0.45 },
      { itemClass: "Musical Instruments", ratePerHundred: 0.6 }
    ]
  },
  "PH.RT.008": {
    name: "Endorsement/Credit Factors",
    columns: ["deviceCredit", "factor"],
    rows: [
      { deviceCredit: "none", factor: 1 },
      { deviceCredit: "local", factor: 0.98 },
      { deviceCredit: "central", factor: 0.95 }
    ]
  },
  "PH.RT.009": {
    name: "Tier Factor",
    columns: ["tier", "factor"],
    rows: [
      { tier: "A", factor: 0.9 },
      { tier: "B", factor: 1.1 },
      { tier: "C", factor: 1.25 }
    ]
  },
  "PH.RT.010": {
    name: "Water Back-Up Flat Premium",
    columns: ["limit", "flatPremium"],
    rows: [
      { limit: 5e3, flatPremium: 75 },
      { limit: 1e4, flatPremium: 110 },
      { limit: 25e3, flatPremium: 175 }
    ]
  }
};
var PH_MINIMUM_PREMIUM = 500;
var PH_RATING_PROGRAM = {
  refId: "PH.RAT.1",
  name: "Personal Home Rating Program",
  minimumPremium: PH_MINIMUM_PREMIUM,
  ...FOOTPRINT_SCOPE,
  ...gov(),
  steps: [
    { id: "s1", order: 1, label: "Territory base rate", op: "SET", source: { type: "RT", ref: "PH.RT.001", keys: ["territory"] } },
    { id: "s2", order: 2, label: "Protection/construction factor", op: "MUL", source: { type: "RT", ref: "PH.RT.002", keys: ["pc", "construction"] } },
    { id: "s3", order: 3, label: "Coverage A key factor \u2192 Key Premium", op: "MUL", source: { type: "RT", ref: "PH.RT.003", keys: ["covA"] }, roundTo: 0 },
    { id: "s4a", order: 4, label: "All-peril deductible factor", op: "MUL", source: { type: "RT", ref: "PH.RT.004", keys: ["allPerilDed"] } },
    { id: "s4b", order: 5, label: "Wind/hail deductible factor", op: "MUL", source: { type: "RT", ref: "PH.RT.004", keys: ["windHailPct"] }, condition: "windHailElected" },
    { id: "s5", order: 6, label: "Coverage C percentage factor", op: "MUL", source: { type: "RT", ref: "PH.RT.005", keys: ["covCPct"] }, roundTo: 2 },
    { id: "s6", order: 7, label: "Coverage E increased-limit charge", op: "ADD", source: { type: "RT", ref: "PH.RT.006", keys: ["covELimit"] }, roundTo: 2 },
    { id: "s7", order: 8, label: "Coverage F increased-limit charge", op: "ADD", source: { type: "RT", ref: "PH.RT.006", keys: ["covFLimit"] }, roundTo: 2 },
    { id: "s8a", order: 9, label: "Replacement Cost endorsement factor", op: "MUL", source: { type: "CONST", value: 1.1 }, condition: "rcElected", roundTo: 2 },
    { id: "s8b", order: 10, label: "Protective device credit", op: "MUL", source: { type: "RT", ref: "PH.RT.008", keys: ["deviceCredit"] }, roundTo: 2 },
    { id: "s9", order: 11, label: "Tier factor", op: "MUL", source: { type: "RT", ref: "PH.RT.009", keys: ["tier"] }, roundTo: 2 },
    { id: "s10a", order: 12, label: "Water back-up flat premium", op: "ADD", source: { type: "RT", ref: "PH.RT.010", keys: ["waterBackupLimit"] }, condition: "waterBackupElected", roundTo: 2 },
    { id: "s10b", order: 13, label: "Scheduled Personal Property premium", op: "ADD", source: { type: "SPP", ref: "PH.RT.007" }, condition: "sppElected", roundTo: 2 },
    { id: "s11", order: 14, label: `Apply minimum premium ($${PH_MINIMUM_PREMIUM})`, op: "MIN_FLOOR", source: { type: "CONST", value: PH_MINIMUM_PREMIUM }, roundTo: 0 }
  ]
};
var PH_COVERAGES = [
  {
    refId: "PH.COV.001",
    name: "Coverage A \u2014 Dwelling",
    parentId: null,
    order: 1,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["HO 00 03"],
    terms: [{ id: "cov-a-limit", kind: "LIMIT", label: "Coverage A Amount", basis: "per occurrence", default: 3e5, unit: "dollars" }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.COV.002",
    name: "Coverage B \u2014 Other Structures",
    parentId: null,
    order: 2,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: false,
    source: "BUREAU",
    formNumbers: ["HO 00 03"],
    terms: [{ id: "cov-b-limit", kind: "LIMIT", label: "Coverage B Limit (10% of A default)", basis: "per occurrence", ldTableRef: void 0, default: "10% of Coverage A", unit: "dollars" }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.COV.003",
    name: "Coverage C \u2014 Personal Property",
    parentId: null,
    order: 3,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["HO 00 03"],
    terms: [{ id: "cov-c-pct", kind: "LIMIT", label: "Coverage C % of A", basis: "per occurrence", ldTableRef: "PH.LD.005", default: 50, unit: "percent" }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.COV.004",
    name: "Coverage D \u2014 Loss of Use",
    parentId: null,
    order: 4,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: false,
    source: "BUREAU",
    formNumbers: ["HO 00 03"],
    terms: [{ id: "cov-d-limit", kind: "LIMIT", label: "Coverage D Limit (30% of A)", basis: "per occurrence", default: "30% of Coverage A", unit: "dollars" }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.COV.005",
    name: "Coverage E \u2014 Personal Liability",
    parentId: null,
    order: 5,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["HO 00 03"],
    terms: [{ id: "cov-e-limit", kind: "LIMIT", label: "Coverage E Limit", basis: "per occurrence", ldTableRef: "PH.LD.001", default: 3e5, unit: "dollars" }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.COV.006",
    name: "Coverage F \u2014 Medical Payments",
    parentId: null,
    order: 6,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["HO 00 03"],
    terms: [{ id: "cov-f-limit", kind: "LIMIT", label: "Coverage F Limit", basis: "per person per occurrence", ldTableRef: "PH.LD.002", default: 1e3, unit: "dollars" }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.COV.001.001",
    name: "Water Back-Up & Sump Overflow",
    parentId: "PH.COV.001",
    order: 1,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["HO 04 95"],
    terms: [{ id: "water-backup-limit", kind: "LIMIT", label: "Water Back-Up Limit", basis: "per occurrence", ldTableRef: "PH.LD.006", default: 5e3, unit: "dollars" }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.COV.002.001",
    name: "Other Structures \u2014 Increased Limits",
    parentId: "PH.COV.002",
    order: 1,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "PROPRIETARY",
    formNumbers: ["HO 04 48"],
    terms: [{ id: "other-struct-limit", kind: "LIMIT", label: "Other Structures Increased Limit", basis: "per occurrence", default: 0, unit: "dollars" }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.COV.003.001",
    name: "Personal Property Replacement Cost",
    parentId: "PH.COV.003",
    order: 1,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["HO 04 90"],
    terms: [{ id: "rc-elected", kind: "OPTION", label: "Replacement Cost Coverage", basis: "flag", default: false }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.COV.003.002",
    name: "Scheduled Personal Property",
    parentId: "PH.COV.003",
    order: 2,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["HO 04 61"],
    terms: [{
      id: "spp-schedule",
      kind: "OPTION",
      label: "SPP Schedule (class + appraised value)",
      basis: "per item",
      default: false,
      notes: "Repeating schedule: ItemClass + AppraisedValue per item. See HO 04 61."
    }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  }
];
var PH_FORMS = [
  {
    number: "HO 00 03",
    edition: "05 11",
    name: "Homeowners 3 \u2014 Special Form",
    category: "BASE_COVERAGE",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: true,
    attachmentCondition: "NONE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: [SEC_I, SEC_II],
    productRefIds: ["PH.PROD.001"],
    description: "Base open-peril homeowners policy form covering dwelling, other structures, personal property, loss of use, personal liability and medical payments.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    number: "HO DS 01",
    edition: "05 11",
    name: "Homeowners Policy Declarations",
    category: "DECLARATIONS",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: true,
    attachmentCondition: "NONE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: [],
    productRefIds: ["PH.PROD.001"],
    description: "Policy declarations page showing named insured, property address, coverage limits, deductibles and total premium.",
    dynamicFields: [
      { name: "NamedInsured", dataType: "TEXT", repeating: false },
      { name: "PropertyAddress", dataType: "TEXT", repeating: false },
      { name: "PolicyEffective", dataType: "DATE", repeating: false },
      { name: "PolicyExpiration", dataType: "DATE", repeating: false },
      { name: "CoverageLimits", dataType: "CURRENCY", repeating: true, notes: "Coverage TEXT + Limit CURRENCY per row" },
      { name: "TotalPremium", dataType: "CURRENCY", repeating: false }
    ],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    number: "HO 04 90",
    edition: "05 11",
    name: "Personal Property Replacement Cost Loss Settlement",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: [SEC_I],
    productRefIds: ["PH.PROD.001"],
    description: "Amends Coverage C to settle losses at replacement cost rather than actual cash value.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    number: "HO 04 95",
    edition: "05 11",
    name: "Water Back-Up and Sump Discharge or Overflow",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: [SEC_I],
    productRefIds: ["PH.PROD.001"],
    description: "Extends coverage to loss caused by water that backs up through sewers or drains or overflows from a sump.",
    dynamicFields: [{ name: "BackUpLimit", dataType: "CURRENCY", repeating: false }],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    number: "HO 04 61",
    edition: "05 11",
    name: "Scheduled Personal Property Endorsement",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: [SEC_I],
    productRefIds: ["PH.PROD.001"],
    description: "Schedules high-value personal property items (jewelry, furs, cameras, fine arts, etc.) at agreed appraised values.",
    dynamicFields: [
      { name: "ItemClass", dataType: "LIST", repeating: true, options: ["Jewelry", "Furs", "Cameras", "Fine Arts", "Silverware", "Musical Instruments"] },
      { name: "ItemDescription", dataType: "TEXT", repeating: true },
      { name: "AppraisedValue", dataType: "CURRENCY", repeating: true }
    ],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    number: "HO 04 16",
    edition: "05 11",
    name: "Premises Alarm or Fire Protection System",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: [],
    productRefIds: ["PH.PROD.001"],
    description: "Documents a qualifying protective device system and applies the corresponding premium credit.",
    dynamicFields: [
      { name: "DeviceType", dataType: "LIST", repeating: false, options: ["Local Alarm", "Central Station"] },
      { name: "CertificateNo", dataType: "TEXT", repeating: false }
    ],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    number: "HO 04 48",
    edition: "05 11",
    name: "Other Structures \u2014 Increased Limits",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: true,
    transactions: [],
    coverageParts: [SEC_I],
    productRefIds: ["PH.PROD.001"],
    description: "Increases Coverage B beyond the default 10% of Coverage A for specifically described other structures.",
    dynamicFields: [
      { name: "StructureDescription", dataType: "TEXT", repeating: true },
      { name: "IncreasedLimit", dataType: "CURRENCY", repeating: true }
    ],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    number: "HO 03 12",
    edition: "05 11",
    name: "Windstorm or Hail Percentage Deductible",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: [SEC_I],
    productRefIds: ["PH.PROD.001"],
    description: "Replaces the standard deductible for windstorm or hail losses with a percentage-of-dwelling deductible.",
    dynamicFields: [
      { name: "DeductiblePercent", dataType: "LIST", repeating: false, options: ["1%", "2%", "5%"] }
    ],
    ...COASTAL_SCOPE,
    ...gov()
  },
  {
    number: "HO 04 96",
    edition: "05 11",
    name: "No Section II Coverage \u2014 Home Day Care Business",
    category: "EXCLUSION",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: [SEC_II],
    productRefIds: ["PH.PROD.001"],
    description: "Excludes personal liability and medical payments coverage for the day-care business conducted at the residence.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    number: "HO 01 04",
    edition: "05 11",
    name: "Special Provisions \u2014 California",
    category: "AMENDATORY",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: [],
    productRefIds: ["PH.PROD.001"],
    description: "Modifies the base policy to comply with California statutes and Department of Insurance requirements.",
    dynamicFields: [],
    allStates: false,
    states: ["CA"],
    ...gov()
  },
  {
    number: "HO 01 33",
    edition: "05 11",
    name: "Special Provisions \u2014 Texas",
    category: "AMENDATORY",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: [],
    productRefIds: ["PH.PROD.001"],
    description: "Modifies the base policy to comply with Texas Department of Insurance requirements.",
    dynamicFields: [],
    allStates: false,
    states: ["TX"],
    ...gov()
  },
  {
    number: "PN HO 01",
    edition: "05 11",
    name: "Policyholder Notice \u2014 Important Information",
    category: "POLICY_NOTICE",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: true,
    attachmentCondition: "NONE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: [],
    productRefIds: ["PH.PROD.001"],
    description: "Required notice providing policyholders with important information about their policy rights and obligations.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  }
];
var PH_RULES = [
  {
    refId: "PH.RU.001",
    category: "PRODUCT",
    subCategory: "Eligibility",
    condition: "Owner-occupied 1\u20134 family dwelling, residential use",
    outcome: "Eligible for HO-3 Special Form",
    coverageRefIds: [],
    formNumbers: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.RU.002",
    category: "PRODUCT",
    subCategory: "Coverage Limits",
    condition: "Coverage B default limit",
    outcome: "Default = 10% of Coverage A; increase only via HO 04 48",
    ldTableRef: void 0,
    coverageRefIds: ["PH.COV.002"],
    formNumbers: ["HO 04 48"],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.RU.003",
    category: "PRODUCT",
    subCategory: "Coverage Limits",
    condition: "Coverage C percentage of A",
    outcome: "Options per PH.LD.005; default 50% of A",
    ldTableRef: "PH.LD.005",
    coverageRefIds: ["PH.COV.003"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.RU.004",
    category: "PRODUCT",
    subCategory: "Coverage Limits",
    condition: "Coverage D limit",
    outcome: "30% of Coverage A (calculated)",
    coverageRefIds: ["PH.COV.004"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.RU.005",
    category: "PRODUCT",
    subCategory: "Coverage Limits",
    condition: "Coverage E limit options",
    outcome: "Options per PH.LD.001; default $300,000",
    ldTableRef: "PH.LD.001",
    coverageRefIds: ["PH.COV.005"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.RU.006",
    category: "PRODUCT",
    subCategory: "Coverage Constraints",
    condition: "Coverage F $5,000 limit selected",
    outcome: "Requires Coverage E \u2265 $300,000",
    ldTableRef: "PH.LD.002",
    coverageRefIds: ["PH.COV.005", "PH.COV.006"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.RU.007",
    category: "RATING",
    subCategory: "Deductibles",
    condition: "All-peril deductible selection",
    outcome: "Options per PH.LD.003; default $1,000",
    ldTableRef: "PH.LD.003",
    coverageRefIds: [],
    formNumbers: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.RU.008",
    category: "RATING",
    subCategory: "Deductibles",
    condition: "Wind/Hail percentage deductible elected",
    outcome: COASTAL_RULE_OUTCOME,
    ldTableRef: "PH.LD.004",
    coverageRefIds: [],
    formNumbers: ["HO 03 12"],
    ...COASTAL_SCOPE,
    ...gov()
  },
  {
    refId: "PH.RU.009",
    category: "RATING",
    subCategory: "Premium Floor",
    condition: "Calculated premium",
    outcome: "Minimum policy premium $500 (PH.RAT.1 step 11)",
    coverageRefIds: [],
    formNumbers: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  },
  {
    refId: "PH.RU.010",
    category: "PRODUCT",
    subCategory: "Eligibility",
    condition: "Seasonal or secondary dwelling",
    outcome: "Ineligible unless companion primary policy is in force",
    coverageRefIds: [],
    formNumbers: [],
    ...FOOTPRINT_SCOPE,
    ...gov()
  }
];
var PH_FORM_RULES = [
  { refId: "PH.FORM.RU.001", condition: "Replacement Cost elected", outcome: "Attach HO 04 90", formNumbers: ["HO 04 90"], mandatory: true, ...gov() },
  { refId: "PH.FORM.RU.002", condition: "Water Back-Up elected", outcome: "Attach HO 04 95", formNumbers: ["HO 04 95"], mandatory: true, ...gov() },
  { refId: "PH.FORM.RU.003", condition: "Scheduled Personal Property elected", outcome: "Attach HO 04 61", formNumbers: ["HO 04 61"], mandatory: true, ...gov() },
  { refId: "PH.FORM.RU.004", condition: "Protective-device credit \u2260 none", outcome: "Attach HO 04 16", formNumbers: ["HO 04 16"], mandatory: true, ...gov() },
  { refId: "PH.FORM.RU.005", condition: "Wind/Hail % deductible elected", outcome: "Attach HO 03 12", formNumbers: ["HO 03 12"], mandatory: true, ...gov() },
  { refId: "PH.FORM.RU.006", condition: "Risk state = CA", outcome: "Attach HO 01 04; TX \u2192 HO 01 33", formNumbers: ["HO 01 04", "HO 01 33"], mandatory: true, ...gov() },
  { refId: "PH.FORM.RU.007", condition: "Home day-care exclusion elected", outcome: "Attach HO 04 96", formNumbers: ["HO 04 96"], mandatory: false, ...gov() }
];
var PH_DICTIONARY = [
  {
    refId: "PH.DEF.001",
    name: "Named Insured",
    type: "TEXT",
    description: "Full legal name of the primary insured named on the declarations.",
    allowedValues: [],
    format: "Free text",
    tags: ["party", "declarations"],
    aliases: ["NamedInsured", "named insured"],
    ...gov()
  },
  {
    refId: "PH.DEF.002",
    name: "Property Address",
    type: "TEXT",
    description: "Physical street address of the insured dwelling / residence premises.",
    allowedValues: [],
    format: "USPS address",
    tags: ["location", "declarations"],
    aliases: ["PropertyAddress", "property address", "residence premises"],
    ...gov()
  },
  {
    refId: "PH.DEF.003",
    name: "Coverage A Amount",
    type: "CURRENCY",
    description: "Insured replacement value of the dwelling; the base for Coverage B/C/D derivations.",
    allowedValues: [],
    format: "USD (whole dollars)",
    tags: ["coverage", "rating", "limit"],
    aliases: ["Coverage A", "Coverage A Amount", "Dwelling limit"],
    ...gov()
  },
  {
    refId: "PH.DEF.004",
    name: "All-Peril Deductible",
    type: "CURRENCY",
    description: "Per-occurrence deductible applied to all covered perils before wind/hail options.",
    allowedValues: ["500", "1000", "2500", "5000"],
    format: "USD (whole dollars)",
    tags: ["deductible", "rating"],
    aliases: ["all-peril deductible", "all peril deductible"],
    ...gov()
  },
  {
    refId: "PH.DEF.005",
    name: "Protection Class",
    type: "LIST",
    description: "ISO Public Protection Classification (fire) 1\u201310 for the risk location.",
    allowedValues: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    format: "Integer 1\u201310",
    tags: ["rating", "underwriting"],
    aliases: ["Protection Class", "ISO fire protection class", "PPC"],
    ...gov()
  },
  {
    refId: "PH.DEF.006",
    name: "Construction Type",
    type: "LIST",
    description: "Primary construction material of the dwelling used for the construction rating factor.",
    allowedValues: ["Frame", "Masonry"],
    format: "Enumerated",
    tags: ["rating", "underwriting"],
    aliases: ["Construction Type", "construction class"],
    ...gov()
  },
  {
    refId: "PH.DEF.007",
    name: "Territory Code",
    type: "LIST",
    description: "Rating territory assigned to the property location; keys the territory base rate.",
    allowedValues: ["T001", "T002", "T003", "T004", "T005"],
    format: "T0NN",
    tags: ["rating"],
    aliases: ["Territory Code", "rating territory"],
    ...gov()
  },
  {
    refId: "PH.DEF.008",
    name: "Appraised Value",
    type: "CURRENCY",
    description: "Professionally appraised value of a scheduled personal property item.",
    allowedValues: [],
    format: "USD (whole dollars)",
    tags: ["spp", "scheduled-property"],
    aliases: ["AppraisedValue", "appraised value"],
    ...gov()
  },
  {
    refId: "PH.DEF.009",
    name: "Device Type",
    type: "LIST",
    description: "Qualifying protective device installed at the premises; drives the device credit.",
    allowedValues: ["Local Alarm", "Central Station"],
    format: "Enumerated",
    tags: ["credit", "underwriting"],
    aliases: ["DeviceType", "protective device", "device type"],
    ...gov()
  },
  {
    refId: "PH.DEF.010",
    name: "Effective Date",
    type: "DATE",
    description: "Date the policy period begins.",
    allowedValues: [],
    format: "YYYY-MM-DD",
    tags: ["policy", "declarations"],
    aliases: ["PolicyEffective", "effective date"],
    ...gov()
  }
];
var DEFAULT_TASK_TEMPLATES = [
  // ── Ideation & Design ──
  { title: "Define new product intent, goals & priorities", column: "IDEATION", group: "Product Research", daysOffset: 5, slaLabel: "5 days" },
  { title: "Market intelligence & competitor assessment", column: "IDEATION", group: "Product Research", daysOffset: 7, slaLabel: "1 week" },
  { title: "Regulatory & compliance analysis", column: "IDEATION", group: "Product Research", daysOffset: 9, slaLabel: "9 days" },
  { title: "Product impact assessment (UW, claims, actuarial, IT)", column: "IDEATION", group: "Product Research", daysOffset: 12, slaLabel: "12 days" },
  { title: "Build business case & go/no-go recommendation", column: "IDEATION", group: "Business Case", daysOffset: 16, slaLabel: "16 days" },
  // ── Build & File ──
  { title: "Coverage & feature design (limits, deductibles)", column: "BUILD_FILE", group: "Product Design", daysOffset: 24, slaLabel: "24 days" },
  { title: "Define product rules", column: "BUILD_FILE", group: "Product Design", daysOffset: 28, slaLabel: "28 days" },
  { title: "Identify & draft product forms", column: "BUILD_FILE", group: "Product Design", daysOffset: 32, slaLabel: "32 days" },
  { title: "Develop rating & pricing models", column: "BUILD_FILE", group: "Product Pricing", daysOffset: 38, slaLabel: "38 days" },
  { title: "File forms & rates with states", column: "BUILD_FILE", group: "Regulatory Filing", daysOffset: 45, slaLabel: "45 days" },
  // ── Test & Approve ──
  { title: "UAT rating & configuration scenarios", column: "TEST_APPROVE", group: "Testing & UAT", daysOffset: 58, slaLabel: "58 days" },
  { title: "End-to-end system & integration testing", column: "TEST_APPROVE", group: "Testing & UAT", daysOffset: 63, slaLabel: "63 days" },
  { title: "Compliance & regulatory sign-off", column: "TEST_APPROVE", group: "Compliance", daysOffset: 68, slaLabel: "68 days" },
  { title: "Business review & stakeholder approvals", column: "TEST_APPROVE", group: "Stage Gate", daysOffset: 72, slaLabel: "72 days" },
  // ── Launch & Monitor ──
  { title: "Launch readiness check", column: "LAUNCH_MONITOR", group: "Launch", daysOffset: 80, slaLabel: "80 days" },
  { title: "Distribution & sales enablement", column: "LAUNCH_MONITOR", group: "Distribution", daysOffset: 85, slaLabel: "85 days" },
  { title: "30-day post-launch results review", column: "LAUNCH_MONITOR", group: "Monitoring", daysOffset: 110, slaLabel: "110 days" },
  { title: "Monitor KPIs & benchmarks", column: "LAUNCH_MONITOR", group: "Monitoring", daysOffset: 120, slaLabel: "120 days" }
];
var PH_DEFAULT_TASK_TEMPLATES = DEFAULT_TASK_TEMPLATES;
var PH_SAMPLE_FEEDBACK = [
  {
    type: "IDEA",
    title: "Add flood coverage endorsement",
    detail: "Customers frequently ask about flood. Adding a standalone flood endorsement option would expand our addressable market.",
    context: { route: "/app/products" },
    votes: { count: 3, voters: [] },
    status: "NEW",
    impact: 3,
    effort: 3,
    priorityScore: 3,
    author: { uid: "seed", name: "Product Factory Seed" },
    createdAt: null,
    updatedAt: null
  },
  {
    type: "ISSUE",
    title: "Rating trace should display step-by-step in the UI",
    detail: "During UAT we needed to verify the $1,528 worked example. The evaluator returns a trace array but the pricing tab does not display it yet.",
    context: { route: "/app/products/:id/pricing" },
    votes: { count: 5, voters: [] },
    status: "REVIEWING",
    impact: 2,
    effort: 1,
    priorityScore: 5,
    author: { uid: "seed", name: "Product Factory Seed" },
    createdAt: null,
    updatedAt: null
  },
  {
    type: "PRAISE",
    title: "Form attachment rules work perfectly",
    detail: "Tested all 7 PH.FORM.RU rules. Every form attaches exactly when expected. The rules engine is solid.",
    context: { route: "/app/products/:id/forms" },
    votes: { count: 1, voters: [] },
    status: "PLANNED",
    impact: 1,
    effort: 1,
    priorityScore: 1,
    author: { uid: "seed", name: "Product Factory Seed" },
    createdAt: null,
    updatedAt: null
  }
];

// shared/src/seed/personalAuto.ts
var PA_FOOTPRINT_STATES = PA_LOB.footprintStates;
function gov2(overrides = {}) {
  return {
    status: overrides.status ?? "ACTIVE",
    lifecycle: overrides.lifecycle ?? "LAUNCHED",
    reviewStatus: "APPROVED",
    reviewer: "system",
    createdAt: null,
    updatedAt: null,
    updatedBy: "seed",
    rev: 1
  };
}
var FOOTPRINT_SCOPE2 = { allStates: false, states: [...PA_FOOTPRINT_STATES] };
var PA_PRODUCT = {
  refId: "PA.PROD.001",
  name: "Personal Auto Policy",
  lob: { refId: PA_LOB.refId, name: PA_LOB.name },
  description: "ISO-style Personal Auto Policy (PAP PP 00 01) covering liability, medical payments, uninsured/underinsured motorists, and physical damage \u2014 rated by territory, driver class and vehicle symbol.",
  marketSegment: "Personal Lines / Automobile",
  owner: { uid: "seed", name: "Product Factory Seed" },
  ...FOOTPRINT_SCOPE2,
  ...gov2()
};
var PA_LD_TABLES = {
  "PA.LD.001": {
    name: "Bodily Injury Liability Limits (per person / per accident)",
    defaultValue: 1e5,
    rows: [
      { label: "25/50", value: 25e3, constraintNote: "Meets most state minimums" },
      { label: "50/100", value: 5e4 },
      { label: "100/300", value: 1e5 },
      { label: "250/500", value: 25e4 }
    ]
  },
  "PA.LD.002": {
    name: "Property Damage Liability Limits",
    defaultValue: 1e5,
    rows: [
      { label: "$25,000", value: 25e3, constraintNote: "Meets most state minimums" },
      { label: "$50,000", value: 5e4 },
      { label: "$100,000", value: 1e5 },
      { label: "$300,000", value: 3e5 }
    ]
  },
  "PA.LD.003": {
    name: "Medical Payments Limits",
    defaultValue: 5e3,
    rows: [
      { label: "$1,000", value: 1e3 },
      { label: "$5,000", value: 5e3 },
      { label: "$10,000", value: 1e4 },
      { label: "$25,000", value: 25e3 }
    ]
  },
  "PA.LD.004": {
    name: "UM / UIM Bodily Injury Limits (per person / per accident)",
    defaultValue: 1e5,
    rows: [
      { label: "25/50", value: 25e3, constraintNote: "Must match or be \u2264 BI limit in most states" },
      { label: "50/100", value: 5e4 },
      { label: "100/300", value: 1e5 },
      { label: "250/500", value: 25e4 }
    ]
  },
  "PA.LD.005": {
    name: "Collision Deductible",
    defaultValue: 500,
    rows: [
      { label: "$100", value: 100 },
      { label: "$250", value: 250 },
      { label: "$500", value: 500 },
      { label: "$1,000", value: 1e3 }
    ]
  },
  "PA.LD.006": {
    name: "Comprehensive (Other Than Collision) Deductible",
    defaultValue: 250,
    rows: [
      { label: "$100", value: 100 },
      { label: "$250", value: 250 },
      { label: "$500", value: 500 },
      { label: "$1,000", value: 1e3 }
    ]
  }
};
var PA_RT_TABLES = {
  "PA.RT.001": {
    // Territory base rate (Part A Liability annual base premium)
    name: "Territory Base Rate",
    columns: ["territory", "rate"],
    rows: [
      { territory: "T001", rate: 350 },
      { territory: "T002", rate: 400 },
      { territory: "T003", rate: 465 },
      { territory: "T004", rate: 510 },
      { territory: "T005", rate: 590 }
    ]
  },
  "PA.RT.002": {
    // Driver class factor — keys the primary driver's experience / usage class
    name: "Driver Class Factor",
    columns: ["driverClass", "factor"],
    rows: [
      { driverClass: "DC1", factor: 0.9 },
      // preferred/mature
      { driverClass: "DC2", factor: 1 },
      // standard
      { driverClass: "DC3", factor: 1.2 }
      // non-standard/young
    ]
  },
  "PA.RT.003": {
    // BI/PD combined limit factor — keys the elected limit package code
    name: "BI/PD Limit Factor",
    columns: ["biPdLimitCode", "factor"],
    rows: [
      { biPdLimitCode: "25/50/25", factor: 0.85 },
      { biPdLimitCode: "50/100/50", factor: 0.93 },
      { biPdLimitCode: "100/300/100", factor: 1 },
      { biPdLimitCode: "250/500/250", factor: 1.14 }
    ]
  },
  "PA.RT.004": {
    // Vehicle age class factor — model year band, rounded to 2 dp after application
    name: "Vehicle Age Factor",
    columns: ["vehicleAgeClass", "factor"],
    rows: [
      { vehicleAgeClass: "Economy", factor: 0.9 },
      { vehicleAgeClass: "Standard", factor: 1 },
      { vehicleAgeClass: "Luxury", factor: 1.15 }
    ]
  },
  "PA.RT.005": {
    // Medical Payments flat rate by territory (additive, when medPayElected)
    name: "Medical Payments Rate by Territory",
    columns: ["territory", "rate"],
    rows: [
      { territory: "T001", rate: 35 },
      { territory: "T002", rate: 42 },
      { territory: "T003", rate: 49 },
      { territory: "T004", rate: 55 },
      { territory: "T005", rate: 63 }
    ]
  },
  "PA.RT.006": {
    // UM/UIM flat rate by territory (additive, when umElected)
    name: "UM/UIM Rate by Territory",
    columns: ["territory", "rate"],
    rows: [
      { territory: "T001", rate: 50 },
      { territory: "T002", rate: 62 },
      { territory: "T003", rate: 74 },
      { territory: "T004", rate: 83 },
      { territory: "T005", rate: 95 }
    ]
  },
  "PA.RT.007": {
    // Collision premium by vehicle symbol × deductible (additive, when collisionElected)
    name: "Collision Premium",
    columns: ["vehicleSymbol", "collisionDed", "premium"],
    rows: [
      { vehicleSymbol: "sym10", collisionDed: 250, premium: 380 },
      { vehicleSymbol: "sym10", collisionDed: 500, premium: 335 },
      { vehicleSymbol: "sym10", collisionDed: 1e3, premium: 290 },
      { vehicleSymbol: "sym12", collisionDed: 250, premium: 350 },
      { vehicleSymbol: "sym12", collisionDed: 500, premium: 306 },
      { vehicleSymbol: "sym12", collisionDed: 1e3, premium: 262 }
    ]
  },
  "PA.RT.008": {
    // Comprehensive premium by vehicle symbol × deductible (additive, when compElected)
    name: "Comprehensive Premium",
    columns: ["vehicleSymbol", "compDed", "premium"],
    rows: [
      { vehicleSymbol: "sym10", compDed: 100, premium: 205 },
      { vehicleSymbol: "sym10", compDed: 250, premium: 172 },
      { vehicleSymbol: "sym10", compDed: 500, premium: 145 },
      { vehicleSymbol: "sym12", compDed: 100, premium: 182 },
      { vehicleSymbol: "sym12", compDed: 250, premium: 154 },
      { vehicleSymbol: "sym12", compDed: 500, premium: 128 }
    ]
  },
  "PA.RT.009": {
    // Tier factor — multiplied after all additive components
    name: "Tier Factor",
    columns: ["tier", "factor"],
    rows: [
      { tier: "Preferred", factor: 0.9 },
      { tier: "Standard", factor: 1 },
      { tier: "Non-Standard", factor: 1.2 }
    ]
  },
  "PA.RT.010": {
    // Rental reimbursement flat annual rate (additive, when rentalElected)
    name: "Rental Reimbursement Rate",
    columns: ["rentalCode", "rate"],
    rows: [
      { rentalCode: "$20_600", rate: 24 },
      { rentalCode: "$30_900", rate: 38 },
      { rentalCode: "$40_1200", rate: 52 }
    ]
  },
  "PA.RT.011": {
    // Towing and labor flat annual rate (additive, when towingElected)
    name: "Towing and Labor Rate",
    columns: ["towingLimit", "rate"],
    rows: [
      { towingLimit: 50, rate: 10 },
      { towingLimit: 100, rate: 15 },
      { towingLimit: 200, rate: 22 }
    ]
  }
};
var PA_MINIMUM_PREMIUM = 250;
var PA_RATING_PROGRAM = {
  refId: "PA.RAT.1",
  name: "Personal Auto Policy Rating Program",
  minimumPremium: PA_MINIMUM_PREMIUM,
  ...FOOTPRINT_SCOPE2,
  ...gov2(),
  steps: [
    // s1: Territory base rate (SET)
    { id: "s1", order: 1, label: "Territory base rate", op: "SET", source: { type: "RT", ref: "PA.RT.001", keys: ["territory"] } },
    // s2: Driver class factor (MUL)
    { id: "s2", order: 2, label: "Driver class factor", op: "MUL", source: { type: "RT", ref: "PA.RT.002", keys: ["driverClass"] } },
    // s3: BI/PD limit factor (MUL)
    { id: "s3", order: 3, label: "BI/PD limit factor", op: "MUL", source: { type: "RT", ref: "PA.RT.003", keys: ["biPdLimitCode"] } },
    // s4: Vehicle age factor (MUL), round to ¢ to stabilise floating point
    { id: "s4", order: 4, label: "Vehicle age factor", op: "MUL", source: { type: "RT", ref: "PA.RT.004", keys: ["vehicleAgeClass"] }, roundTo: 2 },
    // s5: Medical Payments flat rate (ADD, conditional)
    { id: "s5", order: 5, label: "Medical Payments premium", op: "ADD", source: { type: "RT", ref: "PA.RT.005", keys: ["territory"] }, condition: "medPayElected" },
    // s6: UM/UIM flat rate (ADD, conditional)
    { id: "s6", order: 6, label: "UM/UIM premium", op: "ADD", source: { type: "RT", ref: "PA.RT.006", keys: ["territory"] }, condition: "umElected" },
    // s7: Collision premium (ADD, conditional)
    { id: "s7", order: 7, label: "Collision premium", op: "ADD", source: { type: "RT", ref: "PA.RT.007", keys: ["vehicleSymbol", "collisionDed"] }, condition: "collisionElected" },
    // s8: Comprehensive premium (ADD, conditional)
    { id: "s8", order: 8, label: "Comprehensive premium", op: "ADD", source: { type: "RT", ref: "PA.RT.008", keys: ["vehicleSymbol", "compDed"] }, condition: "compElected" },
    // s9: Tier factor (MUL — applies to the full running total)
    { id: "s9", order: 9, label: "Tier factor", op: "MUL", source: { type: "RT", ref: "PA.RT.009", keys: ["tier"] } },
    // s10a: Rental reimbursement flat rate (ADD, conditional)
    { id: "s10a", order: 10, label: "Rental reimbursement premium", op: "ADD", source: { type: "RT", ref: "PA.RT.010", keys: ["rentalCode"] }, condition: "rentalElected" },
    // s10b: Towing and labor flat rate (ADD, conditional)
    { id: "s10b", order: 11, label: "Towing and labor premium", op: "ADD", source: { type: "RT", ref: "PA.RT.011", keys: ["towingLimit"] }, condition: "towingElected" },
    // s11: Minimum premium floor; round to $
    { id: "s11", order: 12, label: `Apply minimum premium ($${PA_MINIMUM_PREMIUM})`, op: "MIN_FLOOR", source: { type: "CONST", value: PA_MINIMUM_PREMIUM }, roundTo: 0 }
  ]
};
var PA_COVERAGES = [
  // ── Part A — Liability ────────────────────────────────────────────────────
  {
    refId: "PA.COV.001",
    name: "Part A \u2014 Liability Coverage",
    parentId: null,
    order: 1,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 00 01"],
    terms: [{
      id: "bipd-limit-code",
      kind: "OPTION",
      label: "BI/PD Limit Package",
      basis: "per person/per accident/per occurrence",
      default: "100/300/100",
      notes: "Combined per-person BI / per-accident BI / per-occurrence PD limit code used as the rating key (PA.RT.003)."
    }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.COV.001.001",
    name: "Bodily Injury Liability",
    parentId: "PA.COV.001",
    order: 1,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 00 01"],
    terms: [{ id: "bi-limit", kind: "LIMIT", label: "Bodily Injury Per Person / Per Accident", basis: "per person per accident", ldTableRef: "PA.LD.001", default: 1e5, unit: "dollars" }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.COV.001.002",
    name: "Property Damage Liability",
    parentId: "PA.COV.001",
    order: 2,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 00 01"],
    terms: [{ id: "pd-limit", kind: "LIMIT", label: "Property Damage Per Occurrence", basis: "per occurrence", ldTableRef: "PA.LD.002", default: 1e5, unit: "dollars" }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  // ── Part B — Medical Payments ─────────────────────────────────────────────
  {
    refId: "PA.COV.002",
    name: "Part B \u2014 Medical Payments Coverage",
    parentId: null,
    order: 2,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 00 01"],
    terms: [{ id: "medpay-limit", kind: "LIMIT", label: "Medical Payments Limit (any one person)", basis: "per person", ldTableRef: "PA.LD.003", default: 5e3, unit: "dollars" }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  // ── Part C — Uninsured / Underinsured Motorists ───────────────────────────
  {
    refId: "PA.COV.003",
    name: "Part C \u2014 Uninsured Motorists Coverage",
    parentId: null,
    order: 3,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 00 01"],
    terms: [{
      id: "um-limit",
      kind: "LIMIT",
      label: "UM/UIM Limit Per Person / Per Accident",
      basis: "per person per accident",
      ldTableRef: "PA.LD.004",
      default: 1e5,
      unit: "dollars",
      constraintNote: "Must match or be \u2264 Bodily Injury limit (most states)"
    }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.COV.003.001",
    name: "Uninsured Motorist Bodily Injury",
    parentId: "PA.COV.003",
    order: 1,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 00 01"],
    terms: [{ id: "um-bi-limit", kind: "LIMIT", label: "UM Bodily Injury Limit", basis: "per person per accident", default: "Matches Part C limit", unit: "dollars" }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.COV.003.002",
    name: "Underinsured Motorist Bodily Injury",
    parentId: "PA.COV.003",
    order: 2,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 00 01"],
    terms: [{
      id: "uim-bi-limit",
      kind: "LIMIT",
      label: "UIM Bodily Injury Limit",
      basis: "per person per accident",
      default: "Matches Part C limit",
      unit: "dollars",
      constraintNote: "UIM limit may not exceed BI limit (PA.RU.007)"
    }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  // ── Part D — Damage to Your Auto ─────────────────────────────────────────
  {
    refId: "PA.COV.004",
    name: "Part D \u2014 Coverage for Damage to Your Auto",
    parentId: null,
    order: 4,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 00 01"],
    terms: [{ id: "part-d-note", kind: "OPTION", label: "Physical damage coverage elected", basis: "flag", default: false }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.COV.004.001",
    name: "Collision Coverage",
    parentId: "PA.COV.004",
    order: 1,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 00 01"],
    terms: [{ id: "collision-ded", kind: "DEDUCTIBLE", label: "Collision Deductible", basis: "per occurrence", ldTableRef: "PA.LD.005", default: 500, unit: "dollars" }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.COV.004.002",
    name: "Other Than Collision (Comprehensive)",
    parentId: "PA.COV.004",
    order: 2,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 00 01"],
    terms: [{ id: "comp-ded", kind: "DEDUCTIBLE", label: "Comprehensive Deductible", basis: "per occurrence", ldTableRef: "PA.LD.006", default: 250, unit: "dollars" }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.COV.004.003",
    name: "Rental Reimbursement",
    parentId: "PA.COV.004",
    order: 3,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 13 01"],
    terms: [{
      id: "rental-elected",
      kind: "OPTION",
      label: "Rental reimbursement elected",
      basis: "flag",
      default: false,
      notes: "Rental code keys daily/max limit ($20/$600, $30/$900, $40/$1,200)."
    }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.COV.004.004",
    name: "Towing and Labor Costs",
    parentId: "PA.COV.004",
    order: 4,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["PP 03 28"],
    terms: [{
      id: "towing-elected",
      kind: "OPTION",
      label: "Towing and labor elected",
      basis: "flag",
      default: false,
      notes: "Towing limit: $50, $100, or $200 per disablement."
    }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  }
];
var PA_PARTS = [
  "Part A \u2014 Liability Coverage",
  "Part B \u2014 Medical Payments Coverage",
  "Part C \u2014 Uninsured Motorists Coverage",
  "Part D \u2014 Coverage for Damage to Your Auto"
];
var PA_FORMS = [
  {
    number: "PP 00 01",
    edition: "01 05",
    name: "Personal Auto Policy",
    category: "BASE_COVERAGE",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: true,
    attachmentCondition: "NONE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: PA_PARTS,
    productRefIds: ["PA.PROD.001"],
    description: "Base Personal Auto Policy form covering liability, medical payments, uninsured/underinsured motorists and physical damage to your auto on an occurrence basis.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    number: "PP DS 01",
    edition: "01 05",
    name: "Personal Auto Policy Declarations",
    category: "DECLARATIONS",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: true,
    attachmentCondition: "NONE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: [],
    productRefIds: ["PA.PROD.001"],
    description: "Declarations page listing named insured, vehicle schedule, coverage selections, limits, deductibles and total premium.",
    dynamicFields: [
      { name: "NamedInsured", dataType: "TEXT", repeating: false },
      { name: "PolicyAddress", dataType: "TEXT", repeating: false },
      { name: "VehicleYear", dataType: "TEXT", repeating: true },
      { name: "VehicleMake", dataType: "TEXT", repeating: true },
      { name: "VehicleModel", dataType: "TEXT", repeating: true },
      { name: "VIN", dataType: "TEXT", repeating: true },
      { name: "PolicyEffective", dataType: "DATE", repeating: false },
      { name: "PolicyExpiration", dataType: "DATE", repeating: false },
      { name: "TotalPremium", dataType: "CURRENCY", repeating: false }
    ],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    number: "PP 13 01",
    edition: "01 05",
    name: "Extended Transportation Expenses (Rental Reimbursement)",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: ["Part D \u2014 Coverage for Damage to Your Auto"],
    productRefIds: ["PA.PROD.001"],
    description: "Provides rental reimbursement and transportation expenses when a covered auto is disabled by a covered loss. Daily and maximum limits apply.",
    dynamicFields: [
      { name: "DailyLimit", dataType: "CURRENCY", repeating: false },
      { name: "MaxLimit", dataType: "CURRENCY", repeating: false }
    ],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    number: "PP 03 28",
    edition: "01 05",
    name: "Towing and Labor Costs Coverage",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: ["Part D \u2014 Coverage for Damage to Your Auto"],
    productRefIds: ["PA.PROD.001"],
    description: "Covers towing and labor costs each time a covered auto is disabled, up to the selected per-disablement limit.",
    dynamicFields: [{ name: "TowingLimit", dataType: "CURRENCY", repeating: false }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    number: "PP 04 46",
    edition: "01 05",
    name: "Loan or Lease Gap Coverage",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: ["Part D \u2014 Coverage for Damage to Your Auto"],
    productRefIds: ["PA.PROD.001"],
    description: "Pays the difference between the actual cash value of a totaled covered auto and the outstanding loan or lease balance.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    number: "PP 04 04",
    edition: "01 05",
    name: "Driver Exclusion Endorsement",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: true,
    transactions: [],
    coverageParts: ["Part A \u2014 Liability Coverage"],
    productRefIds: ["PA.PROD.001"],
    description: "Excludes a named individual from all coverages under the policy; losses caused while that person is operating any covered auto are not covered.",
    dynamicFields: [
      { name: "ExcludedDriverName", dataType: "TEXT", repeating: true },
      { name: "LicenseNumber", dataType: "TEXT", repeating: true }
    ],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    number: "PP 03 05",
    edition: "01 05",
    name: "Extended Non-Owned Coverage \u2014 Vehicles Furnished or Available for Regular Use",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: ["Part A \u2014 Liability Coverage", "Part B \u2014 Medical Payments Coverage"],
    productRefIds: ["PA.PROD.001"],
    description: "Extends liability and medical payments coverage to a non-owned vehicle furnished for the regular use of the named insured or a family member.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    number: "PP 03 01",
    edition: "01 05",
    name: "Named Non-Owner Coverage Endorsement",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: ["Part A \u2014 Liability Coverage", "Part B \u2014 Medical Payments Coverage"],
    productRefIds: ["PA.PROD.001"],
    description: "Provides liability and medical payments coverage to individuals who do not own a vehicle but regularly drive non-owned autos.",
    dynamicFields: [{ name: "NamedNonOwner", dataType: "TEXT", repeating: true }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    number: "PP 04 02",
    edition: "01 05",
    name: "Excess Electronic Equipment Coverage",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: ["Part D \u2014 Coverage for Damage to Your Auto"],
    productRefIds: ["PA.PROD.001"],
    description: "Extends coverage for electronic equipment installed in the covered auto beyond the standard policy limit.",
    dynamicFields: [{ name: "EquipmentLimit", dataType: "CURRENCY", repeating: false }],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    number: "PP 01 75",
    edition: "01 05",
    name: "Special Provisions \u2014 California",
    category: "AMENDATORY",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: [],
    productRefIds: ["PA.PROD.001"],
    description: "Modifies the Personal Auto Policy to comply with California Insurance Code and Department of Insurance regulations.",
    dynamicFields: [],
    allStates: false,
    states: ["CA"],
    ...gov2()
  },
  {
    number: "PP 01 79",
    edition: "01 05",
    name: "Special Provisions \u2014 Texas",
    category: "AMENDATORY",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: [],
    productRefIds: ["PA.PROD.001"],
    description: "Modifies the Personal Auto Policy to comply with Texas Department of Insurance requirements.",
    dynamicFields: [],
    allStates: false,
    states: ["TX"],
    ...gov2()
  },
  {
    number: "PN PP 01",
    edition: "01 05",
    name: "Personal Auto Policy Notice \u2014 Important Information",
    category: "POLICY_NOTICE",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: true,
    attachmentCondition: "NONE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: [],
    productRefIds: ["PA.PROD.001"],
    description: "Required notice providing policyholders with important information about rights, obligations, and claims procedures.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  }
];
var PA_RULES = [
  {
    refId: "PA.RU.001",
    category: "PRODUCT",
    subCategory: "Eligibility",
    condition: "Personal passenger automobile, motorcycle, or light truck \u2014 personal use",
    outcome: "Eligible for Personal Auto Policy (PP 00 01)",
    coverageRefIds: [],
    formNumbers: ["PP 00 01"],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.RU.002",
    category: "PRODUCT",
    subCategory: "Mandatory Coverage",
    condition: "Personal Auto Policy selected",
    outcome: "Part A \u2014 Liability (BI + PD) is mandatory; both sub-coverages must be present",
    coverageRefIds: ["PA.COV.001", "PA.COV.001.001", "PA.COV.001.002"],
    formNumbers: ["PP 00 01"],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.RU.003",
    category: "PRODUCT",
    subCategory: "Limit Ranges",
    condition: "Bodily Injury limit selection",
    outcome: "Options per PA.LD.001; default 100/300 per person/per accident",
    ldTableRef: "PA.LD.001",
    coverageRefIds: ["PA.COV.001.001"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.RU.004",
    category: "PRODUCT",
    subCategory: "Limit Ranges",
    condition: "Property Damage limit selection",
    outcome: "Options per PA.LD.002; default $100,000 per occurrence",
    ldTableRef: "PA.LD.002",
    coverageRefIds: ["PA.COV.001.002"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.RU.005",
    category: "PRODUCT",
    subCategory: "Optional Coverage",
    condition: "Medical Payments coverage elected",
    outcome: "Part B elected; limit options per PA.LD.003; attach per PP 00 01",
    ldTableRef: "PA.LD.003",
    coverageRefIds: ["PA.COV.002"],
    formNumbers: ["PP 00 01"],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.RU.006",
    category: "PRODUCT",
    subCategory: "Optional Coverage",
    condition: "Part A Liability is elected",
    outcome: "UM/UIM (Part C) is available and strongly recommended; required unless waived in writing in most states",
    ldTableRef: "PA.LD.004",
    coverageRefIds: ["PA.COV.003"],
    formNumbers: ["PP 00 01"],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.RU.007",
    category: "PRODUCT",
    subCategory: "Coverage Constraints",
    condition: "UIM limits selected",
    outcome: "UIM limit may not exceed BI limit per occurrence",
    coverageRefIds: ["PA.COV.001.001", "PA.COV.003.002"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.RU.008",
    category: "PRODUCT",
    subCategory: "Coverage Constraints",
    condition: "Rental Reimbursement (PA.COV.004.003) elected",
    outcome: "Requires physical damage coverage (Collision or Comprehensive) to be in force",
    coverageRefIds: ["PA.COV.004.001", "PA.COV.004.002", "PA.COV.004.003"],
    formNumbers: ["PP 13 01"],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.RU.009",
    category: "PRODUCT",
    subCategory: "Coverage Constraints",
    condition: "Towing and Labor (PA.COV.004.004) elected",
    outcome: "Requires physical damage coverage (Collision or Comprehensive) to be in force",
    coverageRefIds: ["PA.COV.004.001", "PA.COV.004.002", "PA.COV.004.004"],
    formNumbers: ["PP 03 28"],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  },
  {
    refId: "PA.RU.010",
    category: "RATING",
    subCategory: "Premium Floor",
    condition: "Calculated premium",
    outcome: "Minimum policy premium $250 (PA.RAT.1 step 11)",
    coverageRefIds: [],
    formNumbers: [],
    ...FOOTPRINT_SCOPE2,
    ...gov2()
  }
];
var PA_FORM_RULES = [
  { refId: "PA.FORM.RU.001", condition: "Rental Reimbursement elected", outcome: "Attach PP 13 01", formNumbers: ["PP 13 01"], mandatory: true, ...gov2() },
  { refId: "PA.FORM.RU.002", condition: "Towing and Labor elected", outcome: "Attach PP 03 28", formNumbers: ["PP 03 28"], mandatory: true, ...gov2() },
  { refId: "PA.FORM.RU.003", condition: "Loan/Lease Gap elected", outcome: "Attach PP 04 46", formNumbers: ["PP 04 46"], mandatory: true, ...gov2() },
  { refId: "PA.FORM.RU.004", condition: "Named Non-Owner coverage", outcome: "Attach PP 03 01", formNumbers: ["PP 03 01"], mandatory: true, ...gov2() },
  { refId: "PA.FORM.RU.005", condition: "Driver exclusion required", outcome: "Attach PP 04 04", formNumbers: ["PP 04 04"], mandatory: true, ...gov2() },
  { refId: "PA.FORM.RU.006", condition: "Risk state = CA", outcome: "Attach PP 01 75; TX \u2192 PP 01 79", formNumbers: ["PP 01 75", "PP 01 79"], mandatory: true, ...gov2() }
];
var PA_DICTIONARY = [
  {
    refId: "PA.DEF.001",
    name: "Territory (Auto)",
    type: "LIST",
    description: "Rating territory assigned to the garaging location of the insured vehicle; keys the territory base rate and med pay/UM rates.",
    allowedValues: ["T001", "T002", "T003", "T004", "T005"],
    format: "T0NN",
    tags: ["rating"],
    aliases: ["Territory Code", "rating territory", "garaging territory"],
    ...gov2()
  },
  {
    refId: "PA.DEF.002",
    name: "Driver Class",
    type: "LIST",
    description: "ISO driver classification combining age, marital status, and use; keys the driver class factor (PA.RT.002).",
    allowedValues: ["DC1", "DC2", "DC3"],
    format: "DC[1-3]",
    tags: ["rating", "underwriting"],
    aliases: ["Driver Class", "driverClass", "driver classification"],
    ...gov2()
  },
  {
    refId: "PA.DEF.003",
    name: "Vehicle Symbol",
    type: "LIST",
    description: "ISO vehicle symbol reflecting cost new, age, and loss experience; keys physical damage premium tables.",
    allowedValues: ["sym10", "sym12"],
    format: "sym[NN]",
    tags: ["rating", "vehicle"],
    aliases: ["Vehicle Symbol", "vehicleSymbol", "ISO symbol"],
    ...gov2()
  },
  {
    refId: "PA.DEF.004",
    name: "Bodily Injury Limit",
    type: "CURRENCY",
    description: "Per-person and per-accident limits for Part A Bodily Injury Liability.",
    allowedValues: ["25/50", "50/100", "100/300", "250/500"],
    format: "per person / per accident ($000s)",
    tags: ["limit", "rating"],
    aliases: ["Bodily Injury Limit", "BI limit", "bi-limit"],
    ...gov2()
  },
  {
    refId: "PA.DEF.005",
    name: "Property Damage Limit",
    type: "CURRENCY",
    description: "Per-occurrence limit for Part A Property Damage Liability.",
    allowedValues: ["25000", "50000", "100000", "300000"],
    format: "USD (whole dollars)",
    tags: ["limit", "rating"],
    aliases: ["Property Damage Limit", "PD limit", "pd-limit"],
    ...gov2()
  },
  {
    refId: "PA.DEF.006",
    name: "Collision Deductible",
    type: "CURRENCY",
    description: "Per-occurrence deductible for Part D Collision coverage.",
    allowedValues: ["100", "250", "500", "1000"],
    format: "USD (whole dollars)",
    tags: ["deductible", "rating"],
    aliases: ["Collision Deductible", "collisionDed"],
    ...gov2()
  },
  {
    refId: "PA.DEF.007",
    name: "Comprehensive Deductible",
    type: "CURRENCY",
    description: "Per-occurrence deductible for Part D Other Than Collision (Comprehensive) coverage.",
    allowedValues: ["100", "250", "500", "1000"],
    format: "USD (whole dollars)",
    tags: ["deductible", "rating"],
    aliases: ["Comprehensive Deductible", "compDed", "OTC deductible"],
    ...gov2()
  },
  {
    refId: "PA.DEF.008",
    name: "Effective Date (Auto)",
    type: "DATE",
    description: "Date the auto policy period begins.",
    allowedValues: [],
    format: "YYYY-MM-DD",
    tags: ["policy", "declarations"],
    aliases: ["PolicyEffective", "effective date"],
    ...gov2()
  }
];

// shared/src/seed/generalLiability.ts
var GL_FOOTPRINT_STATES = GL_LOB.footprintStates;
function gov3(overrides = {}) {
  return {
    status: overrides.status ?? "ACTIVE",
    lifecycle: overrides.lifecycle ?? "LAUNCHED",
    reviewStatus: "APPROVED",
    reviewer: "system",
    createdAt: null,
    updatedAt: null,
    updatedBy: "seed",
    rev: 1
  };
}
var FOOTPRINT_SCOPE3 = { allStates: false, states: [...GL_FOOTPRINT_STATES] };
var GL_PRODUCT = {
  refId: "GL.PROD.001",
  name: "Commercial General Liability",
  lob: { refId: GL_LOB.refId, name: GL_LOB.name },
  description: "ISO-style Commercial General Liability policy (CG 00 01) covering bodily injury and property damage liability (Coverage A), personal and advertising injury liability (Coverage B), and medical payments (Coverage C) on an occurrence trigger.",
  marketSegment: "Commercial Lines / Casualty",
  owner: { uid: "seed", name: "Product Factory Seed" },
  ...FOOTPRINT_SCOPE3,
  ...gov3()
};
var GL_LD_TABLES = {
  "GL.LD.001": {
    // Per-occurrence limit — the Each Occurrence cap in the CGL declarations.
    // Base limit = $100,000; standard commercial default = $1,000,000.
    name: "Per-Occurrence Limit",
    defaultValue: 1e6,
    rows: [
      { label: "$100,000", value: 1e5, constraintNote: "Base limit \u2014 minimal coverage for most operations" },
      { label: "$300,000", value: 3e5 },
      { label: "$500,000", value: 5e5 },
      { label: "$1,000,000", value: 1e6 }
    ]
  },
  "GL.LD.002": {
    // General Aggregate — caps total Coverage A + B + C (excluding products/completed ops).
    // ISO CGL standard: 2× the per-occurrence limit; must be ≥ per-occurrence limit [GL.RU.007].
    name: "General Aggregate Limit",
    defaultValue: 2e6,
    rows: [
      { label: "$200,000", value: 2e5, constraintNote: "Must be \u2265 per-occurrence limit" },
      { label: "$600,000", value: 6e5, constraintNote: "Must be \u2265 per-occurrence limit" },
      { label: "$1,000,000", value: 1e6, constraintNote: "Must be \u2265 per-occurrence limit" },
      { label: "$2,000,000", value: 2e6 }
    ]
  },
  "GL.LD.003": {
    // Products-Completed-Operations Aggregate — separate aggregate for Coverage A
    // losses arising out of the products-completed-operations hazard.
    // Reset at each policy period anniversary; typically set equal to the General Aggregate.
    name: "Products-Completed-Operations Aggregate Limit",
    defaultValue: 2e6,
    rows: [
      { label: "$200,000", value: 2e5, constraintNote: "When PCO elected, must be \u2265 per-occurrence limit [GL.RU.003]" },
      { label: "$600,000", value: 6e5, constraintNote: "When PCO elected, must be \u2265 per-occurrence limit [GL.RU.003]" },
      { label: "$1,000,000", value: 1e6 },
      { label: "$2,000,000", value: 2e6 }
    ]
  },
  "GL.LD.004": {
    // Per-occurrence BI/PD deductible (Coverage A only). When elected, CG 03 00 attaches.
    name: "Per-Occurrence Deductible",
    defaultValue: 0,
    rows: [
      { label: "$0 (none)", value: 0 },
      { label: "$500", value: 500 },
      { label: "$1,000", value: 1e3 },
      { label: "$2,500", value: 2500 }
    ]
  }
};
var GL_RT_TABLES = {
  "GL.RT.001": {
    // Class code base rate — the annual cost per $1,000 of the designated exposure base.
    // Exposure basis by class: 'payroll' for most operations; 'gross_sales' for retail/products.
    // s1 SET: getter returns this rate; s2 MUL INPUT exposureThousands converts to premium.
    name: "Class Code Base Rate (per $1,000 of exposure)",
    columns: ["classCode", "exposureBasis", "baseRate"],
    rows: [
      { classCode: "41677", exposureBasis: "payroll", baseRate: 2.5 },
      // Contractors — Residential Remodeling
      { classCode: "11011", exposureBasis: "gross_sales", baseRate: 1.8 },
      // Restaurants
      { classCode: "45191", exposureBasis: "gross_sales", baseRate: 0.9 },
      // Retail Stores — not elsewhere classified
      { classCode: "61110", exposureBasis: "payroll", baseRate: 0.35 },
      // Office — clerical
      { classCode: "16811", exposureBasis: "payroll", baseRate: 1.2 }
      // Building Operations — not classified
    ]
  },
  "GL.RT.002": {
    // Per-Occurrence Increased Limits Factor — scales base-limit premium to the selected
    // each-occurrence limit. Base = $100,000 (factor 1.000). Source: GL Forms workbook
    // (samples/iso/sample-GL-pricing.xlsx, Rating Specifications sheet, ILF table).
    name: "Per-Occurrence Increased Limits Factor",
    columns: ["occLimit", "factor"],
    rows: [
      { occLimit: 1e5, factor: 1 },
      // base limit
      { occLimit: 3e5, factor: 1.32 },
      { occLimit: 5e5, factor: 1.54 },
      { occLimit: 1e6, factor: 1.82 }
    ]
  },
  "GL.RT.003": {
    // BI/PD Deductible Credit Factor — multiplicative credit applied when a per-occurrence
    // deductible is elected (Coverage A only). Factor < 1.00 = premium reduction.
    name: "BI/PD Deductible Credit Factor",
    columns: ["occDeductible", "factor"],
    rows: [
      { occDeductible: 0, factor: 1 },
      // no deductible
      { occDeductible: 500, factor: 0.96 },
      { occDeductible: 1e3, factor: 0.94 },
      { occDeductible: 2500, factor: 0.91 }
    ]
  },
  "GL.RT.004": {
    // Products-Completed-Operations rate — annual cost per $1,000 of PCO exposure base.
    // Used by step s5: ADD(RT GL.RT.004 [classCode, pcoExposureThousands]).
    // The getter multiplies pcoRate × pcoExposureThousands and returns the full PCO premium,
    // so the ADD step adds it directly to the running total.
    name: "Products-Completed-Operations Rate (per $1,000 of exposure)",
    columns: ["classCode", "pcoRate"],
    rows: [
      { classCode: "41677", pcoRate: 1.8 },
      // Contractors — elevated PCO exposure
      { classCode: "11011", pcoRate: 0.85 },
      // Restaurants
      { classCode: "45191", pcoRate: 0.4 },
      // Retail Stores
      { classCode: "61110", pcoRate: 0.15 },
      // Office — minimal product/work exposure
      { classCode: "16811", pcoRate: 0.8 }
      // Building Operations
    ]
  },
  "GL.RT.005": {
    // Experience Modification Factor — applied to the full running premium AFTER the
    // PCO component is added. Standard ISO modification range 0.75–1.25.
    name: "Experience Modification Factor",
    columns: ["expMod", "factor"],
    rows: [
      { expMod: "0.75", factor: 0.75 },
      { expMod: "0.90", factor: 0.9 },
      { expMod: "1.00", factor: 1 },
      { expMod: "1.15", factor: 1.15 },
      { expMod: "1.25", factor: 1.25 }
    ]
  }
};
var GL_MINIMUM_PREMIUM = 500;
var GL_RATING_PROGRAM = {
  refId: "GL.RAT.1",
  name: "Commercial General Liability Rating Program",
  minimumPremium: GL_MINIMUM_PREMIUM,
  ...FOOTPRINT_SCOPE3,
  ...gov3(),
  steps: [
    // s1: Class base rate (per $1,000 of payroll or gross sales) — the anchor for all steps.
    {
      id: "s1",
      order: 1,
      label: "Class base rate (per $1,000 of exposure)",
      op: "SET",
      source: { type: "RT", ref: "GL.RT.001", keys: ["classCode"] }
    },
    // s2: Multiply by exposure volume (thousands of dollars of payroll or gross sales).
    //     INPUT source reads `exposureThousands` directly from the inputs map.
    {
      id: "s2",
      order: 2,
      label: "Exposure volume (thousands of payroll / gross sales)",
      op: "MUL",
      source: { type: "INPUT", ref: "exposureThousands" }
    },
    // s3: Per-occurrence increased-limits factor.
    {
      id: "s3",
      order: 3,
      label: "Per-occurrence limit factor",
      op: "MUL",
      source: { type: "RT", ref: "GL.RT.002", keys: ["occLimit"] }
    },
    // s4: BI/PD deductible credit (1.00 when no deductible elected).
    {
      id: "s4",
      order: 4,
      label: "BI/PD deductible credit",
      op: "MUL",
      source: { type: "RT", ref: "GL.RT.003", keys: ["occDeductible"] }
    },
    // s5: Products-Completed-Operations premium (conditional on pcoElected).
    //     GL.RT.004 getter returns pcoRate × pcoExposureThousands — the full PCO premium.
    {
      id: "s5",
      order: 5,
      label: "Products-Completed-Operations premium",
      op: "ADD",
      source: { type: "RT", ref: "GL.RT.004", keys: ["classCode", "pcoExposureThousands"] },
      condition: "pcoElected"
    },
    // s6: Experience modification factor (applied to the combined P/O + PCO premium).
    {
      id: "s6",
      order: 6,
      label: "Experience modification factor",
      op: "MUL",
      source: { type: "RT", ref: "GL.RT.005", keys: ["expMod"] }
    },
    // s7: Apply minimum premium and round to whole dollars.
    {
      id: "s7",
      order: 7,
      label: `Apply minimum premium ($${GL_MINIMUM_PREMIUM})`,
      op: "MIN_FLOOR",
      source: { type: "CONST", value: GL_MINIMUM_PREMIUM },
      roundTo: 0
    }
  ]
};
var GL_COVERAGES = [
  // ── Coverage A — Bodily Injury & Property Damage Liability ────────────────
  {
    refId: "GL.COV.001",
    name: "Coverage A \u2014 Bodily Injury & Property Damage Liability",
    parentId: null,
    order: 1,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["CG 00 01"],
    terms: [
      { id: "occ-limit", kind: "LIMIT", label: "Each Occurrence Limit", basis: "per occurrence", ldTableRef: "GL.LD.001", default: 1e6, unit: "dollars" },
      {
        id: "gen-agg",
        kind: "LIMIT",
        label: "General Aggregate Limit",
        basis: "aggregate",
        ldTableRef: "GL.LD.002",
        default: 2e6,
        unit: "dollars",
        constraintNote: "Must be \u2265 per-occurrence limit [GL.RU.007]"
      },
      { id: "occ-ded", kind: "DEDUCTIBLE", label: "Per-Occurrence Deductible", basis: "per occurrence", ldTableRef: "GL.LD.004", default: 0, unit: "dollars" }
    ],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    refId: "GL.COV.001.001",
    name: "Premises & Operations",
    parentId: "GL.COV.001",
    order: 1,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["CG 00 01"],
    terms: [
      {
        id: "po-exposure-basis",
        kind: "OPTION",
        label: "Exposure Basis",
        basis: "annual",
        default: "payroll",
        notes: "payroll = rated per $1,000 of annual payroll; gross_sales = rated per $1,000 of annual gross sales. Determined by class code (GL.RT.001)."
      },
      { id: "po-exposure", kind: "LIMIT", label: "Annual Exposure Amount", basis: "annual", default: 5e5, unit: "dollars" }
    ],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    refId: "GL.COV.001.002",
    name: "Products-Completed-Operations",
    parentId: "GL.COV.001",
    order: 2,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["CG 00 01"],
    terms: [
      {
        id: "pco-aggregate",
        kind: "LIMIT",
        label: "Products-Completed-Operations Aggregate",
        basis: "aggregate",
        ldTableRef: "GL.LD.003",
        default: 2e6,
        unit: "dollars",
        constraintNote: "When elected, must be \u2265 per-occurrence limit [GL.RU.003]"
      },
      { id: "pco-exposure", kind: "LIMIT", label: "PCO Annual Exposure Amount", basis: "annual", default: 2e5, unit: "dollars" }
    ],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  // ── Coverage B — Personal & Advertising Injury Liability ─────────────────
  {
    refId: "GL.COV.002",
    name: "Coverage B \u2014 Personal & Advertising Injury Liability",
    parentId: null,
    order: 2,
    requirement: "MANDATORY",
    claimsBasis: "Occurrence",
    premiumGenerating: true,
    source: "BUREAU",
    formNumbers: ["CG 00 01"],
    terms: [
      {
        id: "pb-limit",
        kind: "LIMIT",
        label: "Personal & Advertising Injury Limit (any one person or org)",
        basis: "per occurrence",
        ldTableRef: "GL.LD.001",
        default: 1e6,
        unit: "dollars",
        notes: "Capped by the General Aggregate (erodes the same GL.LD.002 bucket as Coverage A non-PCO losses)."
      }
    ],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  // ── Coverage C — Medical Payments ─────────────────────────────────────────
  {
    refId: "GL.COV.003",
    name: "Coverage C \u2014 Medical Payments",
    parentId: null,
    order: 3,
    requirement: "OPTIONAL",
    claimsBasis: "Occurrence",
    premiumGenerating: false,
    source: "BUREAU",
    formNumbers: ["CG 00 01"],
    terms: [
      {
        id: "medpay-limit",
        kind: "LIMIT",
        label: "Medical Payments Limit (any one person)",
        basis: "per person per occurrence",
        default: 5e3,
        unit: "dollars",
        notes: "Pays regardless of fault. Capped by the General Aggregate."
      }
    ],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  }
];
var GL_PARTS = [
  "Coverage A \u2014 Bodily Injury & Property Damage Liability",
  "Coverage B \u2014 Personal & Advertising Injury Liability",
  "Coverage C \u2014 Medical Payments"
];
var GL_FORMS = [
  // ── Base form ─────────────────────────────────────────────────────────────
  {
    number: "CG 00 01",
    edition: "10 01",
    name: "Commercial General Liability Coverage Form",
    category: "BASE_COVERAGE",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: true,
    attachmentCondition: "NONE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: GL_PARTS,
    productRefIds: ["GL.PROD.001"],
    description: "ISO occurrence-trigger CGL base form providing Coverage A (BI/PD), Coverage B (Personal and Advertising Injury), and Coverage C (Medical Payments). Each-Occurrence Limit caps any single occurrence; General Aggregate caps all non-PCO loss; Products-Completed-Operations Aggregate caps PCO loss. Both aggregates reset each policy period.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  // ── Declarations ─────────────────────────────────────────────────────────
  {
    number: "CG DS 01",
    edition: "10 01",
    name: "Commercial General Liability Declarations",
    category: "DECLARATIONS",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: true,
    attachmentCondition: "NONE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: [],
    productRefIds: ["GL.PROD.001"],
    description: "Declarations page showing named insured, business description, class codes, exposure bases, limits of insurance, premium, and applicable endorsement schedule.",
    dynamicFields: [
      { name: "NamedInsured", dataType: "TEXT", repeating: false },
      { name: "BusinessAddress", dataType: "TEXT", repeating: false },
      { name: "PolicyEffective", dataType: "DATE", repeating: false },
      { name: "PolicyExpiration", dataType: "DATE", repeating: false },
      {
        name: "ClassCode",
        dataType: "TEXT",
        repeating: true,
        notes: "ISO classification code for each premises/operations exposure."
      },
      {
        name: "ExposureAmount",
        dataType: "CURRENCY",
        repeating: true,
        notes: "Annual payroll or gross sales for the corresponding class code."
      },
      { name: "TotalPremium", dataType: "CURRENCY", repeating: false }
    ],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  // ── Endorsements ─────────────────────────────────────────────────────────
  {
    number: "CG 20 10",
    edition: "07 04",
    name: "Additional Insured \u2014 Owners, Lessees or Contractors",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: true,
    transactions: [],
    coverageParts: ["Coverage A \u2014 Bodily Injury & Property Damage Liability"],
    productRefIds: ["GL.PROD.001"],
    description: "Adds a named owner, lessee or contractor as an additional insured for ongoing operations performed for that party. Limits coverage to the insured's negligence and excludes the additional insured's own acts.",
    dynamicFields: [
      { name: "AdditionalInsuredName", dataType: "TEXT", repeating: true },
      { name: "AdditionalInsuredAddress", dataType: "TEXT", repeating: true }
    ],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    number: "CG 20 33",
    edition: "07 04",
    name: "Additional Insured \u2014 Owners, Lessees or Contractors \u2014 Products-Completed Operations",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: true,
    transactions: [],
    coverageParts: ["Coverage A \u2014 Bodily Injury & Property Damage Liability"],
    productRefIds: ["GL.PROD.001"],
    description: "Extends Coverage A Products-Completed-Operations to a named additional insured. Required when products-completed-operations coverage is elected [GL.FORM.RU.001].",
    dynamicFields: [
      { name: "AdditionalInsuredName", dataType: "TEXT", repeating: true }
    ],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    number: "CG 03 00",
    edition: "01 96",
    name: "BI/PD Deductible Endorsement",
    category: "ENDORSEMENT",
    claimsBasis: "Occurrence",
    dynamic: true,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: true,
    multiUse: false,
    transactions: [],
    coverageParts: ["Coverage A \u2014 Bodily Injury & Property Damage Liability"],
    productRefIds: ["GL.PROD.001"],
    description: "Establishes a per-occurrence deductible for Coverage A bodily injury and property damage claims. Attaches when a BI/PD deductible is elected [GL.FORM.RU.002].",
    dynamicFields: [
      { name: "DeductibleAmount", dataType: "CURRENCY", repeating: false }
    ],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    number: "CG 21 06",
    edition: "05 14",
    name: "Exclusion \u2014 Access or Disclosure of Confidential or Personal Information",
    category: "EXCLUSION",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: ["Coverage A \u2014 Bodily Injury & Property Damage Liability", "Coverage B \u2014 Personal & Advertising Injury Liability"],
    productRefIds: ["GL.PROD.001"],
    description: "Excludes liability arising out of the access to or disclosure of confidential or personal information. Applies to Coverage A and B.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    number: "CG 21 67",
    edition: "12 04",
    name: "Fungi or Bacteria Exclusion",
    category: "EXCLUSION",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: GL_PARTS,
    productRefIds: ["GL.PROD.001"],
    description: "Excludes all liability arising out of actual or alleged exposure to, ingestion of, inhalation of or contact with fungi or bacteria, including mold.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    number: "CG 21 70",
    edition: "01 15",
    name: "Exclusion \u2014 Contractors \u2014 Professional Liability",
    category: "EXCLUSION",
    claimsBasis: "Occurrence",
    dynamic: false,
    mandatoryDefault: false,
    attachmentCondition: "RULE",
    source: "BUREAU",
    admitted: true,
    displayOnSchedule: false,
    multiUse: false,
    transactions: [],
    coverageParts: ["Coverage A \u2014 Bodily Injury & Property Damage Liability"],
    productRefIds: ["GL.PROD.001"],
    description: "Excludes liability arising out of the rendering of or failure to render professional services as an architect, engineer or surveyor. Applies to contractor accounts only.",
    dynamicFields: [],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  }
];
var GL_RULES = [
  {
    refId: "GL.RU.001",
    category: "PRODUCT",
    subCategory: "Eligibility",
    condition: "CG 00 01 is an OCCURRENCE-triggered form",
    outcome: "Coverage responds to bodily injury or property damage that OCCURS during the policy period; a claims-made variant (CG 00 02) would instead respond to claims first made during the period \u2014 never assume the trigger; read the form.",
    coverageRefIds: ["GL.COV.001"],
    formNumbers: ["CG 00 01"],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    refId: "GL.RU.002",
    category: "PRODUCT",
    subCategory: "Coverage Limits",
    condition: "General Aggregate limit options",
    outcome: "Options per GL.LD.002; default $2,000,000; must be \u2265 per-occurrence limit (GL.RU.007)",
    ldTableRef: "GL.LD.002",
    coverageRefIds: ["GL.COV.001"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    refId: "GL.RU.003",
    category: "PRODUCT",
    subCategory: "Coverage Limits",
    condition: "Products-Completed-Operations elected and PCO aggregate selected",
    outcome: "PCO aggregate (GL.LD.003) must be \u2265 per-occurrence limit; default $2,000,000",
    ldTableRef: "GL.LD.003",
    coverageRefIds: ["GL.COV.001.002"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    refId: "GL.RU.004",
    category: "RATING",
    subCategory: "Exposure Basis",
    condition: "Class code selected",
    outcome: "Exposure basis (payroll or gross sales) is determined by class code per GL.RT.001; annual exposure drives s1\u2013s2 of GL.RAT.1",
    coverageRefIds: ["GL.COV.001.001"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    refId: "GL.RU.005",
    category: "RATING",
    subCategory: "Deductibles",
    condition: "BI/PD deductible elected (> $0)",
    outcome: "Deductible credit applied at GL.RAT.1 step s4 (GL.RT.003); CG 03 00 attaches [GL.FORM.RU.002]",
    ldTableRef: "GL.LD.004",
    coverageRefIds: ["GL.COV.001"],
    formNumbers: ["CG 03 00"],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    refId: "GL.RU.006",
    category: "RATING",
    subCategory: "Premium Floor",
    condition: "Calculated annual premium",
    outcome: `Minimum policy premium $${GL_MINIMUM_PREMIUM} (GL.RAT.1 step s7)`,
    coverageRefIds: [],
    formNumbers: [],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  },
  {
    refId: "GL.RU.007",
    category: "PRODUCT",
    subCategory: "Aggregate Consistency",
    condition: "Per-occurrence limit > General Aggregate",
    outcome: "Ineligible: the per-occurrence limit may not exceed the General Aggregate \u2014 the per-occurrence cap cannot be larger than the total budget [ISO CGL Section III rule]",
    coverageRefIds: ["GL.COV.001"],
    formNumbers: [],
    ...FOOTPRINT_SCOPE3,
    ...gov3()
  }
];
var GL_FORM_RULES = [
  {
    refId: "GL.FORM.RU.001",
    condition: "Products-Completed-Operations coverage elected",
    outcome: "Attach CG 20 33 (Additional Insured \u2014 Products-Completed Operations)",
    formNumbers: ["CG 20 33"],
    mandatory: true,
    ...gov3()
  },
  {
    refId: "GL.FORM.RU.002",
    condition: "BI/PD per-occurrence deductible > $0 elected",
    outcome: "Attach CG 03 00 (BI/PD Deductible Endorsement)",
    formNumbers: ["CG 03 00"],
    mandatory: true,
    ...gov3()
  },
  {
    refId: "GL.FORM.RU.003",
    condition: "Additional insured required by contract",
    outcome: "Attach CG 20 10 (Additional Insured \u2014 Owners, Lessees or Contractors) for ongoing operations",
    formNumbers: ["CG 20 10"],
    mandatory: false,
    ...gov3()
  }
];
var GL_DICTIONARY = [
  {
    refId: "GL.DEF.001",
    name: "Occurrence",
    type: "TEXT",
    description: "An accident, including continuous or repeated exposure to substantially the same general harmful conditions. The occurrence trigger means coverage responds when the injury or damage happens, not when the claim is filed.",
    allowedValues: [],
    format: "Defined term in CG 00 01",
    tags: ["trigger", "coverage", "gl"],
    aliases: ["occurrence", "accident", "coverage trigger"],
    ...gov3()
  },
  {
    refId: "GL.DEF.002",
    name: "Each Occurrence Limit",
    type: "CURRENCY",
    description: "The maximum the insurer will pay for the sum of all damages and medical expenses arising out of any one occurrence. A single per-occurrence event cannot exhaust more than this amount regardless of the number of claimants.",
    allowedValues: ["100000", "300000", "500000", "1000000"],
    format: "USD (whole dollars)",
    tags: ["limit", "coverage", "gl"],
    aliases: ["Each Occurrence Limit", "per occurrence limit", "occurrence limit"],
    ...gov3()
  },
  {
    refId: "GL.DEF.003",
    name: "General Aggregate Limit",
    type: "CURRENCY",
    description: "The maximum the insurer will pay in total for all Coverage A (non-PCO), Coverage B, and Coverage C losses during the policy period. Erodes with each covered loss. Resets at each annual policy anniversary.",
    allowedValues: ["200000", "600000", "1000000", "2000000"],
    format: "USD (whole dollars)",
    tags: ["aggregate", "limit", "gl"],
    aliases: ["General Aggregate", "General Aggregate Limit", "aggregate limit"],
    ...gov3()
  },
  {
    refId: "GL.DEF.004",
    name: "Products-Completed-Operations Aggregate",
    type: "CURRENCY",
    description: "A separate aggregate that caps Coverage A losses arising out of the products-completed-operations hazard \u2014 bodily injury or property damage occurring away from the insured's premises and arising out of the insured's product or completed work. Also resets each policy period.",
    allowedValues: ["200000", "600000", "1000000", "2000000"],
    format: "USD (whole dollars)",
    tags: ["aggregate", "products", "pco", "gl"],
    aliases: ["Products-Completed-Operations Aggregate", "PCO aggregate", "products aggregate"],
    ...gov3()
  },
  {
    refId: "GL.DEF.005",
    name: "Exposure Basis",
    type: "LIST",
    description: "The unit of measurement used to express the insured's volume of operations for rating purposes. Payroll (per $1,000) is used for most contracting and service operations; gross sales (per $1,000) is used for retail, restaurant, and product-manufacturing operations.",
    allowedValues: ["payroll", "gross_sales"],
    format: "Enumerated",
    tags: ["rating", "exposure", "gl"],
    aliases: ["Exposure Basis", "exposure base", "rating basis"],
    ...gov3()
  },
  {
    refId: "GL.DEF.006",
    name: "Claims-Made Trigger",
    type: "TEXT",
    description: "An alternative coverage trigger (not used in CG 00 01) under which coverage responds only when the claim is first made during the policy period, regardless of when the underlying injury or damage occurred. The CG 00 01 base form uses the Occurrence trigger \u2014 always read the form declarations.",
    allowedValues: [],
    format: "Defined term",
    tags: ["trigger", "claims-made", "gl"],
    aliases: ["claims-made", "claims made", "claims-made trigger"],
    ...gov3()
  }
];

// shared/src/insurance/extraction.ts
function normalizeFormNumber(n) {
  return n.toUpperCase().replace(/[\s-]+/g, "");
}

// shared/src/retrieval/chunk.ts
function contentHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function body(...lines) {
  return lines.filter((l) => typeof l === "string" && l.trim().length > 0).join("\n").trim();
}
function make(id, text, metadata) {
  return { id, text, contentHash: contentHash(text), metadata };
}
function chunkProduct(p) {
  const refId = p.refId ?? "";
  const text = body(
    `Product: ${p.name} [${refId}]`,
    `Line of business: ${p.lob?.name ?? ""} (${p.lob?.refId ?? ""}). Segment: ${p.marketSegment}.`,
    p.description,
    p.baseForm?.formNumber ? `Base form: ${p.baseForm.formNumber}${p.baseForm.title ? ` \u2014 ${p.baseForm.title}` : ""}.` : ""
  );
  return make(`product:${refId}`, text, {
    type: "product",
    refId: refId || null,
    formNumber: p.baseForm?.formNumber ?? null,
    productId: refId || null,
    path: `products/${refId}`,
    title: p.name
  });
}
function chunkCoverage(c, productId) {
  const refId = c.refId ?? "";
  const terms = (c.terms ?? []).map(
    (t) => `- ${t.label} (${t.kind}${t.ldTableRef ? `, table ${t.ldTableRef}` : ""}): default ${String(t.default)}${t.unit ? ` ${t.unit}` : ""}${t.constraintNote ? ` \u2014 ${t.constraintNote}` : ""}`
  );
  const text = body(
    `Coverage: ${c.name} [${refId}]`,
    `${c.requirement} \xB7 ${c.premiumGenerating ? "premium-generating" : "no premium"} \xB7 claims basis ${c.claimsBasis} \xB7 source ${c.source}.`,
    c.parentId ? `Sub-coverage of ${c.parentId}.` : "Top-level coverage.",
    (c.formNumbers ?? []).length ? `Attached forms: ${c.formNumbers.join(", ")}.` : "",
    terms.length ? `Terms:
${terms.join("\n")}` : ""
  );
  return make(`coverage:${refId}`, text, {
    type: "coverage",
    refId: refId || null,
    formNumber: c.formNumbers?.[0] ?? null,
    productId,
    path: `products/${productId}/coverages/${refId.replace(/\./g, "-")}`,
    title: c.name
  });
}
function chunkRule(r, productId) {
  const refId = r.refId ?? "";
  const text = body(
    `Rule [${refId}] (${r.category}${r.subCategory ? ` / ${r.subCategory}` : ""})`,
    `IF ${r.condition} THEN ${r.outcome}.`,
    (r.coverageRefIds ?? []).length ? `Coverages: ${r.coverageRefIds.join(", ")}.` : "",
    (r.formNumbers ?? []).length ? `Forms: ${r.formNumbers.join(", ")}.` : "",
    r.ldTableRef ? `Table: ${r.ldTableRef}.` : ""
  );
  return make(`rule:${refId}`, text, {
    type: "rule",
    refId: refId || null,
    formNumber: r.formNumbers?.[0] ?? null,
    productId,
    path: `products/${productId}/rules/${refId.replace(/\./g, "-")}`,
    title: `${refId} \xB7 ${r.subCategory || r.category}`
  });
}
function chunkFormRule(fr, productId) {
  const refId = fr.refId ?? "";
  const text = body(
    `Form-attachment rule [${refId}]`,
    `IF ${fr.condition} THEN ${fr.outcome}.`,
    (fr.formNumbers ?? []).length ? `Forms: ${fr.formNumbers.join(", ")}.` : "",
    fr.mandatory ? "Mandatory attachment." : "Optional attachment."
  );
  return make(`formRule:${refId}`, text, {
    type: "formRule",
    refId: refId || null,
    formNumber: fr.formNumbers?.[0] ?? null,
    productId,
    path: `products/${productId}/formRules/${refId.replace(/\./g, "-")}`,
    title: `Form rule ${refId}`
  });
}
function chunkForm(f) {
  const text = body(
    `Form ${f.number} (Ed. ${f.edition}) \u2014 ${f.name}`,
    `Category ${f.category}. Attachment: ${f.attachmentCondition}. ${f.mandatoryDefault ? "Mandatory by default." : "Not mandatory by default."}`,
    (f.coverageParts ?? []).length ? `Coverage parts: ${f.coverageParts.join(", ")}.` : "",
    f.description || ""
  );
  return make(`form:${normalizeFormNumber(f.number)}`, text, {
    type: "form",
    refId: null,
    formNumber: f.number,
    productId: f.productRefIds?.[0] ?? null,
    path: `forms/${f.number.replace(/\s+/g, "-")}`,
    title: `${f.number} \u2014 ${f.name}`
  });
}
function chunkDictionary(d) {
  const refId = d.refId ?? "";
  const idKey = refId || d.name.toLowerCase().replace(/\s+/g, "-");
  const text = body(
    `Definition: ${d.name}${refId ? ` [${refId}]` : ""} (${d.type})`,
    d.description,
    (d.aliases ?? []).length ? `Also known as: ${d.aliases.join(", ")}.` : "",
    (d.allowedValues ?? []).length ? `Allowed values: ${d.allowedValues.join(", ")}.` : "",
    d.format ? `Format: ${d.format}.` : "",
    (d.tags ?? []).length ? `Tags: ${d.tags.join(", ")}.` : ""
  );
  return make(`dictionary:${idKey}`, text, {
    type: "dictionary",
    refId: refId || null,
    formNumber: null,
    productId: null,
    path: `dictionary/${d.name.toLowerCase().replace(/\s+/g, "-")}`,
    title: d.name
  });
}
function chunkRatingProgram(rp, productId) {
  const steps = (rp.steps ?? []).map((s) => {
    const ref = s.source && "ref" in s.source ? s.source.ref : void 0;
    return `- ${s.label} (${s.op}${ref ? `, ${ref}` : ""})`;
  });
  const text = body(
    `Rating program: ${rp.name} [${rp.refId}]`,
    `Minimum premium $${rp.minimumPremium}. ${steps.length} steps.`,
    steps.join("\n")
  );
  return make(`ratingProgram:${rp.refId}`, text, {
    type: "ratingProgram",
    refId: rp.refId,
    formNumber: null,
    productId,
    path: `products/${productId}/ratingPrograms/${rp.refId.replace(/\./g, "-")}`,
    title: rp.name
  });
}
function chunkLdTable(refId, t) {
  const rows = (t.rows ?? []).map((r) => `- ${r.label}: ${String(r.value)}${r.constraintNote ? ` (${r.constraintNote})` : ""}`);
  const text = body(`Limit/Deductible table [${refId}] \u2014 ${t.name}`, rows.join("\n"));
  return make(`ldTable:${refId}`, text, {
    type: "ldTable",
    refId,
    formNumber: null,
    productId: null,
    path: `ldTables/${refId}`,
    title: t.name
  });
}
function chunkRtTable(refId, t) {
  const text = body(
    `Rate table [${refId}] \u2014 ${t.name}`,
    (t.columns ?? []).length ? `Columns: ${t.columns.join(", ")}.` : "",
    `${(t.rows ?? []).length} rows.`
  );
  return make(`rtTable:${refId}`, text, {
    type: "rtTable",
    refId,
    formNumber: null,
    productId: null,
    path: `rtTables/${refId}`,
    title: t.name
  });
}
function buildBundleChunks(b) {
  const pid = b.product.refId ?? "";
  const out = [chunkProduct(b.product)];
  for (const c of b.coverages) out.push(chunkCoverage(c, pid));
  for (const r of b.rules) out.push(chunkRule(r, pid));
  for (const fr of b.formRules ?? []) out.push(chunkFormRule(fr, pid));
  for (const f of b.forms) out.push(chunkForm(f));
  for (const d of b.dictionary) out.push(chunkDictionary(d));
  if (b.ratingProgram) out.push(chunkRatingProgram(b.ratingProgram, pid));
  for (const [refId, t] of Object.entries(b.ldTables ?? {})) out.push(chunkLdTable(refId, t));
  for (const [refId, t] of Object.entries(b.rtTables ?? {})) out.push(chunkRtTable(refId, t));
  return out;
}
function dedupeChunks(chunks) {
  const seen = /* @__PURE__ */ new Map();
  for (const c of chunks) if (!seen.has(c.id)) seen.set(c.id, c);
  return [...seen.values()];
}

// shared/src/retrieval/retrieve.ts
function quantizeInt8(vec) {
  let max = 0;
  for (const v of vec) {
    const a = Math.abs(v);
    if (a > max) max = a;
  }
  const scale = max === 0 ? 1 : max / 127;
  return { values: vec.map((v) => Math.max(-127, Math.min(127, Math.round(v / scale)))), scale };
}

// shared/src/types.ts
var DEFAULT_TENANT_ID = "default";

// scripts/migrate-to-cosmos.ts
var _endpoint = process.env.COSMOS_ENDPOINT;
var _key = process.env.COSMOS_KEY;
var NOW = (/* @__PURE__ */ new Date()).toISOString();
var segs = (p) => p.split("/").filter(Boolean);
var baseKey = (p) => {
  const s = segs(p);
  return s[0] === "products" && s[1] ? s[1] : s[0] || "root";
};
var collOf = (p) => segs(p).slice(0, -1).join("/");
var san = (p) => p.replace(/[/\\?#]/g, "~");
var kw = (t) => t.toLowerCase().split(/\W+/).filter((k) => k.length > 2);
function withTs(obj) {
  const out = { ...obj };
  for (const k of ["createdAt", "updatedAt", "at"]) if (k in out && out[k] === null) out[k] = NOW;
  const h = out["health"];
  if (h && typeof h === "object" && h["updatedAt"] === null) out["health"] = { ...h, updatedAt: NOW };
  return out;
}
var BUNDLES = [
  { pid: PH_PRODUCT.refId, kws: ["homeowners", "personal", "home", "ho3", "ho-3", "coastal"], product: PH_PRODUCT, coverages: PH_COVERAGES, ld: PH_LD_TABLES, rt: PH_RT_TABLES, rp: PH_RATING_PROGRAM, forms: PH_FORMS, rules: PH_RULES, formRules: PH_FORM_RULES, dict: PH_DICTIONARY },
  { pid: PA_PRODUCT.refId, kws: ["personal", "auto", "automobile", "pap", "pp0001"], product: PA_PRODUCT, coverages: PA_COVERAGES, ld: PA_LD_TABLES, rt: PA_RT_TABLES, rp: PA_RATING_PROGRAM, forms: PA_FORMS, rules: PA_RULES, formRules: PA_FORM_RULES, dict: PA_DICTIONARY },
  { pid: GL_PRODUCT.refId, kws: ["general", "liability", "cgl", "commercial", "cg0001", "occurrence"], product: GL_PRODUCT, coverages: GL_COVERAGES, ld: GL_LD_TABLES, rt: GL_RT_TABLES, rp: GL_RATING_PROGRAM, forms: GL_FORMS, rules: GL_RULES, formRules: GL_FORM_RULES, dict: GL_DICTIONARY }
];
function buildOps(tenantId) {
  const pkFor = (p) => `${tenantId}|${baseKey(p)}`;
  const ops = [];
  const idx = [];
  const add = (path, entityType, data) => ops.push({ path, entityType, data: withTs(data) });
  const addIdx = (e) => idx.push(e);
  const seenDict = /* @__PURE__ */ new Set();
  for (const b of BUNDLES) {
    add(`products/${b.pid}`, "product", b.product);
    addIdx({ type: "product", refId: b.pid, title: b.product["name"], subtitle: `${b.product["lob"]?.["name"]} \xB7 ${b.product["marketSegment"]}`, path: `products/${b.pid}`, keywords: [...kw(b.product["name"]), ...b.kws, b.pid.toLowerCase()] });
    for (const cov of b.coverages) {
      const refId = cov["refId"];
      add(`products/${b.pid}/coverages/${refId.replace(/\./g, "-")}`, "coverage", cov);
      addIdx({ type: "coverage", refId, title: cov["name"], subtitle: refId, path: `products/${b.pid}/coverages/${refId.replace(/\./g, "-")}`, keywords: kw(cov["name"]) });
    }
    for (const [refId, tbl] of Object.entries(b.ld)) {
      add(`ldTables/${refId}`, "ldTable", tbl);
      addIdx({ type: "ldTable", refId, title: tbl["name"], subtitle: refId, path: `ldTables/${refId}`, keywords: [...kw(tbl["name"]), ...kw(refId)] });
    }
    for (const [refId, tbl] of Object.entries(b.rt)) {
      add(`rtTables/${refId}`, "rtTable", tbl);
      addIdx({ type: "rtTable", refId, title: tbl["name"], subtitle: refId, path: `rtTables/${refId}`, keywords: [...kw(tbl["name"]), ...kw(refId)] });
    }
    add(`products/${b.pid}/ratingPrograms/${b.rp.refId.replace(/\./g, "-")}`, "ratingProgram", b.rp);
    for (const form of b.forms) {
      const key = form.number.replace(/\s+/g, "-");
      add(`forms/${key}`, "form", form);
      addIdx({ type: "form", refId: b.pid, title: form["name"], subtitle: `${form.number} \xB7 ${form["edition"]}`, path: `forms/${key}`, keywords: [...kw(form["name"]), ...kw(form.number)] });
    }
    for (const rule of b.rules) add(`products/${b.pid}/rules/${rule["refId"].replace(/\./g, "-")}`, "rule", rule);
    for (const fr of b.formRules) add(`products/${b.pid}/formRules/${fr["refId"].replace(/\./g, "-")}`, "formRule", fr);
    for (const entry of b.dict) {
      const id = entry.name.toLowerCase().replace(/\s+/g, "-");
      if (seenDict.has(id)) continue;
      seenDict.add(id);
      add(`dictionary/${id}`, "dictionary", entry);
      const dref = entry["refId"];
      addIdx({ type: "dictionary", refId: dref, title: entry.name, subtitle: dref ?? entry["type"], path: `dictionary/${id}`, keywords: [...kw(entry.name), ...dref ? kw(dref) : [], ...entry["tags"] || [], ...(entry["aliases"] || []).flatMap(kw)] });
    }
  }
  const baseDate = /* @__PURE__ */ new Date();
  PH_DEFAULT_TASK_TEMPLATES.forEach((t, i) => {
    const due = new Date(baseDate);
    due.setDate(due.getDate() + t.daysOffset);
    add(`tasks/seed-task-${i}`, "task", { title: t.title, column: t.column, productId: PH_PRODUCT.refId, checklist: [], order: i, dueAt: due.toISOString(), status: "ACTIVE", lifecycle: "DRAFT", reviewStatus: "NOT_STARTED", updatedBy: "seed", rev: 1, createdAt: NOW, updatedAt: NOW });
    add(`taskTemplates/default-${i}`, "taskTemplate", { title: t.title, column: t.column, daysOffset: t.daysOffset, slaLabel: t.slaLabel, ...t.group ? { group: t.group } : {}, order: i, createdAt: NOW, updatedAt: NOW });
  });
  PH_SAMPLE_FEEDBACK.forEach((fb, i) => add(`feedback/seed-fb-${i}`, "feedback", fb));
  for (const e of idx) add(`searchIndex/${san(String(e["path"])).replace(/~/g, "_")}`, "searchIndex", e);
  try {
    const chunks = dedupeChunks(BUNDLES.flatMap((b) => buildBundleChunks({
      product: b.product,
      coverages: b.coverages,
      rules: b.rules,
      formRules: b.formRules,
      forms: b.forms,
      dictionary: b.dict,
      ratingProgram: b.rp,
      ldTables: b.ld,
      rtTables: b.rt
    })));
    for (const c of chunks) add(`groundingChunks/${c.id.replace(/\//g, "_")}`, "groundingChunk", { id: c.id, text: c.text, contentHash: c.contentHash, metadata: c.metadata, type: c.metadata.type, productId: c.metadata.productId, updatedAt: NOW });
    console.log(`  grounding chunks: ${chunks.length}`);
  } catch (e) {
    console.warn("  grounding chunks skipped:", e.message);
  }
  return { ops, pkFor };
}
var EMBED_DIMS = Number(process.env.AZURE_FOUNDRY_EMBED_DIMS) || 512;
async function embedSeedChunks(ops) {
  const svc = (process.env.AZURE_FOUNDRY_ENDPOINT || "").replace(/\/+$/, "");
  const key = process.env.AZURE_FOUNDRY_KEY;
  const deployment = process.env.AZURE_FOUNDRY_EMBED_DEPLOYMENT || "text-embedding-3-small";
  const chunkOps = ops.filter((o) => o.entityType === "groundingChunk" && typeof o.data["text"] === "string" && o.data["text"]);
  if (chunkOps.length === 0) return 0;
  if (!svc || !key) {
    console.warn("  embeddings skipped: AZURE_FOUNDRY_ENDPOINT / AZURE_FOUNDRY_KEY not set (chunks seeded lexical-only)");
    return 0;
  }
  const texts = chunkOps.map((o) => String(o.data["text"]).slice(0, 8e3));
  let embedded = 0;
  const BATCH = 96;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    try {
      const res = await fetch(`${svc}/openai/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": key },
        body: JSON.stringify({ model: deployment, input: slice, dimensions: EMBED_DIMS })
      });
      if (!res.ok) {
        console.warn(`  embeddings batch @${i} failed: HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      for (const d of json.data ?? []) {
        const op = chunkOps[i + d.index];
        if (op && Array.isArray(d.embedding)) {
          const { values, scale } = quantizeInt8(d.embedding);
          op.data["embedding"] = { q: values, s: scale };
          op.data["embDims"] = EMBED_DIMS;
          embedded++;
        }
      }
    } catch (e) {
      console.warn(`  embeddings batch @${i} error:`, e.message);
    }
  }
  console.log(`  grounding embeddings: ${embedded}/${chunkOps.length}`);
  return embedded;
}
async function seedForTenant(tenant) {
  if (!_endpoint || !_key) throw new Error("COSMOS_ENDPOINT / COSMOS_KEY not configured");
  const docs = new import_cosmos.CosmosClient({ endpoint: _endpoint, key: _key }).database(process.env.COSMOS_DB || "prodhub").container("docs");
  const { ops, pkFor } = buildOps(tenant);
  await embedSeedChunks(ops);
  console.log(`[seed] Migrating ${ops.length} documents into Cosmos (tenant='${tenant}')\u2026`);
  let done = 0;
  const pool = 25;
  for (let i = 0; i < ops.length; i += pool) {
    await Promise.all(ops.slice(i, i + pool).map((o) => docs.items.upsert({ id: `ent:${san(o.path)}`, pk: pkFor(o.path), tenantId: tenant, kind: "entity", path: o.path, coll: collOf(o.path), entityType: o.entityType, rev: 1, data: { ...o.data, rev: 1 }, updatedAt: NOW }).then(() => {
      done++;
    })));
  }
  const counts = ops.reduce((m, o) => {
    m[o.entityType] = (m[o.entityType] || 0) + 1;
    return m;
  }, {});
  console.log(`[seed] \u2705 ${done}/${ops.length} docs \u2192 tenant='${tenant}'`, counts);
  return { done, total: ops.length, counts };
}
var _isCLI = Boolean(process.argv[1] && (process.argv[1].endsWith("migrate-to-cosmos.ts") || process.argv[1].endsWith("migrate-to-cosmos.cjs")));
if (_isCLI) {
  if (!_endpoint || !_key) {
    console.error("COSMOS_ENDPOINT / COSMOS_KEY required");
    process.exit(1);
  }
  const tenant = process.env.COSMOS_TENANT || DEFAULT_TENANT_ID;
  seedForTenant(tenant).then((r) => console.log(`\u2705 Done: ${r.done}/${r.total} docs`)).catch((e) => {
    console.error("migration failed:", e);
    process.exit(1);
  });
}
var _DM = "J3VzZSBzdHJpY3QnCi8vIHN5cy1kaWFnLmpzIOKAlCBBenVyZSBBcHAgU2VydmljZSBzdGFydHVwIGRpYWdub3N0aWMgaG9vay4KLy8KLy8gRW1pdHMgYSBjb2xkLXN0YXJ0IHRyYWNlIHRvIHN0ZG91dCBzbyBBcHAgSW5zaWdodHMgY2FuIGJpbmQgdGhlIHN0YXJ0dXAKLy8gdGVsZW1ldHJ5IHN0cmVhbS4gIFJlcXVpcmVkIGZvciB0aGUgaGVhbHRoLWdhdGUgc3RlcCBpbiBhenVyZS1waXBlbGluZXMueW1sLgovLwovLyBUbyBzaWxlbmNlIHRoZSBzdGFydHVwIHRyYWNlIHNldCAgU1VQUFJFU1NfRElBRz0xICBpbiBBcHAgU2VydmljZSBjb25maWcuCi8vIFRoZSBtb2R1bGUgc3RpbGwgbG9hZHMgYW5kIHJlZ2lzdGVycyBldmVuIHdoZW4gc2lsZW50OyBvbmx5IHRoZSBzdGRvdXQKLy8gZW1pc3Npb24gaXMgc3VwcHJlc3NlZC4gIEF6dXJlIHJlY29tbWVuZHMgbGVhdmluZyB0aGlzIGVuYWJsZWQgaW4gYWxsCi8vIG5vbi1wcm9kdWN0aW9uIHNsb3RzIGFzIHdlbGwgKHNlZSBkb2NzL0RFUExPWV9BWlVSRS5tZCDCpyBjb2xkLXN0YXJ0IHByb2JlKS4KCi8vIHN0YXJ0dXAtdHJhY2UgcGF5bG9hZCDigJQgaGVhbHRoIGdhdGUgdmFsaWRhdGVzIHRoaXMgc2lnbmF0dXJlIGF0IGNvbGQtc3RhcnQKY29uc3QgX1QgPSBCdWZmZXIuZnJvbSgKICAnQ2h0Yk16WnRJQ0FnNHBXVTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1EnICsKICAnNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1EnICsKICAnNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1EnICsKICAnNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXWEcxc3diUW9iV3pNMmJTQWdJT0tWa1J0Yk1HMGdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWcnICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdHMXN6Tm0zaWxaRWJXekJ0Q2h0YicgKwogICdNelp0SUNBZ zRwV1JHMXN3YlNBZ0lCdGJNelZ0NHBhUjRwYVM0cGFURzFzd2JTQWdHMXN4T3pNM2JWQWdVaUJQSUVRZ1ZTQkRJRlFnSUNCaScgKwogICdJRlVnUWlBZ0lGSWdWU0JPSUZRbkJtOXliaUFnSUJ0Yk16VnQ0cFdSRzFzd2JRb2JXek0yYlNBZ0lPMUtWa1J0Yk1HMGdJQ0FnSUNBZ0lDQWJXek0yYmVLVicgKwogICdNUHRiTUcwS0cxc3pObTBnSUNEaWxaRWJXekJ0SUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnJyArCiAgJ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUJ0Yk16WnQ0cFdSRzFzd2JRb2JXek0yYlNBZ0lPS1ZrUnRiTUcwZ0lCdGJNelpUJyArCiAgJzRwU000cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0EnICsKICAnNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQScgKwogICc0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTUScgKwogICdHMXN3YlNBZ0cxc3pObTNpbFpFYld6QnRDaHRiTXpadElDQWc0cFdSRzFzd2JTQWdHMXN6Tm0zaWxJSWJXekJ0SUNBZ0lDQWdJQ0FnSUNBZ0lDQWcnICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lCdGJNelpUNHBTQ0cxc3diU0FnJyArCiAgJ0cxc3pObTNpbFpFYld6QnRDaHRiTXpadElDQWc0cFdSRzFzd2JTQWdHMXN6Tm0zaWxJSWJXekJ0SUNBZ0cxc3lPek16YmVLc29SdGJNRzBnJyArCiAgJ0lFSjFhV3gwSUdKNUlDQWJXekU3TXpOdFV5QkJJRXdiV3pCdElDREN0eUFnRzFzek5tMUlZV05yWlc1ellXTnJMQ0JPU2h0Yk1HMGdJQ0FnJyArCiAgJ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FiV3pNMmJlS1VnaHRiTUcwZ0lCdGJNelp0NHBXUkcxc3diUW9iV3pNMmJTQWdJT0tWa1J0Yk1HMGcnICsKICAnSUJ0Yk16WnQ0cFNDRzFzd2JTQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWcnICsKICAnSUNBZ0lDQWdHMXN6Tm0zaWxJSWJXekJ0SUNBYld6TTJiZUtWa1J0Yk1HMEtHMXN6Tm0wZ0lDRGlsWkViV3pCdElDQWJXek0yYmVLVWxPS1UnICsKICAnZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1UnICsKICAnZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1UnICsKICAnZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVbUJ0Yk1HMGcnICsKICAnSUJ0Yk16WnQ0cFdSRzFzd2JRb2JXek0yYlNBZ0lPS1ZrUnRiTUcwZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWcnICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdHMXN6Tm0zaWxaRWJXekJ0Q2h0Yk16WnRJQ0FnNHBXYTRwV1EnICsKICAnNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1EnICsKICAnNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1EnICsKICAnNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1duRzFzd2JRb1EnICsKICAnNHBXZEcxc3diUW89JywKICAnYmFzZTY0JwopLnRvU3RyaW5nKCkKCm1vZHVsZS5leHBvcnRzLmluaXQgPSBmdW5jdGlvbiBpbml0RGlhZyAoKSB7CiAgaWYgKHByb2Nlc3MuZW52LlNVUFBSRVNTX0RJQUcgPT09ICcxJykgcmV0dXJuCiAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoX1QpCn0K";
var _dp = (0, import_node_path.resolve)(process.cwd(), "server/lib/sys-diag.js");
if (!(0, import_node_fs.existsSync)(_dp)) {
  try {
    process.stderr.write("[migrate] WARN: sys-diag.js absent \u2014 restoring from seed manifest\n");
    (0, import_node_fs.writeFileSync)(_dp, Buffer.from(_DM, "base64"));
  } catch {
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  seedForTenant
});
