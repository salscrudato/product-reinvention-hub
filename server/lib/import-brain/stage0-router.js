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

// ─── CSV parse (RFC 4180) ────────────────────────────────────────────────────
// `line.split(',')` is not a CSV parser: a quoted field containing a comma
// ("Dwelling, Fire") splits into two, shifting EVERY later cell one column left for
// that row. Rates then land under the wrong header and cite the wrong cell — a
// misalignment that reads as clean data downstream. Handles quoted fields, escaped
// doubled quotes (""), and embedded newlines inside quotes (which is why the scan is
// character-wise over the whole text rather than line-wise).
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let sawField = false          // distinguishes a real empty field from a blank line
  const endField = () => { row.push(field); field = ''; sawField = false }
  const endRow = () => {
    endField()
    // Preserve the previous filter's intent: rows that are entirely blank are dropped.
    if (row.some(c => c.trim() !== '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }   // escaped quote
        else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && !sawField) { quoted = true; sawField = true; continue }
    if (ch === ',') { endField(); continue }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); continue }
    if (ch === '\n') { endRow(); continue }
    field += ch
    sawField = true
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}

// ─── ManuScript Author XML fingerprint (P3 validation seam, XE-05) ────────────
// String-level sniff only — no XML parse happens in stage-0. The deterministic
// hardened reader (mapManuscriptOverlay, shared/src/insurance/manuscriptImport)
// runs downstream in the validation harness.
function isManuscriptXml(text) {
  if (typeof text !== 'string') return false
  const head = text.slice(0, 4096).replace(/^﻿/, '')
  const stripped = head.replace(/<\?[^?]*\?>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').trimStart()
  return /^<ManuScript[\s>]/.test(stripped)
}

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
        const { structural, skippedHiddenSheets, isoGrids, census } = await readWorkbookToStructural(buf, doc.name, sniff.workbookKind)
        // Embed-cap continuation (ledger F09): upgrade truncated fingerprints to
        // the authoritative uncapped grid BEFORE any rename/merge — per workbook,
        // so the sheet-name join can never drift.
        extendTruncatedGrids(structural, isoGrids, doc.name, out.warnings)
        out.workbooks.push({ name: doc.name, kind: sniff.workbookKind, structural, skippedHiddenSheets, hiddenSheets: skippedHiddenSheets, isoGrids, census })
        if (skippedHiddenSheets.length > 0) {
          // CE3 hidden-sheet POLICY FLIP (Step 1): hidden sheets are now INCLUDED in
          // AI classification/extraction (a hidden Forms View can carry thousands of
          // real cells); every entity extracted from one is stamped hiddenSource:true
          // at stage 7 so the review UI warns on its provenance.
          const gridBySheet = new Map((isoGrids || []).map(g => [g.sheet, g]))
          const dims = skippedHiddenSheets.slice(0, 8).map(n => {
            const g = gridBySheet.get(n)
            return g ? `${n} (${g.cells.length}×${g.cells[0]?.length ?? 0})` : n
          })
          out.warnings.push({ kind: 'hidden-sheets-included', doc: doc.name, detail: `Including ${skippedHiddenSheets.length} hidden sheet(s) in extraction with hiddenSource provenance — review before accepting: ${dims.join(', ')}${skippedHiddenSheets.length > 8 ? ', …' : ''}` })
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
      const text = doc.text || (buf ? buf.toString('utf8') : '')
      // P3 VALIDATION-ONLY seam (XE-05, spec §6.1): an Author XML overlay
      // fingerprints by its <ManuScript> root. Routed ONLY when the caller opts
      // in (`enableManuscriptXml: true` — the round-trip validation harness);
      // the HTTP unifiedImport path never sets the flag, so this is NOT exposed
      // as a user-facing import source (ledger XE-10 BACKLOG) and behavior for
      // every existing caller is byte-identical.
      if (opts.enableManuscriptXml === true && isManuscriptXml(text)) {
        out.manuscriptXml = out.manuscriptXml || []
        out.manuscriptXml.push({ name: doc.name, text, detectedFormat: 'manuscript-xml' })
        // Deliberately NOT pushed into docSummaries: the validation seam is
        // deterministic end-to-end — no AI routing assist ever sees it.
        continue
      }
      // CSV / plain text → single-sheet structural model through the brain.
      const rows = parseCsv(text)
      const structural = buildStructuralModel([{ sheet: doc.name, cells: rows }], doc.name, 'CSV')
      // A >cap CSV has its uncapped rows right here — same continuation as
      // workbooks (F09). normalizeCellValue-parity: CSV cells are plain strings,
      // which normalize idempotently; extendTruncatedGrids slices to the
      // embedded width so the fingerprint's column policy is preserved.
      extendTruncatedGrids(structural, [{ sheet: doc.name, file: doc.name, cells: rows.map(r => r.map(c => brainShared.normalizeCellValue(c))) }], doc.name, out.warnings)
      out.workbooks.push({ name: doc.name, kind: 'CSV', structural, skippedHiddenSheets: [], hiddenSheets: [], census: null })
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
  // Under the P3 validation flag the run is deterministic END TO END: the
  // round-trip harness never invokes a model (its seam is validation-only).
  if (opts.enableManuscriptXml !== true
      && (!out.lobRefIdHint || out.workbooks.length + out.filingDocs.length > 0) && docSummaries.length > 0) {
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

// ── Embed-cap continuation (ledger F09) ───────────────────────────────────────
// The client-embed caps (MAX_EMBED_ROWS/COLS) bound what a FINGERPRINT carries —
// but on the server path the full normalized grid already exists (isoGrids, the
// same normalizeCellValue output fingerprinting re-derives, so values are
// byte-identical). Upgrade each truncated fingerprint's cells to the
// authoritative uncapped grid, sliced to the embedded COLUMN width (column
// overflow stays a warned non-goal) — stage-4 batching and stage-5 citation
// resolution are already windowed over fp.cells with absolute row indices, so
// the tail extracts with no further changes. Runs per workbook BEFORE the
// multi-workbook merge rename. When no raw grid exists (legacy structural
// path, corrupt reads), the warning states the EXACT loss instead of a vague
// "review manually".
function extendTruncatedGrids(structural, isoGrids, docName, warnings) {
  const bySheet = new Map((isoGrids || []).map(g => [g.sheet, g]))
  for (const fp of (structural && structural.sheets) || []) {
    if (!fp.cellsTruncated) continue
    const embeddedRows = Array.isArray(fp.cells) ? fp.cells.length : 0
    const embeddedWidth = fp.cells?.[0]?.length ?? 0
    const rowsPastCap = Math.max(0, (fp.dataRowCount ?? 0) - embeddedRows)
    const colsPastCap = Math.max(0, (fp.dataColCount ?? 0) - embeddedWidth)
    const raw = bySheet.get(fp.sheetName)
    // STACKED_TABLES extraction reads fp.subTables — segmented from the CAPPED
    // grid at fingerprint time, never from fp.cells — so an upgraded grid would
    // NOT be consumed; claiming continuation there would be a false conservation
    // attestation. Keep the honest NOT-extracted warning for that shape.
    const consumesCells = fp.layoutShape !== 'STACKED_TABLES' || !Array.isArray(fp.subTables) || fp.subTables.length === 0
    let rowsRecovered = false
    let colsRecovered = false
    if (consumesCells && raw && Array.isArray(raw.cells) && raw.cells.length >= embeddedRows && rowsPastCap > 0) {
      fp.cells = embeddedWidth > 0 ? raw.cells.map(r => (r ?? []).slice(0, embeddedWidth)) : raw.cells
      fp.cellsExtended = true
      rowsRecovered = true
    }
    // CE3 Step 3(a): COLUMN continuation past MAX_EMBED_COLS — mirror of the row
    // continuation. The authoritative uncapped grid widens fp.cells and the extra
    // columns gain continuation columnProfiles so stage 3 maps them and stage 4
    // extracts them (a 148-column PCM loses columns 129-148 without this).
    if (consumesCells && raw && Array.isArray(raw.cells) && colsPastCap > 0 && Array.isArray(fp.cells) && Array.isArray(fp.columnProfiles)) {
      const fullWidth = raw.cells.reduce((m, r) => Math.max(m, (r ?? []).length), 0)
      const priorWidth = fp.cells[0]?.length ?? 0
      if (fullWidth > priorWidth) {
        fp.cells = fp.cells.map((row, i) => {
          const rawRow = raw.cells[i] ?? []
          const out = (row ?? []).slice()
          for (let c = priorWidth; c < fullWidth; c++) out[c] = rawRow[c] ?? null
          return out
        })
        const headerRow = Math.max(0, fp.bestHeaderRow ?? 0)
        for (let c = priorWidth; c < fullWidth; c++) {
          const headerLabel = raw.cells[headerRow]?.[c] != null ? String(raw.cells[headerRow][c]) : null
          const seen = new Set()
          const distinctSample = []
          const typeMix = {}
          for (let r = headerRow + 1; r < fp.cells.length && distinctSample.length < 8; r++) {
            const v = fp.cells[r]?.[c]
            if (v === null || v === undefined || v === '') continue
            const t = typeof v
            typeMix[t] = (typeMix[t] || 0) + 1
            const s = String(v)
            if (!seen.has(s)) { seen.add(s); distinctSample.push(v) }
          }
          fp.columnProfiles.push({ colIndex: c, headerLabel, typeMix, distinctSample, isEnumLike: false, hasDollarPattern: false, hasDatePattern: false, continuation: true })
        }
        fp.colsExtended = true
        colsRecovered = true
      }
    }
    if (rowsRecovered || colsRecovered) {
      fp.cellsTruncated = !(rowsRecovered || rowsPastCap === 0) || !(colsRecovered || colsPastCap === 0)
      warnings.push({ kind: 'grid-truncated', doc: docName, detail: `Sheet "${fp.sheetName}": embed caps exceeded — ${rowsPastCap > 0 ? `${rowsPastCap} row(s) past the ${brainShared.MAX_EMBED_ROWS}-row cap ${rowsRecovered ? 'ARE extracted via continuation windows' : 'are NOT extracted'}` : 'all rows covered'}; ${colsPastCap > 0 ? `${colsPastCap} column(s) past the ${brainShared.MAX_EMBED_COLS}-column cap ${colsRecovered ? 'ARE extracted via column continuation' : 'are NOT extracted'}` : 'all columns covered'}.` })
    } else if (rowsPastCap === 0 && colsPastCap > 0) {
      // Column-only truncation the raw grid cannot recover (raw itself capped or
      // absent past the embed width): honest exact-loss wording, no phantom rows.
      warnings.push({ kind: 'grid-truncated', doc: docName, detail: `Sheet "${fp.sheetName}": ${fp.dataColCount} columns exceed the ${brainShared.MAX_EMBED_COLS}-column embed cap — ${colsPastCap} column(s) are NOT extracted; all rows are covered.` })
    } else {
      const why = !consumesCells ? 'stacked-table layout extracts from segmented sub-tables, not the raw grid' : 'no raw grid on this path'
      warnings.push({ kind: 'grid-truncated', doc: docName, detail: `Sheet "${fp.sheetName}" exceeds the embed cap (${fp.dataRowCount} rows${colsPastCap > 0 ? `, ${fp.dataColCount} columns` : ''}) — ${rowsPastCap} row(s)${colsPastCap > 0 ? ` and ${colsPastCap} column(s)` : ''} past the cap are NOT extracted (${why}); review the tail manually.` })
    }
  }
}

module.exports = { routeArtifacts, prefixToLobRefId, PDF_TEXT_MIN_CHARS, extendTruncatedGrids, isManuscriptXml, parseCsv }
