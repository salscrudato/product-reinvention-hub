// tsup bundles @pf/shared into the output so functions ship self-contained — no
// workspace:* dependency in the deployed package.json (Cloud Build runs npm, which
// can't resolve pnpm's workspace protocol). Shared is resolved from source via an
// alias, so no node_modules symlink is required at build or deploy time.
import { defineConfig } from 'tsup'
import { fileURLToPath } from 'node:url'

const sharedEntry = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url))

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node20',
  bundle: true,
  outDir: 'lib',
  clean: true,
  splitting: false,
  sourcemap: true,
  // Bundle local workspace packages; leave Firebase + Node built-ins as external.
  noExternal: ['@pf/shared'],
  external: ['firebase-admin', 'firebase-functions'],
  esbuildOptions(options) {
    options.alias = { ...(options.alias ?? {}), '@pf/shared': sharedEntry }
  },
})
