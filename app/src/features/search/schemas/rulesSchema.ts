// Rules facet schema — the reference implementation the engine is proven on first.
//
// The taxonomy is a fixed, hierarchical controlled vocabulary: RuleCategory (the real
// PRODUCT | RATING | FORMS enum) is the parent axis; a canonical sub-category is the
// child axis. Taxonomy lives as data here; adding a value edits this constant, never a
// component.
//
// IMPORTANT — canonical taxonomy vs. seed drift. The spec's canonical sub-categories
// (below) are the vocabulary the tool standardizes on. The seeded data uses shorter
// ISO-ish labels ("Eligibility", "Coverage Limits", "Premium Floor", "Mandatory
// Coverage", "Optional Coverage") and has casing/whitespace drift. The alias map folds
// those source forms onto the canonical values ON READ (childAccessor), so:
//   - counts line up with the on-screen section badge,
//   - "opt cov" resolves to "Optional Coverage Eligibility" with no network call, and
//   - any sub-category in the data with no mapping passes through and is SURFACED by the
//     engine as an unknown value (disabled chip), never silently hidden.
// A rule always matches at least its real category, so normalization can never drop it.

import type { Rule, RuleCategory } from '@pf/shared'
import type { WithId } from '../../../context/ProductContext'
import type { FacetSchema, HierarchyFacet, HierarchyParent } from '../facetTypes'
import { statusFacet, reviewFacet, stateFacet } from '../universalDimensions'

// ─── Canonical taxonomy (parent → ordered children) ────────────────────────────
const RULES_TAXONOMY: { parent: RuleCategory; label: string; children: string[] }[] = [
  {
    parent: 'PRODUCT', label: 'Product',
    children: [
      'Product Eligibility',
      'Product Availability',
      'Packaging / Line of Business',
      'Bundling',
      'Base Coverage (Default)',
      'Mandatory Inclusion/Exclusion of Coverage',
      'Optional Coverage Eligibility',
      'Limit Ranges and Defaults',
      'Deductible Ranges and Defaults',
    ],
  },
  { parent: 'RATING', label: 'Rating', children: ['Minimum / Additional / Return Premium'] },
  { parent: 'FORMS',  label: 'Forms',  children: ['Forms Attachment Conditions'] },
]

// ─── Alias / normalization map ──────────────────────────────────────────────────
// canonical sub-category -> the surface forms that fold onto it. Serves double duty:
//  1. ingest normalization — collapses seed labels + casing/whitespace drift, and
//  2. command-bar typeahead — the shorthands users actually type ("opt cov").
// Judgment calls to confirm: "Coverage Constraints" (a limit/deductible dependency in
// seed, e.g. "Cov F $5,000 requires Cov E >= $300,000") is folded into "Limit Ranges
// and Defaults"; "Mandatory Coverage" into "Mandatory Inclusion/Exclusion of Coverage".
const SUBCATEGORY_ALIASES: Record<string, readonly string[]> = {
  'Product Eligibility':                       ['eligibility'],
  'Product Availability':                      ['availability'],
  'Packaging / Line of Business':              ['packaging/line of business', 'packaging', 'line of business', 'lob'],
  'Bundling':                                  ['bundle'],
  'Base Coverage (Default)':                   ['base coverage', 'default coverage'],
  'Mandatory Inclusion/Exclusion of Coverage': ['mandatory coverage', 'mandatory inclusion', 'mandatory exclusion', 'mandatory'],
  'Optional Coverage Eligibility':             ['optional coverage', 'optional coverage selection', 'opt cov', 'optional cov', 'optional'],
  'Limit Ranges and Defaults':                 ['coverage limits', 'limit ranges', 'coverage constraints', 'limits'],
  'Deductible Ranges and Defaults':            ['deductibles', 'deductible ranges', 'deductible'],
  'Minimum / Additional / Return Premium':     ['premium floor', 'minimum premium', 'minimum/additional/return premium', 'additional premium', 'return premium', 'premium'],
  'Forms Attachment Conditions':               ['forms attachment', 'form attachment', 'attachment conditions'],
}

// Collapse casing + surrounding/interior whitespace drift (e.g. a trailing space on
// "Packaging / Line of Business ") to a stable comparison key.
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

// Precomputed { normalized surface form -> canonical value } for O(1) lookup.
const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const { children } of RULES_TAXONOMY) for (const c of children) m[norm(c)] = c
  for (const [canonical, aliases] of Object.entries(SUBCATEGORY_ALIASES)) {
    m[norm(canonical)] = canonical
    for (const a of aliases) m[norm(a)] = canonical
  }
  return m
})()

/** Fold a raw seed sub-category onto its canonical facet value. Unknown values pass
 *  through trimmed so the engine can surface them rather than crash or hide the rule. */
export function normalizeSubCategory(raw: string): string {
  return ALIAS_TO_CANONICAL[norm(raw)] ?? raw.trim()
}

// ─── The hierarchical category facet ──────────────────────────────────────────────
const parents: HierarchyParent[] = RULES_TAXONOMY.map(({ parent, label, children }) => ({
  value: parent,
  label,
  token: label,
  children: children.map((c) => ({ value: c, label: c, token: c, aliases: [...(SUBCATEGORY_ALIASES[c] ?? [])] })),
}))

const categoryFacet: HierarchyFacet<WithId<Rule>> = {
  kind: 'hierarchy',
  id: 'category',
  parent: { label: 'Category', param: 'cat', token: 'category' },
  child:  { label: 'Sub-category', param: 'sub', token: 'sub' },
  parents,
  parentAccessor: (r) => r.category,
  childAccessor:  (r) => normalizeSubCategory(r.subCategory),
}

// ─── Schema ───────────────────────────────────────────────────────────────────────
export const rulesSchema: FacetSchema<WithId<Rule>> = {
  entityType: 'rule',
  facets: [
    categoryFacet,
    statusFacet<WithId<Rule>>(),
    reviewFacet<WithId<Rule>>(),
    stateFacet<WithId<Rule>>(),
  ],
  // Free text spans the refId, the taxonomy, the IF/THEN prose, and every join key
  // (coverage refIds, form numbers, LD table) so a query like "HO 04 90" or "PH.COV.003"
  // finds the rules that reference it.
  getText: (r) =>
    [
      r.refId ?? '', r.category, r.subCategory, r.condition, r.outcome,
      r.coverageRefIds.join(' '), r.formNumbers.join(' '), r.ldTableRef ?? '',
    ].join(' '),
  identify: (r) => ({
    id: r.id,
    refId: r.refId,            // load-bearing refId chip
    title: r.refId ?? 'Draft rule',
    subtitle: r.condition,
  }),
}
