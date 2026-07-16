# TEST_MAP — every suite, the canaries, the eval harness, holdouts, and the gaps (`d28c8a1`)

> `docs/reveng/` dossier. Counted on this tree: **118 test files** (112 `*.test.ts` +
> 6 `*.test.tsx`; `find`, excluding node_modules). Gate = `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
> (wrapped with timing by `scripts/ops/cleanse/gate.mjs`). Evidence from RUNNING both the
> gate and the OFFLINE eval on this tree is quoted in sections 6-7.

## 1. Suite topology

| Location | ~Files | Vitest project | What lives there |
|---|---|---|---|
| `shared/src/**` | ~50 | `shared/vitest.config.ts` (node) — ALSO the ONLY tests the deploy pipeline runs (`azure-pipelines.yml:67-68`) | rating evaluator + canaries, isoImport/conceptMatch/coverageHierarchy, filing reconcile, audit chain, money, GTM plan, platform flags, seed integrity |
| `app/src/**` | ~35 | root `vitest.config.ts` (node default; jsdom per-file opt-in) | components (axe suite `a11y.axe.test.tsx`), lib, **and the server invariant tests** (`app/src/__invariants__/`) |
| `tests/import-brain/` | ~20 | root config | hardening locks `hardening-*.test.ts` — one per ledger defect family (F01-F30, M1, reconcile) |
| `tests/import/` | 2 | root | `harness.test.ts` (fixture->plan->rating harness) + `core-acceptance.test.ts` (CORE concept-linker acceptance) |
| `tests/eval/` | 1 | root | `import-eval-metrics.test.ts` — locks the PURE metric functions the eval harness gates on |
| `tests/server/` | 10 | root | integration (auth/tenancy/filing), portal, metering, platform(+toggles), ops-copilot, external clients, task-summary, refresh-news, versions-read |
| `tests/golden/import/` | 4 JSON | consumed by eval, not vitest | CORE/GL/IM/PR golden entity sets |

Quirk worth knowing: the SERVER invariants live in the APP tree
(`app/src/__invariants__/`) so they run on every `pnpm test`; the deploy pipeline runs
only the `shared` project — meaning lint, app tests, server tests, invariants and
hardening locks gate LOCALLY (and in this dossier's Phase-2 run), not at deploy time.

## 2. The four rating canaries (the platform's headline locks)

| Canary | Value | File |
|---|---|---|
| Personal Home HO-3 | **$1,528** | `shared/src/rating/evaluator.test.ts` (headline per CLAUDE.md) |
| Personal Auto | **$1,002** | `shared/src/rating/personalAuto.evaluator.test.ts` |
| General Liability | **$2,635** | `shared/src/rating/generalLiability.evaluator.test.ts` |
| Imported Lemonade NJ HO filing | **$1,281** | `shared/src/insurance/filing/reconcile.test.ts:115` (`expect(result.finalPremium).toBe(1281)`); the creditFloor MECHANISM it exercises (Rule 92) is separately locked by `shared/src/rating/evaluator.creditFloor.test.ts` |
| All four, registry-complete | — | `shared/src/rating/workedExample.canary.test.ts` — asserts every bespoke rating kit has a canary and vice-versa, AND final premium === last trace row (no display/engine drift) |

A red canary blocks the deploy pipeline by construction (`azure-pipelines.yml:67-68`).

Related import-side canaries (different thing — authored expected-fixture programs, not
the seed): `tests/import/harness.test.ts:110-124` re-rates imported fixtures to
HO $1,528 / GL $2,635 (seed programs byte-for-byte) plus authored IM $1,700
(`tests/fixtures/import/expected.im.ts:39-44`) and PR $2,310 (`expected.pr.ts:43`).

## 3. The eval harness (`scripts/import-eval.mts`, 641 lines)

Modes: **offline** (default — re-parse every sample deterministically, diff against
goldens, ZERO model spend), `--live` (POST base64 to `/api/ai/unifiedImport`, score the
returned bundle), `--write-golden`, `--rescore` (score the last dumped extraction),
`IMPORT_EVAL_RECOVER_RUN=<runId>` (score a persisted bundle — the "recovered, not
re-bought" mechanism), `IMPORT_EVAL_ONLY=GL,IM` slicing, attempt/timeout knobs
(`import-eval.mts:44-58,299-336,571-577`).

Gated metrics (pure functions in `scripts/lib/import-eval-metrics.mts`, LOCKED by
`tests/eval/import-eval-metrics.test.ts`): F1 >= 0.95 · numeric exact >= 0.98 ·
citations = 1.0 · fabricationExtraRate <= 0.02 live / 0.00 offline ·
parentResolutionRate == 1 · parentEdgeRecall >= 0.98 · formAttachmentRecall >= 0.98 ·
resolveProvenanceRows >= 0.98. Report-only: `ldTableRefResolutionRate` (the GL 0.8 gap —
INGESTION_PIPELINE.md sec 12), conservation delta.

Sibling harnesses: `scripts/import-live.mts` (cross-format live smoke + durable-run
recovery), `scripts/import-judge.ts` (adversarial opus oracle that reads raw columns and
never sees parser logic), `scripts/import-enumerate.mjs` (offline corpus baseline via a
deterministic fetch STUB — real deterministic stages, no network),
`scripts/phaseg-holdout.mts`, `scripts/phasep-probes.mts`,
`scripts/lib/run-recovery.mts` (F23 client recovery + transient-error classifier).

## 4. Goldens, holdouts, and the anti-overfit rule

- **Goldens** (`tests/golden/import/{CORE,GL,IM,PR}.golden.json`): entity tuples
  `{kind, refId, scalar fields + formNumbers}` extracted from the deterministic parse
  (`import-eval.mts:131-167`); regenerated only via `--write-golden`. KNOWN
  LIMITATION [diagnostic A8/E10]: the goldens were built from the same templates the
  parser was tuned on — offline F1 = 1.0 proves parse STABILITY, not real-world linking.
- **Holdout** (`samples/hardening/holdout/{GL,IM}/`, 7 variant pairs each + manifest,
  frozen at HOLDOUT_SHA `d51e32f`): never-seen deterministic mutations — moved preamble,
  shuffled columns, merged banner, dashed refIds, blank silence, renamed sheets,
  unfamiliar layout — checked by `scripts/phaseg-holdout.mts --check`. VERIFIED PRESENT
  at this tree (the cleanse did NOT delete them; the pre-cleanse `git status` "D" entries
  were another lane's staged state, not this tree's). Phase-G record: 7/7 GL + 7/7 IM
  green post-G5, blind re-verdict PASS (`docs/import-hardening/RESULTS/phaseg/`).
- **Two-fixture anti-overfit rule** (hardening ledger discipline,
  `docs/import-hardening/ledger.json` schema line 2): every fix needs its original red
  fixture PLUS one structurally different fixture green for the same reason.
- **Hardening ledger**: 37 entries (F01-F30, PCM-A/B/C, M1, G-C), classes SILENT_LOSS /
  GROUNDING / MULTIPLICITY / EVAL_GAP / PDF / PERF / ARCH_ESCALATION / GENERALIZATION,
  zero open at close (IMPORT-CERTIFIED); residuals carried as written WATCH triggers in
  `RESULTS/loop-summary.md` (e.g. >2000-row stacked-table sheet, in-header merges).

## 5. What each notable suite locks (selection)

| Suite | Locks |
|---|---|
| `shared/src/audit/chain.test.ts` | SHA-256 test vectors + canonical JSON + chain verdicts |
| `shared/src/money.test.ts` | integer-cents round-trip invariant (sub-cent drift throws) |
| `shared/src/seed/seedIntegrity.test.ts` | seed portfolio counts + worked-example premiums |
| `shared/src/insurance/isoImport.test.ts` | mapper behaviors incl. rating parse (`:287-294`), form edition identity |
| `tests/import/core-acceptance.test.ts` | CORE concept-linker acceptance (this branch's headline feature) |
| `tests/import-brain/hardening-*.test.ts` | one pinning suite per fixed defect (the ledger's regression floor) |
| `app/src/__invariants__/*` | no-bare-writes census (31 calls/8 files exact), audit-chain wiring, capability gates, vite-define secret guard (FRONTEND_MAP.md sec 5) |
| `app/src/a11y.axe.test.tsx` | axe structural a11y over interactive components (color-contrast + region off in jsdom) |
| `tests/server/integration.test.ts` | auth floor, tenancy, filing verifier/tamper paths |
| `shared/src/platform/platform.test.ts` + `tests/server/platform*.test.ts` | flag registry, tenant overrides, metering, budget throttle |

## 6. Gate evidence (RUN on this tree, 2026-07-16)

```text
node scripts/ops/cleanse/gate.mjs
PASS  typecheck  34.6s
PASS  lint       12.4s
PASS  test       113.6s
PASS  build      71.1s
GATE GREEN (total 231.7s)
```

(Node 24 on this dev box vs repo target 20 — the two historical Node-24 cosmetic
artifacts did not reproduce in this run.)

## 7. Offline eval evidence (RUN on this tree, 2026-07-16 — zero model spend)

```text
pnpm exec tsx scripts/import-eval.mts        (offline mode — default)
── OFFLINE: parse-stability diff vs golden ──
  OK GL:   F1 1.0000 | numeric 1.0000 | extras 0 | link parent=1.000 edges=1.000 forms=1.000 |  5515 golden fields
  OK IM:   F1 1.0000 | numeric 1.0000 | extras 0 | link parent=1.000 edges=1.000 forms=1.000 | 19461 golden fields
  OK PR:   F1 1.0000 | numeric 1.0000 | extras 0 | link parent=1.000 edges=1.000 forms=1.000 | 26053 golden fields
  OK CORE: F1 1.0000 | numeric 1.0000 | extras 0 | link parent=1.000 edges=1.000 forms=1.000 |  5065 golden fields
```

(The run rewrites `docs/audit/import_eval_results.json`; that side-effect was reverted in
this dossier's worktree — the file stays as committed by the hardening loop. Remember the
caveat in section 4: offline 1.0 = parse STABILITY on template-shaped goldens.)

## 8. Coverage gaps worth closing (ranked)

1. **No test pins the docId conventions against each other** — a unit asserting
   `dashId(x) === toDocId(x)` for the seed corpus would have caught the split
   (BACKLOG_SEED item 1's verify step).
2. **The diagnostic's refutation defenses lack pinning tests** (LOCK CANDIDATES,
   BACKLOG_SEED sec 3): splitList multi-value semantics, 20-row header scan window,
   placeholder filter, used-range bounding, stacked-table segmentation each defend
   real sample traps but only some have dedicated fixtures.
3. **Goldens are template-shaped** — a held-out REAL-vendor workbook scored on link-edge
   counts (not regenerated goldens) is the missing "green means right" proof.
4. **Deploy pipeline runs only shared tests** — the invariant suites (census, capability
   gates) can only fail locally; a cheap `pnpm vitest run app/src/__invariants__` step in
   the pipeline would close the gap.
5. **No load/soak coverage** for the poll-based subscribe layer or the 96-op batch chunker.
6. Restore path (dormant), presence TTL, and admin export streaming have no tests at all
   (matching their unbuilt/known-gap status).
