// DeleteDraftDialog — TWO-STEP confirmation for permanently deleting a draft product
// and everything it owns (P3 directive 09). Step 1 states the real consequence with
// LIVE counts (coverages/forms from the Builder's inventory); step 2 is the final
// destructive commit. The copy states permanence honestly: the server's delete is a
// hard Cosmos delete inside the atomic envelope — restore refuses across a delete —
// so there is NO recovery window, and the platform never stores the uploaded source
// file (only audit/version telemetry and the import run record survive).
import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, Button } from '../ui'
import { IconSpinner, IconWarning, IconArrowRight } from '../ui/icons'
import { deleteDraftProduct } from '../../lib/product/deleteDraft'

interface Props {
  product: { id: string; name: string; lifecycle?: string }
  actor: { uid: string; name: string }
  /** Live child counts (from the caller's inventory); undefined = still loading. */
  counts?: { coverages?: number; forms?: number }
  onClose: () => void
  onDeleted: () => void
}

const label = (n: number | undefined, singular: string, plural: string) =>
  n === undefined ? `its ${plural}` : `${n.toLocaleString('en-US')} ${n === 1 ? singular : plural}`

export function DeleteDraftDialog({ product, actor, counts, onClose, onDeleted }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
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
        <div className="flex items-start gap-2.5 rounded-[12px] p-3.5" style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-border)' }}>
          <IconWarning size={16} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm text-dim">
            {step === 1 ? (
              <>
                Deletes <span className="font-semibold text-text">{product.name}</span> and everything it
                contains — <span className="text-text">{label(counts?.forms, 'extracted form', 'extracted forms')}</span>,{' '}
                <span className="text-text">{label(counts?.coverages, 'coverage', 'coverages')}</span>, its rules
                and lifecycle tasks. Deletion is <span className="font-semibold text-text">permanent</span> — there
                is no recovery window and restore cannot resurrect a deleted draft. The platform does not keep the
                uploaded source file; only the audit trail and the import run record remain.
              </>
            ) : (
              <>
                Last confirmation: permanently delete <span className="font-semibold text-text">{product.name}</span>{' '}
                and {label(counts?.forms, 'extracted form', 'extracted forms')}? This cannot be undone.
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={step === 1 ? onClose : () => setStep(1)} disabled={busy}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step === 1 ? (
            <Button onClick={() => setStep(2)} data-autofocus>
              Continue <IconArrowRight size={13} aria-hidden="true" />
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
              {busy && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
              {busy ? 'Deleting…' : 'Delete draft'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
