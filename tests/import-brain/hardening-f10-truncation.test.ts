/**
 * hardening-f10-truncation.test.ts — regression lock for ledger F10.
 *
 * The API tells you when output was cut off (anthropic stop_reason
 * 'max_tokens' / openai finish_reason 'length'); pre-fix nothing in
 * import-brain read it, so a token-ceiling truncation degraded into a generic
 * parse failure: identical retry (re-truncates identically), same-prompt
 * ladder (same ceiling), then a dropped-batch — 20 rows silently absent.
 *
 * Locks three structurally different layers of the same defect (two-fixture
 * rule): (a) ai-call surfaces stopReason from BOTH response families;
 * (b) parseWithRetry treats truncation as a detectable condition — never the
 * wasted identical retry; (c) end-to-end, a truncating batch SPLITS in half
 * and re-extracts until every row lands — nothing dropped, split visible.
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
const { parseWithRetry, TRUNCATED_STOP_REASONS } = require('../../server/lib/import-brain/constants.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { callAnthropic, callOpenAI } = require('../../server/lib/import-brain/ai-call.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractRows } = require('../../server/lib/import-brain/stage4-extract.js')

describe('F10a: ai-call surfaces the stop reason from both response families', () => {
  it('anthropic stop_reason and openai finish_reason reach the caller', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('anthropic')) {
        return {
          ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ content: [{ type: 'text', text: '{"entities":[' }], stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 1 } }),
        }
      }
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ choices: [{ message: { content: '{"entities":[', tool_calls: null }, finish_reason: 'length' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      }
    })
    const a = await callAnthropic({ deployment: 'stub-a', systemPrompt: 's', userPrompt: 'u', maxTokens: 10, budget: { noCap: true } })
    expect(a.stopReason).toBe('max_tokens')
    const b = await callOpenAI({ deployment: 'stub-b', systemPrompt: 's', userPrompt: 'u', maxTokens: 10, budget: { noCap: true } })
    expect(b.stopReason).toBe('length')
    expect(TRUNCATED_STOP_REASONS.has(a.stopReason)).toBe(true)
    expect(TRUNCATED_STOP_REASONS.has(b.stopReason)).toBe(true)
  })
})

describe('F10b: parseWithRetry treats truncation as detectable, never an identical retry', () => {
  it('onTruncation short-circuits with NO retry', async () => {
    let calls = 0
    const review: unknown[] = []
    const SENTINEL = { truncated: true }
    const out = await parseWithRetry({
      call: async () => { calls++; return { raw: '{"entities":[', stopReason: 'max_tokens' } },
      parse: JSON.parse, review, stage: 'stage4', sheetName: 'FW', what: 'test',
      onTruncation: () => SENTINEL,
    })
    expect(out).toBe(SENTINEL)
    expect(calls).toBe(1)
    expect(review.some((r) => (r as { kind: string }).kind === 'malformed-model-output')).toBe(false)
  })

  it('without onTruncation: named telemetry + null, still no wasted retry', async () => {
    let calls = 0
    const review: unknown[] = []
    const out = await parseWithRetry({
      call: async () => { calls++; return { raw: '{"x":', stopReason: 'length' } },
      parse: JSON.parse, review, stage: 'stage3', sheetName: 'FW', what: 'test',
    })
    expect(out).toBeNull()
    expect(calls).toBe(1)
    expect(review.some((r) => (r as { kind: string }).kind === 'truncated-model-output')).toBe(true)
  })

  it('ordinary malformed output keeps the one targeted retry (P0-7 unchanged)', async () => {
    let calls = 0
    const out = await parseWithRetry({
      call: async () => { calls++; return { raw: 'not json', stopReason: 'end_turn' } },
      parse: (raw: string) => { try { return JSON.parse(raw) } catch { return null } },
      review: [], stage: 'stage4', sheetName: 'FW', what: 'test',
    })
    expect(out).toBeNull()
    expect(calls).toBe(2)
  })
})

describe('F10c: a truncating batch splits in half until every row extracts', () => {
  // Stub model: any prompt carrying MORE than 5 rows truncates (both families);
  // 5 or fewer returns one valid entity per row (indices parsed from the prompt).
  const entityFor = (rowIdx: number) => ({
    kind: 'coverage', sourceRowIndex: rowIdx, reviewFlag: false, needsRefIdSynthesis: false,
    fields: [
      { fieldName: 'refId', value: `GL.COV.${String(rowIdx).padStart(3, '0')}`, confidence: 0.9, citation: { sheet: 'FW', cell: `A${rowIdx + 2}`, verbatim: `GL.COV.${String(rowIdx).padStart(3, '0')}` } },
      { fieldName: 'name', value: `Coverage ${rowIdx}`, confidence: 0.9, citation: { sheet: 'FW', cell: `B${rowIdx + 2}`, verbatim: `Coverage ${rowIdx}` } },
    ],
  })
  const respond = (userPrompt: string, family: 'anthropic' | 'openai') => {
    const m = /Rows to extract \((\d+) rows\)/.exec(userPrompt)
    const n = m ? Number(m[1]) : 0
    const truncated = n > 5
    const rowIdxs = [...userPrompt.matchAll(/\(0-based (\d+)\)/g)].map(x => Number(x[1]))
    const body = truncated ? '{"entities":[{"kind":"cover' : JSON.stringify({ entities: rowIdxs.map(entityFor) })
    if (family === 'anthropic') {
      return { content: [{ type: 'text', text: body }], stop_reason: truncated ? 'max_tokens' : 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
    }
    return { choices: [{ message: { content: body, tool_calls: null }, finish_reason: truncated ? 'length' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const req = JSON.parse(init.body)
      if (String(url).includes('anthropic')) {
        const userPrompt = String(req.messages?.[0]?.content ?? '')
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(userPrompt, 'anthropic') }
      }
      const userPrompt = String(req.messages?.find((mm: { role: string }) => mm.role === 'user')?.content ?? '')
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(userPrompt, 'openai') }
    })
  })

  it('20 rows all extract via recursive halving; the split is visible, nothing dropped', async () => {
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
    const entities = await extractRows(classified, locks, colMaps, new Map([['FW', fp]]), { noCap: true }, review, 'GL.LOB.001')

    expect(entities.length).toBe(N)
    const refIds = new Set(entities.map((e: { fields: Array<{ fieldName: string; value: string }> }) => e.fields.find(f => f.fieldName === 'refId')?.value))
    for (let i = 0; i < N; i++) expect(refIds.has(`GL.COV.${String(i).padStart(3, '0')}`)).toBe(true)
    expect(review.some(r => r.kind === 'truncated-batch-split')).toBe(true)
    expect(review.some(r => r.kind === 'dropped-batch')).toBe(false)
  })
})
