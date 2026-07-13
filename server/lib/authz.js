'use strict'
// authz.js -- two-plane capability model.
//
// PLANE         | ROLES
// platform      | SUPER_ADMIN, SUPPORT
// tenant        | TENANT_ADMIN, EDITOR, ANALYST, VIEWER, + inquiry personas
//               | (UNDERWRITING, COMPLIANCE, CLAIMS, ACTUARIAL)
//
// Authority = (plane, role, tenantId, capability). Every privileged action is
// checked server-side via requireCapability() or requirePlatform(). Role-string
// comparisons are replaced by these middleware factories throughout server/lib.
//
// auth.js (attachUser) must run BEFORE any authz middleware so that req.user is set.

// ─── Capability constants ────────────────────────────────────────────────────
// Tenant-plane capabilities
const CAP_PRODUCT_READ      = 'product:read'
const CAP_PRODUCT_WRITE     = 'product:write'
const CAP_AI_INVOKE         = 'ai:invoke'
const CAP_FILING_GENERATE   = 'filing:generate'
const CAP_CHANGESET_APPROVE = 'changeset:approve'  // wired; approval workflow deferred
const CAP_MEMBER_MANAGE     = 'member:manage'
const CAP_ROLE_ASSIGN       = 'role:assign'
const CAP_AUDIT_READ        = 'audit:read'
// Platform-plane capabilities
const CAP_PLATFORM_TENANTS     = 'platform:tenants'
const CAP_PLATFORM_USERS       = 'platform:users'
const CAP_PLATFORM_AUDIT       = 'platform:audit'
const CAP_PLATFORM_IMPERSONATE = 'platform:impersonate'

// ─── Role -> capability matrix ───────────────────────────────────────────────
// This is the authoritative mapping. docs/AUTHORITIES.md mirrors it in prose.
// Inquiry-only personas (UNDERWRITING, COMPLIANCE, CLAIMS, ACTUARIAL) get
// product:read + ai:invoke — they can never write.
const ROLE_CAPS = {
  // Tenant plane — inquiry personas (read + AI only)
  // VIEWER holds ai:invoke for the read-only copilot chat; every write surface is
  // still closed to it (no product:write) and the server-side write gate + per-route
  // capability checks reject any VIEWER mutation.
  VIEWER:       [CAP_PRODUCT_READ, CAP_AI_INVOKE],
  UNDERWRITING: [CAP_PRODUCT_READ, CAP_AI_INVOKE],
  COMPLIANCE:   [CAP_PRODUCT_READ, CAP_AI_INVOKE],
  CLAIMS:       [CAP_PRODUCT_READ, CAP_AI_INVOKE],
  ACTUARIAL:    [CAP_PRODUCT_READ, CAP_AI_INVOKE],
  ANALYST:      [CAP_PRODUCT_READ, CAP_AI_INVOKE],  // legacy; maps to inquiry persona set
  // Tenant plane — editors
  EDITOR:       [CAP_PRODUCT_READ, CAP_PRODUCT_WRITE, CAP_AI_INVOKE, CAP_FILING_GENERATE, CAP_CHANGESET_APPROVE],
  // Tenant plane — admin (manages own org)
  TENANT_ADMIN: [CAP_PRODUCT_READ, CAP_PRODUCT_WRITE, CAP_AI_INVOKE, CAP_FILING_GENERATE, CAP_CHANGESET_APPROVE, CAP_MEMBER_MANAGE, CAP_ROLE_ASSIGN, CAP_AUDIT_READ],
  ADMIN:        [CAP_PRODUCT_READ, CAP_PRODUCT_WRITE, CAP_AI_INVOKE, CAP_FILING_GENERATE, CAP_CHANGESET_APPROVE, CAP_MEMBER_MANAGE, CAP_ROLE_ASSIGN, CAP_AUDIT_READ],  // legacy alias, normalized at JWT decode
  // Platform plane
  SUPPORT:      [CAP_PRODUCT_READ, CAP_AUDIT_READ, CAP_PLATFORM_IMPERSONATE],
  SUPER_ADMIN:  [CAP_PRODUCT_READ, CAP_PRODUCT_WRITE, CAP_AI_INVOKE, CAP_FILING_GENERATE, CAP_CHANGESET_APPROVE, CAP_MEMBER_MANAGE, CAP_ROLE_ASSIGN, CAP_AUDIT_READ, CAP_PLATFORM_TENANTS, CAP_PLATFORM_USERS, CAP_PLATFORM_AUDIT, CAP_PLATFORM_IMPERSONATE],
}

// Platform-plane roles. These are NOT bound to a tenantId; they can read across
// tenants or use the X-Tenant-Id override (SUPER_ADMIN) / impersonation (SUPPORT).
const PLATFORM_ROLES = new Set(['SUPER_ADMIN', 'SUPPORT'])

// Managed roles: roles that a TENANT_ADMIN may assign to members of their org.
// Never includes platform roles; never includes ADMIN (legacy) or SUPER_ADMIN.
const TENANT_MANAGED_ROLES = ['VIEWER', 'UNDERWRITING', 'COMPLIANCE', 'CLAIMS', 'ACTUARIAL', 'ANALYST', 'EDITOR', 'TENANT_ADMIN']

// ─── Core capability check ───────────────────────────────────────────────────
function hasCapability(user, cap) {
  if (!user || !user.role) return false
  const caps = ROLE_CAPS[user.role] || []
  return caps.includes(cap)
}

// ─── requireCapability(cap) ──────────────────────────────────────────────────
// Primary middleware for all privileged actions. Checks:
//   1. User authenticated (401)
//   2. User has the capability (403)
//   3. Non-platform users must have a tenantId (409)
function requireCapability(cap) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' })
    if (!hasCapability(req.user, cap)) {
      return res.status(403).json({ error: 'forbidden', need: cap, have: req.user.role })
    }
    // Tenant-scoped: non-platform users must be bound to a tenant
    if (!PLATFORM_ROLES.has(req.user.role) && !req.user.tenantId) {
      return res.status(409).json({ error: 'no_tenant_selected' })
    }
    next()
  }
}

// ─── requirePlatform(cap?) ───────────────────────────────────────────────────
// Gate for platform-plane operations. Requires the caller to be on the platform
// plane (SUPER_ADMIN or SUPPORT). Optional second capability check.
function requirePlatform(cap) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' })
    if (!PLATFORM_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'forbidden', detail: 'platform role required', have: req.user.role })
    }
    if (cap && !hasCapability(req.user, cap)) {
      return res.status(403).json({ error: 'forbidden', need: cap, have: req.user.role })
    }
    next()
  }
}

// ─── requireSameTenant(getTidFn?) ───────────────────────────────────────────
// Enforces that a tenant-admin caller can only operate on their own org.
// SUPER_ADMIN bypasses (they are cross-tenant by design).
// getTidFn: optional function(req) => tenantId to check against (default: req.user.tenantId).
function requireSameTenant(getTidFn) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' })
    // SUPER_ADMIN is cross-tenant; no same-tenant restriction.
    if (req.user.role === 'SUPER_ADMIN') return next()
    const requestedTid = typeof getTidFn === 'function' ? getTidFn(req) : req.user.tenantId
    if (!req.user.tenantId) return res.status(409).json({ error: 'no_tenant_selected' })
    if (req.user.tenantId !== requestedTid) {
      return res.status(403).json({ error: 'cross_tenant_forbidden' })
    }
    next()
  }
}

module.exports = {
  // Capability constants
  CAP_PRODUCT_READ, CAP_PRODUCT_WRITE, CAP_AI_INVOKE,
  CAP_FILING_GENERATE, CAP_CHANGESET_APPROVE,
  CAP_MEMBER_MANAGE, CAP_ROLE_ASSIGN, CAP_AUDIT_READ,
  CAP_PLATFORM_TENANTS, CAP_PLATFORM_USERS, CAP_PLATFORM_AUDIT, CAP_PLATFORM_IMPERSONATE,
  // Role sets + matrix
  ROLE_CAPS, PLATFORM_ROLES, TENANT_MANAGED_ROLES,
  // Helpers + middleware
  hasCapability, requireCapability, requirePlatform, requireSameTenant,
}
