'use strict'
// server/lib/import-brain/ai-call.js — shared AI call helpers for the brain stages.
// Wraps the Anthropic Messages API and OpenAI Chat API (via Foundry) with:
//   - fleet cost guard (guard before, record after)
//   - temperature: 0 on all Claude calls (OpenAI o-series does not support temperature)
//   - 90s timeout (brain calls can be longer than the chat 120s timeout)
//   - Honest throw on budget ceiling or upstream error (no fabricated answers)

const fleet = require('../fleet')

// ─── Deployment resolvers ──────────────────────────────────────────────────────
// Both resolvers call fleet.guard() before each stage's AI calls so the $25/hour
// budget ceiling is enforced on ALL brain stage calls, Anthropic and OpenAI alike.

function resolveAnthropic(role, budget) {
  const g = fleet.guard()
  if (!g.allow) throw new Error('ai_budget_ceiling')
  budget.degraded = g.degrade
  return fleet.resolveModel(role, g.degrade)
}

// resolveOpenAI mirrors resolveAnthropic: enforces the cost guard then returns
// the raw Foundry deployment name from the fleet constants.
function resolveOpenAI(deploymentConst, budget) {
  const g = fleet.guard()
  if (!g.allow) throw new Error('ai_budget_ceiling')
  budget.degraded = g.degrade
  return deploymentConst
}

// ─── Anthropic Messages API call ──────────────────────────────────────────────
// For Claude models (haiku, opus). Sets temperature: 0 on every structured call.
// If tools + toolName are provided, uses forced tool_choice and returns the tool input.
// Otherwise returns the first text block raw.

async function callAnthropic({ deployment, systemPrompt, userPrompt, maxTokens, tools, toolName }) {
  const body = {
    model: deployment,
    max_tokens: maxTokens,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  }
  if (tools && toolName) {
    body.tools = tools
    body.tool_choice = { type: 'tool', name: toolName }
  }
  const upstream = await fetch(fleet.anthropicMessagesUrl(), {
    method: 'POST',
    headers: fleet.anthropicHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`Foundry Anthropic ${upstream.status}: ${detail}`)
  }
  const json = await upstream.json()
  fleet.record(deployment, json.usage?.input_tokens, json.usage?.output_tokens)
  if (tools && toolName) {
    const tu = Array.isArray(json.content) ? json.content.find(b => b.type === 'tool_use') : null
    return { raw: JSON.stringify(tu?.input ?? {}), usage: json.usage }
  }
  const text = Array.isArray(json.content) ? (json.content.find(b => b.type === 'text')?.text ?? '') : ''
  return { raw: text, usage: json.usage }
}

// ─── OpenAI Chat API call ─────────────────────────────────────────────────────
// For gpt-5.1 (VISION / VALIDATOR) and gpt-5-mini (CHEAP_GENERAL / BULK_ALT).
// o-series models reject `temperature` — never set it here.
// Converts Anthropic-style tools to OpenAI function-calling format.

async function callOpenAI({ deployment, systemPrompt, userPrompt, maxTokens, tools, toolName }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
  const body = fleet.openaiChatBody(deployment, messages, maxTokens)
  if (tools) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }))
    if (toolName) body.tool_choice = { type: 'function', function: { name: toolName } }
  }
  const upstream = await fetch(fleet.openaiChatUrl(), {
    method: 'POST',
    headers: fleet.openaiHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`Foundry OpenAI ${upstream.status}: ${detail}`)
  }
  const json = await upstream.json()
  fleet.record(deployment, json.usage?.prompt_tokens, json.usage?.completion_tokens)
  if (tools && toolName) {
    const tc = json.choices?.[0]?.message?.tool_calls?.[0]
    return { raw: tc?.function?.arguments ?? '{}', usage: json.usage }
  }
  const text = json.choices?.[0]?.message?.content ?? ''
  return { raw: text, usage: json.usage }
}

// ─── Budget factory ───────────────────────────────────────────────────────────
// Creates a budget object passed through the brain pipeline. `degraded` is
// updated before every AI call; callers check it to route to cheaper models.

function createBudget() {
  return { degraded: false }
}

module.exports = { callAnthropic, callOpenAI, resolveAnthropic, resolveOpenAI, createBudget }
