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

// A coverage section within a line (e.g. ISO Homeowners "Section I — Property").
// `match` classifies a coverage into the section by its name; `groupBySection`
// assigns each coverage to the first section whose predicate matches.
export interface LobSection {
  label: string
  match: (coverageName: string) => boolean
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

export interface LobDefinition {
  refId:    string                 // e.g. "HO.LOB.001"
  prefix:   string                 // refId prefix for this line's entities, e.g. "HO"
  name:     string                 // "Homeowners"
  vertical: MarketVertical
  family:   CoverageFamily
  sections: LobSection[]           // ordered; drives coverage grouping
  peril:    PerilRule
  footprintStates: readonly string[] // the line's standard filing footprint (States "All footprint")
}

// ─── Homeowners (fully described — the seed reference line) ────────────────────

// ISO Homeowners splits coverages into Section I (property: Coverages A–D) and
// Section II (liability + medical payments: Coverages E–F).
const isHoLiability = (name: string) => /liabilit|medical/i.test(name)

export const HO_LOB: LobDefinition = {
  refId:    'HO.LOB.001',
  prefix:   'HO',
  name:     'Homeowners',
  vertical: 'Personal Lines',
  family:   'Property',
  sections: [
    { label: 'Section I — Property',   match: (n) => !isHoLiability(n) },
    { label: 'Section II — Liability', match: isHoLiability },
  ],
  peril: {
    kind:           'COASTAL_WIND_HAIL',
    eligibleStates: ['FL', 'GA', 'NC', 'SC', 'TX'],
    label:          'Coastal wind/hail',
  },
  footprintStates: ['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA'],
}

// ─── General Liability (the second seed reference line — commercial casualty) ──

// ISO CGL groups coverage into coverage parts A/B/C; GL rates by territory and has
// no coastal peril. The final catch-all keeps any unclassified coverage visible.
export const GL_LOB: LobDefinition = {
  refId:    'GL.LOB.001',
  prefix:   'GL',
  name:     'General Liability',
  vertical: 'Commercial Lines',
  family:   'Casualty',
  sections: [
    { label: 'Coverage A — Bodily Injury & Property Damage', match: (n) => /bodily|property damage/i.test(n) },
    { label: 'Coverage B — Personal & Advertising Injury',   match: (n) => /personal|advertising/i.test(n) },
    { label: 'Coverage C — Medical Payments',                match: (n) => /medical/i.test(n) },
    { label: 'Other Coverages',                              match: () => true },
  ],
  peril: { kind: 'TERRITORY', eligibleStates: [], label: 'Rating territory' },
  footprintStates: [
    'AL','AZ','AR','CA','CO','CT','DE','DC','FL','GA','ID','IL','IN','IA','KS','KY',
    'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NC','ND','OH',
    'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  ],
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
