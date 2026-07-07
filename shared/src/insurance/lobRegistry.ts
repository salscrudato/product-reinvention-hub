// lobRegistry.ts — the Line-of-Business registry: the single source of truth for
// line-specific behavior so the platform is genuinely multi-line rather than
// Homeowners-only. Each entry owns its refId prefix, coverage-section taxonomy
// (how Overview/Explorer group coverages), and peril/territorial deductible rules
// (Homeowners gates a wind/hail % deductible to a coastal state subset; other lines
// use rating territories instead). Every line-aware decision in shared/ and the UI
// resolves through here rather than hard-coding Homeowners-isms. Both Homeowners and
// General Liability are fully described (each has a seed reference product).
// Pure TypeScript — zero platform imports.

// Personal vs Commercial market vertical; Property vs Casualty family — the two
// grouping hints the portfolio/segment surfaces use to describe a line.
export type MarketVertical = 'Personal Lines' | 'Commercial Lines'
export type CoverageFamily = 'Property' | 'Casualty'

// PROPERTY vs CASUALTY — the canonical line category used by the task-specified
// LOB registry contract. Maps one-to-one with CoverageFamily (Property → PROPERTY).
export type LineCategory = 'PROPERTY' | 'CASUALTY'

// A coverage section within a line (e.g. ISO Homeowners "Section I — Property").
// `label` is the full display string; `shortName` is the short identifier used in
// form `coverageParts` arrays and other compact contexts. `match` classifies a
// coverage into the section by its name; `groupBySection` assigns each coverage to
// the first section whose predicate matches.
export interface LobSection {
  label:     string
  shortName: string                       // compact identifier, e.g. "Section I"
  match:     (coverageName: string) => boolean
}

// How a line expresses peril-based territorial deductible eligibility. Homeowners
// gates a wind/hail % deductible to coastal states; a casualty line rates by
// territory and has no coastal peril at all.
export type PerilKind = 'COASTAL_WIND_HAIL' | 'TERRITORY' | 'NONE'

export interface PerilRule {
  kind:           PerilKind
  eligibleStates: readonly string[]  // states where the special-peril deductible applies
  label:          string             // badge/legend label, e.g. "Coastal wind/hail"
}

// LobDefinition carries both the original field names (for backward compatibility
// with all existing consumers) and the task-specified canonical names. The aliased
// pairs share the same values — `prefix`/`code`/`refIdPrefix`, `name`/`displayName`,
// `sections`/`sectionTaxonomy`, `peril`/`perilModel` — so callers may use either.
export interface LobDefinition {
  // ── original fields (kept for backward compatibility) ──────────────────────
  refId:    string                 // e.g. "HO.LOB.001"
  prefix:   string                 // refId prefix for this line's entities, e.g. "HO"
  name:     string                 // "Homeowners"
  vertical: MarketVertical
  family:   CoverageFamily
  sections: LobSection[]           // ordered; drives coverage grouping
  peril:    PerilRule
  footprintStates: readonly string[] // the line's standard filing footprint

  // ── task-specified canonical fields (additive — extend, do not replace) ───
  code:                 string             // short LOB code; same value as `prefix`
  displayName:          string             // human label; same value as `name`
  refIdPrefix:          string             // refId prefix; same value as `prefix`
  lineCategory:         LineCategory       // 'PROPERTY' | 'CASUALTY'
  personalOrCommercial: 'Personal' | 'Commercial'
  sectionTaxonomy:      LobSection[]       // how coverages group; same ref as `sections`
  perilModel:           PerilRule          // peril/territory model; same ref as `peril`
  supportsRulesSimulation: boolean         // true only for lines with an evaluateRules() impl
  // Size / market bands the line serves (e.g. Small Commercial, Middle Market for
  // commercial casualty; Personal Lines for a personal line). This is the third
  // portfolio-segmentation axis and — like vertical and family — is owned here so
  // the segmentation UI derives its facets from the registry rather than hard-coding
  // them. Adding a line automatically extends the Market-segment facet.
  marketSegments:       readonly string[]
}

// ─── Homeowners (fully described — the seed reference line) ────────────────────

// ISO Homeowners splits coverages into Section I (property: Coverages A–D) and
// Section II (liability + medical payments: Coverages E–F).
const isHoLiability = (name: string) => /liabilit|medical/i.test(name)

const HO_SECTIONS: LobSection[] = [
  { label: 'Section I — Property',   shortName: 'Section I',  match: (n) => !isHoLiability(n) },
  { label: 'Section II — Liability', shortName: 'Section II', match: isHoLiability },
]

const HO_PERIL: PerilRule = {
  kind:           'COASTAL_WIND_HAIL',
  eligibleStates: ['FL', 'GA', 'NC', 'SC', 'TX'],
  label:          'Coastal wind/hail',
}

export const HO_LOB: LobDefinition = {
  refId:    'HO.LOB.001',
  prefix:   'HO',
  name:     'Homeowners',
  vertical: 'Personal Lines',
  family:   'Property',
  sections: HO_SECTIONS,
  peril:    HO_PERIL,
  footprintStates: ['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA'],
  // canonical additive fields
  code:                 'HO',
  displayName:          'Homeowners',
  refIdPrefix:          'HO',
  lineCategory:         'PROPERTY',
  personalOrCommercial: 'Personal',
  sectionTaxonomy:      HO_SECTIONS,
  perilModel:           HO_PERIL,
  supportsRulesSimulation: true,
  marketSegments:       ['Personal Lines'],
}

// ─── General Liability (the second seed reference line — commercial casualty) ──

// ISO CGL groups coverage into coverage parts A/B/C; GL rates by territory and has
// no coastal peril. The final catch-all keeps any unclassified coverage visible.
const GL_SECTIONS: LobSection[] = [
  { label: 'Coverage A — Bodily Injury & Property Damage', shortName: 'Coverage A', match: (n) => /bodily|property damage/i.test(n) },
  { label: 'Coverage B — Personal & Advertising Injury',   shortName: 'Coverage B', match: (n) => /personal|advertising/i.test(n) },
  { label: 'Coverage C — Medical Payments',                shortName: 'Coverage C', match: (n) => /medical/i.test(n) },
  { label: 'Other Coverages',                              shortName: 'Other',      match: () => true },
]

const GL_PERIL: PerilRule = {
  kind: 'TERRITORY', eligibleStates: [], label: 'Rating territory',
}

export const GL_LOB: LobDefinition = {
  refId:    'GL.LOB.001',
  prefix:   'GL',
  name:     'General Liability',
  vertical: 'Commercial Lines',
  family:   'Casualty',
  sections: GL_SECTIONS,
  peril:    GL_PERIL,
  footprintStates: [
    'AL','AZ','AR','CA','CO','CT','DE','DC','FL','GA','ID','IL','IN','IA','KS','KY',
    'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NC','ND','OH',
    'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  ],
  // canonical additive fields
  code:                 'GL',
  displayName:          'General Liability',
  refIdPrefix:          'GL',
  lineCategory:         'CASUALTY',
  personalOrCommercial: 'Commercial',
  sectionTaxonomy:      GL_SECTIONS,
  perilModel:           GL_PERIL,
  supportsRulesSimulation: false,
  marketSegments:       ['Small Commercial', 'Middle Market'],
}

// ─── Registry + resolution ─────────────────────────────────────────────────────

export const LOB_REGISTRY: Record<string, LobDefinition> = {
  [HO_LOB.refId]: HO_LOB,
  [GL_LOB.refId]: GL_LOB,
}

// Homeowners is the seed reference line and the safe default when a product's LOB
// is missing or unrecognised.
export const DEFAULT_LOB = HO_LOB

function lobByPrefix(refId?: string | null): LobDefinition | undefined {
  if (!refId) return undefined
  const prefix = refId.split('.')[0]
  return Object.values(LOB_REGISTRY).find(l => l.prefix === prefix)
}

/** Resolve a product's line-of-business definition. Matches the LOB refId exactly,
 *  then falls back to the refId prefix, then to Homeowners (the reference line). */
export function resolveLob(product?: { lob?: { refId?: string | null } | null } | null): LobDefinition {
  const refId = product?.lob?.refId ?? null
  if (refId && LOB_REGISTRY[refId]) return LOB_REGISTRY[refId]
  return lobByPrefix(refId) ?? DEFAULT_LOB
}

/** Resolve a LOB from any entity refId by its prefix (e.g. "HO.COV.003" →
 *  Homeowners). Returns undefined when no line claims the prefix. */
export function resolveLobByRefId(refId?: string | null): LobDefinition | undefined {
  return lobByPrefix(refId)
}

/** Group items (coverages) into the line's sections, preserving input order. Each
 *  item lands in the first section whose predicate matches (fallback: the last
 *  section). Empty sections are dropped so only populated groups render. */
export function groupBySection<T extends { name: string }>(
  lob: LobDefinition,
  items: T[],
): { label: string; items: T[] }[] {
  const buckets = lob.sections.map(s => ({ label: s.label, items: [] as T[] }))
  for (const item of items) {
    let idx = lob.sections.findIndex(s => s.match(item.name))
    if (idx < 0) idx = buckets.length - 1
    buckets[idx]!.items.push(item)
  }
  return buckets.filter(b => b.items.length > 0)
}

/** Whether a state falls in the line's special-peril (coastal wind/hail) subset. */
export function isPerilState(lob: LobDefinition, state: string): boolean {
  return lob.peril.eligibleStates.includes(state)
}

// ─── Portfolio segmentation (registry-driven) ──────────────────────────────────
// The portfolio surfaces (Products list, inventory, hierarchy) segment products
// along three axes: market vertical (Personal vs Commercial), coverage family
// (Property vs Casualty), and market segment (Small / Middle Market, …). Every
// facet's *values* are derived from LOB_REGISTRY below — nothing is hard-coded in
// the UI — so registering a new line automatically extends every axis.

/** The identifier of a segmentation axis. */
export type SegmentAxisId = 'vertical' | 'family' | 'marketSegment'

/** One selectable facet axis: an id, a human label, and the distinct values that
 *  currently exist across the registry (sorted, de-duplicated). */
export interface SegmentAxis {
  id:     SegmentAxisId
  label:  string
  values: string[]
}

/** A (possibly partial) segmentation selection — an optional chosen value per axis. */
export type SegmentSelection = Partial<Record<SegmentAxisId, string>>

/** The segment tags a single line carries on each axis. `marketSegments` is a set
 *  because a line can serve several bands (e.g. Small Commercial + Middle Market). */
export interface LineSegments {
  vertical:       MarketVertical
  family:         CoverageFamily
  marketSegments: readonly string[]
}

/** Distinct, sorted values for an axis across every registered line. */
function distinctAcrossRegistry(pick: (lob: LobDefinition) => readonly string[]): string[] {
  const set = new Set<string>()
  for (const lob of Object.values(LOB_REGISTRY)) for (const v of pick(lob)) set.add(v)
  return [...set].sort()
}

/** Build the segmentation axes from the registry. The facet values are whatever the
 *  registered lines actually declare — add a line and the axes grow automatically. */
export function deriveSegmentAxes(): SegmentAxis[] {
  return [
    { id: 'vertical',      label: 'Vertical',       values: distinctAcrossRegistry(l => [l.vertical]) },
    { id: 'family',        label: 'Coverage family', values: distinctAcrossRegistry(l => [l.family]) },
    { id: 'marketSegment', label: 'Market segment',  values: distinctAcrossRegistry(l => l.marketSegments) },
  ]
}

/** The segment tags a product carries, resolved through its line-of-business. */
export function productSegments(product?: { lob?: { refId?: string | null } | null } | null): LineSegments {
  const lob = resolveLob(product)
  return { vertical: lob.vertical, family: lob.family, marketSegments: lob.marketSegments }
}

/** Whether a product satisfies a segmentation selection. Unset axes are wildcards;
 *  the marketSegment axis matches when the product's line serves that band. */
export function matchesSegments(
  product: { lob?: { refId?: string | null } | null } | null | undefined,
  selection: SegmentSelection,
): boolean {
  const seg = productSegments(product)
  if (selection.vertical && seg.vertical !== selection.vertical) return false
  if (selection.family && seg.family !== selection.family) return false
  if (selection.marketSegment && !seg.marketSegments.includes(selection.marketSegment)) return false
  return true
}
