// Root vitest config — covers shared engines and app units.
// Functions unit tests run via `pnpm --filter functions test` (chained in pnpm test).
// Functions integration tests run separately via pnpm test:rules (emulator required).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'shared/src/**/*.test.ts',
      'app/src/**/*.test.ts',
    ],
    reporter: 'verbose',
  },
})
