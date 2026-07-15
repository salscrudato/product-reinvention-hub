// The bundle's single source of truth for rate tables (spec §3.6): the manifest
// records `tables: [{tableName, sheetName, keyColumns[], valueColumn, dcTableId}]`
// so the overlay lint (R-rates, R-idref) and the two-way proof share one list —
// and the TableConfig producer emits sheets from exactly the same derivation.

import type { RTTable } from '../../types'
import type { ManifestTable } from './types'
import { tableDcId, tableSheetName } from './ids'

/**
 * Every RT table of the product, in insertion order; sheet ordinals are the
 * 1-based workbook positions (spec §3.4 — `TerritoryBaseRate_1` …).
 */
export function manifestTables(rtTables: Record<string, RTTable>): ManifestTable[] {
  const out: ManifestTable[] = []
  let ordinal = 0
  for (const [refId, t] of Object.entries(rtTables)) {
    ordinal++
    const valueColumn = t.valueColumn ?? t.columns[t.columns.length - 1]!
    out.push({
      tableName: t.name,
      sheetName: tableSheetName(t.name, ordinal),
      dcTableId: tableDcId(t.name),
      keyColumns: t.columns.filter((c) => c !== valueColumn),
      valueColumn,
      hubRefId: refId,
    })
  }
  return out
}
