/**
 * hardening-f09-cap-continuation.test.ts — regression lock for ledger F09.
 *
 * The client-embed caps (MAX_EMBED_ROWS=2000 / MAX_EMBED_COLS=128) bound what a
 * FINGERPRINT carries — but pre-fix they also silently bounded what the AI path
 * could ever extract: rows past the cap were "warned" ('review the tail
 * manually') and then extracted by NO path when the deterministic ISO mapper
 * did not consume the sheet (CORE 'Rule References': visible, 2280×29, name
 * matched by no ISO pattern — 280 rows lost in effect).
 *
 * On the server path the full normalized grid already exists (isoGrids), so a
 * truncated fingerprint is UPGRADED to the authoritative uncapped grid before
 * the brain runs — stage-4 batching and stage-5 citation resolution are
 * already windowed over fp.cells with absolute row indices, so the tail
 * extracts with no further changes. Column overflow stays a warned non-goal.
 * When no raw grid exists (legacy structural path), the warning states the
 * EXACT loss instead of a vague 'review manually'.
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
const { extendTruncatedGrids } = require('../../server/lib/import-brain/stage0-router.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveCitationsDeterministic } = require('../../server/lib/import-brain/stage5-validate.js')

const CAP_ROWS = 2000

function bigFixture(dataRows: number, cols = 3) {
  // 1 header + dataRows rows; the fingerprint carries only the first CAP_ROWS.
  const raw: (string | null)[][] = [['PRODUCT FRAMEWORK ID', 'COVERAGE', 'NOTES'].slice(0, cols)]
  for (let i = 0; i < dataRows; i++) raw.push([`GL.RUL.${String(i).padStart(4, '0')}`, `Rule ${i}`, ''].slice(0, cols))
  const fp = {
    sheetName: 'BIG', layoutShape: 'FLAT_TABLE',
    cells: raw.slice(0, CAP_ROWS).map(r => [...r]),
    cellsTruncated: true,
    dataRowCount: raw.length,
    dataColCount: cols,
    columnProfiles: [],
  }
  return { fp, raw }
}

describe('F09: truncated fingerprints upgrade to the authoritative raw grid', () => {
  it('rows past the cap become extractable and the warning states the continuation', () => {
    const { fp, raw } = bigFixture(2009)
    const warnings: Array<{ kind: string; detail: string }> = []
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: 'BIG', file: 'w.xlsx', cells: raw }], 'w.xlsx', warnings)
    expect(fp.cells.length).toBe(2010)          // full grid, header + 2009 data rows
    expect(fp.cellsTruncated).toBe(false)
    expect((fp as { cellsExtended?: boolean }).cellsExtended).toBe(true)
    // The tail's last row is really there, values intact.
    expect(fp.cells[2009]![0]).toBe('GL.RUL.2008')
    const w = warnings.find(x => x.kind === 'grid-truncated')!
    expect(w).toBeTruthy()
    expect(w.detail).toMatch(/10 row\(s\)/)     // 2010 - 2000 exact loss-turned-continuation
    expect(w.detail).toMatch(/IS extracted|continuation/i)
  })

  it('without a raw grid the warning states the EXACT loss, never a vague "review manually" alone', () => {
    const { fp } = bigFixture(2009)
    const warnings: Array<{ kind: string; detail: string }> = []
    extendTruncatedGrids({ sheets: [fp] }, [], 'w.xlsx', warnings)
    expect(fp.cells.length).toBe(CAP_ROWS)      // unchanged — no raw grid on this path
    expect(fp.cellsTruncated).toBe(true)
    const w = warnings.find(x => x.kind === 'grid-truncated')!
    expect(w.detail).toMatch(/10 row\(s\)/)
    expect(w.detail).toMatch(/NOT extracted/i)
  })

  it('column overflow stays excluded (warned non-goal): rows are sliced to the embedded width', () => {
    const { fp, raw } = bigFixture(2009, 3)
    // Pretend the source had 200 columns; the fingerprint embedded only 3.
    fp.dataColCount = 200
    const wide = raw.map(r => [...r, ...new Array(197).fill('x')])
    const warnings: Array<{ kind: string; detail: string }> = []
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: 'BIG', file: 'w.xlsx', cells: wide }], 'w.xlsx', warnings)
    expect(fp.cells.length).toBe(2010)
    expect(fp.cells[5]!.length).toBe(3)         // sliced to embedded width
    const w = warnings.find(x => x.kind === 'grid-truncated')!
    expect(w.detail).toMatch(/197 column\(s\)/)
  })

  it('STACKED_TABLES never claims continuation — its extraction ignores fp.cells', () => {
    // Stacked extraction reads fp.subTables (segmented from the CAPPED grid at
    // fingerprint time). An upgraded fp.cells would NOT be consumed, so claiming
    // "IS extracted" would be a false conservation attestation (judge-found).
    const { fp, raw } = bigFixture(2009)
    ;(fp as { layoutShape: string }).layoutShape = 'STACKED_TABLES'
    ;(fp as { subTables?: unknown[] }).subTables = [{ cells: fp.cells.slice(0, 50) }]
    const warnings: Array<{ kind: string; detail: string }> = []
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: 'BIG', file: 'w.xlsx', cells: raw }], 'w.xlsx', warnings)
    expect(fp.cells.length).toBe(CAP_ROWS)      // NOT upgraded
    expect(fp.cellsTruncated).toBe(true)
    const w = warnings.find(x => x.kind === 'grid-truncated')!
    expect(w.detail).toMatch(/NOT extracted/i)
    expect(w.detail).toMatch(/stacked/i)
    expect(w.detail).not.toMatch(/IS extracted/)
  })

  it('column-only truncation: honest wording, no phantom row loss, no false "no raw grid"', () => {
    const { fp, raw } = bigFixture(100)          // few rows — under the row cap
    fp.cells = raw.map(r => [...r])              // all rows embedded
    fp.dataColCount = 200                        // …but 200 source columns
    fp.cellsTruncated = true                     // col cap fired
    const warnings: Array<{ kind: string; detail: string }> = []
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: 'BIG', file: 'w.xlsx', cells: raw }], 'w.xlsx', warnings)
    const w = warnings.find(x => x.kind === 'grid-truncated')!
    expect(w.detail).toMatch(/197 column\(s\) are NOT extracted/)
    expect(w.detail).toMatch(/all rows are covered/i)
    expect(w.detail).not.toMatch(/no raw grid/)
    expect(w.detail).not.toMatch(/review the tail/i)
  })

  it('non-truncated fingerprints are never touched', () => {
    const fp = { sheetName: 'OK', cells: [['a']], cellsTruncated: false, dataRowCount: 1, dataColCount: 1 }
    const warnings: unknown[] = []
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: 'OK', file: 'w.xlsx', cells: [['a'], ['b']] }], 'w.xlsx', warnings)
    expect(fp.cells.length).toBe(1)
    expect(warnings).toHaveLength(0)
  })

  it('stage-5 citations into the tail resolve against the upgraded grid', () => {
    const { fp, raw } = bigFixture(2009)
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: 'BIG', file: 'w.xlsx', cells: raw }], 'w.xlsx', [])
    const entity = {
      kind: 'rule', sourceSheet: 'BIG', sourceRowIndex: 2005, reviewFlag: false,
      fields: [{
        fieldName: 'refId', value: 'GL.RUL.2004', confidence: 0.9,
        // data row 2004 sits at absolute grid row 2005 → Excel row 2006 → cell A2006.
        citation: { sheet: 'BIG', cell: 'A2006', verbatim: 'GL.RUL.2004' },
      }],
    }
    const review: unknown[] = []
    const findings = resolveCitationsDeterministic([entity], new Map([['BIG', fp]]), review)
    expect(findings.filter((f: { kind: string }) => f.kind === 'invalid-citation-pointer')).toHaveLength(0)
    expect((entity as { blocked?: boolean }).blocked).not.toBe(true)
  })
})
