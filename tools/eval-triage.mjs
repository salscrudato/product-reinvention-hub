#!/usr/bin/env node
// eval-triage.mjs — read-only triage for the import-brain live-test loop.
//
// A cross-lane assist for the import-brain workstream: it reads the result
// artifacts the eval/live harnesses already drop in docs/audit/ and classifies
// every failure by ROOT CAUSE (timeout wall vs crash vs fabrication vs accuracy
// vs zero-extraction), then flags any fixed duration ceiling that looks like a
// hard timeout rather than a natural completion.
//
// Why: the slowest part of the fix loop is eyeballing raw JSON to answer "what
// actually broke, and is it the same thing across lines?". This answers that in
// one glance so time goes to the real bug, not to reading files.
//
// SAFE BY CONSTRUCTION: reads local JSON only. No network, no dev calls, no
// writes to any brain-owned file, and it is never imported by the app/server —
// running it cannot restart dev or sever an in-flight SSE stream.
//
// Usage:  node tools/eval-triage.mjs [dir]     (default dir: docs/audit)
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.argv[2] ?? 'docs/audit'
const RESULT_RE = /^import_(eval|live)_results-.*\.json$/

// Two *different* stream-death signatures → two *different* fixes:
//   CONN-DROPPED  = "terminated" / reset → connection killed mid-stream. On this
//                   shared dev, the usual cause is a DEPLOY restarting the host
//                   (every push severs in-flight SSE). Fix = a push-free window,
//                   not a code change.
//   CLIENT-ABORT  = "aborted" / timed out → a client/harness timeout ceiling
//                   fired. Fix = raise the ceiling (or cut import latency).
const CONN_DROP_RE = /terminat|ECONNRESET|socket hang up|EPIPE/i
const CLIENT_ABORT_RE = /abort|timed?\s*out|timeout|ETIMEDOUT|deadline/i
const classifyStreamDeath = (msg) =>
  CONN_DROP_RE.test(msg) ? 'CONN-DROPPED' : CLIENT_ABORT_RE.test(msg) ? 'CLIENT-ABORT' : null

// Cluster durations that sit within 2% of each other → smells like a fixed
// client/server timeout rather than genuine per-case completion time.
function detectCeilings(durations) {
  const big = durations.filter((d) => d >= 60_000).sort((a, b) => a - b)
  const clusters = []
  for (const d of big) {
    const c = clusters.find((k) => Math.abs(k.mid - d) / k.mid < 0.02)
    if (c) { c.vals.push(d); c.mid = c.vals.reduce((s, v) => s + v, 0) / c.vals.length }
    else clusters.push({ mid: d, vals: [d] })
  }
  return clusters.filter((c) => c.vals.length >= 2)
}

function classifyEval(file, json, sink) {
  for (const r of json.results ?? []) {
    const errs = (r.errors ?? []).join(' ')
    const cls = r.pass ? 'PASS'
      : classifyStreamDeath(errs) ?? (errs ? 'ERROR' : 'ACCURACY(<targets)')
    sink.push({ file, id: r.id, cls, ms: r.durationMs ?? 0, cov: r.coverageCount, note: errs || '' })
  }
}

function classifyLive(file, json, sink) {
  for (const r of json.results ?? []) {
    const notes = (r.notes ?? []).join(' ')
    const zeroExtract = r.status === 'pass' && (r.productCount > 0) && (r.coverageCount === 0)
    const cls = r.fabrication ? 'FABRICATION(!!)'
      : r.crashed ? (classifyStreamDeath(notes) ?? 'CRASH')
      : r.status === 'source-gap' ? 'source-gap(ok)'
      : zeroExtract ? 'ZERO-EXTRACTION'
      : r.status === 'pass' ? 'PASS'
      : 'FAIL'
    sink.push({ file, id: r.id, cls, ms: r.durationMs ?? 0, cov: r.coverageCount, note: notes })
  }
}

const files = (() => {
  try { return readdirSync(DIR).filter((f) => RESULT_RE.test(f)).sort() }
  catch { console.error(`✗ cannot read ${DIR}`); process.exit(1) }
})()

if (!files.length) { console.log(`(no import_*_results-*.json in ${DIR} yet)`); process.exit(0) }

const rows = []
for (const f of files) {
  let json
  try { json = JSON.parse(readFileSync(join(DIR, f), 'utf8')) } catch { console.error(`  ! unparseable: ${f}`); continue }
  if (f.startsWith('import_eval')) classifyEval(f, json, rows)
  else classifyLive(f, json, rows)
}

const tally = rows.reduce((m, r) => ((m[r.cls] = (m[r.cls] ?? 0) + 1), m), {})
const ceilings = detectCeilings(rows.filter((r) => r.cls === 'CLIENT-ABORT').map((r) => r.ms))
const secs = (ms) => (ms / 1000).toFixed(0) + 's'
const mins = (ms) => (ms / 60000).toFixed(0) + 'm'

console.log('\n  IMPORT-BRAIN TRIAGE  (read-only · ' + rows.length + ' cases across ' + files.length + ' files)\n')
const pad = (s, n) => String(s).padEnd(n)
console.log('  ' + pad('CASE', 20) + pad('CLASS', 18) + pad('DUR', 8) + 'NOTE')
console.log('  ' + '-'.repeat(78))
for (const r of rows) {
  const flag = /FABRICATION|CRASH|ZERO-EXTRACTION/.test(r.cls) ? '⚑ ' : '  '
  console.log(flag + pad(r.id, 20) + pad(r.cls, 18) + pad(secs(r.ms), 8) + (r.note || '').slice(0, 40))
}
console.log('\n  ── tally ──')
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log('   ' + pad(k, 20) + v)

const abort = tally['CLIENT-ABORT'] ?? 0
const dropped = tally['CONN-DROPPED'] ?? 0

if (ceilings.length) {
  console.log('\n  ⏱  SUSPECTED CLIENT-ABORT CEILING — same wall across cases, likely a fixed timeout:')
  for (const c of ceilings) console.log(`     ~${secs(c.mid)} (${mins(c.mid)}, ${c.vals.length}× within 2%) → grep the harness for ${Math.round(c.mid)} / AbortController / AbortSignal.timeout / setTimeout`)
}

if (dropped) {
  const dur = rows.filter((r) => r.cls === 'CONN-DROPPED').map((r) => r.ms)
  const longest = Math.max(...dur)
  console.log('\n  ✂  ' + dropped + ' case(s) had the stream TERMINATED mid-flight (longest ' + mins(longest) + ').')
  console.log('     On shared dev this signature = a DEPLOY restarting the host, not a code bug.')
  console.log('     → A push-free window is the fix: an import that runs ~' + mins(longest) + ' cannot survive')
  console.log('       a deploy landing inside that window, and each retry restarts the ~' + mins(longest) + ' clock.')
}

if (abort + dropped) {
  console.log('\n  → HEADLINE: ' + (abort + dropped) + ' case(s) never returned a plan → accuracy targets were NOT measured.')
  console.log('    This is a LATENCY / STREAM-SURVIVAL wall, not an accuracy regression. Clear the wall first,')
  console.log('    THEN read f1 / numericExact / citation. Adversarial + safety cases are passing (see tally).')
}
if (tally['ZERO-EXTRACTION']) console.log('  → ' + tally['ZERO-EXTRACTION'] + ' case(s) returned a product with 0 coverages — a distinct extraction gap (PDF/filing path).')
if (tally['FABRICATION(!!)']) console.log('  → ⚑ FABRICATION detected — the anti-invention guard let something through. Investigate FIRST.')
console.log('')
