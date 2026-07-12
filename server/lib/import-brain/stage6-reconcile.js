'use strict'
// server/lib/import-brain/stage6-reconcile.js — Reconcile into BrainOutput.
//
// THIS STAGE WRITES NOTHING and makes NO AI calls.
// It aggregates all preceding stage results into the final BrainOutput.
//
// Pure function — deterministic, synchronous. Ported from
// functions/src/import/brain/stage6_reconcile.ts.

/**
 * @param {object[]} entities           BrainEntity[] from stage 4
 * @param {object[]} classifiedSheets   ClassifiedSheet[] from stage 1
 * @param {object[]} headerLocks        HeaderLock[] from stage 2
 * @param {object[]} columnMaps         SheetColumnMap[] from stage 3
 * @param {object[]} reviewQueue        ReviewItem[] accumulated across stages 1-5
 * @param {object[]} validationDiscrepancies ValidationDiscrepancy[] from stage 5
 * @returns {object} BrainOutput
 */
function reconcileOutput(entities, classifiedSheets, headerLocks, columnMaps, reviewQueue, validationDiscrepancies) {
  const perEntityConfidence = entities.map(e => e.overallConfidence)

  const sheetsIgnored    = classifiedSheets.filter(s => s.domain === 'ignore').length
  const sheetsClassified = classifiedSheets.filter(s => s.domain !== 'ignore').length

  const columnsTotal    = columnMaps.reduce((n, m) => n + m.mappings.length, 0)
  const columnsMapped   = columnMaps.reduce((n, m) => n + m.mappings.filter(c => c.canonicalField !== null).length, 0)
  const columnsUnmapped = columnsTotal - columnsMapped

  const rowsInReview  = entities.filter(e => e.reviewFlag).length
  const rowsExtracted = entities.length

  const summaryCounts = {
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

module.exports = { reconcileOutput }
