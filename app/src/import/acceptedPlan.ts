// acceptedPlan — turn a reviewed proposal bundle into the ImportPlan that will actually
// be written. Two gates, both the reviewer's choice:
//   • section include toggles (coverages / tables / rules / rating), and
//   • per-item exclusions by docId — "import everything here except this one row".
// Pure + side-effect-free so the review count and the write use the identical result, and
// so the exclusion contract (excluded data is NEVER written) is unit-testable.
import type { UnifiedProposalBundle, FilingReviewSectionKey, ImportPlan, PlannedEntity } from '@pf/shared'

/** Re-parent any kept coverage whose parent did NOT survive the exclusion filter.
 *
 *  Excluding a parent used to leave its kept children pointing at a refId no longer in the
 *  plan. The server validates parentId live and rejects the write with INVALID_PARENT, which
 *  fails the ENTIRE Cosmos batch — so one dropped parent silently took the reviewer's kept
 *  children and every unrelated valid sibling with it, reported only as an aggregate "skipped".
 *
 *  Children are PROMOTED to top level, not dropped: the reviewer explicitly kept them, and
 *  promotion is already the importer's convention for an unresolvable parent (stage 7's
 *  `orphan-promoted`). One pass suffices — promotion sets parentId to null, so it can never
 *  strand a further child. A whole excluded chain resolves at once. */
function cascadeParentExclusions(coverages: PlannedEntity[]): PlannedEntity[] {
  if (coverages.length === 0) return coverages
  const present = new Set(coverages.map(c => c.refId).filter((r): r is string => typeof r === 'string' && r !== ''))
  return coverages.map(c => {
    const pid = c.data?.['parentId']
    if (typeof pid !== 'string' || pid === '' || present.has(pid)) return c
    return { ...c, data: { ...c.data, parentId: null, parentExcluded: pid, needsReview: true } }
  })
}

/** Writable-item count for a plan — matches importPlan()'s `total`. `?? []` guards a
 *  malformed bundle missing an array field. */
export function countPlan(p: ImportPlan): number {
  return (p.product ? 1 : 0) + (p.coverages ?? []).length + (p.forms ?? []).length +
    (p.rules ?? []).length + (p.formRules ?? []).length + (p.ratingProgram ? 1 : 0) +
    (p.ldTables ?? []).length + (p.rtTables ?? []).length
}

/** Build the plan to write: a section is kept only when its include toggle is on, and
 *  within a kept section any individually EXCLUDED item (by docId, falling back to refId)
 *  is dropped. Excluded items — and items in an unchecked section — never reach the write. */
export function acceptedPlan(
  bundle: UnifiedProposalBundle,
  accepted: Set<FilingReviewSectionKey>,
  excluded: ReadonlySet<string> = new Set(),
): ImportPlan {
  const p = bundle.plan
  const keepTables = accepted.has('tables') || accepted.has('rating')
  const keep = <T extends { docId?: string; refId?: string | null }>(arr: T[] | undefined, on: boolean): T[] =>
    on ? (arr ?? []).filter(e => !excluded.has(e.docId ?? e.refId ?? '')) : []
  return {
    ...p,
    coverages:     cascadeParentExclusions(keep(p.coverages, accepted.has('coverages'))),
    forms:         keep(p.forms, accepted.has('coverages')),
    rtTables:      keep(p.rtTables, keepTables),
    ldTables:      keep(p.ldTables, keepTables),
    rules:         keep(p.rules, accepted.has('rules')),
    formRules:     keep(p.formRules, accepted.has('rules')),
    ratingProgram: accepted.has('rating') && !excluded.has(p.ratingProgram?.docId ?? '') ? p.ratingProgram : null,
  }
}
