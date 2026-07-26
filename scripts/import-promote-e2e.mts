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

// ── gated floors ─────────────────────────────────────────────────────────────
// Both were informational notes, and both were being cleared by runs that had lost most of the
// data: "at least one term survived" passed with terms on 8 of 95 coverages, and the coverageRef
// ratio was never gated at all. Each floor is derived from what the SOURCE workbooks state, not
// from what today's runs produce — the derivation is at each check site. Not overridable by env:
// a floor a run can lower is not a floor.
const COV_TERM_FLOOR     = 0.50   // coverages carrying >=1 term        (source basis 0.607 / 0.663)
const STEP_COVREF_FLOOR  = 0.90   // rating steps carrying a coverageRef (source basis 0.999 / 0.948)

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

// A stage-4.5 SWEEPER NOMINATION is an unconfirmed cell proposal (confidence 0.5,
// needsReview, no refId) — the review offers it but does not write it unless a human ticks
// it. Persisting them here would measure a product no reviewer would ever create: the E+ run
// offered 59 of them out of 154 "coverages", named things like "EPLS.COV.005; EPLS.COV.007".
const isNomination = (e: Record<string, unknown>) => dataOf(e)['sweeperFact'] === true
const kept = (k: string) => arr(k).filter(e => !isNomination(e))
const nominated = (k: string) => arr(k).filter(isNomination).length

const GROUPS: Record<string, { entityType: string; path: (id: string) => string; underProduct: boolean }> = {
  coverages:     { entityType: 'coverage',      underProduct: true,  path: id => `products/${PID}/coverages/${id}` },
  forms:         { entityType: 'form',          underProduct: false, path: id => `forms/${PID}__${id}` },
  rules:         { entityType: 'rule',          underProduct: true,  path: id => `products/${PID}/rules/${id}` },
  formRules:     { entityType: 'formRule',      underProduct: true,  path: id => `products/${PID}/formRules/${id}` },
  ldTables:      { entityType: 'ldTable',       underProduct: false, path: id => `ldTables/${id}` },
  rtTables:      { entityType: 'rtTable',       underProduct: false, path: id => `rtTables/${id}` },
}
let written = 0, failed = 0
const payloadFor = (g: typeof GROUPS[string], e: Record<string, unknown>) => {
  const d = dataOf(e)
  const data = g.entityType === 'form' ? { ...d, productRefIds: [PID] }
    : (g.entityType === 'ldTable' || g.entityType === 'rtTable') ? { ...d, productId: PID } : d
  return { op: 'create', path: g.path(String(e['docId'])), entityType: g.entityType,
    ...(g.underProduct ? { productId: PID } : {}), actor, data }
}
const flush = async (payloads: unknown[], key: string) => {
  if (!payloads.length) return
  const r = await api('/db/mutateBatch', { payloads })
  if (r.ok) written += payloads.length
  else { failed += payloads.length; log(`  batch ${key} failed ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`) }
}

// COVERAGES — wave batching, mirroring app/src/lib/import/importProduct.ts. The server
// validates every parentId with a live read DURING the envelope phase, before ANY op in the
// batch commits, so a child may never share a batch with an ancestor: the ancestor does not
// exist yet and the WHOLE batch 422s with invalid_parent (which is exactly what a naive
// 50-chunk did here). Flush the moment a coverage's parent is still pending in this batch;
// each flush fully commits before the next is enveloped. Correct at any nesting depth.
{
  const g = GROUPS['coverages']!
  let batch: unknown[] = []
  let pending = new Set<string>()
  for (const e of kept('coverages')) {
    const parentId = dataOf(e)['parentId']
    if ((parentId != null && pending.has(String(parentId))) || batch.length >= 50) {
      await flush(batch, 'coverages'); batch = []; pending = new Set()
    }
    batch.push(payloadFor(g, e))
    const rid = e['refId']
    if (typeof rid === 'string' && rid) pending.add(rid)
  }
  await flush(batch, 'coverages')
}

// Everything else has no intra-collection parent dependency — free batching.
for (const [key, g] of Object.entries(GROUPS)) {
  if (key === 'coverages') continue
  const items = kept(key)
  for (let i = 0; i < items.length; i += 50) await flush(items.slice(i, i + 50).map(e => payloadFor(g, e)), key)
}
const prog = plan['ratingProgram'] as Record<string, unknown> | null
if (prog) {
  const r = await api('/db/mutate', { payload: {
    op: 'create', path: `products/${PID}/ratingPrograms/${String(prog['docId'])}`,
    entityType: 'ratingProgram', productId: PID, actor, data: dataOf(prog),
  } })
  if (r.ok) written++; else { failed++; log(`  ratingProgram failed ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`) }
}
log(`persisted ${written} entities (${failed} failed; ${nominated('coverages')} sweeper nominations withheld, as the review would)`)

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
const outProd  = (await list('products')).find(p => String(p['id'] ?? '') === PID)

const PLACEHOLDER = /^<.*>$|^n\/?a$|^not applicable$|^intentionally left blank$/i
const fails: string[] = []
const notes: string[] = []

const sentinel = outCovs.filter(c => PLACEHOLDER.test(String(c['name'] ?? '').trim()))
if (sentinel.length) fails.push(`${sentinel.length}/${outCovs.length} PERSISTED coverages are placeholder-named`)
else notes.push(`persisted coverage names: 0/${outCovs.length} placeholder-named`)

let lim = 0, ded = 0, covDed = 0, covWithTerm = 0
for (const c of outCovs) {
  const terms = (c['terms'] ?? []) as { kind?: string }[]
  const l = terms.filter(t => t.kind === 'LIMIT').length
  const d = terms.filter(t => t.kind === 'DEDUCTIBLE').length
  lim += l; ded += d; if (d) covDed++; if (terms.length) covWithTerm++
}
notes.push(`persisted terms: ${lim} LIMIT, ${ded} DEDUCTIBLE (${covWithTerm} coverages carry a term; ${covDed} carry a deductible)`)
if (outCovs.length > 0 && lim === 0 && ded === 0) fails.push('no limit or deductible term survived the round trip')

// GATED FLOOR — coverages carrying at least one term.
// "at least one term anywhere in the product" is a presence check, not a fidelity check: the
// EPLUS-R2 run cleared it with terms on 8 of 95 coverages. The source states limits and
// deductibles for most of its coverages — measured on the two spec workbooks these runs use,
// 82/135 (60.7%) of Core coverage names and 63/95 (66.3%) of E+ coverage names appear inside the
// named limit/deductible table blocks of their Rule References sheet ("Liability Limits - CO",
// "Physical Damage Deductibles - AZ", "EP 501 Spare Parts Limits and Deductibles", ...). The floor
// sits deliberately BELOW that measured basis — it is the minimum a correct import must clear,
// not the expected value — and well above where today's runs land.
const termRatio = outCovs.length > 0 ? covWithTerm / outCovs.length : 1
notes.push(`coverages carrying >=1 term: ${covWithTerm}/${outCovs.length} = ${termRatio.toFixed(3)} (floor ${COV_TERM_FLOOR})`)
if (outCovs.length > 0 && termRatio < COV_TERM_FLOOR) {
  fails.push(`only ${covWithTerm}/${outCovs.length} coverages carry a term (${termRatio.toFixed(3)} < floor ${COV_TERM_FLOOR})`)
}

const steps = (outProgs[0]?.['steps'] ?? []) as Record<string, unknown>[]
const badSteps = steps.filter(s => {
  const src = s['source'] as { type?: unknown } | undefined
  return !src || typeof src.type !== 'string'
})
if (steps.length && badSteps.length) fails.push(`${badSteps.length}/${steps.length} PERSISTED steps carry no source.type`)
else notes.push(`persisted rating steps: ${steps.length}${steps.length ? ', all with source.type' : ' (none)'}`)

// GATED FLOOR — rating steps carrying a coverage reference.
// The source states the coverage a step prices in its own column: on "Core Rating
// Specifications" 2000 of 2003 step rows (99.9%) carry a CORE.COV.* id in PRODUCT FRAMEWORK ID,
// and on "E+ Rating Specs" 293 of 309 (94.8%) carry an EPLS.COV.* id — both sheets also carry a
// COVERAGE NAME column (D5). A step whose coverageRef is blank has dropped a value the source
// stated plainly, and the coverage card then shows no pricing figure. The floor is set below the
// weaker of the two source rates to leave room for genuinely policy-level steps (fees, minimum
// premium) that name no coverage; it is NOT set where today's runs land (90/2024 and 17/303).
const withCovRef = steps.filter(s => String(s['coverageRef'] ?? '').trim() !== '').length
const covRefRatio = steps.length > 0 ? withCovRef / steps.length : 1
notes.push(`steps carrying a stated coverageRef: ${withCovRef}/${steps.length} = ${covRefRatio.toFixed(3)} (floor ${STEP_COVREF_FLOOR})`)
if (steps.length > 0 && covRefRatio < STEP_COVREF_FLOOR) {
  fails.push(`only ${withCovRef}/${steps.length} rating steps carry a coverageRef (${covRefRatio.toFixed(3)} < floor ${STEP_COVREF_FLOOR})`)
}

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
// ── 5. the COVERAGE CARD figures, computed from persisted data ───────────────
// Mirrors coverageAspects.useCoverageCounts closely enough to answer the question the card
// actually poses: does this coverage report real limits, deductibles, pricing and rules?
// A card that reads "—" everywhere is the symptom; this prints the numbers behind it.
const stepsFor = (refId: string) => steps.filter(s => {
  const cr = String(s['coverageRef'] ?? '').trim()
  return cr !== '' && cr.split(/[;,]/).some(x => x.trim() === refId)
}).length
const optCount = (t: Record<string, unknown>) => {
  const o = t['options']
  return Array.isArray(o) && o.length ? o.length : (typeof t['default'] === 'number' ? 1 : 0)
}
const cardRows = outCovs.map(c => {
  const terms = (c['terms'] ?? []) as Record<string, unknown>[]
  const sum = (kind: string) => terms.filter(t => t['kind'] === kind).reduce((n, t) => n + optCount(t), 0)
  const refId = String(c['refId'] ?? '')
  return {
    refId, name: String(c['name'] ?? ''),
    limits: sum('LIMIT'), deductibles: sum('DEDUCTIBLE'),
    forms: ((c['formNumbers'] ?? []) as unknown[]).length,
    pricing: c['premiumGenerating'] === false ? 0 : stepsFor(refId),
    rules: outRules.filter(r => refId && ((r['coverageRefIds'] ?? []) as string[]).includes(refId)).length,
  }
})
const anyDed = cardRows.filter(r => r.deductibles > 0).length
const anyPricing = cardRows.filter(r => r.pricing > 0).length
notes.push(`cards showing a DEDUCTIBLE figure: ${anyDed}/${cardRows.length}`)
notes.push(`cards showing a PRICING figure: ${anyPricing}/${cardRows.length}`)
if (steps.length > 0 && withCovRef > 0 && anyPricing === 0) fails.push('steps state a coverageRef yet no card would show a pricing figure')

console.log(`[${LABEL}]   ── coverage cards, as the UI would compute them ──`)
for (const r of cardRows.filter(r => r.limits || r.deductibles || r.pricing || r.rules).slice(0, 8)) {
  console.log(`[${LABEL}]   ${r.refId.padEnd(18)} lim=${String(r.limits).padStart(4)} ded=${String(r.deductibles).padStart(4)} forms=${String(r.forms).padStart(3)} pricing=${String(r.pricing).padStart(3)} rules=${String(r.rules).padStart(3)}  ${r.name.slice(0, 38)}`)
}

try {
  mkdirSync(resolve('docs/audit'), { recursive: true })
  writeFileSync(resolve('docs/audit', `import_promote_e2e-${LABEL}.json`), JSON.stringify({
    label: LABEL, baseUrl: BASE, runId, productId: PID, promoted,
    counts: { persisted: written, failed, coverages: outCovs.length, rules: outRules.length, steps: steps.length, limitTerms: lim, deductibleTerms: ded, stepsWithCoverageRef: withCovRef, coveragesWithTerm: covWithTerm },
    floors: {
      coverageTermRatio: { value: Number(termRatio.toFixed(4)), floor: COV_TERM_FLOOR, pass: !(outCovs.length > 0 && termRatio < COV_TERM_FLOOR) },
      stepCoverageRefRatio: { value: Number(covRefRatio.toFixed(4)), floor: STEP_COVREF_FLOOR, pass: !(steps.length > 0 && covRefRatio < STEP_COVREF_FLOOR) },
    },
    fails, notes,
  }, null, 2))
} catch { /* best effort */ }

if (!KEEP) {
  const d = await api('/db/deleteProduct', { productId: PID })
  console.log(`[${LABEL}] teardown: ${d.ok ? `removed ${d.body?.['deleted'] ?? '?'} entities` : `failed ${d.status} (product ${PID} left behind)`}`)
} else console.log(`[${LABEL}] kept product ${PID} (IMPORT_KEEP=1)`)

console.log(`[${LABEL}] ${fails.length === 0 ? 'PASS' : `FAIL (${fails.length})`}`)
process.exit(fails.length === 0 ? 0 : 1)
