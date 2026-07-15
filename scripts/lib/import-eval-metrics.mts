/**
 * scripts/lib/import-eval-metrics.mts — pure metric functions for the import
 * eval (ledger F20). Kept CLI-free so vitest can lock them.
 *
 * Why these exist: an eval that only scores fields the golden tracks cannot
 * see fabrication (extra entities were unpenalized), missing linkage
 * (parentId / formNumbers / ldTableRef edges were unscored), lost candidates
 * (no conservation check), or citations that don't resolve against the source
 * (a truthy citation string passed). Each function below closes one of those
 * blind spots and is wired into scripts/import-eval.mts pass/fail.
 */

export interface EvalEntity { kind: string; refId: string; fields: Record<string, unknown> }

const key = (e: EvalEntity) => `${e.kind}|${e.refId}`

// ─── Fabrication: extracted entities with no golden counterpart ───────────────

export interface ExtrasMetrics {
  extraEntities: number
  extraEntityRate: number            // ALL extras / extracted — the offline gate (same parser both sides ⇒ 0)
  /** Extras claiming a SOURCE-shaped id the golden doesn't know — the live
   *  fabrication gate (ledger F30). An id the extraction says it READ from the
   *  document but the golden has never seen is the true fabrication signal. */
  fabricationExtras: number
  fabricationExtraRate: number
  /** SYNTH-marked extras: self-declared MINTED ids (platform convention) on
   *  brain-only content — cited rows from sheets the deterministic golden does
   *  not cover (the first completed CORE live run carried 345 of them: 234 real
   *  eligibility rules + 111 per-state factor tables, all citation-resolved,
   *  zero golden-name collisions). Gating these as "fabrication" makes the
   *  metric a formula that lies on partially-covered formats (F20's own
   *  lesson) — REPORTED, never gated. */
  syntheticExtras: number
  syntheticExtraRate: number
  extraByKind: Record<string, number>
  sampleExtras: Array<{ kind: string; refId: string }>
}

export function extrasMetrics(extracted: EvalEntity[], golden: EvalEntity[]): ExtrasMetrics {
  const gKeys = new Set(golden.map(key))
  const extras = extracted.filter(e => !gKeys.has(key(e)))
  // Segment-anchored: the platform mints SYNTH### / SYNTH.<token> — a real source
  // id containing the WORD "SYNTHETIC" must stay on the gated side (judge-demanded).
  const isSynthMarked = (id: string) => /(^|\.)SYNTH(?:[^A-Za-z]|$)/i.test(id)
  const synthetic = extras.filter(e => isSynthMarked(e.refId ?? ''))
  const fabrication = extras.filter(e => !isSynthMarked(e.refId ?? ''))
  const extraByKind: Record<string, number> = {}
  for (const e of extras) extraByKind[e.kind] = (extraByKind[e.kind] ?? 0) + 1
  return {
    extraEntities: extras.length,
    extraEntityRate: extracted.length > 0 ? extras.length / extracted.length : 0,
    fabricationExtras: fabrication.length,
    fabricationExtraRate: extracted.length > 0 ? fabrication.length / extracted.length : 0,
    syntheticExtras: synthetic.length,
    syntheticExtraRate: extracted.length > 0 ? synthetic.length / extracted.length : 0,
    extraByKind,
    sampleExtras: extras.slice(0, 15).map(e => ({ kind: e.kind, refId: e.refId })),
  }
}

// ─── Linkage: relationships are first-class (framework ID is the linkage key) ─

export interface LinkageMetrics {
  parentWithRef: number
  parentResolved: number
  parentResolutionRate: number       // internal consistency: 1.0 = no dangling parentId in the extracted set
  goldenParentEdges: number
  parentEdgesReproduced: number
  parentEdgeRecall: number           // golden (refId → parentId) edges reproduced by the extraction
  goldenFormEdges: number
  formEdgesReproduced: number
  formAttachmentRecall: number       // per-edge form-number attachment recall (finer than array equality)
  ldRefWithRef: number
  ldRefResolved: number
  ldTableRefResolutionRate: number | null  // null when the set carries no ldTableRef (report-only)
  sampleMisses: Array<{ metric: string; kind: string; refId: string; detail: string }>
}

export function linkageMetrics(extracted: EvalEntity[], golden: EvalEntity[]): LinkageMetrics {
  const exByKey = new Map(extracted.map(e => [key(e), e]))
  const misses: LinkageMetrics['sampleMisses'] = []
  const miss = (metric: string, e: { kind: string; refId: string }, detail: string) => {
    if (misses.length < 15) misses.push({ metric, kind: e.kind, refId: e.refId, detail })
  }

  // (a) Internal consistency: every non-empty coverage parentId must resolve to
  // an extracted coverage refId. Stage-7 orphan-promotion nulls dangling parents,
  // so anything below 1.0 in a returned plan is a pipeline defect.
  const covIds = new Set(extracted.filter(e => e.kind === 'coverage').map(e => e.refId))
  let parentWithRef = 0, parentResolved = 0
  for (const e of extracted) {
    if (e.kind !== 'coverage') continue
    const pid = e.fields['parentId']
    if (typeof pid !== 'string' || pid.trim() === '') continue
    parentWithRef++
    if (covIds.has(pid)) parentResolved++
    else miss('parentResolution', e, `parentId "${pid}" resolves to no extracted coverage`)
  }

  // (b) Recall of golden parent edges: the hierarchy the source defines must survive.
  let goldenParentEdges = 0, parentEdgesReproduced = 0
  for (const g of golden) {
    if (g.kind !== 'coverage') continue
    const gp = g.fields['parentId']
    if (typeof gp !== 'string' || gp.trim() === '') continue
    goldenParentEdges++
    const ex = exByKey.get(key(g))
    if (ex && ex.fields['parentId'] === gp) parentEdgesReproduced++
    else miss('parentEdgeRecall', g, `golden edge → "${gp}" ${ex ? `extracted "${String(ex.fields['parentId'] ?? '')}"` : '(entity missing)'}`)
  }

  // (c) Per-edge form-attachment recall: each golden formNumber on an entity is
  // one edge; the extraction must carry it. Finer-grained than the all-or-nothing
  // sorted-array equality the field score uses.
  let goldenFormEdges = 0, formEdgesReproduced = 0
  for (const g of golden) {
    const gf = g.fields['formNumbers']
    if (!Array.isArray(gf) || gf.length === 0) continue
    const ex = exByKey.get(key(g))
    const ef = Array.isArray(ex?.fields['formNumbers']) ? (ex!.fields['formNumbers'] as unknown[]).map(v => String(v).trim()) : []
    const efSet = new Set(ef)
    for (const f of gf) {
      goldenFormEdges++
      if (efSet.has(String(f).trim())) formEdgesReproduced++
      else miss('formAttachmentRecall', g, `form "${String(f)}" not attached in extraction`)
    }
  }

  // (d) ldTableRef resolution (report-only until the string convention is
  // verified against real goldens): a rule's LD/RT table pointer must land on an
  // extracted table.
  const tableIds = new Set(extracted.filter(e => e.kind === 'ldTable' || e.kind === 'rtTable').map(e => e.refId))
  let ldRefWithRef = 0, ldRefResolved = 0
  for (const e of extracted) {
    const ref = e.fields['ldTableRef']
    if (typeof ref !== 'string' || ref.trim() === '') continue
    ldRefWithRef++
    if (tableIds.has(ref)) ldRefResolved++
    else miss('ldTableRefResolution', e, `ldTableRef "${ref}" resolves to no extracted table`)
  }

  return {
    parentWithRef, parentResolved,
    parentResolutionRate: parentWithRef > 0 ? parentResolved / parentWithRef : 1,
    goldenParentEdges, parentEdgesReproduced,
    parentEdgeRecall: goldenParentEdges > 0 ? parentEdgesReproduced / goldenParentEdges : 1,
    goldenFormEdges, formEdgesReproduced,
    formAttachmentRecall: goldenFormEdges > 0 ? formEdgesReproduced / goldenFormEdges : 1,
    ldRefWithRef, ldRefResolved,
    ldTableRefResolutionRate: ldRefWithRef > 0 ? ldRefResolved / ldRefWithRef : null,
    sampleMisses: misses,
  }
}

// ─── Conservation: candidates = accepted + unresolved (+ legitimate joins) ────

export interface ConservationMetrics {
  stage4Candidates: number | null
  planEntities: number
  unresolvedCount: number | null
  countsIdentityOk: boolean | null   // bundle.counts.proposed === accepted + unresolved
  lossDelta: number | null           // max(0, stage4 - plan - unresolved); positive = candidates LOST
}

export function conservationMetrics(input: {
  stage4Count?: number | null
  planEntities: number
  unresolvedCount?: number | null
  counts?: { proposed?: number; accepted?: number; unresolved?: number } | null
}): ConservationMetrics {
  const { stage4Count, planEntities, unresolvedCount, counts } = input
  const countsIdentityOk = counts && typeof counts.proposed === 'number'
    ? counts.proposed === (counts.accepted ?? 0) + (counts.unresolved ?? 0)
    : null
  // Negative deltas are legitimate (the deterministic ISO join APPENDS mapper-only
  // entities, so the plan can exceed stage-4 candidates); only a POSITIVE delta is
  // loss. stage4 unknown (severed stream / old dump) → null, never a fake zero.
  const lossDelta = typeof stage4Count === 'number' && typeof unresolvedCount === 'number'
    ? Math.max(0, stage4Count - planEntities - unresolvedCount)
    : null
  return {
    stage4Candidates: stage4Count ?? null,
    planEntities,
    unresolvedCount: unresolvedCount ?? null,
    countsIdentityOk,
    lossDelta,
  }
}

// ─── Citation resolution: accepted values must resolve against the source ─────

export interface ProvenanceRow { sheet?: string; cell?: string; verbatim?: string; field?: string; refId?: string }
export interface GridLike { sheet: string; cells: unknown[][] }

export interface CitationResolution {
  checked: number
  resolved: number
  citationResolvableRate: number | null  // null when nothing checkable (no locus rows)
  sampleMisses: Array<{ sheet: string; cell: string; verbatim: string; actual: string }>
}

const A1_RE = /^([A-Za-z]{1,3})(\d{1,7})$/
const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

// A provenance row resolves when its sheet+cell points into a real grid and the
// cell's value matches the recorded verbatim (byte-equal, containment for
// multi-value cells, or whitespace-folded). Placeholder citations — importer
// stamps like '(synthesized: …)' / '(deterministic ISO-family parse)' — carry
// no locus and are skipped: they are DERIVED provenance, not source claims.
export function resolveProvenanceRows(rows: ProvenanceRow[], grids: GridLike[]): CitationResolution {
  const bySheet = new Map<string, GridLike[]>()
  for (const g of grids) {
    const list = bySheet.get(g.sheet) ?? []
    list.push(g)
    bySheet.set(g.sheet, list)
  }
  let checked = 0, resolved = 0
  const sampleMisses: CitationResolution['sampleMisses'] = []
  for (const row of rows) {
    if (!row.sheet || !row.cell) continue
    const verbatim = String(row.verbatim ?? '')
    if (fold(verbatim) === '' || /^\(.*\)$/.test(verbatim)) continue
    const m = A1_RE.exec(String(row.cell).trim())
    if (!m) continue
    checked++
    const col = m[1]!.toUpperCase().split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1
    const r = Number(m[2]) - 1
    // Multi-document uploads suffix colliding sheet names with "(file.xlsx)" —
    // fall back to the unsuffixed name when the exact one is absent.
    const candidates = bySheet.get(row.sheet)
      ?? bySheet.get(row.sheet.replace(/\s*\([^)]*\)\s*$/, ''))
      ?? []
    let hit = false
    let actual = '(sheet not found)'
    for (const g of candidates) {
      const cv = g.cells[r]?.[col]
      const cellStr = cv === null || cv === undefined ? '' : String(cv)
      actual = cellStr
      if (cellStr === verbatim || cellStr.includes(verbatim) || fold(cellStr) === fold(verbatim) || fold(cellStr).includes(fold(verbatim))) { hit = true; break }
    }
    if (hit) resolved++
    else if (sampleMisses.length < 15) sampleMisses.push({ sheet: row.sheet, cell: String(row.cell), verbatim: verbatim.slice(0, 80), actual: actual.slice(0, 80) })
  }
  return {
    checked, resolved,
    citationResolvableRate: checked > 0 ? resolved / checked : null,
    sampleMisses,
  }
}
