#!/usr/bin/env tsx
/**
 * scripts/phaseg-holdout.mts — Phase G generalization holdout (ledger Phase G, G2/G3).
 *
 * Generates NEVER-SEEN format variants by deterministic mutation of the committed
 * golden source workbooks, then scores the deterministic import layer against
 * mechanically-derived expectations. Each variant certifies ONE invariance claim:
 *
 *   v1-moved-preamble    banner/preamble rows above the header   → plan EQUAL
 *   v2-shuffled-columns  column order permuted (reversed)        → plan EQUAL
 *   v3-merged-banner     merged-cell title banner above header   → plan EQUAL
 *   v4-dashed-refids     line-scoped refIds use '-' not '.'      → plan EQUAL modulo
 *                        the same token transform (byte-for-byte refId invariant)
 *   v5-blank-silence     requirement/category/mandatory cells blanked → HONESTY:
 *                        blanked fields must surface as UNKNOWN/absent, never a
 *                        fabricated canonical value (G1 clusters *-SILENCE)
 *   v6-renamed-sheets    sheet names outside every known regex   → FLOOR: every
 *                        sheet accounted (recognized|skipped), zero silent loss
 *   v7-unfamiliar-layout same VALID content in an unseen layout (reordered
 *                        columns + noise columns + preamble)     → plan EQUAL to
 *                        the plain-layout parse of the same content
 *
 * Scope (stated honestly): Tier-0 certifies the DETERMINISTIC layer
 * (mapIsoWorkbook — the identity oracle the live brain joins against). Sheet-name
 * robustness beyond the mapper's regex contract is the live AI classifier's job
 * (v6 locks the no-silent-loss floor, not extraction).
 *
 * Usage:
 *   npx tsx scripts/phaseg-holdout.mts --generate [--seed GL|IM]   # write variants + expected
 *   npx tsx scripts/phaseg-holdout.mts --check    [--seed GL|IM] [--out <json>]
 *
 * Determinism: no randomness; mutations are fixed transforms. Committed bytes are
 * frozen at HOLDOUT_SHA (the freeze commit); regeneration is only for a new seed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import ExcelJS from 'exceljs'
import { mapIsoWorkbook } from '@pf/shared'
import type { IsoCell, IsoGrid, ImportPlan } from '@pf/shared'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dir, '..')
function resolveSeed(): string {
  const eq = process.argv.find(a => a.startsWith('--seed='))
  if (eq) return eq.slice('--seed='.length).toUpperCase()
  const i = process.argv.indexOf('--seed')
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')) return process.argv[i + 1]!.toUpperCase()
  return 'GL'
}
const SEED = resolveSeed()
const OUT_ARG = process.argv.indexOf('--out') >= 0 ? process.argv[process.argv.indexOf('--out') + 1] : null

const SEEDS: Record<string, { framework: string; forms?: string }> = {
  GL: { framework: 'samples/iso/sample-GL-framework.xlsx', forms: 'samples/iso/sample-GL-forms.xlsx' },
  IM: { framework: 'samples/iso/sample-IM-framework.xlsx' },
}
const seedFiles = SEEDS[SEED]
if (!seedFiles) { console.error(`unknown seed ${SEED}`); process.exit(2) }
const HOLDOUT_DIR = resolve(REPO, `samples/hardening/holdout/${SEED}`)

// ─── Grid IO ───────────────────────────────────────────────────────────────────

function flatten(v: ExcelJS.CellValue): IsoCell {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if (Array.isArray(o['richText'])) return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
    if ('result' in o) { const r = o['result']; return typeof r === 'object' ? null : (r as IsoCell) }
    if ('hyperlink' in o) return String(o['text'] ?? o['hyperlink'] ?? '')
    if ('text' in o) return String(o['text'])
  }
  return null
}

async function readGrids(filePath: string): Promise<IsoGrid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const grids: IsoGrid[] = []
  wb.eachSheet(ws => {
    const cells: IsoCell[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const rowObj = ws.getRow(r)
      const arr: IsoCell[] = []
      for (let c = 1; c <= ws.columnCount; c++) arr[c - 1] = flatten(rowObj.getCell(c).value)
      cells[r - 1] = arr
    }
    grids.push({ sheet: ws.name, file: filePath, cells })
  })
  return grids
}

async function writeGrids(grids: IsoGrid[], filePath: string, merges: Record<string, string[]> = {}) {
  const wb = new ExcelJS.Workbook()
  const used = new Set<string>()
  for (const g of grids) {
    let name = g.sheet.slice(0, 31)
    for (let n = 2; used.has(name.toUpperCase()); n++) name = `${g.sheet.slice(0, 26)} (${n})`
    used.add(name.toUpperCase())
    const ws = wb.addWorksheet(name)
    for (let r = 0; r < g.cells.length; r++) {
      const row = g.cells[r] ?? []
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== null && row[c] !== undefined) ws.getCell(r + 1, c + 1).value = row[c] as ExcelJS.CellValue
      }
    }
    for (const range of merges[g.sheet] ?? []) ws.mergeCells(range)
  }
  await wb.xlsx.writeFile(filePath)
}

const deepCopy = (grids: IsoGrid[]): IsoGrid[] => grids.map(g => ({ ...g, cells: g.cells.map(r => [...(r ?? [])]) }))

// ─── Canonical plan comparison ─────────────────────────────────────────────────

type Entity = { kind: string; refId: string | null; docId: string | null; label: string; data: Record<string, unknown> }
function canonicalize(plan: ImportPlan): Entity[] {
  const out: Entity[] = []
  const push = (kind: string, list: { refId?: string | null; docId?: string | null; label?: string; data: Record<string, unknown> }[] | null | undefined) => {
    for (const p of list ?? []) out.push({ kind, refId: p.refId ?? null, docId: p.docId ?? null, label: p.label ?? '', data: p.data })
  }
  push('product', plan.products)
  push('coverage', plan.coverages)
  push('form', plan.forms)
  push('rule', plan.rules)
  push('formRule', plan.formRules)
  push('ldTable', plan.ldTables)
  push('rtTable', plan.rtTables)
  if (plan.ratingProgram) push('ratingProgram', [plan.ratingProgram])
  out.sort((a, b) => `${a.kind}|${a.refId}|${a.docId}`.localeCompare(`${b.kind}|${b.refId}|${b.docId}`))
  return out
}
function stableStringify(v: unknown): string {
  return JSON.stringify(v, function replacer(_k, val) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    }
    return val
  })
}
function diffEntities(exp: Entity[], got: Entity[]): string[] {
  const key = (e: Entity) => `${e.kind}|${e.refId}|${e.docId}`
  const em = new Map(exp.map(e => [key(e), e])); const gm = new Map(got.map(e => [key(e), e]))
  const out: string[] = []
  for (const [k, e] of em) {
    const g = gm.get(k)
    if (!g) { out.push(`MISSING ${k}`); continue }
    if (stableStringify(e.data) !== stableStringify(g.data)) {
      for (const f of new Set([...Object.keys(e.data), ...Object.keys(g.data)])) {
        if (stableStringify(e.data[f]) !== stableStringify(g.data[f])) out.push(`FIELD ${k}.${f}: expected ${JSON.stringify(e.data[f])?.slice(0, 80)} got ${JSON.stringify(g.data[f])?.slice(0, 80)}`)
      }
    }
  }
  for (const k of gm.keys()) if (!em.has(k)) out.push(`EXTRA ${k}`)
  return out
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

const BANNER = ['Carrier Product Workbook — internal working copy', 'Prepared by: Product Management Office', '']
function mutPreamble(grids: IsoGrid[]): IsoGrid[] {
  return deepCopy(grids).map(g => ({ ...g, cells: [...BANNER.map(t => [t] as IsoCell[]), ...g.cells] }))
}
function mutShuffleColumns(grids: IsoGrid[]): IsoGrid[] {
  return deepCopy(grids).map(g => {
    const width = Math.max(...g.cells.map(r => (r ?? []).length), 0)
    return { ...g, cells: g.cells.map(r => { const full = Array.from({ length: width }, (_, i) => (r ?? [])[i] ?? null); return full.reverse() }) }
  })
}
// SOURCE ids only: a MINTED id (SYNTH marker) is the platform's own convention —
// byte-for-byte preservation applies to what the document states, never to what
// the pipeline mints (blind-challenge finding, IM seed: the synthesized product id
// must stay dotted even in a dash-notation workbook).
const REFID_TOKEN = /\b((?:GL|IM|PR|PH|PA)(?:\.[A-Z]{2,12})+\.\d+(?:\.\d+)*)\b/g
function dashToken(s: string): string { return s.replace(REFID_TOKEN, m => m.replace(/\./g, '-')) }
/** Byte-for-byte applies to ids the DOCUMENT states — so the expected-plan
 *  transform swaps exactly the tokens found in the source cells, and never ids
 *  the platform MINTS (SYNTH products, registry LOB pointers stay canonical
 *  dotted; blind-challenge finding on the IM seed). */
function mutDashRefIds(grids: IsoGrid[]): { grids: IsoGrid[]; sourceTokens: Set<string> } {
  const sourceTokens = new Set<string>()
  const out = deepCopy(grids).map(g => ({
    ...g,
    cells: g.cells.map(r => (r ?? []).map(c => {
      if (typeof c !== 'string') return c
      for (const m of c.match(REFID_TOKEN) ?? []) sourceTokens.add(m)
      return dashToken(c)
    })),
  }))
  return { grids: out, sourceTokens }
}
function dashExpected(json: string, sourceTokens: Set<string>): string {
  let out = json
  // Longest first: "GL.COV.001" must never rewrite the prefix of "GL.COV.001.001".
  for (const t of [...sourceTokens].sort((a, b) => b.length - a.length)) out = out.split(t).join(t.replace(/\./g, '-'))
  return out
}
function mutRenameSheets(grids: IsoGrid[]): IsoGrid[] {
  const RENAME: [RegExp, string][] = [
    [/framework/i, 'Product Structure Register'],
    [/forms specifications?/i, 'Form Catalog'],
    [/forms dynamic|dynamic data/i, 'Form Field Register'],
    [/optional forms rules/i, 'Attachment Logic'],
    [/rules specifications?/i, 'Rule Book'],
    [/rating specifications?/i, 'Rate Plan'],
    [/rating tables|rate tables/i, 'Factor Grids'],
    [/limits and deductibles/i, 'Amount Options'],
  ]
  let n = 0
  return deepCopy(grids).map(g => {
    const hit = RENAME.find(([re]) => re.test(g.sheet))
    return hit ? { ...g, sheet: `${hit[1]} ${++n}` } : g
  })
}
const squish = (v: IsoCell) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
function findHeaderRow(g: IsoGrid, marker: string): number {
  for (let r = 0; r < Math.min(g.cells.length, 30); r++) {
    if ((g.cells[r] ?? []).some(c => squish(c).includes(marker))) return r
  }
  return -1
}
function findCol(g: IsoGrid, headerRow: number, ...markers: string[]): number {
  const row = g.cells[headerRow] ?? []
  for (let c = 0; c < row.length; c++) {
    const s = squish(row[c])
    if (s && markers.some(m => s.includes(m))) return c
  }
  return -1
}
/** v5: blank honesty probes. Returns the mutated grids + which entities were blanked. */
function mutBlankSilence(grids: IsoGrid[]): { grids: IsoGrid[]; blanked: { coverageRefIds: string[]; formNumbers: string[] } } {
  const out = deepCopy(grids)
  const blanked = { coverageRefIds: [] as string[], formNumbers: [] as string[] }
  for (const g of out) {
    if (/framework/i.test(g.sheet)) {
      const hr = findHeaderRow(g, 'COVERAGEREQUIREMENT') >= 0 ? findHeaderRow(g, 'COVERAGEREQUIREMENT') : findHeaderRow(g, 'FRAMEWORKID')
      if (hr < 0) continue
      const reqCol = findCol(g, hr, 'COVERAGEREQUIREMENT', 'MANDATORYOPTIONAL', 'REQUIREMENT')
      const idCol = findCol(g, hr, 'FRAMEWORKID', 'REFID')
      if (reqCol < 0 || idCol < 0) continue
      let n = 0
      for (let r = hr + 1; r < g.cells.length && n < 5; r++) {
        const row = g.cells[r] ?? []
        const id = String(row[idCol] ?? '')
        if (/\.COV\./.test(id) && String(row[reqCol] ?? '').trim() !== '') {
          row[reqCol] = ''
          blanked.coverageRefIds.push(id.trim())
          n++
        }
      }
    }
    if (/forms specifications?/i.test(g.sheet)) {
      const hr = findHeaderRow(g, 'FORMNUMBER')
      if (hr < 0) continue
      const catCol = findCol(g, hr, 'CATEGORY')
      const manCol = findCol(g, hr, 'MANDATORY')
      const numCol = findCol(g, hr, 'FORMNUMBER')
      if (numCol < 0) continue
      let n = 0
      for (let r = hr + 1; r < g.cells.length && n < 5; r++) {
        const row = g.cells[r] ?? []
        const num = String(row[numCol] ?? '').trim()
        // Only true form-number rows (e.g. "CG 00 01"); the sheet's leading
        // field-label block must never be mistaken for data.
        if (!/^[A-Z]{2,3}\s?\d{2}\s?\d{2}/.test(num)) continue
        if (catCol >= 0) row[catCol] = ''
        if (manCol >= 0) row[manCol] = ''
        blanked.formNumbers.push(num)
        n++
      }
    }
  }
  return { grids: out, blanked }
}

// v7: the same VALID content in an unfamiliar-but-legal layout vs a plain layout.
function v7Pair(): { plain: IsoGrid[]; unfamiliar: IsoGrid[] } {
  const rows: [string, string, string, string, string, string][] = [
    // [refId, product, lob, coverage, requirement, forms]
    ['IM.PROD.900', 'Scheduled Equipment Floater', 'Inland Marine', '', '', ''],
    ['IM.COV.901', 'Scheduled Equipment Floater', 'Inland Marine', 'Scheduled Equipment', 'Mandatory', 'IM 79 01'],
    ['IM.COV.901.001', 'Scheduled Equipment Floater', 'Inland Marine', 'Rented Equipment', 'Optional', 'IM 79 02'],
    ['IM.COV.902', 'Scheduled Equipment Floater', 'Inland Marine', 'Equipment In Transit', 'Optional', 'IM 79 03'],
  ]
  const H = ['STATUS', 'PRODUCT FRAMEWORK ID', 'PRODUCT', 'LINE OF BUSINESS', 'COVERAGE', 'MANDATORY/ OPTIONAL', 'FORM NUMBER(S)']
  const plain: IsoGrid[] = [{
    sheet: 'IM Product Framework', cells: [
      H as IsoCell[],
      ...rows.map(r => ['Active', r[0], r[1], r[2], r[3], r[4], r[5]] as IsoCell[]),
    ],
  }]
  // Unfamiliar: preamble, noise columns interleaved, column order changed.
  const HU = ['COVERAGE', 'INTERNAL NOTES', 'MANDATORY/ OPTIONAL', 'STATUS', 'FILED?', 'PRODUCT FRAMEWORK ID', 'FORM NUMBER(S)', 'PRODUCT', 'LINE OF BUSINESS']
  const unfamiliar: IsoGrid[] = [{
    sheet: 'IM Product Framework (2026 refresh)', cells: [
      ['Marine practice — product register', null, null] as IsoCell[],
      [''] as IsoCell[],
      HU as IsoCell[],
      ...rows.map(r => [r[3], 'reviewed', r[4], 'Active', 'yes', r[0], r[5], r[1], r[2]] as IsoCell[]),
    ],
  }]
  return { plain, unfamiliar }
}

// ─── Variant registry ──────────────────────────────────────────────────────────

interface VariantSpec { id: string; kind: 'EQUAL' | 'EQUAL_TRANSFORMED' | 'HONESTY' | 'FLOOR' | 'EQUAL_PAIR'; note: string }
const VARIANTS: VariantSpec[] = [
  { id: 'v1-moved-preamble', kind: 'EQUAL', note: 'banner rows above every sheet' },
  { id: 'v2-shuffled-columns', kind: 'EQUAL', note: 'column order reversed on every sheet' },
  { id: 'v3-merged-banner', kind: 'EQUAL', note: 'merged-cell title banner above the header' },
  { id: 'v4-dashed-refids', kind: 'EQUAL_TRANSFORMED', note: 'line-scoped refIds use dashes; extraction must carry them byte-for-byte' },
  { id: 'v5-blank-silence', kind: 'HONESTY', note: 'requirement/category/mandatory cells blanked — fabrication probe (G1 clusters)' },
  { id: 'v6-renamed-sheets', kind: 'FLOOR', note: 'sheet names outside every known regex — zero silent loss' },
  { id: 'v7-unfamiliar-layout', kind: 'EQUAL_PAIR', note: 'valid IM content, unfamiliar layout vs plain layout' },
]

async function generate() {
  mkdirSync(HOLDOUT_DIR, { recursive: true })
  const srcFiles = [seedFiles.framework, seedFiles.forms].filter(Boolean).map(f => resolve(REPO, f as string))
  const pristine = (await Promise.all(srcFiles.map(readGrids))).flat()
  const expectedPlan = canonicalize(mapIsoWorkbook(pristine))
  const manifest: Record<string, unknown> = { seed: SEED, sources: srcFiles.map(f => f.replace(REPO + '\\', '').replace(REPO + '/', '')), variants: {} }

  const put = async (id: string, grids: IsoGrid[], expected: unknown, extra: Record<string, unknown> = {}, merges: Record<string, string[]> = {}) => {
    await writeGrids(grids, join(HOLDOUT_DIR, `${id}.xlsx`), merges)
    writeFileSync(join(HOLDOUT_DIR, `${id}.expected.json`), stableStringify(expected))
    ;(manifest.variants as Record<string, unknown>)[id] = { ...VARIANTS.find(v => v.id === id), ...extra }
  }

  await put('v1-moved-preamble', mutPreamble(pristine), expectedPlan)
  await put('v2-shuffled-columns', mutShuffleColumns(pristine), expectedPlan)
  // v3: banner + merged cells across the banner row on each sheet.
  const banner = mutPreamble(pristine)
  await put('v3-merged-banner', banner, expectedPlan, {}, Object.fromEntries(banner.map(g => [g.sheet, ['A1:E1', 'A2:C2']])))
  const dashed = mutDashRefIds(pristine)
  await put('v4-dashed-refids', dashed.grids, JSON.parse(dashExpected(stableStringify(expectedPlan), dashed.sourceTokens)))
  const { grids: blankGrids, blanked } = mutBlankSilence(pristine)
  await put('v5-blank-silence', blankGrids, null, { blanked })
  await put('v6-renamed-sheets', mutRenameSheets(pristine), null, { sheetCount: pristine.length })
  const { plain, unfamiliar } = v7Pair()
  await writeGrids(plain, join(HOLDOUT_DIR, 'v7-plain.xlsx'))
  await put('v7-unfamiliar-layout', unfamiliar, null)
  writeFileSync(join(HOLDOUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`generated ${VARIANTS.length} variants for seed ${SEED} → ${HOLDOUT_DIR}`)
}

// ─── Check ─────────────────────────────────────────────────────────────────────

async function check() {
  const manifest = JSON.parse(readFileSync(join(HOLDOUT_DIR, 'manifest.json'), 'utf8'))
  const results: Record<string, { verdict: 'GREEN' | 'RED'; details: string[] }> = {}

  const parseFile = async (name: string) => {
    const grids = await readGrids(join(HOLDOUT_DIR, name))
    return mapIsoWorkbook(grids)
  }

  for (const v of VARIANTS) {
    const details: string[] = []
    let verdict: 'GREEN' | 'RED' = 'GREEN'
    try {
      if (v.kind === 'EQUAL' || v.kind === 'EQUAL_TRANSFORMED') {
        const expected = JSON.parse(readFileSync(join(HOLDOUT_DIR, `${v.id}.expected.json`), 'utf8')) as Entity[]
        const got = canonicalize(await parseFile(`${v.id}.xlsx`))
        const diffs = diffEntities(expected, got)
        if (diffs.length) { verdict = 'RED'; details.push(...diffs.slice(0, 12), `(${diffs.length} total diffs)`) }
      } else if (v.kind === 'HONESTY') {
        // Honesty contract (recorded in g4-clusters.md BEFORE any fix):
        //  - requirement: STRICT — blank must surface as UNKNOWN (the type supports it, F14).
        //  - category / boolean defaults: the documented default may stand ONLY when the
        //    plan carries a warning naming the defaulting (F18: warned defaults are the
        //    platform's honesty floor; SILENT fabrication is the defect).
        const plan = await parseFile(`${v.id}.xlsx`)
        const warns = plan.summary.warnings.join('\n')
        const { coverageRefIds, formNumbers } = manifest.variants[v.id].blanked
        for (const rid of coverageRefIds) {
          const cov = plan.coverages.find(c => c.refId === rid)
          if (!cov) { details.push(`coverage ${rid} missing entirely`); verdict = 'RED'; continue }
          const req = cov.data['requirement']
          if (req !== 'UNKNOWN' && req !== undefined && req !== null && req !== '') {
            details.push(`coverage ${rid}: blank requirement cell fabricated as ${JSON.stringify(req)}`)
            verdict = 'RED'
          }
        }
        for (const num of formNumbers) {
          const form = plan.forms.find(f => String(f.data['number'] ?? '') === num)
          if (!form) { details.push(`form ${num} missing entirely`); verdict = 'RED'; continue }
          const cat = form.data['category']
          const catHonest = cat === 'UNKNOWN' || cat === undefined || cat === null || cat === ''
            || /blank FORM CATEGORY/i.test(warns)
          if (!catHonest) {
            details.push(`form ${num}: blank category cell SILENTLY fabricated as ${JSON.stringify(cat)} (no warning)`)
            verdict = 'RED'
          }
          const man = form.data['mandatoryDefault']
          const manHonest = man === undefined || man === null || man === 'UNKNOWN'
            || /blank MANDATORY/i.test(warns)
          if (!manHonest) {
            details.push(`form ${num}: blank mandatory cell SILENTLY fabricated as ${JSON.stringify(man)} (no warning)`)
            verdict = 'RED'
          }
        }
      } else if (v.kind === 'FLOOR') {
        const grids = await readGrids(join(HOLDOUT_DIR, `${v.id}.xlsx`))
        const plan = mapIsoWorkbook(grids)
        const accounted = new Set([...plan.summary.sheetsRecognized, ...plan.summary.sheetsSkipped])
        const missing = grids.map(g => g.sheet).filter(s => !accounted.has(s))
        if (missing.length) { verdict = 'RED'; details.push(`sheets silently unaccounted: ${missing.join(', ')}`) }
        const planEntities = canonicalize(plan).length
        details.push(`entities from renamed sheets: ${planEntities} (extraction not required at the mapper; silent loss is the red)`)
      } else if (v.kind === 'EQUAL_PAIR') {
        const plainPlan = canonicalize(await parseFile('v7-plain.xlsx'))
        const got = canonicalize(await parseFile(`${v.id}.xlsx`))
        if (plainPlan.length === 0) { verdict = 'RED'; details.push('plain-layout parse produced ZERO entities — pair fixture degenerate') }
        const diffs = diffEntities(plainPlan, got)
        if (diffs.length) { verdict = 'RED'; details.push(...diffs.slice(0, 12), `(${diffs.length} total diffs)`) }
      }
    } catch (e) {
      verdict = 'RED'
      details.push(`EXCEPTION: ${String((e as Error).message).slice(0, 200)}`)
    }
    results[v.id] = { verdict, details }
    console.log(`${verdict === 'GREEN' ? '✓' : '✗'} ${v.id} [${v.kind}] ${details[0] ?? ''}`)
    for (const d of details.slice(1, 6)) console.log(`    ${d}`)
  }

  const reds = Object.values(results).filter(r => r.verdict === 'RED').length
  if (OUT_ARG) writeFileSync(resolve(REPO, OUT_ARG), JSON.stringify({ seed: SEED, checkedVariants: VARIANTS.length, reds, results }, null, 2))
  console.log(`\n${VARIANTS.length - reds}/${VARIANTS.length} green`)
  process.exit(reds > 0 ? 1 : 0)
}

if (process.argv.includes('--generate')) await generate()
else if (process.argv.includes('--check')) await check()
else { console.error('pass --generate or --check'); process.exit(2) }
