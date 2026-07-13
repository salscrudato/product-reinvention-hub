// coverageHierarchy.ts — first-principles resolver for the coverage -> sub-coverage tree.
//
// WHAT MAKES A COVERAGE A SUB-COVERAGE (conceptual definition, format-agnostic):
//   A sub-coverage is a coverage that exists BENEATH a parent coverage — it narrows, extends,
//   or is a component of that parent (e.g. "Debris Removal" beneath "Building"). It never stands
//   on its own in the product hierarchy; it always resolves to exactly one parent coverage.
//
// Real workbooks encode that relationship in three different ways, and unseen formats will use
// some combination of the same structural signals. This resolver reads the SIGNALS, not any one
// template's layout, so it generalises:
//
//   SIGNAL 1 — explicit sub-coverage field. A dedicated "SUB-COVERAGE" column is populated on the
//     row while the "COVERAGE" column names the parent. (ISO GL, Sample Mutual Property, component-model IM.)
//   SIGNAL 2 — refId nesting. The row's refId strictly SEGMENT-nests under another coverage's
//     refId, e.g. GL.COV.001.001 under GL.COV.001. (Nested-id schemes.)
//   SIGNAL 3 — group + row context. Rows are grouped by a shared coverage name; the first row of a
//     group (no sub-coverage value) is the parent anchor, later rows are its children. (Sample Mutual
//     schemes, where the child's refId is a sibling counter — PR.COV001.5 — NOT a prefix child.)
//
// PARENT RESOLUTION PRECEDENCE (most structurally certain first):
//   1. refId segment-nesting — unambiguous when present.
//   2. coverage-group name match — the COVERAGE column names the parent; resolve to that group's
//      top-level anchor. This is what carries the Sample Mutual schemes, where refIds do not nest.
//   3. nearest preceding top-level coverage — last resort so a child is never dropped.
// A child that resolves to no parent is PROMOTED to top-level (never silently dropped); callers
// surface that as a warning.
//
// Ordering is by SOURCE ROW, never by refId string: Sample Mutual tails are not zero-padded (.1, .10, .3)
// so string/number sorts reorder siblings. Duplicate refIds keep the first occurrence.
//
// Pure TypeScript, zero platform imports. Consumed by the deterministic ISO mapper
// (isoImport.ts) and available to the server import brain for a single source of hierarchy truth.

/** One coverage row as read from a source grid, in source-row order. */
export interface CoverageRow {
  /** Traceability id, verbatim (e.g. "GL.COV.001.001", "PR.COV001.5"). */
  refId: string
  /** The COVERAGE column value — names the (parent) coverage. May be '' when only a sub is given. */
  coverageName: string
  /** The SUB-COVERAGE column value — names the child. '' when the row is a top-level coverage. */
  subCoverageName: string
  /** 0-based source row index; defines sibling order and "nearest preceding" resolution. */
  rowIndex: number
}

/** A coverage placed in the hierarchy. */
export interface ResolvedCoverage {
  refId: string
  /** Display name: the sub-coverage name for a child, else the coverage name. */
  name: string
  /** Parent coverage refId, or null for a top-level coverage. */
  parentRefId: string | null
  /** True when this coverage resolved to a parent. */
  isSub: boolean
  /** Sibling order within the parent (or among top-level coverages), 1-based, in source order. */
  order: number
  /** How the parent was resolved — for transparency / debugging. 'orphan-promoted' means the row
   *  expressed sub-coverage intent (a sub name or a nesting refId) but no real parent could be
   *  found, so it was promoted to a top-level coverage. 'none' is a genuine top-level. */
  parentSignal: 'refid-nesting' | 'group-name' | 'nearest-preceding' | 'orphan-promoted' | 'none'
}

/** Uppercase + single-spaced key for coverage-name matching (tolerant of casing / spacing noise). */
function nameKey(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim()
}

/** Split a refId into dot-delimited segments, dropping empties. */
function segs(refId: string): string[] {
  return refId.split('.').filter(Boolean)
}

/** True when `prefix` is a strict SEGMENT prefix of `candidate` (candidate has more segments and
 *  every prefix segment matches). Segment-wise so "PR.COV001.1" is NOT a prefix of "PR.COV001.10". */
function isSegmentPrefix(prefix: string[], candidate: string[]): boolean {
  if (prefix.length >= candidate.length) return false
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== candidate[i]) return false
  return true
}

/**
 * Resolve the coverage/sub-coverage tree from coverage rows in source order.
 * Deterministic and pure. Never drops a row; a parentless child is promoted to top-level.
 */
export function resolveCoverageHierarchy(rows: CoverageRow[]): ResolvedCoverage[] {
  const out: ResolvedCoverage[] = []
  const seen = new Set<string>()

  // Parent-resolution state, maintained in source order.
  const topLevelByName = new Map<string, string>()   // coverage-group name -> anchor refId
  const known: { refId: string; segs: string[] }[] = [] // every accepted coverage, for nesting lookup
  let lastTopLevelRefId: string | null = null
  let lastCoverageName = ''   // for fill-forward of merged/blank COVERAGE cells

  // Sibling order counters.
  let topOrder = 0
  const childOrder = new Map<string, number>()

  for (const raw of rows) {
    const refId = raw.refId.trim()
    if (!refId || seen.has(refId)) continue           // dedup: first occurrence wins
    let coverageName = raw.coverageName.trim()
    const subName = raw.subCoverageName.trim()
    // Fill-forward: a sub row with a blank COVERAGE cell continues the merged coverage above it
    // (real books merge the COVERAGE column across a coverage's sub rows; the reader sees the value
    // only on the anchor row and null on the continuation rows). Only inherit for sub rows so a
    // blank identity/header row is still skipped below.
    if (coverageName) lastCoverageName = coverageName
    else if (subName && lastCoverageName) coverageName = lastCoverageName
    if (!coverageName && !subName) continue            // not a coverage row

    const mySegs = segs(refId)

    // SIGNAL 2 — refId segment-nesting: the longest known coverage whose refId is a strict
    // segment-prefix of this one is a structurally-certain parent.
    let nestParent: string | null = null
    for (const k of known) {
      if (isSegmentPrefix(k.segs, mySegs)) {
        if (!nestParent || k.segs.length > segs(nestParent).length) nestParent = k.refId
      }
    }

    // A sub name identical to the coverage name is the coverage repeating its own name on the
    // top-level row (a common Sample Mutual pattern: COVERAGE="Ordinance or Law", SUB="Ordinance Or Law")
    // — it is the coverage itself, not a child, so it does not count as an explicit sub signal.
    const explicitSub = subName !== '' && nameKey(subName) !== nameKey(coverageName)
    // A row is a sub-coverage when the sub field distinguishes it (SIGNAL 1) or its refId nests
    // under an existing coverage (SIGNAL 2 / 3). Otherwise it is a top-level coverage.
    const isSub = explicitSub || nestParent !== null

    if (!isSub) {
      // Top-level coverage. Its COVERAGE name anchors the group for later children.
      const name = coverageName || subName
      topOrder += 1
      out.push({ refId, name, parentRefId: null, isSub: false, order: topOrder, parentSignal: 'none' })
      if (coverageName) topLevelByName.set(nameKey(coverageName), refId)
      lastTopLevelRefId = refId
      known.push({ refId, segs: mySegs })
      seen.add(refId)
      continue
    }

    // Sub-coverage. Resolve the parent by precedence:
    //   1. refId segment-nesting (structurally certain).
    //   2. coverage-group name match (the COVERAGE column names the parent).
    //   3. nearest preceding top-level — ONLY when the COVERAGE cell is blank (positional
    //      inference for indented layouts). When the COVERAGE cell is populated but matches no
    //      top-level, the named parent is genuinely missing: we PROMOTE to top-level rather than
    //      assert a false relationship to an unrelated neighbour (dangling-parent repair).
    let parentRefId: string | null = null
    let signal: ResolvedCoverage['parentSignal'] = 'none'
    if (nestParent) {
      parentRefId = nestParent
      signal = 'refid-nesting'
    } else if (coverageName && topLevelByName.has(nameKey(coverageName))) {
      parentRefId = topLevelByName.get(nameKey(coverageName))!
      signal = 'group-name'
    } else if (!coverageName && lastTopLevelRefId) {
      parentRefId = lastTopLevelRefId
      signal = 'nearest-preceding'
    }

    const name = subName || coverageName
    if (parentRefId) {
      const n = (childOrder.get(parentRefId) ?? 0) + 1
      childOrder.set(parentRefId, n)
      out.push({ refId, name, parentRefId, isSub: true, order: n, parentSignal: signal })
    } else {
      // Orphan — the row wanted a parent (sub name or nesting refId) but none resolved. Promote to
      // top-level so it is never dropped, and flag it so callers can surface a review warning.
      topOrder += 1
      out.push({ refId, name, parentRefId: null, isSub: false, order: topOrder, parentSignal: 'orphan-promoted' })
      if (coverageName) topLevelByName.set(nameKey(coverageName), refId)
      lastTopLevelRefId = refId
    }
    known.push({ refId, segs: mySegs })
    seen.add(refId)
  }

  return out
}
