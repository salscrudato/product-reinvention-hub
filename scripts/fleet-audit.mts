// fleet-audit.mts — H5: a READ-ONLY capability probe of the configured AI provider(s).
//
// For every routed deployment (shared/src/ai/fleet.ts) it makes ONE minimal, read-only call
// (max 1 output token; embeddings probe a 1-token input) through the configured Azure Foundry
// gateway and records reachable / unprovisioned / auth_error / unreachable — so the fleet audit
// (docs/build/FLEET_AUDIT.md) rests on observed provisioning, not assumption. It NEVER writes,
// mutates, or persists anything, and it prints NO secret. Costs are trivial and each call goes
// through the same endpoint the server uses (the cost guard applies in-process; this probe is
// out-of-process and self-bounded to 6 tiny calls). With no creds in the environment it reports
// `not_configured` and exits 0 — run it IN-AZURE, or locally with AZURE_FOUNDRY_ENDPOINT/KEY set.
//
//   npx tsx scripts/fleet-audit.mts            # human table
//   npx tsx scripts/fleet-audit.mts --json     # machine JSON (for FLEET_AUDIT.md evidence)
import { allDeployments } from '../shared/src/ai/fleet.ts'

const SVC = (process.env.AZURE_FOUNDRY_ENDPOINT || '').replace(/\/+$/, '')
const KEY = process.env.AZURE_FOUNDRY_KEY || ''
const ANTHROPIC_VERSION = process.env.AZURE_FOUNDRY_ANTHROPIC_VERSION || '2023-06-01'
const asJson = process.argv.includes('--json')
const TIMEOUT_MS = Number(process.env.FLEET_AUDIT_TIMEOUT_MS) || 20_000

// Other provider keys that MIGHT be present (the fleet routes through Foundry today; these are
// reported for completeness so the audit can note what else is wired).
const OTHER_PROVIDERS = {
  openai_direct: !!process.env.OPENAI_API_KEY,
  google: !!process.env.GOOGLE_API_KEY,
  anthropic_direct: !!process.env.ANTHROPIC_API_KEY,
}

type Status = 'reachable' | 'unprovisioned' | 'auth_error' | 'unreachable' | 'not_configured'

async function probe(dep: { deploymentName: string; sdkFamily: 'anthropic' | 'openai'; role: string }): Promise<{ role: string; deployment: string; status: Status; httpStatus?: number; detail?: string }> {
  const base = { role: dep.role, deployment: dep.deploymentName }
  if (!SVC || !KEY) return { ...base, status: 'not_configured' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    let url: string, headers: Record<string, string>, body: unknown
    if (dep.sdkFamily === 'anthropic') {
      url = `${SVC}/anthropic/v1/messages`
      headers = { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': ANTHROPIC_VERSION }
      body = { model: dep.deploymentName, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
    } else if (/embedding/i.test(dep.deploymentName)) {
      url = `${SVC}/openai/v1/embeddings`
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'api-key': KEY }
      body = { model: dep.deploymentName, input: 'ping' }
    } else {
      url = `${SVC}/openai/v1/chat/completions`
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'api-key': KEY }
      body = { model: dep.deploymentName, max_completion_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
    }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    if (res.ok) return { ...base, status: 'reachable', httpStatus: res.status }
    if (res.status === 401 || res.status === 403) return { ...base, status: 'auth_error', httpStatus: res.status }
    // 404 / DeploymentNotFound (or a 400 naming the deployment) → not provisioned in this project.
    const txt = (await res.text().catch(() => '')).slice(0, 200)
    const unprovisioned = res.status === 404 || /deploymentnotfound|does not exist|not found/i.test(txt)
    return { ...base, status: unprovisioned ? 'unprovisioned' : 'unreachable', httpStatus: res.status, detail: txt.replace(/\s+/g, ' ').trim() }
  } catch (e) {
    return { ...base, status: 'unreachable', detail: String((e as Error)?.message || e).slice(0, 120) }
  } finally {
    clearTimeout(timer)
  }
}

const results = await Promise.all(allDeployments().map(probe))
const configured = !!(SVC && KEY)
const report = {
  at: new Date().toISOString(),
  foundry: { configured, endpointHost: SVC ? new URL(SVC).host : null },  // host only — never the key
  otherProviders: OTHER_PROVIDERS,
  deployments: results,
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Fleet capability probe @ ${report.at}`)
  console.log(`Foundry gateway: ${configured ? `configured (${report.foundry.endpointHost})` : 'NOT CONFIGURED — set AZURE_FOUNDRY_ENDPOINT/KEY or run in-Azure'}`)
  console.log(`Other provider keys present: ${Object.entries(OTHER_PROVIDERS).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`)
  console.log('')
  for (const r of results) console.log(`  ${r.status.padEnd(14)} ${r.role.padEnd(15)} ${r.deployment}${r.httpStatus ? `  [HTTP ${r.httpStatus}]` : ''}${r.detail ? `  ${r.detail}` : ''}`)
}
// A probe is a diagnostic, never a gate — exit 0 even when nothing is configured.
process.exit(0)
