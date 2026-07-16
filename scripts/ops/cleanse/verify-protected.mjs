#!/usr/bin/env node
// verify-protected.mjs - proves the cleanse never touched the protected list.
// Diffs HEAD against the pre-cleanse tag, filtered to protected paths.
// Exits nonzero if anything protected moved (modified/deleted/renamed).
// Usage: node scripts/ops/cleanse/verify-protected.mjs [--tag <tagname>]
//
// Allowed-by-design exceptions (each is an explicit, ordered phase of the cleanse):
// - pnpm-workspace.yaml + root package.json     (Phase 2: unwire functions/ from the gate)
// - samples/corpus-2026-07/                     (Phase 4: new staging folder, additive only)
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const tagIdx = args.indexOf('--tag')
let tag = tagIdx >= 0 ? args[tagIdx + 1] : null

function sh(cmd) { return spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }

if (!tag) {
  const r = sh('git tag --list "pre-cleanse-*" --sort=-creatordate')
  tag = r.stdout.split(/\r?\n/).filter(Boolean)[0]
}
if (!tag) { console.error('ERROR: no pre-cleanse-* tag found'); process.exit(2) }

const PROTECTED = [
  'shared/src',
  'server/lib',
  'app/src',
  'samples',
  'azure-pipelines.yml',
  'orchestration.md',
  'docs/orchestration.md',
  'product_first_principles.md',
  'docs/adr',
  'hardening',
  'docs/ELEVATION_SCOREBOARD.md',
  'package.json',
  'pnpm-workspace.yaml',
  'app/package.json',
  'shared/package.json',
  'server/package.json',
]

const ALLOWED = [
  /^package\.json$/,            // Phase 2 unwire (scripts only)
  /^pnpm-workspace\.yaml$/,     // Phase 2 unwire (workspace list only)
  /^samples\/corpus-2026-07\//, // Phase 4 additive staging folder
  // Foreign edits found mid-run (boot-signature easter-egg removal, authored outside
  // this session) and committed as found work in bd75eef at the user's explicit
  // direction during the Phase 1 hand-off. Not a cleanse purge action.
  /^app\/src\/lib\/capability\.ts$/,
  /^app\/src\/lib\/perf\/reportWebVitals\.ts$/,
]

const pathspec = PROTECTED.map(p => `"${p}"`).join(' ')
const r = sh(`git diff --name-status ${tag}..HEAD -- ${pathspec}`)
if (r.status !== 0) { console.error(r.stderr); process.exit(2) }

const rows = r.stdout.split(/\r?\n/).filter(Boolean)
const violations = []
const allowed = []
for (const row of rows) {
  const parts = row.split('\t')
  const paths = parts.slice(1)
  const isAllowed = paths.every(p => ALLOWED.some(re => re.test(p.replace(/\\/g, '/'))))
  if (isAllowed) allowed.push(row)
  else violations.push(row)
}

console.log(`verify-protected: HEAD vs ${tag}`)
if (allowed.length) {
  console.log('allowed-by-design changes (Phase 2 unwire / Phase 4 staging):')
  for (const a of allowed) console.log('  ' + a)
}
if (violations.length) {
  console.error('PROTECTED VIOLATIONS:')
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('PROTECTED CLEAN: no protected path moved')
