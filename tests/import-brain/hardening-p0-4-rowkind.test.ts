/**
 * hardening-p0-4-rowkind.test.ts — regression lock for ledger F05 (P0-4).
 *
 * Row-kind inference must route through the shared LOB-registry identifier parser
 * (refIdSegmentKind), not an ad-hoc /\.PROD\./ regex. Scheme variants that carry a
 * glued digit run ("PR.PROD001", "IM.PROD044") or an abbreviated token
 * ("CORE.PRD.001") are product rows.
 *
 * Fails on the pre-fix sha (2b1f893): rowKind matched only literal ".PROD"/".LOB"
 * with a boundary, misclassifying the variants as the sheet's dominant kind, and
 * refIdSegmentKind did not exist in the shared registry.
 */
import { describe, it, expect } from 'vitest'

// Real bridge deliberately — the shared parser is the unit under test.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { refIdSegmentKind } = require('../../server/lib/import-brain-shared.cjs')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rowKind } = require('../../server/lib/import-brain/stage4-extract.js')

describe('P0-4: refId kind inference via the LOB registry parser (ledger F05)', () => {
  it('shared parser classifies scheme variants', () => {
    expect(refIdSegmentKind('PR.PROD001')).toBe('product')
    expect(refIdSegmentKind('IM.PROD044')).toBe('product')
    expect(refIdSegmentKind('CORE.PRD.001')).toBe('product')
    expect(refIdSegmentKind('GL.PROD.001')).toBe('product')
    expect(refIdSegmentKind('GL.LOB.001')).toBe('lob')
    expect(refIdSegmentKind('IM.COV044.02')).toBe('coverage')
    expect(refIdSegmentKind('GL.RU.017')).toBe('rule')
    expect(refIdSegmentKind('PR.ROC.003')).toBe('rating')
    expect(refIdSegmentKind('not a refid')).toBe(null)
    expect(refIdSegmentKind(null)).toBe(null)
  })

  it('rowKind recognizes product rows in every scheme variant', () => {
    expect(rowKind('PR.PROD001', 'coverage')).toBe('product')
    expect(rowKind('IM.PROD044', 'coverage')).toBe('product')
    expect(rowKind('CORE.PRD.001', 'coverage')).toBe('product')
    expect(rowKind('GL.PROD.001', 'coverage')).toBe('product')
  })

  it('rowKind still skips LOB rows and falls back to the dominant kind', () => {
    expect(rowKind('GL.LOB.001', 'coverage')).toBe(null)
    expect(rowKind('GL.COV.007', 'coverage')).toBe('coverage')
    expect(rowKind('GL.RU.017', 'rule')).toBe('rule')
    expect(rowKind(undefined, 'coverage')).toBe('coverage')
  })
})
