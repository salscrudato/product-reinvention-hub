/**
 * hardening-s06-vote-starvation.test.ts — regression lock for ledger S06.
 *
 * The OpenAI legs of the dual-family vote sites run on reasoning-class models
 * (gpt-5-mini / gpt-5.1 / DeepSeek) that spend completion budget on internal
 * reasoning BEFORE emitting the vote. At the pre-fix budgets (prefilter 128,
 * classify 256, judges 400) the live probe measured gpt-5-mini returning
 * finish_reason 'length' with ZERO content in 2/3 trials — the dual-family
 * site silently collapsed to single family, and nothing counted it.
 *
 * Locks three layers:
 *  (a) refusal is an explicit vote class: callOpenAI normalizes message.refusal
 *      to stopReason 'refusal'; parseWithRetry names it (no wasted retry);
 *  (b) per-family vote participation counters accumulate on the budget for
 *      every outcome class — a fully degraded run is measurable;
 *  (c) the raised completion budgets (1024/2048/2048) are source-locked so a
 *      refactor cannot silently re-starve the legs.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

vi.mock('../../server/lib/fleet', () => ({
  guard:                () => ({ allow: true, degrade: false, reason: 'ok' }),
  record:               () => {},
  resolveModel:         (role: string) => `stub-${role}`,
  anthropicMessagesUrl: () => 'http://stub/anthropic',
  openaiChatUrl:        () => 'http://stub/openai',
  anthropicHeaders:     () => ({ 'Content-Type': 'application/json' }),
  openaiHeaders:        () => ({ 'Content-Type': 'application/json' }),
  openaiChatBody:       (model: string, msgs: unknown[], maxTokens: number) => ({ model, messages: msgs, max_completion_tokens: maxTokens }),
  DEPLOY_GPT:           'stub-gpt',
  DEPLOY_GPT_MINI:      'stub-gpt-mini',
  DEPLOY_OPUS:          'stub-opus',
  DEPLOY_HAIKU:         'stub-haiku',
  isConfigured:         () => false,
  estimateCostUsd:      () => 0,
  IMPORT_CONTEXT:       'import-no-cap',
  ESCALATION_LADDER:    ['BULK_VERIFY', 'MID_REASONER', 'GROUNDED_CITED'],
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseWithRetry, recordVote, REFUSAL_STOP_REASONS } = require('../../server/lib/import-brain/constants.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { callOpenAI } = require('../../server/lib/import-brain/ai-call.js')

type Vote = { attempted: number; cast: number; truncated: number; refused: number; empty: number; malformed: number; retries: number }
type Budget = { votes?: Record<string, Record<string, Vote>> }

describe('S06a: refusal is an explicit vote class, not an empty raw', () => {
  it('callOpenAI normalizes a non-empty message.refusal to stopReason "refusal"', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: null, refusal: 'I cannot help with that.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    }))
    const res = await callOpenAI({ deployment: 'stub-gpt', systemPrompt: 's', userPrompt: 'u', maxTokens: 100, budget: { noCap: true } })
    expect(res.stopReason).toBe('refusal')
    expect(res.raw).toBe('')
    expect(REFUSAL_STOP_REASONS.has(res.stopReason)).toBe(true)
  })

  it('finish_reason content_filter is in the refusal stop set', () => {
    expect(REFUSAL_STOP_REASONS.has('content_filter')).toBe(true)
  })

  it('parseWithRetry names a refusal (review item, no wasted retry) and counts it', async () => {
    let calls = 0
    const review: Array<{ kind: string }> = []
    const budget: Budget = {}
    const out = await parseWithRetry({
      call: async () => { calls++; return { raw: '', stopReason: 'refusal' } },
      parse: JSON.parse, review, stage: 'stage1', sheetName: 'FW', what: 'test',
      vote: { budget, site: 'stage1-classify', family: 'openai' },
    })
    expect(out).toBeNull()
    expect(calls).toBe(1)
    expect(review.some(r => r.kind === 'refused-model-output')).toBe(true)
    expect(budget.votes?.['stage1-classify']?.openai).toMatchObject({ attempted: 1, refused: 1, cast: 0 })
  })
})

describe('S06b: per-family participation counters make a degraded run measurable', () => {
  it('accumulates cast / truncated / empty / malformed (+retries) per site and family', async () => {
    const budget: Budget = {}
    const mk = (raw: string, stopReason: string) => async () => ({ raw, stopReason })

    // cast
    await parseWithRetry({ call: mk('{"ok":true}', 'stop'), parse: JSON.parse, review: [], stage: 's', sheetName: 'FW', what: 'w', vote: { budget, site: 'stage4-extract', family: 'openai' } })
    // truncated (no onTruncation)
    await parseWithRetry({ call: mk('{"x":', 'length'), parse: JSON.parse, review: [], stage: 's', sheetName: 'FW', what: 'w', vote: { budget, site: 'stage4-extract', family: 'openai' } })
    // empty raw (transport failure)
    await parseWithRetry({ call: async () => { throw new Error('net') }, parse: JSON.parse, review: [], stage: 's', sheetName: 'FW', what: 'w', vote: { budget, site: 'stage4-extract', family: 'openai' } })
    // malformed twice (burns the one retry, still malformed)
    const safeParse = (raw: string) => { try { return JSON.parse(raw) } catch { return null } }
    await parseWithRetry({ call: mk('not json', 'stop'), parse: safeParse, review: [], stage: 's', sheetName: 'FW', what: 'w', vote: { budget, site: 'stage4-extract', family: 'openai' } })
    // anthropic leg votes fine — families tallied independently
    await parseWithRetry({ call: mk('{"ok":true}', 'end_turn'), parse: JSON.parse, review: [], stage: 's', sheetName: 'FW', what: 'w', vote: { budget, site: 'stage4-extract', family: 'anthropic' } })

    const site = budget.votes?.['stage4-extract']
    expect(site?.openai).toMatchObject({ attempted: 4, cast: 1, truncated: 1, empty: 1, malformed: 1, retries: 1 })
    expect(site?.anthropic).toMatchObject({ attempted: 1, cast: 1 })
    // participation = cast/attempted: the degraded leg reads 0.25, the healthy leg 1.0
    expect((site!.openai.cast / site!.openai.attempted)).toBeLessThan(0.95)
    expect((site!.anthropic.cast / site!.anthropic.attempted)).toBe(1)
  })

  it('a malformed-then-recovered retry counts as cast, and the retry is counted', async () => {
    const budget: Budget = {}
    let calls = 0
    const safeParse = (raw: string) => { try { return JSON.parse(raw) } catch { return null } }
    const out = await parseWithRetry({
      call: async () => { calls++; return calls === 1 ? { raw: 'not json', stopReason: 'stop' } : { raw: '{"ok":1}', stopReason: 'stop' } },
      parse: safeParse, review: [], stage: 's', sheetName: 'FW', what: 'w',
      vote: { budget, site: 'stage1-classify', family: 'openai' },
    })
    expect(out).toEqual({ ok: 1 })
    expect(budget.votes?.['stage1-classify']?.openai).toMatchObject({ attempted: 1, cast: 1, retries: 1, malformed: 0 })
  })

  it('recordVote ignores unknown outcome classes instead of corrupting counters', () => {
    const budget: Budget = {}
    recordVote(budget, 'site', 'openai', 'cast')
    recordVote(budget, 'site', 'openai', 'nonsense')
    expect(budget.votes?.site?.openai).toMatchObject({ attempted: 2, cast: 1 })
  })
})

describe('S06c: the raised completion budgets are source-locked', () => {
  const root = resolve(__dirname, '..', '..')
  it('prefilter 1024 / classify 2048 (stage1-classify.js)', () => {
    const src = readFileSync(resolve(root, 'server/lib/import-brain/stage1-classify.js'), 'utf8')
    expect(src).toMatch(/PREFILTER_MAX_TOKENS = 1024/)
    expect(src).toMatch(/CLASSIFY_MAX_TOKENS {2}= 2048/)
    expect(src).not.toMatch(/maxTokens: 128[,\s]/)
  })
  it('both judges 2048 (stage4-extract.js)', () => {
    const src = readFileSync(resolve(root, 'server/lib/import-brain/stage4-extract.js'), 'utf8')
    expect(src).toMatch(/JUDGE_MAX_TOKENS = 2048/)
    expect(src).not.toMatch(/maxTokens: 400[,\s]/)
  })
})
