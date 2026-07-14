// no-bare-writes.test.ts — DEF-0047 extension: exhaustive Cosmos write-call census.
//
// The mutation invariant says every ENTITY write goes through the data.js atomic
// envelope (entity + audit + version + searchIndex + chainHead in one transactional
// batch). This test enumerates EVERY Cosmos write call in server source and pins it
// to an explicit allowlist with a rationale. Adding a new bare write anywhere —
// or removing an allowlisted one without updating the list — fails the gate, so
// every new write path gets a deliberate review against the invariant.
//
// Generated bundles (*-shared.cjs) are excluded: they are build artifacts of
// shared/ sources (the seed bundle legitimately contains migration writes).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, dirname } from 'path'
import { fileURLToPath } from 'url'

const dir = dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = resolve(dir, '../../../server')

// Every Cosmos SDK write shape: items.create / items.upsert / items.batch,
// and point-item replace/delete.
const WRITE_RE = /\.items\.(create|upsert|batch)\s*\(|\.item\([^)]*\)\.(delete|replace)\s*\(/g

// file (relative to server/, posix slashes) -> { count, why }
// Counts are EXACT: a new write fails the gate until it is consciously allowlisted
// here (and justified), and a removed write must be delisted.
const ALLOWLIST: Record<string, { count: number; why: string }> = {
  'lib/data.js': {
    count: 3,
    why: 'THE atomic envelope: commitEnvelope items.batch + mutateBatch chunk items.batch + presence heartbeat upsert (separate presence container, ephemeral non-entity — DEF-0017).',
  },
  'lib/filing.js': {
    count: 1,
    why: 'createBatch(): ONE transactional batch of Create-only ops (filing record + hash-chained audit + chainHead). Immutable by construction; no upsert/replace exists in the file.',
  },
  'lib/auth.js': {
    count: 5,
    why: '__system__ identity plane (DEF-0017): loginAudit append-only create, JIT user provisioning upserts (x2), changePassword user upsert, revokedToken upsert (RISK-006). Not tenant entities.',
  },
  'lib/admin.js': {
    count: 8,
    why: 'SUPER_ADMIN platform plane, __system__ partition: platformAudit append-only create, tenant create/update upserts + delete, user create/update upserts + delete, impersonateAudit append-only create. All non-entity platform records (DEF-0017), each paired with a platformAudit write.',
  },
  'lib/tenant-admin.js': {
    count: 4,
    why: '__system__ user-identity upserts (invite / role change / remove / disable). Each is PAIRED with an audited member-mirror write through mutateInternal (hash-chained) in the tenant partition.',
  },
  'lib/ai/reindex-product.js': {
    count: 1,
    why: 'Grounding-chunk REBUILD: derived retrieval data (same class as searchIndex), regenerated from audited entities. Not an entity write; carries no audit obligation.',
  },
}

function listSourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name === 'public') continue
      const full = join(d, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (name.endsWith('.js') && !name.endsWith('-shared.cjs')) out.push(full)
    }
  }
  walk(root)
  return out
}

describe('DEF-0047 (extended) — every Cosmos write call in server/ is allowlisted', () => {
  const census = new Map<string, string[]>() // rel file -> matched snippets
  for (const file of listSourceFiles(SERVER_DIR)) {
    const src = readFileSync(file, 'utf8')
    const hits = [...src.matchAll(WRITE_RE)].map((m) => m[0])
    if (hits.length > 0) census.set(relative(SERVER_DIR, file).replace(/\\/g, '/'), hits)
  }

  it('finds the write surface at all (harness sanity — empty census would be theater)', () => {
    expect(census.get('lib/data.js')?.length).toBeGreaterThan(0)
  })

  it('no file outside the allowlist performs a Cosmos write', () => {
    const rogue = [...census.entries()].filter(([f]) => !(f in ALLOWLIST))
    expect(rogue, `Unallowlisted Cosmos write(s): ${rogue.map(([f, h]) => `${f} (${h.join(', ')})`).join('; ')} — route entity writes through data.js mutateInternal, or allowlist non-entity writes with a rationale.`).toEqual([])
  })

  it('every allowlisted file has EXACTLY its expected write count', () => {
    const drift: string[] = []
    for (const [f, { count }] of Object.entries(ALLOWLIST)) {
      const actual = census.get(f)?.length ?? 0
      if (actual !== count) drift.push(`${f}: expected ${count}, found ${actual}`)
    }
    expect(drift, `Write-count drift (new bare write, or stale allowlist): ${drift.join('; ')}`).toEqual([])
  })
})
