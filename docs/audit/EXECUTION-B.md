# EXECUTION-B — Lane B: Filing generation with independent verifier

Prompt F2 Lane-B. Objective: five-step filing flow (SCOPE → RESOLVE → BUILD → VERIFY → FREEZE),
gated at the front (filing:generate, VIEWER server-blocked), frozen at the back (create-only,
hash-covered), with an independent MID_REASONER model verifier blocking fabrication before freeze.

## Orientation findings (reconciled with live code before designing)

- `server/lib/filing.js` **already implements the five-step flow** (built in the audit-integrity
  workstream, live-verified at `c132146`): capability gate, as-of version-history resolution,
  deterministic package + SHA-256 content/package hashes, write-once blob (`ifNoneMatch:'*'`),
  independent verifier with forced `extraction_verdict` tool call, create-only transactional
  freeze batch (filing + hash-chained audit + chainHead).
- Gaps vs this prompt:
  1. Verifier ran on **GROUNDED_CITED** (opus). Prompt requires the **MID_REASONER** role
     (claude-sonnet-5). The sonnet Foundry deployment may be unprovisioned on dev
     (import-brain caches its 404s), so the verifier needs a documented escalation:
     MID_REASONER first, climb the fleet ladder only on a missing deployment.
  2. No live tamper proof: need a probe that feeds the verifier a fabricated/altered field
     and can NEVER freeze, so the rejection path is provable end-to-end on dev.
  3. Immutability proof: mutate envelope ids (`ent:`/`ver:`/`idx:`/`chn:`) can never collide
     with `filing:*` ids, but `/api/db/mutate` with a `filings/...` path could still write
     entity docs into the reserved `${tenant}|filings` partition and upsert a colliding
     `chn:filings~<id>` chainHead. Adding an explicit reserved-base rejection (403).

## Work log

| When (ET) | What | Cost |
|---|---|---|
| start | Orientation: filing.js/fleet.js/data.js/auth.js/authz.js reconciled; row claimed | — |
| wave 1 | Verifier → MID_REASONER + ladder; tamper probe; RESERVED_BASES guard; tests; harness. Gate: typecheck ✅ lint ✅ test ✅ (907+186). Local `pnpm build` red on ANOTHER agent's uncommitted app edits (Landing/Pricing); verified my exact commit via detached worktree `tsc -b` = 0 + zero vite-graph delta. Pushed `9be28d0` (fast-forward, origin unmoved). | within envelope |
| wave 2 | Pipeline run 2427 (`9be28d0`) green, deployed. Live proof on dev: **15/15 checks** (`scripts/filing-live.mts` → `docs/audit/filing_live_results.json`), isolated tenant `filing-live-b`, torn down after. | within envelope |

## Live proof (dev, run 2427 deploy — transcript in filing_live_results.json)

All 15 checks passed:

1. **SCOPE** — server-minted VIEWER token (admin user-create + audited impersonation seam) →
   `POST /api/filing/generate` = **403** `{need:'filing:generate', have:'VIEWER'}`. Same VIEWER
   token CAN read (`GET /api/filing` = 200, product:read).
2. **RESOLVE** — filed fieldValues reconstructed from real version history: seeded coverage at
   limit 1,000,000 then updated to 2,000,000; the filed item folds the update rev
   (`limit=2000000`), `refId=FLB.COV.001` and `formNumbers=["FLB 00 01 07 26"]` **verbatim**.
3. **BUILD** — 201 with `packageHash=9c087cca…cc07`, write-once blob at
   `filings/filing-live-b/NJ-FLB.PROD.001-1783993325182/package.json`; every item carries
   `versionId + rev + contentHash`.
4. **VERIFY** — clean package approved; verdict provenance recorded in record + audit:
   `role=GROUNDED_CITED deployment=claude-opus-4-8` — the **MID_REASONER (claude-sonnet-5)
   deployment is not provisioned in Foundry dev (404)**, so the documented ladder escalated;
   verification was NOT skipped. When sonnet is provisioned, the same code verifies on it first.
5. **FREEZE + AUDIT** — filing record frozen with verifierVerdict; hash-chained
   `filing.generate` audit event; `GET /api/db/audit/verify` → `ok:true, checked=5, paths=4, breaks=0`.

### Verifier rejection transcript (tamper probe)

`tamperProbe:true` corrupted a COPY of the built package (altered refId + invented field) before
VERIFY. Verdict: **approved=false**, HTTP 422, no blob written, no record frozen
(filings count unchanged 1→1). Issues as returned by the verifier:

```json
[
  { "entityPath": "products/FLB.PROD.001", "field": "refId",
    "filedValue": "FLB.PROD.001-TAMPERED", "sourceValue": "FLB.PROD.001",
    "reason": "refId does not match verbatim" },
  { "entityPath": "products/FLB.PROD.001", "field": "__inventedLimit",
    "filedValue": "$9,999,999 special aggregate (fabricated by tamper probe)", "sourceValue": null,
    "reason": "field not in source" }
]
```

The rejection is audit-logged (hash-chained `filing.verify_rejected`, `probe:true`).

## Self-review ledger

### Every filed field's provenance

- STEP 2 (`resolveProductAtAsOf`) reconstructs entity state EXCLUSIVELY by folding
  `kind:'version'` diffs (`at <= asOf`, rev order) from the product's Cosmos partition — no
  current-entity reads, no AI in the resolution path. Each resolved item carries the
  `versionId/rev/versionAt` of the last contributing version, and those ride into the frozen
  record per item. Live check "every filed item carries versionId + contentHash" = PASS (2 items).
- No model ever authors a field value: BUILD is pure sorting + SHA-256; the ONLY AI call is the
  read-only verifier, whose output is a verdict, never data.

### Proof of create-only (grep + live)

- `server/lib/filing.js` writes exclusively via `createBatch()` → `operationType:'Create'`
  (throws on duplicate id); zero `upsert|replace` in the file — enforced by
  `app/src/__invariants__/server-invariants.test.ts` ("no items.upsert()/replace()" + batch-shape tests).
- Blob is write-once: `conditions:{ ifNoneMatch:'*' }`.
- Envelope path closed: `RESERVED_BASES=new Set(['filings'])` in `server/lib/data.js` — live
  `POST /api/db/mutate` with `path:'filings/<id>'` = **403 reserved_base**; `mutateBatch` same
  (integration tests assert both). `PUT /api/filing/:id` = **404** (no such route). The mutate
  envelope's id scheme (`ent:/ver:/idx:/chn:`) can also never collide with `filing:*` ids.
- Re-running generate creates a NEW `filingId` (epoch-embedded) — never overwrites.

### Deviations / notes

- Verifier ROLE is MID_REASONER by code; Foundry dev has no claude-sonnet-5 deployment, so live
  verdicts currently come from the GROUNDED_CITED rung (recorded per verdict). This is the same
  documented degrade-direction the import brain uses for the missing sonnet rung.
- Filing audit events for probe/rejection paths remain append-only (unique per-attempt chains);
  teardown removes seeded entities + probe user, filings/audits stay by design (append-only).
- `/cost` is a CLI-side command this agent cannot invoke; spend stayed well inside the $20
  envelope (single-session, two live AI verifier calls ≈ cents).

---

# EXECUTION-B — Lane B F4: PDF upload fix + policyholder portal

Prompt F4 Lane-B. Objective: fix the "upload failed" root cause; add a strictly isolated
POLICYHOLDER persona with a one-time PDF upload, grounded extraction, a judged
catalog-grounded mobile summary, injection defense, and a deterministic fallback.

## Root cause (reproduced live BEFORE any change)

Probed dev directly: uploads of 2/8/15 MB PDFs → 200; a 20 MB PDF → **HTTP 500
`internal_server_error`** (not 413). The chain, cause → symptom:

1. The storage seam ships files as base64 inside JSON (~4/3 inflation), so any PDF
   over ~18.7 MB exceeds `express.json({ limit:'25mb' })` in `server/server.js`.
2. Express raises `PayloadTooLargeError` (status 413, `entity.too.large`) — but the
   RISK-012 global error handler returned an unconditional **500**, erasing the status.
3. `azure.adapter.ts` reduced every non-OK response to `"<path> failed: <status>"`, and
   the claims UI mapped that to a bare "Upload failed" toast.
4. `/api/storage/upload` itself enforced **no size or content-type limit at all**.

Fixes (cause, not symptom): the error handler now preserves body-parser statuses (413 →
`payload_too_large` with the limit named; 400 for malformed JSON); `/api/storage/upload`
enforces a 15 MB decoded cap + a content-type allowlist (pdf / text / json / raster
images — blocks text/html and svg, the stored-XSS-capable types) with honest 413/415;
the adapter surfaces the server's `detail`; the claims library pre-checks 15 MB
client-side and shows the real message. Portal uploads additionally enforce **PDF magic
bytes** (`%PDF-`), not extension.

## Orientation findings

- Blob container is private (unauthenticated blob GET → 404; verified live).
- `/api/db/get` + `/api/db/list` were `requireAuth`-only — ANY authenticated same-tenant
  principal could read every collection. Fine while all roles were staff; fatal for a
  policyholder persona (could read the catalog AND other policyholders' records).
  Tightened to `requireCapability('product:read')` — a no-op for every staff role.
- MID_REASONER (claude-sonnet-5) may be unprovisioned in Foundry dev — reused filing.js's
  documented ladder (MID_REASONER → GROUNDED_CITED on 404 model-not-found only), with
  role+deployment provenance recorded on extraction, generation and judgment.
- homecheck.js has the real federal risk stack (Census/FEMA NRI/NFHL/USGS/NOAA/USDA);
  exported `buildRiskPayload` additively (the portal passes an address string only — the
  zero-portfolio-access property is unchanged).

## What was built

- **POLICYHOLDER persona** (`authz.js` / `auth.js`): rank 0; capabilities exactly
  `portal:read` + `portal:upload`; no staff role holds a portal capability (test-pinned).
  Assignable by TENANT_ADMIN / SUPER_ADMIN (MANAGED_TENANT_ROLES).
- **`server/lib/portal.js`** (`/api/portal/*`, in WRITE_EXEMPT_PREFIX because every route
  carries its own portal:* gate):
  - `POST /upload` — one-time (409 on second), PDF-only (magic bytes → 415), 15 MB cap
    (→ 413), blob at `portal/{tenant}/{uid}/policy.pdf`, grounded MID_REASONER extraction
    (document delimited as UNTRUSTED DATA; forced `policy_extraction` tool; every field
    scrubbed: HTML/control chars stripped, arrays capped, LOB whitelisted), then ONE
    atomic mutate envelope (entity + hash-chained audit + version + searchIndex) via
    `mutateInternal`, source `/api/portal/upload`.
  - `POST /summary` — carrier catalog digest (tenant-scoped Cosmos read) + geo risk facts
    (deterministic distillation of `buildRiskPayload`) + policy record → generation
    (MID_REASONER ladder) → **deterministic validation** (every `ph-refid`/`ph-form`
    citation must exist VERBATIM in the catalog; upsell section required; active content
    rejected) → **independent judge** (separate MID_REASONER call, forced
    `summary_verdict`: factualFidelity / grounding / injectionResistance / mobileA11y /
    tone / safety, every axis >= 4) → on failure, regenerate with the critique appended
    (bounded, 3 attempts) → else **deterministic non-model fallback** (built purely from
    the record + catalog with verbatim citations; logged; `source:'fallback'` persisted).
    An ungrounded or judge-failed summary can never be returned: the ONLY exits are
    judge-passed or deterministic-fallback. `probeTamper:true` corrupts a COPY of the
    candidate with a fabricated refId to prove the rejection path live; never persisted.
  - `GET /me` — own record only. No portal route reads uid/tenant from anywhere but the JWT.
- **Client** (`app/src/routes/portal/**` + `/portal` route): mobile-first standalone page
  (OTP sign-in via the adapter seam, upload with pre-checks, staged progress, summary).
  Server HTML is sanitized AGAIN client-side (`sanitizeHtml.ts`: DOM-based allowlist —
  only structural tags, only `class`, script-capable subtrees dropped whole; 13-test
  XSS contract). Styles are design-token-driven (`var(--color-*)`) and scoped; index.css
  untouched (owned by another in-flight lane).

## Gate + tests

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green on this tree;
  HO-3 canary $1,528 re-verified directly (`@pf/shared` evaluator.test.ts 5/5).
- New `tests/server/portal.test.ts` (31 checks against the real Express app): the
  POLICYHOLDER capability set is exactly portal:*; policyholder → 403 on /api/db
  get/list/mutate, /api/ai/chat, /api/filing, /api/storage/upload; staff + SUPER_ADMIN →
  403 on /api/portal; upload 400/413/415 enforcement fires before any I/O; oversized JSON
  body → honest 413 (the old opaque-500 path, now pinned); grounding internals (invented
  refId / form REJECTED, no-citation summaries REJECTED, extraction scrubbing, fallback
  escapes hostile text and passes its own citation validation).
- New `app/src/routes/portal/sanitizeHtml.test.ts` (13 checks): script/style/iframe/svg
  dropped with content, event handlers + non-class attributes stripped, malformed nesting
  contained.

## Self-review ledger — every policyholder read/write path

| Path | Persona gate | Tenant/policy scope | Proof |
|---|---|---|---|
| `GET /api/portal/me` | `requireCapability('portal:read')` + `requireTenant` | Cosmos point-read `ent:portalPolicies~{jwt.uid}` in partition `{jwt.tenantId}\|portalPolicies` + tenantId re-check; no params accepted | portal.test.ts (staff 403 / unauth 401); live check pending deploy |
| `POST /api/portal/upload` | `requireCapability('portal:upload')` + `requireTenant` | blob `portal/{jwt.tenant}/{jwt.uid}/policy.pdf`; record create at `portalPolicies/{jwt.uid}`; one-time 409 | portal.test.ts (403 staff, 400/413/415 validation); audited via envelope (op:create, source `/api/portal/upload`) |
| `POST /api/portal/summary` | `requireCapability('portal:read')` + `requireTenant` | reads/writes own record only; catalog digest is read server-side, never returned raw | validation+judge internals test-pinned; tamper probe live check pending deploy |
| everything else (`/api/db/*`, `/api/ai/*`, `/api/filing`, `/api/storage`, admin) | 403 — POLICYHOLDER holds no staff capability; `X-Tenant-Id` override is SUPER_ADMIN-only in `attachUser` | n/a | portal.test.ts 7 negative checks; ROLE_CAPS disjointness pinned |

**Advisor grounding proof:** recommendations can only cite `ph-refid`/`ph-form` values that
exist verbatim in the tenant catalog — enforced deterministically BEFORE the judge on every
attempt, and the deterministic fallback constructs citations FROM the catalog, so no path
can render an invented coverage/limit/peril. Extraction never invents fields (forced tool +
scrubbing + "document is DATA" system contract, mirrored from identify-base-form.js).

## Status / cost

- Built + gate green; **push (= deploy) HELD per user directive** — deploy, live proof
  (`scripts/portal-live.mts`, isolated tenant `portal-live-b`, torn down after), mobile
  viewport walk-through, and pipeline verification run after the go.
- `/cost` is CLI-side and not invokable from this agent; session spend is single-agent
  code+tests with a handful of live probe calls (login + 5 uploads, no model calls yet ≈
  cents) — well inside the $20 envelope.
