// validateAgainstExpected.ts — the pure OFFLINE JUDGE for the model-driven importer.
//
// Given the entities a producer emitted for a workbook and the hand-authored EXPECTED
// canonical snapshot for that workbook, it computes the full quality metric set with ZERO
// LLM calls: per-entity precision/recall/F1, refId-exactness %, parentId integrity (orphan
// count), enum conformance %, and silent-drop count (entity-bearing source rows that
// produced nothing). This is the deterministic scorer the extraction loop optimises against
// — a model proposes a mapping, this scores it, the loop keeps the best. Pure TypeScript.
//
// Alignment is by a stable NATURAL key (author-assigned; e.g. a coverage's normalized name,
// a form number) that is INDEPENDENT of the refId — so refId-exactness is a real, separately
// measured signal rather than trivially 100%. refIds and form numbers are compared verbatim.

import { CANONICAL_MAP, type CanonicalEntityKind } from './canonicalMap'

// ─── I/O shapes ────────────────────────────────────────────────────────────────────

/** One produced-or-expected entity, aligned by `key`. `refId` and (for coverages)
 *  `parentRefId` drive the refId-exactness and parentId-integrity checks; `fields`
 *  carries canonical field values for the enum-conformance check. */
export interface HarnessEntity {
  entityType:  CanonicalEntityKind
  key:         string                     // natural identity (NOT the refId)
  refId:       string | null
  parentRefId?: string | null             // coverages: the parent coverage's refId
  fields?:     Record<string, unknown>    // canonical field values (for enum conformance)
}

/** A hand-authored expected snapshot for one workbook / line. */
export interface ExpectedSnapshot {
  line:          string
  entities:      readonly HarnessEntity[]
  /** Identity of every entity-bearing source row; a produced set missing one is a silent
   *  drop. Defaults to the expected entity keys. */
  sourceRowKeys?: readonly string[]
}

export interface EntityScore {
  entityType: CanonicalEntityKind
  tp: number; fp: number; fn: number
  precision: number; recall: number; f1: number
}

export interface EnumViolation {
  entityType: CanonicalEntityKind
  key: string; field: string; value: unknown; allowed: readonly string[]
}

export interface ImportValidationReport {
  line:              string
  perEntity:         EntityScore[]
  overall:           { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }
  refIdExact:        number   // aligned pairs (expected refId ≠ null) with an exact produced refId
  refIdChecked:      number   // aligned pairs where the expected refId ≠ null
  refIdExactnessPct: number   // 100 * refIdExact / refIdChecked (100 when nothing to check)
  parentIdOrphans:   number
  orphanKeys:        string[]
  enumChecked:       number
  enumConformancePct: number  // 100 * conformant / enumChecked (100 when nothing to check)
  enumViolations:    EnumViolation[]
  silentDrops:       number
  silentDropKeys:    string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4
const pct = (num: number, den: number): number => (den === 0 ? 100 : round4((100 * num) / den))
const f1of = (p: number, r: number): number => (p + r === 0 ? 0 : round4((2 * p * r) / (p + r)))
/** `${type}::${key}` — global identity within a snapshot. */
const idOf = (e: HarnessEntity): string => `${e.entityType}::${e.key}`

/** Enum value-sets per (entity, field), harvested once from the canonical map. */
function enumSet(entity: CanonicalEntityKind, field: string): readonly string[] | undefined {
  return CANONICAL_MAP[entity].fields.find(f => f.field === field)?.enumValues
}

// ─── The scorer ────────────────────────────────────────────────────────────────────

export function validateAgainstExpected(
  produced: readonly HarnessEntity[],
  expected: ExpectedSnapshot,
): ImportValidationReport {
  // Index expected + produced by global id. On a key collision the FIRST wins (a producer
  // emitting the same key twice is a dedupe concern, not a scoring one).
  const expById = new Map<string, HarnessEntity>()
  for (const e of expected.entities) if (!expById.has(idOf(e))) expById.set(idOf(e), e)
  const prodById = new Map<string, HarnessEntity>()
  for (const p of produced) if (!prodById.has(idOf(p))) prodById.set(idOf(p), p)

  const types = new Set<CanonicalEntityKind>([
    ...expected.entities.map(e => e.entityType),
    ...produced.map(p => p.entityType),
  ])

  // ── per-entity precision / recall / F1 (set alignment by key) ──
  const perEntity: EntityScore[] = []
  let TP = 0, FP = 0, FN = 0
  for (const t of types) {
    const exp = new Set([...expById.keys()].filter(k => k.startsWith(`${t}::`)))
    const prod = new Set([...prodById.keys()].filter(k => k.startsWith(`${t}::`)))
    let tp = 0
    for (const k of prod) if (exp.has(k)) tp++
    const fp = prod.size - tp
    const fn = exp.size - tp
    TP += tp; FP += fp; FN += fn
    const precision = tp + fp === 0 ? 1 : round4(tp / (tp + fp))
    const recall = tp + fn === 0 ? 1 : round4(tp / (tp + fn))
    perEntity.push({ entityType: t, tp, fp, fn, precision, recall, f1: f1of(precision, recall) })
  }
  perEntity.sort((a, b) => a.entityType.localeCompare(b.entityType))
  const oP = TP + FP === 0 ? 1 : round4(TP / (TP + FP))
  const oR = TP + FN === 0 ? 1 : round4(TP / (TP + FN))

  // ── refId exactness (over key-aligned pairs whose expected refId is non-null) ──
  let refIdChecked = 0, refIdExact = 0
  for (const [id, exp] of expById) {
    if (exp.refId == null) continue
    const prod = prodById.get(id)
    if (!prod) continue          // a miss is captured by recall, not refId-exactness
    refIdChecked++
    if (prod.refId === exp.refId) refIdExact++
  }

  // ── parentId integrity (produced coverages whose parentRefId resolves to no produced coverage) ──
  const producedCovRefIds = new Set(
    produced.filter(p => p.entityType === 'coverage' && p.refId != null).map(p => p.refId as string),
  )
  const orphanKeys: string[] = []
  for (const p of produced) {
    if (p.entityType !== 'coverage') continue
    if (p.parentRefId != null && !producedCovRefIds.has(p.parentRefId)) orphanKeys.push(p.key)
  }

  // ── enum conformance (produced field values vs the canonical enum sets) ──
  let enumChecked = 0
  const enumViolations: EnumViolation[] = []
  for (const p of produced) {
    if (!p.fields) continue
    for (const [field, value] of Object.entries(p.fields)) {
      const allowed = enumSet(p.entityType, field)
      if (!allowed) continue
      enumChecked++
      if (!allowed.includes(String(value))) {
        enumViolations.push({ entityType: p.entityType, key: p.key, field, value, allowed })
      }
    }
  }
  const enumConformant = enumChecked - enumViolations.length

  // ── silent drops (entity-bearing source rows with no produced entity) ──
  const sourceRowKeys = expected.sourceRowKeys ?? expected.entities.map(idOf)
  const producedIds = new Set(prodById.keys())
  const silentDropKeys = [...sourceRowKeys].filter(k => !producedIds.has(k))

  return {
    line: expected.line,
    perEntity,
    overall: { tp: TP, fp: FP, fn: FN, precision: oP, recall: oR, f1: f1of(oP, oR) },
    refIdExact,
    refIdChecked,
    refIdExactnessPct: pct(refIdExact, refIdChecked),
    parentIdOrphans: orphanKeys.length,
    orphanKeys,
    enumChecked,
    enumConformancePct: pct(enumConformant, enumChecked),
    enumViolations,
    silentDrops: silentDropKeys.length,
    silentDropKeys,
  }
}
