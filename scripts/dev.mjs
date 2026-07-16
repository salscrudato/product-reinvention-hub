#!/usr/bin/env node
// scripts/dev.mjs — one-command local dev: `npm run dev` (or `pnpm dev`) from the
// repo root boots BOTH halves of the platform:
//
//   [api] node server/server.js          (Express host on :8080 — Cosmos/Foundry/Blob)
//   [app] pnpm --filter app dev          (Vite SPA on :5173, /api/* proxied to [api])
//
// Env resolution (secrets NEVER live in code — see CLAUDE.md):
//   1. Your shell env always wins (App-Service-style vars).
//   2. Missing vars are filled from the gitignored keys.md at the repo root — the
//      documented local-dev secret home. Format: markdown rows of `VAR` | `value`
//      (same parse as scripts/annotate-goldens.mts; values are never printed).
//
// The SPA reaches the API through Vite's dev proxy (VITE_DEV_PROXY_TARGET, see
// app/vite.config.ts) so the browser stays same-origin — the server has no CORS
// by design. An existing app/.env.development.local still takes effect for any
// var this script does not set.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.PORT || '8080'

// ─── keys.md → env (fill-only; shell wins; values never logged) ───────────────
function loadKeysMd() {
  const km = resolve(ROOT, 'keys.md')
  if (!existsSync(km)) {
    console.log('[dev] keys.md not found — relying on shell env only.')
    return
  }
  const text = readFileSync(km, 'utf8')
  const filled = []
  for (const m of text.matchAll(/`([A-Z][A-Z0-9_]{2,})`[^|\n]*\|\s*`([^`]+)`/g)) {
    const [, name, value] = m
    if (!process.env[name]) { process.env[name] = value; filled.push(name) }
  }
  console.log(filled.length > 0
    ? `[dev] env filled from keys.md: ${filled.join(', ')}`
    : '[dev] keys.md present; every var already set in the shell.')
}

// ─── child process helpers ────────────────────────────────────────────────────
const children = []
function run(label, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32', // pnpm.cmd / node.exe resolution on Windows
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = (line) => line.split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${label}] ${l}`))
  child.stdout.on('data', (d) => prefix(String(d)))
  child.stderr.on('data', (d) => prefix(String(d)))
  child.on('exit', (code) => {
    console.log(`[dev] ${label} exited (${code ?? 'signal'}) — shutting down.`)
    shutdown(code ?? 1)
  })
  children.push(child)
  return child
}

let stopping = false
function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const c of children) { try { c.kill() } catch { /* already gone */ } }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// ─── boot ─────────────────────────────────────────────────────────────────────
loadKeysMd()

// Local-only JWT secret: the host refuses to boot without one, and keys.md does
// not carry it (it is per-environment, not a shared service credential). An
// ephemeral random secret is correct for local dev — every restart simply
// invalidates local sessions. Set AUTH_JWT_SECRET in your shell to keep sessions
// across restarts.
if (!process.env.AUTH_JWT_SECRET) {
  const { randomBytes } = await import('node:crypto')
  process.env.AUTH_JWT_SECRET = randomBytes(32).toString('hex')
  console.log('[dev] AUTH_JWT_SECRET not set — generated an ephemeral dev secret (sessions reset on restart).')
}

if (!existsSync(resolve(ROOT, 'server/node_modules'))) {
  console.log('[dev] server/node_modules missing — running `npm ci --prefix server` once…')
  const { status } = await import('node:child_process').then(({ spawnSync }) =>
    spawnSync('npm', ['ci', '--prefix', 'server'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }))
  if (status !== 0) { console.error('[dev] server dependency install failed.'); process.exit(status ?? 1) }
}

console.log(`[dev] API host  → http://localhost:${PORT}`)
console.log('[dev] SPA (dev) → http://localhost:5173  (/api proxied to the API host)')

run('api', 'node', ['server/server.js'], { PORT })
run('app', 'pnpm', ['--filter', 'app', 'dev'], { VITE_DEV_PROXY_TARGET: process.env.VITE_DEV_PROXY_TARGET || `http://localhost:${PORT}` })
