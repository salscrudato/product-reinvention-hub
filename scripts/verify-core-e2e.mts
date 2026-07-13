#!/usr/bin/env tsx
// verify-core-e2e.mts — full-scale end-to-end import of the real CORE workbook
// against the LIVE dev server. Parses CORE with the real mapIsoWorkbook, then
// replicates importProduct.ts (product -> wave-batched coverages -> free-batched
// forms/rules/tables), reads the collections back, and asserts every entity landed.
//
// Usage: BASE_URL=... IMPORT_TENANT=testco tsx scripts/verify-core-e2e.mts [file.xlsx]

import ExcelJS from 'exceljs'
import { mapIsoWorkbook } from '@pf/shared'
import type { IsoCell, IsoGrid, ImportPlan, PlannedEntity } from '@pf/shared'
import { resolve } from 'path'

const BASE = (process.env.BASE_URL || 'https://app-prodhub-dev.azurewebsites.net').replace(/\/$/, '')
const TENANT = process.env.IMPORT_TENANT || 'testco'
const FILE = process.argv[2] || 'samples/iso/Product_Specifications_Core_07_13_2026.xlsx'
const PID = `verify-core-${Date.now()}`
const BATCH_SIZE = 50
const actor = { uid: 'verify-core', name: 'Verify Core' }

function flatten(v: ExcelJS.CellValue): IsoCell {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if (Array.isArray(o['richText'])) return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
    if ('result' in o) { const r = o['result']; return typeof r === 'object' ? null : (r as IsoCell) }
    if ('hyperlink' in o) return String(o['text'] ?? o['hyperlink'] ?? '')
    if ('text' in o) return String(o['text'])
  }
  return null
}
async function read(path: string): Promise<IsoGrid[]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path)
  const grids: IsoGrid[] = []
  wb.eachSheet(ws => {
    const cells: IsoCell[][] = []
    const limit = Math.min(ws.rowCount, 100_000)
    for (let r = 1; r <= limit; r++) {
      const row = ws.getRow(r); const arr: IsoCell[] = []
      for (let c = 1; c <= ws.columnCount; c++) arr[c - 1] = flatten(row.getCell(c).value)
      cells[r - 1] = arr
    }
    grids.push({ sheet: ws.name, file: path, cells })
  })
  return grids
}

async function api(path: string, body: unknown, token?: string) {
  const r = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  let j: any = null; try { j = await r.json() } catch { /* empty */ }
  return { status: r.status, ok: r.ok, body: j }
}
async function listColl(coll: string, token: string): Promise<any[]> {
  const r = await fetch(`${BASE}/api/db/list`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path: coll, query: { limit: 5000 } }),
  })
  if (!r.ok) return []
  try { const j = await r.json(); return Array.isArray(j?.data) ? j.data : [] } catch { return [] }
}

const GROUPS: Record<string, { entityType: string; path: (id: string) => string; underProduct: boolean }> = {
  coverage:      { entityType: 'coverage',      underProduct: true,  path: (id) => `products/${PID}/coverages/${id}` },
  form:          { entityType: 'form',          underProduct: false, path: (id) => `forms/${PID}__${id}` },
  rule:          { entityType: 'rule',          underProduct: true,  path: (id) => `products/${PID}/rules/${id}` },
  formRule:      { entityType: 'formRule',      underProduct: true,  path: (id) => `products/${PID}/formRules/${id}` },
  ratingProgram: { entityType: 'ratingProgram', underProduct: true,  path: (id) => `products/${PID}/ratingPrograms/${id}` },
  ldTable:       { entityType: 'ldTable',       underProduct: false, path: (id) => `ldTables/${id}` },
  rtTable:       { entityType: 'rtTable',       underProduct: false, path: (id) => `rtTables/${id}` },
}
function toPayload(kind: string, e: PlannedEntity) {
  const g = GROUPS[kind]
  const data = kind === 'form' ? { ...e.data, productRefIds: [PID] }
    : (kind === 'ldTable' || kind === 'rtTable') ? { ...e.data, productId: PID } : e.data
  return { op: 'create', path: g.path(e.docId), entityType: g.entityType, ...(g.underProduct ? { productId: PID } : {}), actor, data }
}

async function main() {
  const plan: ImportPlan = mapIsoWorkbook(await read(resolve(process.cwd(), FILE)))
  console.log(`parsed: product=${plan.product?.refId} coverages=${plan.coverages.length} forms=${plan.forms.length} rules=${plan.rules.length} ld=${plan.ldTables.length} rt=${plan.rtTables.length}`)

  const login = await api('/auth/bootstrap', { username: 'admin', password: 'admin', tenant: TENANT })
  if (!login.ok || !login.body?.token) { console.error('AUTH FAILED', login.status); process.exit(2) }
  const token = login.body.token
  console.log(`auth ok, pid=${PID}`)

  // Product
  const prod = await api('/db/mutate', { payload: { op: 'create', path: `products/${PID}`, entityType: 'product', productId: PID, actor, data: { ...plan.product!.data, owner: actor } } }, token)
  if (!prod.ok) { console.error('PRODUCT FAILED', prod.status, prod.body); process.exit(1) }

  let written = 0, failed = 0
  const errors: string[] = []
  const flush = async (batch: any[]) => {
    if (!batch.length) return
    const res = await api('/db/mutateBatch', { payloads: batch }, token)
    if (res.ok) written += batch.length
    else { failed += batch.length; errors.push(`${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`) }
  }

  // Coverages — wave batching
  {
    let batch: any[] = []; let pending = new Set<string>()
    for (const e of plan.coverages) {
      const parentId = (e.data as { parentId?: string | null }).parentId
      if ((parentId != null && pending.has(String(parentId))) || batch.length >= BATCH_SIZE) { await flush(batch); batch = []; pending = new Set() }
      batch.push(toPayload('coverage', e)); if (e.refId) pending.add(e.refId)
    }
    await flush(batch)
  }
  // Free groups
  const free: [string, PlannedEntity[]][] = [
    ['ldTable', plan.ldTables], ['rtTable', plan.rtTables], ['form', plan.forms],
    ['rule', plan.rules], ['formRule', plan.formRules], ['ratingProgram', plan.ratingProgram ? [plan.ratingProgram] : []],
  ]
  const q: any[] = []
  for (const [kind, ents] of free) for (const e of ents) q.push(toPayload(kind, e))
  for (let i = 0; i < q.length; i += BATCH_SIZE) await flush(q.slice(i, i + BATCH_SIZE))

  console.log(`writes: written=${written} failed=${failed}`)
  errors.slice(0, 5).forEach(e => console.log(`  ERR ${e}`))

  // Readback: coverages (hierarchy) + rules + forms
  const covs = await listColl(`products/${PID}/coverages`, token)
  const subs = covs.filter(c => c.parentId).length
  const orphanSubs = covs.filter(c => c.parentId && !covs.some(p => p.refId === c.parentId)).length
  console.log(`readback coverages: ${covs.length}/${plan.coverages.length} (subs=${subs}, orphan-subs=${orphanSubs})`)
  const rulesBack = await listColl(`products/${PID}/rules`, token)
  console.log(`readback rules: ${rulesBack.length}/${plan.rules.length}`)
  const formsBack = (await listColl('forms', token)).filter((f: { productRefIds?: string[] }) => (f.productRefIds ?? []).includes(PID))
  console.log(`readback forms: ${formsBack.length}/${plan.forms.length} (list cap-aware)`)

  // Teardown (best-effort): delete every entity we wrote, then the product.
  for (const e of plan.coverages) await api('/db/mutate', { payload: { op: 'delete', path: `products/${PID}/coverages/${e.docId}`, entityType: 'coverage', actor } }, token).catch(() => {})
  for (const e of plan.rules)     await api('/db/mutate', { payload: { op: 'delete', path: `products/${PID}/rules/${e.docId}`, entityType: 'rule', actor } }, token).catch(() => {})
  for (const e of plan.forms)     await api('/db/mutate', { payload: { op: 'delete', path: `forms/${PID}__${e.docId}`, entityType: 'form', actor } }, token).catch(() => {})
  await api('/db/mutate', { payload: { op: 'delete', path: `products/${PID}`, entityType: 'product', actor } }, token).catch(() => {})
  console.log('teardown done (coverages + rules + forms + product)')

  // Rules count may fall short only if the /db/list cap is below plan.rules; coverages + rules
  // are the hierarchy/parent-sensitive writes we most need to confirm landed.
  const pass = failed === 0 && covs.length === plan.coverages.length && orphanSubs === 0 && rulesBack.length === plan.rules.length
  console.log(`\nPASS: ${pass}`)
  process.exit(pass ? 0 : 1)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
