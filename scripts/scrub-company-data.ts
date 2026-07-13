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
//   npx tsx scripts/scrub-company-data.ts                 # dry run: report everything
//   npx tsx scripts/scrub-company-data.ts --apply         # write scrubbed workbook copies + text
//   npx tsx scripts/scrub-company-data.ts --apply --in-place   # overwrite workbooks in place
//   npx tsx scripts/scrub-company-data.ts --terms "Acme,Globex"  # extra terms (comma-separated)

import ExcelJS from 'exceljs'
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
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
const ROOT = process.cwd()
const SAMPLES = join(ROOT, 'samples/iso')
const SCRUBBED = join(ROOT, 'samples/iso-scrubbed')

function scrub(s: string, rules: Rule[]): { out: string; hits: number } {
  let out = s, hits = 0
  for (const r of rules) out = out.replace(r.find, () => { hits++; return r.replace })
  return { out, hits }
}

// ─── Workbooks ──────────────────────────────────────────────────────────────
function flat(v: ExcelJS.CellValue): string | null {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && 'richText' in (v as object)) {
    return (v as { richText: { text?: string }[] }).richText.map(t => t.text ?? '').join('')
  }
  return null
}

async function scrubWorkbooks(rules: Rule[]) {
  const files = readdirSync(SAMPLES).filter(f => /\.(xlsx|xlsm)$/i.test(f))
  if (APPLY && !IN_PLACE && !existsSync(SCRUBBED)) mkdirSync(SCRUBBED, { recursive: true })
  for (const f of files) {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(join(SAMPLES, f))
    let cellHits = 0
    const samples: string[] = []
    wb.eachSheet(ws => {
      ws.eachRow({ includeEmpty: false }, row => {
        row.eachCell({ includeEmpty: false }, cell => {
          const s = flat(cell.value)
          if (s == null) return
          const { out, hits } = scrub(s, rules)
          if (hits > 0) {
            cellHits += hits
            if (samples.length < 3) samples.push(`"${s.slice(0, 40)}" -> "${out.slice(0, 40)}"`)
            if (APPLY) cell.value = out
          }
        })
      })
    })
    const fileNameHit = scrub(f, rules).hits > 0
    console.log(`  ${f}: ${cellHits} cell hit(s)${fileNameHit ? ' [FILENAME also carries a term — rename manually]' : ''}`)
    for (const s of samples) console.log(`      e.g. ${s}`)
    if (APPLY && cellHits > 0) {
      const outName = f.replace(/\.xlsm$/i, '.xlsx')   // data-only copy is always .xlsx
      const outPath = IN_PLACE ? join(SAMPLES, f) : join(SCRUBBED, outName)
      await wb.xlsx.writeFile(outPath)
      console.log(`      wrote ${IN_PLACE ? 'IN PLACE' : 'scrubbed copy'}: ${outPath}`)
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
        if (APPLY) writeFileSync(join(ROOT, rel), out)
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
  console.log('\nTEXT (seed / insurance / import / fixtures / docs):')
  scrubText(rules)
  console.log(`\n${APPLY ? 'Applied.' : 'Dry run only — re-run with --apply to write.'}`)
}

main().catch(e => { console.error(e); process.exit(1) })
