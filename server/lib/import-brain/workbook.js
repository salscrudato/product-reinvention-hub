'use strict'
// server/lib/import-brain/workbook.js — server-side workbook ingestion.
//
// Sniffs artifact containers from MAGIC BYTES (never the filename), reads XLSX/XLSM
// workbooks with ExcelJS (macros in .xlsm are ignored safely — only worksheet parts
// are read; xl/vbaProject.bin is never executed or inspected beyond detection), and
// builds a StructuralModel via the shared platform-free builder so extraction
// operates on the REAL normalized cell grid.
//
// Correctness guarantees (mirrors app/src/lib/import/structure/xlsxReader.ts):
//   * Extent scan uses eachRow({includeEmpty:false}) — ws.rowCount is NEVER trusted
//     (whole-column formatting reports 1,048,576 phantom rows; see SECURA Property RF).
//   * Formula cells contribute their CACHED RESULT value (normalizeCellValue reads
//     `result`), including broken external-workbook references.
//   * Hidden sheets are skipped deterministically but reported (never silent).

const brainShared = require('../import-brain-shared.cjs')

// ─── Magic-byte sniffing ──────────────────────────────────────────────────────

/**
 * @param {Buffer} buf
 * @param {string} [mediaType]
 * @returns {{ container: 'ZIP'|'PDF'|'TEXT'|'UNKNOWN', workbookKind: 'XLSX'|'XLSM'|null }}
 */
function sniffContainer(buf, mediaType) {
  if (!buf || buf.length < 4) return { container: 'UNKNOWN', workbookKind: null }
  // PK\x03\x04 — OOXML zip (xlsx/xlsm/docx/…)
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    // Macro-enabled if the zip carries a VBA project or a macroEnabled content type.
    const head = buf.toString('latin1')
    const isXlsm = head.includes('vbaProject.bin') || head.includes('macroEnabled')
    return { container: 'ZIP', workbookKind: isXlsm ? 'XLSM' : 'XLSX' }
  }
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return { container: 'PDF', workbookKind: null }
  // Printable text heuristic (CSV / plain text)
  let printable = 0
  const n = Math.min(buf.length, 512)
  for (let i = 0; i < n; i++) {
    const c = buf[i]
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) printable++
  }
  if (printable / n >= 0.9) return { container: 'TEXT', workbookKind: null }
  if (mediaType === 'application/pdf') return { container: 'PDF', workbookKind: null }
  return { container: 'UNKNOWN', workbookKind: null }
}

// ─── ZIP pre-inspection (RISK R5 / CRASH_CENSUS F-3) ──────────────────────────
// ExcelJS materializes the WHOLE decompressed workbook before any clamp runs — a
// crafted high-ratio zip turns a small upload into multi-GB RSS on the single-
// instance host. This walker reads ONLY the OOXML central directory (EOCD → CEN,
// declared sizes; nothing is inflated) and enforces layered ceilings BEFORE
// wb.xlsx.load. Env-tunable; breach throws a structured IMPORT_413 error, which
// stage0-router surfaces as an honest notice (never a crash).

function envInt(name, dflt) {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt
}

function importZipLimits() {
  return {
    totalUncompressedBytes:   envInt('IMPORT_ZIP_MAX_UNCOMPRESSED_BYTES', 314572800), // 300 MB
    entryCount:               envInt('IMPORT_ZIP_MAX_ENTRIES', 2000),
    perEntryCompressionRatio: envInt('IMPORT_ZIP_MAX_ENTRY_RATIO', 400),
    declaredCellCount:        envInt('IMPORT_ZIP_MAX_DECLARED_CELLS', 3000000),
    parseWallClockMs:         envInt('IMPORT_PARSE_WALL_CLOCK_MS', 180000),
  }
}

// The compression-ratio ceiling only applies to entries at least this large:
// tiny XML parts (content types, shared styles) legitimately deflate >100x, but a
// bomb needs BULK. Entries below the floor are still counted toward the total-
// bytes and cell-count ceilings, so splitting a bomb into small entries walks
// into entryCount/totalUncompressedBytes instead.
const RATIO_FLOOR_BYTES = 4 * 1024 * 1024

// Conservative lower bound for one declared cell's XML footprint
// (`<c r="A1"><v>1</v></c>` ≈ 24 bytes). declaredCellCount is enforced as
// ceil(declared uncompressed bytes of xl/worksheets/*.xml ÷ 24) — deliberately
// NOT from the <dimension> element: whole-column-formatted sheets DECLARE
// 1,048,576 phantom rows (SECURA Property RF, All Lines Rules Repository) while
// their sheet XML stays small; a dimension-based count would reject exactly the
// legitimate files the used-range clamp exists to save. Phantom rows add no XML
// bytes, bombs do — bytes are the honest signal at pre-inspection time.
const MIN_BYTES_PER_CELL = 24
const SHEET_XML_RE = /^xl\/worksheets\/[^/]+\.xml$/i

function import413(reason, detail, limits, observed) {
  const err = new Error(`IMPORT_413 ${reason}: ${detail}`)
  err.code = 'IMPORT_413'
  err.reason = reason
  err.limits = { ...limits, observed }
  return err
}

function readUInt64LE(buf, off) {
  // Number (not BigInt): real workbook sizes fit 2^53 comfortably; a bomb
  // declaring more just reads as a huge number and breaches the ceiling anyway.
  return buf.readUInt32LE(off) + buf.readUInt32LE(off + 4) * 0x100000000
}

/**
 * Walk the OOXML container's central directory from the raw buffer. Pure reads —
 * no inflation, no ExcelJS. Returns per-entry declared sizes; throws IMPORT_413
 * on any ceiling breach, or a plain Error when the buffer is not a readable zip.
 *
 * @param {Buffer} buf
 * @param {{ limits?: object }} [opts]  test override for the ceilings
 * @returns {{ entries: Array<{name: string, compressedBytes: number, uncompressedBytes: number}>,
 *             entryCount: number, totalUncompressedBytes: number, declaredCellEstimate: number }}
 */
function inspectOoxmlContainer(buf, opts = {}) {
  const limits = { ...importZipLimits(), ...(opts.limits || {}) }

  // 1. EOCD: scan back for PK\x05\x06 (max comment 65535 bytes + 22-byte record).
  const minEocd = 22
  if (!buf || buf.length < minEocd) throw new Error('not a zip container (too small)')
  let eocd = -1
  const scanFloor = Math.max(0, buf.length - (65535 + minEocd))
  for (let i = buf.length - minEocd; i >= scanFloor; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip container (no end-of-central-directory record)')

  let entryCount = buf.readUInt16LE(eocd + 10)
  let cdSize     = buf.readUInt32LE(eocd + 12)
  let cdOffset   = buf.readUInt32LE(eocd + 16)

  // ZIP64: the 16-bit/32-bit fields saturate; the real values live in the ZIP64
  // EOCD record found via its locator (PK\x06\x07, 20 bytes, just before EOCD).
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20
    if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
      const z64Off = readUInt64LE(buf, loc + 8)
      if (z64Off + 56 <= buf.length && buf.readUInt32LE(z64Off) === 0x06064b50) {
        entryCount = readUInt64LE(buf, z64Off + 32)
        cdSize     = readUInt64LE(buf, z64Off + 40)
        cdOffset   = readUInt64LE(buf, z64Off + 48)
      }
    }
  }

  if (entryCount > limits.entryCount) {
    throw import413('entryCount', `zip declares ${entryCount} entries (ceiling ${limits.entryCount})`, limits, { entryCount })
  }
  if (cdOffset >= buf.length || cdOffset + cdSize > buf.length) {
    throw new Error('corrupt zip: central directory outside the buffer')
  }

  // 2. CEN walk: declared compressed/uncompressed sizes per entry.
  const entries = []
  let p = cdOffset
  let totalUncompressedBytes = 0
  let sheetXmlBytes = 0
  for (let n = 0; n < entryCount; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`corrupt zip: bad central-directory entry at ${p}`)
    }
    let compressedBytes   = buf.readUInt32LE(p + 20)
    let uncompressedBytes = buf.readUInt32LE(p + 24)
    const nameLen  = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const cmtLen   = buf.readUInt16LE(p + 32)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)

    // ZIP64 extra field (id 0x0001) carries the real sizes when saturated.
    if (compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) {
      let e = p + 46 + nameLen
      const eEnd = e + extraLen
      while (e + 4 <= eEnd) {
        const id = buf.readUInt16LE(e); const sz = buf.readUInt16LE(e + 2)
        if (id === 0x0001) {
          let f = e + 4
          if (uncompressedBytes === 0xffffffff && f + 8 <= eEnd) { uncompressedBytes = readUInt64LE(buf, f); f += 8 }
          if (compressedBytes === 0xffffffff && f + 8 <= eEnd) { compressedBytes = readUInt64LE(buf, f); f += 8 }
          break
        }
        e += 4 + sz
      }
    }

    totalUncompressedBytes += uncompressedBytes
    if (SHEET_XML_RE.test(name)) sheetXmlBytes += uncompressedBytes

    if (uncompressedBytes >= RATIO_FLOOR_BYTES) {
      const ratio = uncompressedBytes / Math.max(1, compressedBytes)
      if (ratio > limits.perEntryCompressionRatio) {
        throw import413('perEntryCompressionRatio',
          `entry "${name}" declares ${uncompressedBytes} bytes from ${compressedBytes} compressed (ratio ${Math.round(ratio)}, ceiling ${limits.perEntryCompressionRatio})`,
          limits, { name, compressedBytes, uncompressedBytes, ratio: Math.round(ratio) })
      }
    }

    entries.push({ name, compressedBytes, uncompressedBytes })
    p += 46 + nameLen + extraLen + cmtLen
  }

  if (totalUncompressedBytes > limits.totalUncompressedBytes) {
    throw import413('totalUncompressedBytes',
      `zip declares ${totalUncompressedBytes} uncompressed bytes (ceiling ${limits.totalUncompressedBytes})`,
      limits, { totalUncompressedBytes })
  }

  const declaredCellEstimate = Math.ceil(sheetXmlBytes / MIN_BYTES_PER_CELL)
  if (declaredCellEstimate > limits.declaredCellCount) {
    throw import413('declaredCellCount',
      `worksheet XML declares ~${declaredCellEstimate} cells from ${sheetXmlBytes} bytes (ceiling ${limits.declaredCellCount}; estimate = bytes / ${MIN_BYTES_PER_CELL})`,
      limits, { sheetXmlBytes, declaredCellEstimate })
  }

  return { entries, entryCount, totalUncompressedBytes, declaredCellEstimate }
}

// ─── ExcelJS → grids → StructuralModel ────────────────────────────────────────

function colLetterToIndex(letters) {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}

function getMergedRanges(ws) {
  const raw = ws['_merges']
  if (!raw) return []
  const seen = new Set()
  const ranges = []
  for (const entry of Object.values(raw)) {
    // ExcelJS stores either a range string or a model object depending on version.
    const rangeStr = typeof entry === 'string' ? entry : (entry && entry.shortRange) || (entry && String(entry)) || ''
    if (!rangeStr || seen.has(rangeStr)) continue
    seen.add(rangeStr)
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(rangeStr)
    if (!m) continue
    ranges.push({
      top:    parseInt(m[2], 10) - 1,
      left:   colLetterToIndex(m[1]),
      bottom: parseInt(m[4], 10) - 1,
      right:  colLetterToIndex(m[3]),
    })
  }
  return ranges
}

/**
 * Read a workbook buffer into a StructuralModel with real cells embedded.
 * Works for both .xlsx and .xlsm (ExcelJS reads worksheet parts; macros ignored).
 *
 * @param {Buffer} buf
 * @param {string} sourceName
 * @param {'XLSX'|'XLSM'} kind
 * @returns {Promise<{ structural: object, skippedHiddenSheets: string[] }>}
 */
async function readWorkbookToStructural(buf, sourceName, kind) {
  // Lazy require so environments without the server dep fail at call time with a
  // clear message rather than at module load.
  let ExcelJS
  try { ExcelJS = require('exceljs') } catch {
    throw new Error('exceljs is not installed in the server host (npm install --prefix server)')
  }

  // Armor BEFORE materialization: ceilings are enforced on declared central-
  // directory sizes; a breach throws IMPORT_413 and ExcelJS never runs.
  inspectOoxmlContainer(buf)

  const wb = new ExcelJS.Workbook()
  // Wall-clock ceiling on the parse itself. Honest limitation: a rejection
  // cannot abort ExcelJS's CPU-bound work mid-flight (no worker isolation here);
  // it bounds how long the pipeline WAITS and surfaces a structured notice
  // instead of hanging the run. CRASH_CENSUS-style child-process isolation is
  // the harness-side complement.
  const limits = importZipLimits()
  let wallTimer
  try {
    await Promise.race([
      wb.xlsx.load(buf),
      new Promise((_, reject) => {
        wallTimer = setTimeout(
          () => reject(import413('parseWallClockMs', `workbook parse exceeded ${limits.parseWallClockMs}ms`, limits, { parseWallClockMs: limits.parseWallClockMs })),
          limits.parseWallClockMs)
      }),
    ])
  } finally {
    clearTimeout(wallTimer)
  }

  const grids = []
  const hiddenGrids = []
  const skippedHiddenSheets = []

  for (const ws of wb.worksheets) {
    const hidden = ws.state === 'hidden' || ws.state === 'veryHidden'
    // True-extent scan: only rows/cols with actual values count.
    let lastRow = 0
    let lastCol = 0
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.value !== null && cell.value !== undefined) {
          if (rowNumber > lastRow) lastRow = rowNumber
          if (colNumber > lastCol) lastCol = colNumber
        }
      })
    })

    const cells = []
    for (let r = 1; r <= lastRow; r++) {
      const rowObj = ws.getRow(r)
      const arr = new Array(lastCol).fill(null)
      // Normalize to IsoCell scalars HERE, not just inside buildStructuralModel:
      // isoGrids feed mapIsoWorkbook directly, and raw ExcelJS objects (formula
      // {result}, richText) fail its state-scope X-marker tests — 137 CORE rules
      // came back allStates:false on the server while the same file parsed
      // allStates:true locally from flattened grids.
      for (let c = 1; c <= lastCol; c++) arr[c - 1] = brainShared.normalizeCellValue(rowObj.getCell(c).value)
      cells.push(arr)
    }

    if (hidden) {
      // CE3 POLICY FLIP (Step 1): hidden sheets ENTER extraction — a hidden
      // "Forms View - MTG" carries 2,072 real cells the old skip lost. They ride
      // the structural model like any sheet; their names travel as provenance so
      // stage 7 stamps hiddenSource:true on every entity extracted from them.
      skippedHiddenSheets.push(ws.name) // legacy key: now "hidden sheet names", still surfaced
      hiddenGrids.push({ sheet: ws.name, cells, mergedCells: getMergedRanges(ws) })
      continue
    }
    grids.push({ sheet: ws.name, cells, mergedCells: getMergedRanges(ws) })
  }

  // Visible-first, hidden-after: preserves the pre-flip mapper input order exactly
  // (isoGrids already carried hidden sheets in this order; structural now does too).
  const structural = brainShared.buildStructuralModel([...grids, ...hiddenGrids], sourceName, kind)
  // Raw grids (visible + hidden) ride along for the deterministic ISO-family mapper
  // (stage 7 joins its canonical identities with the brain's cited extraction).
  const isoGrids = [
    ...grids.map(g => ({ sheet: g.sheet, file: sourceName, cells: g.cells })),
    ...hiddenGrids.map(g => ({ sheet: g.sheet, file: sourceName, cells: g.cells, hidden: true })),
  ]

  // CE1 cell census on the SAME loaded workbook (no second ExcelJS parse).
  // Formatting-lite over the census-lite ceiling: the per-cell style walk doubles
  // RSS on 100k+-cell masters (CE1 F-C6: All Lines = 1.28 GB child RSS); above the
  // ceiling only values/merges/validations are censused (format flags default off —
  // the only losses are the headerLockV2 formatting bonus and indent staircase).
  let census = null
  try {
    const totalCells = [...grids, ...hiddenGrids].reduce(
      (n, g) => n + g.cells.reduce((m, row) => m + row.reduce((k, v) => k + (v !== null && v !== undefined && v !== '' ? 1 : 0), 0), 0), 0)
    const liteCeiling = Number(process.env.IMPORT_CENSUS_LITE_CELLS || 60000)
    const raws = collectRawCensusSheets(wb, { lite: totalCells > liteCeiling })
    census = brainShared.buildWorkbookCensus(raws, sourceName)
    census.formattingLite = totalCells > liteCeiling
  } catch (e) {
    // The census is an accounting aid, never a run blocker — surface, continue.
    census = { sourceName, sheets: [], censusError: String(e && e.message || e).slice(0, 200) }
  }

  return { structural, skippedHiddenSheets, hiddenSheets: skippedHiddenSheets, isoGrids, census }
}

// ─── Cell-census feeding (CE1-S4) ─────────────────────────────────────────────
// The census needs what only the LIVE ExcelJS worksheet has: formatting (bold /
// fill / indent / top border), merge ranges, sheet visibility, data validations.
// This collector walks each worksheet ONCE into the pure RawCensusSheet contract
// (shared/src/import/census); the census itself is built by the bridged pure
// module. Read-only: no ExcelJS write API is ever touched.

function collectRawCensusSheets(wb, opts = {}) {
  // lite (CE3): skip per-cell STYLE reads (font/fill/alignment/border) — on
  // 100k+-cell masters the style walk doubles RSS (CE1 F-C6). RawCensusCell's
  // format fields are optional; buildSheetCensus defaults them, so census
  // structure/accounting are byte-identical — only formatting-derived detector
  // signals (headerLockV2 formattingShift, indent staircase) lose input.
  const lite = !!opts.lite
  const sheets = []
  for (const ws of wb.worksheets) {
    const hidden = ws.state === 'hidden' || ws.state === 'veryHidden'
    // True extent (same discipline as readWorkbookToStructural: rowCount lies).
    let lastRow = 0
    let lastCol = 0
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.value !== null && cell.value !== undefined) {
          if (rowNumber > lastRow) lastRow = rowNumber
          if (colNumber > lastCol) lastCol = colNumber
        }
      })
    })
    const cells = []
    for (let r = 1; r <= lastRow; r++) {
      const rowObj = ws.getRow(r)
      const arr = new Array(lastCol).fill(null)
      for (let c = 1; c <= lastCol; c++) {
        const cell = rowObj.getCell(c)
        const v = cell.value
        if (v === null || v === undefined) continue
        arr[c - 1] = lite ? { v } : {
          v,
          bold: !!(cell.font && cell.font.bold),
          filled: !!(cell.fill && cell.fill.type === 'pattern' && cell.fill.pattern && cell.fill.pattern !== 'none'),
          indent: (cell.alignment && Number(cell.alignment.indent)) || 0,
          topBorder: !!(cell.border && cell.border.top && cell.border.top.style),
        }
      }
      cells.push(arr)
    }
    const validations = []
    const dvModel = ws.dataValidations && ws.dataValidations.model
    if (dvModel && typeof dvModel === 'object') {
      for (const [ref, rule] of Object.entries(dvModel)) {
        if (rule && rule.type) {
          validations.push({ ref, type: String(rule.type), formulae: Array.isArray(rule.formulae) ? rule.formulae.map(String) : [] })
        }
      }
    }
    sheets.push({ name: ws.name, hidden, cells, merges: getMergedRanges(ws), validations })
  }
  return sheets
}

/**
 * Full read-only cell census of a workbook buffer: armor first, one ExcelJS
 * load, RawCensusSheet collection, pure census build via the bridge.
 * @param {Buffer} buf
 * @param {string} sourceName
 * @returns {Promise<{ raws: object[], census: object }>}
 */
async function readWorkbookCensus(buf, sourceName) {
  let ExcelJS
  try { ExcelJS = require('exceljs') } catch {
    throw new Error('exceljs is not installed in the server host (npm install --prefix server)')
  }
  inspectOoxmlContainer(buf)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const raws = collectRawCensusSheets(wb)
  return { raws, census: brainShared.buildWorkbookCensus(raws, sourceName) }
}

// ─── Workbook signal collection (CRASH_CENSUS F-0 residual) ──────────────────
// Harvest refId tokens + sheet names from a StructuralModel for deterministic LOB
// inference. This is the SEAM-FREE home of the collector: stage0-router.js keeps
// an internal copy (that module requires ./ai-call, an AI seam offline harnesses
// must not touch) — the two are pinned together by tests/import-brain so the
// crash-census replica could die. Cap 500 refIds: a signal sample, not a census.
function collectWorkbookSignals(structural, REFID_TOKEN) {
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

module.exports = {
  sniffContainer, readWorkbookToStructural,
  inspectOoxmlContainer, importZipLimits, collectWorkbookSignals,
  collectRawCensusSheets, readWorkbookCensus,
}
