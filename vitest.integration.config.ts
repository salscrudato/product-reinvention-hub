// Emulator integration tests for the load-bearing write path — the REAL adapter.db.mutate()
// transaction run against a live Firestore emulator (B6). Kept separate from the unit config
// (vitest.config.ts) because it needs the emulator, and from the rules config (vitest.rules.
// config.ts) because it proves the TRANSACTION envelope rather than the security rules.
//
// Run via: pnpm test:integration  (firebase emulators:exec boots Firestore first).
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // Hard-wire the adapter to the emulator at transform time — bulletproof regardless of how
  // vitest surfaces process.env, since the adapter branches on this exact literal at module load.
  define: { 'import.meta.env.VITE_USE_EMULATORS': JSON.stringify('true') },
  // Resolve @pf/shared from source (mirrors functions/vitest.config.ts) so the cost-ensemble
  // integration test can import the functions modules, which import @pf/shared.
  resolve: { alias: { '@pf/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)) } },
  test: {
    environment:     'node',
    include:         ['tests/integration/**/*.test.ts'],
    testTimeout:     20000,
    hookTimeout:     30000,
    fileParallelism: false,   // shared emulator state — run serially
  },
})
