// canI.ts -- client-side capability helper (supplementary UI gating only).
// The SERVER is always the authoritative gate. These checks exist to hide UI
// elements that the server would reject, reducing confusion — they do NOT
// replace server-side enforcement.
//
// The role-to-capability mapping here MUST stay in sync with server/lib/authz.js.
import type { Capability } from './backend/types'

// Duck-typed: any object with a role field works (AuthUser, UserProfile, etc.).
interface HasRole { role?: string | null }

const ROLE_CAPS: Record<string, Capability[]> = {
  VIEWER:       ['product:read', 'ai:invoke'],
  UNDERWRITING: ['product:read', 'ai:invoke'],
  COMPLIANCE:   ['product:read', 'ai:invoke'],
  CLAIMS:       ['product:read', 'ai:invoke'],
  ACTUARIAL:    ['product:read', 'ai:invoke'],
  ANALYST:      ['product:read', 'ai:invoke'],
  EDITOR:       ['product:read', 'product:write', 'ai:invoke', 'filing:generate', 'changeset:approve'],
  TENANT_ADMIN: ['product:read', 'product:write', 'ai:invoke', 'filing:generate', 'changeset:approve', 'member:manage', 'role:assign', 'audit:read'],
  ADMIN:        ['product:read', 'product:write', 'ai:invoke', 'filing:generate', 'changeset:approve', 'member:manage', 'role:assign', 'audit:read'],
  SUPPORT:      ['product:read', 'audit:read', 'platform:impersonate'],
  POLICYHOLDER: ['portal:read', 'portal:upload'],
  SUPER_ADMIN:  ['product:read', 'product:write', 'ai:invoke', 'filing:generate', 'changeset:approve', 'member:manage', 'role:assign', 'audit:read', 'platform:tenants', 'platform:users', 'platform:audit', 'platform:impersonate'],
}

const PLATFORM_ROLES = new Set(['SUPER_ADMIN', 'SUPPORT'])

export function canI(user: HasRole | null | undefined, cap: Capability): boolean {
  if (!user?.role) return false
  const caps = ROLE_CAPS[user.role] || []
  return caps.includes(cap)
}

export function isPlatform(user: HasRole | null | undefined): boolean {
  return PLATFORM_ROLES.has(user?.role ?? '')
}

export function isTenantAdmin(user: HasRole | null | undefined): boolean {
  return user?.role === 'TENANT_ADMIN' || user?.role === 'ADMIN'
}
