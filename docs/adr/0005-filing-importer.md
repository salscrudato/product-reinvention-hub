# ADR 0005 — Filing importer (the second ingestion mechanism) + evaluator credit-cap extension

**Status:** Accepted 2026-07-10
**Context companions:** `docs/reviews/GROUND_TRUTH.md` V16, ADR 0003 (enhancement baseline)

## Context

The platform had one ingestion mechanism: the ISO-workbook importer (`shared/src/insurance/isoImport.ts`
→ `app/src/lib/import/importProduct.ts`), which maps structured spreadsheets onto the canonical
model. Real carriers do not file spreadsheets — they file **documents**: a rate order of
calculations, a rate manual, and a policy form. We need a second ingestion mechanism that turns
that document set into a reviewable, governed product without re-inventing the coverage model,
the persistence path, or the anti-fabrication guarantees the platform already holds.

The reference set is the NJ Lemonade Homeowners filing (`samples/filings/nj-lemonade-ho/`): the
RATE ORDER OF CALCULATIONS, the HOMEOWNERS MANUAL (ed. Dec 2023), and the policy form
`LEM 03 05 23`. Their anatomy is **standard filing anatomy**, so the pipeline generalises from it.

## Decision

### 1. Compose, don't duplicate

- **Pure domain** in `shared/src/insurance/filing/` — platform-free types, a concept registry
  (rule-number semantics + concept identity), a deterministic table parser, and a pure
  `reconcileFiling()` that emits the **same** `ImportPlan`/`PlannedEntity` shape the workbook
  importer produces. So a filing persists through the identical atomic path
  (`importPlan()` → `adapter.db.mutate()`), with lineage `IMPORT`.
- **Server pipeline** `functions/src/filingImport.ts` — SSE, EDITOR/ADMIN, cost-guarded
  (`sseCostGate`), telemetry (`recordCascade`). Three stages: CLASSIFY (role from structural
  cues), EXTRACT (role-specific forced tools with the cheap-first→escalate cascade), RECONCILE
  (pure). The **policyForm** stage runs the EXISTING four-section `extractCoverages` machinery
  (`runFourSectionExtraction`, factored out of `extract.ts`) — not a parallel implementation.
- **Review UI** `app/src/components/product/FilingImportModal.tsx` reuses the Builder import
  review pattern (`ImportWorkbookModal`): staged proposals with confidence + citation, UNRESOLVED
  first, per-section accept, nothing persists without review.

### 2. The model never transcribes a table

A rate manual's factor tables (zip→territory→factor triples, a deductible matrix) are parsed by
**deterministic code** (`filing/tableParser.ts`). The model discovers the table's **schema** and
quotes its **verbatim source region**; the parser produces the rows and counts anything it can't
parse (never invents). A sampled verification (`sampleCells` + `cellValueAppearsInText`)
cross-checks parsed cells against the region. This is the structural anti-fabrication guarantee.

### 3. Everything unresolved is visible; nothing is silently dropped

Every rate-order multiplicative step must resolve to an RT/LD/scalar source, every additive step
to a rate schedule / flat premium. Anything that cannot be grounded is emitted as an
`UnresolvedItem` **with its reason and citation**. The bundle carries a `counts` field proving the
conservation law **proposed === accepted + unresolved** (asserted by the golden test).

### 4. Evaluator credit-cap extension (additive, opt-in)

A filing's "maximum credits" rule (Lemonade NJ **Rule 92**: max total credit 50% for LEM 03)
caps the **cumulative product** of a named set of credit factors — something a chain of
independent `MUL` steps cannot express. Rather than a bespoke op, the evaluator honours two
OPTIONAL fields: `RatingStep.isCredit` flags a credit step and `RatingProgram.creditFloor` sets
the floor. When `creditFloor` is set, the evaluator applies **one** corrective factor right after
the last credit step (emitting a distinct, auditable trace entry) so the cumulative credit never
dips below the floor. Programs that set neither field — **every** legacy/seeded program — run
byte-identically, so the $1,528 (HO-3), $1,002 (Personal Auto) and $2,635 (GL) canaries are
untouched. See `shared/src/rating/evaluator.ts` and `evaluator.creditFloor.test.ts`.

### 5. Imported products price through the shared evaluator with no bespoke getter

The reconcile builds every RT table in the **grid shape** (`dimensions` + `valueColumn`), so
`genericRtLookup` resolves them and the Personal-Home kit's getter prices them unchanged. To make
the product priceable in the UI, `deriveGridInputSpec()` builds a data-driven worksheet + a
guaranteed-resolvable worked example from the program's own table dimensions; `ProductPricing`
uses it when the program reads grid tables (null — hence untouched — for the seeded lines).

## Consequences

- The imported reference product carries a frozen canary premium of **$1,281** (derivation in
  `filing/reconcile.test.ts`), priced through the same `evaluate()` the pricing tab calls.
- New cost feature key `filingImport` ($0.085 est.) in `costGuard.ts`.
- The reference PDFs live in `samples/filings/nj-lemonade-ho/` (committed, like `samples/iso/`).
- Live-model + emulator drive (upload→review→accept→pricing in the browser) is exercised offline
  via the AI_FAKE pipeline test (`functions/src/filingImport.test.ts`) and the shared golden +
  canary tests; the live browser walkthrough is the one step not automatable in CI.
