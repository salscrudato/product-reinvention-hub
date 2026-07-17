'use strict'
// server/lib/import-brain/ai-call.js — shared AI call helpers for the brain stages.
// Wraps the Anthropic Messages API and OpenAI Chat API (via Foundry) with:
//   - fleet cost guard (guard before, record after) — EXCEPT on no-cap import budgets,
//     where the guard never denies or degrades but telemetry is still recorded
//   - temperature omitted (deprecated on claude-opus-4-8/haiku-4-5; o-series never accepts it)
//   - retry with exponential backoff + jitter on 408/429/5xx (import calls must be robust)
//   - 120s timeout (brain calls can be longer than the chat timeout)
//   - Honest throw on budget ceiling or upstream error (no fabricated answers)

const fleet = require('../fleet')

// ─── Deployment resolvers ──────────────────────────────────────────────────────
// Default path: fleet.guard() enforces the $25/hour ceiling on ALL brain stage calls.
// No-cap path (budget.noCap === true, the IMPORT context): guard never denies or
// degrades — import always runs the full-strength model — but every call still flows
// through fleet.record() so spend telemetry stays truthful.

function resolveAnthropic(role, budget) {
  if (budget && budget.noCap) {
    fleet.guard(fleet.IMPORT_CONTEXT)   // rolls the window; never denies/degrades
    return fleet.resolveModel(role, { bypassDegrade: true })
  }
  const g = fleet.guard()
  if (!g.allow) throw new Error('ai_budget_ceiling')
  budget.degraded = g.degrade
  return fleet.resolveModel(role, g.degrade)
}

// resolveOpenAI mirrors resolveAnthropic: enforces the cost guard (or the no-cap
// import context) then returns the raw Foundry deployment name from the fleet constants.
function resolveOpenAI(deploymentConst, budget) {
  if (budget && budget.noCap) {
    fleet.guard(fleet.IMPORT_CONTEXT)
    return deploymentConst
  }
  const g = fleet.guard()
  if (!g.allow) throw new Error('ai_budget_ceiling')
  budget.degraded = g.degrade
  return deploymentConst
}

// ─── Retry helper ─────────────────────────────────────────────────────────────
// Exponential backoff + jitter on 408/429/5xx and network errors. Import-path calls
// must survive transient Foundry hiccups rather than silently losing a whole batch.

async function fetchWithRetry(url, opts, { maxAttempts = 3, timeoutMs = 120_000 } = {}) {
  let lastErr = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const base   = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
      const jitter = Math.floor(Math.random() * 500)
      await new Promise(r => setTimeout(r, base + jitter))
    }
    let resp
    try {
      resp = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      lastErr = e
      continue
    }
    const status = typeof resp.status === 'number' ? resp.status : (resp.ok ? 200 : 500)
    if (status !== 408 && status !== 429 && status < 500) return resp
    if (attempt === maxAttempts - 1) return resp
    try { await resp.arrayBuffer() } catch { /* drain */ }
    const ra = Number(resp.headers?.get?.('Retry-After') || 0)
    if (ra > 0) await new Promise(r => setTimeout(r, Math.min(ra * 1000, 30_000)))
  }
  throw lastErr ?? new Error('fetch failed after retries')
}

// ─── Per-run spend telemetry ──────────────────────────────────────────────────
// Accumulates real token cost into the budget object so the pipeline can log and
// emit per-run spend (the no-cap switch removes the CAP, never the TELEMETRY).

function recordSpend(budget, deployment, inputTokens, outputTokens) {
  fleet.record(deployment, inputTokens, outputTokens)
  if (!budget) return
  const usd = fleet.estimateCostUsd(deployment, inputTokens || 0, outputTokens || 0)
  budget.spendUsd = (budget.spendUsd || 0) + usd
  budget.calls    = (budget.calls || 0) + 1
  if (!budget.byDeployment) budget.byDeployment = {}
  const d = budget.byDeployment[deployment] || { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 }
  d.calls        += 1
  d.inputTokens  += inputTokens || 0
  d.outputTokens += outputTokens || 0
  d.usd          += usd
  budget.byDeployment[deployment] = d
}

// ─── Anthropic Messages API call ──────────────────────────────────────────────
// For Claude models (haiku, sonnet, opus). temperature is deprecated on these models — omit it.
// If tools + toolName are provided, uses forced tool_choice and returns the tool input.
// Otherwise returns the first text block raw.
// `contentBlocks` (optional) replaces the plain userPrompt with rich blocks — used by
// the vision fallback to pass a base64 PDF document block for scanned documents.

// Deployments that returned 404 (not provisioned in this Foundry project, e.g.
// claude-sonnet-5 until it is deployed) — skipped for the process lifetime so
// ladder climbs never pay repeat round-trips for a known-missing rung.
const MISSING_DEPLOYMENTS = new Set()

async function callAnthropic({ deployment, systemPrompt, userPrompt, maxTokens, tools, toolName, contentBlocks, budget, timeoutMs }) {
  if (MISSING_DEPLOYMENTS.has(deployment)) {
    const err = new Error(`deployment ${deployment} not provisioned (cached 404)`)
    err.status = 404
    throw err
  }
  const content = Array.isArray(contentBlocks) && contentBlocks.length > 0
    ? contentBlocks
    : userPrompt
  // System prompt as a cache-controlled block: brain stages reuse the same (long,
  // first-principles-bearing) system text across many batch calls — the ephemeral
  // cache cuts input cost and latency on every call after the first.
  const body = {
    model: deployment,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  }
  if (tools && toolName) {
    body.tools = tools
    body.tool_choice = { type: 'tool', name: toolName }
  }
  const upstream = await fetchWithRetry(fleet.anthropicMessagesUrl(), {
    method: 'POST',
    headers: fleet.anthropicHeaders(),
    body: JSON.stringify(body),
  }, { timeoutMs: timeoutMs || 120_000 })
  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    if (upstream.status === 404 || /model.+not.+(found|exist)|no deployment/i.test(detail)) {
      MISSING_DEPLOYMENTS.add(deployment)
    }
    const err = new Error(`Foundry Anthropic ${upstream.status}: ${detail}`)
    err.status = upstream.status
    throw err
  }
  const json = await upstream.json()
  recordSpend(budget, deployment, json.usage?.input_tokens, json.usage?.output_tokens)
  // stop_reason rides along so callers can DETECT token-ceiling truncation
  // (ledger F10) instead of treating it as a generic parse failure.
  const stopReason = json.stop_reason ?? null
  if (tools && toolName) {
    const tu = Array.isArray(json.content) ? json.content.find(b => b.type === 'tool_use') : null
    return { raw: JSON.stringify(tu?.input ?? {}), usage: json.usage, stopReason }
  }
  const text = Array.isArray(json.content) ? (json.content.find(b => b.type === 'text')?.text ?? '') : ''
  return { raw: text, usage: json.usage, stopReason }
}

// ─── OpenAI Chat API call ─────────────────────────────────────────────────────
// For gpt-5.1 (VISION / VALIDATOR) and gpt-5-mini (CHEAP_GENERAL / BULK_ALT).
// o-series models reject `temperature` — never set it here.
// Converts Anthropic-style tools to OpenAI function-calling format.

async function callOpenAI({ deployment, systemPrompt, userPrompt, maxTokens, tools, toolName, budget }) {
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
  const upstream = await fetchWithRetry(fleet.openaiChatUrl(), {
    method: 'POST',
    headers: fleet.openaiHeaders(),
    body: JSON.stringify(body),
  })
  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    const err = new Error(`Foundry OpenAI ${upstream.status}: ${detail}`)
    err.status = upstream.status
    throw err
  }
  const json = await upstream.json()
  recordSpend(budget, deployment, json.usage?.prompt_tokens, json.usage?.completion_tokens)
  // finish_reason 'length' is the openai-family truncation signal (ledger F10).
  const stopReason = json.choices?.[0]?.finish_reason ?? null
  if (tools && toolName) {
    const tc = json.choices?.[0]?.message?.tool_calls?.[0]
    return { raw: tc?.function?.arguments ?? '{}', usage: json.usage, stopReason }
  }
  const text = json.choices?.[0]?.message?.content ?? ''
  return { raw: text, usage: json.usage, stopReason }
}

// ─── OpenAI Responses API call (CE3 Step 2: the WORKBOOK_DIGEST primary rung) ──
// gpt-*-pro deployments REJECT chat/completions with 400 — they live on the
// /responses surface (docs/reveng/FLEET.md, the #1 wiring trap). external/foundry's
// deepReason() does NOT know the IMPORT_CONTEXT (it can throw ai_budget_ceiling) and
// records only globally, so the import path gets its own call here: guard with the
// no-cap context, record into BOTH fleet.record and the per-run budget.
async function callResponses({ deployment, input, maxOutputTokens, budget }) {
  if (MISSING_DEPLOYMENTS.has(deployment)) {
    const err = new Error(`deployment ${deployment} not provisioned (cached 404)`)
    err.status = 404
    throw err
  }
  if (budget && budget.noCap) fleet.guard(fleet.IMPORT_CONTEXT)
  else {
    const g = fleet.guard()
    if (!g.allow) throw new Error('ai_budget_ceiling')
  }
  const upstream = await fetchWithRetry(fleet.openaiResponsesUrl(), {
    method: 'POST',
    headers: fleet.openaiHeaders(),
    body: JSON.stringify({ model: deployment, input, max_output_tokens: maxOutputTokens ?? 4096 }),
  })
  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    if (upstream.status === 404) MISSING_DEPLOYMENTS.add(deployment)
    const err = new Error(`Foundry responses ${upstream.status}: ${detail}`)
    err.status = upstream.status
    throw err
  }
  const json = await upstream.json()
  recordSpend(budget, deployment, json.usage?.input_tokens, json.usage?.output_tokens)
  const text = (json.output || [])
    .flatMap(o => Array.isArray(o.content) ? o.content : [])
    .filter(c => c && c.type === 'output_text')
    .map(c => c.text)
    .join('')
  return { raw: text, usage: json.usage, stopReason: json.status ?? null }
}

// ─── Escalation ladder (haiku → sonnet → opus) ────────────────────────────────
// Walks the Anthropic tiers above `fromRole`, calling each until one parses.
// A missing mid-tier deployment (Foundry 4xx, e.g. sonnet not deployed) is skipped —
// the ladder degrades gracefully to the next rung rather than failing the field.
// `parse(raw)` must return null/undefined for an unusable response.

async function escalateAnthropic({ fromRole, systemPrompt, userPrompt, maxTokens, budget, parse }) {
  const ladder = fleet.ESCALATION_LADDER
  const start  = Math.max(0, ladder.indexOf(fromRole) + 1)
  for (let i = start; i < ladder.length; i++) {
    const role = ladder[i]
    let deployment
    try { deployment = resolveAnthropic(role, budget) } catch { continue }
    try {
      const res    = await callAnthropic({ deployment, systemPrompt, userPrompt, maxTokens, budget })
      const parsed = parse(res.raw)
      if (parsed != null) {
        // Additive telemetry hook (set by unified-import): a REAL hand-off happened.
        try { budget?.onEscalation?.({ fromRole, toRole: role, deployment }) } catch { /* never fail the ladder */ }
        return { role, deployment, parsed }
      }
    } catch (e) {
      // 4xx (deployment absent / bad request) → try the next rung; rethrow nothing.
      if (e && e.status && e.status >= 500) continue
      continue
    }
  }
  return null
}

// ─── Budget factory ───────────────────────────────────────────────────────────
// Creates a budget object passed through the brain pipeline.
//   degraded — updated before every guarded AI call; callers check it to route cheaper.
//   noCap    — the EXPLICIT import switch: never deny, never degrade, keep telemetry.
//   spendUsd/calls/byDeployment — per-run spend telemetry (always recorded).

function createBudget(opts = {}) {
  return {
    degraded:     false,
    noCap:        Boolean(opts.noCap),
    spendUsd:     0,
    calls:        0,
    byDeployment: {},
  }
}

module.exports = {
  callAnthropic, callOpenAI, callResponses, resolveAnthropic, resolveOpenAI,
  escalateAnthropic, fetchWithRetry, createBudget,
}
