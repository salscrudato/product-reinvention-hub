// Waits for the Firestore emulator to accept connections, then runs the idempotent
// HO-3 seed. This is the seed half of `pnpm spinup` (concurrently starts the emulator
// suite in parallel) so one command brings up the emulators AND seeds them in one go.
import net from 'node:net'
import { spawn } from 'node:child_process'

// Firestore emulator port — keep in sync with firebase.json (`emulators.firestore.port`).
const HOST = '127.0.0.1'
const PORT = 8080
const TIMEOUT_MS = 120_000 // the Firestore emulator (JVM) can take a while on a cold start
const POLL_MS = 500

/** Resolve true once a TCP connection to host:port succeeds. */
function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    socket.setTimeout(1000)
    const done = (ok) => { socket.destroy(); resolve(ok) }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
  })
}

async function waitForFirestore() {
  const deadline = Date.now() + TIMEOUT_MS
  process.stdout.write(`⏳ Waiting for the Firestore emulator on ${HOST}:${PORT}…`)
  while (Date.now() < deadline) {
    if (await portOpen(HOST, PORT)) { process.stdout.write(' ready.\n'); return }
    process.stdout.write('.')
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  console.error(`\n✗ Firestore emulator did not come up within ${TIMEOUT_MS / 1000}s.`)
  process.exit(1)
}

await waitForFirestore()

// The seed is idempotent: it wipes the seeded collections, re-seeds HO-3, and verifies
// the $1,528 worked example. `shell: true` so `pnpm` resolves as a .cmd on Windows.
const seed = spawn('pnpm', ['seed'], { stdio: 'inherit', shell: true })
seed.on('exit', (code) => process.exit(code ?? 0))
