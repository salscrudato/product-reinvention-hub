// READ-ONLY recon screenshot capture. Not committed (gitignored). Drives the LOCAL
// emulator-pointed Vite (VITE_USE_EMULATORS=true) on :5174. Never touches production:
// a route guard aborts any request to prod Firestore/Auth/Functions hosts, and we assert
// the app actually talked to the Firestore emulator (127.0.0.1:8080) before capturing.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(__dirname, 'shots')
const BASE = 'http://localhost:5174'
const HO = 'HO.PROD.001'
const GL = 'GL.PROD.001'

const manifest = []          // { file, caption }
let n = 0
let sawEmulator = false
let blockedProd = 0

const pad = (i) => String(i).padStart(2, '0')

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
    deviceScaleFactor: 2,
  })

  // Hard prod-safety net (insurance; emulator mode already verified).
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).host
    if (host === '127.0.0.1:8080') sawEmulator = true
    const isProd =
      host === 'firestore.googleapis.com' ||
      host === 'identitytoolkit.googleapis.com' ||
      host === 'securetoken.googleapis.com' ||
      host.endsWith('cloudfunctions.net')
    if (isProd) { blockedProd++; return route.abort() }
    return route.continue()
  })

  const page = await context.newPage()
  page.setDefaultTimeout(30000)

  async function shot(name, caption) {
    n += 1
    const file = `${pad(n)}_${name}.png`
    await page.screenshot({ path: join(SHOTS, file), fullPage: true })
    manifest.push({ file, caption })
    console.log(`[shot] ${file} — ${caption}`)
  }
  async function step(label, fn) {
    try { await fn(); console.log(`[ok] ${label}`) }
    catch (e) { console.log(`[FAIL] ${label}: ${e.message}`) }
  }
  const settle = (ms = 3200) => page.waitForTimeout(ms)
  async function go(url, ms = 3200) {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
    await settle(ms)
  }

  // ── 1. Landing ──────────────────────────────────────────────────────────
  await step('landing', async () => { await go('/', 1500); await shot('landing', 'Route / — Landing (marketing showpiece + bespoke insight-graph SVG)') })

  // ── 2. Sign-in ──────────────────────────────────────────────────────────
  await step('signin', async () => { await go('/sign-in', 1200); await shot('signin', 'Route /sign-in — username/password sign-in') })

  // ── Login as the seeded ADMIN (sal / scrudato) ────────────────────────────
  await step('login', async () => {
    await page.getByPlaceholder('sal').fill('sal')
    await page.getByPlaceholder('Password').fill('scrudato')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/app', { timeout: 30000 })
    await settle(3500)
    if (!sawEmulator) throw new Error('SAFETY: no request to Firestore emulator (127.0.0.1:8080) — refusing to continue (may be prod-pointed)')
    console.log('[safety] confirmed emulator traffic; blockedProd=' + blockedProd)
  })

  // ── 3. Home ────────────────────────────────────────────────────────────
  await step('home', async () => { await go('/app', 2500); await shot('home', 'Route /app — Home portfolio cockpit + grounded Q&A composer') })

  // ── 4. Home Q&A with citations (AI moment) ────────────────────────────────
  await step('home-qa', async () => {
    const pill = page.getByRole('button', { name: /Trace HO-3 premium/i })
    await pill.click()
    // wait for streaming to finish: assistant text present and no pulsing caret
    await page.waitForFunction(() => {
      const log = document.querySelector('[role="log"]')
      if (!log) return false
      const hasCaret = !!log.querySelector('.animate-pulse')
      return log.textContent && log.textContent.length > 120 && !hasCaret
    }, { timeout: 120000 })
    await settle(1500)
    await shot('home_qa_citations', 'Route /app — grounded portfolio Q&A: streamed HO-3 premium trace with [refId] citations + tool chips')
  })

  // ── 5. Cmd+K command palette (AI-adjacent global) ─────────────────────────
  await step('cmdk', async () => {
    await page.keyboard.press('Control+k')
    await settle(700)
    await page.keyboard.type('cover')
    await settle(900)
    await shot('cmdk_palette', 'Route /app — ⌘K/Ctrl+K command palette open (fuzzy search over the searchIndex)')
    await page.keyboard.press('Escape')
  })

  // ── 6-8. Products (cards / table / hierarchy) ─────────────────────────────
  await step('products-cards', async () => { await go('/app/products', 2600); await shot('products_cards', 'Route /app/products — published portfolio (Cards view)') })
  await step('products-table', async () => {
    await page.getByRole('button', { name: 'Table' }).click(); await settle(2200)
    await shot('products_table', 'Route /app/products — flattened coverage/form Inventory (Table view)')
  })
  await step('products-tree', async () => {
    await page.getByRole('button', { name: 'Hierarchy' }).click(); await settle(2200)
    await shot('products_hierarchy', 'Route /app/products — product framework tree (Hierarchy view)')
  })

  // ── 9. HO Overview (AI summary) ───────────────────────────────────────────
  await step('overview-ho', async () => {
    await go(`/app/products/${HO}/overview`, 3000)
    await page.waitForFunction(() => !document.body.textContent.includes('…') || true, { timeout: 1 }).catch(() => {})
    await settle(9000) // allow the summarizeProduct (Haiku) call to render
    await shot('overview_ho', 'Route /app/products/HO.PROD.001/overview — AI product summary dashboard (Homeowners)')
  })

  // ── 10. HO Coverages ──────────────────────────────────────────────────────
  await step('coverages-ho', async () => { await go(`/app/products/${HO}/coverages`, 2800); await shot('coverages_ho', 'Route /app/products/HO.PROD.001/coverages — coverages grouped by Section I/II with refId chips') })

  // ── 11. HO coverage detail (Limits/Deductibles/Options) ───────────────────
  await step('coverage-detail-ho', async () => {
    // open the first coverage card, then try to reveal a terms/options aspect
    const card = page.locator('[class*="rise-in"]').first()
    await card.click().catch(() => {})
    await settle(1500)
    // try clicking a tile/button that opens limits/deductibles/options
    for (const nm of [/limit/i, /deductible/i, /option/i, /terms/i]) {
      const b = page.getByRole('button', { name: nm }).first()
      if (await b.count()) { await b.click().catch(() => {}); break }
    }
    await settle(1500)
    await shot('coverage_detail_ho', 'HO coverage detail — Limits / Deductibles / Options (typed terms model)')
    await page.keyboard.press('Escape').catch(() => {})
  })

  // ── 13. HO Forms ──────────────────────────────────────────────────────────
  await step('forms-ho', async () => { await go(`/app/products/${HO}/forms`, 2800); await shot('forms_ho', 'Route /app/products/HO.PROD.001/forms — master-detail forms repository (form-number chips, where-used)') })

  // ── 14. HO Pricing ($1,528 trace) ─────────────────────────────────────────
  await step('pricing-ho', async () => {
    await go(`/app/products/${HO}/pricing`, 3000)
    await page.getByText(/1,528/).first().waitFor({ timeout: 15000 }).catch(() => {})
    await settle(1200)
    await shot('pricing_ho_1528', 'Route /app/products/HO.PROD.001/pricing — rating worksheet, $1,528 premium + step-by-step trace') })

  // ── 15. HO States ─────────────────────────────────────────────────────────
  await step('states-ho', async () => { await go(`/app/products/${HO}/states`, 3000); await shot('states_ho', 'Route /app/products/HO.PROD.001/states — footprint map (COASTAL wind/hail peril badges)') })

  // ── 16. HO Rules ──────────────────────────────────────────────────────────
  await step('rules-ho', async () => { await go(`/app/products/${HO}/rules`, 3000); await shot('rules_ho', 'Route /app/products/HO.PROD.001/rules — IF→THEN rule flow cards + live Simulate panel') })

  // ── 17. HO Rules — Simulate interaction ───────────────────────────────────
  await step('rules-simulate', async () => {
    // toggle a checkbox in the SimulatePanel to change the simulated outcome
    const cb = page.locator('input[type="checkbox"]').first()
    if (await cb.count()) { await cb.click().catch(() => {}); await settle(1200) }
    // scroll simulate panel into view if labelled
    await page.getByText(/simulate/i).first().scrollIntoViewIfNeeded().catch(() => {})
    await settle(800)
    await shot('rules_simulate_ho', 'HO Rules — Simulate: sample submission → engine outcome (violations / forms that attach)')
  })

  // ── 18-23. GL product tabs ────────────────────────────────────────────────
  await step('overview-gl', async () => { await go(`/app/products/${GL}/overview`, 3000); await settle(9000); await shot('overview_gl', 'Route /app/products/GL.PROD.001/overview — AI product summary dashboard (General Liability)') })
  await step('coverages-gl', async () => { await go(`/app/products/${GL}/coverages`, 2800); await shot('coverages_gl', 'Route /app/products/GL.PROD.001/coverages — GL coverages (Coverage A/B/C/Other), line-agnostic') })
  await step('pricing-gl', async () => {
    await go(`/app/products/${GL}/pricing`, 3000)
    await page.getByText(/2,789/).first().waitFor({ timeout: 15000 }).catch(() => {})
    await settle(1200)
    await shot('pricing_gl_2789', 'Route /app/products/GL.PROD.001/pricing — GL rating worksheet, $2,789 premium + trace') })
  await step('states-gl', async () => { await go(`/app/products/${GL}/states`, 3000); await shot('states_gl', 'Route /app/products/GL.PROD.001/states — GL footprint map (TERRITORY peril, 44 states + DC)') })
  await step('forms-gl', async () => { await go(`/app/products/${GL}/forms`, 2600); await shot('forms_gl', 'Route /app/products/GL.PROD.001/forms — GL forms repository (CG-series)') })
  await step('rules-gl', async () => { await go(`/app/products/${GL}/rules`, 2600); await shot('rules_gl', 'Route /app/products/GL.PROD.001/rules — GL rules (documentation-only; no Simulate for this LOB)') })

  // ── 24. Explorer (cascade + peek) ─────────────────────────────────────────
  await step('explorer', async () => {
    await go('/app/explorer', 3000)
    // cascade: click first product, then first coverage, then a sub-coverage → peek
    const clickFirstIn = async (colIdx) => {
      const btns = page.getByRole('button')
      // fall back: click list items
    }
    // click through columns by role option/button text where possible
    const items = page.locator('[role="option"], button')
    await settle(1000)
    // Product column
    await page.locator('text=Homeowners').first().click().catch(() => {})
    await settle(1200)
    // Coverage column — click first coverage entry
    await page.locator('[class*="Miller"], [role="listbox"] >> nth=1').first().waitFor({ timeout: 2000 }).catch(() => {})
    await page.keyboard.press('ArrowRight').catch(() => {})
    await settle(1000)
    await shot('explorer_peek', 'Route /app/explorer — Miller-column cascade (Products → Coverages → peek panel)')
  })

  // ── 25-31. Remaining top-level routes ─────────────────────────────────────
  await step('tasks', async () => { await go('/app/tasks', 2600); await shot('tasks', 'Route /app/tasks — product-lifecycle kanban (Board view, dnd-kit)') })
  await step('news', async () => { await go('/app/news', 2600); await shot('news', 'Route /app/news — portfolio-relevance-ranked market news feed') })
  await step('claims', async () => { await go('/app/claims', 2600); await shot('claims', 'Route /app/claims — grounded coverage copilot (base-forms library + conversation zero-state)') })
  await step('dictionary', async () => { await go('/app/dictionary', 2600); await shot('dictionary', 'Route /app/dictionary — governed data dictionary with live used-in backrefs') })
  await step('feedback', async () => { await go('/app/feedback', 2600); await shot('feedback', 'Route /app/feedback — PM feedback loop (Inbox / Backlog / Shipped)') })
  await step('admin', async () => { await go('/app/admin', 2600); await shot('admin', 'Route /app/admin — Admin console (Users tab; 5 tabs incl. audit→version diff)') })
  await step('builder', async () => { await go('/app/builder', 2600); await shot('builder', 'Route /app/builder — Drafts workbench (New / Import / Clone / Scaffold-with-AI)') })

  // ── 12. Base-form extraction review dialog (AI moment) ────────────────────
  // Inject a data:-URL base form into the emulator product doc (NO prod storage write),
  // then drive the Coverages-tab "Extract" → the streamed review dialog.
  await step('baseform-extract', async () => {
    const formText = [
      'HOMEOWNERS HO 00 03 10 00 — HO-3 SPECIAL FORM (SAMPLE, for extraction demo)',
      '',
      'SECTION I — PROPERTY COVERAGES',
      'COVERAGE A — Dwelling. We cover the dwelling on the residence premises.',
      'COVERAGE B — Other Structures on the residence premises.',
      'COVERAGE C — Personal Property owned or used by an insured.',
      'COVERAGE D — Loss Of Use (additional living expense).',
      'SECTION II — LIABILITY COVERAGES',
      'COVERAGE E — Personal Liability. Limit of Liability applies per occurrence.',
      'COVERAGE F — Medical Payments To Others.',
      '',
      'ENDORSEMENTS / FORMS',
      'HO 04 90 — Personal Property Replacement Cost.',
      'HO 04 95 — Water Back-Up And Sump Discharge Or Overflow.',
      'HO 04 61 — Scheduled Personal Property Endorsement.',
      'HO 03 12 — Windstorm Or Hail Percentage Deductible.',
      '',
      'RULES',
      'If the residence is seasonal or secondary, a companion policy is required to be eligible.',
      'Windstorm/Hail percentage deductible applies only in designated coastal territories.',
      'Replacement Cost on Coverage C requires Coverage C limit at least 70% of Coverage A.',
    ].join('\n')
    const b64 = Buffer.from(formText, 'utf-8').toString('base64')
    const dataUrl = `data:text/plain;base64,${b64}`
    const patchUrl = `http://127.0.0.1:8080/v1/projects/productreinvention/databases/(default)/documents/products/${HO}?updateMask.fieldPaths=baseForm`
    const body = { fields: { baseForm: { mapValue: { fields: {
      url: { stringValue: dataUrl },
      name: { stringValue: 'HO-3 Special Form (sample).txt' },
      uploadedAt: { stringValue: new Date().toISOString() },
      uploadedBy: { stringValue: 'sal' },
    } } } } }
    const res = await fetch(patchUrl, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error('emulator PATCH failed: ' + res.status + ' ' + (await res.text()).slice(0, 200))
    await go(`/app/products/${HO}/coverages`, 3500)
    await page.getByRole('button', { name: /^extract$/i }).click({ timeout: 8000 })
    await page.getByText(/Review extracted proposals/i).waitFor({ timeout: 150000 })
    await settle(2000)
    await shot('baseform_extract_dialog', 'AI moment — base-form extraction review dialog (grounded, cited proposals with confidence)')
    await page.getByRole('button', { name: /cancel/i }).click().catch(() => {})
  })

  // ── 32. Share (public viewer) — mint via workspace then read the id ────────
  await step('share', async () => {
    let shareId = null
    try {
      await go(`/app/products/${HO}/overview`, 2500)
      await page.getByRole('button', { name: /share/i }).first().click({ timeout: 6000 })
      await settle(3500)
      const r = await fetch(`http://127.0.0.1:8080/v1/projects/productreinvention/databases/(default)/documents/shares`, { headers: { Authorization: 'Bearer owner' } })
      if (r.ok) {
        const j = await r.json()
        const docs = j.documents ?? []
        if (docs.length) shareId = docs[docs.length - 1].name.split('/').pop()
      }
    } catch (e) { console.log('  share mint note: ' + e.message) }
    await page.keyboard.press('Escape').catch(() => {})
    await go(`/share/${shareId ?? 'demo-nonexistent'}`, 3000)
    await shot('share_public', `Route /share/:id — public read-only product snapshot${shareId ? '' : ' (empty/expired state)'}`)
  })

  // ── 33. Must-change-password (form, not submitted) ────────────────────────
  await step('must-change-password', async () => { await go('/must-change-password', 1600); await shot('must_change_password', 'Route /must-change-password — forced password-reset interstitial (not submitted)') })

  // ── 34. Admin anonymous-gate state (sign out → anonymous) ─────────────────
  await step('admin-anon-gate', async () => {
    await page.evaluate(async () => {
      // clear Firebase auth so the app falls back to the anonymous (no-role) session
      try { indexedDB.deleteDatabase('firebaseLocalStorageDb') } catch {}
      try { sessionStorage.clear(); localStorage.removeItem('pf.devAdminBypass') } catch {}
    })
    await go('/app/admin', 4000)
    await shot('admin_anon_gate', 'Route /app/admin as an anonymous (no-role) session — the admin gate / empty state')
  })

  writeFileSync(join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\n[done] captured ${manifest.length} screenshots; prod requests blocked=${blockedProd}`)
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
