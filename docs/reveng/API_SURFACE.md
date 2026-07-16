# API_SURFACE — every /api route at `d28c8a1`

> `docs/reveng/` dossier. Routes enumerated by grepping `router.(get|post|patch|put|delete)`
> and `app.(get|post)` across `server/server.js` and `server/lib/*.js` — line numbers are the
> route definitions. Global gauntlet (auth floor, write gate, tenant bucket, flags) applies
> before every route: see ARCHITECTURE.md section 3. "Tenant" column: how the tenant is
> resolved — always server-side from the JWT (`resolveTenantForPrincipal`,
> `server/lib/auth.js:541-542`); SUPER_ADMIN may override per-request via `X-Tenant-Id`
> (`auth.js:486-488`). No route trusts a client-supplied tenantId in the body.

Route count: **62 explicitly mounted route handlers** (plus the `/:name` AI dispatcher
fanning out to 13 named handlers). SSE = server-sent events stream response.

## 1. Health + auth (`server/server.js`)

| Method | Path | Guard | Tenant | Req -> Res | SSE |
|---|---|---|---|---|---|
| GET | `/api/health` (`server.js:177`) | public, no-store | — | -> `{status:'ok'}` (verified live in local boot) | no |
| POST | `/api/auth/otp/request` (`:183`) | public + 10/hr/IP | derived from email domain | `{email}` -> generic 200 (anti-enumeration) | no |
| POST | `/api/auth/otp/verify` (`:184`) | public + limiter | JIT-provision VIEWER | `{email, code}` -> JWT + `pf_session` cookie | no |
| POST | `/api/auth/bootstrap` (`:186`) | public + limiter; only if `BOOTSTRAP_USERS_ENABLED` | — | `{username, password}` -> SUPER_ADMIN JWT (`auth.js:92-106`) | no |
| GET | `/api/auth/tenants` (`:187`) | public + 60/hr/IP | — | -> `[{id, name}]` (the only SW-cached API) | no |
| GET | `/api/auth/me` (`:188`) | auth | JWT | -> user + flags | no |
| POST | `/api/auth/logout` (`:189`) | auth | — | revokes jti (Cosmos + 5-min cache) then clears cookie | no |
| POST | `/api/auth/change-password` (`:190`) | auth | JWT | `{current, next}` | no |

## 2. Data plane `/api/db` (`server/lib/data.js`)

| Method | Path | Guard | Req -> Res | SSE |
|---|---|---|---|---|
| GET | `/api/db/get` (`data.js:83`) | `product:read` | `?path=` -> entity doc | no |
| POST | `/api/db/list` (`:90`) | `product:read` (read-shaped POST, write-gate exempt) | `{path, query}` -> rows (MAX_LIST 6000, cursor pages of 500) | no |
| POST | `/api/db/mutate` (`:321`) | `product:write` | `{op, path, data, entityType, expectedRev}` -> `{rev}`; 409 on stale rev; 422 INVALID_PARENT; 403 RESERVED_BASE (`filings`); product-create checks per-tenant quota (`:328-332`) | no |
| POST | `/api/db/mutateBatch` (`:345`) | `product:write` | `{payloads[]}` grouped by pk, <=96-op transactional chunks; reports `batch_partial` (not cross-partition atomic) | no |
| POST | `/api/db/vote` (`:384`) | `product:write` | toggle voter uid in `entity.votes` | no |
| POST | `/api/db/setNewsPins` (`:395`) | `product:write` | upsert `newsPrefs/{uid}` pinnedHashes | no |
| POST | `/api/db/presence/join` (`:404`) | `product:write` | heartbeat upsert to `presence` container (non-entity, un-audited by design) | no |
| POST | `/api/db/presence/watch` (`:410`) | auth (read-shaped POST) | `{pid}` -> viewer uids | no |
| GET | `/api/db/versions` (`:427`) | `product:read` | `?productId=&limit=` -> version docs (cap 2000) | no |
| GET | `/api/db/audit` (`:449`) | `audit:read` + `PROBE_MODE=1` env | raw audit docs for a path (probe-only) | no |
| GET | `/api/db/audit/verify` (`:472`) | `audit:read` | reconstructs hash chains -> `{ok, checked, legacy, paths, breaks}` (hash_mismatch/link_broken/fork/orphaned/tail_missing; MAX_VERIFY 10000) | no |

## 3. AI plane `/api/ai` (`server/lib/ai/index.js`)

Single dispatcher `POST /api/ai/:name` (`ai/index.js:28`) guarded `ai:invoke` + tenant;
plus `registerReindexRoute(router)` (`:26`) mounting `POST /api/ai/reindexProduct`.
Per-tenant MONTHLY token budget throttle (429) applies to every name EXCEPT
`unifiedImport`/`unifiedImportResult` (`ai/index.js:36-41` — the no-cap invariant; the
result fetch is exempt because a 429 would break exactly the reconnect the persistence
exists for). The global 1h cost breaker (`fleet.guard`) is checked inside each handler.
Write-shaped names (`unifiedImport`, `reindexProduct`) additionally require
`product:write` at the global gate (`server.js:102,111-114`).

| Name | Handler | What | SSE |
|---|---|---|---|
| `chat` | `server/lib/ai/chat.js` | grounded portfolio copilot, hybrid RAG, citation-verified | yes |
| `summarizeProduct` | `summarize-product.js` | cited product summary | no |
| `unifiedImport` | `unified-import.js:200` | THE import brain entry (see INGESTION_PIPELINE.md) | yes |
| `unifiedImportResult` | `unified-import.js` | F23 durable-run recovery fetch, zero AI calls, works with AI unconfigured | no |
| `scaffoldProduct` | `scaffold-product.js` | AI product scaffold (lineage AI_SCAFFOLD) | no |
| `draftRule` | `draft-rule.js` | rule drafting | no |
| `analyzeClaim` | `analyze-claim.js` | claims coverage determination (form-grounded) | yes |
| `proposeMapping` | `propose-mapping.js` | concept-linker AI overlay (fill-only; NOT budget-exempt) | no |
| `shapeFeedback` | `shape-feedback.js` | feedback -> user story (haiku) | no |
| `refreshNews` | `refresh-news.js` | industry news refresh | no |
| `taskSummary` | `task-summary.js` | cited GTM task summary | no |
| `formRiskReport` | `form-risk-report.js` | insured-centric form risk report | no |
| `identifyBaseForm` | `identify-base-form.js` | base-form id (regex fallback works AI-less, `ai/index.js:46`) | no |
| `reindexProduct` | `reindex-product.js` | rebuild grounding chunks (write-shaped; the 1 allowlisted bare write) | no |

Unknown names -> 501 `ai_handler_not_ported` (`ai/index.js:63`); AI unconfigured -> 503
`ai_not_configured` except the two AI-less names (`:48-50`, observed in the local boot:
`AI configured=false` still mounts the router).

## 4. Platform admin `/api/admin` (`server/lib/admin.js`) — `requirePlatform` floor

| Method | Path | Extra cap | What |
|---|---|---|---|
| GET | `/tenants` (`admin.js:54`) | `platform:tenants` | list tenants (paged) |
| POST | `/tenants` (`:97`) | 〃 | provision tenant (+optional seed via `seed-shared.cjs`) |
| PATCH | `/tenants/:id` (`:148`) | 〃 | rename/suspend/reactivate |
| DELETE | `/tenants/:id` (`:167`) | 〃 | delete tenant record |
| GET | `/tenants/:id/summary` (`:177`) | 〃 | entity counts, users, meter |
| GET | `/tenants/:id/export` (`:282`) | 〃 | full-tenant JSON export (in-memory, up to 200k docs — known robustness gap) |
| POST | `/tenants/:id/offboard` (`:297`) | 〃 | partition-scoped hard delete |
| GET/PUT | `/config/global` (`:345,:350`) | 〃 | platform config registry |
| GET/PUT | `/tenants/:id/config` (`:360,:371`) | 〃 | per-tenant config/flags/entitlements |
| GET | `/tenants/:id/telemetry` (`:387`) | 〃 | request + AI meter snapshots |
| POST | `/ops-copilot/ask` (`:425`) | platform | cited ops copilot (propose -> human-confirm -> audited) |
| GET/POST | `/users` (`:428,:446`) | `platform:users` | platform user CRUD |
| PATCH/DELETE | `/users/:username` (`:470,:499`) | 〃 | update / delete |
| POST | `/audit/search` (`:517`) | `platform:audit` | search platform audit (`__system__` partition) |
| POST | `/impersonate` (`:564`) | `platform:impersonate` | mint 1h dual-attributed token; platform targets refused (`auth.js:388-422`) |

## 5. Tenant admin `/api/tenant-admin` (`server/lib/tenant-admin.js`) — `member:manage` + same-tenant floor

| Method | Path | Extra cap | What |
|---|---|---|---|
| GET | `/members` (`tenant-admin.js:63`) | — | list members |
| POST | `/members` (`:84`) | `role:assign` | invite/create member |
| PATCH | `/members/:username/role` (`:126`) | `role:assign` | change role |
| DELETE | `/members/:username` (`:152`) | — | remove member |
| PATCH | `/members/:username/disabled` (`:172`) | `role:assign` | enable/disable |
| GET | `/audit` (`:194`) | `audit:read` | tenant audit feed |
| GET | `/config` (`:218`) | — | tenant config + flags |
| PUT | `/flags` (`:234`) | `role:assign` | per-tenant flag overrides (allowlist-sanitized) |

## 6. Filing + SERFF

| Method | Path | Guard | What | SSE |
|---|---|---|---|---|
| POST | `/api/filing/generate` (`filing.js:476`) | `filing:generate` | product diff -> regulatory filing record; CREATE-only batch (filing + audit + chainHead); AI verifier (MID_REASONER, escalates to opus on 404 rung) must pass before freeze; tamper -> 422 | no |
| GET | `/api/filing` (`:658`) | `filing:generate` | list filings | no |
| GET | `/api/filing/:filingId` (`:682`) | 〃 | one filing (immutable; `filings` base is mutate-reserved, `data.js:220`) | no |
| POST | `/api/serff/v1/bundle` (`serff.js:166`) | EDITOR role | SERFF TX bundle from product diff (`serff-shared.cjs` engine) | no |
| GET | `/api/serff/v1/states` (`:253`) | auth | supported states | no |

## 7. Storage + news images

| Method | Path | Guard | What |
|---|---|---|---|
| POST | `/api/storage/upload` (`storage.js:57`) | EDITOR | base64 chunked upload -> Blob; 15 MB cap + content-type allowlist; honest 413/415 |
| GET | `/api/storage/url` (`storage.js:83`) | auth | read URL for a blob path |
| GET | `/api/news/image/:hash` (`server.js:226`) | auth | Blob-persisted news thumbnail stream (`news-image.js`) |

## 8. Policyholder portal `/api/portal` (`server/lib/portal.js`) — consumer plane

| Method | Path | Guard | What |
|---|---|---|---|
| GET | `/me` (`portal.js:520`) | `portal:read` | policyholder profile |
| POST | `/upload` (`:532`) | `portal:upload` | policy PDF upload (size/type enforced in storage.js) |
| POST | `/summary` (`:595`) | `portal:read` | judged, sanitized HTML policy summary (double-sanitized model output) |

POLICYHOLDER (rank 0) holds only `portal:*` caps (`authz.js:41-65`) — structurally cannot
reach `/api/db`. Portal is on the write-gate exempt prefix list (`server.js:100`), its own
capability gates apply instead.

## 9. HomeCheck guest surface `/api/homecheck/v1` (`server/lib/homecheck.js`) — no auth, per-IP limited

| Method | Path | What |
|---|---|---|
| POST | `/risk` (`homecheck.js:962`) | address -> hazard risk report (Census geocode + FEMA NRI/NFHL + USGS + NWS via `server/lib/external/hazards.js`) |
| POST | `/report-html` (`:979`) | render report HTML |
| POST | `/inventory` (`:994`) | consent-gated vision home inventory (24h TTL sessions) |
| GET | `/inventory/:sessionId` (`:1063`) | fetch session |
| DELETE | `/inventory/:sessionId` (`:1072`) | delete session |
| GET | `/inventory/:sessionId/export` (`:1081`) | export inventory |
| POST | `/twin-diff` (`:1095`) | compare two inventories |

Structurally isolated: `homecheck.js` imports no cosmos/data/auth modules — the
zero-portfolio-access property is architectural, not asserted (confirmed by
Platform_Review section 12 and re-checked: only `external/*` + in-memory sessions).

## 10. SPA + fallthrough

- Static `public/` assets, then `GET *` -> SPA `index.html` with hashed-asset 404 handling
  (`server.js:296-322`).
- 4-arg error handler: honest 413/400 pass-through, no stack leak (`server.js:328-346`).

## 11. Cross-cutting request/response conventions

- Client transport: `api()` in `app/src/lib/backend/azure.adapter.ts:39-77` — same-origin,
  Bearer header, 401 -> full local sign-out, 409 -> `MutationConflictError`, 204 -> undefined.
- SSE consumers use `adapter.fns.stream()` (`azure.adapter.ts:370-393`); server keeps SSE
  uncompressed (`server.js:61-65`) + 15s `:hb` heartbeat on import.
- All list queries are field-name allowlisted by regex and value-parameterized
  (`server/lib/data.js` query builder) — no SQL injection surface via `/db/list`.
- Rate limits: login 10/hr/IP, tenants 60/hr/IP (`server.js:183-187`), per-tenant bucket
  120 burst / 2 rps on AI+filing+mutate (`server.js:127-144`), per-tenant monthly AI token
  budget -> 429 (`metering.js:101-106`), global 1h AI spend ceiling -> 503
  (`fleet.js:99-105`).
