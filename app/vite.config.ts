import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A unique id per build. Emitted into dist/version.json and inlined as __BUILD_ID__ so a
// running client can detect a new deploy and offer a one-tap reload — no cache clearing.
const buildId = `${Date.now()}`

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    tailwindcss(),
    {
      // Write dist/version.json after the bundle is emitted. Firebase serves it with a
      // no-cache header (see firebase.json), so every poll sees the freshest build id.
      name: 'emit-version-json',
      apply: 'build',
      closeBundle() {
        writeFileSync(resolve(process.cwd(), 'dist/version.json'), JSON.stringify({ buildId }))
      },
    },
  ],
})
