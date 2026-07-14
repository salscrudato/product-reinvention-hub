/**
 * hardening-p0-1-multirefid.test.ts — regression lock for ledger F01 (P0-1).
 *
 * Contract: models return multi-refId cells UNSPLIT; reconciliation keys candidates
 * by (sourceRowIndex, occurrence) so same-row entities never overwrite each other;
 * deterministic expansion happens exactly once post-consensus (expandMultiRefIds)
 * with occurrence keys and the ORIGINAL cell text preserved as citation evidence.
 *
 * Fails on the pre-fix sha (2b1f893): reconcileEntities keyed a Map by
 * sourceRowIndex alone (last same-row entity wins) and was not exported;
 * STAGE4_EXTRACT_SYSTEM instructed models to split multi-refId cells.
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { reconcileEntities, expandMultiRefIds } = require('../../server/lib/import-brain/stage4-extract.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { STAGE4_EXTRACT_SYSTEM } = require('../../server/lib/import-brain/prompts.js')

function rawEntity(row: number, refId: string, name: string) {
  return {
    kind: 'coverage', sourceRowIndex: row, reviewFlag: false, needsRefIdSynthesis: false,
    fields: [
      { fieldName: 'refId', value: refId, confidence: 0.9, citation: { sheet: 'FW', cell: `A${row + 2}`, verbatim: refId } },
      { fieldName: 'name', value: name, confidence: 0.9, citation: { sheet: 'FW', cell: `B${row + 2}`, verbatim: name } },
    ],
  }
}

describe('P0-1: multi-refId contract (ledger F01)', () => {
  it('same-row entities from one vote never overwrite each other', () => {
    const review: unknown[] = []
    // Model A (disobedient) split row 7 into two entities; model B kept it unsplit.
    const a = [rawEntity(7, 'GL.COV.002', 'Cov A'), rawEntity(7, 'GL.COV.003', 'Cov B')]
    const b = [rawEntity(7, 'GL.COV.002 GL.COV.003', 'Cov A')]
    const { entities } = reconcileEntities(a, b, 'FW', review)
    const refIds = entities.map((e: { fields: { fieldName: string; value: unknown }[] }) =>
      e.fields.find(f => f.fieldName === 'refId')?.value)
    expect(entities).toHaveLength(2)
    expect(refIds).toContain('GL.COV.002')
    expect(refIds).toContain('GL.COV.003')
    // Multiplicity is visible, not silent: both occurrences flagged + review item.
    expect(entities.every((e: { reviewFlag: boolean }) => e.reviewFlag)).toBe(true)
    expect(review.some((r: unknown) => (r as { kind: string }).kind === 'row-multiplicity')).toBe(true)
    // Occurrence keys distinguish same-row entities.
    expect(entities.map((e: { occurrence: number }) => e.occurrence)).toEqual([0, 1])
  })

  it('the extraction prompt no longer instructs models to split multi-refId cells', () => {
    expect(STAGE4_EXTRACT_SYSTEM).not.toMatch(/split them and produce one entity per refId/i)
    expect(STAGE4_EXTRACT_SYSTEM).toMatch(/do NOT split/i)
  })

  it('expansion happens once post-consensus, preserving the original cell text as evidence', () => {
    const entity = rawEntity(4, 'GL.COV.010 GL.COV.011', 'Bundled Coverage')
    const out = expandMultiRefIds([{ ...entity, overallConfidence: 0.9, sourceSheet: 'FW', occurrence: 0 }], 'FW')
    expect(out).toHaveLength(2)
    const values = out.map((e: { fields: { fieldName: string; value: unknown }[] }) =>
      e.fields.find(f => f.fieldName === 'refId')?.value)
    expect(values).toEqual(['GL.COV.010', 'GL.COV.011'])
    for (const e of out) {
      const ref = (e as { fields: { fieldName: string; citation: { verbatim: string } }[] }).fields.find(f => f.fieldName === 'refId')
      expect(ref?.citation.verbatim).toBe('GL.COV.010 GL.COV.011') // real cell text, not a fabricated fragment
    }
    expect(out.map((e: { occurrence: number }) => e.occurrence)).toEqual([0, 1])
    expect(out.every((e: { expandedFrom: string }) => e.expandedFrom === 'GL.COV.010 GL.COV.011')).toBe(true)
  })

  it('single-refId entities pass through expansion untouched', () => {
    const entity = { ...rawEntity(2, 'GL.COV.001', 'Solo'), overallConfidence: 0.9, sourceSheet: 'FW' }
    const out = expandMultiRefIds([entity], 'FW')
    expect(out).toHaveLength(1)
    expect(out[0].fields.find((f: { fieldName: string }) => f.fieldName === 'refId')?.value).toBe('GL.COV.001')
  })
})
