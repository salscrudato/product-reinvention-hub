// create-tenant.ts — create a new tenant + admin user in Cosmos __system__ partition.
//
// Run BEFORE migrate-to-cosmos.ts to set up the auth records for a new company.
// All values are configured via env vars so no secrets are committed.
//
// Run:
//   COSMOS_ENDPOINT=... COSMOS_KEY=... \
//   COSMOS_TENANT=testco \
//   ADMIN_USER=testadmin \
//   ADMIN_PASS=<password> \
//   ADMIN_EMAIL=testadmin@testco.local \
//   ADMIN_NAME="Test Admin" \
//   ADMIN_ROLE=ADMIN \
//     pnpm tsx scripts/create-tenant.ts
//
// ADMIN_ROLE defaults to ADMIN. Valid values: VIEWER, ANALYST, EDITOR, ADMIN.
// ADMIN_PASS defaults to ADMIN_USER value (change immediately after first login).
// To seed the reference products after this, run migrate-to-cosmos.ts next.

import { CosmosClient } from '@azure/cosmos'

const endpoint = process.env.COSMOS_ENDPOINT!
const key = process.env.COSMOS_KEY!
if (!endpoint || !key) { console.error('COSMOS_ENDPOINT / COSMOS_KEY required'); process.exit(1) }

const tenantId = (process.env.COSMOS_TENANT || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
if (!tenantId) { console.error('COSMOS_TENANT required (e.g. testco)'); process.exit(1) }

const username = (process.env.ADMIN_USER || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '')
if (!username) { console.error('ADMIN_USER required (e.g. testadmin)'); process.exit(1) }

const password = process.env.ADMIN_PASS || username
const email = process.env.ADMIN_EMAIL || `${username}@${tenantId}.local`
const name = process.env.ADMIN_NAME || username
const role = process.env.ADMIN_ROLE || 'ADMIN'
const validRoles = ['VIEWER', 'ANALYST', 'EDITOR', 'ADMIN']
if (!validRoles.includes(role)) { console.error(`Invalid ADMIN_ROLE "${role}". Valid: ${validRoles.join(', ')}`); process.exit(1) }

const NOW = new Date().toISOString()
const docs = new CosmosClient({ endpoint, key }).database(process.env.COSMOS_DB || 'prodhub').container('docs')

async function run() {
  console.log(`Creating tenant "${tenantId}" and ${role} user "${username}"…`)

  // Write tenant record into __system__ partition
  const tenantDoc = {
    id: `tenant:${tenantId}`,
    pk: '__system__',
    kind: 'tenant',
    data: {
      tenantId,
      name: process.env.TENANT_NAME || tenantId,
      createdAt: NOW,
      createdBy: 'create-tenant-script',
    },
  }
  await docs.items.upsert(tenantDoc)
  console.log(`  ✅ Tenant "${tenantId}" created (name: "${tenantDoc.data.name}")`)

  // Write user record into __system__ partition
  const userDoc = {
    id: `user:${username}`,
    pk: '__system__',
    kind: 'user',
    data: {
      username,
      role,
      tenants: [tenantId],
      email,
      name,
      password, // plaintext — matching auth.js convention; change via /api/admin/users after first login
      createdAt: NOW,
    },
  }
  await docs.items.upsert(userDoc)
  console.log(`  ✅ User "${username}" created (role: ${role}, tenant: ${tenantId})`)
  console.log()
  console.log('Next step: seed reference products for this tenant:')
  console.log(`  COSMOS_ENDPOINT=... COSMOS_KEY=... COSMOS_TENANT=${tenantId} NODE_PATH=server/node_modules pnpm tsx scripts/migrate-to-cosmos.ts`)
  console.log()
  console.log('Login credentials:')
  console.log(`  username: ${username}`)
  console.log(`  password: ${password === username ? username + '  ← default (= username); change this!' : '(set via ADMIN_PASS)'}`)
  console.log(`  tenant:   ${tenantId}`)
}

run().catch((e) => { console.error('create-tenant failed:', e); process.exit(1) })
