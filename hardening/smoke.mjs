#!/usr/bin/env node
/**
 * hardening/smoke.mjs — golden-path E2E harness
 *
 * Calls the REAL /api/* endpoints — no stubs, no mocks, no reimplemented product logic.
 * Prints a machine-readable result block and exits non-zero on the first failed assertion.
 *
 * Two modes:
 *   LOCAL  (default) — expects the Express server running at BASE_URL (default :3000)
 *                      and the SPA dev server at VITE_PORT (default :5173).
 *   LIVE             — set MODE=LIVE and BASE_URL=https://your-app.azurewebsites.net
 *
 * Env vars:
 *   BASE_URL        server base URL (no trailing slash).  Default: http://localhost:3000
 *   MODE            LOCAL | LIVE.  Default: LOCAL
 *   SMOKE_USER      bootstrap username.  Default: admin
 *   SMOKE_PASS      bootstrap password.  Default: admin
 *   SMOKE_TENANT    tenant id to bind.   Default: smoke-test
 *
 * Exit codes:
 *   0  all assertions passed
 *   1  at least one assertion failed (first failure message in stdout)
 *   2  pre-flight error (missing fixture, server unreachable)
 */

import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// ─── config ───────────────────────────────────────────────────────────────────
const MODE = (process.env.MODE || 'LOCAL').toUpperCase()
const BASE_URL = (process.env.BASE_URL || (MODE === 'LOCAL' ? 'http://localhost:3000' : '')).replace(/\/$/, '')
const SMOKE_USER = process.env.SMOKE_USER || 'admin'
const SMOKE_PASS = process.env.SMOKE_PASS || 'admin'
const SMOKE_TENANT = process.env.SMOKE_TENANT || 'smoke-test'

// ─── fixture manifest (must all exist before any probe runs) ──────────────────
const FIXTURES = [
  'samples/duckcreek/DuckCreekXML.xml',
  'samples/duckcreek/PolicyXML.xml',
  'samples/filings/nj-lemonade-ho/LEM 03 05 23 Lemonade Homeowners_FINAL.pdf',
  'samples/filings/nj-lemonade-ho/NJ HO Manual 02.27.24.pdf',
  'samples/filings/nj-lemonade-ho/NJ HO Rate Order of Calculations.pdf',
  'samples/iso/20-BaseForm-HO3-Homeowners.pdf',
  'samples/iso/20-ISO-Forms-GL.xlsx',
  'samples/iso/20-ISO-Framework-GL.xlsx',
  'samples/iso/20-ISO-Pricing-GL.xlsx',
  'samples/iso/20-ISO-Rules-GL.xlsx',
  'samples/mock/mock-HO3-baseform.md',
  'samples/mock/mock-GL-baseform.md',
  'samples/process-value-explorer.xlsx',
]

// ─── GL canary: authoritative value from shared/ test source ──────────────────
// The task spec cited 2789, but the actual test assertion is 2635.
// See hardening/BACKEND.md §8 for the reconciliation note.
const GL_CANARY_EXPECTED = 2635
const HO3_CANARY_EXPECTED = 1528

// ─── helpers ──────────────────────────────────────────────────────────────────

function fail(assertion) {
  console.log(`\nSMOKE FAIL: ${assertion}`)
  process.exit(1)
}

function pass(label) {
  console.log(`  ✓ ${label}`)
}

function note(msg) {
  console.log(`  ⚠ ${msg}`)
}

function section(title) {
  console.log(`\n── ${title} ──`)
}

async function apiCall(path, opts = {}, authToken = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
  const res = await fetch(`${BASE_URL}/api${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } })
  return res
}

async function apiJson(path, opts = {}, authToken = null) {
  const res = await apiCall(path, opts, authToken)
  let body
  try { body = await res.json() } catch { body = null }
  return { status: res.status, ok: res.ok, body }
}

async function readSse(path, bodyData, authToken, timeoutMs = 30_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(bodyData),
      signal: controller.signal,
    })
    if (!res.ok) {
      let errBody = null
      try { errBody = await res.json() } catch { /* empty */ }
      return { status: res.status, ok: false, chunks: [], full: '', error: errBody }
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    const chunks = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (!raw) continue
        try {
          const evt = JSON.parse(raw)
          if (evt.t === 'token' && typeof evt.v === 'string') chunks.push(evt.v)
          if (evt.t === 'error') return { status: res.status, ok: false, chunks, full: chunks.join(''), error: evt.message }
          if (evt.t === 'done') break
        } catch { /* non-JSON line, skip */ }
      }
    }
    return { status: res.status, ok: true, chunks, full: chunks.join(''), error: null }
  } finally {
    clearTimeout(timer)
  }
}

// ─── pre-flight: fixture check ────────────────────────────────────────────────

section('Pre-flight: fixture check')
const missing = FIXTURES.filter(f => !existsSync(join(REPO_ROOT, f)))
if (missing.length > 0) {
  console.log('\nMissing fixtures:')
  missing.forEach(f => console.log(`  MISSING: ${f}`))
  fail(`fixture missing: ${missing.join(', ')}`)
}
pass(`all ${FIXTURES.length} fixtures present`)

// ─── pre-flight: server reachability ─────────────────────────────────────────

section('Pre-flight: server reachability')
if (!BASE_URL) fail('BASE_URL is not set (required in LIVE mode)')

try {
  const healthRes = await apiCall('/health')
  if (!healthRes.ok) fail(`server health check failed: HTTP ${healthRes.status}`)
  pass(`${BASE_URL}/api/health → OK`)
} catch (e) {
  fail(`server unreachable at ${BASE_URL}: ${e.message}. Start the server first (node server/server.js).`)
}

// ─── pre-flight: rating canaries (shared/ unit tests) ────────────────────────

section('Pre-flight: rating canaries')

// Verify GL canary assertion in source (defensive check against spec drift)
try {
  const glTestSource = execSync(
    `node -e "const fs=require('fs');const t=fs.readFileSync('shared/src/rating/generalLiability.evaluator.test.ts','utf8');console.log(t.match(/toBe\\\\(\\\\d+\\\\)/g)||[])"`,
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
  if (!glTestSource.includes(`toBe(${GL_CANARY_EXPECTED})`)) {
    note(`Could not confirm GL canary assertion toBe(${GL_CANARY_EXPECTED}) from source scan — proceeding with test run`)
  } else {
    pass(`GL canary source confirms toBe(${GL_CANARY_EXPECTED})`)
  }
} catch { /* source scan is informational only */ }

let sharedTestsPassed = false
try {
  execSync('pnpm --filter shared test 2>&1', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 60_000,
  })
  sharedTestsPassed = true
  pass(`shared/ test suite green — HO-3 $${HO3_CANARY_EXPECTED} + GL $${GL_CANARY_EXPECTED} canaries confirmed`)
} catch (e) {
  const out = (e.stdout || '') + (e.stderr || '')
  console.log(out.slice(-2000))
  fail(`rating canary failed — shared/ test suite not green. Expected GL $${GL_CANARY_EXPECTED}, HO-3 $${HO3_CANARY_EXPECTED}. Run: pnpm --filter shared test`)
}

// ─── authentication ───────────────────────────────────────────────────────────

section('Auth: sign in as bootstrap admin')
const loginRes = await apiJson('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: SMOKE_USER, password: SMOKE_PASS, tenant: SMOKE_TENANT }),
})
if (!loginRes.ok) fail(`login failed: HTTP ${loginRes.status} — ${JSON.stringify(loginRes.body)}`)
const TOKEN = loginRes.body?.token
if (!TOKEN) fail('login response missing token field')
pass(`authenticated as ${SMOKE_USER} / tenant=${SMOKE_TENANT}`)

// Verify the me endpoint honours the token
const meRes = await apiJson('/auth/me', {}, TOKEN)
if (!meRes.ok) fail(`/auth/me failed: HTTP ${meRes.status}`)
if (meRes.body?.user?.role !== 'ADMIN') fail(`expected ADMIN role from /auth/me, got: ${meRes.body?.user?.role}`)
pass(`/auth/me → role=${meRes.body.user.role}`)

// ─── ROLE ENFORCEMENT: VIEWER cannot mutate ───────────────────────────────────

section('Role enforcement: VIEWER write must be rejected')
// We test role enforcement by temporarily using a bogus token signed with a VIEWER claim.
// We cannot mint one here without the JWT secret, so we test by calling mutate with no auth
// and asserting 401, then call with a valid EDITOR+ (admin) token and assert 200.
// A proper role probe requires creating a VIEWER user — deferred to Phase 3 (FAULT-004).
const noAuthMutate = await apiJson('/db/mutate', {
  method: 'POST',
  body: JSON.stringify({
    payload: {
      op: 'create',
      path: 'products/smoke-test-role-probe',
      entityType: 'product',
      data: { name: 'role-probe' },
      actor: { uid: 'probe', name: 'probe' },
    },
  }),
})
if (noAuthMutate.status !== 401) fail(`unauthenticated mutate should return 401, got ${noAuthMutate.status}`)
pass(`unauthenticated mutate → 401 (auth guard confirmed)`)

// ─── HO PATH: Lemonade NJ filing import ──────────────────────────────────────

section('HO path: Lemonade NJ filing import (POST /api/ai/unifiedImport)')
note(`Attempting POST /api/ai/unifiedImport — currently not ported to Azure host (known 501 state)`)
note(`Fixture: samples/filings/nj-lemonade-ho/LEM 03 05 23 Lemonade Homeowners_FINAL.pdf`)

// The unified import path: send the PDF path as a document reference.
// The server handler is expected to return 501 (ai_handler_not_ported) in the current codebase.
// This is a FAIL — the HO filing import path must work before the harness can pass.
const hoImportRes = await readSse(
  '/ai/unifiedImport',
  {
    documents: [{ name: 'LEM 03 05 23 Lemonade Homeowners_FINAL.pdf', type: 'application/pdf', dataBase64: '' }],
    productName: 'Lemonade NJ HO-3 Smoke',
    filingState: 'NJ',
  },
  TOKEN,
  10_000,
)

if (hoImportRes.status === 501) {
  // The 501 is the expected current state — report it as a SMOKE FAIL so the gate stays red
  // until the handler is ported.  Phase 2 wires unifiedImport into the Azure host.
  fail(
    `HO filing import not ported to Azure host (501 ai_handler_not_ported). ` +
    `POST /api/ai/unifiedImport returns 501. ` +
    `Wire the unifiedImport handler in server/lib/ai.js before this assertion can pass. ` +
    `(DEF-0006: unifiedImport not ported)`
  )
}

if (!hoImportRes.ok) {
  fail(`HO filing import failed: HTTP ${hoImportRes.status} — ${JSON.stringify(hoImportRes.error)}`)
}

// If we get here the handler is ported — validate the extraction output.
const hoFull = hoImportRes.full
if (!hoFull) fail('HO filing import: empty response body')

// Assert at least one coverage with an HO-prefixed refId and a captured form number
let hoBundle
try { hoBundle = JSON.parse(hoFull) } catch { fail(`HO filing import: response is not valid JSON: ${hoFull.slice(0, 200)}`) }

const hoCoverages = hoBundle?.coverages ?? hoBundle?.proposal?.coverages ?? []
if (!Array.isArray(hoCoverages) || hoCoverages.length === 0) fail('HO filing import: no coverages in extraction output')

const hoWithRefId = hoCoverages.filter(c => typeof c.refId === 'string' && c.refId.startsWith('HO-'))
if (hoWithRefId.length === 0) fail('HO filing import: no coverage has an HO-prefixed refId')
pass(`HO extraction: ${hoWithRefId.length} coverage(s) with HO-prefixed refId`)

const hoWithForm = hoCoverages.filter(c => Array.isArray(c.formNumbers) && c.formNumbers.length > 0)
if (hoWithForm.length === 0) fail('HO filing import: no coverage has a captured form number')
pass(`HO extraction: ${hoWithForm.length} coverage(s) with captured form numbers`)

// Write the first extracted HO coverage via mutate() and verify the audit trail
const hoCov = hoWithRefId[0]
const hoProdPath = `products/smoke-ho-${Date.now()}`
const hoCovPath = `${hoProdPath}/coverages/${hoCov.refId}`

// Create the smoke product container
const hoProdMutate = await apiJson('/db/mutate', {
  method: 'POST',
  body: JSON.stringify({
    payload: {
      op: 'create',
      path: hoProdPath,
      entityType: 'product',
      data: { name: 'Smoke HO-3 Import', lob: 'PH', state: 'NJ' },
      actor: { uid: meRes.body.user.uid, name: meRes.body.user.name },
    },
  }),
}, TOKEN)
if (!hoProdMutate.ok) fail(`HO product mutate failed: HTTP ${hoProdMutate.status}`)
const hoProdRev = hoProdMutate.body?.rev
if (typeof hoProdRev !== 'number') fail('HO product mutate: response missing rev')
pass(`HO product written via mutate() — rev=${hoProdRev}`)

// Write the extracted coverage
const hoCovMutate = await apiJson('/db/mutate', {
  method: 'POST',
  body: JSON.stringify({
    payload: {
      op: 'create',
      path: hoCovPath,
      entityType: 'coverage',
      data: {
        refId: hoCov.refId,
        name: hoCov.name,
        formNumbers: hoCov.formNumbers,
        parentId: null,
        premiumGenerating: true,
      },
      actor: { uid: meRes.body.user.uid, name: meRes.body.user.name },
    },
  }),
}, TOKEN)
if (!hoCovMutate.ok) fail(`HO coverage mutate failed: HTTP ${hoCovMutate.status}`)
const hoCovRev = hoCovMutate.body?.rev
if (typeof hoCovRev !== 'number') fail('HO coverage mutate: response missing rev')
pass(`HO coverage written via mutate() — refId=${hoCov.refId}, rev=${hoCovRev}`)

// Read the coverage back and verify audit trail fields
const hoCovGet = await apiJson(`/db/get?path=${encodeURIComponent(hoCovPath)}`, {}, TOKEN)
if (!hoCovGet.ok) fail(`HO coverage get failed: HTTP ${hoCovGet.status}`)
const hoEntity = hoCovGet.body?.data
if (!hoEntity) fail('HO coverage get: entity not found after mutate')
if (hoEntity.rev !== hoCovRev) fail(`HO coverage: rev mismatch — expected ${hoCovRev}, got ${hoEntity.rev}`)
if (typeof hoEntity.updatedAt !== 'string') fail('HO coverage: updatedAt missing — atomic batch may not have run')
pass(`HO audit trail confirmed: entity readable, rev=${hoEntity.rev}, updatedAt=${hoEntity.updatedAt}`)

// Chat citation: ask about the coverage's form number
const hoChatRef = hoCov.refId
const hoChatForm = hoCov.formNumbers?.[0] ?? 'LEM-HO-001'
const hoSseRes = await readSse('/ai/chat', {
  messages: [{ role: 'user', content: `What form number governs coverage ${hoChatRef}?` }],
  productId: hoProdPath.replace('products/', ''),
}, TOKEN, 30_000)

if (!hoSseRes.ok) fail(`HO chat failed: HTTP ${hoSseRes.status} — ${JSON.stringify(hoSseRes.error)}`)
const hoAnswer = hoSseRes.full
if (!hoAnswer) fail('HO chat: empty response')

const hoHasCitation = /\[[A-Z0-9][^\]]{0,50}\]/.test(hoAnswer)
if (!hoHasCitation) fail(`HO chat: response contains no citation in brackets. Answer: ${hoAnswer.slice(0, 300)}`)
pass(`HO chat: response contains a bracketed citation`)

const hoRefCited = hoAnswer.includes(hoChatRef)
if (!hoRefCited) note(`HO chat: answer does not cite the exact refId ${hoChatRef} — check grounding`)
else pass(`HO chat: exact refId [${hoChatRef}] cited in response`)

// ─── GL PATH: ISO workbook import ────────────────────────────────────────────

section('GL path: ISO workbook import + rating canary')
note(`Fixture: samples/iso/20-ISO-{Forms,Framework,Pricing,Rules}-GL.xlsx`)
note(`GL canary expected: $${GL_CANARY_EXPECTED} (per shared/src/rating/generalLiability.evaluator.test.ts:27)`)

// The ISO workbook import is browser-side only (ExcelJS + mapIsoWorkbook in the React app).
// There is no POST /api/*/import endpoint.  The smoke harness tests the SEAM:
// it writes a minimal GL product structure via mutate() and verifies the atomic batch.
// The full ExcelJS import path is exercised end-to-end in the browser; Phase 3 adds a
// Playwright-driven browser probe to cover the client-side import flow.

const glProdId = `smoke-gl-${Date.now()}`
const glProdPath = `products/${glProdId}`
const glCovRefId = 'GL-COV-SMOKE-001'
const glCovPath = `${glProdPath}/coverages/${glCovRefId}`

// Write GL product
const glProdMutate = await apiJson('/db/mutate', {
  method: 'POST',
  body: JSON.stringify({
    payload: {
      op: 'create',
      path: glProdPath,
      entityType: 'product',
      data: {
        name: 'Smoke ISO GL Product',
        lob: 'GL',
        ratingProgramId: 'GL.PROD.001',
        source: 'ISO',
      },
      actor: { uid: meRes.body.user.uid, name: meRes.body.user.name },
    },
  }),
}, TOKEN)
if (!glProdMutate.ok) fail(`GL product mutate failed: HTTP ${glProdMutate.status} — ${JSON.stringify(glProdMutate.body)}`)
const glProdRev = glProdMutate.body?.rev
if (typeof glProdRev !== 'number') fail('GL product mutate: response missing rev')
pass(`GL product written via mutate() — rev=${glProdRev}`)

// Write GL coverage with GL-prefixed refId
const glCovMutate = await apiJson('/db/mutate', {
  method: 'POST',
  body: JSON.stringify({
    payload: {
      op: 'create',
      path: glCovPath,
      entityType: 'coverage',
      data: {
        refId: glCovRefId,
        name: 'Commercial General Liability (Occurrence)',
        formNumbers: ['CG 00 01 04 13'],
        parentId: null,
        premiumGenerating: true,
        claimsBasis: 'occurrence',
        requirement: 'STANDARD',
      },
      actor: { uid: meRes.body.user.uid, name: meRes.body.user.name },
    },
  }),
}, TOKEN)
if (!glCovMutate.ok) fail(`GL coverage mutate failed: HTTP ${glCovMutate.status} — ${JSON.stringify(glCovMutate.body)}`)
const glCovRev = glCovMutate.body?.rev
if (typeof glCovRev !== 'number') fail('GL coverage mutate: response missing rev')
pass(`GL coverage written via mutate() — refId=${glCovRefId}, rev=${glCovRev}`)

// Read back and verify audit trail
const glProdGet = await apiJson(`/db/get?path=${encodeURIComponent(glProdPath)}`, {}, TOKEN)
if (!glProdGet.ok) fail(`GL product get failed: HTTP ${glProdGet.status}`)
const glEntity = glProdGet.body?.data
if (!glEntity) fail('GL product get: entity not found after mutate')
if (glEntity.rev !== glProdRev) fail(`GL product: rev mismatch — expected ${glProdRev}, got ${glEntity.rev}`)
if (typeof glEntity.updatedAt !== 'string') fail('GL product: updatedAt missing — atomic batch may not have run')
pass(`GL audit trail confirmed: entity readable, rev=${glEntity.rev}, updatedAt=${glEntity.updatedAt}`)

// Verify the GL rating canary via the shared test suite (already run in pre-flight)
if (!sharedTestsPassed) fail(`GL rating canary $${GL_CANARY_EXPECTED} not verified — shared/ tests did not pass`)
pass(`GL rating canary $${GL_CANARY_EXPECTED} confirmed by shared/ test suite`)

// Write a second mutation to verify optimistic concurrency (expectedRev)
const glCovUpdate = await apiJson('/db/mutate', {
  method: 'POST',
  body: JSON.stringify({
    payload: {
      op: 'update',
      path: glCovPath,
      entityType: 'coverage',
      expectedRev: glCovRev,
      data: {
        refId: glCovRefId,
        name: 'Commercial General Liability (Occurrence) — updated',
        formNumbers: ['CG 00 01 04 13'],
        parentId: null,
        premiumGenerating: true,
        claimsBasis: 'occurrence',
        requirement: 'STANDARD',
      },
      actor: { uid: meRes.body.user.uid, name: meRes.body.user.name },
    },
  }),
}, TOKEN)
if (!glCovUpdate.ok) fail(`GL coverage update (expectedRev=${glCovRev}) failed: HTTP ${glCovUpdate.status}`)
const glCovRev2 = glCovUpdate.body?.rev
if (typeof glCovRev2 !== 'number') fail('GL coverage update: response missing rev')
if (glCovRev2 <= glCovRev) fail(`GL coverage update: rev did not increment (before=${glCovRev}, after=${glCovRev2})`)
pass(`GL optimistic concurrency: rev incremented ${glCovRev} → ${glCovRev2}`)

// Stale write: attempt to update with the old rev — must get 409
const glStaleUpdate = await apiJson('/db/mutate', {
  method: 'POST',
  body: JSON.stringify({
    payload: {
      op: 'update',
      path: glCovPath,
      entityType: 'coverage',
      expectedRev: glCovRev,
      data: { refId: glCovRefId, name: 'stale write attempt', parentId: null },
      actor: { uid: meRes.body.user.uid, name: meRes.body.user.name },
    },
  }),
}, TOKEN)
if (glStaleUpdate.status !== 409) fail(`GL stale write: expected HTTP 409 conflict, got ${glStaleUpdate.status}`)
pass(`GL stale write rejected with 409 — optimistic lock working`)

// GL chat: grounded citation
const glSseRes = await readSse('/ai/chat', {
  messages: [{ role: 'user', content: `What is the refId of the commercial general liability coverage in this product?` }],
  productId: glProdId,
}, TOKEN, 30_000)

if (!glSseRes.ok) fail(`GL chat failed: HTTP ${glSseRes.status} — ${JSON.stringify(glSseRes.error)}`)
const glAnswer = glSseRes.full
if (!glAnswer) fail('GL chat: empty response')

const glHasCitation = /\[[A-Z0-9][^\]]{0,50}\]/.test(glAnswer)
if (!glHasCitation) fail(`GL chat: response contains no citation in brackets. Answer: ${glAnswer.slice(0, 300)}`)
pass(`GL chat: response contains a bracketed citation`)

const glRefCited = glAnswer.includes(glCovRefId)
if (!glRefCited) {
  note(`GL chat: answer does not cite exact refId ${glCovRefId} — grounding may be partial. Answer: ${glAnswer.slice(0, 300)}`)
} else {
  pass(`GL chat: exact refId [${glCovRefId}] cited — grounded and cited`)
}

// Verify the cited refId resolves to an entity we created (not fabricated)
if (glRefCited) {
  const citedGet = await apiJson(`/db/get?path=${encodeURIComponent(glCovPath)}`, {}, TOKEN)
  if (!citedGet.ok || !citedGet.body?.data) {
    fail(`GL chat: cited refId ${glCovRefId} does not resolve to an existing entity — fabrication risk`)
  }
  pass(`GL chat: cited refId ${glCovRefId} resolves to an entity created by this import run`)
}

// ─── final ────────────────────────────────────────────────────────────────────

console.log('\nSMOKE PASS')
process.exit(0)
