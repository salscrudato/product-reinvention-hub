/**
 * tooling/capture-admin.mjs
 * Admin-only screenshot pass. Spawns a fresh Vite dev server, detects the
 * actual port from Vite's stdout, signs in as admin@admin.com, captures all
 * product sub-tabs + admin console tabs.
 *
 * Run: node tooling/capture-admin.mjs
 * Prerequisite: Firebase emulators running and seeded (pnpm spinup).
 */

import { chromium } from '@playwright/test'
import { spawn }     from 'node:child_process'
import { mkdir }     from 'node:fs/promises'
import path          from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, '..')
const APP_DIR   = path.join(ROOT, 'app')
const OUT       = path.join(ROOT, 'screenshots')

async function detectVitePort(vite, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite port not detected within timeout')), timeoutMs)
    vite.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      process.stdout.write(text)
      // Strip ANSI escape codes — Vite inserts bold/color codes inside the URL string.
      const clean = text.replace(/\x1b\[[0-9;]*m/g, '')
      // Vite prints: "Local:   http://localhost:5173/"
      const m = clean.match(/localhost:(\d{4,5})/)
      if (m) {
        clearTimeout(timer)
        resolve(Number(m[1]))
      }
    })
  })
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`  📸 ${name}.png`)
}

async function settle(page, extra = 2000) {
  try { await page.waitForLoadState('networkidle', { timeout: 12_000 }) } catch { /* ok */ }
  await page.waitForTimeout(extra)
}

async function main() {
  await mkdir(OUT, { recursive: true })

  // Spawn Vite via Windows CMD wrapper; let Vite pick any available port
  // (we detect the actual port from stdout, avoiding the port-conflict problem).
  console.log('🚀 Starting Vite dev server (VITE_USE_EMULATORS=true)…')
  const vite = spawn('cmd', ['/c', 'pnpm', 'exec', 'vite'], {
    cwd: APP_DIR,
    env: { ...process.env, VITE_USE_EMULATORS: 'true', FORCE_COLOR: '0', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  vite.stderr.on('data', d => process.stderr.write(d))
  process.on('exit', () => { try { vite.kill('SIGTERM') } catch { /* ignore */ } })

  const port = await detectVitePort(vite)
  const BASE = `http://localhost:${port}`
  console.log(`  Vite started on port ${port} — BASE = ${BASE}`)
  // Extra settle for HMR warmup
  await new Promise(r => setTimeout(r, 3000))

  const browser = await chromium.launch({ headless: true })
  const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  // React 19 crashes the component tree on unhandled promise rejections.
  // The Firestore emulator sends phantom watch events from prior connections,
  // causing the SDK to throw an internal assertion error as an unhandledrejection.
  // Intercept those rejections BEFORE React's global handler runs so React doesn't
  // unmount the entire app — the screenshots can still be taken.
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const msg = String(event?.reason?.message ?? '')
      if (msg.includes('FIRESTORE') || msg.includes('INTERNAL ASSERTION')) {
        event.preventDefault()  // Stop React 19 from seeing this rejection
        event.stopImmediatePropagation()
      }
    }, true) // capture phase = runs before React's handler
    window.addEventListener('error', (event) => {
      const msg = String(event?.message ?? '')
      if (msg.includes('FIRESTORE') || msg.includes('INTERNAL ASSERTION')) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }, true)
  })

  // Also suppress from Playwright's reporting
  page.on('pageerror', (err) => {
    const msg = String(err.message ?? '')
    if (msg.includes('FIRESTORE') || msg.includes('ASSERTION')) return
    console.warn('Page error:', msg.slice(0, 120))
  })

  console.log('\n── Admin pass (admin@admin.com) ──')

  // Navigate to landing page first — static React, no Firestore subscriptions.
  // This lets anonymous auth complete before the sign-in page loads.
  await page.goto(BASE)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(5000)

  // Navigate to sign-in
  await page.goto(`${BASE}/sign-in`)
  await page.waitForTimeout(3000)

  // Fill the sign-in form
  await page.waitForSelector('input[type="email"]', { timeout: 30_000 })
  await page.fill('input[type="email"]', 'admin@admin.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  try { await page.waitForURL(`${BASE}/app**`, { timeout: 20_000 }) } catch { /* continue */ }
  await settle(page, 5000)

  await shot(page, 'adm-01-home-admin')

  await page.goto(`${BASE}/app/products`)
  await settle(page)
  await shot(page, 'adm-02-products-admin')

  // HO-3 product sub-tabs
  await page.goto(`${BASE}/app/products/HO.PROD.001/overview`)
  await settle(page, 3000)
  await shot(page, 'adm-03-product-overview-admin')

  await page.goto(`${BASE}/app/products/HO.PROD.001/coverages`)
  await settle(page, 2000)
  await shot(page, 'adm-04-product-coverages-admin')

  await page.goto(`${BASE}/app/products/HO.PROD.001/forms`)
  await settle(page, 2000)
  await shot(page, 'adm-05-product-forms-admin')

  await page.goto(`${BASE}/app/products/HO.PROD.001/pricing`)
  await settle(page, 5000)
  await shot(page, 'adm-06-product-pricing-admin')

  await page.goto(`${BASE}/app/products/HO.PROD.001/states`)
  await settle(page, 2000)
  await shot(page, 'adm-07-product-states-admin')

  await page.goto(`${BASE}/app/products/HO.PROD.001/rules`)
  await settle(page, 2000)
  await shot(page, 'adm-08-product-rules-admin')

  // GL product
  await page.goto(`${BASE}/app/products/GL.PROD.001/overview`)
  await settle(page, 3000)
  await shot(page, 'adm-09-gl-overview-admin')

  await page.goto(`${BASE}/app/products/GL.PROD.001/pricing`)
  await settle(page, 5000)
  await shot(page, 'adm-10-gl-pricing-admin')

  // Other routes
  await page.goto(`${BASE}/app/claims`)
  await settle(page, 2000)
  await shot(page, 'adm-11-claims-admin')

  // Admin console
  await page.goto(`${BASE}/app/admin`)
  await settle(page, 2000)
  await shot(page, 'adm-12-admin-users')

  try {
    await page.click('text=Audit Log', { timeout: 5000 })
    await settle(page)
    await shot(page, 'adm-13-admin-audit')
  } catch { console.log('  ⚠  Audit Log tab not found') }

  try {
    await page.click('text=Seed Report', { timeout: 5000 })
    await settle(page)
    await shot(page, 'adm-14-admin-seed')
  } catch { console.log('  ⚠  Seed Report tab not found') }

  try {
    await page.click('text=Settings', { timeout: 5000 })
    await settle(page)
    await shot(page, 'adm-15-admin-settings')
  } catch { console.log('  ⚠  Settings tab not found') }

  await browser.close()
  console.log('\n✅ Admin pass complete — see screenshots/')
  try { vite.kill('SIGTERM') } catch { /* ignore */ }
  await new Promise(r => setTimeout(r, 1000))
  process.exit(0)
}

main().catch(err => {
  console.error('Capture failed:', err)
  process.exit(1)
})
