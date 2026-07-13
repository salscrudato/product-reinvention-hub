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

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)

  const grids = []
  const skippedHiddenSheets = []

  for (const ws of wb.worksheets) {
    if (ws.state === 'hidden' || ws.state === 'veryHidden') {
      skippedHiddenSheets.push(ws.name)
      continue
    }
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
      for (let c = 1; c <= lastCol; c++) arr[c - 1] = rowObj.getCell(c).value
      cells.push(arr)
    }

    grids.push({ sheet: ws.name, cells, mergedCells: getMergedRanges(ws) })
  }

  const structural = brainShared.buildStructuralModel(grids, sourceName, kind)
  return { structural, skippedHiddenSheets }
}

module.exports = { sniffContainer, readWorkbookToStructural }
