/**
 * hardening-p0-3-header.test.ts — regression lock for ledger F04 (P0-3).
 *
 * Preamble-above-header fixture: the sheet carries 3 preamble rows before the real
 * header row (absolute index 3). When the fingerprinter's own candidate is weak,
 * stage 2 must re-score the AUTHORITATIVE embedded grid (fp.cells) — absolute row
 * indices — and lock row 3. Pre-fix (2b1f893) it rebuilt a SYNTHETIC grid from
 * columnProfiles (headerLabel as row 0 + distinctSample as rows 1+) and applied the
 * synthetic index as an absolute one, confirming headerRowIndex 0.
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

// NOTE: import-brain-shared.cjs is deliberately NOT mocked — the real deterministic
// header scorer is the unit under test's dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { lockHeaders } = require('../../server/lib/import-brain/stage2-header-lock.js')

// AI fallback must never be reached in the passing path; if it is, fail loudly.
vi.stubGlobal('fetch', async () => { throw new Error('AI fallback reached — deterministic re-score should have locked the header') })

const HEADER = ['Ref ID', 'Coverage Name', 'Requirement', 'Claims Basis', 'Premium Generating', 'Source']
const DATA = [
  ['GL.COV.001', 'Premises Liability', 'MANDATORY', 'OCCURRENCE', 'Yes', 'ISO'],
  ['GL.COV.002', 'Products Liability', 'OPTIONAL', 'OCCURRENCE', 'Yes', 'ISO'],
  ['GL.COV.003', 'Medical Payments', 'OPTIONAL', 'OCCURRENCE', 'No', 'ISO'],
  ['GL.COV.004', 'Fire Legal', 'OPTIONAL', 'OCCURRENCE', 'Yes', 'ISO'],
  ['GL.COV.005', 'Liquor Liability', 'OPTIONAL', 'CLAIMS_MADE', 'Yes', 'ISO'],
]

function preambleFp() {
  return {
    sheetName: 'GL Framework',
    layoutShape: 'FLAT_TABLE',
    dataRowCount: 5,
    dataColCount: 6,
    bestHeaderRow: 0, // fingerprinter's weak (wrong) guess
    headerCandidates: [{ rowIndex: 0, score: 0.4, labels: ['Product Framework — General Liability'] }],
    // AUTHORITATIVE grid: 3 preamble rows, real header at absolute row 3.
    cells: [
      ['Product Framework — General Liability', null, null, null, null, null],
      ['Prepared for review', null, null, null, null, null],
      [null, null, null, null, null, null],
      HEADER,
      ...DATA,
    ],
    // Synthetic reconstruction bait (what the pre-fix code scored): row 0 = labels.
    columnProfiles: HEADER.map((label, i) => ({
      colIndex: i, headerLabel: label,
      distinctSample: DATA.map(r => r[i]),
    })),
  }
}

describe('P0-3: header re-score uses absolute grid indices (ledger F04)', () => {
  it('locks the real header row (3) behind a 3-row preamble', async () => {
    const review: unknown[] = []
    const locks = await lockHeaders(
      [{ sheetName: 'GL Framework', domain: 'product-framework', confidence: 0.9, rationale: '', disagreed: false, humanFlagNeeded: false }],
      new Map([['GL Framework', preambleFp()]]),
      { noCap: true },
      review,
    )
    expect(locks).toHaveLength(1)
    expect(locks[0].headerRowIndex).toBe(3)
    expect(locks[0].isConfirmed).toBe(true)
  })

  it('legacy fingerprints without an embedded grid can no longer confirm from synthetic samples', async () => {
    const fp = preambleFp() as Record<string, unknown>
    delete fp.cells
    const review: unknown[] = []
    // Parse-proof fetch: AI fallback replies unparseably, so any confirmation could
    // only have come from the synthetic reconstruction.
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ content: [{ type: 'text', text: 'not json' }], usage: { input_tokens: 1, output_tokens: 1 } }),
    }))
    const locks = await lockHeaders(
      [{ sheetName: 'GL Framework', domain: 'product-framework', confidence: 0.9, rationale: '', disagreed: false, humanFlagNeeded: false }],
      new Map([['GL Framework', fp]]),
      { noCap: true },
      review,
    )
    expect(locks).toHaveLength(1)
    expect(locks[0].isConfirmed).toBe(false) // pre-fix: synthetic grid confirmed row 0
    expect(review.some((r: unknown) => (r as { kind: string }).kind === 'ungrounded')).toBe(true)
  })
})
