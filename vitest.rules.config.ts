// Separate vitest config for Firestore security rules tests.
// Run via: pnpm test:rules  (which uses firebase emulators:exec to start Firestore first)
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment:   'node',
    include:       ['tests/**/*.test.ts'],
    testTimeout:   20000,
    hookTimeout:   30000,
    singleThread:  true,   // rules tests are stateful; run serially
  },
})
