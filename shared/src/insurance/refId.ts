// shared/src/insurance/refId.ts — THE canonical refId -> docId mint.
//
// BACKLOG_SEED item 1 (RISK_REGISTER R1): the platform had three docId minters
// with two conventions — the case-preserving mapper `dashId` ("GL.COV.001" ->
// "GL-COV-001") and two lowercasing server mints ("gl-cov-001"). The parentId
// validator (server/lib/data.js) resolves only the case-preserving form, so any
// child minted lowercase while its parentId stayed dotted-uppercase was dropped
// with HTTP 422 INVALID_PARENT on non-ISO-joined paths (CSV/text uploads carry
// no isoGrids; brain-only entities have no ISO counterpart).
//
// This module is the single source of truth. Semantics are EXACTLY the historic
// mapper dashId: dots become dashes, case preserved, nothing else touched.
// refIds are byte-for-byte load-bearing (CLAUDE.md) — no trimming, no case
// folding, no collapsing. Do not add "sanitization" here: a transform of the
// refId is a transform of entity identity, version chains, and audit paths.

/** Canonical docId for a refId: dots -> dashes, case preserved ("GL.COV.001" -> "GL-COV-001"). */
export function refIdToDocId(refId: string): string {
  return refId.replace(/\./g, '-')
}

/** Historic mapper name for the same mint — kept as an alias so existing
 *  call sites and docs stay valid. `dashId === refIdToDocId` by construction. */
export const dashId = refIdToDocId
