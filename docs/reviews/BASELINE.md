# Gate Baseline — 2026-07-09

## Gate command

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Overall result: RED (exit 1)

| Step | Result | Notes |
|---|---|---|
| `pnpm install` | PASS | |
| `pnpm typecheck` | PASS | |
| `pnpm lint` | PASS | |
| `pnpm test:unit` | PASS | 44 files · 493 tests (see canary values below) |
| `pnpm test:rules` | **FAIL** | Port 8080 already in use — Firestore emulator conflict |
| `pnpm test:integration` | not reached | blocked by test:rules failure |
| `pnpm test:e2e` | not reached | blocked |
| `pnpm build` | not reached | blocked |

**Root cause:** A Firestore emulator instance from a prior session was holding port 8080 when
`firebase emulators:exec --only firestore` attempted to start a new one. This is a transient
infrastructure conflict, not a code failure. All 493 unit tests, including both rating canaries,
passed cleanly before the port conflict.

**Obsolete snapshot (warning, not failure):**
`app/src/lib/import/isoFixture.test.ts > GL golden fixtures — Phase 0 baseline counts >
form-rules: merge-aware count (golden=259, likely < due to merged-anchor gap) 1`

---

## Rating canary values (from test:unit — both PASS)

**HO-3 canary** (`shared/src/rating/evaluator.test.ts`):
```
✓ shared/src/rating/evaluator.test.ts > HO-3 rating evaluator > produces $1,528 for the DOMAIN_HO worked example with exact per-step trace  2ms
```

**PA canary — second line exactly as found** (`shared/src/rating/personalAuto.evaluator.test.ts`):
```
✓ shared/src/rating/personalAuto.evaluator.test.ts > Personal Auto rating evaluator > produces $1,002 for the PA worked example with exact per-step trace  2ms
```

Both canaries: `finalPremium === 1528` (HO-3) and `finalPremium === 1002` (PA).

---

## Failure verbatim

```
$ firebase emulators:exec --only firestore --project productreinvention "vitest run --config vitest.rules.config.ts"
i  emulators: Starting emulators: firestore
!  firestore: Port 8080 is not open on localhost (127.0.0.1), could not start Firestore Emulator.
!  firestore: To select a different host/port, specify that host/port in a firebase.json config file:
      {
        // ...
        "emulators": {
          "firestore": {
            "host": "HOST",
            "port": "PORT"
          }
        }
      }
!  hub: emulator hub unable to start on port 4400, starting on 4401 instead.
!  logging: Logging Emulator unable to start on port 4500, starting on 4501 instead.
i  emulators: Shutting down emulators.

Error: Could not start Firestore Emulator, port taken.
[ELIFECYCLE] Command failed with exit code 1.
[ELIFECYCLE] Test failed. See above for more details.
```

---

## Environment

| | |
|---|---|
| Node | v24.12.0 (repo targets Node 20; `functions/` emits engine warning) |
| pnpm | 11.9.0 |
| Date | 2026-07-09 |
| Branch | main |

### Key dependency versions (from package.json)

| Package | Version spec |
|---|---|
| `firebase` (app) | ^11.9.0 |
| `firebase` (root devDep) | ^11.10.0 |
| `firebase-admin` | ^13.10.0 |
| `@firebase/rules-unit-testing` | ^5.0.1 |
| `@anthropic-ai/sdk` | (in functions — see functions/package.json) |
| `react` | ^19.2.7 |
| `vite` | ^8.1.1 |
| `vitest` | ^3.1.4 |
| `typescript` | ~6.0.2 |
| `@playwright/test` | ^1.61.1 |

---

## First work items (gate-blocking)

1. **`test:rules` port conflict** — Before re-running the gate, ensure no Firebase Firestore
   emulator is already running on port 8080. Run `lsof -ti:8080 | xargs kill` (macOS/Linux)
   or identify and kill the process on Windows. Then `pnpm test:rules` will pass.
2. **`build` not verified** — must clear item 1 first to confirm build is green.
3. **Node 24 / Node 20 mismatch** — repo `engines` target is Node 20; running Node 24 causes
   a warning in `functions/`. No test failures attributable to this on this run, but the mismatch
   should be resolved (switch to Node 20 via nvm/volta, or update the engine target).

---

## Notes

- This baseline was established during the ground-truth session (2026-07-09). See
  `docs/reviews/GROUND_TRUTH.md` for the full V1–V14 verification ledger.
- The telemetry.ts PRICING map duplicate model strings were fixed (V2) in this same session:
  `functions/src/telemetry.ts` now uses `[MODEL]`/`[MODEL_FAST]` computed keys instead of
  hardcoded `'claude-sonnet-5'`/`'claude-haiku-4-5'` literals.
