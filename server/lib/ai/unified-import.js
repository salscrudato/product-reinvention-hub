'use strict'
// server/lib/ai/unified-import.js — POST /api/ai/unifiedImport (SSE).
//
// Flow (import path — NO COST CAP, telemetry always recorded):
//   Stage 0 router (server-side, magic-byte sniff — never filename):
//     * XLSX / XLSM / CSV  → parse with ExcelJS server-side, build StructuralModel
//                            with REAL cells → 6-stage adaptive brain → ImportPlan bundle
//     * text PDF           → filing pipeline (whole-document text in context)
//     * scanned/encrypted/CID-font PDF → filing pipeline with NATIVE PDF document
//                            blocks (vision-capable models read pages directly)
//   Legacy back-compat:
//     * body.structural    → brain directly (harness / older clients)
//     * stage-filing absent → single-pass forced-tool fallback
//
// Every produced field carries a source citation + confidence; validator findings
// become importWarnings — nothing is silently dropped. The bundle's plan persists
// through the app's standard adapter.db.mutate path (importPlan()).

const { hasCapability } = require('../authz')
const { resolveTenantForPrincipal } = require('../auth')
const fleet = require('../fleet')
const { sse, emit, _forcedToolCall, _extractPdfText, _findSampleFile, getImportBrain, getStageFiling } = require('./_shared')
const { persistRunResult, fetchRunResult, sanitizeRunId } = require('./run-results')
const { createRunTrace } = require('./run-trace')
const { isDraining } = require('./drain')
const observatory = require('./run-observatory')
const fs = require('fs')
const crypto = require('crypto')

// ─── Source content hash (resume guard) ───────────────────────────────────────
// Resume used to trust the run id ALONE. A run id is a client-minted string, not
// a statement about the input: resuming a run id after swapping the file replayed
// stage-1..3 artifacts — classifications, header locks, column maps — built from
// the OLD grids against the NEW ones. Nothing detected it; the mismatch just
// produced a plausible, wrong import.
//
// Every checkpoint now carries a hash of the bytes it was derived from, and a
// resume whose artifacts do not all match the current input is REFUSED. Name and
// content both ride the hash: same content under a different filename is a
// different import (sourceName travels into entity provenance), and same filename
// with different content is the exact swap this exists to catch.
function contentHashOfDocuments(documents) {
  const parts = (Array.isArray(documents) ? documents : [])
    .map(d => {
      const body = typeof (d && d.base64) === 'string' ? d.base64 : (typeof (d && d.text) === 'string' ? d.text : '')
      return `${String((d && d.name) || '')}:${crypto.createHash('sha256').update(body).digest('hex')}`
    })
    .sort()                                   // upload ORDER is not part of the input's identity
  if (parts.length === 0) return null
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex')
}

/** Decide whether a set of checkpoint payloads may be replayed against `sourceHash`.
 *  An UNSTAMPED payload is refused too: it predates the guard, so it cannot be
 *  shown to match — and "cannot be shown to match" is precisely the condition the
 *  guard exists for. Returns { ok, reason }. */
function checkpointsMatchSource(payloads, sourceHash) {
  const list = (Array.isArray(payloads) ? payloads : []).filter(Boolean)
  if (list.length === 0) return { ok: true, reason: 'no checkpoints' }
  if (!sourceHash) return { ok: false, reason: 'the current upload has no content hash, so no checkpoint can be shown to belong to it' }
  const unstamped = list.filter(p => typeof p.sourceHash !== 'string' || p.sourceHash === '')
  if (unstamped.length > 0) {
    return { ok: false, reason: `${unstamped.length} of ${list.length} checkpoint(s) predate the content-hash guard and cannot be shown to belong to this upload` }
  }
  const mismatched = list.filter(p => p.sourceHash !== sourceHash)
  if (mismatched.length > 0) {
    return { ok: false, reason: `${mismatched.length} of ${list.length} checkpoint(s) were built from different bytes (checkpoint ${String(mismatched[0].sourceHash).slice(0, 12)}… vs upload ${String(sourceHash).slice(0, 12)}…) — the file changed since that run` }
  }
  return { ok: true, reason: `${list.length} checkpoint(s) match the upload` }
}

/** Server-minted run id — durability is default-ON. Opt-in durability meant the
 *  most expensive operation in the product lost its safety net whenever a caller
 *  simply did not think to supply an id. Shaped for sanitizeRunId (8-64 chars,
 *  conservative charset) since it becomes a blob path segment. */
function mintRunId() {
  return `run-${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

const HAIKU_OVERRIDE = process.env.AZURE_FOUNDRY_HAIKU_DEPLOYMENT || ''

const _PROPOSE_COVERAGES = {
  name: 'propose_coverages',
  description: 'Return the coverages the base form actually defines. Only include coverages the document describes — never invent a coverage, form, limit or requirement. When the document does not establish a fact (mandatory status, premium treatment), say UNKNOWN — never guess.',
  input_schema: {
    type: 'object',
    properties: {
      coverages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:              { type: 'string' },
            requirement:       { type: 'string', enum: ['MANDATORY', 'OPTIONAL', 'UNKNOWN'], description: 'UNKNOWN when the document does not establish product-level mandatory status.' },
            premiumGenerating: { type: 'string', enum: ['YES', 'NO', 'UNKNOWN'], description: 'UNKNOWN when the document does not state premium treatment.' },
            formNumbers:       { type: 'array', items: { type: 'string' }, description: 'Form numbers exactly as printed. Only numbers present in the document.' },
            limitHint:         { type: 'string' },
            confidence:        { type: 'number', description: '0..1 confidence this coverage is correctly identified.' },
            citation:          { type: 'string', description: 'Section/heading where found. REQUIRED — proposals without a citation are discarded.' },
          },
          required: ['name', 'requirement', 'premiumGenerating', 'confidence', 'citation'],
        },
      },
      note: { type: 'string' },
    },
    required: ['coverages'],
  },
}

const _IMPORT_SYSTEM =
  'You are a P&C actuarial analyst extracting structured coverage data from an insurance policy form. ' +
  'Ground EVERY coverage in the document\'s actual text — never invent a coverage, form number, or limit. ' +
  'Cite each item by section or heading. Include form numbers only if they literally appear in the document. ' +
  'Call propose_coverages exactly once with ALL coverages the form defines.'

// ─── Bundle normalization ─────────────────────────────────────────────────────
// Every emitted bundle must present the FULL UnifiedProposalBundle surface — the
// review UI dereferences review sections, sampledVerifications, splitProducts,
// unresolved etc. without guards, and a missing array is a client crash.

function normalizeBundle(bundle, { container = 'PDF', detectedFormat = 'COMPANY_FILING_PDF', documents = [] } = {}) {
  const b = bundle && typeof bundle === 'object' ? bundle : {}
  b.plan = b.plan && typeof b.plan === 'object' ? b.plan : {}
  for (const k of ['coverages', 'forms', 'rules', 'formRules', 'ldTables', 'rtTables', 'products']) {
    if (!Array.isArray(b.plan[k])) b.plan[k] = []
  }
  if (b.plan.product === undefined) b.plan.product = null
  if (b.plan.ratingProgram === undefined) b.plan.ratingProgram = null
  if (b.plan.productId === undefined) b.plan.productId = null
  b.plan.summary = b.plan.summary && typeof b.plan.summary === 'object' ? b.plan.summary : {}
  for (const k of ['warnings', 'unmappedColumns', 'sheetsRecognized', 'sheetsSkipped', 'defects', 'notices']) {
    if (!Array.isArray(b.plan.summary[k])) b.plan.summary[k] = []
  }
  b.review = b.review && typeof b.review === 'object' ? b.review : {}
  for (const k of ['product', 'coverages', 'tables', 'rules', 'rating']) {
    if (!b.review[k] || typeof b.review[k] !== 'object') b.review[k] = { items: [] }
    if (!Array.isArray(b.review[k].items)) b.review[k].items = []
  }
  for (const k of ['unresolved', 'sampledVerifications', 'splitProducts', 'importWarnings', 'provenance']) {
    if (!Array.isArray(b[k])) b[k] = []
  }
  if (!Array.isArray(b.ensembleDisagreements)) b.ensembleDisagreements = []
  if (!b.counts || typeof b.counts !== 'object') b.counts = { proposed: 0, accepted: 0, unresolved: 0 }
  if (!b.fingerprint || typeof b.fingerprint !== 'object') {
    b.fingerprint = {
      container, detectedFormat,
      lineGuesses: [],
      documentRoles: documents.map(d => ({ documentName: d.name, role: 'unknown', confidence: 0 })),
    }
  }
  if (!Array.isArray(b.fingerprint.lineGuesses)) b.fingerprint.lineGuesses = []
  if (!Array.isArray(b.fingerprint.documentRoles)) b.fingerprint.documentRoles = []
  if (!b.extractionPlan || typeof b.extractionPlan !== 'object') {
    b.extractionPlan = { format: detectedFormat, lobRefId: '', archetype: null, documentRoleAssignments: [], splitStrategy: 'SINGLE_PRODUCT' }
  }
  if (!Array.isArray(b.extractionPlan.documentRoleAssignments)) b.extractionPlan.documentRoleAssignments = []
  if (!Array.isArray(b.coverages)) {
    b.coverages = b.plan.coverages.map(p => ({ refId: p.refId ?? '', name: p.data?.name ?? p.label ?? '', formNumbers: Array.isArray(p.data?.formNumbers) ? p.data.formNumbers : [] }))
  }
  return b
}

// ─── Merge multiple workbook structural models into one brain input ───────────
// Sheet names must stay citable: kept verbatim when unique across workbooks; a
// collision gets " (workbook name)" appended so citations remain unambiguous.

function mergeStructurals(workbooks) {
  if (workbooks.length === 1) return workbooks[0].structural
  const seen = new Set()
  const sheets = []
  const definitionsBySheet = {}
  for (const wb of workbooks) {
    for (const fp of wb.structural.sheets || []) {
      let name = fp.sheetName
      if (seen.has(name)) name = `${fp.sheetName} (${wb.name})`
      seen.add(name)
      const renamed = name === fp.sheetName ? fp : { ...fp, sheetName: name }
      sheets.push(renamed)
      if (renamed.definitions && renamed.definitions.length > 0) definitionsBySheet[name] = renamed.definitions
    }
  }
  return {
    sourceName: workbooks.map(w => w.name).join(' + '),
    sourceType: workbooks[0].structural.sourceType,
    sheets,
    definitionsBySheet,
  }
}

// ─── Multi-product workbook detection ────────────────────────────────────────
// A workbook is "self-contained" (a complete product spec) when it has enough
// distinct content sheets to stand alone. A supplementary file (e.g. a single
// forms-only or rating-only sheet) merges with its siblings instead.
//
// SELF_CONTAINED_THRESHOLD: workbooks with this many total sheets are treated as
// independent products. Calibrated at 4: the largest supplementary ISO sample
// files have 2–3 sheets (sample-GL-forms, sample-GL-pricing, etc.) while every
// full product spec seen in the corpus (Core, Hagerty, SECURA) has ≥ 4 sheets.
const SELF_CONTAINED_THRESHOLD = 4

function partitionWorkbooks(workbooks) {
  if (workbooks.length <= 1) return { groups: [workbooks], isSplit: false }
  const selfContained = workbooks.filter(wb => (wb.structural?.sheets || []).length >= SELF_CONTAINED_THRESHOLD)
  // When ≥ 2 files are each self-contained → each is its own product run.
  if (selfContained.length >= 2) {
    // CONSERVATION: the sub-threshold files are supplementary (a rating-only or forms-only
    // book), not noise. Returning only `selfContained` DROPPED them — not merged, not in the
    // plan, not in skippedDocuments, no warning — so coverages priced against rate tables that
    // were silently never read. There is no evidence saying which product they belong to, so
    // they are not guessed into one: they are reported, and the caller surfaces them.
    const supplementary = workbooks.filter(wb => !selfContained.includes(wb))
    return { groups: selfContained.map(wb => [wb]), isSplit: true, supplementary }
  }
  // Otherwise (0 or 1 self-contained) → merge all, same as before.
  return { groups: [workbooks], isSplit: false, supplementary: [] }
}

// ─── Run the brain over a structural model and emit the plan bundle ───────────

async function runBrainToBundle({ structural, lobRefIdHint, edition, routerWarnings, budget, send, isoGrids, skippedDocuments, censuses, hiddenSheets, onStage, resume, tenantId }) {
  const brain = getImportBrain()
  if (typeof brain.runAdaptiveImportBrain !== 'function') {
    throw new Error('Import brain not available (build:import-brain may not have run).')
  }
  const brainOutput = await brain.runAdaptiveImportBrain({
    structural,
    lobRefIdHint: lobRefIdHint || undefined,
    budget,
    emit: send,
    censuses: censuses || [],
    onStage,
    resume,
    tenantId,
  })

  // Deterministic ISO-family mapper as canonical-identity oracle: when the raw
  // grids parse into a recognizable plan, stage 7 joins its registry-derived
  // refIds/hierarchy/order with the brain's cited fields.
  let isoPlan = null
  if (Array.isArray(isoGrids) && isoGrids.length > 0) {
    try {
      const brainShared = require('../import-brain-shared.cjs')
      if (typeof brainShared.mapIsoWorkbook === 'function') {
        isoPlan = brainShared.mapIsoWorkbook(isoGrids)
        send({ t: 'tool', name: 'brain:stage7:isoJoin', phase: 'start', summary: `deterministic mapper: ${isoPlan?.coverages?.length ?? 0} coverages, ${isoPlan?.rules?.length ?? 0} rules` })
      }
    } catch (e) {
      send({ t: 'notice', level: 'info', message: `Deterministic ISO mapper skipped: ${String(e.message).slice(0, 120)}`, kind: 'iso-mapper' })
      isoPlan = null
    }
  }

  send({ t: 'tool', name: 'brain:stage7:plan', phase: 'start', summary: 'Assembling the reviewable import plan' })
  // Near-dup sheet clusters from the CE1 census fingerprints (CE3 Step 1): every
  // cluster member was extracted; stage 7 folds byte-identical facts and turns
  // conflicting ones into review items carrying the cluster evidence.
  let sheetClusters = []
  try {
    const brainShared = require('../import-brain-shared.cjs')
    if (typeof brainShared.nearDuplicateSheetClusters === 'function') {
      for (const c of censuses || []) {
        if (c && Array.isArray(c.sheets) && c.sheets.length > 0) {
          sheetClusters.push(...brainShared.nearDuplicateSheetClusters(c))
        }
      }
    }
  } catch { sheetClusters = [] }
  const { buildImportPlan } = require('../import-brain/stage7-plan')
  const bundle = buildImportPlan(brainOutput, {
    lobRefIdHint: lobRefIdHint || undefined,
    sourceName:   structural.sourceName,
    edition:      edition || undefined,
    routerWarnings: routerWarnings || [],
    isoPlan,
    hiddenSheets: hiddenSheets || [],
    sheetClusters,
  })
  send({ t: 'tool', name: 'brain:stage7:plan', phase: 'end', summary: `${bundle.counts?.accepted ?? 0} accepted, ${bundle.counts?.unresolved ?? 0} unresolved, ${bundle.importWarnings?.length ?? 0} warning(s)` })
  send({ t: 'json', key: 'brain:stage7', value: {
    counts: bundle.counts, completeness: bundle.completeness,
    warnings: Array.isArray(bundle.importWarnings) ? bundle.importWarnings.length : 0,
  } })

  // M1 (Phase M): a mixed upload SKIPS its PDFs — that skip is a filter above the
  // conservation ledger (F22's lesson), so every skipped document becomes a review
  // citizen in F13's exact contract shape: a NAMED unresolved item plus a named
  // warning, with proposed/unresolved counted together. The aggregate mixed-upload
  // notice (why the skip happened) stays at the routing seam.
  for (const name of (skippedDocuments || [])) {
    bundle.importWarnings.push({ kind: 'unprocessed-document', sheet: null, row: null, field: null, detail: `${name} arrived in a mixed upload — not extracted (the workbook plan was produced); re-upload it separately for filing extraction.` })
    bundle.unresolved.push({ stage: 'classify', kind: 'unprocessed-document', name, reason: 'mixed upload: workbooks were imported; this PDF was not extracted', citation: 'mixed-upload' })
    bundle.counts.proposed += 1
    bundle.counts.unresolved += 1
  }

  // Completeness alert: a forms-only / rating-only upload cannot stand alone as a
  // product — tell the user what is likely missing (first-principles pillars).
  if (bundle.completeness && bundle.completeness.assessment !== 'COMPLETE' && bundle.completeness.assessment !== 'EMPTY') {
    send({ t: 'notice', level: 'warn', kind: 'incomplete-product', message: bundle.completeness.guidance })
  }

  normalizeBundle(bundle, { container: 'XLSX', detectedFormat: 'ISO_WORKBOOK' })
  send({ t: 'json', key: 'bundle', value: bundle })
  send({ t: 'token', v: JSON.stringify({ coverages: bundle.coverages }) })
  return bundle
}

async function unifiedImport(req, res) {
  if (!hasCapability(req.user, 'product:write')) {
    return res.status(403).json({ error: 'forbidden', need: 'product:write', have: req.user.role })
  }

  const body = req.body || {}

  // Do not start a ~$70 / ~110-minute run inside a container that is shutting
  // down: it would be destroyed within the grace window with nothing to show.
  // Refused BEFORE the SSE handshake so the client sees a real status code.
  if (isDraining()) {
    return res.status(503).set('Retry-After', '120').json({
      error: 'draining',
      detail: 'This host is shutting down for a deployment and is not accepting new imports. Retry in a couple of minutes.',
    })
  }

  sse(res)

  // F23: a run id makes the finished bundle DURABLE — persisted server-side at
  // completion (run-results.js) so a severed stream costs a reconnect, not a $70
  // re-run. Durability is now DEFAULT-ON: an absent or malformed client id is
  // replaced with a server-minted one rather than silently disabling the safety
  // net on the most expensive operation in the product. The id is streamed back
  // (run:id) so the client can reconnect or resume with it either way.
  const runId = sanitizeRunId(body.runId) || mintRunId()
  const runTenant = resolveTenantForPrincipal(req.user)
  // Bytes the checkpoints of THIS run are derived from (resume guard).
  const sourceHash = contentHashOfDocuments(body.documents)

  const runStartedAt = new Date().toISOString()
  const runFileNames = (Array.isArray(body.documents) ? body.documents : []).map(d => String((d && d.name) || '')).filter(Boolean).slice(0, 20)
  // Run-trace telemetry: every SSE frame is observed BEFORE it hits the wire, so
  // a finished (or crashed, or client-abandoned) run leaves a durable per-stage
  // record for the admin Import Runs surface. Never throws, never gates the run.
  const tracer = createRunTrace({
    runId,
    tenantId: runTenant,
    actor: req.user ? { uid: req.user.uid, name: req.user.name, role: req.user.role } : null,
  })
  const send = (ev) => { tracer.observe(ev); emit(res, ev) }

  if (runId) send({ t: 'json', key: 'run:id', value: { runId } })
  const persistIfRequested = async (bundle) => {
    if (!runId || !bundle) return
    const r = await persistRunResult({ tenantId: runTenant, runId, bundle })
    if (!r.ok) console.warn(`[unifiedImport] run ${runId}: bundle persistence failed (${r.reason})`)
    send({ t: 'json', key: 'run:persisted', value: { runId, ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) } })
    // CE3 Step 8 observatory: a compact, replayable index doc + the bundle as a
    // stage artifact. Best-effort telemetry — never fails the run, never blocks.
    try {
      const plan = (bundle && bundle.plan) || {}
      const metrics = {
        products: (plan.products || []).length,
        coverages: (plan.coverages || []).length,
        forms: (plan.forms || []).length,
        rules: (plan.rules || []).length,
        unresolved: (bundle.unresolved || []).length,
        importWarnings: (bundle.importWarnings || []).length,
      }
      await observatory.persistImportRun({
        tenantId: runTenant, runId,
        indexDoc: {
          startedAt: runStartedAt,
          status: 'ok',
          fileNames: runFileNames,
          metrics,
          spend: { byDeployment: (budget && budget.byDeployment) || {}, spendUsd: Math.round(((budget && budget.spendUsd) || 0) * 1e4) / 1e4, calls: (budget && budget.calls) || 0, votes: (budget && budget.votes) || {} },
          checkpointRefs: [],
        },
      })
      await observatory.persistStageArtifact({ tenantId: runTenant, runId, stage: 'bundle', artifact: { metrics, bundleCounts: bundle.counts || null } })
    } catch (e) {
      console.warn(`[unifiedImport] run ${runId}: observatory persistence failed (${String(e && e.message).slice(0, 120)})`)
    }
  }

  // ── CE3 Step 7: per-stage checkpoints + resume ──────────────────────────────
  // With a run id, every completed stage persists its output as a Blob artifact
  // (import-runs/{tenant}/{runId}/{stage}.json) and emits brain:checkpoint. A
  // resumeRunId in the body reloads those artifacts so completed stages — and
  // completed stage-4 SHEETS — are restored, never re-run.
  const onStage = runId ? async (stage, artifact) => {
    // Per-sheet stage-4 checkpoints encode the sheet into a slash-free slug; the
    // artifact body carries the true sheetName (resume reads bodies, never slugs).
    // EVERY artifact is stamped with the hash of the bytes it came from — that
    // stamp is what makes a resume verifiable instead of merely hopeful.
    const isSheet = typeof stage === 'string' && stage.startsWith('stage4/')
    const stageKey = isSheet ? observatory.sheetStageSlug(stage.slice(7)) : stage
    const stamped = { ...(artifact && typeof artifact === 'object' ? artifact : { value: artifact }), sourceHash }
    const r = await observatory.persistStageArtifact({ tenantId: runTenant, runId, stage: stageKey, artifact: stamped })
    if (r && r.ok) emit(res, observatory.checkpointEvent(stageKey, isSheet ? stage.slice(7) : null, `${runId}/${stageKey}`))
  } : undefined
  let resume
  const resumeRunId = sanitizeRunId(body.resumeRunId)
  if (resumeRunId) {
    resume = { stage4: { sheets: {} } }
    try {
      const list = await observatory.listStageArtifacts({ tenantId: runTenant, runId: resumeRunId })
      const stages = (list && list.status === 'ok' && Array.isArray(list.stages)) ? list.stages : []
      const payloads = []
      const staged = []
      for (const stage of stages) {
        const got = await observatory.getStageArtifact({ tenantId: runTenant, runId: resumeRunId, stage })
        if (!got || got.status !== 'ok' || !got.artifact) continue
        const payload = got.artifact.artifact // wrapper {runId, stage, at, artifact}
        if (!payload) continue
        payloads.push(payload)
        staged.push({ stage, payload })
      }
      // THE GUARD. Checkpoints are replayed only when every one of them is proven
      // to come from the bytes in front of us. A mismatch means the file changed
      // since that run, and replaying stage-1..3 artifacts against new grids is
      // a wrong import that looks exactly like a right one.
      const verdict = checkpointsMatchSource(payloads, sourceHash)
      if (!verdict.ok) {
        emit(res, { t: 'notice', level: 'warn', kind: 'resume-refused', message: `Resume from ${resumeRunId} REFUSED: ${verdict.reason}. Running from the start — a stale checkpoint replayed against different bytes produces a wrong import that looks like a correct one.` })
        resume = undefined
      } else {
        for (const { stage, payload } of staged) {
          if (stage.startsWith('stage4.')) {
            if (payload.sheetName && Array.isArray(payload.entities)) resume.stage4.sheets[payload.sheetName] = payload.entities
          } else if (/^stage[1-9]/.test(stage)) {
            resume[stage] = payload
          }
        }
        const restoredSheets = Object.keys(resume.stage4.sheets).length
        const restoredStages = Object.keys(resume).filter(k => k !== 'stage4').length
        if (restoredSheets + restoredStages === 0) resume = undefined
        emit(res, { t: 'notice', level: 'info', kind: 'resume', message: resume ? `Resuming run ${resumeRunId}: restored ${restoredStages} stage checkpoint(s) + ${restoredSheets} extracted sheet(s); ${verdict.reason}.` : `Resume from ${resumeRunId}: no checkpoints found — running from the start.` })
      }
    } catch (e) {
      emit(res, { t: 'notice', level: 'warn', kind: 'resume', message: `Resume from ${resumeRunId} unavailable (${String(e && e.message).slice(0, 80)}) — running from the start.` })
      resume = undefined
    }
  }

  // SSE keepalive: Azure App Service closes connections idle >~230s; long stage-4
  // extractions can be silent longer than that. Comment lines (":hb") are protocol
  // no-ops every client ignores. Cleared on end/close.
  const heartbeat = setInterval(() => { try { res.write(':hb\n\n') } catch { /* closed */ } }, 15_000)
  res.on('close', () => clearInterval(heartbeat))

  // Import path runs with the EXPLICIT no-cap budget: never denied, never degraded,
  // spend fully recorded (fleet.record on every call + per-run brain:spend event).
  const brainMod = getImportBrain()
  const budget = typeof brainMod.createBudget === 'function'
    ? brainMod.createBudget({ noCap: true })
    : { degraded: false, noCap: true, spendUsd: 0, calls: 0, byDeployment: {} }
  // Additive SSE: a REAL escalation event whenever the haiku→sonnet→opus ladder
  // actually hands off (see ai-call.js escalateAnthropic). Existing consumers
  // ignore unknown json keys; the agent visualizer renders the hand-off live.
  budget.onEscalation = (info) => {
    try { send({ t: 'json', key: 'brain:escalation', value: info }) } catch { /* stream closed */ }
  }

  try {
    // ── Legacy/back-compat: pre-built structural model (harness, older clients) ──
    if (body.structural && typeof body.structural === 'object') {
      tracer.setPath('structural')
      tracer.setSource(body.structural.sourceName, [{ name: String(body.structural.sourceName || 'structural model'), mediaType: 'structural' }])
      const bundle = await runBrainToBundle({
        structural:   body.structural,
        lobRefIdHint: body.lobRefIdHint,
        budget, send,
      })
      await persistIfRequested(bundle)
      send({ t: 'done' }); return res.end()
    }

    const rawDocs = Array.isArray(body.documents) ? body.documents.filter((d) => d && d.name) : []
    if (rawDocs.length === 0) {
      send({ t: 'error', message: 'No documents or structural model supplied.' }); send({ t: 'done' }); return res.end()
    }

    const docs = rawDocs.map((d) => {
      let b64 = d.base64 || d.dataBase64 || ''
      if (!b64) {
        const diskPath = _findSampleFile(String(d.name))
        if (diskPath) { try { b64 = fs.readFileSync(diskPath).toString('base64') } catch { /* leave empty */ } }
      }
      return { name: String(d.name), base64: b64, text: String(d.text || ''), mediaType: String(d.type || d.mediaType || 'application/pdf') }
    }).filter((d) => d.base64 || d.text)

    if (docs.length === 0) {
      send({ t: 'error', message: 'No document content available (provide base64 or a named fixture).' })
      send({ t: 'done' }); return res.end()
    }

    tracer.setSource(docs.map((d) => d.name).join(' + '), docs)

    // ── Stage 0: artifact router (magic bytes; LOB/edition from content) ──────
    send({ t: 'tool', name: 'brain:stage0:route', phase: 'start', summary: `Routing ${docs.length} document(s) by content` })
    const { routeArtifacts } = require('../import-brain/stage0-router')
    const routed = await routeArtifacts({
      documents: docs,
      extractPdfText: _extractPdfText,
      budget,
      emit: send,
    })
    send({ t: 'tool', name: 'brain:stage0:route', phase: 'end', summary: `${routed.workbooks.length} workbook(s), ${routed.filingDocs.length} filing PDF(s), ${routed.unknown.length} unrecognized` })
    send({ t: 'json', key: 'brain:stage0', value: {
      workbooks: routed.workbooks.map((w) => w.name),
      filingDocs: routed.filingDocs.map((d) => d.name),
      unknown: routed.unknown,
      lobRefIdHint: routed.lobRefIdHint ?? null,
      lobSource: routed.lobSource ?? null,
      edition: routed.edition ?? null,
      warnings: routed.warnings,
    } })

    // ── Workbook path: adaptive brain (per-product or merged) ────────────────
    if (routed.workbooks.length > 0) {
      tracer.setPath('workbook')
      if (routed.filingDocs.length > 0) {
        routed.warnings.push({ kind: 'mixed-upload', detail: `Upload mixes workbooks and PDFs; the workbook plan was produced — re-upload the ${routed.filingDocs.length} PDF(s) separately for filing extraction.` })
        send({ t: 'notice', level: 'warn', message: 'Mixed upload: workbooks imported; PDFs skipped — upload them separately.', kind: 'mixed-upload' })
      }

      const { groups, isSplit, supplementary } = partitionWorkbooks(routed.workbooks)

      // Announce the routing decision so operators can see it in the SSE trace.
      if (isSplit) {
        send({ t: 'notice', level: 'info', kind: 'multi-product-split',
          message: `${groups.length} self-contained product workbooks detected — running each independently. Results collected in splitProducts.` })
      }
      // A supplementary book dropped by the split is a MISSING ARTIFACT, not a non-event: its
      // rate/forms sheets are exactly what the split products' coverages reference. Warn loudly
      // and record it as skipped so the reviewer can re-upload it against the right product.
      if (Array.isArray(supplementary) && supplementary.length > 0) {
        const names = supplementary.map(w => w.name)
        routed.warnings.push({ kind: 'supplementary-workbook-skipped', detail: `${names.length} supplementary workbook(s) (${names.join(', ')}) were NOT imported: ${groups.length} self-contained product workbooks were detected, and there is no evidence establishing which product these belong to. Re-upload each against its product so its tables are read.` })
        send({ t: 'notice', level: 'warn', kind: 'supplementary-workbook-skipped',
          message: `${names.length} supplementary workbook(s) skipped by the multi-product split — re-upload against the intended product: ${names.join(', ')}` })
      }

      // Run the brain once per group (each group is either one self-contained
      // workbook or the full merged set of supplementary files).
      const groupBundles = []
      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi]
        const structural  = mergeStructurals(group)
        const isoGrids    = group.flatMap(w => Array.isArray(w.isoGrids) ? w.isoGrids : [])
        const censuses    = group.map(w => w.census).filter(Boolean)
        const hiddenSheets = group.flatMap(w => Array.isArray(w.hiddenSheets) ? w.hiddenSheets : [])

        // CE3 Step 1: emit per-sheet census counts (only for the first group to
        // avoid flooding the client; subsequent groups are the splitProducts path).
        if (gi === 0) {
          try {
            const observatory = require('./run-observatory')
            const perSheet = censuses.flatMap(c => (c.sheets || []).map(s => ({ name: s.name, nonEmpty: s.nonEmpty, hidden: !!s.hidden, tables: (s.tables || []).length })))
            if (perSheet.length > 0) emit(res, observatory.censusEvent(perSheet))
          } catch { /* census telemetry is never a run blocker */ }
        }

        if (isSplit && gi > 0) {
          send({ t: 'notice', level: 'info', kind: 'split-product-start',
            message: `Extracting split product ${gi + 1}/${groups.length}: ${structural.sourceName}` })
        }

        const gb = await runBrainToBundle({
          structural,
          lobRefIdHint: body.lobRefIdHint || routed.lobRefIdHint,
          edition:      routed.edition,
          routerWarnings: gi === 0 ? routed.warnings : [],
          skippedDocuments: gi === 0
            ? [...routed.filingDocs.map((d) => d.name), ...(supplementary || []).map((w) => w.name)]
            : [],
          budget, send, isoGrids, censuses, hiddenSheets,
          // Checkpointing + resume are keyed to the primary run id; split products
          // use the same id with a group suffix so their stage artifacts are
          // namespaced and resumable independently.
          onStage: onStage && isSplit && gi > 0
            ? (stage, artifact) => onStage(`split${gi}/${stage}`, artifact)
            : onStage,
          resume: gi === 0 ? resume : undefined,
          tenantId: runTenant,
        })
        groupBundles.push(gb)
      }

      // Primary bundle is the first group's output. Split-product bundles are
      // attached to bundle.splitProducts so the review UI can present them.
      const wbBundle = groupBundles[0]
      if (isSplit && groupBundles.length > 1) {
        if (!Array.isArray(wbBundle.splitProducts)) wbBundle.splitProducts = []
        for (const gb of groupBundles.slice(1)) wbBundle.splitProducts.push(gb)
        send({ t: 'json', key: 'brain:split-products', value: { count: groupBundles.length, names: groups.map(g => g.map(w => w.name).join('+')) } })
      }

      await persistIfRequested(wbBundle)
      emitSpend(send, budget)
      send({ t: 'done' }); return res.end()
    }

    // ── Filing path: PDFs (text or native-PDF vision blocks) ──────────────────
    const filingState = String(body.filingState || 'XX').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2)
    const productName = String(body.productName || docs[0].name.replace(/\.[^.]+$/, '') || 'Imported Filing').slice(0, 200)

    const stageFiling = getStageFiling()
    if (routed.filingDocs.length > 0 && typeof stageFiling.runFilingPipeline === 'function') {
      tracer.setPath('filing')
      const { bundle } = await stageFiling.runFilingPipeline({
        documents:        routed.filingDocs.map(d => ({ name: d.name, base64: d.base64, text: d.text })),
        productNameHint:  productName,
        filingStateHint:  filingState,
        // F18: same precedence as the workbook path — body override wins, else
        // the router's content-derived line. The filing path must never
        // re-hard-code Personal Home.
        lobRefIdHint:     body.lobRefIdHint || routed.lobRefIdHint,
        budget,
        extractPdfText:   _extractPdfText,
        emit:             send,
      })
      normalizeBundle(bundle, { documents: routed.filingDocs })
      const planCoverages = (Array.isArray(bundle?.plan?.coverages) ? bundle.plan.coverages : [])
        .map((e) => ({ refId: e.data?.refId ?? e.refId ?? '', name: e.data?.name ?? e.label ?? '', formNumbers: e.data?.formNumbers ?? [] }))
      send({ t: 'json', key: 'bundle', value: bundle })
      await persistIfRequested(bundle)
      send({ t: 'token', v: JSON.stringify({ coverages: planCoverages }) })
      emitSpend(send, budget)
      send({ t: 'done' }); return res.end()
    }

    if (routed.workbooks.length === 0 && routed.filingDocs.length === 0) {
      send({ t: 'error', message: `No importable artifacts detected: ${routed.unknown.map(u => `${u.name} (${u.reason})`).join('; ') || 'unknown content'}` })
      send({ t: 'done' }); return res.end()
    }

    // ── Fallback: single-pass extraction (legacy robustness path) ─────────────
    const doc = docs[0]
    tracer.setPath('fallback')
    send({ t: 'tool', name: 'extract:coverages', phase: 'start', summary: doc.name })

    // F18: honor the content-derived line even on the fallback; PH stays the
    // WARNED platform default when no hint resolved.
    const fbHint = body.lobRefIdHint || routed.lobRefIdHint
    const fbLobDef = fbHint ? require('../import-brain-shared.cjs').LOB_REGISTRY?.[fbHint] : null
    const fbLob = fbLobDef ? { refId: fbLobDef.refId, name: fbLobDef.name } : { refId: 'PH.LOB.001', name: 'Personal Home' }
    // F15: ids minted here have NO source counterpart — mark them with the
    // platform SYNTH convention (registry prefix + SYNTH, kind in segment 2).
    const fbPrefix = (fbLobDef && (fbLobDef.refIdPrefix || fbLobDef.code)) || 'PH'
    if (!fbLobDef) send({ t: 'notice', level: 'warn', kind: 'lob-defaulted', message: `LOB undetected${fbHint ? ` (hint "${fbHint}" matched no registry line)` : ''} — defaulted to Personal Home; verify the product line.` })

    const deployment = HAIKU_OVERRIDE || fleet.resolveModel('BULK_VERIFY', { bypassDegrade: true })
    const pdfText = doc.base64 ? _extractPdfText(doc.base64) : null
    let contentBlock
    if (pdfText && pdfText.length > 100) {
      contentBlock = { type: 'text', text: `FILING DOCUMENT (${doc.name}):\n\n${pdfText.slice(0, 60_000)}` }
    } else if (doc.base64 && doc.mediaType === 'application/pdf') {
      contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 } }
    } else {
      contentBlock = { type: 'text', text: `FILING DOCUMENT (${doc.name}):\n\n${doc.text.slice(0, 60_000)}` }
    }

    const extractedInput = await _forcedToolCall(
      deployment, _IMPORT_SYSTEM, [_PROPOSE_COVERAGES], 'propose_coverages',
      [contentBlock],
      `Extract ALL coverages this policy form defines. For each coverage include any form number(s) that appear in the document. Filing state: ${filingState}.`,
      4096,
    )

    const rawCoverages = (Array.isArray(extractedInput.coverages) ? extractedInput.coverages : [])
      .filter((c) => c && c.name && c.citation)

    send({ t: 'tool', name: 'extract:coverages', phase: 'end', summary: `${rawCoverages.length} coverage(s) extracted` })

    // Canonical case-preserving mint (BACKLOG_SEED item 1) — the old
    // .toLowerCase() stranded these ids outside the parentId validator's
    // dot->dash candidate set.
    const { refIdToDocId } = require('../import-brain-shared.cjs')
    const coverageEntities = rawCoverages.map((c, i) => {
      const refId = `${fbPrefix}.COV.SYNTH${String(i + 1).padStart(3, '0')}`
      return {
        docId: refIdToDocId(refId),
        refId,
        label: String(c.name),
        data: {
          refId,
          name: String(c.name),
          formNumbers: Array.isArray(c.formNumbers) ? c.formNumbers.filter((n) => n && typeof n === 'string') : [],
          // F14: not-stated facts land as UNKNOWN / null — never a guessed value.
          premiumGenerating: (c.premiumGenerating === true || c.premiumGenerating === 'YES') ? true
                           : (c.premiumGenerating === false || c.premiumGenerating === 'NO') ? false
                           : null,
          requirement: c.requirement === 'OPTIONAL' ? 'OPTIONAL' : c.requirement === 'MANDATORY' ? 'MANDATORY' : 'UNKNOWN',
          confidence: typeof c.confidence === 'number' ? Math.max(0, Math.min(1, c.confidence)) : 0.7,
          citation: String(c.citation || ''),
        },
      }
    })

    const productRefId = `${fbPrefix}.PROD.SYNTH.FIL${filingState}`
    const bundle = {
      plan: {
        productId: productRefId,
        product: {
          docId: 'fil-prod', label: productName,
          // lob must be an object { refId, name } to match the seeded/ISO-imported product
          // shape — the app reads product.lob.name across Products/News/etc. A bare string
          // here produces a product that crashes those surfaces.
          data: { refId: productRefId, name: productName, lob: fbLob, state: filingState },
        },
        coverages: coverageEntities,
        forms: [], rules: [], formRules: [], ratingProgram: null, ldTables: [], rtTables: [],
      },
      filingState,
      baseFormNumber: coverageEntities[0]?.data?.formNumbers?.[0] || doc.name.replace(/\.[^.]+$/, ''),
      baseFormEdition: '',
      review: {
        product: { items: [{ section: 'product', label: productName, confidence: 0.85, citation: doc.name }] },
        coverages: {
          items: coverageEntities.map((e) => ({
            section: 'coverages', label: e.data.name, refId: e.refId,
            docId: e.docId, confidence: e.data.confidence, citation: e.data.citation,
          })),
        },
        tables: { items: [] }, rules: { items: [] }, rating: { items: [] },
      },
      unresolved: [],
      counts: { proposed: coverageEntities.length, accepted: coverageEntities.length, unresolved: 0 },
      fingerprint: {
        container: 'PDF', detectedFormat: 'COMPANY_FILING_PDF',
        lineGuesses: [{ lobRefId: fbLob.refId, confidence: 0.85, signals: fbLobDef ? ['router-hint'] : [] }],
        documentRoles: docs.map((d) => ({ documentName: d.name, role: 'policyForm', confidence: 0.9 })),
      },
      extractionPlan: {
        format: 'COMPANY_FILING_PDF', lobRefId: fbLob.refId, archetype: null,
        documentRoleAssignments: docs.map((d) => ({ documentName: d.name, role: 'policyForm', extractor: 'AI_EXTRACT_FULL' })),
        splitStrategy: 'SINGLE_PRODUCT',
      },
      sampledVerifications: [], splitProducts: [],
      coverages: coverageEntities.map((e) => ({ refId: e.refId, name: e.data.name, formNumbers: e.data.formNumbers })),
    }

    send({ t: 'json', key: 'bundle', value: bundle })
    await persistIfRequested(bundle)
    send({ t: 'token', v: JSON.stringify({ coverages: bundle.coverages }) })
    emitSpend(send, budget)
    send({ t: 'done' })
    res.end()
  } catch (err) {
    send({ t: 'error', message: `Import error: ${String((err && err.message) || err).slice(0, 220)}` })
    send({ t: 'done' })
    res.end()
  }
}

// Per-run spend telemetry for the non-brain paths (the brain emits its own
// brain:spend event; this covers filing/fallback and is harmless to repeat).
function emitSpend(send, budget) {
  const spend = {
    spendUsd:     Math.round((budget.spendUsd || 0) * 1e4) / 1e4,
    calls:        budget.calls || 0,
    noCap:        Boolean(budget.noCap),
    byDeployment: budget.byDeployment || {},
  }
  console.log(`[unifiedImport] run spend: $${spend.spendUsd} across ${spend.calls} call(s)`)
  send({ t: 'json', key: 'import:spend', value: spend })
}

// F23: fetch a persisted run result. Read-shaped, but scoped like the import
// itself (product:write) — the bundle IS the import output. Tenant comes from
// the JWT, never the body: one tenant can never read another's result.
async function unifiedImportResult(req, res) {
  if (!hasCapability(req.user, 'product:write')) {
    return res.status(403).json({ error: 'forbidden', need: 'product:write', have: req.user.role })
  }
  const runId = sanitizeRunId((req.body || {}).runId)
  if (!runId) return res.status(400).json({ error: 'invalid_run_id' })
  const r = await fetchRunResult({ tenantId: resolveTenantForPrincipal(req.user), runId })
  if (r.status === 'ok') return res.json({ runId, finishedAt: r.envelope.finishedAt, bundle: r.envelope.bundle })
  if (r.status === 'storage_not_configured') return res.status(503).json({ error: 'storage_not_configured', detail: 'Set AZURE_BLOB_CONNECTION to enable durable run results.' })
  return res.status(404).json({ error: 'result_not_found', runId })
}

module.exports = {
  unifiedImport, unifiedImportResult, partitionWorkbooks,
  // Durability seams (pure — unit-tested directly):
  contentHashOfDocuments, checkpointsMatchSource, mintRunId,
}
