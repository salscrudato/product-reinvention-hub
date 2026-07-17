// tests/import-brain/fixtures/ce3-kill-runner.mjs — CE3 Step 7 kill-test child.
//
// Plain-node runner (no vitest): drives stage-4 extraction over three synthetic
// sheets with a STUBBED global fetch (zero spend, deterministic, ~300ms per model
// call so the parent can SIGKILL mid-stage-4). Every extraction call is appended to
// <dir>/call-log.jsonl with its sheet name; every completed sheet checkpoint is
// written to <dir>/checkpoint-<sheet>.json (the same per-sheet artifact shape the
// production onStage persists). Resume mode reloads those checkpoints as
// extras.completedSheets — the exact production seam — and MUST NOT re-extract them.
//
// Usage: node ce3-kill-runner.mjs <dir> run|resume
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dir = path.dirname(fileURLToPath(import.meta.url))
const [dir, mode] = process.argv.slice(2)
if (!dir || !mode) { console.error('usage: ce3-kill-runner.mjs <dir> run|resume'); process.exit(2) }
fs.mkdirSync(dir, { recursive: true })

// Foundry env stubs so fleet URL builders produce strings (fetch is stubbed anyway).
process.env.AZURE_FOUNDRY_ENDPOINT = process.env.AZURE_FOUNDRY_ENDPOINT || 'http://stub.local'
process.env.AZURE_FOUNDRY_KEY = process.env.AZURE_FOUNDRY_KEY || 'stub-key'

const CALL_LOG = path.join(dir, 'call-log.jsonl')
const SHEETS = ['Alpha Coverages', 'Beta Coverages', 'Gamma Coverages']

const delay = (ms) => new Promise(r => setTimeout(r, ms))
globalThis.fetch = async (url, opts) => {
  const body = String(opts && opts.body || '')
  const sheet = SHEETS.find(s => body.includes(s)) || null
  fs.appendFileSync(CALL_LOG, JSON.stringify({ mode, sheet, url: String(url).slice(0, 60) }) + '\n')
  await delay(300) // slow enough for the parent to SIGKILL mid-stage-4
  const entityJson = JSON.stringify({ entities: [{ kind: 'coverage', sourceRowIndex: 0, occurrence: 0, fields: [{ fieldName: 'refId', value: 'GL.COV.001', confidence: 0.9, citation: { sheet: sheet || 'S', cell: 'A2', verbatim: 'GL.COV.001' } }] }] })
  if (String(url).includes('/anthropic')) {
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: entityJson }], usage: { input_tokens: 5, output_tokens: 5 } }), headers: { get: () => null } }
  }
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: entityJson, tool_calls: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } }), headers: { get: () => null } }
}

const { extractRows } = require(path.join(__dir, '../../../server/lib/import-brain/stage4-extract.js'))

const fpOf = (name) => ({
  sheetName: name,
  layoutShape: 'GRID',
  bestHeaderRow: 0,
  cells: [
    ['refId', 'name'],
    ['GL.COV.001', `${name} coverage one`],
    ['GL.COV.002', `${name} coverage two`],
  ],
  columnProfiles: [
    { colIndex: 0, headerLabel: 'refId', typeMix: { string: 2 }, distinctSample: ['GL.COV.001'] },
    { colIndex: 1, headerLabel: 'name', typeMix: { string: 2 }, distinctSample: ['x'] },
  ],
})
const classified = SHEETS.map(s => ({ sheetName: s, domain: 'framework' }))
const locks = SHEETS.map(s => ({ sheetName: s, headerRowIndex: 0 }))
// LOW map confidence => AI extraction path (the deterministic fast path must not
// swallow the stage-4 calls the kill-test measures).
const colMaps = SHEETS.map(s => ({ sheetName: s, mappings: [
  { colIndex: 0, canonicalField: 'refId', entityKind: 'coverage', confidence: 0.5 },
  { colIndex: 1, canonicalField: 'name', entityKind: 'coverage', confidence: 0.5 },
], unmappedIndices: [] }))
const fpByName = new Map(SHEETS.map(s => [s, fpOf(s)]))

const completedSheets = new Map()
if (mode === 'resume') {
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('checkpoint-')) continue
    const art = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    if (art.sheetName && Array.isArray(art.entities)) completedSheets.set(art.sheetName, art.entities)
  }
}

const budget = { noCap: true, spendUsd: 0, calls: 0, byDeployment: {} }
const entities = await extractRows(classified, locks, colMaps, fpByName, budget, [], undefined, undefined, {
  completedSheets,
  onSheetComplete: async (sheetName, sheetEntities) => {
    fs.writeFileSync(path.join(dir, `checkpoint-${sheetName.replace(/[^A-Za-z0-9]/g, '_')}.json`),
      JSON.stringify({ sheetName, entities: sheetEntities }))
  },
})
fs.writeFileSync(path.join(dir, `done-${mode}.json`), JSON.stringify({ entities: entities.length, restored: completedSheets.size }))
process.exit(0)
