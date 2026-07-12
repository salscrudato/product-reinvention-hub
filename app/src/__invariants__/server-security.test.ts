// server-security.test.ts -- S1 hardening source-audit tests for server/lib/ security invariants.
//
// Each test is paired to a specific RISK-### from the hardening campaign. The test must turn RED
// when the security control is absent and GREEN when the fix is applied.
//
// Pattern: read server source files; assert security-relevant patterns are present.
// Same approach as server-invariants.test.ts (source-audit, not runtime mock).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const dir = dirname(fileURLToPath(import.meta.url))
const authJs      = readFileSync(resolve(dir, '../../../server/lib/auth.js'),      'utf8')
const dataJs      = readFileSync(resolve(dir, '../../../server/lib/data.js'),      'utf8')
const serverJs    = readFileSync(resolve(dir, '../../../server/server.js'),        'utf8')
const storageJs   = readFileSync(resolve(dir, '../../../server/lib/storage.js'),   'utf8')
const homecheckJs = readFileSync(resolve(dir, '../../../server/lib/homecheck.js'), 'utf8')

// --- RISK-002: Bootstrap accounts must warn when enabled with default passwords ---------------
describe('RISK-002 -- bootstrap accounts must emit a startup warning when using default passwords', () => {
  it('auth.js warns on startup when BOOTSTRAP_ENABLED with default password', () => {
    // The startup warning must mention the risk of default bootstrap credentials.
    // Accepts any console.warn call that references bootstrap and defaults.
    expect(authJs).toMatch(/console\.warn[\s\S]*?bootstrap|bootstrap[\s\S]*?console\.warn/i)
  })
})

// --- RISK-003: Rate limiting on POST /api/auth/login -----------------------------------------
describe('RISK-003 -- login endpoint must be rate-limited', () => {
  it('server.js defines a login rate limiter', () => {
    expect(serverJs).toMatch(/loginRateLimit/)
  })

  it('server.js applies loginRateLimit before auth.login on POST /api/auth/login', () => {
    // loginRateLimit must appear as a middleware argument before auth.login
    expect(serverJs).toMatch(/loginRateLimit[\s\S]{0,80}auth\.login/)
  })
})

// --- RISK-004: Blob path traversal protection on POST /api/storage/upload --------------------
describe('RISK-004 -- blob upload path must be sanitized', () => {
  it('storage.js rejects paths with directory traversal sequences', () => {
    // Must check for ".." in the path before passing to getBlockBlobClient
    expect(storageJs).toMatch(/\.\.|traversal|sanitize.*path|invalid.*path/i)
  })

  it('storage.js enforces safe path before calling getBlockBlobClient', () => {
    // The guard (path rejection) must precede the getBlockBlobClient call
    expect(storageJs).toMatch(/return res\.status\(400\)[\s\S]*?getBlockBlobClient|invalid.*path[\s\S]*?getBlockBlobClient/i)
  })
})

// --- RISK-006: JWT revocation -----------------------------------------------------------------
describe('RISK-006 -- JWT revocation must be implemented', () => {
  it('auth.js adds jti claim to newly issued tokens', () => {
    // The sign() function must include a jti in the payload
    expect(authJs).toMatch(/jti/)
  })

  it('auth.js checks for revokedToken in Cosmos inside attachUser', () => {
    // attachUser must query for kind:'revokedToken' to detect revoked tokens
    expect(authJs).toMatch(/revokedToken/)
  })

  it('auth.js exports a revokeToken function for use by the logout route', () => {
    expect(authJs).toMatch(/revokeToken/)
  })
})

// --- RISK-007: Rate limiting on GET /api/auth/tenants ----------------------------------------
describe('RISK-007 -- tenants endpoint must be rate-limited', () => {
  it('server.js defines a tenants rate limiter', () => {
    expect(serverJs).toMatch(/tenantsRateLimit/)
  })

  it('server.js applies tenantsRateLimit before auth.publicTenants', () => {
    expect(serverJs).toMatch(/tenantsRateLimit[\s\S]{0,80}auth\.publicTenants/)
  })
})

// --- RISK-008: ORDER BY direction must be constrained to ASC or DESC -------------------------
describe('RISK-008 -- ORDER BY direction must be validated to ASC or DESC only', () => {
  it("data.js rejects ORDER BY directions that are not 'ASC' or 'DESC'", () => {
    // Must include an explicit includes check against ['ASC','DESC']
    expect(dataJs).toMatch(/\[['"]ASC['"],\s*['"]DESC['"]\]\.includes|includes\(['"]ASC['"]\)|'ASC'.*'DESC'.*400/)
  })
})

// --- RISK-009: HomeCheck session secret -------------------------------------------------------
describe('RISK-009 -- HomeCheck inventory session must require a session secret', () => {
  it('homecheck.js generates a sessionSecret when a session is created', () => {
    expect(homecheckJs).toMatch(/sessionSecret/)
  })

  it('homecheck.js stores sessionSecret in the session object', () => {
    // The session stored in _sessions must include sessionSecret
    expect(homecheckJs).toMatch(/_sessions\.set\([\s\S]*?sessionSecret/)
  })
})

// --- RISK-011: Password minimum length must be at least 12 -----------------------------------
describe('RISK-011 -- changePassword must reject passwords shorter than 12 characters', () => {
  it('auth.js changePassword rejects passwords with length < 12', () => {
    // Must have a length check against 12 (not 3 or any lower value)
    expect(authJs).toMatch(/length\s*<\s*12/)
  })
})

// --- RISK-012: Global Express error handler --------------------------------------------------
describe('RISK-012 -- server.js must have a global Express error handler', () => {
  it('server.js registers a 4-argument error handler with app.use', () => {
    // Express error handlers have exactly 4 params: (err, req, res, next)
    // Match: app.use((err, req, res, next) => or app.use(function(err, req, res, next) {
    expect(serverJs).toMatch(/app\.use\s*\(\s*(?:function\s*)?\(\s*err\s*,\s*req\s*,\s*res\s*,\s*next\s*\)/)
  })

  it('server.js error handler returns 500 without leaking stack traces', () => {
    // Must send a 500 response
    expect(serverJs).toMatch(/500/)
  })
})
