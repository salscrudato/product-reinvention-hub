I have a strong corpus of Rebecca Freeman's and Peter Jones's methodology materials. Let me open the two most authoritative sources — the Product Training deck and the Product Specifications Overview — to extract full first-principles definitions before synthesizing.# P\&C Insurance Product Methodology — Conceptual Definition (AI-Consumable)

Synthesized from the Product Offering methodology developed and taught by **[Freeman, Rebecca](https://www.office.com/search?q=Freeman%2c+Rebecca\&EntityRepresentationId=0e0dd0ce-5b62-4781-9526-2092f1b1432a)** (Managing Director, Product Offering Executive) and **[Jones, Peter L.](https://www.office.com/search?q=Jones%2c+Peter+L.\&EntityRepresentationId=052c68fa-6e3b-48cf-9dc9-ff723fd4b62c)** (Senior Manager, Product Definition, Rationalization & Governance), and refined across engagements at SECURA, Travelers, Nationwide, AIG/PCS, USAA, and Hagerty. This definition is written for an AI to reason over insurance products with the same first-principles the practice uses.

***

## 1. Purpose & First Principles

An **insurance product** is a **structured promise of protection** offered to a market. The methodology's core principle is that a product is not a document, a form, or a system configuration — it is a **hierarchical set of components** whose relationships (rules), presentation (forms) and pricing (rates) must be defined **from a business perspective, before technology is chosen**, and remain the single source of truth thereafter. [\[Product Tr...3_February \| PowerPoint\]](https://ts.accenture.com/sites/ProductCommunityofPracticeCoP/_layouts/15/Doc.aspx?sourcedoc=%7BAA02AA6F-08BF-4CAE-88E3-3A517B6FB918%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[Product Tr...g_FY23_May \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B9D3A250B-3C68-4A3A-9FB7-B214A53DA0D5%7D&file=Product%20Training_FY23_May.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[20260303 P...vF SHARED \| PowerPoint\]](https://ts.accenture.com/sites/Hagerty-ApexDiagnostics/_layouts/15/Doc.aspx?sourcedoc=%7BFFD3A05F-2156-40E5-A202-1451588C8780%7D&file=20260303%20Product%20Framework%20%26%20Specifications_Team%20Kickoff%20vF%20SHARED.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

Four axioms govern the entire methodology:

1. **Business-defined, technology-agnostic.** The product definition is authored in business language and is portable across policy admin platforms (Guidewire, Duck Creek, Socotra, legacy). Product Specifications are explicitly **NOT policy requirements** — policy requirements come later, after technology selection. [\[Product Tr...3_February \| PowerPoint\]](https://ts.accenture.com/sites/ProductCommunityofPracticeCoP/_layouts/15/Doc.aspx?sourcedoc=%7BAA02AA6F-08BF-4CAE-88E3-3A517B6FB918%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[Product Tr...g_FY23_May \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B9D3A250B-3C68-4A3A-9FB7-B214A53DA0D5%7D&file=Product%20Training_FY23_May.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[20260303 P...vF SHARED \| PowerPoint\]](https://ts.accenture.com/sites/Hagerty-ApexDiagnostics/_layouts/15/Doc.aspx?sourcedoc=%7BFFD3A05F-2156-40E5-A202-1451588C8780%7D&file=20260303%20Product%20Framework%20%26%20Specifications_Team%20Kickoff%20vF%20SHARED.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)
2. **Coverage is the atomic unit of protection.** Every product is grounded in coverages; everything else (rates, rules, forms) exists to modify, enable, price, present, or govern coverages. [\[NOT SCRUBB...Transition \| Word\]](https://ts.accenture.com/sites/Hagerty-ApexDiagnostics/_layouts/15/Doc.aspx?sourcedoc=%7B82B07B4A-C96D-42C7-8674-26150C3E6EFF%7D&file=NOT%20SCRUBBED%20Product%20Framework%20%26%20Specifications_Knowledge%20Transition.docx&action=default&mobileredirect=true&DefaultItemOpen=1)
3. **Relationships are first-class.** The value of the model is not the list of components — it is the enforced parent/child, attach-point, and cardinality relationships between them. Product decisions must consider **the impact of changing relationships**. [\[Product Tr...3_February \| PowerPoint\]](https://ts.accenture.com/sites/ProductCommunityofPracticeCoP/_layouts/15/Doc.aspx?sourcedoc=%7BAA02AA6F-08BF-4CAE-88E3-3A517B6FB918%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)
4. **Rationalize before you implement.** Simplification of forms, rules and rates before build reduces implementation effort by \~15–60% and materially improves speed to market. [\[Slide Commentary \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAARJU2qSAAA%3d&exvsurl=1&viewmodel=ReadMessageItem), [\[Product Cr...tials.pptx \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEJAACJASweA%2bNcTZGq5OxusfiFAANZlIXwAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

***

## 2. The Canonical Product Hierarchy (PCM — Product Component Model)

The PCM is the **central, versioned, component-based graph** that represents a product. It is defined by a **strictly enforced hierarchy** with the following node types and cardinalities: [\[RE: Reques...Insurance \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAbm24xVAAA%3d&exvsurl=1&viewmodel=ReadMessageItem), [\[D26-194 fo...Insurance \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAbW5gTfAAA%3d&exvsurl=1&viewmodel=ReadMessageItem), [\[FW: Hagert...tion Track \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEJAACJASweA%2bNcTZGq5OxusfiFAAZ3VJYfAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

```
Product ──1:M── Line of Business (LOB) ──1:M── Coverage ──1:M── Sub-Coverage
```

Attached to Coverage and Sub-Coverage (1:M each): **Limits, Deductibles, Rating Steps, Forms** (that enable the coverage).
Attached at any level: **Rules**. Attached to Product/LOB: **Forms** (Base Coverage Forms, Notices). [\[RE: Reques...Insurance \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAbm24xVAAA%3d&exvsurl=1&viewmodel=ReadMessageItem), [\[Product Sp...s Overview \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B792EC7EC-C704-4A03-B0B4-6FB945154BA3%7D&file=Product%20Specifications%20Overview.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

### 2.1 Node Definitions (from the Product Design Framework)

| Node                       | Definition                                                                                                                                                                                   | Guidance / Constraints                                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Product**                | A single Line of Business (monoline) OR multiple Lines of Business (a package) **presented for sale and distribution in the market** by an insurer.                                          | Must have ≥1 LOB. Governed by availability rules, packaging/bundling, pricing modifications, forms alignment. [\[Product Tr...3_February \| PowerPoint\]](https://ts.accenture.com/sites/ProductCommunityofPracticeCoP/_layouts/15/Doc.aspx?sourcedoc=%7BAA02AA6F-08BF-4CAE-88E3-3A517B6FB918%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[Product Tr...g_FY23_May \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B9D3A250B-3C68-4A3A-9FB7-B214A53DA0D5%7D&file=Product%20Training_FY23_May.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)                                                                |
| **Line of Business (LOB)** | A group of related Coverages within a Product.                                                                                                                                               | Must have ≥1 Coverage. Governed by availability rules, pricing modifications, forms alignment. [\[Product Tr...3_February \| PowerPoint\]](https://ts.accenture.com/sites/ProductCommunityofPracticeCoP/_layouts/15/Doc.aspx?sourcedoc=%7BAA02AA6F-08BF-4CAE-88E3-3A517B6FB918%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)                                                                                                                |
| **Coverage**               | The **scope of protection against a specific loss or liability**. **Must have** a limit, a deductible, a premium, and the ability to report claims.                                          | May contain ≥1 Sub-Coverages. Typically aligns to a single LOB. If there is no limit, deductible or premium, it is **not** a coverage (e.g., exclusions are not coverages). [\[Product Tr...3_February \| PowerPoint\]](https://ts.accenture.com/sites/ProductCommunityofPracticeCoP/_layouts/15/Doc.aspx?sourcedoc=%7BAA02AA6F-08BF-4CAE-88E3-3A517B6FB918%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[RE: Produc...chitecture \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAP3FjUEAAA%3d&exvsurl=1&viewmodel=ReadMessageItem) |
| **Sub-Coverage**           | Scope of protection with a **parent-child relationship** to a Coverage; also has a limit, deductible, premium, and claims-reporting. Often supplementary or optional for additional premium. | May share the parent's limit, deductible, or premium; or have its own. Travels with its parent. [\[Product Tr...3_February \| PowerPoint\]](https://ts.accenture.com/sites/ProductCommunityofPracticeCoP/_layouts/15/Doc.aspx?sourcedoc=%7BAA02AA6F-08BF-4CAE-88E3-3A517B6FB918%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[RE: Reques...Insurance \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAbm24xVAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)                                                                              |

### 2.2 Coverage-Level Attributes (PCM Column Definitions per [Jones, Peter L.](https://www.office.com/search?q=Jones%2c+Peter+L.\&EntityRepresentationId=052c68fa-6e3b-48cf-9dc9-ff723fd4b62c)) [\[RE: Produc...chitecture \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAP3FjUEAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

* **Claims Basis**: `Occurrence` (covers incidents during policy period regardless of when reported) or `Claims-Made` (covers only claims that occur *and* are reported within the policy period).
* **Coverage Requirement**: `Mandatory` (legally required) or `Optional` (added for additional premium).
* **Coverage Scope**: `First Party` (protects the insured's own property/self) or `Third Party` (protects the insured against liability to others).
* **Coverage Effect**: `Grants Coverage` | `Restricts` | `Broadens` | `Amends`.
* **Premium Generating?**: `Yes` / `No` — does this element impact premium.
* **Rating Bureau** vs. **Proprietary**: `ISO` / `AAIS` / `NCCI` / `ACORD` etc. vs. carrier-defined.
* **Claims Expense within Limit?**: Yes/No.
* **State Applicability**: The states in which the component applies (a cross-cutting variation dimension — any node may have state-specific variants). [\[RE: Reques...Insurance \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAbm24xVAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

### 2.3 Framework ID Linkage

Every row of the PCM has a **unique Product Framework ID**, which is the linkage key across Forms, Rules and Rating specifications: [\[Product Sp...s Overview \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B792EC7EC-C704-4A03-B0B4-6FB945154BA3%7D&file=Product%20Specifications%20Overview.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[NOT SCRUBB...Transition \| Word\]](https://ts.accenture.com/sites/Hagerty-ApexDiagnostics/_layouts/15/Doc.aspx?sourcedoc=%7B82B07B4A-C96D-42C7-8674-26150C3E6EFF%7D&file=NOT%20SCRUBBED%20Product%20Framework%20%26%20Specifications_Knowledge%20Transition.docx&action=default&mobileredirect=true&DefaultItemOpen=1)

* **Base Coverage Forms** link to the **Product ID**.
* **Coverage & Exclusion Forms** link to the corresponding **Coverage ID**.
* **Notices** link to the **LOB ID**.
* **Endorsements/Exclusions** that modify existing coverage tie to the**"highest" (most general) Product Framework ID** that they modify. [\[NOT SCRUBB...Transition \| Word\]](https://ts.accenture.com/sites/Hagerty-ApexDiagnostics/_layouts/15/Doc.aspx?sourcedoc=%7B82B07B4A-C96D-42C7-8674-26150C3E6EFF%7D&file=NOT%20SCRUBBED%20Product%20Framework%20%26%20Specifications_Knowledge%20Transition.docx&action=default&mobileredirect=true&DefaultItemOpen=1)

***

## 3. The Three Specification Pillars — "Governed / Presented / Priced"

Per [Jones, Peter L.](https://www.office.com/search?q=Jones%2c+Peter+L.\&EntityRepresentationId=052c68fa-6e3b-48cf-9dc9-ff723fd4b62c), insurance products are split into three distinct, complementary categories: [\[Product Sp...s Overview \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B792EC7EC-C704-4A03-B0B4-6FB945154BA3%7D&file=Product%20Specifications%20Overview.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

| Pillar                    | Answers                                         | Single Repository For                                                                                                |
| ------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Rules Specifications**  | How is the product **governed** in the market?  | Product Eligibility, Availability, Packaging, Bundling, Base/Mandatory/Optional Coverage, Limits & Deductibles rules |
| **Forms Specifications**  | How is the product **presented** in the market? | All product form details, form categories, attachment conditions, dynamic vs. static data                            |
| **Rating Specifications** | How is the product **priced** in the market?    | Rating algorithms, rating steps, factor tables, order-of-calculation (ROC)                                           |

Product Specifications **build on** the Product Framework (PCM); the PCM without specs is a hierarchy, the specs without the PCM are unlinked artifacts. [\[Product Tr...g_FY23_May \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B9D3A250B-3C68-4A3A-9FB7-B214A53DA0D5%7D&file=Product%20Training_FY23_May.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

***

## 4. Rules — First-Principles Model

### 4.1 Product Rules ≠ Underwriting Rules (critical distinction)

* **Product Rules** govern the **product itself** — what can be sold, packaged, bundled, defaulted, made mandatory/optional, and the ranges of limits/deductibles. They are documented in the Product Rules Specifications. [\[Product Sp...s Overview \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B792EC7EC-C704-4A03-B0B4-6FB945154BA3%7D&file=Product%20Specifications%20Overview.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)
* **Underwriting Rules** govern **risk-specific decisions** on an individual quote/policy (e.g., "New Ventures cannot have Separate Defense Limit"). They belong in an underwriting rules repository, **not** in Product Rules. [\[NOT SCRUBB...Transition \| Word\]](https://ts.accenture.com/sites/Hagerty-ApexDiagnostics/_layouts/15/Doc.aspx?sourcedoc=%7B82B07B4A-C96D-42C7-8674-26150C3E6EFF%7D&file=NOT%20SCRUBBED%20Product%20Framework%20%26%20Specifications_Knowledge%20Transition.docx&action=default&mobileredirect=true&DefaultItemOpen=1), [\[Product Tr...3_February \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7BE659DC7F-A1D8-4170-ABAC-4EB678733787%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

### 4.2 Rules Repository Data Model [\[Product Tr...3_February \| PowerPoint\]](https://myoffice.accenture.com/personal/daniel_kukuyev_accenture_com/_layouts/15/Doc.aspx?sourcedoc=%7B18855529-552F-4A6D-AB71-A896A1FD71EE%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

Every rule has: `Rule ID`, `Rule Category`, `Rule Sub-Category`, `Rule Condition` (the trigger/description), `Rule Outcome` (the action/end state), and `Rule Dependency` (relationships to other rules).

### 4.3 Product Rule Taxonomy (Category → Sub-Category) [\[Product Sp...s Overview \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B792EC7EC-C704-4A03-B0B4-6FB945154BA3%7D&file=Product%20Specifications%20Overview.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

| Category | Sub-Category                                  | Definition                                                              | Example                                                           |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Product  | **Product Eligibility**                       | Which Products are available based on attributes of a Class of Business | Class code X ineligible for Liquor Liability                      |
| Product  | **Product Availability**                      | Where a Product can be written (geography, agent, BU)                   | Agent not licensed in state X                                     |
| Product  | **Packaging (LOB)**                           | Which Products/LOBs can be combined or written together                 | Marine Builders Risk incompatible with Property Builders Risk     |
| Product  | **Bundling (Programs)**                       | Which Coverages travel together                                         | Coverages that must/cannot be written together                    |
| Product  | **Base Coverage (Default)**                   | What is offered by default for a given Product/state/class              | When LOB=GL, CGL base (CG0001) is default                         |
| Product  | **Mandatory Inclusion/Exclusion of Coverage** | Coverages that must be offered or must be excluded                      | Coverages X,Y,Z included by default for Product Q                 |
| Product  | **Optional Coverage Eligibility**             | Which optional coverages may be offered                                 | Professional Liability optional only if CG0001 present            |
| Product  | **Optional Coverage Selection**               | Which coverages are optional by Product                                 | Spoilage remains optional even if standalone                      |
| Product  | **Limit Ranges & Defaults**                   | Available limits per coverage                                           | If Pesticide/Herbicide coverage selected, X limits available      |
| Product  | **Deductible Ranges & Defaults**              | Available deductibles per coverage                                      | If Pesticide/Herbicide coverage selected, X deductibles available |
| Rating   | **Minimum / Additional / Return Premium**     | Premium floor and adjustments                                           | Minimum premium = $250                                            |

### 4.4 Attachment Point Principle

A rule may attach to any level of the hierarchy — **Product, LOB, Coverage, Sub-Coverage, Limit, Deductible, Rating Step, or Form** — and the structural attachment point is part of the rule's definition. State/geography is a cross-cutting variation dimension applicable to any rule. [\[RE: Reques...Insurance \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAbm24xVAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

***

## 5. Forms — First-Principles Model

### 5.1 Form Categories [\[Product Sp...s Overview \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B792EC7EC-C704-4A03-B0B4-6FB945154BA3%7D&file=Product%20Specifications%20Overview.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

* **Declaration / Schedule** — details all policy information plus schedules
* **Policy Notice** — informational notice to the Insured
* **Base Coverage Form** — the form that *grants* the coverage of the product (e.g., ISO CG 00 01 for CGL)
* **Endorsement** — adds or amends coverage
* **Exclusion** — removes or amends coverage
* **Other Policy Documents** — Cover Letter, Quote Letter, Binder
* **Trailing Documents** — e.g., Rejection forms
* **Marketing Materials**

### 5.2 Form Data Model (per Peter Jones) [\[Product Sp...s Overview \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B792EC7EC-C704-4A03-B0B4-6FB945154BA3%7D&file=Product%20Specifications%20Overview.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

Every form captures: `Product Framework ID` (link to PCM node), `Form Number`, `Edition Date`, `Bureau or Proprietary`, `Dynamic (variable) or Static`, and attachment metadata.

**Attachment Condition** is the conjunction of:

* `Market Segment` (Commercial / Specialty / Personal / Agribusiness)
* `Product` (e.g., BPP, Builders' Risk)
* `State Applicability`
* `Mandatory / Optional`
* Additional `Attachment Conditions` (references to the **presence of policy attributes**, not the rules surrounding them — e.g., "When \[coverage] is selected")

If Mandatory *and* Market Segment + Product + State conditions are met → the form is always attached. The eligibility/availability logic itself lives in the **Rules** specs, not on the form. [\[Product Sp...s Overview \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B792EC7EC-C704-4A03-B0B4-6FB945154BA3%7D&file=Product%20Specifications%20Overview.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

### 5.3 Foundational Approach

The forms rationalization starts with **the Base Coverage Form** (e.g., CG 00 01 for GL). From the base form you extract Coverages, then Exclusions modify them, then Endorsements broaden/restrict them — every extraction adds or modifies a row in the PCM. [\[Product Sp...s Overview \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B792EC7EC-C704-4A03-B0B4-6FB945154BA3%7D&file=Product%20Specifications%20Overview.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

***

## 6. Rating — First-Principles Model

### 6.1 Structure

* Rating Specifications hold **one document per Product Algorithm**, containing common rating steps + coverage-specific detailed steps. A product may have a collection of algorithms differentiated by peril, risk, or state. [\[Product Tr...g_FY23_May \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B9D3A250B-3C68-4A3A-9FB7-B214A53DA0D5%7D&file=Product%20Training_FY23_May.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[Product Tr...Condensed \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B7AF78D5C-9834-4A34-B8CB-39C02F0EB4A8%7D&file=Product%20Training%20-%20Condensed.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)
* **Rating Step** is the atomic rating operation; steps have a **sequenced order-of-calculation (ROC)** where order matters. [\[Product Tr...Condensed \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B7AF78D5C-9834-4A34-B8CB-39C02F0EB4A8%7D&file=Product%20Training%20-%20Condensed.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)
* Steps consume **factor tables** (e.g., class code tables, coastal factors, experience rating, discounts) and produce intermediate/final premium.

### 6.2 Design Questions the Methodology Requires You to Answer [\[Product Tr...Condensed \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B7AF78D5C-9834-4A34-B8CB-39C02F0EB4A8%7D&file=Product%20Training%20-%20Condensed.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

* How many algorithms does the product have, and along what dimension are they differentiated (peril / risk / state)?
* Are all premium-bearing coverages represented in the algorithm?
* Bureau (ISO) or Proprietary? Which state deviations contribute to differentiation vs. add complexity without value?
* Does step sequence matter? Are naming conventions and data inputs consistent across coverages?
* Where can steps or factor tables be consolidated to reduce filings, dislocation risk, and configuration effort?

### 6.3 Simplification Outcomes (documented benchmarks) [\[Slide Commentary \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAARJU2qSAAA%3d&exvsurl=1&viewmodel=ReadMessageItem), [\[Product Cr...tials.pptx \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEJAACJASweA%2bNcTZGq5OxusfiFAANZlIXwAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

Consolidating rating typically yields \~25% reduction in rating steps and \~40% reduction in factor tables, with 40–60% reduction in implementation time.

***

## 7. Packaging, Bundling & Offering — Definitional Discipline

Per the FY26 Insurance Product Offering, four terms must be disambiguated in every engagement: [\[RE: US Ins...Follow-Up \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAWgkuUwAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

* **Industry Offering** — combination of products *and services* targeted to a specific customer segment.
* **Product** — the protection afforded (monoline or package) presented for sale.
* **Packaging** — two or more LOBs/products written together (e.g., Homeowners + Auto).
* **Coverage Bundle** — a grouping of coverages tailored to an industry/customer (e.g., a Plus Endorsement).
* **Policy Bundle** — multiple products under multiple policies grouped for a seamless customer experience.

Misalignment on these terms across Product, UW, Actuarial, Legal, Claims and IT is the single most common source of rework. **Business alignment on definitions is the first lesson learned.** [\[Product Tr...3_February \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7BE659DC7F-A1D8-4170-ABAC-4EB678733787%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

***

## 8. Cross-Cutting Concerns

### 8.1 State (Geography) Variation

State applicability is a **cross-cutting dimension**, not a node. Any Product, LOB, Coverage, Sub-Coverage, Limit, Deductible, Rating Step, Form, or Rule may have state-specific variants. [\[RE: Reques...Insurance \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAbm24xVAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

### 8.2 Bureau vs. Proprietary

Every component records whether it follows a bureau (ISO/AAIS/NCCI) standard or is proprietary. Deviation from bureau should be a deliberate strategic choice (target: <10% ISO deviations in typical guiding principles), justified by market differentiation, not accreted complexity. [\[Product Credentials \| PowerPoint\]](https://ts.accenture.com/sites/ProductCommunityofPracticeCoP/_layouts/15/Doc.aspx?sourcedoc=%7BCB390599-9F96-477C-986C-F9986489EE9D%7D&file=Product%20Credentials.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[Slide Commentary \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAARJU2qSAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

### 8.3 Effective-Dating & Versioning

Each component (coverage, rule, rate, limit, deductible, form) is **independently versioned** with its own audit trail, variant records, and effective-date intervals. Change-sets are computed for transitive impact and committed atomically across all downstream artifacts. [\[RE: Reques...Insurance \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAbm24xVAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

### 8.4 Reusability Layers

Configurations should be placed at the **highest level** where they can be re-used: [\[Product Fa...- MunichRe \| PowerPoint\]](https://myoffice.accenture.com/personal/kurt_r_schulenburg_accenture_com/_layouts/15/Doc.aspx?sourcedoc=%7B169F195C-E498-4946-9686-D43030B33021%7D&file=Product%20Factory%20Overview%20-%20MunichRe.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

1. **Shared Platform Layer** — reusable across all products
2. **Shared Multi-Product Layer** — reusable across ≥2 products
3. **Product-Specific Layer** — unique to one product

***

## 9. What the Product Definition is NOT

* **Not policy requirements.** Policy requirements (UI fields, workflows, integrations, stat plan, user roles, wireframes) are downstream of technology selection and are authored by Technical Product Owners, Developers, QA, Operations, Compliance. Product Specs are **business-centric foundational business requirements** for the marketable product. [\[Product Tr...3_February \| PowerPoint\]](https://ts.accenture.com/sites/ProductCommunityofPracticeCoP/_layouts/15/Doc.aspx?sourcedoc=%7BAA02AA6F-08BF-4CAE-88E3-3A517B6FB918%7D&file=Product%20Training_FY23_February.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[20260303 P...vF SHARED \| PowerPoint\]](https://ts.accenture.com/sites/Hagerty-ApexDiagnostics/_layouts/15/Doc.aspx?sourcedoc=%7BFFD3A05F-2156-40E5-A202-1451588C8780%7D&file=20260303%20Product%20Framework%20%26%20Specifications_Team%20Kickoff%20vF%20SHARED.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)
* **Not underwriting rules.** Product rules govern the product; UW rules govern risk selection on an individual submission. [\[NOT SCRUBB...Transition \| Word\]](https://ts.accenture.com/sites/Hagerty-ApexDiagnostics/_layouts/15/Doc.aspx?sourcedoc=%7B82B07B4A-C96D-42C7-8674-26150C3E6EFF%7D&file=NOT%20SCRUBBED%20Product%20Framework%20%26%20Specifications_Knowledge%20Transition.docx&action=default&mobileredirect=true&DefaultItemOpen=1)
* **Not filings.** The specifications can cross-check filings but are not the primary filing artifact. [\[Product Sp...s Overview \| PowerPoint\]](https://ts.accenture.com/sites/ProductOffering/_layouts/15/Doc.aspx?sourcedoc=%7B792EC7EC-C704-4A03-B0B4-6FB945154BA3%7D&file=Product%20Specifications%20Overview.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)
* **Not a system export.** The PCM is the **source of truth**; downstream systems (Guidewire APD, Duck Creek, Socotra) render *from* it — never the reverse. [\[RE: Reques...Insurance \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAbm24xVAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

***

## 10. Product Development Lifecycle (surrounding the PCM)

The PCM lives inside a lifecycle with defined phases and gates: [\[202502_CoP...ct_Process \| PowerPoint\]](https://ts.accenture.com/sites/InsuranceARTFramework/_layouts/15/Doc.aspx?sourcedoc=%7B4C71D911-0BB0-41A2-84CF-B7E6679E1F36%7D&file=202502_CoP_Product_Process.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1), [\[202502_Product_ART \| PowerPoint\]](https://ts.accenture.com/sites/InsuranceARTFramework/_layouts/15/Doc.aspx?sourcedoc=%7B54C76B77-40FF-40C1-94A2-DAE8A191877D%7D&file=202502_Product_ART.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

1. **Product Strategy** — market/consumer/competitive research, financial feasibility, phase-gate business case.
2. **Product Design** — features, benchmarks, pricing, coverage/limit/deductible design, forms, rules, bundling, reinsurance structure.
3. **Product Definition** — build the PCM, detail Rules/Rating/Forms Specifications, map to platform.
4. **Product Configuration & Testing** — system configuration, regulatory filings & state approvals, policy docs.
5. **Go-to-Market** — channel strategy, sales collateral, incentives, training.
6. **Product Management & Monitoring** — performance analytics, portfolio profitability, rate & UW adjustments, feedback loop, decommission.

Lifecycle stage transitions should be **gated by role-matrix approval** (Product Manager + Compliance + Actuary) based on artifact class, change magnitude, and impact set. [\[RE: Reques...Insurance \| Outlook\]](https://outlook.office365.com/owa/?ItemID=AAMkADQ2NTEwZjVkLTdmZmMtNDA0OS05YzUyLWZkNTc5NThlMTQ3ZABGAAAAAAB%2f2NCeE2hLTrzDrM7Oo4KjBwCJASweA%2bNcTZGq5OxusfiFAAAAAAEMAACJASweA%2bNcTZGq5OxusfiFAAbm24xVAAA%3d&exvsurl=1&viewmodel=ReadMessageItem)

***

## 11. Product Offering — Four Focus Areas (organizing frame)

At the practice level, all product work aligns to four focus areas: [\[Insurance...0_FY26 vF \| PowerPoint\]](https://ts.accenture.com/sites/ProductCommunityofPracticeCoP/_layouts/15/Doc.aspx?sourcedoc=%7BA8B031B0-E180-4E19-8977-DC437024FE6E%7D&file=Insurance%20Product%20Offering_Stage%200_FY26%20vF.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)

1. **Product Strategy** — objectives, competitive positioning, coverages/rating ROC/forms/rules alignment to market.
2. **Product Architecture** — the PCM, hierarchy, relationships, specifications (this document's core focus).
3. **Product Enablement** — technology, operating model, filings, compliance.
4. **Product Management** — KPIs, portfolio monitoring, continuous improvement.

***

## 12. Machine-Readable Summary (for AI grounding)

```yaml
product:
  definition: "A promise of protection presented for sale and distribution; monoline (1 LOB) or package (2+ LOBs)."
  must_have: [ ">=1 LOB" ]
  children: [LOB]
  attachments: [BaseCoverageForm, Notice, ProductRule, RatingAlgorithm]

lob:
  definition: "A group of related Coverages within a Product."
  must_have: [ ">=1 Coverage" ]
  children: [Coverage]

coverage:
  definition: "Scope of protection against a specific loss or liability."
  must_have: [Limit, Deductible, Premium, ClaimsReporting]
  attributes: [ClaimsBasis(Occurrence|ClaimsMade), Requirement(Mandatory|Optional),
               Scope(FirstParty|ThirdParty), Effect(Grants|Restricts|Broadens|Amends),
               PremiumGenerating, BureauOrProprietary, StateApplicability]
  children: [SubCoverage, Limit, Deductible, RatingStep, Form]

sub_coverage:
  definition: "Scope of protection with parent-child relationship to a Coverage; supplementary/optional."
  may_share_with_parent: [Limit, Deductible, Premium]
  attributes: (same as coverage)

specifications:
  rules:        {answers: "How is the product GOVERNED?"}
  forms:        {answers: "How is the product PRESENTED?"}
  rating:       {answers: "How is the product PRICED?"}

rule:
  attaches_to: [Product, LOB, Coverage, SubCoverage, Limit, Deductible, RatingStep, Form]
  categories:  [ProductEligibility, ProductAvailability, Packaging, Bundling,
                BaseCoverage, MandatoryInclusionExclusion, OptionalEligibility,
                OptionalSelection, LimitRanges, DeductibleRanges, MinAddReturnPremium]
  fields:      [RuleID, Category, SubCategory, Condition, Outcome, Dependency,
                Source, Proprietary, StateApplicability]
  distinct_from: UnderwritingRule

form:
  categories:  [Declaration, Notice, BaseCoverage, Endorsement, Exclusion,
                OtherPolicyDoc, TrailingDoc, MarketingMaterial]
  fields:      [ProductFrameworkID, FormNumber, EditionDate, BureauOrProprietary,
                DynamicOrStatic, MarketSegment, Product, StateApplicability,
                MandatoryOptional, AttachmentConditions]
  link_rules:
    BaseCoverageForm: Product.ID
    CoverageOrExclusionForm: Coverage.ID
    Notice: LOB.ID
    EndorsementModifyingExisting: "highest applicable Product Framework ID"

rating:
  unit: RatingStep
  container: RatingAlgorithm  # one per Product; may be many differentiated by peril/risk/state
  ordered: true               # ROC (Rate Order Calculation) sequence is significant
  inputs: [FactorTables, ClassCodes, CoverageVariables]
  fields: [StepID, Description, Formula, Sequence, StateApplicability, BureauOrProprietary]

cross_cutting:
  state_variation: "any node may have state-specific variants"
  versioning: "component-level with effective dates and audit trail"
  reusability: [PlatformShared, MultiProductShared, ProductSpecific]

not_this:
  - PolicyRequirements (post-technology, platform-specific)
  - UnderwritingRules (risk-specific, per-submission)
  - Filings (specs are cross-check, not primary artifact)
  - SystemExport (PCM is source of truth; systems render from it)
```

***