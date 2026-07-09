// DeleteProductDialog — permanently delete a PUBLISHED product and everything it owns
// (coverages, rules, forms, lifecycle tasks) from the Products portfolio. Guarded by:
//   • Role: EDITOR/ADMIN only (hidden for VIEWER here; enforced server-side by the
//     Firestore product-write rule — both sides, always).
//   • A TYPED confirmation: the user must type the product's exact name, so a published
//     product can never be destroyed by a stray click.
// Reuses the shared deleteProduct cascade (adapter mutate seam → atomic per removal).
// Sibling of the Builder's DeleteDraftDialog, which is a lighter confirm for cheap drafts.
import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, Button } from '../ui'
import { IconSpinner, IconTrash, IconWarning } from '../ui/icons'
import { deleteProduct } from '../../lib/product/deleteDraft'

interface Props {
  product: { id: string; name: string; lifecycle?: string }
  actor:   { uid: string; name: string }
  onClose: () => void
  onDeleted: () => void
}

export function DeleteProductDialog({ product, actor, onClose, onDeleted }: Props) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy]   = useState(false)
  const target  = product.name.trim()
  const matches = typed.trim() === target

  async function remove() {
    if (!matches || busy) return
    setBusy(true)
    try {
      await deleteProduct(product, actor)
      toast.success(`Deleted “${product.name}”`)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the product.')
      setBusy(false)
    }
  }

  return (
    <Dialog open title="Delete product" onClose={busy ? () => {} : onClose} width="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-[12px] p-3.5 bg-danger/10" style={{ border: '1px solid var(--color-border)' }}>
          <IconWarning size={16} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm text-dim">
            Permanently delete <span className="font-semibold text-text">{product.name}</span> and everything it
            contains — its coverages, rules, forms and lifecycle tasks. This removes it from the published
            portfolio and can&apos;t be undone.
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="delete-product-confirm" className="text-sm text-dim">
            Type the product name <span className="font-mono text-text">{target}</span> to confirm:
          </label>
          <input
            id="delete-product-confirm"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && matches) void remove() }}
            autoComplete="off"
            aria-invalid={typed.length > 0 && !matches}
            placeholder={target}
            className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
            style={{ borderColor: typed.length > 0 && !matches ? 'var(--color-danger)' : 'var(--color-border-strong)' }}
          />
          {typed.length > 0 && !matches && (
            <span className="flex items-center gap-1 text-[11px] text-danger">
              <IconWarning size={12} aria-hidden="true" /> Doesn&apos;t match — deletion stays disabled.
            </span>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={() => void remove()} disabled={!matches || busy}>
            {busy ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : <IconTrash size={14} aria-hidden="true" />}
            Delete product
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
