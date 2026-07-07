/**
 * tooling/capture-screens.mjs
 * Playwright (headless Chromium, 1440×900, full-page) screenshot pass.
 *
 * Strategy:
 *  • Spawns a second Vite dev-server on port 5174 with VITE_USE_EMULATORS=true
 *    so screenshots always hit the emulator (seeded data), regardless of whatever
 *    .env.development.local says. Does NOT touch the running 5173 server.
 *  • Main pass: anonymous auth (the adapter auto-signs-in anonymously — the
 *    "Continue as Guest" path). Captures every route in reading order.
 *  • Admin pass: signs in as admin@admin.com/admin123 to capture edit surfaces.
 *  • Dark pass: SKIPPED — the app has no dark mode (no dark CSS vars or media
 *    query in app/src/index.css). Notes in manifest.
 *
 * Run: node tooling/capture-screens.mjs
 *
 * Prerequisite: `pnpm spinup` (emulators + seed) and `node tooling/capture-screens.mjs`
 * Or just run this file — it starts its own Vite server.
 */

import { chromium } from '@playwright/test'
import { spawn }     from 'node:child_process'
import { mkdir }     from 'node:fs/promises'
import { existsSync } from 'node:fs'
import net           from 'node:net'
import path          from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, '..')
const OUT       = path.join(ROOT, 'screenshots')
const BASE_PORT = 5174
const BASE      = `http://localhost:${BASE_PORT}`

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function portOpen(port) {
  return new Promise(resolve => {
    const s = net.connect({ host: '127.0.0.1', port })
    s.setTimeout(1000)
    const done = ok => { s.destroy(); resolve(ok) }
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
    s.once('timeout', () => done(false))
  })
}

async function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  process.stdout.write(`⏳ Waiting for port ${port}…`)
  while (Date.now() < deadline) {
    if (await portOpen(port)) { process.stdout.write(' ready.\n'); return }
    process.stdout.write('.')
    await new Promise(r => setTimeout(r, 800))
  }
  throw new Error(`Port ${port} did not open within ${timeoutMs / 1000}s`)
}

let counter = 0
async function shot(page, slug) {
  counter++
  const n    = String(counter).padStart(2, '0')
  const file = path.join(OUT, `${n}-${slug}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`  📸 ${n}-${slug}.png`)
  return file
}

async function namedShot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`  📸 ${name}.png`)
  return file
}

/** Wait for network idle + a short settle. Tolerates slow SSE endpoints. */
async function settle(page, extra = 1500) {
  try { await page.waitForLoadState('networkidle', { timeout: 10_000 }) } catch { /* ok */ }
  await page.waitForTimeout(extra)
}

/** Click the first product card or link in the products list and return the product URL. */
async function openFirstProduct(page) {
  await page.goto(`${BASE}/app/products`)
  await settle(page)
  // Product cards are clickable — find the first one by role link or a card anchor
  const link = page.locator('a[href*="/app/products/"]').first()
  if (await link.count() === 0) {
    // Fallback: click any element containing the HO-3 name
    await page.click('text=HO-3')
  } else {
    await link.click()
  }
  await page.waitForURL(`${BASE}/app/products/**`, { timeout: 8000 })
  return page.url()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(OUT, { recursive: true })

  // ── Spawn Vite on 5174 with emulators ────────────────────────────────────────
  console.log('🚀 Starting Vite dev server on port 5174 (VITE_USE_EMULATORS=true)…')
  const vite = spawn('pnpm', ['--filter', 'app', 'dev', '--', '--port', BASE_PORT.toString()], {
    cwd:   ROOT,
    shell: true,
    env:   { ...process.env, VITE_USE_EMULATORS: 'true', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  vite.stdout.on('data', d => process.stdout.write(d))
  vite.stderr.on('data', d => process.stderr.write(d))
  process.on('exit', () => { try { vite.kill('SIGTERM') } catch { /* ignore */ } })

  await waitForPort(BASE_PORT, 60_000)
  // Extra settle for Vite HMR warmup
  await new Promise(r => setTimeout(r, 2000))

  // ── Launch Playwright ─────────────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: true })
  const mkCtx = () => browser.newContext({ viewport: { width: 1440, height: 900 } })

  // ════════════════════════════════════════════════════════════════════════════
  //  MAIN PASS — anonymous / guest auth
  //  The adapter auto-signs-in anonymously (signInAnonymously) when it detects
  //  no user; this is the "Continue as Guest" path. No sign-in form needed.
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── Main pass (guest / anonymous) ──')
  {
    const ctx  = await mkCtx()
    const page = await ctx.newPage()

    // 01 — Landing
    await page.goto(BASE)
    await settle(page, 2500)
    await shot(page, 'landing')

    // 02 — Sign-in (before auth)
    await page.goto(`${BASE}/sign-in`)
    await settle(page, 1000)
    await shot(page, 'signin')

    // Trigger anonymous sign-in: navigate to the app shell.
    // The adapter will call signInAnonymously() automatically.
    await page.goto(`${BASE}/app`)
    await settle(page, 3000)  // allow the anonymous sign-in + Firestore reads to complete

    // 03 — Home
    await shot(page, 'home')

    // 04 — Products list
    await page.goto(`${BASE}/app/products`)
    await settle(page)
    await shot(page, 'products')

    // Navigate into the HO-3 product
    const ho3Url = await openFirstProduct(page)
    console.log('  HO-3 URL:', ho3Url)
    const ho3Base = ho3Url.replace(/\/overview$/, '').replace(/\/$/, '')

    // 05 — Product Overview
    await page.goto(`${ho3Base}/overview`)
    await settle(page)
    await shot(page, 'product-overview')

    // 06 — Product Coverages
    await page.goto(`${ho3Base}/coverages`)
    await settle(page)
    await shot(page, 'product-coverages')

    // 07 — Product Forms
    await page.goto(`${ho3Base}/forms`)
    await settle(page)
    await shot(page, 'product-forms')

    // 08 — Product Pricing (wait for rating trace to render)
    await page.goto(`${ho3Base}/pricing`)
    await settle(page, 3000)  // rating evaluator renders client-side, needs a moment
    await shot(page, 'product-pricing')

    // 09 — Product States
    await page.goto(`${ho3Base}/states`)
    await settle(page)
    await shot(page, 'product-states')

    // 10 — Product Rules
    await page.goto(`${ho3Base}/rules`)
    await settle(page)
    await shot(page, 'product-rules')

    // Find GL product (second product in the list)
    await page.goto(`${BASE}/app/products`)
    await settle(page)
    const links = await page.locator('a[href*="/app/products/"]').all()
    let glBase = null
    if (links.length >= 2) {
      const glLink = links[1]
      const href   = await glLink.getAttribute('href')
      if (href) {
        glBase = `${BASE}${href}`.replace(/\/overview$/, '').replace(/\/$/, '')
        // 11 — GL Product Overview
        await page.goto(`${glBase}/overview`)
        await settle(page)
        await shot(page, 'gl-product-overview')
        // 12 — GL Product Pricing
        await page.goto(`${glBase}/pricing`)
        await settle(page, 3000)
        await shot(page, 'gl-product-pricing')
      }
    }

    // 13 — Builder (stub)
    await page.goto(`${BASE}/app/builder`)
    await settle(page)
    await shot(page, 'builder-stub')

    // 14 — Explorer
    await page.goto(`${BASE}/app/explorer`)
    await settle(page)
    await shot(page, 'explorer')

    // 15 — Tasks
    await page.goto(`${BASE}/app/tasks`)
    await settle(page)
    await shot(page, 'tasks')

    // 16 — News
    await page.goto(`${BASE}/app/news`)
    await settle(page)
    await shot(page, 'news')

    // 17 — Claims Analysis
    await page.goto(`${BASE}/app/claims`)
    await settle(page, 2000)
    await shot(page, 'claims')

    // 18 — Data Dictionary
    await page.goto(`${BASE}/app/dictionary`)
    await settle(page)
    await shot(page, 'dictionary')

    // 19 — Feedback
    await page.goto(`${BASE}/app/feedback`)
    await settle(page)
    await shot(page, 'feedback')

    // Admin route shows "Admins only" EmptyState for anonymous users
    await page.goto(`${BASE}/app/admin`)
    await settle(page)
    await shot(page, 'admin-anonymous-gate')

    await ctx.close()
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  ADMIN PASS — sign in as admin@admin.com / admin123
  //  Captures edit surfaces, admin console tabs, open edit dialogs.
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── Admin pass (admin@admin.com) ──')
  {
    const ctx  = await mkCtx()
    const page = await ctx.newPage()

    // Sign in
    await page.goto(`${BASE}/sign-in`)
    await settle(page, 1000)
    await page.fill('input[type="email"]', 'admin@admin.com')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    try {
      await page.waitForURL(`${BASE}/app**`, { timeout: 15_000 })
    } catch {
      // might already be redirected; continue anyway
    }
    await settle(page, 2000)

    // adm-01 — Home (as admin, to show role badge/name)
    await namedShot(page, 'adm-01-home-admin')

    // Navigate to HO-3 product
    const ho3Url = await openFirstProduct(page)
    const ho3Base = ho3Url.replace(/\/overview$/, '').replace(/\/$/, '')

    // adm-02 — Coverages (edit mode available)
    await page.goto(`${ho3Base}/coverages`)
    await settle(page)
    await namedShot(page, 'adm-02-product-coverages-admin')

    // adm-03 — Try to open a coverage edit dialog
    try {
      const editBtn = page.locator('button:has-text("Edit"), button[aria-label*="edit" i], button[aria-label*="Edit" i]').first()
      if (await editBtn.count() > 0) {
        await editBtn.click()
        await settle(page, 1000)
        await namedShot(page, 'adm-03-coverage-edit-dialog')
        await page.keyboard.press('Escape')
        await settle(page, 500)
      }
    } catch { /* dialog might not open; skip */ }

    // adm-04 — Pricing (admin sees the rate-table editor button)
    await page.goto(`${ho3Base}/pricing`)
    await settle(page, 3000)
    await namedShot(page, 'adm-04-product-pricing-admin')

    // adm-05 — Admin console — Users tab
    await page.goto(`${BASE}/app/admin`)
    await settle(page)
    await namedShot(page, 'adm-05-admin-users')

    // adm-06 — Admin console — Audit Log tab
    try {
      await page.click('text=Audit Log')
      await settle(page)
      await namedShot(page, 'adm-06-admin-audit')
    } catch { /* skip */ }

    // adm-07 — Admin console — Seed Report tab
    try {
      await page.click('text=Seed Report')
      await settle(page)
      await namedShot(page, 'adm-07-admin-seed')
    } catch { /* skip */ }

    // adm-08 — Admin console — Settings tab
    try {
      await page.click('text=Settings')
      await settle(page)
      await namedShot(page, 'adm-08-admin-settings')
    } catch { /* skip */ }

    await ctx.close()
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  DARK PASS — SKIPPED
  //  The app has no dark mode implementation. app/src/index.css has no
  //  @media (prefers-color-scheme: dark) block and no .dark CSS variant.
  //  The Admin > Settings tab does not expose a theme toggle.
  //  Dark screenshots cannot be produced; see manifest note.
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── Dark pass: SKIPPED (no dark mode in app) ──')

  // ─── Teardown ─────────────────────────────────────────────────────────────────
  await browser.close()

  console.log('\n✅ Screenshots complete — see screenshots/')
  console.log('Stopping Vite server…')
  try { vite.kill('SIGTERM') } catch { /* ignore */ }
  await new Promise(r => setTimeout(r, 1000))
  process.exit(0)
}

main().catch(err => {
  console.error('Capture failed:', err)
  process.exit(1)
})
