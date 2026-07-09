// CoverageFormsDialog — view and edit which forms are attached to a coverage.
// For each form number in coverage.formNumbers it looks up the live form documents
// (from the product context) to surface edition dates and state applicability.
// Multiple editions of the same number are shown separately so the PM can see
// which edition is filed where. Edits write only coverage.formNumbers via mutate().
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { Dialog, Button, EmptyState, RefChip } from '../ui'
import { IconForm, IconClose, IconPlus, IconTrash, IconSearch, IconStates } from '../ui/icons'
import { resolveLob } from '@pf/shared'
import type { Coverage, Form } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

interface Props { cov: WithId<Coverage>; onClose: () => void }

export function CoverageFormsDialog({ cov, onClose }: Props) {
  const { pid, product, forms } = useProductCtx()
  const navigate = useNavigate()
  // Deep link a form-number chip to the Forms tab (…/forms?form=<number>), closing
  // this dialog first so the drawer there opens cleanly.
  const openForm = (num: string) => { onClose(); navigate(`/app/products/${pid}/forms?form=${encodeURIComponent(num)}`) }
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }

  const [formNumbers, setFormNumbers] = useState<string[]>(() => cov.formNumbers ?? [])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

	  // The product footprint for state counts — derived from the line's footprint
	  // and the product's own state scope so counts never exceed the denominator.
	  const lob = resolveLob(product)
	  const productFootprintStates = (product?.allStates
	    ? (product?.states?.length ? product.states : lob.footprintStates)
	    : (product?.states ?? lob.footprintStates)
	  ).filter(st => lob.footprintStates.includes(st))
	  const footprintSize = productFootprintStates.length

  // For each form number in coverage.formNumbers, collect all matching form docs
  // (multiple editions of the same number may exist in the product's form library).
  const attachedGroups = useMemo(() => {
    return formNumbers.map(num => {
      const matches = forms.filter(f => f.number === num)
      return { number: num, docs: matches }
    })
  }, [formNumbers, forms])

  // Forms in the product library that are NOT yet attached.
  const unattached = useMemo(() => {
    const attached = new Set(formNumbers)
    const seen = new Set<string>()
    return forms.filter(f => {
      if (attached.has(f.number) || seen.has(f.number)) return false
      seen.add(f.number)
      return true
    })
  }, [formNumbers, forms])

  const filtered = useMemo(() => {
    if (!search.trim()) return unattached
    const q = search.toLowerCase()
    return unattached.filter(f =>
      f.number.toLowerCase().includes(q) || f.name.toLowerCase().includes(q) ||
      f.edition.toLowerCase().includes(q)
    )
  }, [unattached, search])

  function attach(num: string) {
    if (!canEdit || formNumbers.includes(num)) return
    setFormNumbers(prev => [...prev, num])
  }

  function detach(num: string) {
    if (!canEdit) return
    setFormNumbers(prev => prev.filter(n => n !== num))
  }

  async function save() {
    if (!canEdit) return
    setSaving(true)
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/coverages/${cov.id}`,
        data: { formNumbers },
        entityType: 'coverage', productId: pid, actor,
        expectedRev: (cov as { rev?: number }).rev,
      })
      toast.success('Forms saved')
      onClose()
    } catch (err) {
      toast.error(err instanceof MutationConflictError
        ? 'Conflict — this coverage changed elsewhere. Please reopen.'
        : err instanceof Error ? err.message : 'Save failed')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onClose={onClose} width="max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white shrink-0"
            style={{ background: 'var(--gradient-accent)' }}>
            <IconForm size={22} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-text">Forms</h2>
            <p className="text-sm text-dim">{cov.name}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close"
          className="text-faint hover:text-text rounded-[8px] p-1.5 hover:bg-raised transition-colors">
          <IconClose size={18} />
        </button>
      </div>

      <div className="flex flex-col gap-5 max-h-[62vh] overflow-y-auto pr-1 -mr-1">
        {/* ─ Attached forms ─────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">
              Attached forms
            </p>
            <span className="text-[11px] text-faint tnum">{formNumbers.length}</span>
          </div>

          {formNumbers.length === 0 ? (
            <EmptyState compact icon={<IconForm size={26} />}
              title="No forms attached"
              description="Add forms from the product library below to associate them with this coverage." />
          ) : (
            <div className="flex flex-col gap-2">
              {attachedGroups.map(({ number, docs }) => (
                <AttachedFormRow key={number} number={number} docs={docs}
                  footprintSize={footprintSize} canEdit={canEdit}
                  onOpen={() => openForm(number)}
                  onDetach={() => detach(number)} />
              ))}
            </div>
          )}
        </section>

        {/* ─ Add from library ───────────────────────────────────────────── */}
        {canEdit && (
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mb-2.5">
              Add from product library
            </p>
            {forms.length === 0 ? (
              <p className="text-sm text-faint text-center py-4">No forms in this product's library yet.</p>
            ) : unattached.length === 0 ? (
              <p className="text-sm text-faint text-center py-4">All product forms are already attached.</p>
            ) : (
              <>
                <div className="relative mb-3">
                  <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by number, name or edition…"
                    className="w-full h-9 pl-9 pr-3 rounded-[9px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25" />
                </div>
                {filtered.length === 0 ? (
                  <p className="text-sm text-faint text-center py-3">No forms match "{search}".</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {filtered.map(f => (
                      <LibraryFormRow key={f.id} form={f} footprintSize={footprintSize}
                        onAttach={() => attach(f.number)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 mt-5 pt-4"
        style={{ borderTop: '1px solid var(--color-border)' }}>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        {canEdit && (
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </div>
    </Dialog>
  )
}

// ─── Attached form row ────────────────────────────────────────────────────────
// Shows a form number chip + all editions found in the product library, each
// with its edition date and state scope.

function AttachedFormRow({ number, docs, footprintSize, canEdit, onOpen, onDetach }: {
  number: string; docs: WithId<Form>[]; footprintSize: number
  canEdit: boolean; onOpen: () => void; onDetach: () => void
}) {
  return (
    <div className="rounded-[10px] bg-surface" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <RefChip id={number} tone="accent" onClick={onOpen} title={`Open ${number} in Forms`} />
        <div className="flex-1 min-w-0">
          {docs.length === 0 ? (
            <p className="text-sm text-dim italic">Not found in product library</p>
          ) : (
            <div className="flex flex-col gap-1">
              {docs.map(f => (
                <FormEditionLine key={f.id} form={f} footprintSize={footprintSize} />
              ))}
            </div>
          )}
        </div>
        {canEdit && (
          <button onClick={onDetach} aria-label={`Remove ${number}`}
            className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[var(--color-danger-hover)] transition-colors shrink-0">
            <IconTrash size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Library form row ─────────────────────────────────────────────────────────
// Shows a form from the product library that can be attached.

function LibraryFormRow({ form, footprintSize, onAttach }: {
  form: WithId<Form>; footprintSize: number; onAttach: () => void
}) {
  return (
    <button onClick={onAttach}
      className="group flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] bg-surface hover:bg-raised transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      style={{ border: '1px solid var(--color-border)' }}>
      <RefChip id={form.number} />
      <div className="flex-1 min-w-0">
        <FormEditionLine form={form} footprintSize={footprintSize} />
      </div>
      <span className="shrink-0 flex items-center gap-1 text-xs font-medium text-faint group-hover:text-accent transition-colors">
        <IconPlus size={13} />Attach
      </span>
    </button>
  )
}

// ─── Form edition line ────────────────────────────────────────────────────────
// One line inside a form row: name + edition chip + state scope pill.

function FormEditionLine({ form, footprintSize }: { form: WithId<Form>; footprintSize: number }) {
  const stateCount = form.allStates ? footprintSize : (form.states?.length ?? 0)

  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      <span className="text-sm font-medium text-text truncate flex-1 min-w-0">{form.name}</span>
      {form.edition && (
        <span className="font-mono text-[11px] text-faint shrink-0 px-1.5 py-0.5 rounded-[5px] bg-raised">
          Ed. {form.edition}
        </span>
      )}
      <span className={`flex items-center gap-1 text-[11px] shrink-0 ${stateCount > 0 ? 'text-dim' : 'text-faint'}`}>
        <IconStates size={11} />
        <span className="tnum">{form.allStates ? 'All states' : `${stateCount} state${stateCount === 1 ? '' : 's'}`}</span>
      </span>
      {form.category !== 'BASE_COVERAGE' && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] bg-raised text-dim font-medium shrink-0">
          {form.category.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}
        </span>
      )}
    </div>
  )
}
