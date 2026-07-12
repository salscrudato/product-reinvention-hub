'use strict'
const { RANK } = require('../auth')
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

async function unifiedImport(req, res) {
  if ((RANK[req.user.role] ?? -1) < RANK['EDITOR']) {
    return res.status(403).json({ error: 'editor_required', message: 'Filing import requires EDITOR access or above.' })
  }

  const body = req.body || {}
  sse(res)

  const g = fleet.guard()
  if (!g.allow) {
    emit(res, { t: 'error', message: 'AI budget ceiling reached — try again shortly.' })
    emit(res, { t: 'done' }); return res.end()
  }
  const deployment = HAIKU_OVERRIDE || fleet.resolveModel('BULK_VERIFY', g.degrade)

  try {
    if (body.structural && typeof body.structural === 'object') {
      const brain = getImportBrain()
      if (typeof brain.runAdaptiveImportBrain !== 'function') {
        emit(res, { t: 'error', message: 'Import brain not available (build:import-brain may not have run).' })
        emit(res, { t: 'done' }); return res.end()
      }
      const brainOutput = await brain.runAdaptiveImportBrain({
        structural:   body.structural,
        lobRefIdHint: body.lobRefIdHint || undefined,
        emit:         (ev) => emit(res, ev),
      })
      const brainCoverages = (brainOutput.entities || [])
        .filter((e) => e.kind === 'coverage' || e.kind === 'product')
        .map((e) => {
          const refIdF = e.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
          const nameF  = e.fields.find(f => f.fieldName === 'name' || f.fieldName === 'label')
          return { refId: String(refIdF?.value ?? ''), name: String(nameF?.value ?? e.kind), kind: e.kind }
        })
      emit(res, { t: 'token', v: JSON.stringify({ coverages: brainCoverages }) })
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

    const filingState = String(body.filingState || 'XX').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2)
    const productName = String(body.productName || docs[0].name.replace(/\.[^.]+$/, '') || 'Imported Filing').slice(0, 200)

    const stageFiling = getStageFiling()
    if (typeof stageFiling.runFilingPipeline === 'function') {
      const { bundle, extraction } = await stageFiling.runFilingPipeline({
        documents:        docs,
        productNameHint:  productName,
        filingStateHint:  filingState,
        extractPdfText:   _extractPdfText,
        emit:             (ev) => emit(res, ev),
      })
      const planCoverages = (Array.isArray(bundle?.plan?.coverages) ? bundle.plan.coverages : [])
        .map((e) => ({ refId: e.data?.refId ?? e.refId ?? '', name: e.data?.name ?? e.label ?? '', formNumbers: e.data?.formNumbers ?? [] }))
      emit(res, { t: 'json', key: 'bundle', value: bundle })
      emit(res, { t: 'token', v: JSON.stringify({ coverages: planCoverages }) })
      emit(res, { t: 'done' }); return res.end()
    }

    // Fallback: single-pass extraction (legacy robustness path)
    const doc = docs[0]
    emit(res, { t: 'tool', name: 'extract:coverages', phase: 'start', summary: doc.name })

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
          data: { refId: productRefId, name: productName, lob: 'PH', state: filingState },
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
    emit(res, { t: 'done' })
    res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `Import error: ${String((err && err.message) || err).slice(0, 220)}` })
    emit(res, { t: 'done' })
    res.end()
  }
}

module.exports = { unifiedImport }
