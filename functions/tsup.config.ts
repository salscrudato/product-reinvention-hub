// tsup bundles @pf/shared into the output so it ships without a workspace link.
import { defineConfig } from 'tsup'

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
})
