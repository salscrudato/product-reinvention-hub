/**
 * Comprehensive screenshot + PDF capture for Product Reinvention Hub.
 * Covers all 20 UI surfaces + key product workspace tabs (HO-3 and PA).
 * Outputs individual PNGs to fable-handoff/screenshots/ and a single
 * consolidated fable-handoff/screenshots/ALL_SCREENS.pdf.
 *
 * Pre-requisite: pnpm dev:seed must be running.
 * Usage: node fable-handoff/take-screenshots.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir    = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://127.0.0.1:5173';
const FS_API   = 'http://127.0.0.1:8080/v1/projects/productreinvention/databases/(default)/documents';
const SHOTS    = join(__dir, 'screenshots');
const VP       = { width: 1440, height: 900 };
const TIMEOUT  = 30_000;

if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

// ── Helpers ────────────────────────────────────────────────────────────────────

let shotLog = []; // [{file, label}]

async function shot(page, file, label) {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SHOTS, file) });
  shotLog.push({ file, label });
  console.log(`  ✓  ${label} → ${file}`);
}

async function go(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForTimeout(2000);
}

async function fsGet(path) {
  const r = await fetch(`${FS_API}/${path}?pageSize=20`, {
    headers: { Authorization: 'Bearer owner' }
  });
  return r.json();
}

// ── Main ───────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: VP });
const page    = await ctx.newPage();
page.setDefaultTimeout(TIMEOUT);

try {
  // S01 — Landing (unauthenticated anonymous session)
  console.log('\n── S01  Landing ──');
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForTimeout(2000);
  await shot(page, 's01-landing.png', 'S01 · Landing — sign-in + insight graph');

  // Sign in as ADMIN
  console.log('\n── Sign in ──');
  await page.waitForSelector('#signin-username', { timeout: TIMEOUT });
  await page.fill('#signin-username', 'sal');
  await page.fill('input[type="password"]', 'scrudato');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/app**', { timeout: TIMEOUT });
  await page.waitForTimeout(3000);
  console.log('  ✓  Signed in as ADMIN');

  // S04 — Home
  console.log('\n── S04  Home ──');
  await go(page, '/app');
  await shot(page, 's04-home.png', 'S04 · Home — portfolio chat + priority rail');

  // Discover product IDs from emulator (auth required)
  const fsResp = await fsGet('products');
  const docs = fsResp.documents ?? [];
  const pids = docs.map(d => d.name?.split('/').pop()).filter(Boolean);
  console.log(`\n  Product IDs: ${pids.join(', ')}`);

  // Sort so HO-3 (PH) is first, PA second
  pids.sort((a, b) => (a.startsWith('PH') ? -1 : a.startsWith('PA') ? 1 : 0) - (b.startsWith('PH') ? -1 : b.startsWith('PA') ? 1 : 0));
  const [pid1, pid2] = pids;

  // S05 — Products
  console.log('\n── S05  Products ──');
  await go(page, '/app/products');
  await page.waitForTimeout(1500);
  await shot(page, 's05-products.png', 'S05 · Products — published portfolio grid');

  // Product workspace for each product
  for (const [pid, label] of [[pid1, 'HO-3'], [pid2, 'PA']].filter(([p]) => p)) {
    const prefix = label === 'HO-3' ? 'ho3' : 'pa';
    const base   = `/app/products/${pid}`;
    console.log(`\n── Product workspace: ${label} (${pid}) ──`);

    await go(page, `${base}/overview`);
    await shot(page, `s07-${prefix}-overview.png`, `S07 · ${label} Overview — AI summary + lineage`);

    await go(page, `${base}/coverages`);
    await shot(page, `s08-${prefix}-coverages.png`, `S08 · ${label} Coverages — card view with terms`);

    await go(page, `${base}/forms`);
    await shot(page, `s09-${prefix}-forms.png`, `S09 · ${label} Forms — library tab`);

    await go(page, `${base}/pricing`);
    await shot(page, `s10-${prefix}-pricing.png`, `S10 · ${label} Pricing — interactive rating worksheet`);

    await go(page, `${base}/states`);
    await shot(page, `s11-${prefix}-states.png`, `S11 · ${label} States — US footprint tile map`);

    await go(page, `${base}/rules`);
    await shot(page, `s12-${prefix}-rules.png`, `S12 · ${label} Rules — rules table`);
  }

  // S13 — Builder
  console.log('\n── S13  Builder ──');
  await go(page, '/app/builder');
  await shot(page, 's13-builder.png', 'S13 · Builder — draft product workbench');

  // S14 — Explorer (empty + results)
  console.log('\n── S14  Explorer ──');
  await go(page, '/app/explorer');
  await shot(page, 's14-explorer.png', 'S14 · Explorer — global entity search (empty)');
  const input = page.locator('input').first();
  if (await input.isVisible().catch(() => false)) {
    await input.fill('coverage');
    await page.waitForTimeout(1800);
    await shot(page, 's14b-explorer-results.png', 'S14b · Explorer — search results for "coverage"');
  }

  // S15 — GTM Board
  console.log('\n── S15  Tasks / GTM Board ──');
  await go(page, '/app/tasks');
  await shot(page, 's15-tasks.png', 'S15 · Tasks — GTM launch Kanban board');

  // S16 — News
  console.log('\n── S16  News ──');
  await go(page, '/app/news');
  await shot(page, 's16-news.png', 'S16 · News — market news feed');

  // S17 — Claims
  console.log('\n── S17  Claims ──');
  await go(page, '/app/claims');
  await shot(page, 's17-claims.png', 'S17 · Claims — coverage copilot (base forms library + chat)');

  // S18 — Dictionary
  console.log('\n── S18  Dictionary ──');
  await go(page, '/app/dictionary');
  await shot(page, 's18-dictionary.png', 'S18 · Dictionary — data dictionary browser');

  // S19 — Feedback
  console.log('\n── S19  Feedback ──');
  await go(page, '/app/feedback');
  await shot(page, 's19-feedback.png', 'S19 · Feedback — Kanban board (Inbox/In Progress/Done)');

  // S20 — Admin
  console.log('\n── S20  Admin ──');
  await go(page, '/app/admin');
  await shot(page, 's20-admin-users.png', 'S20 · Admin — user management');
  // Try AI Cost tab
  const costTab = page.locator('[role="tab"]:has-text("Cost"), button:has-text("Cost"), a:has-text("Cost")').first();
  if (await costTab.isVisible().catch(() => false)) {
    await costTab.click();
    await page.waitForTimeout(800);
    await shot(page, 's20b-admin-cost.png', 'S20b · Admin — AI cost telemetry tab');
  }

  // ── Generate consolidated PDF ──────────────────────────────────────────────
  console.log('\n── Generating PDF ──');

  // Build HTML with all captured screenshots as embedded base64 images
  const pngs = shotLog.filter(s => existsSync(join(SHOTS, s.file)));
  const imgHtml = pngs.map(({ file, label }) => {
    const data = readFileSync(join(SHOTS, file));
    const b64  = data.toString('base64');
    return `
    <div class="page">
      <div class="label">${label}</div>
      <img src="data:image/png;base64,${b64}" alt="${label}" />
    </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #0f0f14; color: #e2e8f0; }
  .cover { display: flex; flex-direction: column; align-items: center; justify-content: center;
           min-height: 100vh; gap: 24px; padding: 48px; background: linear-gradient(135deg, #0f0f14 0%, #1a1a2e 100%); }
  .cover h1 { font-size: 2.5rem; font-weight: 700; text-align: center;
              background: linear-gradient(135deg, #818cf8, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .cover p { font-size: 1rem; color: #94a3b8; text-align: center; max-width: 600px; line-height: 1.6; }
  .cover .meta { font-size: 0.8rem; color: #64748b; }
  .page { page-break-before: always; padding: 0; }
  .label { padding: 8px 16px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em;
           background: #1e293b; color: #94a3b8; border-bottom: 1px solid #334155; }
  .page img { width: 100%; display: block; }
</style>
</head>
<body>
  <div class="cover">
    <h1>Product Reinvention Hub</h1>
    <p>Complete UI surface screenshot capture — ${pngs.length} screens across the full application, from Landing to Admin.</p>
    <p class="meta">Compiled ${new Date().toISOString().split('T')[0]} · fable-handoff/screenshots/</p>
  </div>
  ${imgHtml}
</body>
</html>`;

  // Use Playwright to render the HTML and print to PDF
  const pdfPage = await ctx.newPage();
  await pdfPage.setContent(html, { waitUntil: 'load' });
  const pdfPath = join(SHOTS, 'ALL_SCREENS.pdf');
  await pdfPage.pdf({
    path: pdfPath,
    format: 'A3',
    landscape: true,
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });
  await pdfPage.close();
  console.log(`  ✓  PDF → ALL_SCREENS.pdf  (${pngs.length} pages)`);

  // Summary
  console.log(`\n✅  Done! ${pngs.length} screenshots + 1 PDF`);
  console.log(`📁  ${SHOTS}`);
  readdirSync(SHOTS).forEach(f => console.log(`     ${f}`));

} catch (err) {
  console.error('\n❌  Failed:', err.message, err.stack);
  process.exit(1);
} finally {
  await browser.close();
}
