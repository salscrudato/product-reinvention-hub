// shared/src/ai/fleet.ts — Azure AI Foundry model fleet constants.
// Pure TypeScript: no platform imports, no process.env reads, no I/O.
// Consumed by both app/ (read-only display) and functions/ (instantiates clients).
//
// Five deployments in foundry-prodhub-dev, two SDK families:
//   Anthropic surface (/anthropic):    claude-opus-4-8, claude-haiku-4-5
//   OpenAI surface   (/openai/v1):     gpt-5.1, gpt-5-mini, text-embedding-3-small
//
// SECRETS ARE NOT HERE. The API key and endpoint base live in AZURE_FOUNDRY_KEY and
// AZURE_FOUNDRY_ENDPOINT (server env only). Deployment names are identifiers, not secrets.

/** The task roles the ensemble core serves. Every AI call declares its role;
 *  the router maps role → Foundry deployment. */
export type ModelRole =
  | 'GROUNDED_CITED'  // claude-opus-4-8:        deep reasoning + grounded cited generation
  | 'MID_REASONER'    // claude-sonnet-5:        mid-tier escalation between haiku and opus
  | 'BULK_VERIFY'     // claude-haiku-4-5:       bulk verification, cheap cascade passes
  | 'VISION'          // gpt-5.1:                general reasoning, vision-heavy extraction
  | 'CHEAP_GENERAL'   // gpt-5-mini:             cheap fast general-purpose calls
  | 'EMBED'           // text-embedding-3-small: dense retrieval vectors for RAG grounding

/** SDK family determines which client to instantiate.
 *  anthropic → @anthropic-ai/sdk with baseURL = {endpoint}/anthropic
 *  openai    → raw fetch (or openai SDK) with baseURL = {endpoint}/openai/v1 */
export type ModelSdkFamily = 'anthropic' | 'openai'

/** Static descriptor for one Foundry deployment. No secrets; no env reads. */
export interface FleetDeployment {
  readonly role:           ModelRole
  readonly deploymentName: string       // Foundry deployment name (an identifier, not a secret)
  readonly sdkFamily:      ModelSdkFamily
  readonly roleLabel:      string       // human description for logs / UI
}

// ─── The fleet registry ───────────────────────────────────────────────────────
// Deployment names come from the Foundry project foundry-prodhub-dev.
// These are identifiers — NOT credentials. Credentials stay in AZURE_FOUNDRY_KEY.

const FLEET_REGISTRY: Readonly<Record<ModelRole, FleetDeployment>> = {
  GROUNDED_CITED: {
    role:           'GROUNDED_CITED',
    deploymentName: 'claude-opus-4-8',
    sdkFamily:      'anthropic',
    roleLabel:      'Grounded cited reasoning — Opus 4.8',
  },
  MID_REASONER: {
    role:           'MID_REASONER',
    deploymentName: 'claude-sonnet-5',
    sdkFamily:      'anthropic',
    roleLabel:      'Mid-tier escalation reasoning — Sonnet 5',
  },
  BULK_VERIFY: {
    role:           'BULK_VERIFY',
    deploymentName: 'claude-haiku-4-5',
    sdkFamily:      'anthropic',
    roleLabel:      'Bulk verification — Haiku 4.5',
  },
  VISION: {
    role:           'VISION',
    deploymentName: 'gpt-5.1',
    sdkFamily:      'openai',
    roleLabel:      'General reasoning / vision — GPT-5.1',
  },
  CHEAP_GENERAL: {
    role:           'CHEAP_GENERAL',
    deploymentName: 'gpt-5-mini',
    sdkFamily:      'openai',
    roleLabel:      'Cheap fast general — GPT-5-mini',
  },
  EMBED: {
    role:           'EMBED',
    deploymentName: 'text-embedding-3-small',
    sdkFamily:      'openai',
    roleLabel:      'Dense retrieval embeddings — text-embedding-3-small',
  },
} as const

/** Resolve the FleetDeployment for a role, with optional per-role name overrides
 *  (useful for testing or temporary model swaps without editing the registry). */
export function resolveDeployment(
  role:      ModelRole,
  overrides?: Partial<Record<ModelRole, string>>,
): FleetDeployment {
  const base     = FLEET_REGISTRY[role]
  const override = overrides?.[role]
  return override ? { ...base, deploymentName: override } : base
}

/** All registered deployments in definition order. */
export function allDeployments(): FleetDeployment[] {
  return Object.values(FLEET_REGISTRY)
}

// ─── Convenience deployment-name constants ────────────────────────────────────
// Named string exports so call sites can reference names without importing the
// full FleetDeployment object.

export const DEPLOY_OPUS     = FLEET_REGISTRY.GROUNDED_CITED.deploymentName  // 'claude-opus-4-8'
export const DEPLOY_SONNET   = FLEET_REGISTRY.MID_REASONER.deploymentName     // 'claude-sonnet-5'
export const DEPLOY_HAIKU    = FLEET_REGISTRY.BULK_VERIFY.deploymentName      // 'claude-haiku-4-5'
export const DEPLOY_GPT      = FLEET_REGISTRY.VISION.deploymentName           // 'gpt-5.1'
export const DEPLOY_GPT_MINI = FLEET_REGISTRY.CHEAP_GENERAL.deploymentName   // 'gpt-5-mini'
export const DEPLOY_EMBED    = FLEET_REGISTRY.EMBED.deploymentName            // 'text-embedding-3-small'

// ─── Extended deployments (specialty surfaces, 2026-07-15 fleet expansion) ────
// Deployments outside the chat/embed ModelRole router: each rides a DIFFERENT API
// surface on the same Foundry resource + key. Kept separate from FLEET_REGISTRY so
// the ModelRole union (and every Record<ModelRole, …> consumer) is untouched.
// Ready-to-use callers live in server/lib/external/foundry.js.

/** Which HTTP surface an extended deployment answers on (all same resource + key):
 *  openai-responses  → POST {endpoint}/openai/v1/responses           (gpt-*-pro REJECT chat/completions)
 *  openai-chat       → POST {endpoint}/openai/v1/chat/completions
 *  openai-embeddings → POST {endpoint}/openai/v1/embeddings
 *  cohere-rerank     → POST {endpoint}/providers/cohere/v2/rerank
 *  mistral-ocr       → POST {endpoint}/providers/mistral/azure/ocr */
export type ExtendedSurface =
  | 'openai-responses' | 'openai-chat' | 'openai-embeddings' | 'cohere-rerank' | 'mistral-ocr'

export interface ExtendedDeployment {
  readonly deploymentName: string
  readonly surface:        ExtendedSurface
  readonly roleLabel:      string
}

export const EXTENDED_DEPLOYMENTS = {
  /** Deliberate deep reasoning for the hardest import disambiguation. Quality ≫ latency. */
  DEEP_REASONER:   { deploymentName: 'gpt-5.4-pro',              surface: 'openai-responses',  roleLabel: 'Deep escalation reasoning — GPT-5.4-pro' },
  /** Cross-vendor verify panel, third model lineage (decorrelates Claude+GPT errors). */
  VERIFY_XAI:      { deploymentName: 'grok-4.3',                 surface: 'openai-chat',       roleLabel: 'Verify panel — Grok 4.3' },
  /** Cross-vendor verify panel, fourth model lineage. */
  VERIFY_DEEPSEEK: { deploymentName: 'DeepSeek-V4-Pro',          surface: 'openai-chat',       roleLabel: 'Verify panel — DeepSeek V4 Pro' },
  /** Fast multimodal tier (page classification, vision-ladder steps). */
  FAST_GENERAL:    { deploymentName: 'gpt-5.4-mini',             surface: 'openai-chat',       roleLabel: 'Fast general / vision — GPT-5.4-mini' },
  /** Higher-fidelity query-time embeddings (write-time bulk stays on EMBED). */
  EMBED_QUALITY:   { deploymentName: 'text-embedding-3-large',   surface: 'openai-embeddings', roleLabel: 'Quality retrieval embeddings — text-embedding-3-large' },
  /** Cross-encoder rerank over hybrid retrieval results (citation precision). */
  RERANK:          { deploymentName: 'Cohere-rerank-v4.0-pro',   surface: 'cohere-rerank',     roleLabel: 'RAG rerank — Cohere Rerank v4 pro' },
  /** Document OCR → markdown with native tables (the 0-char-PDF import fix). */
  DOC_OCR:         { deploymentName: 'mistral-document-ai-2512', surface: 'mistral-ocr',       roleLabel: 'Document OCR — Mistral Document AI' },
} as const satisfies Record<string, ExtendedDeployment>

export type ExtendedRole = keyof typeof EXTENDED_DEPLOYMENTS

// ─── Fleet pricing (for cost accounting / spend ceilings) ─────────────────────
// USD per 1M tokens. Illustrative list-price estimates — the cost GUARD only needs a
// conservative order-of-magnitude to enforce a spend ceiling, not billing-grade exactness.
// The Anthropic figures mirror functions/src/telemetry.ts; update all when prices change.
export interface FleetPricing {
  readonly inputPerMTok:  number
  readonly outputPerMTok: number
}

export const FLEET_PRICING: Readonly<Record<string, FleetPricing>> = {
  [DEPLOY_OPUS]:     { inputPerMTok: 15.00, outputPerMTok: 75.00 },
  [DEPLOY_SONNET]:   { inputPerMTok:  3.00, outputPerMTok: 15.00 },
  [DEPLOY_HAIKU]:    { inputPerMTok:  0.80, outputPerMTok:  4.00 },
  [DEPLOY_GPT]:      { inputPerMTok:  3.00, outputPerMTok: 12.00 },
  [DEPLOY_GPT_MINI]: { inputPerMTok:  0.30, outputPerMTok:  1.60 },
  // Embeddings bill input tokens only (no completion) — the output tier is 0.
  [DEPLOY_EMBED]:    { inputPerMTok:  0.02, outputPerMTok:  0.00 },
  // Extended deployments (2026-07-15). Conservative order-of-magnitude estimates — the
  // guard needs a ceiling, not billing exactness. Rerank + OCR bill per-search/per-page,
  // not per-token; their entries approximate that as an input-token rate so record() still
  // moves the spend window (callers pass a nominal token count).
  [EXTENDED_DEPLOYMENTS.DEEP_REASONER.deploymentName]:   { inputPerMTok: 20.00, outputPerMTok: 150.00 },
  [EXTENDED_DEPLOYMENTS.VERIFY_XAI.deploymentName]:      { inputPerMTok:  3.00, outputPerMTok:  15.00 },
  [EXTENDED_DEPLOYMENTS.VERIFY_DEEPSEEK.deploymentName]: { inputPerMTok:  1.50, outputPerMTok:   6.00 },
  [EXTENDED_DEPLOYMENTS.FAST_GENERAL.deploymentName]:    { inputPerMTok:  0.30, outputPerMTok:   1.60 },
  [EXTENDED_DEPLOYMENTS.EMBED_QUALITY.deploymentName]:   { inputPerMTok:  0.13, outputPerMTok:   0.00 },
  [EXTENDED_DEPLOYMENTS.RERANK.deploymentName]:          { inputPerMTok:  2.00, outputPerMTok:   0.00 },
  [EXTENDED_DEPLOYMENTS.DOC_OCR.deploymentName]:         { inputPerMTok:  3.00, outputPerMTok:   0.00 },
} as const

/** Estimate USD cost for a call. Unknown deployment names fall back to the priciest tier
 *  (fail-safe: an unrecognised model is assumed expensive so the spend ceiling trips sooner). */
export function estimateCostUsd(deploymentName: string, inputTokens: number, outputTokens: number): number {
  const p = FLEET_PRICING[deploymentName] ?? FLEET_PRICING[DEPLOY_OPUS]!
  const M = 1_000_000
  return (Math.max(0, inputTokens) / M) * p.inputPerMTok + (Math.max(0, outputTokens) / M) * p.outputPerMTok
}

/** Map a role to the cheaper deployment of the same SDK family — used by the cost guard to
 *  degrade under budget pressure instead of denying outright. Anthropic reasoning degrades to
 *  Haiku; OpenAI vision degrades to GPT-mini; the cheap roles have no cheaper tier. */
export function degradedRole(role: ModelRole): ModelRole {
  switch (role) {
    case 'GROUNDED_CITED': return 'BULK_VERIFY'
    case 'MID_REASONER':   return 'BULK_VERIFY'
    case 'VISION':         return 'CHEAP_GENERAL'
    default:               return role
  }
}

// ─── Escalation ladder (import path) ─────────────────────────────────────────
// Ordered cheap → strong Anthropic tiers for consensus-failure escalation:
// haiku → sonnet → opus. Callers walk the ladder one rung at a time and must
// tolerate a missing mid-tier deployment (skip to the next rung on upstream 4xx).
export const ESCALATION_LADDER: readonly ModelRole[] = ['BULK_VERIFY', 'MID_REASONER', 'GROUNDED_CITED'] as const
