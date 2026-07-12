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
const anthropicHeaders     = () => ({ 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': ANTHROPIC_VERSION })
const openaiHeaders        = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` })

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
/** Resolve the Foundry deployment name for a fleet role. When `degrade` is true, route to the
 *  cheaper same-family deployment (the cost guard sets this under budget pressure). */
function resolveModel(role, degrade = false) {
  const effectiveRole = degrade ? bridge.degradedRole(role) : role
  return bridge.resolveDeployment(effectiveRole).deploymentName
}

// ─── In-process cost guard ──────────────────────────────────────────────────
const WINDOW_MS     = Number(process.env.AI_SPEND_WINDOW_MS) || 60 * 60 * 1000  // 1h fixed window
const CEILING_USD   = Number(process.env.AI_SPEND_CEILING_USD) || 25            // per-window hard cap
const SOFT_FRACTION = 0.8                                                        // degrade past 80%

let windowStart    = Date.now()
let windowSpendUsd = 0
let callCount      = 0

function rollWindow() {
  const now = Date.now()
  if (now - windowStart >= WINDOW_MS) { windowStart = now; windowSpendUsd = 0; callCount = 0 }
}

/** Pre-call gate. Returns { allow, degrade, reason }:
 *   • allow=false once the window spend meets/exceeds the ceiling → caller must return an honest
 *     503 rather than dispatch (no runaway spend, no fabricated answer).
 *   • degrade=true past the soft threshold → caller may route to the cheaper same-family model. */
function guard() {
  rollWindow()
  if (windowSpendUsd >= CEILING_USD) return { allow: false, degrade: false, reason: 'ai_budget_ceiling' }
  const degrade = windowSpendUsd >= CEILING_USD * SOFT_FRACTION
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
    windowRemainingMs: Math.max(0, WINDOW_MS - (Date.now() - windowStart)),
  }
}

module.exports = {
  // config
  isConfigured, anthropicMessagesUrl, openaiChatUrl, anthropicHeaders, openaiHeaders, ANTHROPIC_VERSION,
  // OpenAI o-series helpers
  openaiMaxTokensKey, openaiChatBody,
  // routing
  resolveModel,
  DEPLOY_OPUS: bridge.DEPLOY_OPUS, DEPLOY_HAIKU: bridge.DEPLOY_HAIKU,
  DEPLOY_GPT: bridge.DEPLOY_GPT,   DEPLOY_GPT_MINI: bridge.DEPLOY_GPT_MINI,
  // cost guard
  guard, record, snapshot,
  estimateCostUsd: bridge.estimateCostUsd,
}
