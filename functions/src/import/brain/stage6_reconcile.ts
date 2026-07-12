// functions/src/import/brain/stage6_reconcile.ts — Reconcile into BrainOutput.
//
// THIS STAGE WRITES NOTHING.
// It aggregates all preceding stage results into the final BrainOutput:
//   { entities, perEntityConfidence, reviewQueue, summaryCounts, classifiedSheets,
//     headerLocks, columnMaps, validationDiscrepancies }
//
// Pure function — no AI calls, no I/O.

import type {
  BrainEntity, BrainOutput, ClassifiedSheet, HeaderLock, SheetColumnMap,
  ReviewItem, SummaryCounts, ValidationDiscrepancy,
} from './types'

export function reconcileOutput(
  entities:               BrainEntity[],
  classifiedSheets:       ClassifiedSheet[],
  headerLocks:            HeaderLock[],
  columnMaps:             SheetColumnMap[],
  reviewQueue:            ReviewItem[],
  validationDiscrepancies: ValidationDiscrepancy[],
): BrainOutput {
  const perEntityConfidence = entities.map(e => e.overallConfidence)

  const sheetsIgnored    = classifiedSheets.filter(s => s.domain === 'ignore').length
  const sheetsClassified = classifiedSheets.filter(s => s.domain !== 'ignore').length

  const columnsTotal   = columnMaps.reduce((n, m) => n + m.mappings.length, 0)
  const columnsMapped  = columnMaps.reduce((n, m) => n + m.mappings.filter(c => c.canonicalField !== null).length, 0)
  const columnsUnmapped = columnsTotal - columnsMapped

  const rowsInReview  = entities.filter(e => e.reviewFlag).length
  const rowsExtracted = entities.length

  const summaryCounts: SummaryCounts = {
    sheetsTotal:            classifiedSheets.length,
    sheetsClassified,
    sheetsIgnored,
    columnsTotal,
    columnsMapped,
    columnsUnmapped,
    rowsExtracted,
    rowsInReview,
    validatorDiscrepancies: validationDiscrepancies.length,
    entitiesProduced:       entities.length,
  }

  return {
    entities,
    perEntityConfidence,
    reviewQueue,
    summaryCounts,
    classifiedSheets,
    headerLocks,
    columnMaps,
    validationDiscrepancies,
  }
}
