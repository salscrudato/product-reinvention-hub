#!/usr/bin/env tsx
/**
 * scripts/import-loop.ts — fidelity + canary + live-import closed loop
 *
 * Runs, in order:
 *   1. pnpm test:unit  — vitest suite incl. 3 rating canaries (HO-3 $1,528 / GL $2,635 / PA $1,002)
 *   2. pnpm import:live — cross-format harness against real dev endpoints
 *
 * Computes a single deterministic exit:
 *   pass = fidelityGreen && canariesGreen && crashes===0 &&
 *          fabrications===0 && formatsPassed===formatsTotal
 *
 * Writes the ledger to docs/audit/import_ledger.json and exits 0 (pass) or 1 (fail).
 *
 * The exit value is COMPUTED from observed outputs — never human-asserted.
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dir  = dirname(fileURLToPath(import.meta.url))
const REPO   = resolve(__dir, '..')
const AUDIT  = join(REPO, 'docs/audit')
const LEDGER = join(AUDIT, 'import_ledger.json')

function log(msg: string) { process.stdout.write(`${msg}\n`) }
function section(t: string) { log(`\n── ${t} ──`) }
function ok(l: string)   { log(`  + ${l}`) }
function fail(l: string) { log(`  x ${l}`) }

// ─── Step helper: run a pnpm script, capture exit code ───────────────────────
function runStep(label: string, cmd: string): { passed: boolean; stdout: string; stderr: string } {
  log(`\n[running] ${cmd}`)
  const t0 = Date.now()
  let stdout = ''
  let stderr = ''
  let passed = false
  try {
    const out = execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 })
    stdout = out
    passed = true
    ok(`${label} passed (${Date.now() - t0}ms)`)
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    stdout = e.stdout ?? ''
    stderr = e.stderr ?? ''
    passed = false
    fail(`${label} FAILED (${Date.now() - t0}ms)`)
    if (stderr) log(`    stderr: ${stderr.slice(0, 400)}`)
  }
  return { passed, stdout, stderr }
}

// ─── Detect canary passes from vitest stdout ──────────────────────────────────
// The 3 rating canaries produce specific assertion lines in vitest output.
// We scan stdout for their test descriptions to confirm they ran and passed.
function detectCanaries(vitestStdout: string): {
  ho3: boolean; gl: boolean; pa: boolean; allGreen: boolean
} {
  // Canary test descriptions (from evaluator.test.ts)
  const ho3 = /\$1[,.]?528/.test(vitestStdout) && !/failed.*\$1[,.]?528/.test(vitestStdout)
  const gl  = /\$2[,.]?635/.test(vitestStdout) && !/failed.*\$2[,.]?635/.test(vitestStdout)
  const pa  = /\$1[,.]?002/.test(vitestStdout) && !/failed.*\$1[,.]?002/.test(vitestStdout)
  return { ho3, gl, pa, allGreen: ho3 && gl && pa }
}

// ─── Read import:live results ─────────────────────────────────────────────────
interface LiveExit {
  runs: number; crashes: number; fabrications: number; sourceGaps: number
  formatsPassed: number; formatsTotal: number; roundTripOk: boolean; pass: boolean
}
interface LiveResults { runAt: string; baseUrl: string; exit: LiveExit }

function readLiveResults(): LiveResults | null {
  const p = join(AUDIT, 'import_live_results.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) as LiveResults } catch { return null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

section('Step 1/2 — Unit tests + rating canaries (pnpm test:unit)')
const testStep = runStep('pnpm test:unit', 'pnpm test:unit')
const fidelityGreen  = testStep.passed
const canaryResult   = detectCanaries(testStep.stdout + testStep.stderr)
const canariesGreen  = fidelityGreen && canaryResult.allGreen

log(`  HO-3 $1,528: ${canaryResult.ho3 ? 'green' : 'MISSING/FAILED'}`)
log(`  GL   $2,635: ${canaryResult.gl  ? 'green' : 'MISSING/FAILED'}`)
log(`  PA   $1,002: ${canaryResult.pa  ? 'green' : 'MISSING/FAILED'}`)

section('Step 2/2 — Live import harness (pnpm import:live)')
const liveStep = runStep('pnpm import:live', 'pnpm import:live')
// import:live writes its own results file; read it back to get the structured exit.
const liveData   = readLiveResults()
const liveExit   = liveData?.exit ?? null

if (!liveExit) {
  fail('import_live_results.json not found after pnpm import:live — harness may have crashed before writing')
}

// ─── Computed exit ────────────────────────────────────────────────────────────

section('Computed exit')

const crashes      = liveExit?.crashes      ?? -1
const fabrications = liveExit?.fabrications ?? -1
const sourceGaps   = liveExit?.sourceGaps   ?? 0
const formatsPassed = liveExit?.formatsPassed ?? 0
const formatsTotal  = liveExit?.formatsTotal  ?? -1
const roundTripOk   = liveExit?.roundTripOk   ?? false

const pass =
  fidelityGreen &&
  canariesGreen &&
  crashes === 0 &&
  fabrications === 0 &&
  formatsPassed === formatsTotal &&
  roundTripOk

log(`  fidelityGreen:  ${fidelityGreen}`)
log(`  canariesGreen:  ${canariesGreen} (HO-3=${canaryResult.ho3} GL=${canaryResult.gl} PA=${canaryResult.pa})`)
log(`  crashes:        ${crashes}`)
log(`  fabrications:   ${fabrications}`)
log(`  source-gaps:    ${sourceGaps} (not counted against pass)`)
log(`  formatsPassed:  ${formatsPassed}/${formatsTotal}`)
log(`  roundTripOk:    ${roundTripOk}`)
log(`\n  PASS: ${pass}`)

// ─── Write ledger ─────────────────────────────────────────────────────────────

if (!existsSync(AUDIT)) mkdirSync(AUDIT, { recursive: true })

const ledger = {
  runAt: new Date().toISOString(),
  pass,
  computed: true,
  steps: {
    unitTests:  { passed: fidelityGreen },
    canaries:   { ho3: canaryResult.ho3, gl: canaryResult.gl, pa: canaryResult.pa, allGreen: canariesGreen },
    importLive: liveExit ?? { error: 'results not found' },
  },
  exit: { fidelityGreen, canariesGreen, crashes, fabrications, sourceGaps, formatsPassed, formatsTotal, roundTripOk, pass },
}

writeFileSync(LEDGER, JSON.stringify(ledger, null, 2))
ok(`Ledger written to docs/audit/import_ledger.json`)

process.exit(pass ? 0 : 1)
