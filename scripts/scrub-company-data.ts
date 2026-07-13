/* eslint-disable no-console */
// scripts/scrub-company-data.ts — genericise company-/client-specific data so nothing confidential
// lives in the repo, the seed, or the test fixtures. Two targets:
//
//   1. WORKBOOKS (samples/iso/*.xlsx|xlsm): rewrites string cell VALUES that contain a sensitive
//      term, and emits a clean, DATA-ONLY .xlsx (exceljs write drops styling + the phantom
//      1,048,576-row extents — exactly the "just structured data" the importer wants). Coverage
//      names, form numbers and refIds are generic insurance data and are left untouched, so the
//      seeded ground truth still holds.
//   2. TEXT (source / docs / fixtures): reports — and with --apply, replaces — the same terms.
//
// SAFE BY DEFAULT: dry-run (report only). Workbook copies are written to samples/iso-scrubbed/
// unless --in-place is given. Text files are only modified with --apply. Renaming sample FILES is
// intentionally NOT automated (it would break path references); the report lists filenames that
// still carry a term so a human can decide.
//
// Usage:
//   npx tsx scripts/scrub-company-data.ts                      # dry run: report everything
//   npx tsx scripts/scrub-company-data.ts --apply              # write scrubbed workbook COPIES
//   npx tsx scripts/scrub-company-data.ts --apply --in-place   # overwrite workbooks in place
//   npx tsx scripts/scrub-company-data.ts --apply --text       # also rewrite source/docs text
//   npx tsx scripts/scrub-company-data.ts --terms "Acme,Globex" # extra terms (comma-separated)

import ExcelJS from 'exceljs'
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join, extname, basename } from 'path'

// ─── Sensitive term rules (find -> generic replacement). Case-insensitive, longest first. ───────
interface Rule { find: RegExp; replace: string; label: string }
const BASE_RULES: Rule[] = [
  { find: /SECURA\s+Insurance\s+Companies/gi, replace: 'Sample Mutual Insurance', label: 'carrier (full)' },
  { find: /SECURA\s+Insurance/gi,             replace: 'Sample Mutual Insurance', label: 'carrier' },
  { find: /\bSECURA\b/gi,                      replace: 'Sample Mutual',           label: 'carrier (short)' },
]
function extraRules(): Rule[] {
  const i = process.argv.indexOf('--terms')
  if (i < 0 || !process.argv[i + 1]) return []
  return process.argv[i + 1]!.split(',').map(t => t.trim()).filter(Boolean)
    .map(t => ({ find: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replace: 'Sample', label: `custom:${t}` }))
}

const APPLY    = process.argv.includes('--apply')
const IN_PLACE = process.argv.includes('--in-place')
const DO_TEXT  = process.argv.includes('--text')   // text (source/docs/fixtures) scrub is opt-in
const ROOT = process.cwd()
const SAMPLES = join(ROOT, 'samples/iso')
const SCRUBBED = join(ROOT, 'samples/iso-scrubbed')

function scrub(s: string, rules: Rule[]): { out: string; hits: number } {
  let out = s, hits = 0
  for (const r of rules) out = out.replace(r.find, () => { hits++; return r.replace })
  return { out, hits }
}

// ─── Workbooks ──────────────────────────────────────────────────────────────
// Reduce a raw exceljs cell to a plain value: strings (incl. rich text / hyperlink / formula
// string results) are returned as strings for scrubbing; numbers / booleans / dates pass through
// unchanged so rating tables keep their numeric values.
function plainCell(v: ExcelJS.CellValue): string | number | boolean | Date | null {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v
  const o = v as unknown as Record<string, unknown>
  if (Array.isArray(o['richText'])) return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
  if ('result' in o) { const r = o['result']; return (typeof r === 'object' || r == null) ? null : (r as string | number | boolean) }
  if ('hyperlink' in o) return String(o['text'] ?? o['hyperlink'] ?? '')
  if ('text' in o) return String(o['text'])
  return null
}

async function scrubWorkbooks(rules: Rule[]) {
  const files = readdirSync(SAMPLES).filter(f => /\.(xlsx|xlsm)$/i.test(f))
  if (APPLY && !IN_PLACE && !existsSync(SCRUBBED)) mkdirSync(SCRUBBED, { recursive: true })
  for (const f of files) {
    const src = new ExcelJS.Workbook()
    await src.xlsx.readFile(join(SAMPLES, f))
    // Rebuild a clean, DATA-ONLY workbook: only the true-data region, values only (no styling, no
    // phantom rows, no macros). This is both the scrub and the "just structured data" cleanup.
    const out = new ExcelJS.Workbook()
    let cellHits = 0
    const samples: string[] = []
    src.eachSheet(ws => {
      let maxRow = 0, maxCol = 0
      ws.eachRow({ includeEmpty: false }, (row, rn) => {
        let lastCol = 0
        row.eachCell({ includeEmpty: false }, (_c, cn) => { if (cn > lastCol) lastCol = cn })
        if (lastCol > 0) { if (rn > maxRow) maxRow = rn; if (lastCol > maxCol) maxCol = lastCol }
      })
      const os = out.addWorksheet(ws.name.slice(0, 31))
      for (let r = 1; r <= maxRow; r++) {
        const rowVals: (string | number | boolean | Date | null)[] = []
        for (let c = 1; c <= maxCol; c++) {
          let v = plainCell(ws.getRow(r).getCell(c).value)
          if (typeof v === 'string') {
            const { out: s, hits } = scrub(v, rules)
            if (hits > 0) {
              cellHits += hits
              if (samples.length < 3) samples.push(`"${v.slice(0, 40)}" -> "${s.slice(0, 40)}"`)
              v = s
            }
          }
          rowVals[c - 1] = v
        }
        os.getRow(r).values = [undefined, ...rowVals] as ExcelJS.CellValue[]  // exceljs is 1-based
      }
    })
    const fileNameHit = scrub(f, rules).hits > 0
    console.log(`  ${f}: ${cellHits} cell hit(s)${fileNameHit ? " [FILENAME still carries a term — not renamed]" : ''}`)
    for (const s of samples) console.log(`      e.g. ${s}`)
    if (APPLY && cellHits > 0) {
      const outName = f.replace(/\.xlsm$/i, '.xlsx')   // data-only output is always .xlsx
      const outPath = IN_PLACE ? join(SAMPLES, outName) : join(SCRUBBED, outName)
      await out.xlsx.writeFile(outPath)
      if (IN_PLACE && outName !== f) rmSync(join(SAMPLES, f))   // drop the old .xlsm
      console.log(`      wrote ${IN_PLACE ? 'IN PLACE' : 'scrubbed copy'}: ${basename(outPath)}${outName !== f ? ` (was ${extname(f)})` : ''}`)
    }
  }
}

// ─── Text files (source / docs / fixtures) ────────────────────────────────────
const TEXT_DIRS = ['shared/src/seed', 'shared/src/insurance', 'shared/src/import', 'tests/fixtures', 'docs']
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.md', '.json'])
function walk(dir: string, acc: string[] = []): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return acc
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = join(dir, e.name)
    if (e.isDirectory()) walk(rel, acc)
    else if (TEXT_EXT.has(extname(e.name))) acc.push(rel)
  }
  return acc
}

function scrubText(rules: Rule[]) {
  let total = 0
  for (const dir of TEXT_DIRS) {
    for (const rel of walk(dir)) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      const { out, hits } = scrub(src, rules)
      if (hits > 0) {
        total += hits
        console.log(`  ${rel}: ${hits} occurrence(s)`)
        if (APPLY && DO_TEXT) writeFileSync(join(ROOT, rel), out)
      }
    }
  }
  if (total === 0) console.log('  (no sensitive terms in scanned text files)')
}

async function main() {
  const rules = [...BASE_RULES, ...extraRules()]
  console.log(`\nscrub-company-data — ${APPLY ? (IN_PLACE ? 'APPLY IN-PLACE' : 'APPLY (scrubbed copies)') : 'DRY RUN'}`)
  console.log(`terms: ${rules.map(r => r.label).join(', ')}\n`)
  console.log('WORKBOOKS (samples/iso):')
  await scrubWorkbooks(rules)
  console.log(`\nTEXT (seed / insurance / import / fixtures / docs)${DO_TEXT ? '' : ' — report only; pass --text to also rewrite'}:`)
  scrubText(rules)
  console.log(`\n${APPLY ? 'Applied.' : 'Dry run only — re-run with --apply to write.'}`)
}

main().catch(e => { console.error(e); process.exit(1) })
