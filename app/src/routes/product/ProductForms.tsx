// Forms tab — table of product forms with facets; row click opens a full Drawer.
// Two-way linked with coverages: a coverage's form chip deep-links here (?form=),
// and each form lists the coverages that reference it (clickable back).
import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { FileText } from 'lucide-react'
import { useProductCtx } from '../../context/useProductCtx'
import { Badge, Skeleton, EmptyState, RefChip } from '../../components/ui'
import { Drawer } from '../../components/ui/Drawer'
import type { WithId } from '../../context/ProductContext'
import type { Form, Coverage } from '@pf/shared'

const CAT_COLOR: Record<string, 'blue'|'purple'|'warn'|'danger'|'good'|'default'> = {
  BASE_COVERAGE: 'purple', DECLARATIONS: 'blue', ENDORSEMENT: 'good',
  EXCLUSION: 'danger', AMENDATORY: 'warn', POLICY_NOTICE: 'default',
}

function FormDrawer({ form, coverages, onOpenCoverage, onClose }: {
  form: WithId<Form>; coverages: WithId<Coverage>[]; onOpenCoverage: (id: string) => void; onClose: () => void
}) {
  const referencedBy = coverages.filter(c => c.formNumbers?.includes(form.number))
  return (
    <Drawer open title={`${form.number} — ${form.name}`} onClose={onClose} width="w-[480px]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-1.5">
          <Badge label={form.category.replace('_', ' ')} color={CAT_COLOR[form.category] ?? 'default'} />
          <Badge label={`Ed. ${form.edition}`} color="default" />
          <Badge label={form.source} color="default" />
          {form.dynamic && <Badge label="Dynamic" color="blue" />}
          {form.mandatoryDefault && <Badge label="Mandatory" color="purple" />}
        </div>

        <div>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-1">Description</p>
          <p className="text-sm text-dim">{form.description || 'No description yet.'}</p>
        </div>

        {/* Two-way link back to coverages */}
        {referencedBy.length > 0 && (
          <div>
            <p className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Referenced by coverages</p>
            <div className="flex flex-col gap-1">
              {referencedBy.map(c => (
                <button key={c.id} onClick={() => onOpenCoverage(c.id)}
                  className="flex items-center justify-between gap-2 text-left px-3 py-2 rounded-[8px] bg-raised hover:bg-accent/5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                  <span className="text-sm text-text truncate">{c.name}</span>
                  {c.refId && <span className="font-mono text-[11px] text-faint shrink-0">{c.refId}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {form.dynamicFields?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Dynamic fields</p>
            <div className="flex flex-col gap-1.5">
              {form.dynamicFields.map(f => (
                <div key={f.name} className="flex items-center justify-between px-3 py-2 bg-raised rounded-[8px] text-sm">
                  <span className="font-medium text-text">{f.name}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge label={f.dataType} color="default" />
                    {f.repeating && <Badge label="repeating" color="blue" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-1">Attachment</p>
          <p className="text-sm text-dim">{form.attachmentCondition === 'NONE' ? 'Mandatory — always attached' : 'Rule-driven — see Forms rules'}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-1">States</p>
          <p className="text-sm text-dim">{form.allStates ? 'All states' : (form.states?.join(', ') || 'None')}</p>
        </div>
      </div>
    </Drawer>
  )
}

export default function ProductForms() {
  const { pid, forms, coverages, loading } = useProductCtx()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [query, setQuery]     = useState('')
  const [catFilter, setCat]   = useState('')
  const [selected, setSelected] = useState<WithId<Form> | null>(null)

  // Honour a deep link from a coverage's form chip (…/forms?form=HO%2004%2090).
  const focusForm = params.get('form')
  useEffect(() => {
    if (focusForm && forms.length) {
      const hit = forms.find(f => f.number === focusForm)
      if (hit) setSelected(hit)
    }
  }, [focusForm, forms])

  const fuse    = useMemo(() => new Fuse(forms, { keys: ['number', 'name', 'category'], threshold: 0.4 }), [forms])
  const filtered = catFilter ? (query ? fuse.search(query).map(r => r.item) : forms).filter(f => f.category === catFilter)
                             : (query ? fuse.search(query).map(r => r.item) : forms)
  const cats = [...new Set(forms.map(f => f.category))]

  if (loading) return <Skeleton className="h-64 rounded-[14px]" />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          className="flex-1 min-w-[200px] h-8 px-3 rounded-[8px] bg-surface border border-border-strong text-sm placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
          placeholder="Search forms..."
          value={query} onChange={e => setQuery(e.target.value)}
        />
        <select
          className="h-8 px-3 rounded-[8px] bg-surface border border-border-strong text-sm text-dim focus:outline-none focus:ring-2 focus:ring-accent/25"
          value={catFilter} onChange={e => setCat(e.target.value)}
        >
          <option value="">All categories</option>
          {cats.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
        <span className="text-sm text-faint tnum">{filtered.length} form{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<FileText size={32} />} title="No forms" description="Forms appear here once the product is seeded." compact />
      ) : (
        <div className="bg-surface rounded-[14px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-raised text-xs font-medium text-dim uppercase tracking-wide" style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Number','Name','Edition','Category','Dyn','States'].map(h => (
                  <th key={h} className="text-left px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(form => (
                <tr key={form.id} onClick={() => setSelected(form)}
                  className="cursor-pointer hover:bg-raised transition-colors"
                  style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-3"><RefChip id={form.number} /></td>
                  <td className="px-4 py-3 text-text max-w-[200px] truncate">{form.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-dim">{form.edition}</td>
                  <td className="px-4 py-3"><Badge label={form.category.replace('_',' ')} color={CAT_COLOR[form.category] ?? 'default'} /></td>
                  <td className="px-4 py-3 text-center">{form.dynamic ? '✓' : '—'}</td>
                  <td className="px-4 py-3 text-xs text-dim">{form.allStates ? 'All' : form.states?.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <FormDrawer
          form={selected}
          coverages={coverages}
          onOpenCoverage={id => { setSelected(null); navigate(`/app/products/${pid}/coverages?cov=${id}`) }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
