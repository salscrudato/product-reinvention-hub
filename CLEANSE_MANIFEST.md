# CLEANSE MANIFEST - P-CLEANSE run of 2026-07-16

Repo scrub to functional code, helper code, critical documentation, live configuration,
and eval fixtures. Bloat map: Platform_Review.md s16; secrets map: s12 C1/F1.
Baseline tag: pre-cleanse-2026-07-16. Archive: %USERPROFILE%\hub-archive\2026-07-16\.
Every destructive action ran through scripts/ops/cleanse/purge-wave.mjs (dry-run plan
first, then execute), and every wave was followed by the full gate.

## Run context and deviations (read this first)

- The working tree was NOT clean at start (117 changes): 97 tracked files deleted on disk
  but never committed (samples/, docs/, .claude/ skills - restored losslessly from HEAD),
  9 modified + 6 untracked functional items (external-services layer, fleet expansion) -
  checkpoint-committed as found (22e0524), and untracked bloat left for the waves.
- Foreign edits kept landing in the tree DURING the run (an active editor outside this
  session): boot-signature easter-egg removal (committed as bd75eef at the user's explicit
  direction), then ChatComposer send-launch work, orchestration.md, traceRef.ts, and
  samples/filings/additional_samples/ - all left uncommitted and untouched.
- KEPT against the s16 map: reference_tasks/ - its single workbook is the ADR-0006
  generator source read by scripts/genGtmProcess.ts:24 and referenced by
  shared/src/seed/personalHome.ts. Live fixture, not bloat.
- KEPT: samples/ (55MB eval fixtures) untouched per instruction; corpus swap is a
  ledgered follow-up owned by the eval-harness lane, not done here.
- NOT TOUCHED: artifacts/ (curated corpus document library, P-CORPUS raw material) and
  .claude/worktrees/* (other lanes' checkouts).
- 9 s16 items were already absent at cleanse start (deleted in earlier sessions) and are
  recorded as SKIPPED-MISSING rows below.

## Secrets and rotation status

- The s12/C1 plaintext files (tmp_keys.md, model_secrets.md, tmp.md, tmp_key.md,
  apikeys.md) were already secure-deleted on 2026-07-15, before this run. Per the
  review they were gitignored and NEVER committed: git history does NOT contain the
  values. Exposure was disk/zip/screenshot-level; rotation is the real fix.
- ROTATION: DONE - confirmed by the user during this run for the exposed set (Cosmos
  primary key incl. legacy account, Foundry account key, Storage connection, NewsData),
  with the wider inventory (ACS, Maps, Socrata, First Street, JWT secret, SMTP,
  bootstrap passwords, stale REACT_APP_* settings) delivered as a checklist.
- Verified secret home: process.env populated by App Service settings (prod) or shell
  (local); keys.md (repo root) is the human-facing source - untracked and
  git check-ignore verified. There is no dotenv/loader in the boot path.
- Stale .gitignore entries for the dead files, the snowchat block, and the retired
  Firebase/emulator blocks removed (b98216a); keys.md and the generic tmp*.md
  guard kept.
- scan-secrets.mjs over ALL TRACKED FILES: 0 hits (after teaching it that npm
  lockfile integrity hashes, UI design tokens, and documented fake test values are not
  credentials).

## Gate results per wave (Node 24; steps: typecheck / lint / test / build)

| Run | Result | typecheck | lint | test | build | total |
|---|---|---|---|---|---|---|
| Baseline (post-checkpoint, at tag) | GREEN | 24.6s | 4.0s | 96.2s | 46.8s | 171.6s |
| Phase 2 unwired (functions/ still on disk) | GREEN | 19.7s | 3.6s | 86.3s | 50.2s | 159.8s |
| Phase 2 removed | GREEN | 16.8s | 3.9s | 77.5s | 43.2s | 141.5s |
| Wave A | GREEN | 15.0s | 4.1s | 77.6s | 48.6s | 145.3s |
| Wave B | GREEN | 19.8s | 3.4s | 86.1s | 46.0s | 155.2s |
| Wave C (first run) | RED at test | 24.7s | 5.3s | 122.0s | - | - |
| Wave C (after fix, loop iteration 1 of 3) | GREEN | 25.5s | 4.9s | 104.6s | 52.7s | 187.7s |
| Final (closing) | GREEN | 36.4s | 5.8s | 154.0s | 142.7s | 338.8s |

Final-run timings are elevated by concurrent load on the box (other lanes active), not by
the tree: the same commit gated at 187.7s earlier. Closing checks on the final tree:
/api/health 200 on a local boot (10 routers mounted), scan-secrets 0 hits on tracked
files, verify-protected PROTECTED CLEAN, all four canaries asserted in the final test
output.

Wave C red cause: pre-existing load-dependent flake in tests/server/metering.test.ts -
the suite set a dummy COSMOS_ENDPOINT, forcing every meter() through a FAILING network
call; duration crept 3836ms -> 4672ms -> 5026ms across the day's runs against a 5s
default timeout. Fixed at cause (Cosmos env deleted for the suite = the module's
documented deterministic no-op path; assertions unchanged; suite ~5s -> 2.3s). No wave
content was related; nothing was weakened.

## DuckCreek retirement verification (Wave C precondition)

- git log contains 8825cbd ("remove DuckCreek Author XML export end-to-end"). PASS
- Local boot + minted dev JWT: /api/duckcreek/v1/export -> 404,
  /api/duckcreek/anything -> 404, control /api/auth/me -> 200, /api/health -> 200. PASS

## Totals

| Wave | Action | Items executed | MB |
|---|---|---|---|
| 2-functions | archive | 1 | 0.66 |
| A | delete | 6 (+6 already absent) | 45.72 |
| B | delete | 24 (4 sha256-verified duplicates) | 14.12 |
| C | archive | 9 (+2 already absent) | 28.18 |
| Screenshot sweep | none needed | 0 (only 3 referenced app assets remain) | 0 |
| Total |  | 40 | 88.68 MB shed from the working tree |

Git delta vs pre-cleanse-2026-07-16: 238 files changed, 167 insertions, 637,328
deletions across 12 commits (checkpoints excluded from the purge totals above; tracked
purged content remains recoverable from git history, archived content from the archive
folder).

## Actions (appended live by purge-wave.mjs)

| wave | path | action | size (MB) | tracked | destination | reason |
|---|---|---|---|---|---|---|
| 2-functions | functions | archive | 0.66 | yes | C:\Users\salvatore.scrudato\hub-archive\2026-07-16\wave-2-functions\functions | F7: reference-only AI plumbing, never deployed; unwired from workspace+gate in 51ff5b5 with gate green before removal; node_modules and lib (regenerable) stripped before archiving |
| A | hardening-corpus.zip | SKIPPED-MISSING | - | - | - | s16 DELETE: corpus zip export - already absent at cleanse start, recorded for the map |
| A | hardening-corpus | delete | 2.44 | no | - | s16 DELETE: unzipped corpus export duplicating samples/ + docs content (README_CORPUS confirms it is an export, tiers repo-native) |
| A | docs/review | delete | 42.77 | no | - | s16 DELETE: 43MB heavy PNG/PDF/mjs capture artifacts (SCREENSHOTS.pdf, shots/, screens-after/, _capture.mjs); all gitignored/untracked; the six allow-listed *.md deliverables no longer exist |
| A | firestore-debug.log | SKIPPED-MISSING | - | - | - | s16 DELETE: Firebase debug log - already absent, recorded for the map |
| A | build | delete | 0.10 | no | - | s16 DELETE: stray root build/ mockups (gtm-tracker-mockup.html, product-process-template.json); gitignored; not referenced by any script (docs/build is a different, kept path) |
| A | snowchat | SKIPPED-MISSING | - | - | - | s16 DELETE: legacy non-workspace cruft - already removed in f90e30c, recorded for the map |
| A | Sal_Scrudato Policy.pdf | SKIPPED-MISSING | - | - | - | s16 DELETE: personal document - already absent, recorded for the map |
| A | .firebase | SKIPPED-MISSING | - | - | - | s16 DELETE: Firebase deploy cache - already absent (Azure cutover), recorded for the map |
| A | test-results | SKIPPED-MISSING | - | - | - | s16 DELETE: Playwright artifacts - already absent, recorded for the map |
| A | tools/orchestrate/run | delete | 0.41 | no | - | s16 DELETE: headless orchestration session logs (gitignored, local only) |
| A | CHECKSUMS.md5 | delete | 0.00 | yes | - | s16 DELETE: checksum sidecar for the removed hardening-corpus export (tracked) |
| A | README_CORPUS.md | delete | 0.00 | yes | - | s16 DELETE: readme sidecar for the removed hardening-corpus export (tracked) |
| B | docs/audit/import_eval_extracted-CORE.json | delete | 5.09 | yes | - | s16 DELETE: regenerable import-eval extraction dump (written by scripts/import-eval.mts:594; tracked, recoverable from history) |
| B | docs/audit/import_eval_extracted-GL.json | delete | 5.88 | yes | - | s16 DELETE: regenerable import-eval extraction dump (tracked, recoverable from history) |
| B | docs/audit/import_eval_extracted-IM.json | delete | 1.21 | yes | - | s16 DELETE: regenerable import-eval extraction dump (tracked, recoverable from history) |
| B | docs/audit/import_eval_extracted-PR.json | delete | 1.79 | yes | - | s16 DELETE: regenerable import-eval extraction dump (tracked, recoverable from history) |
| B | docs/audit/import_eval_results-CORE.json | delete | 0.00 | yes | - | s16 DELETE: regenerable eval results JSON (written by scripts/import-eval.mts:633) |
| B | docs/audit/import_eval_results-GL.json | delete | 0.01 | yes | - | s16 DELETE: regenerable eval results JSON |
| B | docs/audit/import_eval_results-IM-PR.json | delete | 0.02 | yes | - | s16 DELETE: regenerable eval results JSON |
| B | docs/audit/import_eval_results-IM.json | delete | 0.00 | yes | - | s16 DELETE: regenerable eval results JSON |
| B | docs/audit/import_eval_results-PR.json | delete | 0.01 | yes | - | s16 DELETE: regenerable eval results JSON |
| B | docs/audit/import_eval_results.json | delete | 0.01 | yes | - | s16 DELETE: regenerable eval results JSON |
| B | docs/audit/filing_live_results.json | delete | 0.01 | yes | - | s16 DELETE: regenerable live-run transcript (written by scripts/filing-live.mts:200) |
| B | docs/audit/import_live_results-addl.json | delete | 0.01 | yes | - | s16 DELETE: regenerable live-run transcript |
| B | docs/audit/import_live_results-adv.json | delete | 0.00 | yes | - | s16 DELETE: regenerable live-run transcript |
| B | docs/audit/import_live_results-none.json | delete | 0.00 | yes | - | s16 DELETE: regenerable live-run transcript |
| B | docs/audit/import_live_results-pdf-roundtrip.json | delete | 0.00 | yes | - | s16 DELETE: regenerable live-run transcript |
| B | docs/audit/import_live_results-pdf.json | delete | 0.00 | yes | - | s16 DELETE: regenerable live-run transcript |
| B | docs/audit/import_live_results.json | delete | 0.01 | no | - | s16 DELETE: regenerable live-run transcript (gitignored/untracked) |
| B | docs/audit/ops_live_results.json | delete | 0.01 | yes | - | s16 DELETE: regenerable live-run transcript |
| B | docs/audit/portal_live_results.json | delete | 0.01 | yes | - | s16 DELETE: regenerable live-run transcript |
| B | docs/audit/seed_v2_live_results.json | delete | 0.00 | yes | - | s16 DELETE: regenerable live-run transcript |
| B | docs/build/wave1-core-live-attempt1-aborted45min.log | delete | 0.00 | no | - | s16 DELETE: byte-identical copy of docs/import-hardening/RESULTS/ original (sha256-verified by purge-wave) |
| B | docs/build/wave1-core-live.log | delete | 0.01 | no | - | s16 DELETE: byte-identical copy of docs/import-hardening/RESULTS/ original (sha256-verified) |
| B | docs/build/wave2-core-live.log | delete | 0.05 | no | - | s16 DELETE: byte-identical copy of docs/import-hardening/RESULTS/ original (sha256-verified) |
| B | docs/build/phasew-offline-run.md | delete | 0.00 | no | - | s16 DELETE: byte-identical copy of docs/import-hardening/RESULTS/ original (sha256-verified); corpus-baseline.json and wave1-live-attempts.md DIFFER and are kept |
| C | review-packet | archive | 24.52 | yes | C:\Users\salvatore.scrudato\hub-archive\2026-07-16\wave-C\review-packet | s16 ARCHIVE: external review dossier (SVGs, prompts, 46 authed screenshots, capture harness); one-shot deliverable, delivered |
| C | claims_analysis | archive | 0.79 | yes | C:\Users\salvatore.scrudato\hub-archive\2026-07-16\wave-C\claims_analysis | s16 ARCHIVE: claims enhancement recon artifacts; workstream closed (claims copilot already enhanced) |
| C | docs/handoff | archive | 0.90 | yes | C:\Users\salvatore.scrudato\hub-archive\2026-07-16\wave-C\docs\handoff | s16 ARCHIVE: import-brain + PCM handoff briefs; consumed by completed workstreams; contains stale tmp_keys.md references |
| C | docs/import-hardening | archive | 0.30 | yes | C:\Users\salvatore.scrudato\hub-archive\2026-07-16\wave-C\docs\import-hardening | s16 ARCHIVE: IH1-IH4 ledger+RESULTS, workstream closed (IMPORT-CERTIFIED f67fbf0); ledger.json survives summarized into BACKLOG_SEED by P-REVENG; caveat: scripts/phasep-probes.mts (manual one-off probe) wrote into RESULTS/ and becomes vestigial |
| C | docs/claims-cx-vision | archive | 0.12 | no | C:\Users\salvatore.scrudato\hub-archive\2026-07-16\wave-C\docs\claims-cx-vision | s16 ARCHIVE: claims CX vision docs (untracked); parked workstream |
| C | docs/design-review | archive | 0.04 | no | C:\Users\salvatore.scrudato\hub-archive\2026-07-16\wave-C\docs\design-review | s16 ARCHIVE: design review notes (untracked); consumed |
| C | docs/prompts | archive | 0.06 | no | C:\Users\salvatore.scrudato\hub-archive\2026-07-16\wave-C\docs\prompts | s16 ARCHIVE: agent prompt library incl. PROMPT_IMPORT_CONCEPT_LINKER.md (untracked); concept-linker port is COMPLETE on this branch so the prompt is consumed |
| C | docs/AI_REVIEW.md | archive | 0.07 | yes | C:\Users\salvatore.scrudato\hub-archive\2026-07-16\wave-C\docs\AI_REVIEW.md | s16 ARCHIVE: AI review one-shot deliverable |
| C | additional_samples | SKIPPED-MISSING | - | - | - | s16 ARCHIVE: client-proprietary eval workbooks - already absent at cleanse start, recorded for the map |
| C | docs/kurt-brief.md | SKIPPED-MISSING | - | - | - | s16 personal brief - already absent at cleanse start, recorded for the map |
| C | docs/export-templates/author-xml | archive | 1.39 | yes | C:\Users\salvatore.scrudato\hub-archive\2026-07-16\wave-C\docs\export-templates\author-xml | s16 ARCHIVE: DuckCreek Author XML templates; retirement VERIFIED this run: commit 8825cbd present AND authed /api/duckcreek/* probes returned 404 on local boot (control /api/auth/me 200); sibling xlsx config templates in docs/export-templates/ are kept |

## Judge verdict (pasted verbatim)

JUDGE VERDICT (Haiku 4.5, fresh context, read-only)

CHECK A (verify-protected): PASS - Script exits 0, reports "PROTECTED CLEAN", and all 5 allowed-by-design changes (app/src/lib/capability.ts, app/src/lib/perf/reportWebVitals.ts, package.json, pnpm-workspace.yaml, samples/corpus-2026-07/FIXTURES.md) are in the approved list.

CHECK B (scan-secrets): PASS - Script prints "SCAN CLEAN: 0 hits" and exits 0 (gitleaks fallback pattern grep verified zero secrets in tracked files).

CHECK C (manifest vs git): PASS - Manifest claims "238 files changed, 167 insertions, 637,328 deletions"; actual git diff --stat pre-cleanse-2026-07-16..HEAD output is exactly "238 files changed, 167 insertions(+), 637328 deletions(-)" - zero drift. Spot-checked 11 tracked deletions from Actions table (CHECKSUMS.md5, README_CORPUS.md, docs/audit/import_eval_extracted-*.json, docs/audit/import_eval_results-*.json, docs/AI_REVIEW.md, review-packet/*, functions/*, docs/export-templates/author-xml/*) - all confirmed as deleted in git diff.

OVERALL: PASS

## Hostile self-review

1. Is any credential still tracked ANYWHERE in the working tree? Final scan-secrets.mjs
   output over all tracked files:
       gitleaks not installed - using pattern grep fallback
       SCAN CLEAN: 0 hits
   The only live-credential file on disk is keys.md - untracked, git check-ignore
   verified, and it is the designed secret home, not a leak.

2. Did anything on the PROTECTED list move? verify-protected.mjs output:
       verify-protected: HEAD vs pre-cleanse-2026-07-16
       allowed-by-design changes (Phase 2 unwire / Phase 4 staging):
         M  app/src/lib/capability.ts
         M  app/src/lib/perf/reportWebVitals.ts
         M  package.json
         M  pnpm-workspace.yaml
         A  samples/corpus-2026-07/FIXTURES.md
       PROTECTED CLEAN: no protected path moved
   The two app/src files are the user-directed bd75eef checkpoint of foreign edits, the
   other three are the explicitly ordered Phase 2 unwire and Phase 4 staging. Zero
   violations.

3. Does the app boot, gate, and rate the canaries exactly as at baseline?
   Baseline gate:  GREEN - typecheck 24.6s / lint 4.0s / test 96.2s / build 46.8s (171.6s)
   Final gate:     GREEN - typecheck 36.4s / lint 5.8s / test 154.0s / build 142.7s (338.8s)
   The final-run slowdown is concurrent machine load (the same tree gated at 187.7s
   two hours earlier); every step green both times, all four canary values asserted in
   the final test output, and the server boots with /api/health 200 (10 routers mounted).

4. One archived thing a future agent will most likely need back:
   docs/import-hardening/ledger.json (the 37-entry defect ledger) - it is the seed input
   P-REVENG summarizes into BACKLOG_SEED, and any future import-regression triage will
   want the original entries, not the summary. It lives at
   %USERPROFILE%\hub-archive\2026-07-16\wave-C\docs\import-hardening\ledger.json
   (and in git history before f955dff).

5. MB and files shed, wave by wave:
   2-functions: 0.66 MB (1 item, the functions/ package)
   Wave A: 45.72 MB (6 items)  |  Wave B: 14.12 MB (24 items, 4 sha256-verified dups)
   Wave C: 28.18 MB (9 items)  |  Sweep: 0 (nothing unreferenced remained)
   Total: 88.68 MB / 40 executed items (+9 recorded SKIPPED-MISSING); git delta 238
   files, -637,328 lines.

6. Most likely reused ops script and the flag it wants:
   gate.mjs - it is the universal pre-commit ritual. Add `--only <step>` (run a single
   step, e.g. --only test while iterating on a red suite) and a `--json` summary line so
   harnesses can parse timings instead of scraping the log.

## Post-merge correction: docs/export-templates/author-xml RESTORED

The Wave C archive of docs/export-templates/author-xml was verified against THIS branch
(old DuckCreek export removed in 8825cbd; authed /api/duckcreek/* 404). The concurrent P3
lane on main, however, shipped a NEW Duck Creek XML export whose drift/roundtrip tests
(tests/export/node-index-drift.test.ts, tests/export/roundtrip.test.ts) read
author-xml-node-index.json and DCT_SampleProduct_3_0_0_0.xml from that directory as live
fixtures. The merge gate caught it (2 ENOENT failures); the directory is restored in the
merge commit from main's side (byte-identical to the wave-C archive copy - main never
modified it, it only reads it). The Wave C row above is therefore REVERSED for this path;
the archive copy remains as a redundant backup.
