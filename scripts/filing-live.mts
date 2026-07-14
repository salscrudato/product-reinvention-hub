// scripts/filing-live.mts — live end-to-end proof for the 5-step filing flow (Lane B).
//
// Runs against a deployed /api host in an ISOLATED tenant (never testco) and proves:
//   1. SCOPE   — VIEWER is rejected server-side (403 need=filing:generate)
//   2. RESOLVE — filed fields come from real version history (fieldValues match seeded data)
//   3. BUILD   — deterministic package with contentHash/packageHash + write-once blob
//   4. VERIFY  — independent MID_REASONER verifier approves clean packages and REJECTS a
//                tamper probe (fabricated field + altered refId) with a logged discrepancy
//   5. FREEZE  — immutable record: /api/db/mutate into filings/ → 403 reserved_base;
//                no update route exists on /api/filing
// Plus: hash-chained audit verification via GET /api/db/audit/verify.
//
// Usage (PowerShell):
//   $env:PF_BASE_URL     = "https://app-prodhub-dev.azurewebsites.net"
//   $env:PF_AUTH_SECRET  = "<AUTH_JWT_SECRET from App Service config>"   # for the VIEWER probe
//   pnpm tsx scripts/filing-live.mts
//
// Writes the full transcript (incl. verifier rejection issues) to
// docs/audit/filing_live_results.json for the EXECUTION-B self-review ledger.

import { createHmac, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const BASE = (process.env.PF_BASE_URL || 'https://app-prodhub-dev.azurewebsites.net').replace(/\/$/, '')
const AUTH_SECRET = process.env.PF_AUTH_SECRET || ''
const TENANT = 'filing-live-b'
const PRODUCT_ID = 'FLB.PROD.001'

type Check = { name: string; pass: boolean; detail: string }
const results: Check[] = []
const artifacts: Record<string, unknown> = {}

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api(path: string, init: RequestInit = {}, token: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers })
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

// Retry wrapper: dev redeploys sever in-flight requests; cold starts 503 briefly.
async function apiRetry(path: string, init: RequestInit, token: string | null, tries = 3) {
  let last: { status: number; body: any } = { status: 0, body: null }
  for (let i = 0; i < tries; i++) {
    try {
      last = await api(path, init, token)
      if (last.status !== 0 && last.status !== 502 && last.status !== 503) return last
    } catch (e) { last = { status: 0, body: String(e) } }
    await new Promise((r) => setTimeout(r, 20_000))
  }
  return last
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Mint a validly-signed VIEWER JWT (same HS256 scheme as server/lib/auth.js sign()).
// The server evaluates it exactly like a real login token — this proves the SERVER-side gate.
function mintViewerToken(): string | null {
  if (!AUTH_SECRET) return null
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    sub: 'filing-live-viewer', name: 'Filing Live Viewer', email: 'viewer@filing-live-b.local',
    role: 'VIEWER', tenantId: TENANT, method: 'otp', jti: randomUUID(), iat: now, exp: now + 3600,
  }))
  const data = `${head}.${payload}`
  return `${data}.${b64url(createHmac('sha256', AUTH_SECRET).update(data).digest())}`
}

async function mutate(token: string, payload: Record<string, unknown>) {
  return apiRetry('/db/mutate', { method: 'POST', body: JSON.stringify({ payload }) }, token)
}

async function main() {
  console.log(`filing-live: ${BASE} tenant=${TENANT}`)

  // ── Login (SUPER_ADMIN bootstrap, scoped to the isolated tenant) ────────────
  const login = await apiRetry('/auth/bootstrap', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin', tenant: TENANT }) }, null)
  if (login.status !== 200 || !login.body?.token) {
    console.error(`bootstrap login failed: ${login.status} ${JSON.stringify(login.body).slice(0, 200)}`)
    process.exit(2)
  }
  const jwt = login.body.token as string
  record('bootstrap login', true, `tenant=${login.body.user?.tenantId}`)

  // ── Seed an isolated product with version history (RESOLVE source of truth) ─
  const covRefId = 'FLB.COV.001'
  const formNumber = 'FLB 00 01 07 26'
  const seedProduct = await mutate(jwt, {
    op: 'create', path: `products/${PRODUCT_ID}`, entityType: 'product',
    data: { refId: PRODUCT_ID, name: 'Filing Live Probe Product', lob: 'GL', lifecycle: 'ACTIVE', states: ['NJ'] },
  })
  const seedCoverage = await mutate(jwt, {
    op: 'create', path: `products/${PRODUCT_ID}/coverages/FLB-COV-001`, entityType: 'coverage',
    data: { refId: covRefId, name: 'Probe General Liability Coverage', formNumbers: [formNumber], limit: 1_000_000, deductible: 500 },
  })
  // A second rev so RESOLVE has a real diff to fold (update limit).
  const seedUpdate = await mutate(jwt, {
    op: 'update', path: `products/${PRODUCT_ID}/coverages/FLB-COV-001`, entityType: 'coverage',
    data: { limit: 2_000_000 },
  })
  record('seed product+coverage (+1 update rev)', seedProduct.status === 200 && seedCoverage.status === 200 && seedUpdate.status === 200,
    `${seedProduct.status}/${seedCoverage.status}/${seedUpdate.status}`)

  // ── STEP 1 proof: VIEWER server-blocked at SCOPE ─────────────────────────────
  const viewerJwt = mintViewerToken()
  if (viewerJwt) {
    const v = await api('/filing/generate', { method: 'POST', body: JSON.stringify({ productId: PRODUCT_ID, stateCode: 'NJ' }) }, viewerJwt)
    record('VIEWER blocked at SCOPE (403 filing:generate)', v.status === 403 && v.body?.need === 'filing:generate', `${v.status} ${JSON.stringify(v.body)}`)
    const vr = await api('/filing', {}, viewerJwt)
    record('VIEWER can read filings (product:read)', vr.status === 200, `${vr.status}`)
    artifacts.viewerProbe = v
  } else {
    record('VIEWER blocked at SCOPE', false, 'PF_AUTH_SECRET not set — cannot mint VIEWER token')
  }

  // ── STEPS 2–5: clean end-to-end filing ──────────────────────────────────────
  const asOf = new Date().toISOString()
  const gen = await apiRetry('/filing/generate', { method: 'POST', body: JSON.stringify({ productId: PRODUCT_ID, stateCode: 'NJ', asOf }) }, jwt)
  artifacts.generate = gen
  const genOk = gen.status === 201 && gen.body?.ok === true && !!gen.body?.packageHash && !!gen.body?.storagePath
  record('filing generate end-to-end (201 + packageHash + storagePath)', genOk, `${gen.status} ${JSON.stringify(gen.body).slice(0, 300)}`)
  record('verifier approved via fleet role', gen.body?.verifier?.approved === true,
    `role=${gen.body?.verifier?.role} deployment=${gen.body?.verifier?.deployment}`)

  const filingId = gen.body?.filingId as string | undefined

  // Provenance: every filed field traces to a real version.
  if (filingId) {
    const rec = await api(`/filing/${encodeURIComponent(filingId)}`, {}, jwt)
    artifacts.filingRecord = rec.body
    const items: any[] = rec.body?.filing?.items || []
    const allVersioned = items.length > 0 && items.every((i) => i.versionId && i.contentHash && typeof i.rev === 'number')
    record('every filed item carries versionId + contentHash', allVersioned, `${items.length} items`)
    const cov = items.find((i) => String(i.entityPath).includes('FLB-COV-001'))
    const verbatim = cov && cov.fieldValues?.refId === covRefId
      && Array.isArray(cov.fieldValues?.formNumbers) && cov.fieldValues.formNumbers[0] === formNumber
      && cov.fieldValues?.limit === 2_000_000
    record('refId + formNumber verbatim; as-of state folds the update rev (limit=2,000,000)', !!verbatim,
      cov ? JSON.stringify({ refId: cov.fieldValues?.refId, formNumbers: cov.fieldValues?.formNumbers, limit: cov.fieldValues?.limit }) : 'coverage item missing')
    record('frozen record stores verifier verdict + role', rec.body?.filing?.verifierVerdict?.approved === true,
      JSON.stringify(rec.body?.filing?.verifierVerdict))
  }

  // ── STEP 4 proof: tamper probe → verifier REJECTS, no freeze ────────────────
  const before = await api(`/filing?productId=${PRODUCT_ID}`, {}, jwt)
  const countBefore = (before.body?.filings || []).length
  const tamper = await apiRetry('/filing/generate', { method: 'POST', body: JSON.stringify({ productId: PRODUCT_ID, stateCode: 'NJ', asOf, tamperProbe: true }) }, jwt)
  artifacts.tamperProbe = tamper
  const tamperRejected = tamper.status === 422 && tamper.body?.error === 'filing_rejected_by_verifier'
    && tamper.body?.probe === true && Array.isArray(tamper.body?.issues) && tamper.body.issues.length > 0
  record('tamper probe rejected by verifier (422 + issues logged)', tamperRejected,
    `${tamper.status} issues=${(tamper.body?.issues || []).length} role=${tamper.body?.verifier?.role}`)
  const after = await api(`/filing?productId=${PRODUCT_ID}`, {}, jwt)
  const countAfter = (after.body?.filings || []).length
  record('tamper probe did NOT freeze a record', countAfter === countBefore, `filings before=${countBefore} after=${countAfter}`)

  // ── STEP 5 proof: the frozen record cannot be updated by any code path ──────
  if (filingId) {
    const upd = await api('/db/mutate', {
      method: 'POST',
      body: JSON.stringify({ payload: { op: 'update', path: `filings/${filingId}`, entityType: 'filing', data: { packageHash: 'tampered' } } }),
    }, jwt)
    record('mutate into filings/ rejected (403 reserved_base)', upd.status === 403 && upd.body?.error === 'reserved_base', `${upd.status} ${JSON.stringify(upd.body)}`)
    artifacts.updateAttempt = upd
    const put = await api(`/filing/${encodeURIComponent(filingId)}`, { method: 'PUT', body: JSON.stringify({ packageHash: 'tampered' }) }, jwt)
    record('no update route on /api/filing/:id (PUT is 4xx)', put.status >= 400 && put.status < 500, `${put.status}`)
    // Re-running generate for the same scope creates a NEW filingId — never overwrites.
  }

  // ── Audit chain: filing events are hash-chained and verifiable ──────────────
  const auditVerify = await api('/db/audit/verify', {}, jwt)
  artifacts.auditVerify = auditVerify.body
  record('audit chain verifies for the tenant (incl. filing events)', auditVerify.status === 200 && auditVerify.body?.ok !== false,
    `${auditVerify.status} ${JSON.stringify(auditVerify.body).slice(0, 200)}`)

  // ── Teardown: remove seeded entities (filings are append-only by design) ────
  const del1 = await mutate(jwt, { op: 'delete', path: `products/${PRODUCT_ID}/coverages/FLB-COV-001`, entityType: 'coverage' })
  const del2 = await mutate(jwt, { op: 'delete', path: `products/${PRODUCT_ID}`, entityType: 'product' })
  record('teardown seeded entities', del1.status === 200 && del2.status === 200, `${del1.status}/${del2.status}`)

  const passed = results.filter((r) => r.pass).length
  console.log(`\n${passed}/${results.length} checks passed`)
  writeFileSync('docs/audit/filing_live_results.json', JSON.stringify({ base: BASE, tenant: TENANT, at: new Date().toISOString(), results, artifacts }, null, 2))
  console.log('transcript → docs/audit/filing_live_results.json')
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
