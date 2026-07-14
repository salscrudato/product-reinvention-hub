#!/usr/bin/env node
// scripts/import-enumerate.mjs — OFFLINE enumeration pass over the hardening corpus.
//
// Runs every file in samples/hardening/{workbooks,adversarial} (plus the request
// combinations declared in samples/hardening/mixed/mixed_requests.json) through the
// REAL POST /api/ai/unifiedImport handler — stage-0 routing, the 6-stage brain, the
// ISO join, stage-7 plan assembly and normalizeBundle — with global fetch stubbed to
// a deterministic minimal-valid AI. No network, no spend. What this proves is
// ROBUSTNESS, not accuracy: every artifact must reach `done` with zero unhandled
// errors, and the conservation summary (candidates vs accepted/flagged/review) must
// be computable. Results → docs/import-hardening/RESULTS/corpus-baseline.json.
//
// Baseline only: exit code is 0 unless the harness itself breaks. IH2 turns this
// into a gate once the ledger's conservation defects are fixed.
//
// Run: node scripts/import-enumerate.mjs [--only <substring>]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS = resolve(REPO, 'samples/hardening')
const OUT_DIR = resolve(REPO, 'docs/import-hardening/RESULTS')
const OUT = join(OUT_DIR, 'corpus-baseline.json')
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i !== -1 ? process.argv[i + 1] : null })()

// ─── Offline AI stub ──────────────────────────────────────────────────────────
// Answers every fleet call with a minimal VALID-SHAPE response: forced tool calls
// get an empty input, text turns get '{}'. Deterministic paths (header lock,
// deterministic extract, ISO join) do the real work; AI-dependent paths exercise
// their malformed/empty-output handling — which is exactly what we are baselining.
process.env.AZURE_FOUNDRY_ENDPOINT ||= 'https://offline-stub.local'
process.env.AZURE_FOUNDRY_KEY ||= 'offline-stub'
process.env.LOG_LEVEL ||= 'error'

let stubCalls = 0
globalThis.fetch = async (url, opts) => {
  stubCalls++
  let body = {}
  try { body = JSON.parse(opts?.body ?? '{}') } catch { /* ignore */ }
  const toolName = body?.tool_choice?.name
  if (String(url).includes('anthropic') || Array.isArray(body?.system) || body?.max_tokens) {
    const content = toolName
      ? [{ type: 'tool_use', name: toolName, input: {} }]
      : [{ type: 'text', text: '{}' }]
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ content, usage: { input_tokens: 1, output_tokens: 1 } }),
      arrayBuffer: async () => new ArrayBuffer(0),
    }
  }
  return {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ choices: [{ message: { content: '{}', tool_calls: null } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

const { unifiedImport } = require(join(REPO, 'server/lib/ai/unified-import.js'))

// ─── Fake Express req/res ─────────────────────────────────────────────────────

function makeRes(events) {
  const closeHandlers = []
  return {
    setHeader() {}, flushHeaders() {},
    on(ev, fn) { if (ev === 'close') closeHandlers.push(fn) },
    status(code) { return { json: (o) => events.push({ t: 'http', code, body: o }) } },
    write(chunk) {
      for (const line of String(chunk).split('\n')) {
        if (!line.startsWith('data: ')) continue
        try { events.push(JSON.parse(line.slice(6))) } catch { /* :hb etc. */ }
      }
      return true
    },
    end() { for (const fn of closeHandlers) { try { fn() } catch { /* ignore */ } } },
  }
}

async function runRequest(id, files) {
  const documents = files.map(f => ({
    name: basename(f),
    base64: readFileSync(f).toString('base64'),
    mediaType: /\.pdf$/i.test(f) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const events = []
  const req = { user: { role: 'ADMIN', sub: 'import-enumerate' }, body: { documents } }
  const res = makeRes(events)
  const t0 = Date.now()
  let harnessError = null
  try {
    await Promise.race([
      unifiedImport(req, res),
      new Promise((_, rej) => setTimeout(() => rej(new Error('harness timeout 300s')), 300_000)),
    ])
  } catch (e) {
    harnessError = String((e && e.stack) || e)
  }
  const durationMs = Date.now() - t0

  const byKey = (key) => events.find(e => e.t === 'json' && e.key === key)?.value
  const bundle = byKey('bundle')
  const plan = bundle?.plan ?? null
  const planCount = (k) => (Array.isArray(plan?.[k]) ? plan[k].length : (plan?.[k] ? 1 : 0))
  const planCounts = plan ? {
    products: planCount('products') || planCount('product'),
    coverages: planCount('coverages'), forms: planCount('forms'), rules: planCount('rules'),
    formRules: planCount('formRules'), ldTables: planCount('ldTables'), rtTables: planCount('rtTables'),
    ratingProgram: plan.ratingProgram ? 1 : 0,
  } : null
  const stage4 = byKey('brain:stage4')
  const output = byKey('brain:output')
  const candidates = stage4?.entityCount ?? null
  const plannedTotal = planCounts ? Object.values(planCounts).reduce((a, b) => a + b, 0) : null
  const unresolved = Array.isArray(bundle?.unresolved) ? bundle.unresolved.length : 0

  return {
    id,
    files: files.map(f => basename(f)),
    completed: events.some(e => e.t === 'done'),
    harnessError,
    unhandled: Boolean(harnessError),
    errors: events.filter(e => e.t === 'error').map(e => e.message),
    notices: events.filter(e => e.t === 'notice').map(e => `[${e.level}/${e.kind}] ${e.message}`),
    stage0: byKey('brain:stage0') ?? null,
    stage4: stage4 ?? null,
    summaryCounts: output ?? null,
    planCounts,
    conservation: {
      // Target identity (IH2 gate): candidates = accepted + merged + rejected + unresolved.
      // At baseline only these raw observables exist — the delta records what the
      // pipeline itself cannot currently account for (ledger F06/F20).
      stage4Candidates: candidates,
      planEntities: plannedTotal,
      flagged: stage4?.flagged ?? null,
      reviewQueue: output?.reviewItems ?? output?.reviewQueue ?? null,
      bundleUnresolved: unresolved,
      unaccountedDelta: candidates != null && plannedTotal != null ? candidates - plannedTotal - unresolved : null,
    },
    counts: bundle?.counts ?? null,
    durationMs,
  }
}

// ─── Corpus enumeration ───────────────────────────────────────────────────────

const singles = []
for (const d of ['workbooks', 'adversarial']) {
  for (const f of readdirSync(join(CORPUS, d))) {
    const p = join(CORPUS, d, f)
    if (statSync(p).isFile()) singles.push({ id: `${d}/${f}`, files: [p] })
  }
}
const mixed = JSON.parse(readFileSync(join(CORPUS, 'mixed/mixed_requests.json'), 'utf8'))
  .requests.map(r => ({ id: `mixed/${r.id}`, files: r.files.map(f => resolve(REPO, f)) }))

const runs = [...singles, ...mixed].filter(r => !ONLY || r.id.includes(ONLY))

const results = []
for (const r of runs) {
  process.stdout.write(`  ${r.id} ... `)
  const res = await runRequest(r.id, r.files)
  results.push(res)
  const status = res.unhandled ? 'UNHANDLED' : res.errors.length ? `error(${res.errors.length})` : res.completed ? 'ok' : 'NO-DONE'
  process.stdout.write(`${status} ${res.durationMs}ms cand=${res.conservation.stage4Candidates ?? '-'} plan=${res.conservation.planEntities ?? '-'} Δ=${res.conservation.unaccountedDelta ?? '-'}\n`)
}

const summary = {
  generatedBy: 'scripts/import-enumerate.mjs (offline, stubbed AI)',
  headSha: process.env.GIT_SHA || null,
  runs: results.length,
  completed: results.filter(r => r.completed).length,
  unhandled: results.filter(r => r.unhandled).length,
  withErrors: results.filter(r => r.errors.length > 0).length,
  stubAiCalls: stubCalls,
  results,
}
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(summary, null, 2))
process.stdout.write(`\n${summary.completed}/${summary.runs} completed, ${summary.unhandled} unhandled, ${summary.withErrors} with error events → ${OUT}\n`)
process.exit(0)
