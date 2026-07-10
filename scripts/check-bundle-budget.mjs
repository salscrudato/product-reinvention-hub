// check-bundle-budget.mjs — CI bundle-size budget. Fails (exit 1) when the built
// SPA regresses past the gzipped budgets below, so a heavy import can't silently
// bloat first load. Run after `pnpm --filter app build`; wired into azure-pipelines.yml.
//
// Budgets are gzipped KB with headroom over the 2026-07-10 baseline (docs/reviews/
// PERF_BASELINE.md). Raise them deliberately (with a note) — never to paper over a regression.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'dist', 'assets')

// gzipped KB budgets
const BUDGETS = {
  initialCriticalJs: 175, // entry `index` + `vendor-react` + `src` + `rolldown-runtime` (loaded on first paint)
  css: 25,                // the single stylesheet
  routeChunk: 25,         // any lazy route/feature chunk (excludes the heavy lazy `exceljs`)
}
// Chunks that make up the first-paint critical path (by filename prefix).
const CRITICAL = ['index-', 'vendor-react-', 'src-', 'rolldown-runtime-']
// Heavy libs that MUST stay lazy (their own chunk, never in the critical path).
const LAZY_HEAVY = ['exceljs']

const gz = (p) => gzipSync(readFileSync(p)).length / 1024

let files
try { files = readdirSync(ASSETS) } catch { console.error(`✗ no build at ${ASSETS} — run \`pnpm --filter app build\` first`); process.exit(1) }

const js = files.filter((f) => f.endsWith('.js'))
const css = files.filter((f) => f.endsWith('.css'))
const isCritical = (f) => CRITICAL.some((p) => f.startsWith(p))
const isLazyHeavy = (f) => LAZY_HEAVY.some((p) => f.startsWith(p))

const criticalKb = js.filter(isCritical).reduce((s, f) => s + gz(join(ASSETS, f)), 0)
const cssKb = css.reduce((s, f) => s + gz(join(ASSETS, f)), 0)
const routeChunks = js.filter((f) => !isCritical(f) && !isLazyHeavy(f)).map((f) => ({ f, kb: gz(join(ASSETS, f)) }))
const worstRoute = routeChunks.sort((a, b) => b.kb - a.kb)[0] ?? { f: '(none)', kb: 0 }

const fails = []
if (criticalKb > BUDGETS.initialCriticalJs) fails.push(`initial critical JS ${criticalKb.toFixed(1)}kB > ${BUDGETS.initialCriticalJs}kB`)
if (cssKb > BUDGETS.css) fails.push(`CSS ${cssKb.toFixed(1)}kB > ${BUDGETS.css}kB`)
if (worstRoute.kb > BUDGETS.routeChunk) fails.push(`route chunk ${worstRoute.f} ${worstRoute.kb.toFixed(1)}kB > ${BUDGETS.routeChunk}kB`)
// A heavy lib leaking into the critical path (no longer its own lazy chunk) is a hard fail.
for (const h of LAZY_HEAVY) if (!js.some((f) => f.startsWith(h))) fails.push(`${h} is not a standalone lazy chunk — it may have leaked into an eager import`)

console.log('Bundle budget (gzipped KB):')
console.log(`  initial critical JS : ${criticalKb.toFixed(1)} / ${BUDGETS.initialCriticalJs}`)
console.log(`  CSS                 : ${cssKb.toFixed(1)} / ${BUDGETS.css}`)
console.log(`  worst route chunk   : ${worstRoute.kb.toFixed(1)} / ${BUDGETS.routeChunk}  (${worstRoute.f})`)

if (fails.length) { console.error('\n✗ bundle budget exceeded:\n' + fails.map((x) => `   - ${x}`).join('\n')); process.exit(1) }
console.log('\n✓ bundle within budget')
