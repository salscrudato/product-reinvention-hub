/**
 * hardening-unread-columns.test.ts — COMMIT 1 lock: mapped columns below the
 * deterministic read floor must never vanish.
 *
 * The deterministic fast path reads only columns at map confidence >= 0.80, while
 * a sheet QUALIFIES for that path at 60% confident columns — so up to 40% of a
 * qualifying sheet's mapped columns were read by nothing at all, with no review
 * item naming them. Stage 3 multiplies confidence by 0.7 on mapper disagreement,
 * so every DISPUTED column landed under the floor by construction.
 *
 * Locked here:
 *   (a) sub-threshold mapped columns are routed through the AI extraction path and
 *       their values are merged onto the code-extracted entities;
 *   (b) a sub-threshold column that has content and that nothing read becomes a
 *       named `unread-column` review item carrying the column and its confidence;
 *   (c) the per-run column-coverage ledger records the before (belowReadThreshold)
 *       and after (unread) counts;
 *   (d) an EMPTY column is never flagged (a manufactured finding is still noise).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

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
const { extractRows } = require('../../server/lib/import-brain/stage4-extract.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __resetForTests } = require('../../server/lib/import-brain/extract-cache.js')

type Cell = string | null
type Review = { kind: string; sheetName?: string; colIndex?: number; detail?: string }
type Coverage = {
  sheet: string; path: string; mappedColumns: number
  belowReadThreshold: number; recovered: number; unread: number; empty: number
}

const N = 4
const HEADER = [
  'COVERAGE ID', 'COVERAGE NAME', 'DESCRIPTION', 'DISPLAY NAME', 'NOTES',
  'REQUIREMENT', 'CLAIMS BASIS', 'ALWAYS EMPTY',
]

/** 5 confident columns + 3 disputed at 0.55 (the shape stage-3's x0.7 penalty
 *  produces), one of which is EMPTY in every row. 5/8 clears the 0.60
 *  qualification floor, so the sheet takes the deterministic path — and 3 of its
 *  8 mapped columns sit under the 0.80 read floor. */
function fixture() {
  const cells: Cell[][] = [HEADER]
  for (let i = 0; i < N; i++) {
    cells.push([
      `GL.COV.${String(i + 1).padStart(3, '0')}`,
      `Coverage ${i}`,
      `Description ${i}`,
      `Display ${i}`,
      `Note ${i}`,
      i % 2 === 0 ? 'MANDATORY' : 'OPTIONAL',
      'OCCURRENCE',
      null,                       // never populated — empty, not unread
    ])
  }
  const fp = {
    sheetName: 'FW', layoutShape: 'SINGLE_TABLE', cells, dataRowCount: N,
    columnProfiles: HEADER.map((h, c) => ({ colIndex: c, headerLabel: h, distinctSample: [], typeMix: {} })),
    definitions: [],
  }
  const colMaps = [{
    sheetName: 'FW',
    mappings: [
      { colIndex: 0, headerLabel: HEADER[0], canonicalField: 'refId',        entityKind: 'coverage', confidence: 0.95 },
      { colIndex: 1, headerLabel: HEADER[1], canonicalField: 'name',         entityKind: 'coverage', confidence: 0.95 },
      { colIndex: 2, headerLabel: HEADER[2], canonicalField: 'description',  entityKind: 'coverage', confidence: 0.95 },
      { colIndex: 3, headerLabel: HEADER[3], canonicalField: 'displayName',  entityKind: 'coverage', confidence: 0.95 },
      { colIndex: 4, headerLabel: HEADER[4], canonicalField: 'notes',        entityKind: 'coverage', confidence: 0.95 },
      { colIndex: 5, headerLabel: HEADER[5], canonicalField: 'requirement',  entityKind: 'coverage', confidence: 0.55 },
      { colIndex: 6, headerLabel: HEADER[6], canonicalField: 'claimsBasis',  entityKind: 'coverage', confidence: 0.55 },
      { colIndex: 7, headerLabel: HEADER[7], canonicalField: 'territory',    entityKind: 'coverage', confidence: 0.55 },
    ],
    unmappedIndices: [], stateColumns: [], allStatesColIndex: null,
  }]
  return { fp, colMaps }
}

/** The recovery pass STATES its narrowed map; the blind cross-check states none.
 *  `recoverable` is the set of canonical fields the stubbed models will answer for. */
function stubModels(recoverable: Set<string>, seenPrompts: string[]) {
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    const req = JSON.parse(init.body)
    const msgs = req.messages ?? []
    const userPrompt = String(msgs.find((m: { role: string }) => m.role === 'user')?.content ?? msgs[0]?.content ?? '')
    seenPrompts.push(userPrompt)

    let body = JSON.stringify({ entities: [] })
    // Only the map-stating extraction prompt gets answered; the blind cross-check
    // (no map supplied) stays empty so it cannot contaminate the assertion.
    if (!userPrompt.includes('Decide for yourself')) {
      const asked = [...recoverable].filter(f => userPrompt.includes(`.${f} (confidence`))
      const rowIdxs = [...userPrompt.matchAll(/0-based (\d+)\)/g)].map(m => Number(m[1]))
      if (asked.length > 0 && rowIdxs.length > 0) {
        body = JSON.stringify({
          entities: rowIdxs.map(r => ({
            sourceRowIndex: r, kind: 'coverage',
            fields: asked.map(f => ({
              fieldName: f, value: f === 'requirement' ? 'MANDATORY' : 'OCCURRENCE', confidence: 0.7,
              citation: { sheet: 'FW', cell: `D${r + 2}`, verbatim: 'MANDATORY' },
            })),
          })),
        })
      }
    }
    if (String(url).includes('anthropic')) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text: body }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) }
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: body, tool_calls: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) }
  })
}

async function run(recoverable: Set<string>) {
  __resetForTests()
  const { fp, colMaps } = fixture()
  const review: Review[] = []
  const columnCoverage: Coverage[] = []
  const seenPrompts: string[] = []
  stubModels(recoverable, seenPrompts)
  const entities = await extractRows(
    [{ sheetName: 'FW', domain: 'product-framework' }],
    [{ sheetName: 'FW', headerRowIndex: 0 }],
    colMaps, new Map([['FW', fp]]), { noCap: true }, review, 'GL.LOB.001',
    () => {}, { columnCoverage },
  )
  return { entities, review, columnCoverage, seenPrompts }
}

afterEach(() => { vi.unstubAllGlobals(); __resetForTests() })

describe('sub-threshold mapped columns are read, not skipped', () => {
  it('routes the below-floor columns through the AI path and merges what it reads', async () => {
    const { entities, review, columnCoverage } = await run(new Set(['requirement', 'claimsBasis']))

    expect(entities.length).toBe(N)                       // deterministic path still owns the rows
    for (const e of entities) {
      const names = e.fields.map((f: { fieldName: string }) => f.fieldName)
      expect(names).toContain('refId')                    // confident column — code read, byte-perfect
      expect(names).toContain('requirement')              // sub-threshold column — recovered, not dropped
      expect(names).toContain('claimsBasis')
      const rec = e.fields.find((f: { fieldName: string }) => f.fieldName === 'requirement')
      expect(rec.recoveredColumn).toBe(true)              // provenance stays honest
      expect(e.fields.find((f: { fieldName: string }) => f.fieldName === 'refId').deterministic).toBe(true)
    }

    const cov = columnCoverage[0]
    expect(cov.path).toBe('deterministic')
    expect(cov.mappedColumns).toBe(8)
    expect(cov.belowReadThreshold).toBe(3)                // the pre-fix "unread" number
    expect(cov.recovered).toBe(2)
    expect(cov.unread).toBe(0)                            // the post-fix number
    expect(cov.empty).toBe(1)                             // the never-populated column
    expect(review.filter(r => r.kind === 'unread-column')).toHaveLength(0)
  })

  it('a below-floor column with content that nothing reads is a NAMED review item', async () => {
    // Models answer for `requirement` only — `claimsBasis` has content and is read
    // by nobody. That is exactly the column that used to vanish silently.
    const { review, columnCoverage } = await run(new Set(['requirement']))

    const unread = review.filter(r => r.kind === 'unread-column')
    expect(unread).toHaveLength(1)
    expect(unread[0].sheetName).toBe('FW')
    expect(unread[0].colIndex).toBe(6)                    // column G
    expect(unread[0].detail).toContain('claimsBasis')
    expect(unread[0].detail).toContain('0.55')            // its confidence is named
    expect(unread[0].detail).toContain('CLAIMS BASIS')

    const cov = columnCoverage[0]
    expect(cov.belowReadThreshold).toBe(3)
    expect(cov.recovered).toBe(1)
    expect(cov.unread).toBe(1)
    expect(cov.empty).toBe(1)
  })

  it('the recovery pass asks ONLY for the below-floor columns', async () => {
    const { seenPrompts } = await run(new Set(['requirement', 'claimsBasis']))
    const mapPrompts = seenPrompts.filter(p => p.includes('Column map (col letter -> canonical field)'))
    expect(mapPrompts.length).toBeGreaterThan(0)
    for (const p of mapPrompts) {
      expect(p).toContain('coverage.requirement')
      expect(p).not.toContain('coverage.refId')          // the confident columns stay on the code path
      expect(p).not.toContain('coverage.name (')
    }
  })
})
