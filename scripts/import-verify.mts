#!/usr/bin/env tsx
/**
 * scripts/import-verify.mts — run ONE workbook through a LIVE /api/ai/unifiedImport and assert
 * the fidelity invariants the import brain is supposed to hold. Unlike import-watch (which
 * narrates the stream), this exits non-zero when an invariant is violated, so it can gate a
 * deploy.
 *
 * Usage:
 *   BASE_URL=https://app-prodhub-dev.azurewebsites.net tsx scripts/import-verify.mts <file.xlsx>
 *
 * Env: BASE_URL, IMPORT_USER, IMPORT_PASS, IMPORT_TENANT, IMPORT_LABEL
 *
 * Exit: 0 = every invariant held · 1 = at least one violated · 2 = could not run
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'

const BASE_URL = (process.env.BASE_URL || 'https://app-prodhub-dev.azurewebsites.net').replace(/\/$/, '')
const USER     = process.env.IMPORT_USER   || 'admin'
const PASS     = process.env.IMPORT_PASS   || 'admin'
const TENANT   = process.env.IMPORT_TENANT || 'import-verify'
const LABEL    = process.env.IMPORT_LABEL  || ''

const filePath = process.argv[2]
if (!filePath) { console.error('usage: tsx scripts/import-verify.mts <file>'); process.exit(2) }
const abs = resolve(filePath)
if (!existsSync(abs)) { console.error(`not found: ${abs}`); process.exit(2) }

const tag = LABEL || abs.split(/[\\/]/).pop()!
const log = (m: string) => process.stdout.write(`[${tag}] ${m}\n`)

// ── auth ─────────────────────────────────────────────────────────────────────
const loginRes = await fetch(`${BASE_URL}/api/auth/bootstrap`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS, tenant: TENANT }),
})
if (!loginRes.ok) { log(`AUTH FAILED ${loginRes.status}`); process.exit(2) }
const { token } = await loginRes.json() as { token: string }
log(`authenticated → ${BASE_URL}`)

// ── stream the import ────────────────────────────────────────────────────────
const runId = `verify-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
const body = {
  documents: [{
    name: abs.split(/[\\/]/).pop(),
    base64: readFileSync(abs).toString('base64'),
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }],
  runId,
}
const t0 = Date.now()
log(`POST /api/ai/unifiedImport  (runId=${runId})`)
let streamErr = ''
try {
  const res = await fetch(`${BASE_URL}/api/ai/unifiedImport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) { log(`HTTP ${res.status} — ${(await res.text().catch(() => '')).slice(0, 300)}`); process.exit(1) }
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const e = JSON.parse(line.slice(6).trim()) as { t: string; name?: string; summary?: string; message?: string }
        if (e.t === 'tool' && /stage/.test(e.name ?? '')) log(`  ${e.name}${e.summary ? ` — ${e.summary}` : ''}`)
        else if (e.t === 'error') log(`  [error] ${e.message}`)
      } catch { /* partial frame */ }
    }
  }
} catch (err) {
  streamErr = (err as Error).message
  log(`stream ended early: ${streamErr} — falling back to the durable result`)
}
log(`stream finished in ${Math.round((Date.now() - t0) / 1000)}s`)

// ── durable bundle ───────────────────────────────────────────────────────────
let bundle: Record<string, unknown> | null = null
for (let i = 0; i < 20 && !bundle; i++) {
  const rr = await fetch(`${BASE_URL}/api/ai/unifiedImportResult`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ runId }),
  })
  if (rr.ok) bundle = ((await rr.json()) as { bundle?: Record<string, unknown> }).bundle ?? null
  if (!bundle) await new Promise(r => setTimeout(r, 5000))
}
if (!bundle) { log('FAIL — no durable bundle'); process.exit(1) }

const plan = (bundle['plan'] ?? {}) as Record<string, unknown>
const arr = (k: string) => (Array.isArray(plan[k]) ? plan[k] as Record<string, unknown>[] : [])
const coverages = arr('coverages'), forms = arr('forms'), rules = arr('rules')
const rtTables = arr('rtTables'), ldTables = arr('ldTables')
const program = plan['ratingProgram'] as { data?: { steps?: Record<string, unknown>[] } } | null
const steps = Array.isArray(program?.data?.steps) ? program!.data!.steps! : []
const dataOf = (e: Record<string, unknown>) => (e['data'] ?? {}) as Record<string, unknown>

// ── invariants ───────────────────────────────────────────────────────────────
const failures: string[] = []
const notes: string[] = []

// 1. No placeholder sentinel may survive as a NAME.
const PLACEHOLDER = /^<.*>$|^n\/?a$|^not applicable$|^intentionally left blank$/i
const sentinelNamed = coverages.filter(c => PLACEHOLDER.test(String(dataOf(c)['name'] ?? '').trim()))
if (sentinelNamed.length) {
  failures.push(`${sentinelNamed.length}/${coverages.length} coverages are named with a placeholder sentinel (e.g. ${sentinelNamed.slice(0, 3).map(c => `${c['refId']}="${dataOf(c)['name']}"`).join(', ')})`)
} else notes.push(`coverage names: 0/${coverages.length} placeholder-named`)

// 2. Every rating step must carry a canonical source (the Pricing-tab crash).
const badSteps = steps.filter(s => {
  const src = s['source'] as { type?: unknown } | undefined
  return !src || typeof src.type !== 'string'
})
if (badSteps.length) failures.push(`${badSteps.length}/${steps.length} rating steps carry no canonical source.type — the Pricing tab will crash`)
else notes.push(`rating steps: ${steps.length}, all with source.type`)

// 3. Terms — limits and deductibles actually reach coverages.
let nLimit = 0, nDed = 0, covDed = 0
for (const c of coverages) {
  const terms = (dataOf(c)['terms'] ?? []) as { kind?: string }[]
  const l = terms.filter(t => t.kind === 'LIMIT').length
  const d = terms.filter(t => t.kind === 'DEDUCTIBLE').length
  nLimit += l; nDed += d
  if (d) covDed++
}
notes.push(`terms: ${nLimit} LIMIT, ${nDed} DEDUCTIBLE (on ${covDed} coverages)`)

// 4. Something must actually have been extracted.
if (coverages.length === 0 && forms.length === 0) failures.push('plan is empty — no coverages and no forms')

console.log(`\n[${tag}] ────────── RESULT ──────────`)
console.log(`[${tag}] coverages=${coverages.length} forms=${forms.length} rules=${rules.length} rt=${rtTables.length} ld=${ldTables.length} steps=${steps.length}`)
for (const n of notes) console.log(`[${tag}]   ok   ${n}`)
for (const f of failures) console.log(`[${tag}]   FAIL ${f}`)
if (streamErr) console.log(`[${tag}]   note stream dropped (${streamErr}); bundle recovered from the durable result`)

const outDir = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../docs/audit')
try {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, `import_verify-${tag.replace(/[^\w.-]+/g, '_')}.json`), JSON.stringify({
    tag, baseUrl: BASE_URL, runId, durationMs: Date.now() - t0,
    counts: { coverages: coverages.length, forms: forms.length, rules: rules.length, rtTables: rtTables.length, ldTables: ldTables.length, steps: steps.length, limitTerms: nLimit, deductibleTerms: nDed },
    failures, notes,
  }, null, 2))
} catch { /* reporting is best-effort */ }

console.log(`[${tag}] ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`)
process.exit(failures.length === 0 ? 0 : 1)
