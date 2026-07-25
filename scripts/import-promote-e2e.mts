#!/usr/bin/env tsx
/**
 * scripts/import-promote-e2e.mts — the WHOLE journey against a live host:
 *   brain import → persist the plan → promote the draft → read the data BACK.
 *
 * import-verify proves the PLAN is sound. This proves the plan survives the round trip into
 * Cosmos and out again — which is the only thing a reviewer actually looks at. Every check
 * below reads PERSISTED entities, never the in-memory plan.
 *
 * Usage:
 *   BASE_URL=https://app-prodhub-dev.azurewebsites.net tsx scripts/import-promote-e2e.mts <file.xlsx>
 *   IMPORT_ATTACH_RUN_ID=<id> tsx scripts/import-promote-e2e.mts        (reuse a finished run)
 *
 * Env: BASE_URL IMPORT_USER IMPORT_PASS IMPORT_TENANT IMPORT_LABEL
 *      IMPORT_RESULT_WAIT_MS (default 45min)  IMPORT_KEEP=1 to skip teardown
 *
 * Exit: 0 all checks held · 1 a check failed · 2 could not run
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const BASE  = (process.env.BASE_URL || 'https://app-prodhub-dev.azurewebsites.net').replace(/\/$/, '')
const USER  = process.env.IMPORT_USER   || 'admin'
const PASS  = process.env.IMPORT_PASS   || 'admin'
const TEN   = process.env.IMPORT_TENANT || 'import-e2e'
const LABEL = process.env.IMPORT_LABEL  || 'E2E'
const ATTACH = process.env.IMPORT_ATTACH_RUN_ID || ''
const WAIT_MS = Number(process.env.IMPORT_RESULT_WAIT_MS) || 2_700_000
const KEEP  = process.env.IMPORT_KEEP === '1'

const file = process.argv[2]
if (!file && !ATTACH) { console.error('usage: tsx scripts/import-promote-e2e.mts <file>'); process.exit(2) }
const abs = file ? resolve(file) : ''
if (abs && !existsSync(abs)) { console.error(`not found: ${abs}`); process.exit(2) }
const log = (m: string) => process.stdout.write(`[${LABEL}] ${m}\n`)

// ── auth ─────────────────────────────────────────────────────────────────────
const lr = await fetch(`${BASE}/api/auth/bootstrap`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS, tenant: TEN }),
})
if (!lr.ok) { log(`AUTH FAILED ${lr.status}`); process.exit(2) }
const { token } = await lr.json() as { token: string }
const actor = { uid: 'import-e2e', name: 'Import E2E' }
const api = async (path: string, body: unknown) => {
  const r = await fetch(`${BASE}/api${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  let j: unknown = null; try { j = await r.json() } catch { /* empty */ }
  return { status: r.status, ok: r.ok, body: j as Record<string, unknown> | null }
}
log(`authenticated → ${BASE} (tenant ${TEN})`)

// ── 1. brain import ──────────────────────────────────────────────────────────
const runId = ATTACH || `e2e-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
const t0 = Date.now()
if (ATTACH) log(`attaching to run ${ATTACH}`)
else {
  log(`POST /api/ai/unifiedImport (runId=${runId})`)
  try {
    const res = await fetch(`${BASE}/api/ai/unifiedImport`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        documents: [{
          name: abs.split(/[\\/]/).pop(),
          base64: readFileSync(abs).toString('base64'),
          mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }], runId,
      }),
    })
    if (!res.ok) { log(`HTTP ${res.status}`); process.exit(1) }
    const rd = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''
    for (;;) {
      const { done, value } = await rd.read(); if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const l of lines) {
        if (!l.startsWith('data: ')) continue
        try {
          const e = JSON.parse(l.slice(6).trim()) as { t: string; name?: string; summary?: string }
          if (e.t === 'tool' && /stage[07]/.test(e.name ?? '')) log(`  ${e.name}${e.summary ? ` — ${e.summary}` : ''}`)
        } catch { /* partial */ }
      }
    }
  } catch (err) { log(`stream ended early: ${(err as Error).message} — using the durable result`) }
}

let bundle: Record<string, unknown> | null = null
const deadline = Date.now() + WAIT_MS
let waited = 0
while (!bundle && Date.now() < deadline) {
  const r = await api('/ai/unifiedImportResult', { runId })
  if (r.ok) bundle = (r.body?.['bundle'] ?? null) as Record<string, unknown> | null
  if (bundle) break
  await new Promise(s => setTimeout(s, 30_000)); waited += 30
  if (waited % 300 === 0) log(`  waiting for the durable result (${waited / 60}min)`)
}
if (!bundle) { log(`FAIL — no durable bundle after ${Math.round(WAIT_MS / 60000)}min`); process.exit(1) }
log(`plan ready in ${Math.round((Date.now() - t0) / 1000)}s`)

// ── 2. persist ───────────────────────────────────────────────────────────────
const plan = (bundle['plan'] ?? {}) as Record<string, unknown>
const arr = (k: string) => (Array.isArray(plan[k]) ? plan[k] as Record<string, unknown>[] : [])
const dataOf = (e: Record<string, unknown>) => (e['data'] ?? {}) as Record<string, unknown>
const product = plan['product'] as Record<string, unknown> | null
if (!product) { log('FAIL — plan carries no product'); process.exit(1) }

const PID = `e2e-${Date.now().toString(36)}`
const pr = await api('/db/mutate', { payload: {
  op: 'create', path: `products/${PID}`, entityType: 'product', productId: PID, actor,
  data: { ...dataOf(product), owner: actor },
} })
if (!pr.ok) { log(`FAIL — product create ${pr.status}: ${JSON.stringify(pr.body).slice(0, 200)}`); process.exit(1) }
log(`product ${PID} created`)

const GROUPS: Record<string, { entityType: string; path: (id: string) => string; underProduct: boolean }> = {
  coverages:     { entityType: 'coverage',      underProduct: true,  path: id => `products/${PID}/coverages/${id}` },
  forms:         { entityType: 'form',          underProduct: false, path: id => `forms/${PID}__${id}` },
  rules:         { entityType: 'rule',          underProduct: true,  path: id => `products/${PID}/rules/${id}` },
  formRules:     { entityType: 'formRule',      underProduct: true,  path: id => `products/${PID}/formRules/${id}` },
  ldTables:      { entityType: 'ldTable',       underProduct: false, path: id => `ldTables/${id}` },
  rtTables:      { entityType: 'rtTable',       underProduct: false, path: id => `rtTables/${id}` },
}
let written = 0, failed = 0
for (const [key, g] of Object.entries(GROUPS)) {
  const items = arr(key)
  for (let i = 0; i < items.length; i += 50) {
    const payloads = items.slice(i, i + 50).map(e => {
      const d = dataOf(e)
      const data = g.entityType === 'form' ? { ...d, productRefIds: [PID] }
        : (g.entityType === 'ldTable' || g.entityType === 'rtTable') ? { ...d, productId: PID } : d
      return { op: 'create', path: g.path(String(e['docId'])), entityType: g.entityType,
        ...(g.underProduct ? { productId: PID } : {}), actor, data }
    })
    const r = await api('/db/mutateBatch', { payloads })
    if (r.ok) written += payloads.length
    else { failed += payloads.length; if (failed <= 50) log(`  batch ${key} failed ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`) }
  }
}
const prog = plan['ratingProgram'] as Record<string, unknown> | null
if (prog) {
  const r = await api('/db/mutate', { payload: {
    op: 'create', path: `products/${PID}/ratingPrograms/${String(prog['docId'])}`,
    entityType: 'ratingProgram', productId: PID, actor, data: dataOf(prog),
  } })
  if (r.ok) written++; else { failed++; log(`  ratingProgram failed ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`) }
}
log(`persisted ${written} entities (${failed} failed)`)

// ── 3. promote ───────────────────────────────────────────────────────────────
const promo = await api(`/db/drafts/${encodeURIComponent(PID)}/promote`, {})
const promoted = promo.ok
log(promoted
  ? `PROMOTED — draft → portfolio (rev ${promo.body?.['rev']})`
  : `promote ${promo.status}: ${JSON.stringify(promo.body).slice(0, 300)}`)

// ── 4. read the data BACK ────────────────────────────────────────────────────
const list = async (coll: string): Promise<Record<string, unknown>[]> => {
  const r = await fetch(`${BASE}/api/db/list`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path: coll, query: { limit: 5000 } }),
  })
  if (!r.ok) return []
  try { const j = await r.json() as { data?: unknown }; return Array.isArray(j.data) ? j.data as Record<string, unknown>[] : [] } catch { return [] }
}
const outCovs  = await list(`products/${PID}/coverages`)
const outRules = await list(`products/${PID}/rules`)
const outProgs = await list(`products/${PID}/ratingPrograms`)
const outProd  = (await api('/db/get', { path: `products/${PID}` })).body?.['data'] as Record<string, unknown> | undefined

const PLACEHOLDER = /^<.*>$|^n\/?a$|^not applicable$|^intentionally left blank$/i
const fails: string[] = []
const notes: string[] = []

const sentinel = outCovs.filter(c => PLACEHOLDER.test(String(c['name'] ?? '').trim()))
if (sentinel.length) fails.push(`${sentinel.length}/${outCovs.length} PERSISTED coverages are placeholder-named`)
else notes.push(`persisted coverage names: 0/${outCovs.length} placeholder-named`)

let lim = 0, ded = 0, covDed = 0
for (const c of outCovs) {
  const terms = (c['terms'] ?? []) as { kind?: string }[]
  const l = terms.filter(t => t.kind === 'LIMIT').length
  const d = terms.filter(t => t.kind === 'DEDUCTIBLE').length
  lim += l; ded += d; if (d) covDed++
}
notes.push(`persisted terms: ${lim} LIMIT, ${ded} DEDUCTIBLE (on ${covDed} coverages)`)
if (outCovs.length > 0 && lim === 0 && ded === 0) fails.push('no limit or deductible term survived the round trip')

const steps = (outProgs[0]?.['steps'] ?? []) as Record<string, unknown>[]
const badSteps = steps.filter(s => {
  const src = s['source'] as { type?: unknown } | undefined
  return !src || typeof src.type !== 'string'
})
if (steps.length && badSteps.length) fails.push(`${badSteps.length}/${steps.length} PERSISTED steps carry no source.type`)
else notes.push(`persisted rating steps: ${steps.length}${steps.length ? ', all with source.type' : ' (none)'}`)

const withCovRef = steps.filter(s => String(s['coverageRef'] ?? '').trim() !== '').length
notes.push(`steps carrying a stated coverageRef: ${withCovRef}/${steps.length}`)

if (!promoted) fails.push(`promote did not succeed (${promo.status})`)
else {
  const lc = String(outProd?.['lifecycle'] ?? '')
  notes.push(`product lifecycle after promote: ${lc || '(unknown)'}`)
}
if (outCovs.length === 0) fails.push('no coverages were persisted')

console.log(`\n[${LABEL}] ────────── PERSISTED DATA ──────────`)
console.log(`[${LABEL}] product=${PID} coverages=${outCovs.length} rules=${outRules.length} programs=${outProgs.length}`)
for (const n of notes) console.log(`[${LABEL}]   ok   ${n}`)
for (const f of fails) console.log(`[${LABEL}]   FAIL ${f}`)
for (const c of outCovs.slice(0, 5)) {
  const terms = (c['terms'] ?? []) as { kind?: string; label?: string }[]
  console.log(`[${LABEL}]   e.g. ${c['refId']} "${String(c['name']).slice(0, 44)}" terms=${terms.length} [${terms.map(t => t.kind).join(',')}]`)
}

try {
  mkdirSync(resolve('docs/audit'), { recursive: true })
  writeFileSync(resolve('docs/audit', `import_promote_e2e-${LABEL}.json`), JSON.stringify({
    label: LABEL, baseUrl: BASE, runId, productId: PID, promoted,
    counts: { persisted: written, failed, coverages: outCovs.length, rules: outRules.length, steps: steps.length, limitTerms: lim, deductibleTerms: ded, stepsWithCoverageRef: withCovRef },
    fails, notes,
  }, null, 2))
} catch { /* best effort */ }

if (!KEEP) {
  const d = await api('/db/deleteProduct', { productId: PID })
  console.log(`[${LABEL}] teardown: ${d.ok ? `removed ${d.body?.['deleted'] ?? '?'} entities` : `failed ${d.status} (product ${PID} left behind)`}`)
} else console.log(`[${LABEL}] kept product ${PID} (IMPORT_KEEP=1)`)

console.log(`[${LABEL}] ${fails.length === 0 ? 'PASS' : `FAIL (${fails.length})`}`)
process.exit(fails.length === 0 ? 0 : 1)
