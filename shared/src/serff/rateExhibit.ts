// serff/rateExhibit.ts — before/after rate exhibits + premium impact histogram.
//
// Rate impacts are computed by the ACTUAL evaluate() engine, not estimated.
// The exhibit runs evaluate() for both the parent (before) and clone (after) rating
// programs against a grid of representative inputs, then buckets the % impacts into
// a histogram. Texas 28 TAC §5.9334(d) requires rate indication and relativity
// analyses when rate level changes are filed.
//
// Pure TypeScript; zero platform imports; canaries are untouched (no seed changes).

import { evaluate, type RtGetter, type LdGetter } from '../rating/evaluator'
import type { RatingProgram, RatingInputMap } from '../types'
import type { ChangeSet, RateTableCellChange, LDTableChange } from '../changeset/types'
import type { RateExhibitContent, RateExhibitRow, PremiumImpactRow, HistogramBucket } from './types'

// ─── Histogram bands ──────────────────────────────────────────────────────────────

const HISTOGRAM_BANDS: Array<{ label: string; low: number; high: number }> = [
  { label: 'Below −10%',     low: -Infinity, high: -10   },
  { label: '−10% to −5%',   low: -10,       high: -5    },
  { label: '−5% to 0%',     low: -5,        high: 0     },
  { label: '0% (no change)', low: 0,         high: 0     },
  { label: '0% to +5%',     low: 0,         high: 5     },
  { label: '+5% to +10%',   low: 5,         high: 10    },
  { label: 'Above +10%',    low: 10,        high: Infinity },
]

function bucketPct(pct: number): string {
  if (pct === 0) return '0% (no change)'
  for (const b of HISTOGRAM_BANDS) {
    if (pct > b.low && pct <= b.high) return b.label
    if (b.low === -Infinity && pct <= b.high) return b.label
  }
  return 'Above +10%'
}

// ─── Premium impact grid ──────────────────────────────────────────────────────────

export interface ExhibitInputScenario {
  label:  string
  inputs: RatingInputMap
}

/** Compute the premium impact for a set of scenarios using before/after rating programs. */
export function computePremiumImpacts(
  parentProgram:  RatingProgram,
  cloneProgram:   RatingProgram,
  parentRtGetter: RtGetter,
  parentLdGetter: LdGetter,
  cloneRtGetter:  RtGetter,
  cloneLdGetter:  LdGetter,
  scenarios:      ExhibitInputScenario[],
): PremiumImpactRow[] {
  return scenarios.map(s => {
    let before = 0
    let after  = 0
    try {
      before = evaluate(parentProgram, s.inputs, parentRtGetter, parentLdGetter).finalPremium
    } catch { /* non-fatal: keep 0 */ }
    try {
      after  = evaluate(cloneProgram,  s.inputs, cloneRtGetter,  cloneLdGetter).finalPremium
    } catch { /* non-fatal: keep 0 */ }
    const pctChange = before !== 0 ? ((after - before) / Math.abs(before)) * 100 : null
    return { inputLabel: s.label, before, after, pctChange }
  })
}

/** Bucket a set of PremiumImpactRow[] into a histogram. */
export function buildHistogram(impacts: PremiumImpactRow[]): HistogramBucket[] {
  const counts: Record<string, number> = {}
  for (const b of HISTOGRAM_BANDS) counts[b.label] = 0
  for (const row of impacts) {
    if (row.pctChange === null) continue
    const bucket = bucketPct(row.pctChange)
    counts[bucket] = (counts[bucket] ?? 0) + 1
  }
  const total = impacts.filter(r => r.pctChange !== null).length || 1
  return HISTOGRAM_BANDS.map(b => ({
    band:       b.label,
    low:        b.low,
    high:       b.high,
    count:      counts[b.label] ?? 0,
    pctOfTotal: ((counts[b.label] ?? 0) / total) * 100,
  }))
}

/** Exposure-weighted average premium impact across all scenarios (null when all before=0). */
export function overallImpactPct(impacts: PremiumImpactRow[]): number | null {
  const valid = impacts.filter(r => r.pctChange !== null && r.before > 0)
  if (valid.length === 0) return null
  const totalBefore = valid.reduce((s, r) => s + r.before, 0)
  const totalAfter  = valid.reduce((s, r) => s + r.after,  0)
  return totalBefore !== 0 ? ((totalAfter - totalBefore) / totalBefore) * 100 : null
}

// ─── RT table exhibit rows ─────────────────────────────────────────────────────────

function rtExhibitRows(cells: RateTableCellChange[]): RateExhibitRow[] {
  return cells.map(c => {
    const keyStr = Object.entries(c.rowKey).map(([k, v]) => `${k}=${v}`).join(', ')
    return {
      label:     `${c.tableName} [${c.tableRefId}] — ${keyStr} — column "${c.column}"`,
      before:    c.before,
      after:     c.after,
      pctChange: c.pctChange,
    }
  })
}

function ldExhibitRows(changes: LDTableChange[]): RateExhibitRow[] {
  return changes
    .filter(c => c.kind === 'row-modified' && c.field === 'value')
    .map(c => ({
      label:     `${c.tableName} [${c.tableRefId}] — "${c.label}" value`,
      before:    c.before as number ?? 0,
      after:     c.after  as number ?? 0,
      pctChange: (typeof c.before === 'number' && c.before !== 0)
        ? ((((c.after as number) ?? 0) - c.before) / Math.abs(c.before)) * 100
        : null,
    }))
}

// ─── Public entry point ────────────────────────────────────────────────────────────

/** Generate a full rate exhibit for the combined RT and LD changes in a ChangeSet.
 *  `scenarios` must be supplied by the caller (the server fetches the actual product
 *  data to build them; tests use explicit fixture inputs). */
export function generateRateExhibit(
  changeset:      ChangeSet,
  parentProgram:  RatingProgram,
  cloneProgram:   RatingProgram,
  parentRtGetter: RtGetter,
  parentLdGetter: LdGetter,
  cloneRtGetter:  RtGetter,
  cloneLdGetter:  LdGetter,
  scenarios:      ExhibitInputScenario[],
): RateExhibitContent {
  const allCells = changeset.rateTableCellChanges
  const allLD    = changeset.ldTableChanges

  const tableRefId = allCells[0]?.tableRefId ?? allLD[0]?.tableRefId ?? 'combined'
  const tableName  = allCells[0]?.tableName  ?? allLD[0]?.tableName  ?? 'Rate Changes'
  const rows: RateExhibitRow[] = [...rtExhibitRows(allCells), ...ldExhibitRows(allLD)]

  const premiumImpacts = computePremiumImpacts(
    parentProgram, cloneProgram,
    parentRtGetter, parentLdGetter,
    cloneRtGetter,  cloneLdGetter,
    scenarios,
  )
  const histogram = buildHistogram(premiumImpacts)
  const impact    = overallImpactPct(premiumImpacts)

  return {
    kind:             'rateExhibit',
    tableRefId,
    tableName,
    rows,
    premiumImpacts,
    histogram,
    overallImpactPct: impact !== null ? parseFloat(impact.toFixed(4)) : null,
  }
}
