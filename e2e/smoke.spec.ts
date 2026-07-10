import { test, expect } from '@playwright/test'

// Sign-in → app loads → the reseeded portfolio renders, end-to-end against the emulator stack.
// Uses the seeded ADMIN (a bare username maps to <name>@productreinvention.app in the adapter).
//
// Note on the flow: sign-in lives inline on the landing page (there is no separate /sign-in
// route). The app also auto-connects an ANONYMOUS session on load, but the landing only
// redirects a *real* (credentialed, email-bearing) session to /app — anonymous visitors stay,
// so the form never detaches mid-interaction. We fill it and target the hero's submit button
// (button[type="submit"]) to disambiguate it from the header "Sign in →" link. The load-bearing
// assertions are the end state: we reach /app and both P4 products render off the emulator.
test('signs in and shows the reseeded Personal Home + Personal Auto portfolio', async ({ page }) => {
  await page.goto('/')

  await page.getByPlaceholder('first name').fill('sal')
  await page.getByPlaceholder('last name').fill('scrudato')
  await page.locator('button[type="submit"]').click()

  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 })

  // Exercises the P4 reseed: both published products render (Products lists LAUNCHED only).
  await page.goto('/app/products')
  await expect(page.getByText(/Personal Home/i).first()).toBeVisible()
  await expect(page.getByText(/Personal Auto/i).first()).toBeVisible()
})

// GTM launch tracker — the full authoring loop against the emulator stack: create a project
// with a deadline → seed the board from the L1–L4 process (auto-offered) → the last pre-launch
// task lands on the deadline and a launch runway renders → complete a task (it drops into
// Completed) → un-complete restores it to the board.
test('GTM tracker: create project → seed → complete → restore', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('first name').fill('sal')
  await page.getByPlaceholder('last name').fill('scrudato')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 })

  await page.goto('/app/tasks')

  // Create the first project (deadline is prefilled with a healthy default runway).
  await page.getByRole('button', { name: /create your first project|new project/i }).first().click()
  await page.getByLabel('Project name').fill(`E2E Launch ${Date.now()}`)
  await page.getByRole('button', { name: 'Create project' }).click()

  // The seed dialog is auto-offered → seed the board from the process.
  await expect(page.getByRole('heading', { name: 'Seed tasks from process' })).toBeVisible()
  await page.getByRole('button', { name: /seed board/i }).click()

  // Board populated + the launch runway renders; a known seeded task is visible.
  await expect(page.getByText('Launch runway')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Deploy to production').first()).toBeVisible()

  // Complete a task → it leaves its column and a Reopen control appears in Completed.
  await page.getByRole('button', { name: 'Mark complete' }).first().click()
  await expect(page.getByRole('button', { name: 'Reopen task' }).first()).toBeVisible({ timeout: 10_000 })

  // Un-completing restores it (no reopen controls left).
  await page.getByRole('button', { name: 'Reopen task' }).first().click()
  await expect(page.getByRole('button', { name: 'Reopen task' })).toHaveCount(0, { timeout: 10_000 })
})

// Pricing centerpiece — the on-screen worked example prices to each line's canary. Open each
// seeded product's Pricing tab, click "Worked example" (fills the LOB kit example), and read
// the rendered premium: it must equal that line's regression lock. One step per registered
// line — the browser-level companion to shared/src/rating/workedExample.canary.test.ts.
const PRICING_CANARIES = [
  { pid: 'PH.PROD.001', line: 'Personal Home',     premium: '$1,528' },
  { pid: 'PA.PROD.001', line: 'Personal Auto',     premium: '$1,002' },
  { pid: 'GL.PROD.001', line: 'General Liability',  premium: '$2,635' },
]
for (const { pid, line, premium } of PRICING_CANARIES) {
  test(`Pricing: ${line} worked example prices to ${premium}`, async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('first name').fill('sal')
    await page.getByPlaceholder('last name').fill('scrudato')
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 })

    // Product doc ids are the product refIds (seed.ts) — navigate straight to Pricing.
    await page.goto(`/app/products/${pid}/pricing`)
    await page.getByRole('button', { name: /worked example/i }).click()
    // Premium is spring-animated; toHaveText waits for it to settle on the canary.
    await expect(page.getByTestId('calculated-premium')).toHaveText(premium, { timeout: 15_000 })
  })
}

// A read-only session (no editor role) must not see the create/seed controls — the UI half of
// the two-sided role enforcement (firestore.rules is the server half).
test('GTM tracker: a read-only session sees no create/seed controls', async ({ page }) => {
  // No sign-in → an anonymous, role-less session (canEdit === false).
  await page.goto('/app/tasks')
  await expect(page.getByRole('button', { name: /^new project$/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /create your first project/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /seed from process/i })).toHaveCount(0)
})
