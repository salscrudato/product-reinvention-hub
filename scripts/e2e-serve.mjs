// E2E stack orchestrator — runs UNDER `firebase emulators:exec` (which exports the emulator
// host env vars). It seeds the running emulators FIRST (so sign-in + the reseeded portfolio
// exist), THEN starts Vite pointed at the emulators. Playwright's webServer polls the Vite URL,
// so the test suite only starts once seeding has completed and the app is serving — a
// deterministic ordering with no race between "emulators up" and "data ready".
import { execSync, spawn } from 'node:child_process'

console.log('[e2e-serve] seeding emulators…')
execSync('pnpm seed', { stdio: 'inherit' })   // FIRESTORE/AUTH emulator hosts come from emulators:exec

console.log('[e2e-serve] starting Vite (dev:emulator → VITE_USE_EMULATORS=true) on http://127.0.0.1:5173 …')
// Run the app's `dev:emulator` script, which bakes in `--mode emulator`. That mode loads
// app/.env.emulator (VITE_USE_EMULATORS=true) and, crucially, does NOT load .env.development.local
// (which pins it false and outranks a shell env var). Baking the flag into the script — rather
// than passing it through `pnpm exec … vite --mode` — avoids the flag being dropped in transit.
const vite = spawn(
  'pnpm',
  ['--filter', 'app', 'run', 'dev:emulator'],
  { stdio: 'inherit', shell: true, env: { ...process.env } },
)

// Forward termination so Playwright killing this process also stops Vite; emulators:exec then
// tears the emulators down when this command exits.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { vite.kill(); process.exit(0) })
vite.on('exit', (code) => process.exit(code ?? 0))
