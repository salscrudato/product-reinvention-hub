// Pure unit test for the mutation envelope — proves what a single mutation (and a seed
// batch of them) writes: entity (+ rev), append-only audit, version(diff), and searchIndex
// for indexable types (Project + Task included). Runs in the fast unit gate (no emulator);
// the emulator integration test (tests/integration/mutate.test.ts) proves the same shapes
// land in Firestore atomically.
import { describe, it, expect } from 'vitest'
import { buildMutationWrites, computeDiff, stripUndefinedDeep, INDEXABLE } from './envelope'
import type { EnvelopeWrite } from './envelope'
import type { MutationPayload } from './types'

const actor = { uid: 'u1', name: 'Tester' }
const NOW = '__ts__'
const build = (m: MutationPayload, prev: Record<string, unknown> = {}) =>
  buildMutationWrites(m, m.data, prev, { now: NOW })
const pick = (ws: EnvelopeWrite[], target: EnvelopeWrite['target']) => ws.find(w => w.target === target)

describe('buildMutationWrites — the atomic envelope', () => {
  it('project create: entity rev:1 + audit + version + searchIndex (project is indexable)', () => {
    const ws = build({
      op: 'create', path: 'projects/P1', entityType: 'project', actor,
      data: { name: 'Personal Auto — National Launch', refId: 'PRJ.001', status: 'planning' },
    })
    const entity = pick(ws, 'entity')!
    expect(entity.op).toBe('set')
    expect(entity.data).toMatchObject({ rev: 1, updatedBy: 'u1', createdAt: NOW, updatedAt: NOW, name: 'Personal Auto — National Launch' })

    expect(pick(ws, 'audit')!.data).toMatchObject({ action: 'create', entityType: 'project', entityPath: 'projects/P1', at: NOW })

    const version = pick(ws, 'version')!.data as { snapshot: Record<string, unknown>; diff: unknown[] }
    expect((version.snapshot as { refId: string }).refId).toBe('PRJ.001')
    expect(version.diff.length).toBeGreaterThan(0)

    const idx = pick(ws, 'searchIndex')!
    expect(idx.op).toBe('set')
    expect(idx.data).toMatchObject({ type: 'project', title: 'Personal Auto — National Launch', path: 'projects/P1' })
  })

  it('task create: uses title for the ⌘K entry and stamps rev:1 (task is indexable)', () => {
    const ws = build({
      op: 'create', path: 'tasks/t1', entityType: 'task', productId: 'HO.PROD.001', actor,
      data: { title: 'Develop product rating', column: 'IDEATION', projectId: 'P1', origin: 'seeded' },
    })
    expect((pick(ws, 'entity')!.data as { rev: number }).rev).toBe(1)
    expect(pick(ws, 'audit')!.data).toMatchObject({ entityType: 'task', productId: 'HO.PROD.001' })
    expect((pick(ws, 'searchIndex')!.data as { title: string }).title).toBe('Develop product rating')
  })

  it('update: bumps rev to prev+1 and records a field-level diff', () => {
    const ws = build(
      { op: 'update', path: 'projects/P1', entityType: 'project', actor, expectedRev: 3, data: { name: 'Renamed' } },
      { name: 'Original', rev: 3 },
    )
    const entity = pick(ws, 'entity')!
    expect(entity.op).toBe('update')
    expect((entity.data as { rev: number }).rev).toBe(4)
    const diff = (pick(ws, 'version')!.data as { diff: { field: string; before: unknown; after: unknown }[] }).diff
    expect(diff).toContainEqual({ field: 'name', before: 'Original', after: 'Renamed' })
  })

  it('delete: removes entity + searchIndex, appends a delete audit + null-snapshot version', () => {
    const ws = build({ op: 'delete', path: 'tasks/t1', entityType: 'task', actor }, { title: 'Old', rev: 2 })
    expect(pick(ws, 'entity')!.op).toBe('delete')
    expect(pick(ws, 'searchIndex')!.op).toBe('delete')
    expect(pick(ws, 'audit')!.data).toMatchObject({ action: 'delete' })
    expect((pick(ws, 'version')!.data as { snapshot: unknown }).snapshot).toBeNull()
  })

  it('non-indexable type (newsPrefs) writes NO ⌘K doc but is still audited + versioned', () => {
    const ws = build({ op: 'create', path: 'newsPrefs/u1', entityType: 'newsPrefs', actor, data: { instruction: 'x' } })
    expect(pick(ws, 'searchIndex')).toBeUndefined()
    expect(pick(ws, 'audit')).toBeDefined()
    expect(pick(ws, 'version')).toBeDefined()
    expect(INDEXABLE.has('newsPrefs')).toBe(false)
  })

  it('seed batch: every task payload produces a full envelope (entity rev:1 + audit + version + index)', () => {
    const batch: MutationPayload[] = Array.from({ length: 5 }, (_, i) => ({
      op: 'create', path: `tasks/seed-${i}`, entityType: 'task', productId: 'HO.PROD.001', actor,
      data: { title: `Task ${i}`, column: 'BUILD_FILE', projectId: 'P1', origin: 'seeded' },
    }))
    for (const m of batch) {
      const ws = build(m)
      expect((pick(ws, 'entity')!.data as { rev: number }).rev).toBe(1)
      expect(pick(ws, 'audit')).toBeDefined()
      expect(pick(ws, 'version')).toBeDefined()
      expect(pick(ws, 'searchIndex')!.op).toBe('set')
    }
  })
})

describe('undefined stripping — no write carries an unpersistable value', () => {
  // Mirrors the real failure: adding a deductible persists a coverage whose `terms`
  // array holds a term with an optional field left `undefined` (limitBasis) plus an
  // option whose cleared `label` is `undefined`. Firestore rejects `undefined` even
  // nested inside an array element — so the envelope must strip it everywhere.
  const coverageUpdate: MutationPayload = {
    op: 'update', path: 'products/PA.PROD.001/coverages/PA-COV-001-001',
    entityType: 'coverage', productId: 'PA.PROD.001', actor,
    data: {
      terms: [{
        id: 'ded-1', kind: 'DEDUCTIBLE', label: 'Deductible',
        limitBasis: undefined, min: undefined,
        optionSet: [{ id: 'o1', type: 'FLAT', value: 500, label: undefined }],
      }],
    },
  }

  it('strips undefined from the entity write (including inside array elements)', () => {
    const entity = pick(build(coverageUpdate, { rev: 1 }), 'entity')!.data as {
      terms: Array<Record<string, unknown> & { optionSet: Record<string, unknown>[] }>
    }
    const term = entity.terms[0]
    expect('limitBasis' in term).toBe(false)
    expect('min' in term).toBe(false)
    expect('label' in term.optionSet[0]).toBe(false)
    expect(JSON.stringify(entity)).not.toContain('null')   // omitted, not coerced to null
  })

  it('strips undefined from the version snapshot too', () => {
    const snap = (pick(build(coverageUpdate, { rev: 1 }), 'version')!.data as { snapshot: { terms: Record<string, unknown>[] } }).snapshot
    expect('limitBasis' in snap.terms[0]).toBe(false)
  })

  it('stripUndefinedDeep leaves defined values (incl. null/0/false) untouched', () => {
    expect(stripUndefinedDeep({ a: 0, b: false, c: null, d: undefined, e: { f: undefined, g: 1 } }))
      .toEqual({ a: 0, b: false, c: null, e: { g: 1 } })
  })
})

describe('computeDiff', () => {
  it('reports added, changed, and removed fields', () => {
    const diff = computeDiff({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })
    expect(diff).toContainEqual({ field: 'b', before: 2, after: 3 })
    expect(diff).toContainEqual({ field: 'c', before: null, after: 4 })
    expect(diff.find(d => d.field === 'a')).toBeUndefined()
  })
})
