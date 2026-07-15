# DEFAULTS_SPEC — the two default flips + the shared export switch (P1 → P2/P3)

**Status:** SPEC_READY (P1, 2026-07-15). Code lands in the foundational wave (ledger EX-01 /
EX-02) — docs-only hold means P1 specs it here and the implementing wave commits it
test-first.

## 1. Collapse-all-products-by-default (EX-01)

Current: product trees render EXPANDED — `app/src/components/product/ProductHierarchy.tsx:90`
and `:175` both `useState(true)`. Change: initial state `false` (collapsed) for every product
node; expand state persists per-session only (no per-user persistence in v1 — deliberate,
matches the R0 "Hierarchy default" directive lineage). "Expand all / Collapse all" affordance
in the Products toolbar toggles the set. Test-first: initial render shows collapsed rows
(aria-expanded="false"), toggle expands one without expanding siblings, expand-all/collapse-all
round-trips. Axe: the toggle buttons keep their existing aria contract
(ProductHierarchy.tsx:106-108).

## 2. Hide Data Dictionary until a DC export succeeds (EX-02)

Current: `page.dictionary` ships enabled — `shared/src/platform/featureFlags.ts:57`
`{ key: 'page.dictionary', …, defaultEnabled: true, tenantOverridable: true }`; Sidebar hides
the nav item when the flag is off (`Sidebar.tsx:32`), and `Dictionary.tsx` is the routed
surface.

Change (two sides, ONE switch):

- **Default flip:** `featureFlags.ts:57` → `defaultEnabled: false`. The Dictionary disappears
  for every tenant that has no explicit override — including seeded demo tenants (accepted;
  the unlock is the point).
- **The unlock:** a SUCCESSFUL Duck Creek XML export — defined as validation ladder L0–L3
  green + bundle delivered to the user (XML_EXPORT_SPEC §6) — sets the tenant override
  `page.dictionary = true` through the EXISTING per-tenant toggle path (the F5 platform-config
  write, audited like any config change). Server-side, in the export handler — never a client
  write, so a VIEWER cannot flip it and a failed export cannot.

**The shared switch is the flag key `page.dictionary` — verbatim.** P2 wires nothing new
(Sidebar already obeys the flag); P3's export-success hook performs the tenant-override write.
Neither side invents a second flag, localStorage key, or env var.

Test-first: flag default false (registry test), export-success hook writes the override
(server test with the export handler stubbed to L3-green), failed export (lint FAIL) does NOT
write, Sidebar hides/shows on the flag (existing pattern test extended).

## 3. Out of scope here

The Dictionary surface itself is unchanged; the export-readiness pill (HOME_BRIEF_SPEC §3)
reads the same export outcome but is BRIEF-workstream scope.
