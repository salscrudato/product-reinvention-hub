// guard-backend.mjs — startup guard for the local dev app.
//
// The footgun (see docs/reviews/GROUND_TRUTH.md V12): `pnpm dev` runs Vite in `development`
// mode, which loads app/.env.development[.local]. Those pin VITE_USE_EMULATORS=false, so the
// BROWSER silently reads/writes the LIVE "productreinvention" Firebase project — even under
// `pnpm dev:seed`, where the emulators are running but the app ignores them.
//
// This guard runs BEFORE Vite. It resolves the effective VITE_USE_EMULATORS for the target mode
// (replicating Vite's env-file precedence), prints which backend the session will target, and
// REFUSES to start against the live project unless ALLOW_LIVE=1 is set. The seed scripts carry
// their own ALLOW_LIVE gate (scripts/seed.ts). See CLAUDE.md → "Environment safety".
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir   = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(__dir, '..', 'app')
const mode    = process.argv[2] || 'development'

// Minimal .env parser: KEY=VALUE lines; ignores blanks + `#` comments; strips matching quotes.
function parseEnv(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

// Vite precedence — later overrides earlier: .env < .env.local < .env.[mode] < .env.[mode].local
const env = {}
for (const f of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
  Object.assign(env, parseEnv(resolve(APP_DIR, f)))
}
// A shell-level VITE_USE_EMULATORS still wins over the files (matches Vite).
const useEmulators = (process.env.VITE_USE_EMULATORS ?? env.VITE_USE_EMULATORS) === 'true'
const target = useEmulators
  ? 'LOCAL Firebase Emulator Suite (127.0.0.1)'
  : 'the LIVE "productreinvention" Firebase project'

console.log(`\n🔎 [guard] dev app (mode=${mode}) will target: ${target}`)

if (!useEmulators && process.env.ALLOW_LIVE !== '1') {
  console.error(
    '\n⛔ Refusing to start the dev app against LIVE Firebase.\n' +
    '   VITE_USE_EMULATORS is not "true", so the browser would read/write PRODUCTION data.\n' +
    '     • For local development: run `pnpm dev:seed` and set VITE_USE_EMULATORS=true in\n' +
    '       app/.env.development.local (the full local stack uses the emulators).\n' +
    '     • To target the live project on purpose: re-run with ALLOW_LIVE=1.\n',
  )
  process.exit(1)
}
if (!useEmulators) {
  console.warn('⚠️  ALLOW_LIVE=1 set — proceeding against LIVE Firebase intentionally.\n')
}
