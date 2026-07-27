/**
 * hardening-p0-2-ladder.test.ts — regression lock for ledger F02 + F03 (P0-2).
 *
 * F02: entity-kind disagreement between the two decorrelated extractors must enter
 *      the conflict ladder (reserved '__kind' conflict), never resolve silently.
 * F03: the grounding judge must see EVERY live candidate and be able to pick the
 *      4th ladder candidate (verdict 'd') — pre-fix it saw slice(0,3) and parsed
 *      verdicts through 'abc'.indexOf.
 *
 * Fails on the pre-fix sha (2b1f893): no '__kind' conflict was created (primary's
 * kind silently adopted), candidates were sliced to 3, and verdict 'd' resolved to
 * candidates[-1] → null.
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
const { reconcileEntities, resolveConflicts } = require('../../server/lib/import-brain/stage4-extract.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { STAGE4_JUDGE_SYSTEM } = require('../../server/lib/import-brain/prompts.js')

function rawEntity(row: number, kind: string, refId: string) {
  return {
    kind, sourceRowIndex: row, reviewFlag: false, needsRefIdSynthesis: false,
    fields: [
      { fieldName: 'refId', value: refId, confidence: 0.9, citation: { sheet: 'FW', cell: `A${row + 2}`, verbatim: refId } },
      { fieldName: 'name', value: 'Thing', confidence: 0.9, citation: { sheet: 'FW', cell: `B${row + 2}`, verbatim: 'Thing' } },
    ],
  }
}

beforeEach(() => {
  // Anthropic (ladder rungs) → unparseable-for-extraction text so the ladder adds no
  // candidates; OpenAI (judge) → verdict 'd' picking the 4th candidate. The judge is
  // a FORCED TOOL now, so the verdict rides tool_calls (as real responses do).
  const verdict = '{"verdict":"d","value":"D-VALUE","confidence":0.95,"rationale":"cell A2 grounds candidate d"}'
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    if (String(url).includes('anthropic')) {
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } }),
      }
    }
    const req = JSON.parse(init.body)
    const forced = req.tool_choice?.function?.name
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({
        choices: [{
          message: forced
            ? { content: null, tool_calls: [{ type: 'function', function: { name: forced, arguments: verdict } }] }
            : { content: verdict, tool_calls: null },
          finish_reason: forced ? 'tool_calls' : 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    }
  })
})

describe('P0-2: kind disagreement + full-candidate judge (ledger F02, F03)', () => {
  it('kind disagreement creates a __kind conflict instead of silent adoption', () => {
    const review: unknown[] = []
    const a = [rawEntity(3, 'coverage', 'GL.COV.001')]
    const b = [rawEntity(3, 'rule', 'GL.COV.001')]
    const { entities, conflicts } = reconcileEntities(a, b, 'FW', review)
    expect(conflicts.some((c: { fieldName: string }) => c.fieldName === '__kind')).toBe(true)
    expect(entities[0].reviewFlag).toBe(true)
    expect(review.some((r: unknown) => (r as { kind: string }).kind === 'kind-disagreement')).toBe(true)
  })

  it('judge receives every live candidate and verdict "d" resolves the 4th', async () => {
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
    const review: unknown[] = []
    await resolveConflicts({
      conflicts: [conflict], entities: [entity], fp: { sheetName: 'FW' },
      colMap: { mappings: [] }, headerRow: 0, rows: [['x', 'y', 'A-VALUE']], batchStart: 0,
      sheetName: 'FW', budget: { noCap: true }, review, deployJudge: 'stub-gpt',
    })
    expect((conflict as { resolved?: { value: string; method: string } }).resolved?.value).toBe('D-VALUE')
    expect(entity.fields[0].value).toBe('D-VALUE')
    expect((entity.fields[0] as { consensus?: string }).consensus).toBe('judge')
    // No consensus-failure — the 4th candidate was reachable. (Other telemetry,
    // e.g. malformed-model-output from the stubbed ladder rungs, is expected.)
    expect(review.filter((r: unknown) => (r as { kind: string }).kind === 'consensus-failure')).toHaveLength(0)
  })

  it('the judge prompt no longer hardcodes a 3-letter verdict set', () => {
    expect(STAGE4_JUDGE_SYSTEM).not.toMatch(/"a" \| "b" \| "c" \| "none"/)
  })

  it('__kind conflicts resolve onto the entity via ladder majority', async () => {
    const entity = {
      kind: 'coverage', sourceRowIndex: 5, occurrence: 0, reviewFlag: true, needsRefIdSynthesis: false,
      overallConfidence: 0.8, sourceSheet: 'FW',
      fields: [{ fieldName: 'refId', value: 'GL.RU.009', confidence: 0.9, citation: { sheet: 'FW', cell: 'A7', verbatim: 'GL.RU.009' } }],
    }
    const conflict = {
      rowIdx: 5, occurrence: 0, fieldName: '__kind',
      candidates: [
        { key: 'a', value: 'coverage', confidence: 0.6, citation: null, source: 'BULK' },
        { key: 'b', value: 'rule', confidence: 0.7, citation: null, source: 'BULK_ALT' },
        { key: 'c', value: 'rule', confidence: 0.8, citation: null, source: 'MID_REASONER' },
      ],
    }
    await resolveConflicts({
      conflicts: [conflict], entities: [entity], fp: { sheetName: 'FW' },
      colMap: { mappings: [] }, headerRow: 0, rows: [['GL.RU.009']], batchStart: 0,
      sheetName: 'FW', budget: { noCap: true }, review: [], deployJudge: 'stub-gpt',
    })
    // 'rule' has two votes → weighted majority resolves without the judge.
    expect(entity.kind).toBe('rule')
    expect((entity as { kindConsensus?: string }).kindConsensus).toBeTruthy()
  })
})
