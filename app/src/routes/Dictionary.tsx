// Data Dictionary (/app/dictionary) — reusable field definitions with audited
// create/edit/delete. Each card shows type, description, allowed values, format,
// tags and "used in" backlinks.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { IconBook, IconPlus, IconSearch, IconTrash, IconLink } from '../components/ui/icons'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Button, Input, Dialog, Skeleton, EmptyState } from '../components/ui'
import type { DictionaryEntry, DynamicFieldType } from '@pf/shared'

type DictDoc = DictionaryEntry & { id: string }

const TYPES: DynamicFieldType[] = ['TEXT', 'CURRENCY', 'DATE', 'LIST', 'PERCENT']
const TYPE_COLOR: Record<DynamicFieldType, 'blue' | 'good' | 'purple' | 'warn' | 'default'> = {
  TEXT: 'default', CURRENCY: 'good', DATE: 'blue', LIST: 'purple', PERCENT: 'warn',
}

// Map an entity path (e.g. products/HO.PROD.001/coverages/x) to an in-app route.
function pathToRoute(entityPath: string): string {
  const parts = entityPath.split('/')
  const pid = parts[1] ?? 'HO.PROD.001'
  if (entityPath.includes('/coverages')) return `/app/products/${pid}/coverages`
  if (entityPath.includes('/rules'))     return `/app/products/${pid}/rules`
  if (entityPath.startsWith('forms'))    return `/app/products/${pid}/forms`
  if (entityPath.startsWith('products')) return `/app/products/${pid}/overview`
  return '/app/explorer'
}

interface Draft { id?: string; name: string; type: DynamicFieldType; description: string; allowedValues: string; format: string; tags: string; source?: DictDoc }
const EMPTY_DRAFT: Draft = { name: '', type: 'TEXT', description: '', allowedValues: '', format: '', tags: '' }

export default function Dictionary() {
  const navigate = useNavigate()
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'

  const [entries, setEntries] = useState<DictDoc[] | null>(null)
  const [query, setQuery]     = useState('')
  const [typeFilter, setTypeFilter] = useState<DynamicFieldType | ''>('')
  const [draft, setDraft]     = useState<Draft | null>(null)
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    const unsub = adapter.db.subscribe<DictDoc>('dictionary', d => { if (Array.isArray(d)) setEntries(d) })
    return unsub
  }, [])

  const visible = useMemo(() => {
    let list = entries ?? []
    if (typeFilter) list = list.filter(e => e.type === typeFilter)
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(e => `${e.name} ${e.description} ${(e.tags ?? []).join(' ')}`.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [entries, query, typeFilter])

  async function save() {
    if (!draft || !user) return
    const name = draft.name.trim()
    if (!name) { toast.error('Name is required'); return }
    setSaving(true)
    const actor = { uid: user.uid, name: user.name ?? user.email ?? 'User' }
    const allowedValues = draft.allowedValues.split(',').map(s => s.trim()).filter(Boolean)
    const tags          = draft.tags.split(',').map(s => s.trim()).filter(Boolean)

    try {
      if (draft.source) {
        // Update — spread the full current entity so the version diff is clean.
        const { id, ...rest } = draft.source
        await adapter.db.mutate({
          op: 'update', path: `dictionary/${id}`,
          data: { ...rest, name, type: draft.type, description: draft.description.trim(), allowedValues, format: draft.format.trim(), tags },
          entityType: 'dictionary', actor, expectedRev: draft.source.rev,
        })
        toast.success('Field updated')
      } else {
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID()
        await adapter.db.mutate({
          op: 'create', path: `dictionary/${id}`,
          data: {
            name, type: draft.type, description: draft.description.trim(), allowedValues, format: draft.format.trim(), tags,
            usedIn: [], status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
          },
          entityType: 'dictionary', actor,
        })
        toast.success('Field created')
      }
      setDraft(null)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!draft?.source || !user) return
    if (!window.confirm(`Delete the “${draft.source.name}” field? This can be restored from version history.`)) return
    setSaving(true)
    try {
      await adapter.db.mutate({
        op: 'delete', path: `dictionary/${draft.source.id}`,
        entityType: 'dictionary', actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
      })
      toast.success('Field deleted')
      setDraft(null)
    } catch {
      toast.error('Delete failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Data Dictionary</h1>
          <p className="text-sm text-dim">Canonical field definitions, reused across coverages and forms.</p>
        </div>
        {canEdit && (
          <Button variant="primary" size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <IconPlus size={14} /> New field
          </Button>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search fields…" leftIcon={<IconSearch size={14} />} className="max-w-xs" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setTypeFilter('')} aria-pressed={typeFilter === ''}
            className={`px-2.5 py-1 rounded-[8px] text-xs font-medium ${typeFilter === '' ? 'bg-accent-soft text-accent' : 'bg-surface text-dim'}`} style={{ border: '1px solid var(--color-border)' }}>All</button>
          {TYPES.map(t => (
            <button key={t} onClick={() => setTypeFilter(t === typeFilter ? '' : t)} aria-pressed={typeFilter === t}
              className={`px-2.5 py-1 rounded-[8px] text-xs font-medium ${typeFilter === t ? 'bg-accent-soft text-accent' : 'bg-surface text-dim'}`} style={{ border: '1px solid var(--color-border)' }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {entries === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<IconBook size={28} />} title={query || typeFilter ? 'No matching fields' : 'No dictionary fields yet'}
          description={query || typeFilter ? 'Try a different search or type.' : 'Define your first reusable field.'}
          action={canEdit && !query && !typeFilter ? <Button variant="primary" size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}><IconPlus size={14} /> New field</Button> : undefined} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(e => (
            <button key={e.id} onClick={() => canEdit && setDraft({ id: e.id, name: e.name, type: e.type, description: e.description, allowedValues: (e.allowedValues ?? []).join(', '), format: e.format ?? '', tags: (e.tags ?? []).join(', '), source: e })}
              className={`text-left bg-surface rounded-[16px] p-4 flex flex-col gap-3 transition-all ${canEdit ? 'hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5' : 'cursor-default'}`}
              style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-sm text-text">{e.name}</span>
                <Badge label={e.type} color={TYPE_COLOR[e.type]} />
              </div>
              {e.description && <p className="text-xs text-dim leading-relaxed line-clamp-3">{e.description}</p>}
              {e.format && <span className="text-[11px] font-mono text-faint">format: {e.format}</span>}
              {(e.allowedValues ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {e.allowedValues.slice(0, 4).map(v => <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded-[5px] bg-raised text-dim">{v}</span>)}
                  {e.allowedValues.length > 4 && <span className="text-[10px] text-faint">+{e.allowedValues.length - 4}</span>}
                </div>
              )}
              {(e.tags ?? []).length > 0 && <div className="flex flex-wrap gap-1">{e.tags.map(t => <Badge key={t} label={t} color="default" />)}</div>}
              {(e.usedIn ?? []).length > 0 && (
                <div className="flex flex-col gap-1 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <span className="text-[10px] uppercase tracking-wide text-faint">Used in</span>
                  {e.usedIn.slice(0, 3).map((u, i) => (
                    <span key={i} role="link" tabIndex={0}
                      onClick={ev => { ev.stopPropagation(); navigate(pathToRoute(u.entityPath)) }}
                      onKeyDown={ev => { if (ev.key === 'Enter') { ev.stopPropagation(); navigate(pathToRoute(u.entityPath)) } }}
                      className="flex items-center gap-1 text-[11px] text-accent hover:underline cursor-pointer">
                      <IconLink size={10} /> {u.label}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Editor dialog */}
      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.source ? 'Edit field' : 'New field'}>
        {draft && (
          <div className="flex flex-col gap-4">
            <Input label="Name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Coverage A" autoFocus />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text" htmlFor="dict-type">Type</label>
              <select id="dict-type" value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value as DynamicFieldType })}
                className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25" style={{ borderColor: 'var(--color-border-strong)' }}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text" htmlFor="dict-desc">Description</label>
              <textarea id="dict-desc" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} rows={3}
                className="rounded-[10px] bg-surface border text-sm text-text p-3 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none" style={{ borderColor: 'var(--color-border-strong)' }} placeholder="What this field means…" />
            </div>
            <Input label="Allowed values (comma-separated)" value={draft.allowedValues} onChange={e => setDraft({ ...draft, allowedValues: e.target.value })} placeholder="50, 70, 75" />
            <Input label="Format" value={draft.format} onChange={e => setDraft({ ...draft, format: e.target.value })} placeholder="USD, percent, ISO-8601…" />
            <Input label="Tags (comma-separated)" value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} placeholder="rating, limits" />

            <div className="flex items-center justify-between pt-2">
              {draft.source
                ? <Button variant="destructive" size="sm" onClick={remove} disabled={saving}><IconTrash size={14} /> Delete</Button>
                : <span />}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={save} disabled={saving || !draft.name.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
