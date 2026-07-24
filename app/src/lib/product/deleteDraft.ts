// Cascade-delete a product and everything it owns. Delegates to the server-side
// POST /api/db/deleteProduct endpoint which runs every deletion through the atomic
// mutate envelope (entity + audit + version + searchIndex per entity) in a single
// server round-trip rather than N separate client calls.
//
// Two entry points:
//   • deleteProduct      — general; deletes ANY product. Used by the Products portfolio
//     behind a typed-name confirmation (DeleteProductDialog).
//   • deleteDraftProduct — the Builder's draft-only path; refuses a LAUNCHED product so a
//     published product can never be destroyed by a stray click in the Drafts workbench.
import { adapter } from '../backend'

interface DeletableProduct {
  id: string
  lifecycle?: string
}

/** Cascade-delete a product through the server-side envelope (single round-trip).
 *  actor is accepted for call-site compatibility but the server uses req.user. */
export async function deleteProduct(
  product: DeletableProduct,
  _actor: { uid: string; name: string },
): Promise<void> {
  await adapter.db.deleteProduct(product.id)
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
