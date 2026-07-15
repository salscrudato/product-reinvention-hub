'use strict'
// server/lib/export-duckcreek.js — Duck Creek Author XML export (P3, XE-01..06/08).
// Mounted at /api/export in server.js.
//
//   POST /api/export/duckcreek { productId } — assemble the product bundle from
//     Cosmos, emit the ManuScript OVERLAY + Unity CoverageConfig/TableConfig pair
//     + export-manifest.json, gate on the 17-row gap report (MISSING blocks) and
//     the OVERLAY-DELTA LINT (hard gate), write an audited export-run record
//     through the standard mutate envelope, and — on the FIRST successful export
//     for the tenant — flip the page.dictionary tenant override (XE-08).
//
// Auth: EDITOR+ (product:write) — exporting is a write-class action (it flips a
// tenant flag and writes a run record); the global non-GET floor in server.js
// also enforces this. The heavy lifting lives in export-duckcreek-shared.cjs
// (built from shared/src/export/duckcreek by `pnpm build:export`).

const express = require('express')
const ExcelJS = require('exceljs')
const { requireTenant } = require('./auth')
const { requireCapability } = require('./authz')
const { mutateInternal } = require('./data')

const router = express.Router()

let dc = null
try {
  dc = require('./export-duckcreek-shared.cjs')
} catch {
  console.warn('[export-duckcreek] export-duckcreek-shared.cjs not found — run `pnpm build:export`. Endpoint will return 503.')
}

// ─── Cosmos tenant-store seam (same shape as serff.js/data.js) ────────────────
function cosmos(tenantId) {
  return require('./cosmos').resolveTenantStore(tenantId).docs
}

const idFor = (prefix, key) => `${prefix}:${String(key).replace(/[/\\?#]/g, '~')}`
const pkFor = (tid, base) => `${tid}|${base}`

async function readColl(tenantId, productId, coll) {
  const { resources } = await cosmos(tenantId).items.query({
    query: "SELECT c.data FROM c WHERE c.kind='entity' AND c.coll=@coll AND c.tenantId=@tid",
    parameters: [
      { name: '@coll', value: `products/${productId}/${coll}` },
      { name: '@tid', value: tenantId },
    ],
  }, { maxItemCount: 500 }).fetchAll()
  return resources.map(r => r.data)
}

async function readEntity(tenantId, path) {
  const base = path.split('/').filter(Boolean)[0] === 'products' ? path.split('/')[1] : path.split('/')[0]
  try {
    const r = (await cosmos(tenantId).item(idFor('ent', path), pkFor(tenantId, base)).read()).resource
    return r?.tenantId === tenantId ? r.data : null
  } catch { return null }
}

async function readFormsForProduct(tenantId, productId) {
  const { resources } = await cosmos(tenantId).items.query({
    query: "SELECT c.data FROM c WHERE c.kind='entity' AND c.coll='forms' AND c.tenantId=@tid AND ARRAY_CONTAINS(c.data.productRefIds, @pid)",
    parameters: [
      { name: '@tid', value: tenantId },
      { name: '@pid', value: productId },
    ],
  }, { maxItemCount: 500 }).fetchAll()
  return resources.map(r => r.data)
}

// ─── Input assembly (readers injected for testability) ────────────────────────

/**
 * Assemble the ExportInput shape from the canonical store. `readers` mirrors the
 * Cosmos helpers above so tests can inject an in-memory store (_internals).
 */
async function assembleExportInput(readers, tid, productId, { tenantName, now }) {
  const product = await readers.readEntity(tid, `products/${productId}`)
  if (!product) return null
  const [coverages, rules, formRules, ratingPrograms] = await Promise.all([
    readers.readColl(tid, productId, 'coverages'),
    readers.readColl(tid, productId, 'rules'),
    readers.readColl(tid, productId, 'formRules'),
    readers.readColl(tid, productId, 'ratingPrograms'),
  ])
  const forms = await readers.readFormsForProduct(tid, productId)
  const ratingProgram = ratingPrograms[0] ?? null

  // Referenced tables only — rt from rating steps, ld from term/rule references.
  const rtRefs = [...new Set((ratingProgram?.steps ?? [])
    .filter(s => s.source && s.source.type === 'RT' && s.source.ref)
    .map(s => s.source.ref))].sort()
  const ldRefs = [...new Set([
    ...coverages.flatMap(c => (c.terms ?? []).map(t => t.ldTableRef).filter(Boolean)),
    ...rules.map(r => r.ldTableRef).filter(Boolean),
  ])].sort()
  const rtTables = {}
  for (const ref of rtRefs) {
    const t = await readers.readEntity(tid, `rtTables/${ref}`)
    if (t) rtTables[ref] = t
  }
  const ldTables = {}
  for (const ref of ldRefs) {
    const t = await readers.readEntity(tid, `ldTables/${ref}`)
    if (t) ldTables[ref] = t
  }

  const lobPrefix = String(product.refId || productId).split('.')[0]
  return {
    tenantName,
    product,
    coverages,
    forms,
    rules,
    formRules,
    ratingProgram,
    ldTables,
    rtTables,
    ratingInputSpec: dc ? dc.resolveExportRatingInputSpec(lobPrefix) : [],
    now,
  }
}

// ─── Workbook serialization ───────────────────────────────────────────────────

async function toXlsxBase64(model) {
  const wb = new ExcelJS.Workbook()
  for (const s of model.sheets) {
    const ws = wb.addWorksheet(s.name)
    for (const [rn, row] of s.rows) {
      for (const [cn, v] of row) ws.getCell(rn, cn).value = v
    }
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf).toString('base64')
}

// ─── The export flow (deps injected for testability) ─────────────────────────

async function runDuckCreekExport(deps, tid, actor, input) {
  const bundle = deps.buildExportBundle(input)

  if (bundle.blocked) {
    // MISSING blocks (flagged-not-dropped) — and a lint FAIL is never delivered.
    // No run record write, no flag flip: a blocked export leaves no success state.
    // HTTP 200 with ok:false — a blocked export is a normal, reportable outcome
    // (the gap list IS the result), same shape discipline as the brief's
    // per-block statuses.
    return {
      status: 200,
      body: {
        ok: false,
        blocked: true,
        error: bundle.lint && !bundle.lint.ok ? 'overlay_lint_failed' : 'export_blocked_missing_fields',
        gapReport: bundle.gapReport,
        ...(bundle.lint ? { lint: bundle.lint } : {}),
      },
    }
  }

  const exportId = `dc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const [coverageConfigXlsxB64, tableConfigXlsxB64] = await Promise.all([
    deps.toXlsxBase64(bundle.coverageConfig),
    deps.toXlsxBase64(bundle.tableConfig),
  ])

  // Audited export-run record through the standard envelope (atomic entity +
  // audit + version + searchIndex batch). Carries the P4 provenance envelope on
  // the export lineage: deterministic, human-triggered, fully cited.
  await deps.mutateInternal(tid, {
    op: 'create',
    path: `exports/${exportId}`,
    entityType: 'exportRun',
    data: {
      kind: 'duckcreek-authorxml',
      productId: bundle.manifest.product.refId,
      productName: bundle.manifest.product.name,
      manuscriptID: bundle.manifest.manuscriptID,
      base: bundle.manifest.base,
      gapCounts: bundle.gapReport.counts,
      hitlCount: bundle.manifest.hitl.length,
      lintOk: bundle.lint.ok,
      lintWarnings: bundle.lint.findings.filter(f => f.level === 'WARN').length,
      tables: bundle.manifest.tables.map(t => t.tableName),
      provenance: bundle.manifest.provenance,
      generatedAt: bundle.manifest.generatedAt,
    },
  }, actor, '/api/export/duckcreek')

  // XE-08: first SUCCESSFUL export for the tenant reveals the Data Dictionary.
  let dictionaryRevealed = false
  try {
    dictionaryRevealed = await deps.flipDictionaryFlag(tid, actor)
  } catch (err) {
    // The export itself succeeded — surface the flip failure honestly, never mask it.
    console.warn('[export-duckcreek] page.dictionary flip failed:', err.message)
  }

  return {
    status: 200,
    body: {
      ok: true,
      exportId,
      blocked: false,
      gapReport: bundle.gapReport,
      lint: bundle.lint,
      dictionaryRevealed,
      artifacts: {
        overlayFileName: bundle.overlayFileName,
        overlayXml: bundle.overlayXml,
        coverageConfigXlsxB64,
        tableConfigXlsxB64,
        manifest: bundle.manifest,
      },
    },
  }
}

/**
 * XE-08 (X5): server-side tenant override {'page.dictionary': true} via the F5
 * platform-config write (audited; CONTRACTS: Cosmos tenant doc data.config.flags,
 * served on GET /api/auth/me as user.flags). Flips only when not already true —
 * and ONLY callers of runDuckCreekExport's success path reach here.
 */
async function flipDictionaryFlag(tid, actor) {
  const pc = require('./platform-config')
  const flags = await pc.getEffectiveFlags(tid)
  if (flags['page.dictionary'] === true) return false
  await pc.setTenantConfig(tid, { flags: { 'page.dictionary': true } }, 'tenant', actor)
  return true
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post('/duckcreek', requireCapability('product:write'), requireTenant, async (req, res) => {
  if (!dc) return res.status(503).json({ error: 'export_module_unavailable', detail: 'run pnpm build:export' })
  const productId = String((req.body || {}).productId || '').trim()
  if (!productId) return res.status(400).json({ error: 'productId required' })
  const tid = req.user.tenantId
  try {
    const input = await assembleExportInput(
      { readColl, readEntity, readFormsForProduct },
      tid, productId,
      { tenantName: tid, now: new Date() },
    )
    if (!input) return res.status(404).json({ error: 'product_not_found', productId })
    const actor = { uid: req.user.uid, name: req.user.name || req.user.uid }
    const result = await runDuckCreekExport(
      { buildExportBundle: dc.buildExportBundle, toXlsxBase64, mutateInternal, flipDictionaryFlag },
      tid, actor, input,
    )
    return res.status(result.status).json(result.body)
  } catch (err) {
    console.error('[export-duckcreek] export failed:', err)
    return res.status(500).json({ error: 'export_failed', detail: err.message })
  }
})

module.exports = Object.assign(router, {
  _internals: { assembleExportInput, runDuckCreekExport, flipDictionaryFlag, toXlsxBase64 },
})
