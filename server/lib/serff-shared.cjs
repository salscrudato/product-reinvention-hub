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

// shared/src/serff/api-server.ts
var api_server_exports = {};
__export(api_server_exports, {
  STATE_FILING_MATRIX: () => STATE_FILING_MATRIX,
  TEXAS_FILING_PROFILE: () => TEXAS_FILING_PROFILE,
  assembleSerffBundle: () => assembleSerffBundle,
  buildHistogram: () => buildHistogram,
  buildMemoStructure: () => buildMemoStructure,
  checkTexasBundle: () => checkTexasBundle,
  computePremiumImpacts: () => computePremiumImpacts,
  diffProducts: () => diffProducts,
  documentsInTab: () => documentsInTab,
  generateRateExhibit: () => generateRateExhibit,
  generateRedlineDocuments: () => generateRedlineDocuments,
  getStateProfile: () => getStateProfile,
  overallImpactPct: () => overallImpactPct,
  requiresMarkedCopies: () => requiresMarkedCopies,
  requiresRateExhibits: () => requiresRateExhibits,
  resolveRatingKit: () => resolveRatingKit
});
module.exports = __toCommonJS(api_server_exports);

// shared/src/changeset/diff.ts
function diffTerms(parentTerms, cloneTerms) {
  const changes = [];
  const byId = (ts) => new Map(ts.map((t) => [t.id, t]));
  const pm = byId(parentTerms);
  const cm = byId(cloneTerms);
  const allIds = /* @__PURE__ */ new Set([...pm.keys(), ...cm.keys()]);
  for (const id of allIds) {
    const pt = pm.get(id);
    const ct = cm.get(id);
    if (!pt || !ct) continue;
    const fieldChanges = [];
    const optionSetChanges = [];
    const scalarFields = ["options", "default", "min", "max", "label", "notes", "basis", "constraintNote"];
    for (const f of scalarFields) {
      const before = pt[f];
      const after = ct[f];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        fieldChanges.push({ field: f, before, after });
      }
    }
    const pOpts = pt.optionSet ?? [];
    const cOpts = ct.optionSet ?? [];
    const pByOid = new Map(pOpts.map((o) => [o.id, o]));
    const cByOid = new Map(cOpts.map((o) => [o.id, o]));
    const allOids = /* @__PURE__ */ new Set([...pByOid.keys(), ...cByOid.keys()]);
    for (const oid of allOids) {
      const po = pByOid.get(oid);
      const co = cByOid.get(oid);
      if (!po) {
        optionSetChanges.push({ optionId: oid, kind: "added" });
        continue;
      }
      if (!co) {
        optionSetChanges.push({ optionId: oid, kind: "removed" });
        continue;
      }
      const optFields = ["type", "value", "parts", "label", "allStates", "states", "isDefault", "enabled", "constraintNote"];
      for (const f of optFields) {
        if (JSON.stringify(po[f]) !== JSON.stringify(co[f])) {
          optionSetChanges.push({ optionId: oid, kind: "modified", field: f, before: po[f], after: co[f] });
        }
      }
    }
    if (fieldChanges.length > 0 || optionSetChanges.length > 0) {
      changes.push({ termId: id, termLabel: ct.label || pt.label, termKind: ct.kind, fieldChanges, optionSetChanges });
    }
  }
  return changes;
}
function diffCoverages(parentCovs, cloneCovs) {
  const changes = [];
  const byRef = (cs) => new Map(cs.filter((c) => c.refId).map((c) => [c.refId, c]));
  const pm = byRef(parentCovs);
  const cm = byRef(cloneCovs);
  for (const [ref, cov] of cm.entries()) {
    if (!pm.has(ref)) changes.push({ kind: "added", refId: ref, name: cov.name });
  }
  for (const [ref, cov] of pm.entries()) {
    if (!cm.has(ref)) changes.push({ kind: "removed", refId: ref, name: cov.name });
  }
  for (const [ref, pc] of pm.entries()) {
    const cc = cm.get(ref);
    if (!cc) continue;
    const termChanges = diffTerms(pc.terms, cc.terms);
    const covFields = ["name", "requirement", "claimsBasis", "premiumGenerating", "source", "formNumbers"];
    const fieldChanges = [];
    for (const f of covFields) {
      if (JSON.stringify(pc[f]) !== JSON.stringify(cc[f])) {
        fieldChanges.push({ field: f, before: pc[f], after: cc[f] });
      }
    }
    if (termChanges.length > 0 || fieldChanges.length > 0) {
      changes.push({ kind: "modified", refId: ref, name: cc.name, termChanges, fieldChanges });
    }
  }
  return changes;
}
function resolveTableLayout(table) {
  if (table.dimensions && table.dimensions.length > 0) {
    const dimKeys = new Set(table.dimensions.map((d) => d.key));
    const valueCols = table.columns.filter((c) => !dimKeys.has(c));
    return { keyColumns: [...dimKeys].filter((k) => table.columns.includes(k)), valueCols };
  }
  const valueCol = table.valueColumn ?? table.columns[table.columns.length - 1];
  const keyColumns = table.columns.filter((c) => c !== valueCol);
  return { keyColumns, valueCols: [valueCol] };
}
function compositeKey(row, keyColumns) {
  const obj = {};
  for (const k of keyColumns) obj[k] = row[k];
  return JSON.stringify(obj);
}
function diffRTTables(parentTables, cloneTables) {
  const changes = [];
  const allRefs = /* @__PURE__ */ new Set([...Object.keys(parentTables), ...Object.keys(cloneTables)]);
  for (const ref of allRefs) {
    const pt = parentTables[ref];
    const ct = cloneTables[ref];
    if (!pt || !ct) continue;
    const { keyColumns, valueCols } = resolveTableLayout(ct);
    const pByKey = /* @__PURE__ */ new Map();
    for (const row of pt.rows) pByKey.set(compositeKey(row, keyColumns), row);
    for (const row of ct.rows) {
      const key = compositeKey(row, keyColumns);
      const pr = pByKey.get(key);
      const rowKey = {};
      for (const k of keyColumns) rowKey[k] = row[k];
      for (const vc of valueCols) {
        const beforeRaw = pr ? pr[vc] : void 0;
        const afterRaw = row[vc];
        const before = typeof beforeRaw === "number" ? beforeRaw : parseFloat(String(beforeRaw ?? "NaN"));
        const after = typeof afterRaw === "number" ? afterRaw : parseFloat(String(afterRaw ?? "NaN"));
        if (!isFinite(before) || !isFinite(after)) continue;
        if (before !== after) {
          const pctChange = before !== 0 ? (after - before) / Math.abs(before) * 100 : null;
          changes.push({ tableRefId: ref, tableName: ct.name, rowKey: { ...rowKey }, column: vc, before, after, pctChange });
        }
      }
    }
  }
  return changes;
}
function diffLDTables(parentTables, cloneTables) {
  const changes = [];
  const allRefs = /* @__PURE__ */ new Set([...Object.keys(parentTables), ...Object.keys(cloneTables)]);
  for (const ref of allRefs) {
    const pt = parentTables[ref];
    const ct = cloneTables[ref];
    if (!pt || !ct) continue;
    if (pt.defaultValue !== ct.defaultValue) {
      changes.push({ tableRefId: ref, tableName: ct.name, kind: "default-changed", field: "defaultValue", before: pt.defaultValue, after: ct.defaultValue });
    }
    const pByLabel = new Map(pt.rows.map((r) => [r.label, r]));
    const cByLabel = new Map(ct.rows.map((r) => [r.label, r]));
    for (const [label, cr] of cByLabel.entries()) {
      if (!pByLabel.has(label)) {
        changes.push({ tableRefId: ref, tableName: ct.name, kind: "row-added", label });
        continue;
      }
      const pr = pByLabel.get(label);
      if (pr.value !== cr.value) {
        changes.push({ tableRefId: ref, tableName: ct.name, kind: "row-modified", label, field: "value", before: pr.value, after: cr.value });
      }
      if (pr.constraintNote !== cr.constraintNote) {
        changes.push({ tableRefId: ref, tableName: ct.name, kind: "row-modified", label, field: "constraintNote", before: pr.constraintNote, after: cr.constraintNote });
      }
    }
    for (const label of pByLabel.keys()) {
      if (!cByLabel.has(label)) {
        changes.push({ tableRefId: ref, tableName: ct.name, kind: "row-removed", label });
      }
    }
  }
  return changes;
}
function diffForms(parentForms, cloneForms) {
  const changes = [];
  const pByNum = new Map(parentForms.map((f) => [f.number, f]));
  const cByNum = new Map(cloneForms.map((f) => [f.number, f]));
  for (const [num, cf] of cByNum.entries()) {
    const pf = pByNum.get(num);
    if (!pf) continue;
    const fields = ["edition", "status", "category", "description"];
    for (const field of fields) {
      if (pf[field] !== cf[field]) {
        changes.push({ formNumber: num, formName: cf.name, field, before: pf[field], after: cf[field] });
      }
    }
  }
  return changes;
}
function diffProducts(parent, clone) {
  const coverageChanges = diffCoverages(parent.coverages, clone.coverages);
  const rateTableCellChanges = diffRTTables(parent.rtTables, clone.rtTables);
  const ldTableChanges = diffLDTables(parent.ldTables, clone.ldTables);
  const formEditionChanges = diffForms(parent.forms, clone.forms);
  const hasCoverageOptionChanges = coverageChanges.some(
    (c) => c.kind === "modified" && c.termChanges != null && c.termChanges.length > 0
  );
  return {
    cloneRefId: clone.refId,
    parentRefId: parent.refId,
    cloneName: clone.name,
    parentName: parent.name,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    coverageChanges,
    rateTableCellChanges,
    ldTableChanges,
    formEditionChanges,
    summary: {
      coveragesAdded: coverageChanges.filter((c) => c.kind === "added").length,
      coveragesRemoved: coverageChanges.filter((c) => c.kind === "removed").length,
      coveragesModified: coverageChanges.filter((c) => c.kind === "modified").length,
      rateTableCellsChanged: rateTableCellChanges.length,
      ldTableChanges: ldTableChanges.length,
      formEditionChanges: formEditionChanges.length,
      hasRateImpact: rateTableCellChanges.length > 0 || ldTableChanges.length > 0,
      hasFormChanges: formEditionChanges.length > 0,
      hasCoverageOptionChanges
    }
  };
}

// shared/src/serff/redline.ts
function termChangeBlocks(tc) {
  const blocks = [];
  blocks.push({ type: "unchanged", text: `${tc.termLabel} (${tc.termKind})
` });
  for (const fc of tc.fieldChanges) {
    const before = formatValue(fc.before);
    const after = formatValue(fc.after);
    if (before) blocks.push({ type: "del", text: `  ${fc.field}: ${before}
` });
    if (after) blocks.push({ type: "ins", text: `  ${fc.field}: ${after}
` });
  }
  for (const oc of tc.optionSetChanges) {
    if (oc.kind === "added") {
      blocks.push({ type: "ins", text: `  Option ${oc.optionId}: [added]
` });
    } else if (oc.kind === "removed") {
      blocks.push({ type: "del", text: `  Option ${oc.optionId}: [removed]
` });
    } else if (oc.field && oc.before !== void 0 && oc.after !== void 0) {
      blocks.push({ type: "del", text: `  Option ${oc.optionId} ${oc.field}: ${formatValue(oc.before)}
` });
      blocks.push({ type: "ins", text: `  Option ${oc.optionId} ${oc.field}: ${formatValue(oc.after)}
` });
    }
  }
  return blocks;
}
function coverageRedline(cov) {
  const sections = [];
  if (cov.kind === "added") {
    sections.push({
      heading: "Coverage Added",
      blocks: [{ type: "ins", text: `${cov.name} [${cov.refId}] \u2014 new coverage added in this filing.
`, refId: cov.refId }]
    });
  } else if (cov.kind === "removed") {
    sections.push({
      heading: "Coverage Removed",
      blocks: [{ type: "del", text: `${cov.name} [${cov.refId}] \u2014 coverage removed in this filing.
`, refId: cov.refId }]
    });
  } else {
    if (cov.fieldChanges && cov.fieldChanges.length > 0) {
      const fieldBlocks = [{ type: "unchanged", text: `Coverage: ${cov.name} [${cov.refId}]
`, refId: cov.refId }];
      for (const fc of cov.fieldChanges) {
        fieldBlocks.push({ type: "del", text: `  ${fc.field}: ${formatValue(fc.before)}
` });
        fieldBlocks.push({ type: "ins", text: `  ${fc.field}: ${formatValue(fc.after)}
` });
      }
      sections.push({ heading: "Coverage Fields", blocks: fieldBlocks });
    }
    if (cov.termChanges && cov.termChanges.length > 0) {
      const termBlocks = [{ type: "unchanged", text: `Coverage: ${cov.name} [${cov.refId}]
`, refId: cov.refId }];
      for (const tc of cov.termChanges) {
        termBlocks.push(...termChangeBlocks(tc));
      }
      sections.push({ heading: "Terms and Options", blocks: termBlocks });
    }
  }
  return {
    kind: "redline",
    coverageRefId: cov.refId,
    title: `Marked Copy \u2014 Coverage: ${cov.name} [${cov.refId}]`,
    sections
  };
}
function formEditionRedline(fe) {
  return {
    kind: "redline",
    formNumber: fe.formNumber,
    title: `Marked Copy \u2014 Form: ${fe.formNumber} (${fe.formName})`,
    sections: [{
      heading: `Form ${fe.field.charAt(0).toUpperCase() + fe.field.slice(1)} Change`,
      blocks: [
        { type: "unchanged", text: `Form: ${fe.formNumber} \u2014 ${fe.formName}
` },
        { type: "del", text: `  ${fe.field}: ${formatValue(fe.before)}
` },
        { type: "ins", text: `  ${fe.field}: ${formatValue(fe.after)}
` }
      ]
    }]
  };
}
function rateTableRedlines(cells) {
  const byTable = /* @__PURE__ */ new Map();
  for (const c of cells) {
    const list = byTable.get(c.tableRefId) ?? [];
    list.push(c);
    byTable.set(c.tableRefId, list);
  }
  const docs = [];
  for (const [tableRef, tableCells] of byTable.entries()) {
    const tableName = tableCells[0].tableName;
    const sections = [{
      heading: "Rate Factor Changes",
      blocks: tableCells.flatMap((cell) => {
        const keyStr = Object.entries(cell.rowKey).map(([k, v]) => `${k}=${v}`).join(", ");
        const sign = (cell.pctChange ?? 0) >= 0 ? "+" : "";
        const pct = cell.pctChange !== null ? ` (${sign}${cell.pctChange.toFixed(2)}%)` : "";
        return [
          { type: "unchanged", text: `  Row [${keyStr}] column "${cell.column}":
` },
          { type: "del", text: `    Before: ${cell.before}
` },
          { type: "ins", text: `    After:  ${cell.after}${pct}
` }
        ];
      })
    }];
    docs.push({
      kind: "redline",
      title: `Marked Copy \u2014 Rate Table: ${tableName} [${tableRef}]`,
      sections
    });
  }
  return docs;
}
function ldTableRedlines(changes) {
  const byTable = /* @__PURE__ */ new Map();
  for (const c of changes) {
    const list = byTable.get(c.tableRefId) ?? [];
    list.push(c);
    byTable.set(c.tableRefId, list);
  }
  const docs = [];
  for (const [tableRef, tableChanges] of byTable.entries()) {
    const tableName = tableChanges[0].tableName;
    const blocks = [];
    for (const ch of tableChanges) {
      if (ch.kind === "default-changed") {
        blocks.push({ type: "del", text: `  Default value: ${formatValue(ch.before)}
` });
        blocks.push({ type: "ins", text: `  Default value: ${formatValue(ch.after)}
` });
      } else if (ch.kind === "row-added") {
        blocks.push({ type: "ins", text: `  Option row added: "${ch.label}"
` });
      } else if (ch.kind === "row-removed") {
        blocks.push({ type: "del", text: `  Option row removed: "${ch.label}"
` });
      } else {
        blocks.push({ type: "del", text: `  "${ch.label}" ${ch.field}: ${formatValue(ch.before)}
` });
        blocks.push({ type: "ins", text: `  "${ch.label}" ${ch.field}: ${formatValue(ch.after)}
` });
      }
    }
    docs.push({
      kind: "redline",
      title: `Marked Copy \u2014 Limit/Deductible Table: ${tableName} [${tableRef}]`,
      sections: [{ heading: "Option Changes", blocks }]
    });
  }
  return docs;
}
function generateRedlineDocuments(changeset) {
  const docs = [];
  for (const cov of changeset.coverageChanges) docs.push(coverageRedline(cov));
  for (const fe of changeset.formEditionChanges) docs.push(formEditionRedline(fe));
  docs.push(...rateTableRedlines(changeset.rateTableCellChanges));
  docs.push(...ldTableRedlines(changeset.ldTableChanges));
  return docs;
}
function formatValue(v) {
  if (v === null || v === void 0) return "\u2014";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// shared/src/rating/evaluator.ts
function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
function evaluate(program, inputs, rtGetter, ldGetter) {
  const sortedSteps = [...program.steps].sort((a, b) => a.order - b.order);
  let running = 0;
  const trace = [];
  const capEnabled = typeof program.creditFloor === "number" && program.creditFloor > 0;
  const lastCreditIdx = capEnabled ? sortedSteps.reduce((last, s, i) => s.op === "MUL" && isCreditStep(s, inputs) ? i : last, -1) : -1;
  let creditProduct = 1;
  let capApplied = false;
  sortedSteps.forEach((step, idx) => {
    if (step.condition !== void 0 && !inputs[step.condition]) return;
    const { factor, sourceRef } = resolveSource(step, inputs, rtGetter, ldGetter);
    let nextRunning;
    switch (step.op) {
      case "SET":
        nextRunning = factor;
        break;
      case "MUL":
        nextRunning = running * factor;
        break;
      case "ADD":
        nextRunning = running + factor;
        break;
      case "MIN_FLOOR":
        nextRunning = Math.max(running, factor);
        break;
    }
    const didRound = step.roundTo !== void 0;
    if (didRound) nextRunning = round(nextRunning, step.roundTo);
    running = nextRunning;
    trace.push({
      stepId: step.id,
      label: step.label,
      op: step.op,
      sourceRef,
      factorOrAmount: factor,
      rounded: didRound,
      runningTotal: running
    });
    if (capEnabled && step.op === "MUL" && isCreditStep(step, inputs)) creditProduct *= factor;
    if (capEnabled && !capApplied && idx === lastCreditIdx) {
      capApplied = true;
      const floor = program.creditFloor;
      if (creditProduct > 0 && creditProduct < floor) {
        const adjust = floor / creditProduct;
        running *= adjust;
        trace.push({
          stepId: "__credit_cap__",
          label: `Maximum credit cap (floor ${floor})`,
          op: "MUL",
          sourceRef: `CREDIT_CAP(floor=${floor}, credits=${round(creditProduct, 4)})`,
          factorOrAmount: adjust,
          rounded: false,
          runningTotal: running
        });
      }
    }
  });
  return { finalPremium: running, trace };
}
function isCreditStep(step, inputs) {
  if (!step.isCredit) return false;
  if (step.condition !== void 0 && !inputs[step.condition]) return false;
  return true;
}
function resolveSource(step, inputs, rtGetter, ldGetter) {
  const src = step.source;
  switch (src.type) {
    case "CONST":
      return { factor: src.value, sourceRef: `CONST(${src.value})` };
    case "INPUT": {
      const v = inputs[src.ref];
      if (typeof v !== "number") throw new Error(`INPUT '${src.ref}' must be a number, got ${typeof v}`);
      return { factor: v, sourceRef: `INPUT(${src.ref})` };
    }
    case "LD": {
      const selectedValue = inputs[src.keys[0]];
      if (selectedValue === void 0) throw new Error(`LD key '${src.keys[0]}' not found in inputs`);
      const factor = ldGetter(src.ref, selectedValue);
      return { factor, sourceRef: `${src.ref}[${selectedValue}]` };
    }
    case "RT": {
      const queryInputs = {};
      for (const k of src.keys ?? []) queryInputs[k] = inputs[k];
      const factor = rtGetter(src.ref, queryInputs);
      const keyStr = (src.keys ?? []).map((k) => `${k}=${inputs[k]}`).join(",");
      return { factor, sourceRef: `${src.ref}[${keyStr}]` };
    }
    case "SPP": {
      const items = inputs.sppItems ?? [];
      let total = 0;
      for (const item of items) {
        const ratePerHundred = rtGetter(src.ref, { itemClass: item.itemClass });
        total += item.appraisedValue / 100 * ratePerHundred;
      }
      return { factor: total, sourceRef: `SPP(${src.ref})` };
    }
    default:
      throw new Error(`Unknown source type: ${src.type}`);
  }
}

// shared/src/serff/rateExhibit.ts
var HISTOGRAM_BANDS = [
  { label: "Below \u221210%", low: -Infinity, high: -10 },
  { label: "\u221210% to \u22125%", low: -10, high: -5 },
  { label: "\u22125% to 0%", low: -5, high: 0 },
  { label: "0% (no change)", low: 0, high: 0 },
  { label: "0% to +5%", low: 0, high: 5 },
  { label: "+5% to +10%", low: 5, high: 10 },
  { label: "Above +10%", low: 10, high: Infinity }
];
function bucketPct(pct) {
  if (pct === 0) return "0% (no change)";
  for (const b of HISTOGRAM_BANDS) {
    if (pct > b.low && pct <= b.high) return b.label;
    if (b.low === -Infinity && pct <= b.high) return b.label;
  }
  return "Above +10%";
}
function computePremiumImpacts(parentProgram, cloneProgram, parentRtGetter, parentLdGetter, cloneRtGetter, cloneLdGetter, scenarios) {
  return scenarios.map((s) => {
    let before = 0;
    let after = 0;
    try {
      before = evaluate(parentProgram, s.inputs, parentRtGetter, parentLdGetter).finalPremium;
    } catch {
    }
    try {
      after = evaluate(cloneProgram, s.inputs, cloneRtGetter, cloneLdGetter).finalPremium;
    } catch {
    }
    const pctChange = before !== 0 ? (after - before) / Math.abs(before) * 100 : null;
    return { inputLabel: s.label, before, after, pctChange };
  });
}
function buildHistogram(impacts) {
  const counts = {};
  for (const b of HISTOGRAM_BANDS) counts[b.label] = 0;
  for (const row of impacts) {
    if (row.pctChange === null) continue;
    const bucket = bucketPct(row.pctChange);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  const total = impacts.filter((r) => r.pctChange !== null).length || 1;
  return HISTOGRAM_BANDS.map((b) => ({
    band: b.label,
    low: b.low,
    high: b.high,
    count: counts[b.label] ?? 0,
    pctOfTotal: (counts[b.label] ?? 0) / total * 100
  }));
}
function overallImpactPct(impacts) {
  const valid = impacts.filter((r) => r.pctChange !== null && r.before > 0);
  if (valid.length === 0) return null;
  const totalBefore = valid.reduce((s, r) => s + r.before, 0);
  const totalAfter = valid.reduce((s, r) => s + r.after, 0);
  return totalBefore !== 0 ? (totalAfter - totalBefore) / totalBefore * 100 : null;
}
function rtExhibitRows(cells) {
  return cells.map((c) => {
    const keyStr = Object.entries(c.rowKey).map(([k, v]) => `${k}=${v}`).join(", ");
    return {
      label: `${c.tableName} [${c.tableRefId}] \u2014 ${keyStr} \u2014 column "${c.column}"`,
      before: c.before,
      after: c.after,
      pctChange: c.pctChange
    };
  });
}
function ldExhibitRows(changes) {
  return changes.filter((c) => c.kind === "row-modified" && c.field === "value").map((c) => ({
    label: `${c.tableName} [${c.tableRefId}] \u2014 "${c.label}" value`,
    before: c.before ?? 0,
    after: c.after ?? 0,
    pctChange: typeof c.before === "number" && c.before !== 0 ? ((c.after ?? 0) - c.before) / Math.abs(c.before) * 100 : null
  }));
}
function generateRateExhibit(changeset, parentProgram, cloneProgram, parentRtGetter, parentLdGetter, cloneRtGetter, cloneLdGetter, scenarios) {
  const allCells = changeset.rateTableCellChanges;
  const allLD = changeset.ldTableChanges;
  const tableRefId = allCells[0]?.tableRefId ?? allLD[0]?.tableRefId ?? "combined";
  const tableName = allCells[0]?.tableName ?? allLD[0]?.tableName ?? "Rate Changes";
  const rows = [...rtExhibitRows(allCells), ...ldExhibitRows(allLD)];
  const premiumImpacts = computePremiumImpacts(
    parentProgram,
    cloneProgram,
    parentRtGetter,
    parentLdGetter,
    cloneRtGetter,
    cloneLdGetter,
    scenarios
  );
  const histogram = buildHistogram(premiumImpacts);
  const impact = overallImpactPct(premiumImpacts);
  return {
    kind: "rateExhibit",
    tableRefId,
    tableName,
    rows,
    premiumImpacts,
    histogram,
    overallImpactPct: impact !== null ? parseFloat(impact.toFixed(4)) : null
  };
}

// shared/src/serff/memo.ts
function purposeSection(cs) {
  return {
    heading: "Purpose of Filing",
    items: [
      { label: "Product", value: cs.cloneName, citation: `Product refId: ${cs.cloneRefId}` },
      { label: "Parent Product", value: cs.parentName, citation: `Basis: ${cs.parentRefId}` },
      { label: "Filing Basis", value: "Clone-based revision under Texas Insurance Code \xA72251.101 (File-and-Use)", citation: "Texas Ins. Code \xA72251.101" }
    ]
  };
}
function coverageChangesSection(cs) {
  const { coveragesAdded, coveragesRemoved, coveragesModified } = cs.summary;
  if (coveragesAdded + coveragesRemoved + coveragesModified === 0) return null;
  const items = [];
  for (const cov of cs.coverageChanges) {
    if (cov.kind === "added") {
      items.push({ label: `Added: ${cov.name}`, value: `New coverage [${cov.refId}] added in this filing.`, citation: `Coverage refId: ${cov.refId}` });
    } else if (cov.kind === "removed") {
      items.push({ label: `Removed: ${cov.name}`, value: `Coverage [${cov.refId}] removed from the product.`, citation: `Coverage refId: ${cov.refId}` });
    } else {
      const termLabels = (cov.termChanges ?? []).map((tc) => tc.termLabel).join(", ");
      const desc = termLabels ? `Modified terms: ${termLabels}` : "Coverage fields updated.";
      items.push({ label: `Modified: ${cov.name}`, value: desc, citation: `Coverage refId: ${cov.refId}` });
    }
  }
  return { heading: "Coverage Changes", items };
}
function rateChangesSection(cs, overallImpactPct2) {
  if (!cs.summary.hasRateImpact) return null;
  const items = [];
  const tableNames = [...new Set(cs.rateTableCellChanges.map((c) => c.tableName))];
  for (const name of tableNames) {
    const cells = cs.rateTableCellChanges.filter((c) => c.tableName === name);
    items.push({
      label: `Rate Table: ${name}`,
      value: `${cells.length} cell(s) changed.`,
      citation: `Table refId: ${cells[0].tableRefId}`
    });
  }
  const ldTableNames = [...new Set(cs.ldTableChanges.map((c) => c.tableName))];
  for (const name of ldTableNames) {
    items.push({ label: `Limit/Deductible Table: ${name}`, value: "Option values or defaults changed.", citation: `Table: ${name}` });
  }
  if (overallImpactPct2 !== null) {
    const sign = overallImpactPct2 >= 0 ? "+" : "";
    items.push({
      label: "Overall Rate Level Impact",
      value: `${sign}${overallImpactPct2.toFixed(2)}% (exposure-weighted average across representative policyholders)`,
      citation: "28 Tex. Admin. Code \xA75.9334(d)"
    });
  }
  return { heading: "Rate Changes", items };
}
function formChangesSection(cs) {
  if (!cs.summary.hasFormChanges) return null;
  const items = cs.formEditionChanges.map((fe) => ({
    label: `Form ${fe.formNumber}: ${fe.formName}`,
    value: `${fe.field} changed from "${fe.before}" to "${fe.after}".`,
    citation: `Form number: ${fe.formNumber}; 28 Tex. Admin. Code \xA75.9327`
  }));
  return { heading: "Form Changes", items };
}
function regulatoryComplianceSection(_stateCode) {
  return {
    heading: "Regulatory Compliance",
    items: [
      {
        label: "Filing Type",
        value: "File-and-Use \u2014 rates effective upon filing.",
        citation: "Texas Insurance Code \xA72251.101"
      },
      {
        label: "Commissioner Review Period",
        value: "The Commissioner may disapprove within 30 days of filing under \xA72251.102.",
        citation: "Texas Insurance Code \xA72251.102"
      },
      {
        label: "Marked Copies",
        value: "Marked copies of all changed forms are included under the Supporting Documentation tab.",
        citation: "28 Tex. Admin. Code \xA75.9327"
      }
    ]
  };
}
function buildMemoStructure(changeset, overallImpactPct2, stateCode = "TX") {
  const sections = [purposeSection(changeset)];
  const covSec = coverageChangesSection(changeset);
  const rateSec = rateChangesSection(changeset, overallImpactPct2);
  const frmSec = formChangesSection(changeset);
  const regSec = regulatoryComplianceSection(stateCode);
  if (covSec) sections.push(covSec);
  if (rateSec) sections.push(rateSec);
  if (frmSec) sections.push(frmSec);
  sections.push(regSec);
  return {
    kind: "memo",
    productName: changeset.cloneName,
    filingType: "File-and-Use (Texas Insurance Code \xA72251.101)",
    overallImpactPct: overallImpactPct2,
    sections,
    citations: [
      "Texas Insurance Code Chapter 2251 (File-and-Use)",
      "28 Tex. Admin. Code \xA75.9327 (Marked Copies)",
      "28 Tex. Admin. Code \xA75.9334 (Filing Memorandum)",
      "28 Tex. Admin. Code \xA75.9334(d) (Rate Indication and Relativity Analysis)"
    ]
  };
}

// shared/src/serff/bundle.ts
function redlineDoc(rd) {
  return {
    title: rd.title,
    tabName: "SupportingDocumentation",
    grouping: "MarkedCopies",
    documentType: "redline",
    refIds: [rd.coverageRefId ?? rd.formNumber ?? "unknown"].filter(Boolean),
    content: rd
  };
}
function rateExhibitDoc(re) {
  return {
    title: `Rate Exhibit \u2014 ${re.tableName} (Before/After)`,
    tabName: "RateRuleSchedule",
    grouping: "RateExhibits",
    documentType: "rateExhibit",
    refIds: [re.tableRefId],
    content: re
  };
}
function memoDoc(memo) {
  return {
    title: `Explanation of Changes \u2014 ${memo.productName}`,
    tabName: "SupportingDocumentation",
    grouping: "FilingMemorandum",
    documentType: "memo",
    refIds: [],
    content: memo
  };
}
function cleanFormPlaceholder(formNumber, formName) {
  return {
    title: `Filed Form \u2014 ${formNumber} (${formName})`,
    tabName: "FormSchedule",
    grouping: "FiledForms",
    documentType: "cleanForm",
    refIds: [formNumber],
    content: `Clean copy of form ${formNumber} \u2014 ${formName}. Attach PDF of the final approved form text.`
  };
}
function generalInfoDoc(cs, state, filingId) {
  const content = [
    `Filing ID: ${filingId}`,
    `State: ${state}`,
    `Filing Type: File-and-Use (Texas Insurance Code \xA72251.101)`,
    `Product: ${cs.cloneName} [${cs.cloneRefId}]`,
    `Based On: ${cs.parentName} [${cs.parentRefId}]`,
    `Generated: ${cs.generatedAt}`,
    `Changes: ${cs.summary.coveragesAdded} added, ${cs.summary.coveragesRemoved} removed, ${cs.summary.coveragesModified} modified coverages; ${cs.summary.rateTableCellsChanged} rate cells changed; ${cs.summary.formEditionChanges} form edition changes.`
  ].join("\n");
  return {
    title: "General Information",
    tabName: "GeneralInformation",
    grouping: "GeneralInfo",
    documentType: "other",
    refIds: [cs.cloneRefId],
    content
  };
}
function assembleSerffBundle(input) {
  const { filingId, state, productRefId, productName, changeset, redlines, rateExhibit, memo } = input;
  const documents = [];
  documents.push(generalInfoDoc(changeset, state, filingId));
  if (rateExhibit && changeset.summary.hasRateImpact) {
    documents.push(rateExhibitDoc(rateExhibit));
  }
  for (const fe of changeset.formEditionChanges) {
    documents.push(cleanFormPlaceholder(fe.formNumber, fe.formName));
  }
  for (const rd of redlines) documents.push(redlineDoc(rd));
  documents.push(memoDoc(memo));
  return {
    filingId,
    state,
    filingType: "file-and-use",
    productRefId,
    productName,
    changeSet: changeset,
    documents,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function documentsInTab(bundle, tab) {
  return bundle.documents.filter((d) => d.tabName === tab);
}

// shared/src/serff/reviewer.ts
var KNOWN_GAPS = [
  "Actuarial certification: The lens does not verify that a licensed P&C actuary signed the rate indication. TDI may require an actuarial opinion for significant rate changes (28 TAC \xA75.9334(d)). The bundle must include an actuarial memo if requested.",
  "Comparison to TDI-filed version: Redlines generated by this system compare the clone to its immediate parent product in this platform. TDI examiners compare to the LAST APPROVED VERSION in the SERFF system, which may differ from the parent product here. Verify that the marked copies accurately reflect changes from the TDI-approved base.",
  "Overall impact percentage validation: The lens checks that an overall rate impact is stated but does not validate that the percentage is actuarially supported or that the relativity analysis methodology is technically adequate (28 TAC \xA75.9334(d)).",
  "Effective date compliance: Texas \xA72251.101 requires the filing to be received by TDI before the effective date of the change. The lens does not verify this timing constraint.",
  "Coverage amount reasonableness: TDI may reject rates that are significantly outside approved bands for the line of business. The lens checks structure, not rate adequacy.",
  "Mandatory endorsement compliance: If the filing removes a form that is mandatory under a TDI rule or prior order, TDI would flag that. The lens does not track mandatory endorsement obligations.",
  "SERFF filing type / company licensure: The lens does not verify that the filing company is licensed in Texas for the line of business being filed."
];
var CHECKS = [
  // ── Check 1: Supporting Documentation tab exists ─────────────────────────────
  {
    id: "TX-01",
    label: "Supporting Documentation tab present",
    citation: "SERFF Filings Made Easy guide (TDI edition) \u2014 required tab",
    tab: "SupportingDocumentation",
    fn: (b) => {
      const hasDocs = b.documents.some((d) => d.tabName === "SupportingDocumentation");
      return {
        passed: hasDocs,
        tab: "SupportingDocumentation",
        finding: hasDocs ? void 0 : {
          message: "The Supporting Documentation tab contains no documents.",
          citation: "SERFF Filings Made Easy guide (TDI edition)",
          severity: "error",
          tab: "SupportingDocumentation"
        }
      };
    }
  },
  // ── Check 2: Marked copies present under Supporting Documentation ─────────────
  {
    id: "TX-02",
    label: "Marked (redline) copies present in Supporting Documentation",
    citation: "28 Tex. Admin. Code \xA75.9327 \u2014 marked copies required",
    tab: "SupportingDocumentation",
    fn: (b) => {
      const hasRedlines = b.documents.some(
        (d) => d.tabName === "SupportingDocumentation" && d.grouping === "MarkedCopies" && d.documentType === "redline"
      );
      const hasChanges = b.changeSet.summary.coveragesAdded + b.changeSet.summary.coveragesRemoved + b.changeSet.summary.coveragesModified + b.changeSet.summary.rateTableCellsChanged + b.changeSet.summary.ldTableChanges + b.changeSet.summary.formEditionChanges > 0;
      const passed = !hasChanges || hasRedlines;
      return {
        passed,
        tab: "SupportingDocumentation",
        finding: passed ? void 0 : {
          message: "Changes were made but no marked (redline) copies are present under Supporting Documentation \u2192 Marked Copies.",
          citation: "28 Tex. Admin. Code \xA75.9327",
          severity: "error",
          tab: "SupportingDocumentation"
        }
      };
    }
  },
  // ── Check 3: Each changed form has a marked copy ──────────────────────────────
  {
    id: "TX-03",
    label: "Each changed form has a corresponding marked copy",
    citation: "28 Tex. Admin. Code \xA75.9327(b) \u2014 one marked copy per changed form",
    tab: "SupportingDocumentation",
    fn: (b) => {
      const changedForms = b.changeSet.formEditionChanges.map((fe) => fe.formNumber);
      const redlineFormNums = b.documents.filter((d) => d.tabName === "SupportingDocumentation" && d.documentType === "redline" && d.refIds.some((r) => changedForms.includes(r))).flatMap((d) => d.refIds);
      const missing = changedForms.filter((fn) => !redlineFormNums.includes(fn));
      const passed = missing.length === 0;
      return {
        passed,
        tab: "SupportingDocumentation",
        finding: passed ? void 0 : {
          message: `Changed form(s) missing marked copies: ${missing.join(", ")}. Each changed form must have a redline copy in Supporting Documentation.`,
          citation: "28 Tex. Admin. Code \xA75.9327(b)",
          severity: "error",
          tab: "SupportingDocumentation",
          refId: missing[0]
        }
      };
    }
  },
  // ── Check 4: Filing memorandum present ───────────────────────────────────────
  {
    id: "TX-04",
    label: "Filing memorandum present in Supporting Documentation",
    citation: "28 Tex. Admin. Code \xA75.9334 \u2014 explanation-of-changes memo required",
    tab: "SupportingDocumentation",
    fn: (b) => {
      const hasMemo = b.documents.some(
        (d) => d.tabName === "SupportingDocumentation" && d.documentType === "memo"
      );
      return {
        passed: hasMemo,
        tab: "SupportingDocumentation",
        finding: hasMemo ? void 0 : {
          message: "No filing memorandum found under Supporting Documentation. Texas requires an explanation-of-changes memo per 28 TAC \xA75.9334.",
          citation: "28 Tex. Admin. Code \xA75.9334",
          severity: "error",
          tab: "SupportingDocumentation"
        }
      };
    }
  },
  // ── Check 5: Filing memo includes an overall rate impact statement ───────────
  {
    id: "TX-05",
    label: "Filing memorandum includes overall rate impact statement",
    citation: "28 Tex. Admin. Code \xA75.9334(d) \u2014 overall impact percentage required when rates change",
    tab: "SupportingDocumentation",
    fn: (b) => {
      if (!b.changeSet.summary.hasRateImpact) return { passed: true, tab: "SupportingDocumentation" };
      const memoDoc2 = b.documents.find((d) => d.tabName === "SupportingDocumentation" && d.documentType === "memo");
      if (!memoDoc2) return {
        passed: false,
        tab: "SupportingDocumentation",
        finding: {
          message: "Rate changes exist but no memo is present to carry the overall impact statement.",
          citation: "28 Tex. Admin. Code \xA75.9334(d)",
          severity: "error",
          tab: "SupportingDocumentation"
        }
      };
      const memo = typeof memoDoc2.content === "object" && memoDoc2.content.kind === "memo" ? memoDoc2.content : null;
      const hasImpact = memo !== null && memo.overallImpactPct !== null && memo.overallImpactPct !== void 0;
      return {
        passed: hasImpact,
        tab: "SupportingDocumentation",
        finding: hasImpact ? void 0 : {
          message: "The filing memorandum does not include an overall rate impact percentage. \xA75.9334(d) requires this when rates change.",
          citation: "28 Tex. Admin. Code \xA75.9334(d)",
          severity: "error",
          tab: "SupportingDocumentation"
        }
      };
    }
  },
  // ── Check 6: Rate exhibits in Rate/Rule Schedule when rates changed ───────────
  {
    id: "TX-06",
    label: "Before-and-after rate exhibits present when rates are changed",
    citation: "28 Tex. Admin. Code \xA75.9334(d) \u2014 rate indication and relativity analysis required",
    tab: "RateRuleSchedule",
    fn: (b) => {
      if (!b.changeSet.summary.hasRateImpact) return { passed: true, tab: "RateRuleSchedule" };
      const hasExhibit = b.documents.some(
        (d) => d.tabName === "RateRuleSchedule" && d.documentType === "rateExhibit"
      );
      return {
        passed: hasExhibit,
        tab: "RateRuleSchedule",
        finding: hasExhibit ? void 0 : {
          message: "Rate changes exist but no before-and-after rate exhibit is present in the Rate/Rule Schedule tab. \xA75.9334(d) requires rate indication and relativity analyses.",
          citation: "28 Tex. Admin. Code \xA75.9334(d)",
          severity: "error",
          tab: "RateRuleSchedule"
        }
      };
    }
  },
  // ── Check 7: Form Schedule present when forms changed ─────────────────────────
  {
    id: "TX-07",
    label: "Form Schedule (clean forms) present when forms are changed",
    citation: "SERFF Filings Made Easy guide (TDI edition) \u2014 Form Schedule tab required for form filings",
    tab: "FormSchedule",
    fn: (b) => {
      if (!b.changeSet.summary.hasFormChanges) return { passed: true, tab: "FormSchedule" };
      const hasCleanForms = b.documents.some(
        (d) => d.tabName === "FormSchedule" && d.documentType === "cleanForm"
      );
      return {
        passed: hasCleanForms,
        tab: "FormSchedule",
        finding: hasCleanForms ? void 0 : {
          message: "Form changes exist but no clean (final) copies appear in the Form Schedule tab.",
          citation: "SERFF Filings Made Easy guide (TDI edition)",
          severity: "error",
          tab: "FormSchedule"
        }
      };
    }
  },
  // ── Check 8: General Information tab present ──────────────────────────────────
  {
    id: "TX-08",
    label: "General Information tab present",
    citation: "SERFF Filings Made Easy guide (TDI edition) \u2014 required tab",
    tab: "GeneralInformation",
    fn: (b) => {
      const has = b.documents.some((d) => d.tabName === "GeneralInformation");
      return {
        passed: has,
        tab: "GeneralInformation",
        finding: has ? void 0 : {
          message: "General Information tab is missing.",
          citation: "SERFF Filings Made Easy guide (TDI edition)",
          severity: "warning",
          tab: "GeneralInformation"
        }
      };
    }
  }
];
function checkTexasBundle(bundle) {
  const checklist = [];
  const findings = [];
  for (const check of CHECKS) {
    const result = check.fn(bundle);
    const item = {
      id: check.id,
      label: check.label,
      citation: check.citation,
      tab: check.tab,
      passed: result.passed,
      finding: result.finding
    };
    checklist.push(item);
    if (result.finding) findings.push(result.finding);
  }
  const passed = findings.filter((f) => f.severity === "error").length === 0;
  return {
    state: "TX",
    bundleId: bundle.filingId,
    checklist,
    findings,
    passed,
    knownGaps: KNOWN_GAPS,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// shared/src/registry/stateFilingMatrix.ts
var TEXAS_FILING_PROFILE = {
  stateCode: "TX",
  stateName: "Texas",
  filingType: "file-and-use",
  serffEnabled: true,
  source: "Texas Insurance Code \xA72251.101; 28 Tex. Admin. Code \xA7\xA75.9327, 5.9334",
  note: "File-and-use under Chapter 2251. Rates become effective upon filing. Commissioner may disapprove within 30 days under \xA72251.102. Supporting Documentation tab must include marked copies and filing memorandum per 28 TAC \xA75.9334.",
  effectiveDateConstraint: "Rates may be used immediately upon filing. The filing must be received by TDI before the effective date of the change.",
  serffTabs: {
    requiresMarkedCopies: true,
    // 28 TAC §5.9327
    requiresActuarialMemo: false,
    // not required for non-commercial lines unless requested
    requiresRelativities: true,
    // 28 TAC §5.9334(d) — rate indication and relativity analysis
    requiresCleanForms: true,
    // SERFF Form Schedule tab
    requiresRateExhibits: true
    // 28 TAC §5.9334(d) — before-and-after exhibits
  }
};
var STUB_TABS = {
  requiresMarkedCopies: true,
  requiresActuarialMemo: false,
  requiresRelativities: false,
  requiresCleanForms: true,
  requiresRateExhibits: false
};
var STATE_FILING_MATRIX = {
  TX: TEXAS_FILING_PROFILE,
  // ── Prior-approval states ────────────────────────────────────────────────
  AL: { stateCode: "AL", stateName: "Alabama", filingType: "prior-approval", serffEnabled: true, source: "Ala. Code \xA727-13-1 et seq.", serffTabs: STUB_TABS },
  AK: { stateCode: "AK", stateName: "Alaska", filingType: "prior-approval", serffEnabled: true, source: "AS \xA721.39.080", serffTabs: STUB_TABS },
  DC: { stateCode: "DC", stateName: "District of Columbia", filingType: "prior-approval", serffEnabled: true, source: "D.C. Code \xA731-2703", serffTabs: STUB_TABS },
  FL: { stateCode: "FL", stateName: "Florida", filingType: "prior-approval", serffEnabled: true, source: "Fla. Stat. \xA7627.062", note: "Prior approval; OIR review within 90 days.", serffTabs: STUB_TABS },
  GA: { stateCode: "GA", stateName: "Georgia", filingType: "file-and-use", serffEnabled: true, source: "O.C.G.A. \xA733-9-21", serffTabs: STUB_TABS },
  HI: { stateCode: "HI", stateName: "Hawaii", filingType: "prior-approval", serffEnabled: true, source: "Haw. Rev. Stat. \xA7431:14-104", serffTabs: STUB_TABS },
  ID: { stateCode: "ID", stateName: "Idaho", filingType: "file-and-use", serffEnabled: true, source: "Idaho Code \xA741-1408", serffTabs: STUB_TABS },
  IL: {
    stateCode: "IL",
    stateName: "Illinois",
    filingType: "prior-approval",
    serffEnabled: true,
    source: "215 ILCS 5/155.04",
    note: "Prior approval. SB714/HB4273 may alter the regime effective July 1, 2027 \u2014 verify with Illinois DOI before that date.",
    pendingLegislationEffective: "2027-07-01",
    serffTabs: STUB_TABS
  },
  IN: { stateCode: "IN", stateName: "Indiana", filingType: "file-and-use", serffEnabled: true, source: "Ind. Code \xA727-1-22-2", serffTabs: STUB_TABS },
  IA: { stateCode: "IA", stateName: "Iowa", filingType: "file-and-use", serffEnabled: true, source: "Iowa Code \xA7515.72", serffTabs: STUB_TABS },
  KS: { stateCode: "KS", stateName: "Kansas", filingType: "file-and-use", serffEnabled: true, source: "Kan. Stat. \xA740-955", serffTabs: STUB_TABS },
  KY: { stateCode: "KY", stateName: "Kentucky", filingType: "file-and-use", serffEnabled: true, source: "Ky. Rev. Stat. \xA7304.13-051", serffTabs: STUB_TABS },
  LA: { stateCode: "LA", stateName: "Louisiana", filingType: "prior-approval", serffEnabled: true, source: "La. R.S. \xA722:1452", serffTabs: STUB_TABS },
  ME: { stateCode: "ME", stateName: "Maine", filingType: "file-and-use", serffEnabled: true, source: "Me. Rev. Stat. tit. 24-A \xA72303", serffTabs: STUB_TABS },
  MD: { stateCode: "MD", stateName: "Maryland", filingType: "prior-approval", serffEnabled: true, source: "Md. Code Ins. \xA711-307", serffTabs: STUB_TABS },
  MA: { stateCode: "MA", stateName: "Massachusetts", filingType: "prior-approval", serffEnabled: true, source: "Mass. Gen. Laws ch. 175A \xA74", serffTabs: STUB_TABS },
  MI: { stateCode: "MI", stateName: "Michigan", filingType: "prior-approval", serffEnabled: true, source: "Mich. Comp. Laws \xA7500.2111", serffTabs: STUB_TABS },
  MN: { stateCode: "MN", stateName: "Minnesota", filingType: "file-and-use", serffEnabled: true, source: "Minn. Stat. \xA770A.04", serffTabs: STUB_TABS },
  MS: { stateCode: "MS", stateName: "Mississippi", filingType: "file-and-use", serffEnabled: true, source: "Miss. Code \xA783-2-5", serffTabs: STUB_TABS },
  MO: { stateCode: "MO", stateName: "Missouri", filingType: "file-and-use", serffEnabled: true, source: "Mo. Rev. Stat. \xA7379.318", serffTabs: STUB_TABS },
  MT: { stateCode: "MT", stateName: "Montana", filingType: "prior-approval", serffEnabled: true, source: "Mont. Code \xA733-16-107", serffTabs: STUB_TABS },
  NE: { stateCode: "NE", stateName: "Nebraska", filingType: "file-and-use", serffEnabled: true, source: "Neb. Rev. Stat. \xA744-7501", serffTabs: STUB_TABS },
  NV: { stateCode: "NV", stateName: "Nevada", filingType: "prior-approval", serffEnabled: true, source: "Nev. Rev. Stat. \xA7681B.090", serffTabs: STUB_TABS },
  NH: { stateCode: "NH", stateName: "New Hampshire", filingType: "file-and-use", serffEnabled: true, source: "N.H. Rev. Stat. \xA7412:15", serffTabs: STUB_TABS },
  NJ: { stateCode: "NJ", stateName: "New Jersey", filingType: "prior-approval", serffEnabled: true, source: "N.J. Stat. \xA717:29A-6", serffTabs: STUB_TABS },
  NM: { stateCode: "NM", stateName: "New Mexico", filingType: "file-and-use", serffEnabled: true, source: "N.M. Stat. \xA759A-17-9", serffTabs: STUB_TABS },
  NY: { stateCode: "NY", stateName: "New York", filingType: "prior-approval", serffEnabled: true, source: "N.Y. Ins. Law \xA72305", serffTabs: STUB_TABS },
  NC: { stateCode: "NC", stateName: "North Carolina", filingType: "prior-approval", serffEnabled: true, source: "N.C. Gen. Stat. \xA758-40-10", serffTabs: STUB_TABS },
  ND: { stateCode: "ND", stateName: "North Dakota", filingType: "file-and-use", serffEnabled: true, source: "N.D. Cent. Code \xA726.1-25-08", serffTabs: STUB_TABS },
  OH: { stateCode: "OH", stateName: "Ohio", filingType: "file-and-use", serffEnabled: true, source: "Ohio Rev. Code \xA73937.01", serffTabs: STUB_TABS },
  OK: { stateCode: "OK", stateName: "Oklahoma", filingType: "prior-approval", serffEnabled: true, source: "Okla. Stat. tit. 36 \xA7921", serffTabs: STUB_TABS },
  OR: { stateCode: "OR", stateName: "Oregon", filingType: "file-and-use", serffEnabled: true, source: "Or. Rev. Stat. \xA7737.310", serffTabs: STUB_TABS },
  PA: { stateCode: "PA", stateName: "Pennsylvania", filingType: "file-and-use", serffEnabled: true, source: "40 Pa. Stat. \xA71008.31", serffTabs: STUB_TABS },
  RI: { stateCode: "RI", stateName: "Rhode Island", filingType: "prior-approval", serffEnabled: true, source: "R.I. Gen. Laws \xA727-9-21", serffTabs: STUB_TABS },
  SC: { stateCode: "SC", stateName: "South Carolina", filingType: "prior-approval", serffEnabled: true, source: "S.C. Code \xA738-73-10", serffTabs: STUB_TABS },
  SD: { stateCode: "SD", stateName: "South Dakota", filingType: "file-and-use", serffEnabled: true, source: "S.D. Codified Laws \xA758-17-12", serffTabs: STUB_TABS },
  TN: { stateCode: "TN", stateName: "Tennessee", filingType: "file-and-use", serffEnabled: true, source: "Tenn. Code \xA756-5-106", serffTabs: STUB_TABS },
  UT: { stateCode: "UT", stateName: "Utah", filingType: "file-and-use", serffEnabled: true, source: "Utah Code \xA731A-19a-204", serffTabs: STUB_TABS },
  VT: { stateCode: "VT", stateName: "Vermont", filingType: "prior-approval", serffEnabled: true, source: "8 V.S.A. \xA74684", serffTabs: STUB_TABS },
  VA: { stateCode: "VA", stateName: "Virginia", filingType: "file-and-use", serffEnabled: true, source: "Va. Code \xA738.2-1916", serffTabs: STUB_TABS },
  WA: { stateCode: "WA", stateName: "Washington", filingType: "prior-approval", serffEnabled: true, source: "Wash. Rev. Code \xA748.18.100", serffTabs: STUB_TABS },
  WV: { stateCode: "WV", stateName: "West Virginia", filingType: "prior-approval", serffEnabled: true, source: "W. Va. Code \xA733-20-3", serffTabs: STUB_TABS },
  WI: { stateCode: "WI", stateName: "Wisconsin", filingType: "file-and-use", serffEnabled: true, source: "Wis. Stat. \xA7625.11", serffTabs: STUB_TABS },
  WY: { stateCode: "WY", stateName: "Wyoming", filingType: "file-and-use", serffEnabled: true, source: "Wyo. Stat. \xA726-6-102", serffTabs: STUB_TABS },
  AR: { stateCode: "AR", stateName: "Arkansas", filingType: "file-and-use", serffEnabled: true, source: "Ark. Code \xA723-67-217", serffTabs: STUB_TABS },
  AZ: { stateCode: "AZ", stateName: "Arizona", filingType: "file-and-use", serffEnabled: true, source: "Ariz. Rev. Stat. \xA720-386", serffTabs: STUB_TABS },
  CA: { stateCode: "CA", stateName: "California", filingType: "prior-approval", serffEnabled: true, source: "Cal. Ins. Code \xA71861.01 (Prop 103)", note: "Prior approval under Prop 103; CDI review required.", serffTabs: STUB_TABS },
  CO: { stateCode: "CO", stateName: "Colorado", filingType: "file-and-use", serffEnabled: true, source: "Colo. Rev. Stat. \xA710-4-403", serffTabs: STUB_TABS },
  CT: { stateCode: "CT", stateName: "Connecticut", filingType: "file-and-use", serffEnabled: true, source: "Conn. Gen. Stat. \xA738a-688", serffTabs: STUB_TABS },
  DE: { stateCode: "DE", stateName: "Delaware", filingType: "file-and-use", serffEnabled: true, source: "Del. Code tit. 18 \xA72504", serffTabs: STUB_TABS }
};
function getStateProfile(stateCode) {
  return STATE_FILING_MATRIX[stateCode.toUpperCase()] ?? null;
}
function requiresMarkedCopies(stateCode) {
  return getStateProfile(stateCode)?.serffTabs?.requiresMarkedCopies ?? true;
}
function requiresRateExhibits(stateCode) {
  return getStateProfile(stateCode)?.serffTabs?.requiresRateExhibits ?? false;
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
function toDisplay(v) {
  return v === null || v === void 0 ? "" : String(v);
}
function genericRtLookup(t, q) {
  const dims = t.dimensions;
  if (!dims || dims.length === 0) return null;
  if (!dims.every((d) => d.key in q)) return null;
  const vc = t.valueColumn ?? inferValueColumn(t);
  if (!vc) return null;
  const row = t.rows.find((r) => dims.every((d) => toDisplay(r[d.key]) === toDisplay(q[d.key])));
  if (!row) return null;
  const v = row[vc];
  return typeof v === "number" ? v : null;
}

// shared/src/rating/ldGetter.ts
function makeLdGetter(tables) {
  return (tableRef, selectedValue) => {
    const t = tables[tableRef];
    if (!t) throw new Error(`LD table not found: ${tableRef}`);
    const row = t.rows.find((r) => r.value === selectedValue || r.label === selectedValue);
    if (!row) throw new Error(`${tableRef}: no option matching '${selectedValue}'`);
    return row.value;
  };
}

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
function makePHRtGetter(tables) {
  return (tableRef, q) => {
    const t = tables[tableRef];
    if (!t) throw new Error(`RT table not found: ${tableRef}`);
    const generic = genericRtLookup(t, q);
    if (generic !== null) return generic;
    const rows = t.rows;
    switch (tableRef) {
      case "PH.RT.001": {
        const r = rows.find((r2) => r2["territory"] === q["territory"]);
        if (!r) throw new Error(`PH.RT.001: no row for territory=${q["territory"]}`);
        return r["rate"];
      }
      case "PH.RT.002": {
        const pc = q["pc"];
        const constr = q["construction"];
        const r = rows.find((r2) => r2["pcMin"] <= pc && pc <= r2["pcMax"]);
        if (!r) throw new Error(`PH.RT.002: no row for pc=${pc}`);
        const f = r[constr];
        if (typeof f !== "number") throw new Error(`PH.RT.002: unknown construction=${constr}`);
        return f;
      }
      case "PH.RT.003": {
        const covA = q["covA"];
        const exact = rows.find((r) => r["covA"] === covA);
        if (exact) return exact["factor"];
        const top = rows.reduce((hi, r) => r["covA"] > hi["covA"] ? r : hi);
        const topCovA = top["covA"];
        if (covA > topCovA) {
          return top["factor"] + Math.ceil((covA - topCovA) / 1e5) * 0.32;
        }
        throw new Error(`PH.RT.003: no row for covA=${covA}`);
      }
      case "PH.RT.004": {
        if ("allPerilDed" in q) {
          const r = rows.find((r2) => r2["subTable"] === "allPeril" && r2["key"] === q["allPerilDed"]);
          if (!r) throw new Error(`PH.RT.004: no allPeril row for ded=${q["allPerilDed"]}`);
          return r["factor"];
        }
        if ("windHailPct" in q) {
          const r = rows.find((r2) => r2["subTable"] === "windHail" && r2["key"] === q["windHailPct"]);
          if (!r) throw new Error(`PH.RT.004: no windHail row for pct=${q["windHailPct"]}`);
          return r["factor"];
        }
        throw new Error("PH.RT.004: query must include allPerilDed or windHailPct");
      }
      case "PH.RT.005": {
        const r = rows.find((r2) => r2["covCPct"] === q["covCPct"]);
        if (!r) throw new Error(`PH.RT.005: no row for covCPct=${q["covCPct"]}`);
        return r["factor"];
      }
      case "PH.RT.006": {
        if ("covELimit" in q) {
          const r = rows.find((r2) => r2["limType"] === "E" && r2["limit"] === q["covELimit"]);
          if (!r) throw new Error(`PH.RT.006: no E row for limit=${q["covELimit"]}`);
          return r["charge"];
        }
        if ("covFLimit" in q) {
          const r = rows.find((r2) => r2["limType"] === "F" && r2["limit"] === q["covFLimit"]);
          if (!r) throw new Error(`PH.RT.006: no F row for limit=${q["covFLimit"]}`);
          return r["charge"];
        }
        throw new Error("PH.RT.006: query must include covELimit or covFLimit");
      }
      case "PH.RT.007": {
        const r = rows.find((r2) => r2["itemClass"] === q["itemClass"]);
        if (!r) throw new Error(`PH.RT.007: unknown itemClass=${q["itemClass"]}`);
        return r["ratePerHundred"];
      }
      case "PH.RT.008": {
        const r = rows.find((r2) => r2["deviceCredit"] === q["deviceCredit"]);
        if (!r) throw new Error(`PH.RT.008: unknown deviceCredit=${q["deviceCredit"]}`);
        return r["factor"];
      }
      case "PH.RT.009": {
        const r = rows.find((r2) => r2["tier"] === q["tier"]);
        if (!r) throw new Error(`PH.RT.009: unknown tier=${q["tier"]}`);
        return r["factor"];
      }
      case "PH.RT.010": {
        const r = rows.find((r2) => r2["limit"] === q["waterBackupLimit"]);
        if (!r) throw new Error(`PH.RT.010: no row for limit=${q["waterBackupLimit"]}`);
        return r["flatPremium"];
      }
      default:
        throw new Error(`No lookup implementation for RT table: ${tableRef}`);
    }
  };
}
var makePHLdGetter = makeLdGetter;
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
var PH_WORKED_EXAMPLE = {
  territory: "T002",
  pc: 5,
  construction: "M",
  covA: 4e5,
  allPerilDed: 1e3,
  windHailElected: false,
  windHailPct: void 0,
  covCPct: 70,
  covELimit: 3e5,
  covFLimit: 2e3,
  rcElected: true,
  deviceCredit: "none",
  tier: "B",
  waterBackupElected: true,
  waterBackupLimit: 5e3,
  sppElected: true,
  sppItems: [{ itemClass: "Jewelry", appraisedValue: 15e3 }]
};

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
function makePARtGetter(tables) {
  return (tableRef, q) => {
    const t = tables[tableRef];
    if (!t) throw new Error(`RT table not found: ${tableRef}`);
    const generic = genericRtLookup(t, q);
    if (generic !== null) return generic;
    const rows = t.rows;
    switch (tableRef) {
      case "PA.RT.001": {
        const r = rows.find((r2) => r2["territory"] === q["territory"]);
        if (!r) throw new Error(`PA.RT.001: no row for territory=${q["territory"]}`);
        return r["rate"];
      }
      case "PA.RT.002": {
        const r = rows.find((r2) => r2["driverClass"] === q["driverClass"]);
        if (!r) throw new Error(`PA.RT.002: no row for driverClass=${q["driverClass"]}`);
        return r["factor"];
      }
      case "PA.RT.003": {
        const r = rows.find((r2) => r2["biPdLimitCode"] === q["biPdLimitCode"]);
        if (!r) throw new Error(`PA.RT.003: no row for biPdLimitCode=${q["biPdLimitCode"]}`);
        return r["factor"];
      }
      case "PA.RT.004": {
        const r = rows.find((r2) => r2["vehicleAgeClass"] === q["vehicleAgeClass"]);
        if (!r) throw new Error(`PA.RT.004: no row for vehicleAgeClass=${q["vehicleAgeClass"]}`);
        return r["factor"];
      }
      case "PA.RT.005": {
        const r = rows.find((r2) => r2["territory"] === q["territory"]);
        if (!r) throw new Error(`PA.RT.005: no row for territory=${q["territory"]}`);
        return r["rate"];
      }
      case "PA.RT.006": {
        const r = rows.find((r2) => r2["territory"] === q["territory"]);
        if (!r) throw new Error(`PA.RT.006: no row for territory=${q["territory"]}`);
        return r["rate"];
      }
      case "PA.RT.007": {
        const r = rows.find((r2) => r2["vehicleSymbol"] === q["vehicleSymbol"] && r2["collisionDed"] === q["collisionDed"]);
        if (!r) throw new Error(`PA.RT.007: no row for symbol=${q["vehicleSymbol"]} ded=${q["collisionDed"]}`);
        return r["premium"];
      }
      case "PA.RT.008": {
        const r = rows.find((r2) => r2["vehicleSymbol"] === q["vehicleSymbol"] && r2["compDed"] === q["compDed"]);
        if (!r) throw new Error(`PA.RT.008: no row for symbol=${q["vehicleSymbol"]} ded=${q["compDed"]}`);
        return r["premium"];
      }
      case "PA.RT.009": {
        const r = rows.find((r2) => r2["tier"] === q["tier"]);
        if (!r) throw new Error(`PA.RT.009: no row for tier=${q["tier"]}`);
        return r["factor"];
      }
      case "PA.RT.010": {
        const r = rows.find((r2) => r2["rentalCode"] === q["rentalCode"]);
        if (!r) throw new Error(`PA.RT.010: no row for rentalCode=${q["rentalCode"]}`);
        return r["rate"];
      }
      case "PA.RT.011": {
        const r = rows.find((r2) => r2["towingLimit"] === q["towingLimit"]);
        if (!r) throw new Error(`PA.RT.011: no row for towingLimit=${q["towingLimit"]}`);
        return r["rate"];
      }
      default:
        throw new Error(`No lookup implementation for RT table: ${tableRef}`);
    }
  };
}
var makePALdGetter = makeLdGetter;
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
var PA_RATING_INPUT_SPEC = [
  { key: "territory", label: "Territory", kind: "select", options: [{ label: "T001", value: "T001" }, { label: "T002", value: "T002" }, { label: "T003", value: "T003" }, { label: "T004", value: "T004" }, { label: "T005", value: "T005" }] },
  { key: "driverClass", label: "Driver class", kind: "select", options: [{ label: "DC1 \u2014 Preferred", value: "DC1" }, { label: "DC2 \u2014 Standard", value: "DC2" }, { label: "DC3 \u2014 Non-Standard", value: "DC3" }] },
  { key: "biPdLimitCode", label: "BI/PD limit package", kind: "select", options: [{ label: "25/50/25", value: "25/50/25" }, { label: "50/100/50", value: "50/100/50" }, { label: "100/300/100", value: "100/300/100" }, { label: "250/500/250", value: "250/500/250" }] },
  { key: "vehicleAgeClass", label: "Vehicle age class", kind: "select", options: [{ label: "Economy", value: "Economy" }, { label: "Standard", value: "Standard" }, { label: "Luxury", value: "Luxury" }] },
  { key: "vehicleSymbol", label: "Vehicle symbol", kind: "select", options: [{ label: "sym10", value: "sym10" }, { label: "sym12", value: "sym12" }] },
  { key: "tier", label: "Tier", kind: "select", options: [{ label: "Preferred", value: "Preferred" }, { label: "Standard", value: "Standard" }, { label: "Non-Standard", value: "Non-Standard" }] },
  { key: "medPayElected", label: "Medical Payments (Part B)", kind: "boolean" },
  { key: "umElected", label: "UM/UIM (Part C)", kind: "boolean" },
  { key: "collisionElected", label: "Collision", kind: "boolean" },
  { key: "collisionDed", label: "Collision deductible", kind: "select", ldTableRef: "PA.LD.005" },
  { key: "compElected", label: "Comprehensive", kind: "boolean" },
  { key: "compDed", label: "Comprehensive deductible", kind: "select", ldTableRef: "PA.LD.006" },
  { key: "rentalElected", label: "Rental reimbursement", kind: "boolean" },
  { key: "rentalCode", label: "Rental limit", kind: "select", options: [{ label: "$20/day, $600 max", value: "$20_600" }, { label: "$30/day, $900 max", value: "$30_900" }, { label: "$40/day, $1,200 max", value: "$40_1200" }] },
  { key: "towingElected", label: "Towing and labor", kind: "boolean" },
  { key: "towingLimit", label: "Towing limit", kind: "select", options: [{ label: "$50", value: 50 }, { label: "$100", value: 100 }, { label: "$200", value: 200 }] }
];
var PA_WORKED_EXAMPLE = {
  territory: "T002",
  driverClass: "DC2",
  biPdLimitCode: "100/300/100",
  vehicleAgeClass: "Standard",
  vehicleSymbol: "sym12",
  tier: "Standard",
  medPayElected: true,
  umElected: true,
  collisionElected: true,
  collisionDed: 500,
  compElected: true,
  compDed: 250,
  rentalElected: true,
  rentalCode: "$30_900",
  towingElected: false,
  towingLimit: 100
};

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
function makeGLRtGetter(tables) {
  return (tableRef, q) => {
    const t = tables[tableRef];
    if (!t) throw new Error(`RT table not found: ${tableRef}`);
    const generic = genericRtLookup(t, q);
    if (generic !== null) return generic;
    const rows = t.rows;
    switch (tableRef) {
      case "GL.RT.001": {
        const r = rows.find((r2) => r2["classCode"] === q["classCode"]);
        if (!r) throw new Error(`GL.RT.001 (sheet "Rating Specifications", column "Class Code"): no row for classCode=${q["classCode"]}`);
        return r["baseRate"];
      }
      case "GL.RT.002": {
        const r = rows.find((r2) => r2["occLimit"] === q["occLimit"]);
        if (!r) throw new Error(`GL.RT.002 (sheet "Rating Specifications", column "Each Occ Limit"): no row for occLimit=${q["occLimit"]}`);
        return r["factor"];
      }
      case "GL.RT.003": {
        const r = rows.find((r2) => r2["occDeductible"] === q["occDeductible"]);
        if (!r) throw new Error(`GL.RT.003 (sheet "Limits and Deductibles", column "Deductible"): no row for occDeductible=${q["occDeductible"]}`);
        return r["factor"];
      }
      case "GL.RT.004": {
        const r = rows.find((r2) => r2["classCode"] === q["classCode"]);
        if (!r) throw new Error(`GL.RT.004 (sheet "Rating Specifications", column "Class Code"): no PCO row for classCode=${q["classCode"]}`);
        const pcoRate = r["pcoRate"];
        const pcoExposureThousands = q["pcoExposureThousands"];
        if (typeof pcoExposureThousands !== "number") {
          throw new Error(`GL.RT.004: pcoExposureThousands must be a number, got ${typeof pcoExposureThousands}`);
        }
        return pcoRate * pcoExposureThousands;
      }
      case "GL.RT.005": {
        const r = rows.find((r2) => r2["expMod"] === q["expMod"]);
        if (!r) throw new Error(`GL.RT.005 (sheet "Rating Specifications", column "Exp Mod"): no row for expMod=${q["expMod"]}`);
        return r["factor"];
      }
      default:
        throw new Error(`No lookup implementation for RT table: ${tableRef}`);
    }
  };
}
var makeGLLdGetter = makeLdGetter;
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
var GL_RATING_INPUT_SPEC = [
  {
    key: "classCode",
    label: "Class code",
    kind: "select",
    options: [
      { label: "41677 \u2014 Contractors, Residential Remodeling (payroll)", value: "41677" },
      { label: "11011 \u2014 Restaurants (gross sales)", value: "11011" },
      { label: "45191 \u2014 Retail Stores \u2014 NEC (gross sales)", value: "45191" },
      { label: "61110 \u2014 Office \u2014 Clerical (payroll)", value: "61110" },
      { label: "16811 \u2014 Building Operations \u2014 NEC (payroll)", value: "16811" }
    ]
  },
  { key: "exposureThousands", label: "Annual exposure (thousands of $)", kind: "number", min: 1, step: 1 },
  {
    key: "occLimit",
    label: "Per-occurrence limit",
    kind: "select",
    options: [
      { label: "$100,000 (base)", value: 1e5 },
      { label: "$300,000", value: 3e5 },
      { label: "$500,000", value: 5e5 },
      { label: "$1,000,000", value: 1e6 }
    ]
  },
  {
    key: "occDeductible",
    label: "BI/PD deductible",
    kind: "select",
    options: [
      { label: "$0 (none)", value: 0 },
      { label: "$500", value: 500 },
      { label: "$1,000", value: 1e3 },
      { label: "$2,500", value: 2500 }
    ]
  },
  { key: "pcoElected", label: "Products-Completed-Operations elected", kind: "boolean" },
  { key: "pcoExposureThousands", label: "PCO exposure (thousands of $)", kind: "number", min: 0, step: 1 },
  {
    key: "expMod",
    label: "Experience modification",
    kind: "select",
    options: [
      { label: "0.75 (credit)", value: "0.75" },
      { label: "0.90 (credit)", value: "0.90" },
      { label: "1.00 (unity)", value: "1.00" },
      { label: "1.15 (debit)", value: "1.15" },
      { label: "1.25 (debit)", value: "1.25" }
    ]
  }
];
var GL_WORKED_EXAMPLE = {
  classCode: "41677",
  exposureThousands: 500,
  occLimit: 1e6,
  occDeductible: 0,
  pcoElected: true,
  pcoExposureThousands: 200,
  expMod: "1.00"
};

// shared/src/lines/ratingKit.ts
function makeGenericRtGetter(tables) {
  return (tableRef, queryInputs) => {
    const t = tables[tableRef];
    if (!t) throw new Error(`RT table not found: ${tableRef}`);
    const v = genericRtLookup(t, queryInputs);
    if (v === null) throw new Error(`${tableRef}: no match for ${JSON.stringify(queryInputs)} (table must declare dimensions)`);
    return v;
  };
}
function exposureBaseToField(base) {
  switch (base) {
    case "COVERAGE_A_AMOUNT":
      return { key: "coverageA_per100", label: "Coverage A (\xF7$100)", kind: "number", min: 0 };
    case "PAYROLL_PER_100":
      return { key: "payroll_per100", label: "Payroll (\xF7$100)", kind: "number", min: 0 };
    case "GROSS_SALES_PER_1000":
      return { key: "grossSales_per1000", label: "Gross Sales (\xF7$1,000)", kind: "number", min: 0 };
    case "PER_VEHICLE":
      return { key: "numVehicles", label: "Number of Vehicles", kind: "number", min: 1 };
    case "PER_UNIT":
      return { key: "numUnits", label: "Number of Units", kind: "number", min: 1 };
    case "AREA":
      return { key: "areaSqFt", label: "Area (sq ft)", kind: "number", min: 0 };
    case "REVENUE":
      return { key: "revenueBand", label: "Revenue Band", kind: "text" };
    case "PER_LOCATION":
      return { key: "numLocations", label: "Number of Locations", kind: "number", min: 1 };
    case "REPLACEMENT_COST_VALUE":
      return { key: "tiv_per100", label: "Total Insured Value (\xF7$100)", kind: "number", min: 0 };
    case "FLAT":
      return { key: "flatPremium", label: "Flat Premium", kind: "number", min: 0 };
  }
}
function ratingKitGenerator(archetype) {
  const inputSpec = archetype.exposureBases.map(exposureBaseToField);
  return {
    makeRtGetter: makeGenericRtGetter,
    makeLdGetter,
    workedExample: {},
    // skeleton; fixture's workedExample is the actual canary input
    inputSpec,
    archetype
  };
}
function fixtureGov() {
  return {
    status: "ACTIVE",
    lifecycle: "LAUNCHED",
    reviewStatus: "APPROVED",
    reviewer: "seed",
    createdAt: null,
    updatedAt: null,
    updatedBy: "seed",
    rev: 1
  };
}

// shared/src/lines/__fixtures__/homeowners.golden.ts
var HOMEOWNERS_ARCHETYPE = {
  lobRefId: "PH.LOB.001",
  displayName: "Homeowners (HO-2/3/4/5/6/8)",
  family: "PERSONAL_PROPERTY",
  exposureBases: ["COVERAGE_A_AMOUNT"],
  // ISO HO-3 is an occurrence-trigger form (ISO HO 00 03 10 00 §I — Perils Insured Against).
  triggerTypes: ["OCCURRENCE"],
  limitStructures: ["BLANKET"],
  aggregatePatterns: ["NONE"],
  ratingStageArchetypes: ["LOSS_COST_TIMES_LCM", "BASE_RATE_RELATIVITY_CHAIN", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    { bureau: "ISO", rangeStart: 1, rangeEnd: 2, kind: "BASE_LOSS_COST", description: "HO base loss cost (Rule 1) and LCM (Rule 2)." },
    { bureau: "ISO", rangeStart: 3, rangeEnd: 91, kind: "FACTOR_TABLE", description: "Rating factor tables in the adjusted-base chain." },
    { bureau: "ISO", rangeStart: 92, rangeEnd: 92, kind: "CREDIT_CAP", description: "Maximum total credits floor (Rule 92)." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "Minimum premium per form (Rule 205)." },
    { bureau: "ISO", rangeStart: 406, rangeEnd: 406, kind: "DEDUCTIBLE", description: "All-perils deductible credit matrix (Rule 406)." },
    { bureau: "ISO", rangeStart: 400, rangeEnd: 499, kind: "PROTECTIVE_DEVICE", description: "Protective device credits (Rules 400\u2013499)." },
    { bureau: "ISO", rangeStart: 300, rangeEnd: 399, kind: "SCHEDULED_PROPERTY", description: "Scheduled personal property rates (Rules 300\u2013399)." },
    { bureau: "ISO", rangeStart: 500, rangeEnd: 699, kind: "ENDORSEMENT_SCHEDULE", description: "Endorsement premium schedules (Rules 500\u2013699)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["rate order", "order of calculation", "rate filing"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["homeowners manual", "ho manual", "rating manual", "loss cost"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["ho 00 0", "ho0003", "homeowners policy", "section i", "section ii"], confidenceWeight: 0.9 },
    { role: "RULES", signals: ["eligibility rules", "underwriting guidelines", "ho rules"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    // ISO HO-3 10 00 base form; carriers use proprietary equivalents like LEM 03 05 23.
    primaryFormPattern: "^(HO|LEM)\\s*0*3",
    ratingProgramStructure: ["LOSS_COST_TIMES_LCM", "BASE_RATE_RELATIVITY_CHAIN", "MINIMUM_PREMIUM_FLOOR"],
    // HO-3 vs HO-5 → separate sibling products sharing a product line.
    productSplitStrategy: "SIBLING_PRODUCTS_PER_FORM",
    formSplitDimension: "HO form variant (HO-3 / HO-5)",
    defaultVariableOp: "MUL",
    hasLcmStep: true,
    hasExpMod: false,
    hasClaimsMadeStepFactors: false
  }
};
var HOMEOWNERS_FIXTURE = {
  rt: {
    "LI.HO.RT.001": {
      name: "Base Rate by Territory",
      columns: ["territory", "rate"],
      dimensions: [{ key: "territory", label: "Territory", values: ["1", "2", "3"] }],
      valueColumn: "rate",
      rows: [
        { territory: "1", rate: 2 },
        { territory: "2", rate: 2.5 },
        { territory: "3", rate: 3 }
      ]
    },
    "LI.HO.RT.002": {
      name: "Construction Type Factor",
      columns: ["construction", "factor"],
      dimensions: [{ key: "construction", label: "Construction", values: ["FRAME", "MASONRY", "SUPERIOR"] }],
      valueColumn: "factor",
      rows: [
        { construction: "FRAME", factor: 1.1 },
        { construction: "MASONRY", factor: 0.9 },
        { construction: "SUPERIOR", factor: 0.75 }
      ]
    },
    "LI.HO.RT.003": {
      name: "Age of Home Factor",
      columns: ["ageGroup", "factor"],
      dimensions: [{ key: "ageGroup", label: "Age Group", values: ["NEW", "1-5", "6-15", "16-25", "25+"] }],
      valueColumn: "factor",
      rows: [
        { ageGroup: "NEW", factor: 0.8 },
        { ageGroup: "1-5", factor: 0.9 },
        { ageGroup: "6-15", factor: 1 },
        { ageGroup: "16-25", factor: 1.15 },
        { ageGroup: "25+", factor: 1.3 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.HO.RAT.1",
    name: "Homeowners Rating Program (archetype fixture)",
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Base rate by territory", op: "SET", source: { type: "RT", ref: "LI.HO.RT.001", keys: ["territory"] } },
      { id: "s2", order: 2, label: "Coverage A exposure", op: "MUL", source: { type: "INPUT", ref: "coverageA_per100" } },
      { id: "s3", order: 3, label: "Construction type factor", op: "MUL", source: { type: "RT", ref: "LI.HO.RT.002", keys: ["construction"] } },
      { id: "s4", order: 4, label: "Age of home factor", op: "MUL", source: { type: "RT", ref: "LI.HO.RT.003", keys: ["ageGroup"] } },
      { id: "s5", order: 5, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 500 }, roundTo: 0 }
    ]
  },
  workedExample: { territory: "1", coverageA_per100: 2e3, construction: "FRAME", ageGroup: "NEW" },
  expectedPremium: 3520
};

// shared/src/lines/__fixtures__/personalAuto.golden.ts
var PERSONAL_AUTO_ARCHETYPE = {
  lobRefId: "PA.LOB.001",
  displayName: "Personal Auto (ISO PAP PP 00 01)",
  family: "PERSONAL_AUTO",
  exposureBases: ["PER_VEHICLE"],
  // ISO PAP is an occurrence-trigger form (PP 00 01 12 15 §I "We will pay damages…for which any
  // covered person becomes legally responsible because of an auto accident").
  triggerTypes: ["OCCURRENCE"],
  // Offers both SPLIT (25/50/25) and CSL (combined single limit) options.
  limitStructures: ["SPLIT", "CSL"],
  aggregatePatterns: ["NONE"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "ILF_STEP", "EXPERIENCE_MOD", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    { bureau: "ISO", rangeStart: 1, rangeEnd: 2, kind: "BASE_LOSS_COST", description: "PA base loss cost by class/territory and LCM." },
    { bureau: "ISO", rangeStart: 3, rangeEnd: 91, kind: "FACTOR_TABLE", description: "Driver class, vehicle symbol, use, and other rating factors." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "Minimum premium per coverage part." },
    { bureau: "ISO", rangeStart: 500, rangeEnd: 699, kind: "ENDORSEMENT_SCHEDULE", description: "Optional coverage endorsement premiums." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["personal auto rate order", "private passenger"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["personal auto manual", "private passenger manual", "pp 00 01"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["pp 00 01", "pp0001", "personal auto policy", "part a", "part b", "part c", "part d"], confidenceWeight: 0.9 },
    { role: "TERRITORY_TABLE", signals: ["territory", "rating territory", "zip code territory"], confidenceWeight: 0.8 }
  ],
  translationRecipe: {
    primaryFormPattern: "^PP\\s*00\\s*01",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "ILF_STEP", "EXPERIENCE_MOD", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT_MULTI_FORM",
    defaultVariableOp: "MUL",
    hasLcmStep: true,
    hasExpMod: true,
    hasClaimsMadeStepFactors: false
  }
};
var PERSONAL_AUTO_FIXTURE = {
  rt: {
    "LI.PA.RT.001": {
      name: "Base Premium by Driver Class and Territory",
      columns: ["driverClass", "territory", "rate"],
      dimensions: [
        { key: "driverClass", label: "Driver Class", values: ["1", "2", "3"] },
        { key: "territory", label: "Territory", values: ["1", "3", "5"] }
      ],
      valueColumn: "rate",
      rows: [
        { driverClass: "1", territory: "1", rate: 500 },
        { driverClass: "1", territory: "3", rate: 600 },
        { driverClass: "1", territory: "5", rate: 750 },
        { driverClass: "2", territory: "3", rate: 800 },
        { driverClass: "3", territory: "3", rate: 1100 }
      ]
    },
    "LI.PA.RT.002": {
      name: "BI Limit Relativity",
      columns: ["biLimit", "factor"],
      dimensions: [{ key: "biLimit", label: "BI Limit", values: ["25/50", "50/100", "100/300", "250/500"] }],
      valueColumn: "factor",
      rows: [
        { biLimit: "25/50", factor: 0.8 },
        { biLimit: "50/100", factor: 0.9 },
        { biLimit: "100/300", factor: 1.15 },
        { biLimit: "250/500", factor: 1.45 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.PA.RAT.1",
    name: "Personal Auto Rating Program (archetype fixture)",
    minimumPremium: 200,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Base premium by class/territory", op: "SET", source: { type: "RT", ref: "LI.PA.RT.001", keys: ["driverClass", "territory"] } },
      { id: "s2", order: 2, label: "Number of vehicles", op: "MUL", source: { type: "INPUT", ref: "numVehicles" } },
      { id: "s3", order: 3, label: "BI limit relativity", op: "MUL", source: { type: "RT", ref: "LI.PA.RT.002", keys: ["biLimit"] } },
      { id: "s4", order: 4, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 200 }, roundTo: 0 }
    ]
  },
  workedExample: { driverClass: "1", territory: "3", numVehicles: 2, biLimit: "100/300" },
  expectedPremium: 1380
};

// shared/src/lines/__fixtures__/dwelling.golden.ts
var DWELLING_ARCHETYPE = {
  lobRefId: "DP.FAMILY",
  // virtual — no seeded product yet
  displayName: "Dwelling Fire / Landlord (DP-1/2/3)",
  family: "DWELLING",
  exposureBases: ["REPLACEMENT_COST_VALUE"],
  // ISO DP-3 is an occurrence-trigger form (DP 00 03 — Special Form).
  triggerTypes: ["OCCURRENCE"],
  limitStructures: ["BLANKET"],
  aggregatePatterns: ["NONE"],
  ratingStageArchetypes: ["LOSS_COST_TIMES_LCM", "BASE_RATE_RELATIVITY_CHAIN", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    { bureau: "ISO", rangeStart: 1, rangeEnd: 2, kind: "BASE_LOSS_COST", description: "DP base loss cost and LCM." },
    { bureau: "ISO", rangeStart: 3, rangeEnd: 91, kind: "FACTOR_TABLE", description: "DP rating factor tables (construction, protection class, occupancy)." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "Minimum premium per form (DP-1/2/3)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["dwelling fire rate", "dp rate order"], confidenceWeight: 0.85 },
    { role: "MANUAL", signals: ["dwelling fire manual", "dp manual", "dp 00 0"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["dp 00 01", "dp 00 02", "dp 00 03", "dwelling fire policy", "landlord policy"], confidenceWeight: 0.9 }
  ],
  translationRecipe: {
    primaryFormPattern: "^DP\\s*00\\s*0[123]",
    ratingProgramStructure: ["LOSS_COST_TIMES_LCM", "BASE_RATE_RELATIVITY_CHAIN", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SIBLING_PRODUCTS_PER_FORM",
    formSplitDimension: "DP form variant (DP-1 / DP-2 / DP-3)",
    defaultVariableOp: "MUL",
    hasLcmStep: true,
    hasExpMod: false,
    hasClaimsMadeStepFactors: false
  }
};
var DWELLING_FIXTURE = {
  rt: {
    "LI.DP.RT.001": {
      name: "Base Rate by Territory",
      columns: ["territory", "rate"],
      dimensions: [{ key: "territory", label: "Territory", values: ["1", "2", "3", "4"] }],
      valueColumn: "rate",
      rows: [
        { territory: "1", rate: 1.2 },
        { territory: "2", rate: 1.5 },
        { territory: "3", rate: 1.85 },
        { territory: "4", rate: 2.2 }
      ]
    },
    "LI.DP.RT.002": {
      name: "Construction Factor",
      columns: ["construction", "factor"],
      dimensions: [{ key: "construction", label: "Construction", values: ["FRAME", "MASONRY", "SUPERIOR"] }],
      valueColumn: "factor",
      rows: [
        { construction: "FRAME", factor: 1 },
        { construction: "MASONRY", factor: 0.85 },
        { construction: "SUPERIOR", factor: 0.7 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.DP.RAT.1",
    name: "Dwelling Fire Rating Program (archetype fixture)",
    minimumPremium: 300,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Base rate by territory", op: "SET", source: { type: "RT", ref: "LI.DP.RT.001", keys: ["territory"] } },
      { id: "s2", order: 2, label: "TIV exposure (per $100)", op: "MUL", source: { type: "INPUT", ref: "tiv_per100" } },
      { id: "s3", order: 3, label: "Construction factor", op: "MUL", source: { type: "RT", ref: "LI.DP.RT.002", keys: ["construction"] }, roundTo: 0 },
      { id: "s4", order: 4, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 300 } }
    ]
  },
  workedExample: { territory: "2", tiv_per100: 1500, construction: "MASONRY" },
  expectedPremium: 1913
};

// shared/src/lines/__fixtures__/personalUmbrella.golden.ts
var PERSONAL_UMBRELLA_ARCHETYPE = {
  lobRefId: "PU.FAMILY",
  displayName: "Personal Umbrella",
  family: "UMBRELLA",
  exposureBases: ["PER_LOCATION", "FLAT"],
  // Personal umbrella is an occurrence-trigger form following the underlying policy.
  triggerTypes: ["OCCURRENCE"],
  limitStructures: ["CSL"],
  aggregatePatterns: ["NONE"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    { bureau: "ISO", rangeStart: 1, rangeEnd: 50, kind: "FACTOR_TABLE", description: "Umbrella rating factors by underlying-policy retention and household exposures." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "Minimum premium." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["personal umbrella rate", "umbrella rate order"], confidenceWeight: 0.85 },
    { role: "MANUAL", signals: ["personal umbrella manual", "umbrella manual"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["personal umbrella policy", "umbrella liability", "excess liability", "ue 00"], confidenceWeight: 0.9 }
  ],
  translationRecipe: {
    primaryFormPattern: "^UE\\s*00|personal\\s+umbrella",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT",
    defaultVariableOp: "MUL",
    hasLcmStep: false,
    hasExpMod: false,
    hasClaimsMadeStepFactors: false
  }
};
var PERSONAL_UMBRELLA_FIXTURE = {
  rt: {
    "LI.PU.RT.001": {
      name: "Personal Umbrella Base Premium (retention \xD7 limit)",
      columns: ["retention", "limit", "rate"],
      dimensions: [
        { key: "retention", label: "Underlying Retention", values: ["100000", "300000", "500000"] },
        { key: "limit", label: "Umbrella Limit", values: ["1000000", "2000000", "5000000"] }
      ],
      valueColumn: "rate",
      rows: [
        { retention: "100000", limit: "1000000", rate: 900 },
        { retention: "300000", limit: "1000000", rate: 750 },
        { retention: "500000", limit: "1000000", rate: 600 },
        { retention: "300000", limit: "2000000", rate: 1e3 },
        { retention: "300000", limit: "5000000", rate: 1500 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.PU.RAT.1",
    name: "Personal Umbrella Rating Program (archetype fixture)",
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Base premium by retention/limit", op: "SET", source: { type: "RT", ref: "LI.PU.RT.001", keys: ["retention", "limit"] } },
      { id: "s2", order: 2, label: "Number of locations/households", op: "MUL", source: { type: "INPUT", ref: "numLocations" } },
      { id: "s3", order: 3, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 500 }, roundTo: 0 }
    ]
  },
  workedExample: { retention: "300000", limit: "1000000", numLocations: 2 },
  expectedPremium: 1500
};

// shared/src/lines/__fixtures__/inlandMarine.golden.ts
var INLAND_MARINE_ARCHETYPE = {
  lobRefId: "IM.FAMILY",
  displayName: "Inland Marine / Valuable Articles (scheduled + blanket)",
  family: "INLAND_MARINE",
  // IM products include both scheduled (per-item, agreed value or actual cash value)
  // and blanket (one limit across a category like fine arts or jewelry).
  exposureBases: ["PER_UNIT", "REPLACEMENT_COST_VALUE"],
  triggerTypes: ["OCCURRENCE"],
  // Scheduled = per-item limits; blanket = one limit over a category.
  limitStructures: ["SCHEDULED", "BLANKET"],
  aggregatePatterns: ["NONE"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "ADDITIVE_SCHEDULED_PREMIUMS", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    // ISO IM scheduled property rates follow the 300–399 band for HO endorsement overlap;
    // standalone IM filings use proprietary numbering.
    { bureau: "ISO", rangeStart: 300, rangeEnd: 399, kind: "SCHEDULED_PROPERTY", description: "Scheduled personal property class rates ($ per $100 appraised value)." },
    { bureau: "PROPRIETARY", rangeStart: 1, rangeEnd: 999, kind: "FACTOR_TABLE", description: "Carrier-proprietary IM rating factors." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["inland marine rate", "im rate order", "valuable articles rate"], confidenceWeight: 0.85 },
    { role: "MANUAL", signals: ["inland marine manual", "im manual", "valuable articles manual", "scheduled personal property"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["inland marine policy", "im 00", "valuable articles", "scheduled property floater", "blanket jewelry"], confidenceWeight: 0.9 },
    { role: "CLASS_TABLE", signals: ["class code", "item class", "jewelry class", "fine arts class"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    primaryFormPattern: "^IM\\s*00|scheduled\\s+personal|valuable\\s+articles",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "ADDITIVE_SCHEDULED_PREMIUMS", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT_MULTI_FORM",
    defaultVariableOp: "MUL",
    hasLcmStep: false,
    hasExpMod: false,
    hasClaimsMadeStepFactors: false,
    notes: "Agreed value (ACV) vs replacement cost settlement option creates a form variant within one product; blanket and scheduled items may coexist on one policy."
  }
};
var INLAND_MARINE_FIXTURE = {
  rt: {
    "LI.IM.RT.001": {
      // Source: ISO HO SPP class rate conventions (ISO HO 04 61 scheduled personal property
      // rates are the basis for standalone IM class rates).
      name: "Scheduled Personal Property Rate by Item Class",
      columns: ["itemClass", "rate"],
      dimensions: [{ key: "itemClass", label: "Item Class", values: ["JEWELRY", "FURS", "CAMERAS", "BICYCLES", "FINE_ARTS", "SILVERWARE", "COLLECTIBLES"] }],
      valueColumn: "rate",
      rows: [
        { itemClass: "JEWELRY", rate: 1.5 },
        { itemClass: "FURS", rate: 1.25 },
        { itemClass: "CAMERAS", rate: 1 },
        { itemClass: "BICYCLES", rate: 0.9 },
        { itemClass: "FINE_ARTS", rate: 0.5 },
        { itemClass: "SILVERWARE", rate: 0.6 },
        { itemClass: "COLLECTIBLES", rate: 1.2 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.IM.RAT.1",
    name: "Inland Marine Rating Program (archetype fixture)",
    minimumPremium: 150,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Class rate per $100 scheduled value", op: "SET", source: { type: "RT", ref: "LI.IM.RT.001", keys: ["itemClass"] } },
      { id: "s2", order: 2, label: "Scheduled value (per $100)", op: "MUL", source: { type: "INPUT", ref: "scheduledValue_per100" } },
      { id: "s3", order: 3, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 150 }, roundTo: 0 }
    ]
  },
  workedExample: { itemClass: "JEWELRY", scheduledValue_per100: 1e3 },
  expectedPremium: 1500
};

// shared/src/lines/__fixtures__/flood.golden.ts
var FLOOD_ARCHETYPE = {
  lobRefId: "FL.FAMILY",
  displayName: "Flood (NFIP Risk Rating 2.0 + private)",
  family: "FLOOD",
  exposureBases: ["COVERAGE_A_AMOUNT", "REPLACEMENT_COST_VALUE"],
  triggerTypes: ["OCCURRENCE"],
  limitStructures: ["BLANKET", "PERCENTAGE_DEDUCTIBLE"],
  aggregatePatterns: ["NONE"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    // NFIP does not use ISO rule numbers; rates are administratively set by FEMA.
    { bureau: "PROPRIETARY", rangeStart: 1, rangeEnd: 999, kind: "FACTOR_TABLE", description: "FEMA NFIP rate tables by flood zone, construction, and CRS class discount." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["flood rate order", "nfip rate", "fema flood rate"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["flood manual", "nfip manual", "flood insurance manual", "risk rating 2.0"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["standard flood insurance policy", "sfip", "flood insurance policy", "dwelling form", "general property form"], confidenceWeight: 0.9 },
    { role: "TERRITORY_TABLE", signals: ["flood zone", "sfha", "community rating system", "crs class"], confidenceWeight: 0.8 }
  ],
  translationRecipe: {
    primaryFormPattern: "sfip|standard\\s+flood|flood\\s+insurance\\s+policy|dwelling\\s+form",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SIBLING_PRODUCTS_PER_FORM",
    formSplitDimension: "NFIP form (Dwelling / General Property / RCBAP)",
    defaultVariableOp: "MUL",
    hasLcmStep: false,
    hasExpMod: false,
    hasClaimsMadeStepFactors: false,
    // Statutory annual premium increase caps: 18% primary residence, 25% other property
    // (Biggert-Waters 2012 §100205, Homeowner Flood Insurance Affordability Act 2014 §8).
    // CRS discount: 5% per CRS class improvement step, 45% maximum (FEMA NFIP CRS Coordinator's Manual).
    notes: "Statutory rate caps: +18% primary / +25% other per policy year. CRS discount: 5\u201345% (class 1\u20139). Private flood may deviate; Risk Rating 2.0 uses per-property multivariable risk scores."
  }
};
var FLOOD_FIXTURE = {
  rt: {
    "LI.FL.RT.001": {
      // Source: FEMA NFIP Rate Tables (illustrative; actual tables use multi-variable risk scoring).
      name: "Flood Base Rate by Zone and Construction",
      columns: ["zone", "construction", "rate"],
      dimensions: [
        { key: "zone", label: "Flood Zone", values: ["X", "AE", "AO", "VE"] },
        { key: "construction", label: "Construction", values: ["PRE_FIRM", "POST_FIRM"] }
      ],
      valueColumn: "rate",
      rows: [
        { zone: "X", construction: "PRE_FIRM", rate: 0.1 },
        { zone: "X", construction: "POST_FIRM", rate: 0.08 },
        { zone: "AE", construction: "PRE_FIRM", rate: 0.65 },
        { zone: "AE", construction: "POST_FIRM", rate: 0.4 },
        { zone: "AO", construction: "POST_FIRM", rate: 0.55 },
        { zone: "VE", construction: "POST_FIRM", rate: 0.9 }
      ]
    },
    "LI.FL.RT.002": {
      // Source: FEMA NFIP Community Rating System (CRS) discount schedule — 5% per class step.
      // Class 1 = 45% discount; Class 10 = no discount (non-participating community).
      name: "CRS Discount Factor by Class",
      columns: ["crsClass", "factor"],
      dimensions: [{ key: "crsClass", label: "CRS Class", values: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] }],
      valueColumn: "factor",
      rows: [
        { crsClass: "1", factor: 0.55 },
        { crsClass: "2", factor: 0.6 },
        { crsClass: "3", factor: 0.65 },
        { crsClass: "4", factor: 0.7 },
        { crsClass: "5", factor: 0.75 },
        { crsClass: "6", factor: 0.8 },
        { crsClass: "7", factor: 0.75 },
        { crsClass: "8", factor: 0.9 },
        { crsClass: "9", factor: 0.95 },
        { crsClass: "10", factor: 1 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.FL.RAT.1",
    name: "Flood Rating Program (archetype fixture)",
    minimumPremium: 100,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Base rate by zone/construction", op: "SET", source: { type: "RT", ref: "LI.FL.RT.001", keys: ["zone", "construction"] } },
      { id: "s2", order: 2, label: "Coverage A exposure (per $100)", op: "MUL", source: { type: "INPUT", ref: "coverageA_per100" } },
      { id: "s3", order: 3, label: "CRS discount factor", op: "MUL", source: { type: "RT", ref: "LI.FL.RT.002", keys: ["crsClass"] } },
      { id: "s4", order: 4, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 100 }, roundTo: 0 }
    ]
  },
  workedExample: { zone: "AE", construction: "POST_FIRM", coverageA_per100: 2500, crsClass: "7" },
  expectedPremium: 750
};

// shared/src/lines/__fixtures__/generalLiability.golden.ts
var GENERAL_LIABILITY_ARCHETYPE = {
  lobRefId: "GL.LOB.001",
  displayName: "Commercial General Liability (ISO CGL)",
  family: "GENERAL_LIABILITY",
  // Most CGL is written on occurrence trigger (CG 00 01); claims-made available (CG 00 02).
  exposureBases: ["PAYROLL_PER_100", "GROSS_SALES_PER_1000"],
  triggerTypes: ["OCCURRENCE", "CLAIMS_MADE", "CLAIMS_MADE_WITH_RETRO"],
  limitStructures: ["PER_OCCURRENCE_PLUS_TWO_AGGREGATES"],
  // ISO CGL standard: general aggregate + products-completed-operations aggregate (CG 00 01 §V).
  aggregatePatterns: ["GENERAL_AGGREGATE", "PRODUCTS_COMPLETED_OPS_AGGREGATE"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "ILF_STEP", "EXPERIENCE_MOD", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    { bureau: "ISO", rangeStart: 1, rangeEnd: 2, kind: "BASE_LOSS_COST", description: "CGL base loss cost by class code and LCM." },
    { bureau: "ISO", rangeStart: 3, rangeEnd: 91, kind: "FACTOR_TABLE", description: "CGL rating factors (ILF, deductible, experience mod, schedule rating)." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "CGL minimum premium." },
    { bureau: "ISO", rangeStart: 500, rangeEnd: 699, kind: "ENDORSEMENT_SCHEDULE", description: "CGL endorsement premium schedules (additional insured, etc.)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["commercial general liability rate", "cgl rate order"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["commercial general liability manual", "cgl manual", "cg 00 01"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["cg 00 01", "cg0001", "commercial general liability coverage form", "coverage a bodily injury", "products-completed operations"], confidenceWeight: 0.9 },
    { role: "CLASS_TABLE", signals: ["class code", "class basis", "iso classification", "code 4", "code 5", "code 9"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    primaryFormPattern: "^CG\\s*00\\s*0[12]",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "ILF_STEP", "EXPERIENCE_MOD", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT_MULTI_FORM",
    defaultVariableOp: "MUL",
    hasLcmStep: true,
    hasExpMod: true,
    hasClaimsMadeStepFactors: false,
    notes: "PCO aggregate is a separate coverage part; when elected, a second aggregate applies to products-completed-operations hazard (ISO CG 00 01 \xA7V Def 17)."
  }
};
var GENERAL_LIABILITY_FIXTURE = {
  rt: {
    "LI.GL.RT.001": {
      // Source: ISO CGL illustrative class rates (samples/iso/sample-GL-pricing.xlsx).
      name: "Class Code Base Rate (per $1,000 payroll)",
      columns: ["classCode", "rate"],
      dimensions: [{ key: "classCode", label: "Class Code", values: ["41677", "91342", "96816"] }],
      valueColumn: "rate",
      rows: [
        { classCode: "41677", rate: 2.5 },
        { classCode: "91342", rate: 1.85 },
        { classCode: "96816", rate: 4.1 }
      ]
    },
    "LI.GL.RT.002": {
      // Source: ISO CGL increased-limits factors (ISO GL ILF table; base limit $100,000).
      name: "Increased Limits Factor",
      columns: ["occLimit", "ilf"],
      dimensions: [{ key: "occLimit", label: "Per-Occurrence Limit", values: ["100000", "300000", "500000", "1000000"] }],
      valueColumn: "ilf",
      rows: [
        { occLimit: "100000", ilf: 1 },
        { occLimit: "300000", ilf: 1.15 },
        { occLimit: "500000", ilf: 1.35 },
        { occLimit: "1000000", ilf: 1.82 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.GL.RAT.1",
    name: "General Liability Rating Program (archetype fixture)",
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Class code base rate", op: "SET", source: { type: "RT", ref: "LI.GL.RT.001", keys: ["classCode"] } },
      { id: "s2", order: 2, label: "Payroll exposure ($1K)", op: "MUL", source: { type: "INPUT", ref: "payroll_per1000" } },
      { id: "s3", order: 3, label: "Increased-limits factor", op: "MUL", source: { type: "RT", ref: "LI.GL.RT.002", keys: ["occLimit"] } },
      { id: "s4", order: 4, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 500 }, roundTo: 0 }
    ]
  },
  workedExample: { classCode: "41677", payroll_per1000: 400, occLimit: "500000" },
  expectedPremium: 1350
};

// shared/src/lines/__fixtures__/commercialProperty.golden.ts
var COMMERCIAL_PROPERTY_ARCHETYPE = {
  lobRefId: "CP.FAMILY",
  displayName: "Commercial Property (ISO CP 00 10)",
  family: "COMMERCIAL_PROPERTY",
  exposureBases: ["REPLACEMENT_COST_VALUE", "PER_LOCATION"],
  triggerTypes: ["OCCURRENCE"],
  // Blanket: one limit over all locations/items; Scheduled: per-item or per-location limits.
  // Agreed Value (CP 00 10 Optional Coverage G.1) removes the coinsurance penalty.
  limitStructures: ["BLANKET", "SCHEDULED"],
  aggregatePatterns: ["NONE"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    { bureau: "ISO", rangeStart: 1, rangeEnd: 2, kind: "BASE_LOSS_COST", description: "CP base loss cost by construction class / protection class and LCM." },
    { bureau: "ISO", rangeStart: 3, rangeEnd: 91, kind: "FACTOR_TABLE", description: "CP rating factors (causes of loss, coinsurance, occupancy, sprinkler)." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "CP minimum premium." },
    { bureau: "ISO", rangeStart: 400, rangeEnd: 499, kind: "PROTECTIVE_DEVICE", description: "Fire-protection / sprinkler credits." },
    { bureau: "ISO", rangeStart: 500, rangeEnd: 699, kind: "ENDORSEMENT_SCHEDULE", description: "CP endorsement premiums (business income, extra expense, etc.)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["commercial property rate", "cp rate order", "building and personal property"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["commercial property manual", "cp 00 10", "cp manual"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["cp 00 10", "cp0010", "building and personal property coverage form", "causes of loss", "coinsurance", "agreed value"], confidenceWeight: 0.9 },
    { role: "CLASS_TABLE", signals: ["construction class", "protection class", "occupancy class", "building code class"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    primaryFormPattern: "^CP\\s*00\\s*10",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT_MULTI_FORM",
    defaultVariableOp: "MUL",
    hasLcmStep: true,
    hasExpMod: false,
    hasClaimsMadeStepFactors: false,
    // Coinsurance (80/90/100%) vs agreed value (CP 00 10 Optional Coverage G.1) changes the
    // penalty structure; blanket vs scheduled changes how the limit is apportioned.
    notes: "Causes-of-loss form selection (Basic CP 10 10 / Broad CP 10 20 / Special CP 10 30) is a major rate multiplier. Agreed Value endorsement removes coinsurance penalty."
  }
};
var COMMERCIAL_PROPERTY_FIXTURE = {
  rt: {
    "LI.CP.RT.001": {
      // Source: ISO CP construction/protection class rate tables (illustrative).
      // Class 8A = frame, protection class 3.
      name: "Building Base Rate by Construction and Protection Class",
      columns: ["class", "protection", "rate"],
      dimensions: [
        { key: "class", label: "Construction Class", values: ["1A", "2A", "3A", "4A", "5A", "6A", "7A", "8A"] },
        { key: "protection", label: "Protection Class", values: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] }
      ],
      valueColumn: "rate",
      rows: [
        { class: "1A", protection: "3", rate: 0.2 },
        { class: "4A", protection: "3", rate: 0.35 },
        { class: "6A", protection: "3", rate: 0.5 },
        { class: "8A", protection: "3", rate: 0.6 },
        { class: "8A", protection: "6", rate: 0.8 },
        { class: "8A", protection: "9", rate: 1.1 }
      ]
    },
    "LI.CP.RT.002": {
      // Source: ISO CP causes-of-loss factors (Basic / Broad / Special).
      name: "Causes of Loss Factor",
      columns: ["cause", "factor"],
      dimensions: [{ key: "cause", label: "Causes of Loss", values: ["BA", "BC", "SC"] }],
      valueColumn: "factor",
      rows: [
        { cause: "BA", factor: 1 },
        // Basic (CP 10 10)
        { cause: "BC", factor: 1.2 },
        // Broad (CP 10 20)
        { cause: "SC", factor: 1.45 }
        // Special (CP 10 30)
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.CP.RAT.1",
    name: "Commercial Property Rating Program (archetype fixture)",
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Building base rate", op: "SET", source: { type: "RT", ref: "LI.CP.RT.001", keys: ["class", "protection"] } },
      { id: "s2", order: 2, label: "TIV exposure (per $100)", op: "MUL", source: { type: "INPUT", ref: "tiv_per100" } },
      { id: "s3", order: 3, label: "Causes-of-loss factor", op: "MUL", source: { type: "RT", ref: "LI.CP.RT.002", keys: ["cause"] } },
      { id: "s4", order: 4, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 500 }, roundTo: 0 }
    ]
  },
  workedExample: { class: "8A", protection: "3", tiv_per100: 5e3, cause: "BC" },
  expectedPremium: 3600
};

// shared/src/lines/__fixtures__/commercialAuto.golden.ts
var COMMERCIAL_AUTO_ARCHETYPE = {
  lobRefId: "CA.FAMILY",
  displayName: "Commercial Auto (ISO BAP CA 00 01)",
  family: "COMMERCIAL_AUTO",
  exposureBases: ["PER_VEHICLE"],
  triggerTypes: ["OCCURRENCE"],
  // Offers both SPLIT (BI/PD separate) and CSL options; symbol-driven coverage selection.
  limitStructures: ["SPLIT", "CSL"],
  aggregatePatterns: ["NONE"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "ILF_STEP", "EXPERIENCE_MOD", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    { bureau: "ISO", rangeStart: 1, rangeEnd: 2, kind: "BASE_LOSS_COST", description: "CA base loss cost by symbol/territory and LCM." },
    { bureau: "ISO", rangeStart: 3, rangeEnd: 91, kind: "FACTOR_TABLE", description: "CA rating factors (vehicle use, fleet size, driver record)." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "CA minimum premium per vehicle." },
    { bureau: "ISO", rangeStart: 500, rangeEnd: 699, kind: "ENDORSEMENT_SCHEDULE", description: "CA endorsement premiums (hired auto, non-owned, etc.)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["commercial auto rate", "ca rate order", "business auto rate"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["commercial auto manual", "business auto manual", "ca 00 01"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["ca 00 01", "ca0001", "business auto coverage form", "covered auto symbol", "section i liability"], confidenceWeight: 0.9 },
    { role: "CLASS_TABLE", signals: ["symbol", "vehicle symbol", "covered auto", "radius class", "fleet discount"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    // ISO BAP CA 00 01; covered-auto symbols 1–9 and 19 define which autos are covered.
    primaryFormPattern: "^CA\\s*00\\s*01",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "ILF_STEP", "EXPERIENCE_MOD", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT",
    defaultVariableOp: "MUL",
    hasLcmStep: true,
    hasExpMod: true,
    hasClaimsMadeStepFactors: false,
    notes: "Covered-auto symbols 1\u20139 select the coverage universe; Symbol 19 (mobile equipment subject to compulsory or financial-responsibility law) is a specialty extension. Fleet discounts apply above threshold vehicle counts."
  }
};
var COMMERCIAL_AUTO_FIXTURE = {
  rt: {
    "LI.CA.RT.001": {
      // Source: ISO CA symbol/territory base rate structure (illustrative).
      // Symbol 7 = autos specifically described; territory 5 = example urban-suburban territory.
      name: "Base Premium by Symbol and Territory",
      columns: ["symbol", "territory", "rate"],
      dimensions: [
        { key: "symbol", label: "Covered Auto Symbol", values: ["1", "7", "8", "9"] },
        { key: "territory", label: "Rating Territory", values: ["1", "3", "5", "7"] }
      ],
      valueColumn: "rate",
      rows: [
        { symbol: "1", territory: "5", rate: 1100 },
        { symbol: "7", territory: "3", rate: 700 },
        { symbol: "7", territory: "5", rate: 850 },
        { symbol: "7", territory: "7", rate: 1050 },
        { symbol: "9", territory: "5", rate: 600 }
      ]
    },
    "LI.CA.RT.002": {
      // Source: ISO CA BI limit relativities (illustrative).
      name: "BI Limit Relativity",
      columns: ["biLimit", "factor"],
      dimensions: [{ key: "biLimit", label: "BI Limit (000 per person/accident)", values: ["25/50", "100/300", "300/600", "500/1000"] }],
      valueColumn: "factor",
      rows: [
        { biLimit: "25/50", factor: 0.75 },
        { biLimit: "100/300", factor: 1 },
        { biLimit: "300/600", factor: 1.2 },
        { biLimit: "500/1000", factor: 1.4 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.CA.RAT.1",
    name: "Commercial Auto Rating Program (archetype fixture)",
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Base premium by symbol/territory", op: "SET", source: { type: "RT", ref: "LI.CA.RT.001", keys: ["symbol", "territory"] } },
      { id: "s2", order: 2, label: "Number of vehicles", op: "MUL", source: { type: "INPUT", ref: "numUnits" } },
      { id: "s3", order: 3, label: "BI limit relativity", op: "MUL", source: { type: "RT", ref: "LI.CA.RT.002", keys: ["biLimit"] } },
      { id: "s4", order: 4, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 500 }, roundTo: 0 }
    ]
  },
  workedExample: { symbol: "7", territory: "5", numUnits: 3, biLimit: "500/1000" },
  expectedPremium: 3570
};

// shared/src/lines/__fixtures__/workersComp.golden.ts
var WORKERS_COMP_ARCHETYPE = {
  lobRefId: "WC.FAMILY",
  displayName: "Workers Compensation (NCCI WC 00 00 00)",
  family: "WORKERS_COMP",
  // WC is always payroll-based: annual payroll ÷ 100 × loss cost × LCM × e-mod.
  exposureBases: ["PAYROLL_PER_100"],
  // WC has no occurrence/claims-made distinction; the statutory benefit obligation
  // attaches when the injury arises out of and in the course of employment.
  triggerTypes: ["OCCURRENCE"],
  limitStructures: ["CSL"],
  // Employers Liability (Part 2) uses a CSL limit.
  aggregatePatterns: ["NONE"],
  ratingStageArchetypes: ["LOSS_COST_TIMES_LCM", "EXPERIENCE_MOD", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    // NCCI Basic Manual Parts (not ISO rule numbers).
    { bureau: "NCCI", rangeStart: 1, rangeEnd: 1, kind: "GENERAL_RULES", description: "NCCI Basic Manual Part 1 \u2014 general rules, eligibility, policy conditions." },
    { bureau: "NCCI", rangeStart: 2, rangeEnd: 2, kind: "CLASSIFICATION", description: "NCCI Scopes Manual / Basic Part 2 \u2014 class codes, phraseology, payroll basis." },
    { bureau: "NCCI", rangeStart: 3, rangeEnd: 3, kind: "LOSS_COST", description: "NCCI Basic Part 3 \u2014 loss costs per $100 payroll + LCM." },
    { bureau: "NCCI", rangeStart: 4, rangeEnd: 4, kind: "PREMIUM_DETERMINATION", description: "NCCI Basic Part 4 \u2014 e-mod, schedule rating (\xB115% capped), minimum premium." },
    { bureau: "NCCI", rangeStart: 40, rangeEnd: 40, kind: "EXPERIENCE_MOD", description: "NCCI Experience Rating Plan \u2014 e-mod calculation." },
    { bureau: "NCCI", rangeStart: 41, rangeEnd: 41, kind: "SCHEDULE_RATING", description: "NCCI schedule rating credit/debit (\xB115% per NCCI; some states allow \xB125%)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["workers compensation rate", "wc rate order", "loss cost filing"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["workers compensation manual", "ncci basic manual", "wc 00 00 00", "loss cost"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["wc 00 00 00", "workers compensation and employers liability", "part one", "part two statutory", "experience modifier"], confidenceWeight: 0.9 },
    { role: "ERC_PACKAGE", signals: ["experience rating calculation", "erc", "mod worksheet", "e-mod calculation", "ncci experience rating"], confidenceWeight: 0.9 },
    { role: "CLASS_TABLE", signals: ["classification code", "class code", "ncci code", "scopes"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    primaryFormPattern: "^WC\\s*00\\s*00\\s*00",
    ratingProgramStructure: ["LOSS_COST_TIMES_LCM", "EXPERIENCE_MOD", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT",
    defaultVariableOp: "MUL",
    hasLcmStep: true,
    hasExpMod: true,
    hasClaimsMadeStepFactors: false,
    notes: "State bureaus (NYCIRB, WCIRB CA, TX DWC, etc.) file their own loss costs; NCCI serves as rating bureau for ~40 states. ERP calculation is separate from rate filing."
  }
};
var WORKERS_COMP_FIXTURE = {
  rt: {
    "LI.WC.RT.001": {
      // Source: NCCI loss cost filing (illustrative; class 5537 = roofing, all types).
      name: "Loss Cost by Class Code (per $100 payroll)",
      columns: ["classCode", "rate"],
      dimensions: [{ key: "classCode", label: "Class Code", values: ["5537", "8810", "9015", "3632"] }],
      valueColumn: "rate",
      rows: [
        { classCode: "5537", rate: 8 },
        // roofing, all types
        { classCode: "8810", rate: 0.25 },
        // clerical office employees
        { classCode: "9015", rate: 2.1 },
        // janitorial services
        { classCode: "3632", rate: 5.5 }
        // machine shop
      ]
    },
    "LI.WC.RT.002": {
      // Source: NCCI experience rating (illustrative e-mod lookup).
      name: "Experience Modification Factor",
      columns: ["expMod", "factor"],
      dimensions: [{ key: "expMod", label: "E-Mod", values: ["0.75", "0.90", "1.00", "1.10", "1.25"] }],
      valueColumn: "factor",
      rows: [
        { expMod: "0.75", factor: 0.75 },
        { expMod: "0.90", factor: 0.9 },
        { expMod: "1.00", factor: 1 },
        { expMod: "1.10", factor: 1.1 },
        { expMod: "1.25", factor: 1.25 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.WC.RAT.1",
    name: "Workers Compensation Rating Program (archetype fixture)",
    minimumPremium: 200,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Loss cost by class code", op: "SET", source: { type: "RT", ref: "LI.WC.RT.001", keys: ["classCode"] } },
      { id: "s2", order: 2, label: "Loss cost multiplier (LCM)", op: "MUL", source: { type: "CONST", value: 1.25 } },
      { id: "s3", order: 3, label: "Payroll exposure (\xF7$100)", op: "MUL", source: { type: "INPUT", ref: "payroll_per100" } },
      { id: "s4", order: 4, label: "Experience mod", op: "MUL", source: { type: "RT", ref: "LI.WC.RT.002", keys: ["expMod"] } },
      { id: "s5", order: 5, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 200 }, roundTo: 0 }
    ]
  },
  workedExample: { classCode: "5537", payroll_per100: 500, expMod: "0.90" },
  expectedPremium: 4500
};

// shared/src/lines/__fixtures__/bop.golden.ts
var BOP_ARCHETYPE = {
  lobRefId: "BP.FAMILY",
  displayName: "Business Owners Policy (ISO BOP BP 00 03)",
  family: "PACKAGE",
  exposureBases: ["PER_LOCATION", "REVENUE"],
  triggerTypes: ["OCCURRENCE"],
  // BOP property is blanket-limit; liability is per-occurrence + aggregate.
  limitStructures: ["BLANKET", "PER_OCCURRENCE_PLUS_AGGREGATE"],
  aggregatePatterns: ["GENERAL_AGGREGATE"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "PACKAGE_MODIFICATION", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    { bureau: "ISO", rangeStart: 1, rangeEnd: 2, kind: "BASE_LOSS_COST", description: "BOP composite base rate by SIC/class and protection class." },
    { bureau: "ISO", rangeStart: 3, rangeEnd: 91, kind: "FACTOR_TABLE", description: "BOP modifiers (liability limit, optional coverages, sprinkler credit)." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "BOP minimum premium." },
    { bureau: "ISO", rangeStart: 500, rangeEnd: 699, kind: "ENDORSEMENT_SCHEDULE", description: "BOP optional coverage premiums (equipment breakdown, data breach, etc.)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["businessowners rate", "bop rate order", "bp 00 03"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["businessowners manual", "bop manual", "bp manual"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["bp 00 03", "bp0003", "businessowners coverage form", "section i property", "section ii liability"], confidenceWeight: 0.9 },
    { role: "CLASS_TABLE", signals: ["eligible class", "sic code", "naics", "business class"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    primaryFormPattern: "^BP\\s*00\\s*03",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "PACKAGE_MODIFICATION", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT",
    defaultVariableOp: "MUL",
    hasLcmStep: true,
    hasExpMod: false,
    hasClaimsMadeStepFactors: false,
    notes: "BOP uses composite (combined property+liability) base rates by SIC class, protection class, and limit. Accounts not eligible for BOP must be placed on a monoline CPP."
  }
};
var BOP_FIXTURE = {
  rt: {
    "LI.BP.RT.001": {
      // Source: ISO BOP class/protection/limit composite base premium (illustrative).
      // SIC division 04 = retail trade. Protection class 3 = good public fire protection.
      name: "BOP Composite Base Premium by Class / Protection / Limit",
      columns: ["sic", "protClass", "limit", "rate"],
      dimensions: [
        { key: "sic", label: "SIC Division", values: ["01", "02", "04", "07", "08"] },
        { key: "protClass", label: "Protection Class", values: ["1", "3", "5", "8"] },
        { key: "limit", label: "Liability Limit", values: ["500K", "1M", "2M"] }
      ],
      valueColumn: "rate",
      rows: [
        { sic: "04", protClass: "3", limit: "500K", rate: 750 },
        { sic: "04", protClass: "3", limit: "1M", rate: 1e3 },
        { sic: "04", protClass: "3", limit: "2M", rate: 1350 },
        { sic: "04", protClass: "8", limit: "1M", rate: 1400 },
        { sic: "02", protClass: "3", limit: "1M", rate: 1200 }
      ]
    },
    "LI.BP.RT.002": {
      // Source: ISO BOP liability limit modification factor (illustrative).
      name: "Liability Modification Factor",
      columns: ["liabilityFactor", "factor"],
      dimensions: [{ key: "liabilityFactor", label: "Liability Factor Type", values: ["reduced", "standard", "enhanced"] }],
      valueColumn: "factor",
      rows: [
        { liabilityFactor: "reduced", factor: 0.9 },
        { liabilityFactor: "standard", factor: 1.2 },
        { liabilityFactor: "enhanced", factor: 1.45 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.BP.RAT.1",
    name: "BOP Rating Program (archetype fixture)",
    minimumPremium: 400,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Composite base premium", op: "SET", source: { type: "RT", ref: "LI.BP.RT.001", keys: ["sic", "protClass", "limit"] } },
      { id: "s2", order: 2, label: "Liability modification", op: "MUL", source: { type: "RT", ref: "LI.BP.RT.002", keys: ["liabilityFactor"] } },
      { id: "s3", order: 3, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 400 }, roundTo: 0 }
    ]
  },
  workedExample: { sic: "04", protClass: "3", limit: "1M", liabilityFactor: "standard" },
  expectedPremium: 1200
};

// shared/src/lines/__fixtures__/commercialPackage.golden.ts
var COMMERCIAL_PACKAGE_ARCHETYPE = {
  lobRefId: "CPP.FAMILY",
  displayName: "Commercial Package Policy (ISO CPP)",
  family: "PACKAGE",
  exposureBases: ["PER_LOCATION", "REVENUE"],
  triggerTypes: ["OCCURRENCE"],
  limitStructures: ["BLANKET", "PER_OCCURRENCE_PLUS_AGGREGATE"],
  aggregatePatterns: ["GENERAL_AGGREGATE", "PRODUCTS_COMPLETED_OPS_AGGREGATE"],
  ratingStageArchetypes: ["ADDITIVE_SCHEDULED_PREMIUMS", "PACKAGE_MODIFICATION", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    // CPP rules are per coverage part (CP, CA, GL, CrP, etc.); the package discount
    // is a cross-part modification. ISO rule numbers apply per part.
    { bureau: "ISO", rangeStart: 1, rangeEnd: 91, kind: "FACTOR_TABLE", description: "Coverage-part-specific rating factors." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "Package minimum premium." },
    { bureau: "ISO", rangeStart: 500, rangeEnd: 699, kind: "ENDORSEMENT_SCHEDULE", description: "Cross-part endorsement premiums." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["commercial package rate", "cpp rate order", "package policy rate"], confidenceWeight: 0.85 },
    { role: "MANUAL", signals: ["commercial package manual", "cpp manual", "package modification"], confidenceWeight: 0.8 },
    { role: "POLICY_FORM", signals: ["il 00 17", "il 00 21", "common policy declarations", "common policy conditions", "coverage parts"], confidenceWeight: 0.9 },
    { role: "DECLARATIONS", signals: ["common policy declarations", "il 00 17", "named insured", "policy period", "coverage parts forming part of this policy"], confidenceWeight: 0.85 }
  ],
  translationRecipe: {
    primaryFormPattern: "^IL\\s*00\\s*17|commercial\\s+package",
    ratingProgramStructure: ["ADDITIVE_SCHEDULED_PREMIUMS", "PACKAGE_MODIFICATION", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT_MULTI_FORM",
    defaultVariableOp: "ADD",
    hasLcmStep: false,
    hasExpMod: false,
    hasClaimsMadeStepFactors: false,
    notes: "Coverage parts (CP, CA, CGL, CrP, etc.) are rated independently; their premiums are summed then multiplied by the package modification factor. IL 00 17 is the common declarations; IL 00 21 the common conditions."
  }
};
var COMMERCIAL_PACKAGE_FIXTURE = {
  rt: {
    "LI.CPP.RT.001": {
      // Source: ISO CPP package modification factor (illustrative).
      // A 2-part package (CP + CGL) earns a 5% discount; more parts earn more.
      name: "Package Modification Factor by Number of Coverage Parts",
      columns: ["parts", "factor"],
      dimensions: [{ key: "parts", label: "Coverage Parts", values: ["1", "2", "3", "4+"] }],
      valueColumn: "factor",
      rows: [
        { parts: "1", factor: 1 },
        { parts: "2", factor: 0.95 },
        { parts: "3", factor: 0.92 },
        { parts: "4+", factor: 0.9 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.CPP.RAT.1",
    name: "Commercial Package Rating Program (archetype fixture)",
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Commercial Property premium", op: "SET", source: { type: "INPUT", ref: "premCP" } },
      { id: "s2", order: 2, label: "General Liability premium", op: "ADD", source: { type: "INPUT", ref: "premGL" } },
      { id: "s3", order: 3, label: "Package modification factor", op: "MUL", source: { type: "RT", ref: "LI.CPP.RT.001", keys: ["parts"] } },
      { id: "s4", order: 4, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 500 }, roundTo: 0 }
    ]
  },
  workedExample: { premCP: 2e3, premGL: 1500, parts: "2" },
  expectedPremium: 3325
};

// shared/src/lines/__fixtures__/cyber.golden.ts
var CYBER_ARCHETYPE = {
  lobRefId: "CY.FAMILY",
  displayName: "Cyber (first/third-party, claims-made)",
  family: "CYBER",
  exposureBases: ["REVENUE"],
  // Cyber is exclusively claims-made; retroactive dates are standard on renewal.
  triggerTypes: ["CLAIMS_MADE", "CLAIMS_MADE_WITH_RETRO"],
  // Single aggregate policy limit with per-insuring-agreement sublimits (e.g. ransomware,
  // business interruption, regulatory defense each capped within the aggregate).
  limitStructures: ["SINGLE_AGGREGATE_WITH_SUBLIMITS"],
  aggregatePatterns: ["PER_INSURING_AGREEMENT_SUBLIMIT"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "ILF_STEP", "CLAIMS_MADE_STEP_FACTOR", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    // No ISO standard form; cyber is proprietary-dominant.
    { bureau: "PROPRIETARY", rangeStart: 1, rangeEnd: 999, kind: "FACTOR_TABLE", description: "Carrier-proprietary cyber rating factors (revenue band, industry sector, retention, security controls)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["cyber rate order", "cyber liability rate", "data breach rate"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["cyber manual", "cyber liability manual", "data breach manual", "technology errors and omissions"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["cyber policy", "data breach", "ransomware", "network security", "privacy liability", "insuring agreement a", "insuring agreement b"], confidenceWeight: 0.9 },
    { role: "RULES", signals: ["cyber eligibility", "security controls", "mfa required", "edr required", "network segmentation"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    primaryFormPattern: "cyber|data\\s+breach|network\\s+security|privacy\\s+liability",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "ILF_STEP", "CLAIMS_MADE_STEP_FACTOR", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT",
    defaultVariableOp: "MUL",
    hasLcmStep: false,
    hasExpMod: false,
    // Cyber typically does NOT ramp up the same way PL/D&O does — most carriers write
    // occurrence-equivalent from policy year 1 with retroactive coverage available.
    // Step factors DO apply when a prior-acts exclusion is in place.
    hasClaimsMadeStepFactors: true,
    notes: "WAITING_PERIOD deductibles apply to business income / system restoration coverages (hours-based). Sublimits per insuring agreement (ransomware, regulatory, PCI DSS, social engineering) aggregate within the policy limit."
  }
};
var CYBER_FIXTURE = {
  rt: {
    "LI.CY.RT.001": {
      // Source: carrier-proprietary cyber base premium by revenue band and retention (illustrative).
      name: "Cyber Base Premium by Revenue Band and Retention",
      columns: ["revenueBand", "retention", "rate"],
      dimensions: [
        { key: "revenueBand", label: "Revenue Band", values: ["1M", "5M", "25M", "100M"] },
        { key: "retention", label: "Retention ($)", values: ["5000", "10000", "25000", "50000"] }
      ],
      valueColumn: "rate",
      rows: [
        { revenueBand: "1M", retention: "10000", rate: 1500 },
        { revenueBand: "5M", retention: "5000", rate: 5500 },
        { revenueBand: "5M", retention: "10000", rate: 4e3 },
        { revenueBand: "5M", retention: "25000", rate: 2800 },
        { revenueBand: "25M", retention: "10000", rate: 8500 }
      ]
    },
    "LI.CY.RT.002": {
      // Source: carrier-proprietary cyber ILF table (illustrative; base at $1M aggregate).
      name: "Aggregate Limit Factor",
      columns: ["limit", "ilf"],
      dimensions: [{ key: "limit", label: "Aggregate Limit", values: ["500000", "1000000", "2000000", "5000000"] }],
      valueColumn: "ilf",
      rows: [
        { limit: "500000", ilf: 0.65 },
        { limit: "1000000", ilf: 1 },
        { limit: "2000000", ilf: 1.5 },
        { limit: "5000000", ilf: 2.8 }
      ]
    },
    "LI.CY.RT.003": {
      // Source: carrier-proprietary cyber claims-made step factor (illustrative).
      // Year 1 at 100% (cyber typically does not ramp; prior-acts retroactive from inception).
      name: "Claims-Made Step Factor by Policy Year",
      columns: ["year", "factor"],
      dimensions: [{ key: "year", label: "Policy Year", values: ["1", "2", "3", "4", "5+"] }],
      valueColumn: "factor",
      rows: [
        { year: "1", factor: 1 },
        { year: "2", factor: 1 },
        { year: "3", factor: 1 },
        { year: "4", factor: 1 },
        { year: "5+", factor: 1 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.CY.RAT.1",
    name: "Cyber Rating Program (archetype fixture)",
    minimumPremium: 1e3,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Base premium by revenue/retention", op: "SET", source: { type: "RT", ref: "LI.CY.RT.001", keys: ["revenueBand", "retention"] } },
      { id: "s2", order: 2, label: "Aggregate limit factor", op: "MUL", source: { type: "RT", ref: "LI.CY.RT.002", keys: ["limit"] } },
      { id: "s3", order: 3, label: "Claims-made step factor", op: "MUL", source: { type: "RT", ref: "LI.CY.RT.003", keys: ["year"] } },
      { id: "s4", order: 4, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 1e3 }, roundTo: 0 }
    ]
  },
  workedExample: { revenueBand: "5M", retention: "10000", limit: "1000000", year: "1" },
  expectedPremium: 4e3
};

// shared/src/lines/__fixtures__/managementLiability.golden.ts
var MANAGEMENT_LIABILITY_ARCHETYPE = {
  lobRefId: "ML.FAMILY",
  displayName: "Management Liability (D&O, EPL, Fiduciary \u2014 proprietary claims-made)",
  family: "MANAGEMENT_LIABILITY",
  exposureBases: ["REVENUE"],
  // Claims-made with retroactive date is the universal market standard for D&O.
  // "No ISO standard D&O form … treat these as proprietary-dominant archetypes."
  triggerTypes: ["CLAIMS_MADE_WITH_RETRO"],
  limitStructures: ["SINGLE_AGGREGATE_WITH_SUBLIMITS"],
  aggregatePatterns: ["PER_INSURING_AGREEMENT_SUBLIMIT"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "CLAIMS_MADE_STEP_FACTOR", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    // No ISO standard numbering; proprietary filings dominate.
    { bureau: "PROPRIETARY", rangeStart: 1, rangeEnd: 999, kind: "FACTOR_TABLE", description: "Carrier-proprietary D&O/EPL rating factors (assets band, revenue, SIC, limit, retro year)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["directors officers rate", "d&o rate", "epl rate order", "management liability rate"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["directors officers manual", "d&o manual", "management liability manual", "employment practices manual"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["directors' and officers'", "d&o coverage", "employment practices liability", "wrongful act", "insured persons", "prior and pending litigation"], confidenceWeight: 0.9 },
    { role: "RULES", signals: ["d&o eligibility", "governance questionnaire", "epl questionnaire", "prior claims disclosure"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    primaryFormPattern: "directors|d&o|employment\\s+practices|epl|wrongful\\s+act|fiduciary",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "CLAIMS_MADE_STEP_FACTOR", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT_MULTI_FORM",
    formSplitDimension: "Coverage part (D&O / EPL / Fiduciary)",
    defaultVariableOp: "MUL",
    hasLcmStep: false,
    hasExpMod: false,
    hasClaimsMadeStepFactors: true,
    // D&O step factor: year 1 is the first year without a retroactive tail; typically
    // priced at 50–70% of the mature (unlimited retro) rate. 100% reached by year 4–6
    // depending on the insurer's actuarial tables.
    notes: "No ISO standard D&O form. EPL available on ISO EP 00 01 but market uses proprietary forms. Retroactive date and prior-and-pending date are critical rating variables. Step factor reaches mature rate by year 4\u20136."
  }
};
var MANAGEMENT_LIABILITY_FIXTURE = {
  rt: {
    "LI.ML.RT.001": {
      // Source: carrier-proprietary D&O base premium by total assets and limit (illustrative).
      name: "D&O Base Premium by Assets Band and Limit",
      columns: ["assetsBand", "limit", "rate"],
      dimensions: [
        { key: "assetsBand", label: "Total Assets Band", values: ["1M", "10M", "50M", "250M"] },
        { key: "limit", label: "Policy Limit", values: ["1000000", "2000000", "5000000"] }
      ],
      valueColumn: "rate",
      rows: [
        { assetsBand: "1M", limit: "1000000", rate: 2500 },
        { assetsBand: "10M", limit: "1000000", rate: 5e3 },
        { assetsBand: "10M", limit: "2000000", rate: 8e3 },
        { assetsBand: "10M", limit: "5000000", rate: 15e3 },
        { assetsBand: "50M", limit: "2000000", rate: 14e3 }
      ]
    },
    "LI.ML.RT.002": {
      // Source: carrier-proprietary D&O claims-made step factor (illustrative).
      // Year 1 = first year (no retroactive tail) typically priced at 55–70% of mature.
      name: "Claims-Made Step Factor by Retroactive Year",
      columns: ["retroYear", "factor"],
      dimensions: [{ key: "retroYear", label: "Retroactive Year", values: ["1", "2", "3", "4", "5+"] }],
      valueColumn: "factor",
      rows: [
        { retroYear: "1", factor: 0.6 },
        { retroYear: "2", factor: 0.75 },
        { retroYear: "3", factor: 0.88 },
        { retroYear: "4", factor: 0.95 },
        { retroYear: "5+", factor: 1 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.ML.RAT.1",
    name: "Management Liability Rating Program (archetype fixture)",
    minimumPremium: 1500,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Base premium by assets/limit", op: "SET", source: { type: "RT", ref: "LI.ML.RT.001", keys: ["assetsBand", "limit"] } },
      { id: "s2", order: 2, label: "Claims-made step factor", op: "MUL", source: { type: "RT", ref: "LI.ML.RT.002", keys: ["retroYear"] } },
      { id: "s3", order: 3, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 1500 }, roundTo: 0 }
    ]
  },
  workedExample: { assetsBand: "10M", limit: "2000000", retroYear: "1" },
  expectedPremium: 4800
};

// shared/src/lines/__fixtures__/professionalLiability.golden.ts
var PROFESSIONAL_LIABILITY_ARCHETYPE = {
  lobRefId: "PL.FAMILY",
  displayName: "Professional Liability / E&O (claims-made, step-rated)",
  family: "PROFESSIONAL_LIABILITY",
  exposureBases: ["REVENUE", "FLAT"],
  triggerTypes: ["CLAIMS_MADE", "CLAIMS_MADE_WITH_RETRO"],
  limitStructures: ["PER_OCCURRENCE_PLUS_AGGREGATE"],
  aggregatePatterns: ["GENERAL_AGGREGATE"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "CLAIMS_MADE_STEP_FACTOR", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    // Some PL segments have ISO forms (CG 22 43 accountants, etc.) but most are proprietary.
    { bureau: "ISO", rangeStart: 1, rangeEnd: 91, kind: "FACTOR_TABLE", description: "ISO E&O base rates and factors (where ISO forms exist, e.g. CG 22 43)." },
    { bureau: "PROPRIETARY", rangeStart: 1, rangeEnd: 999, kind: "FACTOR_TABLE", description: "Carrier-proprietary PL rating factors (profession class, revenue, deductible, step factor)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["professional liability rate", "e&o rate order", "errors and omissions rate", "tech e&o rate"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["professional liability manual", "e&o manual", "errors and omissions manual", "professional indemnity"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["professional liability", "errors and omissions", "wrongful act", "claims-made and reported", "retroactive date", "prior acts"], confidenceWeight: 0.9 },
    { role: "RULES", signals: ["professional services", "eligible professions", "prior claims", "professional indemnity questionnaire"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    primaryFormPattern: "professional\\s+liability|errors\\s+and\\s+omissions|e&o|professional\\s+indemnity",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "CLAIMS_MADE_STEP_FACTOR", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT",
    defaultVariableOp: "MUL",
    hasLcmStep: false,
    hasExpMod: false,
    hasClaimsMadeStepFactors: true,
    // Step factor reaches 100% (occurrence-equivalent) by policy year 5.
    // First-year factor approximately 38–60% depending on profession and insurer
    // (Gillam & Snader 1992 "Reserving for Claims-Made Policies").
    notes: "Step rating: first-year premium \u224838\u201360% of occurrence-equivalent; 100% by year 5. Retroactive date removes prior-acts coverage, resetting the step factor. Deductible options are critical premium drivers."
  }
};
var PROFESSIONAL_LIABILITY_FIXTURE = {
  rt: {
    "LI.PL.RT.001": {
      // Source: carrier-proprietary PL base rate by profession and revenue band (illustrative).
      // Mature (year-5+) occurrence-equivalent rate.
      name: "PL Base Rate by Profession Class and Revenue Band (mature)",
      columns: ["profClass", "revenueBand", "rate"],
      dimensions: [
        { key: "profClass", label: "Profession Class", values: ["ACCOUNTANT", "CONSULTANT", "TECH_VENDOR", "ARCHITECT"] },
        { key: "revenueBand", label: "Revenue Band", values: ["500K", "1M", "5M", "25M"] }
      ],
      valueColumn: "rate",
      rows: [
        { profClass: "ACCOUNTANT", revenueBand: "500K", rate: 1500 },
        { profClass: "ACCOUNTANT", revenueBand: "1M", rate: 3e3 },
        { profClass: "ACCOUNTANT", revenueBand: "5M", rate: 7e3 },
        { profClass: "CONSULTANT", revenueBand: "1M", rate: 2500 },
        { profClass: "TECH_VENDOR", revenueBand: "1M", rate: 4e3 },
        { profClass: "ARCHITECT", revenueBand: "1M", rate: 3500 }
      ]
    },
    "LI.PL.RT.002": {
      // Source: market-standard E&O claims-made step factors (illustrative; range 38–60% yr 1).
      // Gillam & Snader (1992) documented ~40–55% first-year step for accounting/consulting.
      name: "Claims-Made Step Factor by Policy Year",
      columns: ["year", "factor"],
      dimensions: [{ key: "year", label: "Policy Year", values: ["1", "2", "3", "4", "5+"] }],
      valueColumn: "factor",
      rows: [
        { year: "1", factor: 0.45 },
        { year: "2", factor: 0.65 },
        { year: "3", factor: 0.8 },
        { year: "4", factor: 0.92 },
        { year: "5+", factor: 1 }
      ]
    },
    "LI.PL.RT.003": {
      // Source: carrier-proprietary PL deductible credit (illustrative).
      name: "Deductible Credit Factor",
      columns: ["deductible", "factor"],
      dimensions: [{ key: "deductible", label: "Per-Claim Deductible", values: ["0", "1000", "2500", "5000", "10000"] }],
      valueColumn: "factor",
      rows: [
        { deductible: "0", factor: 1 },
        { deductible: "1000", factor: 0.95 },
        { deductible: "2500", factor: 0.9 },
        { deductible: "5000", factor: 0.83 },
        { deductible: "10000", factor: 0.75 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.PL.RAT.1",
    name: "Professional Liability Rating Program (archetype fixture)",
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Mature base rate by profession/revenue", op: "SET", source: { type: "RT", ref: "LI.PL.RT.001", keys: ["profClass", "revenueBand"] } },
      { id: "s2", order: 2, label: "Claims-made step factor", op: "MUL", source: { type: "RT", ref: "LI.PL.RT.002", keys: ["year"] } },
      { id: "s3", order: 3, label: "Deductible credit", op: "MUL", source: { type: "RT", ref: "LI.PL.RT.003", keys: ["deductible"] } },
      { id: "s4", order: 4, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 500 }, roundTo: 0 }
    ]
  },
  workedExample: { profClass: "ACCOUNTANT", revenueBand: "1M", year: "1", deductible: "2500" },
  expectedPremium: 1215
};

// shared/src/lines/__fixtures__/crime.golden.ts
var CRIME_ARCHETYPE = {
  lobRefId: "CR.FAMILY",
  displayName: "Crime / Fidelity (ISO CR 00 22 discovery form)",
  family: "CRIME",
  exposureBases: ["PER_UNIT", "FLAT"],
  // Commercial crime is written on discovery (claims-made equivalent — covers losses
  // discovered during the policy period regardless of when they occurred).
  triggerTypes: ["CLAIMS_MADE"],
  limitStructures: ["SINGLE_AGGREGATE_WITH_SUBLIMITS", "SCHEDULED"],
  aggregatePatterns: ["PER_INSURING_AGREEMENT_SUBLIMIT"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    { bureau: "ISO", rangeStart: 1, rangeEnd: 91, kind: "FACTOR_TABLE", description: "Crime base rate tables and rating factors (risk class, number of employees, limit)." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "Crime minimum premium." },
    { bureau: "ISO", rangeStart: 500, rangeEnd: 699, kind: "ENDORSEMENT_SCHEDULE", description: "Crime endorsement premiums (computer fraud, forgery, social engineering)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["crime rate order", "fidelity rate", "commercial crime rate"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["crime manual", "fidelity manual", "commercial crime manual", "cr 00"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["cr 00 22", "cr0022", "commercial crime policy", "discovery form", "insuring agreement a employee theft", "forgery"], confidenceWeight: 0.9 },
    { role: "RULES", signals: ["crime eligibility", "fidelity questionnaire", "employee honesty", "prior bond cancellation"], confidenceWeight: 0.75 }
  ],
  translationRecipe: {
    primaryFormPattern: "^CR\\s*00\\s*2[23]|commercial\\s+crime|fidelity\\s+bond",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT",
    defaultVariableOp: "MUL",
    hasLcmStep: false,
    hasExpMod: false,
    hasClaimsMadeStepFactors: false,
    notes: "Discovery form (CR 00 22) vs loss-sustained form (CR 00 23) is the primary product split. Per-insuring-agreement limits (employee theft, forgery, computer fraud) nest within the policy aggregate."
  }
};
var CRIME_FIXTURE = {
  rt: {
    "LI.CR.RT.001": {
      // Source: ISO crime base rate by risk class and employee count (illustrative).
      name: "Crime Base Premium by Risk Class and Employee Count",
      columns: ["riskClass", "numEmployees", "rate"],
      dimensions: [
        { key: "riskClass", label: "Risk Class", values: ["RETAIL", "PROFESSIONAL", "FINANCIAL", "HEALTHCARE"] },
        { key: "numEmployees", label: "Number of Employees", values: ["1-5", "6-10", "11-25", "26-50"] }
      ],
      valueColumn: "rate",
      rows: [
        { riskClass: "RETAIL", numEmployees: "1-5", rate: 300 },
        { riskClass: "RETAIL", numEmployees: "6-10", rate: 500 },
        { riskClass: "RETAIL", numEmployees: "11-25", rate: 900 },
        { riskClass: "PROFESSIONAL", numEmployees: "6-10", rate: 400 },
        { riskClass: "FINANCIAL", numEmployees: "6-10", rate: 900 },
        { riskClass: "HEALTHCARE", numEmployees: "6-10", rate: 600 }
      ]
    },
    "LI.CR.RT.002": {
      // Source: ISO crime limit factor (illustrative; base at $100,000 per-IA limit).
      name: "Limit Factor",
      columns: ["limit", "factor"],
      dimensions: [{ key: "limit", label: "Per-Insuring-Agreement Limit", values: ["25000", "50000", "100000", "250000", "500000"] }],
      valueColumn: "factor",
      rows: [
        { limit: "25000", factor: 0.6 },
        { limit: "50000", factor: 0.8 },
        { limit: "100000", factor: 1 },
        { limit: "250000", factor: 1.45 },
        { limit: "500000", factor: 2.1 }
      ]
    },
    "LI.CR.RT.003": {
      // Source: ISO crime deductible credit (illustrative).
      name: "Deductible Credit Factor",
      columns: ["deductible", "factor"],
      dimensions: [{ key: "deductible", label: "Deductible", values: ["0", "500", "1000", "2500", "5000"] }],
      valueColumn: "factor",
      rows: [
        { deductible: "0", factor: 1 },
        { deductible: "500", factor: 0.95 },
        { deductible: "1000", factor: 0.9 },
        { deductible: "2500", factor: 0.8 },
        { deductible: "5000", factor: 0.7 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.CR.RAT.1",
    name: "Crime Rating Program (archetype fixture)",
    minimumPremium: 250,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Base premium by risk class/employees", op: "SET", source: { type: "RT", ref: "LI.CR.RT.001", keys: ["riskClass", "numEmployees"] } },
      { id: "s2", order: 2, label: "Limit factor", op: "MUL", source: { type: "RT", ref: "LI.CR.RT.002", keys: ["limit"] } },
      { id: "s3", order: 3, label: "Deductible credit", op: "MUL", source: { type: "RT", ref: "LI.CR.RT.003", keys: ["deductible"] } },
      { id: "s4", order: 4, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 250 }, roundTo: 0 }
    ]
  },
  workedExample: { riskClass: "RETAIL", numEmployees: "6-10", limit: "100000", deductible: "1000" },
  expectedPremium: 450
};

// shared/src/lines/__fixtures__/excessUmbrella.golden.ts
var EXCESS_UMBRELLA_ARCHETYPE = {
  lobRefId: "XS.FAMILY",
  displayName: "Commercial Excess / Umbrella (follow-form + drop-down)",
  family: "UMBRELLA",
  exposureBases: ["PER_LOCATION", "FLAT", "REVENUE"],
  // Commercial umbrella is occurrence-trigger following the underlying policy;
  // excess follow-form matches the underlying trigger (occurrence or claims-made).
  triggerTypes: ["OCCURRENCE", "CLAIMS_MADE_WITH_RETRO"],
  limitStructures: ["CSL", "PER_OCCURRENCE_PLUS_AGGREGATE"],
  aggregatePatterns: ["GENERAL_AGGREGATE", "PRODUCTS_COMPLETED_OPS_AGGREGATE"],
  ratingStageArchetypes: ["BASE_RATE_RELATIVITY_CHAIN", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
  bureauRuleNumberSemantics: [
    { bureau: "ISO", rangeStart: 1, rangeEnd: 91, kind: "FACTOR_TABLE", description: "ISO CU base rate tables and rating factors (primary-line limit, layers, retained limit)." },
    { bureau: "ISO", rangeStart: 205, rangeEnd: 205, kind: "MIN_PREMIUM", description: "Commercial umbrella minimum premium." },
    { bureau: "PROPRIETARY", rangeStart: 1, rangeEnd: 999, kind: "FACTOR_TABLE", description: "Carrier-proprietary excess/umbrella pricing (loss-sensitive, large-account)." }
  ],
  documentRoleFingerprints: [
    { role: "RATE_ORDER", signals: ["commercial umbrella rate", "excess liability rate", "umbrella rate order", "cu 00"], confidenceWeight: 0.9 },
    { role: "MANUAL", signals: ["commercial umbrella manual", "excess liability manual", "cu manual"], confidenceWeight: 0.85 },
    { role: "POLICY_FORM", signals: ["cu 00 01", "commercial umbrella", "umbrella liability", "retained limit", "underlying insurance", "drop-down coverage"], confidenceWeight: 0.9 },
    { role: "DECLARATIONS", signals: ["schedule of underlying insurance", "retained limit", "umbrella declarations"], confidenceWeight: 0.8 }
  ],
  translationRecipe: {
    primaryFormPattern: "^CU\\s*00\\s*01|commercial\\s+umbrella|excess\\s+liability",
    ratingProgramStructure: ["BASE_RATE_RELATIVITY_CHAIN", "SCHEDULE_RATING_CAPPED", "MINIMUM_PREMIUM_FLOOR"],
    productSplitStrategy: "SINGLE_PRODUCT",
    defaultVariableOp: "MUL",
    hasLcmStep: false,
    hasExpMod: false,
    hasClaimsMadeStepFactors: false,
    notes: "Commercial umbrella drops down to fill primary-policy gaps; excess follow-form strictly follows the underlying triggers and exclusions. Retained limit = the underlying per-occurrence limit the umbrella sits above."
  }
};
var EXCESS_UMBRELLA_FIXTURE = {
  rt: {
    "LI.XS.RT.001": {
      // Source: ISO CU base premium per $1M of umbrella limit by primary line (illustrative).
      name: "Umbrella Base Premium per $1M by Primary Line",
      columns: ["primaryLine", "limit", "rate"],
      dimensions: [
        { key: "primaryLine", label: "Primary Line of Business", values: ["GL", "CPP", "BOP", "CA"] },
        { key: "limit", label: "Underlying Retained Limit", values: ["1M", "2M", "5M"] }
      ],
      valueColumn: "rate",
      rows: [
        { primaryLine: "GL", limit: "1M", rate: 2e3 },
        { primaryLine: "GL", limit: "2M", rate: 1500 },
        { primaryLine: "CPP", limit: "1M", rate: 1800 },
        { primaryLine: "BOP", limit: "1M", rate: 1200 },
        { primaryLine: "CA", limit: "1M", rate: 2500 }
      ]
    }
  },
  ld: {},
  program: {
    refId: "LI.XS.RAT.1",
    name: "Commercial Excess/Umbrella Rating Program (archetype fixture)",
    minimumPremium: 500,
    ...fixtureGov(),
    allStates: true,
    states: [],
    steps: [
      { id: "s1", order: 1, label: "Base premium per $1M of limit", op: "SET", source: { type: "RT", ref: "LI.XS.RT.001", keys: ["primaryLine", "limit"] } },
      { id: "s2", order: 2, label: "Number of $1M limit layers", op: "MUL", source: { type: "INPUT", ref: "numMillions" } },
      { id: "s3", order: 3, label: "Minimum premium floor", op: "MIN_FLOOR", source: { type: "CONST", value: 500 }, roundTo: 0 }
    ]
  },
  workedExample: { primaryLine: "GL", limit: "1M", numMillions: 2 },
  expectedPremium: 4e3
};

// shared/src/lines/registry.ts
var LINE_INTELLIGENCE_REGISTRY = {
  // ── Seeded lines (lobRefId matches LOB_REGISTRY) ──────────────────────────
  "PH.LOB.001": HOMEOWNERS_ARCHETYPE,
  // personal property → PERSONAL_PROPERTY
  "PA.LOB.001": PERSONAL_AUTO_ARCHETYPE,
  // personal auto     → PERSONAL_AUTO
  "GL.LOB.001": GENERAL_LIABILITY_ARCHETYPE,
  // general liability  → GENERAL_LIABILITY
  // ── Virtual families (no seeded product; adaptive importer uses archetype alone) ─
  "DP.FAMILY": DWELLING_ARCHETYPE,
  // dwelling fire / landlord
  "PU.FAMILY": PERSONAL_UMBRELLA_ARCHETYPE,
  // personal umbrella
  "IM.FAMILY": INLAND_MARINE_ARCHETYPE,
  // inland marine / valuable articles
  "FL.FAMILY": FLOOD_ARCHETYPE,
  // flood (NFIP + private)
  "CP.FAMILY": COMMERCIAL_PROPERTY_ARCHETYPE,
  // commercial property
  "CA.FAMILY": COMMERCIAL_AUTO_ARCHETYPE,
  // commercial auto
  "WC.FAMILY": WORKERS_COMP_ARCHETYPE,
  // workers compensation
  "BP.FAMILY": BOP_ARCHETYPE,
  // business owners policy
  "CPP.FAMILY": COMMERCIAL_PACKAGE_ARCHETYPE,
  // commercial package policy
  "CY.FAMILY": CYBER_ARCHETYPE,
  // cyber
  "ML.FAMILY": MANAGEMENT_LIABILITY_ARCHETYPE,
  // management liability (D&O, EPL)
  "PL.FAMILY": PROFESSIONAL_LIABILITY_ARCHETYPE,
  // professional liability / E&O
  "CR.FAMILY": CRIME_ARCHETYPE,
  // crime / fidelity
  "XS.FAMILY": EXCESS_UMBRELLA_ARCHETYPE
  // commercial excess / umbrella
};
PH_LOB.lineIntelligence = HOMEOWNERS_ARCHETYPE;
PA_LOB.lineIntelligence = PERSONAL_AUTO_ARCHETYPE;
GL_LOB.lineIntelligence = GENERAL_LIABILITY_ARCHETYPE;
function resolveLineArchetypeByPrefix(prefix) {
  const upper = prefix.toUpperCase();
  const exact = Object.values(LINE_INTELLIGENCE_REGISTRY).find((a) => a.lobRefId === upper);
  if (exact) return exact;
  return Object.values(LINE_INTELLIGENCE_REGISTRY).find((a) => a.lobRefId.startsWith(`${upper}.`));
}

// shared/src/rating/kits.ts
var KITS = {
  PH: {
    makeRtGetter: makePHRtGetter,
    makeLdGetter: makePHLdGetter,
    workedExample: { ...PH_WORKED_EXAMPLE }
  },
  PA: {
    makeRtGetter: makePARtGetter,
    makeLdGetter: makePALdGetter,
    workedExample: { ...PA_WORKED_EXAMPLE },
    inputSpec: PA_RATING_INPUT_SPEC
  },
  GL: {
    makeRtGetter: makeGLRtGetter,
    makeLdGetter: makeGLLdGetter,
    workedExample: { ...GL_WORKED_EXAMPLE },
    inputSpec: GL_RATING_INPUT_SPEC
  }
};
var BESPOKE_KIT_PREFIXES = Object.keys(KITS);
function resolveRatingKit(lobPrefix) {
  if (KITS[lobPrefix]) return KITS[lobPrefix];
  const archetype = resolveLineArchetypeByPrefix(lobPrefix);
  if (archetype) return ratingKitGenerator(archetype);
  return KITS["PH"];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  STATE_FILING_MATRIX,
  TEXAS_FILING_PROFILE,
  assembleSerffBundle,
  buildHistogram,
  buildMemoStructure,
  checkTexasBundle,
  computePremiumImpacts,
  diffProducts,
  documentsInTab,
  generateRateExhibit,
  generateRedlineDocuments,
  getStateProfile,
  overallImpactPct,
  requiresMarkedCopies,
  requiresRateExhibits,
  resolveRatingKit
});
