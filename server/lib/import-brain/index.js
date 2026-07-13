'use strict'
// server/lib/import-brain/index.js — Adaptive Import Brain: main pipeline orchestrator.
//
// runAdaptiveImportBrain() drives six stages over a StructuralModel and streams
// live stage-by-stage progress over the existing SSE channel (emit callback).
//
// Stage flow:
//   1  Sheet classification   — BULK pre-filter + REASONER_A/B ensemble
//   2  Header/region lock     — deterministic fast path (shared CJS); AI fallback
//   3  Column -> field map    — REASONER_A + REASONER_B parallel; reconcile
//   4  Row extraction         — BULK + BULK_ALT batch; multi-refId split; refId synthesis
//   5  Adversarial validation — VALIDATOR (gpt-5.1, OpenAI family; decor. from BULK)
//   6  Reconcile              — pure aggregation; WRITES NOTHING
//
// Guaranteed invariants:
//   * All AI calls are server-side; browser holds no credentials
//   * Every produced field carries a source-cell citation (sheet!cell + verbatim)
//   * Models may only extract from cells present in the provided input
//   * refIds are preserved byte-for-byte; never invented
//   * VALIDATOR runs gpt-5.1 (OpenAI), decorrelated from BULK (haiku/Anthropic)
//   * Stage 6 writes nothing

const { classifySheets }    = require('./stage1-classify')
const { lockHeaders }       = require('./stage2-header-lock')
const { mapColumns }        = require('./stage3-column-map')
const { extractRows }       = require('./stage4-extract')
const { validateEntities }  = require('./stage5-validate')
const { reconcileOutput }   = require('./stage6-reconcile')
const { createBudget }      = require('./ai-call')

// ─── SSE helper ───────────────────────────────────────────────────────────────

function emitStage(emit, stage, name, phase, detail) {
  emit({ t: 'tool', name: `brain:stage${stage}:${name}`, phase, summary: detail })
}

// ─── Build fingerprint lookup map ─────────────────────────────────────────────

function buildFpMap(structural) {
  const m = new Map()
  for (const fp of (structural.sheets || [])) m.set(fp.sheetName, fp)
  return m
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object}   opts.structural     StructuralModel from the workbook parser
 * @param {string}   [opts.lobRefIdHint] e.g. 'GL.LOB.001'
 * @param {object}   [opts.budget]       pre-created budget (omit to create fresh)
 * @param {function} [opts.emit]         SSE emit callback (ev) => void
 * @returns {Promise<object>} BrainOutput
 */
async function runAdaptiveImportBrain(opts) {
  const { structural, lobRefIdHint } = opts
  const emit   = typeof opts.emit === 'function' ? opts.emit : () => {}
  const budget = opts.budget ?? createBudget()
  const review = []
  const fpMap  = buildFpMap(structural)

  // Emit initial metadata so the UI knows the workbook shape.
  emit({ t: 'json', key: 'brain:input', value: {
    sourceName: structural.sourceName,
    sourceType: structural.sourceType,
    sheetCount: (structural.sheets || []).length,
    sheetNames: (structural.sheets || []).map(s => s.sheetName),
  } })

  // ── Stage 1: Sheet classification ──────────────────────────────────────────
  emitStage(emit, 1, 'classify', 'start', `Classifying ${(structural.sheets || []).length} sheet(s)`)

  const classifiedSheets = await classifySheets(structural.sheets || [], budget, review)

  const contentCount = classifiedSheets.filter(s => s.domain !== 'ignore').length
  const ignoredCount = classifiedSheets.length - contentCount
  emitStage(emit, 1, 'classify', 'end', `${contentCount} content sheet(s), ${ignoredCount} ignored`)
  emit({ t: 'json', key: 'brain:stage1', value: classifiedSheets })

  // ── Stage 2: Header/region lock ────────────────────────────────────────────
  emitStage(emit, 2, 'headerLock', 'start', `Locking headers for ${contentCount} sheet(s)`)

  const headerLocks = await lockHeaders(classifiedSheets, fpMap, budget, review)

  emitStage(emit, 2, 'headerLock', 'end', `${headerLocks.length} header(s) locked`)
  emit({ t: 'json', key: 'brain:stage2', value: headerLocks })

  // ── Stage 3: Column -> field mapping ───────────────────────────────────────
  emitStage(emit, 3, 'columnMap', 'start', `Mapping columns for ${contentCount} sheet(s)`)

  const columnMaps = await mapColumns(classifiedSheets, headerLocks, fpMap, budget, review)

  const totalMapped   = columnMaps.reduce((n, m) => n + m.mappings.filter(c => c.canonicalField !== null).length, 0)
  const totalUnmapped = columnMaps.reduce((n, m) => n + m.unmappedIndices.length, 0)
  emitStage(emit, 3, 'columnMap', 'end', `${totalMapped} mapped, ${totalUnmapped} unmapped`)
  emit({ t: 'json', key: 'brain:stage3', value: columnMaps })

  // ── Stage 4: Row extraction + normalization ────────────────────────────────
  emitStage(emit, 4, 'extract', 'start', 'Extracting rows')

  const entities = await extractRows(classifiedSheets, headerLocks, columnMaps, fpMap, budget, review, lobRefIdHint)

  const flagged = entities.filter(e => e.reviewFlag).length
  emitStage(emit, 4, 'extract', 'end', `${entities.length} entities extracted, ${flagged} flagged`)
  emit({ t: 'json', key: 'brain:stage4', value: { entityCount: entities.length, flagged } })

  if (budget.degraded) {
    emit({ t: 'notice', level: 'warn', message: 'Token budget soft ceiling reached during extraction. Some calls used cheaper models. Review extraction quality.', kind: 'degrade' })
  }

  // ── Stage 5: Adversarial validation (gpt-5.1 / OpenAI, decorr. from BULK) ──
  emitStage(emit, 5, 'validate', 'start', `Validating ${entities.length} entities`)

  const discrepancies = await validateEntities(entities, classifiedSheets, budget, review)

  emitStage(emit, 5, 'validate', 'end', `${discrepancies.length} discrepancy(ies) found`)
  emit({ t: 'json', key: 'brain:stage5', value: discrepancies })

  // ── Stage 6: Reconcile (writes nothing) ────────────────────────────────────
  emitStage(emit, 6, 'reconcile', 'start')

  const output = reconcileOutput(entities, classifiedSheets, headerLocks, columnMaps, review, discrepancies)

  emitStage(emit, 6, 'reconcile', 'end', `${output.summaryCounts.entitiesProduced} entities, ${output.reviewQueue.length} review items`)
  emit({ t: 'json', key: 'brain:output', value: output.summaryCounts })

  // Per-run spend telemetry — the no-cap import switch removes the CAP, never the
  // TELEMETRY. Logged server-side and streamed so operators see true import cost.
  const spend = {
    spendUsd:     Math.round((budget.spendUsd || 0) * 1e4) / 1e4,
    calls:        budget.calls || 0,
    noCap:        Boolean(budget.noCap),
    byDeployment: budget.byDeployment || {},
  }
  console.log(`[import-brain] run spend: $${spend.spendUsd} across ${spend.calls} call(s)`, JSON.stringify(spend.byDeployment))
  emit({ t: 'json', key: 'brain:spend', value: spend })

  return output
}

module.exports = { runAdaptiveImportBrain, createBudget }
