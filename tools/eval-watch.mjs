#!/usr/bin/env node
// eval-watch.mjs — one-shot "did a clean run land yet?" check for the import loop.
//
// Read-only. Exits 0 the moment a real import COMPLETES (produces a plan / measured
// result) instead of being killed by a timeout/abort/deploy-severance; exits 1 while
// everything is still being guillotined. Pair with the Monitor tool (or any until-loop)
// to get flagged exactly once, when the harness-timeout fix + push-freeze finally let a
// golden line finish. No network, no writes, never imported by app/server.
//
// Usage: node tools/eval-watch.mjs [dir]   (default docs/audit)
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'docs/audit'
const DEATH_RE = /abort|terminat|ECONNRESET|socket|timed?\s*out|other side closed|EPIPE/i

const files = (() => {
  try { return readdirSync(DIR).filter((f) => /^import_(eval|live)_results-.*\.json$/.test(f)) }
  catch { console.log('waiting: no result dir yet'); process.exit(1) }
})()

const landed = []   // real imports that completed (not guillotined)
const killed = []   // still dying on timeout/abort/severance

for (const f of files) {
  let j
  try { j = JSON.parse(readFileSync(join(DIR, f), 'utf8')) } catch { continue }
  const isEval = f.startsWith('import_eval')
  for (const r of j.results ?? []) {
    const id = r.id ?? f
    if (isEval) {
      const errs = (r.errors ?? []).join(' ')
      if (DEATH_RE.test(errs)) killed.push(id)
      else landed.push({ id, pass: r.pass, why: r.pass ? 'PASS' : 'completed (measured, <targets)' })
    } else {
      // live: a full (non-adversarial) import that produced a plan and wasn't killed
      const notes = (r.notes ?? []).join(' ')
      const full = /XLSX|PDF|FILING/i.test(r.format ?? '') && !/ADVERSARIAL/i.test(r.format ?? '')
      if (!full) continue
      if (r.crashed && DEATH_RE.test(notes)) killed.push(id)
      else if (r.planValid || r.status === 'pass') landed.push({ id, pass: r.status === 'pass', why: r.coverageCount > 0 ? `plan, ${r.coverageCount} coverages` : 'plan, 0 coverages' })
    }
  }
}

// Optional gate: --require=CORE,GL,IM,PR → only fire when EVERY named line has landed
// (and none of them is currently killed). Without it, fire as soon as ANY line lands.
const reqArg = process.argv.find((a) => a.startsWith('--require='))
const required = reqArg ? reqArg.slice('--require='.length).split(',').map((s) => s.trim()).filter(Boolean) : null
const landedIds = new Set(landed.map((l) => l.id))
const killedSet = new Set(killed)

const fire = required
  ? required.every((id) => landedIds.has(id) && !killedSet.has(id))
  : landed.length > 0

if (fire) {
  console.log(required ? `ALL LANDED ✓ (${required.join(', ')}):` : 'LANDED ✓ — a real import completed:')
  for (const l of landed) console.log(`   ${l.pass ? '✅' : '▲'} ${l.id} — ${l.why}`)
  if (killed.length) console.log(`   (still guillotined: ${[...new Set(killed)].join(', ')})`)
  process.exit(0)
}

const pend = required ? required.filter((id) => !landedIds.has(id) || killedSet.has(id)) : []
console.log(`waiting: ${required ? 'pending [' + pend.join(',') + ']; landed [' + [...landedIds].join(',') + ']' : (killed.length ? killed.length + ' still killed' : 'no completed runs yet')}`)
process.exit(1)
