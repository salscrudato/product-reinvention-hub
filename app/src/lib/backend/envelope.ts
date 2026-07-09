// The mutation envelope — the PURE, platform-free core of adapter.db.mutate() /
// mutateBatch(). Given a payload + the entity's pre-image, it computes the exact set of
// writes one atomic mutation performs: entity (+ rev bump) · append-only auditEvent ·
// version snapshot with a field-level diff · searchIndex upkeep (indexable types only).
//
// Kept separate from firebase.adapter.ts (which owns the Firestore refs, the transaction,
// the rev re-check, and the coverage-term guard) so both the single and the batched write
// paths share ONE definition of "what a mutation writes" — and so that definition is unit-
// testable without an emulator. AWS-SWAP: the same descriptors map to DynamoDB Put/Update/
// Delete items in a TransactWriteItems call.
import type { MutationPayload } from './types'

// Entity types that belong in the ⌘K search index. Others (feedback, comment, newsPrefs…)
// skip the searchIndex write — which also keeps VIEWER feedback submissions within their
// allowed rule surface (searchIndex is EDITOR+ write).
export const INDEXABLE = new Set([
  'product', 'coverage', 'rule', 'form', 'ldTable', 'rtTable', 'dictionary', 'task', 'project',
])

/** One physical write inside the atomic mutation, targeted at one of the four docs. */
export interface EnvelopeWrite {
  target: 'entity' | 'audit' | 'version' | 'searchIndex'
  op:     'set' | 'update' | 'delete'
  data?:  Record<string, unknown>
}

export interface FieldDiff { field: string; before: unknown; after: unknown }

/**
 * Deep-remove `undefined` so a payload is safe to persist. Firestore (and DynamoDB)
 * reject `undefined` ANYWHERE in a document — including nested inside an array element,
 * e.g. a CoverageTerm's optional `limitBasis`/`min`/`max` or a StandardOption's cleared
 * `label`/`constraintNote`. An optional field left `undefined` is simply omitted, which
 * is the storable equivalent of "field absent". Only plain objects/arrays are descended
 * into; class instances (Date, server-timestamp sentinels) pass through untouched — and
 * anyway only caller-supplied data reaches here (server tokens are stamped on afterwards).
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => stripUndefinedDeep(v)) as unknown as T
  if (value && typeof value === 'object' && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefinedDeep(v)
    }
    return out as T
  }
  return value
}

/** Field-level diff between the stored pre-image and the incoming data (JSON-equality). */
export function computeDiff(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): FieldDiff[] {
  const fields = new Set([...Object.keys(prev), ...Object.keys(next)])
  const diff: FieldDiff[] = []
  for (const field of fields) {
    if (JSON.stringify(prev[field]) !== JSON.stringify(next[field])) {
      diff.push({ field, before: prev[field] ?? null, after: next[field] ?? null })
    }
  }
  return diff
}

/** The ⌘K search-index entry for an indexable entity write. */
export function searchIndexEntry(entityType: string, path: string, data: Record<string, unknown>) {
  const title    = (data['name'] as string | undefined) ?? (data['title'] as string | undefined) ?? ''
  const subtitle = (data['refId'] as string | undefined) ?? entityType
  const keywords = [title, subtitle, data['refId'] as string, data['description'] as string]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/\W+/)
    .filter(k => k.length > 2)
  return {
    type:     entityType,
    refId:    (data['refId'] as string | null) ?? null,
    title,
    subtitle,
    path,
    keywords: [...new Set(keywords)],
  }
}

/**
 * Build the ordered list of writes for one mutation. `data` is the FINAL entity data
 * (with any server-minted refId already injected); `prevData` is the transactional
 * pre-image ({} for a create). `now` is an opaque timestamp token the caller supplies
 * (serverTimestamp() in Firebase; a fixed value in tests).
 */
export function buildMutationWrites(
  m: MutationPayload,
  data: Record<string, unknown> | undefined,
  prevData: Record<string, unknown>,
  ctx: { now: unknown },
): EnvelopeWrite[] {
  const { now } = ctx
  // Clean the caller's payload once: no write below can carry an `undefined` (which
  // Firestore/DynamoDB reject, even nested inside an array element).
  const next = data ? stripUndefinedDeep(data) : {}
  const writes: EnvelopeWrite[] = []

  // 1. Entity write + rev bump.
  if (m.op === 'delete') {
    writes.push({ target: 'entity', op: 'delete' })
  } else if (m.op === 'create') {
    writes.push({
      target: 'entity', op: 'set',
      data: { ...next, createdAt: now, updatedAt: now, updatedBy: m.actor.uid, rev: 1 },
    })
  } else {
    const nextRev = ((prevData['rev'] as number) ?? 0) + 1
    writes.push({
      target: 'entity', op: 'update',
      data: { ...next, updatedAt: now, updatedBy: m.actor.uid, rev: nextRev },
    })
  }

  // 2. Audit event (append-only).
  writes.push({
    target: 'audit', op: 'set',
    data: {
      actor: m.actor, action: m.op, entityType: m.entityType,
      entityPath: m.path, productId: m.productId ?? null, at: now,
    },
  })

  // 3. Version snapshot with field-level diff.
  writes.push({
    target: 'version', op: 'set',
    data: {
      entityType: m.entityType, entityPath: m.path, productId: m.productId ?? null,
      snapshot: m.op !== 'delete' ? (data ? next : null) : null,
      diff: computeDiff(prevData, next), actor: m.actor, at: now,
    },
  })

  // 4. SearchIndex upsert/delete — indexable types only, in the SAME atomic unit.
  if (INDEXABLE.has(m.entityType)) {
    if (m.op === 'delete') {
      writes.push({ target: 'searchIndex', op: 'delete' })
    } else if (data) {
      writes.push({ target: 'searchIndex', op: 'set', data: searchIndexEntry(m.entityType, m.path, next) })
    }
  }

  return writes
}
