/**
 * hardening-f14-unknown.test.ts — regression lock for ledger F14 (Phase P gate).
 *
 * The policy-form extractor's tool schema FORCED requirement into
 * ['MANDATORY','OPTIONAL'] and premiumGenerating into a required boolean — a
 * policy contract that never states product-level mandatory status forced the
 * model to invent, and the sanitizers compounded it (absent requirement →
 * MANDATORY; absent premiumGenerating → true on the filing path, false on the
 * shared path). Every forced enum in a tool schema is an instruction to
 * fabricate when the document is silent — UNKNOWN must be representable.
 *
 * Two structurally different locks (two-fixture rule):
 *   1. the shared sanitizer (cleanCoverages) — not-stated survives as
 *      UNKNOWN / null, stated values pass through;
 *   2. the REAL filing pipeline end-to-end (runFilingPipeline with the real
 *      filing-shared reconciler, stubbed models) — a model abstention reaches
 *      the bundle's coverage entities, never a guessed boolean.
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
const { cleanCoverages } = require('../../shared/src/insurance/extraction.ts')

describe('F14a: cleanCoverages — not-stated is UNKNOWN/null, never a guess', () => {
  it('a coverage stating neither requirement nor premiumGenerating abstains', () => {
    const out = cleanCoverages({ coverages: [{ name: 'Liability', citation: 'Part A' }] }, 'Part A Liability')
    expect(out.items).toHaveLength(1)
    expect(out.items[0].requirement).toBe('UNKNOWN')
    expect(out.items[0].premiumGenerating).toBeNull()
  })

  it('explicitly stated values pass through', () => {
    const out = cleanCoverages({ coverages: [
      { name: 'A', citation: 'c', requirement: 'MANDATORY', premiumGenerating: true },
      { name: 'B', citation: 'c', requirement: 'optional', premiumGenerating: false },
      { name: 'C', citation: 'c', requirement: 'UNKNOWN', premiumGenerating: 'UNKNOWN' },
    ] }, 'x')
    expect(out.items.map(i => i.requirement)).toEqual(['MANDATORY', 'OPTIONAL', 'UNKNOWN'])
    expect(out.items.map(i => i.premiumGenerating)).toEqual([true, false, null])
  })

  it('an unrecognized requirement token is NOT evidence of MANDATORY', () => {
    const out = cleanCoverages({ coverages: [{ name: 'A', citation: 'c', requirement: 'SOMETIMES' }] }, 'x')
    expect(out.items[0].requirement).toBe('UNKNOWN')
  })

  it('string YES/NO premium markers map to booleans', () => {
    const out = cleanCoverages({ coverages: [
      { name: 'A', citation: 'c', premiumGenerating: 'YES' },
      { name: 'B', citation: 'c', premiumGenerating: 'NO' },
    ] }, 'x')
    expect(out.items.map(i => i.premiumGenerating)).toEqual([true, false])
  })
})

describe('F14b: the real filing pipeline never guesses certainty', () => {
  it('a model abstention (UNKNOWN) survives to the bundle coverage entities', async () => {
    vi.stubGlobal('fetch', async (_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts?.body ?? '{}')
      const toolName = body?.tool_choice?.name ?? ''
      if (toolName === 'classify_filing_document') {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'tool_use', input: { role: 'policyForm', cue: 'insuring agreement', confidence: 0.9 } }], usage: { input_tokens: 1, output_tokens: 1 } }) }
      }
      if (toolName === 'propose_coverages') {
        // The document grants coverage but states neither mandatory status nor
        // premium treatment — the model abstains.
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'tool_use', input: { coverages: [{ name: 'Liability To Others', requirement: 'UNKNOWN', premiumGenerating: 'UNKNOWN', formNumbers: [], confidence: 0.85, citation: 'Insuring Agreement, Part A' }] } }], usage: { input_tokens: 1, output_tokens: 1 } }) }
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'tool_use', input: {} }], usage: { input_tokens: 1, output_tokens: 1 } }) }
    })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runFilingPipeline } = require('../../server/lib/import-brain/stage-filing.js')
    const { bundle } = await runFilingPipeline({
      documents: [{ name: 'auto-base-form.pdf', text: 'PERSONAL AUTO POLICY. Insuring Agreement, Part A — Liability To Others. We will pay damages...' }],
      productNameHint: 'Personal Auto Policy',
      filingStateHint: 'WA',
      budget: { noCap: true },
      extractPdfText: () => null,
      emit: () => {},
    })
    const covs = bundle.plan.coverages
    expect(covs.length).toBeGreaterThan(0)
    const liab = covs.find((c: { data: { name: string } }) => /liability to others/i.test(String(c.data.name)))!
    expect(liab).toBeTruthy()
    // Never a guessed boolean: the document did not state these.
    expect(liab.data.requirement).toBe('UNKNOWN')
    expect(liab.data.premiumGenerating).toBeNull()
  })
})
