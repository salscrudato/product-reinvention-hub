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
  DEPLOY_SONNET: () => DEPLOY_SONNET,
  ESCALATION_LADDER: () => ESCALATION_LADDER,
  EXTENDED_DEPLOYMENTS: () => EXTENDED_DEPLOYMENTS,
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
  MID_REASONER: {
    role: "MID_REASONER",
    deploymentName: "claude-sonnet-5",
    sdkFamily: "anthropic",
    roleLabel: "Mid-tier escalation reasoning \u2014 Sonnet 5"
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
var DEPLOY_SONNET = FLEET_REGISTRY.MID_REASONER.deploymentName;
var DEPLOY_HAIKU = FLEET_REGISTRY.BULK_VERIFY.deploymentName;
var DEPLOY_GPT = FLEET_REGISTRY.VISION.deploymentName;
var DEPLOY_GPT_MINI = FLEET_REGISTRY.CHEAP_GENERAL.deploymentName;
var DEPLOY_EMBED = FLEET_REGISTRY.EMBED.deploymentName;
var EXTENDED_DEPLOYMENTS = {
  /** Deliberate deep reasoning for the hardest import disambiguation. Quality ≫ latency. */
  DEEP_REASONER: { deploymentName: "gpt-5.4-pro", surface: "openai-responses", roleLabel: "Deep escalation reasoning \u2014 GPT-5.4-pro" },
  /** Cross-vendor verify panel, third model lineage (decorrelates Claude+GPT errors). */
  VERIFY_XAI: { deploymentName: "grok-4.3", surface: "openai-chat", roleLabel: "Verify panel \u2014 Grok 4.3" },
  /** Cross-vendor verify panel, fourth model lineage. */
  VERIFY_DEEPSEEK: { deploymentName: "DeepSeek-V4-Pro", surface: "openai-chat", roleLabel: "Verify panel \u2014 DeepSeek V4 Pro" },
  /** Fast multimodal tier (page classification, vision-ladder steps). */
  FAST_GENERAL: { deploymentName: "gpt-5.4-mini", surface: "openai-chat", roleLabel: "Fast general / vision \u2014 GPT-5.4-mini" },
  /** Higher-fidelity query-time embeddings (write-time bulk stays on EMBED). */
  EMBED_QUALITY: { deploymentName: "text-embedding-3-large", surface: "openai-embeddings", roleLabel: "Quality retrieval embeddings \u2014 text-embedding-3-large" },
  /** Cross-encoder rerank over hybrid retrieval results (citation precision). */
  RERANK: { deploymentName: "Cohere-rerank-v4.0-pro", surface: "cohere-rerank", roleLabel: "RAG rerank \u2014 Cohere Rerank v4 pro" },
  /** Document OCR → markdown with native tables (the 0-char-PDF import fix). */
  DOC_OCR: { deploymentName: "mistral-document-ai-2512", surface: "mistral-ocr", roleLabel: "Document OCR \u2014 Mistral Document AI" }
};
var FLEET_PRICING = {
  [DEPLOY_OPUS]: { inputPerMTok: 15, outputPerMTok: 75 },
  [DEPLOY_SONNET]: { inputPerMTok: 3, outputPerMTok: 15 },
  [DEPLOY_HAIKU]: { inputPerMTok: 0.8, outputPerMTok: 4 },
  [DEPLOY_GPT]: { inputPerMTok: 3, outputPerMTok: 12 },
  [DEPLOY_GPT_MINI]: { inputPerMTok: 0.3, outputPerMTok: 1.6 },
  // Embeddings bill input tokens only (no completion) — the output tier is 0.
  [DEPLOY_EMBED]: { inputPerMTok: 0.02, outputPerMTok: 0 },
  // Extended deployments (2026-07-15). Conservative order-of-magnitude estimates — the
  // guard needs a ceiling, not billing exactness. Rerank + OCR bill per-search/per-page,
  // not per-token; their entries approximate that as an input-token rate so record() still
  // moves the spend window (callers pass a nominal token count).
  [EXTENDED_DEPLOYMENTS.DEEP_REASONER.deploymentName]: { inputPerMTok: 20, outputPerMTok: 150 },
  [EXTENDED_DEPLOYMENTS.VERIFY_XAI.deploymentName]: { inputPerMTok: 3, outputPerMTok: 15 },
  [EXTENDED_DEPLOYMENTS.VERIFY_DEEPSEEK.deploymentName]: { inputPerMTok: 1.5, outputPerMTok: 6 },
  [EXTENDED_DEPLOYMENTS.FAST_GENERAL.deploymentName]: { inputPerMTok: 0.3, outputPerMTok: 1.6 },
  [EXTENDED_DEPLOYMENTS.EMBED_QUALITY.deploymentName]: { inputPerMTok: 0.13, outputPerMTok: 0 },
  [EXTENDED_DEPLOYMENTS.RERANK.deploymentName]: { inputPerMTok: 2, outputPerMTok: 0 },
  [EXTENDED_DEPLOYMENTS.DOC_OCR.deploymentName]: { inputPerMTok: 3, outputPerMTok: 0 }
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
    case "MID_REASONER":
      return "BULK_VERIFY";
    case "VISION":
      return "CHEAP_GENERAL";
    default:
      return role;
  }
}
var ESCALATION_LADDER = ["BULK_VERIFY", "MID_REASONER", "GROUNDED_CITED"];
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEPLOY_EMBED,
  DEPLOY_GPT,
  DEPLOY_GPT_MINI,
  DEPLOY_HAIKU,
  DEPLOY_OPUS,
  DEPLOY_SONNET,
  ESCALATION_LADDER,
  EXTENDED_DEPLOYMENTS,
  FLEET_PRICING,
  allDeployments,
  degradedRole,
  estimateCostUsd,
  resolveDeployment
});
