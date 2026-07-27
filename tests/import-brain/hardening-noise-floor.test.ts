/**
 * hardening-noise-floor.test.ts — COMMIT 3 locks: the three fixed costs charged
 * against reviewer attention on every single import.
 *
 *  (1) DIGEST vs CLASSIFY. The two stages read in different vocabularies by
 *      design ({framework, rating, tables, …} vs {product-framework, rating-roc,
 *      rate-tables, …}) and the orchestrator compared them with `!==` — so every
 *      CORRECTLY-read framework, rating and rate-table sheet produced a spurious
 *      `digest-classify-disagreement`, in every import. A crosswalk maps the
 *      readings that mean the same thing; a genuine disagreement still fires.
 *  (2) THE SENTINEL THESE BOOKS ACTUALLY USE. `<Intentionally Blank>` (1,154
 *      cells across the two sample workbooks) was absent from the read-time null
 *      list, which carried a differently-worded guess. Those cells burned
 *      extraction tokens, sweep-cap slots and review attention forever. Added,
 *      plus a general bracketed-placeholder rule so the list cannot miss the next
 *      wording — and the exclusion is COUNTED, not assumed.
 *  (3) THE ROUTING ASSIST. Its guard was `!hint || documents > 0`, and the
 *      right-hand side is true for every upload, so the model call fired even
 *      when deterministic LOB inference had already succeeded.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import ExcelJS from 'exceljs'

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
const { runAdaptiveImportBrain } = require('../../server/lib/import-brain/index.js')
const { routeArtifacts } = require('../../server/lib/import-brain/stage0-router.js')
const { readWorkbookToStructural } = require('../../server/lib/import-brain/workbook.js')
const brainShared = require('../../server/lib/import-brain-shared.cjs')

type Review = { kind: string; sheetName?: string; detail?: string }

const quietFetch = () => vi.stubGlobal('fetch', async (url: string) => {
  const text = '[]'
  if (String(url).includes('anthropic')) {
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} }) }
  }
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: {} }) }
})

afterEach(() => { vi.unstubAllGlobals() })

// ─── (1) the digest/classify crosswalk ─────────────────────────────────────────

/** Drives the orchestrator with the digest reading and the stage-1 classification
 *  both injected via the resume seam, so the crosswalk is the only thing under
 *  test — no model decides anything here. */
async function reviewFor(pairs: [string, string, string][]) {
  quietFetch()
  const sheets = pairs.map(([sheet]) => sheet)
  const out = await runAdaptiveImportBrain({
    structural: { sourceName: 'wb.xlsx', sourceType: 'XLSX', sheets: [] },
    censuses: [{ sheets: sheets.map(name => ({ name, nonEmpty: 0, cells: [], tables: [] })) }],
    budget: { noCap: true },
    resume: {
      digest: { understanding: { perSheet: pairs.map(([sheet, digestDomain]) => ({ sheet, domain: digestDomain })) } },
      stage1: { classifiedSheets: pairs.map(([sheetName, , domain]) => ({ sheetName, domain, confidence: 0.9, rationale: 'r' })) },
      stage2: { headerLocks: [] },
      stage3: { columnMaps: [] },
    },
  })
  return out.reviewQueue as Review[]
}

describe('(1) digest vs classify is compared through a crosswalk', () => {
  it('the three guaranteed-spurious pairs produce ZERO disagreement items', async () => {
    const review = await reviewFor([
      ['Framework', 'framework', 'product-framework'],
      ['Rating Specifications', 'rating', 'rating-roc'],
      ['Rate Tables', 'tables', 'rate-tables'],
      ['Forms Specifications', 'forms', 'forms'],
      ['Forms Dynamic Data', 'dynamicFields', 'forms'],
      ['Rule References', 'formRules', 'rules'],
      ['Specification Definitions', 'definitions', 'definitions'],
      ['LD Tables', 'tables', 'limits-deductibles'],
      ['Rating ROC', 'rating', 'rate-tables'],
    ])
    expect(review.filter(r => r.kind === 'digest-classify-disagreement')).toHaveLength(0)
  }, 30_000)

  it('a GENUINE disagreement still fires, and names both readings', async () => {
    const review = await reviewFor([['Forms Specifications', 'forms', 'rating-roc']])
    const items = review.filter(r => r.kind === 'digest-classify-disagreement')
    expect(items).toHaveLength(1)
    expect(items[0].detail).toContain('as forms')
    expect(items[0].detail).toContain('classified rating-roc')
  }, 30_000)

  it('an UNMAPPED digest reading blames the vocabulary, not the sheet', async () => {
    const review = await reviewFor([['Odd Sheet', 'somethingNew', 'forms']])
    expect(review.filter(r => r.kind === 'digest-classify-disagreement')).toHaveLength(0)
    const drift = review.find(r => r.kind === 'digest-vocabulary-unmapped')
    expect(drift).toBeTruthy()
    expect(drift!.detail).toContain('somethingNew')
  }, 30_000)

  it('UNKNOWN and ignore are still skipped (unchanged contract)', async () => {
    const review = await reviewFor([['A', 'UNKNOWN', 'forms'], ['B', 'framework', 'ignore']])
    expect(review.filter(r => r.kind === 'digest-classify-disagreement')).toHaveLength(0)
    expect(review.filter(r => r.kind === 'digest-vocabulary-unmapped')).toHaveLength(0)
  }, 30_000)
})

// ─── (2) the sentinel these books actually use ─────────────────────────────────

describe('(2) `<Intentionally Blank>` is a sentinel, and the exclusion is counted', () => {
  it('normalizes to null — the exact string, the guessed string, and any bracketed form', () => {
    const n = brainShared.normalizeCellValue
    expect(n('<Intentionally Blank>')).toBeNull()          // THE string in the corpus
    expect(n('<intentionally blank>')).toBeNull()
    expect(n('  <Intentionally Blank>  ')).toBeNull()
    expect(n('<Intentionally Left Blank>')).toBeNull()     // the pre-existing guess
    expect(n('<Placeholder>')).toBeNull()
    expect(n('<TBD>')).toBeNull()                          // the general bracketed rule
    // …and nothing that carries meaning is swallowed with them.
    expect(n('Intentionally Blank')).toBe('Intentionally Blank')   // unbracketed prose stays
    expect(n('A < B')).toBe('A < B')
    expect(n('<GL.COV.001')).toBe('<GL.COV.001')
    expect(n('Limit > $1,000')).toBe('Limit > $1,000')
  })

  it('isSentinelText separates "the sheet said nothing here" from "the cell is empty"', () => {
    expect(brainShared.isSentinelText('<Intentionally Blank>')).toBe(true)
    expect(brainShared.isSentinelText('N/A')).toBe(true)
    expect(brainShared.isSentinelText('')).toBe(false)     // empty is not a sentinel
    expect(brainShared.isSentinelText('   ')).toBe(false)
    expect(brainShared.isSentinelText('Premises')).toBe(false)
  })

  it('the reader COUNTS what it silenced, per sheet (recorded, not assumed)', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('FW')
    ws.addRow(['COVERAGE ID', 'COVERAGE NAME', 'SUB-COVERAGE'])
    ws.addRow(['GL.COV.001', 'Premises', '<Intentionally Blank>'])
    ws.addRow(['GL.COV.002', 'Products', '<Intentionally Blank>'])
    ws.addRow(['GL.COV.003', 'Personal Injury', 'N/A'])
    ws.addRow(['GL.COV.004', 'Medical', 'Sub A'])
    const ws2 = wb.addWorksheet('Rating')
    ws2.addRow(['STEP', 'FACTOR'])
    ws2.addRow(['1', '<Intentionally Blank>'])
    const buf = Buffer.from(await wb.xlsx.writeBuffer())

    const { structural, sentinelCells, sentinelBySheet } = await readWorkbookToStructural(buf, 'wb.xlsx', 'XLSX')
    expect(sentinelCells).toBe(4)                          // 3 on FW (2 bracketed + N/A) + 1 on Rating
    expect(sentinelBySheet).toEqual({ FW: 3, Rating: 1 })
    expect(structural.sentinelCells).toBe(4)               // rides the model → brain:input
    // …and the cells really are gone from what the stages see.
    const fw = structural.sheets.find((s: { sheetName: string }) => s.sheetName === 'FW')
    expect(fw.cells[1][2]).toBeNull()
    expect(fw.cells[4][2]).toBe('Sub A')                   // a real sub-coverage survives
  }, 30_000)
})

// ─── (3) the routing assist fires only when deterministic inference failed ─────

describe('(3) the LOB assist is gated on inconclusive deterministic inference', () => {
  const workbook = async (refIdPrefix: string) => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Framework')
    ws.addRow(['PRODUCT FRAMEWORK ID', 'COVERAGE NAME'])
    for (let i = 1; i <= 4; i++) ws.addRow([`${refIdPrefix}.COV.00${i}`, `Coverage ${i}`])
    return Buffer.from(await wb.xlsx.writeBuffer())
  }

  it('a workbook whose LOB resolves deterministically costs ZERO router model calls', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; throw new Error('the router must not call a model here') })
    const buf = await workbook('GL')
    const out = await routeArtifacts({
      documents: [{ name: 'gl.xlsx', base64: buf.toString('base64'), mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
      budget: { noCap: true },
    })
    expect(out.lobSource).toBe('deterministic')
    expect(out.lobRefIdHint).toBeTruthy()
    expect(calls).toBe(0)                                  // was: 1-2 calls on every import
  }, 60_000)

  it('when deterministic inference is inconclusive the assist still runs', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async (url: string) => {
      calls++
      const text = JSON.stringify({ lobPrefix: 'GL', edition: null, rationale: 'stub' })
      if (String(url).includes('anthropic')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} }) }
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: {} }) }
    })
    const buf = await workbook('ZZZ')                      // no registry prefix, no LOB signal
    const out = await routeArtifacts({
      documents: [{ name: 'mystery.xlsx', base64: buf.toString('base64'), mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
      budget: { noCap: true },
    })
    expect(calls).toBeGreaterThan(0)
    expect(out.lobSource).toBe('ai-assist')
  }, 60_000)
})
