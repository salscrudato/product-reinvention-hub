// tests/import-brain/hardening-ce3-brain.test.ts — CE3 brain-rewire locks (Steps 1-4, 7).
//
// Two-fixture rule: each mechanism locks with its original red fixture plus one
// structurally different one. Zero model spend: fleet is mocked before any CJS
// require that reaches ai-call; nothing here opens a network socket.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

vi.mock('../../server/lib/fleet', () => ({
  guard: () => ({ allow: true, degrade: false, reason: 'ok' }),
  record: () => {},
  resolveModel: (role: string) => `stub-${role}`,
  anthropicMessagesUrl: () => 'http://stub.local/anthropic',
  openaiChatUrl: () => 'http://stub.local/openai',
  openaiResponsesUrl: () => 'http://stub.local/responses',
  anthropicHeaders: () => ({ 'Content-Type': 'application/json' }),
  openaiHeaders: () => ({ 'Content-Type': 'application/json' }),
  openaiChatBody: (model: string, messages: unknown[], maxTokens: number) => ({ model, messages, max_completion_tokens: maxTokens }),
  DEPLOY_GPT: 'stub-gpt', DEPLOY_GPT_MINI: 'stub-gpt-mini', DEPLOY_OPUS: 'stub-opus', DEPLOY_HAIKU: 'stub-haiku',
  isConfigured: () => false,
  estimateCostUsd: () => 0,
  IMPORT_CONTEXT: 'import-no-cap',
  ESCALATION_LADDER: ['BULK_VERIFY', 'MID_REASONER', 'GROUNDED_CITED'],
}))

/* eslint-disable @typescript-eslint/no-require-imports */
const { createRequire } = require('module') as typeof import('module')
const req = createRequire(__filename)

const REPO = path.resolve(__dirname, '../..')

// ─── 1. Hidden-sheet POLICY FLIP (Step 1) ───────────────────────────────────────
// Original red: hidden sheets were excluded from AI extraction wholesale.
// Fixture A (real, trimmed): SECURA Property with hidden "Forms View - MTG".
// Fixture B (synthetic): built in-test with ExcelJS, structurally different layout.

describe('CE3 Step 1: hidden sheets enter extraction with provenance', () => {
  it('trimmed SECURA: hidden Forms View - MTG rides the structural model, census and isoGrids', async () => {
    const { readWorkbookToStructural } = req('../../server/lib/import-brain/workbook.js')
    const buf = readFileSync(path.join(REPO, 'samples/hardening/workbooks/trimmed-secura-property-ce3.xlsx'))
    const { structural, hiddenSheets, isoGrids, census } = await readWorkbookToStructural(buf, 'secura-trim.xlsx', 'XLSX')
    expect(hiddenSheets).toContain('Forms View - MTG')
    // POLICY FLIP: the hidden sheet is IN the structural model (stages see it) …
    expect((structural.sheets as Array<{ sheetName: string }>).map(s => s.sheetName)).toContain('Forms View - MTG')
    // … carried on isoGrids with the hidden flag …
    const grid = (isoGrids as Array<{ sheet: string; hidden?: boolean }>).find(g => g.sheet === 'Forms View - MTG')
    expect(grid).toBeTruthy()
    expect(grid!.hidden).toBe(true)
    // … and censused as hidden with real substance.
    const cs = (census.sheets as Array<{ name: string; hidden: boolean; nonEmpty: number }>).find(s => s.name === 'Forms View - MTG')
    expect(cs).toBeTruthy()
    expect(cs!.hidden).toBe(true)
    expect(cs!.nonEmpty).toBeGreaterThan(100)
    // Visible-first order preserved (mapper input order is byte-stable).
    const names = (isoGrids as Array<{ sheet: string; hidden?: boolean }>).map(g => !!g.hidden)
    expect(names.slice(0, names.indexOf(true)).every(h => !h)).toBe(true)
  }, 60_000)

  it('mapper conservation extracts the hidden MTG forms (single-workbook gate fires on the trim)', async () => {
    const brainShared = req('../../server/lib/import-brain-shared.cjs')
    const { readWorkbookToStructural } = req('../../server/lib/import-brain/workbook.js')
    const buf = readFileSync(path.join(REPO, 'samples/hardening/workbooks/trimmed-secura-property-ce3.xlsx'))
    const { isoGrids } = await readWorkbookToStructural(buf, 'secura-trim.xlsx', 'XLSX')
    const plan = brainShared.mapIsoWorkbook(isoGrids)
    // Forms harvested from the hidden sheet: form-token entities exist and at least
    // one cites the hidden Forms View - MTG sheet byte-for-byte.
    const forms = plan.forms as Array<{ refId: string | null; data: Record<string, unknown> }>
    expect(forms.length).toBeGreaterThan(10)
    expect(forms.some(f => String(f.data.citation || '').startsWith('Forms View - MTG!'))).toBe(true)
  }, 60_000)

  it('stage 7 stamps hiddenSource on entities from hidden sheets (synthetic)', () => {
    const { buildImportPlan } = req('../../server/lib/import-brain/stage7-plan.js')
    const entity = (kind: string, sheet: string, name: string) => ({
      kind, sourceSheet: sheet, sourceRowIndex: 2, occurrence: 0, overallConfidence: 0.9,
      reviewFlag: false, needsRefIdSynthesis: false,
      fields: [
        { fieldName: 'refId', value: `GL.${kind.toUpperCase()}.001`, confidence: 0.9, citation: { sheet, cell: 'A2', verbatim: `GL.${kind.toUpperCase()}.001` } },
        { fieldName: 'name', value: name, confidence: 0.9, citation: { sheet, cell: 'B2', verbatim: name } },
      ],
    })
    const bundle = buildImportPlan(
      { entities: [entity('coverage', 'Hidden Sheet', 'Hidden Coverage'), entity('form', 'Visible Sheet', 'Visible Form')] },
      { hiddenSheets: ['Hidden Sheet'] },
    )
    const cov = bundle.plan.coverages[0]
    expect(cov.data.hiddenSource).toBe(true)
    expect(cov.data.needsReview).toBe(true)
    expect(cov.data.sourceSheet).toBe('Hidden Sheet')
    const form = bundle.plan.forms[0]
    expect(form.data.hiddenSource).toBeUndefined()
  })
})

// ─── 2. Near-dup cluster fold (Step 1) ─────────────────────────────────────────
// Original red: PCM Hacked/Main/OLD trio — copies extracted then silently duplicated.
// Fixture A: byte-identical copy folds. Fixture B: conflicting copy → review + unresolved.

describe('CE3 Step 1: dup-cluster fold — identical folds, conflict goes to review', () => {
  const mk = (sheet: string, name: string, extra: Record<string, unknown> = {}) => ({
    kind: 'coverage', sourceSheet: sheet, sourceRowIndex: 3, occurrence: 0, overallConfidence: 0.9,
    reviewFlag: false, needsRefIdSynthesis: false,
    fields: [
      { fieldName: 'refId', value: 'PH.COV.001', confidence: 0.9, citation: { sheet, cell: 'A3', verbatim: 'PH.COV.001' } },
      { fieldName: 'name', value: name, confidence: 0.9, citation: { sheet, cell: 'B3', verbatim: name } },
      ...Object.entries(extra).map(([k, v]) => ({ fieldName: k, value: v, confidence: 0.9, citation: { sheet, cell: 'C3', verbatim: String(v) } })),
    ],
  })
  const clusters = [{ basis: 'headerSig', sheets: [{ name: 'PCM Main' }, { name: 'PCM Copy' }] }]

  it('byte-identical facts across the cluster fold to one entity with a merged citation trail', () => {
    const { buildImportPlan } = req('../../server/lib/import-brain/stage7-plan.js')
    const bundle = buildImportPlan(
      { entities: [mk('PCM Main', 'Building'), mk('PCM Copy', 'Building')] },
      { sheetClusters: clusters },
    )
    expect(bundle.plan.coverages).toHaveLength(1)
    expect(Array.isArray(bundle.plan.coverages[0].data.clusterCitations)).toBe(true)
    expect(bundle.counts.accepted).toBe(bundle.plan.coverages.length + (bundle.plan.product ? 1 : 0))
  })

  it('a CONFLICTING copy stays review-flagged AND becomes an unresolved item with the cluster evidence', () => {
    const { buildImportPlan } = req('../../server/lib/import-brain/stage7-plan.js')
    const bundle = buildImportPlan(
      { entities: [mk('PCM Main', 'Building', { limit: '100k' }), mk('PCM Copy', 'Building', { limit: '250k' })] },
      { sheetClusters: clusters },
    )
    expect(bundle.plan.coverages).toHaveLength(2) // never a silent authority pick
    const conflicted = bundle.plan.coverages.find((c: { data: Record<string, unknown> }) => c.data.clusterConflict)
    expect(conflicted).toBeTruthy()
    expect(conflicted.data.needsReview).toBe(true)
    const item = bundle.unresolved.find((u: { reason?: string }) => /CONFLICTING copy/.test(String(u.reason)))
    expect(item).toBeTruthy()
    expect(String(item.reason)).toContain('PCM Main / PCM Copy')
  })
})

// ─── 3. Sweeper vocabulary enforcement (Step 4) — synthetic, code-level ─────────

describe('CE3 Step 4: sweeper can NEVER invent — vocabulary + citation enforced in code', () => {
  const { acceptAnswer, agreementOf, ALLOWED_NOISE } = req('../../server/lib/import-brain/stage45-sweeper.js')
  // ref -> that cell's verbatim. acceptAnswer now also holds a FACT's name against the cell
  // it cites (fidelity ledger #19), so the batch carries the text, not just the refs.
  const refs = new Map([['B2', 'Real'], ['C3', 'Other']])

  it('rejects a noise rule outside the allowed vocabulary', () => {
    expect(acceptAnswer({ ref: 'B2', kind: 'NOISE', rule: 'NOISE.MADE_UP' }, refs)).toBeNull()
    expect(acceptAnswer({ ref: 'B2', kind: 'NOISE', rule: 'NOISE.TOC' }, refs)).toEqual({ ref: 'B2', kind: 'NOISE', rule: 'NOISE.TOC' })
    expect(ALLOWED_NOISE.size).toBe(8)
  })

  it('rejects a FACT outside the asked batch or without a verbatim name (the invention-impossible line)', () => {
    // acceptAnswer() IS the only path from model answer to ledger FACT: an out-of-batch
    // ref (a cell the model was never asked about) and a nameless FACT both die here.
    expect(acceptAnswer({ ref: 'Z99', kind: 'FACT', entityKind: 'coverage', name: 'Invented' }, refs)).toBeNull()
    expect(acceptAnswer({ ref: 'B2', kind: 'FACT', entityKind: 'coverage', name: '' }, refs)).toBeNull()
    expect(acceptAnswer({ ref: 'B2', kind: 'FACT', entityKind: 'notAKind', name: 'x' }, refs)).toBeNull()
    // …and so does a name the CITED CELL does not contain (an expanded abbreviation).
    expect(acceptAnswer({ ref: 'B2', kind: 'FACT', entityKind: 'coverage', name: 'Really Invented' }, refs)).toBeNull()
    expect(acceptAnswer({ ref: 'B2', kind: 'FACT', entityKind: 'coverage', name: 'Real' }, refs)).toMatchObject({ kind: 'FACT' })
  })

  it('agreement semantics: kind+rule/entityKind must match; UNKNOWN agrees with UNKNOWN', () => {
    const noiseA = { ref: 'B2', kind: 'NOISE', rule: 'NOISE.TOC' }
    const noiseB = { ref: 'B2', kind: 'NOISE', rule: 'NOISE.LOG' }
    expect(agreementOf(noiseA, { ...noiseA })).toBeTruthy()
    expect(agreementOf(noiseA, noiseB)).toBeNull()
    expect(agreementOf({ ref: 'B2', kind: 'UNKNOWN' }, { ref: 'B2', kind: 'UNKNOWN' })).toBeTruthy()
    expect(agreementOf(noiseA, null)).toBeNull()
  })

  it('census_unaccounted items land in the plan unresolved queue (first-class contract)', () => {
    const { buildImportPlan } = req('../../server/lib/import-brain/stage7-plan.js')
    const bundle = buildImportPlan({
      entities: [],
      sweeper: {
        facts: [{ sheet: 'S', ref: 'S!B9', entityKind: 'coverage', name: 'Swept Coverage', verbatim: 'Swept Coverage' }],
        unresolvedItems: [{ sheet: 'S', label: '3 unaccounted cell(s) on "S"', refs: ['S!A1'], verbatimSample: ['S!A1="x"'], reason: 'sweeper could not classify', citation: 'S!A1' }],
      },
    }, {})
    const item = bundle.unresolved.find((u: { kind?: string }) => u.kind === 'census_unaccounted')
    expect(item).toBeTruthy()
    expect(item.sheet).toBe('S')
    expect(Array.isArray(item.refs)).toBe(true)
    // The sweeper FACT joined the plan review-flagged with refId null (no minted id).
    const swept = bundle.plan.coverages.find((c: { data: Record<string, unknown> }) => c.data.sweeperFact)
    expect(swept).toBeTruthy()
    expect(swept.refId).toBeNull()
    expect(swept.data.needsReview).toBe(true)
    expect(swept.data.citation).toBe('S!B9')
  })
})

// ─── 4. Extraction cache determinism (Step 3d) — synthetic ──────────────────────

describe('CE3 Step 3d: extraction cache — hit skips the call, key is content-exact', () => {
  beforeEach(() => {
    req('../../server/lib/import-brain/extract-cache.js').__resetForTests()
  })

  it('same (deployment, prompt) hits the cache; any content change misses', async () => {
    const { cachedCall, cacheKey } = req('../../server/lib/import-brain/extract-cache.js')
    let calls = 0
    const budget: Record<string, number> = {}
    const mk = (userPrompt: string) => cachedCall({
      deployment: 'stub-haiku', systemPrompt: 'S', userPrompt, promptVersion: 'stage4/v1',
      budget, tenantId: 'testco', call: async () => { calls++; return { raw: `out-${calls}` } },
    })
    const r1 = await mk('window A')
    const r2 = await mk('window A')
    expect(calls).toBe(1)
    expect(r2.raw).toBe(r1.raw)
    expect(r2.cached).toBe(true)
    expect(budget.cacheHits).toBe(1)
    expect(budget.cacheMisses).toBe(1)
    await mk('window A with one changed cell')
    expect(calls).toBe(2) // content change = different key
    const k1 = cacheKey({ deployment: 'd', systemPrompt: 's', userPrompt: 'u', promptVersion: 'v1' })
    const k2 = cacheKey({ deployment: 'd', systemPrompt: 's', userPrompt: 'u', promptVersion: 'v2' })
    expect(k1).not.toBe(k2) // prompt-version bump invalidates
  })
})

// ─── 5. Column continuation (Step 3a) — synthetic 200-col (second fixture is the
//        real-corpus absence: F-C4 proved no corpus sheet exceeds 128 real cols; the
//        F09 test file carries the primary lock, this one pins the stage-3 seam) ──

describe('CE3 Step 3a: continuation columnProfiles reach stage 3', () => {
  it('a 200-col grid yields profiles for every continuation column with header labels', () => {
    const { extendTruncatedGrids } = req('../../server/lib/import-brain/stage0-router.js')
    const wide = 200
    const raw: (string | null)[][] = []
    raw.push(Array.from({ length: wide }, (_, c) => `H${c}`))
    for (let r = 1; r <= 10; r++) raw.push(Array.from({ length: wide }, (_, c) => `v${r}.${c}`))
    const fp = {
      sheetName: 'W', layoutShape: 'GRID', cellsTruncated: true, bestHeaderRow: 0,
      dataRowCount: 11, dataColCount: wide,
      cells: raw.map(r => r.slice(0, 128)),
      columnProfiles: Array.from({ length: 128 }, (_, c) => ({ colIndex: c, headerLabel: `H${c}`, typeMix: { string: 10 }, distinctSample: [] })),
    }
    const warnings: unknown[] = []
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: 'W', file: 'w.xlsx', cells: raw }], 'w.xlsx', warnings)
    expect(fp.cells[0]!.length).toBe(wide)
    expect(fp.columnProfiles.length).toBe(wide)
    const p150 = fp.columnProfiles[150] as { headerLabel: string | null; continuation?: boolean; distinctSample: unknown[] }
    expect(p150.headerLabel).toBe('H150')
    expect(p150.continuation).toBe(true)
    expect(p150.distinctSample.length).toBeGreaterThan(0)
  })
})

// ─── 6. Stage-4 per-sheet resume (Step 7, in-process half; the SIGKILL child-
//        process half lives in hardening-ce3-killtest.test.ts) ──────────────────

describe('CE3 Step 7: checkpointed sheets are restored, not re-extracted', () => {
  it('a completed sheet short-circuits and onSheetComplete fires only for fresh sheets', async () => {
    const { extractRows } = req('../../server/lib/import-brain/stage4-extract.js')
    const fp = {
      sheetName: 'Done', layoutShape: 'GRID', bestHeaderRow: 0,
      cells: [['refId', 'name'], ['GL.COV.001', 'Building']],
      columnProfiles: [{ colIndex: 0, headerLabel: 'refId', typeMix: { string: 1 }, distinctSample: ['GL.COV.001'] }],
    }
    const classified = [{ sheetName: 'Done', domain: 'framework' }]
    const locks = [{ sheetName: 'Done', headerRowIndex: 0 }]
    const colMaps = [{ sheetName: 'Done', mappings: [{ colIndex: 0, canonicalField: 'refId', entityKind: 'coverage', confidence: 0.9 }], unmappedIndices: [] }]
    const cachedEntities = [[{ kind: 'coverage', sourceSheet: 'Done', sourceRowIndex: 0, occurrence: 0, overallConfidence: 0.95, reviewFlag: false, needsRefIdSynthesis: false, fields: [{ fieldName: 'refId', value: 'GL.COV.001', confidence: 0.95, citation: { sheet: 'Done', cell: 'A2', verbatim: 'GL.COV.001' } }] }]]
    const checkpointed: string[] = []
    const entities = await extractRows(
      classified, locks, colMaps, new Map([['Done', fp]]),
      { noCap: true }, [], undefined, undefined,
      {
        completedSheets: new Map([['Done', cachedEntities]]),
        onSheetComplete: (name: string) => { checkpointed.push(name) },
      },
    )
    expect(entities).toHaveLength(1)
    expect(entities[0].fields[0].value).toBe('GL.COV.001')
    expect(checkpointed).toHaveLength(0) // restored sheet is NOT re-checkpointed
  })
})

// ─── 7. Digest window tool bounds (Step 2) — code-enforced, synthetic ───────────

describe('CE3 Step 2: window-request tool is bounded in code', () => {
  it('serveWindow clamps to 40x40 and refuses unknown sheets', () => {
    const { serveWindow, WINDOW_DIM } = req('../../server/lib/import-brain/stage1-digest.js')
    const fp = { sheetName: 'Big', cells: Array.from({ length: 200 }, (_, r) => Array.from({ length: 200 }, (_, c) => `${r}.${c}`)) }
    const fpByName = new Map([['Big', fp]])
    const w = serveWindow(fpByName, { sheet: 'Big', r1: 0, r2: 199, c1: 0, c2: 199 })
    expect(w.rows.length).toBeLessThanOrEqual(WINDOW_DIM)
    expect(w.rows[0].length).toBeLessThanOrEqual(WINDOW_DIM)
    expect(serveWindow(fpByName, { sheet: 'Nope', r1: 0, r2: 1, c1: 0, c2: 1 }).error).toBeTruthy()
  })

  it('readerLoop serves at most WINDOW_REQUESTS windows per model then demands the final answer', async () => {
    const { readerLoop, WINDOW_REQUESTS } = req('../../server/lib/import-brain/stage1-digest.js')
    const fp = { sheetName: 'S', cells: [['a']] }
    let calls = 0
    const result = await readerLoop({
      label: 'test', digestPrompt: 'DIGEST', fpByName: new Map([['S', fp]]), review: [], budget: {},
      call: async (prompt: string) => {
        calls++
        if (calls === 1) return { raw: JSON.stringify({ windowRequests: Array.from({ length: 100 }, () => ({ sheet: 'S', r1: 0, r2: 0, c1: 0, c2: 0 })) }) }
        expect(prompt).toContain(`${WINDOW_REQUESTS}/${WINDOW_REQUESTS} used`)
        return { raw: JSON.stringify({ documentType: 'test', perSheet: [] }) }
      },
    })
    expect(result?.understanding.documentType).toBe('test')
    expect(result?.windowsServed).toBe(WINDOW_REQUESTS)
  })
})
