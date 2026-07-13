/**
 * brain-routing.test.ts
 *
 * Structural tests verifying that all 6 stage modules export the expected symbols
 * and that the orchestrator (index.js) and filing pipeline (stage-filing.js) wire
 * them correctly. Does NOT make live AI calls -- fleet and all stage AI calls are
 * stubbed via vi.mock. Exercises all 6 stage call sites in sequence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Stub fleet module before requiring CJS modules ──────────────────────────
vi.mock('../../server/lib/fleet', () => ({
  guard:                 () => ({ allow: true, degrade: false, reason: 'ok' }),
  record:                () => {},
  resolveModel:          (role: string) => `stub-${role}`,
  anthropicMessagesUrl:  () => 'http://stub/anthropic',
  openaiChatUrl:         () => 'http://stub/openai',
  anthropicHeaders:      () => ({ 'Content-Type': 'application/json' }),
  openaiHeaders:         () => ({ 'Content-Type': 'application/json' }),
  openaiChatBody:        (model: string, msgs: unknown[], maxTokens: number) => ({ model, messages: msgs, max_completion_tokens: maxTokens }),
  DEPLOY_GPT:            'stub-gpt',
  DEPLOY_GPT_MINI:       'stub-gpt-mini',
  DEPLOY_OPUS:           'stub-opus',
  DEPLOY_HAIKU:          'stub-haiku',
  isConfigured:          () => false,
  estimateCostUsd:       () => 0,
  IMPORT_CONTEXT:        'import-no-cap',
  ESCALATION_LADDER:     ['BULK_VERIFY', 'MID_REASONER', 'GROUNDED_CITED'],
}))

// Stub the shared CJS bundle (import-brain-shared.cjs)
vi.mock('../../server/lib/import-brain-shared.cjs', () => ({
  scoreHeaderCandidates: () => [],
  pickBestHeaderRow:     () => null,
  CANONICAL_MAP:         {},
  SURFACED_COLUMNS:      [],
}))

// Stub the filing shared bundle (filing-shared.cjs)
vi.mock('../../server/lib/filing-shared.cjs', () => ({
  sanitizeClassification: (name: string, input: Record<string, unknown>) => ({ name, role: input?.role ?? 'other', cue: String(input?.cue ?? ''), confidence: Number(input?.confidence ?? 0) }),
  sanitizeRateOrder:      (input: Record<string, unknown>) => ({ variables: Array.isArray(input?.variables) ? input.variables : [] }),
  sanitizeManual:         (input: Record<string, unknown>) => ({ rules: Array.isArray(input?.rules) ? input.rules : [] }),
  reconcileFiling:        () => ({ plan: { productId: 'FIL.NJ.PROD', product: {}, coverages: [], forms: [], rules: [], formRules: [], ratingProgram: null, ldTables: [], rtTables: [] }, counts: { proposed: 0, accepted: 0, unresolved: 0 }, review: {}, unresolved: [] }),
}))

// ─── Stub global fetch to return stub AI responses ────────────────────────────

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string, opts: { body: string }) => {
    const body = JSON.parse(opts?.body ?? '{}')

    // Anthropic-style response (stage 1 classify, stage 2 header, stage 3/4/5)
    const toolName = body?.tool_choice?.name ?? ''

    if (toolName === 'classify_filing_document') {
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'tool_use', input: { role: 'manual', cue: 'numbered rules', confidence: 0.9 } }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      }
    }
    if (toolName === 'propose_rate_order') {
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'tool_use', input: { variables: [{ name: 'Base Loss Cost', op: 'ADD', stage: 'BASE_LOSS_COST', confidence: 0.9, citation: 'Rule 10', forms: ['CG 00 01'] }] } }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      }
    }
    if (toolName === 'propose_manual_rules') {
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'tool_use', input: { rules: [{ ruleNumber: '100', title: 'Class Code Factors', confidence: 0.9, citation: 'Rule 100' }] } }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      }
    }
    if (toolName === 'propose_coverages') {
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'tool_use', input: { coverages: [{ name: 'BIPA', requirement: 'MANDATORY', premiumGenerating: true, confidence: 0.9, citation: 'Section I' }] } }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      }
    }
    // Generic Anthropic JSON response (prefilter, classify, header, map, extract, validate)
    if (String(url).includes('/anthropic')) {
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"domain":"coverages","confidence":0.9,"rationale":"stub"}' }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      }
    }
    // OpenAI-style response
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"domain":"ignore","confidence":0.9,"rationale":"stub"}', tool_calls: null } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    }
  })
})

// ─── Module symbol checks ─────────────────────────────────────────────────────

describe('brain stage module exports', () => {
  it('stage1 exports classifySheets', async () => {
    const m = await import('../../server/lib/import-brain/stage1-classify.js')
    expect(typeof (m as unknown as Record<string, unknown>).classifySheets).toBe('function')
  })

  it('stage2 exports lockHeaders', async () => {
    const m = await import('../../server/lib/import-brain/stage2-header-lock.js')
    expect(typeof (m as unknown as Record<string, unknown>).lockHeaders).toBe('function')
  })

  it('stage3 exports mapColumns', async () => {
    const m = await import('../../server/lib/import-brain/stage3-column-map.js')
    expect(typeof (m as unknown as Record<string, unknown>).mapColumns).toBe('function')
  })

  it('stage4 exports extractRows', async () => {
    const m = await import('../../server/lib/import-brain/stage4-extract.js')
    expect(typeof (m as unknown as Record<string, unknown>).extractRows).toBe('function')
  })

  it('stage5 exports validateEntities', async () => {
    const m = await import('../../server/lib/import-brain/stage5-validate.js')
    expect(typeof (m as unknown as Record<string, unknown>).validateEntities).toBe('function')
  })

  it('stage6 exports reconcileOutput', async () => {
    const m = await import('../../server/lib/import-brain/stage6-reconcile.js')
    expect(typeof (m as unknown as Record<string, unknown>).reconcileOutput).toBe('function')
  })

  it('orchestrator exports runAdaptiveImportBrain', async () => {
    const m = await import('../../server/lib/import-brain/index.js')
    expect(typeof (m as unknown as Record<string, unknown>).runAdaptiveImportBrain).toBe('function')
  })

  it('stage-filing exports runFilingPipeline', async () => {
    const m = await import('../../server/lib/import-brain/stage-filing.js')
    expect(typeof (m as unknown as Record<string, unknown>).runFilingPipeline).toBe('function')
  })
})

// ─── Orchestrator smoke: all 6 stages called in sequence ─────────────────────

describe('runAdaptiveImportBrain', () => {
  it('runs all 6 stages and returns entities + summaryCounts', async () => {
    const { runAdaptiveImportBrain } = await import('../../server/lib/import-brain/index.js') as unknown as { runAdaptiveImportBrain: (opts: unknown) => Promise<unknown> }
    const workbook = (await import('./fixtures/workbook-structural-model.json', { assert: { type: 'json' } })).default

    const events: unknown[] = []
    const result = await runAdaptiveImportBrain({
      structural: workbook,
      lobRefIdHint: 'GL.LOB.001',
      emit: (ev: unknown) => events.push(ev),
    }) as Record<string, unknown>

    // All 6 stage tool events emitted
    const toolNames = (events as Array<Record<string, string>>)
      .filter(e => e.t === 'tool')
      .map(e => e.name)
    expect(toolNames.some(n => n.startsWith('brain:stage1'))).toBe(true)
    expect(toolNames.some(n => n.startsWith('brain:stage2'))).toBe(true)
    expect(toolNames.some(n => n.startsWith('brain:stage3'))).toBe(true)
    expect(toolNames.some(n => n.startsWith('brain:stage4'))).toBe(true)
    expect(toolNames.some(n => n.startsWith('brain:stage5'))).toBe(true)
    expect(toolNames.some(n => n.startsWith('brain:stage6'))).toBe(true)

    // Output shape: summaryCounts must be present
    expect(result).toHaveProperty('summaryCounts')
    expect(result).toHaveProperty('entities')
    expect(result).toHaveProperty('classifiedSheets')

    // Definitions sheet was auto-accepted (domain='definitions')
    const classified = result.classifiedSheets as Array<Record<string, string>>
    const defSheet = classified.find(s => s.sheetName === 'Definitions')
    expect(defSheet?.domain).toBe('definitions')
  })
})

// ─── Filing pipeline smoke: CLASSIFY + RATE_ORDER + MANUAL + RECONCILE ───────

describe('runFilingPipeline', () => {
  it('runs CLASSIFY/RATE_ORDER/MANUAL stages and returns bundle + extraction', async () => {
    const { runFilingPipeline } = await import('../../server/lib/import-brain/stage-filing.js') as unknown as { runFilingPipeline: (opts: unknown) => Promise<unknown> }
    const fixture = (await import('./fixtures/filing-docs.json', { assert: { type: 'json' } })).default

    const events: unknown[] = []
    const result = await runFilingPipeline({
      documents:       fixture.documents,
      productNameHint: fixture.productName,
      filingStateHint: fixture.filingState,
      extractPdfText:  () => null,
      emit:            (ev: unknown) => events.push(ev),
    }) as Record<string, unknown>

    // All stage tool events emitted
    const toolNames = (events as Array<Record<string, string>>)
      .filter(e => e.t === 'tool')
      .map(e => e.name)
    expect(toolNames).toContain('filing:classify')
    expect(toolNames.some(n => n.startsWith('filing:extract'))).toBe(true)
    expect(toolNames).toContain('filing:reconcile')

    // Bundle and extraction present
    expect(result).toHaveProperty('bundle')
    expect(result).toHaveProperty('extraction')
    expect((result.extraction as Record<string, unknown>)).toHaveProperty('classifications')
    expect((result.extraction as Record<string, unknown>)).toHaveProperty('rateOrder')
    expect((result.extraction as Record<string, unknown>)).toHaveProperty('manual')
  })
})
