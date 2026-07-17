'use strict'
const fleet = require('../fleet')
const { sse, emit, grounding } = require('./_shared')

const CHAT_OVERRIDE = process.env.AZURE_FOUNDRY_DEPLOYMENT || ''

const SYSTEM = [
  'You are the Product Hub portfolio copilot for P&C insurance.',
  'The CONTEXT below has two sections: PORTFOLIO (the tenant\'s COMPLETE product catalogue — one entry per product) and DETAIL (the coverages, forms, rules and rating chunks most relevant to this specific query, retrieved semantically).',
  'PORTFOLIO is authoritative and exhaustive: when asked what products / lines the customer offers, list EVERY product in PORTFOLIO — never claim the catalogue is incomplete or that you only have one line when PORTFOLIO lists several.',
  'Answer ONLY from the CONTEXT. If it is insufficient for a specific detail, say so plainly for that detail — never invent facts, coverages, forms, or numbers.',
  'Silently select the CONTEXT entries that actually support the question and answer directly from them — do not narrate your selection or reasoning process in the reply.',
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
    // Honest status: the ceiling was hit — emit the canonical `deny` notice (notices.ts) so the
    // client shows the resettable "AI paused for today" copy instead of a raw error string.
    emit(res, { t: 'notice', level: 'warn', kind: 'deny', message: 'The daily AI budget ceiling has been reached. It resets at 00:00 UTC.' })
    emit(res, { t: 'done' }); return res.end()
  }
  const deployment = CHAT_OVERRIDE || fleet.resolveModel('GROUNDED_CITED', g.degrade)
  // Under soft budget pressure the answer used the cheaper same-family model — surface the
  // canonical `degrade` notice so the reduced depth is visible and Regenerate is offered.
  if (g.degrade) emit(res, { t: 'notice', level: 'info', kind: 'degrade', message: 'Reduced-depth answer — the AI budget for this session is running low.' })

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
    // Streaming timeout discipline (S07): bound ONLY time-to-first-token with an abort; once the
    // body is flowing, read under a per-chunk inactivity watchdog. A long-but-healthy generation
    // is never killed mid-answer, and a genuinely stalled stream salvages the partial (metered +
    // cited + carded + truncation notice) instead of throwing it away into the catch.
    const TTFT_MS = 45_000, IDLE_MS = 90_000
    const ac = new AbortController()
    const ttft = setTimeout(() => ac.abort(), TTFT_MS)
    let upstream
    try {
      upstream = await fetch(fleet.anthropicMessagesUrl(), {
        method: 'POST',
        headers: fleet.anthropicHeaders(),
        signal: ac.signal,
        body: JSON.stringify({ model: deployment, max_tokens: 8192, system: systemBlocks, stream: true, messages: msgs.length ? msgs : [{ role: 'user', content: 'Hello' }] }),
      })
    } catch (e) {
      clearTimeout(ttft)
      emit(res, { t: 'error', message: `AI connection failed: ${String((e && e.message) || e).slice(0, 160)}` })
      emit(res, { t: 'done' }); return res.end()
    }
    clearTimeout(ttft) // headers received — the abort was only for connect/first-byte
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
    let stopReason = null
    let truncated = false
    for (;;) {
      let chunk, timer
      try {
        chunk = await Promise.race([
          reader.read(),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('idle')), IDLE_MS) }),
        ])
      } catch { truncated = true; try { await reader.cancel() } catch { /* already closed */ } break }
      finally { clearTimeout(timer) }
      const { done, value } = chunk
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
          else if (j.type === 'message_delta') { if (j.usage?.output_tokens != null) outputTokens = j.usage.output_tokens; if (j.delta?.stop_reason) stopReason = j.delta.stop_reason }
          else if (j.type === 'error') emit(res, { t: 'error', message: j.error?.message || 'stream error' })
        } catch { /* keep-alive / partial */ }
      }
    }
    fleet.record(deployment, inputTokens, outputTokens)
    require('../metering').meterCurrent(deployment, inputTokens, outputTokens) // per-tenant attribution (ALS)
    // Honest surfacing (S09): a safety refusal or an output-cap / inactivity truncation is told to
    // the user rather than silently returning a short or empty answer.
    if (stopReason === 'refusal') {
      emit(res, { t: 'notice', level: 'warn', kind: 'refusal', message: 'The model declined to answer this request. Try rephrasing.' })
    } else if (truncated || stopReason === 'max_tokens') {
      emit(res, { t: 'notice', level: 'warn', kind: 'truncated', message: 'This answer was cut off (length limit or a stalled stream). Regenerate for the full response.' })
    }
    // Citations = bracketed refs the model emitted, EXCLUDING markdown links `[text](url)`
    // (the lookahead on the char after `]`), which are navigation, not citations (S18/S37).
    const cited = [...new Set(
      [...fullText.matchAll(/\[([^\]]+)\]/g)]
        .filter((m) => fullText[m.index + m[0].length] !== '(')
        .map((m) => m[1].trim())
        .filter(Boolean),
    )]
    let unverified = []
    if (cited.length > 0) {
      const inCtxBracketed = new Set(ctx.flatMap((c) => [...c.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim())))
      const ctxFullText = ctx.join(' ')
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Verified = a bracketed ref present in the context, OR a citation token (refId / form
      // number) that appears in context as a WHOLE token — not a loose substring, so a short or
      // fabricated ref can't be "verified" by coincidentally being a substring of prose.
      const inCtx = (r) => inCtxBracketed.has(r) || (r.length >= 2 && new RegExp(`(?:^|[^\\w])${esc(r)}(?:[^\\w]|$)`).test(ctxFullText))
      unverified = cited.filter((r) => !inCtx(r))
      if (unverified.length > 0) {
        emit(res, { t: 'notice', kind: 'unverified', level: 'warn', message: `Unverified citation(s): ${unverified.join(', ')} — not found in retrieved context.`, refs: unverified })
      }
    }
    // Emit a structured card payload: citation chips + provenance metadata.
    // The client renders this below the markdown text as a "Data citations" panel.
    const verified = cited.filter((r) => !unverified.includes(r))
    emit(res, { t: 'json', key: 'chatCard', value: { citations: verified, allCitations: cited, contextHits: ctx.length, inputTokens, outputTokens } })
    emit(res, { t: 'done' })
    res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `AI error: ${String(err.message || err).slice(0, 220)}` })
    emit(res, { t: 'done' })
    res.end()
  }
}

module.exports = { SYSTEM, chat }
