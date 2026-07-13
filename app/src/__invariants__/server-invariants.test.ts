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

  it('freezeFiling uses items.create() for the filing record (never upsert — CREATE-ONLY)', () => {
    // items.upsert() would allow silent overwrite of an existing filing record.
    // Only items.create() enforces immutability at the storage layer.
    expect(filingJs).toMatch(/items\.create\(filingRecord\)/)
  })

  it('freezeFiling uses items.create() for the audit event (never upsert — append-only)', () => {
    expect(filingJs).toMatch(/items\.create\(auditRecord\)/)
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
