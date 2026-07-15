'use strict'
// fleet.js — production model routing + in-process cost guard for the Azure host.
//
// SINGLE SOURCE OF TRUTH for Foundry deployment names is shared/src/ai/fleet.ts, bundled to
// ./fleet-shared.cjs (`pnpm build:fleet`). No server handler hardcodes a model string; every AI
// call resolves its deployment through a fleet ROLE:
//   GROUNDED_CITED → claude-opus-4-8   (portfolio chat: deep, grounded, cited)
//   BULK_VERIFY    → claude-haiku-4-5   (bulk/structured prose, product summaries)
//   VISION         → gpt-5.1            (photo/vision extraction)
//   CHEAP_GENERAL  → gpt-5-mini         (degrade target)
//
// COST GUARD: an in-process rolling-window spend estimator with a hard ceiling. Every call is
// gated before dispatch (deny past the ceiling) and its actual token usage recorded after. State
// is per host instance (App Service is single-instance here); documented as such. SECRETS
// (AZURE_FOUNDRY_KEY) are read from process.env server-side only — never returned or logged.

const bridge = require('./fleet-shared.cjs')

// ─── Foundry endpoint config (shared by every AI handler) ─────────────────────
const SVC               = (process.env.AZURE_FOUNDRY_ENDPOINT || '').replace(/\/+$/, '')
const KEY               = process.env.AZURE_FOUNDRY_KEY
const ANTHROPIC_VERSION = process.env.AZURE_FOUNDRY_ANTHROPIC_VERSION || '2023-06-01'

const isConfigured        = () => Boolean(SVC && KEY)
const anthropicMessagesUrl = () => `${SVC}/anthropic/v1/messages`
const openaiChatUrl        = () => `${SVC}/openai/v1/chat/completions`
const openaiEmbeddingsUrl  = () => `${SVC}/openai/v1/embeddings`
// Foundry's OpenAI-native surface authenticates with either `api-key` or Bearer; the embeddings
// endpoint accepts `api-key`, so we reuse it for symmetry with the rest of the OpenAI surface.
const anthropicHeaders     = () => ({ 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': ANTHROPIC_VERSION })
const openaiHeaders        = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'api-key': KEY })

// gpt-5.1 and gpt-5-mini are o-series reasoning models: they reject max_tokens with HTTP 400.
// Use max_completion_tokens for all OpenAI deployments routed through this fleet.
const openaiMaxTokensKey = () => 'max_completion_tokens'

/** Build a valid body for an OpenAI o-series chat call (VISION / CHEAP_GENERAL roles).
 *  @param {string} deployment - Foundry deployment name (e.g. 'gpt-5.1')
 *  @param {Array}  messages   - Anthropic-style messages array, already converted to OpenAI format
 *  @param {number} maxTokens  - Output token budget (mapped to max_completion_tokens)
 *  @param {object} [extra]    - Additional body fields (e.g. { temperature: 0 })
 */
function openaiChatBody(deployment, messages, maxTokens, extra = {}) {
  return { model: deployment, messages, max_completion_tokens: maxTokens, ...extra }
}

// ─── Role → deployment ────────────────────────────────────────────────────────
/** Resolve the Foundry deployment name for a fleet role.
 *
 *  Second argument is either the legacy boolean `degrade` (route to the cheaper same-family
 *  deployment under budget pressure) or an options object:
 *    resolveModel(role, { degrade, bypassDegrade })
 *  `bypassDegrade: true` is the EXPLICIT, NAMED no-downgrade switch for the import path
 *  (see IMPORT_CONTEXT below): the role always resolves to its full-strength deployment
 *  even when the cost guard is signalling degrade. Scoped per call site — never global. */
function resolveModel(role, degradeOrOpts = false) {
  const opts = (degradeOrOpts && typeof degradeOrOpts === 'object')
    ? degradeOrOpts
    : { degrade: Boolean(degradeOrOpts) }
  const degrade = Boolean(opts.degrade) && !opts.bypassDegrade
  const effectiveRole = degrade ? bridge.degradedRole(role) : role
  return bridge.resolveDeployment(effectiveRole).deploymentName
}

// ─── Import context (no cost cap on the import path) ─────────────────────────
// Named, scoped switch: pass to guard() to exempt a call from BOTH the hard spend
// ceiling and the soft degrade signal. Import accuracy is prioritised over spend by
// product decision — but telemetry is NEVER bypassed: every import call still goes
// through record(), so windowSpendUsd/callCount reflect true spend and other roles
// see (and pay for) the pressure import creates. Only the import pipeline may use this.
const IMPORT_CONTEXT = 'import-no-cap'

// ─── In-process cost guard ──────────────────────────────────────────────────
const WINDOW_MS     = Number(process.env.AI_SPEND_WINDOW_MS) || 60 * 60 * 1000  // 1h fixed window
const CEILING_USD   = Number(process.env.AI_SPEND_CEILING_USD) || 25            // per-window hard cap
const SOFT_FRACTION = 0.8                                                        // degrade past 80%

let windowStart    = Date.now()
let windowSpendUsd = 0
let callCount      = 0
let trips          = 0   // times the hard ceiling DENIED a call this window
let degrades       = 0   // times the soft threshold signalled degrade this window

function rollWindow() {
  const now = Date.now()
  if (now - windowStart >= WINDOW_MS) { windowStart = now; windowSpendUsd = 0; callCount = 0; trips = 0; degrades = 0 }
}

/** Pre-call gate. Returns { allow, degrade, reason }:
 *   • allow=false once the window spend meets/exceeds the ceiling → caller must return an honest
 *     503 rather than dispatch (no runaway spend, no fabricated answer).
 *   • degrade=true past the soft threshold → caller may route to the cheaper same-family model.
 *   • guard(IMPORT_CONTEXT) — the import path's named exemption: never denies, never degrades.
 *     Spend telemetry is unaffected (record() still runs after every call). */
function guard(context) {
  rollWindow()
  if (context === IMPORT_CONTEXT) return { allow: true, degrade: false, reason: 'import_no_cap' }
  // Count trips/degrades so the guard's activity is OBSERVABLE (admin diagnostics read) —
  // a fuzz/soak run can PROVE the ceiling fired instead of assuming it. Import is exempt above.
  if (windowSpendUsd >= CEILING_USD) { trips += 1; return { allow: false, degrade: false, reason: 'ai_budget_ceiling' } }
  const degrade = windowSpendUsd >= CEILING_USD * SOFT_FRACTION
  if (degrade) degrades += 1
  return { allow: true, degrade, reason: degrade ? 'ai_budget_soft' : 'ok' }
}

/** Record actual token usage after a call so the rolling spend reflects real cost. */
function record(deploymentName, inputTokens, outputTokens) {
  rollWindow()
  windowSpendUsd += bridge.estimateCostUsd(deploymentName, inputTokens || 0, outputTokens || 0)
  callCount += 1
}

function snapshot() {
  rollWindow()
  return {
    windowSpendUsd: Math.round(windowSpendUsd * 1e4) / 1e4,
    ceilingUsd: CEILING_USD,
    callCount,
    trips,
    degrades,
    windowRemainingMs: Math.max(0, WINDOW_MS - (Date.now() - windowStart)),
  }
}

module.exports = {
  // config
  isConfigured, anthropicMessagesUrl, openaiChatUrl, openaiEmbeddingsUrl, anthropicHeaders, openaiHeaders, ANTHROPIC_VERSION,
  // OpenAI o-series helpers
  openaiMaxTokensKey, openaiChatBody,
  // routing
  resolveModel,
  DEPLOY_OPUS: bridge.DEPLOY_OPUS, DEPLOY_SONNET: bridge.DEPLOY_SONNET, DEPLOY_HAIKU: bridge.DEPLOY_HAIKU,
  DEPLOY_GPT: bridge.DEPLOY_GPT,   DEPLOY_GPT_MINI: bridge.DEPLOY_GPT_MINI,
  DEPLOY_EMBED: bridge.DEPLOY_EMBED,
  ESCALATION_LADDER: bridge.ESCALATION_LADDER,
  // cost guard
  guard, record, snapshot,
  IMPORT_CONTEXT,
  estimateCostUsd: bridge.estimateCostUsd,
}
