// shared/src/import/census/accounting.ts — the conservation ledger (CE1-S4).
//
// Every censused cell starts UNACCOUNTED (except merge shadows, which are
// accounted automatically — the anchor carries the value). Extraction layers
// post dispositions; the rollup turns the ledger into coverage math:
//
//   substanceCoverage = (FACT + SCHEMA)
//                     / (nonEmpty - NOISE - HEADER - MERGE_SHADOW)
//
// Invariants (pinned by unit tests + property fuzz):
//   * accounting always sums to nonEmpty — every censused cell has exactly one entry;
//   * posts to refs outside the census are REJECTED (return false), never phantom;
//   * MERGE_SHADOW entries are immutable (shadows are accounted, not substance).

import type {
  AccountingEntry, ConsumedSpan, Disposition, SheetCensus, SheetRollup, WorkbookRollup,
} from './types'
import { colLabel } from './buildCensus'

export interface SheetAccounting {
  sheet: string
  nonEmpty: number
  entries: Map<string, AccountingEntry>  // ref -> entry (insertion = row-major census order)
}

const DISPOSITIONS: Disposition[] = ['FACT', 'SCHEMA', 'NOISE', 'HEADER', 'MERGE_SHADOW', 'NEEDS_REVIEW', 'UNACCOUNTED']

/** Open a ledger for one sheet: every censused cell gets an entry up front. */
export function createAccounting(census: SheetCensus): SheetAccounting {
  const entries = new Map<string, AccountingEntry>()
  for (const cell of census.cells) {
    const isShadow = cell.merged !== null && cell.merged.anchor !== cell.ref
    entries.set(cell.ref, {
      ref: cell.ref,
      disposition: isShadow ? 'MERGE_SHADOW' : 'UNACCOUNTED',
      by: 'code',
      ruleId: isShadow ? 'merge-normalization' : null,
      factRef: null,
      citations: [],
    })
  }
  return { sheet: census.name, nonEmpty: census.nonEmpty, entries }
}

/** Post a disposition to one cell. Returns false (and changes nothing) when the
 *  ref is not in the census or is a merge shadow. Re-posting overwrites — the
 *  most specific layer to run wins; UNACCOUNTED cannot be posted back. */
export function post(
  acc: SheetAccounting,
  ref: string,
  disposition: Exclude<Disposition, 'UNACCOUNTED' | 'MERGE_SHADOW'>,
  by: AccountingEntry['by'],
  ruleId: string | null = null,
  factRef: string | null = null,
  citations: string[] = [],
): boolean {
  const cur = acc.entries.get(ref)
  if (!cur || cur.disposition === 'MERGE_SHADOW') return false
  acc.entries.set(ref, { ref, disposition, by, ruleId, factRef, citations })
  return true
}

/** Post a rectangular consumed span (S6 mapper instrumentation) as one
 *  disposition. Only refs that exist in the census are touched. Returns the
 *  number of cells actually posted. */
export function postSpan(
  acc: SheetAccounting,
  span: ConsumedSpan,
  disposition: Exclude<Disposition, 'UNACCOUNTED' | 'MERGE_SHADOW'>,
  by: AccountingEntry['by'],
  ruleId: string | null = null,
): number {
  let n = 0
  for (let r = span.rowStart; r <= span.rowEnd; r++) {
    for (let c = span.colStart; c <= span.colEnd; c++) {
      if (post(acc, `${span.sheet}!${colLabel(c)}${r + 1}`, disposition, by, ruleId)) n++
    }
  }
  return n
}

function emptyCounts(): Record<Disposition, number> {
  const out = {} as Record<Disposition, number>
  for (const d of DISPOSITIONS) out[d] = 0
  return out
}

/** Ledger math for one sheet. Pure; throws if the ledger lost conservation. */
export function rollupSheet(acc: SheetAccounting): SheetRollup {
  const byDisposition = emptyCounts()
  const unaccounted: string[] = []
  for (const e of acc.entries.values()) {
    byDisposition[e.disposition]++
    if (e.disposition === 'UNACCOUNTED') unaccounted.push(e.ref)
  }
  const total = DISPOSITIONS.reduce((s, d) => s + byDisposition[d], 0)
  if (total !== acc.nonEmpty) {
    throw new Error(`accounting broke conservation on "${acc.sheet}": ${total} entries vs ${acc.nonEmpty} nonEmpty`)
  }
  const denominator = acc.nonEmpty - byDisposition.NOISE - byDisposition.HEADER - byDisposition.MERGE_SHADOW
  const substanceCoverage = denominator <= 0 ? 1 : (byDisposition.FACT + byDisposition.SCHEMA) / denominator
  return { sheet: acc.sheet, nonEmpty: acc.nonEmpty, byDisposition, substanceCoverage, unaccounted }
}

/** Workbook rollup over per-sheet rollups. */
export function rollupWorkbook(sourceName: string, sheets: SheetRollup[]): WorkbookRollup {
  const byDisposition = emptyCounts()
  let nonEmpty = 0
  for (const s of sheets) {
    nonEmpty += s.nonEmpty
    for (const d of DISPOSITIONS) byDisposition[d] += s.byDisposition[d]
  }
  const denominator = nonEmpty - byDisposition.NOISE - byDisposition.HEADER - byDisposition.MERGE_SHADOW
  const substanceCoverage = denominator <= 0 ? 1 : (byDisposition.FACT + byDisposition.SCHEMA) / denominator
  return { sourceName, nonEmpty, byDisposition, substanceCoverage, sheets }
}
