/**
 * hardening-s36-validator-armed.test.ts — regression lock for ledger S36.
 *
 * The stage-5 validator was asked to check GROUNDING but never given the source
 * cells: the prompt shipped each field's value + claimed verbatim only, so the
 * model could only compare the extractor's claim against itself. An internally
 * consistent mis-extraction — wrong value with a FABRICATED verbatim that
 * matches it — passed with zero discrepancies, while the authoritative grids
 * (fpByName) sat unused in the same function.
 *
 * Locks three layers:
 *  (a) buildValidatorPrompt resolves every citation against the grids and puts
 *      the ACTUAL cell content beside the claim, plus one source-row context
 *      line per entity (capped);
 *  (b) the synthetic wrong-value + fabricated-matching-verbatim fixture flows
 *      through validateEntities and is caught by the new
 *      cited-vs-actual-mismatch discrepancy kind (accepted, not filtered);
 *  (c) the LLM pass stays WARNING-only — the deterministic resolver remains
 *      the only thing that can block an entity.
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
const { validateEntities, buildValidatorPrompt } = require('../../server/lib/import-brain/stage5-validate.js')

// The synthetic fixture: the source cell B2 states 250000; the extractor claims
// value 500000 with a fabricated verbatim "500000" that matches its own value
// but not the cell. Verbatim-vs-value is perfectly consistent — only the ACTUAL
// cell content can expose it.
const GRID: (string | null)[][] = [
  ['PRODUCT FRAMEWORK ID', 'LIMIT', 'COVERAGE'],
  ['GL.COV.001', '250000', 'Wrongful Acts Coverage'],
]
const fp = { sheetName: 'FW', layoutShape: 'SINGLE_TABLE', cells: GRID, dataRowCount: 1, columnProfiles: [] }
const fpByName = new Map([['FW', fp]])

const misExtracted = () => [{
  kind: 'coverage', sourceSheet: 'FW', sourceRowIndex: 0, overallConfidence: 0.9,
  reviewFlag: false, needsRefIdSynthesis: false,
  fields: [
    { fieldName: 'refId', value: 'GL.COV.001', confidence: 0.95, citation: { sheet: 'FW', cell: 'A2', verbatim: 'GL.COV.001' } },
    { fieldName: 'limit', value: '500000', confidence: 0.9, citation: { sheet: 'FW', cell: 'B2', verbatim: '500000' } },
  ],
}]

describe('S36a: the prompt carries the actual cells', () => {
  it('resolves each citation and puts the ACTUAL cell content beside the claim, with one source-row context line', () => {
    const prompt = buildValidatorPrompt('FW', misExtracted(), 1, fpByName)
    // The fabricated claim and the authoritative truth sit side by side.
    expect(prompt).toContain('cited "500000" at FW!B2')
    expect(prompt).toContain('ACTUAL cell content: "250000"')
    // One row of context, capped, from the cited row.
    expect(prompt).toContain('SOURCE ROW (FW):')
    expect(prompt).toContain('B2="250000"')
    expect(prompt).toContain('C2="Wrongful Acts Coverage"')
  })

  it('a fingerprint without a grid degrades to the claim-only line (no crash, no fake ACTUAL)', () => {
    const noGrid = new Map([['FW', { sheetName: 'FW', columnProfiles: [] }]])
    const prompt = buildValidatorPrompt('FW', misExtracted(), 1, noGrid)
    expect(prompt).toContain('cited "500000" at FW!B2')
    expect(prompt).not.toContain('ACTUAL cell content:')
    expect(prompt).not.toContain('SOURCE ROW')
  })
})

describe('S36b: the fixture is caught by cited-vs-actual-mismatch end to end', () => {
  it('the new kind survives parse filtering, lands WARN-only, and flags the entity', async () => {
    let sawActualInPrompt = false
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const req = JSON.parse(init.body)
      const userPrompt = String(req.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '')
      // The validator model can only catch the fixture if the prompt carries the truth.
      sawActualInPrompt = userPrompt.includes('ACTUAL cell content: "250000"')
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                discrepancies: [{
                  kind: 'cited-vs-actual-mismatch', entityIndex: 0, fieldName: 'limit',
                  expected: '250000', found: '500000',
                  detail: 'Cited cell FW!B2 actually contains "250000"; the claimed verbatim "500000" matches the value, not the cell.',
                }],
                sourceRowsChecked: 1, entitiesValidated: 1,
              }),
              tool_calls: null,
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      }
    })

    const entities = misExtracted()
    const review: Array<{ kind: string }> = []
    const classified = [{ sheetName: 'FW', domain: 'product-framework' }]
    const discrepancies = await validateEntities(entities, classified, { noCap: true }, review, fpByName)

    expect(sawActualInPrompt).toBe(true)
    const hit = discrepancies.find((d: { kind: string }) => d.kind === 'cited-vs-actual-mismatch')
    expect(hit).toBeTruthy()
    expect(hit.severity).toBe('WARN')                    // (c) warning-only, never blocking
    expect(hit.expected).toBe('250000')
    expect(hit.found).toBe('500000')
    expect(entities[0].reviewFlag).toBe(true)            // surfaced for review
    expect(entities[0].blocked).toBeUndefined()          // the LLM pass cannot block
    expect(review.some(r => r.kind === 'validator-discrepancy')).toBe(true)
  })
})
