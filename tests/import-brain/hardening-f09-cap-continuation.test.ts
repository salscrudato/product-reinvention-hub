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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fingerprintGrid } = require('../../server/lib/import-brain-shared.cjs')

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

  it('column overflow is RECOVERED via column continuation (CE3 Step 3a policy flip)', () => {
    // Pre-CE3 this pinned "columns stay excluded (warned non-goal)". The CE3 brain
    // rewire mandates column continuation mirroring the row continuation: the
    // authoritative raw grid widens fp.cells and the new columns gain continuation
    // columnProfiles so stages 3-4 map + extract them.
    const { fp, raw } = bigFixture(2009, 3)
    fp.dataColCount = 200
    ;(fp as { columnProfiles?: unknown[] }).columnProfiles = [
      { colIndex: 0, headerLabel: 'RefId', typeMix: { string: 3 }, distinctSample: ['GL.RUL.1'] },
      { colIndex: 1, headerLabel: 'Name', typeMix: { string: 3 }, distinctSample: ['x'] },
      { colIndex: 2, headerLabel: 'Desc', typeMix: { string: 3 }, distinctSample: ['y'] },
    ]
    const wide = raw.map(r => [...r, ...new Array(197).fill('x')])
    const warnings: Array<{ kind: string; detail: string }> = []
    extendTruncatedGrids({ sheets: [fp] }, [{ sheet: 'BIG', file: 'w.xlsx', cells: wide }], 'w.xlsx', warnings)
    expect(fp.cells.length).toBe(2010)
    expect(fp.cells[5]!.length).toBe(200)       // widened to the authoritative grid
    expect(fp.cells[5]![150]).toBe('x')          // continuation values really there
    const profiles = (fp as { columnProfiles: Array<{ colIndex: number; continuation?: boolean }> }).columnProfiles
    expect(profiles.length).toBe(200)            // 3 originals + 197 continuation profiles
    expect(profiles[3]!.colIndex).toBe(3)
    expect(profiles.filter(p => p.continuation).length).toBe(197)
    expect((fp as { colsExtended?: boolean }).colsExtended).toBe(true)
    expect(fp.cellsTruncated).toBe(false)
    const w = warnings.find(x => x.kind === 'grid-truncated')!
    expect(w.detail).toMatch(/197 column\(s\)/)
    expect(w.detail).toMatch(/ARE extracted via column continuation/)
  })

  it('STACKED_TABLES upgrades AND re-segments — the tail is recovered, not attested away', () => {
    // RE-BASELINED. This case used to pin the opposite: "STACKED_TABLES never claims
    // continuation". That was honest bookkeeping of a real limitation — stacked
    // extraction reads fp.subTables, segmented from the CAPPED grid at fingerprint
    // time, so an upgraded fp.cells genuinely would not have been consumed, and
    // claiming "IS extracted" would have been a false conservation attestation.
    //
    // The limitation is now fixed at the cause rather than reported: after the grid
    // is upgraded, stage 0 RE-INVOKES segmentStackedTables (pure, deterministic)
    // against the uncapped grid, so the blocks past the cap become real sub-tables
    // and their rows really are extracted. The attestation is true now, so the test
    // asserts the recovery. Nothing here was loosened — see the sub-table count and
    // tail-value checks, which the old behaviour could not have satisfied.
    // "Head" is long enough that "Tail"'s marker row falls PAST the 2000-row cap,
    // so the capped grid cannot see the second block at all.
    const stackedRaw: (string | null)[][] = [['TABLE NAME: Head'], ['RULE ID: GL.RU001'], ['Id', 'Name']]
    for (let i = 0; i < 2100; i++) stackedRaw.push([`GL.A.${String(i).padStart(4, '0')}`, `A ${i}`])
    stackedRaw.push([null])
    const tailMarker = stackedRaw.length
    stackedRaw.push(['TABLE NAME: Tail'], ['RULE ID: GL.RU002'], ['Id', 'Name'])
    for (let i = 0; i < 1200; i++) stackedRaw.push([`GL.B.${String(i).padStart(4, '0')}`, `B ${i}`])
    expect(tailMarker).toBeGreaterThan(CAP_ROWS)

    const fpFull = fingerprintGrid({ sheet: 'BIG', cells: stackedRaw })
    expect(fpFull.cellsTruncated).toBe(true)
    // The capped grid holds only ONE marker, and both stacked detectors need >= 2 —
    // so this genuinely stacked sheet does not even fingerprint as stacked. That is
    // the second, independent loss the cap caused.
    expect(fpFull.layoutShape).toBe('FLAT_TABLE')
    expect(fpFull.subTables).toBeUndefined()

    const warnings: Array<{ kind: string; detail: string }> = []
    extendTruncatedGrids({ sheets: [fpFull] }, [{ sheet: 'BIG', file: 'w.xlsx', cells: stackedRaw }], 'w.xlsx', warnings)

    expect(fpFull.cells).toHaveLength(stackedRaw.length)   // upgraded
    expect(fpFull.cellsTruncated).toBe(false)
    expect(fpFull.layoutShape).toBe('STACKED_TABLES')      // re-detected against the full grid
    expect(fpFull.subTables).toHaveLength(2)               // "Tail" recovered
    expect(fpFull.subTables!.map(s => s.name)).toEqual(['Head', 'Tail'])
    // The recovered block's last row is really present, byte-for-byte.
    expect(fpFull.cells![stackedRaw.length - 1]![0]).toBe('GL.B.1199')

    const w = warnings.find(x => x.kind === 'grid-truncated')!
    expect(w.detail).toMatch(/ARE extracted via continuation/)
    expect(w.detail).not.toMatch(/NOT extracted/)
    expect(warnings.find(x => x.kind === 'stacked-redetected')!.detail).toMatch(/fingerprinted as FLAT_TABLE/)
    expect(warnings.find(x => x.kind === 'stacked-resegmented')!.detail).toMatch(/0 sub-table\(s\) from the capped grid became 2/)
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
