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

// shared/src/retrieval/chunk.ts
var chunk_exports = {};
__export(chunk_exports, {
  buildBundleChunks: () => buildBundleChunks,
  chunkBaseFormText: () => chunkBaseFormText,
  chunkCoverage: () => chunkCoverage,
  chunkDictionary: () => chunkDictionary,
  chunkForm: () => chunkForm,
  chunkFormRule: () => chunkFormRule,
  chunkLdTable: () => chunkLdTable,
  chunkProduct: () => chunkProduct,
  chunkRatingProgram: () => chunkRatingProgram,
  chunkRtTable: () => chunkRtTable,
  chunkRule: () => chunkRule,
  contentHash: () => contentHash,
  dedupeChunks: () => dedupeChunks
});
module.exports = __toCommonJS(chunk_exports);

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
function chunkBaseFormText(formNumber, text, softLimit = 900) {
  const norm = normalizeFormNumber(formNumber);
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s+\n/g, "\n").trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  let heading = "";
  const flush = () => {
    if (!buf.trim()) return;
    const n = chunks.length;
    const chunkText = body(`Form ${formNumber} \u2014 ${heading || "text"}`, buf);
    chunks.push(make(`baseForm:${norm}:${n}`, chunkText, {
      type: "baseForm",
      refId: null,
      formNumber,
      productId: null,
      path: `forms/${formNumber.replace(/\s+/g, "-")}`,
      title: `${formNumber} \u2014 ${heading || `section ${n + 1}`}`,
      section: heading || void 0
    }));
    buf = "";
  };
  for (const p of paras) {
    if (p.length < 70 && /[A-Z]/.test(p) && p === p.toUpperCase()) {
      flush();
      heading = p;
    }
    buf = buf ? `${buf}

${p}` : p;
    if (buf.length >= softLimit) flush();
  }
  flush();
  return chunks;
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildBundleChunks,
  chunkBaseFormText,
  chunkCoverage,
  chunkDictionary,
  chunkForm,
  chunkFormRule,
  chunkLdTable,
  chunkProduct,
  chunkRatingProgram,
  chunkRtTable,
  chunkRule,
  contentHash,
  dedupeChunks
});
