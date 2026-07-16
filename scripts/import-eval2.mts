#!/usr/bin/env tsx
/**
 * scripts/import-eval2.mts — EVAL v2 harness (CE2).
 *
 * Where eval1 scores plan STABILITY against template-shaped goldens (same parser both sides),
 * eval2 scores plan against CELL-LEVEL TRUTH (dual-family golden2) plus deterministic
 * counting-invariant floors, so a green board cannot hide DATA LOSS. Metric functions are PURE
 * and locked in scripts/lib/import-eval2-metrics.mts (tests/eval/import-eval2-metrics.test.ts);
 * this file is only the wiring: read goldens2 + a plan bundle + (optional) a CE1 census, compute
 * the gated metrics, print the board, exit non-zero on any blocking red.
 *
 * The FIRST run against the CURRENT pipeline is EXPECTED RED — that is the deliverable
 * (docs/import-census/BASELINE_EVAL2.md). Reds are CE3's work order.
 *
 * Modes:
 *   --offline (default)   deterministic mapIsoWorkbook on each golden's source workbook
 *   --bundle <path>       score a dumped brain bundle (== eval1 --rescore); uses provenance if present
 *   --live                POST each source to /api/ai/unifiedImport (SSE) and score the bundle
 *   --recover <runId>     fetch a durable run result and score it (no new import)
 *   --mutations           ALSO score samples/goldens2/mutations/*.golden2.json (fuzz check)
 *   --only <name,...>     restrict to named goldens
 *   --census <path>       reconcile CE1 census nonEmpty vs cell-enum nonEmpty (hostile Q4)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { resolve, dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { mapIsoWorkbook } from '@pf/shared'
import { readWorkbookCells, sheetDigest, type EnumWorkbook, type EnumSheet } from './lib/cell-enum.mts'
import { recoverRunResult } from './lib/run-recovery.mts'
import {
  canonicalizeNumeric, isSubstance, refToRC, rcToRef,
  mutReorderSheets, mutSynonymHeaders, mutInjectBlankRows, mutHideSheet, mutDashRefIds,
  type Golden2File, type MutationName,
} from './lib/golden2-schema.mts'
import {
  accountingMetrics, goldenEntityRecall, goldenNumericFidelity, resolveCitations,
  fabricationMetrics, linkage2, countingInvariants, needsReviewBand, reconcileCensus,
  hierarchyRecall, isSourceShapedRefId,
  type EvalEntity2, type KindFloor, type NumericClaim, type CitationClaim, type Golden2ParentEdge,
} from './lib/import-eval2-metrics.mts'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dir, '..')
const GOLDENS = resolve(REPO, 'samples/goldens2')
const AUDIT = resolve(REPO, 'docs/audit')
const CORPUS_BASES = [resolve(REPO, 'samples/corpus-2026-07'), resolve(REPO, '../../../samples/corpus-2026-07'), resolve(REPO, '../../../../samples/corpus-2026-07')]

// ─── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (f: string) => argv.includes(f)
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const MODE_BUNDLE = opt('--bundle')
const MODE_LIVE = flag('--live')
const MODE_RECOVER = opt('--recover')
const WITH_MUTATIONS = flag('--mutations')
const ONLY = (opt('--only') || '').split(',').map(s => s.trim()).filter(Boolean)
const CENSUS = opt('--census')
const MODE = MODE_LIVE ? 'live' : MODE_RECOVER ? 'recover' : MODE_BUNDLE ? 'bundle' : 'offline'

// ─── thresholds (per the CE2 prompt) ───────────────────────────────────────────
const T = {
  unaccountedEntityCells: 0,        // ==
  substanceCoverage: 0.985,         // >=
  goldenEntityRecall: 0.98,         // >= (full-coverage files)
  goldenNumericFidelity: 1.0,       // ==
  citationResolve: 1.0,             // == (live)
  fabricationLive: 0.02,            // <=
  fabricationOffline: 0.0,          // <=
  parentResolutionRate: 1.0,        // ==
  ldTableRefResolutionRate: 0.95,   // >=
  needsReview: 0.10,                // band
}

// ─── source resolution ─────────────────────────────────────────────────────────
function findSource(file: string): string | null {
  for (const base of CORPUS_BASES) for (const sub of ['reference', 'hagerty']) { const p = join(base, sub, file); if (existsSync(p)) return p }
  const mut = join(GOLDENS, 'mutations', file); if (existsSync(mut)) return mut
  return null
}

// ─── plan -> comparable entities (mirrors eval1 planToGolden kinds) ────────────
const SKIP = new Set(['confidence', 'citation', 'owner', 'lineage', 'lob'])
function scalarFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data ?? {})) {
    if (SKIP.has(k)) continue
    if (v == null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = v
  }
  return out
}
type PlanLike = Record<string, { refId?: string | null; data?: Record<string, unknown> }[]> & Record<string, unknown>
function planToEntities(plan: PlanLike): EvalEntity2[] {
  const out: EvalEntity2[] = []
  const pull = (kind: string, key: string) => {
    const list = plan[key]
    if (!Array.isArray(list)) return
    for (const p of list) { if (!p?.refId) continue; out.push({ kind, refId: p.refId, fields: scalarFields(p.data ?? {}) }) }
  }
  pull('product', 'products'); pull('coverage', 'coverages'); pull('form', 'forms')
  pull('rule', 'rules'); pull('formRule', 'formRules'); pull('ldTable', 'ldTables')
  pull('rtTable', 'rtTables'); pull('ratePlaceholder', 'ratePlaceholders')
  return out
}

// Dense grids for mapIsoWorkbook from the sparse enumeration.
function densify(wb: EnumWorkbook): { sheet: string; file: string; cells: (string | number | boolean | null)[][] }[] {
  return wb.sheets.map(s => {
    const rows: (string | number | boolean | null)[][] = []
    for (let r = 0; r <= s.maxRow; r++) rows[r] = new Array(s.maxCol + 1).fill(null)
    for (const c of s.cells) rows[c.row]![c.col] = c.value
    return { sheet: s.name, file: wb.file, cells: rows }
  })
}

// Index a workbook's flattened cell values by "sheet!REF".
function valueIndex(wb: EnumWorkbook): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of wb.sheets) for (const c of s.cells) m.set(`${s.name}!${c.ref}`, String(c.value ?? ''))
  return m
}

// ─── live/recover: fetch a bundle from the server ──────────────────────────────
const BASE_URL = (process.env.BASE_URL || 'https://app-prodhub-dev.azurewebsites.net').replace(/\/$/, '')
async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/bootstrap`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.IMPORT_USER || 'admin', password: process.env.IMPORT_PASS || 'admin', tenant: process.env.IMPORT_TENANT || 'eval2' }),
  })
  const b = await res.json().catch(() => null) as { token?: string } | null
  if (!res.ok || !b?.token) throw new Error(`bootstrap failed HTTP ${res.status}`)
  return b.token
}
async function liveBundle(token: string, filePath: string): Promise<{ bundle: unknown; provenance: { sheet?: string; cell?: string; verbatim?: string }[] }> {
  const documents = [{ name: basename(filePath), base64: readFileSync(filePath).toString('base64'), mediaType: filePath.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }]
  const res = await fetch(`${BASE_URL}/api/ai/unifiedImport`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ documents }), signal: AbortSignal.timeout(Number(process.env.EVAL2_TIMEOUT_MS) || 9_000_000),
  })
  if (!res.ok) throw new Error(`unifiedImport HTTP ${res.status}`)
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''; let bundle: unknown = null
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() ?? ''
    for (const line of lines) { if (!line.startsWith('data: ')) continue; try { const e = JSON.parse(line.slice(6)) as { t: string; key?: string; value?: unknown }; if (e.t === 'json' && e.key === 'bundle') bundle = e.value } catch { /* */ } } }
  const b = bundle as { provenance?: { sheet?: string; cell?: string; verbatim?: string }[] } | null
  return { bundle, provenance: Array.isArray(b?.provenance) ? b!.provenance! : [] }
}
function bundlePlan(bundle: unknown): { plan: PlanLike; provenance: { sheet?: string; cell?: string; verbatim?: string }[] } {
  const b = bundle as { plan?: PlanLike; provenance?: { sheet?: string; cell?: string; verbatim?: string }[] } | null
  return { plan: (b?.plan ?? {}) as PlanLike, provenance: Array.isArray(b?.provenance) ? b!.provenance! : [] }
}

// ─── per-golden scoring ─────────────────────────────────────────────────────────
interface Row { id: string; coverage: string; pass: boolean; reds: string[]; metrics: Record<string, unknown> }

function buildFloors(g: Golden2File): KindFloor[] {
  const byKind = g.distinctRefIdsByKind ?? {}
  const floors: KindFloor[] = []
  // Golden annotated counts (lower bound: we SAW at least this many).
  if (g.counts.products) floors.push({ kind: 'product', floor: g.counts.products, source: 'golden.products' })
  if (g.counts.coverages) floors.push({ kind: 'coverage', floor: g.counts.coverages, source: 'golden.coverages' })
  if (g.counts.forms) floors.push({ kind: 'form', floor: g.counts.forms, source: 'golden.forms' })
  // Deterministic distinct-token floors (do not need model annotation).
  if (g.counts.distinctFormTokens) floors.push({ kind: 'form', floor: g.counts.distinctFormTokens, source: 'distinctFormTokens' })
  for (const [k, n] of Object.entries(byKind)) if (n > 0 && k !== 'other') floors.push({ kind: k, floor: n, source: `distinctRefIds.${k}` })
  // FILE-LEVEL total floor (hostile review #4): the distinct source-shaped refIds a plan
  // extracts (junk / SYNTH excluded — see scoreGolden's __TOTAL__ count) must meet the raw
  // distinct-refId cardinality of the workbook, REGARDLESS of kind. Closes "drop real
  // entities, pad the count with mislabelled fillers, stay green".
  if (g.counts.distinctRefIds) floors.push({ kind: '__TOTAL__', floor: g.counts.distinctRefIds, source: 'counts.distinctRefIds (file-level)' })
  // Collapse to the MAX floor per kind.
  const max = new Map<string, KindFloor>()
  for (const f of floors) { const cur = max.get(f.kind); if (!cur || f.floor > cur.floor) max.set(f.kind, f) }
  return [...max.values()]
}

function scoreGolden(g: Golden2File, extracted: EvalEntity2[], accounted: Set<string>, wb: EnumWorkbook, provenance: { sheet?: string; cell?: string; verbatim?: string }[], census: CensusFile | null): Row {
  const reds: string[] = []
  const vidx = valueIndex(wb)

  // Accounting.
  const acc = accountingMetrics(g, accounted)
  if (acc.unaccountedEntityCells > T.unaccountedEntityCells) reds.push(`unaccountedEntityCells=${acc.unaccountedEntityCells}`)
  if (acc.substanceCoverage < T.substanceCoverage) reds.push(`substanceCoverage=${acc.substanceCoverage.toFixed(3)}<${T.substanceCoverage}`)

  // Entity recall — only gated on FULL-coverage files (sampled goldens are not exhaustive).
  const recall = goldenEntityRecall(g, extracted)
  if (g.coverage !== 'sampled' && recall.golden > 0 && recall.recall < T.goldenEntityRecall) reds.push(`entityRecall=${recall.recall.toFixed(3)}<${T.goldenEntityRecall}`)

  // Numeric fidelity — claims from ATTR cells that carry a numeric source value + an ofEntity.
  const claims = buildNumericClaims(g, vidx)
  const numeric = goldenNumericFidelity(claims, extracted)
  if (numeric.checked > 0 && numeric.fidelity < T.goldenNumericFidelity) reds.push(`numericFidelity=${numeric.fidelity.toFixed(3)}<1.0`)

  // Citation resolve — live/bundle provenance only.
  let citRate: number | null = null
  if (provenance.length > 0) {
    const claimsC: CitationClaim[] = provenance.filter(p => p.sheet && p.cell).map(p => ({ citation: `${p.sheet}!${p.cell}`, verbatim: String(p.verbatim ?? '') }))
    const cr = resolveCitations(claimsC, (sheet, ref) => vidx.get(`${sheet}!${ref}`) ?? null)
    citRate = cr.rate
    if (MODE !== 'offline' && cr.rate != null && cr.rate < T.citationResolve) reds.push(`citationResolve=${cr.rate.toFixed(3)}<1.0`)
  }

  // Fabrication — floor-based against the source token set.
  const srcTokens = sourceRefTokens(g)
  const fab = fabricationMetrics(extracted, srcTokens)
  const fabT = MODE === 'offline' ? T.fabricationOffline : T.fabricationLive
  if (fab.rate > fabT) reds.push(`fabrication=${fab.rate.toFixed(3)}>${fabT}`)

  // Linkage.
  const link = linkage2(extracted)
  if (link.parentWithRef > 0 && link.parentResolutionRate < T.parentResolutionRate) reds.push(`parentResolution=${link.parentResolutionRate.toFixed(3)}<1.0`)
  if (link.ldTableRefResolutionRate != null && link.ldTableRefResolutionRate < T.ldTableRefResolutionRate) reds.push(`ldTableRef=${link.ldTableRefResolutionRate.toFixed(3)}<${T.ldTableRefResolutionRate}`)

  // Hierarchy recall — a FLATTENED plan (subs promoted to top-level) must not pass vacuously.
  const goldenParentEdges: Golden2ParentEdge[] = []
  for (const sh of g.sheets) {
    for (const e of sh.entities) if (e.refId && e.parentRef) goldenParentEdges.push({ child: e.refId, parent: e.parentRef })
    for (const ed of sh.edges) if (ed.type === 'BELONGS_TO') goldenParentEdges.push({ child: ed.from, parent: ed.to })
  }
  const hier = hierarchyRecall(goldenParentEdges, extracted)
  if (hier.goldenParentEdges > 0 && hier.recall < T.parentResolutionRate) reds.push(`hierarchyRecall=${hier.recall.toFixed(3)}<1.0 (${hier.goldenParentEdges} golden edges, ${hier.reproduced} reproduced)`)

  // Counting invariants — the bulk-loss floor.
  const countByKind: Record<string, number> = {}
  for (const e of extracted) countByKind[e.kind] = (countByKind[e.kind] ?? 0) + 1
  // coverage floor covers coverage+subCoverage.
  countByKind['coverage'] = (countByKind['coverage'] ?? 0)
  // File-level floor target: distinct source-shaped extracted refIds (junk/SYNTH excluded).
  const isSynth = (id: string) => /(^|\.)SYNTH(?:[^A-Za-z]|$)/i.test(id)
  countByKind['__TOTAL__'] = new Set(extracted.map(e => e.refId).filter((r): r is string => !!r && isSourceShapedRefId(r) && !isSynth(r)).map(r => r.toLowerCase())).size
  const floors = buildFloors(g)
  const counting = countingInvariants(floors, countByKind)
  if (!counting.ok) reds.push(`countingInvariants=${counting.violations.length} (${counting.violations.map(v => `${v.kind}:${v.extracted}<${v.floor}`).join(',')})`)

  // needsReview band (golden annotation quality, reported).
  const nr = needsReviewBand(g.agreement?.windows ? (acc.substanceCells + (g.agreement.queued ?? 0)) : acc.substanceCells, g.agreement?.queued ?? 0, g.coverage !== 'sampled')

  // Census reconcile.
  let censusReconcileReds = 0
  if (census) {
    const enumNonEmpty: Record<string, number> = {}
    for (const s of wb.sheets) enumNonEmpty[s.name] = s.cells.length
    const censusNonEmpty: Record<string, number> = {}
    for (const s of census.sheets) censusNonEmpty[s.name] = s.nonEmpty
    const rc = reconcileCensus(enumNonEmpty, censusNonEmpty)
    censusReconcileReds = rc.disagreements.length
    if (!rc.ok) reds.push(`censusReconcile=${rc.disagreements.length} sheet(s) disagree`)
  }

  // Golden completeness (hostile review #5/A, #F): a FULL golden must disposition-or-queue EVERY
  // non-empty source cell, else correlated omission shrinks the accounting denominator and the
  // board goes green while data is lost. REPORTED as a golden-QUALITY signal (distinct from a
  // pipeline red): goldens annotated before the 'omitted-by-both' harness fix may show < 1.0 — a
  // full re-annotation drives it to 1.0. `warn` when a full golden is under-covered.
  const rawNonEmpty = wb.sheets.reduce((n, s) => n + s.cells.length, 0)
  const dispositioned = g.sheets.reduce((n, s) => n + s.cells.length, 0)
  const goldenCompleteness = rawNonEmpty > 0 ? Math.min(1, (dispositioned + (g.agreement?.queued ?? 0)) / rawNonEmpty) : 1
  const completenessWarn = g.coverage !== 'sampled' && goldenCompleteness < 0.98

  return {
    id: goldenName(g), coverage: g.coverage ?? 'full', pass: reds.length === 0, reds,
    metrics: {
      accounting: acc, entityRecall: recall, numeric: { checked: numeric.checked, fidelity: numeric.fidelity }, citationResolve: citRate,
      fabrication: fab, linkage: link, hierarchy: hier, counting, needsReview: nr, extractedByKind: countByKind, floors, censusReconcileReds,
      goldenCompleteness: { rawNonEmpty, dispositioned, queued: g.agreement?.queued ?? 0, completeness: goldenCompleteness, warn: completenessWarn },
    },
  }
}

interface CensusFile { file: string; sheets: { name: string; nonEmpty: number; accounted?: string[] }[] }
function goldenName(g: Golden2File): string { return basename(g.file).replace(/\.[^.]+$/, '') }

function buildNumericClaims(g: Golden2File, vidx: Map<string, string>): NumericClaim[] {
  const out: NumericClaim[] = []
  for (const sh of g.sheets) for (const c of sh.cells) {
    if (c.disposition !== 'ATTR' || !c.ofEntity) continue
    const v = vidx.get(`${sh.name}!${c.ref}`)
    const canon = canonicalizeNumeric(v ?? '')
    if (canon != null && /^-?\d+(\.\d+)?$/.test(canon)) out.push({ entityRef: c.ofEntity, value: canon, label: `${sh.name}!${c.ref}` })
  }
  return out
}
function sourceRefTokens(g: Golden2File): Set<string> {
  // The set of refIds the annotators actually cited as present in the source (entity refIds).
  const s = new Set<string>()
  for (const sh of g.sheets) for (const e of sh.entities) if (e.refId) s.add(e.refId)
  return s
}

// ─── offline accounted: ENTITY-BOUND value-presence (hostile review #1) ─────────
// The naive global value bag let a categorical value (state="CA") survive on ONE of 200
// coverages mark all 200 loci accounted while 199 were dropped. This binds:
//   ENTITY cell            -> its value must BE an extracted entity's refId or name
//   ATTR cell with ofEntity-> its value must appear on THAT entity (per-entity bag)
//   ATTR cell w/o ofEntity -> falls back to the global bag (documented weaker proxy; the
//                             live mode uses exact provenance loci and has no such fallback)
function offlineAccounted(g: Golden2File, extracted: EvalEntity2[], wb: EnumWorkbook): Set<string> {
  const global = new Set<string>()
  const entityIdName = new Set<string>()
  const byEntity = new Map<string, Set<string>>()
  const add = (m: Set<string>, v: unknown) => { const c = canonicalizeNumeric(v); if (c) m.add(c) }
  for (const e of extracted) {
    const bag = new Set<string>()
    if (e.refId) { add(global, e.refId); add(entityIdName, e.refId); add(bag, e.refId) }
    add(entityIdName, e.fields['name'])
    for (const v of Object.values(e.fields)) for (const x of (Array.isArray(v) ? v : [v])) { add(global, x); add(bag, x) }
    if (e.refId) byEntity.set(e.refId.trim().toLowerCase(), bag)
    const nm = String(e.fields['name'] ?? '').trim().toLowerCase(); if (nm) byEntity.set(nm, bag)
  }
  const vidx = valueIndex(wb)
  const accounted = new Set<string>()
  for (const sh of g.sheets) for (const c of sh.cells) {
    if (!isSubstance(c.disposition)) continue
    const canon = canonicalizeNumeric(vidx.get(`${sh.name}!${c.ref}`) ?? '')
    if (canon == null) continue
    let hit: boolean
    if (c.disposition === 'ENTITY') hit = entityIdName.has(canon)
    else if (c.ofEntity) hit = byEntity.get(c.ofEntity.trim().toLowerCase())?.has(canon) ?? false
    else hit = global.has(canon)   // ATTR without an owner link -> global fallback (weaker)
    if (hit) accounted.add(`${sh.name}!${c.ref}`)
  }
  return accounted
}
function bundleAccounted(provenance: { sheet?: string; cell?: string }[]): Set<string> {
  const s = new Set<string>()
  for (const p of provenance) if (p.sheet && p.cell) s.add(`${p.sheet}!${p.cell}`)
  return s
}

// ─── mutation fuzz generation (--mutate <goldenName>) ──────────────────────────
// mapIsoWorkbook reads only cell VALUES, so a mutated workbook is generated by transforming
// the value-grid and writing a fresh .xlsx. The workbook mutation and the PURE golden
// transform share identical params, so the transformed golden is the EXACT expected result.
const require2 = createRequire(import.meta.url)
const ExcelJS = require2('exceljs') as typeof import('exceljs')
const SYNONYM_MAP: Record<string, string> = {
  'ID': 'Reference', 'COVERAGE': 'Peril', 'SUB COVERAGE': 'Nested Peril', 'SUBCOVERAGE': 'Nested Peril',
  'LIMIT': 'Cap', 'DEDUCTIBLE': 'Retention', 'FORM': 'Document', 'FORM NUMBER': 'Document No', 'RULE': 'Directive',
  'STATE': 'Jurisdiction', 'PRODUCT': 'Program',
}
const INJECT_AT = 12, INJECT_N = 3, SPLIT_AT = 24, SPLIT_GAP = 3   // shared with the golden transform

interface GridSheet { name: string; hidden: boolean; cells: { ref: string; value: string | number | boolean }[] }
function toGrid(wb: EnumWorkbook): GridSheet[] {
  return wb.sheets.map(s => ({ name: s.name, hidden: s.hidden, cells: s.cells.filter(c => c.value !== null).map(c => ({ ref: c.ref, value: c.value as string | number | boolean })) }))
}
function shiftGridRows(g: GridSheet, atRow0: number, n: number): GridSheet {
  return { ...g, cells: g.cells.map(c => { const rc = refToRC(c.ref)!; return rc.row >= atRow0 ? { ref: rcToRef(rc.row + n, rc.col), value: c.value } : c }) }
}
const isLoneRefId = (v: unknown) => typeof v === 'string' && /^[A-Za-z]{2,12}(?:[.\-_][A-Za-z0-9]{1,8})+$/.test(v.trim()) && /\d/.test(v)
function mutateGrid(wb: EnumWorkbook, mut: MutationName, fwSheet: string): GridSheet[] {
  let g = toGrid(wb)
  if (mut === 'reorder-sheets') return [...g].reverse()
  if (mut === 'hide-sheet') return g.map(s => s.name === fwSheet ? { ...s, hidden: true } : s)
  if (mut === 'inject-blank-rows') return g.map(s => s.name === fwSheet ? shiftGridRows(s, INJECT_AT, INJECT_N) : s)
  if (mut === 'split-table') return g.map(s => s.name === fwSheet ? shiftGridRows(s, SPLIT_AT, SPLIT_GAP) : s)
  if (mut === 'dash-refids') return g.map(s => ({ ...s, cells: s.cells.map(c => isLoneRefId(c.value) ? { ...c, value: String(c.value).replace(/\./g, '-') } : c) }))
  if (mut === 'synonym-headers') {
    // Rename header-row cells via the synonym map (headers move; golden is unchanged).
    return g.map(s => {
      const es: EnumSheet = { name: s.name, hidden: s.hidden, maxRow: Math.max(...s.cells.map(c => refToRC(c.ref)!.row), 0), maxCol: 0, cells: s.cells.map(c => ({ ...c, ...refToRC(c.ref)!, mergeRange: null })) }
      const hr = sheetDigest(es).headerRow
      if (hr == null) return s
      return { ...s, cells: s.cells.map(c => { const rc = refToRC(c.ref)!; const key = String(c.value).toUpperCase().trim(); return rc.row === hr && SYNONYM_MAP[key] ? { ...c, value: SYNONYM_MAP[key] } : c }) }
    })
  }
  return g
}
async function writeGridXlsx(grid: GridSheet[], outPath: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  for (const s of grid) {
    const ws = wb.addWorksheet(s.name.slice(0, 31) || 'Sheet', { state: s.hidden ? 'hidden' : 'visible' })
    for (const c of s.cells) ws.getCell(c.ref).value = c.value
  }
  await wb.xlsx.writeFile(outPath)
}
function transformGolden(g: Golden2File, mut: MutationName, fwSheet: string): Golden2File {
  switch (mut) {
    case 'reorder-sheets': return mutReorderSheets(g)
    case 'synonym-headers': return mutSynonymHeaders(g)
    case 'inject-blank-rows': return mutInjectBlankRows(g, fwSheet, INJECT_AT, INJECT_N)
    case 'split-table': return mutInjectBlankRows(g, fwSheet, SPLIT_AT, SPLIT_GAP)
    case 'hide-sheet': return mutHideSheet(g, fwSheet)
    case 'dash-refids': return mutDashRefIds(g)
  }
}
async function generateMutations(name: string): Promise<void> {
  const { createHash } = await import('crypto')
  const gpath = join(GOLDENS, `${name}.golden2.json`)
  if (!existsSync(gpath)) { console.error(`no golden ${gpath} — annotate ${name} first`); process.exit(2) }
  const golden = JSON.parse(readFileSync(gpath, 'utf8')) as Golden2File
  const src = findSource(golden.file)
  if (!src) { console.error(`source workbook for ${golden.file} not found`); process.exit(2) }
  const wb = await readWorkbookCells(src)
  // Framework sheet = the substance sheet with the most ENTITY cells.
  const fwSheet = golden.sheets.map(s => ({ name: s.name, ents: s.cells.filter(c => c.disposition === 'ENTITY').length })).sort((a, b) => b.ents - a.ents)[0]?.name ?? golden.sheets[0]!.name
  const outDir = join(GOLDENS, 'mutations'); mkdirSync(outDir, { recursive: true })
  const muts: MutationName[] = ['reorder-sheets', 'synonym-headers', 'inject-blank-rows', 'split-table', 'hide-sheet', 'dash-refids']
  console.log(`\n══ mutate ${name} (framework sheet "${fwSheet}") ══`)
  for (const mut of muts) {
    const base = golden.file.replace(/\.[^.]+$/, '')
    const xlsxOut = join(outDir, `${base}__${mut}.xlsx`)
    await writeGridXlsx(mutateGrid(wb, mut, fwSheet), xlsxOut)
    const tg = transformGolden(golden, mut, fwSheet)
    tg.file = `${base}__${mut}.xlsx`
    tg.sha256 = createHash('sha256').update(readFileSync(xlsxOut)).digest('hex')
    tg.annotatedAt = golden.annotatedAt
    writeFileSync(join(outDir, `${name}__${mut}.golden2.json`), JSON.stringify(tg, null, 2))
    console.log(`  ✓ ${mut} → mutations/${base}__${mut}.xlsx + golden`)
  }
  console.log(`\nScore them with: pnpm exec tsx scripts/import-eval2.mts --offline --mutations --only ${muts.map(m => `${name}__${m}`).join(',')}`)
}

// ─── REVIEW_QUEUE.md (--review-queue) ──────────────────────────────────────────
// Every adjudicated/queued disagreement + a deterministic 2% sample of ACCEPTED cells,
// grouped by file/sheet, verbatim values + both candidates — scannable by a human in ~10 min.
async function buildReviewQueue(): Promise<void> {
  const queuePath = resolve(REPO, 'docs/import-census/.queue.jsonl')
  const outPath = resolve(REPO, 'docs/import-census/REVIEW_QUEUE.md')
  const lines: string[] = ['# CE2 human review queue', '', 'Scannable in ~10 minutes. Every family disagreement the harness could not ground (never auto-resolved), plus a deterministic 2% sample of accepted cells for spot-audit.', '']

  // Cache source workbook value indexes by golden file.
  const goldenFiles = existsSync(GOLDENS) ? readdirSync(GOLDENS).filter(f => f.endsWith('.golden2.json')) : []
  const vidxByFile = new Map<string, Map<string, string>>()
  const goldenByFile = new Map<string, Golden2File>()
  for (const gf of goldenFiles) {
    const g = JSON.parse(readFileSync(join(GOLDENS, gf), 'utf8')) as Golden2File
    goldenByFile.set(g.file, g)
    const src = findSource(g.file)
    if (src) vidxByFile.set(g.file, valueIndex(await readWorkbookCells(src)))
  }
  const verbatim = (file: string, sheet: string, ref: string) => {
    // queue rows store the golden basename via g.file; map by matching golden file basename.
    for (const [gfile, vidx] of vidxByFile) if (gfile.replace(/\.[^.]+$/, '') === file || gfile === file) return (vidx.get(`${sheet}!${ref}`) ?? '').slice(0, 100)
    return ''
  }

  // (1) Queued disagreements.
  lines.push('## Adjudicated / queued disagreements (never auto-resolved)', '')
  if (existsSync(queuePath)) {
    const rows = readFileSync(queuePath, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) as Record<string, unknown>[]
    const byGroup = new Map<string, Record<string, unknown>[]>()
    for (const r of rows) { const k = `${r.file} / ${r.sheet}`; (byGroup.get(k) ?? byGroup.set(k, []).get(k)!).push(r) }
    lines.push(`Total queued: **${rows.length}** across ${byGroup.size} file/sheet group(s).`, '')
    for (const [k, group] of [...byGroup].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`### ${k} (${group.length})`, '', '| ref | verbatim | reason | A | B |', '|---|---|---|---|---|')
      for (const r of group.slice(0, 25)) lines.push(`| ${r.ref} | ${String(verbatim(String(r.file), String(r.sheet), String(r.ref))).replace(/\|/g, '\\|')} | ${r.reason} | ${JSON.stringify(r.a).slice(0, 60).replace(/\|/g, '\\|')} | ${JSON.stringify(r.b).slice(0, 60).replace(/\|/g, '\\|')} |`)
      if (group.length > 25) lines.push(`| … | (${group.length - 25} more) | | | |`)
      lines.push('')
    }
  } else lines.push('_(no queue file — annotation produced no disagreements, or has not run)_', '')

  // (2) Deterministic 2% accepted-cell sample (every 50th accepted substance cell).
  lines.push('## 2% accepted-cell audit sample (every 50th accepted substance cell)', '')
  for (const [file, g] of goldenByFile) {
    const base = file.replace(/\.[^.]+$/, '')
    for (const sh of g.sheets) {
      const sub = sh.cells.filter(c => c.disposition === 'ENTITY' || c.disposition === 'ATTR')
      const sample = sub.filter((_, i) => i % 50 === 0)
      if (sample.length === 0) continue
      lines.push(`### ${base} / ${sh.name} (${sample.length} of ${sub.length})`, '', '| ref | disposition | kind | verbatim |', '|---|---|---|---|')
      for (const c of sample.slice(0, 20)) lines.push(`| ${c.ref} | ${c.disposition} | ${c.kind ?? ''} | ${String(vidxByFile.get(file)?.get(`${sh.name}!${c.ref}`) ?? '').slice(0, 80).replace(/\|/g, '\\|')} |`)
      lines.push('')
    }
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, lines.join('\n'))
  console.log(`REVIEW_QUEUE.md written (${goldenByFile.size} golden file(s))`)
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  if (opt('--mutate')) { await generateMutations(opt('--mutate')!); return }
  if (flag('--review-queue')) { await buildReviewQueue(); return }
  const goldenFiles: string[] = []
  if (existsSync(GOLDENS)) for (const f of readdirSync(GOLDENS)) if (f.endsWith('.golden2.json')) goldenFiles.push(join(GOLDENS, f))
  const mutDir = join(GOLDENS, 'mutations')
  if (WITH_MUTATIONS && existsSync(mutDir)) for (const f of readdirSync(mutDir)) if (f.endsWith('.golden2.json')) goldenFiles.push(join(mutDir, f))
  if (goldenFiles.length === 0) { console.error('no goldens2 found — run scripts/annotate-goldens.mts first'); process.exit(2) }

  const census = CENSUS && existsSync(CENSUS) ? (JSON.parse(readFileSync(CENSUS, 'utf8')) as { files: CensusFile[] }) : null
  let token: string | null = null
  if (MODE === 'live' || MODE === 'recover') { try { token = await login() } catch (e) { console.error(`login failed: ${(e as Error).message}`); process.exit(2) } }

  console.log(`\n══ eval2 [${MODE}] — ${goldenFiles.length} golden(s) ══`)
  const rows: Row[] = []
  for (const gf of goldenFiles) {
    const g = JSON.parse(readFileSync(gf, 'utf8')) as Golden2File
    const name = goldenName(g)
    if (ONLY.length && !ONLY.includes(name)) continue
    const src = gf.includes(`${sep()}mutations${sep()}`) ? join(mutDir, g.file) : findSource(g.file)
    if (!src || !existsSync(src)) { console.log(`  ⚠ ${name}: source workbook not found (${g.file}) — skipped`); continue }
    const wb = await readWorkbookCells(src)

    let extracted: EvalEntity2[] = []
    let provenance: { sheet?: string; cell?: string; verbatim?: string }[] = []
    let accounted: Set<string>
    try {
      if (MODE === 'offline') {
        const plan = mapIsoWorkbook(densify(wb)) as unknown as PlanLike
        extracted = planToEntities(plan)
        accounted = offlineAccounted(g, extracted, wb)
      } else if (MODE === 'bundle') {
        const { plan, provenance: prov } = bundlePlan(JSON.parse(readFileSync(MODE_BUNDLE!, 'utf8')))
        extracted = planToEntities(plan); provenance = prov; accounted = bundleAccounted(prov)
      } else if (MODE === 'recover') {
        const rec = await recoverRunResult({ baseUrl: BASE_URL, token: token!, runId: MODE_RECOVER!, log: () => {}, pollIntervalMs: 60_000, maxWaitMs: 2_700_000 })
        const { plan, provenance: prov } = bundlePlan(rec?.bundle ?? {}); extracted = planToEntities(plan); provenance = prov; accounted = bundleAccounted(prov)
      } else {
        const { bundle, provenance: prov } = await liveBundle(token!, src)
        const { plan } = bundlePlan(bundle); extracted = planToEntities(plan); provenance = prov; accounted = bundleAccounted(prov)
      }
    } catch (e) {
      console.log(`  ✗ ${name}: extraction failed (${(e as Error).message.slice(0, 80)}) — recorded as total loss`)
      accounted = new Set()
    }
    // census-provided accounted overrides the derived set when present for this file.
    const cf = census?.files.find(f => f.file === g.file) ?? null
    if (cf && cf.sheets.some(s => s.accounted)) { accounted = new Set(); for (const s of cf.sheets) for (const r of (s.accounted ?? [])) accounted.add(`${s.name}!${r}`) }

    const row = scoreGolden(g, extracted, accounted, wb, provenance, cf)
    rows.push(row)
    const m = row.metrics as Record<string, { substanceCoverage?: number }>
    const acc = m.accounting as { substanceCoverage: number; unaccountedEntityCells: number; substanceCells: number }
    console.log(`  ${row.pass ? '✓' : '✗'} ${name} [${row.coverage}]: cov ${(acc.substanceCoverage * 100).toFixed(1)}% | unaccEnt ${acc.unaccountedEntityCells} | ${row.reds.length ? 'RED: ' + row.reds.join('; ') : 'green'}`)
  }

  mkdirSync(AUDIT, { recursive: true })
  const anyFail = rows.some(r => !r.pass)
  writeFileSync(join(AUDIT, 'import_eval2_results.json'), JSON.stringify({ runAt: new Date().toISOString(), mode: MODE, thresholds: T, rows }, null, 2))
  console.log(`\n${anyFail ? '✗ RED' : '✓ GREEN'} — ${rows.filter(r => !r.pass).length}/${rows.length} golden(s) failing → docs/audit/import_eval2_results.json`)
  process.exit(anyFail ? 1 : 0)
}
function sep(): string { return process.platform === 'win32' ? '\\' : '/' }

main().catch(e => { console.error(e); process.exit(1) })
