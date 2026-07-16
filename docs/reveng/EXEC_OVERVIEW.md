# EXEC_OVERVIEW — one page (`d28c8a1`)

> `docs/reveng/` dossier index. Written for whoever reads exactly one file.

## What this platform is

A multi-tenant P&C **product-definition platform** ("Product Reinvention Hub"): carriers
define products — coverages, forms, rules, rating algorithms — across 5 lines
(PH/PA/GL/IM/PR), price them through a deterministic evaluator locked by four premium
canaries ($1,528 / $1,002 / $2,635 / $1,281), ingest real carrier documents (Excel
product specs, rate-filing PDFs) through a cross-vendor multi-model AI **import brain**
whose every output is cited back to a source cell, generate SERFF filing bundles, and run
grounded copilots over the portfolio. React SPA + Express host on one Azure App Service;
Cosmos DB with atomic 6-document mutation envelopes and a tamper-evident audit hash
chain; Azure AI Foundry fleet (Claude opus/sonnet/haiku + GPT + specialty rerank/OCR/
judge deployments) behind a single role registry with cost governance.

Dossier map: [ARCHITECTURE](ARCHITECTURE.md) · [INGESTION_PIPELINE](INGESTION_PIPELINE.md)
· [API_SURFACE](API_SURFACE.md) · [DATA_MODEL_DELTA](DATA_MODEL_DELTA.md) ·
[FRONTEND_MAP](FRONTEND_MAP.md) · [SECURITY_TENANCY](SECURITY_TENANCY.md) ·
[PERF_COST](PERF_COST.md) · [TEST_MAP](TEST_MAP.md) · [FLEET](FLEET.md) ·
[RISK_REGISTER](RISK_REGISTER.md) · [BACKLOG_SEED](BACKLOG_SEED.md).

## What is strong

- **Discipline of seams**: every cross-cutting concern has exactly one home — the client
  adapter, the mutation envelope, the fleet registry, the LOB registry, the external-
  client directory. Invariant tests enforce the seams (bare-write census, capability
  gates, vite-define secret guard).
- **Integrity model**: atomic entity+audit+version+searchIndex+chainHead(+chunk) batches;
  SHA-256 hash-chained audits with a verify endpoint; tenant isolation at four layers
  with no leak found by two independent passes.
- **The import brain**: deterministic-first with an AI overlay that is fill-only and
  provenance-labeled; cross-family adversarial ensembles; uncited output dies in code;
  37-defect hardening ledger closed with frozen holdouts. Gate GREEN and offline eval
  4/4 F1 1.0 were RE-RUN on this exact tree for this dossier.

## What is weak

- **One live correctness defect class**: the docId case split (three minters, two
  conventions) silently drops CSV/brain-only sub-coverages — ranked item 1 in
  BACKLOG_SEED, cheap to fix, never yet fixed.
- **Operational hardening lags the architecture**: plaintext stored passwords, no
  helmet/CSP, in-memory limits/spend/revocation (single-instance ceiling), zip-bomb
  exposure on the no-cap path, key rotation owed. 9 of Platform_Review's 12 findings
  remain open (2 fixed, 1 partial).
- **Economics**: a CORE import run costs ~$110/7,652 calls with no extraction cache and
  no checkpoint/resume; goldens are template-shaped so offline green does not prove
  real-world linking.
- **Tree fragmentation (immediate)**: this lineage (concept linker + cleanse), origin/
  main (P3 XML export + P4 history), and the unpushed P2 experience worktree are three
  diverged lines that someone must merge deliberately.

## What the next build pack should do

1. Merge the three lineages (R25) — then re-run this dossier's drift checks on the union.
2. Ship BACKLOG_SEED items 1-6 as one hardening wave: docId canonicalization, helmet/CSP,
   password field removal, GL ldTableRef gate, zip-bomb ceiling, bridge-parity CI.
3. Spend wave: extraction cache + page-range windowing + checkpoint/resume (items 8-10)
   to make the import loop cheap enough to iterate on real vendor corpora.
4. Concept-linker wave 2 (items 14-16): content-signature routing and schema-learning in
   the deterministic mapper — the highest-leverage accuracy work left.
5. Add the 7 LOCK-candidate pinning tests so today's defenses survive tomorrow's refactor.

---

## Hostile self-review (the five questions)

**1. Which doc is most likely to still contain a wrong claim, and what did the verifier
catch there?**
[API_SURFACE.md](API_SURFACE.md) — 62 routes with per-route line numbers is the largest
surface of small facts, and several guard/limit details were taken from swarm reports
rather than my own reads. The Phase-2 verifier verdicts are appended below in the
VERIFICATION LEDGER; whatever it caught is recorded there per doc, and anything
unfixable within two rounds is flagged UNVERIFIED in that doc's header.

**2. What did you discover that BOTH Platform_Review.md and REVERSE_ENGINEERING.md missed
or got wrong — name at least one with evidence.**
Three concrete ones. (a) **The deploy pipeline runs almost none of the test estate**: it
executes only `pnpm --filter @pf/shared test` + typecheck + bundle budget
(`azure-pipelines.yml:64-74`) — so the no-bare-writes census, capability-gate invariants,
and all 20 hardening lock suites can never fail a deploy; both prior docs treat "the
gate" as one thing. (b) **Platform_Review's D5-adjacent claim that unrecognized
containers fall into the PDF/vision path is stale at HEAD**: `.xls`/unknown magic now
routes to `unknown` with an explicit warning (`stage0-router.js:212-214`) — the
diagnostic's D5 severity is overstated for this tree (marked DRIFTED in
INGESTION_PIPELINE sec 11). (c) **The review's "9 Foundry deployments" and SERVICES.md's
"16" are BOTH snapshots neither doc reconciles**: 16 = 13 registered in `fleet.ts` + 3
deployed-but-unreferenced, with `grok-4-20-reasoning` appearing in ZERO files of this
tree (FLEET.md sec 3). Also worth noting: my own swarm initially reported "no
docs/build gitignore trap"; `git check-ignore` proved the trap real — swarm output is
proposals, not truth.

**3. Which single file would you tell a new agent to read first, and why?**
`server/lib/data.js` (492 lines). CLAUDE.md states the rules, but data.js IS the
platform's constitution executed: the envelope, the audit chain, tenancy stamping, the
reserved bases, parentId validation (including the exact line where the docId bug
bites), and the route guards — every other subsystem is legible once you've read it.

**4. What is the riskiest undocumented behavior you found in the ingestion path?**
The **CSV asymmetry**: stage 0 attaches `isoGrids` to XLSX workbooks (`stage0-router.js:152`)
but not to CSVs (`:200-207`), and the oracle gate is simply `isoGrids.length > 0`
(`unified-import.js:154`). Nothing warns the user that a CSV upload silently runs
WITHOUT the canonical-identity oracle — the exact condition under which the lowercase
docId minters (`stage7-plan.js:40-43`) produce children whose parents can never resolve
(`data.js:243`), dropped as 422s the review UI never explains. Every layer behaves "as
designed"; the composition is the trap.

**5. Where did the two prior documents CONTRADICT each other, and which one does HEAD
support?**
(a) **Hardening-ledger size**: Platform_Review sec 8 says "34-entry ledger";
the diagnostic-era close-out and the tree say **37 entries** (`docs/import-hardening/
ledger.json` — F01-F30 + PCM-A/B/C + M1 + G-C). HEAD supports 37; the review counted an
earlier wave. (b) **CORE run economics**: the diagnostic says ~95 min/~$70, the review
~110 min/~$70; the committed cost-correction record says a full headless run was
**$110.81/7,652 calls** (`RESULTS/loop-summary.md:82`) — HEAD's own artifacts outbid both.
(c) **Vision-ladder shape**: the review describes haiku+opus parallel racing with
heavyDoc retry-drop; the diagnostic's stage map describes the older serial ladder
("haiku, escalating") — HEAD supports the review (`stage-filing.js:180-258`, commit
`9372aa4` post-dates the diagnostic's pass).

---

## VERIFICATION LEDGER (Phase 2)

Filled after the fresh-context verifier pass; per-doc verdicts, misses found, and fixes.

```text
[VERIFICATION-LEDGER]
```
