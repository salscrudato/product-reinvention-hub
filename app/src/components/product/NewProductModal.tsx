// Modal to create a DRAFT product shell and auto-seed the default task set.
import { useState, type FormEvent } from 'react'
import { adapter } from '../../lib/backend'
import { IconSpinner } from '../ui/icons'
import { useUser } from '../../context/useUser'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { HO3_DEFAULT_TASK_TEMPLATES, DEFAULT_LOB } from '@pf/shared'
import { PRODUCT_NAME_SUGGESTIONS, MARKET_SEGMENTS } from '../../lib/insurance/vocab'

interface Props { onClose: () => void; onCreated: (id: string) => void }

export function NewProductModal({ onClose, onCreated }: Props) {
  const { user }   = useUser()
  const [name,     setName]     = useState('')
  const [seg,      setSeg]      = useState('Personal Lines / Property')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setLoading(true); setError('')
    const actor  = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
    const pid    = `prod-${Date.now()}`
    const baseDate = new Date()
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
          health: { score: 100, findingCount: 0, updatedAt: null },
        },
        entityType: 'product', actor,
      })
      // Auto-seed default tasks
      for (let i = 0; i < HO3_DEFAULT_TASK_TEMPLATES.length; i++) {
        const tmpl  = HO3_DEFAULT_TASK_TEMPLATES[i]
        const dueAt = new Date(baseDate)
        dueAt.setDate(dueAt.getDate() + tmpl.daysOffset)
        await adapter.db.mutate({
          op: 'create', path: `tasks/task-${pid}-${i}`,
          data: {
            title: tmpl.title, column: tmpl.column, productId: pid,
            checklist: [], order: i, dueAt: dueAt.toISOString(),
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
    <Dialog open title="New product" onClose={onClose} width="max-w-md">
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
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={loading || !name.trim()}>
            {loading && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
            Create product
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
