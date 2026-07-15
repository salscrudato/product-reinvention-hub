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

// shared/src/platform/server-entry.ts
var server_entry_exports = {};
__export(server_entry_exports, {
  BRAND_ACCENTS: () => BRAND_ACCENTS,
  DEFAULT_ENTITLEMENTS: () => DEFAULT_ENTITLEMENTS,
  ENTITLEMENT_CAPS: () => ENTITLEMENT_CAPS,
  FEATURE_FLAGS: () => FEATURE_FLAGS,
  FLAG_KEYS: () => FLAG_KEYS,
  KNOWN_AI_ROLES: () => KNOWN_AI_ROLES,
  TENANT_OVERRIDABLE_KEYS: () => TENANT_OVERRIDABLE_KEYS,
  effectiveEntitlements: () => effectiveEntitlements,
  flagDef: () => flagDef,
  isKnownFlag: () => isKnownFlag,
  mergeConfig: () => mergeConfig,
  resolveFlag: () => resolveFlag,
  resolveFlags: () => resolveFlags,
  sanitizeFlagOverrides: () => sanitizeFlagOverrides,
  validateConfigPatch: () => validateConfigPatch
});
module.exports = __toCommonJS(server_entry_exports);

// shared/src/platform/featureFlags.ts
var FEATURE_FLAGS = [
  // Product-workspace tabs
  { key: "tab.overview", label: "Overview tab", group: "tab", defaultEnabled: true, tenantOverridable: true },
  { key: "tab.coverages", label: "Coverages tab", group: "tab", defaultEnabled: true, tenantOverridable: true },
  { key: "tab.rules", label: "Rules tab", group: "tab", defaultEnabled: true, tenantOverridable: true },
  { key: "tab.forms", label: "Forms tab", group: "tab", defaultEnabled: true, tenantOverridable: true },
  { key: "tab.states", label: "States tab", group: "tab", defaultEnabled: true, tenantOverridable: true },
  // Pages / routes
  { key: "page.rating", label: "Rating", group: "page", defaultEnabled: true, tenantOverridable: true },
  { key: "page.claims", label: "Claims", group: "page", defaultEnabled: true, tenantOverridable: true },
  { key: "page.homeCheck", label: "HomeCheck", group: "page", defaultEnabled: true, tenantOverridable: true },
  { key: "page.explorer", label: "Explorer", group: "page", defaultEnabled: true, tenantOverridable: true },
  { key: "page.tasks", label: "Tasks", group: "page", defaultEnabled: true, tenantOverridable: true },
  // EX-02 (DEFAULTS_SPEC §2): the Dictionary hides by default and is EARNED — a
  // successful Duck Creek export (validation ladder green + bundle delivered) flips
  // the tenant override true server-side (P3's export-success hook). The literal key
  // 'page.dictionary' is the ONE shared switch between P2 (default + gated render)
  // and P3 (the unlock write); neither side invents a second flag.
  { key: "page.dictionary", label: "Dictionary", group: "page", defaultEnabled: false, tenantOverridable: true },
  { key: "page.news", label: "News", group: "page", defaultEnabled: true, tenantOverridable: true },
  { key: "page.builder", label: "Builder", group: "page", defaultEnabled: true, tenantOverridable: true },
  { key: "page.feedback", label: "Feedback", group: "page", defaultEnabled: true, tenantOverridable: true },
  { key: "page.policyholderPortal", label: "Policyholder portal", group: "page", defaultEnabled: true, tenantOverridable: true },
  { key: "page.filing", label: "Filing", group: "page", defaultEnabled: true, tenantOverridable: true },
  // Public marketing surface — platform-controlled, NOT a per-tenant decision.
  { key: "page.pricing", label: "Pricing", group: "page", defaultEnabled: true, tenantOverridable: false },
  // Major features
  { key: "feature.agenticCopilot", label: "Agentic copilot", group: "feature", defaultEnabled: true, tenantOverridable: true },
  { key: "feature.draftRule", label: "AI draft rule", group: "feature", defaultEnabled: true, tenantOverridable: true },
  { key: "feature.scaffoldProduct", label: "AI scaffold product", group: "feature", defaultEnabled: true, tenantOverridable: true },
  { key: "feature.filingGeneration", label: "Filing generation", group: "feature", defaultEnabled: true, tenantOverridable: true },
  { key: "feature.newsRefresh", label: "News refresh", group: "feature", defaultEnabled: true, tenantOverridable: true },
  { key: "feature.agentVisualizer", label: "Agent visualizer", group: "feature", defaultEnabled: true, tenantOverridable: true },
  // Public share links expose tenant data outside auth — a platform risk decision.
  { key: "feature.shareLinks", label: "Share links", group: "feature", defaultEnabled: true, tenantOverridable: false }
];
var FLAG_BY_KEY = new Map(FEATURE_FLAGS.map((f) => [f.key, f]));
var FLAG_KEYS = FEATURE_FLAGS.map((f) => f.key);
function isKnownFlag(key) {
  return FLAG_BY_KEY.has(key);
}
function flagDef(key) {
  return FLAG_BY_KEY.get(key);
}
var TENANT_OVERRIDABLE_KEYS = FEATURE_FLAGS.filter((f) => f.tenantOverridable).map((f) => f.key);
function resolveFlag(key, globalOverrides, tenantOverrides) {
  const def = FLAG_BY_KEY.get(key);
  if (!def) return false;
  const g = globalOverrides?.[key];
  if (g === false) return false;
  let value = g === true ? true : def.defaultEnabled;
  if (def.tenantOverridable && tenantOverrides && typeof tenantOverrides[key] === "boolean") {
    value = tenantOverrides[key];
  }
  return value;
}
function resolveFlags(globalOverrides, tenantOverrides) {
  const out = {};
  for (const def of FEATURE_FLAGS) out[def.key] = resolveFlag(def.key, globalOverrides, tenantOverrides);
  return out;
}
function sanitizeFlagOverrides(input, plane) {
  const value = {};
  const unknownKeys = [];
  const forbiddenKeys = [];
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [k, v] of Object.entries(input)) {
      const def = FLAG_BY_KEY.get(k);
      if (!def) {
        unknownKeys.push(k);
        continue;
      }
      if (typeof v !== "boolean") {
        unknownKeys.push(k);
        continue;
      }
      if (plane === "tenant" && !def.tenantOverridable) {
        forbiddenKeys.push(k);
        continue;
      }
      value[k] = v;
    }
  }
  return { value, unknownKeys, forbiddenKeys };
}

// shared/src/platform/tenantConfig.ts
var BRAND_ACCENTS = ["default", "blue", "violet", "emerald", "amber", "rose", "slate"];
var KNOWN_AI_ROLES = ["GROUNDED_CITED", "MID_REASONER", "BULK_VERIFY", "VISION", "CHEAP_GENERAL", "EMBED"];
var ENTITLEMENT_CAPS = {
  maxSeats: 1e5,
  maxProducts: 1e5,
  monthlyAiTokenBudget: 5e9
  // 5B tokens/month
};
var DEFAULT_ENTITLEMENTS = {
  maxSeats: 25,
  maxProducts: 100,
  monthlyAiTokenBudget: 2e7,
  // 20M tokens/month
  aiModelRoles: ["GROUNDED_CITED", "MID_REASONER", "BULK_VERIFY", "VISION", "CHEAP_GENERAL", "EMBED"]
};
var isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var isInt = (v) => typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
var clampStr = (v, max) => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return s.slice(0, max);
};
function validateBranding(input, errors) {
  if (input === void 0) return void 0;
  if (!isPlainObject(input)) {
    errors.push("branding must be an object");
    return void 0;
  }
  const out = {};
  if (input.displayName !== void 0) {
    const s = clampStr(input.displayName, 60);
    if (s === null) errors.push("branding.displayName must be a string");
    else out.displayName = s;
  }
  if (input.tagline !== void 0) {
    const s = clampStr(input.tagline, 120);
    if (s === null) errors.push("branding.tagline must be a string");
    else out.tagline = s;
  }
  if (input.accent !== void 0) {
    if (!BRAND_ACCENTS.includes(input.accent)) {
      errors.push(`branding.accent must be one of ${BRAND_ACCENTS.join(", ")}`);
    } else out.accent = input.accent;
  }
  return out;
}
function validateEntitlements(input, errors) {
  if (input === void 0) return void 0;
  if (!isPlainObject(input)) {
    errors.push("entitlements must be an object");
    return void 0;
  }
  const out = {};
  const numField = (key, min) => {
    if (input[key] === void 0) return;
    if (!isInt(input[key])) {
      errors.push(`entitlements.${key} must be an integer`);
      return;
    }
    const n = input[key];
    if (n < min) {
      errors.push(`entitlements.${key} must be >= ${min}`);
      return;
    }
    if (n > ENTITLEMENT_CAPS[key]) {
      errors.push(`entitlements.${key} exceeds the platform cap of ${ENTITLEMENT_CAPS[key]}`);
      return;
    }
    out[key] = n;
  };
  numField("maxSeats", 1);
  numField("maxProducts", 1);
  numField("monthlyAiTokenBudget", 0);
  if (input.aiModelRoles !== void 0) {
    if (!Array.isArray(input.aiModelRoles)) errors.push("entitlements.aiModelRoles must be an array");
    else {
      const bad = input.aiModelRoles.filter((r) => !KNOWN_AI_ROLES.includes(r));
      if (bad.length) errors.push(`entitlements.aiModelRoles has unknown roles: ${bad.join(", ")}`);
      else out.aiModelRoles = [...new Set(input.aiModelRoles)];
    }
  }
  return out;
}
function validateConfigPatch(patch, plane) {
  const errors = [];
  if (!isPlainObject(patch)) return { ok: false, errors: ["config patch must be an object"], value: null };
  const out = {};
  if (patch.branding !== void 0) {
    const b = validateBranding(patch.branding, errors);
    if (b !== void 0) out.branding = b;
  }
  if (patch.flags !== void 0) {
    const { value, unknownKeys, forbiddenKeys } = sanitizeFlagOverrides(patch.flags, plane);
    if (unknownKeys.length) errors.push(`flags: unknown or non-boolean keys: ${unknownKeys.join(", ")}`);
    if (forbiddenKeys.length) errors.push(`flags: not tenant-overridable: ${forbiddenKeys.join(", ")}`);
    out.flags = value;
  }
  if (patch.entitlements !== void 0) {
    if (plane === "tenant") {
      errors.push("entitlements are platform-set and cannot be changed on the tenant plane");
    } else {
      const e = validateEntitlements(patch.entitlements, errors);
      if (e !== void 0) out.entitlements = e;
    }
  }
  const KNOWN_TOP = /* @__PURE__ */ new Set(["branding", "flags", "entitlements"]);
  for (const k of Object.keys(patch)) if (!KNOWN_TOP.has(k)) errors.push(`unknown config key: ${k}`);
  if (errors.length) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: out };
}
function mergeConfig(current, patch) {
  const base = current || {};
  return {
    branding: patch.branding !== void 0 ? { ...base.branding, ...patch.branding } : base.branding,
    flags: patch.flags !== void 0 ? { ...base.flags, ...patch.flags } : base.flags,
    entitlements: patch.entitlements !== void 0 ? { ...base.entitlements, ...patch.entitlements } : base.entitlements
  };
}
function effectiveEntitlements(config) {
  const e = config?.entitlements;
  if (!e) return { ...DEFAULT_ENTITLEMENTS };
  return {
    maxSeats: e.maxSeats ?? DEFAULT_ENTITLEMENTS.maxSeats,
    maxProducts: e.maxProducts ?? DEFAULT_ENTITLEMENTS.maxProducts,
    monthlyAiTokenBudget: e.monthlyAiTokenBudget ?? DEFAULT_ENTITLEMENTS.monthlyAiTokenBudget,
    aiModelRoles: e.aiModelRoles ?? [...DEFAULT_ENTITLEMENTS.aiModelRoles]
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BRAND_ACCENTS,
  DEFAULT_ENTITLEMENTS,
  ENTITLEMENT_CAPS,
  FEATURE_FLAGS,
  FLAG_KEYS,
  KNOWN_AI_ROLES,
  TENANT_OVERRIDABLE_KEYS,
  effectiveEntitlements,
  flagDef,
  isKnownFlag,
  mergeConfig,
  resolveFlag,
  resolveFlags,
  sanitizeFlagOverrides,
  validateConfigPatch
});
