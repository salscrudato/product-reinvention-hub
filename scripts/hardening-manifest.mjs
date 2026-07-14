#!/usr/bin/env node
// scripts/hardening-manifest.mjs — structural ground-truth manifest for the
// import-hardening corpus (samples/hardening/{workbooks,adversarial}).
//
// Emits samples/hardening/manifest/xlsx_ooxml_summary.json: per workbook file,
// the OOXML facts the import pipeline must not silently lose — sheet inventory
// with hidden state, REPORTED extents vs TRUE used range (whole-column styling
// inflates ws.rowCount to 1,048,576), non-empty cell counts, merged ranges, and
// independent header-row candidates (top rows scored by short-string density —
// deliberately NOT the pipeline's own scorer, so the manifest stays non-circular).
//
// Run: node scripts/hardening-manifest.mjs
// Deterministic: same files → same JSON (md5 included per file).

import { createHash } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS = resolve(REPO, 'samples/hardening')
const OUT_DIR = join(CORPUS, 'manifest')
const OUT = join(OUT_DIR, 'xlsx_ooxml_summary.json')

// workbooks + adversarial are the staged hardening corpus; ../iso holds the
// repo-native golden workbooks (Tier A) — included so the manifest also records
// the CORE reference workbook's hidden sheets and any cap-exceeding extents.
const DIRS = ['workbooks', 'adversarial', '../iso']

function md5(buf) { return createHash('md5').update(buf).digest('hex') }

function isZipContainer(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
}

// Independent header candidate scorer: rows in the top 12 whose cells are mostly
// short non-numeric strings (>=3 of them) look like header rows. Top 2 by score.
function headerCandidates(grid, lastRow, lastCol) {
  const scored = []
  const scanRows = Math.min(lastRow, 12)
  for (let r = 0; r < scanRows; r++) {
    const row = grid[r] || []
    let shortStrings = 0, nonEmpty = 0
    for (let c = 0; c < lastCol; c++) {
      const v = row[c]
      if (v === null || v === undefined || v === '') continue
      nonEmpty++
      if (typeof v === 'string' && v.length > 0 && v.length <= 60 && !/^-?\d+(\.\d+)?$/.test(v.trim())) shortStrings++
    }
    if (shortStrings >= 3) scored.push({ row: r + 1, score: shortStrings + nonEmpty / 100 })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 2).map(s => s.row)
}

function flatten(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text ?? '').join('')
    if ('result' in v) return typeof v.result === 'object' ? null : v.result
    if ('hyperlink' in v) return String(v.text ?? v.hyperlink ?? '')
    if ('text' in v) return String(v.text)
  }
  return null
}

async function describeWorkbook(filePath) {
  const buf = readFileSync(filePath)
  const entry = {
    file: basename(filePath),
    dir: basename(dirname(filePath)),
    bytes: buf.length,
    md5: md5(buf),
    container: isZipContainer(buf) ? 'ZIP_OOXML' : 'NOT_ZIP',
    sheets: [],
    error: null,
  }
  if (entry.container !== 'ZIP_OOXML') return entry
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    wb.eachSheet(ws => {
      // True used range: only cells with real values, never the reported extent.
      let lastRow = 0, lastCol = 0, nonEmptyCells = 0
      ws.eachRow({ includeEmpty: false }, (row, rn) => {
        row.eachCell({ includeEmpty: false }, (cell, cn) => {
          if (cell.value === null || cell.value === undefined) return
          nonEmptyCells++
          if (rn > lastRow) lastRow = rn
          if (cn > lastCol) lastCol = cn
        })
      })
      const grid = []
      const scanRows = Math.min(lastRow, 12)
      for (let r = 1; r <= scanRows; r++) {
        const rowObj = ws.getRow(r)
        const arr = []
        for (let c = 1; c <= lastCol; c++) arr[c - 1] = flatten(rowObj.getCell(c).value)
        grid[r - 1] = arr
      }
      entry.sheets.push({
        name: ws.name,
        state: ws.state === 'hidden' ? 'hidden' : ws.state === 'veryHidden' ? 'veryHidden' : 'visible',
        reportedRows: ws.rowCount,
        reportedCols: ws.columnCount,
        usedRows: lastRow,
        usedCols: lastCol,
        nonEmptyCells,
        mergedRanges: Object.keys(ws._merges || {}).length,
        headerCandidates: headerCandidates(grid, lastRow, lastCol),
        exceedsEmbedCap: lastRow > 2000 || lastCol > 128,
      })
    })
  } catch (e) {
    entry.error = String(e && e.message ? e.message : e)
  }
  return entry
}

const files = []
for (const d of DIRS) {
  const dir = join(CORPUS, d)
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (!statSync(p).isFile()) continue
    if (/\.pdf$/i.test(f)) continue
    files.push(p)
  }
}
files.sort()

const workbooks = []
for (const f of files) {
  process.stdout.write(`  scanning ${basename(f)} ...\n`)
  workbooks.push(await describeWorkbook(f))
}

const parsed = workbooks.filter(w => !w.error && w.container === 'ZIP_OOXML')
const summary = {
  generatedBy: 'scripts/hardening-manifest.mjs',
  corpus: 'samples/hardening/{workbooks,adversarial}',
  workbookFiles: workbooks.length,
  parsedWorkbooks: parsed.length,
  totalSheets: parsed.reduce((n, w) => n + w.sheets.length, 0),
  hiddenSheets: parsed.reduce((n, w) => n + w.sheets.filter(s => s.state !== 'visible').length, 0),
  sheetsExceedingEmbedCap: parsed.reduce((n, w) => n + w.sheets.filter(s => s.exceedsEmbedCap).length, 0),
  duplicateMd5Groups: Object.entries(
    workbooks.reduce((m, w) => { (m[w.md5] ??= []).push(`${w.dir}/${w.file}`); return m }, {})
  ).filter(([, v]) => v.length > 1).map(([hash, files]) => ({ md5: hash, files })),
  workbooks,
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(summary, null, 2))
process.stdout.write(`\n✓ ${summary.parsedWorkbooks}/${summary.workbookFiles} workbooks, ${summary.totalSheets} sheets (${summary.hiddenSheets} hidden, ${summary.sheetsExceedingEmbedCap} exceed embed caps) → ${OUT}\n`)
