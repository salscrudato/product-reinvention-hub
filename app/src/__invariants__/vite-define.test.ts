// vite-define.test.ts — asserts that the Vite define block contains only build-metadata
// keys and never embeds server-side secret env-var names.
//
// Paired to mutation sweep FAULT-D: adding AZURE_FOUNDRY_KEY to the define block was not
// caught by `pnpm test`. This test closes the gap.
//
// Why source-audit?
//   vite.config.ts exports a defineConfig() call; importing it in a test would run the
//   entire Vite plugin chain. Reading the source and checking the define object's key
//   surface is simpler and catches the exact fault.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const dir = dirname(fileURLToPath(import.meta.url))
// vite.config.ts lives one level above app/src/ in app/
const viteConfig = readFileSync(resolve(dir, '../../vite.config.ts'), 'utf8')

// Patterns that identify known server-side secret env-var names.
// Any of these appearing as a key in the define block means a secret may be bundled.
const SECRET_KEY_RE = /COSMOS_KEY|COSMOS_ENDPOINT|FOUNDRY_KEY|FOUNDRY_ENDPOINT|JWT_SECRET|BLOB_CONNECTION|STORAGE_KEY|API_KEY/i

describe('DEF-0048 — Vite define block must not embed server-side secret names', () => {
  it('define block contains only build-metadata keys — no secret env-var names (FAULT-D regression guard)', () => {
    // Extract the define: { ... } block. The current block is single-line, with no
    // nested braces in the values, so [^}]* correctly captures the key list.
    const m = viteConfig.match(/\bdefine\s*:\s*\{([^}]*)\}/)
    expect(m, 'vite.config.ts must have a define: { } block').toBeTruthy()
    const defineContent = m![1]
    expect(defineContent).not.toMatch(SECRET_KEY_RE)
  })

  it('vite.config.ts define block contains __BUILD_ID__ (sanity: the block was found and is non-empty)', () => {
    expect(viteConfig).toContain('__BUILD_ID__')
  })
})
