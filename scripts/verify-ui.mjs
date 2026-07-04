// Live browser verification (Playwright) against the deployed PREVIEW channel.
// a landing · b auth · c ⌘K · d rating $1,528 · e rules/limits · i edit(EDITOR) · l Excel.
import { chromium } from 'playwright'
import { mkdirSync, statSync } from 'node:fs'

const PREVIEW = process.env.PREVIEW_URL
const SHOTS = process.env.SHOTS || './scratch-shots'
mkdirSync(SHOTS, { recursive: true })
const results = []
const rec = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id} — ${detail}`) }
const shot = async (page, name) => { await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) }
const P = (path) => `${PREVIEW}${path}`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
page.setDefaultTimeout(25000)

try {
  // a: landing
  try {
    const t0 = Date.now(); const r = await page.goto(PREVIEW, { waitUntil: 'domcontentloaded' })
    await page.getByText('Ship insurance').first().waitFor()
    const svg = await page.locator('svg[role="img"]').count(); await shot(page, 'a-landing')
    rec('a-landing', r.status() === 200 && svg > 0, `http=${r.status()} heroSVGs=${svg} domReady=${Date.now() - t0}ms`)
  } catch (e) { await shot(page, 'a-fail'); rec('a-landing', false, e.message) }

  // b: auth (editor) → shell
  try {
    await page.goto(P('/sign-in'), { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email').fill('editor@productfactory.app')
    await page.getByLabel('Password').fill('editor123')
    await page.getByRole('button', { name: /^Sign in$/ }).click()
    await page.waitForURL(/\/app/); await page.getByRole('button', { name: /Search/i }).first().waitFor()
    await shot(page, 'b-shell')
    rec('b-auth', true, `signed in as editor → ${new URL(page.url()).pathname}`)
  } catch (e) { await shot(page, 'b-fail'); rec('b-auth', false, e.message) }

  // c: command palette
  try {
    await page.getByRole('button', { name: /Search/i }).first().click()
    const input = page.getByPlaceholder(/Search products/i); await input.waitFor()
    await input.fill('HO 04 61'); await page.waitForTimeout(700)
    const form = await page.getByText(/Scheduled Personal Property|HO 04 61/i).count()
    await input.fill('ZZTEST'); await page.waitForTimeout(700)
    const zz = await page.getByText(/ZZTEST/i).count()
    await shot(page, 'c-palette')
    await page.getByText(/ZZTEST/i).first().click().catch(() => {}); await page.waitForTimeout(800)
    rec('c-palette', form > 0 && zz > 0, `HO0461=${form} ZZTEST=${zz} → ${new URL(page.url()).pathname}`)
  } catch (e) { await shot(page, 'c-fail'); rec('c-palette', false, e.message) }

  // d: rating $1,528 (SVG text → check textContent)
  try {
    await page.goto(P('/app/products/HO.PROD.001/pricing'), { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.textContent.includes('1,528'), { timeout: 25000 })
    const refs = await page.evaluate(() => (document.body.textContent.match(/HO\.RT\.00\d/g) || []).length)
    await shot(page, 'd-rating')
    rec('d-rating', true, `$1,528 rendered live; RT refs in trace=${refs}`)
  } catch (e) { await shot(page, 'd-fail'); rec('d-rating', false, e.message) }

  // e: rules/limits — Cov F gate + wind/hail FL vs OH
  try {
    await page.goto(P('/app/products/HO.PROD.001/rules'), { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /Simulate/i }).click()
    await page.waitForTimeout(600)
    const covE = page.locator('select', { has: page.locator('option[value="300000"]') }).first()
    const covF = page.locator('select', { has: page.locator('option[value="2000"]') }).first()
    await covE.selectOption('100000'); await covF.selectOption('5000'); await page.waitForTimeout(500)
    const covFViolation = await page.getByText(/HO\.RU\.006|Coverage E|300,000/i).count()
    const stateSel = page.locator('select', { has: page.locator('option', { hasText: 'FL' }) }).first()
    await stateSel.selectOption('OH'); await page.waitForTimeout(300)
    const oh = await page.getByText(/non-coastal/i).count()
    await stateSel.selectOption('FL'); await page.waitForTimeout(300)
    const fl = await page.getByText(/coastal ✓/i).count()
    await shot(page, 'e-rules')
    rec('e-rules', covFViolation > 0 && oh > 0 && fl > 0, `covF@5k/E100k violationRefs=${covFViolation}; windHail OH=non-coastal(${oh}) FL=coastal(${fl})`)
  } catch (e) { await shot(page, 'e-fail'); rec('e-rules', false, e.message) }

  // l: Excel export round-trip
  try {
    await page.goto(P('/app/products'), { waitUntil: 'domcontentloaded' })
    await page.getByText(/Homeowners — HO-3/).first().waitFor()
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 25000 }),
      page.getByRole('button', { name: /Export/i }).first().click(),
    ])
    const path = await dl.path(); const size = path ? statSync(path).size : 0
    rec('l-excel', !!path && size > 3000 && /\.xlsx$/i.test(dl.suggestedFilename()), `file=${dl.suggestedFilename()} bytes=${size}`)
  } catch (e) { await shot(page, 'l-fail'); rec('l-excel', false, e.message) }

  // i: edit as EDITOR on ZZTEST coverage → save (mutation)
  try {
    await page.goto(P('/app/products/ZZTEST-PROD-001/coverages'), { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /\$75,000/ }).first().waitFor({ timeout: 25000 })
    await page.getByRole('button', { name: /\$75,000/ }).first().click()
    await page.getByRole('button', { name: /^Save$/ }).click()
    await page.getByText(/saved/i).first().waitFor({ timeout: 10000 })
    await shot(page, 'i-edit')
    rec('i-edit', true, 'editor changed Coverage C limit → $75,000 and saved (toast seen)')
  } catch (e) { await shot(page, 'i-fail'); rec('i-edit', false, e.message) }

  console.log('\n=== UI SUMMARY ===')
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id} :: ${r.detail}`)
} finally { await browser.close() }
