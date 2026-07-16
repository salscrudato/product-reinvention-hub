// scripts/ops/corpus/crash-census.mjs
//
// CRASH CENSUS: run ONLY the deterministic stage-0 path of the live import brain
// against every workbook under samples/corpus-2026-07/**. ZERO model calls, ZERO
// network. Emits docs/baseline/CRASH_CENSUS.md + samples/corpus-2026-07/crash-census.json.
//
// What "the deterministic path" means here (verified against the live code, not assumed):
//   * sniffContainer(buf)            server/lib/import-brain/workbook.js (magic bytes)
//   * readWorkbookToStructural(...)  same module (ExcelJS parse -> StructuralModel + isoGrids)
//   * refId signal collection        replicated VERBATIM from the non-exported
//                                    collectWorkbookSignals() in stage0-router.js:46-63
//                                    (stage0-router.js itself is NOT required here because it
//                                    imports ./ai-call - an AI seam this census must not touch)
//   * inferLob({refIds,sheetNames})  import-brain-shared.cjs (pure registry matching)
//   * scoreHeaderCandidates(cells)   import-brain-shared.cjs - the deterministic header-lock
//                                    fast path stage2 uses before any AI fallback (>0.80 = lock)
//
// SAFETY FLOOR:
//   * Workbooks are opened READ-ONLY; no ExcelJS write API is ever called.
//   * .xlsm macros are NEVER executed - ExcelJS reads worksheet parts only.
//   * Each file runs in a CHILD PROCESS under a hard timeout (CRASH_CENSUS_TIMEOUT_MS,
//     default 120000). A hang or crash is a recorded RESULT row, never worked around.
//   * Child reports peak RSS as the memory note.
//
// Result taxonomy per file:
//   OK               deterministic path completed
//   STRUCTURED-ERROR the live path rejected the file with a clean Error (message recorded)
//   CRASH            child process died (stack head recorded)
//   TIMEOUT          child exceeded the hard timeout
//
// Usage:
//   node scripts/ops/corpus/crash-census.mjs           # full run
//   node scripts/ops/corpus/crash-census.mjs --one F   # internal child mode
//
// Idempotent: deterministic output for identical inputs (no timestamps in table body).

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..', '..', '..')
const CORPUS_DIR = path.join(ROOT, 'samples', 'corpus-2026-07')
const OUT_MD = path.join(ROOT, 'docs', 'baseline', 'CRASH_CENSUS.md')
const OUT_JSON = path.join(CORPUS_DIR, 'crash-census.json')
const TIMEOUT_MS = Number(process.env.CRASH_CENSUS_TIMEOUT_MS || 120000)

const requireCjs = createRequire(path.join(ROOT, 'server', 'lib', 'import-brain', 'noop.js'))

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

// collectWorkbookSignals: the replica this census used to carry (CRASH_CENSUS
// F-0 residual) died — the collector is now exported from the seam-free
// workbook.js (stage0-router.js keeps an internal twin because it requires
// ./ai-call; the twin is pinned by tests/import-brain/parser-armor.test.ts).

// ---------- child mode: exercise the deterministic live path on ONE file ----------

async function crashOne(file) {
  const { sniffContainer, readWorkbookToStructural, collectWorkbookSignals } = requireCjs('./workbook.js')
  const { REFID_TOKEN } = requireCjs('./constants.js')
  const brainShared = requireCjs('../import-brain-shared.cjs')
  const { inferLob, scoreHeaderCandidates } = brainShared

  const buf = fs.readFileSync(file) // read-only
  const t0 = Date.now()

  // 1. Magic-byte sniff (never the filename)
  const sniff = sniffContainer(buf, null)

  // Reported (pre-clamp) dims: one plain ExcelJS load so we can judge whether the
  // live path CLAMPED the phantom used-range or BELIEVED it.
  const ExcelJS = requireCjs('exceljs')
  const wbRaw = new ExcelJS.Workbook()
  await wbRaw.xlsx.load(buf)
  const reported = new Map(wbRaw.worksheets.map(ws => [ws.name, { r: ws.rowCount, c: ws.columnCount }]))

  // 2. Live stage-0 structural build
  let structural, skippedHiddenSheets, isoGrids
  try {
    ;({ structural, skippedHiddenSheets, isoGrids } = await readWorkbookToStructural(buf, path.basename(file), sniff.workbookKind || 'XLSX'))
  } catch (e) {
    // A clean Error from the live path is a STRUCTURED-ERROR result, not a crash.
    return {
      file: rel(file), status: 'STRUCTURED-ERROR', error: String(e && e.message || e).slice(0, 300),
      sniff, wallMs: Date.now() - t0, peakRssMB: Math.round(process.memoryUsage().rss / 1048576),
    }
  }

  // Phantom used-range verdict: for each sheet whose reported area is >=2x the real
  // parsed grid area, did the structural build use the real extent (CLAMPED) or the
  // inflated one (BELIEVED)?
  let phantomSheets = 0, clampedSheets = 0, believedSheets = 0
  let cellCount = 0, maxGridR = 0, maxGridC = 0
  for (const g of (isoGrids || [])) {
    const realR = g.cells.length
    const realC = g.cells[0] ? g.cells[0].length : 0
    cellCount += realR * realC
    if (realR > maxGridR) maxGridR = realR
    if (realC > maxGridC) maxGridC = realC
    const rep = reported.get(g.sheet)
    if (!rep) continue
    if (rep.r * rep.c >= 2 * Math.max(1, realR * realC) && realR > 0) {
      phantomSheets++
      if (realR < rep.r || realC < rep.c) clampedSheets++
      else believedSheets++
    }
  }

  // 3. Deterministic LOB inference (stage0's step 1; AI assist deliberately NOT run)
  const sig = collectWorkbookSignals(structural, REFID_TOKEN)
  const lob = inferLob({ refIds: sig.refIds, sheetNames: sig.sheetNames, productName: null })

  // 4. Deterministic header-lock scorer (stage2 fast path) per visible fingerprint
  let sheetsScored = 0, fastLocked = 0, bestScore = 0
  for (const fp of (structural.sheets || [])) {
    if (!Array.isArray(fp.cells) || fp.cells.length === 0) continue
    sheetsScored++
    try {
      const cands = scoreHeaderCandidates(fp.cells)
      const top = Array.isArray(cands) && cands.length ? (cands[0].score ?? 0) : 0
      if (top > bestScore) bestScore = top
      if (top > 0.80) fastLocked++
    } catch (e) {
      return {
        file: rel(file), status: 'STRUCTURED-ERROR', error: 'scoreHeaderCandidates: ' + String(e && e.message || e).slice(0, 200),
        sniff, wallMs: Date.now() - t0, peakRssMB: Math.round(process.memoryUsage().rss / 1048576),
      }
    }
  }

  return {
    file: rel(file), status: 'OK', sniff,
    visibleSheets: structural.sheets.length,
    hiddenSheetsSkipped: skippedHiddenSheets.length,
    peakSheetCount: (isoGrids || []).length,
    peakCellCount: cellCount,
    maxGrid: `${maxGridR}x${maxGridC}`,
    phantom: { sheets: phantomSheets, clamped: clampedSheets, believed: believedSheets },
    lob: lob ? lob.refId : null,
    refIdSignals: sig.refIds.length,
    headerLock: { sheetsScored, fastLocked, bestScore: Number(bestScore.toFixed(3)) },
    wallMs: Date.now() - t0,
    peakRssMB: Math.round(process.memoryUsage().rss / 1048576),
  }
}

// ---------- orchestrator ----------

function runChild(file) {
  const started = Date.now()
  const res = spawnSync(process.execPath, [SELF, '--one', file], {
    timeout: TIMEOUT_MS, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
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
  L.push('# Crash census - deterministic stage-0 path vs corpus-2026-07')
  L.push('')
  L.push('Generated by `scripts/ops/corpus/crash-census.mjs`. ZERO model calls, ZERO network:')
  L.push('only `sniffContainer` + `readWorkbookToStructural` (server/lib/import-brain/workbook.js),')
  L.push('deterministic `inferLob`, and the stage-2 deterministic header-lock scorer')
  L.push('`scoreHeaderCandidates` (import-brain-shared.cjs). Per-file hard timeout ' + TIMEOUT_MS + 'ms;')
  L.push('macro files parsed structure-only, never executed.')
  L.push('')
  L.push('## Per-file results')
  L.push('')
  L.push('| file | status | sniff | sheets vis/hid | peak cells | max grid | phantom (clamped/believed) | LOB (det.) | refId sig | header fast-lock | wall ms | RSS MB |')
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of records) {
    if (r.status !== 'OK') {
      L.push(`| ${r.file} | ${r.status} | - | - | - | - | - | - | - | - | ${r.wallMs} | - | `.trim())
      L.push(`| -> detail | ${String(r.error || '').replace(/\|/g, '/')} |  |  |  |  |  |  |  |  |  |  |`)
      continue
    }
    const ph = r.phantom.sheets === 0 ? 'none' : `${r.phantom.sheets} (${r.phantom.clamped} clamped / ${r.phantom.believed} believed)`
    L.push(`| ${r.file} | OK | ${r.sniff.container}/${r.sniff.workbookKind} | ${r.visibleSheets}/${r.hiddenSheetsSkipped} | ${r.peakCellCount} | ${r.maxGrid} | ${ph} | ${r.lob || 'none'} | ${r.refIdSignals} | ${r.headerLock.fastLocked}/${r.headerLock.sheetsScored} (best ${r.headerLock.bestScore}) | ${r.wallMs} | ${r.peakRssMB} |`)
  }
  L.push('')
  return L.join('\n')
}

async function main() {
  const oneIdx = process.argv.indexOf('--one')
  if (oneIdx !== -1) {
    const rec = await crashOne(process.argv[oneIdx + 1])
    process.stdout.write(JSON.stringify(rec))
    return
  }
  const files = listWorkbooks(CORPUS_DIR)
  if (files.length === 0) { console.error('No workbooks under ' + CORPUS_DIR); process.exit(1) }
  const records = files.map((f) => {
    const r = runChild(f)
    console.error(`${r.status.padEnd(16)} ${r.file} (${r.wallMs}ms)`)
    return r
  })
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true })
  fs.writeFileSync(OUT_JSON, JSON.stringify(records, null, 2) + '\n')
  // Preserve any hand-written findings section below the marker on re-runs (idempotent
  // table refresh without clobbering analysis).
  const MARK = '<!-- findings-below: hand-authored, preserved across re-runs -->'
  let tail = ''
  if (fs.existsSync(OUT_MD)) {
    const prev = fs.readFileSync(OUT_MD, 'utf8')
    const i = prev.indexOf(MARK)
    if (i !== -1) tail = prev.slice(i)
  }
  fs.writeFileSync(OUT_MD, emitMd(records) + (tail ? '\n' + tail : '\n' + MARK + '\n'))
  console.error(`Wrote ${path.relative(ROOT, OUT_MD)} + crash-census.json (${records.length} files)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
