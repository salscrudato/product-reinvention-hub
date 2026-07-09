// DeleteDraftDialog — in-app confirmation for permanently deleting a draft product and
// everything it owns (coverages, rules, forms, tasks). Draft-only + EDITOR/ADMIN, matching
// the Firestore rules and the deleteDraftProduct cascade. No native window.confirm.
import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, Button } from '../ui'
import { IconSpinner, IconWarning } from '../ui/icons'
import { deleteDraftProduct } from '../../lib/product/deleteDraft'

interface Props {
  product: { id: string; name: string; lifecycle?: string }
  actor: { uid: string; name: string }
  onClose: () => void
  onDeleted: () => void
}

export function DeleteDraftDialog({ product, actor, onClose, onDeleted }: Props) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await deleteDraftProduct(product, actor)
      toast.success(`Deleted “${product.name}”`)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the draft.')
      setBusy(false)
    }
  }

  return (
    <Dialog open title="Delete draft" onClose={busy ? () => {} : onClose} width="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-[12px] p-3.5 bg-danger/10" style={{ border: '1px solid var(--color-border)' }}>
          <IconWarning size={16} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm text-dim">
            Permanently delete <span className="font-semibold text-text">{product.name}</span> and everything it
            contains — its coverages, rules, forms and lifecycle tasks. This can&apos;t be undone.
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
            {busy ? 'Deleting…' : 'Delete draft'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
