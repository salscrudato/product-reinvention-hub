#!/usr/bin/env tsx
/**
 * scripts/import-eval.mts — golden-set evaluation for the import brain.
 *
 * Modes:
 *   pnpm import:eval --write-golden   Regenerate tests/golden/import/*.golden.json from
 *                                     the deterministic mapIsoWorkbook parse (ground truth).
 *   pnpm import:eval                  OFFLINE: re-parse every sample and diff against the
 *                                     goldens (parse-stability gate; no AI, no network).
 *   pnpm import:eval --live           LIVE: POST each format as BASE64 documents to
 *                                     /api/ai/unifiedImport on BASE_URL (exercises the
 *                                     stage-0 router + 6-stage brain end-to-end), then
 *                                     score the returned bundle against the golden set:
 *                                       field-level precision / recall / F1   (target >= 0.95)
 *                                       numeric exact-match                    (target >= 0.98)
 *                                       citation coverage                      (target 100%)
 *
 * Env (live mode): BASE_URL, IMPORT_USER, IMPORT_PASS, IMPORT_TENANT (same as import:live).
 * Results: docs/audit/import_eval_results.json
 * Exit: 0 pass, 1 metric below threshold or diff, 2 pre-flight failure.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'
import ExcelJS from 'exceljs'
import { mapIsoWorkbook } from '@pf/shared'
import type { IsoCell, IsoGrid, ImportPlan } from '@pf/shared'

const __dir   = dirname(fileURLToPath(import.meta.url))
const REPO    = resolve(__dir, '..')
const SAMPLES = resolve(REPO, 'samples')
const GOLDEN  = resolve(REPO, 'tests/golden/import')
const AUDIT   = resolve(REPO, 'docs/audit')

const MODE_WRITE   = process.argv.includes('--write-golden')
const MODE_LIVE    = process.argv.includes('--live')
// --rescore: score the last dumped extraction (docs/audit/import_eval_extracted-<ID>.json)
// against the golden set WITHOUT a live run — seconds instead of a full brain pass.
// Use it to iterate on scoring/canonicalization; confirm with --live when done.
const MODE_RESCORE = process.argv.includes('--rescore')
// IMPORT_EVAL_ONLY=GL,IM limits the run to specific format ids (CI slicing).
const EVAL_TIMEOUT_MS = Number(process.env.IMPORT_EVAL_TIMEOUT_MS) || 2_700_000
const ONLY = (process.env.IMPORT_EVAL_ONLY || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

const F1_TARGET       = 0.95
const NUMERIC_TARGET  = 0.98
const CITATION_TARGET = 1.0

// ─── Formats under evaluation ─────────────────────────────────────────────────

const FORMATS: { id: string; files: string[]; lobHint?: string }[] = [
  { id: 'GL', lobHint: 'GL.LOB.001', files: [
    'iso/sample-GL-framework.xlsx', 'iso/sample-GL-forms.xlsx',
    'iso/sample-GL-rules.xlsx', 'iso/sample-GL-pricing.xlsx',
  ] },
  { id: 'IM', lobHint: 'IM.LOB.001', files: ['iso/sample-IM-framework.xlsx', 'iso/sample-IM-rules.xlsx'] },
  { id: 'PR', lobHint: 'PR.LOB.001', files: ['iso/sample-PR-framework.xlsx', 'iso/sample-PR-rating.xlsx'] },
  { id: 'CORE', files: ['iso/Product_Specifications_Core_07_13_2026.xlsx'] },
]

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg: string) { process.stdout.write(`${msg}\n`) }
function section(t: string) { log(`\n── ${t} ──`) }

// ─── Deterministic local parse (identical to import-live.mts) ─────────────────

function flatten(v: ExcelJS.CellValue): IsoCell {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if (Array.isArray(o['richText']))
      return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
    if ('result' in o) { const r = o['result']; return typeof r === 'object' ? null : (r as IsoCell) }
    if ('hyperlink' in o) return String(o['text'] ?? o['hyperlink'] ?? '')
    if ('text' in o) return String(o['text'])
  }
  return null
}

async function readWorkbookNode(filePath: string): Promise<IsoGrid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const grids: IsoGrid[] = []
  const ROW_CAP = 100_000
  wb.eachSheet(ws => {
    const cells: IsoCell[][] = []
    const limit = Math.min(ws.rowCount, ROW_CAP)
    for (let r = 1; r <= limit; r++) {
      const rowObj = ws.getRow(r)
      const arr: IsoCell[] = []
      for (let c = 1; c <= ws.columnCount; c++) arr[c - 1] = flatten(rowObj.getCell(c).value)
      cells[r - 1] = arr
    }
    grids.push({ sheet: ws.name, file: filePath, cells })
  })
  return grids
}

async function parseXlsx(files: string[]): Promise<ImportPlan> {
  const grids = (await Promise.all(files.map(f => readWorkbookNode(f)))).flat()
  return mapIsoWorkbook(grids)
}

// ─── Golden extraction: plan → comparable entity tuples ───────────────────────
// Scalars only (string/number/boolean) plus formNumbers; system noise dropped.

const SKIP_FIELDS = new Set(['confidence', 'citation', 'owner', 'lineage', 'lob'])

interface GoldenEntity { kind: string; refId: string; fields: Record<string, unknown> }
interface GoldenSet { format: string; generatedFrom: string[]; entities: GoldenEntity[] }

function scalarFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (SKIP_FIELDS.has(k)) continue
    if (v === null || v === undefined) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (k === 'formNumbers' && Array.isArray(v)) out[k] = [...v].sort()
  }
  return out
}

function planToGolden(plan: ImportPlan, format: string, files: string[]): GoldenSet {
  const entities: GoldenEntity[] = []
  const push = (kind: string, list: { refId: string | null; data: Record<string, unknown> }[]) => {
    for (const p of list) {
      if (!p.refId) continue
      entities.push({ kind, refId: p.refId, fields: scalarFields(p.data) })
    }
  }
  push('product', plan.products as never[])
  push('coverage', plan.coverages as never[])
  push('form', plan.forms as never[])
  push('rule', plan.rules as never[])
  push('formRule', plan.formRules as never[])
  push('ldTable', plan.ldTables as never[])
  push('rtTable', plan.rtTables as never[])
  return { format, generatedFrom: files.map(f => basename(f)), entities }
}

// ─── Value comparison (numeric-canonicalized) ─────────────────────────────────

function canon(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return JSON.stringify([...v].map(String).sort())
  const s = String(v).trim()
  if (s === '') return null
  const numericish = s.replace(/[$,\s]/g, '')
  if (/^-?\d+(\.\d+)?$/.test(numericish)) return String(Number(numericish))
  return s.toLowerCase()
}

function isNumeric(v: unknown): boolean {
  if (typeof v === 'number') return true
  const s = String(v ?? '').replace(/[$,\s]/g, '')
  return s !== '' && /^-?\d+(\.\d+)?$/.test(s)
}

// ─── Scoring: golden vs extracted entity set ──────────────────────────────────

interface Metrics {
  goldenFields: number; extractedFields: number
  tp: number; fp: number; fn: number
  precision: number; recall: number; f1: number
  numericTotal: number; numericExact: number; numericExactRate: number
  entityRecall: number
  diagnostics: {
    entityByKind: Record<string, { golden: number; found: number }>
    missByField: Record<string, number>
    sampleMisses: Array<{ kind: string; refId: string; field: string; golden: unknown; extracted: unknown }>
    extractedKinds: Record<string, number>
  }
}

function score(golden: GoldenEntity[], extracted: GoldenEntity[]): Metrics {
  const exByKey = new Map<string, GoldenEntity>()
  for (const e of extracted) exByKey.set(`${e.kind}|${e.refId}`, e)

  let tp = 0, fn = 0, goldenFields = 0, numericTotal = 0, numericExact = 0
  let entitiesFound = 0
  const matchedFieldKeys = new Set<string>()
  const entityByKind: Record<string, { golden: number; found: number }> = {}
  const missByField: Record<string, number> = {}
  const sampleMisses: Metrics['diagnostics']['sampleMisses'] = []
  const extractedKinds: Record<string, number> = {}
  for (const e of extracted) extractedKinds[e.kind] = (extractedKinds[e.kind] ?? 0) + 1

  for (const g of golden) {
    const ex = exByKey.get(`${g.kind}|${g.refId}`)
    entityByKind[g.kind] ??= { golden: 0, found: 0 }
    entityByKind[g.kind]!.golden++
    if (ex) { entitiesFound++; entityByKind[g.kind]!.found++ }
    for (const [field, gv] of Object.entries(g.fields)) {
      goldenFields++
      const numeric = isNumeric(gv)
      if (numeric) numericTotal++
      const ev = ex?.fields?.[field]
      if (ev !== undefined && canon(ev) === canon(gv)) {
        tp++
        matchedFieldKeys.add(`${g.kind}|${g.refId}|${field}`)
        if (numeric) numericExact++
      } else {
        fn++
        missByField[field] = (missByField[field] ?? 0) + 1
        if (ex && sampleMisses.length < 25) sampleMisses.push({ kind: g.kind, refId: g.refId, field, golden: gv, extracted: ev })
      }
    }
  }

  // FP: extracted field values that exist in the golden schema but hold WRONG values
  // (fields golden doesn't track are ignored — the brain legitimately extracts more).
  let extractedFields = 0, fp = 0
  const gByKey = new Map<string, GoldenEntity>()
  for (const g of golden) gByKey.set(`${g.kind}|${g.refId}`, g)
  for (const e of extracted) {
    const g = gByKey.get(`${e.kind}|${e.refId}`)
    for (const [field, ev] of Object.entries(e.fields)) {
      extractedFields++
      if (!g || !(field in g.fields)) continue
      if (!matchedFieldKeys.has(`${e.kind}|${e.refId}|${field}`) && canon(ev) !== canon(g.fields[field])) fp++
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1
  const recall    = tp + fn > 0 ? tp / (tp + fn) : 1
  const f1        = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  return {
    goldenFields, extractedFields, tp, fp, fn,
    precision, recall, f1,
    numericTotal, numericExact,
    numericExactRate: numericTotal > 0 ? numericExact / numericTotal : 1,
    entityRecall: golden.length > 0 ? entitiesFound / golden.length : 1,
    diagnostics: {
      entityByKind,
      missByField: Object.fromEntries(Object.entries(missByField).sort((a, b) => b[1] - a[1]).slice(0, 20)),
      sampleMisses,
      extractedKinds,
    },
  }
}

// ─── Live mode: SSE against the dev server ────────────────────────────────────

const BASE_URL      = (process.env.BASE_URL || 'https://app-prodhub-dev.azurewebsites.net').replace(/\/$/, '')
const IMPORT_USER   = process.env.IMPORT_USER   || 'admin'
const IMPORT_PASS   = process.env.IMPORT_PASS   || 'admin'
const IMPORT_TENANT = process.env.IMPORT_TENANT || 'import-eval'

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/bootstrap`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: IMPORT_USER, password: IMPORT_PASS, tenant: IMPORT_TENANT }),
  })
  const body = await res.json().catch(() => null) as { token?: string } | null
  if (!res.ok || !body?.token) throw new Error(`bootstrap login failed: HTTP ${res.status}`)
  return body.token
}

interface LiveResult { bundle: unknown; errors: string[]; spend: unknown; notices: string[] }

// Dev is a shared, continuously-deployed environment: a deploy restarts the app and
// severs in-flight SSE ("fetch: terminated"). Retry the whole import a few times,
// pausing so the restarted app warms up.
async function postImport(token: string, files: string[], lobHint?: string, timeoutMs = EVAL_TIMEOUT_MS): Promise<LiveResult> {
  let last: LiveResult = { bundle: null, errors: ['not attempted'], spend: null, notices: [] }
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await postImportOnce(token, files, lobHint, timeoutMs)
    if (last.bundle || last.errors.length === 0) return last
    const transient = last.errors.some(e => /terminated|fetch failed|ECONNRESET|socket|other side closed/i.test(e))
    if (!transient) return last
    log(`    transient stream failure (attempt ${attempt}/3): ${last.errors[0]} — retrying in 45s`)
    await new Promise(r => setTimeout(r, 45_000))
  }
  return last
}

async function postImportOnce(token: string, files: string[], lobHint?: string, timeoutMs = 2_700_000): Promise<LiveResult> {
  const documents = files.map(f => ({
    name: basename(f),
    base64: readFileSync(f).toString('base64'),
    mediaType: f.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // Stall watchdog: the server emits an SSE heartbeat (`:hb`) every 15s
  // (server/lib/ai/unified-import.js). A dev deploy can sever the connection
  // without a FIN reaching us, leaving read() hung on a half-open socket until
  // the big timeout — and that abort message doesn't match the transient-retry
  // regex. Abort after 90s of total silence with a message that does.
  let lastByteAt = Date.now()
  const stallTimer = setInterval(() => {
    if (Date.now() - lastByteAt > 90_000) controller.abort(new Error('socket stalled (no SSE heartbeat for 90s)'))
  }, 15_000)
  const out: LiveResult = { bundle: null, errors: [], spend: null, notices: [] }
  const t0 = Date.now()
  const elapsed = () => `${Math.round((Date.now() - t0) / 1000)}s`
  try {
    const res = await fetch(`${BASE_URL}/api/ai/unifiedImport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ documents, lobRefIdHint: lobHint }),
      signal: controller.signal,
    })
    if (!res.ok) { out.errors.push(`HTTP ${res.status}`); return out }
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      lastByteAt = Date.now()
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6)) as {
            t: string; key?: string; value?: unknown; message?: string
            name?: string; phase?: string; summary?: string; level?: string; kind?: string
          }
          if (evt.t === 'json' && evt.key === 'bundle') out.bundle = evt.value
          if (evt.t === 'json' && (evt.key === 'brain:spend' || evt.key === 'import:spend')) out.spend = evt.value
          if (evt.t === 'error') out.errors.push(evt.message ?? 'unknown')
          // Server stage progress + notices: without these a 90-minute brain run is
          // 90 minutes of silence, and diagnostics like "Deterministic ISO mapper
          // skipped: <reason>" are lost. Notices also land in the results JSON.
          if (evt.t === 'tool' && evt.phase !== 'end') log(`    [${elapsed()}] ${evt.name}${evt.summary ? ` — ${evt.summary}` : ''}`)
          if (evt.t === 'notice') {
            const msg = `[${evt.level ?? 'info'}/${evt.kind ?? '-'}] ${evt.message ?? ''}`
            out.notices.push(msg)
            log(`    [${elapsed()}] NOTICE ${msg}`)
          }
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    out.errors.push(`fetch: ${(e as Error).message}`)
  } finally { clearTimeout(timer); clearInterval(stallTimer) }
  return out
}

// Bundle plan → comparable entity tuples (same shape as golden).
function bundleToEntities(bundle: unknown): GoldenEntity[] {
  const b = bundle as { plan?: Record<string, unknown> } | null
  const plan = b?.plan as Record<string, unknown> | undefined
  if (!plan) return []
  const out: GoldenEntity[] = []
  const pull = (kind: string, listKey: string) => {
    const list = plan[listKey]
    if (!Array.isArray(list)) return
    for (const p of list as { refId?: string | null; data?: Record<string, unknown> }[]) {
      if (!p?.refId) continue
      out.push({ kind, refId: p.refId, fields: scalarFields(p.data ?? {}) })
    }
  }
  pull('product', 'products')
  pull('coverage', 'coverages')
  pull('form', 'forms')
  pull('rule', 'rules')
  pull('formRule', 'formRules')
  pull('ldTable', 'ldTables')
  pull('rtTable', 'rtTables')
  return out
}

// Citation coverage from the bundle: provenance rows with a real locus, and plan
// entities carrying a citation string.
function citationCoverage(bundle: unknown): { provenanceCoverage: number; entityCoverage: number; provenanceRows: number } {
  const b = bundle as { provenance?: { sheet?: string; cell?: string; verbatim?: string }[]; plan?: Record<string, unknown> } | null
  const prov = Array.isArray(b?.provenance) ? b!.provenance! : []
  const withLocus = prov.filter(p => (p.sheet && p.cell) || (p.verbatim && p.verbatim.length > 0)).length
  let entities = 0, cited = 0
  const plan = b?.plan as Record<string, unknown> | undefined
  for (const key of ['products', 'coverages', 'forms', 'rules', 'formRules', 'ldTables', 'rtTables']) {
    const list = plan?.[key]
    if (!Array.isArray(list)) continue
    for (const p of list as { data?: { citation?: string } }[]) {
      entities++
      if (p?.data?.citation) cited++
    }
  }
  return {
    provenanceCoverage: prov.length > 0 ? withLocus / prov.length : 0,
    entityCoverage: entities > 0 ? cited / entities : 0,
    provenanceRows: prov.length,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!existsSync(GOLDEN)) mkdirSync(GOLDEN, { recursive: true })
if (!existsSync(AUDIT)) mkdirSync(AUDIT, { recursive: true })

const results: Record<string, unknown>[] = []
let anyFail = false

if (MODE_WRITE) {
  section('Writing golden set from deterministic parse')
  for (const fmt of FORMATS) {
    const files = fmt.files.map(f => join(SAMPLES, f)).filter(f => existsSync(f))
    if (files.length !== fmt.files.length) { log(`  ⚠ ${fmt.id}: missing sample file(s), skipped`); continue }
    const plan = await parseXlsx(files)
    const golden = planToGolden(plan, fmt.id, files)
    writeFileSync(join(GOLDEN, `${fmt.id}.golden.json`), JSON.stringify(golden, null, 2))
    log(`  ✓ ${fmt.id}: ${golden.entities.length} golden entities → tests/golden/import/${fmt.id}.golden.json`)
  }
  process.exit(0)
}

const ACTIVE_FORMATS = ONLY.length ? FORMATS.filter(f => ONLY.includes(f.id)) : FORMATS

if (MODE_RESCORE) {
  section('RESCORE: last dumped live extraction vs golden (no network, no AI)')
  for (const fmt of ACTIVE_FORMATS) {
    const goldenPath = join(GOLDEN, `${fmt.id}.golden.json`)
    const dumpPath   = join(AUDIT, `import_eval_extracted-${fmt.id}.json`)
    if (!existsSync(goldenPath)) { log(`  ⚠ ${fmt.id}: no golden — skipped`); continue }
    if (!existsSync(dumpPath))   { log(`  ⚠ ${fmt.id}: no extraction dump (run --live once) — skipped`); continue }
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenSet
    const dump   = JSON.parse(readFileSync(dumpPath, 'utf8')) as { entities: GoldenEntity[] }
    const m = score(golden.entities, dump.entities)
    const pass = m.f1 >= F1_TARGET && m.numericExactRate >= NUMERIC_TARGET
    if (!pass) anyFail = true
    results.push({ id: fmt.id, mode: 'rescore', ...m, pass })
    log(`  ${pass ? '✓' : '✗'} ${fmt.id}: F1 ${m.f1.toFixed(3)} (P ${m.precision.toFixed(3)} R ${m.recall.toFixed(3)}) | numeric ${m.numericExactRate.toFixed(3)} | entityRecall ${m.entityRecall.toFixed(3)} (citations not re-checked)`)
  }
} else if (!MODE_LIVE) {
  section('OFFLINE: parse-stability diff vs golden')
  for (const fmt of ACTIVE_FORMATS) {
    const goldenPath = join(GOLDEN, `${fmt.id}.golden.json`)
    if (!existsSync(goldenPath)) { log(`  ⚠ ${fmt.id}: no golden (run --write-golden)`); continue }
    const files = fmt.files.map(f => join(SAMPLES, f)).filter(f => existsSync(f))
    if (files.length !== fmt.files.length) { log(`  ⚠ ${fmt.id}: missing sample file(s), skipped`); continue }
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenSet
    const plan = await parseXlsx(files)
    const current = planToGolden(plan, fmt.id, files)
    const m = score(golden.entities, current.entities)
    const pass = m.f1 >= 0.999 && m.numericExactRate >= 0.999
    if (!pass) anyFail = true
    results.push({ id: fmt.id, mode: 'offline', ...m, pass })
    log(`  ${pass ? '✓' : '✗'} ${fmt.id}: F1 ${m.f1.toFixed(4)} | numeric ${m.numericExactRate.toFixed(4)} | ${m.goldenFields} golden fields`)
  }
} else {
  section(`LIVE: ${BASE_URL}`)
  let token: string
  try { token = await login(); log(`  ✓ authenticated (tenant=${IMPORT_TENANT})`) }
  catch (e) { log(`  ✗ ${(e as Error).message}`); process.exit(2) }

  for (const fmt of ACTIVE_FORMATS) {
    const goldenPath = join(GOLDEN, `${fmt.id}.golden.json`)
    if (!existsSync(goldenPath)) { log(`  ⚠ ${fmt.id}: no golden — skipped`); continue }
    const files = fmt.files.map(f => join(SAMPLES, f)).filter(f => existsSync(f))
    if (files.length !== fmt.files.length) { log(`  ⚠ ${fmt.id}: missing sample file(s), skipped`); continue }
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenSet
    const t0 = Date.now()
    const live = await postImport(token, files, fmt.lobHint)
    const durationMs = Date.now() - t0
    if (live.errors.length > 0 || !live.bundle) {
      anyFail = true
      results.push({ id: fmt.id, mode: 'live', pass: false, errors: live.errors, durationMs })
      log(`  ✗ ${fmt.id}: ${live.errors.join('; ') || 'no bundle returned'}`)
      continue
    }
    const extracted = bundleToEntities(live.bundle)
    // Always dump: a live extraction costs real money and ~an hour — the dump makes
    // it replayable through --rescore instead of disposable.
    writeFileSync(join(AUDIT, `import_eval_extracted-${fmt.id}.json`), JSON.stringify({ entities: extracted, citations: citationCoverage(live.bundle) }, null, 2))
    const m = score(golden.entities, extracted)
    const cit = citationCoverage(live.bundle)
    const pass = m.f1 >= F1_TARGET && m.numericExactRate >= NUMERIC_TARGET && cit.entityCoverage >= CITATION_TARGET
    if (!pass) anyFail = true
    results.push({ id: fmt.id, mode: 'live', ...m, ...cit, spend: live.spend, durationMs, notices: live.notices, pass })
    log(`  ${pass ? '✓' : '✗'} ${fmt.id}: F1 ${m.f1.toFixed(3)} (P ${m.precision.toFixed(3)} R ${m.recall.toFixed(3)}) | numeric ${m.numericExactRate.toFixed(3)} | citations entity=${(cit.entityCoverage * 100).toFixed(0)}% prov=${(cit.provenanceCoverage * 100).toFixed(0)}% (${cit.provenanceRows} rows) | entityRecall ${m.entityRecall.toFixed(3)} | ${Math.round(durationMs / 1000)}s`)
  }
}

const evalSlice = ONLY.length ? '-' + ONLY.join('-') : ''
writeFileSync(join(AUDIT, `import_eval_results${evalSlice}.json`), JSON.stringify({
  runAt: new Date().toISOString(),
  mode: MODE_RESCORE ? 'rescore' : MODE_LIVE ? 'live' : 'offline',
  baseUrl: MODE_LIVE ? BASE_URL : null,
  targets: { f1: F1_TARGET, numericExact: NUMERIC_TARGET, citation: CITATION_TARGET },
  results,
}, null, 2))
log(`\nResults → docs/audit/import_eval_results${evalSlice}.json`)
process.exit(anyFail ? 1 : 0)
