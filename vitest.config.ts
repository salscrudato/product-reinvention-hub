// Root vitest config — covers shared engines and app units.
// Functions unit tests run via `pnpm --filter functions test` (chained in pnpm test).
// Functions integration tests run separately via pnpm test:rules (emulator required).
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  // JSX for the handful of DOM-behaviour tests (*.test.tsx) that render a component
  // under jsdom (opted-in per file via `// @vitest-environment jsdom`). Uses the
  // automatic runtime so no explicit React import is needed. Pure logic tests stay
  // `.test.ts` in the default node environment.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  // Resolve @pf/shared to source for every suite. app/functions tests already resolve it
  // via their own node_modules symlink (to the same shared/src/index.ts); this alias also
  // lets the top-level tests/ suites (no workspace of their own) import it.
  resolve: {
    alias: { '@pf/shared': path.resolve(process.cwd(), 'shared/src/index.ts') },
  },
  test: {
    environment: 'node',
    include: [
      'shared/src/**/*.test.ts',
      'app/src/**/*.test.ts',
      'app/src/**/*.test.tsx',
      // Cross-workspace integration suites (e.g. the format-agnostic importer harness in
      // tests/import) that exercise @pf/shared against the golden fixtures in tests/fixtures.
      'tests/**/*.test.ts',
    ],
    reporter: 'verbose',
  },
})
