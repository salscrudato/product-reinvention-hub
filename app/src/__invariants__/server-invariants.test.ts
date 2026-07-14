// server-invariants.test.ts — source-audit tests for server/lib/ hardening invariants.
//
// These tests read server source files and assert that load-bearing patterns are present.
// Each is paired to a specific fault-injection FAULT-### from the mutation sweep; the test
// must turn RED when that exact mutation is applied and GREEN when the code is correct.
//
// Why source-audit rather than runtime mocking?
//   The server is a CJS Express module (not a pnpm workspace, no test runner configured).
//   Mocking its Cosmos client in a vitest ESM test requires non-trivial hoisting machinery.
//   Source-audit catches the exact mutations described: dropped ops.push lines, swapped role
//   names, and removed system-prompt strings — all of which change the source text.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const dir = dirname(fileURLToPath(import.meta.url))
const dataJs   = readFileSync(resolve(dir, '../../../server/lib/data.js'),       'utf8')
const aiJs     = readFileSync(resolve(dir, '../../../server/lib/ai/chat.js'),    'utf8')
const filingJs = readFileSync(resolve(dir, '../../../server/lib/filing.js'),     'utf8')
const authJs   = readFileSync(resolve(dir, '../../../server/lib/auth.js'),       'utf8')

// ─── DEF-0043 / DEF-0046 ─────────────────────────────────────────────────────
// Mutation sweep FAULT-003 dropped the audit ops.push from envelope(); FAULT-B dropped
// the version ops.push. Neither was caught by the unit suite — these tests close the gap.
describe('DEF-0043 / DEF-0046 — mutation envelope must push both audit and version ops', () => {
  it("envelope() pushes a kind:'audit' op (FAULT-003 regression guard)", () => {
    // The ops.push for audit uses the JS object literal `kind: 'audit'`.
    // The Cosmos query string inside the PROBE endpoint uses `c.kind='audit'` (different format).
    // Only the ops.push call matches the pattern below.
    expect(dataJs).toMatch(/kind:\s*'audit'/)
  })

  it("envelope() pushes a kind:'version' op (FAULT-B regression guard)", () => {
    // Same reasoning: 'kind: 'version'' only appears in the ops.push within envelope().
    expect(dataJs).toMatch(/kind:\s*'version'/)
  })

  it("envelope() audit op is inside an ops.push() call", () => {
    // Tighter check: the audit entry is passed to ops.push, not just present as a string constant.
    // Use [\s\S]*? (lazy, any char) rather than [^)]* because ops.push arguments contain ')' e.g. auditId().
    expect(dataJs).toMatch(/ops\.push\(\{[\s\S]*?kind:\s*'audit'/)
  })

  it("envelope() version op is inside an ops.push() call", () => {
    expect(dataJs).toMatch(/ops\.push\(\{[\s\S]*?kind:\s*'version'/)
  })
})

// ─── Audit hash-chain (tamper evidence) ──────────────────────────────────────
// Every audit event must seal its content + link to its predecessor; the chainHead
// anchor must ride the SAME transactional batch; the verifier endpoint must exist.
describe('audit hash-chain — envelope seals every audit event', () => {
  it('envelope computes the event hash via the shared chain module', () => {
    expect(dataJs).toMatch(/require\(['"]\.\/audit-chain-shared\.cjs['"]\)/)
    expect(dataJs).toMatch(/computeAuditHash\(/)
  })

  it('audit op carries prevHash and the sealed hash', () => {
    expect(dataJs).toMatch(/prevHash:\s*head\?\.hash\s*\?\?\s*null/)
    expect(dataJs).toMatch(/kind:\s*'audit',\s*\.\.\.auditBody,\s*hash/)
  })

  it('audit op carries source attribution and the before/after field diff', () => {
    expect(dataJs).toMatch(/source:\s*source\s*\|\|\s*null/)
    expect(dataJs).toMatch(/auditBody\s*=\s*\{[\s\S]*?diff/)
  })

  it("chainHead anchor (kind:'chainHead') is pushed into the same ops batch", () => {
    expect(dataJs).toMatch(/kind:\s*'chainHead'/)
    expect(dataJs).toMatch(/ops\.push\(headOp\)/)
  })

  it('chainHead upsert is etag-guarded so concurrent writers serialize per path', () => {
    expect(dataJs).toMatch(/ifMatchETag/)
  })

  it('GET /audit/verify endpoint exists behind the audit:read capability', () => {
    expect(dataJs).toMatch(/router\.get\(['"]\/audit\/verify['"],\s*requireCapability\(['"]audit:read['"]\)/)
    expect(dataJs).toMatch(/verifyAuditChain\(/)
  })
})

// ─── DEF-0003 — parentId validated server-side in the envelope ───────────────
describe('DEF-0003 — parentId must resolve to an existing same-tenant entity', () => {
  it('envelope rejects a dangling parentId with INVALID_PARENT', () => {
    expect(dataJs).toMatch(/data\.parentId\s*&&\s*op\s*!==\s*'delete'/)
    expect(dataJs).toMatch(/INVALID_PARENT/)
  })
  it('parent resolution goes through readEntity (which enforces r.tenantId === tid)', () => {
    expect(dataJs).toMatch(/parent\s*=\s*await readEntity\(tid,/)
    expect(dataJs).toMatch(/r\.tenantId === tid \? r : null/)
  })
})

// ─── DEF-0041 (re-hardened) — bootstrap admins are fail-closed ───────────────
// The original fix regressed during the multi-tenant rewrite: BOOTSTRAP_ADMINS came
// back always-on with default passwords. These assertions pin the fail-closed shape.
describe('DEF-0041 — bootstrap admins fail-closed (no default passwords in production)', () => {
  it('dev-default passwords exist only behind the BOOTSTRAP_USERS_ENABLED opt-in', () => {
    expect(authJs).toMatch(/BOOTSTRAP_USERS_ENABLED\s*===\s*'true'/)
    expect(authJs).toMatch(/BOOTSTRAP_DEFAULTS_OK\s*\?\s*devDefault\s*:\s*null/)
  })
  it('no unconditional env-or-default password fallback remains', () => {
    // The regressed shape was: password: process.env.X || 'admin'
    expect(authJs).not.toMatch(/password:\s*process\.env\.\w+\s*\|\|\s*'/)
  })
  it('AUTH_JWT_SECRET stays fail-closed (server refuses to start without it)', () => {
    expect(authJs).toMatch(/AUTH_JWT_SECRET is required/)
  })
})

// ─── DEF-0044 / DEF-0047 ─────────────────────────────────────────────────────
// Mutation sweep FAULT-004 changed requireRole('EDITOR') → requireRole('VIEWER') on /mutate;
// FAULT-C did the same on /mutateBatch. Now migrated to capability-based checks (authz.js).
// requireCapability('product:write') is the authoritative gate; only EDITOR+ have this capability.
describe("DEF-0044 / DEF-0047 — /mutate and /mutateBatch must be gated by requireCapability('product:write')", () => {
  it("POST /mutate uses requireCapability('product:write'), not a VIEWER role (FAULT-004 regression guard)", () => {
    // Match: router.post('/mutate', requireCapability('product:write')
    // Fails if capability is removed or downgraded to a read-only capability.
    expect(dataJs).toMatch(/router\.post\(['"]\/mutate['"],\s*requireCapability\(['"]product:write['"]\)/)
  })

  it("POST /mutateBatch uses requireCapability('product:write'), not a VIEWER role (FAULT-C regression guard)", () => {
    expect(dataJs).toMatch(/router\.post\(['"]\/mutateBatch['"],\s*requireCapability\(['"]product:write['"]\)/)
  })
})

// ─── DEF-0045 ────────────────────────────────────────────────────────────────
// Mutation sweep FAULT-005 removed the citation instruction from the AI SYSTEM prompt.
// ai.test.ts does not assert SYSTEM content — this test closes the gap.
describe('DEF-0045 — AI SYSTEM prompt must contain the citation instruction', () => {
  it("SYSTEM constant contains 'MUST cite its source' (FAULT-005 regression guard)", () => {
    // The exact phrase from ai.js line 44. Removal of this line changes the string.
    expect(aiJs).toContain('MUST cite its source')
  })

  it("SYSTEM constant instructs model to use bracketed reference tags", () => {
    expect(aiJs).toContain('bracketed reference tags')
  })

  it("SYSTEM constant forbids fabricating reference tags", () => {
    expect(aiJs).toContain('Do not fabricate reference tags')
  })
})

// ─── Filing generation invariants ────────────────────────────────────────────
// filing.js must: (1) gate on filing:generate capability to block VIEWER, (2) use
// items.create() exclusively for filing records (never upsert/replace), and (3) have
// the independent verifier gated to reject before freeze.
describe('filing.js — authority gate + create-only + verifier-before-freeze invariants', () => {
  it("POST /generate is gated by requireCapability('filing:generate') not a raw role check", () => {
    // filing:generate grants only EDITOR+, TENANT_ADMIN, SUPER_ADMIN (see authz.js).
    // VIEWER is excluded. A mutation swapping to product:read would allow viewers to file.
    expect(filingJs).toMatch(/requireCapability\(['"]filing:generate['"]\)/)
  })

  it('freezeFiling commits filing record + audit + chainHead in ONE Create-only transactional batch', () => {
    // A separate create for each doc would let a filing record exist without its
    // audit event. createBatch() maps every body to operationType:'Create' inside
    // one Cosmos transactional batch — atomic AND immutable (Create throws on dup id).
    expect(filingJs).toMatch(/createBatch\(docs,\s*pk,\s*\[filingRecord,\s*auditRecord,\s*chainHead\]\)/)
    expect(filingJs).toMatch(/operationType:\s*'Create'/)
  })

  it('filing audit events are hash-chained (computeAuditHash from the shared chain module)', () => {
    expect(filingJs).toMatch(/require\(['"]\.\/audit-chain-shared\.cjs['"]\)/)
    expect(filingJs).toMatch(/computeAuditHash\(/)
  })

  it('filing.js contains NO items.upsert() or items.replace() calls (no update path for filing records)', () => {
    // This is the authoritative proof that no code path can update a filing record after creation.
    // The regex catches both upsert and replace on the items object.
    expect(filingJs).not.toMatch(/items\.(upsert|replace)\(/)
  })

  it('verifyPackage is called before freezeFiling (verifier gates freeze)', () => {
    // The verifier must block fabricated fields before the record is made immutable.
    // We check that verifyPackage appears before freezeFiling in the source order.
    const verifyIdx = filingJs.indexOf('verifyPackage(')
    const freezeIdx = filingJs.indexOf('freezeFiling(')
    expect(verifyIdx).toBeGreaterThan(0)
    expect(freezeIdx).toBeGreaterThan(0)
    expect(verifyIdx).toBeLessThan(freezeIdx)
  })

  it('actor is derived from req.user, not from req.body (server-stamped identity)', () => {
    // The actor object must be built from req.user fields. It must not read actor from
    // req.body, which would let a client forge the identity in the audit trail.
    expect(filingJs).toMatch(/actor\s*=\s*\{[^}]*req\.user\.uid/)
    expect(filingJs).not.toMatch(/req\.body\.actor/)
  })

  it('rejection path writes a filing.verify_rejected audit event (discrepancy is logged)', () => {
    expect(filingJs).toContain("'filing.verify_rejected'")
  })

  it('VERIFIER_SYSTEM instructs the model to verify fields verbatim (no fabrication)', () => {
    expect(filingJs).toContain('verbatim')
    expect(filingJs).toContain('extraction_verdict')
  })

  it('packageHash is computed over per-item contentHashes (tamper evidence covers all filed content)', () => {
    expect(filingJs).toContain('packageHash')
    expect(filingJs).toContain('contentHash')
  })
})

// ─── Filing verifier role + tamper probe + reserved-base immutability ─────────
// Lane B (EXECUTION-B): the independent verifier runs on the MID_REASONER fleet role,
// escalating the ladder ONLY when the deployment is unprovisioned; the tamper probe can
// never freeze; the mutation envelope can never write into the reserved filings base.
describe('filing verifier — MID_REASONER role + tamper probe + filings base reserved', () => {
  it('verifier ladder starts at MID_REASONER and escalates only to GROUNDED_CITED', () => {
    expect(filingJs).toMatch(/VERIFIER_LADDER\s*=\s*\['MID_REASONER',\s*'GROUNDED_CITED'\]/)
    // The verdict records which role/deployment produced it (audit provenance).
    expect(filingJs).toContain('verifierRole')
    expect(filingJs).toContain('verifierDeployment')
  })

  it('ladder escalation is gated on a missing deployment, not on any error', () => {
    expect(filingJs).toMatch(/isMissingDeployment\(resp\.status,\s*detail\)/)
  })

  it('tamper probe branch returns before STORE and FREEZE (a probe can never freeze)', () => {
    const probeIdx  = filingJs.indexOf('tamperProbe')
    const storeIdx  = filingJs.indexOf('storagePath = await storePackage')
    const freezeIdx = filingJs.indexOf('await freezeFiling(')
    expect(probeIdx).toBeGreaterThan(0)
    expect(storeIdx).toBeGreaterThan(0)
    expect(freezeIdx).toBeGreaterThan(0)
    expect(probeIdx).toBeLessThan(storeIdx)
    expect(probeIdx).toBeLessThan(freezeIdx)
    // Even a wrongly-approving verdict on a tampered package must NOT freeze.
    expect(filingJs).toContain("'tamper_probe_not_detected'")
  })

  it("data.js reserves the 'filings' base — the mutation envelope rejects it with RESERVED_BASE", () => {
    expect(dataJs).toMatch(/RESERVED_BASES\s*=\s*new Set\(\['filings'\]\)/)
    expect(dataJs).toMatch(/RESERVED_BASES\.has\(baseKey\(path\)\)/)
    expect(dataJs).toMatch(/e\.code\s*=\s*'RESERVED_BASE'/)
    // Both mutate routes surface it as 403 (matched twice: /mutate and /mutateBatch).
    const matches = dataJs.match(/RESERVED_BASE'\)\s*return res\.status\(403\)/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})
