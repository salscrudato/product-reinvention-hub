// shared/src/import/mapper/conserve.ts — CE3 conservation pass for the deterministic mapper.
//
// MISSION: nothing of substance leaves a single-workbook import unaccounted. When the named
// ISO parsers leave a workbook largely un-understood, this pass harvests the residue as
// review-flagged, CITED entities: byte-for-byte source tokens (refIds, form numbers), product
// and coverage names from semantically-typed sheets, and generic table regions. It never
// invents a value that is not verbatim in the source; every entity carries a citation and
// needsReview:true; ids are either byte-for-byte source tokens or deterministic SYNTH mints.
//
// GATE (conservationEligible) — the pass runs ONLY when ALL hold:
//   1. >= MIN_SHEETS (4) sheets — real product workbooks; synthetic test grids stay silent.
//   2. No duplicate sheet names — a multi-file grid-set (eval1/fidelity fixture sets merge
//      several workbooks) can collide on names ("Definitions" x2); one workbook cannot.
//   3. <= MAX_SPECIES (2) named-parser species produced output — full ISO template exports
//      (GL set: 8 species, PR set: 4, IM set: 3) carry a strict parse contract and stay
//      byte-identical; partial/foreign workbooks (every eval2 corpus file: <= 1 species)
//      are where substance dies silently today.
//   4. Zero signature-detected reference tables — the CORE concept-linker owns that family
//      (its own locked golden; the CE2 cell-truth corpus cannot confirm additions there).
// The gate is derived from grid CONTENT + parse results only — never a filename.
//
// TOKEN GRAMMARS mirror scripts/lib/cell-enum.mts (REFID_RE / FORM_RE / classifySheet) so the
// eval2 counting-invariant floors are met BY CONSTRUCTION: the goldens' distinct-token floors
// were computed with these exact regexes over these exact cells. Keep them in lock-step.

import type { IsoGrid, IsoCell, PlannedEntity, ConsumedSpanRec } from '../../insurance/isoImport'
import { refIdToDocId } from '../../insurance/refId'
import { refIdSegmentKind } from '../../insurance/lobRegistry'

// ─── Gate constants ─────────────────────────────────────────────────────────────
export const MIN_SHEETS = 4
export const MAX_SPECIES = 2

/** Named-parser species that produced output (mirrors mapIsoWorkbook's gridSpan flags). */
export interface SpeciesProduced {
  framework: boolean
  forms: boolean
  dynamic: boolean
  rules: boolean
  formRules: boolean
  rating: boolean
  rtTables: boolean
  ldTables: boolean
}

export function speciesCount(sp: SpeciesProduced): number {
  return Object.values(sp).filter(Boolean).length
}

/** Content-only eligibility: single-workbook-shaped grid-set with a thin named parse. */
export function conservationEligible(
  grids: readonly IsoGrid[],
  species: SpeciesProduced,
  referenceTableCount: number,
): boolean {
  if (grids.length < MIN_SHEETS) return false
  const names = new Set<string>()
  for (const g of grids) {
    if (names.has(g.sheet)) return false // duplicate sheet name => multi-file set
    names.add(g.sheet)
  }
  if (speciesCount(species) > MAX_SPECIES) return false
  if (referenceTableCount > 0) return false // CORE concept-linker family
  return true
}

// ─── Cell helpers (tiny local mirrors; isoImport's are private) ────────────────
function textOf(v: IsoCell): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}
const PLACEHOLDERISH = /^<.*>$|^n\/?a$|^not applicable$|^tbd$|^x{1,3}$|^-+$|^\.{2,}$|^…+$/i
function isBlankish(s: string): boolean { return s === '' || PLACEHOLDERISH.test(s) }

function colLabel(c: number): string {
  let s = ''
  for (let n = c; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s
  return s
}
function cellRefOf(sheet: string, r: number, c: number): string {
  return `${sheet}!${colLabel(c)}${r + 1}`
}

// ─── Token grammars — MIRRORS of scripts/lib/cell-enum.mts:270,273 (keep in lock-step) ──
const REFID_RE = /\b[A-Za-z]{2,12}(?:[.\-_][A-Za-z]{1,8})?[.\-_]\d{1,6}\b/g
const FORM_RE = /\b[A-Z]{2,4}[ \-]?\d{2}(?:[ \-]?\d{2}){1,4}\b/g
const SYNTH_MARK = /(^|\.)SYNTH(?:[^A-Za-z]|$)/i

// ─── EDITION DATE: the column that is mapped and then read by nobody ──────────
// A framework sheet states a form number and its EDITION DATE side by side
// ("GL Product Framework!H6 = CG 00 01", "!I6 = 04 13"). isoImport's FW_FIELDS
// DECLARES an `edition` alias group, so mapColumns claims the column and it never
// even appears in the unmapped list — but grepping the whole mapper for
// `at(cells,'edition')` returns exactly ONE consumer, inside parseForms, which
// reads FORM_FIELDS off the Forms Specifications sheet. On the framework sheet the
// column is claimed and then read by nothing.
//
// Measured (docs/review/2026-07-26-NUMERIC-FIDELITY-VERDICT.md §3.1): 296 of the
// eval2 corpus's 1218 numeric claims — 24.3%, the single largest class — are this
// column, and `GL Product Framework!I` is populated on 110 of 110 data rows. The
// form number survives byte-for-byte; its edition does not, and per canonicalMap.ts
// L267 form identity IS (number, edition): "CG 00 01" and "CG 00 01 04 13" are
// legally distinct filings.
//
// The harvest below reads the edition from the SAME ROW the form token was found
// on, byte-for-byte, cited to its own cell. When the row states no edition, none is
// attached — flag-not-invent, never a default.

const EDITION_HEADER_ALIASES = [
  'EDITION DATE', 'FORM EDITION DATE', 'FORM EDITION DATE (MM YY)',
  'FORM EDITION', 'EDITION', 'EFFECTIVE DATE', 'VERSION DATE',
]
/** Whitespace/punctuation-insensitive compare, matching isoImport's squishStr discipline. */
function squishHeader(v: unknown): string {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}
const EDITION_HEADER_SET = new Set(EDITION_HEADER_ALIASES.map(squishHeader))

/** Column index of this grid's EDITION-DATE column, or -1. Scans the leading rows
 *  (a framework sheet carries banner/group bands above its true header) and takes
 *  the FIRST exact alias hit — the same alias vocabulary isoImport declares, so the
 *  two agree on what an edition column is. */
export function editionColumnOf(grid: IsoGrid, scanRows = 20): number {
  const limit = Math.min(scanRows, grid.cells.length)
  for (let r = 0; r < limit; r++) {
    const row = grid.cells[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v !== 'string') continue
      if (EDITION_HEADER_SET.has(squishHeader(v))) return c
    }
  }
  return -1
}

/** The edition this row states, or null. Byte-for-byte apart from trimming — an
 *  edition is an identifier half, so nothing else is normalized. */
function editionAt(grid: IsoGrid, r: number, editionCol: number): string | null {
  if (editionCol < 0) return null
  const v = (grid.cells[r] ?? [])[editionCol]
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Deterministic sheet-name classification — MIRROR of cell-enum.mts classifySheet().
 *  Returns a non-null class for sheets whose whole disposition is decided by NAME
 *  (noise/log/schema): those sheets are never entity-harvested (their cells are not
 *  substance) though the whole-cell TOKEN scan still reads them (a dropdown source
 *  legitimately carries governed ids). */
export type SheetNameClass = 'noise' | 'log' | 'schema'
export function sheetNameClass(name: string): SheetNameClass | null {
  const n = name.trim().toLowerCase()
  if (/(^|\b)(table of contents|toc)(\b|$)/.test(n)) return 'noise'
  if (/(revision|version)\s*history/.test(n)) return 'log'
  if (/(observation|question).*log|log.*(observation|question)|question\s*&\s*observation/.test(n)) return 'log'
  if (/product\s*contacts?|contacts?$/.test(n)) return 'noise'
  if (/^definitions|definitions$|definitions-/.test(n)) return 'schema'
  if (/data\s*validation/.test(n)) return 'schema'
  if (/dropdown|\(hide\)/.test(n)) return 'noise'
  if (/archive|\bold\b|- archive/.test(n)) return 'noise'
  return null
}

// ─── Region segmentation (lightweight; BLANK_RUN_SPLIT mirrors census/regions.ts) ──
const BLANK_RUN_SPLIT = 2

export interface Region {
  rowStart: number
  rowEnd: number
  colStart: number
  colEnd: number
  headerRow: number | null
}

/** Split a grid into vertical regions on runs of >= 2 blank rows (single blank rows do
 *  not split — census law). Header = first region row that is mostly non-numeric strings
 *  followed by at least one more row. */
export function detectRegions(grid: IsoGrid): Region[] {
  const rows = grid.cells
  const occupied: number[] = []
  let maxCol = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? []
    let n = 0
    for (let c = 0; c < row.length; c++) {
      if (textOf(row[c] ?? null) !== '') { n++; if (c > maxCol) maxCol = c }
    }
    occupied.push(n)
  }
  const regions: Region[] = []
  let start = -1
  let blanks = 0
  const close = (end: number) => {
    if (start < 0) return
    regions.push({ rowStart: start, rowEnd: end, colStart: 0, colEnd: maxCol, headerRow: headerRowOf(grid, start, end) })
    start = -1
  }
  for (let r = 0; r < rows.length; r++) {
    if (occupied[r]! > 0) {
      if (start < 0) start = r
      blanks = 0
    } else if (start >= 0 && ++blanks >= BLANK_RUN_SPLIT) {
      close(r - blanks)
      blanks = 0
    }
  }
  close(rows.length - 1)
  return regions.filter(rg => rg.rowEnd >= rg.rowStart)
}

function headerRowOf(grid: IsoGrid, rowStart: number, rowEnd: number): number | null {
  // The header is the FIRST row carrying the MAXIMUM number of mostly-string cells in the
  // leading window: title rows ("PRODUCT FRAMEWORK") and section bands ("PRODUCT HIERARCHY" /
  // "COVERAGE DETAILS") have few cells; the real header row names every column.
  let best: number | null = null
  let bestValues = 0
  for (let r = rowStart; r <= Math.min(rowStart + 8, rowEnd - 1); r++) {
    const row = grid.cells[r] ?? []
    let strings = 0, values = 0
    for (const v of row) {
      const s = textOf(v ?? null)
      if (s === '') continue
      values++
      if (typeof v === 'string' && !/^\d+([.,]\d+)?$/.test(s)) strings++
    }
    if (values >= 2 && strings / values >= 0.6 && values > bestValues) { best = r; bestValues = values }
  }
  return best
}

// ─── Result shape ───────────────────────────────────────────────────────────────
/** A per-workbook enum domain harvested from a Data Validation sheet (item 15).
 *  `range` cites the source cells (e.g. "Data Validation!E5:E9"). */
export interface EnumDomain {
  field: string
  values: string[]
  range: string
}

export interface ConservationResult {
  products: PlannedEntity[]
  coverages: PlannedEntity[]
  forms: PlannedEntity[]
  rules: PlannedEntity[]
  /** Generic limit/deductible-family region tables (append to plan.ldTables). */
  ldTables: PlannedEntity[]
  /** Generic rate/factor-family region tables (append to plan.rtTables) — item 14. */
  rtTables: PlannedEntity[]
  /** Item 15: enum domains harvested from Data Validation sheets (schema-learning). */
  enumDomains: EnumDomain[]
  /** Cell-grain consumption claims for the accounting/census export. */
  consumed: ConsumedSpanRec[]
  /** Per-mechanism counts for the plan notice. */
  stats: Record<string, number>
  /** Substance sheets the pass could not harvest at all (flag-not-invent residue). */
  unharvestedSheets: string[]
}

export interface ConservationInput {
  grids: readonly IsoGrid[]
  /** Sheets a named parser consumed (span-claimed). */
  consumedSheets: ReadonlySet<string>
  /** Lowercased refIds already planned (all arrays). */
  existingRefIds: ReadonlySet<string>
  /** Lowercased names already planned, by family. */
  existingProductNames: ReadonlySet<string>
  existingCoverageNames: ReadonlySet<string>
  /** Existing planned coverage count from the framework grid (drives second-chance). */
  frameworkCoverageCount: number
  frameworkSheet: string | null
  /** SYNTH prefix, e.g. 'GL' (falls back to 'WB'). */
  refPrefix: string
  /** NAMED FLAG — form-edition harvest (see EDITION_HEADER_ALIASES above).
   *  Off leaves the pre-fix path byte-identical: a form token mints a form with
   *  `formNumber` and nothing else. On, a form token whose row also states an
   *  EDITION DATE carries that edition, cited to its own cell. */
  harvestFormEditions?: boolean
}

// ─── The pass ─────────────────────────────────────────────────────────────────
export function runConservationPass(input: ConservationInput): ConservationResult {
  const res: ConservationResult = {
    products: [], coverages: [], forms: [], rules: [], ldTables: [], rtTables: [],
    enumDomains: [], consumed: [], stats: {}, unharvestedSheets: [],
  }
  const prefix = /^[A-Za-z]{2,6}$/.test(input.refPrefix) ? input.refPrefix.toUpperCase() : 'WB'
  const seenRefIds = new Set<string>(input.existingRefIds)
  const synthSeq: Record<string, number> = {}
  const bump = (k: string) => { res.stats[k] = (res.stats[k] ?? 0) + 1 }
  const mintSynth = (kind: string): string => {
    const n = (synthSeq[kind] = (synthSeq[kind] ?? 0) + 1)
    return `${prefix}.SYNTH.${kind}.${String(n).padStart(3, '0')}`
  }
  const entity = (
    refId: string, name: string, citation: string, mechanism: string,
    extra?: Record<string, unknown>,
  ): PlannedEntity => ({
    docId: refIdToDocId(refId),
    refId,
    label: `${refId} — ${name}`,
    data: {
      refId, name,
      conservation: mechanism,
      needsReview: true,
      citation,
      ...extra,
    },
  })

  // (1) WHOLE-WORKBOOK TOKEN HARVEST — every REFID_RE token, all sheets (consumed included:
  // a framework row can carry governed ids the named parser never lifted). Token is the
  // byte-for-byte refId; kind from its own grammar; unknown-kind tokens are review-flagged
  // rules (an id referenced by the source whose family the source does not establish).
  for (const g of input.grids) {
    for (let r = 0; r < g.cells.length; r++) {
      const row = g.cells[r] ?? []
      for (let c = 0; c < row.length; c++) {
        const v = row[c] ?? null
        if (typeof v !== 'string' && typeof v !== 'number') continue
        const s = String(v)
        const matches = s.match(REFID_RE)
        if (!matches) continue
        for (const tok of matches) {
          const key = tok.toLowerCase()
          if (seenRefIds.has(key) || SYNTH_MARK.test(tok)) continue
          seenRefIds.add(key)
          const cite = cellRefOf(g.sheet, r, c)
          const kind = refIdSegmentKind(tok)
          const e = entity(tok, tok, cite, 'refid-token')
          if (kind === 'product') { res.products.push(e); bump('token.product') }
          // LOB ids are hierarchy nodes — the coverage family is their governed home
          // (the dual-family goldens annotate them as coverage-kind entities).
          else if (kind === 'coverage' || kind === 'lob') { res.coverages.push(e); bump('token.coverage') }
          else if (kind === 'form') { res.forms.push(e); bump('token.form') }
          else if (kind === 'rating') {
            if (/^LD/i.test(tok)) { res.ldTables.push(e); bump('token.ldTable') }
            else { res.rtTables.push(e); bump('token.rtTable') }
          }
          else { e.data['kindUnknown'] = true; res.rules.push(e); bump('token.rule') }
          res.consumed.push({ sheet: g.sheet, rowStart: r, rowEnd: r, colStart: c, colEnd: c, reason: 'conserve:refid-token' })
        }
      }
    }
  }

  // (2) WHOLE-WORKBOOK FORM-TOKEN HARVEST — ISO form numbers ("CG 00 01"), normalized the
  // way the floor counts them; one form entity per distinct token.
  const formTokens = new Set<string>()
  const harvestEditions = input.harvestFormEditions === true
  for (const g of input.grids) {
    // One header scan per grid, not per cell — the column is a property of the sheet.
    const editionCol = harvestEditions ? editionColumnOf(g) : -1
    for (let r = 0; r < g.cells.length; r++) {
      const row = g.cells[r] ?? []
      for (let c = 0; c < row.length; c++) {
        const v = row[c] ?? null
        if (typeof v !== 'string') continue
        const matches = v.match(FORM_RE)
        if (!matches) continue
        for (const raw of matches) {
          const tok = raw.replace(/[ \-]+/g, ' ').trim()
          const key = tok.toLowerCase()
          if (formTokens.has(key) || seenRefIds.has(key)) continue
          formTokens.add(key)
          seenRefIds.add(key)
          // The edition this row states about this form. Absent → nothing is
          // attached; the source not stating an edition is a fact, not a gap to fill.
          const edition = editionAt(g, r, editionCol)
          const extra: Record<string, unknown> = { formNumber: tok }
          if (edition !== null) {
            extra['edition'] = edition
            extra['editionCitation'] = cellRefOf(g.sheet, r, editionCol)
            bump('form.token.edition')
          }
          res.forms.push(entity(tok, tok, cellRefOf(g.sheet, r, c), 'form-token', extra))
          bump('form.token')
          res.consumed.push({ sheet: g.sheet, rowStart: r, rowEnd: r, colStart: c, colEnd: c, reason: 'conserve:form-token' })
          // The edition cell is CONSUMED by this form — without the span it stays
          // UNACCOUNTED and the sweeper re-classifies a cell we just read.
          if (edition !== null) {
            res.consumed.push({ sheet: g.sheet, rowStart: r, rowEnd: r, colStart: editionCol, colEnd: editionCol, reason: 'conserve:form-edition' })
          }
        }
      }
    }
  }

  // (3) FRAMEWORK PRODUCT-COLUMN HARVEST — a multi-product framework sheet names its
  // products in a PRODUCT hierarchy column the single-product parse collapses. Harvest
  // distinct-per-sheet PRODUCT-column values as review-flagged SYNTH products. Runs on the
  // framework sheet even when it produced (the products are what it under-produced).
  const fwGrid = input.frameworkSheet ? input.grids.find(g => g.sheet === input.frameworkSheet) : undefined
  if (fwGrid) {
    const regions = detectRegions(fwGrid)
    for (const rg of regions) {
      if (rg.headerRow === null) continue
      const header = fwGrid.cells[rg.headerRow] ?? []
      const prodCols = header
        .map((v, c) => ({ c, h: textOf(v ?? null).replace(/\s+/g, ' ').toUpperCase() }))
        .filter(x => x.h === 'PRODUCT' || x.h === 'PRODUCT NAME' || x.h === 'PROGRAM')
        .map(x => x.c)
      const seenHere = new Set<string>()
      for (const c of prodCols) {
        for (let r = rg.headerRow + 1; r <= rg.rowEnd; r++) {
          const label = textOf(fwGrid.cells[r]?.[c] ?? null)
          if (isBlankish(label) || /^\d+([.,]\d+)?$/.test(label)) continue
          const key = label.toLowerCase()
          if (seenHere.has(key)) continue
          seenHere.add(key)
          res.products.push(entity(mintSynth('PROD'), label, cellRefOf(fwGrid.sheet, r, c), 'framework-product-column'))
          bump('name.product')
          res.consumed.push({ sheet: fwGrid.sheet, rowStart: r, rowEnd: r, colStart: c, colEnd: c, reason: 'conserve:framework-product-column' })
        }
      }
    }
  }

  // (4)-(6) SHEET-SEMANTIC HARVESTS over sheets the named parsers left unconsumed (plus a
  // second chance on a framework sheet that yielded zero coverages). Name-classified
  // noise/log/schema sheets are never entity-harvested. Name dedupe is PER SHEET: each
  // sheet's assertion of an entity is conserved (near-dup folding is the plan reviewer's
  // call, never a silent authority pick).
  const conservable = input.grids.filter(g =>
    !sheetNameClass(g.sheet) &&
    (!input.consumedSheets.has(g.sheet) ||
      (g.sheet === input.frameworkSheet && input.frameworkCoverageCount === 0)))

  for (const g of conservable) {
    const regions = detectRegions(g)
    if (regions.length === 0) { res.unharvestedSheets.push(g.sheet); continue }
    const sheetLower = g.sheet.toLowerCase()
    const isProductSheet = /product\s*(inventory|overview)|program\s*version/.test(sheetLower)
    const isCoverageLike =
      /coverage|cvg|\bcov\b|product component model|product framework/.test(sheetLower) ||
      g.sheet === input.frameworkSheet
    const isDocumentSheet = /\bdocuments?\b|\bforms?\b/.test(sheetLower)
    let harvested = false
    const seenProductsHere = new Set<string>()
    const seenCoveragesHere = new Set<string>()
    const seenFormsHere = new Set<string>()

    for (const rg of regions) {
      const dataStart = rg.headerRow !== null ? rg.headerRow + 1 : rg.rowStart
      // Header-driven label columns: prefer columns whose header names the family
      // (COVERAGE / SUB COVERAGE / PRODUCT / FORM ...); fall back to the leftmost column
      // with >= 2 distinct non-blank strings.
      const header = rg.headerRow !== null ? (g.cells[rg.headerRow] ?? []) : []
      const headerText = (c: number) => textOf(header[c] ?? null).replace(/\s+/g, ' ').toUpperCase()
      const colsMatching = (re: RegExp): number[] => {
        const out: number[] = []
        for (let c = rg.colStart; c <= rg.colEnd; c++) if (re.test(headerText(c))) out.push(c)
        return out
      }
      let coverageCols = isCoverageLike ? colsMatching(/^(SUB ?)?COVERAGE( NAME)?S?$/) : []
      // Product columns: any product-inventory sheet (fallback allowed), and — header-driven
      // only — the PRODUCT hierarchy column of framework-family sheets (a near-dup PCM copy
      // asserts its product too; the fold is the reviewer's).
      let productCols = (isProductSheet || isCoverageLike) ? colsMatching(/^PRODUCT( NAME)?$|^PROGRAM$/) : []
      let formCols = isDocumentSheet ? colsMatching(/FORM|DOCUMENT|TITLE|NAME/) : []
      const fallbackLabelCol = ((): number => {
        for (let c = rg.colStart; c <= rg.colEnd; c++) {
          const seen = new Set<string>()
          for (let r = dataStart; r <= rg.rowEnd; r++) {
            const v = g.cells[r]?.[c] ?? null
            if (typeof v === 'string' && !isBlankish(v.trim())) seen.add(v.trim().toLowerCase())
          }
          if (seen.size >= 2) return c
        }
        return -1
      })()
      if (isCoverageLike && coverageCols.length === 0 && fallbackLabelCol >= 0) coverageCols = [fallbackLabelCol]
      if (isProductSheet && productCols.length === 0 && fallbackLabelCol >= 0) productCols = [fallbackLabelCol]
      if (formCols.length === 0 && isDocumentSheet && fallbackLabelCol >= 0) formCols = [fallbackLabelCol]

      const harvestCols = (
        cols: number[], seenHere: Set<string>, push: (e: PlannedEntity) => void,
        synthKind: string, mechanism: string, stat: string,
      ): void => {
        for (const c of cols) {
          for (let r = dataStart; r <= rg.rowEnd; r++) {
            const row = g.cells[r] ?? []
            const label = textOf(row[c] ?? null)
            if (isBlankish(label) || /^\d+([.,]\d+)?$/.test(label)) continue
            const key = label.toLowerCase()
            if (seenHere.has(key)) continue
            seenHere.add(key)
            const residue = row
              .map(v => textOf(v ?? null))
              .filter((s, i) => i !== c && s !== '')
              .slice(0, 24)
            push(entity(mintSynth(synthKind), label, cellRefOf(g.sheet, r, c), mechanism, { sourceValues: residue }))
            bump(stat)
            harvested = true
          }
        }
        if (cols.length > 0) {
          res.consumed.push({ sheet: g.sheet, rowStart: rg.rowStart, rowEnd: rg.rowEnd, colStart: rg.colStart, colEnd: rg.colEnd, reason: 'conserve:named-rows' })
        }
      }

      if (productCols.length > 0 || coverageCols.length > 0 || (isDocumentSheet && formCols.length > 0)) {
        harvestCols(productCols, seenProductsHere, e => res.products.push(e), 'PROD', 'product-sheet', 'name.product')
        harvestCols(coverageCols, seenCoveragesHere, e => res.coverages.push(e), 'COV', 'coverage-sheet', 'name.coverage')
        harvestCols(formCols, seenFormsHere, e => res.forms.push(e), 'FORM', 'document-sheet', 'name.form')
      } else {
        // Generic region => one review-flagged TABLE entity carrying the region's verbatim
        // values (bounded). Rate-ish content classifies rt, else ld-family (both satisfy the
        // /table/i kind family in scoring; neither is fabricated — the region IS a table).
        const title = regionTitle(g, rg)
        const values: string[] = []
        outer: for (let r = rg.rowStart; r <= rg.rowEnd; r++) {
          const row = g.cells[r] ?? []
          for (let c = rg.colStart; c <= rg.colEnd; c++) {
            const s = textOf(row[c] ?? null)
            if (s === '') continue
            values.push(s)
            if (values.length >= 400) break outer
          }
        }
        if (values.length === 0) continue
        // Family split (item 14): rate/factor content is a rate table; limit/deductible
        // content is an LD reference table; anything else defaults to the LD family.
        const scope = `${g.sheet} ${title}`
        const rateish = /rate|factor|loss cost|premium/i.test(scope) && !/limit|deductible/i.test(scope)
        const e = entity(
          mintSynth(rateish ? 'RTB' : 'TBL'),
          title || `${g.sheet} region ${rg.rowStart + 1}-${rg.rowEnd + 1}`,
          cellRefOf(g.sheet, rg.rowStart, rg.colStart),
          'generic-region',
          { sourceValues: values, region: `${cellRefOf(g.sheet, rg.rowStart, rg.colStart)}:${colLabel(rg.colEnd)}${rg.rowEnd + 1}` },
        )
        if (rateish) res.rtTables.push(e); else res.ldTables.push(e)
        bump(rateish ? 'region.rt' : 'region.ld')
        res.consumed.push({ sheet: g.sheet, rowStart: rg.rowStart, rowEnd: rg.rowEnd, colStart: rg.colStart, colEnd: rg.colEnd, reason: 'conserve:generic-region' })
        harvested = true
      }
    }
    if (!harvested) res.unharvestedSheets.push(g.sheet)
  }

  // (7) ITEM 15 — schema-learning pre-pass: harvest per-workbook enum domains from
  // Data Validation sheets (layout: a field-name header row, allowed values stacked below,
  // e.g. SECURA IM "Data Validation!E5:E9" = the coverageEffect domain). The domains are
  // surfaced verbatim + cited; typed-field enrichment happens fill-only in enrichFromDomains.
  for (const g of input.grids) {
    if (!/data\s*validation/i.test(g.sheet)) continue
    const regions = detectRegions(g)
    for (const rg of regions) {
      if (rg.headerRow === null) continue
      const header = g.cells[rg.headerRow] ?? []
      for (let c = rg.colStart; c <= rg.colEnd; c++) {
        const field = textOf(header[c] ?? null).replace(/\s+/g, ' ').trim()
        if (field === '' || isBlankish(field)) continue
        const values: string[] = []
        let first = -1, last = -1
        for (let r = rg.headerRow + 1; r <= rg.rowEnd; r++) {
          const s = textOf(g.cells[r]?.[c] ?? null)
          if (s === '') continue
          values.push(s)
          if (first < 0) first = r
          last = r
        }
        if (values.length < 2) continue // a domain is a vocabulary, not a lone value
        const fieldKey = camelize(field)
        if (fieldKey === '') continue // punctuation-only header cell is not a field
        res.enumDomains.push({
          field: fieldKey,
          values,
          range: `${g.sheet}!${colLabel(c)}${first + 1}:${colLabel(c)}${last + 1}`,
        })
        bump('overlay.domain')
      }
      res.consumed.push({ sheet: g.sheet, rowStart: rg.rowStart, rowEnd: rg.rowEnd, colStart: rg.colStart, colEnd: rg.colEnd, reason: 'conserve:enum-domains' })
    }
  }
  if (res.enumDomains.length > 0) enrichFromDomains(res)

  return res
}

function camelize(header: string): string {
  const words = header.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  return words.map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join('')
}

/** ITEM 15 application — FILL-ONLY: when a conserved entity's residue carries a value that
 *  belongs to exactly one harvested domain, type it onto the entity as that field. Never
 *  overwrites an existing field; never coerces a value not verbatim in the domain. */
function enrichFromDomains(res: ConservationResult): void {
  const byValue = new Map<string, { field: string; hits: number }>()
  for (const d of res.enumDomains) {
    for (const v of d.values) {
      const key = v.toLowerCase()
      const cur = byValue.get(key)
      if (cur && cur.field !== d.field) cur.hits++ // ambiguous across domains — never applied
      else if (!cur) byValue.set(key, { field: d.field, hits: 1 })
    }
  }
  const apply = (e: PlannedEntity): void => {
    const residue = e.data['sourceValues']
    if (!Array.isArray(residue)) return
    for (const raw of residue) {
      const hit = byValue.get(String(raw).toLowerCase())
      if (!hit || hit.hits > 1) continue
      if (e.data[hit.field] !== undefined) continue // fill-only
      e.data[hit.field] = String(raw)
    }
  }
  for (const arr of [res.products, res.coverages, res.forms, res.rules, res.ldTables, res.rtTables]) arr.forEach(apply)
}

function regionTitle(g: IsoGrid, rg: Region): string {
  // A region's title: the first non-blank string cell of its first row (common layout for
  // stacked tables: "Rule 85 BG1 Class Loss Costs" above the matrix).
  const row = g.cells[rg.rowStart] ?? []
  for (let c = rg.colStart; c <= rg.colEnd; c++) {
    const s = textOf(row[c] ?? null)
    if (s !== '' && !/^\d+([.,]\d+)?$/.test(s)) return s.slice(0, 120)
  }
  return ''
}
