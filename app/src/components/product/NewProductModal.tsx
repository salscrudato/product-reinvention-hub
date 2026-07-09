// Modal to create a DRAFT product shell plus a PM-curated lifecycle task set.
// The candidate tasks come from DEFAULT_TASK_TEMPLATES (the curated Product-Manufacture
// activity subset); every one is pre-selected and the PM deselects the irrelevant ones,
// so only the kept tasks are created with SLA-driven due dates.
import { useState, type FormEvent } from 'react'
import { adapter } from '../../lib/backend'
import { IconSpinner } from '../ui/icons'
import { useUser } from '../../context/useUser'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { DEFAULT_TASK_TEMPLATES, DEFAULT_LOB } from '@pf/shared'
import { PRODUCT_NAME_SUGGESTIONS, MARKET_SEGMENTS } from '../../lib/insurance/vocab'
import { blankLineage } from '../../lib/draft/draft'
import { BaseFormField } from './BaseFormField'
import { uploadAndIdentifyBaseForm } from '../../lib/product/baseForm'
import { TaskSelectList } from '../tasks/TaskSelectList'

interface Props { onClose: () => void; onCreated: (id: string) => void }

const ALL_TASK_INDEXES = new Set(DEFAULT_TASK_TEMPLATES.map((_, i) => i))

export function NewProductModal({ onClose, onCreated }: Props) {
  const { user }   = useUser()
  const [name,     setName]     = useState('')
  const [seg,      setSeg]      = useState('Personal Lines / Property')
  const [file,     setFile]     = useState<File | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  // Task selection — all candidates pre-selected; the PM deselects what doesn't apply.
  const [checkedTasks, setCheckedTasks] = useState<Set<number>>(() => new Set(ALL_TASK_INDEXES))
  const toggleTask = (i: number) => setCheckedTasks(prev => {
    const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n
  })
  const setAllTasks = (on: boolean) => setCheckedTasks(on ? new Set(ALL_TASK_INDEXES) : new Set())

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || !file) return
    setLoading(true); setError('')
    const actor     = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
    const pid       = `prod-${Date.now()}`
    const startDate = new Date()

    // A base coverage form is required — upload + identify it first; abort on failure.
    let baseForm
    try {
      baseForm = await uploadAndIdentifyBaseForm(file, actor, pid)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the base form.')
      setLoading(false)
      return
    }

    try {
      await adapter.db.mutate({
        op: 'create', path: `products/${pid}`,
        data: {
          refId: null, name: name.trim(),
          lob: { refId: DEFAULT_LOB.refId, name: DEFAULT_LOB.name },
          description: '', marketSegment: seg,
          owner: actor, status: 'ACTIVE', lifecycle: 'DRAFT',
          reviewStatus: 'NOT_STARTED', updatedBy: actor.uid,
          rev: 1, allStates: false, states: [],
          baseForm,
          lineage: blankLineage(actor),
        },
        entityType: 'product', actor,
      })
      // Seed only the selected tasks, with SLA-driven due dates.
      // dueAt = startDate + template.daysOffset calendar days. `order` follows the
      // kept-task sequence; the doc id keeps the template index so ids stay unique.
      let order = 0
      for (let i = 0; i < DEFAULT_TASK_TEMPLATES.length; i++) {
        if (!checkedTasks.has(i)) continue
        const tmpl  = DEFAULT_TASK_TEMPLATES[i]!
        const dueAt = new Date(startDate)
        dueAt.setDate(dueAt.getDate() + tmpl.daysOffset)
        await adapter.db.mutate({
          op: 'create', path: `tasks/task-${pid}-${i}`,
          data: {
            title: tmpl.title, column: tmpl.column, productId: pid,
            checklist: [], order: order++, dueAt: dueAt.toISOString(),
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
            updatedBy: actor.uid,
          },
          entityType: 'task', productId: pid, actor,
        })
      }
      onCreated(pid)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create product.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open title="New product" onClose={onClose} width="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <datalist id="np-names">{PRODUCT_NAME_SUGGESTIONS.map(n => <option key={n} value={n} />)}</datalist>
        <Input label="Product name" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Homeowners — HO-3 Special Form" list="np-names" autoComplete="off" required />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">Market segment</label>
          <select className="h-9 px-3 rounded-[10px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
            value={seg} onChange={e => setSeg(e.target.value)}>
            {MARKET_SEGMENTS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <BaseFormField file={file} onFile={setFile} disabled={loading} />

        {/* Lifecycle tasks — pre-selected; deselect the ones that don't apply. */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">Lifecycle tasks</label>
          <p className="text-xs text-dim">These tasks will be created for the product. Deselect any that don&apos;t apply.</p>
          <div className="max-h-[38vh] overflow-y-auto rounded-[10px] p-2 mt-0.5" style={{ border: '1px solid var(--color-border)' }}>
            <TaskSelectList
              templates={DEFAULT_TASK_TEMPLATES}
              checked={checkedTasks}
              onToggle={toggleTask}
              onSetAll={setAllTasks}
            />
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={loading || !name.trim() || !file}>
            {loading && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
            {loading ? 'Creating…' : 'Create product'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
