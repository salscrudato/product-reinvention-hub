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

// shared/src/ai/api-server.ts
var api_server_exports = {};
__export(api_server_exports, {
  DEPLOY_EMBED: () => DEPLOY_EMBED,
  DEPLOY_GPT: () => DEPLOY_GPT,
  DEPLOY_GPT_MINI: () => DEPLOY_GPT_MINI,
  DEPLOY_HAIKU: () => DEPLOY_HAIKU,
  DEPLOY_OPUS: () => DEPLOY_OPUS,
  FLEET_PRICING: () => FLEET_PRICING,
  allDeployments: () => allDeployments,
  degradedRole: () => degradedRole,
  estimateCostUsd: () => estimateCostUsd,
  resolveDeployment: () => resolveDeployment
});
module.exports = __toCommonJS(api_server_exports);

// shared/src/ai/fleet.ts
var FLEET_REGISTRY = {
  GROUNDED_CITED: {
    role: "GROUNDED_CITED",
    deploymentName: "claude-opus-4-8",
    sdkFamily: "anthropic",
    roleLabel: "Grounded cited reasoning \u2014 Opus 4.8"
  },
  BULK_VERIFY: {
    role: "BULK_VERIFY",
    deploymentName: "claude-haiku-4-5",
    sdkFamily: "anthropic",
    roleLabel: "Bulk verification \u2014 Haiku 4.5"
  },
  VISION: {
    role: "VISION",
    deploymentName: "gpt-5.1",
    sdkFamily: "openai",
    roleLabel: "General reasoning / vision \u2014 GPT-5.1"
  },
  CHEAP_GENERAL: {
    role: "CHEAP_GENERAL",
    deploymentName: "gpt-5-mini",
    sdkFamily: "openai",
    roleLabel: "Cheap fast general \u2014 GPT-5-mini"
  },
  EMBED: {
    role: "EMBED",
    deploymentName: "text-embedding-3-small",
    sdkFamily: "openai",
    roleLabel: "Dense retrieval embeddings \u2014 text-embedding-3-small"
  }
};
function resolveDeployment(role, overrides) {
  const base = FLEET_REGISTRY[role];
  const override = overrides?.[role];
  return override ? { ...base, deploymentName: override } : base;
}
function allDeployments() {
  return Object.values(FLEET_REGISTRY);
}
var DEPLOY_OPUS = FLEET_REGISTRY.GROUNDED_CITED.deploymentName;
var DEPLOY_HAIKU = FLEET_REGISTRY.BULK_VERIFY.deploymentName;
var DEPLOY_GPT = FLEET_REGISTRY.VISION.deploymentName;
var DEPLOY_GPT_MINI = FLEET_REGISTRY.CHEAP_GENERAL.deploymentName;
var DEPLOY_EMBED = FLEET_REGISTRY.EMBED.deploymentName;
var FLEET_PRICING = {
  [DEPLOY_OPUS]: { inputPerMTok: 15, outputPerMTok: 75 },
  [DEPLOY_HAIKU]: { inputPerMTok: 0.8, outputPerMTok: 4 },
  [DEPLOY_GPT]: { inputPerMTok: 3, outputPerMTok: 12 },
  [DEPLOY_GPT_MINI]: { inputPerMTok: 0.3, outputPerMTok: 1.6 },
  // Embeddings bill input tokens only (no completion) — the output tier is 0.
  [DEPLOY_EMBED]: { inputPerMTok: 0.02, outputPerMTok: 0 }
};
function estimateCostUsd(deploymentName, inputTokens, outputTokens) {
  const p = FLEET_PRICING[deploymentName] ?? FLEET_PRICING[DEPLOY_OPUS];
  const M = 1e6;
  return Math.max(0, inputTokens) / M * p.inputPerMTok + Math.max(0, outputTokens) / M * p.outputPerMTok;
}
function degradedRole(role) {
  switch (role) {
    case "GROUNDED_CITED":
      return "BULK_VERIFY";
    case "VISION":
      return "CHEAP_GENERAL";
    default:
      return role;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEPLOY_EMBED,
  DEPLOY_GPT,
  DEPLOY_GPT_MINI,
  DEPLOY_HAIKU,
  DEPLOY_OPUS,
  FLEET_PRICING,
  allDeployments,
  degradedRole,
  estimateCostUsd,
  resolveDeployment
});
