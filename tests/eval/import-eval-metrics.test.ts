/**
 * import-eval-metrics.test.ts — regression lock for ledger F20 (eval blind spots).
 *
 * Pre-fix, scripts/import-eval.mts could not see: fabricated extra entities
 * (unpenalized), missing linkage (parentId / formNumbers / ldTableRef edges
 * unscored), lost candidates (no conservation identity), or citations that do
 * not resolve against the source grid (any truthy string passed). These unit
 * fixtures lock each metric's semantics; the wiring into pass/fail lives in
 * scripts/import-eval.mts and is exercised by the offline gate itself.
 */
import { describe, it, expect } from 'vitest'
import {
  extrasMetrics, linkageMetrics, conservationMetrics, resolveProvenanceRows,
  type EvalEntity,
} from '../../scripts/lib/import-eval-metrics.mts'

const ent = (kind: string, refId: string, fields: Record<string, unknown> = {}): EvalEntity => ({ kind, refId, fields })

describe('F20: extras / fabrication penalty', () => {
  it('counts extracted entities with no golden counterpart', () => {
    const golden = [ent('coverage', 'GL.COV.001')]
    const extracted = [ent('coverage', 'GL.COV.001'), ent('coverage', 'GL.COV.999')]
    const m = extrasMetrics(extracted, golden)
    expect(m.extraEntities).toBe(1)
    expect(m.extraEntityRate).toBe(0.5)
    expect(m.extraByKind).toEqual({ coverage: 1 })
    expect(m.sampleExtras[0]).toEqual({ kind: 'coverage', refId: 'GL.COV.999' })
  })

  it('a clean extraction scores zero extras', () => {
    const golden = [ent('coverage', 'GL.COV.001'), ent('rule', 'GL.RUL.001')]
    expect(extrasMetrics(golden, golden).extraEntityRate).toBe(0)
  })
})

describe('F20: linkage metrics', () => {
  it('parentResolutionRate: dangling parentId in the extracted set is a defect', () => {
    const extracted = [
      ent('coverage', 'C1'),
      ent('coverage', 'C2', { parentId: 'C1' }),
      ent('coverage', 'C3', { parentId: 'GHOST' }),
    ]
    const m = linkageMetrics(extracted, [])
    expect(m.parentWithRef).toBe(2)
    expect(m.parentResolved).toBe(1)
    expect(m.parentResolutionRate).toBe(0.5)
  })

  it('parentEdgeRecall: golden hierarchy edges must survive extraction', () => {
    const golden = [ent('coverage', 'C1'), ent('coverage', 'C2', { parentId: 'C1' })]
    const good = linkageMetrics([ent('coverage', 'C1'), ent('coverage', 'C2', { parentId: 'C1' })], golden)
    expect(good.parentEdgeRecall).toBe(1)
    // A nulled parent (e.g. wrong orphan-promotion) is a lost edge, not a pass.
    const lost = linkageMetrics([ent('coverage', 'C1'), ent('coverage', 'C2', {})], golden)
    expect(lost.goldenParentEdges).toBe(1)
    expect(lost.parentEdgeRecall).toBe(0)
  })

  it('formAttachmentRecall scores each golden form edge individually', () => {
    const golden = [ent('coverage', 'C1', { formNumbers: ['CG 00 01', 'CG 21 47'] })]
    const m = linkageMetrics([ent('coverage', 'C1', { formNumbers: ['CG 00 01'] })], golden)
    expect(m.goldenFormEdges).toBe(2)
    expect(m.formEdgesReproduced).toBe(1)
    expect(m.formAttachmentRecall).toBe(0.5)
  })

  it('ldTableRefResolutionRate resolves rule table pointers; null when absent', () => {
    const withRef = [
      ent('rule', 'R1', { ldTableRef: 'LDTable.002' }),
      ent('rule', 'R2', { ldTableRef: 'LDTable.MISSING' }),
      ent('ldTable', 'LDTable.002'),
    ]
    expect(linkageMetrics(withRef, []).ldTableRefResolutionRate).toBe(0.5)
    expect(linkageMetrics([ent('rule', 'R1')], []).ldTableRefResolutionRate).toBeNull()
  })

  it('empty sets degrade to perfect rates, never NaN', () => {
    const m = linkageMetrics([], [])
    expect(m.parentResolutionRate).toBe(1)
    expect(m.parentEdgeRecall).toBe(1)
    expect(m.formAttachmentRecall).toBe(1)
  })
})

describe('F20: conservation identity', () => {
  it('balanced: candidates = plan + unresolved → lossDelta 0', () => {
    const m = conservationMetrics({ stage4Count: 10, planEntities: 8, unresolvedCount: 2, counts: { proposed: 10, accepted: 8, unresolved: 2 } })
    expect(m.lossDelta).toBe(0)
    expect(m.countsIdentityOk).toBe(true)
  })

  it('positive delta = lost candidates; negative (ISO-join appends) is NOT loss', () => {
    expect(conservationMetrics({ stage4Count: 10, planEntities: 7, unresolvedCount: 2 }).lossDelta).toBe(1)
    expect(conservationMetrics({ stage4Count: 10, planEntities: 805, unresolvedCount: 0 }).lossDelta).toBe(0)
  })

  it('unknown stage-4 count yields null, never a fake zero', () => {
    const m = conservationMetrics({ stage4Count: null, planEntities: 8, unresolvedCount: 2 })
    expect(m.lossDelta).toBeNull()
    expect(m.countsIdentityOk).toBeNull()
  })

  it('a broken bundle counts identity is caught', () => {
    const m = conservationMetrics({ planEntities: 8, counts: { proposed: 11, accepted: 8, unresolved: 2 } })
    expect(m.countsIdentityOk).toBe(false)
  })
})

describe('F20: citation resolution against the source grid', () => {
  const grids = [
    { sheet: 'FW', cells: [['refId', 'Name'], ['GL.COV.001', 'Premises Liability']] },
  ]

  it('resolves a verbatim that matches its cited cell', () => {
    const r = resolveProvenanceRows([{ sheet: 'FW', cell: 'B2', verbatim: 'Premises Liability' }], grids)
    expect(r.checked).toBe(1)
    expect(r.resolved).toBe(1)
    expect(r.citationResolvableRate).toBe(1)
  })

  it('a citation pointing at the wrong cell does NOT resolve', () => {
    const r = resolveProvenanceRows([{ sheet: 'FW', cell: 'A1', verbatim: 'Premises Liability' }], grids)
    expect(r.resolved).toBe(0)
    expect(r.sampleMisses[0]?.actual).toBe('refId')
  })

  it('multi-value cells resolve by containment; whitespace folds', () => {
    const g = [{ sheet: 'FW', cells: [['GL.COV.001, GL.COV.002']] }]
    expect(resolveProvenanceRows([{ sheet: 'FW', cell: 'A1', verbatim: 'GL.COV.002' }], g).resolved).toBe(1)
    const g2 = [{ sheet: 'FW', cells: [['Premises  Liability']] }]
    expect(resolveProvenanceRows([{ sheet: 'FW', cell: 'A1', verbatim: 'Premises Liability' }], g2).resolved).toBe(1)
  })

  it('placeholder / synthesized provenance is skipped, unknown sheets miss honestly', () => {
    const r = resolveProvenanceRows([
      { sheet: 'FW', cell: 'A1', verbatim: '(synthesized)' },
      { sheet: 'NOPE', cell: 'A1', verbatim: 'x' },
    ], grids)
    expect(r.checked).toBe(1)
    expect(r.resolved).toBe(0)
    expect(r.citationResolvableRate).toBe(0)
  })

  it('nothing checkable yields null, never a fake pass number', () => {
    expect(resolveProvenanceRows([], grids).citationResolvableRate).toBeNull()
  })

  it('collision-suffixed sheet names ("FW (book.xlsx)") fall back to the base name', () => {
    const r = resolveProvenanceRows([{ sheet: 'FW (book.xlsx)', cell: 'B2', verbatim: 'Premises Liability' }], grids)
    expect(r.resolved).toBe(1)
  })

  it('whitespace-only verbatims are skipped, not auto-resolved', () => {
    const r = resolveProvenanceRows([{ sheet: 'FW', cell: 'B2', verbatim: '   ' }], grids)
    expect(r.checked).toBe(0)
  })
})

// ─── F30: extras measure FABRICATION, not golden blindness ───────────────────────
// The first completed CORE live run scored extras 49.9% RED while precision on
// golden-covered content was 1.000: all 345 "extras" were SYNTH-marked, citation-
// resolved brain extractions from sheets the deterministic golden cannot parse
// (234 real eligibility rules + 111 per-state factor tables, zero golden-name
// collisions). The gate now reads fabricationExtraRate — extras that claim a
// SOURCE-shaped id the golden has never seen — while SYNTH-marked minted ids are
// reported (syntheticExtraRate), never gated. The offline zero-tolerance gate
// stays on the TOTAL rate (same parser both sides ⇒ any extra is instability).
describe('F30: extras split — fabrication gated, synthetic reported', () => {
  const golden = [
    { kind: 'rule', refId: 'CORE.RULE.SYNTH001', fields: {} },
    { kind: 'coverage', refId: 'CORE.COV.001', fields: {} },
  ]
  it('a SYNTH-marked extra is reported, never gated as fabrication', () => {
    const m = extrasMetrics([
      { kind: 'rule', refId: 'CORE.RULE.SYNTH001', fields: {} },   // golden match
      { kind: 'rule', refId: 'XX.RULE.SYNTH002', fields: {} },     // minted, golden-blind
      { kind: 'rtTable', refId: 'XX.RT.SYNTH001', fields: {} },    // minted, golden-blind kind
    ], golden)
    expect(m.extraEntities).toBe(2)
    expect(m.syntheticExtras).toBe(2)
    expect(m.fabricationExtras).toBe(0)
    expect(m.fabricationExtraRate).toBe(0)
    expect(m.extraEntityRate).toBeCloseTo(2 / 3)                   // total rate unchanged (offline gate)
  })
  it('an extra claiming a SOURCE-shaped id the golden never saw stays gated', () => {
    const m = extrasMetrics([
      { kind: 'coverage', refId: 'CORE.COV.001', fields: {} },
      { kind: 'coverage', refId: 'CORE.COV.999', fields: {} },     // claims a real-looking source id
    ], golden)
    expect(m.fabricationExtras).toBe(1)
    expect(m.fabricationExtraRate).toBeCloseTo(0.5)
    expect(m.syntheticExtras).toBe(0)
  })
  it('SYNTH matching is segment-anchored — a source id containing the word SYNTHETIC stays GATED (judge-demanded)', () => {
    const m = extrasMetrics([
      { kind: 'coverage', refId: 'CORE.COV.SYNTHETIC-LIABILITY-01', fields: {} }, // real source id, not a mint marker
      { kind: 'coverage', refId: 'CORE.COVSYNTH.001', fields: {} },               // SYNTH not segment-leading either
    ], golden)
    expect(m.syntheticExtras).toBe(0)
    expect(m.fabricationExtras).toBe(2)
    // The actual minted shapes all stay on the reported side:
    const minted = extrasMetrics([
      { kind: 'rule', refId: 'XX.RULE.SYNTH001', fields: {} },
      { kind: 'product', refId: 'PH.PROD.SYNTH.NJHO3', fields: {} },
      { kind: 'rtTable', refId: 'PH.RT.SYNTH.NJHO3.BASE', fields: {} },
    ], golden)
    expect(minted.syntheticExtras).toBe(3)
    expect(minted.fabricationExtras).toBe(0)
  })
})
