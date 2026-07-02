// Root vitest config — covers shared engines and app units.
// Functions integration tests run separately against the emulators.
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
