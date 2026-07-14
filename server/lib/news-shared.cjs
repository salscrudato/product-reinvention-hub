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

// shared/src/grounding/sources.ts
var sources_exports = {};
__export(sources_exports, {
  deterministicColor: () => deterministicColor,
  extractInlineImage: () => extractInlineImage,
  extractOgImage: () => extractOgImage,
  resolveImageUrl: () => resolveImageUrl,
  sanitizeNewsUrl: () => sanitizeNewsUrl,
  verifyItems: () => verifyItems
});
module.exports = __toCommonJS(sources_exports);
function sanitizeNewsUrl(raw) {
  const s = (raw ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(s)) return null;
  return s;
}
function extractOgImage(html) {
  const patterns = [
    /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*\/?>/i,
    /<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["'][^>]*\/?>/i
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    const v = m?.[1]?.trim();
    if (v) return v;
  }
  return null;
}
function extractInlineImage(html) {
  const imgPattern = /<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gi;
  let match;
  while ((match = imgPattern.exec(html)) !== null) {
    const fullTag = match[0];
    const src = match[1]?.trim();
    if (!src) continue;
    const widthMatch = /\bwidth=["']?(\d+)["']?/i.exec(fullTag);
    const heightMatch = /\bheight=["']?(\d+)["']?/i.exec(fullTag);
    const w = widthMatch ? parseInt(widthMatch[1], 10) : null;
    const h = heightMatch ? parseInt(heightMatch[1], 10) : null;
    if (w !== null && w < 10 || h !== null && h < 10) continue;
    if (w === null && h === null || w !== null && w >= 200 || h !== null && h >= 200) {
      return src;
    }
  }
  return null;
}
function resolveImageUrl(candidate, baseUrl) {
  const c = (candidate ?? "").trim();
  if (!c || /\s/.test(c)) return null;
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(c, base);
    return resolved.href;
  } catch {
    return null;
  }
}
function deterministicColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h, 31) + seed.charCodeAt(i) | 0;
  const hue = Math.abs(h) % 360;
  const s = 70, l = 50;
  const c = (1 - Math.abs(2 * l / 100 - 1)) * (s / 100);
  const x = c * (1 - Math.abs(hue / 60 % 2 - 1));
  const m = l / 100 - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (hue < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (hue < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (hue < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
async function verifyItems(items, isLive) {
  const gated = items.map((it) => ({ it, url: sanitizeNewsUrl(it.url) })).filter((g) => g.url !== null);
  const alive = await Promise.all(gated.map((g) => isLive(g.url)));
  const out = [];
  gated.forEach((g, i) => {
    if (alive[i]) out.push({ ...g.it, url: g.url });
  });
  return out;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  deterministicColor,
  extractInlineImage,
  extractOgImage,
  resolveImageUrl,
  sanitizeNewsUrl,
  verifyItems
});
