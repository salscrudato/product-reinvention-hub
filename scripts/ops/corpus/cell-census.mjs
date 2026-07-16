// scripts/ops/corpus/cell-census.mjs
//
// CELL CENSUS: run the deterministic conservation layer (shared/src/import/census
// via import-brain-shared.cjs + the workbook.js feeder) against every workbook
// under samples/corpus-2026-07/**. ZERO model calls, ZERO network.
//
// Per file it emits docs/import-census/BASELINE/<file>.census.json with:
//   * per-sheet census rollups (dims, nonEmpty, regions, fingerprints)
//   * detector outputs (near-dup clusters, hidden substance, form tokens,
//     state orientation, id prefixes, repeating-parent + staircase signals)
//   * a virgin accounting rollup (everything UNACCOUNTED except merge shadows)
//     whose conservation identity is ASSERTED: entries sum exactly to nonEmpty.
// Plus docs/import-census/CELL_CENSUS.md — a per-file summary table with a
// hand-authored findings section preserved across re-runs (crash-census.mjs
// discipline: child-process isolation, hard timeout, findings marker).
//
// SAFETY FLOOR (same as crash-census.mjs):
//   * Workbooks are opened READ-ONLY; no ExcelJS write API is ever called.
//   * .xlsm macros are NEVER executed.
//   * Each file runs in a CHILD PROCESS under a hard timeout
//     (CELL_CENSUS_TIMEOUT_MS, default 120000). Crash/hang = recorded row.
//
// Usage:
//   node scripts/ops/corpus/cell-census.mjs           # full run
//   node scripts/ops/corpus/cell-census.mjs --one F   # internal child mode
//
// Idempotent: deterministic output for identical inputs (no timestamps in body).

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..', '..', '..')
const CORPUS_DIR = path.join(ROOT, 'samples', 'corpus-2026-07')
const OUT_DIR = path.join(ROOT, 'docs', 'import-census', 'BASELINE')
const OUT_MD = path.join(ROOT, 'docs', 'import-census', 'CELL_CENSUS.md')
const TIMEOUT_MS = Number(process.env.CELL_CENSUS_TIMEOUT_MS || 120000)

const requireCjs = createRequire(path.join(ROOT, 'server', 'lib', 'import-brain', 'anchor.js'))

function listWorkbooks(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...listWorkbooks(p))
    else if (/\.(xlsx|xlsm)$/i.test(ent.name) && !ent.name.startsWith('~$')) out.push(p)
  }
  return out.sort()
}
const rel = (p) => path.relative(CORPUS_DIR, p).replace(/\\/g, '/')
const safeName = (relPath) => relPath.replace(/[\\/]/g, '__')

// ---------- child mode: census ONE file ----------

async function censusOne(file) {
  const wbmod = requireCjs('./workbook.js')
  const brain = requireCjs('../import-brain-shared.cjs')

  const buf = fs.readFileSync(file) // read-only
  const t0 = Date.now()

  let raws, census
  try {
    ;({ raws, census } = await wbmod.readWorkbookCensus(buf, path.basename(file)))
  } catch (e) {
    return {
      file: rel(file), status: e && e.code === 'IMPORT_413' ? 'REJECTED-413' : 'STRUCTURED-ERROR',
      error: String((e && e.message) || e).slice(0, 300),
      wallMs: Date.now() - t0, peakRssMB: Math.round(process.memoryUsage().rss / 1048576),
    }
  }

  // Virgin accounting: conservation identity must hold on every sheet.
  const sheetRollups = []
  for (const s of census.sheets) {
    const acc = brain.createAccounting(s)
    sheetRollups.push(brain.rollupSheet(acc)) // throws if entries !== nonEmpty
  }
  const rollup = brain.rollupWorkbook(census.sourceName, sheetRollups)

  // Detectors.
  const hidden = brain.hiddenSheetSubstance(census)
  const clusters = brain.nearDuplicateSheetClusters(census)
  const overlay = brain.harvestAliasOverlay(raws, census.sheets)
  const perSheet = census.sheets.map((s) => {
    // Rebuild the normalized grid for the state detector (sparse -> dense).
    const normalized = []
    for (let r = 0; r < s.dims.rows; r++) normalized.push(new Array(s.dims.cols).fill(null))
    for (const c of s.cells) {
      const n = Number(c.verbatim)
      normalized[c.row][c.col] = c.type === 'number' && Number.isFinite(n) ? n : c.verbatim
    }
    const tokens = brain.formTokenCensus(s)
    const states = brain.stateLexicon(s, normalized)
    const ids = brain.idColumnProfile(s)
    return {
      name: s.name, hidden: s.hidden, dims: s.dims, nonEmpty: s.nonEmpty,
      fingerprint: s.fingerprint,
      tables: s.tables,
      formTokens: tokens.count,
      formTokenSample: tokens.distinct.slice(0, 12),
      stateOrientation: states.orientation,
      idPrefixes: ids.prefixes,
      repeatingParentCols: brain.repeatingParentRuns(s).map((x) => x.col),
      staircaseCols: brain.staircaseHierarchy(s).map((x) => ({ col: x.col, kind: x.kind, levels: x.levels })),
    }
  })

  return {
    file: rel(file), status: 'OK',
    sheets: census.sheets.length,
    hiddenSheets: census.sheets.filter((s) => s.hidden).length,
    nonEmpty: rollup.nonEmpty,
    mergeShadows: rollup.byDisposition.MERGE_SHADOW,
    unaccounted: rollup.byDisposition.UNACCOUNTED,
    conservation: rollup.byDisposition.UNACCOUNTED + rollup.byDisposition.MERGE_SHADOW === rollup.nonEmpty,
    tablesFound: perSheet.reduce((n, s) => n + s.tables.length, 0),
    hiddenSubstanceCells: hidden.reduce((n, h) => n + h.nonEmpty, 0),
    nearDupClusters: clusters.map((c) => ({ basis: c.basis, sheets: c.sheets.map((s) => ({ name: s.name, nonEmpty: s.nonEmpty })) })),
    formTokensDistinct: [...new Set(perSheet.flatMap((s) => s.formTokenSample))].length >= 0
      ? perSheet.reduce((n, s) => n + s.formTokens, 0) : 0,
    stateMatrixSheets: perSheet.filter((s) => s.stateOrientation === 'STATE_COLUMNS').map((s) => s.name),
    widestSheet: perSheet.reduce((w, s) => (s.dims.cols > (w.cols || 0) ? { name: s.name, cols: s.dims.cols } : w), {}),
    enumDomains: overlay.enumDomains.length,
    definitionsHarvested: overlay.definitions.length,
    perSheet,
    wallMs: Date.now() - t0,
    peakRssMB: Math.round(process.memoryUsage().rss / 1048576),
  }
}

// ---------- orchestrator ----------

function runChild(file) {
  const started = Date.now()
  const res = spawnSync(process.execPath, [SELF, '--one', file], {
    timeout: TIMEOUT_MS, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  })
  const wallMs = Date.now() - started
  if (res.error && res.error.code === 'ETIMEDOUT') {
    return { file: rel(file), status: 'TIMEOUT', wallMs, error: `killed at ${TIMEOUT_MS}ms` }
  }
  if (res.status !== 0) {
    const head = String(res.stderr || res.error || 'unknown').split('\n').slice(0, 4).join(' | ')
    return { file: rel(file), status: 'CRASH', wallMs, error: head.slice(0, 400) }
  }
  try { return { ...JSON.parse(res.stdout), orchWallMs: wallMs } }
  catch (e) { return { file: rel(file), status: 'CRASH', wallMs, error: 'child stdout not JSON: ' + String(e).slice(0, 120) } }
}

function emitMd(records) {
  const L = []
  L.push('# Cell census - deterministic conservation layer vs corpus-2026-07')
  L.push('')
  L.push('Generated by `scripts/ops/corpus/cell-census.mjs`. ZERO model calls, ZERO network:')
  L.push('`readWorkbookCensus` (workbook.js feeder incl. zip pre-inspection armor) +')
  L.push('the pure census/accounting/detector modules from `import-brain-shared.cjs`.')
  L.push('Per-file hard timeout ' + TIMEOUT_MS + 'ms; macro files parsed structure-only, never executed.')
  L.push('Full per-file detail: `docs/import-census/BASELINE/<file>.census.json`.')
  L.push('')
  L.push('## Per-file results')
  L.push('')
  L.push('| file | status | sheets (hid) | nonEmpty | merge shadows | tables | hidden substance cells | near-dup clusters | form tokens | state-matrix sheets | widest sheet | conservation | wall ms | RSS MB |')
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of records) {
    if (r.status !== 'OK') {
      L.push(`| ${r.file} | ${r.status} | - | - | - | - | - | - | - | - | - | - | ${r.wallMs} | - |`)
      L.push(`| -> detail | ${String(r.error || '').replace(/\|/g, '/')} |  |  |  |  |  |  |  |  |  |  |  |  |`)
      continue
    }
    const dup = r.nearDupClusters.length === 0 ? 'none'
      : r.nearDupClusters.map((c) => `${c.sheets.length}x${c.basis === 'headerSig' ? 'hdr' : 'name'}(${c.sheets.map((s) => s.nonEmpty).join('/')})`).join(' ')
    const widest = r.widestSheet && r.widestSheet.name ? `${r.widestSheet.name} (${r.widestSheet.cols}c)` : '-'
    const matrix = r.stateMatrixSheets.length ? r.stateMatrixSheets.length + ': ' + r.stateMatrixSheets.slice(0, 2).join(', ') + (r.stateMatrixSheets.length > 2 ? ', ...' : '') : 'none'
    L.push(`| ${r.file} | OK | ${r.sheets} (${r.hiddenSheets}) | ${r.nonEmpty} | ${r.mergeShadows} | ${r.tablesFound} | ${r.hiddenSubstanceCells} | ${dup} | ${r.formTokensDistinct} | ${matrix} | ${widest} | ${r.conservation ? 'EXACT' : 'BROKEN'} | ${r.wallMs} | ${r.peakRssMB} |`)
  }
  L.push('')
  return L.join('\n')
}

async function main() {
  const oneIdx = process.argv.indexOf('--one')
  if (oneIdx !== -1) {
    const rec = await censusOne(process.argv[oneIdx + 1])
    process.stdout.write(JSON.stringify(rec))
    return
  }
  const files = listWorkbooks(CORPUS_DIR)
  if (files.length === 0) { console.error('No workbooks under ' + CORPUS_DIR); process.exit(1) }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const records = files.map((f) => {
    const r = runChild(f)
    console.error(`${r.status.padEnd(16)} ${r.file} (${r.wallMs}ms)`)
    if (r.status === 'OK') {
      // Per-file JSON keeps everything (perSheet detail is too wide for the table).
      fs.writeFileSync(path.join(OUT_DIR, safeName(r.file) + '.census.json'), JSON.stringify(r, null, 2) + '\n')
    }
    return r
  })
  // Preserve hand-written findings below the marker (idempotent table refresh).
  const MARK = '<!-- findings-below: hand-authored, preserved across re-runs -->'
  let tail = ''
  if (fs.existsSync(OUT_MD)) {
    const prev = fs.readFileSync(OUT_MD, 'utf8')
    const i = prev.indexOf(MARK)
    if (i !== -1) tail = prev.slice(i)
  }
  const summaryRows = records.map((r) => ({
    file: r.file, status: r.status, nonEmpty: r.nonEmpty ?? null, conservation: r.conservation ?? null,
  }))
  fs.writeFileSync(OUT_MD, emitMd(records) + (tail ? '\n' + tail : '\n' + MARK + '\n'))
  console.error(`Wrote ${path.relative(ROOT, OUT_MD)} + ${records.filter((r) => r.status === 'OK').length} BASELINE json files (${records.length} files, ${summaryRows.filter((r) => r.conservation === false).length} conservation breaks)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
