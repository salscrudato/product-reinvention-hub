// functions/src/import/brain/index.ts — Adaptive Import Brain: main pipeline.
//
// runAdaptiveImportBrain() orchestrates six stages over a StructuralModel and
// streams live stage-by-stage progress over the existing SSE channel (StreamEvent).
//
// Stage flow:
//   1  Sheet classification  — BULK pre-filter + REASONER_A/B ensemble
//   2  Header/region lock   — deterministic fast path; AI fallback when ambiguous
//   3  Column → field map   — REASONER_A + REASONER_B parallel; reconcile
//   4  Row extraction       — BULK + BULK_ALT batch; multi-refId split; refId synthesis
//   5  Adversarial validation — VALIDATOR (gpt-5.1, OpenAI family; differs from BULK)
//   6  Reconcile             — pure aggregation; WRITES NOTHING
//
// Guaranteed invariants (enforced here and in each stage):
//   ✓ All AI calls are server-side (functions/ only; no browser AI client)
//   ✓ Every produced field carries a source-cell citation (sheet!cell + verbatim)
//   ✓ Models may only extract from cells present in the provided input
//   ✓ refIds are preserved byte-for-byte from source; never invented
//   ✓ If a field cannot be grounded → review flag, not a guess
//   ✓ VALIDATOR runs gpt-5.1 (OpenAI), decorrelated from BULK (haiku/Anthropic)
//   ✓ RoutingBudget circuit breaker is passed through and checked by extractFieldsWithRole()
//   ✓ Stage 6 writes nothing

import type { StructuralModel, SheetFingerprint } from '@pf/shared'
import type { StreamEvent } from '../../runtime'
import type { RoutingBudget } from '../../ai/router'
import { createBudget } from '../../ai/router'

import type { BrainOpts, BrainOutput, ReviewItem } from './types'
import { classifySheets }  from './stage1_classify'
import { lockHeaders }     from './stage2_headerLock'
import { mapColumns }      from './stage3_columnMap'
import { extractRows }     from './stage4_extract'
import { validateEntities } from './stage5_validate'
import { reconcileOutput } from './stage6_reconcile'

export type { BrainOpts, BrainOutput }

// ─── Default budget ───────────────────────────────────────────────────────────
// Per-import token ceiling. The RoutingBudget degrades to cheaper models at this
// threshold but does NOT hard-stop — the existing circuit breaker in router.ts
// will deny if the rolling spend window is exceeded.
const DEFAULT_TOKEN_CEILING = 300_000

// ─── SSE helper ───────────────────────────────────────────────────────────────

function emitStage(
  emit:   (ev: StreamEvent) => void,
  stage:  number,
  name:   string,
  phase:  'start' | 'end',
  detail?: string,
): void {
  emit({
    t:       'tool',
    name:    `brain:stage${stage}:${name}`,
    phase,
    summary: detail,
  })
}

// ─── Build fingerprint lookup ─────────────────────────────────────────────────

function buildFpMap(structural: StructuralModel): Map<string, SheetFingerprint> {
  const m = new Map<string, SheetFingerprint>()
  for (const fp of structural.sheets) m.set(fp.sheetName, fp)
  return m
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runAdaptiveImportBrain(opts: BrainOpts): Promise<BrainOutput> {
  const { structural, lobRefIdHint, emit: rawEmit } = opts
  const emit   = rawEmit ?? (() => {})
  const budget: RoutingBudget = opts.budget ?? createBudget(DEFAULT_TOKEN_CEILING)
  const review: ReviewItem[]  = []
  const fpMap  = buildFpMap(structural)

  // Emit initial metadata so the UI knows the workbook shape
  emit({ t: 'json', key: 'brain:input', value: {
    sourceName:  structural.sourceName,
    sourceType:  structural.sourceType,
    sheetCount:  structural.sheets.length,
    sheetNames:  structural.sheets.map(s => s.sheetName),
  }})

  // ── Stage 1: Sheet classification ──────────────────────────────────────────
  emitStage(emit, 1, 'classify', 'start', `Classifying ${structural.sheets.length} sheet(s)`)

  const classifiedSheets = await classifySheets(structural.sheets, budget, review)

  const contentCount = classifiedSheets.filter(s => s.domain !== 'ignore').length
  const ignoredCount = classifiedSheets.length - contentCount
  emitStage(emit, 1, 'classify', 'end', `${contentCount} content sheet(s), ${ignoredCount} ignored`)
  emit({ t: 'json', key: 'brain:stage1', value: classifiedSheets })

  // ── Stage 2: Header/region lock ────────────────────────────────────────────
  emitStage(emit, 2, 'headerLock', 'start', `Locking headers for ${contentCount} sheet(s)`)

  const headerLocks = await lockHeaders(classifiedSheets, fpMap, budget, review)

  emitStage(emit, 2, 'headerLock', 'end', `${headerLocks.length} header(s) locked`)
  emit({ t: 'json', key: 'brain:stage2', value: headerLocks })

  // ── Stage 3: Column → field mapping ───────────────────────────────────────
  emitStage(emit, 3, 'columnMap', 'start', `Mapping columns for ${contentCount} sheet(s)`)

  const columnMaps = await mapColumns(classifiedSheets, headerLocks, fpMap, budget, review)

  const totalMapped   = columnMaps.reduce((n, m) => n + m.mappings.filter(c => c.canonicalField !== null).length, 0)
  const totalUnmapped = columnMaps.reduce((n, m) => n + m.unmappedIndices.length, 0)
  emitStage(emit, 3, 'columnMap', 'end', `${totalMapped} mapped, ${totalUnmapped} unmapped`)
  emit({ t: 'json', key: 'brain:stage3', value: columnMaps })

  // ── Stage 4: Row extraction + normalization ────────────────────────────────
  emitStage(emit, 4, 'extract', 'start', 'Extracting rows')

  const entities = await extractRows(
    classifiedSheets, headerLocks, columnMaps, fpMap, budget, review, lobRefIdHint,
  )

  const flagged = entities.filter(e => e.reviewFlag).length
  emitStage(emit, 4, 'extract', 'end', `${entities.length} entities extracted, ${flagged} flagged`)
  emit({ t: 'json', key: 'brain:stage4', value: { entityCount: entities.length, flagged } })

  // Warn if budget was degraded during extraction
  if (budget.degraded) {
    emit({
      t:       'notice',
      level:   'warn',
      message: `Token budget ceiling reached during extraction. Some calls were degraded to cheaper models. Review the extraction for quality.`,
      kind:    'degrade',
    })
  }

  // ── Stage 5: Adversarial validation (VALIDATOR = gpt-5.1, OpenAI family) ──
  emitStage(emit, 5, 'validate', 'start', `Validating ${entities.length} entities`)

  const discrepancies = await validateEntities(entities, classifiedSheets, budget, review)

  emitStage(emit, 5, 'validate', 'end', `${discrepancies.length} discrepancy(ies) found`)
  emit({ t: 'json', key: 'brain:stage5', value: discrepancies })

  // ── Stage 6: Reconcile (writes nothing) ────────────────────────────────────
  emitStage(emit, 6, 'reconcile', 'start')

  const output = reconcileOutput(
    entities, classifiedSheets, headerLocks, columnMaps, review, discrepancies,
  )

  emitStage(emit, 6, 'reconcile', 'end', `${output.summaryCounts.entitiesProduced} entities, ${output.reviewQueue.length} review items`)
  emit({ t: 'json', key: 'brain:output', value: output.summaryCounts })

  return output
}

// ─── Convenience factory ──────────────────────────────────────────────────────
// Creates a fresh RoutingBudget for callers that don't supply one.

export { createBudget } from '../../ai/router'
