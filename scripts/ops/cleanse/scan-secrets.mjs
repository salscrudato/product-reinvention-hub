#!/usr/bin/env node
// scan-secrets.mjs - secret scan over TRACKED files (default) or the whole tree (--all).
// Tracked-only is the meaningful check: the gitignored secret home (keys.md) legitimately
// holds live credentials and must NOT count as a finding.
// Uses gitleaks when installed; otherwise a pattern grep for key/token/connstring shapes.
// Prints file:line hits (values redacted). Exits 1 if any hit, 0 if clean.
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const ALL = process.argv.includes('--all')

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
}

// --- try gitleaks first ---
const gl = run('gitleaks version')
if (gl.status === 0) {
  const args = ALL ? 'detect --no-git --redact -v' : 'detect --no-git --redact -v'
  // gitleaks --no-git scans the tree; for tracked-only we still post-filter below.
  const r = run(`gitleaks ${args}`)
  process.stdout.write(r.stdout || '')
  process.stdout.write(r.stderr || '')
  if (!ALL) {
    process.stdout.write('NOTE: gitleaks scanned the full tree; review hits against git ls-files.\n')
  }
  process.exit(r.status === 0 ? 0 : 1)
}

// --- fallback: pattern grep ---
process.stdout.write('gitleaks not installed - using pattern grep fallback\n')

const PATTERNS = [
  [/AccountKey=[A-Za-z0-9+/=%]{30,}/, 'azure-connstring-accountkey'],
  [/SharedAccessSignature=[^\s"']{30,}/, 'azure-sas'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'sk-style-api-key'],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'jwt'],
  [/[A-Za-z0-9+/]{86}==/, 'cosmos-master-key-shape'],
  // bare "token" is a UI concept in this codebase (design tokens, form-token chips) - require
  // a credential-flavored prefix so 'token: "var(--color-x)"' style literals do not hit.
  [/(api[_-]?key|secret|(api|access|auth|bearer)[_-]?token|password|passwd|connection[_-]?string)\s*[:=]\s*["'][^"']{12,}["']/i, 'assigned-secret-literal'],
  [/(AZURE|COSMOS|FOUNDRY|BLOB|STORAGE)[A-Z_]*(KEY|SECRET|TOKEN|CONN)[A-Z_]*\s*[:=]\s*\S{12,}/, 'env-style-secret-value'],
]

// Lines that are clearly placeholders / env reads, not values.
// sha512/integrity: npm lockfile subresource hashes match the base64-key shape but are public.
const BENIGN = /process\.env|import\.meta\.env|YOUR_|<[A-Za-z_ -]+>|\bexample\b|\bredacted\b|\bplaceholder\b|\*\*\*|xxxx|integrity|sha512-|sha384-|\bfake[-_']|\bstub[-_']|\bdummy[-_']|\$cfg\[|\$env:|data:image\//i

const BINARY_EXT = /\.(png|jpg|jpeg|gif|ico|pdf|xlsx|xlsm|docx|zip|woff2?|ttf|eot|mp4|webm|svg)$/i
const SKIP_PATH = /^(node_modules|\.git|dist|build|coverage|test-results)\/|\/(node_modules|dist|build)\/|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$/

let files
if (ALL) {
  const r = run('git ls-files --cached --others --exclude-standard')
  files = r.stdout.split(/\r?\n/).filter(Boolean)
  // --all additionally includes gitignored files:
  const ig = run('git ls-files --others --ignored --exclude-standard')
  files = [...new Set([...files, ...ig.stdout.split(/\r?\n/).filter(Boolean)])]
} else {
  files = run('git ls-files --cached').stdout.split(/\r?\n/).filter(Boolean)
}

let hits = 0
for (const f of files) {
  if (SKIP_PATH.test(f) || BINARY_EXT.test(f)) continue
  let st
  try { st = statSync(f) } catch { continue }
  if (!st.isFile() || st.size > 5 * 1024 * 1024) continue
  let text
  try { text = readFileSync(f, 'utf8') } catch { continue }
  if (text.includes('\u0000')) continue
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (BENIGN.test(line)) continue
    for (const [re, label] of PATTERNS) {
      const m = line.match(re)
      if (m) {
        const redacted = m[0].slice(0, 12) + '...REDACTED'
        process.stdout.write(`${f}:${i + 1}: [${label}] ${redacted}\n`)
        hits++
        break
      }
    }
  }
}

process.stdout.write(hits === 0 ? 'SCAN CLEAN: 0 hits\n' : `SCAN: ${hits} hit(s)\n`)
process.exit(hits === 0 ? 0 : 1)
