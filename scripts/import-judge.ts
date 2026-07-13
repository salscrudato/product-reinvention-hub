/* eslint-disable no-console */
// scripts/import-judge.ts — live Foundry-AI judge for the ISO/SECURA workbook importer.
//
// Grades the DETERMINISTIC coverage/sub-coverage tree produced by mapIsoWorkbook against an
// INDEPENDENT reading of the raw workbook rows by claude-opus-4-8 (GROUNDED_CITED) on Azure AI
// Foundry. The model never sees the parser's logic — only the raw COVERAGE / SUB COVERAGE / ID
// columns and the parent the parser assigned — and returns only the rows it believes are
// misclassified, with the parent it would assign and why. This is an adversarial oracle: a run
// with zero flagged rows is strong evidence the tree is right; flagged rows are triaged by hand
// (the model can also be wrong) and drive the next parser iteration.
//
// Usage (creds from env — never commit secrets):
//   AZURE_FOUNDRY_ENDPOINT="https://<res>.services.ai.azure.com" AZURE_FOUNDRY_KEY="<key>" \
//     npx tsx scripts/import-judge.ts ["file filter"]
//
// Reads samples from samples/iso. Prints a per-workbook scorecard + overall accuracy.

import ExcelJS from 'exceljs'
import { readdirSync } from 'fs'
import { join } from 'path'
import {
  mapIsoWorkbook, type IsoCell, type IsoGrid, type PlannedEntity,
} from '../shared/src/insurance/isoImport'

const DIR = join(process.cwd(), 'samples/iso')
const ENDPOINT = (process.env.AZURE_FOUNDRY_ENDPOINT || '').replace(/\/+$/, '')
const KEY = process.env.AZURE_FOUNDRY_KEY || ''
const ANTHROPIC_VERSION = process.env.AZURE_FOUNDRY_ANTHROPIC_VERSION || '2023-06-01'
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'claude-opus-4-8'

if (!ENDPOINT || !KEY) {
  console.error('Set AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_KEY (see tmp_keys.md).')
  process.exit(1)
}

// ─── true-data-region reader (mirrors app/src/lib/import/readWorkbook.ts) ───────

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

async function readWorkbook(path: string): Promise<IsoGrid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const grids: IsoGrid[] = []
  wb.eachSheet(ws => {
    let maxRow = 0, maxCol = 0
    ws.eachRow({ includeEmpty: false }, (rowObj, rowNumber) => {
      let lastCol = 0
      rowObj.eachCell({ includeEmpty: false }, (_c, colNumber) => { if (colNumber > lastCol) lastCol = colNumber })
      if (lastCol > 0) { if (rowNumber > maxRow) maxRow = rowNumber; if (lastCol > maxCol) maxCol = lastCol }
    })
    const cells: IsoCell[][] = []
    for (let r = 1; r <= maxRow; r++) {
      const rowObj = ws.getRow(r)
      const arr: IsoCell[] = []
      for (let c = 1; c <= maxCol; c++) arr[c - 1] = flatten(rowObj.getCell(c).value)
      cells[r - 1] = arr
    }
    grids.push({ sheet: ws.name, file: path, cells })
  })
  return grids
}

// ─── Foundry (Anthropic-native) forced-tool call ───────────────────────────────

interface JudgeError { refId: string; assignedParentName: string | null; expectedParentName: string | null; reason: string }

const JUDGE_TOOL = {
  name: 'report_misclassifications',
  description:
    'Report ONLY the coverage rows whose assigned parent is wrong, comparing by the parent COVERAGE '
    + 'NAME (ids in this book are unreliable — do not judge by id). A row with a non-empty SUB '
    + 'COVERAGE value is a SUB-COVERAGE; its correct parent NAME is the value of its own COVERAGE '
    + 'column. A row with an empty SUB COVERAGE value is a TOP-LEVEL coverage (parent name must be '
    + 'null). Return expectedParentName = the correct parent COVERAGE name (or null). If every row is '
    + 'correct, return an empty array.',
  input_schema: {
    type: 'object',
    properties: {
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            refId:              { type: 'string' },
            assignedParentName: { type: ['string', 'null'] },
            expectedParentName: { type: ['string', 'null'] },
            reason:             { type: 'string' },
          },
          required: ['refId', 'expectedParentName', 'reason'],
        },
      },
    },
    required: ['errors'],
  },
}

const JUDGE_SYSTEM =
  'You are an adversarial QA reviewer for an insurance product importer. You are given coverage '
  + 'rows exactly as they appear in a carrier workbook (ID, COVERAGE, SUB COVERAGE) plus the parent '
  + 'coverage NAME the importer assigned to each. Judge ONLY the parent/child structure, and ONLY by '
  + 'NAME — the ID column is unreliable (ids repeat and are out of order), so never flag a row just '
  + 'because a parent id looks odd. First principles: a populated SUB COVERAGE cell means the row is '
  + 'a child of the coverage named in its COVERAGE cell (so expectedParentName = its COVERAGE value); '
  + 'an empty SUB COVERAGE cell means the row is a top-level coverage (expectedParentName = null). '
  + 'Report only rows whose assignedParentName is wrong. Do not invent rows. Call the tool once.'

async function callJudge(rows: { refId: string; coverage: string; sub: string; assignedParentName: string | null }[]): Promise<JudgeError[]> {
  const table = rows.map(r =>
    `${r.refId} | COVERAGE="${r.coverage}" | SUB="${r.sub}" | assignedParentName=${r.assignedParentName ?? 'null'}`,
  ).join('\n')
  const body = {
    model: JUDGE_MODEL,
    max_tokens: 8000,
    system: JUDGE_SYSTEM,
    tools: [JUDGE_TOOL],
    tool_choice: { type: 'tool', name: JUDGE_TOOL.name },
    messages: [{ role: 'user', content: [{ type: 'text', text: `Rows (source order):\n${table}` }] }],
  }
  const resp = await fetch(`${ENDPOINT}/anthropic/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': ANTHROPIC_VERSION },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })
  if (!resp.ok) throw new Error(`Foundry ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 300)}`)
  const json = await resp.json() as { content?: { type: string; input?: { errors?: JudgeError[] } }[] }
  const tu = (json.content || []).find(b => b.type === 'tool_use')
  return tu?.input?.errors ?? []
}

// Split into batches that each START at a top-level coverage, so every child's group anchor is
// present in the same batch the model reviews.
function batchByGroup<T extends { assignedParentName: string | null }>(rows: T[], target = 140): T[][] {
  const batches: T[][] = []
  let cur: T[] = []
  for (const r of rows) {
    if (cur.length >= target && r.assignedParentName === null) { batches.push(cur); cur = [] }
    cur.push(r)
  }
  if (cur.length) batches.push(cur)
  return batches
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const filter = process.argv[2]
  const files = readdirSync(DIR).filter(f => /\.(xlsx|xlsm)$/i.test(f) && (!filter || f.toLowerCase().includes(filter.toLowerCase())))

  let grandTotal = 0, grandErrors = 0
  for (const f of files) {
    const grids = await readWorkbook(join(DIR, f))
    const plan = mapIsoWorkbook(grids)
    const covs: PlannedEntity[] = plan.coverages
    if (covs.length === 0) continue

    // Reconstruct the raw COVERAGE / SUB columns per coverage from the framework grid (Map is in
    // SOURCE order — critical so coverage groups stay contiguous for batching; plan.coverages is
    // depth-sorted with all top-levels first, which would defeat group-boundary batching).
    const raw = buildRawColumns(grids)
    const parentByRef = new Map(covs.map(c => [c.refId!, (c.data['parentId'] as string | null) ?? null]))
    // Parent NAME = the assigned parent's COVERAGE-column value (ids are unreliable; judge by name).
    const parentNameOf = (refId: string): string | null => {
      const pid = parentByRef.get(refId) ?? null
      if (!pid) return null
      return raw.get(pid)?.coverage || null
    }
    const rows = [...raw.entries()]
      .filter(([refId]) => parentByRef.has(refId))
      .map(([refId, r]) => ({ refId, coverage: r.coverage, sub: r.sub, assignedParentName: parentNameOf(refId) }))

    const nTop = rows.filter(r => !parentByRef.get(r.refId)).length
    console.log(`\n${'='.repeat(80)}\n${f}\n  product=${plan.summary.productRefId} coverages=${rows.length} (top=${nTop} sub=${rows.length - nTop})`)
    const norm = (s: string | null | undefined) => (s ?? '').trim() || null
    const batches = batchByGroup(rows)
    const allErrors: JudgeError[] = []
    let noise = 0
    let failedBatches = 0
    for (let i = 0; i < batches.length; i++) {
      process.stdout.write(`  judging batch ${i + 1}/${batches.length} (${batches[i]!.length} rows)… `)
      try {
        const errs = await callJudge(batches[i]!)
        // Drop AI noise: a "flag" whose expected parent NAME equals the parent name we assigned is
        // not a disagreement (the model sometimes flags then agrees). Compare by NAME (ids are noise).
        const real = errs.filter(e => norm(e.expectedParentName) !== norm(parentNameOf(e.refId)))
        noise += errs.length - real.length
        console.log(real.length ? `${real.length} flagged` : 'clean')
        allErrors.push(...real)
      } catch (e) { failedBatches++; console.log('ERROR', (e as Error).message) }
    }
    if (noise) console.log(`  (filtered ${noise} non-disagreement flag(s) where the model's expected parent matched ours)`)
    if (failedBatches) console.log(`  WARNING: ${failedBatches} batch(es) failed to grade — accuracy below is over graded rows only.`)
    grandTotal += rows.length
    grandErrors += allErrors.length
    const acc = ((rows.length - allErrors.length) / rows.length * 100).toFixed(2)
    console.log(`  ACCURACY: ${acc}%  (${allErrors.length} flagged of ${rows.length})`)
    for (const e of allErrors.slice(0, 25)) {
      console.log(`   ✗ ${e.refId}: assignedParent="${parentNameOf(e.refId) ?? 'null'}" expected="${e.expectedParentName ?? 'null'}" — ${e.reason}`)
    }
  }
  const overall = grandTotal ? ((grandTotal - grandErrors) / grandTotal * 100).toFixed(2) : '—'
  console.log(`\n${'#'.repeat(80)}\nOVERALL ACCURACY: ${overall}%  (${grandErrors} flagged of ${grandTotal} coverages)\n${'#'.repeat(80)}`)
}

/** Reconstruct refId -> { coverage, sub } from the framework sheet's raw cells (first occurrence). */
function buildRawColumns(grids: IsoGrid[]): Map<string, { coverage: string; sub: string }> {
  const out = new Map<string, { coverage: string; sub: string }>()
  const fw = grids.find(g => /product framework|product component model|component model/i.test(g.sheet)
    && !/revision|definition|validation/i.test(g.sheet))
  if (!fw) return out
  // Find header row + the ID / COVERAGE / SUB COVERAGE columns by squished header text.
  const squish = (s: IsoCell) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  let hr = -1, idC = -1, covC = -1, subC = -1
  for (let r = 0; r < Math.min(fw.cells.length, 20); r++) {
    const heads = (fw.cells[r] ?? []).map(squish)
    const id = heads.findIndex(h => h === 'ID' || h === 'PRODUCTFRAMEWORKID' || h === 'FRAMEWORKID')
    const cov = heads.findIndex(h => h === 'COVERAGE')
    const sub = heads.findIndex(h => h === 'SUBCOVERAGE')
    if (id >= 0 && cov >= 0 && sub >= 0) { hr = r; idC = id; covC = cov; subC = sub; break }
  }
  if (hr < 0) return out
  for (let r = hr + 1; r < fw.cells.length; r++) {
    const row = fw.cells[r] ?? []
    const id = String(row[idC] ?? '').trim()
    if (!id || out.has(id)) continue
    const cov = String(row[covC] ?? '').trim()
    const sub = String(row[subC] ?? '').trim()
    if (!cov && !sub) continue
    out.set(id, { coverage: cov, sub })
  }
  return out
}

main().catch(e => { console.error(e); process.exit(1) })
