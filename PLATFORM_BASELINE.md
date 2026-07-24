# Product Reinvention Hub — Platform Baseline

**A plain-language state-of-the-system brief for stakeholders.**
Date: 2026-07-24 · Scope: what the platform is, what works, what doesn't, and where we stand.

> Why this exists: the system was built fast (largely AI-assisted "vibe coding"), which
> produced real capability but also churn, drift, and uneven hardening. This is an honest
> baseline so business and technical stakeholders share the same picture before the next
> phase of work.

---

## TL;DR

- **What it is:** a multi-tenant platform that turns insurance product documents (Excel
  workbooks, rate/filing PDFs) into a governed, canonical **Product model** — coverages,
  forms, rules, and rating — and lets you price, search, and ask questions against it.
- **What's genuinely solid:** the core engineering discipline — one controlled path for
  every data write, a tamper-evident audit trail, deterministic pricing locked by tests,
  and an import pipeline that refuses to invent facts (every AI output must cite its source
  or it's dropped, and a human approves before anything is saved).
- **What's weak:** operational hardening (security headers, secret hygiene, single-instance
  limits), some economics (expensive AI import runs), and — most visibly — **documentation
  and code drift** from the rapid build, which misleads both people and coding agents.
- **Where we are today:** the hosted app runs on Azure with one live tenant (**hagerty**).
  We have just established this baseline, fixed a real data bug, removed a deceptive
  legacy artifact, consolidated the authoritative docs, and reset the live database to a
  clean slate for a fresh, controlled data upload.

---

## 1. What the platform is (and is not)

**It is** a *product factory* — the system of record for **what an insurance product is**:
its coverages, the forms that present it, the rules that govern it, and the algorithm that
prices it. It supports importing carrier/bureau documents into that shape, versioning and
auditing changes, simulating rating, and running grounded AI copilots over the catalogue.

**It is not** a policy-administration or claims system. There is no policy, quote, billing,
or claims-payment record. That scope is intentional.

Hosted at `app-prodhub-dev.azurewebsites.net` (Azure App Service) with Azure Cosmos DB for
data and Azure AI Foundry for the AI models.

---

## 2. How the data actually works

**Source of truth.** The live database (Cosmos DB) is the single source of truth at
runtime. **The uploaded Excel workbook is the source of the *data*** — products exist
because someone imported them. (The three reference products in the code repository —
Personal Home, Personal Auto, General Liability — are **test fixtures**, not live data.
This mismatch is exactly why the app showed products like "Enthusiast+" and "Core" that
don't appear in the codebase's seed.)

**How an upload becomes product data** — a hybrid pipeline, human-gated:

| Stage | Who does it | Notes |
|---|---|---|
| Read the file | **Deterministic code** | Excel cells read exactly; file type detected by content, not extension |
| Understand messy content | **AI models** | Only for PDFs / complex or unstructured docs; a clean spreadsheet needs no AI |
| Extract values | **AI + deterministic** | Models cross-check each other; a fast code path is used when structure is clear |
| Validate | **Deterministic + AI** | **Every value must cite its source cell or it is dropped — no invention** |
| Assemble & review | **Deterministic → human** | Nothing is written until a person approves it in the review screen |
| Save | **Deterministic** | One atomic write per item: the record + its audit + version + search index |

Two things worth telling stakeholders: **(1)** a plain Excel upload is essentially a
deterministic importer — the AI only wakes up for messy carrier PDFs; **(2)** nothing the
AI produces reaches the database without a citation and a human sign-off.

---

## 3. What's working well

- **Controlled data layer.** Every change goes through one path that writes the record,
  a hash-chained **audit event**, a **version snapshot**, and a **search index** together,
  atomically. Deleting or editing is traceable and reversible via history.
- **Tenant isolation.** Each customer's data is partitioned and server-stamped; one tenant
  cannot read another's.
- **Deterministic pricing.** The rating engine is pure, repeatable code locked by four
  "canary" test cases (Home $1,528, Auto $1,002, General Liability $2,635, and a filing
  reconciliation $1,281). A wrong number fails the build and blocks deployment.
- **Grounded, cited AI.** The home-page copilot answers only from the live catalogue and
  cites the product/form IDs it used; unverifiable claims are stripped.
- **Import integrity.** Certified against a frozen "holdout" set of documents; refuses to
  fabricate values and preserves form numbers and IDs byte-for-byte.

---

## 4. Known issues & risks (the honest list)

| Priority | Issue | Status |
|---|---|---|
| **High** | No HTTP security headers (CSP/HSTS/frame protection) on a portal that renders AI-generated HTML | Open |
| **High** | Rate limits, AI spend caps, and sessions are held **in memory** — correct only on a single server instance; a restart resets them | Open (documented single-instance constraint) |
| **High** | Hardcoded default admin logins (`admin`/`admin`, `sal`/`scrudato`) are always enabled | Open — acceptable for a demo, **must be disabled/changed before production** |
| **Medium** | AI import runs are expensive (~$110 for a large workbook) with no caching or resume | Open (economics) |
| **Medium** | Test/"golden" data is template-shaped — proves stability, not real-world accuracy on unseen carrier documents | Open |
| **Medium** | Documentation & code drift (stale/contradictory docs, dropped-then-re-added features) | **Improved this session; ongoing** |
| **Low/Med** | Wide tables (>128 columns) and CSV-only uploads have documented extraction gaps | Open, with user-visible warnings |
| Resolved | Deleted products lingered in the AI copilot's memory (stale search data) | **Fixed this session** |
| Resolved | A legacy script silently re-injected an un-sanitized banner and cited a non-existent "CI gate" | **Removed this session** |

Note on drift: the risk documentation lists some issues (e.g. a data-ID casing bug, wide-column
truncation, missing zip-bomb protection) that our verification found are **already fixed in the
current code** — a concrete example of why the docs needed reconciling.

---

## 5. Development health — the "vibe coding" reality

Being candid, because it matters for planning:

- **~490 commits, ~96% by a single author**, concentrated in a **6-day burst** (Jul 11–16)
  followed by a **rollback** and a sharp slowdown — the signature of intense, AI-assisted
  solo building.
- **Feature churn:** features were added, removed, and re-added in different forms (filters,
  home-page cards, seeding behavior), which is why parts of the UI and docs disagree.
- **Platform migration residue:** the app moved from Firebase to Azure/Cosmos, leaving stale
  references that have been progressively scrubbed.
- **The good news:** there is a recently **verified engineering dossier** (`docs/reveng/`)
  that reconciles the codebase against reality claim-by-claim. It — plus `DATA_MODEL.md` —
  is now the designated source of truth, and the misleading older docs are flagged as
  superseded.

**Implication:** the *foundation* is sound and well-architected; the *surface* (docs,
config hygiene, operational hardening) needs a deliberate cleanup pass rather than new
features. This baseline is step one of that.

---

## 6. What we changed to establish this baseline

- **Fixed a real bug:** deleting a product now also clears its AI-search copy, so the
  copilot can no longer cite deleted products.
- **Removed an outdated, deceptive artifact:** the `migrate-to-cosmos` seeding script and
  its bundle (which carried a self-restoring banner justified by a fabricated CI gate).
- **Reconciled documentation:** corrected the primary agent/context files, rewrote the
  broken "seed" procedure to the real clean-slate flow, and marked superseded docs.
- **Built safe reset tooling** and **reset the live database** to a clean slate for a fresh
  upload — **preserving the `hagerty` tenant and admin login**, removing only product data
  and unrelated cruft.

---

## 7. Recommended next steps

1. **Fresh, controlled data upload** into the clean `hagerty` tenant (in progress).
2. **Production-hardening wave** (highest leverage): security headers, disable default
   admin logins, and secret hygiene — before any real user access.
3. **Finish the documentation reconciliation** so every contributor (and their coding
   agent) reads truth.
4. **Prove import accuracy** against a real, unseen carrier document (not just templates).
5. **Address scale limits** (move in-memory state to shared storage) only if multi-instance
   hosting is needed.

---

*Source of truth for depth: `docs/reveng/` (start at `EXEC_OVERVIEW.md`) and `DATA_MODEL.md`.
When code and docs disagree, the code wins — update the docs.*
