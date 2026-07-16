// scripts/ops/corpus/census.mjs
//
// READ-ONLY structural census of every workbook under samples/corpus-2026-07/**.
// Emits samples/corpus-2026-07/FIXTURES.md (table + drift check vs expected-traits.json)
// and samples/corpus-2026-07/census.json (machine-readable, used by the judge).
//
// SAFETY FLOOR:
//   - Workbooks are parsed READ-ONLY (ExcelJS read path only; nothing is ever written
//     back to any workbook, and no ExcelJS write API is imported or called).
//   - .xlsm macro files are NEVER executed: ExcelJS reads sheet structure and cells
//     from the zip; VBA is detected by byte-scanning for the "vbaProject.bin" zip
//     entry name, never loaded.
//   - Every per-file parse runs in a CHILD PROCESS under a hard timeout
//     (CENSUS_TIMEOUT_MS, default 120000). A hang or crash is a recorded RESULT
//     (TIMEOUT / CRASH row), never silently retried or worked around.
//   - Memory note: child reports peak RSS after parse (process.memoryUsage().rss).
//
// Usage:
//   node scripts/ops/corpus/census.mjs            # full census -> FIXTURES.md + census.json
//   node scripts/ops/corpus/census.mjs --one F    # internal: parse one file, print JSON
//
// Idempotent: same inputs -> same outputs (no timestamps in the table body).

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..', '..', '..')
const CORPUS_DIR = path.join(ROOT, 'samples', 'corpus-2026-07')
const TIMEOUT_MS = Number(process.env.CENSUS_TIMEOUT_MS || 120000)

// ---------- shared helpers ----------

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

function rel(p) {
  return path.relative(CORPUS_DIR, p).replace(/\\/g, '/')
}

// ---------- child mode: parse ONE file, print JSON to stdout ----------

async function censusOne(file) {
  const ExcelJS = (await import('exceljs')).default
  const buf = fs.readFileSync(file) // read-only; the only fs touch on the workbook
  const sizeKB = Math.round(buf.length / 1024)
  // Macro detection WITHOUT executing anything: zip entry names are stored in
  // plaintext in the archive, so a byte scan is sufficient and safe.
  const hasMacros = buf.includes(Buffer.from('vbaProject.bin', 'ascii'))

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)

  let definedNames = 0
  try {
    const m = wb.definedNames && wb.definedNames.model
    definedNames = Array.isArray(m) ? m.length : 0
  } catch { definedNames = 0 }

  const sheets = wb.worksheets.map((ws) => {
    let realR = 0, realC = 0, cells = 0
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        if (cell.value === null || cell.value === undefined) return
        cells++
        if (rn > realR) realR = rn
        if (cn > realC) realC = cn
      })
    })
    return {
      name: ws.name,
      state: ws.state || 'visible',
      repR: ws.rowCount, repC: ws.columnCount,
      realR, realC, cells,
      merges: Object.keys(ws._merges || {}).length,
    }
  })

  return {
    file: rel(file), sizeKB, hasMacros, definedNames, sheets,
    peakRssMB: Math.round(process.memoryUsage().rss / 1048576),
  }
}

// ---------- hostile-trait heuristics (pure functions over the census record) ----------

function normalizeSheetName(n) {
  return n.toLowerCase().trim()
    .replace(/\s*\(\d+\)\s*$/, '')   // "Liab BI (2)" -> "liab bi"
    .replace(/[_\s]*\d+$/, '')       // "TierFactor_9" -> "tierfactor"
    .replace(/\s+/g, ' ')
}

function hostileTraits(rec) {
  const t = new Set()
  const seen = new Map()
  for (const s of rec.sheets) {
    const repArea = Math.max(1, s.repR * s.repC)
    const realArea = Math.max(1, s.realR * s.realC)
    if (s.cells > 0 && repArea >= 2 * realArea && (s.repR - s.realR >= 10 || s.repC - s.realC >= 5)) {
      t.add('phantom-range')
    }
    if (s.realC > 200) t.add('wide-matrix-200c')
    if (s.cells > 0 && s.cells <= 2) t.add('ghost-sheet')
    if (s.cells === 0) t.add('empty-sheet')
    if (/^sheet\d*$/i.test(s.name.trim()) || /copy of|template\d|todo|xxx/i.test(s.name)) t.add('placeholder-name')
    if (s.name !== s.name.trim()) t.add('trailing-space-name')
    if (/[^A-Za-z0-9 _.,&()-]/.test(s.name)) t.add('special-char-name')
    if (s.state === 'hidden') t.add('hidden-sheet')
    if (s.state === 'veryHidden') t.add('very-hidden-sheet')
    if (s.name.trim().length >= 31) t.add('name-31char-truncated')
    const norm = normalizeSheetName(s.name)
    if (norm) {
      if (seen.has(norm)) t.add('near-duplicate-sheets')
      seen.set(norm, true)
    }
  }
  if (rec.hasMacros) t.add('macro-file')
  return [...t].sort()
}

// ---------- orchestrator mode ----------

function runChild(file) {
  const started = Date.now()
  const res = spawnSync(process.execPath, [SELF, '--one', file], {
    timeout: TIMEOUT_MS,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const wallMs = Date.now() - started
  if (res.error && res.error.code === 'ETIMEDOUT') {
    return { file: rel(file), status: 'TIMEOUT', wallMs, note: `killed at ${TIMEOUT_MS}ms` }
  }
  if (res.status !== 0) {
    const head = String(res.stderr || res.error || 'unknown').split('\n').slice(0, 3).join(' | ')
    return { file: rel(file), status: 'CRASH', wallMs, note: head.slice(0, 300) }
  }
  try {
    const rec = JSON.parse(res.stdout)
    rec.status = 'OK'
    rec.wallMs = wallMs
    rec.traits = hostileTraits(rec)
    return rec
  } catch (e) {
    return { file: rel(file), status: 'CRASH', wallMs, note: 'child stdout was not JSON: ' + String(e).slice(0, 120) }
  }
}

function loadExpected() {
  const p = path.join(CORPUS_DIR, 'expected-traits.json')
  if (!fs.existsSync(p)) return {}
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} }
}

function emitFixturesMd(records, expected) {
  const lines = []
  lines.push('# Corpus 2026-07 - fixture census (live-verified)')
  lines.push('')
  lines.push('Generated by `scripts/ops/corpus/census.mjs` (read-only parse, per-file hard timeout ' + TIMEOUT_MS + 'ms).')
  lines.push('Re-run the script to refresh; the table body is deterministic for identical inputs.')
  lines.push('')
  lines.push('## Reference pack status')
  lines.push('')
  lines.push('The 17 v1 reference workbooks are **PENDING** - not yet dropped by the operator into')
  lines.push('`samples/corpus-2026-07/`. The operator holds the file list; no v1 pack manifest survives')
  lines.push('in-repo post-cleanse. Rows below cover what is present today.')
  lines.push('')
  lines.push('## Hagerty-track decisions (fixtures 18-22, operator-approved 2026-07-16)')
  lines.push('')
  lines.push('| candidate | decision | rationale |')
  lines.push('|---|---|---|')
  lines.push('| CO_EnthusiastPlus_Config_Template_Final.xlsx | ACCEPTED | trailing-space sheet name, phantom used-range, ghost sheets |')
  lines.push('| OH_EnthusiastPlus_BRD.xlsx | ACCEPTED | document-shaped workbook: 799 merges, 42-col matrices, prose+config |')
  lines.push('| CO_RV125_Rating_Config_Template.xlsm | ACCEPTED | only macro fixture; hidden sheets, copy-suffix near-duplicates, dense rate tables |')
  lines.push('| PA_PROD_001_TableConfig.xlsx | ACCEPTED | 31-char truncated sheet names, numbered near-duplicates, TOC-driven multi-table |')
  lines.push('| PA_PROD_001_CoverageConfig.xlsx | REJECTED | round-trip value only, no hostile traits; near-copy already in docs/export-templates |')
  lines.push('')
  lines.push('NOTE for the operator: accepted files now live in the repo under `samples/corpus-2026-07/hagerty/`;')
  lines.push('remove them from project knowledge to keep knowledge lean (raw workbooks belong in the repo).')
  lines.push('')
  lines.push('## Census')
  lines.push('')
  lines.push('Legend: dims are `reported rows x cols -> scanned-real rows x cols` per sheet (worst offender shown);')
  lines.push('`hidden` counts hidden + veryHidden sheets. `expected (v1)` comes from `expected-traits.json`')
  lines.push('(the accepted-rationale traits recorded at fixture-approval time). DRIFT = live census contradicts')
  lines.push('the expectation; both values are kept.')
  lines.push('')
  lines.push('| file | size | sheets | dims (worst phantom) | hidden | merges | defined names | macros | hostile traits (live) | expected (v1) | VERIFIED-LIVE |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of records) {
    if (r.status !== 'OK') {
      lines.push(`| ${r.file} | - | - | - | - | - | - | - | ${r.status}: ${r.note || ''} | ${(expected[r.file] || []).join(', ') || '-'} | ${r.status} |`)
      continue
    }
    const hidden = r.sheets.filter(s => s.state !== 'visible').length
    const merges = r.sheets.reduce((a, s) => a + s.merges, 0)
    let worst = null
    for (const s of r.sheets) {
      const gap = (s.repR * s.repC) - (s.realR * s.realC)
      if (s.cells > 0 && (!worst || gap > worst.gap)) worst = { s, gap }
    }
    const dims = worst
      ? `${worst.s.name.trim()}: ${worst.s.repR}x${worst.s.repC} -> ${worst.s.realR}x${worst.s.realC}`
      : '-'
    const exp = expected[r.file] || null
    let verdict = 'LIVE-ONLY (no v1 expectation)'
    let expShown = '-'
    if (exp) {
      expShown = exp.join(', ')
      const missing = exp.filter(e => !r.traits.includes(e))
      verdict = missing.length === 0
        ? 'CONFIRMED'
        : `DRIFT (v1 expected [${missing.join(', ')}] not observed live)`
    }
    lines.push(`| ${r.file} | ${r.sizeKB}KB | ${r.sheets.length} | ${dims} | ${hidden} | ${merges} | ${r.definedNames} | ${r.hasMacros ? 'yes' : 'no'} | ${r.traits.join(', ') || 'none'} | ${expShown} | ${verdict} |`)
  }
  lines.push('')
  lines.push('## Per-file wall time and memory')
  lines.push('')
  lines.push('| file | status | wall (ms) | child peak RSS (MB) |')
  lines.push('|---|---|---|---|')
  for (const r of records) {
    lines.push(`| ${r.file} | ${r.status} | ${r.wallMs} | ${r.peakRssMB ?? '-'} |`)
  }
  lines.push('')
  return lines.join('\n')
}

// ---------- main ----------

async function main() {
  const oneIdx = process.argv.indexOf('--one')
  if (oneIdx !== -1) {
    const rec = await censusOne(process.argv[oneIdx + 1])
    process.stdout.write(JSON.stringify(rec))
    return
  }

  const files = listWorkbooks(CORPUS_DIR)
  if (files.length === 0) {
    console.error('No workbooks found under ' + CORPUS_DIR)
    process.exit(1)
  }
  const records = files.map((f) => {
    const r = runChild(f)
    console.error(`${r.status.padEnd(8)} ${r.file} (${r.wallMs}ms)`)
    return r
  })
  const expected = loadExpected()
  fs.writeFileSync(path.join(CORPUS_DIR, 'census.json'), JSON.stringify(records, null, 2) + '\n')
  // Preserve the hand-pasted judge verdict (and anything else) below the marker on re-runs.
  const MARK = '<!-- judge-verdict-below: hand-pasted, preserved across re-runs -->'
  const mdPath = path.join(CORPUS_DIR, 'FIXTURES.md')
  let tail = MARK + '\n'
  if (fs.existsSync(mdPath)) {
    const prev = fs.readFileSync(mdPath, 'utf8')
    const i = prev.indexOf(MARK)
    if (i !== -1) tail = prev.slice(i)
  }
  fs.writeFileSync(mdPath, emitFixturesMd(records, expected) + '\n' + tail)
  console.error(`Wrote FIXTURES.md + census.json (${records.length} files)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
