// importProduct.ts — persists a mapped ISO ImportPlan into Firestore. EVERY entity
// is written through adapter.db.mutate() (one call = entity + audit + version +
// searchIndex + rev, atomically) — there is no other write path, so the mutation
// invariant holds for imports exactly as it does for hand edits. Writes run in
// dependency order (product → tables → coverages parent-before-child → forms →
// rules → form rules → rating program) so parentId always resolves and the product
// doc exists before its sub-collections. Individual row failures are collected, not
// fatal, so one bad row never abandons a large import — except a failed product,
// which aborts (its children would be orphaned).
import { adapter } from '../backend'
import type { ImportPlan, PlannedEntity } from '@pf/shared'

export interface ImportActor { uid: string; name: string }
export interface ImportProgress { done: number; total: number; label: string }
export interface ImportResult { productId: string; written: number; failed: number; errors: string[] }

// Where each planned group lands + how mutate() should tag it.
type Group = { entityType: string; path: (docId: string, productId: string) => string; underProduct: boolean }
const GROUPS: Record<string, Group> = {
  coverage:      { entityType: 'coverage',      underProduct: true,  path: (id, pid) => `products/${pid}/coverages/${id}` },
  form:          { entityType: 'form',          underProduct: false, path: (id)      => `forms/${id}` },
  rule:          { entityType: 'rule',          underProduct: true,  path: (id, pid) => `products/${pid}/rules/${id}` },
  formRule:      { entityType: 'formRule',      underProduct: true,  path: (id, pid) => `products/${pid}/formRules/${id}` },
  ratingProgram: { entityType: 'ratingProgram', underProduct: true,  path: (id, pid) => `products/${pid}/ratingPrograms/${id}` },
  ldTable:       { entityType: 'ldTable',       underProduct: false, path: (id)      => `ldTables/${id}` },
  rtTable:       { entityType: 'rtTable',       underProduct: false, path: (id)      => `rtTables/${id}` },
}

/** Persist a mapped plan. Calls `onProgress` after each write so the UI can show a
 *  live counter. Returns counts + any per-row errors that were skipped. */
export async function importPlan(
  plan: ImportPlan,
  actor: ImportActor,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  if (!plan.product || !plan.productId) throw new Error('Import plan has no product to create.')
  const productId = plan.productId

  const total =
    1 + plan.ldTables.length + plan.rtTables.length + plan.coverages.length +
    plan.forms.length + plan.rules.length + plan.formRules.length + (plan.ratingProgram ? 1 : 0)

  let written = 0, failed = 0
  const errors: string[] = []
  const tick = (label: string) => onProgress?.({ done: written + failed, total, label })

  // Product first — abort if it can't be created (its children need it).
  tick(plan.product.label)
  await adapter.db.mutate({
    op: 'create', path: `products/${productId}`, entityType: 'product', productId, actor,
    data: { ...plan.product.data, owner: { uid: actor.uid, name: actor.name } },
  })
  written++
  tick(plan.product.label)

  // Remaining groups, in dependency order (coverages are pre-sorted parent-first).
  const ordered: [keyof typeof GROUPS, PlannedEntity[]][] = [
    ['ldTable', plan.ldTables],
    ['rtTable', plan.rtTables],
    ['coverage', plan.coverages],
    ['form', plan.forms],
    ['rule', plan.rules],
    ['formRule', plan.formRules],
    ['ratingProgram', plan.ratingProgram ? [plan.ratingProgram] : []],
  ]

  for (const [kind, entities] of ordered) {
    const g = GROUPS[kind]
    for (const e of entities) {
      tick(e.label)
      try {
        await adapter.db.mutate({
          op: 'create', path: g.path(e.docId, productId), entityType: g.entityType,
          ...(g.underProduct ? { productId } : {}), actor, data: e.data,
        })
        written++
      } catch (err) {
        failed++
        errors.push(`${e.label}: ${err instanceof Error ? err.message : String(err)}`)
      }
      tick(e.label)
    }
  }

  return { productId, written, failed, errors }
}
