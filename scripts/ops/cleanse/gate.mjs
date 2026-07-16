#!/usr/bin/env node
// gate.mjs - runs the full repo gate with per-step timing.
// Usage: node scripts/ops/cleanse/gate.mjs
// Exits nonzero on the first red step. Prints a timing summary either way.
import { spawnSync } from 'node:child_process'

const STEPS = [
  ['typecheck', 'pnpm typecheck'],
  ['lint', 'pnpm lint'],
  ['test', 'pnpm test'],
  ['build', 'pnpm build'],
]

const results = []
let failed = null

for (const [name, cmd] of STEPS) {
  process.stdout.write(`\n=== GATE STEP: ${name} (${cmd}) ===\n`)
  const t0 = Date.now()
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' })
  const ms = Date.now() - t0
  const ok = r.status === 0
  results.push({ name, ms, ok })
  if (!ok) { failed = name; break }
}

process.stdout.write('\n=== GATE SUMMARY ===\n')
for (const { name, ms, ok } of results) {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(10)} ${(ms / 1000).toFixed(1)}s\n`)
}
if (failed) {
  process.stdout.write(`GATE RED at step: ${failed}\n`)
  process.exit(1)
}
process.stdout.write(`GATE GREEN (total ${(results.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1)}s)\n`)
