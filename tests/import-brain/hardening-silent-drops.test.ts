/**
 * hardening-silent-drops.test.ts — COMMIT 2 locks: the three paths where data or
 * a failure left the pipeline with nothing to show for it.
 *
 *  (1) PREFILTER VETO. Two 1024-token bulk voters agreeing "non-content" classified
 *      a whole sheet `ignore` at confidence 1.0 with NO review item, and ignored
 *      sheets were excluded from the stage-4.5 conservation sweep as well — the
 *      pipeline's only fully silent whole-sheet drop, gated by its two most
 *      starved models. Now: a `prefilter-skip` breadcrumb naming both voters and
 *      both reasons, and the sheet stays in sweep scope.
 *  (2) BLIND MAP CROSS-CHECK. Every leg swallowed its errors, so two dead voters
 *      left `checkedRows` at 0 and the indictment loop could not fire: "verified
 *      clean" and "the checker was dead" were the same observable. Now: one retry,
 *      then a `map-unverified` item. And the comparison joins by COLUMN CITATION,
 *      so wrong column→field reassignment — the actual wrong-map signature — is
 *      detectable at all.
 *  (3) CONSERVATION FACTS. Stage 4 posted a FACT to whatever cell a model cited,
 *      unverified: a mis-citation marked an innocent cell accounted AND hid the
 *      truly-consumed cell from the sweeper. Now the cited cell is checked against
 *      the grid by containment before posting; a mismatch is a `miscited-field`
 *      review item and NO post.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../server/lib/fleet', () => ({
  guard:                () => ({ allow: true, degrade: false, reason: 'ok' }),
  record:               () => {},
  resolveModel:         (role: string) => `stub-${role}`,
  anthropicMessagesUrl: () => 'http://stub/anthropic',
  openaiChatUrl:        () => 'http://stub/openai',
  openaiResponsesUrl:   () => 'http://stub/responses',
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

/* eslint-disable @typescript-eslint/no-require-imports */
const { classifySheets } = require('../../server/lib/import-brain/stage1-classify.js')
const { sampleVerifyMap, verifyCitedCell, extractRows } = require('../../server/lib/import-brain/stage4-extract.js')
const { runAdaptiveImportBrain } = require('../../server/lib/import-brain/index.js')
const { __resetForTests } = require('../../server/lib/import-brain/extract-cache.js')

type Review = { kind: string; sheetName?: string; colIndex?: number; fieldPath?: string; detail?: string }
type Ev = { t: string; key?: string; value?: unknown }

/** One stub for both families. `answer` maps a request body to the JSON payload;
 *  the payload is returned as text AND as a forced-tool argument, so a caller that
 *  asked for either shape gets it. */
function stubFleet(answer: (body: string) => unknown) {
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    const text = JSON.stringify(answer(init.body))
    if (String(url).includes('anthropic')) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({
        content: [{ type: 'text', text }, { type: 'tool_use', input: JSON.parse(text) }],
        stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      }) }
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({
      choices: [{ message: { content: text, tool_calls: [{ function: { arguments: text } }] }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }) }
  })
}

afterEach(() => { vi.unstubAllGlobals(); __resetForTests() })

// ─── (1) the prefilter veto ────────────────────────────────────────────────────

const sheetFp = (sheetName: string, cells: (string | null)[][]) => ({
  sheetName, layoutShape: 'SINGLE_TABLE', cells,
  dataRowCount: cells.length - 1, dataColCount: cells[0].length,
  isDefinitionsSheet: false, definitions: [],
  columnProfiles: cells[0].map((h, c) => ({
    colIndex: c, headerLabel: String(h ?? ''), distinctSample: cells.slice(1).map(r => r[c]), typeMix: { string: 1 },
  })),
})

const REVISION = sheetFp('Revision History', [['DATE', 'NOTE'], ['2026-01-01', 'v1'], ['2026-02-01', 'v2']])
const FRAMEWORK = sheetFp('FW', [['COVERAGE ID', 'COVERAGE NAME'], ['GL.COV.001', 'Premises'], ['GL.COV.002', 'Products']])

/** Vetoes "Revision History", passes everything else. One payload carries both the
 *  prefilter and the classify shapes so no prompt sniffing is needed. */
const classifyAnswers = (body: string) => {
  const vetoed = body.includes('Sheet name: \\"Revision History\\"') || body.includes('Sheet name: "Revision History"')
  return vetoed
    ? { prefilter: true, reason: 'revision log, no product content', domain: 'ignore', confidence: 1, rationale: 'revision log' }
    : { prefilter: false, reason: 'carries coverage ids', domain: 'product-framework', confidence: 0.9, rationale: 'COVERAGE ID column' }
}

describe('(1) the prefilter veto leaves a breadcrumb and stays in sweep scope', () => {
  it('emits prefilter-skip naming BOTH voters and their reasons', async () => {
    stubFleet(classifyAnswers)
    const review: Review[] = []
    const out = await classifySheets([REVISION, FRAMEWORK], { noCap: true }, review)

    const skipped = out.find((c: { sheetName: string }) => c.sheetName === 'Revision History')
    expect(skipped.domain).toBe('ignore')
    expect(skipped.prefilterSkipped).toBe(true)
    expect(skipped.prefilterReasons).toEqual({ anthropic: 'revision log, no product content', openai: 'revision log, no product content' })

    const item = review.find(r => r.kind === 'prefilter-skip')
    expect(item).toBeTruthy()
    expect(item!.sheetName).toBe('Revision History')
    expect(item!.detail).toContain('BULK/anthropic')
    expect(item!.detail).toContain('BULK_ALT/openai')
    expect(item!.detail).toContain('revision log, no product content')
    // The content sheet is untouched — this is a veto breadcrumb, not a blanket flag.
    expect(review.filter(r => r.kind === 'prefilter-skip')).toHaveLength(1)
  })

  it('a reasoner-agreed ignore also leaves a breadcrumb (no route to `ignore` is silent)', async () => {
    stubFleet(() => ({ prefilter: false, reason: 'unsure', domain: 'ignore', confidence: 0.9, rationale: 'chrome sheet, no entities' }))
    const review: Review[] = []
    const out = await classifySheets([FRAMEWORK], { noCap: true }, review)
    expect(out[0].domain).toBe('ignore')
    expect(out[0].prefilterSkipped).toBeUndefined()
    const item = review.find(r => r.kind === 'sheet-ignored')
    expect(item).toBeTruthy()
    expect(item!.detail).toContain('chrome sheet, no entities')
  })

  it('the vetoed sheet still reaches the conservation sweep (its cells get a disposition)', async () => {
    stubFleet(classifyAnswers)
    const census = (name: string, cells: (string | null)[][]) => {
      const out: { ref: string; row: number; col: number; verbatim: string; merged: null }[] = []
      cells.forEach((row, r) => row.forEach((v, c) => {
        if (v === null || v === '') return
        out.push({ ref: `${name}!${String.fromCharCode(65 + c)}${r + 1}`, row: r, col: c, verbatim: String(v), merged: null })
      }))
      return { name, nonEmpty: out.length, cells: out, tables: [] }
    }
    const events: Ev[] = []
    await runAdaptiveImportBrain({
      structural: { sourceName: 'wb.xlsx', sourceType: 'XLSX', sheets: [REVISION, FRAMEWORK] },
      censuses: [{ sheets: [census('Revision History', REVISION.cells), census('FW', FRAMEWORK.cells)] }],
      budget: { noCap: true },
      emit: (ev: Ev) => events.push(ev),
    })

    const swept = events.filter(e => e.key === 'brain:sweeper').map(e => (e.value as { sheet: string }).sheet)
    expect(swept).toContain('Revision History')   // was: excluded, so its cells vanished entirely
    expect(swept).toContain('FW')
  }, 60_000)
})

// ─── (2) the blind map cross-check ─────────────────────────────────────────────

const CROSS_FP = sheetFp('FW', [
  ['COVERAGE ID', 'COVERAGE NAME', 'REQUIREMENT'],
  ['GL.COV.001', 'Premises', 'MANDATORY'],
  ['GL.COV.002', 'Products', 'OPTIONAL'],
])
const CROSS_MAP = {
  sheetName: 'FW',
  mappings: [
    { colIndex: 0, headerLabel: 'COVERAGE ID',   canonicalField: 'refId',       entityKind: 'coverage', confidence: 0.95 },
    { colIndex: 1, headerLabel: 'COVERAGE NAME', canonicalField: 'name',        entityKind: 'coverage', confidence: 0.95 },
    { colIndex: 2, headerLabel: 'REQUIREMENT',   canonicalField: 'requirement', entityKind: 'coverage', confidence: 0.95 },
  ],
  unmappedIndices: [], stateColumns: [], allStatesColIndex: null,
}
const detOf = () => [0, 1].map(i => ({
  kind: 'coverage', sourceSheet: 'FW', sourceRowIndex: i, reviewFlag: false, overallConfidence: 0.95,
  fields: [
    { fieldName: 'refId',       value: CROSS_FP.cells[i + 1][0], confidence: 0.95, deterministic: true, citation: { sheet: 'FW', cell: `A${i + 2}`, verbatim: String(CROSS_FP.cells[i + 1][0]) } },
    { fieldName: 'name',        value: CROSS_FP.cells[i + 1][1], confidence: 0.95, deterministic: true, citation: { sheet: 'FW', cell: `B${i + 2}`, verbatim: String(CROSS_FP.cells[i + 1][1]) } },
    { fieldName: 'requirement', value: CROSS_FP.cells[i + 1][2], confidence: 0.95, deterministic: true, citation: { sheet: 'FW', cell: `C${i + 2}`, verbatim: String(CROSS_FP.cells[i + 1][2]) } },
  ],
}))

const runCross = async (review: Review[]) => {
  const detEntities = detOf()
  await sampleVerifyMap({
    fp: CROSS_FP, colMap: CROSS_MAP, headerRow: 0,
    rows: CROSS_FP.cells.slice(1), gridRows: [1, 2], detEntities,
    deployBulk: 'stub-haiku', deployGptMini: 'stub-gpt-mini', budget: { noCap: true }, review,
  })
  return detEntities
}

describe('(2) a dead cross-checker is not a clean check', () => {
  it('both voters dead → map-unverified after one retry (was: indistinguishable from verified)', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; throw new Error('upstream down') })
    const review: Review[] = []
    await runCross(review)

    const item = review.find(r => r.kind === 'map-unverified')
    expect(item).toBeTruthy()
    expect(item!.sheetName).toBe('FW')
    expect(item!.detail).toContain('ZERO usable row-reads')
    expect(review.some(r => r.kind === 'map-suspect')).toBe(false)
    expect(calls).toBeGreaterThan(2)              // the retry really re-called both legs
  }, 60_000)

  it('reads that carry no resolvable source cell are also unverified, not clean', async () => {
    stubFleet(() => ({ entities: [0, 1].map(r => ({
      sourceRowIndex: r, kind: 'coverage',
      fields: [{ fieldName: 'name', value: 'Premises', confidence: 0.9, citation: { sheet: 'FW', cell: '', verbatim: 'Premises' } }],
    })) }))
    const review: Review[] = []
    await runCross(review)
    const item = review.find(r => r.kind === 'map-unverified')
    expect(item).toBeTruthy()
    expect(item!.detail).toContain('none of its field reads carried a resolvable source cell')
  })

  it('WRONG COLUMN REASSIGNMENT is caught — the signature a fieldName join cannot see', async () => {
    // The blind reader, given no map, reads column C as `claimsBasis`. The map says
    // column C is `requirement`. Under the old fieldName join this produced NOTHING:
    // `claimsBasis` is absent from the deterministic entity, so the comparison was
    // skipped and the mis-map passed clean.
    stubFleet(() => ({ entities: [0, 1].map(r => ({
      sourceRowIndex: r, kind: 'coverage',
      fields: [
        { fieldName: 'refId',       value: `GL.COV.00${r + 1}`, confidence: 0.9, citation: { sheet: 'FW', cell: `A${r + 2}`, verbatim: 'GL.COV' } },
        { fieldName: 'claimsBasis', value: r === 0 ? 'MANDATORY' : 'OPTIONAL', confidence: 0.9, citation: { sheet: 'FW', cell: `C${r + 2}`, verbatim: 'x' } },
      ],
    })) }))
    const review: Review[] = []
    const detEntities = await runCross(review)

    const suspect = review.filter(r => r.kind === 'map-suspect')
    expect(suspect).toHaveLength(1)
    expect(suspect[0].colIndex).toBe(2)                       // column C, named
    expect(suspect[0].fieldPath).toBe('requirement')
    expect(suspect[0].detail).toContain('read column C as "claimsBasis"')
    expect(suspect[0].detail).toContain('where the map says "requirement"')
    // The indicted column's deterministic fields are downgraded and flagged.
    for (const e of detEntities) {
      expect(e.reviewFlag).toBe(true)
      expect(e.fields.find((f: { fieldName: string }) => f.fieldName === 'requirement').confidence).toBeLessThanOrEqual(0.6)
      expect(e.fields.find((f: { fieldName: string }) => f.fieldName === 'refId').confidence).toBe(0.95)
    }
  })

  it('an agreeing blind read indicts nothing', async () => {
    stubFleet(() => ({ entities: [0, 1].map(r => ({
      sourceRowIndex: r, kind: 'coverage',
      fields: [{ fieldName: 'requirement', value: r === 0 ? 'MANDATORY' : 'OPTIONAL', confidence: 0.9, citation: { sheet: 'FW', cell: `C${r + 2}`, verbatim: 'x' } }],
    })) }))
    const review: Review[] = []
    await runCross(review)
    expect(review.filter(r => r.kind === 'map-suspect')).toHaveLength(0)
    expect(review.filter(r => r.kind === 'map-unverified')).toHaveLength(0)
  })
})

// ─── (3) conservation FACTs are verified before posting ────────────────────────

describe('(3) the ledger is written from verified citations, never claims', () => {
  const fpByName = new Map([['FW', CROSS_FP]])

  it('verifyCitedCell: containment passes, contradiction fails, derived/absent abstain', () => {
    const ok = verifyCitedCell({ sheet: 'FW', cell: 'B2', verbatim: 'Premises' }, 'Premises', fpByName)
    expect(ok.ok).toBe(true)
    // A multi-value cell legitimately CONTAINS the extracted id.
    expect(verifyCitedCell({ sheet: 'FW', cell: 'A2', verbatim: 'GL.COV.001' }, 'GL.COV', fpByName).ok).toBe(true)
    // The cell says something else entirely.
    const bad = verifyCitedCell({ sheet: 'FW', cell: 'B2', verbatim: 'Additional Insured' }, 'Additional Insured', fpByName)
    expect(bad.ok).toBe(false)
    expect(bad.actual).toBe('Premises')
    // Importer-derived and unresolvable-grid cases abstain (absence of evidence is
    // not evidence of mis-citation).
    expect(verifyCitedCell({ sheet: 'FW', cell: 'B2', verbatim: '(synthesized)' }, 'SYNTH-1', fpByName).ok).toBe(true)
    expect(verifyCitedCell({ sheet: 'Other', cell: 'B2', verbatim: 'x' }, 'x', fpByName).ok).toBe(true)
    // A pointer off the end of the grid is a mis-citation, not an abstention.
    expect(verifyCitedCell({ sheet: 'FW', cell: 'B99', verbatim: 'x' }, 'x', fpByName).ok).toBe(false)
  })

  it('a mis-cited field is refused the FACT post and becomes a review item', async () => {
    // BULK/BULK_ALT agree on a value cited to B2 — a cell that says "Premises".
    stubFleet(() => ({ entities: [{
      sourceRowIndex: 0, kind: 'coverage',
      fields: [
        { fieldName: 'refId', value: 'GL.COV.001', confidence: 0.9, citation: { sheet: 'FW', cell: 'A2', verbatim: 'GL.COV.001' } },
        { fieldName: 'name',  value: 'Additional Insured Coverage', confidence: 0.9, citation: { sheet: 'FW', cell: 'B2', verbatim: 'Additional Insured Coverage' } },
      ],
    }] }))

    // A REAL ledger, so the assertion is on cell dispositions, not on a spy.
    const brainShared = require('../../server/lib/import-brain-shared.cjs')
    const cells: { ref: string; row: number; col: number; verbatim: string; merged: null }[] = []
    CROSS_FP.cells.forEach((row, r) => row.forEach((v, c) => {
      if (v === null || v === '') return
      cells.push({ ref: `FW!${String.fromCharCode(65 + c)}${r + 1}`, row: r, col: c, verbatim: String(v), merged: null })
    }))
    const acc = brainShared.createAccounting({ name: 'FW', nonEmpty: cells.length, cells })

    const review: Review[] = []
    // A LOW-confidence map keeps this off the deterministic fast path, so the
    // MODEL's citations (not code-built ones) are what reach the ledger.
    const aiMap = { ...CROSS_MAP, mappings: CROSS_MAP.mappings.map(m => ({ ...m, confidence: 0.5 })) }
    await extractRows(
      [{ sheetName: 'FW', domain: 'product-framework' }],
      [{ sheetName: 'FW', headerRowIndex: 0 }],
      [aiMap], fpByName, { noCap: true }, review, 'GL.LOB.001',
      () => {}, { accounting: new Map([['FW', acc]]) },
    )

    const item = review.find(r => r.kind === 'miscited-field')
    expect(item).toBeTruthy()
    expect(item!.fieldPath).toBe('name')
    expect(item!.detail).toContain('that cell reads "Premises"')
    expect(item!.detail).toContain('NOT posted to the conservation ledger')
    // The verified citation posted a FACT; the mis-citation left its cell in the
    // UNACCOUNTED residue, where the sweeper will see it — which is the whole point:
    // a mis-citation used to mark this innocent cell accounted.
    expect(acc.entries.get('FW!A2').disposition).toBe('FACT')
    expect(acc.entries.get('FW!B2').disposition).toBe('UNACCOUNTED')
  })
})
