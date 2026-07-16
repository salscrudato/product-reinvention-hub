// shared/src/import/census/detectors.ts — deterministic structure detectors (CE1-S5).
//
// Each detector is a pure function over census records: it OBSERVES and reports;
// no detector changes extraction policy (CE3 owns policy flips — hidden-sheet
// extraction, version-copy folding, etc.). Signals here FEED existing seams:
// header signals augment the stage-2 scorer's candidates (never replace them),
// form-token counts are counting-invariant lower bounds for eval work, the
// alias/enum harvest is backlog-item-15 groundwork.

import type { NormalizedCell, HeaderCandidate } from '../structure/types'
import { US_STATE_CODES, hasWideStateColumns } from '../structure/layoutDetector'
import { isDefinitionsSheetName, parseDefinitionsSheet } from '../structure/definitionsParser'
import type { DefinitionsEntry } from '../structure/types'
import { FORM_TOKEN } from '../../insurance/conceptMatch'
import type { CellRecord, RawCensusSheet, SheetCensus, WorkbookCensus } from './types'

// ── shared access helper ──────────────────────────────────────────────────────

/** Sparse row/col lookup over a sheet census. */
export function cellsGrid(census: SheetCensus): Map<string, CellRecord> {
  const m = new Map<string, CellRecord>()
  for (const c of census.cells) m.set(`${c.row}:${c.col}`, c)
  return m
}

function nonEmptyRows(census: SheetCensus): Map<number, CellRecord[]> {
  const rows = new Map<number, CellRecord[]>()
  for (const c of census.cells) {
    const list = rows.get(c.row)
    if (list) list.push(c)
    else rows.set(c.row, [c])
  }
  return rows
}

// ── (a) header lock v2 signals ────────────────────────────────────────────────

export interface HeaderRowSignals {
  row: number
  formattingShift: boolean  // bold row sitting on a non-bold block
  typeShift: boolean        // string row sitting on a numeric block
  aliasHits: number         // squished labels found in the caller-supplied alias set
}

/** Formatting/type/alias signals per candidate row (first `limit` rows).
 *  Aliases arrive squished (A-Z0-9 only) from the caller so the census stays
 *  decoupled from any one field dictionary. */
export function headerLockV2Signals(census: SheetCensus, aliasSquished?: ReadonlySet<string>, limit = 15): HeaderRowSignals[] {
  const rows = nonEmptyRows(census)
  const out: HeaderRowSignals[] = []
  const boldRatio = (r: number) => {
    const cells = rows.get(r) ?? []
    return cells.length === 0 ? 0 : cells.filter(c => c.format.bold).length / cells.length
  }
  const stringRatio = (r: number) => {
    const cells = rows.get(r) ?? []
    return cells.length === 0 ? 0 : cells.filter(c => c.type === 'string').length / cells.length
  }
  const numericBelow = (r: number) => {
    let numeric = 0, total = 0
    for (let rr = r + 1; rr <= r + 3; rr++) {
      for (const c of rows.get(rr) ?? []) { total++; if (c.type === 'number' || c.type === 'date' || c.type === 'formula') numeric++ }
    }
    return total === 0 ? 0 : numeric / total
  }
  const scanTo = Math.min(limit, census.dims.rows)
  for (let r = 0; r < scanTo; r++) {
    const cells = rows.get(r)
    if (!cells || cells.length === 0) continue
    const formattingShift = boldRatio(r) >= 0.6 && boldRatio(r + 1) < 0.3
    const typeShift = stringRatio(r) >= 0.8 && numericBelow(r) >= 0.5
    let aliasHits = 0
    if (aliasSquished && aliasSquished.size > 0) {
      for (const c of cells) {
        const sq = c.verbatim.toUpperCase().replace(/[^A-Z0-9]/g, '')
        if (sq && aliasSquished.has(sq)) aliasHits++
      }
    }
    out.push({ row: r, formattingShift, typeShift, aliasHits })
  }
  return out
}

/** Fold v2 signals into the EXISTING scorer's candidates as bounded bonuses —
 *  feeding stage-2, never replacing it. Deterministic and clamped to [0,1]. */
export function augmentHeaderCandidates(candidates: HeaderCandidate[], signals: HeaderRowSignals[]): HeaderCandidate[] {
  const byRow = new Map(signals.map(s => [s.row, s]))
  return candidates
    .map(c => {
      const s = byRow.get(c.rowIndex)
      if (!s) return c
      const bonus = (s.formattingShift ? 0.10 : 0) + (s.typeShift ? 0.10 : 0) + Math.min(0.05 * s.aliasHits, 0.15)
      return { ...c, score: Math.min(1, c.score + bonus) }
    })
    .sort((a, b) => b.score - a.score)
}

// ── (b) repeating-parent runs ─────────────────────────────────────────────────

export interface RepeatingParentColumn { col: number; repeatFraction: number; nonEmpty: number }

const PARENT_RUN_THRESHOLD = 0.35

/** Columns where >= 35% of consecutive non-empty value pairs repeat — the
 *  parent-label pattern (PCM StatPlan / SECURA PCM group columns). */
export function repeatingParentRuns(census: SheetCensus): RepeatingParentColumn[] {
  const byCol = new Map<number, CellRecord[]>()
  for (const c of census.cells) {
    const list = byCol.get(c.col)
    if (list) list.push(c)
    else byCol.set(c.col, [c])
  }
  const out: RepeatingParentColumn[] = []
  for (const [col, cells] of byCol) {
    if (cells.length < 4) continue
    cells.sort((a, b) => a.row - b.row)
    let pairs = 0, repeats = 0
    for (let i = 1; i < cells.length; i++) {
      pairs++
      if (cells[i]!.valueHash === cells[i - 1]!.valueHash) repeats++
    }
    const repeatFraction = pairs === 0 ? 0 : repeats / pairs
    if (repeatFraction >= PARENT_RUN_THRESHOLD) out.push({ col, repeatFraction, nonEmpty: cells.length })
  }
  return out.sort((a, b) => a.col - b.col)
}

// ── (c) staircase / indent hierarchy ──────────────────────────────────────────

export interface StaircaseSignal { col: number; kind: 'indent' | 'leading-space'; levels: number; laddered: number }

/** Columns whose values climb an indent ladder — either real cell indent
 *  (format.indent) or leading-space prefixes. `levels` counts distinct depths. */
export function staircaseHierarchy(census: SheetCensus): StaircaseSignal[] {
  const byCol = new Map<number, CellRecord[]>()
  for (const c of census.cells) {
    if (c.type !== 'string') continue
    const list = byCol.get(c.col)
    if (list) list.push(c)
    else byCol.set(c.col, [c])
  }
  const out: StaircaseSignal[] = []
  for (const [col, cells] of byCol) {
    if (cells.length < 4) continue
    const indentLevels = new Set<number>()
    let indented = 0
    for (const c of cells) {
      indentLevels.add(c.format.indent)
      if (c.format.indent > 0) indented++
    }
    if (indentLevels.size >= 2 && indented >= 2) {
      out.push({ col, kind: 'indent', levels: indentLevels.size, laddered: indented })
      continue
    }
    const spaceLevels = new Set<number>()
    let spaced = 0
    for (const c of cells) {
      const lead = (c.verbatim.match(/^ */) ?? [''])[0].length
      spaceLevels.add(lead)
      if (lead > 0) spaced++
    }
    if (spaceLevels.size >= 2 && spaced >= 2) {
      out.push({ col, kind: 'leading-space', levels: spaceLevels.size, laddered: spaced })
    }
  }
  return out.sort((a, b) => a.col - b.col)
}

// ── (d) form-token grammar ────────────────────────────────────────────────────

// General bureau grammar derived from the corpus: 2-3 uppercase letters, then
// 2-4 space-separated 2-char groups where the FIRST group may be alphabetic
// ("CG DS 01", "PN HO 01") and later groups are digit pairs ("CG 20 10 04 13" =
// form + edition). Second alternative: prefix + one 3-4 digit block ("AC 900").
// Carrier variants beyond this ride on conceptMatch.FORM_TOKEN below.
export const FORM_TOKEN_GENERAL = /\b[A-Z]{2,3}(?: (?:\d{2}|[A-Z]{2}))(?: \d{2}){1,3}\b|\b[A-Z]{2,3} \d{3,4}\b/g

/** Distinct form tokens in one sheet (counting-invariant lower bound). */
export function formTokenCensus(census: SheetCensus): { distinct: string[]; count: number } {
  const found = new Set<string>()
  for (const c of census.cells) {
    if (c.type !== 'string') continue
    const up = c.verbatim.toUpperCase().replace(/\s+/g, ' ')
    for (const m of up.match(FORM_TOKEN_GENERAL) ?? []) found.add(m.trim())
    for (const m of up.match(FORM_TOKEN) ?? []) found.add(m.replace(/\s+/g, ' ').trim())
  }
  const distinct = [...found].sort()
  return { distinct, count: distinct.length }
}

// ── (e) state lexicon / orientation ───────────────────────────────────────────

export interface StateSignal {
  orientation: 'STATE_COLUMNS' | 'STATE_LIST' | 'NONE'
  stateColumnsRow: number | null   // header row carrying the state band
  stateListCols: number[]          // columns whose values are mostly state codes
}

/** Classify how a sheet carries state applicability: a state-COLUMNS matrix
 *  (GL Product Framework's 50-column band) vs a state LIST column. */
export function stateLexicon(census: SheetCensus, normalized: NormalizedCell[][]): StateSignal {
  // Columns matrix: any of the first 15 rows carries >= 3 state-code headers.
  let stateColumnsRow: number | null = null
  for (let r = 0; r < Math.min(15, normalized.length); r++) {
    if (hasWideStateColumns(normalized[r] ?? [])) { stateColumnsRow = r; break }
  }
  // List: a column with >= 5 non-empty values of which >= 60% are state codes.
  const byCol = new Map<number, { total: number; states: number }>()
  for (const c of census.cells) {
    if (c.type !== 'string') continue
    const s = byCol.get(c.col) ?? { total: 0, states: 0 }
    s.total++
    if (US_STATE_CODES.has(c.verbatim.trim().toUpperCase())) s.states++
    byCol.set(c.col, s)
  }
  const stateListCols = [...byCol.entries()]
    .filter(([, s]) => s.total >= 5 && s.states / s.total >= 0.6)
    .map(([col]) => col)
    .sort((a, b) => a - b)
  const orientation = stateColumnsRow !== null ? 'STATE_COLUMNS' : stateListCols.length > 0 ? 'STATE_LIST' : 'NONE'
  return { orientation, stateColumnsRow, stateListCols }
}

// ── (f) id-column profiler ────────────────────────────────────────────────────

// Dot-grammar refId shapes: "GL.COV.001", "IM.COV044.00", "PR.COV001.0",
// "CORE.COV.001.001" — an uppercase-led token with >= 2 total segments and at
// least one digit. Deliberately broader than any one line's registry scheme.
export const REFID_SHAPE = /^[A-Z][A-Z0-9]{0,7}(?:\.[A-Z0-9]{1,10}){1,4}$/i

export interface IdColumnProfile { col: number; refIdRatio: number; nonEmpty: number }
export interface IdProfile { columns: IdColumnProfile[]; prefixes: Record<string, number> }

/** Per-column refId-shape density + per-workbook-sheet prefix census. */
export function idColumnProfile(census: SheetCensus): IdProfile {
  const byCol = new Map<number, { total: number; ids: number }>()
  const prefixes: Record<string, number> = {}
  for (const c of census.cells) {
    if (c.type !== 'string') continue
    const v = c.verbatim.trim()
    const s = byCol.get(c.col) ?? { total: 0, ids: 0 }
    s.total++
    if (REFID_SHAPE.test(v) && /\d/.test(v)) {
      s.ids++
      const prefix = v.split('.')[0]!.toUpperCase()
      prefixes[prefix] = (prefixes[prefix] ?? 0) + 1
    }
    byCol.set(c.col, s)
  }
  const columns = [...byCol.entries()]
    .map(([col, s]) => ({ col, refIdRatio: s.total === 0 ? 0 : s.ids / s.total, nonEmpty: s.total }))
    .filter(p => p.refIdRatio >= 0.5 && p.nonEmpty >= 3)
    .sort((a, b) => a.col - b.col)
  return { columns, prefixes }
}

// ── (g) near-duplicate sheet fingerprints ─────────────────────────────────────

export interface SheetCluster {
  basis: 'headerSig' | 'name'
  sheets: Array<{ name: string; nonEmpty: number; sampleHash: string; hidden: boolean }>
}

const VERSIONISH = /\s*\(\s*\d+\s*\)\s*$|\b(hacked|old|copy|backup|scratch|final|v\d+)\b/gi

/** Cluster version-copy sheets: same non-empty headerSig, or same
 *  version-word-stripped name. The census only REPORTS clusters — the
 *  extract-all + fold + conflict-to-review policy is CE3's, not ours. */
export function nearDuplicateSheetClusters(workbook: WorkbookCensus): SheetCluster[] {
  const clusters: SheetCluster[] = []
  const row = (s: SheetCensus) => ({ name: s.name, nonEmpty: s.nonEmpty, sampleHash: s.fingerprint.sampleHash, hidden: s.hidden })

  const bySig = new Map<string, SheetCensus[]>()
  for (const s of workbook.sheets) {
    if (!s.fingerprint.headerSig || s.nonEmpty === 0) continue
    const list = bySig.get(s.fingerprint.headerSig)
    if (list) list.push(s)
    else bySig.set(s.fingerprint.headerSig, [s])
  }
  const clustered = new Set<string>()
  for (const group of bySig.values()) {
    if (group.length < 2) continue
    clusters.push({ basis: 'headerSig', sheets: group.map(row) })
    for (const s of group) clustered.add(s.name)
  }

  const byBase = new Map<string, SheetCensus[]>()
  for (const s of workbook.sheets) {
    if (clustered.has(s.name) || s.nonEmpty === 0) continue
    const base = s.name.replace(VERSIONISH, '').replace(/\s+/g, ' ').trim().toUpperCase()
    if (!base || base === s.name.trim().toUpperCase()) continue
    const list = byBase.get(base)
    if (list) list.push(s)
    else byBase.set(base, [s])
  }
  for (const [base, group] of byBase) {
    // A version copy needs a surviving base or sibling to cluster with.
    const sibs = workbook.sheets.filter(s =>
      !group.includes(s) && s.name.replace(VERSIONISH, '').replace(/\s+/g, ' ').trim().toUpperCase() === base)
    const all = [...new Set([...group, ...sibs])]
    if (all.length >= 2) clusters.push({ basis: 'name', sheets: all.map(row) })
  }
  return clusters
}

// ── (h) Definitions + Data Validation harvest ─────────────────────────────────

export interface EnumDomain { sheet: string; ref: string; type: string; values: string[]; sourceRange: string | null }
export interface CensusAliasOverlay {
  definitions: Array<DefinitionsEntry & { sheet: string }>
  enumDomains: EnumDomain[]
  schemaCellRefs: string[]   // census refs consumed as SCHEMA by this harvest
}

/** Harvest per-workbook alias material (Definitions sheets) and enum domains
 *  (Data Validation lists). Backlog item 15 groundwork: an OBSERVED overlay
 *  record; wiring it into mapping is CE3's. Cells consumed here are returned as
 *  schemaCellRefs so the accounting can post SCHEMA. */
export function harvestAliasOverlay(raws: RawCensusSheet[], censuses: SheetCensus[]): CensusAliasOverlay {
  const definitions: Array<DefinitionsEntry & { sheet: string }> = []
  const enumDomains: EnumDomain[] = []
  const schemaCellRefs: string[] = []
  const censusByName = new Map(censuses.map(c => [c.name, c]))

  for (const raw of raws) {
    const census = censusByName.get(raw.name)
    if (census && isDefinitionsSheetName(raw.name)) {
      const normalized: NormalizedCell[][] = []
      for (let r = 0; r < census.dims.rows; r++) normalized.push(new Array(census.dims.cols).fill(null))
      for (const c of census.cells) {
        const asNumber = Number(c.verbatim)
        normalized[c.row]![c.col] = c.type === 'number' && Number.isFinite(asNumber) ? asNumber : c.verbatim
      }
      for (const d of parseDefinitionsSheet(normalized)) definitions.push({ ...d, sheet: raw.name })
      for (const c of census.cells) schemaCellRefs.push(c.ref)
    }
    for (const v of raw.validations ?? []) {
      if (v.type !== 'list' || v.formulae.length === 0) continue
      const f = String(v.formulae[0] ?? '')
      const inline = /^"(.*)"$/.exec(f.trim())
      enumDomains.push({
        sheet: raw.name,
        ref: v.ref,
        type: v.type,
        values: inline ? inline[1]!.split(',').map(s => s.trim()).filter(Boolean) : [],
        sourceRange: inline ? null : f,
      })
    }
  }
  return { definitions, enumDomains, schemaCellRefs }
}

// ── (i) hidden-sheet substance ────────────────────────────────────────────────

/** Hidden sheets carrying real substance (SECURA "Forms View - MTG", 2,072
 *  cells, is the live case). Observation only — extraction policy is CE3's. */
export function hiddenSheetSubstance(workbook: WorkbookCensus): Array<{ name: string; nonEmpty: number }> {
  return workbook.sheets.filter(s => s.hidden && s.nonEmpty > 0).map(s => ({ name: s.name, nonEmpty: s.nonEmpty }))
}
