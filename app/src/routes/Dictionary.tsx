// Data Dictionary (/app/dictionary) — the governed catalogue of canonical fields/terms.
// Each entry carries a citable refId (the AI cites [HO.DEF.003]), a type, description,
// allowed values, format, tags and aliases. Its "used in" back-references are computed
// LIVE from the current coverages/rules/forms (never a stored snapshot, so they can't go
// stale) and rendered as deep links to the exact product tab. Every write goes through
// adapter.db.mutate() (atomic entity + audit + version + searchIndex).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { IconBook, IconPlus, IconSearch, IconTrash, IconEdit, IconCoverage, IconRule, IconForm } from '../components/ui/icons'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { useLiveCollection } from '../lib/useLiveCollection'
import { useDictionaryCorpus } from '../lib/useDictionaryCorpus'
import { Badge, Button, Input, Dialog, Skeleton, EmptyState, RefChip, LifecyclePill, ReviewPill } from '../components/ui'
import { computeDictionaryUsage } from '@pf/shared'
import type { DictionaryEntry, DynamicFieldType, DictUsageRef, DictUsageKind } from '@pf/shared'

type DictDoc = DictionaryEntry & { id: string }

const TYPES: DynamicFieldType[] = ['TEXT', 'CURRENCY', 'DATE', 'LIST', 'PERCENT']
const TYPE_COLOR: Record<DynamicFieldType, 'blue' | 'good' | 'purple' | 'warn' | 'default'> = {
  TEXT: 'default', CURRENCY: 'good', DATE: 'blue', LIST: 'purple', PERCENT: 'warn',
}
const KIND_ICON: Record<DictUsageKind, typeof IconCoverage> = { coverage: IconCoverage, rule: IconRule, form: IconForm }
const KIND_LABEL: Record<DictUsageKind, string> = { coverage: 'Coverage', rule: 'Rule', form: 'Form' }

/** Deep link a back-reference to the exact product tab the entity lives on, focusing it.
 *  Falls back to the Explorer when no owning product is known (e.g. an orphan form). */
function routeForUsage(u: DictUsageRef): string {
  if (!u.productId) return '/app/explorer'
  const tab = u.kind === 'coverage' ? 'coverages' : u.kind === 'rule' ? 'rules' : 'forms'
  return `/app/products/${u.productId}/${tab}?focus=${encodeURIComponent(u.refId)}`
}

/** Next neutral refId (DEF.NNN) for a user-created term — max existing trailing number +1,
 *  scanning all prefixes (HO.DEF/GL.DEF/DEF) so ids never collide across lines. */
function nextRefId(entries: DictDoc[]): string {
  const max = entries.reduce((m, e) => {
    const n = Number(/(\d+)\s*$/.exec(e.refId ?? '')?.[1] ?? '0')
    return Number.isFinite(n) && n > m ? n : m
  }, 0)
  return `DEF.${String(max + 1).padStart(3, '0')}`
}

interface Draft { name: string; type: DynamicFieldType; description: string; allowedValues: string; format: string; tags: string; aliases: string; source?: DictDoc }
const EMPTY_DRAFT: Draft = { name: '', type: 'TEXT', description: '', allowedValues: '', format: '', tags: '', aliases: '' }

export default function Dictionary() {
  const navigate = useNavigate()
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'

  const { items: entries, status } = useLiveCollection<DictDoc>('dictionary')
  const { corpus, status: corpusStatus } = useDictionaryCorpus()

  const [query, setQuery]     = useState('')
  const [typeFilter, setTypeFilter] = useState<DynamicFieldType | ''>('')
  const [draft, setDraft]     = useState<Draft | null>(null)
  const [saving, setSaving]   = useState(false)

  // Citation focus: /app/dictionary?term=HO.DEF.003 scrolls to + rings that entry.
  const [params, setParams] = useSearchParams()
  const focusTerm = params.get('term')?.toLowerCase() ?? ''
  const [flashId, setFlashId] = useState<string | null>(null)
  const cardRefs = useRef(new Map<string, HTMLElement>())

  // Live back-references, recomputed whenever the dictionary or the corpus changes.
  const usageByEntry = useMemo(() => {
    const map = new Map<string, DictUsageRef[]>()
    for (const e of entries) map.set(e.id, computeDictionaryUsage(e, corpus))
    return map
  }, [entries, corpus])

  const visible = useMemo(() => {
    let list = entries
    if (typeFilter) list = list.filter(e => e.type === typeFilter)
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(e => `${e.name} ${e.refId ?? ''} ${e.description} ${(e.tags ?? []).join(' ')} ${(e.aliases ?? []).join(' ')}`.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [entries, query, typeFilter])

  // Once entries are loaded, scroll the cited term into view and flash it.
  useEffect(() => {
    if (!focusTerm || status !== 'ready') return
    const target = entries.find(e => (e.refId ?? '').toLowerCase() === focusTerm || e.id === focusTerm)
    if (!target) return
    setFlashId(target.id)
    const el = cardRefs.current.get(target.id)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const clear = setTimeout(() => setFlashId(null), 2200)
    // Consume the param so a later edit/nav doesn't re-trigger the flash.
    const next = new URLSearchParams(params); next.delete('term'); setParams(next, { replace: true })
    return () => clearTimeout(clear)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTerm, status, entries])

  async function save() {
    if (!draft || !user) return
    const name = draft.name.trim()
    if (!name) { toast.error('Name is required'); return }
    setSaving(true)
    const actor = { uid: user.uid, name: user.name ?? user.email ?? 'User' }
    const split = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)
    const allowedValues = split(draft.allowedValues)
    const tags          = split(draft.tags)
    const aliases       = split(draft.aliases)

    try {
      if (draft.source) {
        // Update — spread the full current entity so the version diff is clean, then
        // overwrite the editable fields (refId + governance are preserved from source).
        const { id, ...rest } = draft.source
        await adapter.db.mutate({
          op: 'update', path: `dictionary/${id}`,
          data: { ...rest, name, type: draft.type, description: draft.description.trim(), allowedValues, format: draft.format.trim(), tags, aliases },
          entityType: 'dictionary', actor, expectedRev: draft.source.rev,
        })
        toast.success('Field updated')
      } else {
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID()
        await adapter.db.mutate({
          op: 'create', path: `dictionary/${id}`,
          data: {
            refId: nextRefId(entries),
            name, type: draft.type, description: draft.description.trim(), allowedValues, format: draft.format.trim(), tags, aliases,
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
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

  function openEditor(e: DictDoc) {
    setDraft({
      name: e.name, type: e.type, description: e.description,
      allowedValues: (e.allowedValues ?? []).join(', '), format: e.format ?? '',
      tags: (e.tags ?? []).join(', '), aliases: (e.aliases ?? []).join(', '), source: e,
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Data Dictionary</h1>
          <p className="text-sm text-dim">Governed field definitions — cited by the assistant and back-linked to where they’re used.</p>
        </div>
        {canEdit && (
          <Button variant="primary" size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <IconPlus size={14} /> New field
          </Button>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search fields…" leftIcon={<IconSearch size={14} />} className="max-w-xs" aria-label="Search dictionary fields" />
        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter by type">
          <button onClick={() => setTypeFilter('')} aria-pressed={typeFilter === ''}
            className={`px-2.5 py-1 rounded-[8px] text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${typeFilter === '' ? 'bg-accent-soft text-accent' : 'bg-surface text-dim'}`} style={{ border: '1px solid var(--color-border)' }}>All</button>
          {TYPES.map(t => (
            <button key={t} onClick={() => setTypeFilter(t === typeFilter ? '' : t)} aria-pressed={typeFilter === t}
              className={`px-2.5 py-1 rounded-[8px] text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${typeFilter === t ? 'bg-accent-soft text-accent' : 'bg-surface text-dim'}`} style={{ border: '1px solid var(--color-border)' }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {status === 'loading' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
        </div>
      ) : status === 'error' ? (
        <EmptyState icon={<IconBook size={28} />} title="Couldn’t load the dictionary"
          description="Check your connection or permissions and try again." />
      ) : visible.length === 0 ? (
        <EmptyState icon={<IconBook size={28} />} title={query || typeFilter ? 'No matching fields' : 'No dictionary fields yet'}
          description={query || typeFilter ? 'Try a different search or type.' : 'Define your first reusable field.'}
          action={canEdit && !query && !typeFilter ? <Button variant="primary" size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}><IconPlus size={14} /> New field</Button> : undefined} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(e => {
            const usage = usageByEntry.get(e.id) ?? []
            const flashing = flashId === e.id
            return (
              <article key={e.id}
                ref={el => { if (el) cardRefs.current.set(e.id, el); else cardRefs.current.delete(e.id) }}
                className="bg-surface rounded-[16px] p-4 flex flex-col gap-3 transition-shadow"
                style={{ border: `1px solid ${flashing ? 'var(--color-accent)' : 'var(--color-border)'}`, boxShadow: flashing ? '0 0 0 3px var(--color-accent-soft)' : 'var(--shadow-card)' }}>
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-semibold text-sm text-text truncate">{e.name}</span>
                    {e.refId && <RefChip id={e.refId} tone="accent" title={`Cite this definition as [${e.refId}]`} />}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge label={e.type} color={TYPE_COLOR[e.type]} />
                    {canEdit && (
                      <button onClick={() => openEditor(e)} aria-label={`Edit ${e.name}`} title={`Edit ${e.name}`}
                        className="p-1 rounded-[6px] text-faint hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                        <IconEdit size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Governance */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <LifecyclePill lifecycle={e.lifecycle} />
                  <ReviewPill review={e.reviewStatus} />
                </div>

                {e.description && <p className="text-xs text-dim leading-relaxed line-clamp-3">{e.description}</p>}
                {e.format && <span className="text-[11px] font-mono text-faint">format: {e.format}</span>}

                {(e.allowedValues ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {e.allowedValues.slice(0, 5).map(v => <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded-[5px] bg-raised text-dim">{v}</span>)}
                    {e.allowedValues.length > 5 && <span className="text-[10px] text-faint self-center">+{e.allowedValues.length - 5}</span>}
                  </div>
                )}
                {(e.tags ?? []).length > 0 && <div className="flex flex-wrap gap-1">{e.tags.map(t => <Badge key={t} label={t} color="default" />)}</div>}

                {/* Used in — live back-references */}
                <div className="flex flex-col gap-1.5 pt-2 mt-auto" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <span className="text-[10px] uppercase tracking-wide text-faint">
                    Used in{usage.length > 0 ? ` · ${usage.length}` : ''}
                  </span>
                  {corpusStatus === 'loading' ? (
                    <span className="text-[11px] text-faint">Resolving references…</span>
                  ) : corpusStatus === 'error' ? (
                    <span className="text-[11px] text-faint">References unavailable.</span>
                  ) : usage.length === 0 ? (
                    <span className="text-[11px] text-faint">Not referenced in any coverage, form or rule.</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {usage.slice(0, 6).map(u => {
                        const Icon = KIND_ICON[u.kind]
                        return (
                          <button key={`${u.kind}:${u.refId}`} onClick={() => navigate(routeForUsage(u))}
                            title={`${KIND_LABEL[u.kind]}: ${u.label} — open`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-raised text-dim text-[11px] hover:bg-accent-soft hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                            <Icon size={11} aria-hidden />
                            <span className="truncate max-w-[150px]">{u.label}</span>
                          </button>
                        )
                      })}
                      {usage.length > 6 && <span className="text-[10px] text-faint self-center">+{usage.length - 6} more</span>}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Editor dialog */}
      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.source ? 'Edit field' : 'New field'}>
        {draft && (
          <div className="flex flex-col gap-4">
            <Input label="Name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Coverage A Amount" autoFocus />
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
            <Input label="Allowed values (comma-separated)" value={draft.allowedValues} onChange={e => setDraft({ ...draft, allowedValues: e.target.value })} placeholder="500, 1000, 2500, 5000" />
            <Input label="Format" value={draft.format} onChange={e => setDraft({ ...draft, format: e.target.value })} placeholder="USD (whole dollars), YYYY-MM-DD…" />
            <Input label="Tags (comma-separated)" value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} placeholder="rating, limits" />
            <div className="flex flex-col gap-1">
              <Input label="Aliases (comma-separated)" value={draft.aliases} onChange={e => setDraft({ ...draft, aliases: e.target.value })} placeholder="Coverage A, Dwelling limit" />
              <span className="text-[11px] text-faint">Other surface forms this term appears under — drives the “used in” back-references.</span>
            </div>

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
