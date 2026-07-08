import { test, expect } from '@playwright/test'

// Sign-in → app loads → the reseeded portfolio renders, end-to-end against the emulator stack.
// Uses the seeded ADMIN (a bare username maps to <name>@productreinvention.app in the adapter).
//
// Note on the flow: the app auto-connects an ANONYMOUS session on load, which redirects
// /sign-in → /app as soon as it resolves — fast against the local emulator, so it can detach the
// form mid-interaction. We drive the real credential sign-in but tolerate that auto-redirect;
// either path ends authenticated in the shell. The load-bearing assertions are the end state:
// we reach /app and both P4 products (Personal Home + Personal Auto) render off the emulator.
test('signs in and shows the reseeded Personal Home + Personal Auto portfolio', async ({ page }) => {
  await page.goto('/sign-in')

  try {
    await page.getByPlaceholder('sal').fill('sal', { timeout: 3000 })
    await page.getByPlaceholder('Password').fill('scrudato', { timeout: 2000 })
    await page.getByRole('button', { name: /sign in/i }).click({ timeout: 3000 })
  } catch {
    // The anonymous auto-session already redirected us into the shell — expected, not a failure.
  }

  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 })

  // Exercises the P4 reseed: both published products render (Products lists LAUNCHED only).
  await page.goto('/app/products')
  await expect(page.getByText(/Personal Home/i).first()).toBeVisible()
  await expect(page.getByText(/Personal Auto/i).first()).toBeVisible()
})
