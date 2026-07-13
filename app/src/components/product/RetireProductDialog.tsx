// RetireProductDialog — soft-retire a LAUNCHED product.
// Sets lifecycle → RETIRED and status → INACTIVE via adapter.db.mutate().
// The product record remains in Cosmos and the audit trail is preserved;
// it simply disappears from the active portfolio view.
// Guarded by a typed-name confirmation identical to DeleteProductDialog.
import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, Button } from '../ui'
import { IconSpinner, IconWarning } from '../ui/icons'
import { adapter } from '../../lib/backend'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

interface Props {
  product: WithId<Product>
  actor:   { uid: string; name: string }
  onClose: () => void
  onRetired: () => void
}

export function RetireProductDialog({ product, actor, onClose, onRetired }: Props) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy]   = useState(false)
  const target  = product.name.trim()
  const matches = typed.trim() === target

  async function retire() {
    if (!matches || busy) return
    setBusy(true)
    try {
      const { id, rev, ...rest } = product
      await adapter.db.mutate({
        op: 'update',
        path: `products/${id}`,
        data: { ...rest, lifecycle: 'RETIRED', status: 'INACTIVE', updatedBy: actor.uid },
        entityType: 'product',
        actor,
        expectedRev: rev,
      })
      toast.success(`"${product.name}" retired`)
      onRetired()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not retire the product.')
      setBusy(false)
    }
  }

  return (
    <Dialog open title="Retire product" onClose={busy ? () => {} : onClose} width="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-[12px] p-3.5"
          style={{ background: 'var(--color-warn-soft)', border: '1px solid var(--color-warn-line)' }}>
          <IconWarning size={16} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm text-dim leading-relaxed">
            Retire <span className="font-semibold text-text">{product.name}</span>. The product will be
            marked <span className="font-mono text-[12px] text-warn">RETIRED</span> and hidden from the
            active portfolio. Its data, audit trail and rating history are preserved and can be reviewed
            in the archived view. This action can be undone by an admin.
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="retire-product-confirm" className="text-sm text-dim">
            Type the product name <span className="font-mono text-text">{target}</span> to confirm:
          </label>
          <input
            id="retire-product-confirm"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && matches) void retire() }}
            autoComplete="off"
            aria-invalid={typed.length > 0 && !matches}
            placeholder={target}
            className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
            style={{ borderColor: typed.length > 0 && !matches ? 'var(--color-danger)' : 'var(--color-border-strong)' }}
          />
          {typed.length > 0 && !matches && (
            <span className="flex items-center gap-1 text-[11px] text-danger">
              <IconWarning size={12} aria-hidden="true" /> Doesn&apos;t match — retirement stays disabled.
            </span>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="ghost"
            onClick={() => void retire()}
            disabled={!matches || busy}
            className="text-warn border-warn/40 hover:bg-warn/10"
          >
            {busy
              ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" />
              : <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 9l6 6M15 9l-6 6" /><circle cx="12" cy="12" r="9" /></svg>
            }
            Retire product
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
