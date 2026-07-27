/**
 * hardening-participation-legs.test.ts — locks for the three silent legs the
 * FIRST participation-instrumented Core run exposed (commit-1 telemetry):
 *
 *  (a) stage4-crosscheck cast 0/10 on BOTH families — the blind map
 *      cross-check sampled a fixed 20 rows x EVERY column, so on 40+-column
 *      sheets every vote truncated at 8192 and the map verification was
 *      silently absent. Sample batches are now width-aware (CELL_BUDGET).
 *  (b) stage3-map anthropic cast 6/7 — an opus chunk answered with the mapping
 *      array wrapped in an object and both parse attempts rejected it.
 *      parseMappings now unwraps an object whose sole array value is the list;
 *      per-item shape validation is unchanged.
 *  (c) stage1-digest openai cast 0/1 — the digest reader was the one
 *      malformed-handling site with NO targeted retry (P0-7 applies
 *      everywhere else). One retry, named telemetry, raw head included.
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
const { widthAwareRowCount, extractRows } = require('../../server/lib/import-brain/stage4-extract.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mapColumns } = require('../../server/lib/import-brain/stage3-column-map.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readerLoop } = require('../../server/lib/import-brain/stage1-digest.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseWithRetry } = require('../../server/lib/import-brain/constants.js')

describe('(a) the blind cross-check sizes its samples by cells, not a fixed 20 rows', () => {
  it('widthAwareRowCount budgets 480 cells', () => {
    const wide = Array.from({ length: 20 }, () => Array.from({ length: 48 }, (_, c) => `v${c}`))
    expect(widthAwareRowCount(wide, 0, 1)).toBe(10)      // floor(480/48)
    const narrow = Array.from({ length: 20 }, () => ['a', 'b'])
    expect(widthAwareRowCount(narrow, 0, 1)).toBe(20)    // capped at BATCH_ROWS
    const huge = Array.from({ length: 20 }, () => Array.from({ length: 600 }, () => 'x'))
    expect(widthAwareRowCount(huge, 0, 1)).toBe(1)       // floor never below 1
  })

  it('a 48-column deterministic sheet cross-checks with <=10-row samples (was a fixed 20)', async () => {
    const COLS = 48
    const N = 30
    const header = Array.from({ length: COLS }, (_, c) => (c === 0 ? 'PRODUCT FRAMEWORK ID' : c === 1 ? 'COVERAGE' : `EXTRA ${c}`))
    const cells: (string | null)[][] = [header]
    for (let i = 0; i < N; i++) cells.push(Array.from({ length: COLS }, (_, c) => (c === 0 ? `GL.COV.${String(i).padStart(3, '0')}` : `v${i}-${c}`)))
    const fp = { sheetName: 'FW', layoutShape: 'SINGLE_TABLE', cells, dataRowCount: N, columnProfiles: [] }
    const colMaps = [{ sheetName: 'FW', mappings: [
      { colIndex: 0, canonicalField: 'refId', entityKind: 'coverage', confidence: 0.95 },
      { colIndex: 1, canonicalField: 'name', entityKind: 'coverage', confidence: 0.95 },
    ], unmappedIndices: [] }]

    const sampledRowCounts: number[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const req = JSON.parse(init.body)
      const userPrompt = String(req.messages?.[0]?.content ?? req.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '')
      const m = /Rows to extract \((\d+) rows\)/.exec(userPrompt)
      if (m) sampledRowCounts.push(Number(m[1]))
      const body = JSON.stringify({ entities: [] })
      if (String(_url).includes('anthropic')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text: body }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) }
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: body, tool_calls: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) }
    })

    const entities = await extractRows(
      [{ sheetName: 'FW', domain: 'framework' }],
      [{ sheetName: 'FW', headerRowIndex: 0 }],
      colMaps, new Map([['FW', fp]]), { noCap: true }, [], 'GL.LOB.001',
    )
    expect(entities.length).toBe(N)                     // deterministic path extracted everything
    expect(sampledRowCounts.length).toBeGreaterThan(0)  // the cross-check DID sample
    for (const n of sampledRowCounts) expect(n).toBeLessThanOrEqual(10)
  })
})

describe('(b) parseMappings unwraps an object-enveloped mapping array', () => {
  const mappingItem = {
    colIndex: 0, canonicalField: 'refId', entityKind: 'coverage', confidence: 0.95,
    citation: { sheet: 'FW', cell: 'A1', verbatim: 'PRODUCT FRAMEWORK ID' }, needsReview: false,
  }
  const fixture = () => ({
    classified: [{ sheetName: 'FW', domain: 'product-framework' }],
    locks: [{ sheetName: 'FW', headerRowIndex: 0 }],
    fpByName: new Map([['FW', {
      sheetName: 'FW', layoutShape: 'SINGLE_TABLE', dataRowCount: 2,
      columnProfiles: [{ colIndex: 0, headerLabel: 'PRODUCT FRAMEWORK ID', distinctSample: ['GL.COV.001'], typeMix: {} }],
      definitions: [],
    }]]),
  })

  const stubBoth = (body: string) => vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('anthropic')) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text: body }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) }
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: body, tool_calls: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) }
  })

  it('{"mappings":[...]} maps the column (was: whole chunk lost, retry included)', async () => {
    stubBoth(JSON.stringify({ mappings: [mappingItem] }))
    const { classified, locks, fpByName } = fixture()
    const maps = await mapColumns(classified, locks, fpByName, { noCap: true }, [])
    expect(maps[0].mappings.find((m: { colIndex: number }) => m.colIndex === 0)?.canonicalField).toBe('refId')
  })

  it('a bare array still parses (contract unchanged)', async () => {
    stubBoth(JSON.stringify([mappingItem]))
    const { classified, locks, fpByName } = fixture()
    const maps = await mapColumns(classified, locks, fpByName, { noCap: true }, [])
    expect(maps[0].mappings.find((m: { colIndex: number }) => m.colIndex === 0)?.canonicalField).toBe('refId')
  })

  it('an object with NO array value is still malformed', async () => {
    stubBoth(JSON.stringify({ note: 'no mappings here' }))
    const { classified, locks, fpByName } = fixture()
    const review: Array<{ kind: string }> = []
    const maps = await mapColumns(classified, locks, fpByName, { noCap: true }, review)
    expect(maps[0].mappings.find((m: { colIndex: number }) => m.colIndex === 0)?.canonicalField ?? null).toBeNull()
    expect(review.some(r => r.kind === 'malformed-model-output')).toBe(true)
  })
})

describe('(a2) round 2: character-budget sizing + halving, and recovered truncations are not missing votes', () => {
  it('a truncating cross-check sample halves until it fits; only unrecoverable truncation counts', async () => {
    // Long-content rows: cell-count sizing said "fits", characters say otherwise.
    const COLS = 12
    const LONG = 'Step 4: Multiply the base loss cost by the territory factor from RT.TERR.01 when eligibility rule R-406.C is satisfied. '.repeat(3)
    const N = 24
    const header = Array.from({ length: COLS }, (_, c) => (c === 0 ? 'PRODUCT FRAMEWORK ID' : c === 1 ? 'COVERAGE' : `RULE TEXT ${c}`))
    const cells: (string | null)[][] = [header]
    for (let i = 0; i < N; i++) cells.push(Array.from({ length: COLS }, (_, c) => (c === 0 ? `GL.COV.${String(i).padStart(3, '0')}` : LONG)))
    const fp = { sheetName: 'FW', layoutShape: 'SINGLE_TABLE', cells, dataRowCount: N, columnProfiles: [] }
    const colMaps = [{ sheetName: 'FW', mappings: [
      { colIndex: 0, canonicalField: 'refId', entityKind: 'coverage', confidence: 0.95 },
      { colIndex: 1, canonicalField: 'name', entityKind: 'coverage', confidence: 0.95 },
    ], unmappedIndices: [] }]

    // Stub: any sample with MORE than 1 row truncates; a 1-row sample casts.
    const respond = (userPrompt: string, family: 'anthropic' | 'openai') => {
      const m = /Rows to extract \((\d+) rows\)/.exec(userPrompt)
      const n = m ? Number(m[1]) : 0
      const truncated = n > 1
      const body = truncated ? '{"entities":[' : JSON.stringify({ entities: [] })
      if (family === 'anthropic') return { content: [{ type: 'text', text: body }], stop_reason: truncated ? 'max_tokens' : 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
      return { choices: [{ message: { content: body, tool_calls: null }, finish_reason: truncated ? 'length' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
    }
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const req = JSON.parse(init.body)
      if (String(url).includes('anthropic')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(String(req.messages?.[0]?.content ?? ''), 'anthropic') }
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(String(req.messages?.find((mm: { role: string }) => mm.role === 'user')?.content ?? ''), 'openai') }
    })

    const budget: { noCap: boolean; votes?: Record<string, Record<string, { attempted: number; cast: number; truncated: number }>> } = { noCap: true }
    const entities = await extractRows(
      [{ sheetName: 'FW', domain: 'framework' }], [{ sheetName: 'FW', headerRowIndex: 0 }],
      colMaps, new Map([['FW', fp]]), budget, [], 'GL.LOB.001',
    )
    expect(entities.length).toBe(N)
    const site = budget.votes?.['stage4-crosscheck']
    // Halving reached 1-row samples that cast; the recovered parent truncations
    // never counted, so participation is 1.0 on both families.
    expect(site?.anthropic.cast).toBeGreaterThan(0)
    expect(site?.anthropic.truncated).toBe(0)
    expect(site?.anthropic.cast).toBe(site?.anthropic.attempted)
    expect(site?.openai.truncated).toBe(0)
    expect(site?.openai.cast).toBe(site?.openai.attempted)
  })

  it('parseWithRetry: a truncation WITH a recovery strategy tallies nothing; without one it is a missing vote', async () => {
    const budget: { votes?: Record<string, Record<string, { attempted: number; truncated: number }>> } = {}
    const SENTINEL = { t: true }
    const out = await parseWithRetry({
      call: async () => ({ raw: '{"x":', stopReason: 'max_tokens' }),
      parse: JSON.parse, review: [], stage: 'stage4', sheetName: 'FW', what: 'w',
      onTruncation: () => SENTINEL,
      vote: { budget, site: 'stage4-extract', family: 'anthropic' },
    })
    expect(out).toBe(SENTINEL)
    expect(budget.votes?.['stage4-extract']).toBeUndefined()

    await parseWithRetry({
      call: async () => ({ raw: '{"x":', stopReason: 'max_tokens' }),
      parse: JSON.parse, review: [], stage: 'stage3', sheetName: 'FW', what: 'w',
      vote: { budget, site: 'stage3-map', family: 'anthropic' },
    })
    expect(budget.votes?.['stage3-map']?.anthropic).toMatchObject({ attempted: 1, truncated: 1 })
  })
})

describe('(c2) round 2: the digest reader survives a prose-wrapped reading', () => {
  it('narration before the JSON still parses (both families measured doing this)', async () => {
    const understanding = { documentType: 'workbook', perSheet: [], crossSheetLinks: [], citations: [] }
    const prose = `Looking at this digest, I have strong signal across sheets. Let me summarize.\n\n${JSON.stringify(understanding)}\n\nThat is my reading.`
    const budget: { votes?: Record<string, Record<string, { cast: number; retries: number }>> } = {}
    const out = await readerLoop({
      label: 'reader-A(test)', digestPrompt: 'DIGEST', fpByName: new Map(), review: [], budget,
      vote: { budget, site: 'stage1-digest', family: 'anthropic' },
      call: async () => ({ raw: prose, stopReason: 'end_turn' }),
    })
    expect(out?.understanding?.documentType).toBe('workbook')
    expect(budget.votes?.['stage1-digest']?.anthropic).toMatchObject({ cast: 1, retries: 0 })
  })

  it('braces inside string values do not truncate the armor scan', async () => {
    const understanding = { documentType: 'workbook {with braces}', perSheet: [], crossSheetLinks: [], citations: ['Sheet!A1 has "{q}" text'] }
    const out = await readerLoop({
      label: 'reader-A(test)', digestPrompt: 'DIGEST', fpByName: new Map(), review: [], budget: {},
      call: async () => ({ raw: `Preamble.\n${JSON.stringify(understanding)}`, stopReason: 'end_turn' }),
    })
    expect(out?.understanding?.citations?.[0]).toContain('"{q}"')
  })
})

describe('(c) the digest reader gets the house one-targeted-retry on malformed', () => {
  const understanding = { documentType: 'workbook', perSheet: [], crossSheetLinks: [], citations: [] }

  it('malformed then valid recovers, counts retry + cast, and names the raw head', async () => {
    let calls = 0
    const review: Array<{ kind: string; detail?: string }> = []
    const budget: { votes?: Record<string, Record<string, { cast: number; retries: number; malformed: number }>> } = {}
    const out = await readerLoop({
      label: 'reader-B(test)', digestPrompt: 'DIGEST', fpByName: new Map(), review, budget,
      vote: { budget, site: 'stage1-digest', family: 'openai' },
      call: async () => { calls++; return calls === 1 ? { raw: 'not json', stopReason: 'stop' } : { raw: JSON.stringify(understanding), stopReason: 'stop' } },
    })
    expect(out?.understanding?.documentType).toBe('workbook')
    expect(calls).toBe(2)
    expect(review.some(r => r.kind === 'digest-reader-malformed' && /Raw head: "not json"/.test(String(r.detail)))).toBe(true)
    expect(budget.votes?.['stage1-digest']?.openai).toMatchObject({ cast: 1, retries: 1, malformed: 0 })
  })

  it('malformed twice burns exactly one retry and lands as a malformed vote', async () => {
    let calls = 0
    const budget: { votes?: Record<string, Record<string, { cast: number; retries: number; malformed: number; attempted: number }>> } = {}
    const out = await readerLoop({
      label: 'reader-B(test)', digestPrompt: 'DIGEST', fpByName: new Map(), review: [], budget,
      vote: { budget, site: 'stage1-digest', family: 'openai' },
      call: async () => { calls++; return { raw: 'still not json', stopReason: 'stop' } },
    })
    expect(out).toBeNull()
    expect(calls).toBe(2)
    expect(budget.votes?.['stage1-digest']?.openai).toMatchObject({ attempted: 1, malformed: 1, retries: 1 })
  })

  it('truncation still never burns the retry', async () => {
    let calls = 0
    const budget: { votes?: Record<string, Record<string, { truncated: number }>> } = {}
    const out = await readerLoop({
      label: 'reader-A(test)', digestPrompt: 'DIGEST', fpByName: new Map(), review: [], budget,
      vote: { budget, site: 'stage1-digest', family: 'anthropic' },
      call: async () => { calls++; return { raw: '{"documentType":', stopReason: 'max_tokens' } },
    })
    expect(out).toBeNull()
    expect(calls).toBe(1)
    expect(budget.votes?.['stage1-digest']?.anthropic).toMatchObject({ truncated: 1 })
  })
})
