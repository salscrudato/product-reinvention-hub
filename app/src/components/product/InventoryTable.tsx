// InventoryTable — the portfolio "bill of materials": one flattened, dense row per
// coverage × attached form across the in-scope products, with the full column set a
// filings inventory needs. A sub-coverage row always names its top-level coverage
// (Coverage) and itself (Sub-Coverage); coverages with an unresolvable parent are
// flagged "unlinked" rather than shown as phantom top-level coverages — so no orphan
// can hide here. Product / coverage identity de-emphasises on repeat for scannability,
// numbers use tabular figures, and Coverage / Sub-Coverage / Form cells deep-link into
// the matching detail view. Read-only: it cannot mutate the hierarchy.
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  buildInventoryRows, productDisplayIdentity, productSegments,
  type Coverage, type Form, type Product, type SegmentAxisId,
} from '@pf/shared'
import { RefChip, Skeleton, EmptyState } from '../ui'
import { IconTable, IconSort, IconWarning, IconAlertCircle } from '../ui/icons'
import type { WithId } from '../../context/ProductContext'
import type { ProductInventory } from '../../lib/usePortfolioInventory'

type SortKey = 'offering' | 'productName' | 'lob' | 'coverage' | 'formNumber' | 'edition'

interface DisplayRow {
  seq:         number
  productId:   string
  offering:    string
  productName: string
  frameworkId: string
  productCode: string
  lobName:     string
  topName:     string
  covName:     string
  isSub:       boolean
  isOrphan:    boolean
  parentId:    string | null
  covRef:      string          // refId|id used for the coverage deep link
  topRef:      string          // refId|id of the top-level coverage
  formName:    string | null
  formNumber:  string | null
  edition:     string | null
  source:      string          // BUREAU | PROPRIETARY (form's, else coverage's)
  allStates:   boolean
  states:      string[]
  groupLabel:  string          // segment bucket for the active "group by"
}

interface InventoryTableProps {
  products:        WithId<Product>[]
  byProduct:       Map<string, ProductInventory>
  loading:         boolean
  error:           string | null
  showFrameworkId: boolean
  groupBy:         SegmentAxisId | 'none'
}

function groupLabelFor(product: WithId<Product>, groupBy: SegmentAxisId | 'none'): string {
  if (groupBy === 'none') return ''
  const seg = productSegments(product)
  if (groupBy === 'vertical') return seg.vertical
  if (groupBy === 'family') return seg.family
  return seg.marketSegments[0] ?? '—' // a line can serve several bands; bucket by the first
}

export function InventoryTable({ products, byProduct, loading, error, showFrameworkId, groupBy }: InventoryTableProps) {
  const navigate = useNavigate()
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null)

  const rows = useMemo<DisplayRow[]>(() => {
    const out: DisplayRow[] = []
    let seq = 0
    for (const p of products) {
      const inv = byProduct.get(p.id)
      if (!inv) continue
      const id = productDisplayIdentity(p)
      const glabel = groupLabelFor(p, groupBy)
      for (const r of buildInventoryRows<WithId<Coverage>, WithId<Form>>(inv.coverages, inv.forms)) {
        out.push({
          seq: seq++,
          productId:   p.id,
          offering:    id.offeringName,
          productName: id.productName,
          frameworkId: id.frameworkId,
          productCode: id.productCode,
          lobName:     id.lobName,
          topName:     r.top.name,
          covName:     r.coverage.name,
          isSub:       r.isSub,
          isOrphan:    r.isOrphan,
          parentId:    r.coverage.parentId,
          covRef:      r.coverage.refId ?? r.coverage.id,
          topRef:      r.top.refId ?? r.top.id,
          formName:    r.form?.name ?? null,
          formNumber:  r.form?.number ?? null,
          edition:     r.form?.edition ?? null,
          source:      r.form?.source ?? r.coverage.source ?? '',
          allStates:   !!r.coverage.allStates,
          states:      r.coverage.states ?? [],
          groupLabel:  glabel,
        })
      }
    }
    return out
  }, [products, byProduct, groupBy])

  // Partition into segment groups (preserving encounter order), then stable-sort
  // within each group by the active column. Sorting never crosses a group boundary.
  const groups = useMemo(() => {
    const map = new Map<string, DisplayRow[]>()
    for (const r of rows) {
      const arr = map.get(r.groupLabel) ?? []
      arr.push(r); map.set(r.groupLabel, arr)
    }
    const cmp = (a: DisplayRow, b: DisplayRow): number => {
      if (!sort) return a.seq - b.seq
      const pick = (r: DisplayRow): string =>
        sort.key === 'offering'   ? r.offering
        : sort.key === 'productName' ? r.productName
        : sort.key === 'lob'      ? r.lobName
        : sort.key === 'coverage' ? `${r.topName} ${r.isSub ? r.covName : ''}`
        : sort.key === 'formNumber' ? (r.formNumber ?? '')
        : (r.edition ?? '')
      const c = pick(a).localeCompare(pick(b), undefined, { numeric: true, sensitivity: 'base' })
      return (sort.dir === 'asc' ? c : -c) || (a.seq - b.seq) // stable tiebreak
    }
    return [...map.entries()].map(([label, rs]) => ({ label, rows: [...rs].sort(cmp) }))
  }, [rows, sort])

  const cols = showFrameworkId ? 13 : 12

  if (loading) return <Skeleton className="h-64 rounded-[14px]" />
  if (error) {
    return (
      <div className="flex items-center gap-2.5 rounded-[12px] px-4 py-3 text-sm" style={{ background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.2)' }}>
        <IconAlertCircle size={16} className="text-danger shrink-0" aria-hidden="true" />
        <span className="text-danger">Couldn't load inventory — {error}</span>
      </div>
    )
  }
  if (rows.length === 0) {
    return <EmptyState icon={<IconTable size={32} />} title="Nothing to inventory" description="No coverages match the current filters." compact />
  }

  const th = (label: string, key?: SortKey, align: 'left' | 'center' = 'left') => {
    const active = sort?.key === key
    const ariaSort = !key ? undefined : active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'
    return (
      <th scope="col" aria-sort={ariaSort}
        className={`px-3 py-2.5 font-medium whitespace-nowrap ${align === 'center' ? 'text-center' : 'text-left'}`}>
        {key ? (
          <button type="button"
            onClick={() => setSort(s => s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' })}
            className="inline-flex items-center gap-1 hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[4px]">
            {label}
            <IconSort size={12} className={active ? 'text-accent' : 'text-faint'} />
          </button>
        ) : label}
      </th>
    )
  }

  return (
    <div className="rounded-[14px] overflow-hidden bg-surface" style={{ border: '1px solid var(--color-border)' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <caption className="sr-only">Coverage and form inventory across the selected products</caption>
          <thead>
            <tr className="bg-raised text-[11px] uppercase tracking-wide text-dim" style={{ borderBottom: '1px solid var(--color-border)' }}>
              {th('Offering Name', 'offering')}
              {th('Product Name', 'productName')}
              {showFrameworkId && th('Product Framework ID')}
              {th('Product')}
              {th('LOB', 'lob')}
              {th('Coverage', 'coverage')}
              {th('Sub-Coverage')}
              {th('Coverage Form(s)')}
              {th('Form Number', 'formNumber')}
              {th('Edition Date', 'edition')}
              {th('Bureau', undefined, 'center')}
              {th('Proprietary', undefined, 'center')}
              {th('State Applicability', undefined, 'center')}
            </tr>
          </thead>
          <tbody>
            {groups.map(group => {
              let prev: DisplayRow | null = null // reset repeat-suppression per group
              return (
                <FragmentGroup key={group.label || '_'}>
                  {groupBy !== 'none' && (
                    <tr className="bg-accent-soft" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <th scope="colgroup" colSpan={cols} className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[.07em] text-accent">
                        {group.label} <span className="tnum text-faint font-normal normal-case">· {group.rows.length}</span>
                      </th>
                    </tr>
                  )}
                  {group.rows.map(r => {
                    const sameProduct  = !!prev && prev.productId === r.productId
                    const sameCoverage = sameProduct && prev!.covRef === r.covRef
                    prev = r
                    const dim = 'text-faint'
                    return (
                      <tr key={`${r.productId}:${r.seq}`} className="hover:bg-raised transition-colors align-top" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {/* Product identity — de-emphasised on repeat within a product */}
                        <td className="px-3 py-2 max-w-[190px]">
                          {sameProduct ? <span className={dim}>›</span> : (
                            <button onClick={() => navigate(`/app/products/${r.productId}/overview`)}
                              className="text-left text-text font-medium hover:text-accent transition-colors truncate block max-w-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[4px]"
                              title={r.offering}>{r.offering}</button>
                          )}
                        </td>
                        <td className={`px-3 py-2 max-w-[150px] truncate ${sameProduct ? dim : 'text-dim'}`} title={r.productName}>{sameProduct ? '' : r.productName}</td>
                        {showFrameworkId && <td className="px-3 py-2">{sameProduct ? '' : <RefChip id={r.frameworkId} />}</td>}
                        <td className={`px-3 py-2 tnum ${sameProduct ? dim : 'text-dim'}`}>{sameProduct ? '' : r.productCode}</td>
                        <td className={`px-3 py-2 whitespace-nowrap ${sameProduct ? dim : 'text-dim'}`}>{sameProduct ? '' : r.lobName}</td>

                        {/* Coverage / Sub-Coverage — clickable into the Coverages detail */}
                        <td className="px-3 py-2 max-w-[190px]">
                          {sameCoverage ? '' : r.isOrphan ? (
                            <span className="inline-flex items-center gap-1 text-warn" title={`This endorsement's parent (${r.parentId ?? 'unknown'}) was not found`}>
                              <IconWarning size={12} aria-hidden="true" /> Unlinked
                            </span>
                          ) : (
                            <button onClick={() => navigate(`/app/products/${r.productId}/coverages?cov=${encodeURIComponent(r.topRef)}`)}
                              className="text-left text-text hover:text-accent transition-colors truncate block max-w-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[4px]"
                              title={r.topName}>{r.topName}</button>
                          )}
                        </td>
                        <td className="px-3 py-2 max-w-[180px]">
                          {sameCoverage ? '' : (r.isSub || r.isOrphan) ? (
                            <button onClick={() => navigate(`/app/products/${r.productId}/coverages?cov=${encodeURIComponent(r.covRef)}`)}
                              className="text-left text-dim hover:text-accent transition-colors truncate block max-w-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[4px]"
                              title={r.covName}>{r.covName}</button>
                          ) : <span className="text-faint">—</span>}
                        </td>

                        {/* Form identity */}
                        <td className="px-3 py-2 max-w-[200px] truncate text-dim" title={r.formName ?? undefined}>{r.formName ?? <span className="text-faint">—</span>}</td>
                        <td className="px-3 py-2">
                          {r.formNumber
                            ? <RefChip id={r.formNumber} onClick={() => navigate(`/app/products/${r.productId}/forms?form=${encodeURIComponent(r.formNumber!)}`)} />
                            : <span className="text-faint">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-dim tnum whitespace-nowrap">{r.edition ?? '—'}</td>
                        <td className="px-3 py-2 text-center">{r.source === 'BUREAU' ? <span className="text-good" aria-label="Bureau">✓</span> : <span className="text-faint" aria-hidden="true">—</span>}</td>
                        <td className="px-3 py-2 text-center">{r.source === 'PROPRIETARY' ? <span className="text-accent" aria-label="Proprietary">✓</span> : <span className="text-faint" aria-hidden="true">—</span>}</td>
                        <td className="px-3 py-2 text-center tnum whitespace-nowrap text-dim"
                          title={r.allStates ? 'All states' : (r.states.join(', ') || 'None')}>
                          {r.allStates ? 'All' : r.states.length}
                        </td>
                      </tr>
                    )
                  })}
                </FragmentGroup>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Small fragment wrapper so each segment group can carry a stable key without an
// extra DOM node inside <tbody> (which only permits table-row content).
function FragmentGroup({ children }: { children: ReactNode }) {
  return <>{children}</>
}
