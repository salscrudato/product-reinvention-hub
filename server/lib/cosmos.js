'use strict'
// cosmos.js — the single Cosmos DB client + container handles.
// Endpoint/key come from App Service settings COSMOS_ENDPOINT / COSMOS_KEY.
// Throws on require if unset, so server.js skips mounting /api/db until wired.

const { CosmosClient } = require('@azure/cosmos')

const endpoint = process.env.COSMOS_ENDPOINT
const key = process.env.COSMOS_KEY
if (!endpoint || !key) throw new Error('COSMOS_ENDPOINT / COSMOS_KEY not set')

const client = new CosmosClient({ endpoint, key })
const database = client.database(process.env.COSMOS_DB || 'prodhub')
const docs = database.container('docs')
const presence = database.container('presence')

// ─── resolveTenantStore(tenantId): the tenant to storage seam ────────────────
// Returns the Cosmos container scope a tenant's data lives in. TODAY every tenant is
// POOLED into the shared `docs` container, partitioned by `${tenantId}|${base}` (see
// data.js), so this returns the shared handles for every tenant.
//
// SILO_READY: to promote a single enterprise tenant to its OWN dedicated container
// (physical isolation) later, add `tenantId -> containerId` to DEDICATED_CONTAINERS and
// provision that container. Every tenant-scoped read/write already resolves its store
// through this seam, so NO call site changes; the promotion is one edit here. The
// `pooled` flag is exposed so a caller can branch if it ever must.
const DEDICATED_CONTAINERS = {}   // tenantId -> containerId (empty: all tenants pooled)

function resolveTenantStore(tenantId) {
  const dedicated = tenantId && DEDICATED_CONTAINERS[tenantId]
  if (dedicated) return { docs: database.container(dedicated), presence, pooled: false }
  return { docs, presence, pooled: true }
}

module.exports = { client, database, docs, presence, resolveTenantStore }
