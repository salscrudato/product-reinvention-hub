// versionRead.ts — PCM-B: bridge from the server's version documents to the
// client Version contract. Server docs carry {entityPath, rev, op,
// diff:{before,changed}, actor, at} — no snapshot (so restore stays hidden:
// we never invent one), and no productId/entityType (derived here from the
// entityPath, which is authoritative).
import type { Version, VersionDiff } from '@pf/shared'

export interface ServerVersionRow {
  id: string
  entityPath: string
  rev: number
  op: 'create' | 'update' | 'delete'
  diff: { before?: Record<string, unknown>; changed?: Record<string, unknown> } | null
  actor: { uid: string; name: string }
  at: unknown
}

// products/{pid}/<segment>/… → client entityType. Version docs read from a
// product's partition can only carry the product subtree's collections.
const SEG_TO_TYPE: Record<string, string> = {
  coverages: 'coverage',
  rules: 'rule',
  formRules: 'formRule',
  ratingPrograms: 'ratingProgram',
  forms: 'form',
}

export function mapServerVersionRow(row: ServerVersionRow): Version & { id: string } {
  const parts = row.entityPath.split('/').filter(Boolean)
  const productId = parts[0] === 'products' ? parts[1] : undefined
  const entityType = SEG_TO_TYPE[parts[2] ?? ''] ?? (parts[0] === 'products' ? 'product' : parts[0])
  const fields = row.diff ? Object.keys({ ...(row.diff.before ?? {}), ...(row.diff.changed ?? {}) }) : []
  const diff: VersionDiff[] = fields.map(field => ({
    field,
    before: row.diff?.before?.[field],
    after: row.diff?.changed?.[field],
  }))
  return {
    id: row.id,
    entityType,
    entityPath: row.entityPath,
    productId,
    snapshot: null,
    diff,
    actor: row.actor,
    at: row.at,
    op: row.op,
    rev: row.rev,
  }
}

// Honest action badge: trust the recorded op; fall back to the legacy
// snapshot heuristic only for rows that predate the op field.
export function versionAction(v: Pick<Version, 'snapshot' | 'diff'> & { op?: Version['op'] }): 'create' | 'update' | 'delete' {
  if (v.op) return v.op
  if (v.snapshot == null) return 'delete'
  const diff = v.diff ?? []
  if (diff.length > 0 && diff.every(d => d.before == null)) return 'create'
  return 'update'
}
