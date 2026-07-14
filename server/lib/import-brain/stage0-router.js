'use strict'
// server/lib/import-brain/stage0-router.js — Stage 0: artifact router (front door).
//
// Runs AHEAD of Stage 1. Detects artifact type and shape and routes accordingly:
//   * native XLSX / XLSM (macro-enabled) / multi-sheet irregular workbook
//       → parse server-side (ExcelJS), build StructuralModel with REAL cells → brain
//   * rate manual / coverage form PDF (text-extractable) → filing pipeline (text)
//   * scanned or non-extractable PDF (encrypted, CID-font, image-only)
//       → filing pipeline with NATIVE PDF document blocks (vision-capable model)
//   * CSV / plain text → single-sheet StructuralModel → brain
//
// Line-of-business + edition detection:
//   1. DETERMINISTIC first: refId tokens found in the actual cells / text are matched
//      against the LOB registry prefixes (inferLob — content-derived, filename-free).
//   2. Cheap-model assist (haiku / BULK_VERIFY) only when deterministic inference is
//      inconclusive; escalates to opus (GROUNDED_CITED) below ESCALATE_CONFIDENCE.
//   3. The lobRefIdHint is ALWAYS a registry refId (e.g. 'GL.LOB.001') resolved from
//      a validated prefix — a model can vote on a prefix, never mint a refId.

const { callAnthropic, resolveAnthropic } = require('./ai-call')
const { STAGE0_ROUTER_SYSTEM } = require('./prompts')
const { extractJson, REFID_TOKEN } = require('./constants')
const { sniffContainer, readWorkbookToStructural } = require('./workbook')

const brainShared = require('../import-brain-shared.cjs')
const { buildStructuralModel, inferLob, LOB_REGISTRY } = brainShared

const ESCALATE_CONFIDENCE = 0.6
// Minimum extracted characters for a PDF to take the text path; below this the
// document is treated as scanned/non-extractable and routed to native-PDF vision.
const PDF_TEXT_MIN_CHARS = 400

// ─── Registry-derived prefix → LOB refId map (never invented) ─────────────────

function prefixToLobRefId(prefix) {
  if (!prefix || typeof prefix !== 'string') return null
  const p = prefix.trim().toUpperCase()
  for (const lob of Object.values(LOB_REGISTRY)) {
    if (String(lob.refIdPrefix || lob.code || '').toUpperCase() === p) return lob.refId
  }
  return null
}

// ─── Deterministic signal gathering ───────────────────────────────────────────

function collectWorkbookSignals(structural) {
  const refIds = []
  const sheetNames = []
  for (const fp of (structural.sheets || [])) {
    sheetNames.push(fp.sheetName)
    const rows = fp.cells || []
    for (const row of rows) {
      for (const cell of row) {
        if (typeof cell !== 'string') continue
        const m = cell.match(new RegExp(REFID_TOKEN.source, 'gi'))
        if (m) refIds.push(...m)
        if (refIds.length > 500) break
      }
      if (refIds.length > 500) break
    }
  }
  return { refIds, sheetNames }
}

// ─── Cheap-model routing assist (escalates on low confidence) ─────────────────

function buildAssistPrompt(docSummaries) {
  return [
    'Artifacts in this upload (content-derived summaries; filenames are NOT evidence):',
    ...docSummaries.map((s, i) => `--- Artifact ${i + 1} ---\n${s}`),
  ].join('\n')
}

function parseAssist(raw) {
  try {
    const obj = extractJson(raw)
    const lobPrefix = obj.lobPrefix != null ? String(obj.lobPrefix).toUpperCase() : null
    return {
      lobPrefix,
      edition:    obj.edition != null && obj.edition !== '' ? String(obj.edition) : null,
      confidence: Number(obj.confidence ?? 0),
      rationale:  String(obj.rationale ?? ''),
    }
  } catch { return null }
}

async function aiRoutingAssist(docSummaries, budget) {
  const userPrompt = buildAssistPrompt(docSummaries)

  const deployBulk = resolveAnthropic('BULK_VERIFY', budget)
  let res = await callAnthropic({
    deployment: deployBulk, systemPrompt: STAGE0_ROUTER_SYSTEM, userPrompt, maxTokens: 300, budget,
  }).catch(() => ({ raw: '' }))
  let parsed = parseAssist(res.raw)

  if (!parsed || parsed.confidence < ESCALATE_CONFIDENCE) {
    // Escalate: opus re-routes when the cheap model is unsure.
    try {
      const deployOpus = resolveAnthropic('GROUNDED_CITED', budget)
      res = await callAnthropic({
        deployment: deployOpus, systemPrompt: STAGE0_ROUTER_SYSTEM, userPrompt, maxTokens: 300, budget,
      })
      const escalated = parseAssist(res.raw)
      if (escalated && (!parsed || escalated.confidence >= parsed.confidence)) parsed = escalated
    } catch { /* keep the cheap result (or null) */ }
  }
  return parsed
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object[]} opts.documents      [{ name, base64?, text?, mediaType? }]
 * @param {function} opts.extractPdfText (base64) => string|null
 * @param {object}   opts.budget         brain budget (noCap for import)
 * @param {function} [opts.emit]         SSE emit callback
 * @returns {Promise<object>} RouterOutput
 */
async function routeArtifacts(opts) {
  const { documents, extractPdfText, budget } = opts
  const emit = typeof opts.emit === 'function' ? opts.emit : () => {}

  const out = {
    workbooks:  [],   // { name, kind, structural, skippedHiddenSheets }
    filingDocs: [],   // { name, base64, text, pdfText, needsVision }
    unknown:    [],   // { name, reason }
    lobRefIdHint: null,
    lobSource:    null,   // 'deterministic' | 'ai-assist' | null
    edition:      null,
    warnings:     [],
  }

  emit({ t: 'tool', name: 'brain:stage0:route', phase: 'start', summary: `Routing ${documents.length} artifact(s)` })

  const docSummaries = []
  const allRefIds = []
  const allSheetNames = []
  let pdfTextHead = ''

  for (const doc of documents) {
    const buf = doc.base64 ? Buffer.from(doc.base64, 'base64') : null
    const sniff = buf ? sniffContainer(buf, doc.mediaType) : { container: doc.text ? 'TEXT' : 'UNKNOWN', workbookKind: null }

    if (sniff.container === 'ZIP' && sniff.workbookKind) {
      try {
        const { structural, skippedHiddenSheets, isoGrids } = await readWorkbookToStructural(buf, doc.name, sniff.workbookKind)
        out.workbooks.push({ name: doc.name, kind: sniff.workbookKind, structural, skippedHiddenSheets, isoGrids })
        if (skippedHiddenSheets.length > 0) {
          out.warnings.push({ kind: 'hidden-sheets-skipped', doc: doc.name, detail: `Skipped ${skippedHiddenSheets.length} hidden sheet(s): ${skippedHiddenSheets.slice(0, 8).join(', ')}` })
        }
        for (const fp of structural.sheets || []) {
          if (fp.cellsTruncated) {
            out.warnings.push({ kind: 'grid-truncated', doc: doc.name, detail: `Sheet "${fp.sheetName}" exceeds the embed cap (${fp.dataRowCount} rows) — extraction covers the first ${brainShared.MAX_EMBED_ROWS} rows; review the tail manually.` })
          }
        }
        const sig = collectWorkbookSignals(structural)
        allRefIds.push(...sig.refIds)
        allSheetNames.push(...sig.sheetNames)
        docSummaries.push([
          `Type: ${sniff.workbookKind} workbook, ${structural.sheets.length} visible sheet(s)`,
          `Sheets: ${sig.sheetNames.join(', ').slice(0, 400)}`,
          `Sample refIds: ${[...new Set(sig.refIds)].slice(0, 12).join(', ') || '(none)'}`,
        ].join('\n'))
      } catch (e) {
        out.unknown.push({ name: doc.name, reason: `workbook parse failed: ${String(e.message).slice(0, 160)}` })
        out.warnings.push({ kind: 'unparseable-workbook', doc: doc.name, detail: String(e.message).slice(0, 200) })
      }
      continue
    }

    if (sniff.container === 'PDF') {
      const pdfText = doc.base64 ? extractPdfText(doc.base64) : null
      const textOk = Boolean((pdfText && pdfText.length >= PDF_TEXT_MIN_CHARS) || (doc.text && doc.text.length >= PDF_TEXT_MIN_CHARS))
      const needsVision = !textOk
      out.filingDocs.push({ name: doc.name, base64: doc.base64 || '', text: doc.text || '', pdfText: pdfText || null, needsVision })
      if (needsVision) {
        out.warnings.push({ kind: 'pdf-vision-route', doc: doc.name, detail: 'Text extraction yielded too little — routing to native-PDF vision extraction.' })
      }
      const head = (pdfText || doc.text || '').slice(0, 1500)
      pdfTextHead += ` ${head}`
      docSummaries.push([
        `Type: PDF (${needsVision ? 'non-extractable text — vision route' : 'text-extractable'})`,
        head ? `Text head: ${head.slice(0, 600)}` : '(no extractable text available for routing — classify from the other artifacts)',
      ].join('\n'))
      continue
    }

    if (sniff.container === 'TEXT') {
      // CSV / plain text → single-sheet structural model through the brain.
      const text = doc.text || (buf ? buf.toString('utf8') : '')
      const rows = text.split(/\r?\n/).filter(l => l.trim().length > 0).map(l => l.split(','))
      const structural = buildStructuralModel([{ sheet: doc.name, cells: rows }], doc.name, 'CSV')
      out.workbooks.push({ name: doc.name, kind: 'CSV', structural, skippedHiddenSheets: [] })
      docSummaries.push(`Type: CSV/text, ${rows.length} line(s)\nHead: ${text.slice(0, 400)}`)
      continue
    }

    out.unknown.push({ name: doc.name, reason: 'unrecognized container (not zip/pdf/text)' })
    out.warnings.push({ kind: 'unknown-container', doc: doc.name, detail: 'Magic bytes match no supported container; artifact skipped.' })
    docSummaries.push('Type: UNKNOWN container')
  }

  // ── LOB inference: deterministic first ─────────────────────────────────────
  const lob = inferLob({ refIds: allRefIds, sheetNames: allSheetNames, productName: pdfTextHead.slice(0, 2000) || null })
  if (lob) {
    out.lobRefIdHint = lob.refId
    out.lobSource = 'deterministic'
  }

  // ── AI assist for LOB/edition when deterministic is inconclusive ───────────
  if ((!out.lobRefIdHint || out.workbooks.length + out.filingDocs.length > 0) && docSummaries.length > 0) {
    const assist = await aiRoutingAssist(docSummaries, budget).catch(() => null)
    if (assist) {
      if (!out.lobRefIdHint && assist.lobPrefix) {
        const derived = prefixToLobRefId(assist.lobPrefix)
        if (derived) {
          out.lobRefIdHint = derived
          out.lobSource = 'ai-assist'
        } else {
          out.warnings.push({ kind: 'lob-prefix-unknown', detail: `Router proposed LOB prefix "${assist.lobPrefix}" which matches no registry entry — no hint applied.` })
        }
      }
      if (assist.edition) out.edition = assist.edition
    }
  }

  const summary = [
    `${out.workbooks.length} workbook(s)`,
    `${out.filingDocs.length} PDF(s) (${out.filingDocs.filter(d => d.needsVision).length} vision)`,
    out.unknown.length ? `${out.unknown.length} unknown` : null,
    out.lobRefIdHint ? `LOB ${out.lobRefIdHint} (${out.lobSource})` : 'LOB undetected',
  ].filter(Boolean).join(', ')
  emit({ t: 'tool', name: 'brain:stage0:route', phase: 'end', summary })
  emit({ t: 'json', key: 'brain:stage0', value: {
    workbooks:  out.workbooks.map(w => ({ name: w.name, kind: w.kind, sheets: w.structural.sheets.length, skippedHiddenSheets: w.skippedHiddenSheets })),
    filingDocs: out.filingDocs.map(d => ({ name: d.name, needsVision: d.needsVision })),
    unknown:    out.unknown,
    lobRefIdHint: out.lobRefIdHint, lobSource: out.lobSource, edition: out.edition,
    warnings: out.warnings,
  } })

  return out
}

module.exports = { routeArtifacts, prefixToLobRefId, PDF_TEXT_MIN_CHARS }
