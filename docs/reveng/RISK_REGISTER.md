# RISK_REGISTER — consolidated, prioritized, evidence-cited (`d28c8a1`)

> `docs/reveng/` dossier. Merges: Platform_Review F1-F12 (statuses REFRESHED against this
> tree — full evidence in [SECURITY_TENANCY.md](SECURITY_TENANCY.md) sec 1), the
> review's E1-E6 enhancement gaps, the import-hardening ledger's surviving WATCH
> residuals, and the diagnostic's live defects. Ranked by severity x exposure.
> Suggested owner lanes: SEC (security/ops hardening), DATA (data layer), BRAIN (import),
> APP (client), PLAT (platform/infra).

| # | Risk | Sev | Status / evidence | Owner |
|---|---|---|---|---|
| R1 | **docId case split breaks parent linking off the ISO path** — three minters, two conventions, case-preserving validator; CSV/brain-only children drop with 422 | CRITICAL (latent on golden paths, live on CSV/brain-only) | OPEN — all five sites re-verified at HEAD (INGESTION_PIPELINE.md sec 10); no canonicalization commit exists in this tree (the diagnostic's proposed W2.5 was NOT run) | BRAIN |
| R2 | **Plaintext passwords in Cosmos** (authenticates nothing; harvestable) | HIGH | OPEN — `auth.js:460` still stores `password: next` unhashed (F2/H1) | SEC |
| R3 | **No HTTP security headers** on a host that renders AI HTML (portal) | HIGH | OPEN — no helmet/CSP/HSTS/frame-ancestors anywhere in `server.js` (F3/H2) | SEC |
| R4 | **All rate-limit/spend/OTP/revocation state in-process** — scale-out breaks correctness; restart = amnesty | HIGH (single-instance ceiling) | OPEN — `server.js:127-144`, `fleet.js:80-86`, `auth.js:161-179`; only metering is Cosmos-durable (F4/M3) | PLAT |
| R5 | **Zip-bomb/unbounded decompression on the no-cap import path** | MED-HIGH (one request can take down the single instance) | OPEN — `workbook.js:87-96` (F8/M2) | BRAIN |
| R6 | **Secret hygiene residue**: `keys.md` live creds on disk (deliberate single source), DEF-0036 key rotation owed, 12 stale `REACT_APP_*` App Service settings incl. legacy Cosmos key | MED-HIGH | PARTIAL — the F1 trio (`tmp_keys.md`/`model_secrets.md`/`tmp.md`) is deleted (verified); rotation + setting cleanup outstanding | SEC |
| R7 | **Bootstrap dev-default SUPER_ADMIN one flag from prod** | MED | PARTIAL — DEF-0041 fail-closed re-hardening landed (`auth.js:84-106`); still no `NODE_ENV=production` refusal; flag reportedly still true on dev; `sal/scrudato` default still in code (F9/M1) | SEC |
| R8 | **Unbounded version+audit growth; filing replay truncates at 2000** | MED (compliance-adjacent) | OPEN in this tree (`data.js:280`, `filing.js:109-112`) — NOTE: origin/main's P4 wave (`aa3eb5d`) builds on history; re-assess after merge (F6) | DATA |
| R9 | **Dual chunk/searchIndex schemes (seed vs runtime)** — duplicate accumulation, masked by query-time dedupe | MED | OPEN — `migrate-to-cosmos.ts:114-185` vs `data.js:145-175` (F5) | DATA |
| R10 | **Fail-open on revocation/suspension/flags/quota** on Cosmos error | MED | OPEN by design — `auth.js:165-179,272-280`, `server.js:162-174` (F10/M5); revocation is the one to fail closed | SEC |
| R11 | **No referential integrity on ref arrays** (`coverageRefIds`, `formNumbers`, `tableRefIds`) after deletes — broken chips, degraded citations | MED | OPEN — only parentId validated (`data.js:240-250`); reconciler exists import-side only (F11) | DATA |
| R12 | **Import path lacks portal-grade output scrubbing** (prompt-injection hardening asymmetry) | MED | OPEN (review M4) — portal double-sanitizes; import bundle is schema-forced but not scrubbed | BRAIN |
| R13 | **GL `ldTableRefResolutionRate` 0.8** — 3 GL rules unlinked, metric report-only | MED (the one live-visible accuracy gap) | OPEN — `docs/audit/import_eval_results.json:89` (E1) | BRAIN |
| R14 | **Golden evals are template-shaped** — offline F1 1.0 proves stability, not real-world linking | MED | OPEN — mitigated by frozen holdout (7x2 variants) but no REAL-vendor held-out fixture (diagnostic A8/E10) | BRAIN |
| R15 | **No checkpoint/resume for ~$110 import runs** — recycle mid-run loses computation up to the persisted bundle | MED (economics) | OPEN (E4); durable-result recovery exists (F23/F29) | BRAIN |
| R16 | **Vision manuals still whole-PDF reads** — no page-range chunking >40pp; 180k-char text cap | MED (latency) | PARTIALLY MITIGATED — parallel haiku+opus + heavyDoc no-retry landed (`9372aa4`); windowing unbuilt (E2) | BRAIN |
| R17 | **No extraction cache on contentHash** — every re-import/eval re-buys unchanged regions | MED (economics) | OPEN (E3) | BRAIN |
| R18 | **Mixed workbook+PDF uploads extract only the workbook**; two same-kind manuals merge | LOW-MED | PARTIALLY ADDRESSED — M1 conservation ledger + F13 multi-role classify landed; true multi-artifact planner unbuilt (E5) | BRAIN |
| R19 | **Bridge (.cjs) / shared-TS drift hazard** — hand-edited or stale bundle is a documented past incident | MED (process) | OPEN — no CI parity check (E6); rule 5 in orchestration.md is discipline, not enforcement | PLAT |
| R20 | **Columns past 128 dropped** on wide state-banded matrices | LOW-MED | OPEN — warned non-goal (`stage0-router.js:289-292`) (E6) | BRAIN |
| R21 | **`proposeMapping` (concept-linker AI tail) not import-exempt** — can be 503'd by the ceiling mid-review; ALSO its live Foundry path never exercised | LOW-MED | OPEN — `ai/index.js:36` (diagnostic A5) | BRAIN |
| R22 | **Admin export/offboard loads up to 200k docs in memory** | LOW-MED | OPEN — `admin.js:282,297` (review sec 13) | PLAT |
| R23 | **Doc/copy drift**: `Explorer.tsx:114` "Run pnpm seed" in prod copy; dead `VITE_ALLOW_GUEST` (ADR-0004) | LOW | OPEN (reduced by cleanse) (F12) | APP |
| R24 | **Hardening WATCH residuals** (written triggers, no fixtures): >2000-row stacked-table sheet; merges INSIDE the header row; sheet names beyond every regex AND the AI classifier | LOW (no such input exists in any corpus yet) | WATCH — `docs/import-hardening/RESULTS/loop-summary.md` sec 3 | BRAIN |
| R25 | **Tree divergence**: this lineage (concept-linker + cleanse) vs origin/main (P3 XML export + P4 history) — 20 commits each way; docs/tests may conflict on merge (orchestration.md certainly) | MED (process, immediate) | OPEN — verified `git rev-list --count` both directions | PLAT |
| R26 | **Node 24 on dev boxes vs repo target 20** — historical cosmetic test artifacts | LOW | OPEN — pipeline pins 20 (`azure-pipelines.yml:36`); this dossier's gate ran green on 24 | PLAT |
| R27 | **Presence docs have no TTL/cleanup** | LOW | OPEN — `data.js:404-410` | DATA |
| R28 | **PROBE_MODE=1 exposes raw audit docs** via `/api/db/audit` | LOW | OPEN — env-gated (`data.js:449`); confirm unset on live App Service | SEC |
