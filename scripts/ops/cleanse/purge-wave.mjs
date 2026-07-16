#!/usr/bin/env node
// purge-wave.mjs - executes one cleanse wave from a manifest JSON.
// Usage: node scripts/ops/cleanse/purge-wave.mjs <wave.json> [--dry-run] [--archive-root <dir>]
//
// Manifest shape:
// {
//   "wave": "A",
//   "archiveRoot": "C:/Users/me/hub-archive/2026-07-16",   // optional, --archive-root wins
//   "items": [
//     { "path": "some/dir-or-file", "action": "delete" | "archive", "reason": "why",
//       "verifyIdenticalTo": "other/path" }                 // optional: hash-compare before delete
//   ]
// }
//
// Rules:
// - archive: copy to <archiveRoot>/wave-<wave>/<path> preserving relative layout, then remove.
// - delete: remove outright.
// - tracked items are removed via `git rm -r -q --force`; untracked via plain fs deletion.
// - verifyIdenticalTo: sha256 both sides; on mismatch the item is SKIPPED and flagged (exit 1 at end).
// - every executed action is appended to CLEANSE_MANIFEST.md at the repo root.
// - missing paths are recorded as SKIPPED-MISSING (warning, not fatal) so reruns are idempotent.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync, cpSync, existsSync, lstatSync, mkdirSync,
  readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const manifestPath = args.find(a => !a.startsWith('--'))
const DRY = args.includes('--dry-run')
const arIdx = args.indexOf('--archive-root')
if (!manifestPath) { console.error('usage: purge-wave.mjs <wave.json> [--dry-run] [--archive-root <dir>]'); process.exit(2) }

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const wave = manifest.wave || 'X'
const archiveRoot = arIdx >= 0 ? args[arIdx + 1] : manifest.archiveRoot
const LOG = 'CLEANSE_MANIFEST.md'

function sh(cmd) { return spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }

function isTracked(p) {
  // Tracked if git ls-files reports anything at/under the path.
  const r = sh(`git ls-files --cached -- "${p}"`)
  return r.status === 0 && r.stdout.trim().length > 0
}

function dirSize(p) {
  const st = lstatSync(p)
  if (st.isFile()) return st.size
  if (!st.isDirectory()) return 0
  let total = 0
  for (const e of readdirSync(p)) {
    try { total += dirSize(join(p, e)) } catch { /* ignore */ }
  }
  return total
}

function mb(bytes) { return (bytes / 1024 / 1024).toFixed(2) }

function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

function logRow(row) {
  if (!existsSync(LOG)) {
    writeFileSync(LOG, '# CLEANSE MANIFEST\n\nEvery destructive action taken by the cleanse, appended by purge-wave.mjs.\n\n| wave | path | action | size (MB) | tracked | destination | reason |\n|---|---|---|---|---|---|---|\n')
  }
  appendFileSync(LOG, row + '\n')
}

let failures = 0
let totalBytes = 0
let executed = 0

console.log(`WAVE ${wave} - ${manifest.items.length} item(s) - ${DRY ? 'DRY RUN' : 'EXECUTE'}`)
if (manifest.items.some(i => i.action === 'archive') && !archiveRoot) {
  console.error('ERROR: wave contains archive actions but no archive root given')
  process.exit(2)
}

for (const item of manifest.items) {
  const { path: p, action, reason, verifyIdenticalTo } = item
  if (!existsSync(p)) {
    console.log(`SKIPPED-MISSING  ${p}`)
    if (!DRY) logRow(`| ${wave} | ${p} | SKIPPED-MISSING | - | - | - | ${reason} |`)
    continue
  }
  const size = dirSize(p)
  const tracked = isTracked(p)

  if (verifyIdenticalTo) {
    if (!existsSync(verifyIdenticalTo)) {
      console.error(`VERIFY-FAIL ${p}: comparison target missing: ${verifyIdenticalTo}`)
      failures++; continue
    }
    const a = sha256(p), b = sha256(verifyIdenticalTo)
    if (a !== b) {
      console.error(`VERIFY-FAIL ${p}: NOT byte-identical to ${verifyIdenticalTo} - skipped`)
      failures++; continue
    }
    console.log(`VERIFIED identical: ${p} == ${verifyIdenticalTo} (sha256 ${a.slice(0, 12)})`)
  }

  let dest = '-'
  if (action === 'archive') dest = join(archiveRoot, `wave-${wave}`, p)

  console.log(`${DRY ? 'PLAN' : 'DO'}  ${action.toUpperCase().padEnd(7)} ${mb(size).padStart(9)} MB  ${tracked ? 'tracked  ' : 'untracked'}  ${p}${action === 'archive' ? ' -> ' + dest : ''}`)

  if (DRY) { totalBytes += size; continue }

  if (action === 'archive') {
    mkdirSync(dirname(resolve(dest)), { recursive: true })
    cpSync(p, dest, { recursive: true })
    if (!existsSync(dest)) { console.error(`ARCHIVE-COPY-FAIL ${p}`); failures++; continue }
  }

  if (tracked) {
    const r = sh(`git rm -r -q --force -- "${p}"`)
    if (r.status !== 0) { console.error(`git rm failed for ${p}: ${r.stderr}`); failures++; continue }
    // git rm leaves untracked leftovers (e.g. gitignored files inside the dir) - sweep them.
    if (existsSync(p)) rmSync(p, { recursive: true, force: true })
  } else {
    rmSync(p, { recursive: true, force: true })
  }

  logRow(`| ${wave} | ${p} | ${action} | ${mb(size)} | ${tracked ? 'yes' : 'no'} | ${action === 'archive' ? dest : '-'} | ${(reason || '').replace(/\|/g, '/')} |`)
  totalBytes += size
  executed++
}

console.log(`\nWAVE ${wave} ${DRY ? 'PLAN' : 'DONE'}: ${DRY ? manifest.items.length : executed} item(s), ${mb(totalBytes)} MB${failures ? `, ${failures} FAILURE(S)` : ''}`)
process.exit(failures ? 1 : 0)
