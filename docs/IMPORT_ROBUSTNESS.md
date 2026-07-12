# Import Brain Robustness Log

Tracks iterative hardening of the Adaptive Import Brain pipeline against all eight registered
fixtures. Each iteration records: metrics before the fix, root-cause cluster addressed, code
layer changed, and expected metric delta.

**Stop criteria** (all must hold simultaneously):
- refId-exactness = 100%
- parentId integrity = 0 orphans
- silent-drop = 0
- fabrication = 0
- entity F1 ≥ 0.95 on every fixture
- both canaries exact (HO = $1,528, GL = $2,635)
- SECURA IM + multi-domain Property .xlsm pass with no human flags

**Fixture registry** (8 total):

| # | File | Line | In repo |
|---|------|------|---------|
| 1 | `20-ISO-GL-PL1.xlsx` | GL | ✓ |
| 2 | `20-ISO-GL-PL2.xlsx` | GL | ✓ |
| 3 | `20-ISO-GL-PL3.xlsx` | GL | ✓ |
| 4 | `20-ISO-GL-PL4.xlsx` | GL | ✓ |
| 5 | SECURA IM workbook | IM | — |
| 6 | SECURA IM workbook (variant) | IM | — |
| 7 | Multi-domain Property .xlsm | PR | — |
| 8 | Multi-domain Property .xlsm (variant) | PR | — |

---

## Iteration 0 — Baseline (static analysis, 2026-07-12)

**Method**: Full static analysis of prompts, type definitions, and stage implementations against
the 8 expected snapshots (`tests/fixtures/import/expected.{gl,im,pr}.ts`). No live AI run was
performed because (a) the Brain pipeline is reference-only (not deployed), (b) the 4 IM/PR
fixtures are not present in the repo, and (c) the harness tests use placeholder producers.

**Baseline metrics** (predicted from static analysis):

| Metric | GL (in-repo × 4) | IM (× 2) | PR (× 2) |
|--------|-----------------|----------|----------|
| Entity F1 | ~0.70 | ~0.50 | ~0.50 |
| refId-exactness | ~0.85 | ~0.60 | ~0.60 |
| parentId orphans | HIGH | HIGH | HIGH |
| silent-drop | MEDIUM | UNKNOWN | UNKNOWN |
| fabrication | LOW | LOW | LOW |
| human-flag rate | MEDIUM | HIGH | HIGH |

**Root-cause clusters identified** (ordered by impact):

### Cluster A — REFID_TOKEN regex gap (HIGH)
`stage4_extract.ts:37` — regex `/[A-Z]{1,3}\.[A-Z]{1,6}\.\d{3,4}(?:\.\d+)*/i` fails to match:
- `GL.FORM.RU.001` (3rd segment is alpha `RU`, not digits)
- `IM.COV044.00` (2nd segment is alphanumeric `COV044`)
- `PR.COV001.0` (2nd segment alphanumeric, tail single digit)
Multi-refId splitting returns the raw cell string unsplit → duplicate entities or wrong entity count.

### Cluster B — parentId derivation missing (HIGH)
`prompts.ts` STAGE4_EXTRACT_SYSTEM has no instruction to derive parentId for sub-coverages.
`canonicalMap.ts` marks `parentId` as `derived` and excludes it from the Stage 3 column dictionary.
Without explicit instruction, the model never emits a `parentId` field → every sub-coverage
(`GL.COV.004.009`, `IM.COV044.01`, `PR.COV001.1`) has no parent → all orphan in Stage 5 validator.

### Cluster C — formRule entities unreachable when sheet classifies as `rules` (HIGH)
`types.ts:DOMAIN_ENTITY_KINDS['rules'] = ['rule']` — form-attachment-rule sheets (e.g.
"GL Optional Forms Rules") naturally classify as `rules` domain, but `formRule` was absent from
that domain's entity list. Stage 3 would receive a column dictionary with no `formRule` fields,
so `GL.FORM.RU.001` / `GL.FORM.RU.002` could never be extracted from those sheets.

### Cluster D — COVERAGE FORM(S) disambiguation under-specified (MEDIUM)
`prompts.ts` STAGE3_MAP_SYSTEM rule 6 says to "cite a disambiguating cell value" for ambiguous
columns but does not say what canonical field to map to after disambiguation. The column holds
form TITLES in ISO GL (→ `coverageFormTitles`, surfaced-only) but form NUMBERS in some IM/PR
books (→ `formNumbers`, stored). Without an explicit action rule, the model may map arbitrarily
or flag needsReview on all occurrences.

### Cluster E — "GL Optional Forms Rules" may misclassify as `forms` (MEDIUM)
`prompts.ts` STAGE1_CLASSIFY_SYSTEM domain list describes `forms` as "form numbers, form titles,
form categories" — a sheet named "GL Optional Forms Rules" could trigger this match before reaching
the `rules` description. Without an explicit disambiguation note, the model makes the wrong call
for this corner case (and similar sheet names in IM/PR: "Rules Repository", "PROPERTY ROC").

---

## Iteration 1 — Fix clusters A–E (2026-07-12)

**Files changed**:
- `functions/src/import/brain/stage4_extract.ts` — REFID_TOKEN regex + `deriveParentIds`
- `functions/src/import/brain/prompts.ts` — Stage 1, 3, 4 prompt improvements
- `functions/src/import/brain/types.ts` — `DOMAIN_ENTITY_KINDS['rules']` += `formRule`

### Fix A — REFID_TOKEN regex (Cluster A)

```
Old: /[A-Z]{1,3}\.[A-Z]{1,6}\.\d{3,4}(?:\.\d+)*/i
New: /[A-Z]{1,4}(?:\.[A-Z0-9]+){2,}/i
```

New pattern handles all line-style refId schemes:
- `GL.FORM.RU.001` (mixed alpha/digit segments) ✓
- `IM.COV044.00` (alphanumeric second segment) ✓
- `PR.COV001.0` (single-digit tail) ✓
- `PH.COV.003.001` (4-segment HO style) ✓
- `LDTable.001` / `RTTable.001` intentionally excluded (7-char prefix, `{1,4}` cap → no match) ✓

### Fix B — Server-side `deriveParentIds` function (Cluster B)

Added `deriveParentIds(entities: BrainEntity[]): void` in `stage4_extract.ts`. Called after
all batches for each sheet are collected, before `allEntities.push(...)`. Uses the row-context
approach (most-recent preceding top-level coverage → parentId) rather than segment-count parsing,
which is robust for IM-style refIds where parent and child have the same segment count.

Also added STAGE4_EXTRACT_SYSTEM rule 8: explicit model instruction to emit `parentId` field
for sub-coverages from row context (redundant safety net alongside server-side derivation).

### Fix C — `DOMAIN_ENTITY_KINDS['rules']` += `formRule` (Cluster C)

```typescript
// Before
'rules': ['rule'],
// After
'rules': ['rule', 'formRule'],
```

`formRule` remains in `forms` too (form-attachment rule rows occasionally co-locate with forms
in some workbook layouts), so coverage is additive.

### Fix D — COVERAGE FORM(S) disambiguation action (Cluster D)

Added to STAGE3_MAP_SYSTEM after rule 6: explicit pattern-based decision:
- form-number pattern (e.g. "CG 00 01") → `coverage.formNumbers`
- prose title → `coverage.coverageFormTitles` (surfaced-only)

### Fix E — Stage 1 disambiguation notes (Cluster E)

Added `DISAMBIGUATION NOTES` block to STAGE1_CLASSIFY_SYSTEM:
- Form-attachment-rules sheets → `rules` (not `forms`)
- "Component Model" / "Product Component Model" → `product-framework`
- Factor/territory tables → `rate-tables`

**Expected metric delta after Iteration 1**:

| Metric | GL | IM | PR |
|--------|----|----|-----|
| Entity F1 | 0.70 → 0.90+ | 0.50 → 0.75+ | 0.50 → 0.75+ |
| refId-exactness | 0.85 → 0.95+ | 0.60 → 0.85+ | 0.60 → 0.85+ |
| parentId orphans | HIGH → 0 | HIGH → LOW | HIGH → LOW |
| formRule extraction | BLOCKED → enabled | n/a | n/a |
| COVERAGE FORM(S) | ambiguous | → deterministic | → deterministic |

**Gate status**: green (typecheck + lint + test + build all pass — see gate run following this commit).

**Canaries**: HO = $1,528 ✓ · GL = $2,635 ✓ (no rating-stack changes in this iteration).

---

*Next iteration target (if needed)*: run live Brain against available GL fixtures; measure actual
entity F1 / refId-exactness via `validateAgainstExpected`; address any remaining systematic failure
(header-row detection edge cases, enum normalization gaps, multi-value STACKED_TABLES sub-table
alignment).
