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
      // Write dist/version.json after the bundle is emitted. The Azure host (server/server.js)
      // serves it no-cache, so every VersionWatcher poll sees the freshest build id.
      name: 'emit-version-json',
      apply: 'build',
      closeBundle() {
        writeFileSync(resolve(process.cwd(), 'dist/version.json'), JSON.stringify({ buildId }))
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        // Pin the stable React runtime into its own long-cache vendor chunk so an app-code
        // deploy doesn't invalidate it. Route chunks + heavy libs (exceljs) already code-split
        // via React.lazy() / dynamic import() — see App.tsx.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react'
          }
        },
      },
    },
  },
})
