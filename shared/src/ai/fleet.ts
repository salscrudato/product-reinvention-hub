// shared/src/ai/fleet.ts — Azure AI Foundry model fleet constants.
// Pure TypeScript: no platform imports, no process.env reads, no I/O.
// Consumed by both app/ (read-only display) and functions/ (instantiates clients).
//
// Four deployments in foundry-prodhub-dev, two SDK families:
//   Anthropic surface (/anthropic): claude-opus-4-8, claude-haiku-4-5
//   OpenAI surface   (/openai/v1):  gpt-5.1, gpt-5-mini
//
// SECRETS ARE NOT HERE. The API key and endpoint base live in AZURE_FOUNDRY_KEY and
// AZURE_FOUNDRY_ENDPOINT (server env only). Deployment names are identifiers, not secrets.

/** The four task roles the ensemble core serves. Every AI call declares its role;
 *  the router maps role → Foundry deployment. */
export type ModelRole =
  | 'GROUNDED_CITED'  // claude-opus-4-8:  deep reasoning + grounded cited generation
  | 'BULK_VERIFY'     // claude-haiku-4-5: bulk verification, cheap cascade passes
  | 'VISION'          // gpt-5.1:          general reasoning, vision-heavy extraction
  | 'CHEAP_GENERAL'   // gpt-5-mini:       cheap fast general-purpose calls

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
export const DEPLOY_HAIKU    = FLEET_REGISTRY.BULK_VERIFY.deploymentName      // 'claude-haiku-4-5'
export const DEPLOY_GPT      = FLEET_REGISTRY.VISION.deploymentName           // 'gpt-5.1'
export const DEPLOY_GPT_MINI = FLEET_REGISTRY.CHEAP_GENERAL.deploymentName   // 'gpt-5-mini'

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
  [DEPLOY_HAIKU]:    { inputPerMTok:  0.80, outputPerMTok:  4.00 },
  [DEPLOY_GPT]:      { inputPerMTok:  3.00, outputPerMTok: 12.00 },
  [DEPLOY_GPT_MINI]: { inputPerMTok:  0.30, outputPerMTok:  1.60 },
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
    case 'VISION':         return 'CHEAP_GENERAL'
    default:               return role
  }
}
