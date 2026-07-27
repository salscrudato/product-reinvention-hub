/**
 * hardening-forced-verdicts.test.ts — regression lock for the schema-forced
 * verdict path (commit 4 of the model-call-path wave).
 *
 * Judge verdicts were parsed by first-character arithmetic
 * (charCodeAt(0) - 97), so a verdict reading "candidate b" silently selected
 * candidate c whenever three or more candidates existed — on the conflict
 * resolution path, the one place confidence can only ratchet upward. Nothing
 * validated membership.
 *
 * Locks:
 *  (a) a VERBOSE verdict ("candidate b") is REJECTED — it burns the single
 *      targeted retry and falls through to the next lineage — never mis-mapped
 *      to candidates[2];
 *  (b) when every lineage stays verbose, the conflict lands in review flagged,
 *      resolved by NOTHING;
 *  (c) classify runs on the forced tool and still validates domain membership
 *      — an off-enum domain from a misbehaving provider is a malformed vote,
 *      not a classification.
 */
import { describe, it, expect, vi } from 'vitest'

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
const { resolveConflicts } = require('../../server/lib/import-brain/stage4-extract.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classifySheets } = require('../../server/lib/import-brain/stage1-classify.js')

const openaiToolResponse = (args: string) => ({
  ok: true, status: 200, headers: { get: () => null },
  json: async () => ({
    choices: [{ message: { content: null, tool_calls: [{ type: 'function', function: { name: 'judge_verdict', arguments: args } }] }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }),
})
const anthropicUnusable = {
  ok: true, status: 200, headers: { get: () => null },
  json: async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
}

const fourWayConflict = () => {
  const entity = {
    kind: 'coverage', sourceRowIndex: 0, occurrence: 0, reviewFlag: false, needsRefIdSynthesis: false,
    overallConfidence: 0.7, sourceSheet: 'FW',
    fields: [{ fieldName: 'limit', value: 'A-VALUE', confidence: 0.7, conflicted: true, citation: { sheet: 'FW', cell: 'C2', verbatim: 'A-VALUE' } }],
  }
  const conflict = {
    rowIdx: 0, occurrence: 0, fieldName: 'limit',
    candidates: [
      { key: 'a', value: 'A-VALUE', confidence: 0.7, citation: null, source: 'BULK' },
      { key: 'b', value: 'B-VALUE', confidence: 0.7, citation: null, source: 'BULK_ALT' },
      { key: 'c', value: 'C-VALUE', confidence: 0.7, citation: null, source: 'MID_REASONER' },
      { key: 'd', value: 'D-VALUE', confidence: 0.7, citation: null, source: 'GROUNDED_CITED' },
    ],
  }
  return { entity, conflict }
}

const runConflict = async (conflict: unknown, entity: unknown, review: unknown[], budget: Record<string, unknown> = { noCap: true }) =>
  resolveConflicts({
    conflicts: [conflict], entities: [entity], fp: { sheetName: 'FW' },
    colMap: { mappings: [] }, headerRow: 0, rows: [['x', 'y', 'A-VALUE']], gridRows: null, batchStart: 0,
    sheetName: 'FW', budget, review, deployJudge: 'stub-gpt',
  })

describe('(a) a verbose verdict is rejected, never mis-mapped', () => {
  it('"candidate b" from the primary judge burns the retry and falls to the tail — which resolves the REAL b', async () => {
    let primaryCalls = 0
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      if (String(url).includes('anthropic')) return anthropicUnusable
      const req = JSON.parse(init.body)
      if (req.model === 'stub-gpt') {
        primaryCalls++
        // The exact pre-fix poison: a verbose verdict whose first character
        // ('c') used to silently select candidates[2].
        return openaiToolResponse('{"verdict":"candidate b","confidence":0.9,"rationale":"verbose"}')
      }
      return openaiToolResponse('{"verdict":"b","value":"B-VALUE","confidence":0.9,"rationale":"cell grounds b"}')
    })

    const { entity, conflict } = fourWayConflict()
    const review: Array<{ kind: string }> = []
    await runConflict(conflict, entity, review)

    const resolved = (conflict as { resolved?: { value: string; method: string } }).resolved
    expect(resolved?.value).toBe('B-VALUE')            // the REAL candidate b
    expect(resolved?.value).not.toBe('C-VALUE')        // never the charCodeAt mis-map
    expect(resolved?.method).toBe('judge-deepseek')    // primary lineage fell through
    expect(primaryCalls).toBe(2)                       // original + the single burnt retry
    expect(review.some(r => r.kind === 'malformed-model-output')).toBe(true)
  })

  it('every lineage verbose → resolved by NOTHING, flagged for review', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('anthropic')) return anthropicUnusable
      return openaiToolResponse('{"verdict":"candidate b","confidence":0.9,"rationale":"verbose"}')
    })

    const { entity, conflict } = fourWayConflict()
    const review: Array<{ kind: string }> = []
    await runConflict(conflict, entity, review)

    expect((conflict as { resolved?: unknown }).resolved).toBeUndefined()
    expect((entity as { reviewFlag: boolean }).reviewFlag).toBe(true)
    expect((entity as { fields: Array<{ confidence: number }> }).fields[0].confidence).toBeLessThanOrEqual(0.5)
    expect(review.some(r => r.kind === 'consensus-failure')).toBe(true)
  })
})

describe('(c) classify rides the forced tool and still validates membership', () => {
  it('an off-enum domain from the tool is a malformed vote; the valid leg wins alone', async () => {
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const req = JSON.parse(init.body)
      if (String(url).includes('anthropic')) {
        if (req.tool_choice?.name === 'classify_sheet') {
          // A provider that ignored the enum: off-vocabulary domain.
          return {
            ok: true, status: 200, headers: { get: () => null },
            json: async () => ({ content: [{ type: 'tool_use', input: { domain: 'not-a-domain', confidence: 0.9, rationale: 'bad' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }),
          }
        }
        // prefilter (plain JSON): not skippable
        return {
          ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ content: [{ type: 'text', text: '{"prefilter":false,"reason":"content"}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
        }
      }
      if (req.tool_choice?.function?.name === 'classify_sheet') {
        return {
          ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ type: 'function', function: { name: 'classify_sheet', arguments: '{"domain":"rules","confidence":0.9,"rationale":"RULE CONDITION column"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        }
      }
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ choices: [{ message: { content: '{"prefilter":false,"reason":"content"}', tool_calls: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      }
    })

    const budget: { votes?: Record<string, Record<string, { cast: number; malformed: number }>> } = { }
    const review: Array<{ kind: string }> = []
    const out = await classifySheets(
      [{ sheetName: 'FW', layoutShape: 'SINGLE_TABLE', dataRowCount: 3, dataColCount: 2, columnProfiles: [] }],
      budget, review,
    )
    expect(out[0].domain).toBe('rules')                 // the valid single leg wins
    expect(out[0].confidence).toBeCloseTo(0.9 * 0.8, 5) // at the single-vote penalty
    expect(budget.votes?.['stage1-classify']?.anthropic).toMatchObject({ malformed: 1, cast: 0 })
    expect(budget.votes?.['stage1-classify']?.openai).toMatchObject({ cast: 1 })
  })
})
