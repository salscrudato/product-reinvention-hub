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
