// versionRead.test.ts — regression lock for ledger PCM-B (client half).
//
// Server version docs carry {entityPath, rev, op, diff:{before,changed}, actor, at}
// — no snapshot, no productId, no entityType, and an OBJECT-pair diff. The client
// contract (shared Version) wants productId/entityType and an ARRAY diff. This
// transform is the honest bridge; it must never invent a snapshot.
import { describe, it, expect } from 'vitest'
import { mapServerVersionRow, versionAction, type ServerVersionRow } from './versionRead'

const row = (over: Partial<ServerVersionRow> = {}): ServerVersionRow => ({
  id: 'ver:products~PH.PROD.001~coverages~CGL-001:3',
  entityPath: 'products/PH.PROD.001/coverages/CGL-001',
  rev: 3,
  op: 'update',
  diff: { before: { name: 'Old' }, changed: { name: 'New' } },
  actor: { uid: 'u1', name: 'Sal' },
  at: '2026-07-14T12:00:00.000Z',
  ...over,
})

describe('mapServerVersionRow (PCM-B)', () => {
  it('turns the {before,changed} object diff into VersionDiff[]', () => {
    const v = mapServerVersionRow(row())
    expect(v.diff).toEqual([{ field: 'name', before: 'Old', after: 'New' }])
  })

  it('derives productId and entityType from entityPath', () => {
    expect(mapServerVersionRow(row()).productId).toBe('PH.PROD.001')
    expect(mapServerVersionRow(row()).entityType).toBe('coverage')
    expect(mapServerVersionRow(row({ entityPath: 'products/PH.PROD.001' })).entityType).toBe('product')
    expect(mapServerVersionRow(row({ entityPath: 'products/PH.PROD.001/rules/R1' })).entityType).toBe('rule')
    expect(mapServerVersionRow(row({ entityPath: 'products/PH.PROD.001/formRules/FR1' })).entityType).toBe('formRule')
    expect(mapServerVersionRow(row({ entityPath: 'products/PH.PROD.001/ratingPrograms/RP1' })).entityType).toBe('ratingProgram')
  })

  it('never invents a snapshot (restore stays hidden) and keeps op/rev/actor/at', () => {
    const v = mapServerVersionRow(row())
    expect(v.snapshot).toBeNull()
    expect(v.op).toBe('update')
    expect(v.rev).toBe(3)
    expect(v.actor).toEqual({ uid: 'u1', name: 'Sal' })
    expect(v.at).toBe('2026-07-14T12:00:00.000Z')
    expect(v.id).toBe(row().id)
  })

  it('a delete carries a null diff → empty VersionDiff[]', () => {
    const v = mapServerVersionRow(row({ op: 'delete', diff: null }))
    expect(v.diff).toEqual([])
  })

  it('a create diff (changed only) maps before to undefined', () => {
    const v = mapServerVersionRow(row({ op: 'create', diff: { before: {}, changed: { name: 'First' } } }))
    expect(v.diff).toEqual([{ field: 'name', before: undefined, after: 'First' }])
  })
})

describe('versionAction (PCM-B: honest action badges)', () => {
  it('trusts the recorded op over the snapshot heuristic', () => {
    // Pre-fix inferAction branded every snapshot-less row 'Deleted'.
    expect(versionAction(mapServerVersionRow(row({ op: 'update' })))).toBe('update')
    expect(versionAction(mapServerVersionRow(row({ op: 'create' })))).toBe('create')
    expect(versionAction(mapServerVersionRow(row({ op: 'delete', diff: null })))).toBe('delete')
  })

  it('falls back to the legacy snapshot heuristic when op is absent', () => {
    expect(versionAction({ snapshot: null, diff: [] })).toBe('delete')
    expect(versionAction({ snapshot: { a: 1 }, diff: [{ field: 'a', before: null, after: 1 }] })).toBe('create')
    expect(versionAction({ snapshot: { a: 1 }, diff: [{ field: 'a', before: 0, after: 1 }] })).toBe('update')
  })
})

// ─── H2/H4: canRestore gate + provenance passthrough + restore op ────────────────
describe('mapServerVersionRow — H2/H4 additions', () => {
  it('sets canRestore from rev (>0), replacing the dead snapshot gate', () => {
    expect(mapServerVersionRow(row({ rev: 2 })).canRestore).toBe(true)
    expect(mapServerVersionRow(row({ rev: 0 })).canRestore).toBe(false)
  })

  it('carries provenance through when present, undefined otherwise', () => {
    const prov = { authoredBy: 'ai' as const, model: 'claude-opus-4-8', citations: ['GL.COV.001'], confidence: 0.9 }
    expect(mapServerVersionRow(row({ provenance: prov })).provenance).toEqual(prov)
    expect(mapServerVersionRow(row()).provenance).toBeUndefined()
  })

  it('maps a restore row faithfully (op + restore provenance)', () => {
    const v = mapServerVersionRow(row({ op: 'restore', rev: 5, provenance: { authoredBy: 'restore', restoredFrom: 2 } }))
    expect(v.op).toBe('restore')
    expect(versionAction(v)).toBe('restore')
    expect(v.provenance?.restoredFrom).toBe(2)
  })
})
