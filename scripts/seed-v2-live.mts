// scripts/seed-v2-live.mts — live end-to-end proof for Task Seeding v2 against the deployed
// /api host, in an ISOLATED tenant (never testco). Task seeding is client-side (the plan is
// computed in the browser and written through the generic atomic mutate envelope), so the
// server surface to prove is: the new lineage fields (seedRefId, seedBatchId, productId,
// projectId) round-trip through /api/db/mutateBatch + /api/db/list intact, the schedule is
// forward-only, re-seed is ADDITIVE + idempotent (only missing rows created, existing ones
// preserved, deterministic ids → no duplicates), a moved deadline persists, and another
// tenant can't see any of it.
//
// Uses the REAL forward-only planner (shared/src/gtm/plan) + the frozen 65-row process
// fixture, so the payloads are exactly what the UI produces.
//
// Usage:  $env:PF_BASE_URL="https://app-prodhub-dev.azurewebsites.net"; pnpm tsx scripts/seed-v2-live.mts
import { writeFileSync } from 'node:fs'
import { planLaunch, seedRefIdFor, type PlannedTask } from '../shared/src/gtm/plan'
import { GTM_PROCESS_TEMPLATE } from '../shared/src/seed/gtmProcess'

const BASE = (process.env.PF_BASE_URL || 'https://app-prodhub-dev.azurewebsites.net').replace(/\/$/, '')
const TENANT = 'seed-v2-live'
const TENANT_B = 'seed-v2-live-b'
const RUN = Date.now().toString(36)
const PRODUCT_ID = `SV2.PROD.${RUN}`
const PROJECT_ID = `project-sv2-${RUN}`

type Check = { name: string; pass: boolean; detail: string }
const results: Check[] = []
const artifacts: Record<string, unknown> = {}
function record(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api(path: string, init: RequestInit = {}, token: string | null = null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers })
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
async function apiRetry(path: string, init: RequestInit, token: string | null, tries = 4) {
  let last: { status: number; body: any } = { status: 0, body: null }
  for (let i = 0; i < tries; i++) {
    try { last = await api(path, init, token); if (last.status !== 0 && last.status !== 502 && last.status !== 503) return last }
    catch (e) { last = { status: 0, body: String(e) } }
    if (i < tries - 1) await new Promise(r => setTimeout(r, 15_000))
  }
  return last
}
const mutate = (token: string, payload: Record<string, unknown>) =>
  apiRetry('/db/mutate', { method: 'POST', body: JSON.stringify({ payload }) }, token)
const mutateBatch = (token: string, payloads: Record<string, unknown>[]) =>
  apiRetry('/db/mutateBatch', { method: 'POST', body: JSON.stringify({ payloads }) }, token)
async function listTasks(token: string, projectId: string) {
  const r = await apiRetry('/db/list', { method: 'POST', body: JSON.stringify({ path: 'tasks', query: { where: [{ field: 'projectId', op: '==', value: projectId }] } }) }, token)
  return { status: r.status, rows: (r.body?.data as any[]) ?? [] }
}

// ── The exact client payload shaping (mirrors app gtm.ts taskDataFromPlanned/buildSeedPlanPayloads) ──
const BOARD_TO_COLUMN: Record<string, string> = {
  'IDEATION & DESIGN': 'IDEATION', 'BUILD & FILE': 'BUILD_FILE', 'TEST & APPROVE': 'TEST_APPROVE', 'LAUNCH & MONITOR': 'LAUNCH_MONITOR',
}
function taskData(p: PlannedTask, seedBatchId: string) {
  return {
    title: p.taskL4, column: BOARD_TO_COLUMN[p.boardColumn], projectId: PROJECT_ID, productId: PRODUCT_ID,
    origin: 'seeded', seedRefId: p.seedRefId, seedBatchId, phaseL2: p.phaseL2, groupL3: p.groupL3, taskL4: p.taskL4,
    phaseOrder: p.phaseOrder, slaDays: p.effectiveSla, ownerRole: p.owner, typeOfWork: p.typeOfWork || null,
    valueOfWork: p.valueOfWork || null, disposition: p.disposition || null, ongoing: p.ongoing,
    startDate: p.startDate, dueAt: p.dueDate, order: p.globalOrder, assignee: null, checklist: [], done: false, completedAt: null,
  }
}
const createPayload = (p: PlannedTask, seedBatchId: string) =>
  ({ op: 'create', path: `tasks/gtm-${PROJECT_ID}-${p.seedRefId}`, entityType: 'task', productId: PRODUCT_ID, data: taskData(p, seedBatchId) })

// Compute the additive create-set for a selection given what's already on the board (by seedRefId).
function planFor(selected: Set<string>, present: Set<string>, deadline: string, today: string) {
  const subset = GTM_PROCESS_TEMPLATE.filter(t => { const id = seedRefIdFor(t); return selected.has(id) || present.has(id) })
  const plan = planLaunch(subset, deadline, { today })
  const toCreate = plan.tasks.filter(t => !present.has(t.seedRefId))
  return { plan, toCreate }
}
const allIds = () => new Set(GTM_PROCESS_TEMPLATE.map(seedRefIdFor))
const researchIds = () => new Set(GTM_PROCESS_TEMPLATE.filter(t => t.phaseL2 === 'Product Research').map(seedRefIdFor))
const todayISO = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` }

async function main() {
  console.log(`seed-v2-live: ${BASE} tenant=${TENANT} run=${RUN}`)
  const today = todayISO()
  const deadline = '2028-06-30'          // far out → the plan fits
  const newDeadline = '2028-09-29'

  // ── Login (SUPER_ADMIN bootstrap, scoped to the isolated tenant) ──
  const login = await apiRetry('/auth/bootstrap', { method: 'POST', body: JSON.stringify({ username: 'sal', password: 'scrudato', tenant: TENANT }) }, null)
  if (login.status !== 200 || !login.body?.token) { console.error(`bootstrap login failed: ${login.status} ${JSON.stringify(login.body).slice(0, 200)}`); process.exit(2) }
  const jwt = login.body.token as string
  record('bootstrap login (isolated tenant)', true, `tenant=${login.body.user?.tenantId}`)

  // ── Seed a Product + linked Project (productId/projectId lineage source) ──
  const prod = await mutate(jwt, { op: 'create', path: `products/${PRODUCT_ID}`, entityType: 'product', data: { refId: PRODUCT_ID, name: 'Seed v2 Live Product', lob: 'GL', lifecycle: 'ACTIVE', states: ['NJ'] } })
  const proj = await mutate(jwt, { op: 'create', path: `projects/${PROJECT_ID}`, entityType: 'project', data: { refId: `PRJ.${RUN}`, name: 'Seed v2 Live Launch', description: 'live seeding proof', productId: PRODUCT_ID, targetLaunchDate: deadline, status: 'planning', owner: { uid: 'admin', name: 'Admin' } } })
  record('seed product + linked project', prod.status === 200 && proj.status === 200, `${prod.status}/${proj.status}`)

  // ══ ROUND 1 — seed ONLY the Product Research phase ══
  const r1 = planFor(researchIds(), new Set(), deadline, today)
  const batch1 = `b1-${RUN}`
  const seed1 = await mutateBatch(jwt, r1.toCreate.map(p => createPayload(p, batch1)))
  record('round 1: seed Research phase via mutateBatch', seed1.status === 200 && seed1.body?.ok === true, `status=${seed1.status} created=${r1.toCreate.length}`)

  const read1 = await listTasks(jwt, PROJECT_ID)
  const n1 = read1.rows.length
  record('round 1: tasks persisted + readable', read1.status === 200 && n1 === r1.toCreate.length && n1 > 0, `rows=${n1} expected=${r1.toCreate.length}`)

  // Lineage fields survived the envelope on every task.
  const lineageOk = read1.rows.every(t => /^pm-[0-9a-f]{8}$/.test(t.seedRefId) && t.seedBatchId === batch1 && t.projectId === PROJECT_ID && t.productId === PRODUCT_ID && t.origin === 'seeded')
  record('round 1: every task carries seedRefId + seedBatchId + projectId + productId', lineageOk,
    lineageOk ? 'all fields present' : `sample=${JSON.stringify({ seedRefId: read1.rows[0]?.seedRefId, seedBatchId: read1.rows[0]?.seedBatchId, projectId: read1.rows[0]?.projectId, productId: read1.rows[0]?.productId })}`)

  // Forward-only: no pre-launch task starts on/before today.
  const pre1 = read1.rows.filter(t => (t.phaseOrder ?? 0) <= 4 && t.startDate)
  const forwardOnly = pre1.length > 0 && pre1.every(t => t.startDate > today)
  record('round 1: forward-only — no start ≤ today', forwardOnly, `minStart=${pre1.map(t => t.startDate).sort()[0]} today=${today}`)

  // ══ ROUND 2 — idempotent, additive re-seed of EVERYTHING (present = round 1) + moved deadline ══
  const present2 = new Set(read1.rows.map(t => t.seedRefId as string))
  const r2 = planFor(allIds(), present2, newDeadline, today)
  const batch2 = `b2-${RUN}`
  // Prepend the rev-guarded deadline update (as buildSeedPlanPayloads does when the PM moved it).
  const projRead = await api(`/db/get?path=${encodeURIComponent(`projects/${PROJECT_ID}`)}`, {}, jwt)
  const projRev = Number((projRead.body?.data as any)?.rev ?? 0)
  const payloads2 = [
    { op: 'update', path: `projects/${PROJECT_ID}`, entityType: 'project', expectedRev: projRev, data: { targetLaunchDate: newDeadline } },
    ...r2.toCreate.map(p => createPayload(p, batch2)),
  ]
  const seed2 = await mutateBatch(jwt, payloads2)
  record('round 2: additive re-seed (all) + deadline move via one batch', seed2.status === 200 && seed2.body?.ok === true, `status=${seed2.status} newlyAdded=${r2.toCreate.length}`)
  record('round 2: proposed only the missing rows', r2.toCreate.length === GTM_PROCESS_TEMPLATE.length - n1, `toCreate=${r2.toCreate.length} = 65 - ${n1}`)

  const read2 = await listTasks(jwt, PROJECT_ID)
  const n2 = read2.rows.length
  record('round 2: board now holds the full 65, no duplicates', n2 === GTM_PROCESS_TEMPLATE.length && new Set(read2.rows.map(t => t.seedRefId)).size === n2, `rows=${n2} uniqueSeedRefIds=${new Set(read2.rows.map(t => t.seedRefId)).size}`)

  // Idempotency: round-1 tasks were PRESERVED (still batch1), not deleted/recreated.
  const preservedR1 = read2.rows.filter(t => t.seedBatchId === batch1).length
  const addedR2 = read2.rows.filter(t => t.seedBatchId === batch2).length
  record('round 2: existing tasks preserved (batch1 kept), only new ones added (batch2)', preservedR1 === n1 && addedR2 === r2.toCreate.length, `batch1=${preservedR1} batch2=${addedR2}`)

  // Moved deadline persisted.
  const projRead2 = await api(`/db/get?path=${encodeURIComponent(`projects/${PROJECT_ID}`)}`, {}, jwt)
  record('round 2: moved deadline persisted on the project', (projRead2.body?.data as any)?.targetLaunchDate === newDeadline, `targetLaunchDate=${(projRead2.body?.data as any)?.targetLaunchDate}`)

  artifacts.round1 = { created: n1, sample: read1.rows[0] }
  artifacts.round2 = { total: n2, added: addedR2, preserved: preservedR1 }

  // ══ Tenant isolation — another tenant sees none of it ══
  const loginB = await apiRetry('/auth/bootstrap', { method: 'POST', body: JSON.stringify({ username: 'sal', password: 'scrudato', tenant: TENANT_B }) }, null)
  if (loginB.status === 200 && loginB.body?.token) {
    const readB = await listTasks(loginB.body.token as string, PROJECT_ID)
    record('tenant isolation: tenant B sees 0 of these tasks', readB.status === 200 && readB.rows.length === 0, `rowsB=${readB.rows.length}`)
  } else record('tenant isolation', false, `login B failed ${loginB.status}`)

  // ══ Cleanup — delete everything created in the isolated tenant ══
  const finalRows = (await listTasks(jwt, PROJECT_ID)).rows
  const dels = await mutateBatch(jwt, [
    ...finalRows.map(t => ({ op: 'delete', path: `tasks/${t.id}`, entityType: 'task' })),
    { op: 'delete', path: `projects/${PROJECT_ID}`, entityType: 'project' },
    { op: 'delete', path: `products/${PRODUCT_ID}`, entityType: 'product' },
  ])
  const after = (await listTasks(jwt, PROJECT_ID)).rows.length
  record('cleanup: created entities removed', dels.status === 200 && after === 0, `delStatus=${dels.status} remaining=${after}`)

  // ── report ──
  const failed = results.filter(r => !r.pass)
  writeFileSync('docs/audit/seed_v2_live_results.json', JSON.stringify({ base: BASE, tenant: TENANT, run: RUN, at: new Date().toISOString(), results, artifacts }, null, 2))
  console.log('\n═══ seed-v2-live results ═══')
  const width = Math.max(...results.map(r => r.name.length))
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`)
  console.log(`\n${results.length - failed.length}/${results.length} passed — ${failed.length === 0 ? 'SEED-V2 LIVE GREEN' : 'SEED-V2 LIVE RED'}`)
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
