// GlobalCommandBar — one product-level bar that searches Rules + Coverages + Forms
// together and returns results grouped by entity type. Deterministic first: named
// cross-entity joins and universal tokens resolve with no AI (runGlobalQuery). The LLM
// fallback is offered only when a query resolves to nothing, only when the flag is on,
// and it never renders a list from the model — it applies a validated, editable filter by
// navigating to the tab with the filter in the URL (visible chips).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { Coverage, Form, Rule } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'
import { IconSearch, IconWand, IconSpinner, IconRule, IconCoverage, IconForm } from '../../components/ui/icons'
import { type CrossHit, runGlobalQuery } from './crossEntity'
import { createSchemaIndex } from './schemaIndex'
import { stateToParams } from './urlState'
import { SEARCH_LLM_ENABLED, type InterpretEntity, interpretQuery } from './interpretQuery'
import { rulesSchema } from './schemas/rulesSchema'
import { makeCoveragesSchema } from '../coverages/coveragesSchema'
import { formsSchema } from '../forms/formsSchema'

interface GlobalCommandBarProps {
  pid:       string
  rules:     WithId<Rule>[]
  coverages: WithId<Coverage>[]
  forms:     WithId<Form>[]
}

const tabFor: Record<InterpretEntity, string> = { rule: 'rules', coverage: 'coverages', form: 'forms' }
const groupIcon = (t: CrossHit['entityType']) =>
  t === 'coverage' ? <IconCoverage size={13} aria-hidden="true" /> : t === 'form' ? <IconForm size={13} aria-hidden="true" /> : <IconRule size={13} aria-hidden="true" />

function pathForHit(pid: string, hit: CrossHit): string {
  if (hit.entityType === 'coverage') return `/app/products/${pid}/coverages?cov=${encodeURIComponent(hit.refId ?? hit.id)}`
  if (hit.entityType === 'form') return `/app/products/${pid}/forms?form=${encodeURIComponent(hit.refId ?? '')}`
  return `/app/products/${pid}/rules?q=${encodeURIComponent(hit.refId ?? hit.title)}`
}

export function GlobalCommandBar({ pid, rules, coverages, forms }: GlobalCommandBarProps) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [interpreting, setInterpreting] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const data = useMemo(() => ({ rules, coverages, forms }), [rules, coverages, forms])
  const result = useMemo(() => runGlobalQuery(q, data), [q, data])
  const flat = useMemo(() => result.groups.flatMap((g) => g.hits), [result])

  // Schema indexes for the AI path (validating + serializing the interpreted filter).
  const indexes = useMemo(() => ({
    rule: createSchemaIndex(rulesSchema),
    coverage: createSchemaIndex(makeCoveragesSchema(coverages)),
    form: createSchemaIndex(formsSchema),
  }), [coverages])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  function openHit(hit: CrossHit) { navigate(pathForHit(pid, hit)); setOpen(false); setQ('') }

  async function runInterpret() {
    setInterpreting(true)
    try {
      const res = await interpretQuery(q, indexes)
      if (!res) { toast.error('Could not interpret that query. Try a filter like status:Active.'); return }
      // Narrow per entity type so each stateToParams call gets a concretely-typed index.
      const params = res.entityType === 'rule' ? stateToParams(indexes.rule, res.state)
        : res.entityType === 'coverage' ? stateToParams(indexes.coverage, res.state)
        : stateToParams(indexes.form, res.state)
      navigate(`/app/products/${pid}/${tabFor[res.entityType]}?${params.toString()}`)
      toast.success(`Interpreted as: ${res.explanation}`)
      setOpen(false); setQ('')
    } finally {
      setInterpreting(false)
    }
  }

  const showPanel = open && q.trim().length > 0

  return (
    <div className="relative" ref={ref}>
      <div
        className="glass flex items-center gap-2 h-9 pl-3 pr-2 rounded-[10px] focus-within:ring-2 focus-within:ring-accent/30"
        style={{ border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-chip)' }}
      >
        <IconSearch size={15} className="text-faint shrink-0" aria-hidden="true" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && flat[0]) openHit(flat[0]) }}
          placeholder="Search across coverages, forms, and rules… (try: optional coverages with no attached form)"
          aria-label="Search across coverages, forms, and rules"
          className="flex-1 min-w-0 bg-transparent text-sm text-text placeholder:text-faint focus:outline-none"
        />
        <span className="text-[10px] text-faint uppercase tracking-wide shrink-0 hidden sm:inline" aria-hidden="true">All entities</span>
      </div>

      {showPanel && (
        <div
          className="glass absolute z-40 mt-1.5 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-[12px] p-2 facet-reveal"
          style={{ border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-dropdown)' }}
          role="dialog" aria-label="Search results"
        >
          {result.kind === 'join' && (
            <div className="px-2 py-1.5 mb-1 text-xs text-dim">
              Interpreted as: <span className="font-medium text-text">{result.interpretation}</span>
              <span className="text-faint"> · {result.total} match{result.total === 1 ? '' : 'es'}, no AI</span>
            </div>
          )}

          {result.groups.map((group) => (
            <div key={group.entityType} className="mb-1.5">
              <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
                <span className="text-accent">{groupIcon(group.entityType)}</span>
                {group.label}
                <span className="text-faint/70">{group.hits.length}</span>
              </div>
              {group.hits.slice(0, 8).map((hit) => (
                <button
                  key={`${hit.entityType}:${hit.id}`}
                  onClick={() => openHit(hit)}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                >
                  {hit.refId && <code className="text-[11px] font-mono text-accent shrink-0">{hit.refId}</code>}
                  <span className="text-sm text-text truncate flex-1 min-w-0">{hit.title}</span>
                  {hit.note && <span className="text-[10px] text-warn shrink-0">{hit.note}</span>}
                </button>
              ))}
              {group.hits.length > 8 && <p className="text-[11px] text-faint px-2.5 py-1">+{group.hits.length - 8} more</p>}
            </div>
          ))}

          {result.kind === 'empty' && (
            <div className="px-2 py-3 text-center">
              <p className="text-sm text-dim">No matches across coverages, forms, and rules.</p>
              {result.canInterpret && SEARCH_LLM_ENABLED && (
                <button
                  onClick={runInterpret} disabled={interpreting}
                  className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-accent text-sm font-medium hover:bg-accent-soft transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {interpreting ? <IconSpinner size={13} className="animate-spin" aria-hidden="true" /> : <IconWand size={13} aria-hidden="true" />}
                  {interpreting ? 'Interpreting…' : 'Interpret with AI'}
                </button>
              )}
              {result.canInterpret && !SEARCH_LLM_ENABLED && (
                <p className="text-[11px] text-faint mt-1.5">Tip: try a cross-entity query like "unused forms" or a token like status:Active.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
