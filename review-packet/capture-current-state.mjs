// review-packet/capture-current-state.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Current-state screenshot capture for the LIVE Azure app (app-prodhub-dev).
// Walks every route in light + dark and writes PNGs into review-packet/screens/.
//
// WHY a token: all /app/* screens are behind auth. Login is OTP-by-email or a
// bootstrap password — neither can be automated headlessly without a secret. So
// this script authenticates by INJECTING a bearer token you already hold into
// localStorage['pf.azure.token'] (exactly how the real app stores it).
//
// ── One-time: get a token ────────────────────────────────────────────────────
//   1. Sign in to https://app-prodhub-dev.azurewebsites.net in your browser.
//   2. DevTools → Application → Local Storage → copy the value of  pf.azure.token
//
// ── Run (PowerShell) ─────────────────────────────────────────────────────────
//   cd review-packet
//   npm i playwright@1.61.1            # browsers are already cached on this machine
//   $env:PF_JWT = "<paste token>"
//   node capture-current-state.mjs
//
//   # optional overrides:
//   $env:PF_BASE_URL = "https://app-prodhub-dev.azurewebsites.net"   # default
//   $env:PF_HO = "HO.PROD.001"; $env:PF_GL = "GL.PROD.001"           # product ids
//   $env:PF_THEMES = "light,dark"                                    # or "light"
//
// With NO PF_JWT set, only the public screens (Landing, HomeCheck) are captured
// and every /app route is skipped with a clear note — the script still succeeds.
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'screens');
mkdirSync(OUT, { recursive: true });

const BASE = (process.env.PF_BASE_URL || 'https://app-prodhub-dev.azurewebsites.net').replace(/\/$/, '');
const JWT = process.env.PF_JWT || '';
const HO = process.env.PF_HO || 'HO.PROD.001';
const GL = process.env.PF_GL || 'GL.PROD.001';
const THEMES = (process.env.PF_THEMES || 'light,dark').split(',').map(s => s.trim()).filter(Boolean);

// Route catalog: [slug, path, settleMs, requiresAuth]
const PUBLIC_ROUTES = [
  ['01-landing', '/', 1500, false],
  ['02-home-check-guest', '/home-check', 2000, false],
];
const AUTH_ROUTES = [
  ['03-home-cockpit', '/app', 3000, true],
  ['04-products', '/app/products', 2600, true],
  ['05-ho-overview', `/app/products/${HO}/overview`, 9000, true],
  ['06-ho-coverages', `/app/products/${HO}/coverages`, 2800, true],
  ['07-ho-forms', `/app/products/${HO}/forms`, 2800, true],
  ['08-ho-pricing-1528', `/app/products/${HO}/pricing`, 3000, true],
  ['09-ho-states', `/app/products/${HO}/states`, 3000, true],
  ['10-ho-rules', `/app/products/${HO}/rules`, 3000, true],
  ['11-gl-overview', `/app/products/${GL}/overview`, 9000, true],
  ['12-gl-coverages', `/app/products/${GL}/coverages`, 2800, true],
  ['13-gl-pricing-2635', `/app/products/${GL}/pricing`, 3000, true],
  ['14-gl-states', `/app/products/${GL}/states`, 3000, true],
  ['15-builder', '/app/builder', 2600, true],
  ['16-explorer', '/app/explorer', 3000, true],
  ['17-tasks-gtm', '/app/tasks', 2600, true],
  ['18-news', '/app/news', 2600, true],
  ['19-claims', '/app/claims', 2600, true],
  ['20-dictionary', '/app/dictionary', 2600, true],
  ['21-feedback', '/app/feedback', 2600, true],
  ['22-admin', '/app/admin', 2600, true],
  ['23-tenant-admin', '/app/tenant-admin', 2600, true],
];

const manifest = [];

async function main() {
  const hasAuth = Boolean(JWT);
  console.log(`[capture] base=${BASE}  auth=${hasAuth ? 'token' : 'NONE (public screens only)'}  themes=${THEMES.join(',')}`);

  const browser = await chromium.launch();
  for (const theme of THEMES) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      colorScheme: theme,
      deviceScaleFactor: 2,
    });
    // Pin the app's own theme + inject the bearer token before any app code runs.
    await ctx.addInitScript(([t, jwt]) => {
      try { localStorage.setItem('pf.theme', t); } catch {}
      if (jwt) { try { localStorage.setItem('pf.azure.token', jwt); } catch {} }
    }, [theme, JWT]);

    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);

    const routes = hasAuth ? [...PUBLIC_ROUTES, ...AUTH_ROUTES] : PUBLIC_ROUTES;
    for (const [slug, path, settle, needsAuth] of routes) {
      const file = `${slug}.${theme}.png`;
      try {
        await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
        // If an auth route bounced us back to Landing, the token is bad/expired.
        if (needsAuth && new URL(page.url()).pathname === '/') {
          console.log(`[SKIP] ${file} — redirected to Landing (token missing/expired?)`);
          continue;
        }
        await page.waitForTimeout(settle);
        await page.screenshot({ path: join(OUT, file), fullPage: true });
        manifest.push({ file, path, theme });
        console.log(`[ok]  ${file}`);
      } catch (e) {
        console.log(`[FAIL] ${file} — ${e.message}`);
      }
    }
    await ctx.close();
  }
  await browser.close();

  writeFileSync(join(OUT, 'capture-manifest.json'), JSON.stringify({ base: BASE, capturedRoutes: manifest }, null, 2));
  console.log(`\n[done] ${manifest.length} screenshots → ${OUT}`);
  if (!hasAuth) console.log('[note] Set PF_JWT to also capture the ~21 authenticated /app screens.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
