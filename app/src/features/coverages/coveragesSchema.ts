// Coverages facet schema. Unlike Rules, the "coverage group" axis is NOT a fixed
// controlled vocabulary — it is the product's own top-level coverages and their
// sub-coverages, which vary per product. So this is a FACTORY built from the current
// coverages; the tab memoizes it on the coverage list. Everything else (included vs
// optional, plus the universal status/review/state dimensions) is fixed.

import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'
import type { FacetSchema, HierarchyFacet, HierarchyParent } from '../search/facetTypes'
import { reviewFacet, stateFacet, statusFacet } from '../search/universalDimensions'

const byOrder = (a: WithId<Coverage>, b: WithId<Coverage>) => (a.order ?? 0) - (b.order ?? 0)
const keyOf = (c: WithId<Coverage>) => c.refId ?? c.id   // stable identity; refId when saved

/** Build the coverage-group hierarchy from the live coverage list: each top-level
 *  coverage is a parent, its sub-coverages (parentId === parent.refId) are the children.
 *  A sub-coverage whose parentId matches no top-level coverage surfaces as a broken-link
 *  unknown (see the engine) rather than vanishing. */
function groupFacet(coverages: WithId<Coverage>[]): HierarchyFacet<WithId<Coverage>> {
  const tops = coverages.filter((c) => !c.parentId).sort(byOrder)
  const parents: HierarchyParent[] = tops.map((t) => ({
    value: keyOf(t),
    label: t.name,
    children: coverages
      .filter((c) => c.parentId && c.parentId === t.refId)
      .sort(byOrder)
      .map((c) => ({ value: keyOf(c), label: c.name })),
  }))
  return {
    kind: 'hierarchy',
    id: 'group',
    parent: { label: 'Coverage group', param: 'grp', token: 'group' },
    child:  { label: 'Sub-coverage', param: 'sub', token: 'sub' },
    parents,
    // A coverage's group is its parent (for a sub-coverage) or itself (for a top-level).
    parentAccessor: (c) => c.parentId ?? keyOf(c),
    // Only sub-coverages carry a child value (their own key); top-level coverages don't.
    childAccessor:  (c) => (c.parentId ? keyOf(c) : null),
  }
}

export function makeCoveragesSchema(coverages: WithId<Coverage>[]): FacetSchema<WithId<Coverage>> {
  return {
    entityType: 'coverage',
    facets: [
      groupFacet(coverages),
      requirementFacet(),
      statusFacet<WithId<Coverage>>(),
      reviewFacet<WithId<Coverage>>(),
      stateFacet<WithId<Coverage>>(),
    ],
    getText: (c) => [c.refId ?? '', c.name, c.claimsBasis, c.formNumbers.join(' ')].join(' '),
    identify: (c) => ({ id: c.id, refId: c.refId, title: c.name, subtitle: c.refId ?? undefined }),
  }
}

// ─── Page-scoped filter schema (Coverages tab) ──────────────────────────────────
// The Coverages *page* deliberately does NOT filter by coverage group ("Part A/B/C…").
// Not every product has groups, so a group facet is product-shape-specific and would be
// empty/irrelevant for flat products. This factory keeps only product-shape-agnostic
// dimensions (requirement, rating, source, status, review, state) that exist for ANY
// coverage in ANY product, and enriches the free-text haystack so the single page search
// matches on name AND key metadata (code, status, requirement, rating, source, LOB,
// parent). The cross-entity global bar keeps `makeCoveragesSchema` (with the group axis)
// unchanged — this is purely the page's own filter/search surface.

const requirementFacet = (): FacetSchema<WithId<Coverage>>['facets'][number] => ({
  kind: 'enum', id: 'requirement', label: 'Requirement', param: 'req', token: 'requirement',
  options: [
    { value: 'MANDATORY', label: 'Included', token: 'Included', aliases: ['included', 'mandatory', 'base', 'core'] },
    { value: 'OPTIONAL',  label: 'Optional', token: 'Optional', aliases: ['optional', 'add-on', 'addon', 'endorsement'] },
  ],
  accessor: (c) => c.requirement,
})

const STATUS_WORD: Record<string, string> = { ACTIVE: 'active', INACTIVE: 'inactive', FUTURE: 'future' }

export function makeCoveragesFilterSchema(
  coverages: WithId<Coverage>[],
  lobName?: string,
): FacetSchema<WithId<Coverage>> {
  const nameByRef = new Map(coverages.map((c) => [keyOf(c), c.name]))
  const parentName = (c: WithId<Coverage>) => (c.parentId ? nameByRef.get(c.parentId) ?? '' : '')
  return {
    entityType: 'coverage',
    facets: [
      requirementFacet(),
      {
        kind: 'enum', id: 'rated', label: 'Rating', param: 'rated', token: 'rated',
        options: [
          { value: 'RATED',   label: 'Rated',     token: 'Rated',   aliases: ['rated', 'premium', 'premium-generating', 'priced'] },
          { value: 'UNRATED', label: 'Not rated', token: 'Unrated', aliases: ['unrated', 'non-rated', 'no premium', 'unpriced'] },
        ],
        accessor: (c) => (c.premiumGenerating ? 'RATED' : 'UNRATED'),
      },
      {
        kind: 'enum', id: 'source', label: 'Source', param: 'src', token: 'source',
        options: [
          { value: 'BUREAU',      label: 'Bureau / ISO', token: 'Bureau',      aliases: ['bureau', 'iso', 'standard'] },
          { value: 'PROPRIETARY', label: 'Proprietary',  token: 'Proprietary', aliases: ['proprietary', 'custom', 'in-house'] },
        ],
        accessor: (c) => c.source,
      },
      statusFacet<WithId<Coverage>>(),
      reviewFacet<WithId<Coverage>>(),
      stateFacet<WithId<Coverage>>(),
    ],
    // Free text = exact conjunctive substring over this haystack (see filterEngine). The
    // metadata words are what make the single search feel "natural-language": e.g.
    // "optional rated liability" or "proprietary flood" resolve without any structured token.
    getText: (c) => [
      c.name,
      c.refId ?? '',
      c.claimsBasis,
      c.formNumbers.join(' '),
      c.requirement === 'MANDATORY' ? 'included mandatory' : 'optional endorsement add-on',
      c.premiumGenerating ? 'rated premium' : 'unrated non-rated',
      c.source === 'PROPRIETARY' ? 'proprietary' : 'bureau iso',
      STATUS_WORD[c.status] ?? '',
      c.parentId ? `sub-coverage ${parentName(c)}` : '',
      lobName ?? '',
    ].join(' '),
    identify: (c) => ({ id: c.id, refId: c.refId, title: c.name, subtitle: c.refId ?? undefined }),
  }
}
