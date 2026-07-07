// ai.ts — the portfolio chat SSE endpoint and the reusable tool-grounded agent
// loop. `runChatAgent` streams assistant tokens + tool-status events while
// looping over tool_use turns; claims.ts and gap.ts reuse it with their own
// system context and tool set.
import { onRequest } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, openSse, send, ANTHROPIC_API_KEY } from './runtime'
import type { SseResponse } from './runtime'
import { TOOLS, SYSTEM_PROMPT, runTool } from './tools'
import type { ToolOutput } from './tools'

export interface AgentOptions {
  system?:      string             // extra, non-cached system context (e.g. focus product)
  tools?:       Anthropic.Tool[]   // defaults to the grounding TOOLS
  maxTokens?:   number
  maxTurns?:    number
  // Custom tool executor — defaults to the shared grounding runTool. Callers (claims.ts)
  // supply this to handle their own extra tools (e.g. emit_determination) while still
  // delegating the grounding tools to runTool. Keeps this the single agent loop.
  runTool?:     (name: string, input: Record<string, unknown>) => Promise<ToolOutput>
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
  // Stable rules first (cached across requests); volatile focus context after the breakpoint.
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ]
  if (opts.system) system.push({ type: 'text', text: opts.system })

  const tools    = opts.tools ?? TOOLS
  const maxTurns  = opts.maxTurns ?? 6
  const exec      = opts.runTool ?? runTool
  const convo: Anthropic.MessageParam[] = [...messages]

  for (let turn = 0; turn < maxTurns; turn++) {
    // No sampling params: Sonnet 5 rejects a non-default temperature/top_p/top_k
    // (400). Grounding is enforced by the tools + system prompt, not by sampling.
    const stream = client.messages.stream({
      model:      MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      system,
      tools,
      messages:   convo,
    })
    stream.on('text', (delta) => send(res, { t: 'token', v: delta }))
    const final = await stream.finalMessage()
    convo.push({ role: 'assistant', content: final.content })

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
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Any signed-in role may chat — it only reads. Writes are gated elsewhere.
    try { await authenticate(req) }
    catch (e) { res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return }

    openSse(res)
    try {
      const body     = (req.body ?? {}) as ChatBody
      const incoming = (body.messages ?? []).filter(m => m.content?.trim())
      if (incoming.length === 0) { send(res, { t: 'error', message: 'No message provided.' }); return }

      const messages: Anthropic.MessageParam[] = incoming.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }))
      const focus = body.productId
        ? `The user is focused on product ${body.productId}. Prefer that product when a productId is needed.`
        : undefined

      await runChatAgent(anthropic(), messages, res, { system: focus })
      send(res, { t: 'done' })
    } catch (err) {
      send(res, { t: 'error', message: err instanceof Error ? err.message : 'AI request failed.' })
    } finally {
      res.end()
    }
  },
)
