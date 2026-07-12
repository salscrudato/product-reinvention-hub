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
const dataJs  = readFileSync(resolve(dir, '../../../server/lib/data.js'),       'utf8')
const aiJs    = readFileSync(resolve(dir, '../../../server/lib/ai/chat.js'), 'utf8')

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
// FAULT-C did the same on /mutateBatch. Neither was caught — these tests close the gap.
describe("DEF-0044 / DEF-0047 — /mutate and /mutateBatch must be gated by requireRole('EDITOR')", () => {
  it("POST /mutate uses requireRole('EDITOR'), not VIEWER (FAULT-004 regression guard)", () => {
    // Match: router.post('/mutate', requireRole('EDITOR')
    // Fails if 'EDITOR' is replaced with 'VIEWER' or any other role string.
    expect(dataJs).toMatch(/router\.post\(['"]\/mutate['"],\s*requireRole\(['"]EDITOR['"]\)/)
  })

  it("POST /mutateBatch uses requireRole('EDITOR'), not VIEWER (FAULT-C regression guard)", () => {
    expect(dataJs).toMatch(/router\.post\(['"]\/mutateBatch['"],\s*requireRole\(['"]EDITOR['"]\)/)
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
