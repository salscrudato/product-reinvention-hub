// Generic, tab-agnostic filter primitives.
//
// One declarative schema shape (FacetSchema<T>) drives the whole engine. Every tab
// (Rules, Coverages, Forms) supplies its own schema; the engine, the FacetPanel, the
// CommandBar and ActiveFilters are entity-agnostic and render purely from the schema
// plus the engine's output. Adding a facet value is a data edit to a schema constant,
// never a component change.
//
// Filtering semantics (fixed, deterministic, client-side):
//   - OR *within* a dimension  (status:Active OR status:Future)
//   - AND *across* dimensions  (status AND state AND category)
// This is the only correct reading in a compliance context, where silently hiding an
// entity via a fuzzy interpretation is a serious failure.

import type { SearchEntityType } from '@pf/shared'

// ─── Facet kinds ──────────────────────────────────────────────────────────────
// Three shapes cover every dimension we need:
//   enum       — flat multi-select (status, state, form category, requirement)
//   hierarchy  — two-level parent → child; a parent reveals its children (Rules)
//   dateRange  — a comparable numeric range (Form edition date)
export type FacetKind = 'enum' | 'hierarchy' | 'dateRange'

/** One selectable value in an enum facet or a hierarchy level.
 *  `value`  — canonical form the accessor returns and the engine compares against.
 *  `label`  — human display in the panel + pills.
 *  `token`  — URL-param + command-bar token form (defaults to `value`); the spec's
 *             examples use the label-ish form (`status=Active`, `cat=Product`), so a
 *             facet declares this explicitly rather than leaking the ALLCAPS enum.
 *  `aliases`— extra surface forms the normalizer / typeahead accept and fold onto
 *             this value (e.g. "Optional Coverage Selection" and "opt cov" →
 *             "Optional Coverage Eligibility"). Load-bearing for the alias map. */
export interface FacetOption {
  value:    string
  label:    string
  token?:   string
  aliases?: string[]
}

/** Naming for one axis of a facet: how it reads in the panel, the URL, and tokens. */
export interface FacetAxis {
  label: string   // panel heading / pill prefix
  param: string   // URL query key (short, e.g. "cat", "sub", "status")
  token: string   // command-bar token keyword (e.g. "category", "sub", "status")
}

// ─── Flat multi-select facet ────────────────────────────────────────────────────
export interface EnumFacet<T> extends FacetAxis {
  kind:    'enum'
  id:      string          // unique dimension id; also the FilterState map key
  options: FacetOption[]
  /** true when the accessor yields an array (formNumbers, state codes): an entity is
   *  a member of a value if that value is present in the returned set. */
  multiValued?: boolean
  /** The value(s) this entity carries for the facet. Return null/undefined/[] when N/A. */
  accessor: (entity: T) => string | readonly string[] | null | undefined
}

/** A parent node and the children it reveals (hierarchical taxonomy). */
export interface HierarchyParent {
  value:    string
  label:    string
  token?:   string
  aliases?: string[]
  children: FacetOption[]
}

// ─── Hierarchical (two-level) facet ──────────────────────────────────────────────
// Selection model (see useEntityFilters reconciliation):
//   - Selecting a parent selects that whole branch (all its entities).
//   - Selecting a child pins the parent to just that child (and its siblings, OR-ed).
//   - A parent with selected children matches ONLY those children; a parent with none
//     matches all of its entities. Result is the OR across selected branches.
//   - Invariant: every selected child's parent is present in `parents`. Deselecting a
//     parent orphans its children, which reconciliation drops (and reports).
export interface HierarchyFacet<T> {
  kind:    'hierarchy'
  id:      string
  parent:  FacetAxis
  child:   FacetAxis
  parents: HierarchyParent[]
  parentAccessor: (entity: T) => string | null | undefined
  childAccessor:  (entity: T) => string | null | undefined
}

// ─── Range / date facet ──────────────────────────────────────────────────────────
export interface DateRangeFacet<T> extends FacetAxis {
  kind: 'dateRange'
  id:   string
  /** Comparable timestamp (ms epoch) for the entity, or null when it has no date. */
  accessor: (entity: T) => number | null | undefined
  /** Parse a token/URL string ("04 13", "2013-04") to ms; null when unparseable. */
  parse:  (raw: string) => number | null
  /** Render a ms timestamp back to the display/token form. */
  format: (ms: number) => string
}

export type Facet<T> = EnumFacet<T> | HierarchyFacet<T> | DateRangeFacet<T>

// ─── Entity identity (results, pills, cross-entity dedupe) ──────────────────────
// refId (Rules/Coverages) and form number (Forms) are load-bearing display chips;
// every schema must surface them here so results and the global command bar can show
// them without the engine knowing the concrete entity shape.
export interface EntityIdentity {
  id:        string          // Firestore doc id (WithId<T>.id)
  refId:     string | null   // refId chip, or the form number for Forms
  title:     string
  subtitle?: string
}

// ─── The schema a tab supplies to the engine ────────────────────────────────────
export interface FacetSchema<T> {
  entityType: SearchEntityType
  facets:     Facet<T>[]
  /** Free-text field accessor: the concatenated searchable text for one entity.
   *  Bundled on the schema (rather than passed separately) so a tab's searchable
   *  fields live with its schema and the global command bar can reuse it verbatim. */
  getText:  (entity: T) => string
  identify: (entity: T) => EntityIdentity
}

// ─── Serializable filter state (one object per tab; URL- and Firestore-safe) ────
export interface HierarchyValue {
  parents:  string[]
  children: string[]
}

export interface DateRangeValue {
  from: number | null   // ms epoch, inclusive
  to:   number | null   // ms epoch, inclusive
}

/** The entire filter state for a tab. Plain, JSON-serializable — the single source
 *  the engine reduces, the URL rehydrates from, and saved views persist. */
export interface FilterState {
  text:        string
  enums:       Record<string, string[]>          // facetId -> selected values
  hierarchies: Record<string, HierarchyValue>     // facetId -> parents + children
  dateRanges:  Record<string, DateRangeValue>     // facetId -> from/to
}

export const emptyFilterState = (): FilterState => ({
  text: '', enums: {}, hierarchies: {}, dateRanges: {},
})

// ─── Faceted counts (engine output) ─────────────────────────────────────────────
// A count is computed with faceted-search semantics: for value v in dimension D, the
// count is the number of entities that match every OTHER active dimension AND carry v
// in D — i.e. "how many results if I toggle v on, given what's already selected".
export interface HierarchyCounts {
  parents:  Record<string, number>
  children: Record<string, number>
}
export interface FacetCounts {
  enums:       Record<string, Record<string, number>>   // facetId -> value  -> count
  hierarchies: Record<string, HierarchyCounts>           // facetId -> counts
}

// ─── Edge reporting ──────────────────────────────────────────────────────────────
/** A taxonomy value present in the data but absent from the schema. Surfaced, never
 *  hidden — hiding it would silently drop compliance-relevant entities. */
export interface UnknownValue {
  facetId: string
  axis:    'enum' | 'parent' | 'child'
  value:   string
  count:   number
}

/** What reconciliation changed, so the UI can announce it (e.g. a toast). */
export interface ReconcileReport {
  dropped: { facetId: string; axis: 'parent' | 'child' | 'value'; value: string; reason: string }[]
}

// ─── Active-filter pills ─────────────────────────────────────────────────────────
export type ChipRole = 'text' | 'value' | 'parent' | 'child' | 'dateFrom' | 'dateTo'
export interface ActiveChip {
  facetId: string
  kind:    FacetKind | 'text'
  role:    ChipRole
  value:   string           // the raw value (or text) this pill removes
  parent?: string           // present for hierarchy child chips
  label:   string           // display, e.g. "Status: Active"
}

// ─── The engine's public contract ─────────────────────────────────────────────────
export interface UseEntityFiltersResult<T> {
  results:        T[]
  total:          number        // unfiltered entity count
  counts:         FacetCounts
  state:          FilterState
  activeChips:    ActiveChip[]
  unknownValues:  UnknownValue[]
  reconciliation: ReconcileReport
  hasActiveFilters: boolean

  // mutators — all funnel through one reducer and write the URL
  setText:      (text: string) => void
  toggleEnum:   (facetId: string, value: string) => void
  toggleParent: (facetId: string, parent: string) => void
  toggleChild:  (facetId: string, child: string) => void   // parent derived from the schema
  setDateRange: (facetId: string, range: Partial<DateRangeValue>) => void
  removeChip:   (chip: ActiveChip) => void
  clearFacet:   (facetId: string) => void
  clearAll:     () => void
  /** Replace the whole state at once — used by URL rehydrate, saved views, and the
   *  interpreted-query path (which populates visible chips, never a raw list). */
  applyState:   (next: FilterState) => void
}
