import { defineConfig, devices } from '@playwright/test'

// One real end-to-end smoke (B7): sign in as a seeded admin and confirm the reseeded portfolio
// (Personal Home + Personal Auto) actually renders — proving the app boots and reads live data
// off the emulator stack, not just that units pass. The webServer boots the whole local stack
// via `firebase emulators:exec` + scripts/e2e-serve.mjs; Playwright waits for Vite before running.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['line']],
  use: {
    // Dedicated e2e port (not the default 5173) so we never reuse a developer's `pnpm dev`
    // server — that runs in the prod-pointing `development` mode and would read live data.
    baseURL: 'http://127.0.0.1:5178',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'firebase emulators:exec --only firestore,auth --project productreinvention "node scripts/e2e-serve.mjs"',
    url: 'http://127.0.0.1:5178',
    timeout: 180_000,
    reuseExistingServer: false,   // always boot our own emulator-mode stack; never reuse a stray server
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
