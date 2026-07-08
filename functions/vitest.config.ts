import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  // Resolve @pf/shared from source, mirroring the tsup build alias (tsup.config.ts). functions
  // deliberately has no workspace dependency on @pf/shared, so without this alias any test that
  // imports a module which pulls in @pf/shared (news/claims/…) fails to resolve it.
  resolve: {
    alias: { '@pf/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
})
