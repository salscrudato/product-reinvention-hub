'use strict'
const fleet = require('../fleet')
const { sse, emit, fetchWithRetry, grounding } = require('./_shared')

const CHAT_OVERRIDE = process.env.AZURE_FOUNDRY_DEPLOYMENT || ''

const SYSTEM = [
  'You are the Product Hub portfolio copilot for P&C insurance.',
  'The CONTEXT below has two sections: PORTFOLIO (the tenant\'s COMPLETE product catalogue — one entry per product) and DETAIL (the coverages, forms, rules and rating chunks most relevant to this specific query, retrieved semantically).',
  'PORTFOLIO is authoritative and exhaustive: when asked what products / lines the customer offers, list EVERY product in PORTFOLIO — never claim the catalogue is incomplete or that you only have one line when PORTFOLIO lists several.',
  'Answer ONLY from the CONTEXT. If it is insufficient for a specific detail, say so plainly for that detail — never invent facts, coverages, forms, or numbers.',
  'Before composing your answer, briefly reason through which CONTEXT entries are most relevant to this question, then provide a direct response.',
  'Every substantive claim MUST cite its source using the bracketed reference tags in the context, e.g. [PH.PROD.001] or a form number like [CG 00 01]. Do not fabricate reference tags.',
].join(' ')

async function chat(req, res) {
  const body = req.body || {}
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: String(m.content) }))
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content || ''
  sse(res)

  const g = fleet.guard()
  if (!g.allow) {
    emit(res, { t: 'error', message: 'AI is temporarily limited — the budget ceiling has been reached. Please try again shortly.' })
    emit(res, { t: 'done' }); return res.end()
  }
  const deployment = CHAT_OVERRIDE || fleet.resolveModel('GROUNDED_CITED', g.degrade)

  try {
    const { baseline, detail } = await grounding(lastUser, body.productId, req.user.tenantId)
    const ctx = [...baseline, ...detail]
    const portfolioSection = baseline.length ? `PORTFOLIO:\n${baseline.join('\n\n---\n\n')}` : ''
    const detailSection    = detail.length    ? `DETAIL:\n${detail.join('\n\n---\n\n')}`    : ''
    const contextBody = [portfolioSection, detailSection].filter(Boolean).join('\n\n===\n\n')
    const systemBlocks = [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `\n\nCONTEXT:\n${contextBody || '(no matching context found)'}` },
    ]
    const upstream = await fetchWithRetry(fleet.anthropicMessagesUrl(), {
      method: 'POST',
      headers: fleet.anthropicHeaders(),
      body: JSON.stringify({ model: deployment, max_tokens: 8192, system: systemBlocks, stream: true, messages: msgs.length ? msgs : [{ role: 'user', content: 'Hello' }] }),
    }, { timeoutMs: 120_000 })
    if (!upstream.ok || !upstream.body) {
      const detail2 = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      emit(res, { t: 'error', message: `Foundry ${upstream.status}: ${detail2}` })
      emit(res, { t: 'done' }); return res.end()
    }
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let fullText = ''
    let inputTokens = 0
    let outputTokens = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const payload = s.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) {
            fullText += j.delta.text
            emit(res, { t: 'token', v: j.delta.text })
          } else if (j.type === 'message_start') { inputTokens = j.message?.usage?.input_tokens || 0; outputTokens = j.message?.usage?.output_tokens || 0 }
          else if (j.type === 'message_delta' && j.usage?.output_tokens != null) outputTokens = j.usage.output_tokens
          else if (j.type === 'error') emit(res, { t: 'error', message: j.error?.message || 'stream error' })
        } catch { /* keep-alive / partial */ }
      }
    }
    fleet.record(deployment, inputTokens, outputTokens)
    const cited = [...new Set([...fullText.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]))]
    if (cited.length > 0) {
      const inCtxBracketed = new Set(ctx.flatMap((c) => [...c.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])))
      const ctxFullText = ctx.join(' ')
      const unverified = cited.filter((r) => !inCtxBracketed.has(r) && !ctxFullText.includes(r))
      if (unverified.length > 0) {
        emit(res, { t: 'notice', kind: 'unverified', level: 'warn', message: `Unverified citation(s): ${unverified.join(', ')} — not found in retrieved context.`, refs: unverified })
      }
    }
    emit(res, { t: 'done' })
    res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `AI error: ${String(err.message || err).slice(0, 220)}` })
    emit(res, { t: 'done' })
    res.end()
  }
}

module.exports = { SYSTEM, chat }
