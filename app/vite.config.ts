import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A unique id per build, derived from the DEPLOYED GIT COMMIT so the id is stable per deploy
// (push-to-main auto-deploys) and identical across a rebuild of the same commit. Precedence:
//   1. Azure DevOps commit SHA (BUILD_SOURCEVERSION) — set by the pipeline checkout.
//   2. `git rev-parse --short HEAD` — local builds / other CI.
//   3. Date.now() — last-resort fallback if git is unavailable (never expected in CI).
// Emitted into dist/version.json, inlined as __BUILD_ID__ (VersionWatcher compares it to the
// server's version.json to prompt a one-tap reload), AND stamped into the service worker so the
// cache name is versioned per deploy — a new bundle can never be served from a stale SW cache.
function resolveBuildId(): string {
  const sha = process.env.BUILD_SOURCEVERSION
  if (sha && sha.trim()) return sha.trim().slice(0, 12)
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return `${Date.now()}`
  }
}
const buildId = resolveBuildId()

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    tailwindcss(),
    {
      // After the bundle is emitted: (1) write dist/version.json (served no-cache by the Azure
      // host, so every VersionWatcher poll sees the freshest build id); (2) stamp the build id
      // into dist/sw.js by replacing the __BUILD_ID__ placeholder, so CACHE_NAME = `prh-<buildId>`
      // changes every deploy — the service worker's activate handler then evicts all prior caches.
      // We rewrite dist/sw.js from the source (public/sw.js) directly, so correctness does not
      // depend on Vite's public-dir copy ordering.
      name: 'emit-version-and-stamp-sw',
      apply: 'build',
      closeBundle() {
        const distDir = resolve(process.cwd(), 'dist')
        writeFileSync(resolve(distDir, 'version.json'), JSON.stringify({ buildId }))
        const swSrc = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')
        writeFileSync(resolve(distDir, 'sw.js'), swSrc.replaceAll('__BUILD_ID__', buildId))
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
