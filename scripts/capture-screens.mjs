/**
 * Comprehensive screenshot + PDF capture for Product Reinvention Hub.
 * Covers all 20 UI surfaces + key product workspace tabs (HO-3 and PA) + the filing-import
 * surface, in BOTH themes (light + dark — the theme toggle added this session).
 * Outputs individual PNGs to docs/review/screens-after/ (suffixed -light / -dark) and a single
 * consolidated docs/review/screens-after/ALL_SCREENS.pdf.
 *
 * Pre-requisite: the seeded emulator stack + app on port 5173 (pnpm dev:seed).
 *
 * Credentials (in priority order):
 *   1. CAPTURE_USER / CAPTURE_PASS environment variables
 *   2. A seeded EDITOR account — set these env vars to match scripts/seed.ts
 *
 * Usage:
 *   CAPTURE_USER=editor@productreinvention.app CAPTURE_PASS=editor node scripts/capture-screens.mjs
 *   # or just (uses env-var fallback):
 *   node scripts/capture-screens.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dir    = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(__dir, '..');
const BASE_URL = 'http://127.0.0.1:5173';
const FS_API   = 'http://127.0.0.1:8080/v1/projects/productreinvention/databases/(default)/documents';
const SHOTS    = join(ROOT, 'docs', 'review', 'screens-after');
const VP       = { width: 1440, height: 900 };
const TIMEOUT  = 30_000;
const THEMES   = ['light', 'dark'];

// Credentials — the landing sign-in is a first-name / last-name form (the adapter maps it to
// a seeded account); mirrors e2e/smoke.spec.ts. Defaults to the seeded ADMIN (sal scrudato).
const CAPTURE_FIRST = process.env.CAPTURE_FIRST ?? 'sal';
const CAPTURE_LAST  = process.env.CAPTURE_LAST ?? 'scrudato';

if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

// ── Helpers ────────────────────────────────────────────────────────────────────

const shotLog = []; // [{file, label, theme}]

async function shot(page, file, label, theme) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SHOTS, file) });
  shotLog.push({ file, label, theme });
  console.log(`  ✓  ${label} → ${file}`);
}

async function go(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForTimeout(1800);
}

async function fsGet(path) {
  const r = await fetch(`${FS_API}/${path}?pageSize=20`, { headers: { Authorization: 'Bearer owner' } });
  return r.json();
}

// ── One full pass in a given theme ───────────────────────────────────────────────

async function capturePass(browser, theme) {
  console.log(`\n╔══ THEME: ${theme.toUpperCase()} ═══════════════════════════════════════`);
  const ctx = await browser.newContext({ viewport: VP, colorScheme: theme });
  // Pin the app theme BEFORE first paint (the no-FOUC script in index.html reads pf.theme).
  await ctx.addInitScript((t) => { try { localStorage.setItem('pf.theme', t) } catch { /* ignore */ } }, theme);
  const page = await ctx.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const sfx = (name) => `${name}-${theme}.png`;
  const S = (name, label) => shot(page, sfx(name), label, theme);

  // S01 — Landing (unauthenticated anonymous session)
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForTimeout(1800);
  await S('s01-landing', 'S01 · Landing');

  // Sign in — first-name / last-name landing form (see e2e/smoke.spec.ts).
  await page.getByPlaceholder('first name').fill(CAPTURE_FIRST);
  await page.getByPlaceholder('last name').fill(CAPTURE_LAST);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/app**', { timeout: TIMEOUT });
  await page.waitForTimeout(2500);
  console.log(`  ✓  Signed in as ${CAPTURE_FIRST} ${CAPTURE_LAST}`);

  await go(page, '/app');
  await S('s04-home', 'S04 · Home — portfolio chat + priority rail');

  const fsResp = await fsGet('products');
  const pids = (fsResp.documents ?? []).map(d => d.name?.split('/').pop()).filter(Boolean);
  pids.sort((a, b) => (a.startsWith('PH') ? -1 : a.startsWith('PA') ? 1 : 0) - (b.startsWith('PH') ? -1 : b.startsWith('PA') ? 1 : 0));
  const [pid1, pid2] = pids;

  await go(page, '/app/products');
  await S('s05-products', 'S05 · Products — published portfolio grid');

  for (const [pid, label] of [[pid1, 'HO-3'], [pid2, 'PA']].filter(([p]) => p)) {
    const prefix = label === 'HO-3' ? 'ho3' : 'pa';
    const base   = `/app/products/${pid}`;
    await go(page, `${base}/overview`);   await S(`s07-${prefix}-overview`,  `S07 · ${label} Overview`);
    await go(page, `${base}/coverages`);  await S(`s08-${prefix}-coverages`, `S08 · ${label} Coverages`);
    await go(page, `${base}/forms`);      await S(`s09-${prefix}-forms`,     `S09 · ${label} Forms`);
    await go(page, `${base}/pricing`);    await S(`s10-${prefix}-pricing`,   `S10 · ${label} Pricing`);
    await go(page, `${base}/states`);     await S(`s11-${prefix}-states`,    `S11 · ${label} States`);
    await go(page, `${base}/rules`);      await S(`s12-${prefix}-rules`,     `S12 · ${label} Rules`);
  }

  await go(page, '/app/builder');
  await S('s13-builder', 'S13 · Builder — draft product workbench');

  // Filing-import surface (workstream H): open the "Import a filing" card from the Builder.
  try {
    const card = page.locator('button:has-text("filing"), [role="button"]:has-text("filing")').first();
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1200);
      await S('s13b-filing-import', 'S13b · Filing import — reviewable-filing ingestion');
      await page.keyboard.press('Escape').catch(() => {});
    } else {
      console.log('  ·  filing-import card not found — skipped');
    }
  } catch (e) { console.log('  ·  filing-import capture skipped:', e.message); }

  await go(page, '/app/explorer');
  await S('s14-explorer', 'S14 · Explorer — global entity search (empty)');
  const input = page.locator('input').first();
  if (await input.isVisible().catch(() => false)) {
    await input.fill('coverage');
    await page.waitForTimeout(1600);
    await S('s14b-explorer-results', 'S14b · Explorer — results for "coverage"');
  }

  await go(page, '/app/tasks');      await S('s15-tasks',      'S15 · Tasks — GTM launch board');
  await go(page, '/app/news');       await S('s16-news',       'S16 · News — market feed');
  await go(page, '/app/claims');     await S('s17-claims',     'S17 · Claims — coverage copilot');
  await go(page, '/app/dictionary'); await S('s18-dictionary', 'S18 · Dictionary');
  await go(page, '/app/feedback');   await S('s19-feedback',   'S19 · Feedback — board');
  await go(page, '/app/admin');      await S('s20-admin-users','S20 · Admin — users');
  const costTab = page.locator('[role="tab"]:has-text("Cost"), button:has-text("Cost")').first();
  if (await costTab.isVisible().catch(() => false)) {
    await costTab.click();
    await page.waitForTimeout(800);
    await S('s20b-admin-cost', 'S20b · Admin — AI cost + breaker');
  }

  await ctx.close();
}

// ── Main ───────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: true });
try {
  for (const theme of THEMES) await capturePass(browser, theme);

  // Consolidated PDF (both themes, in capture order).
  console.log('\n── Generating PDF ──');
  const pngs = shotLog.filter(s => existsSync(join(SHOTS, s.file)));
  const imgHtml = pngs.map(({ file, label }) => {
    const b64 = readFileSync(join(SHOTS, file)).toString('base64');
    return `<div class="page"><div class="label">${label}</div><img src="data:image/png;base64,${b64}" alt="${label}" /></div>`;
  }).join('\n');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f0f14;color:#e2e8f0}
    .cover{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:24px;padding:48px;background:linear-gradient(135deg,#0f0f14 0%,#1a1a2e 100%)}
    .cover h1{font-size:2.5rem;font-weight:700;text-align:center;background:linear-gradient(135deg,#a100ff,#7a00e6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .cover p{font-size:1rem;color:#94a3b8;text-align:center;max-width:640px;line-height:1.6}
    .page{page-break-before:always}
    .label{padding:8px 16px;font-size:11px;font-weight:600;letter-spacing:.05em;background:#1e293b;color:#94a3b8;border-bottom:1px solid #334155}
    .page img{width:100%;display:block}
  </style></head><body>
    <div class="cover"><h1>Product Reinvention Hub</h1>
      <p>UI surface capture — ${pngs.length} screens across the full application in BOTH themes (light + dark).</p>
      <p class="meta">Compiled ${new Date().toISOString().split('T')[0]} · docs/review/screens-after/</p>
    </div>${imgHtml}</body></html>`;
  const ctx2 = await browser.newContext({ viewport: VP });
  const pdfPage = await ctx2.newPage();
  await pdfPage.setContent(html, { waitUntil: 'load' });
  await pdfPage.pdf({ path: join(SHOTS, 'ALL_SCREENS.pdf'), format: 'A3', landscape: true, printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  await ctx2.close();
  console.log(`  ✓  PDF → ALL_SCREENS.pdf  (${pngs.length} pages)`);

  console.log(`\n✅  Done! ${pngs.length} screenshots (${THEMES.join(' + ')}) + 1 PDF`);
  readdirSync(SHOTS).forEach(f => console.log(`     ${f}`));
} catch (err) {
  console.error('\n❌  Failed:', err.message, err.stack);
  process.exit(1);
} finally {
  await browser.close();
}
