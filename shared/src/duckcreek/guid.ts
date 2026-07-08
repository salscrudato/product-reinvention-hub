// duckcreek/guid.ts — deterministic id derivation. Duck Creek instance data uses GUID
// `id` attributes carrying a type-prefix letter (c=coverage, l=limit, S=StatCode, …).
// The real system mints random GUIDs; we DERIVE them from each node's refId so the
// serializer's output is reproducible and diffable (change one refId ⇒ only that node's
// id changes). Pure TypeScript — no `crypto`, no randomness — so it runs identically in
// the browser, Cloud Functions and Vitest, and keeps shared/ platform-free.

// FNV-1a (32-bit) — a tiny, well-distributed non-cryptographic string hash. We only need
// stable, collision-resistant-enough ids for a few hundred nodes; global uniqueness is
// asserted by the validator, not assumed here.
function fnv1a32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    // h *= 16777619, kept in uint32 via Math.imul
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 32 uppercase hex chars (128 bits) derived from a seed string, matching the width of a
 *  Duck Creek GUID. Built from four salted FNV-1a passes so the whole width varies with
 *  the input (not just the low bits). */
export function guid128(seed: string): string {
  let out = ''
  for (let salt = 0; salt < 4; salt++) {
    out += fnv1a32(`${salt}:${seed}`).toString(16).padStart(8, '0')
  }
  return out.toUpperCase()
}

/** A prefixed id: the node type's letter followed by a 128-bit GUID derived from `seed`.
 *  `seed` must be globally unique per node (we use `<type>|<refId>` so two node types can
 *  safely share a refId — e.g. a coverage and a rule that reference the same id space). */
export function deriveId(prefixLetter: string, seed: string): string {
  return `${prefixLetter}${guid128(seed)}`
}
