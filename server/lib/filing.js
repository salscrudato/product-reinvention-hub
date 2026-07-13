'use strict'
// filing.js -- /api/filing/* : authority-gated regulatory filing generation.
//
// Five-step flow:
//   1. SCOPE   -- requireCapability('filing:generate') blocks VIEWER and all inquiry personas.
//                 Actor is always derived server-side from req.user; never accepted from client.
//   2. RESOLVE -- Reconstruct exact entity states at the as-of instant from real Cosmos version
//                 history. No live AI guessing of values; every field comes from a real version doc.
//   3. BUILD   -- Assemble a DETERMINISTIC package: sorted keys + sorted items → same inputs
//                 produce byte-identical JSON. SHA-256 contentHash per item; packageHash over all.
//   4. VERIFY  -- Independent extraction check via GROUNDED_CITED model (claude-opus-4-8).
//                 Separate AI call; verifier confirms every field value in the package is present
//                 verbatim in a cited source version. refIds and form numbers are verified
//                 character-for-character. ANY discrepancy → REJECT (not freeze); issues logged.
//   5. FREEZE  -- On clean verdict: write IMMUTABLE filing record (items.create only, never upsert).
//                 Append-only auditEvent carrying packageHash + verifier verdict. Create-only.
//
// The frozen record answers "what exactly did you file for this state on this date?" with no
// live re-query needed. Every field traces to a real versionId. No code path in this file
// updates a filing record after creation.
//
// GUARDRAILS:
//   - Model never invents coverages, forms, rules, limits, or factors.
//   - Every filed field traces to a real version doc (versionId in the record).
//   - refIds and form numbers are reproduced VERBATIM from version data.
//   - Filing record is CREATE-ONLY; there is no upsert/replace/update anywhere in this file.
//   - Actor is derived server-side from req.user; client cannot forge it.

const express = require('express')
const crypto  = require('crypto')

const { requireCapability }              = require('./authz')
const { requireTenant, resolveTenantForPrincipal } = require('./auth')
const fleet                              = require('./fleet')
const { fetchWithRetry }                 = require('./ai/_shared')

const router = express.Router()

// ─── Cosmos helpers ──────────────────────────────────────────────────────────
function cosmosFor(tenantId) {
  return require('./cosmos').resolveTenantStore(tenantId).docs
}

// Mirror the id/pk helpers from data.js so filing records share the same scheme.
const segs    = (p) => String(p || '').split('/').filter(Boolean)
const baseKey = (path) => { const s = segs(path); return (s[0] === 'products' && s[1]) ? s[1] : (s[0] || 'root') }
const pkFor   = (tid, base)  => `${tid}|${base}`
const idFor   = (prefix, key) => `${prefix}:${String(key).replace(/[/\\?#]/g, '~')}`
const auditId = () => `aud:${Date.now().toString(36)}-${crypto.randomUUID()}`

// ─── STEP 2: RESOLVE ─────────────────────────────────────────────────────────
// Reconstructs exact entity states at asOf from Cosmos version history.
// Algorithm:
//   a. Load ALL version records for the product partition (at <= asOf), sorted by rev.
//   b. Load searchIndex records for the same partition (for entityType lookup).
//   c. Group versions by entityPath; apply diffs in rev order to reconstruct state.
//   d. Exclude entities deleted at or before asOf (op='delete' in last in-scope version).
//   e. Exclude paths outside this product's subtree.
//
// Why version history and not current entity reads:
//   The current entity read gives the LATEST state, which may be newer than asOf.
//   Only version history lets us reconstruct the exact state at a specific point in time.
async function resolveProductAtAsOf(tenantId, productId, asOf) {
  const docs = cosmosFor(tenantId)
  const pk   = pkFor(tenantId, productId)

  // a. All version records for this product partition with at <= asOf.
  //    Versions share pk with their entity (same partition); cross-partition query not needed.
  const verSql = [
    "SELECT c.id, c.entityPath, c.rev, c.op, c.diff, c.at, c.actor",
    "FROM c",
    "WHERE c.kind = 'version'",
    "  AND c.tenantId = @tid",
    "  AND c.at <= @asOf",
  ].join(' ')
  const { resources: versions } = await docs.items.query(
    { query: verSql, parameters: [{ name: '@tid', value: tenantId }, { name: '@asOf', value: asOf }] },
    { partitionKey: pk, maxItemCount: 2000 },
  ).fetchAll()

  // b. searchIndex records for entityType (versions do not carry entityType).
  const idxSql = [
    "SELECT c.entityPath, c.entityType",
    "FROM c",
    "WHERE c.kind = 'searchIndex'",
    "  AND c.tenantId = @tid",
  ].join(' ')
  const { resources: idxItems } = await docs.items.query(
    { query: idxSql, parameters: [{ name: '@tid', value: tenantId }] },
    { partitionKey: pk, maxItemCount: 2000 },
  ).fetchAll()

  const entityTypeMap = {}
  for (const idx of idxItems) {
    if (idx.entityPath) entityTypeMap[idx.entityPath] = idx.entityType
  }

  // c. Group by entityPath, sort by rev, apply diffs.
  const byPath = new Map()
  const prodPrefix = `products/${productId}/`
  const prodExact  = `products/${productId}`
  for (const ver of versions) {
    const p = ver.entityPath
    if (!p) continue
    // d. Scope filter: only this product's subtree.
    if (p !== prodExact && !p.startsWith(prodPrefix)) continue
    if (!byPath.has(p)) byPath.set(p, [])
    byPath.get(p).push(ver)
  }

  const resolved = []
  for (const [entityPath, vers] of byPath) {
    vers.sort((a, b) => a.rev - b.rev)

    // Reconstruct state by applying diffs in rev order.
    // A create version (rev=1, prev=null) has ALL fields in diff.changed.
    // Subsequent versions have only CHANGED fields in diff.changed.
    let state = {}
    let lastDeleted = false
    for (const ver of vers) {
      if (ver.op === 'delete') { lastDeleted = true; continue }
      lastDeleted = false
      if (ver.diff && ver.diff.changed && typeof ver.diff.changed === 'object') {
        Object.assign(state, ver.diff.changed)
      }
    }

    // e. Entity was deleted at/before asOf — exclude from filing.
    if (lastDeleted) continue

    const lastVer = vers[vers.length - 1]
    resolved.push({
      entityPath,
      entityType: entityTypeMap[entityPath] || 'unknown',
      data:       state,
      versionId:  lastVer.id,
      rev:        lastVer.rev,
      versionAt:  lastVer.at,
      actor:      lastVer.actor,
    })
  }

  return resolved
}

// ─── STEP 3: BUILD ───────────────────────────────────────────────────────────
// Assembles a DETERMINISTIC package. Deterministic = same inputs, byte-identical output.
//
// sortedKeys() recursively sorts object keys so JSON.stringify is canonical.
// contentHash = SHA-256(JSON.stringify(sortedFieldValues)) per item.
// packageHash = SHA-256(JSON.stringify(sortedItemHashes)) over all items in entityPath order.
//
// The package body (including all hashes) is computed before storagePath is added,
// so the hashes cover only the filed content — not the storage location.

function sha256hex(val) {
  return crypto.createHash('sha256').update(String(val)).digest('hex')
}

function sortedKeys(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const out = {}
  for (const k of Object.keys(obj).sort()) out[k] = sortedKeys(obj[k])
  return out
}

function buildPackage(resolvedItems, scope) {
  // Sort items by entityPath for determinism.
  const sortedItems = [...resolvedItems].sort((a, b) => a.entityPath.localeCompare(b.entityPath))

  const items = sortedItems.map((item) => {
    // Deterministic field values: sort all keys recursively.
    const fieldValues  = sortedKeys(item.data)
    const fieldJson    = JSON.stringify(fieldValues)
    const contentHash  = sha256hex(fieldJson)
    return {
      entityPath:  item.entityPath,
      entityType:  item.entityType,
      versionId:   item.versionId,
      rev:         item.rev,
      versionAt:   item.versionAt,
      fieldValues,
      contentHash,
    }
  })

  // packageHash covers the complete filed content (entityPath + contentHash per item).
  // This provides tamper evidence: any change to any field in any item changes packageHash.
  const hashInput  = JSON.stringify(items.map((i) => ({ entityPath: i.entityPath, contentHash: i.contentHash })))
  const packageHash = sha256hex(hashInput)

  return { scope, items, packageHash }
}

// ─── STEP 3 (continued): STORE ───────────────────────────────────────────────
// Writes the package JSON to Azure Blob Storage (write-once: conditions.ifNoneMatch='*').
// Returns the storagePath. Throws if storage is not configured or if blob already exists.

async function storePackage(tenantId, filingId, pkg) {
  const conn = process.env.AZURE_BLOB_CONNECTION
  if (!conn) throw new Error('AZURE_BLOB_CONNECTION not configured — storage required for filing')
  const { BlobServiceClient } = require('@azure/storage-blob')
  const container   = process.env.AZURE_BLOB_CONTAINER || 'uploads'
  const blobPath    = `filings/${tenantId}/${filingId}/package.json`
  const client      = BlobServiceClient.fromConnectionString(conn)
    .getContainerClient(container)
    .getBlockBlobClient(blobPath)

  // Write the package with builtAt timestamp (excluded from hash computation above).
  const withTimestamp = { ...pkg, builtAt: new Date().toISOString() }
  const buf = Buffer.from(JSON.stringify(withTimestamp, null, 2), 'utf8')

  // conditions: { ifNoneMatch: '*' } — refuse overwrite; filing blobs are write-once.
  await client.upload(buf, buf.length, {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    conditions:      { ifNoneMatch: '*' },
  })
  return blobPath
}

// ─── STEP 4: VERIFY ──────────────────────────────────────────────────────────
// Independent extraction check — a SEPARATE AI call acting as a pure verifier.
//
// Role: GROUNDED_CITED (claude-opus-4-8) acting as independent verifier only.
// The verifier receives:
//   - filedItems: what we are about to file (entityPath, versionId, fieldValues)
//   - sourceEntities: the resolved source data keyed by entityPath
// The verifier must call `extraction_verdict` exactly once with:
//   { approved: boolean, issues: [{ entityPath, field, filedValue, sourceValue, reason }] }
//
// If approved=false, the filing is REJECTED before freeze. The discrepancy is logged and
// a rejection audit event is written. The filing record is NEVER written on rejection.
//
// This is the generator/verifier ensemble: the same data that BUILD assembled is
// re-examined by an independent model pass before it becomes immutable.

const VERIFIER_SYSTEM = [
  'You are an independent regulatory filing extraction verifier. Your ONLY function is field-level extraction verification.',
  'You will receive a filed package (proposed field values per entity) and the source entity states from version history.',
  'For EVERY field value in every filed item, verify it is present VERBATIM in the corresponding source entity.',
  'Verify that every refId and form number in the package exactly matches the source (case-sensitive, character-for-character).',
  'Flag ANY field whose value differs from the source, is absent from the source, or cannot be traced to the source.',
  'Do NOT fabricate or infer values not present in the provided data.',
  'Call `extraction_verdict` exactly once as your only action.',
  'If all fields are verbatim matches, set approved=true and issues=[].',
  'If any discrepancy exists, set approved=false and list every issue.',
].join(' ')

const EXTRACTION_VERDICT_TOOL = {
  name: 'extraction_verdict',
  description: 'Report the verdict of the independent extraction verification pass.',
  input_schema: {
    type: 'object',
    required: ['approved', 'issues'],
    properties: {
      approved: {
        type: 'boolean',
        description: 'true if every filed field value is present verbatim in its source version entity; false if any discrepancy was found.',
      },
      issues: {
        type: 'array',
        description: 'List of discrepancies. MUST be empty when approved=true.',
        items: {
          type: 'object',
          required: ['entityPath', 'field', 'filedValue', 'sourceValue', 'reason'],
          properties: {
            entityPath:  { type: 'string', description: 'Path of the entity with the discrepancy.' },
            field:       { type: 'string', description: 'Field name with the discrepancy.' },
            filedValue:  { description: 'Value as it appears in the filed package.' },
            sourceValue: { description: 'Value in the source entity state, or null if field absent.' },
            reason:      { type: 'string', description: 'e.g. "field not in source", "value altered", "refId does not match verbatim"' },
          },
        },
      },
    },
  },
}

async function verifyPackage(pkg, resolvedItems) {
  if (!fleet.isConfigured()) throw new Error('AI not configured — filing verification requires GROUNDED_CITED model')

  const g = fleet.guard()
  if (!g.allow) throw new Error('AI budget ceiling reached — filing verification unavailable')

  // Route to GROUNDED_CITED (claude-opus-4-8) for the verification pass.
  // This is the same role used by the portfolio copilot and scaffoldProduct — deep, grounded reasoning.
  const deployment = fleet.resolveModel('GROUNDED_CITED', g.degrade)

  // Build the verification payload. The verifier gets the filed items AND the source entity states.
  // The source entity states are keyed by entityPath and contain the raw reconstructed data.
  const sourceEntities = {}
  for (const item of resolvedItems) {
    sourceEntities[item.entityPath] = {
      entityType: item.entityType,
      versionId:  item.versionId,
      rev:        item.rev,
      versionAt:  item.versionAt,
      data:       item.data,
    }
  }

  const verificationPayload = JSON.stringify({
    instruction:    'Verify that every field value in filedItems is present verbatim in the corresponding sourceEntities entry. Check refIds and form numbers character-for-character.',
    filedItems:     pkg.items.map((i) => ({ entityPath: i.entityPath, entityType: i.entityType, versionId: i.versionId, rev: i.rev, fieldValues: i.fieldValues })),
    sourceEntities,
  })

  const resp = await fetchWithRetry(fleet.anthropicMessagesUrl(), {
    method:  'POST',
    headers: fleet.anthropicHeaders(),
    body:    JSON.stringify({
      model:       deployment,
      max_tokens:  4096,
      temperature: 0,
      system:      [{ type: 'text', text: VERIFIER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools:       [EXTRACTION_VERDICT_TOOL],
      tool_choice: { type: 'tool', name: 'extraction_verdict' },
      messages:    [{ role: 'user', content: verificationPayload }],
    }),
  }, { timeoutMs: 120_000 })

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`Verifier AI call failed ${resp.status}: ${detail}`)
  }

  const json = await resp.json()
  fleet.record(deployment, json.usage?.input_tokens, json.usage?.output_tokens)

  const toolUse = Array.isArray(json.content) ? json.content.find((b) => b.type === 'tool_use') : null
  if (!toolUse || !toolUse.input) throw new Error('Verifier did not return an extraction_verdict tool call')

  const verdict = toolUse.input
  if (typeof verdict.approved !== 'boolean') throw new Error('Verifier returned invalid extraction_verdict (approved must be boolean)')
  if (!Array.isArray(verdict.issues)) verdict.issues = []
  return verdict
}

// ─── STEP 5: FREEZE ──────────────────────────────────────────────────────────
// Writes the immutable filing record and an append-only audit event.
//
// IMMUTABILITY PROOF:
//   Both writes use docs.items.create() — never upsert, never replace.
//   No update path for filing records exists anywhere in this file.
//   If the create fails (e.g. duplicate filingId), the freeze aborts and no record is written.
//
// Partition: ${tenantId}|filings  (a dedicated filing partition, not mixed with entity data).
// Filing record kind: 'filing'
// Audit record kind: 'audit', action: 'filing.generate'

async function freezeFiling(tenantId, filingId, pkg, verifierVerdict, scope, actor, storagePath) {
  const docs = cosmosFor(tenantId)
  const now  = new Date().toISOString()
  const pk   = pkFor(tenantId, 'filings')

  // Filing record — immutable. Every filed item carries versionId + contentHash.
  // packageHash covers all items in entityPath order (tamper evidence for the whole package).
  const filingRecord = {
    id:        `filing:${filingId}`,
    pk,
    kind:      'filing',
    tenantId,
    filingId,
    scope: {
      tenantId:  scope.tenantId,
      productId: scope.productId,
      stateCode: scope.stateCode,
      asOf:      scope.asOf,
    },
    items: pkg.items.map((i) => ({
      entityPath:  i.entityPath,
      entityType:  i.entityType,
      versionId:   i.versionId,
      rev:         i.rev,
      versionAt:   i.versionAt,
      fieldValues: i.fieldValues,
      contentHash: i.contentHash,
    })),
    packageHash:     pkg.packageHash,
    storagePath,
    verifierVerdict: { approved: verifierVerdict.approved, issueCount: (verifierVerdict.issues || []).length },
    actor:     { uid: actor.uid, name: actor.name },
    createdAt: now,
  }

  // Audit event — append-only. Carries packageHash and verifier outcome.
  const auditRecord = {
    id:        auditId(),
    pk,
    kind:      'audit',
    tenantId,
    action:    'filing.generate',
    entityType: 'filing',
    entityPath: `filings/${filingId}`,
    productId:  scope.productId,
    actor:      { uid: actor.uid, name: actor.name },
    at:         now,
    data: {
      filingId,
      stateCode:        scope.stateCode,
      asOf:             scope.asOf,
      packageHash:      pkg.packageHash,
      storagePath,
      verifierApproved: verifierVerdict.approved,
      itemCount:        pkg.items.length,
    },
  }

  // CREATE-ONLY: items.create() throws if the id already exists (no silent overwrite).
  // This enforces immutability at the storage layer, not just at the application layer.
  await docs.items.create(filingRecord)
  await docs.items.create(auditRecord)

  return { filingId, packageHash: pkg.packageHash, createdAt: now }
}

// ─── POST /generate ──────────────────────────────────────────────────────────

router.post('/generate',
  requireCapability('filing:generate'),   // SCOPE: gate — blocks VIEWER and all inquiry personas
  requireTenant,
  async (req, res) => {
    // Actor is derived exclusively from req.user (server-stamped JWT); never from req.body.
    const actor    = { uid: req.user.uid, name: req.user.name ?? req.user.email ?? req.user.uid }
    const tenantId = resolveTenantForPrincipal(req.user)
    const { productId, stateCode, asOf } = req.body || {}

    // ── Input validation ─────────────────────────────────────────────────────
    if (!productId || typeof productId !== 'string' || !productId.trim()) {
      return res.status(400).json({ error: 'productId_required' })
    }
    const rawState = typeof stateCode === 'string' ? stateCode.trim().toUpperCase() : ''
    if (!rawState || !/^[A-Z]{2}$/.test(rawState)) {
      return res.status(400).json({ error: 'stateCode_required', detail: 'Two-letter US state code required (e.g. TX, CA)' })
    }
    const asOfNorm = asOf ? String(asOf) : new Date().toISOString()
    if (isNaN(Date.parse(asOfNorm))) {
      return res.status(400).json({ error: 'asOf_invalid', detail: 'asOf must be an ISO 8601 date-time string' })
    }
    if (new Date(asOfNorm) > new Date()) {
      return res.status(400).json({ error: 'asOf_future', detail: 'asOf must be at or before the current instant' })
    }

    const scope = {
      tenantId,
      productId:  productId.trim(),
      stateCode:  rawState,
      asOf:       asOfNorm,
    }
    // filingId encodes state, product, and epoch so it is unique and self-describing.
    const filingId = `${scope.stateCode}-${scope.productId}-${Date.now()}`

    try {
      // ── STEP 2: RESOLVE ──────────────────────────────────────────────────
      const resolvedItems = await resolveProductAtAsOf(tenantId, scope.productId, scope.asOf)
      if (resolvedItems.length === 0) {
        return res.status(404).json({
          error:  'no_entities_at_asof',
          detail: 'No entity versions found at or before the specified asOf date for this product.',
        })
      }

      // ── STEP 3: BUILD + STORE ─────────────────────────────────────────────
      const pkg = buildPackage(resolvedItems, scope)

      let storagePath
      try {
        storagePath = await storePackage(tenantId, filingId, pkg)
      } catch (e) {
        return res.status(503).json({ error: 'storage_unavailable', detail: String(e.message || e).slice(0, 300) })
      }

      // ── STEP 4: VERIFY ───────────────────────────────────────────────────
      let verifierVerdict
      try {
        verifierVerdict = await verifyPackage(pkg, resolvedItems)
      } catch (e) {
        // Write a verify-error audit event so the failed attempt is on record.
        try {
          const docs = cosmosFor(tenantId)
          await docs.items.create({
            id:        auditId(),
            pk:        pkFor(tenantId, 'filings'),
            kind:      'audit',
            tenantId,
            action:    'filing.verify_error',
            entityType: 'filing',
            entityPath: `filings/${filingId}`,
            productId:  scope.productId,
            actor,
            at:        new Date().toISOString(),
            data:      { filingId, stateCode: scope.stateCode, asOf: scope.asOf, error: String(e.message || e).slice(0, 300) },
          })
        } catch { /* best-effort audit; caller still gets 503 */ }
        return res.status(503).json({ error: 'verifier_unavailable', detail: String(e.message || e).slice(0, 300) })
      }

      // Verifier rejected: write rejection audit, return 422 — filing record NOT written.
      if (!verifierVerdict.approved) {
        const issues = Array.isArray(verifierVerdict.issues) ? verifierVerdict.issues : []
        console.error('[filing] VERIFIER REJECTED filing', filingId, JSON.stringify(issues).slice(0, 500))
        try {
          const docs = cosmosFor(tenantId)
          await docs.items.create({
            id:        auditId(),
            pk:        pkFor(tenantId, 'filings'),
            kind:      'audit',
            tenantId,
            action:    'filing.verify_rejected',
            entityType: 'filing',
            entityPath: `filings/${filingId}`,
            productId:  scope.productId,
            actor,
            at:        new Date().toISOString(),
            data:      { filingId, stateCode: scope.stateCode, asOf: scope.asOf, packageHash: pkg.packageHash, issues },
          })
        } catch { /* best-effort audit */ }
        return res.status(422).json({
          error:    'filing_rejected_by_verifier',
          filingId,
          issues,
          detail:   'The independent verifier detected fabricated or altered field values. Filing aborted — no record written.',
        })
      }

      // ── STEP 5: FREEZE ───────────────────────────────────────────────────
      const result = await freezeFiling(tenantId, filingId, pkg, verifierVerdict, scope, actor, storagePath)

      return res.status(201).json({
        ok:           true,
        filingId:     result.filingId,
        packageHash:  result.packageHash,
        storagePath,
        itemCount:    pkg.items.length,
        createdAt:    result.createdAt,
        verifier:     { approved: true, issueCount: 0 },
      })

    } catch (e) {
      console.error('[filing] generation error:', e.message)
      if (e.code === 409 || (e.statusCode === 409)) {
        return res.status(409).json({ error: 'filing_conflict', detail: 'A filing record with this ID already exists.' })
      }
      return res.status(500).json({ error: 'filing_failed', detail: String(e.message || e).slice(0, 300) })
    }
  },
)

// ─── GET / (list filings for this tenant, optionally scoped to a product) ────
router.get('/',
  requireCapability('product:read'),
  requireTenant,
  async (req, res) => {
    const tenantId  = resolveTenantForPrincipal(req.user)
    const productId = typeof req.query.productId === 'string' ? req.query.productId.trim() : null
    const docs      = cosmosFor(tenantId)
    const pk        = pkFor(tenantId, 'filings')
    let   sql       = "SELECT c.filingId, c.scope, c.packageHash, c.storagePath, c.verifierVerdict, c.actor, c.createdAt, c.items FROM c WHERE c.kind='filing' AND c.tenantId=@tid"
    const params    = [{ name: '@tid', value: tenantId }]
    if (productId) {
      sql += ' AND c.scope.productId=@pid'
      params.push({ name: '@pid', value: productId })
    }
    try {
      const { resources } = await docs.items.query({ query: sql, parameters: params }, { partitionKey: pk, maxItemCount: 100 }).fetchAll()
      return res.json({ filings: resources })
    } catch (e) {
      return res.status(500).json({ error: 'list_failed', detail: String(e.message || e).slice(0, 200) })
    }
  },
)

// ─── GET /:filingId (retrieve one frozen filing record) ──────────────────────
router.get('/:filingId',
  requireCapability('product:read'),
  requireTenant,
  async (req, res) => {
    const tenantId = resolveTenantForPrincipal(req.user)
    const { filingId } = req.params
    if (!filingId || typeof filingId !== 'string') return res.status(400).json({ error: 'filingId_required' })
    const docs = cosmosFor(tenantId)
    const pk   = pkFor(tenantId, 'filings')
    try {
      const item = (await docs.item(`filing:${filingId}`, pk).read()).resource
      if (!item || item.tenantId !== tenantId) return res.status(404).json({ error: 'filing_not_found' })
      return res.json({ filing: item })
    } catch {
      return res.status(404).json({ error: 'filing_not_found' })
    }
  },
)

module.exports = router
