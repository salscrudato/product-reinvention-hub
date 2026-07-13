// scripts/live-smoke.mts — live-endpoint smoke harness for the deployed /api host.
//
// The reusable per-deploy verification pass: hits EVERY router mounted in
// server/server.js against a LIVE base URL, asserting status, response shape,
// role gates, and tenant isolation. Run it after every deploy.
//
// Usage (PowerShell):
//   $env:PF_BASE_URL = "https://app-prodhub-dev.azurewebsites.net"
//   $env:PF_JWT      = "<EDITOR+ bearer token>"        # required for authed routes
//   $env:PF_JWT_VIEWER   = "<VIEWER token>"            # optional: role-gate probe (403)
//   $env:PF_JWT_TENANT_B = "<other-tenant token>"      # optional: isolation probe
//   pnpm live:smoke
//
// Coverage (API Surface Map):
//   /api/health · /api/auth/{tenants,me} · /api/db/{get,list,mutate} (create/update/
//   conflict-409/delete on a throwaway entity) · /api/ai/chat (SSE opens + streams) ·
//   /api/ai/identifyBaseForm (extraction) · /api/storage/url · /api/serff/v1/states ·
//   /api/filing · /api/homecheck/v1/risk · /api/duckcreek/* (must be 404 — removed)
//
// Zero dependencies beyond Node 20 fetch + tsx. Exit code 0 = all green, 1 = any failure.

type Check = { name: string; pass: boolean; detail: string }
const results: Check[] = []

const BASE = (process.env.PF_BASE_URL || '').replace(/\/$/, '')
const JWT = process.env.PF_JWT || ''
const JWT_VIEWER = process.env.PF_JWT_VIEWER || ''
const JWT_TENANT_B = process.env.PF_JWT_TENANT_B || ''

if (!BASE) {
  console.error('PF_BASE_URL is required (e.g. https://app-prodhub-dev.azurewebsites.net)')
  process.exit(2)
}
if (!JWT) {
  console.error('PF_JWT is required (EDITOR+ bearer token — sign in and copy pf.azure.token from localStorage)')
  process.exit(2)
}

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api(path: string, init: RequestInit = {}, token: string | null = JWT) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers })
  let body: unknown = null
  const text = await res.text()
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body: body as Record<string, unknown> | null, headers: res.headers }
}

// SSE probe: POST, assert the stream opens (event-stream content type) and yields
// at least one parseable `data:` event before timeoutMs.
async function sseProbe(path: string, payload: unknown, timeoutMs = 60_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const ctype = res.headers.get('content-type') || ''
    if (!res.ok || !res.body) return { status: res.status, ctype, events: [] as string[], streamed: false }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    const events: string[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw) events.push(raw)
      }
      // Stop early once we have proof of a live stream (≥3 events or a done marker).
      if (events.length >= 3 || events.some((e) => e.includes('"done"') || e.includes("'done'") || e.includes('"t":"done"'))) {
        controller.abort()
        break
      }
    }
    return { status: res.status, ctype, events, streamed: events.length > 0 }
  } catch (e) {
    // AbortError after events were collected is success; otherwise a real failure.
    return { status: 0, ctype: '', events: [] as string[], streamed: false, error: String((e as Error).message) }
  } finally {
    clearTimeout(timer)
  }
}

function section(t: string) { console.log(`\n── ${t} ──`) }

// ─── run ─────────────────────────────────────────────────────────────────────
const runId = `live-smoke-${Date.now().toString(36)}`
const probePath = `smokeProbe/${runId}`

section('health + auth')
{
  const h = await api('/health', {}, null)
  record('health: GET /api/health 200 {status:ok}', h.status === 200 && h.body?.status === 'ok', `status=${h.status}`)

  const t = await api('/auth/tenants', {}, null)
  const tenantList = (t.body as { tenants?: unknown[] } | null)?.tenants ?? t.body
  record('auth: GET /api/auth/tenants 200 + list shape', t.status === 200 && Array.isArray(tenantList), `status=${t.status}`)

  const meNo = await api('/auth/me', {}, null)
  record('auth: GET /api/auth/me without token → 401', meNo.status === 401, `status=${meNo.status}`)

  const me = await api('/auth/me')
  const user = me.body?.user as { role?: string; tenantId?: string } | undefined
  record('auth: GET /api/auth/me with PF_JWT 200 {user.role, user.tenantId}',
    me.status === 200 && !!user?.role && !!user?.tenantId,
    `status=${me.status} role=${user?.role} tenant=${user?.tenantId}`)
}

section('db: atomic mutate lifecycle on a throwaway entity')
let rev1 = 0
{
  const create = await api('/db/mutate', {
    method: 'POST',
    body: JSON.stringify({ payload: { op: 'create', path: probePath, entityType: 'smokeProbe', data: { name: 'live-smoke probe', runId } } }),
  })
  rev1 = Number(create.body?.rev ?? 0)
  record('db: POST /api/db/mutate create → 200 {ok, rev}', create.status === 200 && create.body?.ok === true && rev1 >= 1, `status=${create.status} rev=${rev1}`)

  const get = await api(`/db/get?path=${encodeURIComponent(probePath)}`)
  const ent = get.body?.data as { name?: string; rev?: number } | null
  record('db: GET /api/db/get readback shape + rev match', get.status === 200 && ent?.name === 'live-smoke probe' && ent?.rev === rev1, `status=${get.status} rev=${ent?.rev}`)

  const list = await api('/db/list', { method: 'POST', body: JSON.stringify({ path: 'smokeProbe', query: { where: [{ field: 'runId', op: '==', value: runId }] } }) })
  const rows = (list.body?.data as { id?: string }[] | undefined) ?? []
  record('db: POST /api/db/list filtered → contains probe', list.status === 200 && rows.some((r) => r.id === runId), `status=${list.status} rows=${rows.length}`)

  const update = await api('/db/mutate', {
    method: 'POST',
    body: JSON.stringify({ payload: { op: 'update', path: probePath, entityType: 'smokeProbe', expectedRev: rev1, data: { name: 'live-smoke probe v2' } } }),
  })
  const rev2 = Number(update.body?.rev ?? 0)
  record('db: mutate update with expectedRev → rev bumps', update.status === 200 && rev2 === rev1 + 1, `status=${update.status} rev=${rev1}→${rev2}`)

  const stale = await api('/db/mutate', {
    method: 'POST',
    body: JSON.stringify({ payload: { op: 'update', path: probePath, entityType: 'smokeProbe', expectedRev: rev1, data: { name: 'stale write' } } }),
  })
  record('db: stale expectedRev rejected → 409 conflict', stale.status === 409, `status=${stale.status}`)
}

section('role gates')
{
  const noAuth = await api('/db/mutate', { method: 'POST', body: JSON.stringify({ payload: { op: 'update', path: probePath, entityType: 'smokeProbe', data: { name: 'x' } } }) }, null)
  record('role: unauthenticated mutate → 401', noAuth.status === 401, `status=${noAuth.status}`)

  if (JWT_VIEWER) {
    const vWrite = await api('/db/mutate', { method: 'POST', body: JSON.stringify({ payload: { op: 'update', path: probePath, entityType: 'smokeProbe', data: { name: 'x' } } }) }, JWT_VIEWER)
    record('role: VIEWER mutate → 403 (write floor is EDITOR+)', vWrite.status === 403, `status=${vWrite.status}`)
    const vRead = await api(`/db/get?path=${encodeURIComponent(probePath)}`, {}, JWT_VIEWER)
    record('role: VIEWER read → 200 (read floor)', vRead.status === 200, `status=${vRead.status}`)
  } else {
    record('role: VIEWER 403 probe', true, 'SKIPPED — set PF_JWT_VIEWER to enable')
  }
}

section('tenant isolation')
{
  if (JWT_TENANT_B) {
    const meA = await api('/auth/me')
    const meB = await api('/auth/me', {}, JWT_TENANT_B)
    const tidA = (meA.body?.user as { tenantId?: string })?.tenantId
    const tidB = (meB.body?.user as { tenantId?: string })?.tenantId
    record('tenant: A and B tokens resolve to different tenants', !!tidA && !!tidB && tidA !== tidB, `A=${tidA} B=${tidB}`)
    const crossGet = await api(`/db/get?path=${encodeURIComponent(probePath)}`, {}, JWT_TENANT_B)
    record('tenant: B cannot read A\'s entity (data:null)', crossGet.status === 200 && crossGet.body?.data === null, `status=${crossGet.status} data=${JSON.stringify(crossGet.body?.data)?.slice(0, 40)}`)
    const crossList = await api('/db/list', { method: 'POST', body: JSON.stringify({ path: 'smokeProbe', query: { where: [{ field: 'runId', op: '==', value: runId }] } }) }, JWT_TENANT_B)
    const crossRows = (crossList.body?.data as unknown[] | undefined) ?? []
    record('tenant: B list of A\'s collection → empty', crossList.status === 200 && crossRows.length === 0, `rows=${crossRows.length}`)
  } else {
    record('tenant: cross-tenant read probe', true, 'SKIPPED — set PF_JWT_TENANT_B to enable')
  }
}

section('ai: SSE chat + extraction handler')
{
  const chat = await sseProbe('/ai/chat', { messages: [{ role: 'user', content: 'In one sentence: which lines of business are in the portfolio? Cite refIds.' }] })
  record('ai: POST /api/ai/chat → SSE opens (text/event-stream)', chat.status === 200 && chat.ctype.includes('text/event-stream'), `status=${chat.status} ctype=${chat.ctype}`)
  record('ai: chat stream yields data events', chat.streamed, `events=${chat.events.length}${'error' in chat && chat.error ? ` err=${chat.error}` : ''}`)

  const idf = await api('/ai/identifyBaseForm', {
    method: 'POST',
    body: JSON.stringify({ formText: 'HOMEOWNERS 3 — SPECIAL FORM HO 00 03 05 11 Homeowners Policy special form provisions apply as printed.', fileName: 'smoke.txt' }),
  })
  record('ai: POST /api/ai/identifyBaseForm extracts form number', idf.status === 200 && idf.body?.formNumber === 'HO 00 03', `status=${idf.status} formNumber=${idf.body?.formNumber}`)
}

section('storage / serff / filing / homecheck')
{
  const stNo = await api('/storage/url?path=smoke.txt', {}, null)
  record('storage: GET /api/storage/url without token → 401', stNo.status === 401, `status=${stNo.status}`)
  const st = await api('/storage/url?path=smoke.txt')
  record('storage: GET /api/storage/url authed → mounted (200 or 503 unconfigured)', st.status === 200 || st.status === 503, `status=${st.status}`)

  const serff = await api('/serff/v1/states')
  record('serff: GET /api/serff/v1/states → 200 {states}', serff.status === 200 && !!serff.body?.states, `status=${serff.status}`)

  const filing = await api('/filing')
  record('filing: GET /api/filing → 200 {filings: []}', filing.status === 200 && Array.isArray(filing.body?.filings), `status=${filing.status}`)

  const hc = await api('/homecheck/v1/risk', { method: 'POST', body: JSON.stringify({}) }, null)
  record('homecheck: POST risk without address → 400 (mounted + validating)', hc.status === 400, `status=${hc.status}`)
}

section('duckcreek: removed surface must be 404')
{
  const gen = await api('/duckcreek/v1/author/generate', { method: 'POST', body: JSON.stringify({}) })
  const val = await api('/duckcreek/v1/author/validate', { method: 'POST', body: JSON.stringify({}) })
  const dl = await api('/duckcreek/v1/author/bundle/x/download')
  record('duckcreek: /api/duckcreek/v1/author/* all 404', gen.status === 404 && val.status === 404 && dl.status === 404, `generate=${gen.status} validate=${val.status} download=${dl.status}`)
}

section('cleanup')
{
  const del = await api('/db/mutate', { method: 'POST', body: JSON.stringify({ payload: { op: 'delete', path: probePath, entityType: 'smokeProbe' } }) })
  record('cleanup: probe entity deleted', del.status === 200 && del.body?.ok === true, `status=${del.status}`)
}

// ─── report ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass)
const width = Math.max(...results.map((r) => r.name.length))
console.log('\n═══ live-smoke results ═══')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`)
console.log(`\n${results.length - failed.length}/${results.length} passed — ${failed.length === 0 ? 'LIVE SMOKE GREEN' : 'LIVE SMOKE RED'}`)
process.exit(failed.length === 0 ? 0 : 1)
