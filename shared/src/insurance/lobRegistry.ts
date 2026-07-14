// lobRegistry.ts — the Line-of-Business registry: the single source of truth for
// line-specific behavior so the platform is genuinely multi-line rather than
// Homeowners-only. Each entry owns its refId prefix, coverage-section taxonomy
// (how Overview/Explorer group coverages), and peril/territorial deductible rules
// (Personal Home gates a wind/hail % deductible to a coastal state subset; Personal
// Auto rates by territory instead). Every line-aware decision in shared/ and the UI
// resolves through here rather than hard-coding line-specific logic. Both Personal
// Home and Personal Auto are fully described (each has a seed reference product).
// Pure TypeScript — zero platform imports.
//
// lineIntelligence: the optional LineArchetype that extends each LobDefinition with
// the full Line Intelligence vocabulary (exposure bases, trigger types, limit structures,
// rating-stage archetypes, document fingerprints, translation recipe). Populated by
// lines/registry.ts after module initialisation — no circular import because this file
// only imports the LineArchetype TYPE from lines/types.ts, not any values.
import type { LineArchetype } from '../lines/types'

// Personal vs Commercial market vertical; Property vs Casualty vs Automobile family.
export type MarketVertical = 'Personal Lines' | 'Commercial Lines'
export type CoverageFamily = 'Property' | 'Casualty' | 'Automobile'

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

// How a line expresses peril-based territorial deductible eligibility. Personal Home
// gates a wind/hail % deductible to coastal states; an auto line rates by territory
// and has no coastal peril at all.
export type PerilKind = 'COASTAL_WIND_HAIL' | 'TERRITORY' | 'NONE'

export interface PerilRule {
  kind:           PerilKind
  eligibleStates: readonly string[]  // states where the special-peril deductible applies
  label:          string             // badge/legend label, e.g. "Coastal wind/hail"
}

// ─── refId schemes (line-specific id shapes + synthesis) ─────────────────────────
// Real source workbooks emit refIds in line-specific shapes that differ in BOTH
// punctuation and tokens: GL dots every segment ("GL.COV.002.003", "GL.RU.006",
// "GL.RAT.1.05"); Inland Marine concatenates the number onto the token and pads a
// two-digit tail ("IM.COV044.00", rules "IM.RL.001"); Property uses a one-digit tail
// ("PR.COV001.0") and a "ROC" (Rate Order of Calculations) token for rating steps
// ("PR.ROC.001"). Each line therefore OWNS its shape as data here rather than any
// consumer hard-coding a format. `synthesize` mints an id in the line's exact shape —
// the load-bearing path for sources that ship blank / "TBD" ids (e.g. Property ROC
// steps), so a governed refId can always be assigned without inventing a foreign shape.

/** The canonical entity kinds a refId can identify. */
export type RefIdEntityKind =
  | 'product' | 'lob' | 'coverage' | 'subCoverage'
  | 'rule' | 'formRule' | 'ratingProgram' | 'ratingStep'

export interface RefIdScheme {
  /** Human-readable shape per entity kind ('#' marks a zero-padded digit run). Documentation
   *  + grounding for the models; never parsed as logic. */
  shapes:      Record<RefIdEntityKind, string>
  /** Prefix-anchored recognizer for any refId belonging to this line. */
  pattern:     RegExp
  /** Product-/LOB-name (and sheet-name) signals used to infer the line when a workbook ships
   *  no usable refIds — never a filename match (see inferLob). */
  nameSignals: readonly RegExp[]
  /** Mint a refId in this line's EXACT shape. `seq` is the entity's 1-based index; `parentSeq`
   *  is the parent coverage's index for a sub-coverage. Used for TBD/blank source ids. */
  synthesize:  (kind: RefIdEntityKind, seq: number, parentSeq?: number) => string
}

/** Zero-padded positive integer of a given width. */
const pad = (n: number, w: number): string => String(Math.trunc(Math.abs(n))).padStart(w, '0')

/** The dotted scheme shared by the fully-dotted lines (PH, PA, GL): every segment is
 *  dot-separated and the sequence is a 3-digit run, e.g. "GL.COV.002.003". */
function dottedScheme(code: string, nameSignals: readonly RegExp[]): RefIdScheme {
  return {
    shapes: {
      product:       `${code}.PROD.###`,
      lob:           `${code}.LOB.###`,
      coverage:      `${code}.COV.###`,
      subCoverage:   `${code}.COV.###.###`,
      rule:          `${code}.RU.###`,
      formRule:      `${code}.FORM.RU.###`,
      ratingProgram: `${code}.RAT.#`,
      ratingStep:    `${code}.RAT.#.##`,
    },
    pattern: new RegExp(`^${code}\\.(PROD|LOB|COV|RU|FORM|RAT)`, 'i'),
    nameSignals,
    synthesize(kind, seq, parentSeq = 1) {
      switch (kind) {
        case 'product':       return `${code}.PROD.${pad(seq, 3)}`
        case 'lob':           return `${code}.LOB.${pad(seq, 3)}`
        case 'coverage':      return `${code}.COV.${pad(seq, 3)}`
        case 'subCoverage':   return `${code}.COV.${pad(parentSeq, 3)}.${pad(seq, 3)}`
        case 'rule':          return `${code}.RU.${pad(seq, 3)}`
        case 'formRule':      return `${code}.FORM.RU.${pad(seq, 3)}`
        case 'ratingProgram': return `${code}.RAT.${Math.trunc(seq) || 1}`
        case 'ratingStep':    return `${code}.RAT.1.${pad(seq, 2)}`
        default:              return `${code}.${pad(seq, 3)}`
      }
    },
  }
}

const PH_REFIDS: RefIdScheme = dottedScheme('PH', [/homeowners?/i, /personal home/i, /\bHO-?[2-8]\b/i, /dwelling/i])
const PA_REFIDS: RefIdScheme = dottedScheme('PA', [/personal auto/i, /\bauto(mobile)?\b/i, /\bPAP\b/i, /\bPP 00 01\b/i])
const GL_REFIDS: RefIdScheme = dottedScheme('GL', [/general liability/i, /\bC\.?G\.?L\b/i, /commercial general/i, /\bCG 00 0[12]\b/i])

// Inland Marine — token+number concatenated with a 2-digit tail; rules use the "RL" token.
const IM_REFIDS: RefIdScheme = {
  shapes: {
    product:       'IM.PROD###',
    lob:           'IM.LOB###',
    coverage:      'IM.COV###.##',
    subCoverage:   'IM.COV###.##',
    rule:          'IM.RL.###',
    formRule:      'IM.FORM.RL.###',
    ratingProgram: 'IM.RAT.###',
    ratingStep:    'IM.RAT.###',
  },
  pattern: /^IM\.(PROD|LOB|COV|RL|RU|FORM|RAT)/i,
  nameSignals: [/inland marine/i, /scheduled (personal )?property/i, /contractors?.?equipment/i, /\bfloater\b/i],
  synthesize(kind, seq, parentSeq = seq) {
    switch (kind) {
      case 'product':       return `IM.PROD${pad(seq, 3)}`
      case 'lob':           return `IM.LOB${pad(seq, 3)}`
      case 'coverage':      return `IM.COV${pad(seq, 3)}.00`
      case 'subCoverage':   return `IM.COV${pad(parentSeq, 3)}.${pad(seq, 2)}`
      case 'rule':          return `IM.RL.${pad(seq, 3)}`
      case 'formRule':      return `IM.FORM.RL.${pad(seq, 3)}`
      case 'ratingProgram': return `IM.RAT.${pad(seq, 3)}`
      case 'ratingStep':    return `IM.RAT.${pad(seq, 3)}`
      default:              return `IM.${pad(seq, 3)}`
    }
  },
}

// Property — one-digit tail on coverages; rating steps use the "ROC" (Rate Order of
// Calculations) token, the scheme the synthesizer fills for TBD Property-ROC step ids.
const PR_REFIDS: RefIdScheme = {
  shapes: {
    product:       'PR.PROD###',
    lob:           'PR.LOB###',
    coverage:      'PR.COV###.#',
    subCoverage:   'PR.COV###.#',
    rule:          'PR.RU.###',
    formRule:      'PR.FORM.RU.###',
    ratingProgram: 'PR.ROC',
    ratingStep:    'PR.ROC.###',
  },
  pattern: /^PR\.(PROD|LOB|COV|RU|ROC|FORM|RAT)/i,
  nameSignals: [/commercial property/i, /property (framework|component|coverage part|roc|rating)/i, /building and (business )?personal property/i, /\bCP 00 10\b/i],
  synthesize(kind, seq, parentSeq = seq) {
    switch (kind) {
      case 'product':       return `PR.PROD${pad(seq, 3)}`
      case 'lob':           return `PR.LOB${pad(seq, 3)}`
      case 'coverage':      return `PR.COV${pad(seq, 3)}.0`
      case 'subCoverage':   return `PR.COV${pad(parentSeq, 3)}.${Math.trunc(seq)}`
      case 'rule':          return `PR.RU.${pad(seq, 3)}`
      case 'formRule':      return `PR.FORM.RU.${pad(seq, 3)}`
      case 'ratingProgram': return 'PR.ROC'
      case 'ratingStep':    return `PR.ROC.${pad(seq, 3)}`
      default:              return `PR.${pad(seq, 3)}`
    }
  },
}

// LobDefinition carries both the original field names (for backward compatibility
// with all existing consumers) and the task-specified canonical names. The aliased
// pairs share the same values — `prefix`/`code`/`refIdPrefix`, `name`/`displayName`,
// `sections`/`sectionTaxonomy`, `peril`/`perilModel` — so callers may use either.
export interface LobDefinition {
  // ── original fields (kept for backward compatibility) ──────────────────────
  refId:    string                 // e.g. "PH.LOB.001"
  prefix:   string                 // refId prefix for this line's entities, e.g. "PH"
  name:     string                 // "Personal Home"
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
  // The line's refId shape + synthesizer (see RefIdScheme). Owned here as data so no
  // importer/exporter hard-codes a line's id format; `refIdScheme.synthesize` mints ids
  // for sources that ship blank / "TBD" refIds.
  refIdScheme:          RefIdScheme
  // Size / market bands the line serves (e.g. Small Commercial, Middle Market for
  // commercial casualty; Personal Lines for a personal line). This is the third
  // portfolio-segmentation axis and — like vertical and family — is owned here so
  // the segmentation UI derives its facets from the registry rather than hard-coding
  // them. Adding a line automatically extends the Market-segment facet.
  marketSegments:       readonly string[]
  // Extended Line Intelligence vocabulary — populated by lines/registry.ts after
  // module initialisation. Optional so LOB_REGISTRY entries are valid before the
  // augmentation runs and so unregistered virtual families need no LobDefinition.
  lineIntelligence?:    LineArchetype
}

// ─── Personal Home (fully described — the seed reference line) ────────────────

// ISO Homeowners splits coverages into Section I (property: Coverages A–D) and
// Section II (liability + medical payments: Coverages E–F).
const isPHLiability = (name: string) => /liabilit|medical/i.test(name)

const PH_SECTIONS: LobSection[] = [
  { label: 'Section I — Property',   shortName: 'Section I',  match: (n) => !isPHLiability(n) },
  { label: 'Section II — Liability', shortName: 'Section II', match: isPHLiability },
]

const PH_PERIL: PerilRule = {
  kind:           'COASTAL_WIND_HAIL',
  eligibleStates: ['FL', 'GA', 'NC', 'SC', 'TX'],
  label:          'Coastal wind/hail',
}

export const PH_LOB: LobDefinition = {
  refId:    'PH.LOB.001',
  prefix:   'PH',
  name:     'Personal Home',
  vertical: 'Personal Lines',
  family:   'Property',
  sections: PH_SECTIONS,
  peril:    PH_PERIL,
  footprintStates: ['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA'],
  // canonical additive fields
  code:                 'PH',
  displayName:          'Personal Home',
  refIdPrefix:          'PH',
  lineCategory:         'PROPERTY',
  personalOrCommercial: 'Personal',
  sectionTaxonomy:      PH_SECTIONS,
  perilModel:           PH_PERIL,
  supportsRulesSimulation: true,
  refIdScheme:          PH_REFIDS,
  marketSegments:       ['Personal Lines'],
}

// ─── Personal Auto (the second seed reference line — personal automobile) ──────

// ISO PAP groups coverage into four Parts: A (Liability), B (Med Pay),
// C (UM/UIM), D (Physical Damage). The final catch-all keeps any unclassified
// coverage visible.
const PA_SECTIONS: LobSection[] = [
  { label: 'Part A — Liability Coverage',                  shortName: 'Part A', match: (n) => /liabilit/i.test(n) },
  { label: 'Part B — Medical Payments Coverage',           shortName: 'Part B', match: (n) => /medical/i.test(n) },
  { label: 'Part C — Uninsured Motorists Coverage',        shortName: 'Part C', match: (n) => /uninsured|underinsured|motorist/i.test(n) },
  { label: 'Part D — Coverage for Damage to Your Auto',   shortName: 'Part D', match: () => true },
]

const PA_PERIL: PerilRule = {
  kind: 'TERRITORY', eligibleStates: [], label: 'Rating territory',
}

export const PA_LOB: LobDefinition = {
  refId:    'PA.LOB.001',
  prefix:   'PA',
  name:     'Personal Auto',
  vertical: 'Personal Lines',
  family:   'Automobile',
  sections: PA_SECTIONS,
  peril:    PA_PERIL,
  footprintStates: [
    'AL','AZ','AR','CA','CO','CT','DE','DC','FL','GA','ID','IL','IN','IA','KS','KY',
    'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NC','ND','OH',
    'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI',
  ],
  // canonical additive fields
  code:                 'PA',
  displayName:          'Personal Auto',
  refIdPrefix:          'PA',
  lineCategory:         'CASUALTY',
  personalOrCommercial: 'Personal',
  sectionTaxonomy:      PA_SECTIONS,
  perilModel:           PA_PERIL,
  supportsRulesSimulation: true,
  refIdScheme:          PA_REFIDS,
  marketSegments:       ['Personal Lines'],
}

// ─── Commercial General Liability (ISO CGL, CG 00 01 occurrence form) ─────────

// ISO CGL groups coverage into three insuring agreements:
// Coverage A (BI/PD), Coverage B (Personal & Advertising Injury), Coverage C (Med Pay).
const GL_SECTIONS: LobSection[] = [
  { label: 'Coverage A — Bodily Injury & Property Damage Liability',
    shortName: 'Coverage A',
    match: (n) => /bodily.injury|property.damage|BI.?PD|Coverage A/i.test(n) },
  { label: 'Coverage B — Personal & Advertising Injury Liability',
    shortName: 'Coverage B',
    match: (n) => /personal.*advertis|advertis.*injur|Coverage B/i.test(n) },
  { label: 'Coverage C — Medical Payments',
    shortName: 'Coverage C',
    match: () => true },  // catch-all for Coverage C and unclassified
]

const GL_PERIL: PerilRule = {
  // Commercial casualty — no coastal peril deductible. Rate variation is by class
  // code and exposure base, not by territory in the base occurrence form.
  kind: 'NONE', eligibleStates: [], label: 'None',
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
    'AL', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'ID', 'IL',
    'IN', 'IA', 'KS', 'KY', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
    'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
    'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  ],
  // canonical additive fields
  code:                 'GL',
  displayName:          'General Liability',
  refIdPrefix:          'GL',
  lineCategory:         'CASUALTY',
  personalOrCommercial: 'Commercial',
  sectionTaxonomy:      GL_SECTIONS,
  perilModel:           GL_PERIL,
  supportsRulesSimulation: true,
  refIdScheme:          GL_REFIDS,
  marketSegments:       ['Commercial Lines', 'Small Commercial', 'Middle Market'],
}

// ─── Inland Marine (ISO/AAIS Commercial Inland Marine — scheduled + floater) ──────

// Commercial Inland Marine groups coverage into scheduled (per-item, valued) property,
// blanket/floater coverage, and coverage extensions. No coastal wind/hail territorial
// deductible in the base — inland marine rates per scheduled item / class.
const IM_SECTIONS: LobSection[] = [
  { label: 'Scheduled Property',          shortName: 'Scheduled',  match: (n) => /schedul|itemized|valued|floater/i.test(n) },
  { label: 'Blanket & Equipment Coverage', shortName: 'Blanket',    match: (n) => /blanket|equipment|installation|tool/i.test(n) },
  { label: 'Coverage Extensions',          shortName: 'Extensions', match: () => true }, // catch-all
]

const IM_PERIL: PerilRule = { kind: 'NONE', eligibleStates: [], label: 'None' }

export const IM_LOB: LobDefinition = {
  refId:    'IM.LOB.001',
  prefix:   'IM',
  name:     'Inland Marine',
  vertical: 'Commercial Lines',
  family:   'Property',
  sections: IM_SECTIONS,
  peril:    IM_PERIL,
  footprintStates: [
    'AL','AZ','AR','CA','CO','CT','DE','DC','FL','GA','ID','IL','IN','IA','KS','KY',
    'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
    'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  ],
  code:                 'IM',
  displayName:          'Inland Marine',
  refIdPrefix:          'IM',
  lineCategory:         'PROPERTY',
  personalOrCommercial: 'Commercial',
  sectionTaxonomy:      IM_SECTIONS,
  perilModel:           IM_PERIL,
  supportsRulesSimulation: false,
  refIdScheme:          IM_REFIDS,
  // Segments drawn from the existing registry set so the portfolio facets are unchanged.
  marketSegments:       ['Commercial Lines', 'Small Commercial'],
}

// ─── Property (ISO Commercial Property — CP 00 10 building & personal property) ───

// Commercial Property groups coverage into building & business personal property,
// time-element (business income / extra expense), and additional coverages / causes
// of loss. Commercial property DOES carry a coastal wind/hail deductible programme.
const PR_SECTIONS: LobSection[] = [
  { label: 'Building & Business Personal Property', shortName: 'Property',      match: (n) => /building|business personal|contents|stock/i.test(n) },
  { label: 'Time Element',                          shortName: 'Time Element',  match: (n) => /business income|extra expense|rental value|time element/i.test(n) },
  { label: 'Additional Coverages',                  shortName: 'Additional',    match: () => true }, // catch-all (incl. causes of loss)
]

const PR_PERIL: PerilRule = {
  kind:           'COASTAL_WIND_HAIL',
  eligibleStates: ['AL', 'FL', 'GA', 'LA', 'MS', 'NC', 'SC', 'TX', 'VA'],
  label:          'Coastal wind/hail',
}

export const PR_LOB: LobDefinition = {
  refId:    'PR.LOB.001',
  prefix:   'PR',
  name:     'Commercial Property',
  vertical: 'Commercial Lines',
  family:   'Property',
  sections: PR_SECTIONS,
  peril:    PR_PERIL,
  footprintStates: [
    'AL','AZ','AR','CA','CO','CT','DE','DC','FL','GA','ID','IL','IN','IA','KS','KY',
    'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC',
    'ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  ],
  code:                 'PR',
  displayName:          'Commercial Property',
  refIdPrefix:          'PR',
  lineCategory:         'PROPERTY',
  personalOrCommercial: 'Commercial',
  sectionTaxonomy:      PR_SECTIONS,
  perilModel:           PR_PERIL,
  supportsRulesSimulation: false,
  refIdScheme:          PR_REFIDS,
  // Segments drawn from the existing registry set so the portfolio facets are unchanged.
  marketSegments:       ['Commercial Lines', 'Middle Market'],
}

// ─── Registry + resolution ─────────────────────────────────────────────────────

export const LOB_REGISTRY: Record<string, LobDefinition> = {
  [PH_LOB.refId]: PH_LOB,
  [PA_LOB.refId]: PA_LOB,
  [GL_LOB.refId]: GL_LOB,
  [IM_LOB.refId]: IM_LOB,
  [PR_LOB.refId]: PR_LOB,
}

// Personal Home is the seed reference line and the safe default when a product's LOB
// is missing or unrecognised.
export const DEFAULT_LOB = PH_LOB

function lobByPrefix(refId?: string | null): LobDefinition | undefined {
  if (!refId) return undefined
  const prefix = refId.split('.')[0]
  return Object.values(LOB_REGISTRY).find(l => l.prefix === prefix)
}

/** Resolve a product's line-of-business definition. Matches the LOB refId exactly,
 *  then falls back to the refId prefix, then to Personal Home (the reference line). */
export function resolveLob(product?: { lob?: { refId?: string | null } | null } | null): LobDefinition {
  const refId = product?.lob?.refId ?? null
  if (refId && LOB_REGISTRY[refId]) return LOB_REGISTRY[refId]
  return lobByPrefix(refId) ?? DEFAULT_LOB
}

/** Resolve a LOB from any entity refId by its prefix (e.g. "PH.COV.003" →
 *  Personal Home; "IM.COV044.00" → Inland Marine; "PR.COV001.0" → Property).
 *  Returns undefined when no line claims the prefix. */
export function resolveLobByRefId(refId?: string | null): LobDefinition | undefined {
  return lobByPrefix(refId)
}

/** Entity-kind classification a refId's SCHEME SEGMENT carries, across every line's
 *  shape — including glued digit runs ("PR.PROD001", "IM.PROD044") and abbreviated
 *  tokens ("CORE.PRD.001"). This is the shared identifier parser the import brain
 *  routes row-kind decisions through (ledger F05): narrow ad-hoc regexes like
 *  /\.PROD\./ miss real scheme variants and silently misclassify rows. Returns null
 *  when the string carries no recognizable scheme segment (the caller falls back to
 *  its own context, e.g. the sheet's dominant mapped kind). */
export type RefIdSegmentKind =
  | 'product' | 'lob' | 'coverage' | 'rule' | 'form' | 'rating'

export function refIdSegmentKind(refId?: string | null): RefIdSegmentKind | null {
  if (typeof refId !== 'string') return null
  // PREFIX <sep> SEGMENT…  — separator is '.', '-', '_' or a space; the segment's
  // leading letter run is the kind token (digits may be glued: "PROD001").
  const m = /^[A-Z]{1,6}[.\-_ ]([A-Z]+)/i.exec(refId.trim())
  if (!m) return null
  const token = m[1].toUpperCase()
  if (token.startsWith('PROD') || token === 'PRD') return 'product'
  if (token.startsWith('LOB')) return 'lob'
  if (token.startsWith('SUBCOV') || token.startsWith('COV')) return 'coverage'
  if (token === 'RU' || token === 'RL' || token.startsWith('RULE') || token === 'FR') return 'rule'
  if (token.startsWith('FORM')) return 'form'
  if (token.startsWith('RAT') || token === 'ROC' || token.startsWith('PROG') || token.startsWith('STEP') || token === 'RT' || token === 'LD') return 'rating'
  return null
}

// ─── Workbook line inference (from the source's OWN content, never a filename) ────

/** The evidence inferLob() weighs, gathered from a workbook's own cells — never its
 *  filename. `refIds` are any traceability ids read from the sheets (blank / "TBD"
 *  entries are ignored); `productName` / `lobName` come from the product hierarchy;
 *  `sheetNames` are a weak fallback when a source ships no usable refIds at all. */
export interface LineInferenceSignals {
  refIds?:     readonly (string | null | undefined)[]
  productName?: string | null
  lobName?:     string | null
  sheetNames?:  readonly string[]
}

/** A meaningful refId carries a real prefix — "TBD"/"N/A"/blank do not. */
function usableRefId(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  if (!s || /^(tbd|n\/?a|none|<.*>)$/i.test(s)) return null
  return s
}

/** Infer the line of business from a workbook's OWN content. Strongest signal is the
 *  majority prefix across its refIds; when a source ships no usable refIds (e.g. a
 *  Property ROC with "TBD" step ids) it falls back to product/LOB/sheet-name signals.
 *  Deliberately filename-free: two sources for the same line are named differently, and
 *  the same file name is reused across lines, so the file name is never evidence. */
export function inferLob(signals: LineInferenceSignals): LobDefinition | undefined {
  // 1) Majority refId prefix — the most reliable, content-derived signal.
  const tally = new Map<string, number>()
  for (const raw of signals.refIds ?? []) {
    const lob = lobByPrefix(usableRefId(raw))
    if (lob) tally.set(lob.refId, (tally.get(lob.refId) ?? 0) + 1)
  }
  if (tally.size) {
    let bestRefId = ''; let bestCount = -1
    for (const [refId, count] of tally) if (count > bestCount) { bestCount = count; bestRefId = refId }
    return LOB_REGISTRY[bestRefId]
  }
  // 2) Name / sheet signals (order = registry order; first match wins).
  const hay = [signals.productName, signals.lobName, ...(signals.sheetNames ?? [])]
    .filter(Boolean).join('  ')
  if (hay.trim()) {
    for (const lob of Object.values(LOB_REGISTRY)) {
      if (lob.refIdScheme.nameSignals.some(re => re.test(hay))) return lob
    }
  }
  return undefined
}

/** Mint a refId in a line's exact shape (delegates to its RefIdScheme). The one place
 *  the platform assigns ids to entities a source left blank / "TBD". */
export function synthesizeRefId(
  lob: LobDefinition, kind: RefIdEntityKind, seq: number, parentSeq?: number,
): string {
  return lob.refIdScheme.synthesize(kind, seq, parentSeq)
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
// (Property vs Casualty vs Automobile), and market segment (Personal Lines, …).
// Every facet's *values* are derived from LOB_REGISTRY below — nothing is hard-coded
// in the UI — so registering a new line automatically extends every axis.

/** The identifier of a segmentation axis. `personalOrCommercial` is the two-value
 *  Personal-vs-Commercial grouping (a coarser split than `vertical`'s "…Lines" labels). */
export type SegmentAxisId = 'personalOrCommercial' | 'vertical' | 'family' | 'marketSegment'

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
  personalOrCommercial: 'Personal' | 'Commercial'
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
    { id: 'personalOrCommercial', label: 'Personal / Commercial', values: distinctAcrossRegistry(l => [l.personalOrCommercial]) },
    { id: 'vertical',      label: 'Vertical',        values: distinctAcrossRegistry(l => [l.vertical]) },
    { id: 'family',        label: 'Coverage family', values: distinctAcrossRegistry(l => [l.family]) },
    { id: 'marketSegment', label: 'Market segment',  values: distinctAcrossRegistry(l => l.marketSegments) },
  ]
}

/** The segment tags a product carries, resolved through its line-of-business. */
export function productSegments(product?: { lob?: { refId?: string | null } | null } | null): LineSegments {
  const lob = resolveLob(product)
  return {
    personalOrCommercial: lob.personalOrCommercial,
    vertical: lob.vertical, family: lob.family, marketSegments: lob.marketSegments,
  }
}

/** Whether a product satisfies a segmentation selection. Unset axes are wildcards;
 *  the marketSegment axis matches when the product's line serves that band. */
export function matchesSegments(
  product: { lob?: { refId?: string | null } | null } | null | undefined,
  selection: SegmentSelection,
): boolean {
  const seg = productSegments(product)
  if (selection.personalOrCommercial && seg.personalOrCommercial !== selection.personalOrCommercial) return false
  if (selection.vertical && seg.vertical !== selection.vertical) return false
  if (selection.family && seg.family !== selection.family) return false
  if (selection.marketSegment && !seg.marketSegments.includes(selection.marketSegment)) return false
  return true
}
