// Forms tab — a master-detail forms repository: a searchable, filterable list on the
// left, a rich read panel on the right (identity, plain-English AI summary, editions,
// attachment, states, and the coverages that reference it — "where used"). Two-way
// linked with coverages: a coverage's form chip deep-links here (?form=), and each
// form lists the coverages that reference it (clickable back). AI-generated plain-
// English descriptions are cached on the form document; "Generate" fetches via the
// describeForm callable.
import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useProductCtx } from '../../context/useProductCtx'
import { useCapture } from '../../context/useCapture'
import { Badge, Skeleton, EmptyState, RefChip } from '../../components/ui'
import { IconForm, IconClose, IconSparkle, IconSpinner, IconArrowRight, IconStates, IconLink } from '../../components/ui/icons'
import { adapter } from '../../lib/backend'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { useEntityFilters } from '../../features/search/useEntityFilters'
import { FacetPanel } from '../../features/search/FacetPanel'
import { CommandBar } from '../../features/search/CommandBar'
import { ActiveFilters } from '../../features/search/ActiveFilters'
import { SavedViews } from '../../features/search/SavedViews'
import { formsSchema } from '../../features/forms/formsSchema'
import type { WithId } from '../../context/ProductContext'
import type { Form, Coverage } from '@pf/shared'

const CAT_COLOR: Record<string, 'blue' | 'purple' | 'warn' | 'danger' | 'good' | 'default'> = {
  BASE_COVERAGE: 'purple', DECLARATIONS: 'blue', ENDORSEMENT: 'good',
  EXCLUSION: 'danger', AMENDATORY: 'warn', POLICY_NOTICE: 'default',
}
const catLabel = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, m => m.toUpperCase())

// ─── Detail panel — the selected form, read-first ───────────────────────────────
function FormDetail({ form, coverages, onOpenCoverage }: {
  form: WithId<Form>; coverages: WithId<Coverage>[]; onOpenCoverage: (id: string) => void
}) {
  const { user } = useUser()
  const canEdit  = canI(user, 'product:write')
  const referencedBy = coverages.filter(c => c.formNumbers?.includes(form.number))

  const [description, setDescription] = useState(form.description ?? '')
  const [generating, setGenerating]   = useState(false)

  // Reset the local description when the selected form changes.
  useEffect(() => { setDescription(form.description ?? '') }, [form.id, form.description])

  async function handleGenerate() {
    setGenerating(true)
    try {
      const result = await adapter.fns.call<{ formKey: string }, { description: string; cached: boolean }>(
        'describeForm', { formKey: form.id },
      )
      setDescription(result.description)
      if (!result.cached) toast.success('Description generated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate description')
    } finally {
      setGenerating(false)
    }
  }

  const Section = ({ icon, title, count, children }: { icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) => (
    <div className="rounded-[14px] bg-surface p-4" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-accent">{icon}</span>
        <h3 className="text-[13px] font-semibold text-text">{title}</h3>
        {count !== undefined && <span className="text-[11px] text-faint tnum">{count}</span>}
      </div>
      {children}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Identity header */}
      <div className="rounded-[14px] p-4 relative overflow-hidden"
        style={{ background: 'var(--gradient-accent-soft)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-[11px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}>
            <IconForm size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <RefChip id={form.number} tone="accent" />
              <span className="text-[11px] text-faint tnum">Ed. {form.edition || '—'}</span>
            </div>
            <h2 className="text-[16px] font-bold text-text leading-snug mt-1">{form.name}</h2>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Badge label={catLabel(form.category)} color={CAT_COLOR[form.category] ?? 'default'} />
              <Badge label={form.source} color="default" />
              {form.dynamic && <Badge label="Dynamic" color="blue" />}
              {form.mandatoryDefault && <Badge label="Mandatory" color="purple" />}
            </div>
          </div>
        </div>
      </div>

      {/* Plain-English summary */}
      <Section icon={<IconSparkle size={15} aria-hidden="true" />} title="Plain-English summary">
        <div className="flex items-start justify-between gap-3">
          {description ? (
            <p className="text-sm text-dim leading-relaxed">{description}</p>
          ) : (
            <p className="text-sm text-faint italic">{canEdit ? 'No description yet — generate one.' : 'No plain-English description available.'}</p>
          )}
          {canEdit && (
            <button onClick={handleGenerate} disabled={generating}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline disabled:opacity-50 shrink-0"
              aria-label="Generate AI description">
              {generating ? <IconSpinner size={12} className="animate-spin" /> : <IconSparkle size={12} />}
              {description ? (generating ? 'Regenerating…' : 'Regenerate') : (generating ? 'Generating…' : 'Generate')}
            </button>
          )}
        </div>
      </Section>

      {/* Editions — the current edition on file (read-only). */}
      <Section icon={<IconForm size={15} aria-hidden="true" />} title="Editions" count={form.edition ? 1 : 0}>
        {form.edition ? (
          <div className="flex items-center justify-between px-3 py-2 rounded-[9px] bg-raised" style={{ border: '1px solid var(--color-border)' }}>
            <span className="font-mono text-[13px] text-text">Ed. {form.edition}</span>
            <span className="text-[11px] text-faint">Current</span>
          </div>
        ) : (
          <p className="text-sm text-faint italic">No edition date on file.</p>
        )}
      </Section>

      {/* Attachment + states */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Section icon={<IconLink size={15} aria-hidden="true" />} title="Attachment">
          <p className="text-sm text-dim">{form.attachmentCondition === 'NONE' ? 'Mandatory — always attached' : 'Rule-driven — see Forms rules'}</p>
        </Section>
        <Section icon={<IconStates size={15} aria-hidden="true" />} title="States">
          <p className="text-sm text-dim">{form.allStates ? 'All states' : (form.states?.join(', ') || 'None')}</p>
        </Section>
      </div>

      {/* Where used */}
      <Section icon={<IconLink size={15} aria-hidden="true" />} title="Where used" count={referencedBy.length}>
        {referencedBy.length > 0 ? (
          <div className="flex flex-col gap-1">
            {referencedBy.map(c => (
              <button key={c.id} onClick={() => onOpenCoverage(c.id)}
                className="group flex items-center justify-between gap-2 text-left px-3 py-2 rounded-[9px] bg-raised hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                <span className="text-sm text-text truncate group-hover:text-accent transition-colors">{c.name}</span>
                <IconArrowRight size={13} className="text-faint shrink-0 group-hover:text-accent group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-faint italic">Not referenced by any coverage in this product.</p>
        )}
      </Section>

      {/* Dynamic fields */}
      {form.dynamicFields?.length > 0 && (
        <Section icon={<IconForm size={15} aria-hidden="true" />} title="Dynamic fields" count={form.dynamicFields.length}>
          <div className="flex flex-col gap-1.5">
            {form.dynamicFields.map(f => (
              <div key={f.name} className="flex items-center justify-between px-3 py-2 bg-raised rounded-[9px] text-sm">
                <span className="font-medium text-text">{f.name}</span>
                <div className="flex items-center gap-1.5">
                  <Badge label={f.dataType} color="default" />
                  {f.repeating && <Badge label="repeating" color="blue" />}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

export default function ProductForms() {
  const { pid, forms, coverages, loading } = useProductCtx()
  const { user } = useUser()
  const canEdit = canI(user, 'product:write')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Honour a deep link from a coverage's form chip (…/forms?form=HO%2004%2090).
  const focusForm = params.get('form')
  useEffect(() => {
    if (focusForm && forms.length) {
      const hit = forms.find(f => f.number === focusForm)
      if (hit) setSelectedId(hit.id)
    }
  }, [focusForm, forms])

  // Honour a coverage deep link from its Forms tile (…/forms?cov=<refId>) — scope
  // the list to just that coverage's attached forms, with a clearable chip.
  const covFilter = coverages.find(c => c.refId === params.get('cov') || c.id === params.get('cov'))
  const covForms = useMemo(() => (covFilter ? new Set(covFilter.formNumbers ?? []) : null), [covFilter])

  // Coverage deep-link scopes the entity set first; facet counts reflect that scope.
  const entities = useMemo(() => (covForms ? forms.filter(f => covForms.has(f.number)) : forms), [forms, covForms])
  const filters = useEntityFilters(entities, formsSchema)
  const filtered = filters.results
  useEffect(() => {
    const n = filters.reconciliation.dropped.length
    if (n) toast.info(`Adjusted ${n} filter${n === 1 ? '' : 's'} that no longer applied`)
  }, [filters.reconciliation])

  // The form shown in the detail panel — the selection if it survived filtering,
  // otherwise the first match so the panel is never empty while results exist.
  const current = filtered.find(f => f.id === selectedId) ?? filtered[0] ?? null

  // Feedback capture context: publish the form in the detail panel as the focused entity, so
  // ⌘. attaches that exact form + its ISO form number. Cleared on unmount.
  const { setFocus } = useCapture()
  useEffect(() => {
    setFocus(current ? { entityPath: `forms/${current.id}`, refId: current.number || undefined, label: current.name || current.number } : null)
    return () => setFocus(null)
  }, [current, setFocus])

  // Shaped master-detail skeleton (search + facet rail + list + detail), not one flat block —
  // so the loading state previews the real layout.
  if (loading) return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-9 w-full max-w-lg" />
      <div className="grid lg:grid-cols-[200px_300px_1fr] gap-4 items-start">
        <div className="flex flex-col gap-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-6 w-full" />)}</div>
        <div className="flex flex-col gap-1.5">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-20 w-full rounded-[11px]" />)}</div>
        <Skeleton className="h-[60vh] rounded-[14px]" />
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {covFilter && (
        <div className="flex items-center gap-2 self-start pl-3 pr-1.5 py-1.5 rounded-[9px] bg-accent-soft text-sm">
          <span className="text-dim">Forms attached to</span>
          <span className="font-medium text-accent">{covFilter.name}</span>
          <button onClick={() => { const p = new URLSearchParams(params); p.delete('cov'); setParams(p, { replace: true }) }}
            aria-label="Clear coverage filter" className="w-6 h-6 rounded-[6px] flex items-center justify-center text-accent hover:bg-surface transition-colors"><IconClose size={14} /></button>
        </div>
      )}

      {forms.length === 0 ? (
        <EmptyState icon={<IconForm size={32} />} title="No forms yet"
          description={canEdit
            ? 'Forms arrive with a seeded product, or when you import a workbook / scaffold from a base form in the Builder — every form number is verified.'
            : 'Forms appear here once the product is seeded or an editor extracts them from a base form.'}
          compact />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px] max-w-lg">
              <CommandBar schema={formsSchema} state={filters.state} applyState={filters.applyState}
                placeholder="Search by number, name…" />
            </div>
            <SavedViews scope={`forms:${pid}`} state={filters.state} onApply={filters.applyState} />
          </div>
          <ActiveFilters chips={filters.activeChips} onRemove={filters.removeChip} onClearAll={filters.clearAll}
            resultCount={filtered.length} total={filters.total} />
          <div className="grid lg:grid-cols-[200px_300px_1fr] gap-4 items-start">
            <div className="lg:sticky lg:top-4">
              <FacetPanel schema={formsSchema} counts={filters.counts} state={filters.state} unknownValues={filters.unknownValues}
                onToggleEnum={filters.toggleEnum} onToggleParent={filters.toggleParent}
                onToggleChild={filters.toggleChild} onSetDateRange={filters.setDateRange} />
            </div>
            <div className="flex flex-col gap-1.5 lg:max-h-[62vh] lg:overflow-y-auto -mx-1 px-1">
              {filtered.length === 0 ? (
                <p className="text-sm text-faint italic px-1 py-6 text-center">No forms match.</p>
              ) : filtered.map(f => {
                const on = current?.id === f.id
                return (
                  <button key={f.id} onClick={() => setSelectedId(f.id)} aria-pressed={on}
                    className={`text-left rounded-[11px] p-3 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? 'bg-accent-soft' : 'bg-surface hover:bg-hover'}`}
                    style={{ border: `1px solid ${on ? 'var(--color-accent-line)' : 'var(--color-border)'}`, boxShadow: on ? 'var(--shadow-card)' : 'none' }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <RefChip id={f.number} tone={on ? 'accent' : 'default'} />
                      {f.edition && <span className="text-[10px] text-faint tnum">ed. {f.edition}</span>}
                    </div>
                    <div className={`text-[13px] font-medium leading-snug mt-1.5 line-clamp-2 ${on ? 'text-accent' : 'text-text'}`}>{f.name}</div>
                    <div className="mt-1.5">
                      <Badge label={catLabel(f.category)} color={CAT_COLOR[f.category] ?? 'default'} />
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="min-w-0">
              {current ? (
                <FormDetail
                  form={current}
                  coverages={coverages}
                  onOpenCoverage={id => navigate(`/app/products/${pid}/coverages?cov=${id}`)}
                />
              ) : (
                <div className="rounded-[14px] bg-surface p-10 flex flex-col items-center gap-2 text-center" style={{ border: '1px solid var(--color-border)' }}>
                  <IconForm size={28} className="text-faint" aria-hidden="true" />
                  <p className="text-sm text-dim">Select a form to see its details.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
