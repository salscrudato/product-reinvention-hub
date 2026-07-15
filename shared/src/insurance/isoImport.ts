// isoImport.ts — the pure ISO-workbook → canonical-model mapper. Given plain 2D
// cell grids (produced by the platform reader in app/src/lib/import) it locates the
// known template sheets by name, finds each sheet's header row by content (so it is
// robust to different starting columns / extra columns / re-ordered columns), maps
// column families onto the canonical entities, and returns a fully typed ImportPlan
// plus an ImportSummary (counts, warnings, unmapped columns). It writes nothing —
// persistence is the app's job through adapter.db.mutate(). Zero platform imports.
//
// Every refId, Product Framework ID and form number is preserved verbatim; the only
// transformation on ids is deriving a Firestore-safe docId (dots → dashes) exactly
// as the seed does, so parentId links (which compare against the untouched refId)
// keep resolving. Line-agnostic: the refId prefix (GL, HO, …) resolves the LOB.

import type {
  Status, ReviewStatus, Lifecycle, Requirement, Source,
  FormCategory, DynamicFieldType, RuleCategory, DynamicField,
  RTTable, LDTable, LDRow, RatingStep, CoverageTerm, TermKind,
} from '../types'
import { resolveLobByRefId, DEFAULT_LOB } from './lobRegistry'
import { resolveCoverageHierarchy } from './coverageHierarchy'
import {
  matchCoverageByName, matchRuleReferenceToTables, resolveCoverageCode,
  physicalDamageCoverages, formTokens, FORM_TOKEN,
  type NamedCoverage, type ConceptTable,
} from './conceptMatch'

// ─── Public shapes ─────────────────────────────────────────────────────────────

/** A cell value as read from a workbook. */
export type IsoCell = string | number | boolean | null

/** One worksheet as a row-major grid (0-indexed; missing cells are null). */
export interface IsoGrid {
  sheet:  string
  file?:  string
  cells:  IsoCell[][]
}

/** A single entity ready to be written by the app through mutate(). `data` carries
 *  no timestamps/rev — mutate() stamps those. `docId` is the Firestore doc id. */
export interface PlannedEntity {
  docId:  string
  refId:  string | null
  label:  string
  data:   Record<string, unknown>
}

export interface UnmappedColumns { sheet: string; columns: string[] }

/** A structured defect produced by the deterministic mapper when an enum value is not in
 *  the file's Data Validation vocab and has no canonical target — never silently coerced. */
export interface ReviewDefect {
  code:           'unmapped_enum' | 'forms_applicability_merged'
  field?:         string
  rawValue?:      string
  rowRef?:        string
  mergedForms?:   number
  rowsCollapsed?: number
}

/** A structured notice for aggregated mapper events (e.g. multi-row merge summary). */
export interface ImportNotice {
  code:    string
  message: string
  data?:   Record<string, unknown>
}

/** Column alias / enum overlay produced by a proposeMapping AI call.
 *  Feed back through mapIsoWorkbook(grids, overlay) after the user accepts suggestions.
 *  All fields are additive — absent keys leave the deterministic defaults unchanged. */
export interface AliasOverlay {
  /** Extra header aliases keyed by canonical FW/FORM/RULE/RATE field name. */
  columnAliases?:  Record<string, string[]>
  /** enum override: norm(rawValue) → FormCategory (accepted AI suggestions only). */
  enumOverrides?:  Record<string, FormCategory>
  /** sheet name → role hint (e.g. 'forms', 'rules', 'rating', 'framework'). */
  sheetRoleHints?: Record<string, string>
  /** confidence per proposal key (informational; drives UI chip colour). */
  confidences?:    Record<string, number>
  /** cited cell per proposal key (source of truth for each suggestion). */
  citations?:      Record<string, string>
}

export interface ImportSummary {
  productName:      string | null
  productRefId:     string | null
  lobName:          string | null
  counts:           Record<string, number>
  warnings:         string[]
  unmappedColumns:  UnmappedColumns[]
  sheetsRecognized: string[]
  sheetsSkipped:    string[]
  /** Structured defects: unmapped enums, orphaned refs, etc. */
  defects:          ReviewDefect[]
  /** Aggregated mapper notices (e.g. forms_applicability_merged). */
  notices:          ImportNotice[]
}

export interface ImportPlan {
  productId:      string | null
  /** Backward-compat alias: first entry of products (null when no framework found). */
  product:        PlannedEntity | null
  /** All products detected (>= 1 when a framework sheet is present). */
  products:       PlannedEntity[]
  coverages:      PlannedEntity[]   // parent-before-child order; flat across all products
  forms:          PlannedEntity[]
  rules:          PlannedEntity[]
  formRules:      PlannedEntity[]
  ratingProgram:  PlannedEntity | null
  ldTables:       PlannedEntity[]
  rtTables:       PlannedEntity[]
  summary:        ImportSummary
}

// ─── Cell helpers ──────────────────────────────────────────────────────────────

function text(v: IsoCell): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  return String(v)
}
/** Uppercase, single-spaced form used for enum matching. */
function norm(v: IsoCell): string {
  return text(v).toUpperCase().replace(/\s+/g, ' ').trim()
}
/** Alphanumerics-only form used for header matching — tolerant of the punctuation and
 *  embedded newlines real templates carry (e.g. "SUB-\nCOVERAGE", "MANDATORY/ OPTIONAL"). */
function squishStr(s: string): string { return s.toUpperCase().replace(/[^A-Z0-9]/g, '') }
function squish(v: IsoCell): string { return squishStr(text(v)) }
const PLACEHOLDER = /^<.*>$|^n\/?a$|^not applicable$|^intentionally left blank$/i
function isPlaceholder(s: string): boolean { return s === '' || PLACEHOLDER.test(s) }
function clean(v: IsoCell): string { const s = text(v); return isPlaceholder(s) ? '' : s }

function isX(v: IsoCell): boolean {
  const s = text(v).toUpperCase()
  return s === 'X' || s === '✓' || s === 'YES' || s === 'TRUE'
}
function isYes(v: IsoCell): boolean { return /^(y|yes|true|x)$/i.test(text(v)) }

function parseNum(v: IsoCell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = text(v).replace(/[$,%\s]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Split a multi-value cell (newlines / commas / semicolons), dropping placeholders.
 *  Internal spaces are preserved so form numbers like "CG 21 70" stay intact. */
function splitList(v: IsoCell): string[] {
  return text(v).split(/[\n;,]+/).map(s => s.trim()).filter(s => s && !isPlaceholder(s))
}

// US states + DC + territories — used to detect the per-state applicability columns.
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
  'WV','WI','WY','PR','GU','VI',
])

// ─── Enum mappers (honor the template data-validation vocabularies) ─────────────

function mapStatus(v: IsoCell): Status {
  const s = norm(v)
  if (s.startsWith('INACTIVE')) return 'INACTIVE'
  if (s.startsWith('FUTURE'))   return 'FUTURE'
  return 'ACTIVE'
}
function mapReview(v: IsoCell): ReviewStatus {
  const s = norm(v)
  if (s.startsWith('APPROV'))   return 'APPROVED'
  if (s.startsWith('REJECT'))   return 'REJECTED'
  if (s.startsWith('BUSINESS')) return 'BUSINESS_REVIEW'
  if (s.startsWith('IN PROGRESS') || s.startsWith('INITIAL') || s.startsWith('READY') || s.startsWith('TBD')) return 'IN_PROGRESS'
  return 'NOT_STARTED'
}
// G-D (fabrication-on-silence): a BLANK requirement cell is a fact the source did
// not state — it maps to UNKNOWN (representable since F14), never a silent MANDATORY.
function mapRequirement(v: IsoCell): Requirement {
  const t = text(v)
  if (t === '' || isPlaceholder(t)) return 'UNKNOWN'
  return /optional/i.test(t) ? 'OPTIONAL' : 'MANDATORY'
}
function mapClaimsBasis(v: IsoCell): string {
  const s = text(v)
  if (/claim/i.test(s)) return 'Claims-made'
  if (/occur/i.test(s)) return 'Occurrence'
  return ''
}
function mapSource(bureau: IsoCell, prop: IsoCell): Source {
  if (isYes(bureau)) return 'BUREAU'
  if (isYes(prop))   return 'PROPRIETARY'
  return 'BUREAU'
}
function mapDynType(v: IsoCell): DynamicFieldType {
  const s = norm(v)
  if (s.startsWith('CURRENCY')) return 'CURRENCY'
  if (s.startsWith('DATE'))     return 'DATE'
  if (s.startsWith('LIST'))     return 'LIST'
  if (s.startsWith('PERCENT'))  return 'PERCENT'
  return 'TEXT' // Text / Number / Alphanumeric / Address
}
function mapRuleCategory(v: IsoCell): RuleCategory {
  const s = norm(v)
  if (s.startsWith('RATING')) return 'RATING'
  if (s.startsWith('FORM'))   return 'FORMS'
  return 'PRODUCT'
}
// ─── Form-category canonical crosswalk ──────────────────────────────────────────
// Built from the ISO Data Validation vocab. NEVER silently coerce unknown values to
// ENDORSEMENT — flag them instead so reviewers know to act. The only silent fallback
// is the empty-string case (no value supplied) and carrier-specific labels that are
// clearly endorsement-like (see mapFormCategory for the fallback logic).

const FORM_CATEGORY_CANONICAL: Record<string, FormCategory> = {
  'BASE COVERAGE FORM':          'BASE_COVERAGE',
  'BASE COVERAGE':               'BASE_COVERAGE',
  'DECLARATIONS':                'DECLARATIONS',
  'DECLARATIONS - PRIMARY':      'DECLARATIONS',
  'DECLARATIONS - SUPPLEMENTAL': 'DECLARATIONS',
  'DECLARATIONS PRIMARY':        'DECLARATIONS',
  'DECLARATIONS SUPPLEMENTAL':   'DECLARATIONS',
  'ENDORSEMENT':                 'ENDORSEMENT',
  'ENDORSEMENTS':                'ENDORSEMENT',
  'EXCLUSION':                   'EXCLUSION',
  'EXCLUSIONS':                  'EXCLUSION',
  'SCHEDULE':                    'SCHEDULE',
  'POLICY NOTICE':               'POLICY_NOTICE',
  'POLICY NOTICES':              'POLICY_NOTICE',
  'NOTICE':                      'POLICY_NOTICE',
  'POLICY CONDITIONS':           'POLICY_CONDITIONS',
  'AMENDATORY':                  'AMENDATORY',
  'AMENDATORY ENDORSEMENT':      'ENDORSEMENT',
  'OTHER POLICY DOCUMENTS':      'OTHER',
  'MARKETING MATERIALS':         'MARKETING',
  'MARKETING':                   'MARKETING',
}

// Values that are demonstrably NOT insurance form categories (e.g. classification
// codes from SERFF workflows). These generate a ReviewDefect, never silent coercion.
const FORM_CATEGORY_OUTLIERS = new Set<string>([
  'ISO FILED',
  'POLICY',
])

/** Map a FORM CATEGORY cell to a canonical FormCategory.
 *  Priority: AI overlay > canonical map > specific outliers (defect) > ENDORSEMENT fallback.
 *  Returns category=null for outliers so the caller can surface a ReviewDefect without
 *  writing an invalid category. Fallback to ENDORSEMENT is ONLY for empty cells or
 *  carrier-specific labels not in the outlier set (backward-compat). */
function mapFormCategory(
  v: IsoCell,
  overlay?: AliasOverlay | null,
): { category: FormCategory | null; exact: boolean; outlier: boolean } {
  const s = norm(v)

  // AI overlay: accepted suggestions take top priority
  if (overlay?.enumOverrides) {
    const ov = overlay.enumOverrides[s]
    if (ov) return { category: ov, exact: true, outlier: false }
  }

  // Canonical crosswalk
  if (s in FORM_CATEGORY_CANONICAL) {
    return { category: FORM_CATEGORY_CANONICAL[s]!, exact: true, outlier: false }
  }

  // Specific outlier values — flag as review defect, leave field unset
  if (FORM_CATEGORY_OUTLIERS.has(s)) {
    return { category: null, exact: false, outlier: true }
  }

  // Empty cell: the source did not state a category. The write-fallback stays
  // ENDORSEMENT, but it is a WARNED default now (G-D) — exact:true here used to
  // mint a fabricated value carrying a truth marker, silently.
  if (s === '') return { category: 'ENDORSEMENT', exact: false, outlier: false }

  // Carrier-specific label not in canonical map and not a known outlier:
  // fold onto ENDORSEMENT with a warning (preserves backward compat for values
  // like "Other Coverage Form" that the existing test suite asserts on).
  return { category: 'ENDORSEMENT', exact: false, outlier: false }
}

/** The line prefix (LOB token) of a coverage refId. Tolerant of inconsistent source formatting:
 *  "PR.COV001.0", "PRCOV0010.0" and "GL.COV.001" all yield the leading line code (PR / PR / GL). */
function refIdPrefix(refId: string): string {
  // Separator-agnostic (ledger G-B): "GL.COV.001", "GL-COV-001", "PRCOV0010.0"
  // all yield the leading line code.
  const m = refId.match(/^([A-Za-z]{2,4})[.\-_ ]?(?:COV|PROD|LOB|RAT|RU|FORM)/i)
  if (m) return m[1]!.toUpperCase()
  return (refId.split(/[.\-_\d]/).filter(Boolean)[0] ?? '').toUpperCase()
}
/** Firestore-safe doc id (matches the seed: dots → dashes). */
function dashId(refId: string): string { return refId.replace(/\./g, '-') }
/** Pull an LD/RT table ref out of a free-text "rule reference" cell. */
function extractTableRef(v: IsoCell): string | undefined {
  const m = text(v).match(/\b((?:LD|RT)Table\.\w+)/i)
  return m ? m[1] : undefined
}

// ─── Grid navigation ────────────────────────────────────────────────────────────

function row(grid: IsoGrid, r: number): IsoCell[] { return grid.cells[r] ?? [] }
function cell(grid: IsoGrid, r: number, c: number): IsoCell { return grid.cells[r]?.[c] ?? null }

/** Find the header row: the row (within the first `limit`) matching the most of the
 *  given alias groups. Returns -1 when nothing clears the confidence threshold. */
function findHeaderRow(grid: IsoGrid, aliasGroups: string[][], limit = 20): number {
  const groups = aliasGroups.map(a => a.map(squishStr))
  let best = -1, bestScore = 0
  for (let r = 0; r < Math.min(grid.cells.length, limit); r++) {
    const heads = row(grid, r).map(squish)
    let score = 0
    for (const g of groups) if (heads.some(h => h !== '' && g.includes(h))) score++
    if (score > bestScore) { bestScore = score; best = r }
  }
  return bestScore >= 3 ? best : -1
}

/** Map each field key → the column whose header matches its MOST SPECIFIC alias
 *  (punctuation/whitespace-insensitive). Alias lists are ordered most-specific-first,
 *  and the first ALIAS with a matching column wins — never the first column with any
 *  alias: a bare generic like "ID" must not shadow "PRODUCT FRAMEWORK ID" just by
 *  sitting further left (ledger G-A: Idaho's state column squishes to "ID" and
 *  hijacked the id field whenever the state matrix preceded the id column).
 *  `exclude` removes structurally-identified columns (the state matrix) from
 *  matching entirely — a state-attachment column is never a field column.
 *  A secondary fuzzy word-overlap pass handles novel templates whose header phrasing
 *  isn't in the alias list: if a column header shares at least half its significant
 *  words with an alias, it qualifies. Exact squish matches always win; fuzzy only
 *  fills unmapped keys. */
function mapColumns(header: IsoCell[], fields: Record<string, string[]>, exclude?: ReadonlySet<number>): Record<string, number> {
  const heads = header.map((h, i) => (exclude?.has(i) ? '' : squish(h)))
  const map: Record<string, number> = {}

  // Pass 1 — exact squish match, alias-priority (most specific alias wins).
  for (const [key, aliases] of Object.entries(fields)) {
    for (const alias of aliases) {
      const sq = squishStr(alias)
      const idx = heads.findIndex(h => h !== '' && h === sq)
      if (idx >= 0) { map[key] = idx; break }
    }
  }

  // Pass 2 — fuzzy word-overlap for unmapped keys (tolerates synonym phrasing).
  // Score = (shared significant words) / (words in the shorter of header vs alias).
  // Threshold 0.5 keeps false-positive rate low while catching paraphrase variants.
  const STOP = new Set(['THE','A','AN','OF','OR','AND','TO','IN','IS','FOR','ON','AT','BY'])
  function sigWords(s: string): string[] {
    return s.replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !STOP.has(w))
  }
  for (const [key, aliases] of Object.entries(fields)) {
    if (key in map) continue
    let bestCol = -1, bestScore = 0
    for (let i = 0; i < heads.length; i++) {
      if (!heads[i]) continue
      const hw = sigWords(heads[i]!)
      if (!hw.length) continue
      for (const alias of aliases) {
        const aw = sigWords(squishStr(alias))
        if (!aw.length) continue
        const shared = hw.filter(w => aw.includes(w)).length
        const score = shared / Math.min(hw.length, aw.length)
        if (score > bestScore && score >= 0.5) { bestScore = score; bestCol = i }
      }
    }
    if (bestCol >= 0) map[key] = bestCol
  }

  return map
}

interface StateCol { col: number; code: string }
function stateColumns(header: IsoCell[]): { cols: StateCol[]; allCol: number } {
  const cols: StateCol[] = []
  header.forEach((c, i) => { const h = norm(c); if (US_STATES.has(h)) cols.push({ col: i, code: h }) })
  const allCol = header.findIndex(c => /\bALL( ACTIVE)? STATES\b/.test(norm(c)))
  return { cols, allCol }
}
/** State-named columns that are truly part of an X-marked state MATRIX, by DATA
 *  profile: every non-blank cell below the header is an X mark. A header that merely
 *  COLLIDES with a postal code (the PCM template's id column is literally "ID" —
 *  Idaho) carries real data and must stay matchable as a field column (ledger G-A:
 *  exclusion by header name alone erased the PCM id column and every IM/PR coverage
 *  with it — caught by the golden diff, not the circular regen). */
function stateMatrixExclusions(grid: IsoGrid, hr: number, sc: { cols: StateCol[]; allCol: number }): Set<number> {
  const out = new Set<number>()
  const limit = Math.min(grid.cells.length, hr + 1 + 400)
  for (const s of sc.cols) {
    let matrix = true
    for (let r = hr + 1; r < limit; r++) {
      const v = text((grid.cells[r] ?? [])[s.col] ?? null)
      if (v !== '' && !isX(v)) { matrix = false; break }
    }
    if (matrix) out.add(s.col)
  }
  if (sc.allCol >= 0) out.add(sc.allCol)
  return out
}
function stateScope(r: IsoCell[], sc: { cols: StateCol[]; allCol: number }): { allStates: boolean; states: string[] } {
  if (sc.allCol >= 0 && isX(r[sc.allCol] ?? null)) return { allStates: true, states: [] }
  // Sorted: state applicability is a SET — its serialization must not depend on
  // the source's column order (ledger G-A: a permuted state matrix reversed it).
  const states = sc.cols.filter(s => isX(r[s.col] ?? null)).map(s => s.code).sort()
  return states.length ? { allStates: false, states } : { allStates: true, states: [] }
}

/** Fill blanks with the previous non-blank value — reconstructs merged group labels
 *  (e.g. "COVERAGE PART", "TRANSACTIONS") that only populate their first column. */
function fillForward(r: IsoCell[]): string[] {
  const out: string[] = []
  let last = ''
  for (let i = 0; i < r.length; i++) { const t = text(r[i]); if (t) last = t; out[i] = last }
  return out
}

/** Columns whose (filled-forward) section label matches `re`, with their own header
 *  names — used to read the X-marked coverage-part / transaction membership columns. */
function groupColumns(section: string[], header: IsoCell[], re: RegExp): { col: number; name: string }[] {
  const out: { col: number; name: string }[] = []
  header.forEach((c, i) => { const name = clean(c); if (name && re.test(section[i] ?? '')) out.push({ col: i, name }) })
  return out
}

// ─── Sheet resolution (line-agnostic name matching) ─────────────────────────────

const IGNORE_SHEET = /revision history|definition|data validation|categories/i
// Sheets that look like templates but carry no authoritative data: architect copies,
// before-50-states snapshots, scratch tabs, question helpers, and review-only sheets.
const DECOY_SHEET = /(_|\b)arch\b|before\s*50|scratch|question|review$/i
// Trailing version suffix like " (2)" or "  (3)" marks a copy, never the source.
const VERSION_SUFFIX = /\s*\(\s*\d+\s*\)\s*$/

// Count rows that contain at least one real refId (carrier.token.digits pattern).
// Used to score competing framework-sheet candidates.
const REAL_REF_ID = /^[A-Z][A-Z0-9]*\.[A-Z]{2,6}\.\d/i
function countRefIdRows(grid: IsoGrid): number {
  let n = 0
  for (const r of grid.cells) {
    if (r.some(c => typeof c === 'string' && REAL_REF_ID.test(c.trim()))) n++
  }
  return n
}

// Authoritative framework-sheet selector. Broader than the former product-framework-only
// regex so "Core Framework" is a candidate alongside "GL Product Framework". Decoys and
// version copies are excluded first; then the candidate with the most real-refId rows wins.
// Ties are warned with code ambiguous_sheet and the first candidate is returned.
function selectFrameworkSheet(grids: IsoGrid[], ctx: Ctx): IsoGrid | undefined {
  const FW_RE = /framework|product component model|component model/i
  const candidates = grids.filter(g =>
    FW_RE.test(g.sheet) &&
    !IGNORE_SHEET.test(g.sheet) &&
    !DECOY_SHEET.test(g.sheet) &&
    !VERSION_SUFFIX.test(g.sheet)
  )
  if (!candidates.length) return undefined
  if (candidates.length === 1) return candidates[0]
  let best = candidates[0]!
  let bestScore = countRefIdRows(best)
  for (let i = 1; i < candidates.length; i++) {
    const score = countRefIdRows(candidates[i]!)
    if (score > bestScore) { best = candidates[i]!; bestScore = score }
    else if (score === bestScore) {
      ctx.warnOnce('ambiguous_sheet', `Ambiguous framework sheet: "${best.sheet}" and "${candidates[i]!.sheet}" have equal refId scores (${bestScore}). Using "${best.sheet}".`)
    }
  }
  return best
}

function findSheet(grids: IsoGrid[], re: RegExp, exclude?: RegExp): IsoGrid | undefined {
  return grids.find(g =>
    re.test(g.sheet) &&
    !IGNORE_SHEET.test(g.sheet) &&
    !DECOY_SHEET.test(g.sheet) &&
    !VERSION_SUFFIX.test(g.sheet) &&
    (!exclude || !exclude.test(g.sheet))
  )
}

// ─── Summary accumulator ─────────────────────────────────────────────────────────

class Ctx {
  warnings:   string[] = []
  unmapped:   UnmappedColumns[] = []
  recognized: string[] = []
  defects:    ReviewDefect[] = []
  notices:    ImportNotice[] = []
  private warned = new Set<string>()
  /** De-duplicated warning (keeps the summary readable when a value recurs on 100s of rows). */
  warnOnce(key: string, msg: string): void { if (!this.warned.has(key)) { this.warned.add(key); this.warnings.push(msg) } }
  warn(msg: string): void { this.warnings.push(msg) }
  addDefect(d: ReviewDefect): void { this.defects.push(d) }
  addNotice(n: ImportNotice): void { this.notices.push(n) }
  recordUnmapped(sheet: string, header: IsoCell[], handled: Set<number>): void {
    const labels: string[] = []
    header.forEach((c, i) => {
      const name = clean(c)
      if (name && !handled.has(i) && !US_STATES.has(norm(c)) && !labels.includes(name)) labels.push(name)
    })
    if (labels.length) this.unmapped.push({ sheet, columns: labels.slice(0, 24) })
  }
}

// ─── Framework → product + coverages ────────────────────────────────────────────

// Field aliases span the ISO template ("PRODUCT FRAMEWORK ID", "BUREAU"/"PROPRIETARY"), the
// Sample Mutual "Product Component Model" template ("ID", "RATING BUREAU?", "SUB COVERAGE"), and
// any novel template a carrier might produce. Matching is punctuation/whitespace-insensitive
// via squishStr(), and a fuzzy word-overlap pass in mapColumns() catches further paraphrases.
const FW_FIELDS: Record<string, string[]> = {
  status:      ['STATUS', 'ACTIVE STATUS', 'ITEM STATUS', 'ROW STATUS'],
  id:          ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID', 'ID', 'REFERENCE ID', 'REF ID',
                 'ITEM ID', 'COMPONENT ID', 'COVERAGE ID', 'COV ID'],
  product:     ['PRODUCT', 'PRODUCT NAME', 'PROGRAM', 'POLICY PROGRAM', 'PRODUCT LINE'],
  lob:         ['LINE OF BUSINESS', 'LOB', 'LINE', 'BUSINESS LINE', 'COVERAGE LINE',
                 'POLICY TYPE', 'COVERAGE TYPE'],
  coverage:    ['COVERAGE', 'COVERAGE NAME', 'COVERAGE DESCRIPTION', 'PERIL',
                 'BENEFIT', 'INSURING AGREEMENT', 'RISK ITEM'],
  subCoverage: ['SUB-COVERAGE', 'SUB COVERAGE', 'SUBCOVERAGE', 'SUB-PERIL', 'SUB PERIL',
                 'COVERAGE OPTION', 'OPTION', 'SUBLIMIT ITEM', 'COVERAGE PART', 'ADDITIONAL COVERAGE',
                 'COVERAGE DETAIL', 'COVERAGE SPECIFICATION', 'SPECIFICATION', 'COMPONENT DETAIL',
                 'DETAIL', 'ITEM DETAIL', 'COVERAGE COMPONENT', 'ATTRIBUTE'],
  forms:       ['FORM NUMBER(S)', 'FORM NUMBER', 'FORM NUMBERS', 'ASSOCIATED FORMS',
                 'POLICY FORM', 'FORM NO'],
  edition:     ['EDITION DATE', 'EFFECTIVE DATE', 'FORM EDITION'],
  claimsBasis: ['CLAIMS BASIS', 'TRIGGER', 'LOSS TRIGGER', 'REPORTING BASIS'],
  requirement: ['COVERAGE REQUIREMENT', 'REQUIREMENT', 'MANDATORY/ OPTIONAL', 'MANDATORY / OPTIONAL',
                 'REQUIRED/OPTIONAL', 'MANDATORY OR OPTIONAL', 'OPTIONAL OR MANDATORY'],
  premiumGen:  ['PREMIUM GENERATING', 'PREMIUM GENERATING?', 'GENERATES PREMIUM',
                 'RATING', 'RATED', 'PREMIUM BEARING'],
  bureau:      ['BUREAU', 'RATING BUREAU', 'RATING BUREAU?', 'ISO', 'BUREAU FORM',
                 'FILED', 'BUREAU FILED'],
  proprietary: ['PROPRIETARY', 'PROPRIETARY?', 'CARRIER PROPRIETARY', 'NON-BUREAU',
                 'COMPANY SPECIFIC', 'CARRIER SPECIFIC'],
  review:      ['REVIEW STATUS', 'REVIEW', 'STATUS (REVIEW)', 'APPROVAL STATUS',
                 'CLIENT REVIEW STATUS'],
}

interface FrameworkResult {
  productRefId: string | null
  productName:  string
  lobRefId:     string | null
  lobName:      string
  coverages:    PlannedEntity[]
  productScope: { allStates: boolean; states: string[] }
}

interface CoverageDraft {
  refId: string
  coverageName: string
  subCoverageName: string
  rowIndex: number
  cells: IsoCell[]
  scope: { allStates: boolean; states: string[] }
  /** PRODUCT column value for this row — used to assign coverages in multi-product workbooks. */
  productHint: string
}

/** Build a sorted, depth-ordered, orphan-repaired coverage list from resolved items.
 *  Shared by both single- and multi-product paths. */
function finalizeCoverages(
  resolved: ReturnType<typeof resolveCoverageHierarchy>,
  draftByRefId: Map<string, CoverageDraft>,
  at: (cells: IsoCell[], k: string) => IsoCell | null,
  sheetName: string,
  ctx: Ctx,
): PlannedEntity[] {
  for (const rc of resolved) {
    if (rc.parentSignal === 'orphan-promoted') {
      ctx.warn(`Sheet "${sheetName}" coverage ${rc.refId} ("${rc.name}"): named a sub-coverage but no parent coverage was found — imported as a top-level coverage.`)
    }
  }
  const coverages: PlannedEntity[] = resolved.map(rc => {
    const draft = draftByRefId.get(rc.refId) as CoverageDraft
    const cells = draft.cells
    return {
      docId: dashId(rc.refId), refId: rc.refId, label: `${rc.refId} — ${rc.name}`,
      data: {
        refId: rc.refId, name: rc.name, parentId: rc.parentRefId, order: rc.order,
        requirement: mapRequirement(at(cells, 'requirement')),
        claimsBasis: mapClaimsBasis(at(cells, 'claimsBasis')),
        premiumGenerating: isYes(at(cells, 'premiumGen')),
        source: mapSource(at(cells, 'bureau'), at(cells, 'proprietary')),
        formNumbers: splitList(at(cells, 'forms')),
        terms: [],
        ...draft.scope,
        status: mapStatus(at(cells, 'status')),
        lifecycle: 'DRAFT' as Lifecycle,
        reviewStatus: mapReview(at(cells, 'review')),
        reviewer: '',
      },
    }
  })
  // Belt-and-braces orphan repair (resolver guarantees it, but belt-and-suspenders is safe).
  const byRefId = new Set(coverages.map(c => c.refId!))
  for (const cov of coverages) {
    const pid = cov.data['parentId'] as string | null
    if (pid && !byRefId.has(pid)) {
      ctx.warn(`Sheet "${sheetName}" coverage ${cov.refId}: parent "${pid}" not found — imported as top-level.`)
      cov.data['parentId'] = null
    }
  }
  // Stable depth-ordered sort (parent before child).
  const depthOf = (refId: string): number => {
    let d = 0; let cur: string | null = refId; const guard = new Set<string>()
    while (cur && !guard.has(cur)) {
      guard.add(cur)
      const c = coverages.find(x => x.refId === cur)
      const pid = c ? (c.data['parentId'] as string | null) : null
      if (!pid) break
      d += 1; cur = pid
    }
    return d
  }
  const depthCache = new Map(coverages.map(c => [c.refId!, depthOf(c.refId!)]))
  coverages.sort((a, b) => (depthCache.get(a.refId!) ?? 0) - (depthCache.get(b.refId!) ?? 0))
  return coverages
}

/** Assign coverages to products:
 *  1. By refId prefix match to the product's refId prefix
 *  2. By PRODUCT column value match to the product's name
 *  3. Residual → first product
 * Returns a Map of productRefId → CoverageDraft[] for that product.
 */
function assignDraftsByProduct(
  drafts: CoverageDraft[],
  products: { refId: string; name: string }[],
): Map<string, CoverageDraft[]> {
  const result = new Map<string, CoverageDraft[]>(products.map(p => [p.refId, []]))
  const prefixMap = new Map(products.map(p => [refIdPrefix(p.refId).toUpperCase(), p.refId]))
  const nameMap   = new Map(products.map(p => [p.name.toUpperCase(), p.refId]))

  for (const draft of drafts) {
    const covPrefix = refIdPrefix(draft.refId).toUpperCase()
    // 1. By refId prefix
    let target = prefixMap.get(covPrefix)
    // 2. By PRODUCT column value
    if (!target && draft.productHint) target = nameMap.get(draft.productHint.toUpperCase())
    // 3. Residual → first product
    if (!target) target = products[0]!.refId
    result.get(target)!.push(draft)
  }
  return result
}

/** Detect if a framework sheet carries genuinely multiple products.
 *  Returns array of FrameworkResult (one per product) — always >= 1 when the sheet
 *  has a recognizable header. Returns null when the sheet cannot be parsed. */
function parseFramework(
  grid: IsoGrid,
  ctx: Ctx,
  overlay?: AliasOverlay | null,
): FrameworkResult[] | null {
  const effectiveFwFields: Record<string, string[]> = overlay?.columnAliases
    ? Object.fromEntries(
        Object.entries(FW_FIELDS).map(([k, v]) => [k, overlay.columnAliases![k] ? [...v, ...overlay.columnAliases![k]!] : v]),
      )
    : FW_FIELDS
  const hr = findHeaderRow(grid, Object.values(effectiveFwFields))
  if (hr < 0) { ctx.warn(`Framework sheet "${grid.sheet}": no recognizable header row — skipped.`); return null }
  ctx.recognized.push(grid.sheet)

  const header = row(grid, hr)
  const sc = stateColumns(header)
  const col = mapColumns(header, effectiveFwFields, stateMatrixExclusions(grid, hr, sc))
  const at = (r: IsoCell[], k: string) => (k in col ? (r[col[k]] ?? null) : null)

  // Ordered map preserving first-occurrence order for display stability.
  const productRows  = new Map<string, { refId: string; name: string }>()
  let lobRefId: string | null = null
  let lobName = ''
  let productNameHint = ''
  let lobNameHint = ''

  const drafts: CoverageDraft[] = []
  const draftByRefId = new Map<string, CoverageDraft>()

  // ── Pass 1: collect all product rows AND coverage drafts ──
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r)
    const id = clean(at(cells, 'id'))
    if (!id) continue
    const covName = clean(at(cells, 'coverage'))
    const subName = clean(at(cells, 'subCoverage'))
    const prod = clean(at(cells, 'product'))
    const lob  = clean(at(cells, 'lob'))

    // Separator-agnostic kind detection (ledger G-B): a source that writes its ids
    // as "GL-PROD-001" is stating the same identity as "GL.PROD.001" — recognition
    // must not hinge on the dot, while the id itself is carried byte-for-byte.
    if (/[.\-_ ](PROD|PRD|PRODUCT)(?:[.\-_ ]|\b)/i.test(id)) {
      // Collect explicit product rows. First-seen per refId wins (deduplicates state-row repeats).
      if (!productRows.has(id)) productRows.set(id, { refId: id, name: prod || '' })
      continue
    }
    if (/[.\-_ ]LOB(?:[.\-_ ]|\b)/i.test(id)) {
      if (!lobRefId) { lobRefId = id; lobName = lob || lobName }
      continue
    }
    if (!covName && !subName) {
      if (!productNameHint && prod) productNameHint = prod
      if (!lobNameHint && lob) lobNameHint = lob
      continue
    }

    if (!productNameHint && prod) productNameHint = prod
    if (!lobNameHint && lob) lobNameHint = lob
    const draft: CoverageDraft = {
      refId: id, coverageName: covName, subCoverageName: subName, rowIndex: r,
      cells, scope: stateScope(cells, sc), productHint: prod,
    }
    drafts.push(draft)
    const prior = draftByRefId.get(id)
    if (!prior) {
      draftByRefId.set(id, draft)
    } else if (prior.coverageName !== covName || prior.subCoverageName !== subName) {
      ctx.warnOnce(`dupcovid:${id}`, `Sheet "${grid.sheet}" col "ID": coverage id ${id} is reused for different coverages ("${prior.coverageName || prior.subCoverageName}" and "${covName || subName}") — kept the first; verify the source.`)
    }
  }

  // ── Determine product list ──
  // Priority 1: explicit PROD|PRD rows in the framework sheet (N products supported).
  // Priority 2: synthesize 1 product from the coverage refId prefix (existing single-product fallback).
  //
  // NOTE: "distinct PRODUCT column values" is intentionally NOT used for product detection —
  // real ISO workbooks put carrier/company names in that column, not product identifiers, so
  // splitting on distinct column values produces spurious products. Explicit PROD rows are the
  // only reliable multi-product signal.
  let productList: { refId: string; name: string }[]

  if (productRows.size > 0) {
    // Group by LOB prefix (the 2-4 letter line code, e.g. 'GL', 'IM', 'CORE').
    // Standard ISO workbooks list subsidiary/variant PROD rows under the same LOB prefix
    // (e.g. GL.PROD.001, GL.PROD.002 for CGL variants) — keep only the FIRST per prefix.
    // Workbooks with distinct LOB prefixes (e.g. GL + IM in one book) get one product per LOB.
    const seenPrefixes = new Map<string, { refId: string; name: string }>()
    for (const pd of productRows.values()) {
      const prefix = refIdPrefix(pd.refId).toUpperCase()
      if (!seenPrefixes.has(prefix)) seenPrefixes.set(prefix, pd)
    }
    productList = [...seenPrefixes.values()]
  } else {
    // Single product — synthesize (existing behavior, code: product_synthesized).
    // F26: the id is MINTED, not read from source — it carries the platform SYNTH
    // marker (same shape the brain path mints for the identical situation,
    // stage7-plan.js), never a byte-shape identical to a real source id.
    // G-C: the derived prefix must be a REGISTRY prefix — a junk id parse must
    // never leak into a minted identity ("GL-COV-.PROD.SYNTH001", "X.PROD.SYNTH001").
    // Unresolvable → the platform default line, WARNED (F18: a defaulted value is
    // always a warned default).
    const derived = drafts.length > 0 ? refIdPrefix(drafts[0]!.refId) : ''
    const lobDef = resolveLobByRefId(`${derived}.LOB.001`)
    const prefix = lobDef?.refIdPrefix ?? DEFAULT_LOB.refIdPrefix
    const synthRefId = `${prefix}.PROD.SYNTH001`
    const synthName  = productNameHint || ''
    if (!lobDef) {
      ctx.warnOnce('product_synth_prefix_defaulted', `Framework sheet "${grid.sheet}": coverage id prefix "${derived}" resolves to no registered line — synthesized product id uses the platform default line "${prefix}" (verify the line); code: product_synth_prefix_defaulted.`)
    }
    ctx.warnOnce('product_synthesized', `Framework sheet "${grid.sheet}": no explicit product (.PROD/.PRD) row — synthesized "${synthRefId}" from coverage id prefix "${prefix}"; code: product_synthesized.`)
    productList = [{ refId: synthRefId, name: synthName }]
  }
  if (!lobName) lobName = lobNameHint

  // ── Pass 2: assign drafts to products + resolve hierarchy per product ──
  const isMulti = productList.length > 1
  const assignedDrafts = isMulti
    ? assignDraftsByProduct(drafts, productList)
    : new Map([[productList[0]!.refId, drafts]])

  // ── Build one FrameworkResult per product ──
  const results: FrameworkResult[] = []
  for (const pd of productList) {
    const myDrafts    = assignedDrafts.get(pd.refId) ?? drafts
    const uniqueDrafts = myDrafts.filter(d => draftByRefId.get(d.refId) === d) // keep first-seen only
    const resolved    = resolveCoverageHierarchy(uniqueDrafts.map(d => ({
      refId: d.refId, coverageName: d.coverageName, subCoverageName: d.subCoverageName, rowIndex: d.rowIndex,
    })))
    const coverages   = finalizeCoverages(resolved, draftByRefId, at, grid.sheet, ctx)

    const scopes      = myDrafts.map(d => d.scope)
    const productScope = scopes.some(s => s.allStates) || scopes.length === 0
      ? { allStates: true, states: [] }
      : { allStates: false, states: [...new Set(scopes.flatMap(s => s.states))].sort() }

    const pName = pd.name || productNameHint
    results.push({ productRefId: pd.refId, productName: pName, lobRefId, lobName, coverages, productScope })
  }

  const handled = new Set(Object.values(col).concat(sc.cols.map(s => s.col), sc.allCol))
  ctx.recordUnmapped(grid.sheet, header, handled)
  return results.length > 0 ? results : null
}

// ─── Forms specifications + dynamic data ─────────────────────────────────────────

const FORM_FIELDS: Record<string, string[]> = {
  ids:         ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID', 'COVERAGE ID', 'COVERAGE REF',
                 'APPLICABLE COVERAGE', 'COVERAGE'],
  name:        ['FORM NAME', 'FORM TITLE', 'DESCRIPTION', 'FORM DESCRIPTION', 'TITLE'],
  number:      ['FORM NUMBER', 'FORM NO', 'FORM NO.', 'POLICY FORM', 'FORM', 'FORM #'],
  edition:     ['FORM EDITION DATE (MM YY)', 'FORM EDITION DATE', 'EDITION DATE',
                 'EDITION', 'EFFECTIVE DATE', 'VERSION DATE'],
  claimsBasis: ['CLAIMS BASIS', 'TRIGGER', 'LOSS TRIGGER'],
  bureau:      ['BUREAU', 'RATING BUREAU', 'ISO', 'FILED', 'BUREAU FILED'],
  proprietary: ['PROPRIETARY', 'CARRIER PROPRIETARY', 'NON-BUREAU', 'COMPANY SPECIFIC'],
  // "ADMITTED/NOT ADMITTED" is the PR/Property template; "FILING STATUS" is a common carrier variant.
  admitted:    ['ADMITTED / NON-ADMITTED', 'ADMITTED/NON-ADMITTED', 'ADMITTED',
                 'ADMITTED/NOT ADMITTED', 'ADMITTED / NOT ADMITTED',
                 'ADMITTED STATUS', 'FILING STATUS', 'ADMITTED NON-ADMITTED'],
  category:    ['FORM CATEGORY', 'CATEGORY', 'TYPE', 'FORM TYPE', 'DOCUMENT TYPE'],
  dynamic:     ['DYNAMIC / STATIC', 'DYNAMIC/STATIC', 'DYNAMIC', 'VARIABLE', 'VARIABLE CONTENT'],
  mandatory:   ['MANDATORY/ OPTIONAL', 'MANDATORY / OPTIONAL', 'MANDATORY/OPTIONAL',
                 'REQUIRED', 'MANDATORY OR OPTIONAL', 'REQUIRED OR OPTIONAL', 'APPLICABILITY'],
  // "ATTACHMENT CONDITIONS" (plural) is the PR/Property template variant.
  attachment:  ['ATTACHMENT CONDITION', 'ATTACHMENT CONDITIONS', 'CONDITION',
                 'WHEN ATTACHED', 'ATTACH WHEN'],
  display:     ['DISPLAY ON FORMS SCHEDULE', 'DISPLAY ON SCHEDULE', 'SCHEDULE DISPLAY',
                 'SHOW ON SCHEDULE', 'PRINT ON SCHEDULE'],
  useCount:    ['SINGLE OR MULTI-USE', 'SINGLE OR MULTI USE', 'USE COUNT', 'USAGE',
                 'SINGLE/MULTI USE'],
  review:      ['REVIEW STATUS', 'REVIEW', 'APPROVAL STATUS', 'CLIENT REVIEW STATUS'],
}

const DYN_FIELDS: Record<string, string[]> = {
  number:    ['FORM NUMBER'],
  fieldName: ['DYNAMIC FIELD NAME', 'FIELD NAME'],
  dataType:  ['DATA TYPE'],
  repeating: ['REPEATING FIELD', 'REPEATING'],
  notes:     ['NOTES'],
}

function parseDynamicFields(grid: IsoGrid | undefined, ctx: Ctx): Record<string, DynamicField[]> {
  const out: Record<string, DynamicField[]> = {}
  if (!grid) return out
  const hr = findHeaderRow(grid, Object.values(DYN_FIELDS))
  if (hr < 0) return out
  ctx.recognized.push(grid.sheet)
  const header = row(grid, hr)
  const col = mapColumns(header, DYN_FIELDS)
  if (!('number' in col) || !('fieldName' in col)) return out
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r)
    const number = clean(cells[col['number']] ?? null)
    const fieldName = clean(cells[col['fieldName']] ?? null)
    if (!number || !fieldName) continue
    const key = number.replace(/\s+/g, '-')
    ;(out[key] ??= []).push({
      name: fieldName,
      dataType: mapDynType('dataType' in col ? (cells[col['dataType']] ?? null) : null),
      repeating: isYes('repeating' in col ? (cells[col['repeating']] ?? null) : null),
      // The ISO GL template carries no LIST-type fields and no options column; a
      // future template that does would map here. Empty ≠ dropped.
      options: [],
      notes: 'notes' in col ? clean(cells[col['notes']] ?? null) || undefined : undefined,
    })
  }
  // Surface columns this sheet carries but the DynamicField model doesn't consume
  // (e.g. effective/expiration date) — same transparency every other parser gives.
  ctx.recordUnmapped(grid.sheet, header, new Set(Object.values(col)))
  return out
}

function parseForms(
  grid: IsoGrid,
  dynByForm: Record<string, DynamicField[]>,
  productRefId: string | null,
  ctx: Ctx,
  overlay?: AliasOverlay | null,
): PlannedEntity[] {
  const effectiveFormFields: Record<string, string[]> = overlay?.columnAliases
    ? Object.fromEntries(
        Object.entries(FORM_FIELDS).map(([k, v]) => [k, overlay.columnAliases![k] ? [...v, ...overlay.columnAliases![k]!] : v]),
      )
    : FORM_FIELDS
  const hr = findHeaderRow(grid, Object.values(effectiveFormFields))
  if (hr < 0) { ctx.warn(`Forms sheet "${grid.sheet}": no recognizable header row — skipped.`); return [] }
  ctx.recognized.push(grid.sheet)
  const header = row(grid, hr)
  const scEarly = stateColumns(header)
  const col = mapColumns(header, effectiveFormFields, stateMatrixExclusions(grid, hr, scEarly))
  if (!('number' in col)) { ctx.warn(`Forms sheet "${grid.sheet}": no Form Number column — skipped.`); return [] }
  const sc = stateColumns(header)
  const section = fillForward(row(grid, hr - 1))
  const partCols = groupColumns(section, header, /COVERAGE PART/i)
  const txnCols = groupColumns(section, header, /TRANSACTION/i)
  const at = (r: IsoCell[], k: string) => (k in col ? (r[col[k]] ?? null) : null)

  const byKey = new Map<string, PlannedEntity>()
  // Form-merge tracking: dedupe notices down to one per sheet
  let dupFormRows = 0
  const mergedFormKeys = new Set<string>()

  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r)
    const number = clean(at(cells, 'number'))
    if (!number || /^form number/i.test(number)) continue
    // Form identity is (number, edition) — first principles §5.2 / ledger F12.
    // Same number + same edition on multiple rows = a state/coverage variant
    // (applicability union below); a DIFFERENT edition is a legally distinct
    // document and gets its own entity. Jurisdiction stays attachment scope
    // (states/allStates), never part of the key. Blank edition degrades to the
    // number-only key — never a trailing separator.
    const numKey  = number.replace(/\s+/g, '-')
    const edition = clean(at(cells, 'edition'))
    const key = edition ? `${numKey}__${edition.replace(/\s+/g, '-')}` : numKey
    const scope = stateScope(cells, sc)
    // Sorted: X-marked group membership is a SET — serialization must not depend
    // on the source's column order (ledger G-A, same rule as stateScope).
    const coverageParts = partCols.filter(p => isX(cells[p.col] ?? null)).map(p => p.name).sort()
    const transactions = txnCols.filter(t => isX(cells[t.col] ?? null)).map(t => t.name).sort()

    const existing = byKey.get(key)
    if (existing) {
      // Same form number on multiple rows (state/coverage variant) — union sets.
      const d = existing.data
      const uni = (a: unknown, b: string[]) => [...new Set([...(a as string[]), ...b])]
      d['coverageParts'] = uni(d['coverageParts'], coverageParts)
      d['transactions']  = uni(d['transactions'], transactions)
      if (!(d['allStates'] as boolean)) {
        if (scope.allStates) { d['allStates'] = true; d['states'] = [] }
        else d['states'] = uni(d['states'], scope.states)
      }
      // Keep per-form warning in warnings (test backward-compat: "appears on multiple rows").
      ctx.warnOnce(`dupform:${key}`, `Sheet "${grid.sheet}" row ${r + 1} col "FORM NUMBER": form ${number} appears on multiple rows — applicability merged.`)
      dupFormRows++
      mergedFormKeys.add(key)
      continue
    }

    // Enum crosswalk — flag-not-guess for outlier values; warn (not defect) for
    // carrier-specific unknowns that fold onto ENDORSEMENT for backward compat.
    const cat = mapFormCategory(at(cells, 'category'), overlay)
    if (cat.outlier) {
      ctx.addDefect({
        code:     'unmapped_enum',
        field:    'category',
        rawValue: clean(at(cells, 'category')),
        rowRef:   `${grid.sheet} row ${r + 1}`,
      })
    } else if (!cat.exact) {
      if (clean(at(cells, 'category')) === '') {
        ctx.warnOnce(
          `formcat:blank:${grid.sheet}`,
          `Sheet "${grid.sheet}": blank FORM CATEGORY cell(s) — defaulted to ENDORSEMENT (the source did not state a category); verify intent.`,
        )
      } else {
        ctx.warnOnce(
          `formcat:${norm(at(cells, 'category'))}`,
          `Sheet "${grid.sheet}" row ${r + 1} col "FORM CATEGORY": value "${clean(at(cells, 'category'))}" not recognised — mapped to ENDORSEMENT, verify intent.`,
        )
      }
    }

    // G-D: blank boolean cells are unstated facts — the documented defaults still
    // apply (mandatory=false, dynamic=false, admitted=true) but always WARNED,
    // never silent. Only cells whose COLUMN exists count (an absent column is a
    // template shape, not a silent cell).
    for (const [fieldKey, label] of [['mandatory', 'MANDATORY/ OPTIONAL'], ['dynamic', 'DYNAMIC / STATIC'], ['admitted', 'ADMITTED / NON-ADMITTED']] as const) {
      if (fieldKey in col && clean(at(cells, fieldKey)) === '') {
        ctx.warnOnce(
          `formblank:${fieldKey}:${grid.sheet}`,
          `Sheet "${grid.sheet}": blank ${label} cell(s) — defaulted (${fieldKey === 'admitted' ? 'admitted=true' : `${fieldKey}=false`}); the source did not state them.`,
        )
      }
    }

    byKey.set(key, {
      docId: key, refId: null, label: `${number} — ${clean(at(cells, 'name'))}`,
      data: {
        number, name: clean(at(cells, 'name')),
        edition,
        // Outlier → write ENDORSEMENT as safe write-fallback (defect surfaced above).
        category: cat.category ?? 'ENDORSEMENT',
        claimsBasis: mapClaimsBasis(at(cells, 'claimsBasis')),
        dynamic: /dynamic/i.test(text(at(cells, 'dynamic'))),
        mandatoryDefault: /mandat/i.test(text(at(cells, 'mandatory'))),
        attachmentCondition: /rule/i.test(text(at(cells, 'attachment'))) ? 'RULE' : 'NONE',
        source: mapSource(at(cells, 'bureau'), at(cells, 'proprietary')),
        admitted: !/non-admitted/i.test(text(at(cells, 'admitted'))),
        displayOnSchedule: isYes(at(cells, 'display')),
        multiUse: /multi/i.test(text(at(cells, 'useCount'))),
        transactions, coverageParts,
        productRefIds: productRefId ? [productRefId] : [],
        description: '',
        // The Dynamic Data sheet carries no edition column — its rows apply to
        // every edition of the number, so the lookup stays number-keyed.
        dynamicFields: dynByForm[numKey] ?? [],
        ...scope,
        status: 'ACTIVE' as Status,
        lifecycle: 'DRAFT' as Lifecycle,
        reviewStatus: mapReview(at(cells, 'review')),
        reviewer: '',
      },
    })
  }

  // Single aggregated notice for all form-applicability merges this sheet.
  if (mergedFormKeys.size > 0) {
    ctx.addNotice({
      code:    'forms_applicability_merged',
      message: `${mergedFormKeys.size} form number(s) appeared on multiple rows; state applicability, coverage parts, and transaction columns merged into single entities (${dupFormRows} extra rows collapsed).`,
      data:    { mergedForms: mergedFormKeys.size, rowsCollapsed: dupFormRows },
    })
  }

  const handled = new Set(Object.values(col).concat(
    sc.cols.map(s => s.col), sc.allCol, partCols.map(p => p.col), txnCols.map(t => t.col),
  ))
  ctx.recordUnmapped(grid.sheet, header, handled)
  return [...byKey.values()]
}

// ─── Rules specifications ────────────────────────────────────────────────────────

const RULE_FIELDS: Record<string, string[]> = {
  status:      ['STATUS', 'ACTIVE STATUS', 'RULE STATUS'],
  ids:         ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID', 'COVERAGE ID', 'COVERAGE REF', 'COVERAGE'],
  id:          ['RULE ID', 'ID', 'RULE NO', 'RULE NO.', 'RULE #', 'RULE NUMBER', 'ITEM ID'],
  category:    ['RULE CATEGORY', 'CATEGORY', 'TYPE', 'RULE TYPE', 'RULE CLASS'],
  subCategory: ['RULE SUB-CATEGORY', 'RULE SUB CATEGORY', 'SUB CATEGORY', 'SUB-CATEGORY',
                 'SUBCATEGORY', 'TOPIC', 'SUBJECT', 'RULE TOPIC'],
  forms:       ['FORM NUMBER', 'FORM NUMBER(S)', 'ASSOCIATED FORM', 'APPLICABLE FORM',
                 'FORM REFERENCE', 'RELATED FORM'],
  condition:   ['RULE CONDITION', 'CONDITION', 'WHEN', 'APPLICABILITY', 'TRIGGER',
                 'IF', 'CRITERIA', 'RULE CRITERIA', 'ELIGIBILITY'],
  outcome:     ['RULE OUTCOME', 'OUTCOME', 'RESULT', 'EFFECT', 'THEN', 'APPLIES',
                 'ACTION', 'RULE ACTION', 'APPLIES TO'],
  reference:   ['RULE REFERENCE', 'REFERENCE', 'TABLE REF', 'LD TABLE', 'SEE ALSO',
                 'RATE TABLE', 'FACTOR TABLE', 'NOTES'],
  review:      ['REVIEW STATUS (CLIENT TEAM)', 'REVIEW STATUS', 'REVIEW',
                 'APPROVAL STATUS', 'CLIENT REVIEW STATUS'],
}

function parseRules(grid: IsoGrid, ctx: Ctx): PlannedEntity[] {
  const hr = findHeaderRow(grid, Object.values(RULE_FIELDS))
  if (hr < 0) { ctx.warn(`Rules sheet "${grid.sheet}": no recognizable header row — skipped.`); return [] }
  ctx.recognized.push(grid.sheet)
  const header = row(grid, hr)
  const scEarly = stateColumns(header)
  const col = mapColumns(header, RULE_FIELDS, stateMatrixExclusions(grid, hr, scEarly))
  if (!('id' in col)) { ctx.warn(`Rules sheet "${grid.sheet}": no Rule ID column — skipped.`); return [] }
  const sc = stateColumns(header)
  const at = (r: IsoCell[], k: string) => (k in col ? (r[col[k]] ?? null) : null)

  const byId = new Map<string, PlannedEntity>()
  let synthSeq = 0
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r)
    let id = clean(at(cells, 'id'))
    if (!id) {
      // Some workbooks (e.g. the Hagerty CORE spec) declare a RULE ID column but never
      // populate it — every rule is instead identified by its framework id + category +
      // condition/outcome. Rather than drop all of them (parseRules would return 0),
      // synthesize a stable id from the framework/coverage id and a running sequence,
      // but ONLY for rows that actually carry rule content (a category, sub-category,
      // condition or outcome). Blank/spacer rows are still skipped. The minted id
      // carries the platform SYNTH marker (F25) — it is NOT a source identifier and
      // must never read as one.
      const hasContent = !!(clean(at(cells, 'category')) || clean(at(cells, 'subCategory')) ||
        clean(at(cells, 'condition')) || clean(at(cells, 'outcome')))
      if (!hasContent) continue
      synthSeq += 1
      const fwBase = (clean(at(cells, 'ids')) || 'RULE').split(/[\s,;]+/)[0]
      id = `${fwBase}.RULE.SYNTH${String(synthSeq).padStart(3, '0')}`
    }
    const forms = splitList(at(cells, 'forms'))
    const existing = byId.get(id)
    if (existing) {
      existing.data['formNumbers'] = [...new Set([...(existing.data['formNumbers'] as string[]), ...forms])]
      ctx.warnOnce(`duprule:${id}`, `Sheet "${grid.sheet}" row ${r + 1} col "RULE ID": rule ${id} appears on multiple rows — form numbers merged.`)
      continue
    }
    byId.set(id, {
      docId: dashId(id), refId: id, label: `${id} — ${clean(at(cells, 'subCategory'))}`,
      data: {
        refId: id,
        category: mapRuleCategory(at(cells, 'category')),
        subCategory: clean(at(cells, 'subCategory')),
        condition: clean(at(cells, 'condition')),
        outcome: clean(at(cells, 'outcome')),
        ldTableRef: extractTableRef(at(cells, 'reference')),
        // The raw reference cell, kept only when a table ref was extracted: real
        // workbooks carry stale numeric refs ("Policy Deductible Type (LDTable.122)"
        // where the parsed table is LDTABLE.119) — the same cell's NAME is the
        // authoritative recovery channel for the term fold (PCM-A).
        ldTableRefText: extractTableRef(at(cells, 'reference')) ? clean(at(cells, 'reference')) : undefined,
        // TRANSIENT: the raw RULE REFERENCE text, consumed + deleted by linkReferenceTables
        // (concept rule→table matching, D2). Never reaches a plan/golden — so GL/IM/PR rules
        // stay byte-identical whether or not their reference is a concept name.
        _referenceText: clean(at(cells, 'reference')) || undefined,
        coverageRefIds: splitList(at(cells, 'ids')),
        formNumbers: forms,
        ...stateScope(cells, sc),
        status: mapStatus(at(cells, 'status')),
        lifecycle: 'DRAFT' as Lifecycle,
        reviewStatus: mapReview(at(cells, 'review')),
        reviewer: '',
      },
    })
  }
  const handled = new Set(Object.values(col).concat(sc.cols.map(s => s.col), sc.allCol))
  ctx.recordUnmapped(grid.sheet, header, handled)
  return [...byId.values()]
}

// ─── Optional forms rules → formRules ────────────────────────────────────────────

const FORMRULE_FIELDS: Record<string, string[]> = {
  id:        ['FORM RULE ID', 'RULE ID'],
  forms:     ['FORM NUMBER', 'FORM NUMBER(S)'],
  condition: ['RULE CONDITION'],
  outcome:   ['RULE OUTCOME'],
  review:    ['REVIEW STATUS (<CLIENT NAME>)', 'REVIEW STATUS'],
}

function parseFormRules(grid: IsoGrid, ctx: Ctx): PlannedEntity[] {
  const hr = findHeaderRow(grid, Object.values(FORMRULE_FIELDS))
  if (hr < 0) { ctx.warn(`Optional forms rules sheet "${grid.sheet}": no recognizable header row — skipped.`); return [] }
  ctx.recognized.push(grid.sheet)
  const header = row(grid, hr)
  const col = mapColumns(header, FORMRULE_FIELDS)
  if (!('id' in col)) { ctx.warn(`Optional forms rules sheet "${grid.sheet}": no Form Rule ID column — skipped.`); return [] }
  const at = (r: IsoCell[], k: string) => (k in col ? (r[col[k]] ?? null) : null)

  const byId = new Map<string, PlannedEntity>()
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r)
    const id = clean(at(cells, 'id'))
    if (!id) continue
    const forms = splitList(at(cells, 'forms'))
    const outcome = clean(at(cells, 'outcome'))
    const existing = byId.get(id)
    if (existing) {
      existing.data['formNumbers'] = [...new Set([...(existing.data['formNumbers'] as string[]), ...forms])]
      ctx.warnOnce(`dupformrule:${id}`, `Sheet "${grid.sheet}" row ${r + 1} col "FORM RULE ID": form rule ${id} appears on multiple rows — form numbers merged.`)
      continue
    }
    byId.set(id, {
      docId: dashId(id), refId: id, label: `${id} — ${clean(at(cells, 'condition')).slice(0, 40)}`,
      data: {
        refId: id,
        condition: clean(at(cells, 'condition')),
        outcome,
        formNumbers: forms,
        mandatory: /mandat/i.test(outcome),
        status: 'ACTIVE' as Status,
        lifecycle: 'DRAFT' as Lifecycle,
        reviewStatus: mapReview(at(cells, 'review')),
        reviewer: '',
      },
    })
  }
  const handled = new Set(Object.values(col))
  ctx.recordUnmapped(grid.sheet, header, handled)
  return [...byId.values()]
}

// ─── Stacked LD tables ───────────────────────────────────────────────────────────
// Two known marker styles:
//   GL template:  "LDTable.001" in col 0  — norm → "LDTABLE.001"  → GL pattern
//   IM/component: "LD001" in col 1         — norm → "LD001"        → IM pattern
// The combined LD_MARKER covers both; markerCol is auto-detected per grid.

// ─── LD term fold (ledger PCM-A) ─────────────────────────────────────────────────
// The canonical model defines coverage.terms as "assembled from the coverage row
// plus the LD tables and rules that reference it" (canonicalMap) — a coverage
// without limits/deductibles is not a coverage (first principles §2.1). Two
// source-evidenced association channels:
//   1. rules join — rule.ldTableRef + rule.coverageRefIds (the GL convention).
//      Only LDTable.* refs qualify: extractTableRef also matches RTTable.*,
//      which are RATING tables, never coverage terms.
//   2. name join — an LD table no rule consumed, whose name equals a coverage
//      name modulo a trailing "Coverage" token (the IM convention: LD blocks are
//      named after coverages and IM rules carry no LDTable refs). Exact,
//      unambiguous matches only.
// Attachment is additive: unmatched tables stay in plan.ldTables untouched, and
// term.ldTableRef keeps the table's VERBATIM refId (= its doc id) so the UI's
// ldTables lookup resolves.
function foldLdTermsIntoCoverages(coverages: PlannedEntity[], rules: PlannedEntity[], ldTables: PlannedEntity[], ctx: Ctx): void {
  if (coverages.length === 0 || ldTables.length === 0) return
  const covByRefId = new Map(coverages.map(c => [c.refId as string, c]))
  const tableByRefId = new Map(ldTables.map(t => [t.refId as string, t]))
  const foldKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/\bcoverage\b/g, '').replace(/[^a-z0-9]+/g, '')
  const tablesByNameKey = new Map<string, PlannedEntity[]>()
  for (const t of ldTables) {
    const k = foldKey((t.data as unknown as LDTable).name)
    if (!k) continue
    const list = tablesByNameKey.get(k) ?? []
    list.push(t)
    tablesByNameKey.set(k, list)
  }
  const attached = new Set<string>()       // `${coverageRefId}|${tableRefId}` — dedupes multi-rule citations
  const consumedTables = new Set<string>()
  let unknownCoverageRefs = 0
  let danglingTableRefs = 0
  let recoveredStaleRefs = 0

  // A term is emitted ONLY for a table that actually parsed — a citation to a
  // nonexistent table must never mint a phantom term (fabricated default 0,
  // refId-as-label, a ldTableRef the UI cannot resolve).
  const attach = (cov: PlannedEntity, tableEntity: PlannedEntity, evidence: string) => {
    const tableRefId = tableEntity.refId as string
    const dedupeKey = `${cov.refId}|${tableRefId}`
    if (attached.has(dedupeKey)) return
    attached.add(dedupeKey)
    consumedTables.add(tableRefId)
    const table = tableEntity.data as unknown as LDTable
    // Term kind from source evidence only: the table's name, its value-column
    // header, and the citing rule's own words. Neither limit nor deductible → OPTION.
    const hay = `${table.name ?? ''} ${table.valueHeader ?? ''} ${evidence}`
    const kind: TermKind = /deductible/i.test(hay) ? 'DEDUCTIBLE' : /limit/i.test(hay) ? 'LIMIT' : 'OPTION'
    const term: CoverageTerm = {
      id: tableRefId.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      kind,
      label: (table.name && String(table.name)) || tableRefId,
      ldTableRef: tableRefId,
      // Default precedence: the row the source marks "Default", else the first
      // available value (the same fallback the UI's resolveTermOptions applies).
      default: table.defaultValue ?? table.rows?.[0]?.value ?? 0,
      basis: '',
    }
    ;(cov.data['terms'] as CoverageTerm[]).push(term)
  }

  // Pass 1 — rules join. Resolve the cited table by refId; on a stale numeric ref
  // ("Policy Deductible Type (LDTable.122)" where the parsed table is LDTABLE.119),
  // recover via the NAME the same reference cell carries — source-defined, exact,
  // unambiguous. Unresolvable refs are counted, never guessed into terms.
  for (const rule of rules) {
    const ref = rule.data['ldTableRef']
    if (typeof ref !== 'string' || !/^LD ?TABLE\./i.test(ref)) continue
    let tableEntity = tableByRefId.get(ref)
    if (!tableEntity) {
      const cellText = String(rule.data['ldTableRefText'] ?? '')
      const nameKey = foldKey(cellText.replace(/\([^)]*\)/g, ' '))
      const matches = nameKey ? (tablesByNameKey.get(nameKey) ?? []) : []
      if (matches.length === 1) {
        tableEntity = matches[0]!
        recoveredStaleRefs++
      } else {
        danglingTableRefs++
        continue
      }
    }
    const covRefIds = Array.isArray(rule.data['coverageRefIds']) ? (rule.data['coverageRefIds'] as string[]) : []
    for (const covRefId of covRefIds) {
      const cov = covByRefId.get(covRefId)
      if (!cov) { unknownCoverageRefs++; continue }
      attach(cov, tableEntity, `${String(rule.data['outcome'] ?? '')} ${String(rule.data['subCategory'] ?? '')}`)
    }
  }

  // Pass 2 — name join for tables no rule consumed.
  const covByName = new Map<string, PlannedEntity[]>()
  for (const c of coverages) {
    const k = foldKey(c.data['name'])
    if (!k) continue
    const list = covByName.get(k) ?? []
    list.push(c)
    covByName.set(k, list)
  }
  for (const t of ldTables) {
    const refId = t.refId as string
    if (consumedTables.has(refId)) continue
    const k = foldKey((t.data as unknown as LDTable).name)
    if (!k) continue
    const matches = covByName.get(k)
    if (!matches || matches.length !== 1) continue   // exact + unambiguous only — never guess
    attach(matches[0]!, t, '')
  }

  if (attached.size > 0 || unknownCoverageRefs > 0 || danglingTableRefs > 0) {
    const unattachedCount = ldTables.filter(t => !consumedTables.has(t.refId as string)).length
    ctx.addNotice({
      code: 'ld_terms_folded',
      message: `${attached.size} coverage term(s) assembled from ${consumedTables.size} LD table(s); ${unattachedCount} table(s) unattached`
        + `${recoveredStaleRefs ? `; ${recoveredStaleRefs} stale table ref(s) recovered by name` : ''}`
        + `${danglingTableRefs ? `; ${danglingTableRefs} table ref(s) resolve to no parsed table (no term emitted)` : ''}`
        + `${unknownCoverageRefs ? `; ${unknownCoverageRefs} rule coverage ref(s) not in this workbook` : ''}.`,
      data: { termsAttached: attached.size, tablesConsumed: consumedTables.size, tablesUnattached: unattachedCount, recoveredStaleRefs, danglingTableRefs, unknownCoverageRefs },
    })
  }
}

const LD_MARKER_GL = /^LD ?TABLE\.\s*\w+/i   // GL: "LDTable.001", "LD TABLE. 001"
const LD_MARKER_IM = /^LD\d+$/i              // IM: "LD001", "LD002"
const LD_MARKER    = /^LD ?TABLE\.\s*\w+|^LD\d+$/i  // combined — used for loop-break tests

function parseLdTables(grid: IsoGrid | undefined, ctx: Ctx): PlannedEntity[] {
  if (!grid) return []
  ctx.recognized.push(grid.sheet)
  const tables = new Map<string, { name: string; rows: { label: string; value: number; constraintNote?: string }[]; defaultValue?: number; valueHeader?: string }>()
  const rows = grid.cells

  // Detect which column holds the LD markers. GL puts them at col 0; the IM/component-model
  // template shifts the table block one column right (col 1), leaving col 0 empty.
  let markerCol = 0
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    if (LD_MARKER_GL.test(norm(cell(grid, r, 0)))) break               // GL pattern found at col 0
    if (LD_MARKER_IM.test(norm(cell(grid, r, 1)))) { markerCol = 1; break } // IM pattern at col 1
  }

  for (let r = 0; r < rows.length; r++) {
    const first = norm(cell(grid, r, markerCol))
    if (!LD_MARKER.test(first)) continue
    const refId = text(cell(grid, r, markerCol))                       // preserve verbatim
    const markerRow = row(grid, r)
    // Table name: prefer cell after an explicit "TABLE NAME" label; else first non-empty
    // cell after the marker column itself.
    const nameIdx = markerRow.findIndex(c => /TABLE NAME/i.test(text(c)))
    let name = ''
    if (nameIdx >= 0) name = clean(markerRow.slice(nameIdx + 1).find(c => clean(c)) ?? null)
    if (!name) name = clean(markerRow.slice(markerCol + 1).find(c => clean(c) && !/TABLE NAME/i.test(text(c))) ?? null)

    // Locate the value + comment columns from the marker row or the next 2 rows. Anchor
    // to the column *header* label so a table name like "Occurrence Limits" (which
    // contains "LIMIT") can't be mistaken for the value column.
    let valueCol = -1, commentCol = -1, headerR = r
    let valueHeader: string | undefined
    for (let hr = r; hr <= r + 2 && hr < rows.length; hr++) {
      const hrow = row(grid, hr)
      const vi = hrow.findIndex(c => /^AVAILABLE\b|^LIMITS?$|^DEDUCTIBLES?$|^TYPE$/i.test(text(c).trim()))
      if (vi >= 0) {
        valueCol = vi; headerR = hr
        valueHeader = text(hrow[vi] ?? null).trim() || undefined
        commentCol = hrow.findIndex(c => /COMMENT/i.test(text(c)))
        break
      }
    }
    if (valueCol < 0) { valueCol = markerCol + 3; commentCol = markerCol + 4; headerR = r }

    const entry = tables.get(refId) ?? { name, rows: [] as { label: string; value: number; constraintNote?: string }[], defaultValue: undefined, valueHeader }
    if (tables.has(refId)) ctx.warnOnce(`dupld:${refId}`, `Sheet "${grid.sheet}" row ${r + 1} (LD marker): table ${refId} appears more than once — rows merged.`)
    if (!entry.name) entry.name = name
    if (!entry.valueHeader) entry.valueHeader = valueHeader

    for (let dr = headerR + 1; dr < rows.length; dr++) {
      if (LD_MARKER.test(norm(cell(grid, dr, markerCol)))) break
      const raw = cell(grid, dr, valueCol)
      const label = clean(raw)
      if (!label || /^available|^comment|^limit$|^deductible/i.test(label)) continue
      const note = commentCol >= 0 ? clean(cell(grid, dr, commentCol)) : ''
      const num = parseNum(raw) ?? 0
      entry.rows.push({ label, value: num, constraintNote: note || undefined })
      if (/default/i.test(note)) entry.defaultValue = num
    }
    tables.set(refId, entry)
  }

  return [...tables.entries()].map(([refId, t]) => ({
    docId: refId, refId, label: `${refId} — ${t.name}`,
    data: { name: t.name, defaultValue: t.defaultValue, rows: t.rows, valueHeader: t.valueHeader } satisfies Omit<LDTable, never>,
  }))
}

// ─── Stacked RT tables ───────────────────────────────────────────────────────────

const RT_ID_MARKER = /^RATE TABLE ID/i
const RT_NAME_MARKER = /^RATE TABLE NAME/i
function parseRtTables(grid: IsoGrid | undefined, ctx: Ctx): PlannedEntity[] {
  if (!grid) return []
  ctx.recognized.push(grid.sheet)
  const tables = new Map<string, { name: string; columns: string[]; rows: Record<string, unknown>[]; colIdx: number[] }>()
  const rows = grid.cells
  let pendingName = ''

  for (let r = 0; r < rows.length; r++) {
    const first = norm(cell(grid, r, 0))
    if (RT_NAME_MARKER.test(first)) {
      pendingName = clean(row(grid, r).slice(1).find(c => clean(c)) ?? null)
      continue
    }
    if (!RT_ID_MARKER.test(first)) continue
    const refId = clean(row(grid, r).slice(1).find(c => clean(c)) ?? null) // e.g. "RTTable.001"
    if (!refId) continue

    // Column-header row = the next row with ≥2 non-empty cells.
    let headerR = -1
    for (let hr = r + 1; hr < rows.length && hr <= r + 3; hr++) {
      if (RT_NAME_MARKER.test(norm(cell(grid, hr, 0))) || RT_ID_MARKER.test(norm(cell(grid, hr, 0)))) break
      if (row(grid, hr).filter(c => clean(c)).length >= 2) { headerR = hr; break }
    }
    if (headerR < 0) continue
    const headerRow = row(grid, headerR)
    const colIdx: number[] = []
    const columns: string[] = []
    headerRow.forEach((c, i) => { const nm = clean(c); if (nm) { colIdx.push(i); columns.push(nm) } })

    const entry = tables.get(refId) ?? { name: pendingName, columns, rows: [] as Record<string, unknown>[], colIdx }
    if (tables.has(refId)) ctx.warnOnce(`duprt:${refId}`, `Sheet "${grid.sheet}" row ${r + 1} col "RATE TABLE ID": table ${refId} appears more than once — rows merged.`)
    if (!entry.name) entry.name = pendingName

    for (let dr = headerR + 1; dr < rows.length; dr++) {
      const f = norm(cell(grid, dr, 0))
      if (RT_NAME_MARKER.test(f) || RT_ID_MARKER.test(f)) break
      const cells = row(grid, dr)
      if (!entry.colIdx.some(ci => clean(cells[ci] ?? null))) continue // fully-empty row
      const rec: Record<string, unknown> = {}
      entry.colIdx.forEach((ci, k) => {
        const raw = cells[ci] ?? null
        const num = parseNum(raw)
        rec[entry.columns[k] ?? `col${k}`] = num !== null ? num : clean(raw)
      })
      entry.rows.push(rec)
    }
    tables.set(refId, entry)
  }

  return [...tables.entries()].map(([refId, t]) => ({
    docId: refId, refId, label: `${refId} — ${t.name}`,
    data: { name: t.name, columns: t.columns, rows: t.rows } satisfies Omit<RTTable, never>,
  }))
}

// ─── Rating specifications → rating program + steps ──────────────────────────────

const RATE_FIELDS: Record<string, string[]> = {
  status:    ['STATUS', 'ACTIVE STATUS', 'STEP STATUS'],
  ids:       ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID', 'COVERAGE ID', 'COVERAGE'],
  stepId:    ['RATING STEP ID', 'STEP ID', 'STEP', 'STEP NUMBER', 'STEP NO',
               'ITEM', 'ID', 'SEQUENCE', 'STEP #', 'LINE NO', 'LINE NUMBER'],
  grouping:  ['RATING GROUPING', 'GROUPING', 'GROUP', 'SECTION', 'ELEMENT', 'CATEGORY'],
  manualId:  ['RATING MANUAL RULE/ STEP ID', 'RATING MANUAL RULE/STEP ID',
               'MANUAL RULE/ STEP ID', 'MANUAL STEP', 'MANUAL REF', 'MANUAL RULE'],
  // "RULES" is the ROC-template short form; broader synonyms for novel formats.
  rules:     ['RATING RULES', 'RULES', 'RULE', 'DESCRIPTION', 'STEP DESCRIPTION',
               'LABEL', 'RATING ELEMENT', 'ELEMENT DESCRIPTION'],
  algorithm: ['ALGORITHM STEP', 'ALGORITHM', 'FORMULA', 'CALCULATION DESCRIPTION',
               'STEP DETAIL', 'LOGIC'],
  calc:      ['CALCULATION', 'OPERATOR', 'OPERATION', 'CALC', 'MATH', 'OP'],
  rounding:  ['ROUNDING NUMBER OF DIGITS', 'ROUNDING', 'ROUND TO', 'ROUNDING RULE',
               'DIGITS', 'DECIMAL PLACES'],
  // "TABLE REFERENCE" is the ROC-template equivalent of "RATE REFERENCE".
  reference: ['RATE REFERENCE', 'TABLE REFERENCE', 'RT TABLE', 'RATE TABLE',
               'TABLE', 'FACTOR TABLE', 'LOOKUP TABLE', 'RATE TABLE REFERENCE'],
  review:    ['REVIEW STATUS', 'REVIEW', 'APPROVAL STATUS'],
}

function mapOp(v: IsoCell): RatingStep['op'] {
  const s = text(v).trim()
  if (s === '+' || s === '-') return 'ADD'
  if (s === '=') return 'SET'
  return 'MUL' // '*', '/', blank — division isn't representable; keep as a factor step
}

function parseRating(grid: IsoGrid, rtTables: PlannedEntity[], productRefId: string | null, lobName: string, ctx: Ctx): PlannedEntity | null {
  const hr = findHeaderRow(grid, Object.values(RATE_FIELDS))
  if (hr < 0) { ctx.warn(`Rating sheet "${grid.sheet}": no recognizable header row — skipped.`); return null }
  ctx.recognized.push(grid.sheet)
  const header = row(grid, hr)
  const scEarly = stateColumns(header)
  const col = mapColumns(header, RATE_FIELDS, stateMatrixExclusions(grid, hr, scEarly))
  if (!('stepId' in col) && !('algorithm' in col)) { ctx.warn(`Rating sheet "${grid.sheet}": no rating step columns — skipped.`); return null }
  const sc = stateColumns(header)
  const at = (r: IsoCell[], k: string) => (k in col ? (r[col[k]] ?? null) : null)

  // Resolve a free-text "rate reference" onto a parsed RT table refId when possible.
  const rtByName = new Map(rtTables.map(t => [norm((t.data['name'] as string) ?? ''), t.refId!]))
  const resolveRef = (v: IsoCell): string | undefined => {
    const s = norm(v).replace(/ TABLE$/, '')
    if (!s) return undefined
    for (const [name, refId] of rtByName) if (name && (name === s || name.includes(s) || s.includes(name))) return refId
    return undefined
  }

  const steps: RatingStep[] = []
  const scopes: { allStates: boolean; states: string[] }[] = []
  let programRefId: string | null = null
  let order = 0

  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r)
    const stepId = clean(at(cells, 'stepId'))
    const label = clean(at(cells, 'algorithm')) || clean(at(cells, 'rules')) || clean(at(cells, 'grouping'))
    if (!stepId && !label) continue
    if (!programRefId) {
      const full = [stepId, ...splitList(at(cells, 'ids'))].find(s => /\.RAT/i.test(s))
      if (full) { const m = full.match(/^(.*\.RAT\.\d+)/i); programRefId = m ? m[1]! : full } // "GL.RAT.1.00" → "GL.RAT.1"
    }
    const ref = resolveRef(at(cells, 'reference'))
    const rounding = at(cells, 'rounding')
    const roundTo = /nearest dollar/i.test(text(rounding)) ? 0 : (parseNum(rounding) ?? undefined)
    const rawRef = clean(at(cells, 'reference'))
    order += 1
    steps.push({
      id: stepId || `step-${order}`,
      order,
      label: label || stepId,
      op: mapOp(at(cells, 'calc')),
      source: ref
        ? { type: 'RT', ref }
        : (rawRef ? { type: 'RT', ref: rawRef } : { type: 'INPUT', ref: label || stepId }),
      ...(roundTo !== undefined ? { roundTo } : {}),
    })
    scopes.push(stateScope(cells, sc))
  }
  if (!steps.length) return null

  // Separator-agnostic prefix derivation (G-B): a dashed product id must not leak
  // whole into the program id.
  const refId = programRefId ?? `${productRefId ? refIdPrefix(productRefId) || 'PROD' : 'PROD'}.RAT.1`
  const scope = scopes.some(s => s.allStates) || !scopes.length
    ? { allStates: true, states: [] }
    : { allStates: false, states: [...new Set(scopes.flatMap(s => s.states))].sort() }

  const handled = new Set(Object.values(col).concat(sc.cols.map(s => s.col), sc.allCol))
  ctx.recordUnmapped(grid.sheet, header, handled)

  return {
    docId: dashId(refId), refId, label: `${refId} — rating program`,
    data: {
      refId, name: `${lobName || 'Imported'} Rating Program`,
      minimumPremium: 0, steps, ...scope,
      status: 'ACTIVE' as Status, lifecycle: 'DRAFT' as Lifecycle,
      reviewStatus: 'NOT_STARTED' as ReviewStatus, reviewer: '',
    },
  }
}

// ─── Concept-linked reference tables (signature-detected; D1/D2/D7) ────────────────
// Real carrier specs park limit/deductible tables on a general "Rule References" sheet the
// named LD parser never claims, marked "TABLE NAME:" in COLUMN 0 with no LDTable id. This
// pass recovers them BY CONTENT SIGNATURE (never sheet name): a grid must carry >= 2 column-0
// "TABLE NAME:" block markers AND not already be claimed by a named parser (the `consumed`
// set). GL/IM/PR score zero markers (their LD blocks key on "LDTable.NNN" / "LDNNN") and their
// LD sheet sits in `consumed`, so this pass is a strict no-op on them — verified by the
// offline import:eval diff (extraEntityRate === 0).

const TABLE_NAME_MARKER = /^TABLE NAME:/i
const RULE_ID_MARKER    = /^RULE ID:/i

interface ReferenceTableDraft {
  baseName:    string        // raw table name — matching + state-suffix extraction
  displayName: string        // group/version-qualified name (the minted LDTable.name)
  state?:      string        // per-state family suffix ("- AZ")
  group?:      string        // "GROUP 1" vehicle-group qualifier (dup disambiguation)
  covCodes:    string[]      // marker-row column codes (BI/PD/CSL/…) for a limit matrix
  kindHint:    TermKind
  sourceRows:  string        // "start-end", 1-based, for provenance
  rows:        LDRow[]       // distinct numeric option values (limit/deductible amounts)
  rowLabels:   string[]      // every data-row col-0 label (sub-coverage-matrix name matching)
  backLinkWas: string        // the RULE ID line's value-column header
}

/** Scan every UNCLAIMED grid for "TABLE NAME:" reference-table blocks. Returns [] unless a
 *  grid clears the >= 2-marker signature gate — so it never fires on a GL/IM/PR workbook. */
function detectReferenceTables(grids: IsoGrid[], consumed: ReadonlySet<string>, ctx: Ctx): ReferenceTableDraft[] {
  const drafts: ReferenceTableDraft[] = []
  for (const grid of grids) {
    if (consumed.has(grid.sheet)) continue
    if (IGNORE_SHEET.test(grid.sheet) || DECOY_SHEET.test(grid.sheet) || VERSION_SUFFIX.test(grid.sheet)) continue
    const markerRows: number[] = []
    for (let r = 0; r < grid.cells.length; r++) {
      if (TABLE_NAME_MARKER.test(text(cell(grid, r, 0)))) markerRows.push(r)
    }
    if (markerRows.length < 2) continue            // signature gate
    ctx.recognized.push(grid.sheet)
    const nameCount = new Map<string, number>()
    for (let i = 0; i < markerRows.length; i++) {
      const start = markerRows[i]!
      const end = (markerRows[i + 1] ?? grid.cells.length) - 1
      const baseName = text(cell(grid, start, 0)).replace(/^TABLE NAME:\s*/i, '').trim()
      if (!baseName) continue
      // Column-code headers of a limit/deductible matrix live on the marker row (cols 2..33).
      const mrow = row(grid, start)
      const covCodes: string[] = []
      for (let c = 2; c <= 33; c++) { const s = clean(mrow[c] ?? null); if (s && !covCodes.includes(s)) covCodes.push(s) }
      // The "RULE ID:" line follows the marker; its col-1 cell is the value-column header.
      const ridRow = row(grid, start + 1)
      const hasRid = RULE_ID_MARKER.test(text(ridRow[0] ?? null))
      const backLinkWas = hasRid ? clean(ridRow[1] ?? null) : ''
      const dataStart = start + (hasRid ? 2 : 1)
      const state = (baseName.match(/-\s*([A-Z]{2})\s*$/) ?? [])[1]
      let group: string | undefined
      const rows: LDRow[] = []
      const rowLabels: string[] = []
      const seen = new Set<string>()
      for (let r = dataStart; r <= end && r < grid.cells.length; r++) {
        const label = clean(cell(grid, r, 0))
        const rawVal = cell(grid, r, 1)
        if (!label && !clean(rawVal)) continue
        if (label && !rowLabels.includes(label)) rowLabels.push(label)
        if (!group) { const gm = label.match(/^GROUP \d[^:]*/i); if (gm) group = gm[0]!.trim() }
        const num = parseNum(rawVal)
        if (num !== null && !seen.has(String(num)) && rows.length < 40) {
          seen.add(String(num))
          rows.push({ label: label || String(num), value: num })
        }
      }
      // Kind from the same "hay" the reference impl scans (name + back-link + codes).
      const hay = `${baseName} ${backLinkWas} ${covCodes.join(' ')}`.toUpperCase()
      const kindHint: TermKind = /DEDUCTIBLE/.test(hay) ? 'DEDUCTIBLE' : /\bLIMIT/.test(hay) ? 'LIMIT' : 'OPTION'
      let displayName = baseName + (group ? ` [${group.replace(/\s+/g, ' ')}]` : '')
      const n = (nameCount.get(displayName) ?? 0) + 1
      nameCount.set(displayName, n)
      if (n > 1) displayName = `${displayName} (v${n})`
      drafts.push({ baseName, displayName, state, group, covCodes, kindHint, sourceRows: `${start + 1}-${end + 1}`, rows, rowLabels, backLinkWas })
    }
  }
  return drafts
}

/** Mint a stable PREFIX.TBL.NNN reference-table entity per draft (source-row order). Aligned by
 *  index with the drafts so linkReferenceTables can back-fill coverage/rule links. The refId is
 *  SYNTHESIZED — mintedId:true flags it so it never reads as a source id (F25). */
function mintReferenceTables(drafts: ReferenceTableDraft[], prefix: string): PlannedEntity[] {
  return drafts.map((d, i) => {
    const refId = `${prefix}.TBL.${String(i + 1).padStart(3, '0')}`
    const data: LDTable = {
      name: d.displayName,
      rows: d.rows,
      defaultValue: d.rows[0]?.value,
      valueHeader: d.backLinkWas || undefined,
      kindHint: d.kindHint,
      state: d.state,
      coverageCodes: d.covCodes.length ? d.covCodes : undefined,
      coverageRefIds: [],
      ruleRefIds: [],
      backLinkWas: d.backLinkWas || undefined,
      mintedId: true,
      linkBasis: 'derived',
    }
    return { docId: refId, refId, label: `${refId} — ${d.displayName}`, data: data as unknown as Record<string, unknown> }
  })
}

/** Reconstruct the implied links a human analyst would (D2/D7/D8): reference-table → coverage
 *  (via header codes / physical-damage / sub-coverage-matrix rows / name / form tokens), and
 *  rule → reference-table (concept match on the rule's free-text reference), with a rule →
 *  coverage fallback when the reference names a coverage rather than a table (D8). Consumes +
 *  clears the transient `_referenceText` on EVERY rule so GL/IM/PR stay byte-identical, then
 *  no-ops when no reference tables were detected. Returns link tallies for the caller's notices.
 *  `refDrafts` and `refTables` are index-aligned. */
function linkReferenceTables(
  refDrafts: ReferenceTableDraft[],
  refTables: PlannedEntity[],
  coverages: PlannedEntity[],
  rules: PlannedEntity[],
): { backLinked: number; covLinked: number; rulesLinked: number; resolvedToCoverage: number; unresolved: number } {
  // Always pull + clear the transient reference text (keeps every non-CORE golden clean).
  const refTexts = rules.map(r => {
    const t = r.data['_referenceText']
    delete r.data['_referenceText']
    return typeof t === 'string' ? t : ''
  })
  const tally = { backLinked: 0, covLinked: 0, rulesLinked: 0, resolvedToCoverage: 0, unresolved: 0 }
  if (!refTables.length) return tally

  const namedCovs: NamedCoverage[] = coverages.map(c => ({ refId: c.refId as string, name: String(c.data['name'] ?? '') }))
  const conceptTables: ConceptTable[] = refTables.map((t, i) => ({ refId: t.refId as string, baseName: refDrafts[i]!.baseName, state: refDrafts[i]!.state }))
  const tableByRefId = new Map(refTables.map(t => [t.refId as string, t]))
  // covsByForm: squished form number → the coverage refIds whose form list names it.
  const covsByForm = new Map<string, string[]>()
  for (const c of coverages) {
    for (const f of ((c.data['formNumbers'] as string[] | undefined) ?? [])) {
      const k = squishStr(f)
      if (!k) continue
      const list = covsByForm.get(k) ?? []
      if (!list.includes(c.refId as string)) list.push(c.refId as string)
      covsByForm.set(k, list)
    }
  }

  // ── Reference-table → coverage links (D1/D7) ──
  refDrafts.forEach((d, i) => {
    const linked = new Set<string>()
    if (/LIABILITY LIMITS/i.test(d.baseName)) {
      for (const code of d.covCodes) for (const id of resolveCoverageCode(code, namedCovs)) linked.add(id)
    } else if (/PHYSICAL DAMAGE DEDUCTIBLE/i.test(d.baseName)) {
      for (const id of physicalDamageCoverages(namedCovs)) linked.add(id)
    } else if (/SUB-?COVERAGE.*LIMIT/i.test(d.baseName)) {
      for (const label of d.rowLabels) { const m = matchCoverageByName(label, namedCovs); if (m) linked.add(m.refId) }
    } else {
      const m = matchCoverageByName(d.baseName.replace(FORM_TOKEN, ' '), namedCovs)
      if (m) linked.add(m.refId)
      for (const ftk of formTokens(d.baseName)) for (const id of (covsByForm.get(squishStr(ftk)) ?? [])) linked.add(id)
    }
    refTables[i]!.data['coverageRefIds'] = [...linked]
    if (linked.size) tally.covLinked++
  })

  // ── Rule → reference-table links (D2) + D8 coverage fallback ──
  for (let i = 0; i < rules.length; i++) {
    const ref = refTexts[i]!
    if (!ref) continue
    const rule = rules[i]!
    const states = (rule.data['states'] as string[] | undefined) ?? []
    const allStates = rule.data['allStates'] === true
    const m = matchRuleReferenceToTables(ref, conceptTables, states, allStates, namedCovs)
    if (m.tableRefIds.length) {
      rule.data['tableRefIds'] = m.tableRefIds
      rule.data['tableLinkBasis'] = 'derived'
      tally.rulesLinked++
      for (const tid of m.tableRefIds) {
        const rr = tableByRefId.get(tid)?.data['ruleRefIds'] as string[] | undefined
        if (rr && !rr.includes(rule.refId as string)) rr.push(rule.refId as string)
      }
    } else if (m.resolvedCoverageRefId) {
      rule.data['resolvedCoverageRefId'] = m.resolvedCoverageRefId
      tally.resolvedToCoverage++
    } else if (m.how === 'NO MATCHING TABLE IN SOURCE') {
      tally.unresolved++
    }
  }
  tally.backLinked = refTables.filter(t => (t.data['ruleRefIds'] as string[]).length > 0).length
  return tally
}

/** Assemble coverage.terms from the LIMIT/DEDUCTIBLE reference tables and their reconstructed
 *  coverage links (D1/D7) — this is what makes the user-reported "no limits or deductibles"
 *  symptom disappear. Signature-gated (refTables is [] on GL/IM/PR), and SEPARATE from the
 *  PCM-A fold (foldLdTermsIntoCoverages), which is left untouched so its output stays
 *  byte-identical. One term per (coverage, table); state-suffixed families yield per-state
 *  terms. Returns the number of coverage↔term links attached. */
function deriveTermsFromReferenceTables(coverages: PlannedEntity[], refTables: PlannedEntity[]): number {
  if (!refTables.length) return 0
  const covByRefId = new Map(coverages.map(c => [c.refId as string, c]))
  const dedup = new Set<string>()
  let attached = 0
  for (const table of refTables) {
    const data = table.data as unknown as LDTable
    if (data.kindHint !== 'LIMIT' && data.kindHint !== 'DEDUCTIBLE') continue   // terms only from limit/deductible tables
    const covIds = data.coverageRefIds ?? []
    if (!covIds.length) continue
    const tableRefId = table.refId as string
    for (const covId of covIds) {
      const cov = covByRefId.get(covId)
      if (!cov) continue
      const key = `${covId}|${tableRefId}`
      if (dedup.has(key)) continue
      dedup.add(key)
      const term: CoverageTerm = {
        id: tableRefId.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        kind: data.kindHint,
        label: data.name || tableRefId,
        ldTableRef: tableRefId,                       // resolves in the UI — CORE.TBL is in plan.ldTables
        options: (data.rows ?? []).map(r => r.value),
        default: data.defaultValue ?? data.rows?.[0]?.value ?? 0,
        basis: '',
        states: data.state ? [data.state] : [],
        allStates: !data.state,
        linkBasis: 'derived',
      }
      ;(cov.data['terms'] as CoverageTerm[]).push(term)
      attached++
    }
  }
  return attached
}

// ─── Orchestration ───────────────────────────────────────────────────────────────

/** Map a set of parsed ISO template worksheets onto the canonical model. The grids
 *  may span all four workbooks (concatenate every sheet from every uploaded file);
 *  sheets are located by name so any subset works.
 *
 *  overlay — optional AI-proposed aliases/enum overrides from proposeMapping; purely additive. */
export function mapIsoWorkbook(grids: IsoGrid[], overlay?: AliasOverlay | null): ImportPlan {
  const ctx = new Ctx()

  const fwGrid   = selectFrameworkSheet(grids, ctx)
  // "Forms Library" is the IM/PR component-model template's name for the forms sheet.
  const formGrid = findSheet(grids, /forms specifications?|forms library/i, /dynamic/i)
  const dynGrid  = findSheet(grids, /forms dynamic|dynamic data/i)
  // "Rules Repository" is the IM/PR component-model template's name for the rules sheet.
  const ruleGrid = findSheet(grids, /rules specifications?|rules repository/i, /optional/i)
  const optGrid  = findSheet(grids, /optional forms rules/i)
  // "PROPERTY ROC" and the exact sheet name "ROC" are the Property/IM Rate Order of Calculations.
  const rateGrid = findSheet(grids, /rating specifications?|property roc|^roc$/i)
  const rtGrid   = findSheet(grids, /rating tables|rate tables/i)
  const ldGrid   = findSheet(grids, /limits and deductibles|limits & deductibles/i)

  // parseFramework now returns FrameworkResult[] (multi-product aware) or null.
  const fwResults = fwGrid ? parseFramework(fwGrid, ctx, overlay) : null

  // ── LOB resolution — driven by the first product's refId (line-agnostic). ──
  const firstFw = fwResults?.[0] ?? null
  const productRefId = firstFw?.productRefId ?? null
  const lob = resolveLobByRefId(productRefId) ?? resolveLobByRefId(firstFw?.coverages[0]?.refId ?? null) ?? DEFAULT_LOB
  const lobRefId = firstFw?.lobRefId ?? `${lob.prefix}.LOB.001`
  const lobName = firstFw?.lobName || lob.name
  const productId = productRefId

  const ldTables = parseLdTables(ldGrid, ctx)
  const rtTables = parseRtTables(rtGrid, ctx)
  const dynByForm = parseDynamicFields(dynGrid, ctx)
  // parseForms uses the first product's refId for form-level metadata (forms are rarely
  // product-subdivided within a workbook; they reference coverages by refId prefix).
  const forms = formGrid ? parseForms(formGrid, dynByForm, productRefId, ctx, overlay) : []
  const rules = ruleGrid ? parseRules(ruleGrid, ctx) : []
  const formRules = optGrid ? parseFormRules(optGrid, ctx) : []
  const ratingProgram = rateGrid ? parseRating(rateGrid, rtTables, productRefId, lobName, ctx) : null

  // ── Concept-linked reference tables (D1): recover limit/deductible tables the named LD
  //    parser never claimed. Runs AFTER every named parser so `consumed` is complete;
  //    signature-gated (>= 2 col-0 "TABLE NAME:" markers) + consumed-skip ⇒ strict no-op on
  //    GL/IM/PR. The original `ldTables` still feed the (untouched) PCM-A fold below. ──
  const consumedSheets = new Set<string>(
    [...ctx.recognized, ldGrid?.sheet, rtGrid?.sheet].filter((s): s is string => !!s),
  )
  const refDrafts = detectReferenceTables(grids, consumedSheets, ctx)
  const refPrefix = refIdPrefix(productRefId ?? firstFw?.coverages[0]?.refId ?? '') || lob.prefix
  const refTables = refDrafts.length ? mintReferenceTables(refDrafts, refPrefix) : []

  // ── Build PlannedEntity[] — one per detected product. ──
  const products: PlannedEntity[] = []
  if (fwResults) {
    for (const fw of fwResults) {
      if (!fw.productRefId) continue
      const pLobRefId = fw.lobRefId ?? lobRefId
      const pLobName  = fw.lobName || lobName
      products.push({
        docId: fw.productRefId, refId: fw.productRefId,
        label: `${fw.productRefId} — ${fw.productName}`,
        data: {
          refId: fw.productRefId,
          name: fw.productName || `${pLobName} Product`,
          lob: { refId: pLobRefId, name: pLobName },
          description: '',
          marketSegment: `${lob.vertical} / ${lob.family}`,
          owner: { uid: '', name: '' },
          ...fw.productScope,
          status: 'ACTIVE' as Status,
          lifecycle: 'DRAFT' as Lifecycle,
          reviewStatus: 'NOT_STARTED' as ReviewStatus,
          reviewer: '',
        },
      })
    }
  }
  // Backward-compat: product = first entry (null if none).
  const product: PlannedEntity | null = products[0] ?? null

  // Flat union of all coverages across all products (ordered by product then depth).
  const allCoverages: PlannedEntity[] = fwResults ? fwResults.flatMap(fw => fw.coverages) : []

  // Reconstruct rule↔table↔coverage links by concept matching (D2/D7/D8). Clears the
  // transient rule reference text on every workbook; only wires links when reference tables
  // were detected (CORE signature) — GL/IM/PR are byte-identical.
  const refLinks = linkReferenceTables(refDrafts, refTables, allCoverages, rules)

  // Assemble coverage.terms from the LD tables and the rules that reference them
  // (ledger PCM-A). coverageRefIds are globally unique, so the flat union is safe
  // in multi-product workbooks. NB: the fold runs over the ORIGINAL ldTables only — the
  // minted reference tables derive their terms through the separate, signature-gated
  // deriveTermsFromReferenceTables path so PCM-A output stays byte-identical.
  foldLdTermsIntoCoverages(allCoverages, rules, ldTables, ctx)

  // Assemble coverage terms from the signature-detected reference tables (D1/D7) — separate
  // from the PCM-A fold above, gated on refTables so GL/IM/PR are untouched.
  const derivedTerms = deriveTermsFromReferenceTables(allCoverages, refTables)
  if (derivedTerms > 0) {
    ctx.addNotice({
      code: 'reference_table_terms_derived',
      message: `${derivedTerms} coverage term(s) derived from ${refTables.length} signature-detected reference table(s) (limits/deductibles the named LD parser never claimed).`,
      data: { terms: derivedTerms, tables: refTables.length },
    })
  }

  // Reference tables share a single home with the real LD tables so the UI ldTables→chip
  // lookup and the golden both see them under their minted CORE.TBL refIds.
  const allLdTables = [...ldTables, ...refTables]

  const dynFieldCount = forms.reduce((n, f) => n + ((f.data['dynamicFields'] as unknown[])?.length ?? 0), 0)
  const stepCount = ratingProgram ? (ratingProgram.data['steps'] as unknown[]).length : 0

  const counts: Record<string, number> = {
    products: products.length,
    coverages: allCoverages.length,
    forms: forms.length,
    dynamicFields: dynFieldCount,
    rules: rules.length,
    formRules: formRules.length,
    ratingSteps: stepCount,
    rtTables: rtTables.length,
    ldTables: allLdTables.length,
    referenceTables: refTables.length,
    referenceTablesBackLinked: refLinks.backLinked,
    referenceTablesCovLinked: refLinks.covLinked,
    rulesTableLinked: refLinks.rulesLinked,
    rulesResolvedToCoverage: refLinks.resolvedToCoverage,
    ruleRefsUnresolved: refLinks.unresolved,
  }

  const knownSheets = new Set(ctx.recognized)
  const sheetsSkipped = grids.map(g => g.sheet).filter(s => !knownSheets.has(s))

  return {
    productId,
    product,
    products,
    coverages: allCoverages,
    forms, rules, formRules, ratingProgram, ldTables: allLdTables, rtTables,
    summary: {
      productName: product ? (product.data['name'] as string) : null,
      productRefId,
      lobName,
      counts,
      warnings: ctx.warnings,
      unmappedColumns: ctx.unmapped,
      sheetsRecognized: ctx.recognized,
      sheetsSkipped,
      defects: ctx.defects,
      notices: ctx.notices,
    },
  }
}
