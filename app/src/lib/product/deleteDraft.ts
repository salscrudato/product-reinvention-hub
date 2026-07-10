// Cascade-delete a product and everything it owns, through the adapter mutate seam so
// each removal is atomic (entity + audit + version + searchIndex). Children are removed
// first so the product doc remains the recoverable "handle" until the very end.
//
// Two entry points share ONE cascade:
//   • deleteProduct      — general; deletes ANY product. Used by the Products portfolio
//     behind a typed-name confirmation (DeleteProductDialog).
//   • deleteDraftProduct — the Builder's draft-only path; refuses a LAUNCHED product so a
//     published product can never be destroyed by a stray click in the Drafts workbench.
import { adapter } from '../backend'

interface DeletableProduct {
  id: string
  lifecycle?: string
}

// Product subcollections, paired with the entityType used when they were created.
const SUBCOLLECTIONS: Array<{ coll: string; entityType: string }> = [
  { coll: 'coverages',      entityType: 'coverage' },
  { coll: 'rules',          entityType: 'rule' },
  { coll: 'formRules',      entityType: 'formRule' },
  { coll: 'ratingPrograms', entityType: 'ratingProgram' },
]

/** The shared cascade: subcollection entities → lifecycle tasks → draft-namespaced forms
 *  → the product shell. No lifecycle guard — the caller decides what may be deleted. */
export async function deleteProduct(
  product: DeletableProduct,
  actor: { uid: string; name: string },
): Promise<void> {
  const pid = product.id

  // 1) Subcollection entities (coverages, rules, form-rules, rating programs).
  for (const { coll, entityType } of SUBCOLLECTIONS) {
    const docs = await adapter.db.list<{ id: string }>(`products/${pid}/${coll}`)
    for (const d of docs) {
      // Delete is last-write-wins: cascade deletes are idempotent, so no expectedRev needed.
      await adapter.db.mutate({ op: 'delete', path: `products/${pid}/${coll}/${d.id}`, entityType, productId: pid, actor })
    }
  }

  // 2) Lifecycle tasks for this product (top-level `tasks` collection).
  const tasks = await adapter.db.list<{ id: string }>('tasks', {
    where: [{ field: 'productId', op: '==', value: pid }],
  })
  for (const t of tasks) {
    // Delete is last-write-wins: cascade deletes are idempotent, so no expectedRev needed.
    await adapter.db.mutate({ op: 'delete', path: `tasks/${t.id}`, entityType: 'task', productId: pid, actor })
  }

  // 3) Draft-namespaced forms only. Scaffolded drafts mint forms with a `${pid}__` id and
  //    productRefIds:[pid]; the `${pid}__` guard guarantees we never touch a shared library
  //    form that other products also reference.
  const forms = await adapter.db.list<{ id: string; productRefIds?: string[] }>('forms', {
    where: [{ field: 'productRefIds', op: 'array-contains', value: pid }],
  })
  for (const f of forms) {
    if (!f.id.startsWith(`${pid}__`)) continue
    // Delete is last-write-wins: cascade deletes are idempotent, so no expectedRev needed.
    await adapter.db.mutate({ op: 'delete', path: `forms/${f.id}`, entityType: 'form', productId: pid, actor })
  }

  // 4) Finally the product shell itself.
  // Delete is last-write-wins: product deletion is the terminal step of a cascade, so no expectedRev needed.
  await adapter.db.mutate({ op: 'delete', path: `products/${pid}`, entityType: 'product', productId: pid, actor })
}

/** Builder path: DRAFTS only. Refuses a LAUNCHED product, then runs the shared cascade —
 *  a published product is never deletable from the Drafts workbench (it goes through the
 *  portfolio's DeleteProductDialog instead). */
export async function deleteDraftProduct(
  product: DeletableProduct,
  actor: { uid: string; name: string },
): Promise<void> {
  if (product.lifecycle === 'LAUNCHED') {
    throw new Error('Published products cannot be deleted from the Builder.')
  }
  await deleteProduct(product, actor)
}
