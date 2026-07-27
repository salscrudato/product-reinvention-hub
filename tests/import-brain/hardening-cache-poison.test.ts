/**
 * hardening-cache-poison.test.ts — regression lock for the extraction-cache
 * poisoning defect.
 *
 * Pre-fix, raws were cached BEFORE parse validation and WITHOUT their stop
 * reason. Three consequences, each locked here:
 *  (a) the one targeted retry re-invoked the cache-wrapped thunk, hit the
 *      cache, and replayed identical bad bytes — a structural no-op;
 *  (b) a cache HIT dropped the stop reason, so a replayed truncation skipped
 *      stage-4 batch halving on every warm run (certification re-runs are the
 *      runs most likely to hit a warm cache);
 *  (c) any non-empty raw was cacheable — including truncations and refusals.
 * PROMPT_VERSION is bumped once (stage4/v2) to orphan the poisoned v1
 * population, and the key gains an explicit content hash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
const cache = require('../../server/lib/import-brain/extract-cache.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseWithRetry } = require('../../server/lib/import-brain/constants.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractRows } = require('../../server/lib/import-brain/stage4-extract.js')

const { cachedCall, cacheKey, cachePut, contentHashOf, PROMPT_VERSION } = cache

beforeEach(() => { cache.__resetForTests() })

const safeParse = (raw: string) => { try { return JSON.parse(raw) } catch { return null } }

describe('cache-poison (a): the targeted retry issues a FRESH call, never a cache replay', () => {
  it('a cached malformed vote is bypassed by the retry, and the fresh good result overwrites it', async () => {
    const inputs = { deployment: 'stub-haiku', systemPrompt: 'S', userPrompt: 'window A', promptVersion: PROMPT_VERSION, contentHash: contentHashOf(['A']) }
    // Simulate the poisoned population: a malformed raw sitting under the exact key.
    await cachePut(cacheKey(inputs), 'testco', '{"entities":[ MALFORMED', { stopReason: 'end_turn' })

    let networkCalls = 0
    const budget: Record<string, number> = {}
    const thunk = (callOpts?: { bypassCache?: boolean }) => cachedCall({
      ...inputs, budget, tenantId: 'testco',
      validate: (raw: string) => safeParse(raw) != null,
      call: async () => { networkCalls++; return { raw: '{"ok":1}', stopReason: 'end_turn' } },
    }, callOpts)

    const parsed = await parseWithRetry({
      call: thunk, parse: safeParse, review: [], stage: 'stage4', sheetName: 'FW', what: 'test',
    })
    // First call() hit the poisoned entry (no network); the retry bypassed the
    // cache and reached the model exactly once — and recovered.
    expect(parsed).toEqual({ ok: 1 })
    expect(networkCalls).toBe(1)
    expect(budget.cacheHits).toBe(1)
    expect(budget.cacheBypasses).toBe(1)
    // The fresh good bytes replaced the poison: a later read hits the good raw.
    const again = await thunk()
    expect(again.cached).toBe(true)
    expect(again.raw).toBe('{"ok":1}')
    expect(networkCalls).toBe(1)
  })
})

describe('cache-poison (c): writes are gated on parse success AND a clean stop reason', () => {
  const mk = (raw: string, stopReason: string | null) => {
    let calls = 0
    const thunk = () => cachedCall({
      deployment: 'stub-haiku', systemPrompt: 'S', userPrompt: `w-${raw}-${stopReason}`,
      promptVersion: PROMPT_VERSION, contentHash: 'h', tenantId: 'testco',
      validate: (r: string) => safeParse(r) != null,
      call: async () => { calls++; return { raw, stopReason } },
    })
    return { thunk, calls: () => calls }
  }

  it('a truncated raw is never cached (second call goes to the model again)', async () => {
    const { thunk, calls } = mk('{"entities":[', 'max_tokens')
    await thunk(); await thunk()
    expect(calls()).toBe(2)
  })

  it('a refusal is never cacheable as a vote', async () => {
    const { thunk, calls } = mk('I cannot help with that.', 'refusal')
    await thunk(); await thunk()
    expect(calls()).toBe(2)
  })

  it('a malformed-but-clean-stop raw is never cached', async () => {
    const { thunk, calls } = mk('not json at all', 'end_turn')
    await thunk(); await thunk()
    expect(calls()).toBe(2)
  })

  it('a raw with NO stop reason is not affirmatively clean — not cached', async () => {
    const { thunk, calls } = mk('{"ok":1}', null)
    await thunk(); await thunk()
    expect(calls()).toBe(2)
  })

  it('a clean, parseable raw IS cached, and the hit carries the stop reason', async () => {
    const { thunk, calls } = mk('{"ok":1}', 'end_turn')
    const r1 = await thunk()
    const r2 = await thunk()
    expect(calls()).toBe(1)
    expect(r2.cached).toBe(true)
    expect(r2.stopReason).toBe('end_turn')
  })

  it('the key carries the explicit content hash and the bumped version', () => {
    expect(PROMPT_VERSION).toBe('stage4/v2')
    const base = { deployment: 'd', systemPrompt: 's', userPrompt: 'u', promptVersion: PROMPT_VERSION }
    expect(cacheKey({ ...base, contentHash: contentHashOf([['a']]) }))
      .not.toBe(cacheKey({ ...base, contentHash: contentHashOf([['b']]) }))
  })
})

describe('cache-poison (b): a truncated response still triggers batch halving on a WARM cache', () => {
  // Stub model: any prompt with MORE than 5 rows truncates (both families);
  // 5 or fewer returns one valid entity per row. Mirrors F10c, but run TWICE
  // against the same module-level cache to prove the warm-cache path.
  const entityFor = (rowIdx: number) => ({
    kind: 'coverage', sourceRowIndex: rowIdx, reviewFlag: false, needsRefIdSynthesis: false,
    fields: [
      { fieldName: 'refId', value: `GL.COV.${String(rowIdx).padStart(3, '0')}`, confidence: 0.9, citation: { sheet: 'FW', cell: `A${rowIdx + 2}`, verbatim: `GL.COV.${String(rowIdx).padStart(3, '0')}` } },
      { fieldName: 'name', value: `Coverage ${rowIdx}`, confidence: 0.9, citation: { sheet: 'FW', cell: `B${rowIdx + 2}`, verbatim: `Coverage ${rowIdx}` } },
    ],
  })
  let bigBatchCalls = 0
  let smallBatchCalls = 0
  const respond = (userPrompt: string, family: 'anthropic' | 'openai') => {
    const m = /Rows to extract \((\d+) rows\)/.exec(userPrompt)
    const n = m ? Number(m[1]) : 0
    const truncated = n > 5
    if (truncated) bigBatchCalls++; else smallBatchCalls++
    const rowIdxs = [...userPrompt.matchAll(/\(0-based (\d+)\)/g)].map(x => Number(x[1]))
    const body = truncated ? '{"entities":[{"kind":"cover' : JSON.stringify({ entities: rowIdxs.map(entityFor) })
    if (family === 'anthropic') {
      return { content: [{ type: 'text', text: body }], stop_reason: truncated ? 'max_tokens' : 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
    }
    return { choices: [{ message: { content: body, tool_calls: null }, finish_reason: truncated ? 'length' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
  }

  const runOnce = async () => {
    const N = 20
    const cells: (string | null)[][] = [['PRODUCT FRAMEWORK ID', 'COVERAGE']]
    for (let i = 0; i < N; i++) cells.push([`GL.COV.${String(i).padStart(3, '0')}`, `Coverage ${i}`])
    const fp = { sheetName: 'FW', layoutShape: 'SINGLE_TABLE', cells, dataRowCount: N, columnProfiles: [] }
    const classified = [{ sheetName: 'FW', domain: 'framework' }]
    const locks = [{ sheetName: 'FW', headerRowIndex: 0 }]
    const colMaps = [{ sheetName: 'FW', mappings: [
      { colIndex: 0, canonicalField: 'refId', entityKind: 'coverage', confidence: 0.6 },
      { colIndex: 1, canonicalField: 'name', entityKind: 'coverage', confidence: 0.6 },
    ], unmappedIndices: [] }]
    const review: Array<{ kind: string }> = []
    const entities = await extractRows(classified, locks, colMaps, new Map([['FW', fp]]), { noCap: true }, review, 'GL.LOB.001', undefined, { tenantId: 'testco' })
    return { entities, review }
  }

  it('run 1 halves and caches the good sub-batches; run 2 (warm) still halves and serves sub-batches from cache', async () => {
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const req = JSON.parse(init.body)
      if (String(url).includes('anthropic')) {
        const userPrompt = String(req.messages?.[0]?.content ?? '')
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(userPrompt, 'anthropic') }
      }
      const userPrompt = String(req.messages?.find((mm: { role: string }) => mm.role === 'user')?.content ?? '')
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(userPrompt, 'openai') }
    })

    const r1 = await runOnce()
    expect(r1.entities.length).toBe(20)
    expect(r1.review.some(r => r.kind === 'truncated-batch-split')).toBe(true)
    const smallAfterRun1 = smallBatchCalls
    expect(smallAfterRun1).toBeGreaterThan(0)

    // Run 2 — warm cache. The truncated big-batch raw was NEVER cached, so the
    // batch re-truncates live and halving fires again; the good sub-batch raws
    // WERE cached and are served without a single model call.
    const r2 = await runOnce()
    expect(r2.entities.length).toBe(20)
    expect(r2.review.some(r => r.kind === 'truncated-batch-split')).toBe(true)
    expect(r2.review.some(r => r.kind === 'dropped-batch')).toBe(false)
    expect(smallBatchCalls).toBe(smallAfterRun1)   // zero fresh sub-batch calls on the warm run
    expect(bigBatchCalls).toBeGreaterThanOrEqual(4) // the truncating batch hit the model in BOTH runs
  })
})
