// Coverages tab — hierarchy tree + node editor with live LD-table pickers and F/E constraint.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Save, AlertTriangle } from 'lucide-react'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Badge, StatusPill, Button, Skeleton } from '../../components/ui'
import type { Coverage, CoverageTerm } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

// ─── Coverage tree (left pane) ────────────────────────────────────────────────

function CoverageTreeItem({ cov, children, selected, onSelect }: {
  cov: WithId<Coverage>; children?: React.ReactNode
  selected: boolean; onSelect: () => void
}) {
  return (
    <div>
      <button
        onClick={onSelect}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-sm text-left transition-colors ${selected ? 'bg-accent-soft text-accent' : 'hover:bg-raised text-text'}`}
      >
        <StatusPill status={cov.status} />
        <span className="flex-1 truncate font-medium">{cov.name}</span>
        {cov.refId && <span className="text-xs font-mono text-faint">{cov.refId.split('.').pop()}</span>}
      </button>
      {children && <div className="ml-4 border-l border-accent/15 pl-2">{children}</div>}
    </div>
  )
}

function buildForest(cov: WithId<Coverage>, all: WithId<Coverage>[], selected: string | null, onSelect: (id: string) => void): React.ReactNode {
  const children = all.filter(c => c.parentId === cov.refId)
  return (
    <CoverageTreeItem key={cov.id} cov={cov} selected={selected === cov.id} onSelect={() => onSelect(cov.id)}>
      {children.length > 0 && children.map(ch => buildForest(ch, all, selected, onSelect))}
    </CoverageTreeItem>
  )
}

// ─── LD-table option picker ───────────────────────────────────────────────────

function LDPicker({ term, ldTable, covFGated, canEdit, onChange }: {
  term: CoverageTerm
  ldTable?: { rows: { label: string; value: number; constraintNote?: string }[]; defaultValue?: number }
  covFGated?: boolean  // true = Coverage F 5k blocked because E < 300k
  canEdit: boolean
  onChange: (value: number | string) => void
}) {
  if (!ldTable) return <span className="text-sm text-faint">No LD table</span>

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-faint">{term.label}</span>
      <div className="flex flex-wrap gap-1.5">
        {ldTable.rows.map(row => {
          const isDefault = row.value === ldTable.defaultValue
          const isSelected = row.value === term.default
          const blocked = covFGated && row.value === 5000

          return (
            <button
              key={row.value}
              disabled={!canEdit || blocked}
              onClick={() => onChange(row.value)}
              title={row.constraintNote ?? (blocked ? 'Requires Coverage E ≥ $300,000' : undefined)}
              className={`px-2.5 py-1 rounded-[6px] text-xs font-medium border transition-colors
                ${isSelected ? 'bg-accent text-white border-accent' : 'bg-surface border-border-strong text-dim hover:border-accent hover:text-accent'}
                ${blocked ? 'opacity-40 cursor-not-allowed' : ''}
                ${isDefault && !isSelected ? 'font-bold' : ''}`}
            >
              {row.label}
              {blocked && <AlertTriangle size={10} className="inline ml-1" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Coverage node editor (right pane) ───────────────────────────────────────

function CoverageEditor({ cov }: { cov: WithId<Coverage> }) {
  const { pid, coverages, ldTables } = useProductCtx()
  const { user }  = useUser()
  const canEdit   = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor     = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }

  // Local draft of terms
  const [terms, setTerms] = useState<CoverageTerm[]>(() => cov.terms ?? [])
  const [dirty, setDirty] = useState(false)

  // For Coverage F gate: find Coverage E's current default limit
  const covE        = coverages.find(c => c.refId === 'HO.COV.005')
  const covEDefault = covE?.terms?.[0]?.default as number | undefined
  const covFGated   = cov.refId === 'HO.COV.006' && (covEDefault ?? 300000) < 300000

  function updateTermDefault(termId: string, value: number | string) {
    setTerms(prev => prev.map(t => t.id === termId ? { ...t, default: value } : t))
    setDirty(true)
  }

  async function handleSave() {
    if (!canEdit) return
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/coverages/${cov.id}`,
        data: { terms },
        entityType: 'coverage', productId: pid, actor,
        expectedRev: (cov as { rev?: number }).rev,
      })
      setDirty(false)
      toast.success('Coverage saved')
    } catch (err) {
      if (err instanceof MutationConflictError) {
        toast.error('Conflict — this coverage was updated by someone else. Please refresh.')
      } else {
        toast.error(err instanceof Error ? err.message : 'Save failed')
      }
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text">{cov.name}</h2>
          {cov.refId && <span className="text-xs font-mono text-faint">{cov.refId}</span>}
        </div>
        {canEdit && dirty && (
          <Button variant="primary" size="sm" onClick={handleSave}>
            <Save size={14} />Save
          </Button>
        )}
      </div>

      {/* Metadata chips */}
      <div className="flex flex-wrap gap-1.5">
        <Badge label={cov.requirement} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
        <Badge label={cov.source} color="default" />
        {cov.premiumGenerating && <Badge label="Premium generating" color="good" />}
        {cov.claimsBasis && <Badge label={cov.claimsBasis} color="blue" />}
      </div>

      {/* Coverage F gate warning */}
      {covFGated && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-[8px] bg-[rgba(180,83,9,.07)] text-warn text-sm">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          Coverage F $5,000 limit is currently blocked because Coverage E default is set below $300,000.
          <span className="font-mono text-xs">[HO.RU.006]</span>
        </div>
      )}

      {/* Coverage terms */}
      <div className="flex flex-col gap-4">
        <p className="text-xs font-medium text-faint uppercase tracking-wide">Coverage terms</p>
        {terms.length === 0 && <p className="text-sm text-faint">No terms defined.</p>}
        {terms.map(term => {
          if (term.ldTableRef && ldTables[term.ldTableRef]) {
            return (
              <div key={term.id} className="flex flex-col gap-2">
                <LDPicker
                  term={term}
                  ldTable={ldTables[term.ldTableRef]}
                  covFGated={covFGated}
                  canEdit={canEdit}
                  onChange={v => updateTermDefault(term.id, v)}
                />
                {term.notes && (
                  <p className="text-xs text-faint">{term.notes}</p>
                )}
              </div>
            )
          }
          return (
            <div key={term.id} className="flex flex-col gap-1">
              <span className="text-xs text-faint">{term.label}</span>
              <p className="text-sm text-dim">{String(term.default)}</p>
            </div>
          )
        })}
      </div>

      {/* Linked forms */}
      {cov.formNumbers?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Attached forms</p>
          <div className="flex flex-wrap gap-1.5">
            {cov.formNumbers.map(fn => <Badge key={fn} label={fn} color="blue" mono />)}
          </div>
        </div>
      )}

      {/* State scope */}
      <div>
        <p className="text-xs font-medium text-faint uppercase tracking-wide mb-2">States</p>
        <p className="text-sm text-dim">{cov.allStates ? 'All states' : (cov.states?.join(', ') || 'None configured')}</p>
      </div>
    </div>
  )
}

// ─── Main route ───────────────────────────────────────────────────────────────

export default function ProductCoverages() {
  const { coverages, loading } = useProductCtx()
  const [params] = useSearchParams()
  // Honour a deep link from the Overview (e.g. …/coverages?cov=<id>).
  const [selected, setSelected] = useState<string | null>(() => params.get('cov'))

  if (loading) return <div className="grid grid-cols-[240px_1fr] gap-5"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>

  const roots = coverages.filter(c => !c.parentId)
  const selectedCov = coverages.find(c => c.id === selected) ?? (roots[0] ? coverages[0] ?? null : null)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
      {/* Tree */}
      <div className="bg-surface rounded-[14px] p-3" style={{ border: '1px solid var(--color-border)', maxHeight: '70vh', overflowY: 'auto' }}>
        {roots.map(r => buildForest(r, coverages, selected, setSelected))}
      </div>

      {/* Editor */}
      <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)', minHeight: 300 }}>
        {selectedCov
          ? <CoverageEditor key={selectedCov.id} cov={selectedCov} />
          : <p className="text-sm text-faint">Select a coverage to edit.</p>}
      </div>
    </div>
  )
}
