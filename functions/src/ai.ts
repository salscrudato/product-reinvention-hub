// ai.ts — the portfolio chat SSE endpoint and the reusable tool-grounded agent
// loop. `runChatAgent` streams assistant tokens + tool-status events while
// looping over tool_use turns; claims.ts, rules.ts and scaffoldProduct.ts reuse it
// with their own system context and tool set.
import { onRequest } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, openSse, send, ANTHROPIC_API_KEY, VOYAGE_API_KEY, voyageKey, isRetryableAnthropicError, CACHE_1H } from './runtime'
import type { SseResponse } from './runtime'
import { TOOLS, SYSTEM_PROMPT, runTool, loadKnownCitations } from './tools'
import type { ToolOutput } from './tools'
import { findUnverifiedCitations } from '@pf/shared'
import type { ChunkMetadata } from '@pf/shared'
import { retrieve } from './retrieval/index'
import { buildCiteableDocuments, citationsFromConvo, verifyCitations } from './retrieval/citations'
import { emptyUsage, addUsage, recordUsage } from './telemetry'
import type { UsageAccum } from './telemetry'

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

// ─── chat endpoint ──────────────────────────────────────────────────────────────

interface ChatBody {
  messages?:  Array<{ role: string; content: string }>
  productId?: string
}

export const chat = onRequest(
  { secrets: [ANTHROPIC_API_KEY, VOYAGE_API_KEY], cors: true, timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Any signed-in role may chat — it only reads. Writes are gated elsewhere.
    try { await authenticate(req) }
    catch (e) { res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return }

    openSse(res)
    const usageAccum = emptyUsage()
    const t0 = Date.now()
    let ok = true
    try {
      const body     = (req.body ?? {}) as ChatBody
      const incoming = (body.messages ?? []).filter(m => m.content?.trim())
      if (incoming.length === 0) { send(res, { t: 'error', message: 'No message provided.' }); return }

      const messages: Anthropic.MessageParam[] = incoming.map(m => ({
        role:    (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.content as string | Anthropic.ContentBlockParam[],
      }))
      const focus = body.productId
        ? `The user is focused on product ${body.productId}. Prefer that product when a productId is needed.`
        : undefined

      // Retrieval-augmented citations (gated on a configured Voyage key → prod only; with
      // no key the flow is exactly today's tools-only path, so offline behavior is
      // unchanged). Attach the chunks most relevant to the LATEST question as citeable
      // `document` blocks so the model cites chunk-level sources we then verify server-side.
      let citationIndex: ChunkMetadata[] = []
      const vKey = voyageKey()
      if (vKey) {
        let li = -1
        for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') { li = i; break }
        if (li >= 0) {
          const q = incoming[li]!.content
          try {
            const hits = await retrieve({ query: q, topK: 6, filter: body.productId ? { productId: body.productId } : undefined, voyageKey: vKey })
            const { blocks, index } = buildCiteableDocuments(hits)
            if (blocks.length) {
              citationIndex = index
              messages[li] = { role: 'user', content: [...blocks, { type: 'text', text: q }] }
            }
          } catch (e) { console.warn('[chat] citation pre-retrieval skipped:', e) }
        }
      }

      const convo = await runChatAgent(anthropic(), messages, res, { context: focus, usageAccum })

      const answer = assistantText(convo)
      if (!answer.trim()) {
        // B1: the agent loop can exhaust maxTurns mid-tool-use (or otherwise end with no
        // text) — never let that surface as a silent empty bubble.
        send(res, { t: 'error', message: "I couldn't produce an answer for that. Please rephrase or try again." })
      } else {
        // C1: server-verify every [refId] / [form number] the answer cites against the
        // live catalogue and FLAG any that don't resolve, so an ungrounded reference is
        // never presented as if verified. Best-effort — a lookup failure must not break
        // an answer that already streamed.
        try {
          const known = await loadKnownCitations()
          const unverified = findUnverifiedCitations(answer, known.refIds, known.formNumbers)
          if (unverified.length) {
            const one = unverified.length === 1
            send(res, {
              t: 'notice', level: 'warn', refs: unverified,
              message: `${unverified.length} cited ${one ? 'reference' : 'references'} couldn't be verified against the catalog (${unverified.join(', ')}). Treat ${one ? 'it' : 'them'} as unconfirmed.`,
            })
          }
        } catch (e) {
          console.warn('[chat] citation verification skipped:', e)
        }

        // When citeable chunks were supplied, resolve the model's Citations-API citations
        // back to those chunks: every valid citation points at a REAL chunk whose refId we
        // know (server-verifiable grounding, C1). `invalid` (a citation outside the supplied
        // set) should never happen — surface it if it does.
        if (citationIndex.length) {
          const v = verifyCitations(citationsFromConvo(convo), citationIndex)
          if (v.invalid > 0) {
            send(res, { t: 'notice', level: 'warn', message: `${v.invalid} citation${v.invalid === 1 ? '' : 's'} referenced a source outside the grounded set — treat as unconfirmed.` })
          }
        }
      }
      send(res, { t: 'done' })
    } catch (err) {
      ok = false
      console.error('[chat] internal error:', err)
      send(res, { t: 'error', message: 'AI request failed.' })
    } finally {
      res.end()
      void recordUsage({ feature: 'chat', model: MODEL, usage: usageAccum, latencyMs: Date.now() - t0, ok })
    }
  },
)
