#!/usr/bin/env tsx
/**
 * scripts/ce3-census-export.mts — CE3 accounted-census exporter (ce1-census/v1).
 *
 * For each eval2 corpus file, runs the DETERMINISTIC mapper with a consumedSpans collector
 * and exports a ce1-census/v1 JSON whose per-sheet `accounted` A1 refs are exactly the
 * non-empty cells the pipeline CONSUMED (named-parser spans + conservation claims).
 * Honesty law: a cell is accounted iff a parser walked it into output or the conservation
 * pass harvested/cited it — never "the sheet exists". Cells nothing consumed stay
 * unaccounted and redden eval2's accounting gates; that residue is real, surfaced loss.
 *
 * nonEmpty parity with eval2's reconcileCensus holds BY CONSTRUCTION: this script
 * enumerates cells with the same readWorkbookCells the harness scores with.
 *
 * Usage: tsx scripts/ce3-census-export.mts [--out docs/import-census/ce3-accounted.census.json]
 * Then:  tsx scripts/import-eval2.mts --offline --census docs/import-census/ce3-accounted.census.json
 */
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { mapIsoWorkbook } from '@pf/shared'
import { readWorkbookCells, type EnumWorkbook } from './lib/cell-enum.mts'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dir, '..')
const GOLDENS = resolve(REPO, 'samples/goldens2')
const CORPUS_BASES = [resolve(REPO, 'samples/corpus-2026-07')]
const OUT = ((): string => {
  const i = process.argv.indexOf('--out')
  return resolve(REPO, i >= 0 ? process.argv[i + 1]! : 'docs/import-census/ce3-accounted.census.json')
})()

interface Span { sheet: string; rowStart: number; rowEnd: number; colStart: number; colEnd: number; reason: string }

function colLabel(c: number): string {
  let s = ''
  for (let n = c; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s
  return s
}

function densify(wb: EnumWorkbook) {
  return wb.sheets.map(s => {
    let maxRow = 0, maxCol = 0
    for (const c of s.cells) { if (c.row > maxRow) maxRow = c.row; if (c.col > maxCol) maxCol = c.col }
    const grid: (string | number | boolean | null)[][] = Array.from({ length: maxRow + 1 }, () => Array(maxCol + 1).fill(null))
    for (const c of s.cells) grid[c.row][c.col] = c.value
    return { sheet: s.name, file: wb.file, cells: grid }
  })
}

function findSource(file: string): string | null {
  for (const base of CORPUS_BASES) {
    for (const sub of ['reference', 'hagerty']) {
      const p = join(base, sub, file)
      if (existsSync(p)) return p
    }
  }
  return null
}

async function main() {
  const goldenFiles = existsSync(GOLDENS)
    ? readdirSync(GOLDENS).filter(f => f.endsWith('.golden2.json')).map(f => join(GOLDENS, f))
    : []
  const files: unknown[] = []
  for (const gf of goldenFiles) {
    const g = JSON.parse(readFileSync(gf, 'utf8')) as { file: string }
    const src = findSource(g.file)
    if (!src) { console.log(`  ⚠ ${g.file}: source not found — skipped`); continue }
    const wb = await readWorkbookCells(src)
    const spans: Span[] = []
    mapIsoWorkbook(densify(wb) as never, null, spans as never)
    // Accounted = union of consumed rectangles, intersected with the enumerated non-empty cells.
    const spansBySheet = new Map<string, Span[]>()
    for (const sp of spans) {
      const arr = spansBySheet.get(sp.sheet) ?? []
      arr.push(sp)
      spansBySheet.set(sp.sheet, arr)
    }
    const sheets = wb.sheets.map(s => {
      const shSpans = spansBySheet.get(s.name) ?? []
      const accounted: string[] = []
      for (const c of s.cells) {
        for (const sp of shSpans) {
          if (c.row >= sp.rowStart && c.row <= sp.rowEnd && c.col >= sp.colStart && c.col <= sp.colEnd) {
            accounted.push(`${colLabel(c.col)}${c.row + 1}`)
            break
          }
        }
      }
      return { name: s.name, hidden: s.hidden, nonEmpty: s.cells.length, accounted }
    })
    files.push({ file: g.file, sha256: createHash('sha256').update(readFileSync(src)).digest('hex'), sheets })
    const acc = sheets.reduce((n, sh) => n + sh.accounted.length, 0)
    const tot = sheets.reduce((n, sh) => n + sh.nonEmpty, 0)
    console.log(`  ${g.file}: accounted ${acc}/${tot} (${tot ? Math.round(100 * acc / tot) : 0}%)`)
  }
  writeFileSync(OUT, JSON.stringify({ schema: 'ce1-census/v1', generatedBy: 'scripts/ce3-census-export.mts', files }, null, 1))
  console.log(`census → ${OUT}`)
}
main().catch(e => { console.error(e); process.exit(1) })
