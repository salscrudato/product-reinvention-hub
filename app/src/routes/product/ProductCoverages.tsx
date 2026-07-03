// Coverages tab — hierarchy tree + node editor with live LD-table pickers and F/E constraint.
import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Save, AlertTriangle } from 'lucide-react'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Badge, StatusPill, Button, Skeleton, RefChip } from '../../components/ui'
import { LimitEditor } from '../../components/product/LimitEditor'
import { StateTileMap } from '../../components/product/StateTileMap'
import { HO3_COASTAL_STATES } from '@pf/shared'
import { US_TILE_GRID } from '../../lib/geo/usTileGrid'
import type { Coverage, CoverageTerm } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const COV_COASTAL = new Set<string>(HO3_COASTAL_STATES)
const ALL_TILE_STATES = Object.keys(US_TILE_GRID)

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

// ─── Coverage node editor (right pane) ───────────────────────────────────────

function CoverageEditor({ cov }: { cov: WithId<Coverage> }) {
  const { pid, coverages, ldTables } = useProductCtx()
  const navigate  = useNavigate()
  const { user }  = useUser()
  const canEdit   = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor     = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }

  // Local draft of terms + state scope
  const [terms, setTerms]         = useState<CoverageTerm[]>(() => cov.terms ?? [])
  const [states, setStates]       = useState<string[]>(() => cov.states ?? [])
  const [allStates, setAllStates] = useState<boolean>(() => cov.allStates ?? false)
  const [dirty, setDirty] = useState(false)

  function toggleCovState(s: string) {
    setStates(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
    setDirty(true)
  }

  // For Coverage F gate: find Coverage E's current default limit
  const covE        = coverages.find(c => c.refId === 'HO.COV.005')
  const covEDefault = covE?.terms?.[0]?.default as number | undefined
  const covFGated   = cov.refId === 'HO.COV.006' && (covEDefault ?? 300000) < 300000

  function updateTerm(termId: string, patch: Partial<CoverageTerm>) {
    setTerms(prev => prev.map(t => t.id === termId ? { ...t, ...patch } : t))
    setDirty(true)
  }

  async function handleSave() {
    if (!canEdit) return
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/coverages/${cov.id}`,
        data: { terms, states, allStates },
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
        <div className="flex flex-col gap-1.5 items-start">
          <h2 className="text-base font-semibold text-text">{cov.name}</h2>
          {cov.refId && <RefChip id={cov.refId} />}
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

      {/* Coverage terms — editable limits (range + standard options) */}
      <div className="flex flex-col gap-5">
        <p className="text-xs font-medium text-faint uppercase tracking-wide">Coverage terms</p>
        {terms.length === 0 && <p className="text-sm text-faint">No terms defined.</p>}
        {terms.map(term => (
          <div key={term.id} className="flex flex-col gap-1.5">
            <LimitEditor
              term={term}
              ldTable={term.ldTableRef ? ldTables[term.ldTableRef] : undefined}
              isBlocked={covFGated && term.kind === 'LIMIT' ? (v => v === 5000 ? 'Requires Coverage E ≥ $300,000 [HO.RU.006]' : undefined) : undefined}
              canEdit={canEdit}
              onChange={patch => updateTerm(term.id, patch)}
            />
            {term.notes && <p className="text-xs text-faint">{term.notes}</p>}
          </div>
        ))}
      </div>

      {/* Linked forms — click to open in the Forms tab (two-way link) */}
      {cov.formNumbers?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Attached forms</p>
          <div className="flex flex-wrap gap-1.5">
            {cov.formNumbers.map(fn => (
              <RefChip key={fn} id={fn} tone="accent" title={`Open ${fn} in Forms`}
                onClick={() => navigate(`/app/products/${pid}/forms?form=${encodeURIComponent(fn)}`)} />
            ))}
          </div>
        </div>
      )}

      {/* State scope — the US map, editable per coverage */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <p className="text-xs font-medium text-faint uppercase tracking-wide">State scope</p>
          <label className="flex items-center gap-1.5 text-xs text-dim cursor-pointer">
            <input type="checkbox" className="accent-accent" checked={allStates} disabled={!canEdit}
              onChange={e => { setAllStates(e.target.checked); setDirty(true) }} />
            All footprint states
          </label>
        </div>
        <div className="bg-page rounded-[12px] p-3" style={{ border: '1px solid var(--color-border)' }}>
          <StateTileMap
            active={allStates ? new Set(ALL_TILE_STATES) : new Set(states)}
            coastal={COV_COASTAL}
            onToggle={toggleCovState}
            canEdit={canEdit && !allStates}
            labels={{ active: 'In scope', coastal: 'Coastal wind/hail', inactive: 'Out of scope' }}
          />
        </div>
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
