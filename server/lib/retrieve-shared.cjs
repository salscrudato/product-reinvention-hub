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

// shared/src/retrieval/retrieve.ts
var retrieve_exports = {};
__export(retrieve_exports, {
  cosineSim: () => cosineSim,
  dequantizeInt8: () => dequantizeInt8,
  hybridScore: () => hybridScore,
  keywordOverlapScore: () => keywordOverlapScore,
  lexicalRetrieve: () => lexicalRetrieve,
  quantizeInt8: () => quantizeInt8,
  retrievalTerms: () => retrievalTerms
});
module.exports = __toCommonJS(retrieve_exports);

// shared/src/search/rank.ts
var tokenize = (s) => s.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length > 1);
function rankDocuments(query, docs, topK = 15) {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return docs.slice(0, topK).map((d) => ({ id: d.id, score: 0 }));
  const N = docs.length || 1;
  const docTokens = docs.map((d) => tokenize(d.text));
  const df = /* @__PURE__ */ new Map();
  for (const toks of docTokens) for (const w of new Set(toks)) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w) => Math.log(1 + N / ((df.get(w) ?? 0) + 1));
  const qtf = /* @__PURE__ */ new Map();
  for (const w of qTokens) qtf.set(w, (qtf.get(w) ?? 0) + 1);
  const qVec = /* @__PURE__ */ new Map();
  qtf.forEach((tf, w) => qVec.set(w, tf * idf(w)));
  const qNorm = Math.sqrt([...qVec.values()].reduce((s, v) => s + v * v, 0)) || 1;
  const scored = docs.map((d, i) => {
    const tf = /* @__PURE__ */ new Map();
    for (const w of docTokens[i]) tf.set(w, (tf.get(w) ?? 0) + 1);
    let dot = 0, sumSq = 0;
    tf.forEach((f, w) => {
      const wt = f * idf(w);
      sumSq += wt * wt;
      const qw = qVec.get(w);
      if (qw) dot += qw * wt;
    });
    const dNorm = Math.sqrt(sumSq) || 1;
    return { id: d.id, score: dot / (qNorm * dNorm) };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

// shared/src/retrieval/retrieve.ts
function lexicalRetrieve(query, chunks, opts = {}) {
  const topK = opts.topK ?? 8;
  const pool = chunks.filter((c) => {
    if (opts.types && !opts.types.includes(c.metadata.type)) return false;
    if (opts.productId && c.metadata.productId && c.metadata.productId !== opts.productId) return false;
    return true;
  });
  if (pool.length === 0) return [];
  const docs = pool.map((c, i) => ({
    id: String(i),
    // refId ×2 + form number + title boost the citation anchors, then the body.
    text: `${c.metadata.refId ?? ""} ${c.metadata.refId ?? ""} ${c.metadata.formNumber ?? ""} ${c.metadata.title} ${c.text}`
  }));
  const ranked = rankDocuments(query, docs, topK).filter((r) => r.score > 0 || !query.trim());
  return ranked.map((r) => ({ chunk: pool[Number(r.id)], score: r.score }));
}
function cosineSim(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
function quantizeInt8(vec) {
  let max = 0;
  for (const v of vec) {
    const a = Math.abs(v);
    if (a > max) max = a;
  }
  const scale = max === 0 ? 1 : max / 127;
  return { values: vec.map((v) => Math.max(-127, Math.min(127, Math.round(v / scale)))), scale };
}
function dequantizeInt8(q) {
  return q.values.map((v) => v * q.scale);
}
function retrievalTerms(s) {
  return String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}
function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}
function keywordOverlapScore(query, text) {
  const terms = [...new Set(retrievalTerms(query))];
  if (terms.length === 0) return 0;
  const lc = String(text ?? "").toLowerCase();
  let present = 0, hits = 0;
  for (const t of terms) {
    const n = countOccurrences(lc, t);
    if (n > 0) {
      present++;
      hits += Math.min(n, 3);
    }
  }
  const coverage = present / terms.length;
  const density = hits / (terms.length * 3);
  return 0.8 * coverage + 0.2 * density;
}
function hybridScore(dense, lexical, alpha = 0.7) {
  if (dense === null || Number.isNaN(dense)) return lexical;
  const d = Math.max(0, Math.min(1, dense));
  return alpha * d + (1 - alpha) * lexical;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cosineSim,
  dequantizeInt8,
  hybridScore,
  keywordOverlapScore,
  lexicalRetrieve,
  quantizeInt8,
  retrievalTerms
});
