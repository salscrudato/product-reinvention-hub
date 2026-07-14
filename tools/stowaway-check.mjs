#!/usr/bin/env node
// tools/stowaway-check.mjs — pre-commit stowaway detector for the SHARED checkout.
//
// Problem it kills: several agents share one git index. `git commit` (no pathspec)
// commits EVERYTHING staged — including another lane's staged edits/deletions.
// That exact failure shipped a stowaway deletion of SeedProcessDialog.tsx inside
// import-brain commit 50a7f31 → pipeline run 2432 failed → healed by 92154c6.
//
// Usage (run RIGHT BEFORE committing):
//   node tools/stowaway-check.mjs server/lib/filing.js docs/audit/EXECUTION-B.md ...
//
// Prints every staged index entry OUTSIDE your listed files. Exit 1 if any exist —
// in that case commit ONLY with an explicit pathspec:
//   git commit -m "msg" -- <your-files>
// Deletions (D) are highlighted: they are the most dangerous stowaways because the
// file compiles fine locally (it still exists in your editor's tree view of HEAD)
// and only breaks in CI.

import { execSync } from 'node:child_process'

const mine = new Set(process.argv.slice(2).map((p) => p.replace(/\\/g, '/')))
const out = execSync('git diff --cached --name-status', { encoding: 'utf8' }).trim()

if (!out) {
  console.log('index clean — nothing staged.')
  process.exit(0)
}

let stowaways = 0
for (const line of out.split('\n')) {
  const [status, ...rest] = line.split('\t')
  const file = rest.join('\t').replace(/\\/g, '/')
  const isMine = mine.has(file)
  const isDelete = status.startsWith('D')
  if (!isMine) {
    stowaways++
    console.log(`${isDelete ? '💥 STOWAWAY DELETION' : '⚠️  stowaway'}  ${status}\t${file}`)
  } else {
    console.log(`✓ yours       ${status}\t${file}`)
  }
}

if (stowaways) {
  console.log(`\n${stowaways} staged entr${stowaways === 1 ? 'y' : 'ies'} belong to another lane.`)
  console.log('Commit with an explicit pathspec so they do NOT ride along:')
  console.log('  git commit -m "<msg>" -- <your-files>')
  process.exit(1)
}
console.log('\nno stowaways — a bare commit would be safe (pathspec still recommended).')
