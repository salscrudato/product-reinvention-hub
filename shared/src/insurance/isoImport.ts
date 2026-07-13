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
  RTTable, LDTable, RatingStep,
} from '../types'
import { resolveLobByRefId, DEFAULT_LOB } from './lobRegistry'
import { resolveCoverageHierarchy } from './coverageHierarchy'

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

export interface ImportSummary {
  productName:      string | null
  productRefId:     string | null
  lobName:          string | null
  counts:           Record<string, number>
  warnings:         string[]
  unmappedColumns:  UnmappedColumns[]
  sheetsRecognized: string[]
  sheetsSkipped:    string[]
}

export interface ImportPlan {
  productId:      string | null
  product:        PlannedEntity | null
  coverages:      PlannedEntity[]   // parent-before-child order
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
function mapRequirement(v: IsoCell): Requirement { return /optional/i.test(text(v)) ? 'OPTIONAL' : 'MANDATORY' }
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
// Base/Declarations/Endorsement/Exclusion/Amendatory/Notice map 1:1; the remaining
// GL categories (Other Coverage, Causes Of Loss, Schedule, …) fold onto ENDORSEMENT.
function mapFormCategory(v: IsoCell): { category: FormCategory; exact: boolean } {
  const s = norm(v)
  if (s.startsWith('BASE COVERAGE')) return { category: 'BASE_COVERAGE', exact: true }
  if (s.startsWith('DECLARATION'))   return { category: 'DECLARATIONS',  exact: true }
  if (s.startsWith('ENDORSEMENT'))   return { category: 'ENDORSEMENT',   exact: true }
  if (s.startsWith('EXCLUSION'))     return { category: 'EXCLUSION',     exact: true }
  if (s.startsWith('AMENDATORY'))    return { category: 'AMENDATORY',    exact: true }
  if (s.includes('NOTICE'))          return { category: 'POLICY_NOTICE', exact: true }
  return { category: 'ENDORSEMENT', exact: s === '' }
}

/** The line prefix (LOB token) of a coverage refId. Tolerant of inconsistent source formatting:
 *  "PR.COV001.0", "PRCOV0010.0" and "GL.COV.001" all yield the leading line code (PR / PR / GL). */
function refIdPrefix(refId: string): string {
  const m = refId.match(/^([A-Za-z]{2,4})\.?(?:COV|PROD|LOB|RAT|RU|FORM)/i)
  if (m) return m[1]!.toUpperCase()
  return (refId.split(/[.\d]/).filter(Boolean)[0] ?? '').toUpperCase()
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

/** Map each field key → the first column whose header matches one of its aliases
 *  (punctuation/whitespace-insensitive). */
function mapColumns(header: IsoCell[], fields: Record<string, string[]>): Record<string, number> {
  const heads = header.map(squish)
  const map: Record<string, number> = {}
  for (const [key, aliases] of Object.entries(fields)) {
    const sq = aliases.map(squishStr)
    const idx = heads.findIndex(h => h !== '' && sq.includes(h))
    if (idx >= 0) map[key] = idx
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
function stateScope(r: IsoCell[], sc: { cols: StateCol[]; allCol: number }): { allStates: boolean; states: string[] } {
  if (sc.allCol >= 0 && isX(r[sc.allCol] ?? null)) return { allStates: true, states: [] }
  const states = sc.cols.filter(s => isX(r[s.col] ?? null)).map(s => s.code)
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
function findSheet(grids: IsoGrid[], re: RegExp, exclude?: RegExp): IsoGrid | undefined {
  return grids.find(g => re.test(g.sheet) && !IGNORE_SHEET.test(g.sheet) && (!exclude || !exclude.test(g.sheet)))
}

// ─── Summary accumulator ─────────────────────────────────────────────────────────

class Ctx {
  warnings: string[] = []
  unmapped: UnmappedColumns[] = []
  recognized: string[] = []
  private warned = new Set<string>()
  /** De-duplicated warning (keeps the summary readable when a value recurs on 100s of rows). */
  warnOnce(key: string, msg: string): void { if (!this.warned.has(key)) { this.warned.add(key); this.warnings.push(msg) } }
  warn(msg: string): void { this.warnings.push(msg) }
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

// Field aliases span the ISO template ("PRODUCT FRAMEWORK ID", "BUREAU"/"PROPRIETARY") and the
// Sample Mutual "Product Component Model" template ("ID", "RATING BUREAU?", "SUB COVERAGE"). Matching is
// punctuation/whitespace-insensitive, so trailing "?" and embedded newlines are tolerated.
const FW_FIELDS: Record<string, string[]> = {
  status:      ['STATUS'],
  id:          ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID', 'ID'],
  product:     ['PRODUCT'],
  lob:         ['LINE OF BUSINESS', 'LOB'],
  coverage:    ['COVERAGE'],
  subCoverage: ['SUB-COVERAGE', 'SUB COVERAGE', 'SUBCOVERAGE'],
  forms:       ['FORM NUMBER(S)', 'FORM NUMBER', 'FORM NUMBERS'],
  edition:     ['EDITION DATE'],
  claimsBasis: ['CLAIMS BASIS'],
  requirement: ['COVERAGE REQUIREMENT', 'REQUIREMENT', 'MANDATORY/ OPTIONAL', 'MANDATORY / OPTIONAL'],
  premiumGen:  ['PREMIUM GENERATING', 'PREMIUM GENERATING?'],
  bureau:      ['BUREAU', 'RATING BUREAU', 'RATING BUREAU?'],
  proprietary: ['PROPRIETARY', 'PROPRIETARY?'],
  review:      ['REVIEW STATUS'],
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
}

function parseFramework(grid: IsoGrid, ctx: Ctx): FrameworkResult | null {
  const hr = findHeaderRow(grid, Object.values(FW_FIELDS))
  if (hr < 0) { ctx.warn(`Framework sheet "${grid.sheet}": no recognizable header row — skipped.`); return null }
  ctx.recognized.push(grid.sheet)

  const header = row(grid, hr)
  const col = mapColumns(header, FW_FIELDS)
  const sc = stateColumns(header)
  const at = (r: IsoCell[], k: string) => (k in col ? (r[col[k]] ?? null) : null)

  let productRefId: string | null = null
  let productName = ''
  let lobRefId: string | null = null
  let lobName = ''
  let productNameHint = ''
  let lobNameHint = ''
  const distinctProducts = new Set<string>()

  // ── Pass 1: separate identity rows from coverage rows (source order preserved) ──
  const drafts: CoverageDraft[] = []
  const draftByRefId = new Map<string, CoverageDraft>()

  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r)
    const id = clean(at(cells, 'id'))
    if (!id) continue
    const covName = clean(at(cells, 'coverage'))
    const subName = clean(at(cells, 'subCoverage'))
    const prod = clean(at(cells, 'product'))
    const lob = clean(at(cells, 'lob'))
    if (prod) distinctProducts.add(prod)

    // Explicit product / LOB rows (ISO carries .PROD / .LOB tokens in the id column).
    if (/\.PROD\b|\.PROD\./i.test(id)) {
      if (!productRefId) { productRefId = id; productName = prod || productName }
      continue
    }
    if (/\.LOB\b|\.LOB\./i.test(id)) {
      if (!lobRefId) { lobRefId = id; lobName = lob || lobName }
      if (!productName) productName = prod
      continue
    }
    // A row with neither a coverage nor a sub-coverage name is a hierarchy/identity row
    // (the Sample Mutual component model has no .PROD/.LOB tokens — product/LOB appear as plain rows).
    if (!covName && !subName) {
      if (!productNameHint && prod) productNameHint = prod
      if (!lobNameHint && lob) lobNameHint = lob
      continue
    }

    if (!productNameHint && prod) productNameHint = prod
    if (!lobNameHint && lob) lobNameHint = lob
    const draft: CoverageDraft = {
      refId: id, coverageName: covName, subCoverageName: subName, rowIndex: r,
      cells, scope: stateScope(cells, sc),
    }
    drafts.push(draft)
    const prior = draftByRefId.get(id)
    if (!prior) {
      draftByRefId.set(id, draft)
    } else if (prior.coverageName !== covName || prior.subCoverageName !== subName) {
      // Same refId, different coverage content: the source reuses a traceability id across two
      // distinct coverages, which violates refId uniqueness (parentId links resolve by refId). Keep
      // the first and surface the collision rather than dropping the row silently.
      ctx.warnOnce(`dupcovid:${id}`, `Sheet "${grid.sheet}" col "ID": coverage id ${id} is reused for different coverages ("${prior.coverageName || prior.subCoverageName}" and "${covName || subName}") — kept the first; verify the source.`)
    }
  }

  // ── Pass 2: first-principles hierarchy resolution (format-agnostic) ──
  const resolved = resolveCoverageHierarchy(drafts.map(d => ({
    refId: d.refId, coverageName: d.coverageName, subCoverageName: d.subCoverageName, rowIndex: d.rowIndex,
  })))
  for (const rc of resolved) {
    if (rc.parentSignal === 'orphan-promoted') {
      ctx.warn(`Sheet "${grid.sheet}" coverage ${rc.refId} ("${rc.name}"): named a sub-coverage but no parent coverage was found — imported as a top-level coverage.`)
    }
  }

  const coverages: PlannedEntity[] = resolved.map(rc => {
    const cells = (draftByRefId.get(rc.refId) as CoverageDraft).cells
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
        ...(draftByRefId.get(rc.refId) as CoverageDraft).scope,
        status: mapStatus(at(cells, 'status')),
        lifecycle: 'DRAFT' as Lifecycle,
        reviewStatus: mapReview(at(cells, 'review')),
        reviewer: '',
      },
    }
  })

  // ── Product identity: synthesize when the sheet has no explicit .PROD row ──
  if (!productRefId && coverages.length) {
    const prefix = refIdPrefix(coverages[0]!.refId!) || 'XX'
    productRefId = `${prefix}.PROD.001`
    productName = productName || productNameHint
    ctx.warn(`Framework sheet "${grid.sheet}": no explicit product (.PROD) row — synthesized product id "${productRefId}" from the coverage id prefix "${prefix}".`)
  } else if (!productName) {
    productName = productNameHint
  }
  if (!lobName) lobName = lobNameHint
  if (distinctProducts.size > 1) {
    ctx.warnOnce('multiproduct', `Framework sheet "${grid.sheet}": ${distinctProducts.size} distinct product names detected — imported under a single product ${productRefId ?? '(none)'}. Split into separate products if the source is a multi-product book.`)
  }

  // Integrity: never leave a dangling parentId — promote orphans to top-level (belt-and-braces;
  // the resolver already guarantees this, but a source with a mid-import dedup could surprise us).
  const byRefId = new Set(coverages.map(c => c.refId!))
  for (const cov of coverages) {
    const pid = cov.data['parentId'] as string | null
    if (pid && !byRefId.has(pid)) {
      ctx.warn(`Sheet "${grid.sheet}" coverage ${cov.refId}: parent "${pid}" not found — imported as top-level.`)
      cov.data['parentId'] = null
    }
  }
  // Parent-before-child write order by hierarchy DEPTH (not refId string length — Sample Mutual parent and
  // child share a segment count). Stable sort preserves source order within a depth band.
  const depthOf = (refId: string): number => {
    let d = 0
    let cur: string | null = refId
    const guard = new Set<string>()
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

  const scopes = drafts.map(d => d.scope)
  const productScope = scopes.some(s => s.allStates) || scopes.length === 0
    ? { allStates: true, states: [] }
    : { allStates: false, states: [...new Set(scopes.flatMap(s => s.states))].sort() }

  const handled = new Set(Object.values(col).concat(sc.cols.map(s => s.col), sc.allCol))
  ctx.recordUnmapped(grid.sheet, header, handled)
  return { productRefId, productName, lobRefId, lobName, coverages, productScope }
}

// ─── Forms specifications + dynamic data ─────────────────────────────────────────

const FORM_FIELDS: Record<string, string[]> = {
  ids:         ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID'],
  name:        ['FORM NAME'],
  number:      ['FORM NUMBER'],
  edition:     ['FORM EDITION DATE (MM YY)', 'FORM EDITION DATE', 'EDITION DATE'],
  claimsBasis: ['CLAIMS BASIS'],
  bureau:      ['BUREAU'],
  proprietary: ['PROPRIETARY'],
  admitted:    ['ADMITTED / NON-ADMITTED', 'ADMITTED/NON-ADMITTED', 'ADMITTED / NON-ADMITTED', 'ADMITTED'],
  category:    ['FORM CATEGORY'],
  dynamic:     ['DYNAMIC / STATIC', 'DYNAMIC/STATIC'],
  mandatory:   ['MANDATORY/ OPTIONAL', 'MANDATORY / OPTIONAL', 'MANDATORY/OPTIONAL'],
  attachment:  ['ATTACHMENT CONDITION'],
  display:     ['DISPLAY ON FORMS SCHEDULE', 'DISPLAY ON SCHEDULE'],
  useCount:    ['SINGLE OR MULTI-USE', 'SINGLE OR MULTI USE'],
  review:      ['REVIEW STATUS'],
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

function parseForms(grid: IsoGrid, dynByForm: Record<string, DynamicField[]>, productRefId: string | null, ctx: Ctx): PlannedEntity[] {
  const hr = findHeaderRow(grid, Object.values(FORM_FIELDS))
  if (hr < 0) { ctx.warn(`Forms sheet "${grid.sheet}": no recognizable header row — skipped.`); return [] }
  ctx.recognized.push(grid.sheet)
  const header = row(grid, hr)
  const col = mapColumns(header, FORM_FIELDS)
  if (!('number' in col)) { ctx.warn(`Forms sheet "${grid.sheet}": no Form Number column — skipped.`); return [] }
  const sc = stateColumns(header)
  const section = fillForward(row(grid, hr - 1))
  const partCols = groupColumns(section, header, /COVERAGE PART/i)
  const txnCols = groupColumns(section, header, /TRANSACTION/i)
  const at = (r: IsoCell[], k: string) => (k in col ? (r[col[k]] ?? null) : null)

  const byKey = new Map<string, PlannedEntity>()
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r)
    const number = clean(at(cells, 'number'))
    if (!number || /^form number/i.test(number)) continue
    const key = number.replace(/\s+/g, '-')
    const scope = stateScope(cells, sc)
    const coverageParts = partCols.filter(p => isX(cells[p.col] ?? null)).map(p => p.name)
    const transactions = txnCols.filter(t => isX(cells[t.col] ?? null)).map(t => t.name)

    const existing = byKey.get(key)
    if (existing) {
      // Same form number appearing again (state/coverage variant) — union the sets.
      const d = existing.data
      const uni = (a: unknown, b: string[]) => [...new Set([...(a as string[]), ...b])]
      d['coverageParts'] = uni(d['coverageParts'], coverageParts)
      d['transactions']  = uni(d['transactions'], transactions)
      if (!(d['allStates'] as boolean)) {
        if (scope.allStates) { d['allStates'] = true; d['states'] = [] }
        else d['states'] = uni(d['states'], scope.states)
      }
      ctx.warnOnce(`dupform:${key}`, `Sheet "${grid.sheet}" row ${r + 1} col "FORM NUMBER": form ${number} appears on multiple rows — applicability merged.`)
      continue
    }

    const cat = mapFormCategory(at(cells, 'category'))
    if (!cat.exact) ctx.warnOnce(`formcat:${norm(at(cells, 'category'))}`, `Sheet "${grid.sheet}" row ${r + 1} col "FORM CATEGORY": value "${clean(at(cells, 'category'))}" not recognised — mapped to ENDORSEMENT, verify intent.`)

    byKey.set(key, {
      docId: key, refId: null, label: `${number} — ${clean(at(cells, 'name'))}`,
      data: {
        number, name: clean(at(cells, 'name')),
        edition: clean(at(cells, 'edition')),
        category: cat.category,
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
        dynamicFields: dynByForm[key] ?? [],
        ...scope,
        status: 'ACTIVE' as Status,
        lifecycle: 'DRAFT' as Lifecycle,
        reviewStatus: mapReview(at(cells, 'review')),
        reviewer: '',
      },
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
  status:      ['STATUS'],
  ids:         ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID'],
  id:          ['RULE ID'],
  category:    ['RULE CATEGORY'],
  subCategory: ['RULE SUB-CATEGORY', 'RULE SUB CATEGORY'],
  forms:       ['FORM NUMBER', 'FORM NUMBER(S)'],
  condition:   ['RULE CONDITION'],
  outcome:     ['RULE OUTCOME'],
  reference:   ['RULE REFERENCE'],
  review:      ['REVIEW STATUS (CLIENT TEAM)', 'REVIEW STATUS'],
}

function parseRules(grid: IsoGrid, ctx: Ctx): PlannedEntity[] {
  const hr = findHeaderRow(grid, Object.values(RULE_FIELDS))
  if (hr < 0) { ctx.warn(`Rules sheet "${grid.sheet}": no recognizable header row — skipped.`); return [] }
  ctx.recognized.push(grid.sheet)
  const header = row(grid, hr)
  const col = mapColumns(header, RULE_FIELDS)
  if (!('id' in col)) { ctx.warn(`Rules sheet "${grid.sheet}": no Rule ID column — skipped.`); return [] }
  const sc = stateColumns(header)
  const at = (r: IsoCell[], k: string) => (k in col ? (r[col[k]] ?? null) : null)

  const byId = new Map<string, PlannedEntity>()
  for (let r = hr + 1; r < grid.cells.length; r++) {
    const cells = row(grid, r)
    const id = clean(at(cells, 'id'))
    if (!id) continue
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

const LD_MARKER = /^LD ?TABLE\.\s*\w+/i
function parseLdTables(grid: IsoGrid | undefined, ctx: Ctx): PlannedEntity[] {
  if (!grid) return []
  ctx.recognized.push(grid.sheet)
  const tables = new Map<string, { name: string; rows: { label: string; value: number; constraintNote?: string }[]; defaultValue?: number }>()
  const rows = grid.cells

  for (let r = 0; r < rows.length; r++) {
    const first = norm(cell(grid, r, 0))
    if (!LD_MARKER.test(first)) continue
    const refId = text(cell(grid, r, 0))                      // preserve exact ("LDTable.001")
    const markerRow = row(grid, r)
    // Table name = the non-empty cell after a "TABLE NAME" marker, else the 2nd value.
    const nameIdx = markerRow.findIndex(c => /TABLE NAME/i.test(text(c)))
    let name = ''
    if (nameIdx >= 0) name = clean(markerRow.slice(nameIdx + 1).find(c => clean(c)) ?? null)
    if (!name) name = clean(markerRow.slice(1).find(c => clean(c) && !/TABLE NAME/i.test(text(c))) ?? null)

    // Locate the value + comment columns from the marker row or the next row. Anchor
    // to the column *header* label so a table name like "Occurrence Limits" (which
    // contains "LIMIT") can't be mistaken for the value column.
    let valueCol = -1, commentCol = -1, headerR = r
    for (let hr = r; hr <= r + 2 && hr < rows.length; hr++) {
      const hrow = row(grid, hr)
      const vi = hrow.findIndex(c => /^AVAILABLE\b|^LIMITS?$|^DEDUCTIBLES?$|^TYPE$/i.test(text(c).trim()))
      if (vi >= 0) {
        valueCol = vi; headerR = hr
        commentCol = hrow.findIndex(c => /COMMENT/i.test(text(c)))
        break
      }
    }
    if (valueCol < 0) { valueCol = 3; commentCol = 4; headerR = r } // template default columns

    const entry = tables.get(refId) ?? { name, rows: [] as { label: string; value: number; constraintNote?: string }[], defaultValue: undefined }
    if (tables.has(refId)) ctx.warnOnce(`dupld:${refId}`, `Sheet "${grid.sheet}" row ${r + 1} col 0 (LD marker): table ${refId} appears more than once — rows merged.`)
    if (!entry.name) entry.name = name

    for (let dr = headerR + 1; dr < rows.length; dr++) {
      if (LD_MARKER.test(norm(cell(grid, dr, 0)))) break
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
    data: { name: t.name, defaultValue: t.defaultValue, rows: t.rows } satisfies Omit<LDTable, never>,
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
  status:    ['STATUS'],
  ids:       ['PRODUCT FRAMEWORK ID', 'FRAMEWORK ID'],
  stepId:    ['RATING STEP ID', 'STEP ID'],
  grouping:  ['RATING GROUPING'],
  manualId:  ['RATING MANUAL RULE/ STEP ID', 'RATING MANUAL RULE/STEP ID', 'MANUAL RULE/ STEP ID'],
  rules:     ['RATING RULES'],
  algorithm: ['ALGORITHM STEP'],
  calc:      ['CALCULATION'],
  rounding:  ['ROUNDING NUMBER OF DIGITS', 'ROUNDING'],
  reference: ['RATE REFERENCE'],
  review:    ['REVIEW STATUS'],
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
  const col = mapColumns(header, RATE_FIELDS)
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

  const refId = programRefId ?? `${(productRefId ?? 'PROD').split('.')[0]}.RAT.1`
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

// ─── Orchestration ───────────────────────────────────────────────────────────────

/** Map a set of parsed ISO template worksheets onto the canonical model. The grids
 *  may span all four workbooks (concatenate every sheet from every uploaded file);
 *  sheets are located by name so any subset works. */
export function mapIsoWorkbook(grids: IsoGrid[]): ImportPlan {
  const ctx = new Ctx()

  const fwGrid   = findSheet(grids, /product framework|product component model|component model/i)
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

  const fw = fwGrid ? parseFramework(fwGrid, ctx) : null

  // Product identity + LOB resolution (line-agnostic via the refId prefix).
  const productRefId = fw?.productRefId ?? null
  const lob = resolveLobByRefId(productRefId) ?? resolveLobByRefId(fw?.coverages[0]?.refId ?? null) ?? DEFAULT_LOB
  const lobRefId = fw?.lobRefId ?? `${lob.prefix}.LOB.001`
  const lobName = fw?.lobName || lob.name
  const productId = productRefId ? productRefId : null

  const ldTables = parseLdTables(ldGrid, ctx)
  const rtTables = parseRtTables(rtGrid, ctx)
  const dynByForm = parseDynamicFields(dynGrid, ctx)
  const forms = formGrid ? parseForms(formGrid, dynByForm, productRefId, ctx) : []
  const rules = ruleGrid ? parseRules(ruleGrid, ctx) : []
  const formRules = optGrid ? parseFormRules(optGrid, ctx) : []
  const ratingProgram = rateGrid ? parseRating(rateGrid, rtTables, productRefId, lobName, ctx) : null

  let product: PlannedEntity | null = null
  if (fw && productRefId) {
    product = {
      docId: productRefId, refId: productRefId, label: `${productRefId} — ${fw.productName}`,
      data: {
        refId: productRefId,
        name: fw.productName || `${lobName} Product`,
        lob: { refId: lobRefId, name: lobName },
        description: '',
        marketSegment: `${lob.vertical} / ${lob.family}`,
        owner: { uid: '', name: '' }, // stamped with the importing user by the writer
        ...fw.productScope,
        status: 'ACTIVE' as Status,
        lifecycle: 'DRAFT' as Lifecycle,
        reviewStatus: 'NOT_STARTED' as ReviewStatus,
        reviewer: '',
      },
    }
  } else if (fw && !productRefId) {
    ctx.warn('No product row (…​.PROD.*) found in the framework sheet — cannot create a product.')
  }

  const dynFieldCount = forms.reduce((n, f) => n + ((f.data['dynamicFields'] as unknown[])?.length ?? 0), 0)
  const stepCount = ratingProgram ? (ratingProgram.data['steps'] as unknown[]).length : 0

  const counts: Record<string, number> = {
    products: product ? 1 : 0,
    coverages: fw?.coverages.length ?? 0,
    forms: forms.length,
    dynamicFields: dynFieldCount,
    rules: rules.length,
    formRules: formRules.length,
    ratingSteps: stepCount,
    rtTables: rtTables.length,
    ldTables: ldTables.length,
  }

  const knownSheets = new Set(ctx.recognized)
  const sheetsSkipped = grids.map(g => g.sheet).filter(s => !knownSheets.has(s))

  return {
    productId,
    product,
    coverages: fw?.coverages ?? [],
    forms, rules, formRules, ratingProgram, ldTables, rtTables,
    summary: {
      productName: product ? (product.data['name'] as string) : null,
      productRefId,
      lobName,
      counts,
      warnings: ctx.warnings,
      unmappedColumns: ctx.unmapped,
      sheetsRecognized: ctx.recognized,
      sheetsSkipped,
    },
  }
}
