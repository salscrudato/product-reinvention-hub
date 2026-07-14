/**
 * hardening-p0-6-citations.test.ts — regression lock for ledger F07 + F08 (P0-6).
 *
 * Stage 5 gains a DETERMINISTIC citation resolver: every cited field resolves
 * against the authoritative normalized grid; strict fields (refId/number/parentId)
 * byte-compare (containment allowed for multi-refId cells); findings carry a
 * severity, and BLOCKING findings (invalid pointer, fabricated strict id,
 * fabricated relation target) prevent auto-accept — stage 7 routes the entity to
 * unresolved with evidence. The LLM validator stays semantics-only (WARN).
 *
 * Fails on the pre-fix sha (2b1f893): no code dereferenced a citation against the
 * grid, findings had no severity, and any refId mismatch merely set reviewFlag
 * while the entity was auto-accepted into the plan.
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveCitationsDeterministic } = require('../../server/lib/import-brain/stage5-validate.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildImportPlan } = require('../../server/lib/import-brain/stage7-plan.js')

// FW grid (0-based rows): row 0 header; row 1 = GL.COV.001 | Premises Liability;
// row 2 = "GL.COV.002 GL.COV.003" | Products Liability
const FW = {
  sheetName: 'FW', layoutShape: 'FLAT_TABLE', dataRowCount: 2,
  cells: [
    ['Ref ID', 'Coverage Name'],
    ['GL.COV.001', 'Premises Liability'],
    ['GL.COV.002 GL.COV.003', 'Products Liability'],
  ],
}
const fpMap = new Map([['FW', FW]])

function entity(refId: string, cell: string, name = 'Premises Liability', nameCell = 'B2') {
  return {
    kind: 'coverage', sourceSheet: 'FW', sourceRowIndex: 0, occurrence: 0,
    reviewFlag: false, needsRefIdSynthesis: false, overallConfidence: 0.9,
    fields: [
      { fieldName: 'refId', value: refId, confidence: 0.9, citation: { sheet: 'FW', cell, verbatim: refId } },
      { fieldName: 'name', value: name, confidence: 0.9, citation: { sheet: 'FW', cell: nameCell, verbatim: name } },
    ],
  }
}

describe('P0-6: deterministic citation resolver + severity policy (ledger F07, F08)', () => {
  it('valid citations produce no findings and no blocks', () => {
    const e = entity('GL.COV.001', 'A2')
    const findings = resolveCitationsDeterministic([e], fpMap, [])
    expect(findings).toHaveLength(0)
    expect(e.blocked).toBeUndefined()
  })

  it('a fabricated strict id is BLOCKING', () => {
    const e = entity('GL.COV.999', 'A2') // cell A2 actually holds GL.COV.001
    const review: unknown[] = []
    const findings = resolveCitationsDeterministic([e], fpMap, review)
    expect(findings.some((f: { kind: string; severity: string }) => f.kind === 'fabricated-strict-id' && f.severity === 'BLOCKING')).toBe(true)
    expect(e.blocked).toBe(true)
    expect(review.some((r: unknown) => (r as { kind: string }).kind === 'citation-blocked')).toBe(true)
  })

  it('an invalid citation pointer on a strict field is BLOCKING', () => {
    const e = entity('GL.COV.001', 'A9999') // beyond the grid
    const findings = resolveCitationsDeterministic([e], fpMap, [])
    expect(findings.some((f: { kind: string; severity: string }) => f.kind === 'invalid-citation-pointer' && f.severity === 'BLOCKING')).toBe(true)
    expect(e.blocked).toBe(true)
  })

  it('a multi-refId cell legitimately CONTAINS each expanded id (byte-sensitive)', () => {
    const e = entity('GL.COV.002', 'A3', 'Products Liability', 'B3')
    const findings = resolveCitationsDeterministic([e], fpMap, [])
    expect(findings).toHaveLength(0)
    // ...but a case-mangled id is NOT contained — strict means bytes.
    const bad = entity('gl.cov.002', 'A3', 'Products Liability', 'B3')
    const badFindings = resolveCitationsDeterministic([bad], fpMap, [])
    expect(badFindings.some((f: { kind: string }) => f.kind === 'fabricated-strict-id')).toBe(true)
  })

  it('non-strict verbatim mismatch is WARN (flag, never block)', () => {
    const e = entity('GL.COV.001', 'A2', 'Something Else Entirely', 'B2')
    const findings = resolveCitationsDeterministic([e], fpMap, [])
    const f = findings.find((x: { kind: string }) => x.kind === 'ungrounded-field')
    expect(f).toBeTruthy()
    expect((f as { severity: string }).severity).toBe('WARN')
    expect(e.blocked).toBeUndefined()
    expect(e.reviewFlag).toBe(true)
  })

  it('a fabricated relation target (parentId nowhere in the source) is BLOCKING', () => {
    const e = entity('GL.COV.001', 'A2')
    e.fields.push({ fieldName: 'parentId', value: 'GL.COV.777', confidence: 0.8, citation: { sheet: 'FW', cell: 'A2', verbatim: 'GL.COV.777' } })
    const findings = resolveCitationsDeterministic([e], fpMap, [])
    expect(findings.some((f: { kind: string; severity: string }) => f.kind === 'unresolvable-relation-target' && f.severity === 'BLOCKING')).toBe(true)
    expect(e.blocked).toBe(true)
  })

  it('importer-derived citations ((synthesized), (derived from row context)) are exempt', () => {
    const e = entity('GL.COV.001', 'A2')
    e.fields.push({ fieldName: 'parentId', value: 'GL.COV.001', confidence: 0.9, citation: { sheet: 'FW', cell: '', verbatim: '(derived from row context)' } })
    const findings = resolveCitationsDeterministic([e], fpMap, [])
    expect(findings).toHaveLength(0)
  })

  it('BLOCKING entities are NOT auto-accepted — stage 7 routes them to unresolved with evidence', () => {
    const good = entity('GL.COV.001', 'A2')
    const bad = entity('GL.COV.999', 'A2')
    resolveCitationsDeterministic([good, bad], fpMap, [])
    const bundle = buildImportPlan(
      { entities: [good, bad], importWarnings: [], classifiedSheets: [], columnMaps: [] },
      { lobRefIdHint: 'GL.LOB.001' },
    )
    expect(bundle.plan.coverages.map((c: { refId: string }) => c.refId)).toEqual(['GL.COV.001'])
    const blockedItem = bundle.unresolved.find((u: { refId: string }) => u.refId === 'GL.COV.999')
    expect(blockedItem).toBeTruthy()
    expect(blockedItem.severity).toBe('BLOCKING')
    expect(blockedItem.reason).toContain('deterministic citation verification')
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
  })
})
