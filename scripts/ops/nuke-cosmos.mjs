#!/usr/bin/env node
// scripts/ops/nuke-cosmos.mjs
// ─────────────────────────────────────────────────────────────────────────────
// DESTRUCTIVE local admin tool — bulk-delete documents from the Cosmos containers
// this app uses (`docs` + `presence`). Deletes ITEMS, not the containers, so the
// container definitions + indexing policy stay intact.
//
// Kinds removed (unless --keep-system): entity, audit, version, searchIndex,
// chainHead, groundingChunk (all tenant-partitioned) AND the __system__ partition
// (tenant, user, platformAudit, config, meter). The app's TRUE source of product
// data is the .xlsx you upload — this gets you to a clean slate before a fresh
// import. NOT wired into any route or the CI gate; run it deliberately, by hand.
//
// --keep-system PRESERVES the __system__ partition (pk='__system__'): tenant records,
// user/admin profiles, passkeys, platform config. Use this to clear a tenant's PRODUCT
// data while keeping the tenant + its logins intact for a fresh upload.
//
// @azure/cosmos is a SERVER dependency (server/node_modules), resolved below via
// createRequire so this script runs from repo root without a root-level install.
// If it is missing, run:  npm --prefix server install
//
// Usage:
//   COSMOS_ENDPOINT=... COSMOS_KEY=... [COSMOS_DB=prodhub] \
//     node scripts/ops/nuke-cosmos.mjs --confirm <DB_NAME> [options]
//
// Options:
//   --confirm <name>   REQUIRED. Must equal the target database name (COSMOS_DB, default 'prodhub').
//   --dry-run          Count what WOULD be deleted, per container. Deletes nothing.
//   --keep-system      Preserve the __system__ partition (tenants, users, platform config).
//   --tenant <id>      Scope deletion to one tenant (docs by tenantId, presence by pid prefix).
//   --containers a,b   Which containers to wipe. Default: docs,presence
//
// Examples:
//   node scripts/ops/nuke-cosmos.mjs --confirm prodhub --keep-system --dry-run
//   node scripts/ops/nuke-cosmos.mjs --confirm prodhub --keep-system      # clear data, keep tenants/logins
//   node scripts/ops/nuke-cosmos.mjs --confirm prodhub                    # nuke everything
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

// @azure/cosmos lives in server/node_modules (npm-managed), NOT the root pnpm workspace.
// Resolve it from server/ using process.cwd() — run this from the repo root. We do NOT
// derive the path from import.meta.url: fileURLToPath decodes %20→space, which breaks
// resolution when the checkout folder literally contains "%20" in its name.
let CosmosClient = null
for (const base of [resolve(process.cwd(), 'server/package.json'), resolve(process.cwd(), 'package.json')]) {
  try {
    if (!existsSync(base)) continue
    CosmosClient = createRequire(base)('@azure/cosmos').CosmosClient
    if (CosmosClient) break
  } catch { /* try next candidate */ }
}
if (!CosmosClient) {
  console.error('\n✗ @azure/cosmos not found. From the repo root run:  npm --prefix server install\n')
  process.exit(1)
}

// ─── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { dryRun: false, keepSystem: false, containers: ['docs', 'presence'], confirm: null, tenant: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--keep-system') out.keepSystem = true
    else if (a === '--confirm') out.confirm = argv[++i]
    else if (a === '--tenant') out.tenant = argv[++i]
    else if (a === '--containers') out.containers = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else { console.error(`unknown argument: ${a}`); process.exit(2) }
  }
  return out
}

function die(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1) }

const args = parseArgs(process.argv.slice(2))
const endpoint = process.env.COSMOS_ENDPOINT
const key = process.env.COSMOS_KEY
const dbName = process.env.COSMOS_DB || 'prodhub'

if (!endpoint || !key) die('COSMOS_ENDPOINT / COSMOS_KEY must be set (same env the server uses).')
if (args.confirm !== dbName) {
  die(`refusing to run: pass --confirm ${dbName} to prove you mean to wipe database "${dbName}" at ${endpoint}.\n` +
      `  (got --confirm ${args.confirm === null ? '<missing>' : `"${args.confirm}"`})`)
}

// ─── deletion ──────────────────────────────────────────────────────────────────
const CONCURRENCY = 32

async function mapPool(items, limit, fn) {
  let i = 0
  const run = async () => { while (i < items.length) { const idx = i++; await fn(items[idx]) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
}

// Compose the WHERE clause from optional scopes. `docs` carries tenantId on every
// envelope and pk='__system__' for identity/platform records; `presence` keys on
// pid = `${tenantId}:${productId}` and has no __system__ partition.
function buildFilter(containerId, { tenant, keepSystem }) {
  const clauses = []
  const params = []
  if (tenant) {
    if (containerId === 'presence') { clauses.push('STARTSWITH(c.pid, @pref)'); params.push({ name: '@pref', value: `${tenant}:` }) }
    else { clauses.push('c.tenantId = @tid'); params.push({ name: '@tid', value: tenant }) }
  }
  if (keepSystem && containerId !== 'presence') clauses.push("c.pk != '__system__'")
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

async function wipeContainer(database, containerId, opts) {
  const container = database.container(containerId)
  let pkField = 'pk'
  try {
    const { resource: def } = await container.read()
    const path = def?.partitionKey?.paths?.[0]
    if (path) pkField = path.replace(/^\//, '')
  } catch (e) {
    die(`could not read container "${containerId}" in database "${dbName}": ${e.message || e}`)
  }

  const { where, params } = buildFilter(containerId, opts)

  if (opts.dryRun) {
    const { resources } = await container.items
      .query({ query: `SELECT VALUE COUNT(1) FROM c ${where}`, parameters: params })
      .fetchAll()
    const n = resources?.[0] ?? 0
    // Also report how many __system__ docs would be PRESERVED (docs only).
    let kept = null
    if (opts.keepSystem && containerId !== 'presence') {
      const { resources: k } = await container.items
        .query({ query: "SELECT VALUE COUNT(1) FROM c WHERE c.pk = '__system__'" })
        .fetchAll()
      kept = k?.[0] ?? 0
    }
    console.log(`  ${containerId}: ${n} document(s) would be DELETED${kept !== null ? `, ${kept} __system__ doc(s) PRESERVED` : ''} (partition key /${pkField})`)
    return { container: containerId, deleted: 0, wouldDelete: n, kept, errors: 0 }
  }

  const iterator = container.items.query(
    { query: `SELECT c.id, c["${pkField}"] AS pkv FROM c ${where}`, parameters: params },
    { maxItemCount: 1000 },
  )

  let deleted = 0
  let errors = 0
  while (iterator.hasMoreResults()) {
    const { resources } = await iterator.fetchNext()
    if (!resources?.length) continue
    await mapPool(resources, CONCURRENCY, async (row) => {
      try {
        await container.item(row.id, row.pkv).delete()
        deleted++
      } catch (e) {
        if (Number(e?.code) === 404) return
        errors++
        if (errors <= 10) console.error(`    ! delete failed (${containerId}/${row.id}): ${String(e.message || e).slice(0, 120)}`)
      }
    })
    process.stdout.write(`\r  ${containerId}: deleted ${deleted}${errors ? ` (${errors} errors)` : ''}...   `)
  }
  process.stdout.write('\n')
  return { container: containerId, deleted, errors }
}

async function main() {
  const client = new CosmosClient({ endpoint, key })
  const database = client.database(dbName)

  console.log('\n─── nuke-cosmos ───────────────────────────────────────────────')
  console.log(`  endpoint    : ${endpoint}`)
  console.log(`  database    : ${dbName}`)
  console.log(`  containers  : ${args.containers.join(', ')}`)
  console.log(`  scope       : ${args.tenant ? `tenant "${args.tenant}"` : 'ALL TENANTS'}`)
  console.log(`  keep-system : ${args.keepSystem ? 'YES — preserve __system__ (tenants, users, platform)' : 'no — __system__ also deleted'}`)
  console.log(`  mode        : ${args.dryRun ? 'DRY RUN (no deletes)' : 'DELETE'}`)
  console.log('───────────────────────────────────────────────────────────────\n')

  const results = []
  for (const c of args.containers) {
    results.push(await wipeContainer(database, c, { dryRun: args.dryRun, keepSystem: args.keepSystem, tenant: args.tenant }))
  }

  console.log('\n─── summary ───────────────────────────────────────────────────')
  for (const r of results) {
    if (args.dryRun) console.log(`  ${r.container}: ${r.wouldDelete} would be deleted${r.kept !== null && r.kept !== undefined ? `, ${r.kept} preserved` : ''}`)
    else console.log(`  ${r.container}: ${r.deleted} deleted${r.errors ? `, ${r.errors} errors` : ''}`)
  }
  if (!args.dryRun) console.log('\n  Done. Upload a fresh .xlsx via the Import modal to repopulate.')
  console.log('───────────────────────────────────────────────────────────────\n')
}

main().catch((e) => die(String(e?.stack || e?.message || e)))
