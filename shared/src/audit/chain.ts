// chain.ts — tamper-evident hash chain over the atomic-mutation audit stream.
//
// Every audit event written by the server's mutate() envelope carries:
//   prevHash — the hash of the previous audit event for the SAME entityPath, read
//              from a persistent per-path `chainHead` doc that is upserted in the
//              SAME Cosmos transactional batch (so it can never drift from the
//              events). null only for the very first event of a path.
//   hash     — SHA-256 over the canonical JSON of the event's HASHED fields
//              (which include prevHash), so each event seals its content AND its link.
//
// The chainHead doc survives entity deletes, so a path has ONE unbroken chain for
// its whole lifetime — delete and re-create just keep appending. The verifier
// therefore needs no ordering assumptions at all: it reconstructs each chain by
// following prevHash links from the unique head (prevHash null) and flags
//   hash_mismatch — an event's content was altered (recomputed hash differs)
//   link_broken   — the chain start is missing (first event deleted or altered)
//   fork          — two events claim the same predecessor (an event was inserted)
//   orphaned      — events unreachable from the head (mid-chain deletion/edit)
//   tail_missing  — with an expected head anchor: the newest events were deleted
//
// Tail truncation (deleting the newest N events) is detectable only against the
// chainHead anchor, which is why the anchor rides the same transactional batch as
// the audit event it seals.
//
// Pure + dependency-free (no node:crypto) so `shared` stays platform-free; SHA-256 is
// implemented below and pinned by FIPS 180-4 test vectors in chain.test.ts.

// ─── SHA-256 (FIPS 180-4), dependency-free ────────────────────────────────────
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLen = bytes.length * 8
  // Pad: 0x80, zeros, 64-bit big-endian length -> total length is a multiple of 64
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000))
  dv.setUint32(padded.length - 4, bitLen >>> 0)

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Array<number>(64)

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('')
}

// ─── Canonical JSON (stable key order, recursive) ─────────────────────────────
// JSON.stringify key order is insertion order — the same logical object can
// serialize differently between writer and verifier. Canonicalize sorts every
// object's keys recursively so the hash is representation-independent.
export function canonicalize(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`
  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>).sort()
    return `{${keys
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalize((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return 'null' // functions/symbols cannot appear in stored audit events
}

// ─── Audit event shape + hashing ──────────────────────────────────────────────
export interface AuditChainEvent {
  id?: string
  tenantId: string
  entityPath: string
  entityType?: string | null
  op: string // create | update | delete
  actor?: unknown
  rev: number
  at: string // ISO timestamp
  source?: string | null // which write path produced this event
  diff?: unknown // { before, changed } field diff, null on delete
  prevHash: string | null
  hash?: string
}

/** The exact fields sealed by the hash — storage adornments (id, pk, kind, _rid…)
 *  are deliberately excluded so a Cosmos round-trip never changes the hash. */
export const AUDIT_HASH_FIELDS = [
  'tenantId', 'entityPath', 'entityType', 'op', 'actor', 'rev', 'at', 'source', 'diff', 'prevHash',
] as const

export function computeAuditHash(evt: Omit<AuditChainEvent, 'hash' | 'id'>): string {
  const subset: Record<string, unknown> = {}
  for (const f of AUDIT_HASH_FIELDS) subset[f] = (evt as Record<string, unknown>)[f] ?? null
  return sha256Hex(canonicalize(subset))
}

// ─── Verifier ────────────────────────────────────────────────────────────────
export interface ChainBreak {
  entityPath: string
  id?: string
  rev?: number
  reason: 'hash_mismatch' | 'link_broken' | 'fork' | 'orphaned' | 'tail_missing'
  detail: string
}

export interface ChainVerdict {
  ok: boolean
  /** hashed (chain-era) events verified */
  checked: number
  /** pre-chain events (no hash field) — skipped, reported for visibility */
  legacy: number
  /** distinct (tenantId, entityPath) chains examined */
  paths: number
  breaks: ChainBreak[]
}

const pathKey = (e: { tenantId: string; entityPath: string }) => `${e.tenantId} ${e.entityPath}`

/** Verify a set of audit events (any order, any mix of paths) by reconstructing
 *  each path's chain from its prevHash links. Events without a `hash` field
 *  predate the chain and are counted as legacy, not verified.
 *
 *  `expectedHeads` (optional): map of `${tenantId} ${entityPath}` to the hash
 *  stored in that path's chainHead doc. When provided, the reconstructed chain's
 *  final event must carry exactly that hash — this is what catches deletion of
 *  the NEWEST events (tail truncation), which link-checking alone cannot see. */
export function verifyAuditChain(events: AuditChainEvent[], expectedHeads?: Map<string, string>): ChainVerdict {
  const byPath = new Map<string, AuditChainEvent[]>()
  let legacy = 0
  for (const e of events) {
    if (e.hash === undefined || e.hash === null) { legacy++; continue }
    const key = pathKey(e)
    if (!byPath.has(key)) byPath.set(key, [])
    byPath.get(key)!.push(e)
  }

  const breaks: ChainBreak[] = []
  let checked = 0
  for (const [key, chain] of byPath) {
    const entityPath = chain[0].entityPath

    // 1. Content integrity: every event must hash to its stored hash.
    for (const e of chain) {
      checked++
      const recomputed = computeAuditHash(e)
      if (recomputed !== e.hash) {
        breaks.push({
          entityPath, id: e.id, rev: e.rev, reason: 'hash_mismatch',
          detail: `stored hash ${String(e.hash).slice(0, 12)} != recomputed ${recomputed.slice(0, 12)} — event content was altered`,
        })
      }
    }

    // 2. Link reconstruction: exactly one head, one successor per event, all reachable.
    const byPrev = new Map<string | null, AuditChainEvent[]>()
    for (const e of chain) {
      const k = e.prevHash ?? null
      if (!byPrev.has(k)) byPrev.set(k, [])
      byPrev.get(k)!.push(e)
    }
    const starts = byPrev.get(null) ?? []
    if (starts.length === 0) {
      breaks.push({
        entityPath, reason: 'link_broken',
        detail: 'no chain head found (every event claims a predecessor) — the first event was deleted or altered',
      })
      continue
    }
    if (starts.length > 1) {
      breaks.push({
        entityPath, id: starts[1].id, rev: starts[1].rev, reason: 'fork',
        detail: `${starts.length} events claim to start the chain (prevHash null)`,
      })
    }
    const visited = new Set<AuditChainEvent>()
    let cur: AuditChainEvent | undefined = starts[0]
    let tail: AuditChainEvent = starts[0]
    while (cur && !visited.has(cur)) {
      visited.add(cur)
      tail = cur
      const successors: AuditChainEvent[] = byPrev.get(cur.hash!) ?? []
      if (successors.length > 1) {
        breaks.push({
          entityPath, id: successors[1].id, rev: successors[1].rev, reason: 'fork',
          detail: `${successors.length} events claim the same predecessor ${String(cur.hash).slice(0, 12)} — an event was inserted`,
        })
      }
      cur = successors[0]
    }
    for (const e of chain) {
      if (!visited.has(e)) {
        breaks.push({
          entityPath, id: e.id, rev: e.rev, reason: 'orphaned',
          detail: `event is unreachable from the chain head — its predecessor (prevHash ${String(e.prevHash).slice(0, 12)}) is missing or altered`,
        })
      }
    }

    // 3. Tail anchor: the newest reconstructed event must match the chainHead doc.
    const expected = expectedHeads?.get(key)
    if (expected !== undefined && tail.hash !== expected) {
      breaks.push({
        entityPath, id: tail.id, rev: tail.rev, reason: 'tail_missing',
        detail: `chain ends at ${String(tail.hash).slice(0, 12)} but the chainHead anchor is ${expected.slice(0, 12)} — the newest event(s) were deleted`,
      })
    }
  }
  return { ok: breaks.length === 0, checked, legacy, paths: byPath.size, breaks }
}
