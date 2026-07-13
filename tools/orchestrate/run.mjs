#!/usr/bin/env node
/*
 * tools/orchestrate/run.mjs
 *
 * Local orchestration harness for the remaining product prompts.
 *
 *   03 authz  | build  (headless, push-blocked)
 *   04 filing | build  (headless, push-blocked)
 *   05 portal | build  (headless, push-blocked)
 *   06 ops    | build  (headless, push-blocked)
 *   07 ship   | ship   (headless, FULLY UNATTENDED, allowed to push + deploy)
 *
 * Each prompt runs in its OWN fresh `claude -p` process (context isolation lives
 * in git + files, never in a resumed conversation). After every session the
 * harness runs the full quality gate, then only the rating canary, then asserts
 * HEAD advanced and the tree is clean. Any failure halts the chain and exits
 * non-zero, leaving the pre-<name> checkpoint tag in place.
 *
 * This harness ORCHESTRATES only. It never edits product code, never touches a
 * canary, and its own code never runs git push / git remote / gh / a deploy
 * (enforced by RUNNER_FORBIDDEN below). The ONLY push + deploy happens inside
 * the 07 SHIP session, which Claude drives; see README.md for the reconciliation
 * of why 07 is allowed to push while 03-06 are not.
 *
 * One cross-platform Node ESM script. Runs under PowerShell and bash alike.
 */

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

// --- locations -------------------------------------------------------------

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const PROMPTS_DIR = path.join(SCRIPT_DIR, 'prompts')
const PROJECT_SETTINGS = path.join(REPO_ROOT, '.claude', 'settings.json')

// --- constants -------------------------------------------------------------

const MODEL = 'claude-opus-4-8'
const CANARY_FILE = 'shared/src/rating/workedExample.canary.test.ts'
const CANARIES = [
  { line: 'PH', value: 1528 },
  { line: 'PA', value: 1002 },
  { line: 'GL', value: 2635 },
]

// The gate, exactly as CLAUDE.md defines it, run step by step so the SUMMARY can
// name the first failing stage.
const GATE_STEPS = [
  { name: 'typecheck', cmd: 'pnpm typecheck' },
  { name: 'lint', cmd: 'pnpm lint' },
  { name: 'test', cmd: 'pnpm test' },
  { name: 'build', cmd: 'pnpm build' },
]

const STEPS = [
  { id: '03', name: 'authz', file: '03-authz.md', kind: 'build' },
  { id: '04', name: 'filing', file: '04-filing.md', kind: 'build' },
  { id: '05', name: 'portal', file: '05-portal.md', kind: 'build' },
  { id: '06', name: 'ops', file: '06-ops.md', kind: 'build' },
  { id: '07', name: 'ship', file: '07-ship.md', kind: 'ship' },
]

// Tools pre-authorized for the BUILD prompts. Mirrors .claude/settings.json.
const BASE_ALLOW = [
  'Read', 'Grep', 'Glob', 'Edit', 'Write',
  'Bash(pnpm *)', 'Bash(node *)',
  'Bash(git add *)', 'Bash(git commit *)', 'Bash(git status *)', 'Bash(git diff *)',
  'Bash(git log *)', 'Bash(git tag *)', 'Bash(git rev-parse *)', 'Bash(git checkout *)',
  'Bash(git restore *)', 'Bash(git merge *)',
]

// Denied per-session for BUILD prompts. A deny beats an allow at every settings
// level, so this stops 03-06 pushing even though the user-global allowlist on
// this machine grants git push / gh. Both ":*" and " *" forms are listed to
// match however the agent phrases the command.
const BUILD_DENY = [
  'Bash(git push)', 'Bash(git push:*)', 'Bash(git push *)',
  'Bash(git remote)', 'Bash(git remote:*)', 'Bash(git remote *)',
  'Bash(gh)', 'Bash(gh:*)', 'Bash(gh *)',
]

// Extra tools the SHIP prompt legitimately needs. Added on top of BASE_ALLOW and
// passed via --allowedTools so 07 can ship WITHOUT bypassPermissions: it stays
// fail-closed (no unscoped Bash). If 07 halts on a needed-but-unlisted tool,
// widen this list and re-run rather than reaching for bypassPermissions.
const SHIP_EXTRA = [
  'Bash(git push *)', 'Bash(git push:*)', 'Bash(git remote *)', 'Bash(git remote:*)',
  'Bash(git fetch *)', 'Bash(git pull *)',
  'Bash(gh *)', 'Bash(gh:*)', 'Bash(gitleaks *)', 'Bash(az *)', 'Bash(npx *)',
]
const SHIP_ALLOW = [...BASE_ALLOW, ...SHIP_EXTRA]

// The runner's OWN operational shell calls (gate, canary, git bookkeeping) are
// routed through runShell(), which refuses anything matching this. The claude
// spawn is intentionally NOT routed through it, because a permission flag value
// legitimately contains the substring "git push".
const RUNNER_FORBIDDEN = /(git\s+push|git\s+remote|git\s+fetch|git\s+pull|\bgh\b|gitleaks|\baz\b|deploy)/i

// --- tiny helpers ----------------------------------------------------------

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(ESC + '\\[[0-9;]*m', 'g')
const stripAnsi = (s) => String(s).replace(ANSI, '')
const short = (sha) => (sha ? String(sha).slice(0, 10) : '(none)')
const quote = (s) => '"' + s + '"'
const trunc = (s, n) => (s.length > n ? s.slice(0, n) + '...' : s)

function print(s = '') { process.stdout.write(s + '\n') }

function banner(title) {
  const bar = '='.repeat(Math.max(8, title.length + 6))
  print('')
  print(bar)
  print('=  ' + title)
  print(bar)
}

function tailOf(text, n = 40) {
  const lines = stripAnsi(text).split(/\r?\n/)
  return lines.slice(-n).join('\n')
}

function nowStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  )
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }) }

function tryParse(line) {
  const t = line.trim()
  if (!t) return null
  try { return JSON.parse(t) } catch { return null }
}

// --- guarded shell for the runner's own commands ---------------------------

function runShell(command, opts = {}) {
  if (RUNNER_FORBIDDEN.test(command)) {
    throw new Error('Runner refused a forbidden command (this harness never pushes/deploys): ' + command)
  }
  return spawnSync(command, {
    shell: true,
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  })
}

function git(argstr, opts = {}) { return runShell('git ' + argstr, opts) }
function headSha() { return (git('rev-parse HEAD').stdout || '').trim() }
function treeClean() { return (git('status --porcelain').stdout || '').trim() === '' }

// --- arg parsing -----------------------------------------------------------

function parseArgs(argv) {
  const a = { from: '03', to: '07', auto: false, dryRun: false, maxTurns: 300, maxBudget: 50, help: false }
  const norm = []
  for (const raw of argv) {
    if (raw.startsWith('--') && raw.includes('=')) {
      const eq = raw.indexOf('=')
      norm.push(raw.slice(0, eq), raw.slice(eq + 1))
    } else {
      norm.push(raw)
    }
  }
  for (let i = 0; i < norm.length; i++) {
    const t = norm[i]
    if (t === '--auto') a.auto = true
    else if (t === '--dry-run') a.dryRun = true
    else if (t === '--from') a.from = norm[++i]
    else if (t === '--to') a.to = norm[++i]
    else if (t === '--max-turns') a.maxTurns = Number(norm[++i])
    else if (t === '--max-budget-usd') a.maxBudget = Number(norm[++i])
    else if (t === '-h' || t === '--help') a.help = true
    else throw new Error('Unknown argument: ' + t)
  }
  if (!STEPS.some((s) => s.id === a.from)) throw new Error('--from must be one of ' + STEPS.map((s) => s.id).join(', '))
  if (!STEPS.some((s) => s.id === a.to)) throw new Error('--to must be one of ' + STEPS.map((s) => s.id).join(', '))
  if (a.from > a.to) throw new Error('--from (' + a.from + ') must be <= --to (' + a.to + ')')
  if (!Number.isFinite(a.maxTurns) || a.maxTurns <= 0) throw new Error('--max-turns must be a positive number')
  if (!Number.isFinite(a.maxBudget) || a.maxBudget <= 0) throw new Error('--max-budget-usd must be a positive number')
  return a
}

function selectSteps(from, to) { return STEPS.filter((s) => s.id >= from && s.id <= to) }

function printHelp() {
  print('Usage: node tools/orchestrate/run.mjs [options]')
  print('')
  print('  --from <id>            first prompt to run (default 03)')
  print('  --to <id>              last prompt to run  (default 07)')
  print('  --auto                 chain all prompts without pausing between them')
  print('  --dry-run              print the exact invocations + gates and run nothing')
  print('  --max-turns <N>        per-session turn cap (default 300)')
  print('  --max-budget-usd <X>   per-session dollar cap (default 50)')
  print('  -h, --help             this help')
  print('')
  print('Always run --dry-run first. See tools/orchestrate/README.md.')
}

// --- prompt files ----------------------------------------------------------

function readPrompt(step) { return fs.readFileSync(path.join(PROMPTS_DIR, step.file), 'utf8') }

function isPlaceholder(body) {
  const stripped = body
    .split(/\r?\n/)
    .filter((l) => !l.includes('ORCHESTRATE-PLACEHOLDER'))
    .join('\n')
    .trim()
  return stripped.length === 0
}

// --- claude invocation -----------------------------------------------------

function claudeFlags(step, args) {
  const f = [
    '-p',
    '--model', MODEL,
    '--permission-mode', 'dontAsk',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(args.maxTurns),
    '--max-budget-usd', String(args.maxBudget),
  ]
  if (step.kind === 'ship') f.push('--allowedTools', quote(SHIP_ALLOW.join(',')))
  else f.push('--disallowedTools', quote(BUILD_DENY.join(',')))
  return f
}

function claudeCommand(step, args) { return 'claude ' + claudeFlags(step, args).join(' ') }

function heartbeat(ev) {
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    for (const c of ev.message.content) {
      if (c && c.type === 'tool_use') {
        let detail = ''
        if (c.name === 'Bash' && c.input && typeof c.input.command === 'string') {
          detail = ': ' + trunc(c.input.command.replace(/\s+/g, ' '), 90)
        }
        print('    . ' + c.name + detail)
      }
    }
  } else if (ev.type === 'result') {
    print('    . result: ' + (ev.subtype || '') + (ev.is_error ? ' (is_error)' : ''))
  }
}

// Launch one fresh headless session. The prompt body is streamed via stdin so a
// multi-KB prompt never hits a command-line length or quoting limit on Windows.
function spawnClaude({ step, args, logPath, body }) {
  return new Promise((resolve) => {
    const cmd = claudeCommand(step, args)
    const logStream = fs.createWriteStream(logPath, { flags: 'a' })
    logStream.write('# invocation: ' + cmd + '\n')
    logStream.write('# prompt: piped via stdin (' + body.length + ' chars) from prompts/' + step.file + '\n\n')

    // NOTE: not routed through runShell(). The flag value legitimately contains
    // the substring "git push"; the guard is only for the runner's own commands.
    const child = spawn(cmd, { shell: true, cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] })

    const events = []
    let buf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      logStream.write(chunk)
      buf += chunk
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        const ev = tryParse(line)
        if (ev) { events.push(ev); heartbeat(ev) }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { logStream.write('[stderr] ' + chunk) })
    child.on('error', (err) => { logStream.write('[spawn-error] ' + err.message + '\n') })
    child.on('close', (code) => {
      if (buf.trim()) { const ev = tryParse(buf); if (ev) events.push(ev) }
      logStream.end()
      const result = [...events].reverse().find((e) => e.type === 'result')
      resolve({
        exitCode: code,
        isError: result ? !!result.is_error : code !== 0,
        sessionId: result ? result.session_id : null,
        costUsd: result ? (result.total_cost_usd ?? result.cost_usd ?? null) : null,
        numTurns: result ? result.num_turns : null,
        resultSubtype: result ? result.subtype : null,
        events,
        logPath,
      })
    })

    child.stdin.write(body)
    child.stdin.end()
  })
}

// Heuristic: from a ship session's tool_use events, note what shipped.
function scanShipActions(events) {
  const cmds = []
  for (const ev of events) {
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const c of ev.message.content) {
        if (c && c.type === 'tool_use' && c.name === 'Bash' && c.input && typeof c.input.command === 'string') {
          cmds.push(c.input.command.replace(/\s+/g, ' ').trim())
        }
      }
    }
  }
  const pushes = cmds.filter((c) => /\bgit\s+push\b/.test(c))
  const pushedAzure = pushes.some((c) => /azure/i.test(c))
  const pushedGitHub = pushes.some((c) => /origin|github/i.test(c))
  // A push to an unnamed remote (bare `git push`) is attributed to neither.
  const pushedUnspecified = pushes.length > 0 && !pushedAzure && !pushedGitHub
  return {
    pushCount: pushes.length,
    pushedGitHub,
    pushedAzure,
    pushedUnspecified,
    deployTriggered: pushedAzure, // the ADO pipeline auto-deploys on push to the azure remote
    ghUsed: cmds.some((c) => /\bgh\b/.test(c)),
    pushCommands: pushes.map((c) => trunc(c, 120)),
  }
}

// --- gate + canary ---------------------------------------------------------

function runGate(logDir, tag) {
  const results = []
  for (const s of GATE_STEPS) {
    const r = runShell(s.cmd)
    const out = (r.stdout || '') + (r.stderr || '')
    fs.writeFileSync(path.join(logDir, tag + '.gate.' + s.name + '.log'), out)
    const ok = r.status === 0
    results.push({ name: s.name, ok, tail: tailOf(out) })
    if (!ok) return { ok: false, results, failed: s.name }
  }
  return { ok: true, results, failed: null }
}

function runCanary(logDir, tag) {
  const r = runShell('pnpm exec vitest run ' + CANARY_FILE)
  const out = (r.stdout || '') + (r.stderr || '')
  fs.writeFileSync(path.join(logDir, tag + '.canary.log'), out)
  const clean = stripAnsi(out)
  const observed = {}
  const re = /(PH|PA|GL): the kit worked example prices to \$(\d+)/g
  let m
  while ((m = re.exec(clean))) observed[m[1]] = Number(m[2])
  const valuesOk = CANARIES.every((c) => observed[c.line] === c.value)
  return { ok: r.status === 0 && valuesOk, exitCode: r.status, observed, tail: tailOf(out) }
}

function observedStr(observed) {
  return CANARIES.map((c) => c.line + '=$' + (observed[c.line] ?? '?')).join(' ')
}

// --- pause -----------------------------------------------------------------

function pause(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(q, () => { rl.close(); resolve() })
  })
}

// --- preflight -------------------------------------------------------------

function toolVersion(cmd) {
  const r = runShell(cmd)
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/)[0] || '' }
}

function checkAllowlist() {
  const res = { exists: false, baseOk: false, noPush: false, detail: '' }
  if (!fs.existsSync(PROJECT_SETTINGS)) { res.detail = 'missing ' + PROJECT_SETTINGS; return res }
  res.exists = true
  let allow = []
  try {
    const json = JSON.parse(fs.readFileSync(PROJECT_SETTINGS, 'utf8'))
    allow = (json.permissions && json.permissions.allow) || []
  } catch (e) {
    res.detail = 'unparseable settings.json: ' + e.message
    return res
  }
  const allowSet = new Set(allow)
  res.baseOk = BASE_ALLOW.every((t) => allowSet.has(t))
  const forbidden = allow.filter((t) => /git push|git remote|(^|[^a-z])gh[( ]|Bash\(\*\)/i.test(t))
  res.noPush = forbidden.length === 0
  res.detail = 'allow entries: ' + allow.length + (res.baseOk ? '' : ' (missing base tools)') +
    (res.noPush ? '' : ' (contains push/remote/gh/unscoped-bash: ' + forbidden.join(', ') + ')')
  return res
}

function preflight(args, ctx) {
  banner('PREFLIGHT')
  const claudeV = toolVersion('claude --version')
  const pnpmV = toolVersion('pnpm -v')
  const nodeV = toolVersion('node -v')
  ctx.versions = { claude: claudeV.out, pnpm: pnpmV.out, node: nodeV.out }
  print('  claude : ' + (claudeV.ok ? claudeV.out : 'NOT FOUND'))
  print('  pnpm   : ' + (pnpmV.ok ? pnpmV.out : 'NOT FOUND'))
  print('  node   : ' + (nodeV.ok ? nodeV.out : 'NOT FOUND'))

  const dirty = !treeClean()
  ctx.startSha = headSha()
  print('  start commit : ' + short(ctx.startSha))
  print('  working tree : ' + (dirty ? 'DIRTY' : 'clean'))

  const allow = checkAllowlist()
  print('  allowlist    : ' + (allow.exists ? '' : 'MISSING ') + allow.detail)

  const problems = []
  if (!claudeV.ok) problems.push('claude CLI not runnable')
  if (!pnpmV.ok) problems.push('pnpm not runnable')
  if (dirty) problems.push('working tree is dirty (a clean tree is required)')
  if (!allow.exists) problems.push('.claude/settings.json is missing the scoped allowlist')
  if (allow.exists && !allow.baseOk) problems.push('.claude/settings.json is missing required base tools')
  if (allow.exists && !allow.noPush) problems.push('.claude/settings.json allow list must not contain push/remote/gh/unscoped-bash')

  if (problems.length && !args.dryRun) {
    banner('PREFLIGHT FAILED')
    for (const p of problems) print('  - ' + p)
    print('')
    print('Aborting. Fix the above and re-run. (Nothing was launched, no tags created.)')
    process.exit(1)
  }
  if (problems.length) {
    print('')
    print('  NOTE (dry-run, non-fatal): ' + problems.join('; '))
  }
}

// --- dry-run plan ----------------------------------------------------------

function printPlan(steps, args, ctx) {
  banner('DRY RUN - the following would run; nothing is executed')
  print('  range        : ' + args.from + '..' + args.to)
  print('  pausing      : ' + (args.auto ? 'NO (--auto: chained without pauses)' : 'YES (Enter between prompts)'))
  print('  gate (each)  : ' + GATE_STEPS.map((s) => s.cmd).join(' && '))
  print('  canary (each): pnpm exec vitest run ' + CANARY_FILE)
  print('                 expect ' + CANARIES.map((c) => c.line + ' $' + c.value).join(' / '))
  print('  checkpoints  : git tag orchestrate/pre-<name>-' + ctx.stamp + '  (before each prompt)')

  for (const step of steps) {
    const body = readPrompt(step)
    const filled = isPlaceholder(body) ? 'PLACEHOLDER NOT FILLED IN' : body.length + ' chars'
    banner('PROMPT ' + step.id + ' (' + step.name + ') - ' + (step.kind === 'ship' ? 'SHIP / UNATTENDED' : 'BUILD'))
    if (step.kind === 'ship') {
      print('  !! UNATTENDED SHIP: this session is permitted to merge, push to GitHub')
      print('  !! then Azure, and trigger a PRODUCTION deploy, with no human stop.')
      print('  !! allowed tools : ' + SHIP_ALLOW.join(', '))
    } else {
      print('  push-blocked via --disallowedTools : ' + BUILD_DENY.join(', '))
    }
    print('  fresh session : ' + claudeCommand(step, args))
    print('  prompt body   : < prompts/' + step.file + '  (' + filled + ', piped via stdin)')
    print('  then gate + canary; assert HEAD advanced by >= 1 commit and tree clean')
    if (step.kind === 'ship') print('  (07 legitimately pushes: no "nothing pushed" assertion; push/deploy recorded from the session log)')
  }

  banner('FINAL VERIFICATION (after the last prompt that ran)')
  print('  re-run gate + canary once more')
  print('  startup sanity: app/dist build output + `node --check server/server.js`')
  print('  smoke: `node hardening/smoke.mjs` only if ORCH_SMOKE_URL is set (else skipped)')
  print('  write run/' + ctx.stamp + '/SUMMARY.md and print GREEN/RED verdict')
  print('')
  print('Dry run complete. Nothing was executed.')
}

// --- halt + summary --------------------------------------------------------

function halt(ctx, reason, extra) {
  ctx.halted = true
  ctx.haltReason = reason
  banner('HALT')
  print('  ' + reason)
  if (extra) { print(''); print(extra) }
  const p = writeSummary(ctx)
  print('')
  print('SUMMARY: ' + p)
  print('VERDICT: RED')
  process.exit(1)
}

function num(n) { return typeof n === 'number' && Number.isFinite(n) ? n : null }

function writeSummary(ctx) {
  ensureDir(ctx.logDir)
  const rows = ctx.order.map((id) => ctx.records[id])
  let totalCost = 0
  for (const r of rows) { const c = num(r.session && r.session.costUsd); if (c !== null) totalCost += c }

  const L = []
  L.push('# Orchestration run SUMMARY')
  L.push('')
  L.push('- Timestamp: ' + ctx.stamp)
  L.push('- Range: ' + ctx.args.from + '..' + ctx.args.to + '  Mode: ' + (ctx.args.auto ? 'auto (no pauses)' : 'paused'))
  L.push('- Model: ' + MODEL)
  L.push('- Versions: node ' + (ctx.versions?.node || '?') + ' | claude ' + (ctx.versions?.claude || '?') + ' | pnpm ' + (ctx.versions?.pnpm || '?'))
  L.push('- Start commit: ' + short(ctx.startSha))
  L.push('- Halt reason: ' + (ctx.haltReason || 'none'))
  L.push('- Total session cost (USD): ' + (rows.length ? totalCost.toFixed(4) : '0'))
  L.push('- Verdict: ' + (ctx.halted ? 'RED' : 'GREEN'))
  L.push('')
  L.push('## Per-prompt')
  L.push('')
  L.push('| # | name | kind | session | is_error | cost USD | SHA before -> after | gate | canary | HEAD adv | tree clean | verdict |')
  L.push('|---|------|------|---------|----------|----------|---------------------|------|--------|----------|------------|---------|')
  for (const r of rows) {
    const s = r.session || {}
    L.push('| ' + [
      r.id, r.name, r.kind,
      r.reached ? (s.exitCode === 0 && !s.isError ? 'ok' : 'FAIL') : 'skip',
      s.isError == null ? '-' : String(!!s.isError),
      num(s.costUsd) === null ? '-' : Number(s.costUsd).toFixed(4),
      short(r.before) + ' -> ' + short(r.after),
      r.gate ? (r.gate.ok ? 'pass' : 'FAIL@' + r.gate.failed) : '-',
      r.canary ? (r.canary.ok ? observedStr(r.canary.observed) : 'FAIL ' + observedStr(r.canary.observed)) : '-',
      r.headAdvanced == null ? '-' : (r.headAdvanced ? 'yes' : 'NO'),
      r.treeClean == null ? '-' : (r.treeClean ? 'yes' : 'NO'),
      r.verdict || '-',
    ].join(' | ') + ' |')
  }
  L.push('')

  const ship = rows.find((r) => r.kind === 'ship' && r.reached)
  if (ship && ship.shipActions) {
    const a = ship.shipActions
    L.push('## Ship (07) - observed from session log (heuristic)')
    L.push('')
    L.push('- pushed to GitHub: ' + a.pushedGitHub)
    L.push('- pushed to Azure: ' + a.pushedAzure)
    if (a.pushedUnspecified) L.push('- pushed to an unnamed remote: true (inspect the push commands below)')
    L.push('- deploy triggered: ' + a.deployTriggered + '  (ADO pipeline auto-deploys on push to the azure remote)')
    L.push('- gh used: ' + a.ghUsed + '  | git push commands seen: ' + a.pushCount)
    for (const c of a.pushCommands) L.push('  - `' + c + '`')
    L.push('- session log: run/' + ctx.stamp + '/07-ship.log  (full transcript also in the Claude Code session store)')
    L.push('')
  }

  if (ctx.finalGate || ctx.finalCanary || ctx.startup) {
    L.push('## Final verification')
    L.push('')
    if (ctx.finalGate) L.push('- gate: ' + (ctx.finalGate.ok ? 'pass' : 'FAIL@' + ctx.finalGate.failed))
    if (ctx.finalCanary) L.push('- canary: ' + (ctx.finalCanary.ok ? 'pass ' : 'FAIL ') + observedStr(ctx.finalCanary.observed))
    if (ctx.startup) {
      L.push('- startup sanity: dist=' + ctx.startup.dist + ', server-syntax=' + ctx.startup.serverSyntax)
      L.push('- smoke: ' + ctx.startup.smoke)
    }
    L.push('')
  }

  const p = path.join(ctx.logDir, 'SUMMARY.md')
  fs.writeFileSync(p, L.join('\n') + '\n')
  return p
}

// --- final verification ----------------------------------------------------

function startupSanity(ctx) {
  const distOk = fs.existsSync(path.join(REPO_ROOT, 'app', 'dist', 'index.html'))
  const serverPath = path.join(REPO_ROOT, 'server', 'server.js')
  let serverSyntax = 'n/a'
  if (fs.existsSync(serverPath)) {
    const r = runShell('node --check server/server.js')
    serverSyntax = r.status === 0 ? 'ok' : 'FAIL'
  }
  let smoke = 'skipped (set ORCH_SMOKE_URL to run hardening/smoke.mjs)'
  const smokePath = path.join(REPO_ROOT, 'hardening', 'smoke.mjs')
  if (fs.existsSync(smokePath) && process.env.ORCH_SMOKE_URL) {
    const r = runShell('node hardening/smoke.mjs', { env: { ...process.env, BASE_URL: process.env.ORCH_SMOKE_URL } })
    const out = (r.stdout || '') + (r.stderr || '')
    fs.writeFileSync(path.join(ctx.logDir, 'final.smoke.log'), out)
    smoke = r.status === 0 ? 'pass (' + process.env.ORCH_SMOKE_URL + ')' : 'FAIL (' + process.env.ORCH_SMOKE_URL + ')'
  }
  return { dist: distOk ? 'present' : 'MISSING', serverSyntax, smoke }
}

function finalVerification(ctx) {
  banner('FINAL VERIFICATION')
  const g = runGate(ctx.logDir, 'final')
  ctx.finalGate = g
  if (!g.ok) halt(ctx, 'Final gate step "' + g.failed + '" failed.', g.results.find((r) => !r.ok)?.tail)
  const c = runCanary(ctx.logDir, 'final')
  ctx.finalCanary = c
  if (!c.ok) halt(ctx, 'Final canary failed (observed ' + observedStr(c.observed) + ').', c.tail)
  ctx.startup = startupSanity(ctx)
  print('  gate: pass | canary: ' + observedStr(c.observed) + ' | dist: ' + ctx.startup.dist +
    ' | server-syntax: ' + ctx.startup.serverSyntax + ' | smoke: ' + ctx.startup.smoke)
}

// --- ship banner -----------------------------------------------------------

function shipBanner(ctx) {
  banner('SHIP GATE 07 - FULLY UNATTENDED')
  print('  This session runs HEADLESS and is permitted to:')
  print('    - merge to the release branch')
  print('    - push to GitHub, then push to Azure')
  print('    - trigger a PRODUCTION deploy (ADO pipeline auto-deploys on push)')
  print('  There is NO live approval prompt. The safety net is the gate + canary')
  print('  before (via prompt 06) and after this session.')
  print('  07 also has its own internal stops per its prompt text:')
  print('    RISK-001 secret rotation, gitleaks full-history scan, gh auth, Azure branch policy.')
  print('  Reviewing the diff on this security-sensitive prompt is YOUR responsibility;')
  print('  the harness does not review it. Start commit was ' + short(ctx.startSha) + '.')
}

// --- one prompt ------------------------------------------------------------

async function runStep(step, args, ctx) {
  const rec = {
    id: step.id, name: step.name, kind: step.kind, reached: true,
    tag: null, before: null, after: null, session: null,
    gate: null, canary: null, headAdvanced: null, treeClean: null,
    shipActions: null, verdict: 'FAIL',
  }
  ctx.records[step.id] = rec
  ctx.order.push(step.id)

  banner('PROMPT ' + step.id + ' (' + step.name + ') - ' + (step.kind === 'ship' ? 'SHIP / UNATTENDED' : 'BUILD'))

  const body = readPrompt(step)
  if (isPlaceholder(body)) {
    halt(ctx, 'Prompt ' + step.id + ' (prompts/' + step.file + ') is an unfilled placeholder. Paste the prompt text and re-run.')
  }
  if (step.kind === 'ship') shipBanner(ctx)

  rec.before = headSha()
  rec.tag = 'orchestrate/pre-' + step.name + '-' + ctx.stamp
  const tagRes = git('tag ' + rec.tag)
  if (tagRes.status !== 0) print('  (checkpoint tag ' + rec.tag + ' may already exist; continuing)')
  else print('  checkpoint: ' + rec.tag + ' @ ' + short(rec.before))

  const logPath = path.join(ctx.logDir, step.id + '-' + step.name + '.log')
  print('  launching fresh headless session (model ' + MODEL + ', permission-mode dontAsk)')
  const sess = await spawnClaude({ step, args, logPath, body })
  rec.session = sess
  print('  session done: exit=' + sess.exitCode + ' is_error=' + sess.isError +
    ' subtype=' + (sess.resultSubtype || '?') + ' turns=' + (sess.numTurns ?? '?') +
    ' cost=$' + (num(sess.costUsd) === null ? '?' : Number(sess.costUsd).toFixed(4)))

  if (!(sess.exitCode === 0 && !sess.isError)) {
    halt(ctx, 'Prompt ' + step.id + ' session failed (exit ' + sess.exitCode + ', is_error ' + sess.isError +
      ', subtype ' + sess.resultSubtype + ').', tailOf(fs.readFileSync(logPath, 'utf8'), 40))
  }

  print('  gate: ' + GATE_STEPS.map((s) => s.name).join(' -> '))
  rec.gate = runGate(ctx.logDir, step.id + '-' + step.name)
  if (!rec.gate.ok) {
    halt(ctx, 'Gate step "' + rec.gate.failed + '" failed after prompt ' + step.id + '.',
      rec.gate.results.find((r) => !r.ok)?.tail)
  }
  print('  gate: pass')

  rec.canary = runCanary(ctx.logDir, step.id + '-' + step.name)
  if (!rec.canary.ok) {
    halt(ctx, 'Canary failed after prompt ' + step.id + ' (observed ' + observedStr(rec.canary.observed) +
      '; expected ' + CANARIES.map((c) => c.line + ' $' + c.value).join(' / ') + ').', rec.canary.tail)
  }
  print('  canary: ' + observedStr(rec.canary.observed))

  rec.after = headSha()
  rec.headAdvanced = rec.after !== rec.before
  rec.treeClean = treeClean()
  if (step.kind === 'ship') rec.shipActions = scanShipActions(sess.events)

  if (!rec.headAdvanced) {
    halt(ctx, 'HEAD did not advance after prompt ' + step.id + ' (the session committed nothing). before=' +
      short(rec.before) + ' after=' + short(rec.after) + '.')
  }
  if (!rec.treeClean) {
    halt(ctx, 'Working tree is not clean after prompt ' + step.id + ' (uncommitted changes remain).',
      (git('status --porcelain').stdout || '').trim())
  }

  rec.verdict = 'PASS'
  print('  [OK] prompt ' + step.id + ' passed: ' + short(rec.before) + ' -> ' + short(rec.after) +
    (step.kind === 'ship' && rec.shipActions ? '  (pushed=' + rec.shipActions.pushCount + ')' : ''))
}

// --- main ------------------------------------------------------------------

async function main() {
  let args
  try { args = parseArgs(process.argv.slice(2)) } catch (e) { print('error: ' + e.message); printHelp(); process.exit(2) }
  if (args.help) { printHelp(); return }

  const stamp = nowStamp()
  const ctx = {
    stamp,
    logDir: path.join(SCRIPT_DIR, 'run', stamp),
    args,
    startSha: null,
    versions: null,
    records: {},
    order: [],
    halted: false,
    haltReason: null,
    finalGate: null,
    finalCanary: null,
    startup: null,
  }
  const steps = selectSteps(args.from, args.to)

  banner('ORCHESTRATE 03-07  (run ' + stamp + ')')
  print('  prompts: ' + steps.map((s) => s.id).join(', ') + '   mode: ' + (args.auto ? 'auto' : 'paused') +
    '   max-turns: ' + args.maxTurns + '   max-budget: $' + args.maxBudget)

  preflight(args, ctx)

  if (args.dryRun) { printPlan(steps, args, ctx); return }

  ensureDir(ctx.logDir)
  print('  run dir: ' + path.relative(REPO_ROOT, ctx.logDir))

  for (let i = 0; i < steps.length; i++) {
    await runStep(steps[i], args, ctx)
    const isLast = i === steps.length - 1
    if (!isLast && !args.auto) {
      await pause('\n  -> Press Enter to continue to prompt ' + steps[i + 1].id + ' (' + steps[i + 1].name + '), Ctrl+C to stop: ')
    }
  }

  finalVerification(ctx)
  const p = writeSummary(ctx)
  banner('DONE')
  print('  SUMMARY: ' + p)
  print('  VERDICT: GREEN')
  process.exit(0)
}

main().catch((e) => {
  print('')
  print('FATAL: ' + (e && e.stack ? e.stack : e))
  process.exit(1)
})
