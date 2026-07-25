#!/usr/bin/env tsx
/**
 * scripts/import-watch.mts — live SSE watcher for the import brain
 *
 * Streams every token, tool call, notice, and error from /ai/unifiedImport
 * directly to your terminal so you can watch the brain work in real time.
 *
 * Usage:
 *   pnpm tsx scripts/import-watch.mts <file.xlsx|file.pdf> [lobHint]
 *
 * Examples:
 *   pnpm tsx scripts/import-watch.mts samples/iso/sample-GL-framework.xlsx GL.LOB.001
 *   pnpm tsx scripts/import-watch.mts samples/filings/nj-lemonade-ho/NJ\ HO\ Manual\ 02.27.24.pdf
 *
 * Env vars (all optional — defaults hit the Azure dev server):
 *   BASE_URL      Default: https://app-prodhub-dev.azurewebsites.net
 *   IMPORT_USER   Default: admin
 *   IMPORT_PASS   Default: admin
 *   IMPORT_TENANT Default: import-watch
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const BASE_URL     = (process.env.BASE_URL || 'https://app-prodhub-dev.azurewebsites.net').replace(/\/$/, '')
const IMPORT_USER  = process.env.IMPORT_USER  || 'admin'
const IMPORT_PASS  = process.env.IMPORT_PASS  || 'admin'
const IMPORT_TENANT = process.env.IMPORT_TENANT || 'import-watch'

const filePath = process.argv[2]
const lobHint  = process.argv[3]

if (!filePath) {
  console.error('Usage: pnpm tsx scripts/import-watch.mts <file> [lobHint]')
  process.exit(1)
}

const absPath = resolve(filePath)
if (!existsSync(absPath)) {
  console.error(`File not found: ${absPath}`)
  process.exit(1)
}

// ── helpers ──────────────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  magenta:'\x1b[35m',
}

function label(tag: string, color: string) {
  return `${color}[${tag}]${c.reset} `
}

// ── auth ─────────────────────────────────────────────────────────────────────

console.log(`${c.bold}Import Brain Live Watch${c.reset}`)
console.log(`${c.dim}${BASE_URL}${c.reset}`)
console.log(`${c.dim}file: ${absPath}${c.reset}\n`)

const loginRes = await fetch(`${BASE_URL}/api/auth/bootstrap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: IMPORT_USER, password: IMPORT_PASS, tenant: IMPORT_TENANT }),
})
if (!loginRes.ok) {
  console.error(`Auth failed: HTTP ${loginRes.status}`)
  process.exit(1)
}
const { token } = await loginRes.json() as { token: string }
console.log(`${c.green}✓ authenticated${c.reset} as ${IMPORT_USER} / tenant=${IMPORT_TENANT}\n`)

// ── detect media type ────────────────────────────────────────────────────────

const ext = absPath.split('.').pop()?.toLowerCase() ?? ''
const mediaType = ext === 'pdf'
  ? 'application/pdf'
  : ext === 'xlsm'
    ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const fileName = absPath.split(/[\\/]/).pop() ?? 'file'
const base64   = readFileSync(absPath).toString('base64')

// A client-supplied runId makes the finished bundle DURABLE (F23) so we can fetch it
// after the stream ends and inspect the plan (e.g. the dynamic-field 1:many join).
const runId = `run-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
const body: Record<string, unknown> = {
  documents: [{ name: fileName, base64, mediaType }],
  runId,
}
if (lobHint) body.lobRefIdHint = lobHint

// ── stream ───────────────────────────────────────────────────────────────────

console.log(`${c.cyan}▶ Starting import brain stream…${c.reset}\n`)

const res = await fetch(`${BASE_URL}/api/ai/unifiedImport`, {
  method:  'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body:    JSON.stringify(body),
})

if (!res.ok) {
  const errBody = await res.text().catch(() => '')
  console.error(`${c.red}HTTP ${res.status}${c.reset} — ${errBody}`)
  process.exit(1)
}

const reader  = res.body!.getReader()
const decoder = new TextDecoder()
let buf = ''
let tokenBuf = ''   // accumulate tokens and flush on newline / tool boundary
let tokenCount = 0

function flushTokens() {
  if (!tokenBuf) return
  process.stdout.write(`${tokenBuf}`)
  tokenBuf = ''
}

try { for (;;) {
  const { done, value } = await reader.read()
  if (done) break

  buf += decoder.decode(value, { stream: true })
  const lines = buf.split('\n')
  buf = lines.pop() ?? ''

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const raw = line.slice(6).trim()
    if (!raw) continue

    let evt: { t: string; v?: string; key?: string; value?: unknown; message?: string; name?: string; summary?: string; stage?: string }
    try { evt = JSON.parse(raw) } catch { continue }

    if (evt.t === 'token') {
      if (tokenCount === 0) process.stdout.write(label('token', c.cyan))
      tokenBuf += evt.v ?? ''
      tokenCount++
      // flush on natural paragraph breaks so terminal doesn't buffer silently
      if (tokenBuf.includes('\n')) {
        flushTokens()
      }
      continue
    }

    // Non-token event: flush any pending token stream first
    if (tokenCount > 0) {
      flushTokens()
      process.stdout.write('\n')
      tokenCount = 0
    }

    if (evt.t === 'tool') {
      const summary = evt.summary ? ` — ${evt.summary}` : ''
      console.log(`${label('tool', c.magenta)}${c.bold}${evt.name ?? ''}${c.reset}${c.dim}${summary}${c.reset}`)
    } else if (evt.t === 'notice') {
      console.log(`${label('notice', c.yellow)}${evt.message ?? ''}`)
    } else if (evt.t === 'error') {
      console.log(`${label('error', c.red)}${evt.message ?? ''}`)
    } else if (evt.t === 'json' && evt.key === 'bundle') {
      const b = evt.value as { plan?: { coverages?: unknown[]; product?: unknown } } | null
      const covCount = Array.isArray(b?.plan?.coverages) ? b!.plan!.coverages!.length : 0
      console.log(`\n${label('bundle', c.green)}plan received — ${covCount} coverage(s)`)
    } else if (evt.t === 'stage') {
      console.log(`${label('stage', c.cyan)}${evt.stage ?? ''}`)
    } else if (evt.t === 'done') {
      console.log(`\n${c.green}${c.bold}✓ done${c.reset}`)
      break
    }
  }
} } catch (err) {
  const msg = (err as Error).message ?? String(err)
  flushTokens()
  if (/ECONNRESET|terminated|socket|other side closed/i.test(msg)) {
    console.log(`\n${c.yellow}[stream dropped: ${msg}]${c.reset}`)
    console.log(`${c.dim}The server is still computing — check server logs or re-run once it finishes.${c.reset}`)
  } else {
    console.error(`\n${c.red}[error]${c.reset} ${msg}`)
    process.exit(1)
  }
}

flushTokens()
console.log(`\n${c.dim}stream ended${c.reset}`)

// ── Durable bundle inspection: confirm the dynamic-field 1:many join on real data ──
// The SSE 'bundle' event only carries coverages/product; the full plan (with
// Form.dynamicFields + importWarnings) is the durable F23 result. Fetch it and
// summarise how the "Forms Dynamic Data" rows folded onto their parent forms.
try {
  // Blob persistence can lag the stream's end by a beat; poll briefly.
  let bundle: any = null
  for (let attempt = 0; attempt < 10 && !bundle; attempt++) {
    const rr = await fetch(`${BASE_URL}/api/ai/unifiedImportResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ runId }),
    })
    if (rr.ok) { bundle = (await rr.json() as { bundle?: unknown }).bundle ?? null; if (bundle) break }
    await new Promise(r => setTimeout(r, 3000))
  }
  if (!bundle) {
    console.log(`${c.yellow}[dynamic-fields]${c.reset} durable bundle not available (runId=${runId})`)
  } else {
    const plan = (bundle as { plan?: { forms?: Array<{ data?: Record<string, unknown> }>; rtTables?: Array<{ refId?: string; data?: Record<string, unknown> }> } }).plan ?? {}
    const warns = (bundle as { importWarnings?: Array<{ kind: string; detail: string }> }).importWarnings ?? []
    const forms = Array.isArray(plan.forms) ? plan.forms : []
    const withDf = forms.filter(f => Array.isArray(f.data?.dynamicFields) && (f.data!.dynamicFields as unknown[]).length > 0)
    const totalDf = withDf.reduce((n, f) => n + (f.data!.dynamicFields as unknown[]).length, 0)
    console.log(`\n${c.bold}${c.green}Dynamic-field 1:many join${c.reset}`)
    console.log(`  forms in plan: ${forms.length}`)
    console.log(`  forms carrying dynamicFields: ${c.bold}${withDf.length}${c.reset}`)
    console.log(`  total dynamic fields attached: ${c.bold}${totalDf}${c.reset}`)
    for (const w of warns.filter(w => /^dynamic-fields-/.test(w.kind))) {
      console.log(`  ${c.cyan}[${w.kind}]${c.reset} ${w.detail}`)
    }
    const sample = withDf[0]
    if (sample) {
      const num = sample.data!.number ?? sample.data!.refId ?? '(form)'
      const fields = (sample.data!.dynamicFields as Array<{ name: string; dataType: string; repeating?: boolean }>).slice(0, 6)
      console.log(`  ${c.dim}e.g. form ${num}:${c.reset} ${fields.map(f => `${f.name} [${f.dataType}${f.repeating ? ', repeating' : ''}]`).join('; ')}`)
    }

    // Rate-table grid readiness: how many imported RT tables carry explicit grid
    // metadata (dimensions + valueColumn) — the shape that makes them priceable + editable.
    const rtTables = Array.isArray(plan.rtTables) ? plan.rtTables : []
    const withGrid = rtTables.filter(t => Array.isArray(t.data?.dimensions) && (t.data!.dimensions as unknown[]).length > 0)
    console.log(`\n${c.bold}${c.green}RT-table grid metadata${c.reset}`)
    console.log(`  rate tables in plan: ${rtTables.length}`)
    console.log(`  tables with grid dimensions: ${c.bold}${withGrid.length}${c.reset}`)
    const gsample = withGrid[0]
    if (gsample) {
      const dims = (gsample.data!.dimensions as Array<{ key: string; values: string[] }>)
      console.log(`  ${c.dim}e.g. ${gsample.refId ?? gsample.data!.name}:${c.reset} value=${gsample.data!.valueColumn} · ${dims.map(d => `${d.key}(${d.values.length})`).join(' × ')}`)
    }
  }
} catch (err) {
  console.log(`${c.yellow}[dynamic-fields] result fetch failed: ${(err as Error).message}${c.reset}`)
}
