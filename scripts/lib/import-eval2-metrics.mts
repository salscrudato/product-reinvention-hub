/**
 * scripts/lib/import-eval2-metrics.mts — PURE gated metrics for eval v2 (CE2).
 *
 * CLI-free and I/O-free so vitest (tests/eval/import-eval2-metrics.test.ts) locks every
 * semantic. The wiring into pass/fail lives in scripts/import-eval2.mts. Every function
 * closes a way a green board could hide DATA LOSS:
 *   - accountingMetrics       a source cell present but never accounted for (the core loss gate)
 *   - goldenEntityRecall      a truth entity dropped from the plan
 *   - goldenNumericFidelity   a numeric value silently changed (1,528 -> 1528 is OK; 1,528 -> 1,528? no)
 *   - resolveCitations        a citation that does not resolve to its cell (invented provenance)
 *   - fabricationMetrics      an emitted refId that appears nowhere in the source (free invention)
 *   - linkage2                a dangling parent / unresolved table pointer (broken hierarchy)
 *   - countingInvariants      extracted count below the deterministic distinct-token floor (bulk loss)
 *   - needsReviewBand         annotation confidence band (0.00 on a real master is suspicious)
 *   - reconcileCensus         CE1 census vs CE2 cell-enum nonEmpty disagreement (hostile Q4)
 */
import {
  canonicalizeNumeric, isSubstance, accountingClassOf,
  type Golden2File,
} from './golden2-schema.mts'

export interface EvalEntity2 { kind: string; refId: string; fields: Record<string, unknown> }

// A source-shaped refId (carrier.token.digits or token.digits) — the shape the pipeline
// claims to have READ from the document. Mirrors cell-enum's REFID_RE anchoring.
const SOURCE_REFID_RE = /^[A-Za-z]{2,12}(?:[.\-_][A-Za-z]{1,8})?[.\-_]\d{1,6}$/
export function isSourceShapedRefId(refId: string): boolean {
  return SOURCE_REFID_RE.test(refId.trim())
}

// ─── (A) Accounting: every source cell must be accounted for ──────────────────
// `accounted` is the set of "Sheet!A1" loci the pipeline captured (from a live bundle's
// provenance, the deterministic plan's citations, or a CE1 census). Two non-redundant
// gates: entity-anchor cells have ZERO tolerance; the wider substance set gets 1.5% slack
// (an attribute occasionally folds into a parent legitimately).

export interface AccountingResult {
  entityCells: number
  entityAccounted: number
  unaccountedEntityCells: number          // BLOCKING == 0
  substanceCells: number
  substanceAccounted: number
  substanceCoverage: number               // BLOCKING >= 0.985 (per workbook)
  sampleUnaccounted: { locus: string; disposition: string; kind: string | null }[]
}

export function accountingMetrics(golden: Golden2File, accounted: Set<string>): AccountingResult {
  const acc = normalizeLocusSet(accounted)
  let entityCells = 0, entityAccounted = 0, substanceCells = 0, substanceAccounted = 0
  const sampleUnaccounted: AccountingResult['sampleUnaccounted'] = []
  for (const sh of golden.sheets) {
    for (const c of sh.cells) {
      const isEnt = c.disposition === 'ENTITY'
      const isSub = isSubstance(c.disposition)
      if (!isSub) continue
      const locus = normalizeLocus(`${sh.name}!${c.ref}`)
      const hit = acc.has(locus)
      substanceCells++
      if (hit) substanceAccounted++
      if (isEnt) { entityCells++; if (hit) entityAccounted++ }
      if (!hit && sampleUnaccounted.length < 40) sampleUnaccounted.push({ locus: `${sh.name}!${c.ref}`, disposition: c.disposition, kind: c.kind })
    }
  }
  return {
    entityCells, entityAccounted,
    unaccountedEntityCells: entityCells - entityAccounted,
    substanceCells, substanceAccounted,
    substanceCoverage: substanceCells > 0 ? substanceAccounted / substanceCells : 1,
    sampleUnaccounted,
  }
}

// Loci compare case-insensitively on the sheet name and upper-cased on the A1 ref, and
// tolerate the multi-doc "(file.xlsx)" sheet suffix the brain adds on collisions.
function normalizeLocus(locus: string): string {
  const i = locus.lastIndexOf('!')
  if (i < 0) return locus.toLowerCase()
  const sheet = locus.slice(0, i).replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
  const ref = locus.slice(i + 1).trim().toUpperCase()
  return `${sheet}!${ref}`
}
function normalizeLocusSet(s: Set<string>): Set<string> {
  const out = new Set<string>()
  for (const x of s) out.add(normalizeLocus(x))
  return out
}

// ─── (B) Golden entity recall (full-coverage files) ───────────────────────────

export interface EntityRecallResult { golden: number; found: number; recall: number; missing: { kind: string; refId: string | null; name: string }[] }

export function goldenEntityRecall(golden: Golden2File, extracted: EvalEntity2[]): EntityRecallResult {
  const byRef = new Map<string, EvalEntity2>()
  const byKindName = new Set<string>()
  for (const e of extracted) {
    if (e.refId) byRef.set(e.refId.trim().toLowerCase(), e)
    const nm = String(e.fields['name'] ?? '').trim().toLowerCase()
    if (nm) byKindName.add(`${e.kind}|${nm}`)
  }
  let g = 0, found = 0
  const missing: EntityRecallResult['missing'] = []
  for (const sh of golden.sheets) {
    for (const en of sh.entities) {
      g++
      const hit = en.refId
        ? byRef.has(en.refId.trim().toLowerCase())
        : byKindName.has(`${en.kind}|${en.name.trim().toLowerCase()}`)
      if (hit) found++
      else if (missing.length < 40) missing.push({ kind: en.kind, refId: en.refId, name: en.name })
    }
  }
  return { golden: g, found, recall: g > 0 ? found / g : 1, missing }
}

// ─── (C) Numeric fidelity ─────────────────────────────────────────────────────
// A claim = a numeric value the golden says belongs to an entity (harness derives it
// from the entity's ATTR cells resolved against the workbook). Fidelity 1.00 means every
// such value is present, canonicalized, on the matching extracted entity.

export interface NumericClaim { entityRef: string; value: string; label?: string }
export interface NumericFidelityResult { checked: number; matched: number; fidelity: number; misses: { entityRef: string; value: string; label?: string }[] }

export function goldenNumericFidelity(claims: NumericClaim[], extracted: EvalEntity2[]): NumericFidelityResult {
  const byRef = new Map<string, EvalEntity2>()
  for (const e of extracted) if (e.refId) byRef.set(e.refId.trim().toLowerCase(), e)
  let matched = 0
  const misses: NumericFidelityResult['misses'] = []
  for (const cl of claims) {
    const want = canonicalizeNumeric(cl.value)
    const e = byRef.get(cl.entityRef.trim().toLowerCase())
    const values = e ? Object.values(e.fields).flatMap(v => Array.isArray(v) ? v : [v]) : []
    const hit = want != null && values.some(v => canonicalizeNumeric(v) === want)
    if (hit) matched++
    else if (misses.length < 40) misses.push({ entityRef: cl.entityRef, value: cl.value, label: cl.label })
  }
  return { checked: claims.length, matched, fidelity: claims.length > 0 ? matched / claims.length : 1, misses }
}

// ─── (D) Citation resolution ──────────────────────────────────────────────────
// Byte-verify a citation against the actual cell text. Placeholder/synthesized citations
// ("(deterministic ISO parse)") carry no locus and are skipped. cellText resolves a
// (sheet, ref) to the workbook's flattened value or null.

export interface CitationClaim { citation: string; verbatim: string }
export interface CitationResolveResult { checked: number; resolved: number; rate: number | null; misses: { citation: string; verbatim: string; actual: string }[] }

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export function resolveCitations(claims: CitationClaim[], cellText: (sheet: string, ref: string) => string | null): CitationResolveResult {
  let checked = 0, resolved = 0
  const misses: CitationResolveResult['misses'] = []
  for (const cl of claims) {
    const i = cl.citation.lastIndexOf('!')
    if (i < 0) continue
    const sheet = cl.citation.slice(0, i)
    const ref = cl.citation.slice(i + 1)
    const verbatim = String(cl.verbatim ?? '')
    if (fold(verbatim) === '' || /^\(.*\)$/.test(verbatim.trim())) continue
    checked++
    const actual = cellText(sheet, ref) ?? cellText(sheet.replace(/\s*\([^)]*\)\s*$/, ''), ref) ?? ''
    if (actual === verbatim || actual.includes(verbatim) || fold(actual) === fold(verbatim) || fold(actual).includes(fold(verbatim))) resolved++
    else if (misses.length < 40) misses.push({ citation: cl.citation, verbatim: verbatim.slice(0, 80), actual: actual.slice(0, 80) })
  }
  return { checked, resolved, rate: checked > 0 ? resolved / checked : null, misses }
}

// ─── (E) Fabrication (floor-based; works on sampled goldens) ──────────────────
// An extracted entity whose refId LOOKS like a source id but appears nowhere in the raw
// workbook token set is free invention. Minted SYNTH ids are excluded (platform mints them).

export interface FabricationResult { extracted: number; sourceShaped: number; fabricated: number; rate: number; sample: { kind: string; refId: string }[] }
const isSynthMarked = (id: string) => /(^|\.)SYNTH(?:[^A-Za-z]|$)/i.test(id)

export function fabricationMetrics(extracted: EvalEntity2[], sourceRefTokens: Set<string>): FabricationResult {
  const src = new Set<string>(); for (const t of sourceRefTokens) src.add(t.trim().toLowerCase())
  let sourceShaped = 0, fabricated = 0
  const sample: FabricationResult['sample'] = []
  for (const e of extracted) {
    const id = (e.refId ?? '').trim()
    if (!id || isSynthMarked(id) || !isSourceShapedRefId(id)) continue
    sourceShaped++
    if (!src.has(id.toLowerCase())) { fabricated++; if (sample.length < 30) sample.push({ kind: e.kind, refId: id }) }
  }
  return { extracted: extracted.length, sourceShaped, fabricated, rate: extracted.length > 0 ? fabricated / extracted.length : 0, sample }
}

// ─── (F) Linkage: parent resolution + ldTableRef resolution ───────────────────

export interface Linkage2Result {
  parentWithRef: number; parentResolved: number; parentResolutionRate: number   // BLOCKING == 1
  ldRefWithRef: number; ldRefResolved: number; ldTableRefResolutionRate: number | null  // BLOCKING >= 0.95
  misses: { metric: string; refId: string; detail: string }[]
}

export function linkage2(extracted: EvalEntity2[]): Linkage2Result {
  const covIds = new Set(extracted.filter(e => e.kind === 'coverage' || e.kind === 'subCoverage').map(e => e.refId))
  const tableIds = new Set(extracted.filter(e => /table/i.test(e.kind)).map(e => e.refId))
  const misses: Linkage2Result['misses'] = []
  const miss = (m: string, refId: string, detail: string) => { if (misses.length < 30) misses.push({ metric: m, refId, detail }) }
  let parentWithRef = 0, parentResolved = 0, ldRefWithRef = 0, ldRefResolved = 0
  for (const e of extracted) {
    const pid = e.fields['parentId']
    if ((e.kind === 'coverage' || e.kind === 'subCoverage') && typeof pid === 'string' && pid.trim() !== '') {
      parentWithRef++
      if (covIds.has(pid)) parentResolved++; else miss('parentResolution', e.refId, `parentId "${pid}" resolves to no coverage`)
    }
    const ref = e.fields['ldTableRef']
    if (typeof ref === 'string' && ref.trim() !== '') {
      ldRefWithRef++
      if (tableIds.has(ref)) ldRefResolved++; else miss('ldTableRef', e.refId, `ldTableRef "${ref}" resolves to no table`)
    }
  }
  return {
    parentWithRef, parentResolved,
    parentResolutionRate: parentWithRef > 0 ? parentResolved / parentWithRef : 1,
    ldRefWithRef, ldRefResolved,
    ldTableRefResolutionRate: ldRefWithRef > 0 ? ldRefResolved / ldRefWithRef : null,
    misses,
  }
}

// ─── (F2) Golden hierarchy recall — a FLATTENED plan must not pass vacuously ────
// linkage2 only catches a DANGLING parentId in the extracted set; it is silent when the
// pipeline emits NO parents at all (every sub promoted to top-level). This scores the
// golden's OWN parentRef edges: each golden child with a parentRef must reappear in the
// plan as a child whose parentId resolves to the golden's parent (byte-identical refId).

export interface Golden2ParentEdge { child: string; parent: string }
export interface HierarchyRecallResult {
  goldenParentEdges: number
  reproduced: number
  recall: number                    // BLOCKING >= threshold (only when goldenParentEdges > 0)
  misses: { child: string; parent: string; detail: string }[]
}

export function hierarchyRecall(goldenEdges: Golden2ParentEdge[], extracted: EvalEntity2[]): HierarchyRecallResult {
  const byRef = new Map<string, EvalEntity2>()
  for (const e of extracted) if (e.refId) byRef.set(e.refId.trim().toLowerCase(), e)
  let reproduced = 0
  const misses: HierarchyRecallResult['misses'] = []
  for (const ge of goldenEdges) {
    const child = byRef.get(ge.child.trim().toLowerCase())
    const pid = child ? String(child.fields['parentId'] ?? '') : ''
    if (child && pid && pid.trim().toLowerCase() === ge.parent.trim().toLowerCase()) reproduced++
    else if (misses.length < 30) misses.push({ child: ge.child, parent: ge.parent, detail: !child ? 'child entity missing from plan' : !pid ? 'child promoted to top-level (parentId dropped)' : `parentId "${pid}" != golden parent "${ge.parent}"` })
  }
  return { goldenParentEdges: goldenEdges.length, reproduced, recall: goldenEdges.length > 0 ? reproduced / goldenEdges.length : 1, misses }
}

// ─── (G) Counting invariants (the bulk-loss floor) ────────────────────────────
// For each kind, the extracted count must be >= the deterministic distinct-token lower
// bound (and >= the golden's annotated count). A violation is bulk data loss.

export interface KindFloor { kind: string; floor: number; source: string }
export interface CountingResult { violations: { kind: string; floor: number; extracted: number; source: string }[]; ok: boolean }

export function countingInvariants(floors: KindFloor[], extractedCountByKind: Record<string, number>): CountingResult {
  const violations: CountingResult['violations'] = []
  for (const f of floors) {
    const got = extractedCountByKind[f.kind] ?? 0
    if (got < f.floor) violations.push({ kind: f.kind, floor: f.floor, extracted: got, source: f.source })
  }
  return { violations, ok: violations.length === 0 }
}

// ─── (H) needsReview band ─────────────────────────────────────────────────────

export interface NeedsReviewResult { total: number; queued: number; rate: number; band: 'ok' | 'warn' | 'suspicious' }

export function needsReviewBand(total: number, queued: number, isReferenceMaster: boolean): NeedsReviewResult {
  const rate = total > 0 ? queued / total : 0
  let band: NeedsReviewResult['band'] = 'ok'
  if (rate > 0.10) band = 'warn'
  // Exactly 0.00 on a real reference master is suspicious — a master with hundreds of
  // ambiguous cells that produced ZERO adjudications smells like the annotators rubber-stamped.
  else if (rate === 0 && isReferenceMaster && total > 200) band = 'suspicious'
  return { total, queued, rate, band }
}

// ─── (I) Census reconciliation (hostile self-review Q4) ───────────────────────
// If CE1's census and CE2's cell-enum disagree on a sheet's nonEmpty count, one is wrong.
// eval2 ships this so CE5 detects the divergence at merge instead of trusting a green board.

export interface CensusReconcileResult { disagreements: { sheet: string; enumCount: number; censusCount: number }[]; ok: boolean }

export function reconcileCensus(enumNonEmpty: Record<string, number>, censusNonEmpty: Record<string, number>): CensusReconcileResult {
  const disagreements: CensusReconcileResult['disagreements'] = []
  const sheets = new Set([...Object.keys(enumNonEmpty), ...Object.keys(censusNonEmpty)])
  for (const s of sheets) {
    const a = enumNonEmpty[s] ?? 0
    const b = censusNonEmpty[s] ?? 0
    if (a !== b) disagreements.push({ sheet: s, enumCount: a, censusCount: b })
  }
  return { disagreements, ok: disagreements.length === 0 }
}

// Re-exported for the harness so the accounting-class map has one home.
export { accountingClassOf }
