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
const fleet = require('../fleet')
const { sse, emit, _forcedToolCall, _extractPdfText, _findSampleFile, getImportBrain, getStageFiling } = require('./_shared')
const fs = require('fs')

const HAIKU_OVERRIDE = process.env.AZURE_FOUNDRY_HAIKU_DEPLOYMENT || ''

const _PROPOSE_COVERAGES = {
  name: 'propose_coverages',
  description: 'Return the coverages the base form actually defines. Only include coverages the document describes — never invent a coverage, form, limit or requirement.',
  input_schema: {
    type: 'object',
    properties: {
      coverages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:              { type: 'string' },
            requirement:       { type: 'string', enum: ['MANDATORY', 'OPTIONAL'] },
            premiumGenerating: { type: 'boolean' },
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

// ─── Run the brain over a structural model and emit the plan bundle ───────────

async function runBrainToBundle({ structural, lobRefIdHint, edition, routerWarnings, budget, res }) {
  const brain = getImportBrain()
  if (typeof brain.runAdaptiveImportBrain !== 'function') {
    throw new Error('Import brain not available (build:import-brain may not have run).')
  }
  const brainOutput = await brain.runAdaptiveImportBrain({
    structural,
    lobRefIdHint: lobRefIdHint || undefined,
    budget,
    emit: (ev) => emit(res, ev),
  })

  const { buildImportPlan } = require('../import-brain/stage7-plan')
  const bundle = buildImportPlan(brainOutput, {
    lobRefIdHint: lobRefIdHint || undefined,
    sourceName:   structural.sourceName,
    edition:      edition || undefined,
    routerWarnings: routerWarnings || [],
  })

  emit(res, { t: 'json', key: 'bundle', value: bundle })
  emit(res, { t: 'token', v: JSON.stringify({ coverages: bundle.coverages }) })
  return bundle
}

async function unifiedImport(req, res) {
  if (!hasCapability(req.user, 'product:write')) {
    return res.status(403).json({ error: 'forbidden', need: 'product:write', have: req.user.role })
  }

  const body = req.body || {}
  sse(res)

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

  try {
    // ── Legacy/back-compat: pre-built structural model (harness, older clients) ──
    if (body.structural && typeof body.structural === 'object') {
      await runBrainToBundle({
        structural:   body.structural,
        lobRefIdHint: body.lobRefIdHint,
        budget, res,
      })
      emit(res, { t: 'done' }); return res.end()
    }

    const rawDocs = Array.isArray(body.documents) ? body.documents.filter((d) => d && d.name) : []
    if (rawDocs.length === 0) {
      emit(res, { t: 'error', message: 'No documents or structural model supplied.' }); emit(res, { t: 'done' }); return res.end()
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
      emit(res, { t: 'error', message: 'No document content available (provide base64 or a named fixture).' })
      emit(res, { t: 'done' }); return res.end()
    }

    // ── Stage 0: artifact router (magic bytes; LOB/edition from content) ──────
    const { routeArtifacts } = require('../import-brain/stage0-router')
    const routed = await routeArtifacts({
      documents: docs,
      extractPdfText: _extractPdfText,
      budget,
      emit: (ev) => emit(res, ev),
    })

    // ── Workbook path: adaptive brain over the merged structural model ────────
    if (routed.workbooks.length > 0) {
      if (routed.filingDocs.length > 0) {
        routed.warnings.push({ kind: 'mixed-upload', detail: `Upload mixes workbooks and PDFs; the workbook plan was produced — re-upload the ${routed.filingDocs.length} PDF(s) separately for filing extraction.` })
        emit(res, { t: 'notice', level: 'warn', message: 'Mixed upload: workbooks imported; PDFs skipped — upload them separately.', kind: 'mixed-upload' })
      }
      const structural = mergeStructurals(routed.workbooks)
      await runBrainToBundle({
        structural,
        lobRefIdHint: body.lobRefIdHint || routed.lobRefIdHint,
        edition:      routed.edition,
        routerWarnings: routed.warnings,
        budget, res,
      })
      emitSpend(res, budget)
      emit(res, { t: 'done' }); return res.end()
    }

    // ── Filing path: PDFs (text or native-PDF vision blocks) ──────────────────
    const filingState = String(body.filingState || 'XX').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2)
    const productName = String(body.productName || docs[0].name.replace(/\.[^.]+$/, '') || 'Imported Filing').slice(0, 200)

    const stageFiling = getStageFiling()
    if (routed.filingDocs.length > 0 && typeof stageFiling.runFilingPipeline === 'function') {
      const { bundle } = await stageFiling.runFilingPipeline({
        documents:        routed.filingDocs.map(d => ({ name: d.name, base64: d.base64, text: d.text })),
        productNameHint:  productName,
        filingStateHint:  filingState,
        budget,
        extractPdfText:   _extractPdfText,
        emit:             (ev) => emit(res, ev),
      })
      const planCoverages = (Array.isArray(bundle?.plan?.coverages) ? bundle.plan.coverages : [])
        .map((e) => ({ refId: e.data?.refId ?? e.refId ?? '', name: e.data?.name ?? e.label ?? '', formNumbers: e.data?.formNumbers ?? [] }))
      emit(res, { t: 'json', key: 'bundle', value: bundle })
      emit(res, { t: 'token', v: JSON.stringify({ coverages: planCoverages }) })
      emitSpend(res, budget)
      emit(res, { t: 'done' }); return res.end()
    }

    if (routed.workbooks.length === 0 && routed.filingDocs.length === 0) {
      emit(res, { t: 'error', message: `No importable artifacts detected: ${routed.unknown.map(u => `${u.name} (${u.reason})`).join('; ') || 'unknown content'}` })
      emit(res, { t: 'done' }); return res.end()
    }

    // ── Fallback: single-pass extraction (legacy robustness path) ─────────────
    const doc = docs[0]
    emit(res, { t: 'tool', name: 'extract:coverages', phase: 'start', summary: doc.name })

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

    emit(res, { t: 'tool', name: 'extract:coverages', phase: 'end', summary: `${rawCoverages.length} coverage(s) extracted` })

    const coverageEntities = rawCoverages.map((c, i) => {
      const refId = `HO-COV-${String(i + 1).padStart(3, '0')}`
      return {
        docId: refId.toLowerCase(),
        refId,
        label: String(c.name),
        data: {
          refId,
          name: String(c.name),
          formNumbers: Array.isArray(c.formNumbers) ? c.formNumbers.filter((n) => n && typeof n === 'string') : [],
          premiumGenerating: c.premiumGenerating !== false,
          requirement: c.requirement === 'OPTIONAL' ? 'OPTIONAL' : 'MANDATORY',
          confidence: typeof c.confidence === 'number' ? Math.max(0, Math.min(1, c.confidence)) : 0.7,
          citation: String(c.citation || ''),
        },
      }
    })

    const productRefId = `FIL.${filingState}.PROD`
    const bundle = {
      plan: {
        productId: productRefId,
        product: {
          docId: 'fil-prod', label: productName,
          // lob must be an object { refId, name } to match the seeded/ISO-imported product
          // shape — the app reads product.lob.name across Products/News/etc. A bare string
          // here produces a product that crashes those surfaces.
          data: { refId: productRefId, name: productName, lob: { refId: 'PH.LOB.001', name: 'Personal Home' }, state: filingState },
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
        lineGuesses: [{ lobRefId: 'PH.LOB.001', confidence: 0.85, signals: [] }],
        documentRoles: docs.map((d) => ({ documentName: d.name, role: 'policyForm', confidence: 0.9 })),
      },
      extractionPlan: {
        format: 'COMPANY_FILING_PDF', lobRefId: 'PH.LOB.001', archetype: null,
        documentRoleAssignments: docs.map((d) => ({ documentName: d.name, role: 'policyForm', extractor: 'AI_EXTRACT_FULL' })),
        splitStrategy: 'SINGLE_PRODUCT',
      },
      sampledVerifications: [], splitProducts: [],
      coverages: coverageEntities.map((e) => ({ refId: e.refId, name: e.data.name, formNumbers: e.data.formNumbers })),
    }

    emit(res, { t: 'json', key: 'bundle', value: bundle })
    emit(res, { t: 'token', v: JSON.stringify({ coverages: bundle.coverages }) })
    emitSpend(res, budget)
    emit(res, { t: 'done' })
    res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `Import error: ${String((err && err.message) || err).slice(0, 220)}` })
    emit(res, { t: 'done' })
    res.end()
  }
}

// Per-run spend telemetry for the non-brain paths (the brain emits its own
// brain:spend event; this covers filing/fallback and is harmless to repeat).
function emitSpend(res, budget) {
  const spend = {
    spendUsd:     Math.round((budget.spendUsd || 0) * 1e4) / 1e4,
    calls:        budget.calls || 0,
    noCap:        Boolean(budget.noCap),
    byDeployment: budget.byDeployment || {},
  }
  console.log(`[unifiedImport] run spend: $${spend.spendUsd} across ${spend.calls} call(s)`)
  emit(res, { t: 'json', key: 'import:spend', value: spend })
}

module.exports = { unifiedImport }
