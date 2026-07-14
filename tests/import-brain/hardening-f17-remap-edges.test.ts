/**
 * hardening-f17-remap-edges.test.ts — regression lock for ledger F17.
 *
 * When the deterministic ISO join adopts a mapper identity (refIdRemap:
 * oldBrainRefId → isoRefId), pre-fix ONLY provenance rows were rewritten. Every
 * other edge kept the stale id:
 *   - a brain-only child coverage's parentId → falsely "orphan-promoted"
 *     (hierarchy silently lost) even though the parent exists under its new id;
 *   - rule.coverageRefIds / rule.ldTableRef → dangling relations;
 *   - ratingProgram.steps[].source.ref → a rating step pointing at a table id
 *     that no longer exists in the plan.
 * An identity remap is a graph operation; renaming the node without rewriting
 * its edges corrupts the graph. Three structurally different edge classes lock
 * the same root cause (two-fixture rule).
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildImportPlan } = require('../../server/lib/import-brain/stage7-plan.js')

function entity(kind: string, refId: string, name: string, row: number, extraFields: Array<{ fieldName: string; value: unknown }> = []) {
  return {
    kind, sourceRowIndex: row, sourceSheet: 'FW', reviewFlag: false, needsRefIdSynthesis: false,
    overallConfidence: 0.95,
    fields: [
      { fieldName: 'refId', value: refId, confidence: 0.95, citation: { sheet: 'FW', cell: `A${row + 2}`, verbatim: refId } },
      { fieldName: 'name', value: name, confidence: 0.95, citation: { sheet: 'FW', cell: `B${row + 2}`, verbatim: name } },
      ...extraFields.map((f, i) => ({ ...f, confidence: 0.9, citation: { sheet: 'FW', cell: `C${row + 2 + i}`, verbatim: String(f.value) } })),
    ],
  }
}

const iso = (refId: string, name: string, data: Record<string, unknown> = {}) =>
  ({ refId, label: name, data: { refId, name, ...data } })

describe('F17: refId remap rewrites every edge, not just provenance', () => {
  const brainOutput = {
    entities: [
      entity('product', 'GL.PROD.001', 'CGL Product', 0),
      // Joins the iso coverage by name → adopts GL.COV.001 (remap SYNTH001→001).
      entity('coverage', 'GL.COV.SYNTH001', 'Premises Liability', 1),
      // Brain-only child (no iso counterpart): parentId references the REMAPPED parent.
      entity('coverage', 'GL.COV.SYNTH002', 'Brain Only Sub Coverage', 2, [{ fieldName: 'parentId', value: 'GL.COV.SYNTH001' }]),
      // Rule referencing the remapped coverage and a remapped LD table.
      entity('rule', 'GL.RU.001', 'Limit Rule', 3, [
        { fieldName: 'coverageRefIds', value: ['GL.COV.SYNTH001'] },
        { fieldName: 'ldTableRef', value: 'LDTable.SYNTH1' },
      ]),
      // Brain ldTable that joins the iso table by name → adopts LDTable.001.
      entity('ldTable', 'LDTable.SYNTH1', 'Occurrence Limits', 4),
      // Rating program + step whose source.ref names the remapped RT table.
      entity('ratingProgram', 'GL.PROG.001', 'GL Rating', 5),
      entity('ratingStep', 'GL.RAT.1.00', 'Base Rate', 6, [{ fieldName: 'source', value: { type: 'RT', ref: 'RTTable.SYNTH1' } }]),
      // Brain rtTable that joins the iso RT table by name → adopts RTTable.001.
      entity('rtTable', 'RTTable.SYNTH1', 'Increase Limit Factor', 7),
    ],
    importWarnings: [], classifiedSheets: [], columnMaps: [],
  }
  const bundle = buildImportPlan(brainOutput, {
    lobRefIdHint: 'GL.LOB.001', sourceName: 'fixture.xlsx',
    isoPlan: {
      coverages: [iso('GL.COV.001', 'Premises Liability', { parentId: null })],
      ldTables: [iso('LDTable.001', 'Occurrence Limits')],
      rtTables: [iso('RTTable.001', 'Increase Limit Factor')],
    },
  })

  it('a brain-only child keeps its hierarchy: parentId follows the remapped parent', () => {
    const child = bundle.plan.coverages.find((c: { refId: string }) => c.refId === 'GL.COV.SYNTH002')!
    expect(child).toBeTruthy()
    expect(child.data.parentId).toBe('GL.COV.001')
    // No false orphan-promotion for an edge the remap explains.
    expect(bundle.importWarnings.some((w: { kind: string; detail: string }) =>
      w.kind === 'orphan-promoted' && /SYNTH002/.test(w.detail))).toBe(false)
  })

  it('rule edges follow the remap: coverageRefIds and ldTableRef', () => {
    const rule = bundle.plan.rules.find((r: { refId: string }) => r.refId === 'GL.RU.001')!
    expect(rule.data.coverageRefIds).toEqual(['GL.COV.001'])
    expect(rule.data.ldTableRef).toBe('LDTable.001')
  })

  it('rating step table refs follow the remap', () => {
    const steps = bundle.plan.ratingProgram.data.steps as Array<{ source?: { ref?: string } }>
    expect(steps[0]?.source?.ref).toBe('RTTable.001')
  })

  it('unrelated ids are untouched and nothing is dropped', () => {
    expect(bundle.plan.coverages).toHaveLength(2)
    expect(bundle.plan.ldTables).toHaveLength(1)
    expect(bundle.plan.rtTables).toHaveLength(1)
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
  })
})
