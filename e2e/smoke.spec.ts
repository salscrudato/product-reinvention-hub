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

  await page.getByPlaceholder('sal').fill('sal')
  await page.getByPlaceholder('Password').fill('scrudato')
  await page.locator('button[type="submit"]').click()

  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 })

  // Exercises the P4 reseed: both published products render (Products lists LAUNCHED only).
  await page.goto('/app/products')
  await expect(page.getByText(/Personal Home/i).first()).toBeVisible()
  await expect(page.getByText(/Personal Auto/i).first()).toBeVisible()
})
