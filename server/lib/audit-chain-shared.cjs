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

// shared/src/audit/chain.ts
var chain_exports = {};
__export(chain_exports, {
  AUDIT_HASH_FIELDS: () => AUDIT_HASH_FIELDS,
  canonicalize: () => canonicalize,
  computeAuditHash: () => computeAuditHash,
  sha256Hex: () => sha256Hex,
  verifyAuditChain: () => verifyAuditChain
});
module.exports = __toCommonJS(chain_exports);
var K = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
var rotr = (x, n) => x >>> n | x << 32 - n;
function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((bytes.length + 8 >> 6) + 1 << 6);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  let h0 = 1779033703, h1 = 3144134277, h2 = 1013904242, h3 = 2773480762;
  let h4 = 1359893119, h5 = 2600822924, h6 = 528734635, h7 = 1541459225;
  const w = new Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h0 = h0 + a >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
    h5 = h5 + f >>> 0;
    h6 = h6 + g >>> 0;
    h7 = h7 + h >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("");
}
function canonicalize(v) {
  if (v === null || v === void 0) return "null";
  if (typeof v === "number" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.filter((k) => v[k] !== void 0).map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(",")}}`;
  }
  return "null";
}
var AUDIT_HASH_FIELDS = [
  "tenantId",
  "entityPath",
  "entityType",
  "op",
  "actor",
  "rev",
  "at",
  "source",
  "diff",
  "prevHash"
];
function computeAuditHash(evt) {
  const subset = {};
  for (const f of AUDIT_HASH_FIELDS) subset[f] = evt[f] ?? null;
  const prov = evt.provenance;
  if (prov != null) subset.provenance = prov;
  return sha256Hex(canonicalize(subset));
}
var pathKey = (e) => `${e.tenantId} ${e.entityPath}`;
function verifyAuditChain(events, expectedHeads) {
  const byPath = /* @__PURE__ */ new Map();
  let legacy = 0;
  for (const e of events) {
    if (e.hash === void 0 || e.hash === null) {
      legacy++;
      continue;
    }
    const key = pathKey(e);
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push(e);
  }
  const breaks = [];
  let checked = 0;
  for (const [key, chain] of byPath) {
    const entityPath = chain[0].entityPath;
    for (const e of chain) {
      checked++;
      const recomputed = computeAuditHash(e);
      if (recomputed !== e.hash) {
        breaks.push({
          entityPath,
          id: e.id,
          rev: e.rev,
          reason: "hash_mismatch",
          detail: `stored hash ${String(e.hash).slice(0, 12)} != recomputed ${recomputed.slice(0, 12)} \u2014 event content was altered`
        });
      }
    }
    const byPrev = /* @__PURE__ */ new Map();
    for (const e of chain) {
      const k = e.prevHash ?? null;
      if (!byPrev.has(k)) byPrev.set(k, []);
      byPrev.get(k).push(e);
    }
    const starts = byPrev.get(null) ?? [];
    if (starts.length === 0) {
      breaks.push({
        entityPath,
        reason: "link_broken",
        detail: "no chain head found (every event claims a predecessor) \u2014 the first event was deleted or altered"
      });
      continue;
    }
    if (starts.length > 1) {
      breaks.push({
        entityPath,
        id: starts[1].id,
        rev: starts[1].rev,
        reason: "fork",
        detail: `${starts.length} events claim to start the chain (prevHash null)`
      });
    }
    const visited = /* @__PURE__ */ new Set();
    let cur = starts[0];
    let tail = starts[0];
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      tail = cur;
      const successors = byPrev.get(cur.hash) ?? [];
      if (successors.length > 1) {
        breaks.push({
          entityPath,
          id: successors[1].id,
          rev: successors[1].rev,
          reason: "fork",
          detail: `${successors.length} events claim the same predecessor ${String(cur.hash).slice(0, 12)} \u2014 an event was inserted`
        });
      }
      cur = successors[0];
    }
    for (const e of chain) {
      if (!visited.has(e)) {
        breaks.push({
          entityPath,
          id: e.id,
          rev: e.rev,
          reason: "orphaned",
          detail: `event is unreachable from the chain head \u2014 its predecessor (prevHash ${String(e.prevHash).slice(0, 12)}) is missing or altered`
        });
      }
    }
    const expected = expectedHeads?.get(key);
    if (expected !== void 0 && tail.hash !== expected) {
      breaks.push({
        entityPath,
        id: tail.id,
        rev: tail.rev,
        reason: "tail_missing",
        detail: `chain ends at ${String(tail.hash).slice(0, 12)} but the chainHead anchor is ${expected.slice(0, 12)} \u2014 the newest event(s) were deleted`
      });
    }
  }
  return { ok: breaks.length === 0, checked, legacy, paths: byPath.size, breaks };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AUDIT_HASH_FIELDS,
  canonicalize,
  computeAuditHash,
  sha256Hex,
  verifyAuditChain
});
