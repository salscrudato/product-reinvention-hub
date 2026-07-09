// Universal dimensions — modeled once, reused by every schema.
//
// Two things are true of every governed insurance entity in this repo: it carries a
// GovernanceBlock (status + reviewStatus) and a StateScope (allStates + states). Rather
// than each tab re-declaring "status" and "state", these factories mint the facets and
// every schema spreads them in. Change a status label or add a jurisdiction here and it
// updates on Rules, Coverages and Forms at once.

import type { Status, ReviewStatus, StateScope } from '@pf/shared'
import type { EnumFacet, FacetOption } from './facetTypes'

// ─── Status (ACTIVE / INACTIVE / FUTURE) ────────────────────────────────────────
// `token` is the label form so URLs read `status=Active` and command-bar tokens read
// `status:Active` (never the ALLCAPS enum). The engine maps back to the stored value.
export function statusFacet<T extends { status: Status }>(): EnumFacet<T> {
  return {
    kind: 'enum', id: 'status', label: 'Status', param: 'status', token: 'status',
    options: [
      { value: 'ACTIVE',   label: 'Active',   token: 'Active' },
      { value: 'INACTIVE', label: 'Inactive', token: 'Inactive' },
      { value: 'FUTURE',   label: 'Future',   token: 'Future' },
    ],
    accessor: (e) => e.status,
  }
}

// ─── Review status (the "and review states" half of the universal status dim) ───
// Drives saved-view examples like "My QA queue" (BUSINESS_REVIEW / IN_PROGRESS) and
// "Unreviewed optional coverages" (NOT_STARTED). Aliases accept the natural phrasings.
export function reviewFacet<T extends { reviewStatus: ReviewStatus }>(): EnumFacet<T> {
  return {
    kind: 'enum', id: 'review', label: 'Review', param: 'review', token: 'review',
    options: [
      { value: 'NOT_STARTED',     label: 'Not started',     token: 'Not started',     aliases: ['unreviewed', 'not-started', 'todo'] },
      { value: 'IN_PROGRESS',     label: 'In progress',     token: 'In progress',     aliases: ['in-progress', 'wip'] },
      { value: 'BUSINESS_REVIEW', label: 'Business review', token: 'Business review', aliases: ['qa', 'business-review', 'in review'] },
      { value: 'APPROVED',        label: 'Approved',        token: 'Approved' },
      { value: 'REJECTED',        label: 'Rejected',        token: 'Rejected' },
    ],
    accessor: (e) => e.reviewStatus,
  }
}

// ─── State applicability (50 states + DC + territories) ─────────────────────────
// A controlled vocabulary as data: adding a jurisdiction is a one-line edit here. The
// three territories (PR/GU/VI) are declared per the spec even though the current seed
// scopes nothing to them — they simply render zero-count (disabled, not hidden), which
// is the correct graceful behavior. The app's rendered map covers the 50 states + DC;
// entity StateScopes only ever use that subset today.
export const US_JURISDICTIONS: readonly FacetOption[] = [
  { value: 'AL', label: 'Alabama' },        { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },        { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },      { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },    { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'District of Columbia' },
  { value: 'FL', label: 'Florida' },        { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },         { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },       { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },           { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },       { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },          { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },      { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },       { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },       { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },     { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' }, { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },           { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },         { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },   { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },   { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },          { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },        { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },     { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },      { value: 'WY', label: 'Wyoming' },
  // Territories (spec-mandated; zero-count on the current seed).
  { value: 'PR', label: 'Puerto Rico' },    { value: 'GU', label: 'Guam' },
  { value: 'VI', label: 'U.S. Virgin Islands' },
]

const ALL_STATE_CODES: readonly string[] = US_JURISDICTIONS.map((o) => o.value)

/** State facet — multi-valued. An `allStates` entity applies to every jurisdiction, so
 *  a `state:CA` filter must match it; otherwise it applies to just its `states` list. */
export function stateFacet<T extends StateScope>(): EnumFacet<T> {
  return {
    kind: 'enum', id: 'state', label: 'State', param: 'state', token: 'state',
    multiValued: true,
    options: US_JURISDICTIONS as FacetOption[],
    accessor: (e) => (e.allStates ? ALL_STATE_CODES : e.states),
  }
}
