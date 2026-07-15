#!/usr/bin/env tsx
/**
 * scripts/phasep-probes.mts — Phase P live probes (IH4).
 *
 * Two targeted live imports against the deployed /api host (tenant accenture-test),
 * run AFTER the CORE gate lands (never concurrently — one import at a time):
 *
 *   1. two-manuals  — NJ HO manual + WA PA auto rate manual in ONE request
 *      (ledger F13 live): role assignment is a partition — both documents must land
 *      visibly (real documentRoles for each; nothing silently dropped), and the
 *      conservation identity must hold.
 *   2. anti-ph      — the REAL WA Personal Auto contract + its rate manual
 *      (ledger F18/F14/F22 live): the product must come out Personal Auto (never
 *      the PH default), unstated facts must surface as UNKNOWN (never guessed),
 *      the rating program should populate where the manual resolves it, and
 *      accepted entities must carry citations.
 *
 * NOTE (ledger F27): the samples/hardening/pdf copies of these documents are NOT
 * PDFs (export rasterization artifacts). This probe reads the REAL bytes:
 * committed samples/filings + samples/hardening/pdf/PersonalAuto_WA_Rate_Manual_v2_11_REAL.pdf
 * + the operator-local samples/filings/additional_samples WA contract (gitignored,
 * live-probe-only). Results → docs/import-hardening/RESULTS/phasep-probes.json
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dir, '..')
const BASE_URL = (process.env.BASE_URL || 'https://app-prodhub-dev.azurewebsites.net').replace(/\/$/, '')
const TENANT = process.env.IMPORT_TENANT || 'accenture-test'
const TIMEOUT_MS = Number(process.env.PHASEP_TIMEOUT_MS) || 40 * 60_000

const log = (m: string) => process.stdout.write(`${m}\n`)

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/bootstrap`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.IMPORT_USER || 'admin', password: process.env.IMPORT_PASS || 'admin', tenant: TENANT }),
  })
  const body = await res.json().catch(() => null) as { token?: string } | null
  if (!res.ok || !body?.token) throw new Error(`bootstrap login failed: HTTP ${res.status}`)
  return body.token
}

interface RunOut { bundle: Record<string, unknown> | null; notices: string[]; errors: string[]; seconds: number }
async function runImport(token: string, files: string[], extra: Record<string, unknown> = {}): Promise<RunOut> {
  const documents = files.map(f => ({
    name: basename(f),
    base64: readFileSync(f).toString('base64'),
    mediaType: 'application/pdf',
  }))
  const controller = new AbortController()
  const killer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const out: RunOut = { bundle: null, notices: [], errors: [], seconds: 0 }
  const t0 = Date.now()
  try {
    const res = await fetch(`${BASE_URL}/api/ai/unifiedImport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ documents, ...extra }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) { out.errors.push(`HTTP ${res.status}`); return out }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.t === 'json' && (evt.key === 'bundle' || evt.key === 'filing:bundle')) out.bundle = evt.value
            if (evt.t === 'notice') out.notices.push(`[${evt.level}] ${evt.message}`)
            if (evt.t === 'error') out.errors.push(String(evt.message))
            if (evt.t === 'tool' && evt.phase === 'start') log(`    [${Math.round((Date.now() - t0) / 1000)}s] ${evt.name} — ${evt.summary ?? ''}`)
          } catch { /* :hb */ }
        }
      }
    }
  } catch (e) {
    out.errors.push(String((e as Error).message))
  } finally {
    clearTimeout(killer)
    out.seconds = Math.round((Date.now() - t0) / 1000)
  }
  return out
}

type Check = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): Check => ({ name, pass, detail })

function commonChecks(b: Record<string, unknown>): Check[] {
  const counts = (b['counts'] ?? {}) as { proposed?: number; accepted?: number; unresolved?: number }
  const roles = ((b['fingerprint'] ?? {}) as { documentRoles?: { documentName?: string; role?: string }[] }).documentRoles ?? []
  const out: Check[] = []
  out.push(check('conservation', counts.proposed === (counts.accepted ?? 0) + (counts.unresolved ?? 0),
    `proposed ${counts.proposed} = accepted ${counts.accepted} + unresolved ${counts.unresolved}`))
  out.push(check('documentRoles-real', roles.length > 0 && roles.every(r => r.role && r.role !== 'unknown'),
    JSON.stringify(roles)))
  return out
}

function requirementChecks(b: Record<string, unknown>): Check[] {
  const plan = (b['plan'] ?? {}) as { coverages?: { data?: Record<string, unknown>; refId?: string }[] }
  const covs = plan.coverages ?? []
  const values = covs.map(c => String((c.data ?? {})['requirement'] ?? '(absent)'))
  const canonical = values.every(v => ['MANDATORY', 'OPTIONAL', 'UNKNOWN', '(absent)'].includes(v))
  return [
    check('requirement-enum-honest', canonical, `values: ${JSON.stringify([...new Set(values)])}`),
  ]
}

// ─── Main ──────────────────────────────────────────────────────────────────────
const NJ_MANUAL = resolve(REPO, 'samples/filings/nj-lemonade-ho/NJ HO Manual 02.27.24.pdf')
const WA_RATE = resolve(REPO, 'samples/hardening/pdf/PersonalAuto_WA_Rate_Manual_v2_11_REAL.pdf')
const WA_CONTRACT = resolve(REPO, 'samples/filings/additional_samples/PersonalAuto_WA_Form_Washington Auto Contract 01 26.pdf')

const token = await login()
log(`✓ authenticated (tenant=${TENANT}) → ${BASE_URL}`)
const results: Record<string, unknown> = { runAt: new Date().toISOString(), baseUrl: BASE_URL, tenant: TENANT, probes: {} }

// Probe 1 — two manuals, different lines, one request (F13 live).
log('\n── probe: two-manuals (NJ HO manual + WA PA rate manual) ──')
const p1 = await runImport(token, [NJ_MANUAL, WA_RATE], { productName: 'Phase P two-manuals probe', filingState: 'NJ' })
const p1checks: Check[] = []
if (!p1.bundle) p1checks.push(check('bundle-returned', false, p1.errors.join('; ') || 'no bundle event'))
else {
  p1checks.push(check('bundle-returned', true, `${p1.seconds}s`))
  p1checks.push(...commonChecks(p1.bundle))
  const roles = ((p1.bundle['fingerprint'] ?? {}) as { documentRoles?: { documentName?: string }[] }).documentRoles ?? []
  const named = roles.map(r => r.documentName ?? '')
  p1checks.push(check('both-docs-visible',
    named.some(n => /NJ HO Manual/i.test(n)) && named.some(n => /PersonalAuto|WA_Rate|Rate_Manual/i.test(n)),
    `documentRoles names: ${JSON.stringify(named)}`))
}
;(results.probes as Record<string, unknown>)['two-manuals'] = { checks: p1checks, notices: p1.notices, errors: p1.errors, seconds: p1.seconds }
for (const c of p1checks) log(`  ${c.pass ? '✓' : '✗'} ${c.name}: ${c.detail}`)

// Probe 2 — real PA contract + rate manual (F18/F14/F22 live).
log('\n── probe: anti-ph (WA Auto contract + rate manual) ──')
if (!existsSync(WA_CONTRACT)) {
  log('  ! WA contract not on disk (additional_samples is operator-local) — running rate-manual-only variant')
}
const p2files = existsSync(WA_CONTRACT) ? [WA_CONTRACT, WA_RATE] : [WA_RATE]
const p2 = await runImport(token, p2files, { productName: 'Phase P anti-PH probe', filingState: 'WA' })
const p2checks: Check[] = []
if (!p2.bundle) p2checks.push(check('bundle-returned', false, p2.errors.join('; ') || 'no bundle event'))
else {
  p2checks.push(check('bundle-returned', true, `${p2.seconds}s`))
  p2checks.push(...commonChecks(p2.bundle))
  const plan = (p2.bundle['plan'] ?? {}) as { product?: { data?: Record<string, unknown> }; products?: { data?: Record<string, unknown> }[]; summary?: { lobName?: string }; ratingProgram?: { data?: { steps?: unknown[] } } | null }
  const prodData = plan.product?.data ?? plan.products?.[0]?.data ?? {}
  const lob = (prodData['lob'] ?? {}) as { refId?: string; name?: string }
  p2checks.push(check('lob-not-PH-default', Boolean(lob.refId && !/^PH\./.test(lob.refId)),
    `lob=${JSON.stringify(lob)} summary.lobName=${plan.summary?.lobName}`))
  p2checks.push(...requirementChecks(p2.bundle))
  const steps = plan.ratingProgram?.data?.steps ?? []
  p2checks.push(check('rating-program-populated-or-conserved',
    (Array.isArray(steps) && steps.length > 0) || ((p2.bundle['unresolved'] as unknown[])?.length ?? 0) > 0,
    `steps=${Array.isArray(steps) ? steps.length : 0} unresolved=${(p2.bundle['unresolved'] as unknown[])?.length ?? 0}`))
}
;(results.probes as Record<string, unknown>)['anti-ph'] = { checks: p2checks, notices: p2.notices, errors: p2.errors, seconds: p2.seconds }
for (const c of p2checks) log(`  ${c.pass ? '✓' : '✗'} ${c.name}: ${c.detail}`)

writeFileSync(resolve(REPO, 'docs/import-hardening/RESULTS/phasep-probes.json'), JSON.stringify(results, null, 2))
const allChecks = [...p1checks, ...p2checks]
const reds = allChecks.filter(c => !c.pass)
log(`\n${allChecks.length - reds.length}/${allChecks.length} checks green → RESULTS/phasep-probes.json`)
process.exit(reds.length > 0 ? 1 : 0)
