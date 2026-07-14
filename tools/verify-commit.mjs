#!/usr/bin/env node
// tools/verify-commit.mjs — gate the EXACT commit you are about to push, immune to
// the shared checkout's dirty working tree.
//
// Problem it kills: `pnpm build` in the shared checkout gates the WORKING TREE —
// which contains every other agent's half-finished edits — not your commit. Agents
// have seen both false reds (another lane mid-edit) and false greens (your commit
// carries a stowaway the tree hides, e.g. run 2432's staged deletion). This script
// checks out a sha into a DETACHED temp worktree (no branch, no stash, shared tree
// untouched) and runs the gate there.
//
// Usage:
//   node tools/verify-commit.mjs               # verifies HEAD, typecheck only (fast)
//   node tools/verify-commit.mjs <sha> --full  # typecheck + lint + test + build
//
// Exit 0 = that commit is green as it will ship; non-zero = do NOT push it.

import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const full = args.includes('--full')
const sha = args.find((a) => !a.startsWith('--')) || 'HEAD'
const resolved = execSync(`git rev-parse ${sha}`, { encoding: 'utf8' }).trim()

const wt = mkdtempSync(join(tmpdir(), 'pf-verify-'))
console.log(`verifying ${resolved.slice(0, 9)} in detached worktree ${wt}`)

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}`)
  const r = spawnSync(cmd, { cwd, shell: true, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`\n❌ FAILED: ${cmd} (exit ${r.status}) — commit ${resolved.slice(0, 9)} is NOT safe to push.`)
    cleanup()
    process.exit(r.status || 1)
  }
}

function cleanup() {
  try { execSync(`git worktree remove --force "${wt}"`, { stdio: 'ignore' }) } catch { /* fall through */ }
  try { rmSync(wt, { recursive: true, force: true }); execSync('git worktree prune', { stdio: 'ignore' }) } catch { /* best effort */ }
}

try {
  execSync(`git worktree add --detach "${wt}" ${resolved}`, { stdio: 'inherit' })
  // Shared pnpm store makes this cheap; node_modules is fresh so postinstall runs.
  run('pnpm install --silent', wt)
  run('pnpm typecheck', wt)
  if (full) {
    run('pnpm lint', wt)
    run('pnpm test', wt)
    run('pnpm build', wt)
  }
  console.log(`\n✅ commit ${resolved.slice(0, 9)} is green (${full ? 'full gate' : 'typecheck'}) — safe to push.`)
} finally {
  cleanup()
}
