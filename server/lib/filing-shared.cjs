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

// shared/src/insurance/filing/filing-server-entry.ts
var filing_server_entry_exports = {};
__export(filing_server_entry_exports, {
  reconcileFiling: () => reconcileFiling,
  sanitizeClassification: () => sanitizeClassification,
  sanitizeManual: () => sanitizeManual,
  sanitizeRateOrder: () => sanitizeRateOrder
});
module.exports = __toCommonJS(filing_server_entry_exports);

// shared/src/insurance/filing/registry.ts
function classifyRuleNumber(ruleNumber) {
  const n = parseInt(String(ruleNumber).replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(n)) return "OTHER";
  if (n === 92) return "CREDIT_CAP";
  if (n === 94) return "PREMIUM_CAP";
  if (n === 205) return "MIN_PREMIUM";
  if (n === 406) return "DEDUCTIBLE";
  if (n >= 1 && n <= 2) return "BASE_LOSS_COST";
  if (n >= 300 && n <= 399) return "SCHEDULED_PROPERTY";
  if (n >= 400 && n <= 499) return "PROTECTIVE_DEVICE";
  if (n >= 500 && n <= 699) return "ENDORSEMENT_SCHEDULE";
  if (n >= 3 && n <= 204) return "FACTOR_TABLE";
  return "OTHER";
}
function normalizeConcept(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
var FILING_CONCEPTS = [
  // Base-loss-cost chain.
  { key: "baseLossCost", label: "Base Loss Cost", stage: "BASE_LOSS_COST", op: "ADD", isCredit: false, aliases: ["iso base loss cost", "base loss cost", "loss cost"] },
  { key: "lossCostMult", label: "Loss Cost Multiplier", stage: "BASE_LOSS_COST", op: "MUL", isCredit: false, aliases: ["loss cost multiplier", "lcm", "iso premium adjustment factor"] },
  { key: "lossCostMod", label: "Loss Cost Modification Factor", stage: "BASE_LOSS_COST", op: "MUL", isCredit: false, aliases: ["loss cost modification factor", "loss cost modification factors", "lcmf"] },
  { key: "protConstr", label: "Protection-Construction Factors", stage: "BASE_PREMIUM", op: "MUL", isCredit: false, aliases: ["protection construction factors", "protection construction", "protection class construction"] },
  { key: "keyFactor", label: "Key Factor", stage: "BASE_PREMIUM", op: "MUL", isCredit: false, aliases: ["key factor", "key premium"] },
  // Adjusted-base factor chain — surcharges + characteristics (debits/neutral).
  { key: "multiFamily", label: "Multi-Family Structure Surcharge", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["multi family structure surcharge", "multi family structure"] },
  { key: "tier", label: "Tier", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["tier", "tier rating factors", "tier factor"] },
  { key: "allPerilDed", label: "All Perils Deductible", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["all perils deductible", "all peril deductible", "deductibles", "deductible"] },
  { key: "hurricaneDed", label: "Hurricane Deductible", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["hurricane deductible"] },
  { key: "lossSettlement", label: "Loss Settlement Option - Personal Property", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["loss settlement option personal property", "loss settlement options personal property", "loss settlement options"] },
  { key: "roofType", label: "Type of Roof", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["type of roof", "roof type"] },
  { key: "roofAge", label: "Roof Age", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["roof age"] },
  { key: "squareFootage", label: "Square Footage", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["square footage"] },
  { key: "stories", label: "Number of Stories", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["number of stories"] },
  { key: "bathrooms", label: "Number of Bathrooms", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["number of bathrooms"] },
  { key: "residenceType", label: "Type of Residence", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["type of residence", "residence type"] },
  { key: "coverageAPerSqFt", label: "Coverage A Per Square Foot", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["coverage a per square foot"] },
  { key: "swimmingPool", label: "Swimming Pool Surcharge", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["swimming pool surcharge"] },
  { key: "highRiskDog", label: "High Risk Dog Surcharge", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["high risk dog surcharge"] },
  { key: "oneFamily", label: "One-Family Dwelling Surcharge", stage: "ADJUSTED_BASE", op: "MUL", isCredit: false, aliases: ["one family dwelling surcharge"] },
  { key: "bceg", label: "Building Code Effectiveness Grading Windstorm", stage: "ADJUSTED_BASE", op: "ADD", isCredit: false, aliases: ["building code effectiveness grading windstorm", "building code effectiveness grading"] },
  // Credits — subject to the maximum-credit rule (Rule 92 in the reference filing).
  { key: "ageOfDwelling", label: "Age of Dwelling Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["age of dwelling credit", "age of dwelling", "age of dwelling factors"] },
  { key: "renovation", label: "Renovation Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["renovation credit", "renovation credits"] },
  { key: "loyalty", label: "Loyalty Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["loyalty credit", "loyalty credits"] },
  { key: "newHome", label: "New Home Purchase Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["new home purchase credit"] },
  { key: "bundle", label: "Bundle Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["bundle credit"] },
  { key: "gatedCommunity", label: "Gated Community Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["gated community credit"] },
  { key: "managementCo", label: "Management Company Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["management company credit"] },
  { key: "fireProtection", label: "Fire Protection Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["fire protection credit", "protective devices"] },
  { key: "theftProtection", label: "Theft Protection Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["theft protection credit"] },
  { key: "waterAlert", label: "Water Alert Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["water alert credit"] },
  { key: "windProtective", label: "Wind Protective Device Credit", stage: "ADJUSTED_BASE", op: "MUL", isCredit: true, aliases: ["wind protective device credit", "wind protective device credits"] },
  // Additional-coverage flat premiums (summed into Total).
  { key: "waterBackup", label: "Water Back-up and Sump Discharge or Overflow Coverage", stage: "ADDITIONAL_COVERAGE", op: "ADD", isCredit: false, aliases: ["water back up and sump discharge or overflow coverage", "water back up and sump discharge", "limited water back up and sump discharge or overflow coverage"] },
  { key: "equipmentBreakdown", label: "Equipment Breakdown Coverage", stage: "ADDITIONAL_COVERAGE", op: "ADD", isCredit: false, aliases: ["equipment breakdown coverage"] },
  { key: "sppBicycle", label: "Scheduled Personal Property - Bicycle", stage: "ADDITIONAL_COVERAGE", op: "ADD", isCredit: false, aliases: ["scheduled personal property bicycle", "bicycles"] },
  { key: "sppJewelry", label: "Scheduled Personal Property - Jewelry", stage: "ADDITIONAL_COVERAGE", op: "ADD", isCredit: false, aliases: ["scheduled personal property jewelry", "jewelry"] }
];
var BY_KEY = new Map(FILING_CONCEPTS.map((c) => [c.key, c]));
var ALIAS_INDEX = FILING_CONCEPTS.flatMap((entry) => entry.aliases.map((a) => ({ norm: normalizeConcept(a), entry }))).sort((a, b) => b.norm.length - a.norm.length);
function matchConcept(name) {
  const norm = normalizeConcept(name);
  if (!norm) return null;
  for (const { norm: a, entry } of ALIAS_INDEX) if (a === norm) return entry;
  for (const { norm: a, entry } of ALIAS_INDEX) if (norm.includes(a) || a.includes(norm)) return entry;
  return null;
}

// shared/src/insurance/filing/sanitize.ts
var str = (v) => String(v ?? "").trim();
var num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
var conf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};
var strArr = (v) => Array.isArray(v) ? v.map(str).filter(Boolean) : [];
var asArray = (v) => Array.isArray(v) ? v.filter((x) => !!x && typeof x === "object") : [];
var ROLES = /* @__PURE__ */ new Set(["rateOrder", "manual", "policyForm", "other"]);
var STAGES = /* @__PURE__ */ new Set(["BASE_LOSS_COST", "BASE_PREMIUM", "ADJUSTED_BASE", "INCREASED_LIMIT", "ADDITIONAL_COVERAGE"]);
var KINDS = /* @__PURE__ */ new Set(["BASE_LOSS_COST", "FACTOR_TABLE", "SCALAR", "DEDUCTIBLE", "CREDIT_CAP", "MIN_PREMIUM", "PREMIUM_CAP", "SCHEDULED_PROPERTY", "PROTECTIVE_DEVICE", "ENDORSEMENT_SCHEDULE", "ELIGIBILITY", "OTHER"]);
var LAYOUTS = /* @__PURE__ */ new Set(["triples", "matrix", "pairs"]);
function coerceOp(v) {
  const s = str(v).toUpperCase();
  if (/FACTOR|MUL|MULT|×|\bX\b/.test(s)) return "MUL";
  if (/PREMIUM|ADD|\+/.test(s)) return "ADD";
  return "MUL";
}
function coerceStage(v) {
  const s = str(v).toUpperCase().replace(/[^A-Z]/g, "_");
  return STAGES.has(s) ? s : "ADJUSTED_BASE";
}
function sanitizeClassification(name, input) {
  const roleRaw = str(input?.role);
  return {
    name,
    role: ROLES.has(roleRaw) ? roleRaw : "other",
    cue: str(input?.cue) || "No structural cue reported.",
    confidence: conf(input?.confidence)
  };
}
function sanitizeRateOrder(input) {
  const variables = [];
  let dropped = 0;
  for (const v of asArray(input?.variables)) {
    const name = str(v.name);
    const citation = str(v.citation);
    if (!name || !citation) {
      dropped++;
      continue;
    }
    variables.push({
      name,
      op: coerceOp(v.op),
      stage: coerceStage(v.stage),
      forms: strArr(v.forms).map((f) => f.toUpperCase()),
      citation,
      confidence: conf(v.confidence)
    });
  }
  const note = dropped > 0 ? `${dropped} uncited rate-order variable${dropped === 1 ? "" : "s"} dropped.` : str(input?.note) || void 0;
  return {
    variables,
    maxCreditRuleRef: str(input?.maxCreditRuleRef) || void 0,
    minPremiumRuleRef: str(input?.minPremiumRuleRef) || void 0,
    ...note ? { note } : {}
  };
}
function sanitizeTable(v) {
  if (!v || typeof v !== "object") return void 0;
  const t = v;
  const layout = str(t.layout);
  const rowRegion = str(t.rowRegion);
  const keyColumns = strArr(t.keyColumns);
  const valueColumn = str(t.valueColumn);
  if (!LAYOUTS.has(layout) || !valueColumn || keyColumns.length === 0 || rowRegion.length < 3) return void 0;
  const columnKeys = strArr(t.columnKeys);
  const lookupKeys = strArr(t.lookupKeys).filter((k) => keyColumns.includes(k));
  return {
    layout,
    keyColumns,
    valueColumn,
    rowRegion,
    ...columnKeys.length ? { columnKeys } : {},
    ...lookupKeys.length ? { lookupKeys } : {}
  };
}
function sanitizeManual(input) {
  const rules = [];
  let dropped = 0;
  for (const r of asArray(input?.rules)) {
    const title = str(r.title);
    const citation = str(r.citation);
    if (!title || !citation) {
      dropped++;
      continue;
    }
    const ruleNumber = str(r.ruleNumber);
    const kindRaw = str(r.kind);
    const kind = KINDS.has(kindRaw) ? kindRaw : classifyRuleNumber(ruleNumber);
    const concept = str(r.concept) || matchConcept(title)?.key || "";
    const table = sanitizeTable(r.table);
    const scalarsRaw = asArray(r.scalars).map((s) => ({ label: str(s.label), value: num(s.value), form: str(s.form) || void 0 })).filter((s) => Number.isFinite(s.value));
    const draftCond = str(r.ruleDraft?.condition);
    const draftOut = str(r.ruleDraft?.outcome);
    rules.push({
      ruleNumber,
      title,
      kind,
      concept,
      citation,
      confidence: conf(r.confidence),
      ...table ? { table } : {},
      ...scalarsRaw.length ? { scalars: scalarsRaw } : {},
      ...draftCond && draftOut ? { ruleDraft: { condition: draftCond, outcome: draftOut } } : {}
    });
  }
  const note = dropped > 0 ? `${dropped} uncited manual rule${dropped === 1 ? "" : "s"} dropped.` : str(input?.note) || void 0;
  return { rules, ...note ? { note } : {} };
}

// shared/src/insurance/filing/tableParser.ts
function parseNumericToken(tok) {
  const s = tok.replace(/[$,%\s]/g, "");
  if (s === "" || s === "-" || s === "\u2013" || s === "\u2014") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function isNumericToken(tok) {
  return parseNumericToken(tok) !== null;
}
function lines(region) {
  return region.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
function tokens(line) {
  return line.split(/\s{2,}|\t+/).map((t) => t.trim()).filter(Boolean).flatMap((t) => t.split(/\s+/));
}
function cells(line) {
  return line.split(/\s{2,}|\t+/).map((t) => t.trim()).filter(Boolean);
}
function parseFactorTable(schema) {
  switch (schema.layout) {
    case "pairs":
      return parsePairs(schema);
    case "triples":
      return parseTriples(schema);
    case "matrix":
      return parseMatrix(schema);
  }
}
function parsePairs(schema) {
  const keyCol = schema.keyColumns[0] ?? "key";
  const rows = [];
  let skipped = 0;
  for (const line of lines(schema.rowRegion)) {
    const toks = tokens(line);
    let vi = -1;
    for (let i = toks.length - 1; i >= 0; i--) if (isNumericToken(toks[i])) {
      vi = i;
      break;
    }
    if (vi <= 0) {
      skipped++;
      continue;
    }
    const label = toks.slice(0, vi).join(" ").trim();
    const value = parseNumericToken(toks[vi]);
    if (!label || value === null) {
      skipped++;
      continue;
    }
    rows.push({ [keyCol]: label, [schema.valueColumn]: value });
  }
  return { columns: [keyCol, schema.valueColumn], rows, skipped };
}
function parseTriples(schema) {
  const keyCols = schema.keyColumns.length ? schema.keyColumns : ["key"];
  const arity = keyCols.length + 1;
  const rows = [];
  let skipped = 0;
  for (const line of lines(schema.rowRegion)) {
    const toks = tokens(line).filter(isNumericToken);
    if (toks.length < arity) {
      skipped++;
      continue;
    }
    let consumed = 0;
    for (let i = 0; i + arity <= toks.length; i += arity) {
      const rec = {};
      for (let k = 0; k < keyCols.length; k++) rec[keyCols[k]] = toks[i + k];
      const value = parseNumericToken(toks[i + keyCols.length]);
      if (value === null) continue;
      rec[schema.valueColumn] = value;
      rows.push(rec);
      consumed++;
    }
    if (consumed === 0) skipped++;
  }
  return { columns: [...keyCols, schema.valueColumn], rows, skipped };
}
function parseMatrix(schema) {
  const rowDim = schema.keyColumns[0] ?? "row";
  const colDim = schema.keyColumns[1] ?? "col";
  const colKeys = schema.columnKeys ?? [];
  const nCols = colKeys.length;
  const rows = [];
  let skipped = 0;
  for (const line of lines(schema.rowRegion)) {
    const cs = cells(line);
    const vals = [];
    let i = cs.length - 1;
    while (i >= 0 && vals.length < nCols) {
      const c = cs[i];
      if (/\s/.test(c)) break;
      const n = parseNumericToken(c);
      if (n === null) break;
      vals.unshift(n);
      i--;
    }
    const label = cs.slice(0, i + 1).join(" ").trim();
    if (!label || vals.length !== nCols || nCols === 0) {
      skipped++;
      continue;
    }
    colKeys.forEach((key, k) => rows.push({ [rowDim]: label, [colDim]: key, [schema.valueColumn]: vals[k] }));
  }
  return { columns: [rowDim, colDim, schema.valueColumn], rows, skipped };
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
var DEFAULT_LOB = PH_LOB;
function lobByPrefix(refId) {
  if (!refId) return void 0;
  const prefix = refId.split(".")[0];
  return Object.values(LOB_REGISTRY).find((l) => l.prefix === prefix);
}
function resolveLobByRefId(refId) {
  return lobByPrefix(refId);
}

// shared/src/insurance/filing/reconcile.ts
var dashId = (refId) => refId.replace(/\./g, "-");
var gov = {
  status: "ACTIVE",
  lifecycle: "DRAFT",
  reviewStatus: "NOT_STARTED",
  reviewer: ""
};
function tokenOf(baseFormNumber, state) {
  return `${baseFormNumber}${state}`.toUpperCase().replace(/[^A-Z0-9]/g, "") || "FILING";
}
function toGridTable(name, parsed, valueColumn, lookupKeys) {
  const allKeys = parsed.columns.filter((c) => c !== valueColumn);
  const dimKeys = lookupKeys && lookupKeys.length ? allKeys.filter((k) => lookupKeys.includes(k)) : allKeys;
  const dimensions = dimKeys.map((key) => {
    const values = [];
    for (const r of parsed.rows) {
      const d = String(r[key] ?? "");
      if (d !== "" && !values.includes(d)) values.push(d);
    }
    return { key, label: key, values };
  });
  return { name, columns: parsed.columns, rows: parsed.rows, dimensions, valueColumn };
}
function reconcileFiling(ex, opts = {}) {
  const targetForm = opts.targetForm ?? "HO3";
  const state = (ex.filingState || "NJ").toUpperCase();
  const token = opts.productToken ?? tokenOf(ex.baseFormNumber, state);
  const productRefId = `FIL.${token}.PROD`;
  const productId = productRefId;
  const hintedLob = opts.lobRefIdHint ? LOB_REGISTRY[opts.lobRefIdHint] ?? resolveLobByRefId(opts.lobRefIdHint) : void 0;
  const lobDef = hintedLob ?? DEFAULT_LOB;
  const lobDefaulted = !hintedLob;
  const prefix = lobDef.refIdPrefix || lobDef.code || "PH";
  const unresolved = [];
  const ratingItems = [];
  const tableItems = [];
  const rtTables = [];
  const ldTables = [];
  const manualByConcept = /* @__PURE__ */ new Map();
  for (const r of ex.manual.rules) if (r.concept && !manualByConcept.has(r.concept)) manualByConcept.set(r.concept, r);
  const creditCapRule = ex.manual.rules.find((r) => r.kind === "CREDIT_CAP");
  const minPremRule = ex.manual.rules.find((r) => r.kind === "MIN_PREMIUM");
  const builtTables = /* @__PURE__ */ new Map();
  function ensureTable(rule) {
    if (builtTables.has(rule.concept)) return builtTables.get(rule.concept);
    if (!rule.table) return null;
    const parsed = parseFactorTable(rule.table);
    if (parsed.rows.length === 0) return null;
    const refId = `FIL.${token}.RT.${rule.concept}`;
    const grid = toGridTable(`${rule.title}`, parsed, rule.table.valueColumn, rule.table.lookupKeys);
    rtTables.push({ docId: dashId(refId), refId, label: `${refId} \u2014 ${rule.title}`, data: { ...grid } });
    tableItems.push({ section: "tables", label: `${rule.title} (${parsed.rows.length} rows${parsed.skipped ? `, ${parsed.skipped} skipped` : ""})`, refId, docId: dashId(refId), confidence: rule.confidence, citation: rule.citation, detail: `${rule.table.layout} \xB7 value=${rule.table.valueColumn}` });
    const built = { refId, valueColumn: rule.table.valueColumn, dimKeys: grid.dimensions.map((d) => d.key), parsed };
    builtTables.set(rule.concept, built);
    return built;
  }
  const steps = [];
  let order = 0;
  const vars = ex.rateOrder.variables.filter((v) => v.forms.map((f) => f.toUpperCase()).includes(targetForm.toUpperCase()));
  const varsFiltered = ex.rateOrder.variables.length - vars.length;
  const targetFormWarning = varsFiltered > 0 ? [`${varsFiltered} rate-order variable(s) matched no "${targetForm}" form column and were NOT imported \u2014 the rate order likely belongs to a different form (base form ${ex.baseFormNumber}); the rating program is incomplete until the target form is set correctly.`] : [];
  for (const v of vars) {
    const concept = matchConcept(v.name);
    const rule = concept ? manualByConcept.get(concept.key) : void 0;
    if (concept?.key === "baseLossCost") {
      const blcRule = rule && rule.table ? rule : ex.manual.rules.find((r) => r.kind === "BASE_LOSS_COST" && r.table);
      const built = blcRule ? ensureTable(blcRule) : null;
      if (built) {
        order++;
        steps.push({ id: `s${order}`, order, label: v.name, op: "SET", source: { type: "RT", ref: built.refId, keys: built.dimKeys } });
        ratingItems.push(stepReview(v, `SET ${built.refId}[${built.dimKeys.join(",")}]`));
      } else {
        unresolved.push(unres(v, "No base-loss-cost table could be parsed from the manual."));
      }
      continue;
    }
    if (v.op === "MUL") {
      const built = rule && rule.table ? ensureTable(rule) : null;
      if (built) {
        order++;
        steps.push({ id: `s${order}`, order, label: v.name, op: "MUL", source: { type: "RT", ref: built.refId, keys: built.dimKeys }, ...concept?.isCredit ? { isCredit: true } : {} });
        ratingItems.push(stepReview(v, `MUL ${built.refId}[${built.dimKeys.join(",")}]${concept?.isCredit ? " \xB7 credit" : ""}`));
      } else if (rule && rule.scalars && rule.scalars.length === 1 && Number.isFinite(rule.scalars[0].value)) {
        order++;
        steps.push({ id: `s${order}`, order, label: v.name, op: "MUL", source: { type: "CONST", value: rule.scalars[0].value }, ...concept?.isCredit ? { isCredit: true } : {} });
        ratingItems.push(stepReview(v, `MUL CONST(${rule.scalars[0].value})${concept?.isCredit ? " \xB7 credit" : ""}`));
      } else {
        unresolved.push(unres(v, rule ? "Manual rule found but no parseable factor table or single scalar factor." : "No manual factor table or scalar resolves this multiplicative variable."));
      }
      continue;
    }
    if (rule && rule.scalars && rule.scalars.length === 1 && Number.isFinite(rule.scalars[0].value)) {
      order++;
      steps.push({ id: `s${order}`, order, label: v.name, op: "ADD", source: { type: "CONST", value: rule.scalars[0].value } });
      ratingItems.push(stepReview(v, `ADD CONST(${rule.scalars[0].value})`));
    } else {
      unresolved.push(unres(v, rule ? "Additive variable has no single flat premium in the manual (a per-item/scheduled rate needs its own worksheet)." : "No manual rate schedule or flat premium resolves this additive variable."));
    }
  }
  let minimumPremium = 0;
  if (minPremRule) {
    const scalar = pickFormScalar(minPremRule, targetForm);
    if (scalar != null) {
      minimumPremium = scalar;
      order++;
      steps.push({ id: `s${order}`, order, label: `Minimum premium (Rule ${minPremRule.ruleNumber})`, op: "MIN_FLOOR", source: { type: "CONST", value: scalar }, roundTo: 0 });
      ratingItems.push({ section: "rating", label: `Minimum premium \u2192 MIN_FLOOR $${scalar}`, confidence: minPremRule.confidence, citation: minPremRule.citation, detail: `MIN_FLOOR CONST(${scalar})` });
    } else {
      unresolved.push({ stage: "manual", kind: "min-premium", name: minPremRule.title, reason: `No minimum-premium floor stated for form ${targetForm}.`, citation: minPremRule.citation });
    }
  }
  let creditFloor;
  if (creditCapRule) {
    const pct = pickFormScalar(creditCapRule, targetForm);
    if (pct != null && pct > 0 && pct < 100) {
      creditFloor = 1 - pct / 100;
      ratingItems.push({ section: "rating", label: `Maximum credit ${pct}% \u2192 creditFloor ${creditFloor.toFixed(2)}`, confidence: creditCapRule.confidence, citation: creditCapRule.citation, detail: `creditFloor=${creditFloor}` });
    } else {
      unresolved.push({ stage: "manual", kind: "credit-cap", name: creditCapRule.title, reason: `No maximum-credit percentage stated for form ${targetForm}.`, citation: creditCapRule.citation });
    }
  }
  const ratingProgramRefId = `FIL.${token}.RAT.1`;
  const ratingProgram = steps.length > 0 ? {
    docId: dashId(ratingProgramRefId),
    refId: ratingProgramRefId,
    label: `${ratingProgramRefId} \u2014 rating program`,
    data: {
      refId: ratingProgramRefId,
      name: `${ex.productName || "Imported"} Rating Program`,
      minimumPremium,
      steps,
      ...creditFloor !== void 0 ? { creditFloor } : {},
      allStates: false,
      states: [state],
      ...gov
    }
  } : null;
  const dedRule = ex.manual.rules.find((r) => r.kind === "DEDUCTIBLE" && r.table);
  let dedLdRefId;
  if (dedRule?.table) {
    const parsed = parseFactorTable(dedRule.table);
    const dedValues = distinctColumnValues(parsed, dedRule.table.columnKeys ? dedRule.table.keyColumns[1] ?? "deductible" : dedRule.table.valueColumn);
    const opts2 = (dedRule.table.columnKeys ?? dedValues).map(Number).filter(Number.isFinite);
    if (opts2.length) {
      dedLdRefId = `FIL.${token}.LD.deductible`;
      ldTables.push({
        docId: dashId(dedLdRefId),
        refId: dedLdRefId,
        label: `${dedLdRefId} \u2014 All-perils deductible options`,
        data: { name: "All-perils deductible options", defaultValue: opts2.includes(500) ? 500 : opts2[0], rows: opts2.map((v) => ({ label: `$${v.toLocaleString()}`, value: v })) }
      });
      tableItems.push({ section: "tables", label: `All-perils deductible options (${opts2.length})`, refId: dedLdRefId, docId: dashId(dedLdRefId), confidence: dedRule.confidence, citation: dedRule.citation, detail: "LD \xB7 deductible option set" });
    }
  }
  const coverages = [];
  const coverageItems = [];
  let covNum = 0;
  for (const c of ex.policyForm.coverages.items) {
    covNum++;
    const refId = `${prefix}.${token}.COV.${String(covNum).padStart(3, "0")}`;
    const isDwelling = /coverage a\b|dwelling/i.test(c.name);
    const terms = isDwelling && dedLdRefId ? [{ id: "ded-allperil", kind: "DEDUCTIBLE", label: "All-perils deductible", ldTableRef: dedLdRefId, default: 500, basis: "per occurrence", notes: "Section I deductible (manual Rule 406)" }] : [];
    coverages.push({
      docId: dashId(refId),
      refId,
      label: `${refId} \u2014 ${c.name}`,
      data: {
        refId,
        name: c.name,
        parentId: null,
        order: covNum,
        requirement: c.requirement,
        claimsBasis: "",
        premiumGenerating: c.premiumGenerating,
        source: c.formNumbers.length ? "BUREAU" : "PROPRIETARY",
        formNumbers: c.formNumbers,
        terms,
        allStates: false,
        states: [state],
        ...gov
      }
    });
    coverageItems.push({ section: "coverages", label: c.name, refId, docId: dashId(refId), confidence: c.confidence, citation: c.citation });
  }
  const forms = ex.policyForm.forms.items.map((f) => ({
    docId: f.edition ? `${f.number.replace(/\s+/g, "-")}__${f.edition.replace(/\s+/g, "-")}` : f.number.replace(/\s+/g, "-"),
    refId: null,
    label: `${f.number} \u2014 ${f.name}`,
    data: {
      number: f.number,
      name: f.name,
      edition: f.edition,
      category: f.category,
      claimsBasis: "",
      dynamic: false,
      mandatoryDefault: f.mandatoryDefault,
      attachmentCondition: f.attachmentCondition,
      source: f.number.includes(" ") ? "BUREAU" : "PROPRIETARY",
      admitted: true,
      displayOnSchedule: true,
      multiUse: false,
      transactions: [],
      coverageParts: [],
      productRefIds: [productId],
      description: "",
      dynamicFields: [],
      allStates: false,
      states: [state],
      ...gov
    }
  }));
  const rules = [];
  const ruleItems = [];
  let ruNum = 0;
  const pushRule = (category, subCategory, condition, outcome, formNumbers, citation, confidence) => {
    ruNum++;
    const refId = `${prefix}.${token}.RU.${String(ruNum).padStart(3, "0")}`;
    rules.push({
      docId: dashId(refId),
      refId,
      label: `${refId} \u2014 ${subCategory}`,
      data: { refId, category, subCategory, condition, outcome, coverageRefIds: [], formNumbers, allStates: false, states: [state], ...gov }
    });
    ruleItems.push({ section: "rules", label: `${condition} \u2192 ${outcome}`, refId, docId: dashId(refId), confidence, citation });
  };
  for (const r of ex.policyForm.rules.items) pushRule(r.category, r.subCategory, r.condition, r.outcome, r.formNumbers, r.citation, r.confidence);
  for (const r of ex.manual.rules) if (r.ruleDraft) pushRule("PRODUCT", `Rule ${r.ruleNumber}`, r.ruleDraft.condition, r.ruleDraft.outcome, [], r.citation, r.confidence);
  const product = {
    docId: productId,
    refId: productRefId,
    label: `${productRefId} \u2014 ${ex.productName}`,
    data: {
      refId: productRefId,
      name: ex.productName || `${ex.baseFormNumber} (${state})`,
      lob: { refId: lobDef.refId, name: lobDef.name },
      description: `Imported from a ${state} rate filing (${ex.baseFormNumber} ${ex.baseFormEdition}).`,
      marketSegment: `${lobDef.vertical} / ${lobDef.family}`,
      owner: { uid: "", name: "" },
      // stamped by the writer
      baseForm: { path: "", url: "", name: `${ex.baseFormNumber} ${ex.baseFormEdition}`, uploadedAt: null, uploadedBy: "", formNumber: ex.baseFormNumber, edition: ex.baseFormEdition, lob: lobDef.name },
      allStates: false,
      states: [state],
      ...gov
    }
  };
  const summary = {
    productName: product.data["name"],
    productRefId,
    lobName: lobDef.name,
    counts: {
      products: 1,
      coverages: coverages.length,
      forms: forms.length,
      rules: rules.length,
      formRules: 0,
      ratingSteps: steps.length,
      rtTables: rtTables.length,
      ldTables: ldTables.length
    },
    warnings: [
      // A defaulted line is a WARNED default, never a silent one (F18).
      ...lobDefaulted ? [`LOB undetected${opts.lobRefIdHint ? ` (hint "${opts.lobRefIdHint}" matched no registry line)` : ""} \u2014 defaulted to ${DEFAULT_LOB.name} (the platform default); verify the product line.`] : [],
      ...targetFormWarning,
      ...unresolved.map((u) => `UNRESOLVED [${u.stage}/${u.kind}] ${u.name}: ${u.reason} (cited: ${u.citation})`)
    ],
    unmappedColumns: [],
    sheetsRecognized: [`rate order \xB7 ${ex.rateOrder.variables.length} variables`, `manual \xB7 ${ex.manual.rules.length} rules`, `policy form \xB7 ${ex.baseFormNumber}`],
    sheetsSkipped: [],
    defects: [],
    notices: []
  };
  const plan = {
    productId,
    product,
    products: [product],
    coverages,
    forms,
    rules,
    formRules: [],
    ratingProgram,
    ldTables,
    rtTables,
    summary
  };
  const review = {
    product: sectionOf([{ section: "product", label: product.data["name"], refId: productRefId, docId: productId, confidence: 0.9, citation: `Base form ${ex.baseFormNumber} ${ex.baseFormEdition}; ${state} filing` }]),
    coverages: sectionOf(coverageItems, ex.policyForm.coverages.note),
    tables: sectionOf(tableItems),
    rules: sectionOf(ruleItems),
    rating: sectionOf(ratingItems)
  };
  const proposed = vars.length + ex.policyForm.coverages.items.length + ex.policyForm.forms.items.length + ex.policyForm.rules.items.length + ex.manual.rules.filter((r) => r.ruleDraft).length;
  const stepsFromVars = steps.filter((s) => s.op !== "MIN_FLOOR").length;
  const counts = { proposed, accepted: stepsFromVars + coverages.length + forms.length + rules.length, unresolved: unresolved.length };
  return { plan, filingState: state, baseFormNumber: ex.baseFormNumber, baseFormEdition: ex.baseFormEdition, review, unresolved, counts };
}
function stepReview(v, detail) {
  return { section: "rating", label: v.name, confidence: v.confidence, citation: v.citation, detail };
}
function unres(v, reason) {
  return { stage: "rateOrder", kind: v.op === "MUL" ? "multiplicative-step" : "additive-step", name: v.name, reason, citation: v.citation };
}
function sectionOf(items, note) {
  return note ? { items, note } : { items };
}
function formCode(s) {
  const m = s.match(/\d+/g);
  return m ? parseInt(m[m.length - 1], 10) : null;
}
function pickFormScalar(rule, form) {
  const scalars = rule.scalars ?? [];
  const target = formCode(form);
  if (target !== null) {
    const byForm = scalars.find((s) => s.form && formCode(s.form) === target);
    if (byForm) return byForm.value;
  }
  const formless = scalars.find((s) => !s.form);
  if (formless) return formless.value;
  return scalars.length === 1 ? scalars[0].value : null;
}
function distinctColumnValues(parsed, col) {
  const out = [];
  for (const r of parsed.rows) {
    const d = String(r[col] ?? "");
    if (d !== "" && !out.includes(d)) out.push(d);
  }
  return out;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  reconcileFiling,
  sanitizeClassification,
  sanitizeManual,
  sanitizeRateOrder
});
