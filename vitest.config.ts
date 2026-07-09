// Root vitest config — covers shared engines and app units.
// Functions unit tests run via `pnpm --filter functions test` (chained in pnpm test).
// Functions integration tests run separately via pnpm test:rules (emulator required).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // JSX for the handful of DOM-behaviour tests (*.test.tsx) that render a component
  // under jsdom (opted-in per file via `// @vitest-environment jsdom`). Uses the
  // automatic runtime so no explicit React import is needed. Pure logic tests stay
  // `.test.ts` in the default node environment.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    environment: 'node',
    include: [
      'shared/src/**/*.test.ts',
      'app/src/**/*.test.ts',
      'app/src/**/*.test.tsx',
    ],
    reporter: 'verbose',
  },
})
