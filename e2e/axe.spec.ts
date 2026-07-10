import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Automated accessibility gate (workstream F). Runs axe-core against five representative
// routes — a spread of surface types (cockpit chat, a data grid, the pricing centerpiece, an
// AI copilot, a CRUD hub) — and fails on ANY serious/critical WCAG 2 A/AA violation. Run in
// BOTH themes so the dark-mode work is held to the same bar as light (this session's headline).
// Emulator-gated like the rest of e2e (playwright.config webServer boots the seeded stack).

const ROUTES = [
  { name: 'Home',       path: '/app' },
  { name: 'Products',   path: '/app/products' },
  { name: 'Pricing',    path: '/app/products/PH.PROD.001/pricing' },
  { name: 'Claims',     path: '/app/claims' },
  { name: 'Dictionary', path: '/app/dictionary' },
]

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByPlaceholder('first name').fill('sal')
  await page.getByPlaceholder('last name').fill('scrudato')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 })
}

for (const theme of ['light', 'dark'] as const) {
  for (const route of ROUTES) {
    test(`axe (${theme}): ${route.name} — no serious/critical violations`, async ({ page }) => {
      // Pin the theme BEFORE first paint (the no-FOUC script in index.html reads pf.theme).
      await page.addInitScript((t) => { try { localStorage.setItem('pf.theme', t) } catch { /* ignore */ } }, theme)
      await signIn(page)
      await page.goto(route.path)
      // Let live subscriptions resolve (skeleton → populated) so we audit the real surface.
      await page.waitForTimeout(1500)

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      const summary = blocking.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }))
      expect(blocking, `axe ${theme}/${route.name}:\n${JSON.stringify(summary, null, 2)}`).toEqual([])
    })
  }
}
