// ai.ts — the portfolio chat SSE endpoint and the reusable tool-grounded agent
// loop. `runChatAgent` streams assistant tokens + tool-status events while
// looping over tool_use turns; claims.ts, rules.ts and scaffoldProduct.ts reuse it
// with their own system context and tool set.
import { onRequest } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, MODEL_FAST, openSse, send, ANTHROPIC_API_KEY, VOYAGE_API_KEY, voyageKey, isRetryableAnthropicError, CACHE_1H } from './runtime'
import type { SseResponse } from './runtime'
import { TOOLS, SYSTEM_PROMPT, runTool, loadKnownCitations } from './tools'
import type { ToolOutput } from './tools'
import { findUnverifiedCitations, verifiedCitedAnchors } from '@pf/shared'
import type { ChunkMetadata } from '@pf/shared'
import { retrieve, embedQueryVector } from './retrieval/index'
import { buildCiteableDocuments, citationsFromConvo, verifyCitations } from './retrieval/citations'
import { emptyUsage, addUsage, recordUsage, estimateCost } from './telemetry'
import type { UsageAccum } from './telemetry'
import { semanticCacheGet, semanticCachePut } from './semanticCache'
import { guardSpend, estCostFor } from './costGuard'

/** Concatenate every assistant text block across a completed conversation — the full
 *  answer the user saw (tokens are appended across turns in the UI). Used to detect a
 *  silent empty result and to run the citation post-check. Ignores tool_use blocks. */
export function assistantText(convo: Anthropic.MessageParam[]): string {
  const parts: string[] = []
  for (const m of convo) {
    if (m.role !== 'assistant') continue
    if (typeof m.content === 'string') { parts.push(m.content); continue }
    for (const b of m.content) if (b.type === 'text') parts.push(b.text)
  }
  return parts.join('')
}

export interface AgentOptions {
  system?:      string             // stable feature prompt — cached alongside the house rules
  context?:     string             // volatile per-request context (focus product, detected line) — never cached
  tools?:       Anthropic.Tool[]   // defaults to the grounding TOOLS
  maxTokens?:   number
  maxTurns?:    number
  // Custom tool executor — defaults to the shared grounding runTool. Callers (claims.ts)
  // supply this to handle their own extra tools (e.g. emit_determination) while still
  // delegating the grounding tools to runTool. Keeps this the single agent loop.
  runTool?:     (name: string, input: Record<string, unknown>) => Promise<ToolOutput>
  // When provided, per-turn API usage (input/output/cache tokens) is accumulated here.
  // The caller records it after the agent run so one Usage record covers the full request.
  usageAccum?:  UsageAccum
}

/**
 * Consume one streamed assistant turn, forwarding text deltas as SSE `token`
 * events. Recovers from a transient failure by retrying with backoff — but ONLY
 * while nothing has been streamed to the client yet this turn: the API cannot
 * resume a partially-emitted message, so re-streaming would duplicate visible text.
 * This sits on top of the client's own maxRetries (which covers only establishing
 * the request), catching faults surfaced during stream consumption.
 */
async function streamTurn(
  client: Anthropic,
  params: Anthropic.MessageStreamParams,
  res:    SseResponse,
): Promise<Anthropic.Message> {
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; ; attempt++) {
    let streamed = false
    try {
      // Per-turn timeout so a stalled upstream can't hang the request to the function
      // ceiling — the SDK aborts and surfaces a timeout we treat like any other fault.
      const stream = client.messages.stream(params, { timeout: 120_000 })
      // A no-op 'error' listener keeps an emitted error from becoming an unhandled
      // exception; we act on the finalMessage() rejection below instead.
      stream.on('error', () => {})
      stream.on('text', (delta) => { streamed = true; send(res, { t: 'token', v: delta }) })
      return await stream.finalMessage()
    } catch (err) {
      if (streamed || attempt >= MAX_ATTEMPTS || !isRetryableAnthropicError(err)) throw err
      await new Promise(r => setTimeout(r, 400 * 2 ** (attempt - 1)))   // 400ms, then 800ms
    }
  }
}

/**
 * Drive a tool-grounded conversation to completion, streaming as it goes.
 * Returns the full message list (including the final assistant turn) so callers
 * can persist or post-process it. Tool errors surface to the model, not the client.
 */
export async function runChatAgent(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  res: SseResponse,
  opts: AgentOptions = {},
): Promise<Anthropic.MessageParam[]> {
  // Stable, cacheable context first: the shared house rules, then any feature prompt.
  // One cache breakpoint (explicit 1h TTL) on the LAST stable block caches the whole prefix
  // (tools + system) across this conversation's tool-loop turns AND across requests.
  // Volatile per-request context goes AFTER the breakpoint so it never invalidates the cache.
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: SYSTEM_PROMPT }]
  if (opts.system) system.push({ type: 'text', text: opts.system })
  system[system.length - 1]!.cache_control = CACHE_1H
  if (opts.context) system.push({ type: 'text', text: opts.context })

  const tools     = opts.tools ?? TOOLS
  const maxTokens = opts.maxTokens ?? 2048
  const maxTurns  = opts.maxTurns ?? 6
  const exec      = opts.runTool ?? runTool
  const convo: Anthropic.MessageParam[] = [...messages]

  for (let turn = 0; turn < maxTurns; turn++) {
    // No sampling params: Sonnet 5 rejects a non-default temperature/top_p/top_k
    // (400). Grounding is enforced by the tools + system prompt, not by sampling.
    // streamTurn adds partial-stream recovery over the client's own maxRetries.
    const final = await streamTurn(
      client,
      { model: MODEL, max_tokens: maxTokens, system, tools, messages: convo },
      res,
    )
    convo.push({ role: 'assistant', content: final.content })
    if (opts.usageAccum) addUsage(opts.usageAccum, final.usage)

    const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (final.stop_reason !== 'tool_use' || toolUses.length === 0) break

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      send(res, { t: 'tool', name: tu.name, phase: 'start' })
      const out = await exec(tu.name, (tu.input as Record<string, unknown>) ?? {})
      send(res, { t: 'tool', name: tu.name, phase: 'end', summary: out.summary })
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.content })
    }
    convo.push({ role: 'user', content: results })
  }
  return convo
}

// ─── Shared SSE cost gate (Part C) ──────────────────────────────────────────────
// Reused by the grounded SSE endpoints (claims / extract / rules / scaffold). Reads the cost
// caps + breaker and, on a block, streams the honest notice + a terminal `done` itself; the
// caller returns and its `finally` records the (no-provider-call) usage. A soft cap returns
// `degraded` so the caller can run a cheaper path (fewer turns / no escalation).
export interface CostGate { proceed: boolean; degraded: boolean; blocked: 'deny' | 'breaker' | null }

export async function sseCostGate(res: SseResponse, feature: string, sessionKey: string): Promise<CostGate> {
  const guard = await guardSpend({ feature, sessionKey, estCostUsd: estCostFor(feature) })
  if (guard.action === 'deny') {
    send(res, { t: 'notice', level: 'warn', message: 'AI is temporarily limited — the daily budget ceiling has been reached. Please try again later.' })
    send(res, { t: 'done' })
    return { proceed: false, degraded: false, blocked: 'deny' }
  }
  if (guard.breakerOpen) {
    send(res, { t: 'notice', level: 'warn', message: 'The AI service is temporarily unavailable. Please try again shortly.' })
    send(res, { t: 'done' })
    return { proceed: false, degraded: false, blocked: 'breaker' }
  }
  if (guard.action === 'degrade') {
    send(res, { t: 'notice', level: 'info', message: guard.reason })
    return { proceed: true, degraded: true, blocked: null }
  }
  return { proceed: true, degraded: false, blocked: null }
}

// ─── chat endpoint ──────────────────────────────────────────────────────────────

interface ChatBody {
  messages?:  Array<{ role: string; content: string }>
  productId?: string
  sessionId?: string    // client session — the per-session cost cap bucket + cache scope key
  regenerate?: boolean  // per-session bypass: skip the semantic cache READ, force a fresh answer
}

export const chat = onRequest(
  { secrets: [ANTHROPIC_API_KEY, VOYAGE_API_KEY], cors: true, timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Any signed-in role may chat — it only reads. Writes are gated elsewhere.
    let caller
    try { caller = await authenticate(req) }
    catch (e) { res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return }

    openSse(res)
    const usageAccum = emptyUsage()
    const t0 = Date.now()
    let ok = true
    // Telemetry we resolve as the request unfolds.
    let providerCalled = true
    let semanticCache: 'hit' | 'miss' | undefined
    let savedUsd: number | undefined
    let degraded = false
    let denied = false
    let recordModel: string = MODEL
    let recordUsageAccum: UsageAccum = usageAccum

    const body       = (req.body ?? {}) as ChatBody
    const productId  = body.productId
    const sessionKey = body.sessionId?.trim() || caller.uid
    try {
      const incoming = (body.messages ?? []).filter(m => m.content?.trim())
      if (incoming.length === 0) { send(res, { t: 'error', message: 'No message provided.' }); return }

      const messages: Anthropic.MessageParam[] = incoming.map(m => ({
        role:    (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.content as string | Anthropic.ContentBlockParam[],
      }))
      // The latest user question drives the cache key + citation retrieval.
      let li = -1
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') { li = i; break }
      const query = li >= 0 ? incoming[li]!.content : ''

      const vKey = voyageKey()
      // Embed the query ONCE (Voyage/prod only): reused for the cache probe AND, on a miss, for
      // citation retrieval (no double embed). Null offline → cache skipped, tools-only path.
      const queryVector = vKey && query ? await embedQueryVector(query, vKey) : null

      // The live citation catalogue: used both to check cache freshness up-front AND for the
      // post-answer verification below — loaded once. Best-effort (empty on failure).
      let known = { refIds: new Set<string>(), formNumbers: new Set<string>() }
      try { known = await loadKnownCitations() } catch (e) { console.warn('[chat] known-citations load skipped:', e) }

      // ── PART A — semantic cache READ (skipped on regenerate) ──────────────────
      // Three gates (freshness → similarity → cheap verifier) in semanticCacheGet. A hit
      // skips retrieval + the Sonnet call; a stale-cited candidate is never served + evicted.
      if (queryVector && !body.regenerate) {
        try {
          const r = await semanticCacheGet({ client: anthropic(), query, queryVector, productId, known })
          if (r.hit) {
            send(res, { t: 'token', v: r.hit.answer })
            send(res, { t: 'notice', level: 'info', message: 'Answered from a cached response for a near-identical question. Use Regenerate for a fresh answer.' })
            send(res, { t: 'done' })
            // A hit spent only the tiny verifier (+ one embed) — record that, and the Sonnet
            // spend it AVOIDED as savedUsd. No provider answer call, so the breaker is untouched.
            recordModel = MODEL_FAST
            recordUsageAccum = r.verifierUsage
            semanticCache = 'hit'
            providerCalled = false
            savedUsd = Math.max(0, estCostFor('chat') - estimateCost(MODEL_FAST, r.verifierUsage))
            return
          }
          semanticCache = 'miss'
        } catch (e) { console.warn('[chat] semantic cache probe skipped:', e); semanticCache = 'miss' }
      }

      // ── PART C — budget cap + circuit breaker (graceful degradation) ──────────
      const guard = await guardSpend({ feature: 'chat', sessionKey, estCostUsd: estCostFor('chat') })
      if (guard.action === 'deny') {
        // Hard global ceiling — no model call. Clear, honest message; ADMIN alarm in the tab.
        denied = true; providerCalled = false; recordUsageAccum = emptyUsage()
        send(res, { t: 'notice', level: 'warn', message: 'AI is temporarily limited — the daily budget ceiling has been reached. Please try again later.' })
        send(res, { t: 'done' })
        return
      }
      if (guard.breakerOpen) {
        // Provider unhealthy (breaker open) and no cache hit — don't hammer it. Degrade to a
        // clear message rather than burning the timeout on a call likely to fail.
        degraded = true; providerCalled = false; recordUsageAccum = emptyUsage()
        send(res, { t: 'notice', level: 'warn', message: 'The AI service is temporarily unavailable. Please try again shortly.' })
        send(res, { t: 'done' })
        return
      }
      if (guard.action === 'degrade') {
        // Soft cap (session/feature) with a healthy provider — still answer, but cheaper:
        // fewer tool turns and skip the citation augmentation. Grounding stays enforced by
        // the tools + the post-answer verification.
        degraded = true
        send(res, { t: 'notice', level: 'info', message: guard.reason })
      }

      const focus = productId
        ? `The user is focused on product ${productId}. Prefer that product when a productId is needed.`
        : undefined

      // Retrieval-augmented citations (Voyage/prod; skipped when degrading to save tokens).
      let citationIndex: ChunkMetadata[] = []
      if (vKey && !degraded && li >= 0) {
        try {
          const hits = await retrieve({ query, topK: 6, queryVector: queryVector ?? undefined, filter: productId ? { productId } : undefined, voyageKey: vKey })
          const { blocks, index } = buildCiteableDocuments(hits)
          if (blocks.length) {
            citationIndex = index
            messages[li] = { role: 'user', content: [...blocks, { type: 'text', text: query }] }
          }
        } catch (e) { console.warn('[chat] citation pre-retrieval skipped:', e) }
      }

      const convo = await runChatAgent(anthropic(), messages, res, {
        context: focus, usageAccum, maxTurns: degraded ? 3 : undefined,
      })

      const answer = assistantText(convo)
      if (!answer.trim()) {
        // B1: the agent loop can exhaust maxTurns mid-tool-use (or otherwise end with no
        // text) — never let that surface as a silent empty bubble.
        send(res, { t: 'error', message: "I couldn't produce an answer for that. Please rephrase or try again." })
      } else {
        // C1: server-verify every [refId] / [form number] the answer cites against the
        // live catalogue and FLAG any that don't resolve. Best-effort.
        const unverified = findUnverifiedCitations(answer, known.refIds, known.formNumbers)
        if (unverified.length) {
          const one = unverified.length === 1
          send(res, {
            t: 'notice', level: 'warn', refs: unverified,
            message: `${unverified.length} cited ${one ? 'reference' : 'references'} couldn't be verified against the catalog (${unverified.join(', ')}). Treat ${one ? 'it' : 'them'} as unconfirmed.`,
          })
        }

        // When citeable chunks were supplied, resolve the model's Citations-API citations
        // back to those chunks (server-verifiable grounding, C1).
        if (citationIndex.length) {
          const v = verifyCitations(citationsFromConvo(convo), citationIndex)
          if (v.invalid > 0) {
            send(res, { t: 'notice', level: 'warn', message: `${v.invalid} citation${v.invalid === 1 ? '' : 's'} referenced a source outside the grounded set — treat as unconfirmed.` })
          }
        }

        // ── PART A — semantic cache WRITE. Cache the answer keyed on the query embedding,
        // storing the VERIFIED refId/form anchors as its freshness key. A future read only
        // serves it while every anchor still resolves; the invalidation trigger evicts it the
        // moment a cited entity changes. `regenerate` refreshes the entry in place.
        if (queryVector) {
          const anchors = verifiedCitedAnchors(answer, known.refIds, known.formNumbers)
          void semanticCachePut({ query, queryVector, answer, anchors, productId, model: MODEL })
        }
      }
      send(res, { t: 'done' })
    } catch (err) {
      ok = false
      console.error('[chat] internal error:', err)
      send(res, { t: 'error', message: 'AI request failed.' })
    } finally {
      res.end()
      void recordUsage({
        feature: 'chat', model: recordModel, usage: recordUsageAccum, latencyMs: Date.now() - t0, ok,
        sessionKey, semanticCache, savedUsd, degraded, denied, providerCalled,
      })
    }
  },
)
