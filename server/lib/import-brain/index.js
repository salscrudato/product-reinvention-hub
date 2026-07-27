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
const { sweepUnaccounted }  = require('./stage45-sweeper')
const { validateEntities }  = require('./stage5-validate')
const { reconcileOutput }   = require('./stage6-reconcile')
const { createBudget }      = require('./ai-call')
const brainShared           = require('../import-brain-shared.cjs')

// ─── Digest → classify vocabulary crosswalk ───────────────────────────────────
// The stage-1a digest and the stage-1 classifier read in DIFFERENT vocabularies
// (stage1-digest.js KNOWN_DOMAINS vs constants.js SHEET_DOMAINS). Each entry maps
// a digest reading to every classify domain that means the same thing; anything
// outside its list is a real disagreement. `UNKNOWN` never reaches here (the
// caller skips it) and `ignore` is a classify-only outcome with no digest twin.
const DIGEST_TO_CLASSIFY = {
  framework:     ['product-framework'],
  forms:         ['forms'],
  rules:         ['rules'],
  // The digest does not split ROC programs from factor tables; stage 1 does.
  rating:        ['rating-roc', 'rate-tables'],
  definitions:   ['definitions'],
  // Dynamic fields are a property OF forms — the classifier has no separate domain.
  dynamicFields: ['forms'],
  // Form rules live in either vocabulary's rules domain; some books file them
  // under the forms sheet family.
  formRules:     ['rules', 'forms'],
  // A bare "tables" reading covers both factor-table families.
  tables:        ['rate-tables', 'limits-deductibles'],
}

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
  // CE3 Step 7 seam: per-stage checkpoint callback (unified-import persists the
  // artifact to Blob + emits brain:checkpoint). Best-effort — never blocks a stage.
  const onStage = typeof opts.onStage === 'function' ? opts.onStage : null
  const checkpoint = async (stage, artifact) => {
    if (!onStage) return
    try { await onStage(stage, artifact) } catch { /* checkpointing never fails the run */ }
  }

  // ── CE3 Step 1: open the AccountingLedger on the run context ───────────────
  // One SheetAccounting per censused sheet; stage 4 posts FACTs, the stage-4.5
  // sweeper classifies the residue, the rollup rides the output (conservation is
  // measured on every run, never assumed).
  const censusBySheet = new Map()
  const accounting = new Map()
  for (const census of (Array.isArray(opts.censuses) ? opts.censuses : [])) {
    for (const sheetCensus of (census && census.sheets) || []) {
      if (censusBySheet.has(sheetCensus.name)) continue
      censusBySheet.set(sheetCensus.name, sheetCensus)
      try { accounting.set(sheetCensus.name, brainShared.createAccounting(sheetCensus)) } catch { /* census aid, never a blocker */ }
    }
  }

  // Emit initial metadata so the UI knows the workbook shape.
  emit({ t: 'json', key: 'brain:input', value: {
    sourceName: structural.sourceName,
    sourceType: structural.sourceType,
    sheetCount: (structural.sheets || []).length,
    sheetNames: (structural.sheets || []).map(s => s.sheetName),
    // Placeholder cells the sentinel rule silenced at read time — recorded, so
    // "we stopped spending on 1,154 cells" is a number, not a claim.
    sentinelCells: structural.sentinelCells ?? 0,
    sentinelBySheet: structural.sentinelBySheet ?? {},
  } })

  // ── CE3 Step 7: resume — completed stage artifacts skip their stage entirely.
  const resume = opts.resume && typeof opts.resume === 'object' ? opts.resume : {}

  // ── Stage 1a: workbook digest (CE3 Step 2) ──────────────────────────────────
  // Compressed structural digest -> dual decorrelated readers (opus + gpt-5.1, each
  // with a code-bounded window-request tool) -> WORKBOOK_DIGEST synthesis (deep
  // reasoner on /responses, opus chat fallback). Telemetry + adjudication input:
  // the stage-1 prefilter skip-gate below stays exactly as-is.
  let workbookUnderstanding = null
  if (censusBySheet.size > 0) {
    emitStage(emit, 1, 'digest', 'start', `Digesting ${censusBySheet.size} censused sheet(s)`)
    try {
      const { digestWorkbook } = require('./stage1-digest')
      const d = resume.digest && resume.digest.understanding
        ? { understanding: resume.digest.understanding, resumed: true }
        : await digestWorkbook({ censuses: opts.censuses, structural, budget, review, emit })
      workbookUnderstanding = d && d.understanding ? d.understanding : null
      if (workbookUnderstanding && !d.resumed) await checkpoint('digest', { understanding: workbookUnderstanding })
    } catch (e) {
      review.push({ kind: 'digest-error', detail: `workbook digest failed: ${String(e && e.message || e).slice(0, 160)} — classification proceeds without it.` })
    }
    emitStage(emit, 1, 'digest', 'end', workbookUnderstanding ? `${workbookUnderstanding.perSheet.length} sheet reading(s)` : 'no understanding produced')
  }

  // ── Stage 1: Sheet classification ──────────────────────────────────────────
  emitStage(emit, 1, 'classify', 'start', `Classifying ${(structural.sheets || []).length} sheet(s)`)

  const classifiedSheets = Array.isArray(resume.stage1 && resume.stage1.classifiedSheets)
    ? (emitStage(emit, 1, 'classify', 'progress', 'restored from checkpoint (resume)'), resume.stage1.classifiedSheets)
    : await classifySheets(structural.sheets || [], budget, review)

  // Digest-vs-classify disagreements are review items (visible, never silent).
  //
  // They are compared through a CROSSWALK because the two vocabularies are
  // different by design and can never be literally equal: the digest reads in
  // {framework, forms, rules, rating, definitions, dynamicFields, formRules,
  // tables} (stage1-digest.js KNOWN_DOMAINS) and stage 1 classifies into
  // {product-framework, forms, rating-roc, rules, limits-deductibles,
  // rate-tables, definitions, ignore} (SHEET_DOMAINS). A literal `!==` therefore
  // fired on every CORRECTLY-read framework, rating and rate-table sheet, in
  // every import — a guaranteed floor of spurious items on the most common sheet
  // types in the corpus. Reviewer attention is the scarcest resource here (2,000+
  // entities on a large run), and a fixed noise floor directly raises wrong-accept
  // probability while drowning the real flags.
  //
  // The crosswalk is deliberately tight: it maps each digest reading onto the
  // classify domains that MEAN THE SAME THING, and nothing else. A genuine
  // disagreement (digest says forms, stage 1 says rating-roc) still fires.
  if (workbookUnderstanding) {
    const digestDomain = new Map(workbookUnderstanding.perSheet.map(s => [s.sheet, s.domain]))
    for (const c of classifiedSheets) {
      const dd = digestDomain.get(c.sheetName)
      if (!dd || dd === 'UNKNOWN' || c.domain === 'ignore') continue
      const agrees = DIGEST_TO_CLASSIFY[dd]
      // An unmapped digest reading is a vocabulary drift bug, not a sheet
      // disagreement — say so instead of blaming the sheet.
      if (!agrees) {
        review.push({ kind: 'digest-vocabulary-unmapped', sheetName: c.sheetName, detail: `workbook digest returned domain "${dd}", which has no entry in the digest→classify crosswalk — the vocabularies have drifted apart; the comparison for "${c.sheetName}" could not be made.` })
        continue
      }
      if (agrees.includes(c.domain)) continue
      review.push({ kind: 'digest-classify-disagreement', sheetName: c.sheetName, detail: `digest read "${c.sheetName}" as ${dd} (≡ ${agrees.join(' or ')}); stage-1 classified ${c.domain} — review which is right.` })
    }
  }

  const contentCount = classifiedSheets.filter(s => s.domain !== 'ignore').length
  const ignoredCount = classifiedSheets.length - contentCount
  emitStage(emit, 1, 'classify', 'end', `${contentCount} content sheet(s), ${ignoredCount} ignored`)
  emit({ t: 'json', key: 'brain:stage1', value: classifiedSheets })
  await checkpoint('stage1', { classifiedSheets })

  // ── Stage 2: Header/region lock ────────────────────────────────────────────
  emitStage(emit, 2, 'headerLock', 'start', `Locking headers for ${contentCount} sheet(s)`)

  const headerLocks = Array.isArray(resume.stage2 && resume.stage2.headerLocks)
    ? (emitStage(emit, 2, 'headerLock', 'progress', 'restored from checkpoint (resume)'), resume.stage2.headerLocks)
    : await lockHeaders(classifiedSheets, fpMap, budget, review)

  emitStage(emit, 2, 'headerLock', 'end', `${headerLocks.length} header(s) locked`)
  emit({ t: 'json', key: 'brain:stage2', value: headerLocks })
  await checkpoint('stage2', { headerLocks })

  // ── Stage 3: Column -> field mapping ───────────────────────────────────────
  emitStage(emit, 3, 'columnMap', 'start', `Mapping columns for ${contentCount} sheet(s)`)

  const columnMaps = Array.isArray(resume.stage3 && resume.stage3.columnMaps)
    ? (emitStage(emit, 3, 'columnMap', 'progress', 'restored from checkpoint (resume)'), resume.stage3.columnMaps)
    : await mapColumns(classifiedSheets, headerLocks, fpMap, budget, review)

  const totalMapped   = columnMaps.reduce((n, m) => n + m.mappings.filter(c => c.canonicalField !== null).length, 0)
  const totalUnmapped = columnMaps.reduce((n, m) => n + m.unmappedIndices.length, 0)
  emitStage(emit, 3, 'columnMap', 'end', `${totalMapped} mapped, ${totalUnmapped} unmapped`)
  emit({ t: 'json', key: 'brain:stage3', value: columnMaps })
  await checkpoint('stage3', { columnMaps })

  // ── Stage 4: Row extraction + normalization ────────────────────────────────
  emitStage(emit, 4, 'extract', 'start', 'Extracting rows')

  // Resume: per-sheet stage-4 checkpoints restore completed sheets without re-extraction.
  const completedSheets = new Map()
  for (const [name, entities] of Object.entries((resume.stage4 && resume.stage4.sheets) || {})) {
    if (Array.isArray(entities)) completedSheets.set(name, entities)
  }
  const columnCoverage = []
  const entities = await extractRows(classifiedSheets, headerLocks, columnMaps, fpMap, budget, review, lobRefIdHint,
    (detail) => emitStage(emit, 4, 'extract', 'progress', detail),
    {
      censusBySheet, accounting, tenantId: opts.tenantId, completedSheets, columnCoverage,
      onSheetComplete: onStage ? (sheetName, sheetEntities) => onStage(`stage4/${sheetName}`, { sheetName, entities: sheetEntities }) : undefined,
    })

  const flagged = entities.filter(e => e.reviewFlag).length
  emitStage(emit, 4, 'extract', 'end', `${entities.length} entities extracted, ${flagged} flagged`)
  emit({ t: 'json', key: 'brain:stage4', value: { entityCount: entities.length, flagged } })
  await checkpoint('stage4', { entityCount: entities.length, flagged })

  // Column-coverage rollup: `belowReadThreshold` is the count of mapped columns the
  // deterministic reader would have skipped (the pre-fix "unread" number);
  // `unread` is what survived the recovery pass. Both ride the output and the SSE
  // stream so the before/after is a measured per-run figure, never an inference.
  const columnRollup = columnCoverage.reduce((acc, c) => ({
    sheets: acc.sheets + 1,
    mappedColumns: acc.mappedColumns + c.mappedColumns,
    belowReadThreshold: acc.belowReadThreshold + c.belowReadThreshold,
    recovered: acc.recovered + c.recovered,
    unread: acc.unread + c.unread,
    empty: acc.empty + c.empty,
  }), { sheets: 0, mappedColumns: 0, belowReadThreshold: 0, recovered: 0, unread: 0, empty: 0 })
  emit({ t: 'json', key: 'brain:columns', value: { ...columnRollup, perSheet: columnCoverage } })
  console.log(`[import-brain] column coverage: ${columnRollup.mappedColumns} mapped, ${columnRollup.belowReadThreshold} below the deterministic read floor, ${columnRollup.recovered} recovered by the AI path, ${columnRollup.unread} still unread, ${columnRollup.empty} empty`)

  if (budget.degraded) {
    emit({ t: 'notice', level: 'warn', message: 'Token budget soft ceiling reached during extraction. Some calls used cheaper models. Review extraction quality.', kind: 'degrade' })
  }

  // ── Stage 4.5: conservation sweeper (CE3 Step 4) ────────────────────────────
  // The ledger's UNACCOUNTED residue gets classified into the allowed noise
  // vocabulary or proposed as cited FACTs; everything else becomes NEEDS_REVIEW +
  // first-class census_unaccounted plan items. Vocabulary is enforced in code.
  let sweeper = { sweptFacts: [], unresolvedItems: [], perSheet: [] }
  if (accounting.size > 0) {
    // Sweep content sheets — REASONED-ignore sheets have no extraction to fill the
    // ledger, so all their cells are UNACCOUNTED and sweeping them burns hundreds of
    // AI calls for zero data gain (noise classification on irrelevant cells).
    //
    // PREFILTER-skipped sheets are the exception and go back IN. Nothing reasoned
    // about them at all: two 1024-token bulk voters agreed to drop the sheet before
    // any classifier saw it, and excluding them from the sweep as well meant a
    // whole sheet could leave the pipeline with no entity, no review item, and no
    // cell disposition. Their census already exists, and SWEEP_MAX_PER_SHEET bounds
    // the cost at 300 cells — the price of never dropping a sheet in silence.
    const sweepable = (s) => s.domain !== 'ignore' || s.prefilterSkipped === true
    const contentSheetNames = new Set(classifiedSheets.filter(sweepable).map(s => s.sheetName))
    const contentAccounting = new Map([...accounting].filter(([n]) => contentSheetNames.has(n)))
    emitStage(emit, 4, 'sweep', 'start', `Sweeping unaccounted cells on ${contentAccounting.size} content sheet(s)`)
    try {
      sweeper = await sweepUnaccounted({ accounting: contentAccounting, censusBySheet, budget, review, emit })
    } catch (e) {
      review.push({ kind: 'sweeper-error', detail: `stage 4.5 sweeper failed: ${String(e && e.message || e).slice(0, 160)} — unaccounted residue stays visible in the accounting rollup.` })
    }
    emitStage(emit, 4, 'sweep', 'end', `${sweeper.perSheet.reduce((n, s) => n + s.swept, 0)} cell(s) classified, ${sweeper.perSheet.reduce((n, s) => n + s.reviewed, 0)} for review`)
    await checkpoint('stage4.5', { perSheet: sweeper.perSheet, unresolvedItems: sweeper.unresolvedItems.length })
  }

  // ── Stage 5: Adversarial validation (gpt-5.1 / OpenAI, decorr. from BULK) ──
  emitStage(emit, 5, 'validate', 'start', `Validating ${entities.length} entities`)

  const discrepancies = await validateEntities(entities, classifiedSheets, budget, review, fpMap)

  emitStage(emit, 5, 'validate', 'end', `${discrepancies.length} discrepancy(ies) found`)
  emit({ t: 'json', key: 'brain:stage5', value: discrepancies })
  await checkpoint('stage5', { discrepancyCount: discrepancies.length })

  // ── Stage 6: Reconcile (writes nothing) ────────────────────────────────────
  emitStage(emit, 6, 'reconcile', 'start')

  const output = reconcileOutput(entities, classifiedSheets, headerLocks, columnMaps, review, discrepancies)

  emitStage(emit, 6, 'reconcile', 'end', `${output.summaryCounts.entitiesProduced} entities, ${output.reviewQueue.length} review items`)
  emit({ t: 'json', key: 'brain:output', value: output.summaryCounts })

  // ── CE3: accounting rollup rides the output (conservation, measured) ────────
  if (accounting.size > 0) {
    const sheetRollups = []
    for (const [sheetName, acc] of accounting) {
      try { sheetRollups.push(brainShared.rollupSheet(acc)) } catch (e) {
        review.push({ kind: 'accounting-conservation-broken', sheetName, detail: String(e && e.message || e).slice(0, 200) })
      }
    }
    try {
      output.accounting = brainShared.rollupWorkbook(structural.sourceName || '', sheetRollups)
    } catch { output.accounting = { sourceName: structural.sourceName || '', sheets: sheetRollups } }
    output.sweeper = { facts: sweeper.sweptFacts, unresolvedItems: sweeper.unresolvedItems, perSheet: sweeper.perSheet }
  }
  if (workbookUnderstanding) output.workbookUnderstanding = workbookUnderstanding
  output.columnCoverage = { ...columnRollup, perSheet: columnCoverage }

  // Per-run spend telemetry — the no-cap import switch removes the CAP, never the
  // TELEMETRY. Logged server-side and streamed so operators see true import cost.
  const spend = {
    spendUsd:     Math.round((budget.spendUsd || 0) * 1e4) / 1e4,
    calls:        budget.calls || 0,
    noCap:        Boolean(budget.noCap),
    cacheHits:    budget.cacheHits || 0,
    cacheMisses:  budget.cacheMisses || 0,
    cacheBypasses: budget.cacheBypasses || 0,
    byDeployment: budget.byDeployment || {},
    // Per-site, per-family vote participation (cast/attempted + failure classes):
    // a run whose OpenAI legs silently stopped voting is measurable, not invisible.
    votes:        budget.votes || {},
  }
  console.log(`[import-brain] run spend: $${spend.spendUsd} across ${spend.calls} call(s)`, JSON.stringify(spend.byDeployment))
  emit({ t: 'json', key: 'brain:spend', value: spend })
  if ((budget.cacheHits || 0) + (budget.cacheMisses || 0) > 0) {
    emit({ t: 'json', key: 'brain:cache', value: { hits: budget.cacheHits || 0, misses: budget.cacheMisses || 0 } })
  }

  return output
}

module.exports = { runAdaptiveImportBrain, createBudget }
