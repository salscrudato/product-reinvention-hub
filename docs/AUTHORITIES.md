# Authorization Authorities

Two-plane capability model introduced in feat(authz): Prompt 3.

## Planes

| Plane    | Roles | Scope |
|----------|-------|-------|
| PLATFORM | `SUPER_ADMIN`, `SUPPORT` | Cross-tenant; operate the SaaS across all orgs |
| TENANT   | `TENANT_ADMIN`, `EDITOR`, inquiry personas (`UNDERWRITING`, `COMPLIANCE`, `CLAIMS`, `ACTUARIAL`, `ANALYST`), `VIEWER` | Scoped to one org (`tenantId`) |

Inquiry-only personas (`UNDERWRITING`, `COMPLIANCE`, `CLAIMS`, `ACTUARIAL`, `ANALYST`) can read and invoke AI but **never write**.

## Capabilities

| Capability | Description |
|---|---|
| `product:read` | Read products, coverages, rules, forms, pricing, states |
| `product:write` | Create / update / delete products and sub-entities (via `mutate()`) |
| `ai:invoke` | Invoke AI endpoints (chat, summarize, scaffold, draft-rule, etc.) |
| `filing:generate` | Generate DuckCreek or SERFF filing artifacts |
| `changeset:approve` | Approve changesets (wired; approval workflow deferred) |
| `member:manage` | Invite and remove members within own tenant |
| `role:assign` | Change member roles within own tenant |
| `audit:read` | Read the audit / version history within own tenant |
| `platform:tenants` | Create / delete tenant records (SUPER_ADMIN only) |
| `platform:users` | Create / delete global user records across tenants (SUPER_ADMIN only) |
| `platform:audit` | Read audit across all tenants (SUPER_ADMIN only) |
| `platform:impersonate` | Impersonate a tenant user for support (dual-attributed, time-boxed) |

## Role-to-Capability Matrix

| Role | `product:read` | `product:write` | `ai:invoke` | `filing:generate` | `changeset:approve` | `member:manage` | `role:assign` | `audit:read` | `platform:*` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `VIEWER` | Y | | | | | | | | |
| `UNDERWRITING` | Y | | Y | | | | | | |
| `COMPLIANCE` | Y | | Y | | | | | | |
| `CLAIMS` | Y | | Y | | | | | | |
| `ACTUARIAL` | Y | | Y | | | | | | |
| `ANALYST` (legacy) | Y | | Y | | | | | | |
| `EDITOR` | Y | Y | Y | Y | Y | | | | |
| `TENANT_ADMIN` | Y | Y | Y | Y | Y | Y | Y | Y | |
| `SUPPORT` | Y | | | | | | | Y | `platform:impersonate` |
| `SUPER_ADMIN` | Y | Y | Y | Y | Y | Y | Y | Y | all |

> `ADMIN` is a **legacy alias** for `TENANT_ADMIN`. It is normalized at JWT-decode time (`normalizeRole()` in `auth.js`) and carries identical capabilities. No new records should use `ADMIN`; prefer `TENANT_ADMIN`.

## Enforcement

`Authority = (plane, role, tenantId, capability)`. Every privileged action is checked server-side.

| Middleware | File | Purpose |
|---|---|---|
| `requireCapability(cap)` | `server/lib/authz.js` | Tenant-plane capability gate. Checks: authed, has cap, has tenantId (non-platform). |
| `requirePlatform(cap?)` | `server/lib/authz.js` | Platform-plane gate. Checks: authed, is SUPER_ADMIN or SUPPORT, has cap (if given). |
| `requireSameTenant()` | `server/lib/authz.js` | Cross-tenant write block. Rejects if `req.user.tenantId` != requested tenantId (SUPER_ADMIN exempt). |
| `requireAuth` | `server/lib/auth.js` | Presence check: 401 if no user. |
| `requireTenant` | `server/lib/auth.js` | TenantId presence: 409 if no tenantId (SUPER_ADMIN exempt; SUPPORT NOT exempt). |

## Route-to-Capability Mapping (authoritative)

| Route | Capability | Notes |
|---|---|---|
| `GET /api/db/get` | auth | Any authenticated user |
| `POST /api/db/list` | auth + tenantId | Any authenticated user with a tenant |
| `POST /api/db/mutate` | `product:write` + tenantId | EDITOR, TENANT_ADMIN, SUPER_ADMIN |
| `POST /api/db/mutateBatch` | `product:write` + tenantId | Same |
| `POST /api/db/vote` | `product:write` + tenantId | Same |
| `POST /api/db/setNewsPins` | `product:write` + tenantId | Same + uid-match |
| `POST /api/db/presence/join` | `product:write` + tenantId | Same |
| `POST /api/db/presence/watch` | auth + tenantId | Any authenticated |
| `POST /api/ai/:name` | `ai:invoke` + tenantId | ANALYST+, EDITOR+, TENANT_ADMIN+, SUPER_ADMIN |
| `POST /api/ai/reindexProduct` | `product:write` + tenantId | EDITOR+, TENANT_ADMIN+, SUPER_ADMIN |
| `POST /api/ai/:name (draftRule, scaffoldProduct, unifiedImport)` | `product:write` (inline) | EDITOR+, TENANT_ADMIN+, SUPER_ADMIN |
| `POST /api/storage/upload` | `EDITOR+` (rank) | No capability migration yet; rank check still correct |
| `/api/duckcreek/v1/*` | `EDITOR+` (rank) | No capability migration yet; rank check still correct |
| `/api/serff/v1/bundle` | `EDITOR+` (rank) | No capability migration yet; rank check still correct |
| `GET /api/tenant-admin/members` | `member:manage` + same-tenant | TENANT_ADMIN only |
| `POST /api/tenant-admin/members` | `member:manage` + `role:assign` + same-tenant | TENANT_ADMIN only |
| `PATCH /api/tenant-admin/members/:u/role` | `member:manage` + `role:assign` + same-tenant | TENANT_ADMIN only |
| `DELETE /api/tenant-admin/members/:u` | `member:manage` + same-tenant | TENANT_ADMIN only |
| `GET /api/tenant-admin/audit` | `audit:read` + same-tenant | TENANT_ADMIN only |
| `GET /api/admin/tenants` | `platform:tenants` | SUPER_ADMIN only |
| `POST /api/admin/tenants` | `platform:tenants` | SUPER_ADMIN only |
| `DELETE /api/admin/tenants/:id` | `platform:tenants` | SUPER_ADMIN only |
| `GET /api/admin/users` | `platform:users` | SUPER_ADMIN only |
| `POST /api/admin/users` | `platform:users` | SUPER_ADMIN only |
| `DELETE /api/admin/users/:u` | `platform:users` | SUPER_ADMIN only |
| `POST /api/admin/impersonate` | `platform:impersonate` | SUPER_ADMIN + SUPPORT |

## Impersonation Rules

- Only `SUPPORT` and `SUPER_ADMIN` may call `POST /api/admin/impersonate`.
- The resulting token carries the **target user's tenant-plane role** — never a platform role.
- `signImpersonation()` throws if the target is `SUPER_ADMIN` or `SUPPORT`.
- The token is time-boxed to **1 hour** (vs 12 h for normal sessions).
- Every audit record written during an impersonation session includes `impersonatedBy: { uid, name, email }` (dual-attribution).
- An immutable `impersonateAudit` record is written to `__system__` at creation.

## Migration Map (old → new)

| Old role | New role | Access change |
|---|---|---|
| `VIEWER` | `VIEWER` | None |
| `ANALYST` | `ANALYST` | None |
| `EDITOR` | `EDITOR` | None |
| `ADMIN` | `TENANT_ADMIN` | Scope clarified: own org only. No wider access. |
| `SUPER_ADMIN` | `SUPER_ADMIN` (platform plane) | None |

The migration is transparent: `ADMIN` JWTs are normalized to `TENANT_ADMIN` at decode time by `normalizeRole()` in `auth.js`. No Cosmos records need to be rewritten.
