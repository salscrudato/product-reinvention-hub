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

// shared/src/duckcreek/api-server.ts
var api_server_exports = {};
__export(api_server_exports, {
  DEFAULT_DUCKCREEK_MAPPING: () => DEFAULT_DUCKCREEK_MAPPING,
  LOB_REGISTRY: () => LOB_REGISTRY,
  buildPdm: () => buildPdm,
  composeManuscriptId: () => composeManuscriptId,
  composeManuscriptVersionId: () => composeManuscriptVersionId,
  composeTableManuscriptIdForScope: () => composeTableManuscriptIdForScope,
  serializePdmToDuckCreek: () => serializePdmToDuckCreek,
  summarizeReport: () => summarizeReport,
  validateDuckCreek: () => validateDuckCreek
});
module.exports = __toCommonJS(api_server_exports);

// shared/src/insurance/terms.ts
function isPercentTerm(t) {
  return t.unit === "%" || t.unit === "percent" || (t.basis?.toLowerCase().includes("percent") ?? false);
}
function deriveOptionType(t) {
  if (isPercentTerm(t)) return "PERCENT";
  return "FLAT";
}
function deriveStructure(t) {
  if (t.structure) return t.structure;
  if (t.kind === "DEDUCTIBLE") return isPercentTerm(t) ? "PERCENT" : "FLAT";
  return "SINGLE";
}
function deriveBasis(t) {
  if (t.limitBasis) return t.limitBasis;
  const b = t.basis?.toLowerCase() ?? "";
  if (b.includes("person")) return "PER_PERSON";
  if (b.includes("aggregate")) return "AGGREGATE";
  if (b.includes("item")) return "PER_ITEM";
  if (b.includes("claim")) return "PER_CLAIM";
  if (b.includes("location")) return "PER_LOCATION";
  return "PER_OCCURRENCE";
}
var compactMoney = (n) => n >= 1e6 ? `$${(n / 1e6).toLocaleString(void 0, { maximumFractionDigits: 2 })}M` : n >= 1e3 ? `$${(n / 1e3).toLocaleString(void 0, { maximumFractionDigits: 1 })}k` : `$${n.toLocaleString()}`;
function formatOption(o, compact = false) {
  if (o.label) return o.label;
  switch (o.type) {
    case "PERCENT":
      return `${o.value}%`;
    case "WAITING_PERIOD":
      return o.value % 24 === 0 ? `${o.value / 24} days` : `${o.value} hours`;
    case "SPLIT":
      return (o.parts ?? []).map((p) => compact ? compactMoney(p) : `$${p.toLocaleString()}`).join(" / ");
    default:
      return compact ? compactMoney(o.value) : `$${o.value.toLocaleString()}`;
  }
}
function resolveTermOptions(t, ldTable) {
  if (t.optionSet?.length) return t.optionSet;
  const type = deriveOptionType(t);
  const fromLegacy = t.options?.filter((o) => typeof o === "number") ?? [];
  const fromTable = ldTable?.rows.map((r) => r.value) ?? [];
  const numbers = [.../* @__PURE__ */ new Set([...fromLegacy, ...fromTable])].sort((a, b) => a - b);
  const defNum = typeof t.default === "number" ? t.default : void 0;
  const values = numbers.length ? numbers : defNum !== void 0 ? [defNum] : [];
  const opts = values.map((v) => {
    const row = ldTable?.rows.find((r) => r.value === v);
    return {
      id: `opt-${v}`,
      type,
      value: v,
      allStates: true,
      states: [],
      isDefault: defNum !== void 0 ? v === defNum : false,
      enabled: true,
      // Surface LD-table metadata so editors can display constraint notes + labels.
      ...row?.constraintNote ? { constraintNote: row.constraintNote } : {},
      ...row?.label ? { label: row.label } : {}
    };
  });
  return ensureOneDefault(opts);
}
function ensureOneDefault(opts) {
  if (!opts.length) return opts;
  const enabled = opts.filter((o) => o.enabled);
  const pool = enabled.length ? enabled : opts;
  const chosen = pool.find((o) => o.isDefault) ?? pool[0];
  return opts.map((o) => ({ ...o, isDefault: o.id === chosen.id }));
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
function inferValueColumn(t) {
  if (t.valueColumn && t.columns.includes(t.valueColumn)) return t.valueColumn;
  const matches = t.columns.filter((c) => VALUE_COLUMN_NAMES.includes(c.toLowerCase()));
  return matches.length === 1 ? matches[0] : null;
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
    if (typeof v === "number") cells[joinKey(coords)] = v;
  }
  return { valueColumn, dimensions, cells };
}

// shared/src/pdm/build.ts
function toApplicability(scope, effectiveDate) {
  return {
    allStates: scope.allStates,
    states: [...scope.states],
    ...effectiveDate ? { effectiveDate } : {}
  };
}
function pascalKey(name) {
  const head = name.split(/\s[—–-]\s/)[0] ?? name;
  const words = head.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const key = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return key || "Term";
}
function resolveSection(lob, coverageName) {
  const idx = lob.sections.findIndex((s) => s.match(coverageName));
  const section = idx >= 0 ? lob.sections[idx] : lob.sections[lob.sections.length - 1];
  return section?.label ?? "";
}
function toEligibleValue(o) {
  const valueType = o.type;
  return {
    id: o.id,
    label: formatOption(o),
    value: o.type === "SPLIT" ? null : o.value,
    ...o.type === "SPLIT" && o.parts ? { parts: [...o.parts] } : {},
    valueType,
    isDefault: o.isDefault,
    enabled: o.enabled,
    applicability: { allStates: o.allStates, states: [...o.states] },
    ...o.constraintNote ? { constraintNote: o.constraintNote } : {}
  };
}
function buildTerm(coverageRefId, term, ldTables) {
  const ld = term.ldTableRef ? ldTables[term.ldTableRef] : void 0;
  const options = resolveTermOptions(term, ld);
  return {
    refId: `${coverageRefId}#${term.id}`,
    key: term.id,
    termKey: pascalKey(term.label),
    kind: term.kind,
    label: term.label,
    structure: deriveStructure(term),
    basis: deriveBasis(term),
    ...term.unit ? { unit: term.unit } : {},
    ...term.min !== void 0 ? { min: term.min } : {},
    ...term.max !== void 0 ? { max: term.max } : {},
    defaultValue: term.default,
    ...term.ldTableRef ? { ldTableRef: term.ldTableRef } : {},
    eligibleValues: options.map(toEligibleValue),
    ...term.notes ? { notes: term.notes } : {},
    ...term.constraintNote ? { constraintNote: term.constraintNote } : {}
  };
}
function buildCoverageNode(cov, lob, ldTables, effectiveDate) {
  const refId = cov.refId ?? "";
  return {
    refId,
    name: cov.name,
    termKey: pascalKey(cov.name),
    parentRefId: cov.parentId,
    order: cov.order,
    requirement: cov.requirement,
    claimsBasis: cov.claimsBasis,
    premiumGenerating: cov.premiumGenerating,
    source: cov.source,
    formNumbers: [...cov.formNumbers],
    section: resolveSection(lob, cov.name),
    applicability: toApplicability(cov, effectiveDate),
    terms: cov.terms.map((t) => buildTerm(refId, t, ldTables)),
    children: []
  };
}
function buildCoverageTree(coverages, lob, ldTables, effectiveDate) {
  const nodes = coverages.map((c) => buildCoverageNode(c, lob, ldTables, effectiveDate));
  const byRef = new Map(nodes.map((n) => [n.refId, n]));
  const roots = [];
  for (const n of nodes) {
    const parent = n.parentRefId ? byRef.get(n.parentRefId) : void 0;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sortByOrder = (list) => {
    list.sort((a, b) => a.order - b.order);
    for (const c of list) sortByOrder(c.children);
  };
  sortByOrder(roots);
  return roots;
}
function buildForm(form, effectiveDate) {
  const applicability = toApplicability(form, effectiveDate);
  return {
    refId: form.number,
    formNumber: form.number,
    name: form.name,
    edition: form.edition,
    editions: [{ edition: form.edition, applicability }],
    category: form.category,
    source: form.source,
    admitted: form.admitted,
    mandatoryDefault: form.mandatoryDefault,
    attachmentCondition: form.attachmentCondition,
    dynamic: form.dynamic,
    coverageParts: [...form.coverageParts],
    applicability,
    description: form.description,
    dynamicFields: form.dynamicFields.map((d) => ({
      name: d.name,
      dataType: d.dataType,
      repeating: d.repeating,
      ...d.options ? { options: [...d.options] } : {},
      ...d.notes ? { notes: d.notes } : {}
    }))
  };
}
function ruleTypeOf(rule) {
  if (rule.category === "RATING") return "RATING";
  if (rule.category === "FORMS") return "FORM_ATTACH";
  return /eligib/i.test(rule.subCategory) ? "ELIGIBILITY" : "COVERAGE";
}
function buildRule(rule, effectiveDate) {
  return {
    refId: rule.refId ?? "",
    ruleType: ruleTypeOf(rule),
    category: rule.category,
    ...rule.subCategory ? { subCategory: rule.subCategory } : {},
    condition: rule.condition,
    actions: [rule.outcome],
    coverageRefIds: [...rule.coverageRefIds],
    formNumbers: [...rule.formNumbers],
    ...rule.ldTableRef ? { ldTableRef: rule.ldTableRef } : {},
    applicability: toApplicability(rule, effectiveDate)
  };
}
function buildFormRule(fr, effectiveDate) {
  return {
    refId: fr.refId ?? "",
    ruleType: "FORM_ATTACH",
    category: "FORMS",
    condition: fr.condition,
    actions: [fr.outcome],
    coverageRefIds: [],
    formNumbers: [...fr.formNumbers],
    mandatory: fr.mandatory,
    applicability: toApplicability({ allStates: true, states: [] }, effectiveDate)
  };
}
function buildStep(programRefId, step) {
  const src = step.source;
  return {
    refId: `${programRefId}#${step.id}`,
    key: step.id,
    order: step.order,
    label: step.label,
    op: step.op,
    sourceType: src.type,
    ...src.ref !== void 0 ? { tableRef: src.ref } : {},
    ...src.keys ? { inputKeys: [...src.keys] } : {},
    ...src.value !== void 0 ? { constValue: src.value } : {},
    ...step.condition ? { condition: step.condition } : {},
    ...step.roundTo !== void 0 ? { roundTo: step.roundTo } : {}
  };
}
function buildRatingProgram(program, effectiveDate) {
  return {
    refId: program.refId,
    name: program.name,
    minimumPremium: program.minimumPremium,
    applicability: toApplicability(program, effectiveDate),
    steps: [...program.steps].sort((a, b) => a.order - b.order).map((s) => buildStep(program.refId, s))
  };
}
function buildTable(refId, table, kind, defaultValue) {
  const grid = deriveGridModel(table);
  return {
    refId,
    name: table.name,
    kind,
    columns: [...table.columns],
    valueColumn: table.valueColumn ?? inferValueColumn(table),
    dimensions: grid ? grid.dimensions.map((d) => ({ key: d.key, label: d.label, values: [...d.values] })) : [],
    rows: table.rows.map((r) => ({ ...r })),
    ...defaultValue !== void 0 ? { defaultValue } : {}
  };
}
function buildTables(rtTables, ldTables) {
  const rt = Object.keys(rtTables).sort().map((ref) => buildTable(ref, rtTables[ref], "RT"));
  const ld = Object.keys(ldTables).sort().map((ref) => {
    const t = ldTables[ref];
    const asRt = { name: t.name, columns: ["label", "value"], rows: t.rows.map((r) => ({ ...r })) };
    return buildTable(ref, asRt, "LD", t.defaultValue);
  });
  return [...rt, ...ld];
}
function buildPdm(bundle, options = {}) {
  const { product, lob } = bundle;
  const eff = options.effectiveDate;
  return {
    refId: product.refId ?? "",
    name: product.name,
    description: product.description,
    marketSegment: product.marketSegment,
    line: {
      refId: lob.refId,
      code: lob.prefix,
      name: lob.name,
      compactName: lob.name.replace(/\s+/g, ""),
      displayName: lob.displayName,
      vertical: lob.vertical,
      family: lob.family,
      lineCategory: lob.lineCategory,
      personalOrCommercial: lob.personalOrCommercial,
      perilModel: {
        kind: lob.perilModel.kind,
        eligibleStates: [...lob.perilModel.eligibleStates],
        label: lob.perilModel.label
      },
      sections: lob.sections.map((s) => ({ label: s.label, shortName: s.shortName })),
      footprintStates: [...lob.footprintStates]
    },
    applicability: toApplicability(product, eff),
    coverages: buildCoverageTree(bundle.coverages, lob, bundle.ldTables, eff),
    forms: bundle.forms.map((f) => buildForm(f, eff)),
    rules: [
      ...bundle.rules.map((r) => buildRule(r, eff)),
      ...bundle.formRules.map((fr) => buildFormRule(fr, eff))
    ],
    ratingPrograms: [buildRatingProgram(bundle.ratingProgram, eff)],
    ratingTables: buildTables(bundle.rtTables, bundle.ldTables)
  };
}

// shared/src/duckcreek/xml.ts
function el(name, attrs = [], children = []) {
  return { name, attrs, children };
}
function leaf(name, text, attrs = []) {
  return { name, attrs, children: [], text: String(text) };
}
function empty(name, attrs = []) {
  return { name, attrs, children: [] };
}
function escapeText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, "&quot;");
}
function unescape(s) {
  return s.replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : "'");
}
var DEFAULT_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>';
function writeXml(root, opts = {}) {
  const indentUnit = opts.indent ?? "  ";
  const lines = [];
  if (opts.declaration !== "") lines.push(opts.declaration ?? DEFAULT_DECLARATION);
  if (opts.comment) lines.push(`<!-- ${opts.comment} -->`);
  const attrStr = (attrs) => attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
  const write = (node, depth) => {
    const pad = indentUnit.repeat(depth);
    const open = `${node.name}${attrStr(node.attrs)}`;
    if (node.children.length === 0 && (node.text === void 0 || node.text === "")) {
      lines.push(`${pad}<${open} />`);
      return;
    }
    if (node.children.length === 0) {
      lines.push(`${pad}<${open}>${escapeText(node.text)}</${node.name}>`);
      return;
    }
    lines.push(`${pad}<${open}>`);
    for (const child of node.children) write(child, depth + 1);
    lines.push(`${pad}</${node.name}>`);
  };
  write(root, 0);
  return lines.join("\n") + "\n";
}
var Parser = class {
  s;
  i = 0;
  constructor(input) {
    this.s = input;
  }
  error(msg) {
    throw new Error(`XML parse error at ${this.i}: ${msg}`);
  }
  peek() {
    return this.s[this.i] ?? "";
  }
  startsWith(t) {
    return this.s.startsWith(t, this.i);
  }
  eof() {
    return this.i >= this.s.length;
  }
  skipWs() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  readName() {
    const start = this.i;
    while (this.i < this.s.length && !/[\s/>=]/.test(this.s[this.i])) this.i++;
    if (this.i === start) this.error("expected a name");
    return this.s.slice(start, this.i);
  }
  readAttrs() {
    const attrs = [];
    for (; ; ) {
      this.skipWs();
      const c = this.peek();
      if (c === ">" || c === "/" || c === "") break;
      const name = this.readName();
      this.skipWs();
      if (this.peek() !== "=") this.error(`expected '=' after attribute '${name}'`);
      this.i++;
      this.skipWs();
      if (this.peek() !== '"') this.error(`expected '"' opening value of '${name}'`);
      this.i++;
      const vStart = this.i;
      while (this.i < this.s.length && this.peek() !== '"') this.i++;
      if (this.eof()) this.error(`unterminated attribute value for '${name}'`);
      const value = unescape(this.s.slice(vStart, this.i));
      this.i++;
      attrs.push([name, value]);
    }
    return attrs;
  }
  parseElement() {
    if (this.peek() !== "<") this.error("expected '<'");
    this.i++;
    const name = this.readName();
    const attrs = this.readAttrs();
    this.skipWs();
    if (this.startsWith("/>")) {
      this.i += 2;
      return { name, attrs, children: [] };
    }
    if (this.peek() !== ">") this.error(`expected '>' or '/>' closing tag <${name}>`);
    this.i++;
    return this.parseContent(name, attrs);
  }
  parseContent(name, attrs) {
    const children = [];
    let text = "";
    for (; ; ) {
      if (this.eof()) this.error(`unclosed element <${name}>`);
      if (this.startsWith("</")) {
        this.i += 2;
        const close = this.readName();
        if (close !== name) this.error(`mismatched close </${close}> for <${name}>`);
        this.skipWs();
        if (this.peek() !== ">") this.error(`expected '>' closing </${name}>`);
        this.i++;
        break;
      }
      if (this.peek() === "<") {
        children.push(this.parseElement());
      } else {
        const start = this.i;
        while (this.i < this.s.length && this.peek() !== "<") this.i++;
        text += this.s.slice(start, this.i);
      }
    }
    if (children.length > 0) return { name, attrs, children };
    const trimmed = text.trim();
    return trimmed === "" ? { name, attrs, children: [] } : { name, attrs, children: [], text: unescape(trimmed) };
  }
};
function parseXml(input) {
  const stripped = input.replace(/^﻿/, "").replace(/^\s*<\?xml[\s\S]*?\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const p = new Parser(stripped);
  p.skipWs();
  const root = p.parseElement();
  p.skipWs();
  if (!p.eof()) throw new Error("XML parse error: unexpected trailing content after root element");
  return root;
}
function findAll(root, name) {
  const out = [];
  const walk = (n) => {
    if (n.name === name) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}
function attr(node, name) {
  return node.attrs.find(([k]) => k === name)?.[1];
}
function everyNode(root) {
  const out = [];
  const walk = (n) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

// shared/src/duckcreek/guid.ts
function fnv1a32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function guid128(seed) {
  let out = "";
  for (let salt = 0; salt < 4; salt++) {
    out += fnv1a32(`${salt}:${seed}`).toString(16).padStart(8, "0");
  }
  return out.toUpperCase();
}
function deriveId(prefixLetter, seed) {
  return `${prefixLetter}${guid128(seed)}`;
}

// shared/src/duckcreek/mapping.ts
var DEFAULT_DUCKCREEK_MAPPING = {
  namespace: {
    prefix: "dctSys",
    uri: "http://www.duckcreektech.com/dctSys",
    declareOnRoot: true
  },
  manuscript: {
    carrier: "PCG",
    country: "US",
    version: { major: 1, minor: 0, build: 0, rev: 0 },
    engineVersion: "2.0.0",
    cultureCode: "en-US",
    currencyCode: "USD",
    lobTokens: { PH: "HO", PA: "PA", GL: "GL" },
    layers: {
      viewModel: { market: "Admitted", layer: "ViewModel" },
      forms: { market: "Admitted", layer: "Forms" },
      rating: { market: "Admitted", layer: "Rating" },
      tables: { market: "Admitted", layer: "Tables" },
      communications: "Carrier_ProductBase_Communications_1_0_0_0"
    }
  },
  // id-prefix letters — the sample's first-letter-of-element convention.
  idPrefix: {
    manuscript: "m",
    product: "P",
    line: "l",
    risk: "r",
    coverage: "c",
    limit: "l",
    deductible: "d",
    option: "o",
    statCode: "S",
    exposure: "e",
    peril: "p",
    indicator: "I",
    form: "f",
    edition: "e",
    ratingProgram: "p",
    ratingStep: "s",
    factorTable: "t",
    tableDimension: "D",
    rule: "r",
    validValue: "v",
    dynamicField: "F",
    tableRow: "w"
  },
  elements: {
    manuscript: "manuscript",
    product: "product",
    caption: "Caption",
    description: "Description",
    marketSegment: "MarketSegment",
    type: "Type",
    line: "line",
    risk: "risk",
    exposure: "exposure",
    coverage: "coverage",
    statCode: "StatCode",
    formNumber: "FormNumber",
    limit: "limit",
    deductible: "deductible",
    validValues: "validValues",
    value: "value",
    options: "options",
    section: "Section",
    forms: "forms",
    form: "form",
    formName: "Form",
    edition: "edition",
    editions: "editions",
    coveragePart: "CoveragePart",
    fields: "dynamicFields",
    field: "field",
    fieldOption: "FieldOption",
    states: "states",
    state: "State",
    rating: "rating",
    program: "program",
    step: "step",
    factorTables: "factorTables",
    table: "table",
    columns: "columns",
    column: "Column",
    dimensions: "dimensions",
    dimension: "dimension",
    dimValue: "Value",
    rows: "rows",
    row: "row",
    cell: "cell",
    rules: "rules",
    rule: "rule",
    ifEl: "if",
    thenEl: "then",
    action: "action",
    coverageRef: "CoverageRef",
    ldTableRef: "LdTableRef",
    manuscriptRefs: "policyAdmin",
    policyManuScriptID: "PolicyManuScriptID",
    policyManuScriptVersionID: "PolicyManuScriptVersionID",
    formsManuScriptID: "FormsManuScriptID",
    ratingManuScriptID: "RatingManuScriptID",
    tableManuScriptID: "TableManuScriptID",
    communicationsManuScriptID: "CommunicationsManuScriptID",
    useDctForms: "UseDCTForms",
    useDctFormsAndMessages: "UseDCTFormsAndMessages",
    lineOfBusiness: "LineOfBusiness",
    indicator: "Indicator",
    riskTableManuScriptId: "RiskManuscriptTableManuScriptID"
  },
  attrs: {
    id: "id",
    refId: "refId",
    key: "key",
    t: "t",
    ind: "ind",
    req: "req",
    order: "order",
    source: "src",
    premiumGenerating: "pg",
    effective: "e",
    cid: "cid",
    isValid: "isvalid",
    isMandatory: "Ismandatory",
    isSelected: "Isselected",
    caption: "caption",
    notes: "notes",
    default: "default",
    enabled: "enabled",
    valueType: "valueType",
    allStates: "allStates",
    label: "label",
    name: "name",
    dataType: "dataType",
    repeating: "repeating",
    values: "values",
    kind: "kind",
    valueColumn: "valueColumn",
    op: "op",
    sourceType: "sourceType",
    tableRef: "tableRef",
    inputKeys: "keys",
    constValue: "const",
    condition: "condition",
    roundTo: "roundTo",
    category: "category",
    subCategory: "subCategory",
    mandatory: "mandatory",
    ruleType: "ruleType",
    market: "market",
    manuScriptID: "manuScriptID",
    engineVersion: "engineVersion",
    cultureCode: "cultureCode",
    currencyCode: "currencyCode",
    col: "col",
    editionValue: "value",
    defaultValue: "defaultValue",
    structure: "structure",
    basis: "basis",
    unit: "unit",
    ldRef: "ldRef",
    stateList: "states",
    admitted: "admitted",
    mandatoryDefault: "mandatoryDefault",
    attach: "attach",
    dynamic: "dynamic",
    minimumPremium: "minimumPremium",
    description: "description",
    endorsementMandatory: "ismandatory"
  },
  premiumChildren: ["Premium", "change", "offset", "onset", "written"],
  premiumZero: "0",
  boolTrue: "1",
  boolFalse: "0",
  policyFormExposureKey: "PolicyForm",
  endorsementIndicatorType: "endorsement",
  tablesLayerToken: "Tables"
};
function composeManuscriptId(mapping, lineCode, layer) {
  const m = mapping.manuscript;
  const lob = m.lobTokens[lineCode] ?? lineCode;
  const { market, layer: layerToken } = m.layers[layer];
  const { major, minor, build, rev } = m.version;
  return [m.carrier, lob, market, layerToken, m.country, major, minor, build, rev].join("_");
}
function composeManuscriptVersionId(mapping, lineCode, layer) {
  const m = mapping.manuscript;
  const lob = m.lobTokens[lineCode] ?? lineCode;
  const { market, layer: layerToken } = m.layers[layer];
  return [m.carrier, lob, market, layerToken, m.country].join("_");
}
function composeTableManuscriptIdForScope(mapping, lineCode, scope) {
  const m = mapping.manuscript;
  const lob = m.lobTokens[lineCode] ?? lineCode;
  const { market } = m.layers.tables;
  const { major, minor, build, rev } = m.version;
  return [m.carrier, lob, market, mapping.tablesLayerToken, scope, major, minor, build, rev].join("_");
}

// shared/src/duckcreek/serialize.ts
var DEFAULT_COMMENT = "Generated by the Product Reinvention Hub PDM\u2192Duck Creek serializer. Deterministic, mapping-driven, manuscript-SHAPED projection \u2014 not a proprietary Duck Creek manuscript-definition export. See docs/DUCKCREEK_MAPPING.md.";
function serializePdmToDuckCreek(product, options = {}) {
  const mapping = options.mapping ?? DEFAULT_DUCKCREEK_MAPPING;
  const root = buildManuscriptTree(product, mapping);
  const comment = options.comment === "" ? void 0 : options.comment ?? DEFAULT_COMMENT;
  return writeXml(root, comment ? { comment } : {});
}
function buildManuscriptTree(product, mapping) {
  const E = mapping.elements;
  const A = mapping.attrs;
  const lineCode = product.line.code;
  const bool = (b) => b ? mapping.boolTrue : mapping.boolFalse;
  const id = (type, seed) => deriveId(mapping.idPrefix[type], `${type}|${seed}`);
  const statesNode = (app) => {
    const attrs = [[A.allStates, bool(app.allStates)]];
    if (app.effectiveDate) attrs.push([A.effective, app.effectiveDate]);
    const children = app.allStates ? [] : app.states.map((s) => leaf(E.state, s));
    return el(E.states, attrs, children);
  };
  const valueNode = (term, ev) => {
    const attrs = [
      [A.id, id("validValue", `${term.refId}:${ev.id}`)],
      [A.label, ev.label],
      [A.valueType, ev.valueType],
      [A.default, bool(ev.isDefault)],
      [A.enabled, bool(ev.enabled)],
      [A.allStates, bool(ev.applicability.allStates)]
    ];
    if (!ev.applicability.allStates && ev.applicability.states.length) {
      attrs.push([A.stateList, ev.applicability.states.join("|")]);
    }
    if (ev.constraintNote) attrs.push([A.notes, ev.constraintNote]);
    const text = ev.value !== null ? String(ev.value) : (ev.parts ?? []).join("/");
    return leaf(E.value, text, attrs);
  };
  const termFieldNode = (term) => {
    const isDed = term.kind === "DEDUCTIBLE";
    const attrs = [
      [A.id, id(isDed ? "deductible" : "limit", term.refId)],
      [A.t, term.termKey],
      [A.refId, term.refId],
      [A.key, term.key],
      [A.default, String(term.defaultValue)],
      [A.structure, term.structure],
      [A.basis, term.basis]
    ];
    if (term.unit) attrs.push([A.unit, term.unit]);
    if (term.ldTableRef) attrs.push([A.ldRef, term.ldTableRef]);
    if (term.constraintNote) attrs.push([A.notes, term.constraintNote]);
    const children = term.eligibleValues.length ? [el(E.validValues, [], term.eligibleValues.map((ev) => valueNode(term, ev)))] : [];
    return el(isDed ? E.deductible : E.limit, attrs, children);
  };
  const optionNode = (coverageId, term) => {
    const attrs = [
      [A.id, id("option", term.refId)],
      [A.t, term.termKey],
      [A.refId, term.refId],
      [A.key, term.key],
      [A.cid, coverageId],
      [A.caption, term.label],
      [A.isValid, bool(true)],
      [A.isMandatory, bool(false)],
      [A.isSelected, bool(false)],
      [A.default, String(term.defaultValue)]
    ];
    if (term.notes) attrs.push([A.notes, term.notes]);
    return empty(E.options, attrs);
  };
  const coverageNode = (cov) => {
    const cid = id("coverage", cov.refId);
    const attrs = [
      [A.id, cid],
      [A.t, cov.termKey],
      [A.refId, cov.refId],
      [A.ind, bool(cov.requirement === "MANDATORY")],
      [A.req, cov.requirement],
      [A.order, String(cov.order)],
      [A.source, cov.source],
      [A.premiumGenerating, bool(cov.premiumGenerating)]
    ];
    if (cov.applicability.effectiveDate) attrs.push([A.effective, cov.applicability.effectiveDate]);
    const children = [
      leaf(E.caption, cov.name),
      leaf(E.section, cov.section),
      empty(E.statCode, [[A.id, id("statCode", `${cov.refId}:stat`)]])
    ];
    const isEndorsement = cov.requirement === "OPTIONAL" || cov.parentRefId !== null;
    if (isEndorsement) {
      children.push(empty(E.indicator, [
        [A.id, id("indicator", `${cov.refId}:endorsement`)],
        [A.t, mapping.endorsementIndicatorType],
        [A.endorsementMandatory, bool(cov.requirement === "MANDATORY")]
      ]));
    }
    for (const fn of cov.formNumbers) children.push(leaf(E.formNumber, fn));
    children.push(statesNode(cov.applicability));
    for (const term of cov.terms) {
      children.push(term.kind === "OPTION" ? optionNode(cid, term) : termFieldNode(term));
    }
    for (const p of mapping.premiumChildren) children.push(leaf(p, mapping.premiumZero));
    for (const child of cov.children) children.push(coverageNode(child));
    return el(E.coverage, attrs, children);
  };
  const formNode = (form) => {
    const attrs = [
      [A.id, id("form", form.refId)],
      [A.refId, form.refId],
      [A.category, form.category],
      [A.source, form.source],
      [A.admitted, bool(form.admitted)],
      [A.mandatoryDefault, bool(form.mandatoryDefault)],
      [A.attach, form.attachmentCondition],
      [A.dynamic, bool(form.dynamic)]
    ];
    const editions = el(E.editions, [], form.editions.map((ed) => el(E.edition, [
      [A.id, id("edition", `${form.refId}:${ed.edition}`)],
      [A.editionValue, ed.edition]
    ], [statesNode(ed.applicability)])));
    const fields = el(E.fields, [], form.dynamicFields.map((f) => {
      const fAttrs = [
        [A.id, id("dynamicField", `${form.refId}:${f.name}`)],
        [A.name, f.name],
        [A.dataType, f.dataType],
        [A.repeating, bool(f.repeating)]
      ];
      if (f.notes) fAttrs.push([A.notes, f.notes]);
      const opts = (f.options ?? []).map((o) => leaf(E.fieldOption, o));
      return el(E.field, fAttrs, opts);
    }));
    const children = [
      leaf(E.formName, form.name),
      leaf(E.formNumber, form.formNumber),
      leaf(E.formsManuScriptID, composeManuscriptId(mapping, lineCode, "forms")),
      leaf(E.useDctForms, mapping.boolTrue),
      editions,
      statesNode(form.applicability),
      ...form.coverageParts.map((cp) => leaf(E.coveragePart, cp)),
      leaf(E.description, form.description),
      fields
    ];
    return el(E.form, attrs, children);
  };
  const stepNode = (step) => {
    const attrs = [
      [A.id, id("ratingStep", step.refId)],
      [A.refId, step.refId],
      [A.key, step.key],
      [A.order, String(step.order)],
      [A.op, step.op],
      [A.label, step.label],
      [A.sourceType, step.sourceType]
    ];
    if (step.tableRef) attrs.push([A.tableRef, step.tableRef]);
    if (step.inputKeys && step.inputKeys.length) attrs.push([A.inputKeys, step.inputKeys.join("|")]);
    if (step.constValue !== void 0) attrs.push([A.constValue, String(step.constValue)]);
    if (step.condition) attrs.push([A.condition, step.condition]);
    if (step.roundTo !== void 0) attrs.push([A.roundTo, String(step.roundTo)]);
    return empty(E.step, attrs);
  };
  const programNode = (program) => el(E.program, [
    [A.id, id("ratingProgram", program.refId)],
    [A.refId, program.refId],
    [A.name, program.name],
    [A.minimumPremium, String(program.minimumPremium)]
  ], [statesNode(program.applicability), ...program.steps.map(stepNode)]);
  const tableNode = (table) => {
    const attrs = [
      [A.id, id("factorTable", table.refId)],
      [A.refId, table.refId],
      [A.name, table.name],
      [A.kind, table.kind]
    ];
    if (table.valueColumn) attrs.push([A.valueColumn, table.valueColumn]);
    if (table.defaultValue !== void 0) attrs.push([A.defaultValue, String(table.defaultValue)]);
    const columns = el(E.columns, [], table.columns.map((c) => leaf(E.column, c)));
    const dims = table.dimensions.length ? [el(E.dimensions, [], table.dimensions.map((d) => el(E.dimension, [
      [A.id, id("tableDimension", `${table.refId}:${d.key}`)],
      [A.key, d.key],
      [A.label, d.label]
    ], d.values.map((v) => leaf(E.dimValue, v)))))] : [];
    const rows = el(E.rows, [], table.rows.map((r, idx) => el(
      E.row,
      [[A.id, id("tableRow", `${table.refId}:row:${idx}`)]],
      table.columns.map((col) => {
        const v = r[col];
        return leaf(E.cell, v === null || v === void 0 ? "" : String(v), [[A.col, col]]);
      })
    )));
    return el(E.table, attrs, [columns, ...dims, rows]);
  };
  const ruleNode = (rule) => {
    const attrs = [
      [A.id, id("rule", rule.refId)],
      [A.refId, rule.refId],
      [A.ruleType, rule.ruleType],
      [A.category, rule.category]
    ];
    if (rule.subCategory) attrs.push([A.subCategory, rule.subCategory]);
    if (rule.mandatory !== void 0) attrs.push([A.mandatory, bool(rule.mandatory)]);
    const children = [
      leaf(E.ifEl, rule.condition),
      el(E.thenEl, [], rule.actions.map((a) => leaf(E.action, a))),
      ...rule.coverageRefIds.map((cr) => leaf(E.coverageRef, cr)),
      ...rule.formNumbers.map((fn) => leaf(E.formNumber, fn)),
      ...rule.ldTableRef ? [leaf(E.ldTableRef, rule.ldTableRef)] : [],
      statesNode(rule.applicability)
    ];
    return el(E.rule, attrs, children);
  };
  const perilStates = product.line.perilModel.eligibleStates;
  const tableScopes = perilStates.length ? [...perilStates].sort() : [mapping.manuscript.country];
  const riskTableIds = tableScopes.map((scope) => leaf(E.riskTableManuScriptId, composeTableManuscriptIdForScope(mapping, lineCode, scope)));
  const riskNode = el(E.risk, [[A.id, id("risk", `${product.refId}:risk`)]], [
    leaf(E.exposure, mapping.manuscript.lobTokens[lineCode] ?? lineCode, [
      [A.id, id("exposure", `${product.refId}:policyform`)],
      [A.t, mapping.policyFormExposureKey]
    ]),
    ...product.coverages.map(coverageNode),
    ...riskTableIds
  ]);
  const lineNode = el(E.line, [
    [A.id, id("line", product.line.refId)],
    [A.refId, product.line.refId],
    [A.description, product.line.compactName]
  ], [leaf(E.type, product.line.compactName), riskNode]);
  const productNode = el(E.product, [
    [A.id, id("product", product.refId)],
    [A.refId, product.refId],
    [A.t, product.line.compactName]
  ], [
    leaf(E.caption, product.name),
    leaf(E.description, product.description),
    leaf(E.marketSegment, product.marketSegment),
    leaf(E.type, product.line.compactName),
    // LineOfBusiness — the compact line name from the LOB registry (sample: PersonalHome).
    leaf(E.lineOfBusiness, product.line.compactName),
    statesNode(product.applicability),
    lineNode
  ]);
  const formsNode = el(E.forms, [], product.forms.map(formNode));
  const ratingNode = el(E.rating, [], [
    leaf(E.ratingManuScriptID, composeManuscriptId(mapping, lineCode, "rating")),
    leaf(E.tableManuScriptID, composeManuscriptId(mapping, lineCode, "tables")),
    ...product.ratingPrograms.map(programNode),
    el(E.factorTables, [], product.ratingTables.map(tableNode))
  ]);
  const rulesNode = el(E.rules, [], product.rules.map(ruleNode));
  const manuscriptRefs = el(E.manuscriptRefs, [[A.id, id("manuscript", `${product.refId}:admin`)]], [
    leaf(E.policyManuScriptID, composeManuscriptId(mapping, lineCode, "viewModel")),
    leaf(E.policyManuScriptVersionID, composeManuscriptVersionId(mapping, lineCode, "viewModel")),
    leaf(E.formsManuScriptID, composeManuscriptId(mapping, lineCode, "forms")),
    leaf(E.ratingManuScriptID, composeManuscriptId(mapping, lineCode, "rating")),
    leaf(E.tableManuScriptID, composeManuscriptId(mapping, lineCode, "tables")),
    leaf(E.communicationsManuScriptID, mapping.manuscript.layers.communications),
    leaf(E.useDctForms, mapping.boolTrue),
    leaf(E.useDctFormsAndMessages, mapping.boolTrue)
  ]);
  const rootAttrs = [];
  if (mapping.namespace.declareOnRoot) {
    rootAttrs.push([`xmlns:${mapping.namespace.prefix}`, mapping.namespace.uri]);
  }
  rootAttrs.push(
    [A.manuScriptID, composeManuscriptId(mapping, lineCode, "viewModel")],
    [A.engineVersion, mapping.manuscript.engineVersion],
    [A.cultureCode, mapping.manuscript.cultureCode],
    [A.currencyCode, mapping.manuscript.currencyCode]
  );
  return el(E.manuscript, rootAttrs, [productNode, formsNode, ratingNode, rulesNode, manuscriptRefs]);
}

// shared/src/pdm/types.ts
function flattenCoverages(coverages) {
  const out = [];
  const walk = (c) => {
    out.push(c);
    for (const child of c.children) walk(child);
  };
  for (const c of coverages) walk(c);
  return out;
}
function allTerms(product) {
  return flattenCoverages(product.coverages).flatMap((c) => c.terms);
}

// shared/src/duckcreek/validate.ts
var ENUM_REQUIREMENT = /* @__PURE__ */ new Set(["MANDATORY", "OPTIONAL"]);
var ENUM_RATING_OP = /* @__PURE__ */ new Set(["SET", "MUL", "ADD", "MIN_FLOOR"]);
var ENUM_SOURCE_TYPE = /* @__PURE__ */ new Set(["RT", "LD", "INPUT", "CONST", "SPP"]);
var ENUM_RULE_TYPE = /* @__PURE__ */ new Set(["ELIGIBILITY", "COVERAGE", "RATING", "FORM_ATTACH"]);
var ENUM_VALUE_TYPE = /* @__PURE__ */ new Set(["FLAT", "PERCENT", "SPLIT", "CSL", "SCHEDULED", "WAITING_PERIOD", "FLAG"]);
var ENUM_BOOL = /* @__PURE__ */ new Set(["0", "1"]);
var NUMERIC_VALUE_TYPES = /* @__PURE__ */ new Set(["FLAT", "PERCENT", "CSL", "WAITING_PERIOD"]);
function isNumeric(s) {
  if (s === void 0 || s.trim() === "") return false;
  return Number.isFinite(Number(s));
}
var ID_BEARING = [
  { type: "product", elementKey: "product" },
  { type: "line", elementKey: "line" },
  { type: "risk", elementKey: "risk" },
  { type: "coverage", elementKey: "coverage" },
  { type: "limit", elementKey: "limit" },
  { type: "deductible", elementKey: "deductible" },
  { type: "option", elementKey: "options" },
  { type: "statCode", elementKey: "statCode" },
  { type: "exposure", elementKey: "exposure" },
  { type: "indicator", elementKey: "indicator" },
  { type: "form", elementKey: "form" },
  { type: "ratingProgram", elementKey: "program" },
  { type: "ratingStep", elementKey: "step" },
  { type: "factorTable", elementKey: "table" },
  { type: "rule", elementKey: "rule" },
  { type: "validValue", elementKey: "value" }
];
var REQUIRED_VOCAB = [
  "manuscript",
  "product",
  "line",
  "risk",
  "coverage",
  "statCode",
  "limit",
  "validValues",
  "value",
  "options",
  "forms",
  "form",
  "formNumber",
  "rating",
  "program",
  "step",
  "factorTables",
  "table",
  "rules",
  "rule",
  "states"
];
function refIdsFor(root, tag, refAttr) {
  return findAll(root, tag).map((n) => attr(n, refAttr)).filter((r) => r !== void 0);
}
function diff(section, expected, emitted) {
  const eSet = new Set(emitted);
  const xSet = new Set(expected);
  const missing = expected.filter((r) => !eSet.has(r)).map((refId) => ({ section, refId }));
  const extra = emitted.filter((r) => !xSet.has(r)).map((refId) => ({ section, refId }));
  return {
    count: { section, expected: expected.length, emitted: emitted.length, ok: missing.length === 0 && extra.length === 0 },
    missing,
    extra
  };
}
function validateDuckCreek(product, xml, mapping = DEFAULT_DUCKCREEK_MAPPING) {
  const E = mapping.elements;
  const A = mapping.attrs;
  const issues = [];
  let root;
  try {
    root = parseXml(xml);
  } catch (err) {
    return {
      ok: false,
      wellFormed: false,
      namespaceDeclared: false,
      idPrefixesValid: false,
      crossRefsValid: false,
      roundTripOk: false,
      requiredFieldsPresent: false,
      enumsValid: false,
      numericFormatsValid: false,
      counts: [],
      missingRefIds: [],
      extraRefIds: [],
      duplicateIds: [],
      issues: [{ severity: "error", code: "not-well-formed", message: String(err.message) }]
    };
  }
  const nsAttr = `xmlns:${mapping.namespace.prefix}`;
  const namespaceDeclared = attr(root, nsAttr) === mapping.namespace.uri;
  if (!namespaceDeclared) {
    issues.push({ severity: "error", code: "namespace-missing", message: `Root is missing ${nsAttr}="${mapping.namespace.uri}".` });
  }
  for (const key of REQUIRED_VOCAB) {
    if (findAll(root, E[key]).length === 0) {
      issues.push({ severity: "error", code: "vocab-missing", message: `Expected element <${E[key]}> is absent.` });
    }
  }
  let idPrefixesValid = true;
  const allIds = [];
  for (const { type, elementKey } of ID_BEARING) {
    const letter = mapping.idPrefix[type];
    for (const node of findAll(root, E[elementKey])) {
      const idVal = attr(node, A.id);
      if (idVal === void 0) continue;
      allIds.push(idVal);
      if (!idVal.startsWith(letter)) {
        idPrefixesValid = false;
        issues.push({
          severity: "error",
          code: "id-prefix",
          message: `<${E[elementKey]}> id "${idVal}" should start with "${letter}".`
        });
      }
    }
  }
  const everyId = everyNode(root).map((n) => attr(n, A.id)).filter((v) => v !== void 0);
  const seen = /* @__PURE__ */ new Set();
  const dupes = /* @__PURE__ */ new Set();
  for (const idv of everyId) {
    if (seen.has(idv)) dupes.add(idv);
    else seen.add(idv);
  }
  const duplicateIds = [...dupes];
  for (const d of duplicateIds) issues.push({ severity: "error", code: "duplicate-id", message: `Duplicate id "${d}".` });
  const coverageIds = new Set(
    findAll(root, E.coverage).map((n) => attr(n, A.id)).filter((v) => v !== void 0)
  );
  let crossRefsValid = true;
  for (const opt of findAll(root, E.options)) {
    const cid = attr(opt, A.cid);
    if (cid !== void 0 && !coverageIds.has(cid)) {
      crossRefsValid = false;
      issues.push({ severity: "error", code: "cid-dangling", message: `<${E.options}> cid "${cid}" matches no coverage id.` });
    }
  }
  const covs = flattenCoverages(product.coverages);
  const terms = allTerms(product);
  const steps = product.ratingPrograms.flatMap((p) => p.steps);
  const sections = [
    { section: "coverages", expected: covs.map((c) => c.refId), emittedTag: E.coverage },
    { section: "limits", expected: terms.filter((t) => t.kind === "LIMIT").map((t) => t.refId), emittedTag: E.limit },
    { section: "deductibles", expected: terms.filter((t) => t.kind === "DEDUCTIBLE").map((t) => t.refId), emittedTag: E.deductible },
    { section: "options", expected: terms.filter((t) => t.kind === "OPTION").map((t) => t.refId), emittedTag: E.options },
    { section: "forms", expected: product.forms.map((f) => f.refId), emittedTag: E.form },
    { section: "rules", expected: product.rules.map((r) => r.refId), emittedTag: E.rule },
    { section: "ratingPrograms", expected: product.ratingPrograms.map((p) => p.refId), emittedTag: E.program },
    { section: "ratingSteps", expected: steps.map((s) => s.refId), emittedTag: E.step },
    { section: "ratingTables", expected: product.ratingTables.map((t) => t.refId), emittedTag: E.table }
  ];
  const counts = [];
  const missingRefIds = [];
  const extraRefIds = [];
  for (const s of sections) {
    const emitted = refIdsFor(root, s.emittedTag, A.refId);
    const d = diff(s.section, s.expected, emitted);
    counts.push(d.count);
    missingRefIds.push(...d.missing);
    extraRefIds.push(...d.extra);
  }
  const roundTripOk = counts.every((c) => c.ok) && missingRefIds.length === 0 && extraRefIds.length === 0;
  for (const m of missingRefIds) issues.push({ severity: "error", code: "dropped-node", message: `${m.section}: refId "${m.refId}" was dropped (in PDM, not in XML).` });
  for (const x of extraRefIds) issues.push({ severity: "error", code: "extra-node", message: `${x.section}: refId "${x.refId}" is in the XML but not the PDM.` });
  const req = (cond, code, message) => {
    if (!cond) issues.push({ severity: "error", code, message });
  };
  const msPattern = /^[A-Za-z]+(_[A-Za-z]+)*_[A-Z]{2}_\d+_\d+_\d+_\d+$/;
  const rootMs = attr(root, A.manuScriptID);
  req(
    rootMs !== void 0 && msPattern.test(rootMs),
    "missing-manuscriptid",
    `Root <${E.manuscript}> must carry a well-formed ${A.manuScriptID}.`
  );
  req(
    findAll(root, E.lineOfBusiness).some((n) => (n.text ?? "").trim() !== ""),
    "missing-lob",
    `Expected a non-empty <${E.lineOfBusiness}> (line of business).`
  );
  const riskTableIds = findAll(root, E.riskTableManuScriptId);
  req(
    riskTableIds.length > 0,
    "missing-risk-tables",
    `Expected at least one <${E.riskTableManuScriptId}> (state-scoped tables manuscript).`
  );
  for (const rt of riskTableIds) {
    req(
      msPattern.test((rt.text ?? "").trim()),
      "bad-risk-table-id",
      `<${E.riskTableManuScriptId}> "${(rt.text ?? "").trim()}" is not a well-formed manuScriptID.`
    );
  }
  for (const cov of findAll(root, E.coverage)) {
    const ref = attr(cov, A.refId) ?? attr(cov, A.id) ?? "?";
    const caption = cov.children.find((c) => c.name === E.caption);
    req(
      !!caption && (caption.text ?? "").trim() !== "",
      "missing-caption",
      `Coverage "${ref}" is missing a non-empty <${E.caption}>.`
    );
    const reqVal = attr(cov, A.req);
    if (reqVal !== void 0) {
      req(
        ENUM_REQUIREMENT.has(reqVal),
        "enum-requirement",
        `Coverage "${ref}" has ${A.req}="${reqVal}" (not MANDATORY|OPTIONAL).`
      );
    }
    for (const b of [A.ind, A.premiumGenerating]) {
      const v = attr(cov, b);
      if (v !== void 0) req(ENUM_BOOL.has(v), "enum-bool", `Coverage "${ref}" ${b}="${v}" must be 0 or 1.`);
    }
  }
  for (const ind of findAll(root, E.indicator)) {
    const v = attr(ind, A.endorsementMandatory);
    if (v !== void 0) req(ENUM_BOOL.has(v), "enum-bool", `<${E.indicator}> ${A.endorsementMandatory}="${v}" must be 0 or 1.`);
  }
  for (const v of findAll(root, E.value)) {
    const vt = attr(v, A.valueType);
    if (vt !== void 0) {
      req(ENUM_VALUE_TYPE.has(vt), "enum-valuetype", `<${E.value}> ${A.valueType}="${vt}" is not a known value type.`);
      if (NUMERIC_VALUE_TYPES.has(vt)) {
        req(
          isNumeric(v.text),
          "nonnumeric-value",
          `<${E.value}> of type ${vt} must be numeric (got "${v.text ?? ""}").`
        );
      }
    }
  }
  for (const step of findAll(root, E.step)) {
    const ref = attr(step, A.refId) ?? "?";
    const op = attr(step, A.op);
    req(op !== void 0 && ENUM_RATING_OP.has(op), "enum-op", `Rating step "${ref}" op="${op ?? ""}" is not SET|MUL|ADD|MIN_FLOOR.`);
    const st = attr(step, A.sourceType);
    req(st !== void 0 && ENUM_SOURCE_TYPE.has(st), "enum-sourcetype", `Rating step "${ref}" ${A.sourceType}="${st ?? ""}" is not RT|LD|INPUT|CONST|SPP.`);
    const cv = attr(step, A.constValue);
    if (cv !== void 0) req(isNumeric(cv), "nonnumeric-const", `Rating step "${ref}" ${A.constValue}="${cv}" must be numeric.`);
    const rt2 = attr(step, A.roundTo);
    if (rt2 !== void 0) req(isNumeric(rt2), "nonnumeric-roundto", `Rating step "${ref}" ${A.roundTo}="${rt2}" must be numeric.`);
  }
  for (const prog of findAll(root, E.program)) {
    const mp = attr(prog, A.minimumPremium);
    if (mp !== void 0) req(isNumeric(mp), "nonnumeric-minpremium", `Program "${attr(prog, A.refId) ?? "?"}" ${A.minimumPremium}="${mp}" must be numeric.`);
  }
  for (const rule of findAll(root, E.rule)) {
    const rtv = attr(rule, A.ruleType);
    req(rtv !== void 0 && ENUM_RULE_TYPE.has(rtv), "enum-ruletype", `Rule "${attr(rule, A.refId) ?? "?"}" ${A.ruleType}="${rtv ?? ""}" is not a known rule type.`);
  }
  for (const form of findAll(root, E.form)) {
    const fn = form.children.find((c) => c.name === E.formNumber);
    req(
      !!fn && (fn.text ?? "").trim() !== "",
      "missing-formnumber",
      `Form "${attr(form, A.refId) ?? "?"}" is missing a non-empty <${E.formNumber}>.`
    );
  }
  for (const cov of findAll(root, E.coverage)) {
    for (const child of cov.children) {
      if (mapping.premiumChildren.includes(child.name)) {
        req(
          isNumeric(child.text),
          "nonnumeric-premium",
          `Coverage "${attr(cov, A.refId) ?? "?"}" <${child.name}> must be numeric (got "${child.text ?? ""}").`
        );
      }
    }
  }
  const codeCat = (code) => code.startsWith("missing-") || code === "bad-risk-table-id" ? "required" : code.startsWith("enum-") ? "enum" : code.startsWith("nonnumeric-") ? "numeric" : "other";
  const codes = issues.map((i) => i.code);
  const requiredFieldsPresent = !codes.some((c) => codeCat(c) === "required");
  const enumsValid = !codes.some((c) => codeCat(c) === "enum");
  const numericFormatsValid = !codes.some((c) => codeCat(c) === "numeric");
  const ok = namespaceDeclared && idPrefixesValid && crossRefsValid && roundTripOk && requiredFieldsPresent && enumsValid && numericFormatsValid && duplicateIds.length === 0 && !issues.some((i) => i.severity === "error");
  return {
    ok,
    wellFormed: true,
    namespaceDeclared,
    idPrefixesValid,
    crossRefsValid,
    roundTripOk,
    requiredFieldsPresent,
    enumsValid,
    numericFormatsValid,
    counts,
    missingRefIds,
    extraRefIds,
    duplicateIds,
    issues
  };
}
function summarizeReport(report) {
  const total = report.counts.reduce((n, c) => n + c.emitted, 0);
  const status = report.ok ? "PASS" : "FAIL";
  const sect = report.counts.map((c) => `${c.section}=${c.emitted}/${c.expected}`).join(" ");
  return `[${status}] wellFormed=${report.wellFormed} ns=${report.namespaceDeclared} ids=${report.idPrefixesValid} cids=${report.crossRefsValid} roundTrip=${report.roundTripOk} required=${report.requiredFieldsPresent} enums=${report.enumsValid} numeric=${report.numericFormatsValid} nodes=${total} \xB7 ${sect}`;
}

// shared/src/insurance/lobRegistry.ts
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
  marketSegments: ["Commercial Lines", "Small Commercial", "Middle Market"]
};
var LOB_REGISTRY = {
  [PH_LOB.refId]: PH_LOB,
  [PA_LOB.refId]: PA_LOB,
  [GL_LOB.refId]: GL_LOB
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_DUCKCREEK_MAPPING,
  LOB_REGISTRY,
  buildPdm,
  composeManuscriptId,
  composeManuscriptVersionId,
  composeTableManuscriptIdForScope,
  serializePdmToDuckCreek,
  summarizeReport,
  validateDuckCreek
});
