# SECURITY_TENANCY — two-plane authz, tenant isolation, and Platform_Review F1-F12 re-verified (`d28c8a1`)

> `docs/reveng/` dossier. Platform_Review.md (2026-07-15, `artifacts/6_Documentation/`)
> published twelve findings (its section 10, F1-F12). Each is re-verified below against
> the POST-CLEANSE tree with a current status and evidence. Then the authorization model
> and tenant-isolation mechanics as built.

## 1. Platform_Review F1-F12 — refreshed statuses

| ID | Finding (2026-07-15) | Status at d28c8a1 | Evidence |
|---|---|---|---|
| F1 | Live credentials in plaintext working-tree files (`tmp_keys.md`, `model_secrets.md`, `tmp.md`) | **FIXED (with residue)** — all three files are GONE from the working tree (verified `ls`: no such file). Residue: `keys.md` (gitignored, repo root) is now the deliberate single creds source, and the key-rotation debt (DEF-0036) plus the stale `REACT_APP_*` App Service settings remain open — carried to RISK_REGISTER R1. | main-tree `ls tmp_keys.md model_secrets.md tmp.md` -> none; `keys.md` present |
| F2 | Plaintext password storage in Cosmos | **OPEN** — `changePassword` still persists `password: next` unhashed (`server/lib/auth.js:444-460`); no argon2/bcrypt anywhere. (Bootstrap COMPARISON is SHA-256 + timing-safe, `auth.js:369-370` — but stored user passwords are plaintext.) | `auth.js:460` |
| F3 | No HTTP security headers (helmet/CSP/HSTS/X-Frame-Options) | **OPEN** — grep for helmet/CSP/HSTS/X-Frame in `server/server.js` finds nothing; only `x-powered-by` disabled (`server.js:58`) | grep verified |
| F4 | Rate-limit / spend / OTP / revocation state per-process | **OPEN** — token buckets `server.js:127-144`, spend window `fleet.js:80-86`, OTP store, revocation cache `auth.js:161-179` all in-memory; only monthly metering is Cosmos-persisted (`metering.js:42-63`) | ARCHITECTURE.md sec 8 |
| F5 | Dual chunk/searchIndex schemes (seed vs runtime) | **OPEN** — seed writes `ent:groundingChunks~...` (`scripts/migrate-to-cosmos.ts:114,123,185`); runtime writes `chunk:<path>` co-partitioned (`data.js:145-175`); query-time text dedupe masks it | swarm-verified at HEAD |
| F6 | Unbounded version+audit growth; filing replay TOP 2000 | **OPEN** — every mutation writes `ver:` + `aud:` with no retention (`data.js:279-280`); `/db/versions` and filing replay cap at 2000 (`data.js:427-442`, `filing.js:109-112`). (NOTE: `origin/main`'s P4 wave touches history — not in this tree.) | `data.js:280` |
| F7 | `functions/` dead weight wired into the gate | **FIXED** — cleanse phase 2 unwired it from workspace+gate (`51ff5b5`) then removed it (`52a0253`, archived per CLEANSE_MANIFEST.md); `pnpm-workspace.yaml` now lists only `app`+`shared` | `pnpm-workspace.yaml:1-3` |
| F8 | Unbounded workbook decompression (zip bomb) on the no-cap path | **OPEN** — `workbook.js:87-96` still materializes 25 MB base64 fully via ExcelJS, no decompressed-size/cell-count ceiling | INGESTION_PIPELINE.md sec 9 |
| F9 | Bootstrap dev-default backdoor one env flag from production | **PARTIAL** — re-hardened (DEF-0041): a bootstrap account now EXISTS only when its password is explicitly env-configured, or behind the explicit `BOOTSTRAP_USERS_ENABLED=true` opt-in; with neither, 401 always; loud warn on default-password mode (`auth.js:84-106`). Still missing: a `NODE_ENV=production` refusal, and the flag is reportedly still `true` on the dev App Service (rotation needs human approval). The named `sal/scrudato` default still ships in code (`auth.js:100`). | `auth.js:84-106` |
| F10 | Pervasive fail-open on security-relevant reads | **OPEN (by design, documented)** — revocation check fail-open on Cosmos error (`auth.js:165-179`), tenant-suspension fail-open (`auth.js:272-280`), feature flags fail-open (`server.js:162-174`), tenant-budget check fail-open (`ai/index.js:38-41`). Mitigation nuance: the 5-min in-memory revocation cache stays authoritative through a Cosmos outage for entries it already holds (`auth.js:162-179`) | cited lines |
| F11 | No referential integrity across denormalized ref arrays | **OPEN** — only `parentId` is validated at write (`data.js:240-250`); `coverageRefIds`/`formNumbers`/`tableRefIds`/`productRefIds` can dangle after deletes; the import-side reconciler (`shared/src/insurance/filing/reconcile.ts`) never runs on hand edits | `data.js:240-250` |
| F12 | Doc/comment drift misleads a context-free agent | **OPEN (reduced)** — `Explorer.tsx:114` still says "Run pnpm seed to populate the hub"; `VITE_ALLOW_GUEST` has zero hits in `app/src` (dead flag, ADR-0004 describes a floor that no longer exists). Reduced: the cleanse deleted much of the stale doc surface (9 root docs, per the pre-cleanse git status). | grep verified |

Score: 2 FIXED, 1 PARTIAL, 9 OPEN — all 9 opens are operational/hardening items, none
is an access-control hole. Platform_Review's separate section-12 register (C1/H1/H2/
M1-M5/L1/L2) maps onto the same items and is folded into RISK_REGISTER.md.

## 2. The two-plane authorization model (as built)

Capabilities, not ranks, are authoritative (`server/lib/authz.js:41-65`, checked by
`hasCapability` `:76-80` and the middleware factories `:87-115`):

| Plane | Role | Capabilities |
|---|---|---|
| tenant | VIEWER + UNDERWRITING/COMPLIANCE/CLAIMS/ACTUARIAL/ANALYST | `product:read`, `ai:invoke` |
| tenant | EDITOR | + `product:write`, `filing:generate`, `changeset:approve` |
| tenant | TENANT_ADMIN (legacy ADMIN normalized at decode) | + `member:manage`, `role:assign`, `audit:read` |
| consumer | POLICYHOLDER (rank 0) | ONLY `portal:read`, `portal:upload` — structurally cannot reach `/api/db` |
| platform | SUPPORT | `product:read`, `audit:read`, `platform:impersonate` (no writes) |
| platform | SUPER_ADMIN | everything, incl. `platform:tenants/users/audit/impersonate` |

Layered enforcement (defense in depth, in order): global write floor
(`server.js:104-119`, default-deny `product:write` on non-GET) -> per-router mount floor
(`requirePlatform` / `member:manage`+same-tenant) -> per-route `requireCapability` ->
in-handler guards (reserved bases, quotas). VIEWER read-only is therefore enforced
twice before any handler runs.

Impersonation: SUPPORT mints a 1-hour token carrying the TARGET's tenant role with
`_impersonatedBy` dual attribution in every audit actor; platform roles can never be
impersonated (`auth.js:388-422`).

## 3. Identity mechanics

- JWT: hand-rolled HS256 done correctly — HMAC recomputed, token `alg` header ignored
  (no alg-confusion), timing-safe compare, `exp` enforced (`auth.js:119-127`); 8h TTL;
  `jti` revocation via Cosmos denylist + 5-min cache (`auth.js:161-179`); `pf_session`
  HttpOnly/SameSite=Lax/Secure cookie fallback (`auth.js:135-159`); Bearer wins over
  cookie (`auth.js:474`).
- OTP login: domain allowlist (`ALLOWED_EMAIL_DOMAINS`) -> tenant map
  (`TENANT_DOMAIN_MAP`) -> HMAC-hashed 6-digit OTP, 10-min TTL, 5 attempts, generic-200
  anti-enumeration, 10/hr/IP (`auth.js:283-356`). New users JIT-provision at VIEWER.
  CAVEAT: with `ALLOWED_EMAIL_DOMAINS` unset/empty, any domain may request an OTP and the
  tenant falls back to the domain slug (`auth.js:79-82`) — allow-all is the default.
- Tenant suspension blocks NEW logins at OTP verify (`auth.js:272-280`); existing JWTs
  ride out their 8h TTL.
- `AUTH_JWT_SECRET` is required fail-closed (server refuses to auth without it), locked by
  `server-invariants.test.ts`.

## 4. Tenant isolation mechanics — and where they are tested

Isolation is enforced server-side at four layers:

1. **Identity**: `tenantId` comes ONLY from the signed JWT
   (`resolveTenantForPrincipal`, `auth.js:541-542`); reserved envelope keys incl.
   `tenantId`/`pk` are stripped from every client payload (`data.js:214,226`).
2. **Partition**: pk = `${tenantId}|${baseKey(path)}` (`data.js:44`) — a tenant's data
   lives in tenant-prefixed logical partitions; presence pk = `${tid}:${pid}`.
3. **Query filter**: every list/read query adds `c.tenantId = @tid`
   (`data.js:94,120,433`); single-doc reads re-check `resource.tenantId`.
4. **Cross-tenant path**: only SUPER_ADMIN, only via the `X-Tenant-Id` break-glass
   header (`auth.js:486-488`); every mutation still lands in the TARGET tenant's audit
   log. `requireSameTenant` locks tenant admins to their own tenant (`authz.js:117-133`).

Tested at: `tests/server/integration.test.ts` (cross-tenant sections),
`app/src/__invariants__/server-invariants.test.ts` (parentId same-tenant read,
capability gates), the ops-plane live proof (21/21 incl. partition-scoped offboard with
tenant B untouched — `docs/audit/ops_live_results.json`), and `origin/main`'s H6a adds a
cross-tenant fail-closed CI gate (NOT in this tree). Platform_Review's independent
verdict — "No cross-tenant leak was found" — matched what this pass saw: no query without
a tenant filter was found in `server/lib/data.js`.

## 5. Audit integrity (tamper evidence)

Every mutation writes a SHA-256 hash-chained audit event + a `chn:<path>` chainHead
anchor in the SAME transactional batch (`data.js:279,284-286`); hash covers
`tenantId, entityPath, entityType, op, actor, rev, at, source, diff, prevHash`
(`shared/src/audit/chain.ts:118-122`) over canonical JSON so browser and server hash
byte-identically. `GET /api/db/audit/verify` reconstructs chains and reports
`hash_mismatch / link_broken / fork / orphaned / tail_missing` (`data.js:472-490`).
Tail truncation is detectable because the head anchor rides the batch and survives
entity deletes. Bounded x3 retry on 412 etag races (`data.js:303-317`).
System-plane audits (`loginAudit`, `platformAudit`, `impersonateAudit`) live in the
`__system__` partition (`auth.js:193-209`, `admin.js:37-49,579-592`).

## 6. Injection + output-safety posture

- SQL: field names allowlisted by regex, all values parameterized (`data.js` query
  builder) — no string-built SQL from client input.
- LLM: untrusted-content-as-data delimiting, forced tool calls, citation verification,
  and in-code discard of uncited output (INGESTION_PIPELINE.md sec 5); the portal
  additionally double-sanitizes model HTML (`app/src/routes/portal/sanitizeHtml.ts` +
  server-side scrub). Platform_Review M4 (import path lacks the portal's output-scrub
  discipline) remains open.
- The "Scrudato check" folklore: NOT an authorization bypass — the only functional
  occurrence is the bootstrap dev-default password (`auth.js:100`); no
  `if (name === 'Scrudato')` branch exists (confirmed by Platform_Review sec 12 and
  re-grepped at this tree).

## 7. What a zero-context agent must not break

1. Never weaken the write floor (`server.js:104-119`) — new POST routes are deny-by-
   default until whitelisted; whitelisting a prefix silently exempts every sub-route.
2. Any new Cosmos write in `server/` must be added to the no-bare-writes allowlist WITH a
   rationale (`app/src/__invariants__/no-bare-writes.test.ts:27-60`) or the gate reds.
3. Never strip the audit ops from the envelope batch; never write into the `filings` base
   via mutate (403 reserved, `data.js:220-224`).
4. `tenantId` is never read from a request body. Ever.
