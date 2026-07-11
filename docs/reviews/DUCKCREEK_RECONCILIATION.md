# Duck Creek reconciliation — reference instance vs. our export

**Established 2026-07-10 by reading the reference XML element by element.** Companion to
[docs/DUCKCREEK_MAPPING.md](../DUCKCREEK_MAPPING.md) (the field-by-field mapping contract) and
`shared/src/duckcreek/` (serializer + validator + golden snapshots).

## What the reference is

Two files were supplied and are committed **read-only** under `samples/duckcreek/`:

- `DuckCreekXML.xml` — a complete Duck Creek `<server><responses>` transaction document: an
  `OnlineData.loadPolicyRs` for one **PersonalHome** risk (AIG PCG, a Naples FL coastal-wind
  quote). It carries the coverage tree (typed `<coverage>` with GUID `id`s, `<limit>`/`<deductible>`
  children, `<Caption>`, `<StatCode>` ISO stat-plan blocks, the `Premium`/`change`/`offset`/`onset`/
  `written` transaction quintet plus `TermFactor`/`PremiumAfterWaiver`), `<indicator>`s,
  `<subjectivities>` (with `RuleId`/`TaskQueue`), `<LineOfBusiness>`, and the
  `RiskManuscriptTableManuScriptID` naming.
- `PolicyXML.xml` — **byte-identical** to `DuckCreekXML.xml` (`md5 06f63274…`); it is the same
  transaction document. The "territory mapping tables (distance-from-shore → TerritoryCd)"
  described for it live inside that document as `<veriskIntegrationTerritoryValue>` →
  `<dtsToTerritoryMapping>` (lines ~1058–1123).

> ⚠️ **Instance, not manuscript-definition.** This is *quote* data (one risk, its selected limits,
> its computed premium, address-derived integration values). It is **not** the proprietary Duck
> Creek manuscript-*definition* schema. Our exporter emits a manuscript-**shaped** *definition*
> that reuses this instance's vocabulary — see the honesty caveat in
> [DUCKCREEK_MAPPING.md](../DUCKCREEK_MAPPING.md). The sample's names look like synthetic test
> data ("Florida" / "Wind test", DOB 1999-09-19); it is retained only as a vocabulary reference.

## Source of truth

Everything our export can legitimately assert comes from the **product definition** — the seeded
domain model projected through the PDM (`shared/src/pdm/`): `PdmProduct` → `PdmCoverage` /
`PdmTerm` / `PdmForm` / `PdmRule` / `PdmRatingProgram` / `PdmRatingTable` / `PdmLine` (with
`perilModel`). Runtime values a definition cannot know (a specific risk's premium, territory,
construction, risk scores) are **out of scope**.

## Action legend

- **MAP NOW** — derivable from the product model; emitted by the serializer today.
- **OUT OF SCOPE (runtime)** — a policy-transaction / instance value the platform legitimately does
  not hold at definition time. One-line reason each.
- **NEEDS DATA** — would be mappable but the product model carries no field for it yet.

Emit-vs-omit decision for out-of-scope fields: the reference always emits the **Premium quintet**
(`Premium`/`change`/`offset`/`onset`/`written`) on every coverage, so we **emit it as structural
zeros** to mirror the coverage shape without fabricating amounts. Every *other* runtime-only field
(TermFactor, PremiumAfterWaiver, AOPPremium, risk/severity/frequency scores, ISO stat codes,
Verisk territory rows, subjectivities) is **omitted** — a definition that emitted them would be
inventing instance data. This choice is stated per row below.

---

## A. Policy / manuscript header

| Reference element / attribute | In ref | In export | Source of truth | Action |
|---|:--:|:--:|---|---|
| `manuScriptID="PCG_HO_Admitted_ViewModel_US_1_0_0_0"` (loadPolicyRs, root) | ✓ | ✓ | `mapping.manuscript` + line | **MAP NOW** — root `manuScriptID`, `composeManuscriptId(…, 'viewModel')`. |
| `engineVersion` / `cultureCode` / `currencyCode` | ✓ | ✓ | `mapping.manuscript` | **MAP NOW** — root attributes. |
| `PolicyManuScriptID` / `…VersionID` / `FormsManuScriptID` / `RatingManuScriptID` / `TableManuScriptID` / `CommunicationsManuScriptID` | ✓ | ✓ | `mapping.manuscript.layers` | **MAP NOW** — `policyAdmin` footer. |
| `UseDCTForms` / `UseDCTFormsAndMessages` | ✓ | ✓ | `mapping` | **MAP NOW**. |
| `<LineOfBusiness>PersonalHome</LineOfBusiness>` (policy, ~2339) | ✓ | ✓ | `PdmLine.compactName` (LOB registry) | **MAP NOW** — added this session; child of `<product>`. |
| `QuoteNumber` / `CurrentPolicyNumberIdentifier` / `session` / `properties` | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — a quote/session identity, not a product definition. |
| account / address / party / agent / billing blocks | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — insured/agent PII on one quote. |

## B. Line & risk

| Reference element / attribute | In ref | In export | Source of truth | Action |
|---|:--:|:--:|---|---|
| `<line description="PersonalHome">` + `<Type>PersonalHome</Type>` | ✓ | ✓ | `PdmLine.compactName` | **MAP NOW** — `<line>`/`<Type>`. |
| `line written` / `change` (1676.75) | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — computed premium on one quote. |
| `<risk id displayAdditionalCredits change written>` | ✓ | ✓ (`id`) | product | **MAP NOW** for structure; `change`/`written`/`displayAdditionalCredits` **OUT OF SCOPE (runtime)**. |
| `<exposure t="PolicyForm">HO</exposure>` (182) | ✓ | ✓ | `mapping.policyFormExposureKey` + `lobTokens` | **MAP NOW** — risk policy-form exposure. |
| `<RiskManuscriptTableManuScriptID>PCG_HO_Non_Admitted_Tables_FL_1_0_0_5</…>` (740) | ✓ | ✓ | `PdmLine` + `perilModel.eligibleStates` + `mapping` | **MAP NOW** — added this session; one per peril-eligible state (PH → FL GA NC SC TX incl. the sample's FL), else one national entry. See naming note below. |
| non-coverage risk exposures: `ConstructionType`, `DistanceFromShore`, `YearBuilt`, `RoofShape`, credit flags (`GuardGatedCommunity`, …), `TerritoryCode` (523) | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — address/property-specific risk characteristics collected at quote time. |
| `OverallRiskScore` / `SeverityScore` / `FrequencyScore` (743–745) | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — model scores computed per risk. |
| `AdjustedWind` / `AdjustedNonWind` / `BCEGIntegration` | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — rating/integration internals. |

**ManuScriptID naming convention (deterministic).**
`composeTableManuscriptIdForScope()` composes
`Carrier_LOB_Market_Tables_<scope>_major_minor_build_rev`, e.g. `PCG_HO_Admitted_Tables_FL_1_0_0_0`.
`<scope>` is a two-letter **state** where the line's peril varies by state (`perilModel.eligibleStates`
non-empty), else the **country** token (a uniform-peril line files one national tables manuscript).
It is derived from the product (→ LOB token), the state, and the mapping version — pure, no clock,
so re-exports are byte-identical. The sample's value differs only in **market** (`Non_Admitted`,
because that specific risk is a surplus-lines placement — `ProductCode=NonAdmitted`, 1133) and
**build** (`_5`); both are per-carrier configuration in `mapping.ts`, not derivable from the
definition, so we emit the configured `Admitted` / product version and say so.

## C. Coverage entries

| Reference element / attribute | In ref | In export | Source of truth | Action |
|---|:--:|:--:|---|---|
| `<coverage id="c…">` (GUID, `c` prefix) | ✓ | ✓ | derived from `refId` (`guid.ts`) | **MAP NOW** — deterministic GUID. |
| `t="CoverageA"` … `t="CoverageF"` (type key) | ✓ | ✓ | `PdmCoverage.termKey` = `pascalKey(name)` | **MAP NOW** — "Coverage A — Dwelling" → `CoverageA`; convention confirmed against the sample. |
| `ind="0/1"` | ✓ | ✓ | `PdmCoverage.requirement` | **MAP NOW** — `ind` = mandatory flag (`req` also emitted verbatim). |
| `e="2023-07-21"` (effective date) | ✓ | ✓ (opt-in) | `BuildPdmOptions.effectiveDate` | **MAP NOW** — emitted only when a caller supplies a date; never fabricated. |
| `<Caption>Dwelling</Caption>` | ✓ | ✓ | `PdmCoverage.name` | **MAP NOW**. |
| `<Indicator t="endorsement" ismandatory="0/1"/>` (endorsement coverages, e.g. 1151) | ✓ | ✓ | `PdmCoverage.requirement` + endorsement shape | **MAP NOW** — added this session; emitted on endorsement-like coverages (OPTIONAL / sub-coverages), `ismandatory` from requirement. Base bureau coverages A–F carry none, matching the sample. |
| `Premium`/`change`/`offset`/`onset`/`written` quintet | ✓ | ✓ (zeros) | — | **OUT OF SCOPE (runtime)** — computed premium; **emitted as structural zeros** to mirror the coverage shape (the sample always includes the quintet). |
| `TermFactor` / `PremiumAfterWaiver` / `AOPPremium` / `LiabilityPremium` / `CommissionWaiver*` / `priorTerm` | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — per-term rating outputs; **omitted** (a definition has none). |
| coverage-specific instance fields (`PaymentBasisForDwelling`, `ContentsPeril`, `LimitOverrideFlag`, …) | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — selections on one quote. |
| sub-coverage nesting (Water Back-Up, Scheduled PP, …) | ✓ | ✓ | `parentRefId` | **MAP NOW** — nested `<coverage>` by parent. |
| `<Section>` (LOB section label) | ✗ | ✓ | `PdmCoverage.section` (LOB taxonomy) | **extension** — honest addition; the instance shows no section label. |
| `refId` on every node | ✗ | ✓ | `refId` | **extension** — load-bearing, the round-trip anchor. |

## D. Limits & deductibles

| Reference element / attribute | In ref | In export | Source of truth | Action |
|---|:--:|:--:|---|---|
| `<limit t="Dwelling" id="l…">190000</limit>` | ✓ | ✓ | `PdmTerm` (kind=LIMIT) | **MAP NOW** — typed `<limit>` with `t`/`id`/`refId`/`default`/`structure`/`basis`. |
| `<deductible t="WildFire" id="d…">2</deductible>` (748) | ✓ | ✓ | `PdmTerm` (kind=DEDUCTIBLE) | **MAP NOW** — typed `<deductible>`. |
| the **selected** scalar value (`190000`) | ✓ | — | — | **OUT OF SCOPE (runtime)** — a chosen amount on one quote; the definition emits the *eligible-value list* instead. |
| `<validValues><value …>` full eligible list | ✗ | ✓ | `resolveTermOptions` (`insurance/terms.ts`) | **extension** — a definition must state which limits/deductibles a coverage *offers*; each value carries default/enabled/state applicability. |
| `LimitQuoteDisplay` / `LimitPrior` | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — display/prior-term echoes. |

## E. StatCode (ISO statistical plan)

| Reference element | In ref | In export | Source of truth | Action |
|---|:--:|:--:|---|---|
| `<StatCode id="S…"/>` (the node itself) | ✓ | ✓ (empty) | derived from `refId` | **MAP NOW** — the node + deterministic `S`-prefixed id. |
| `ISOStatPlan`, `ISOSubline`, `ISOPolicyForm`, `ISOConstructionCode` | ✓ | ✗ | — | **NEEDS DATA** — bureau stat-plan codes are definitional but the product model carries no ISO stat-code field. The sample's own additional/endorsement coverages (710, 727, 732) also show an *empty* `StatCode`, so emitting empty is faithful. |
| `ISOTerritoryCode`, `ISOProtectionClass`, `ISOBCEG`, `ISOYearBuilt`, `ISORoofType`, `ISOExposure`, … | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — address/property-derived rating codes for one risk. |

## F. Subjectivities

| Reference element | In ref | In export | Source of truth | Action |
|---|:--:|:--:|---|---|
| `<subjectivities>` / `<subjectivity>` (2281–2334) | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — bind-time underwriting requirements raised on one quote. |
| `RuleId` (HS001…), `TaskQueue` (Ops), `Form`, `Description`, `IsRequired`, `SONLTriggredRuleKey` | ✓ | ✗ | (nearest analog: `PdmRule`) | **OUT OF SCOPE (runtime)** — workflow/queue routing, not product definition. Our eligibility/form-attach **rules** are the definitional analog and *are* exported (region below). |

## G. Indicators

| Reference element | In ref | In export | Source of truth | Action |
|---|:--:|:--:|---|---|
| coverage `<Indicator t="endorsement" ismandatory>` | ✓ | ✓ | `PdmCoverage.requirement` | **MAP NOW** — see region C. |
| account/policy/risk `<indicator t="HighProfile\|BlockMarket\|Platinum\|…">0/1</indicator>` | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — per-account/quote underwriting flags. |

## H. Territory mapping (distance-from-shore → TerritoryCd)

| Reference element | In ref | In export | Source of truth | Action |
|---|:--:|:--:|---|---|
| `<veriskIntegrationTerritoryValue>` → `<dtsToTerritoryMapping>` × 17 | ✓ | ✗ | — | **OUT OF SCOPE (runtime)** — a Verisk *integration* lookup returned for one address (`DistFromShore` band → `TerritoryCd`); not a product-definition table. |
| `DistFromShore` bands ("0 to 500 feet" … "30 mi and above") / `TerritoryCd` (601–604) | ✓ | ✗ | (nearest analog: `PdmLine.perilModel`) | **NEEDS DATA** — we model the *peril* (`COASTAL_WIND_HAIL`, eligible states) but not distance-from-shore→territory bands. We express the peril's state footprint instead, via the state-scoped `RiskManuscriptTableManuScriptID` (region B). |

## Rating & rules (definitional — fully mapped; not a distinct reference region)

The instance carries no rating-worksheet or rule-definition section (it is a computed quote), but a
manuscript *definition* must. We emit both from the product model, flagged as honest additions:
`<rating>` → `<program>`/`<step>` (op/sourceType/tableRef/keys/const/condition/roundTo) and
`<factorTables>` → `<table>` (columns/dimensions/rows), and `<rules>` → `<rule>` (IF/THEN, with
`FORM_ATTACH` rules keyed by state). Sources: `PdmRatingProgram`, `PdmRatingTable`, `PdmRule`.

---

## Out-of-scope ledger (runtime policy-transaction fields)

One line each — the platform legitimately does not hold these at product-definition time:

- **`Premium` / `change` / `offset` / `onset` / `written`** — computed premium & delta transaction
  amounts. *Emitted as `0`* (the sample always includes the quintet; zeros mirror the shape).
- **`TermFactor`, `PremiumAfterWaiver`, `AOPPremium`, `LiabilityPremium`, `CommissionWaiver*`,
  `priorTerm`** — per-term rating outputs / commission handling. *Omitted.*
- **`OverallRiskScore`, `SeverityScore`, `FrequencyScore`, `DistancetoHigherHazard`** — model
  scores computed per risk. *Omitted.*
- **StatCode `ISOTerritoryCode` / `ISOProtectionClass` / `ISOBCEG` / `ISOYearBuilt` / …** —
  address/property-derived stat codes. *Omitted (empty StatCode node kept).*
- **`<veriskIntegrationTerritoryValue>` / `<dtsToTerritoryMapping>`** — address-specific Verisk
  integration result. *Omitted.*
- **`<subjectivities>` (RuleId/TaskQueue/Form)** — bind-time underwriting workflow. *Omitted.*
- **account / party / address / agent / session / quote-number blocks** — insured & quote identity.
  *Omitted.*

## Verification

- **Reconciliation traceability** — every "MAP NOW" row is emitted and asserted in
  `shared/src/duckcreek/serialize.test.ts`; every out-of-scope field is listed above with a reason.
- **Determinism / byte-stability** — `shared/src/duckcreek/golden.test.ts` serializes each seeded
  line twice (byte-identical) and compares to a committed golden under `__golden__/`.
- **Fail-closed validation** — `shared/src/duckcreek/validate.ts` checks required-field presence,
  enum membership, numeric formatting and a parse-back; `validate.test.ts` proves a faithful
  document passes and tampering (non-numeric premium, bad enum, missing LineOfBusiness, dropped
  refId, broken id prefix, missing namespace, malformed XML) fails. The `DuckCreekExportModal`
  surfaces the field-level issue list and disables download unless `report.ok`.
- **Audit continuity** — `functions/src/exportDuckCreek.test.ts` asserts a `manuScriptID`-bearing
  `export-duckcreek` audit event on every export, including a repeat export of the same product.

## Scope note — the Prompt-6 filing fixture

The NJ Lemonade filing-import product is **not** golden-snapshotted: it is an import-time artifact
produced by `reconcileFiling()` (`shared/src/insurance/filing/`), not a seeded standing
`DomainProductBundle`, so there is no PDM to serialize. The three seeded lines (Personal Home,
Personal Auto, General Liability) are the snapshotted set.

---

## REST API — Duck Creek Author export endpoints (v1)

Three endpoints are mounted at `/api/duckcreek/v1` in `server/server.js` by `server/lib/duckcreek.js`:

| Method | Path | Role required | What it does |
|---|---|---|---|
| `POST` | `/api/duckcreek/v1/author/generate` | EDITOR+ | Load product from Cosmos, build PDM, serialize, validate (fail-closed). On pass: store bundle (1-hour TTL, in-memory), emit audit event, return bundleId. On fail: emit rejection audit, return 422 with full report. |
| `POST` | `/api/duckcreek/v1/author/validate` | EDITOR+ | Same build + validate pass, but no bundle stored. Returns the full `ValidationReport`. |
| `GET`  | `/api/duckcreek/v1/author/bundle/:id/download` | EDITOR+ | Stream the stored XML as `application/xml`. Emits a download audit event. Returns 404 if the bundle has expired or doesn't exist. |

Every bundle is stamped with:
- `schemaVersion: "1.0.0"` — the API schema version.
- `manuScriptID` — derived deterministically from the product's LOB and the mapping version
  (e.g. `PCG_HO_Admitted_ViewModel_US_1_0_0_0`), consistent with the existing `export-duckcreek`
  audit events.

**Authentication (layered)**
1. *Outer — Microsoft Entra ID:* Configure App Service authentication V2 with single-tenant Entra
   ID, audience `api://<AZURE_ENTRA_CLIENT_ID>`, scope `user_impersonation`. App Service validates
   the Bearer token and injects `X-MS-CLIENT-PRINCIPAL-ID` before requests reach Express.
2. *Inner — platform JWT:* `auth.requireAuth + requireRole('EDITOR') + requireTenant` enforces the
   EDITOR+ role and tenant scoping in-app. VIEWER is explicitly blocked (CLAUDE.md binding invariant).

**Rate limiting** — token-bucket per platform UID (10 tokens/min by default).
- `DC_RATE_LIMIT_CAP` (default 10): bucket capacity.
- `DC_RATE_LIMIT_RPS` (default 0.1667): refill rate in tokens/second.
- Returns HTTP 429 with `Retry-After` on breach.
- Azure WAF / API Management is the production ceiling; the token-bucket is the in-app guard.

**Audit events** — written to Cosmos (`kind: 'duckcreek_audit'`) for every call.
Actions: `api-duckcreek-generate`, `api-duckcreek-generate-rejected`, `api-duckcreek-validate`,
`api-duckcreek-download`. Each includes `actor`, `productRefId`, `bundleId`, `manuScriptID`,
`schemaVersion`. These are append-only; not keyed by rev, so they never conflict with mutations.

---

## Conventions module — the single file to update when reconciling against a real Author sample

**Q: When a real Duck Creek Author sample arrives and its element names differ from our
assumptions, how many files must change?**

**A: One source file.** `shared/src/duckcreek/mapping.ts` — specifically the
`DEFAULT_DUCKCREEK_MAPPING` object literal — is the single conventions module for every literal
element name, attribute name, id-prefix letter, namespace URI, manuScriptID token, and lobToken
used by the serializer.

Evidence:
- `serialize.ts` accesses all names via `mapping.elements.*` and `mapping.attrs.*` — zero literal
  strings in element-write code.
- `validate.ts` looks up elements via `E[key]` keyed against the same mapping — zero hard-coded
  tag names.
- `server/lib/duckcreek.js` calls `dc.*` functions (from the compiled bundle) — zero Duck Creek
  vocabulary in server code.
- Golden snapshot `.xml` files in `shared/src/duckcreek/__golden__/` **will** contain the old
  element names. After updating `mapping.ts`, regenerate them with:
  ```
  UPDATE_GOLDEN=1 pnpm --filter @pf/shared test golden
  ```
  This is the only additional step — 1 command, not a code change.

**Reconciliation procedure — step by step:**

1. Obtain a real Duck Creek Author *manuscript-definition* XML sample from the carrier.
2. Diff each element and attribute name against the corresponding key in
   `DEFAULT_DUCKCREEK_MAPPING.elements` and `DEFAULT_DUCKCREEK_MAPPING.attrs`.
3. For each mismatch, update the relevant value in `mapping.ts`. No other source file changes.
4. For manuScriptID convention changes, update `mapping.manuscript.*` (carrier, version, layers,
   lobTokens). `composeManuscriptId` + `composeTableManuscriptIdForScope` derive all IDs from that
   config — no code change.
5. Run `UPDATE_GOLDEN=1 pnpm --filter @pf/shared test golden` to regenerate the locked snapshots.
6. Run the full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — the serializer
   tests, validate tests, and golden tests will all confirm the new vocabulary.
7. Update this document's reconciliation table (regions A–H) to reflect which fields are now
   **MAP NOW** vs. **OUT OF SCOPE** given the real schema evidence.

**Checking for leaks:** If you suspect a literal element name leaked somewhere outside `mapping.ts`,
run:
```bash
# Should return zero hits outside mapping.ts and the golden snapshot files
grep -r '"manuscript"' shared/src/duckcreek/ --include='*.ts' | grep -v mapping.ts
grep -r '"coverage"'   shared/src/duckcreek/ --include='*.ts' | grep -v mapping.ts
grep -r '"FormNumber"' shared/src/duckcreek/ --include='*.ts' | grep -v mapping.ts
```
The result for a clean codebase is empty — all element names are DATA in `mapping.ts`.
