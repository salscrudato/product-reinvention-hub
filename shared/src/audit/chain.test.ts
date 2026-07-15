// chain.test.ts — audit hash-chain: SHA-256 correctness, canonical hashing,
// chain construction, and the tamper scenarios the verifier MUST catch.
import { describe, it, expect } from 'vitest'
import {
  sha256Hex, canonicalize, computeAuditHash, verifyAuditChain,
  type AuditChainEvent,
} from './chain'

// ─── SHA-256 pinned to FIPS 180-4 test vectors ───────────────────────────────
describe('sha256Hex', () => {
  it('matches the FIPS vector for the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
  it('matches the FIPS vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('matches the two-block vector (448-bit message)', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })
  it('matches the long-message vector (1,000,000 x "a", trimmed to 1000 for speed)', () => {
    expect(sha256Hex('a'.repeat(1000)))
      .toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })
  it('handles multi-byte UTF-8 input deterministically', () => {
    expect(sha256Hex('prämie €1,528 ✓')).toBe(sha256Hex('prämie €1,528 ✓'))
    expect(sha256Hex('prämie €1,528 ✓')).not.toBe(sha256Hex('prämie €1.528 ✓'))
  })
})

// ─── Canonical JSON ───────────────────────────────────────────────────────────
describe('canonicalize', () => {
  it('is key-order independent', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalize({ a: { c: 3, d: 2 }, b: 1 }))
  })
  it('treats undefined values as absent, null as null', () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}')
  })
  it('preserves array order (arrays are sequences, not sets)', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]))
  })
})

// ─── Chain fixtures ───────────────────────────────────────────────────────────
// A realistic 3-event lifecycle for one coverage under the probe tenant.
function buildChain(): AuditChainEvent[] {
  const base = {
    tenantId: 'audit-harden-probe',
    entityPath: 'products/P1/coverages/GL-COV-001',
    entityType: 'coverage',
    actor: { uid: 'probe', name: 'Probe User' },
    source: '/api/db/mutate',
  }
  const e1: AuditChainEvent = {
    ...base, id: 'aud:1', op: 'create', rev: 1, at: '2026-07-13T10:00:00.000Z',
    diff: { before: {}, changed: { name: 'Premises Liability', limit: 1000000 } },
    prevHash: null,
  }
  e1.hash = computeAuditHash(e1)
  const e2: AuditChainEvent = {
    ...base, id: 'aud:2', op: 'update', rev: 2, at: '2026-07-13T10:05:00.000Z',
    diff: { before: { limit: 1000000 }, changed: { limit: 2000000 } },
    prevHash: e1.hash,
  }
  e2.hash = computeAuditHash(e2)
  const e3: AuditChainEvent = {
    ...base, id: 'aud:3', op: 'update', rev: 3, at: '2026-07-13T10:10:00.000Z',
    diff: { before: { name: 'Premises Liability' }, changed: { name: 'Premises & Ops' } },
    prevHash: e2.hash,
  }
  e3.hash = computeAuditHash(e3)
  return [e1, e2, e3]
}

const KEY = 'audit-harden-probe products/P1/coverages/GL-COV-001'

describe('verifyAuditChain — clean chains', () => {
  it('verifies an intact chain', () => {
    const v = verifyAuditChain(buildChain())
    expect(v.ok).toBe(true)
    expect(v.checked).toBe(3)
    expect(v.paths).toBe(1)
    expect(v.breaks).toEqual([])
  })

  it('verifies regardless of input order (link-based, no sort assumptions)', () => {
    const [e1, e2, e3] = buildChain()
    expect(verifyAuditChain([e3, e1, e2]).ok).toBe(true)
  })

  it('hash is independent of storage adornments and key order', () => {
    const [e1] = buildChain()
    const roundTripped = JSON.parse(JSON.stringify({ _rid: 'xyz', pk: 't|c', kind: 'audit', ...e1 }))
    expect(computeAuditHash(roundTripped)).toBe(e1.hash)
  })

  it('chains straight through delete + re-create (rev resets, links do not)', () => {
    const [e1, e2, e3] = buildChain()
    const del: AuditChainEvent = {
      ...e3, id: 'aud:4', op: 'delete', rev: 4, at: '2026-07-13T11:00:00.000Z',
      diff: null, prevHash: e3.hash!,
    }
    del.hash = computeAuditHash(del)
    // Re-create: entity rev resets to 1, but prevHash comes from the chainHead doc.
    const recreate: AuditChainEvent = {
      ...e1, id: 'aud:5', op: 'create', rev: 1, at: '2026-07-13T12:00:00.000Z',
      prevHash: del.hash!,
    }
    recreate.hash = computeAuditHash(recreate)
    const v = verifyAuditChain([recreate, del, e1, e2, e3])
    expect(v.ok).toBe(true)
    expect(v.checked).toBe(5)
  })

  it('accepts a matching tail anchor and counts pre-chain events as legacy', () => {
    const [e1, e2, e3] = buildChain()
    const legacy = { ...e1, id: 'aud:0', rev: 0, hash: undefined, prevHash: null } as AuditChainEvent
    const v = verifyAuditChain([legacy, e1, e2, e3], new Map([[KEY, e3.hash!]]))
    expect(v.ok).toBe(true)
    expect(v.legacy).toBe(1)
    expect(v.checked).toBe(3)
  })
})

describe('verifyAuditChain — tamper detection (the point of the chain)', () => {
  it('flags content tampering: an edited diff breaks the event hash', () => {
    const [e1, e2, e3] = buildChain()
    const tampered = { ...e2, diff: { before: { limit: 1000000 }, changed: { limit: 9999999 } } }
    const v = verifyAuditChain([e1, tampered, e3])
    expect(v.ok).toBe(false)
    expect(v.breaks.some((b) => b.reason === 'hash_mismatch' && b.rev === 2)).toBe(true)
  })

  it('flags actor forgery: rewriting who did it breaks the hash', () => {
    const [e1, e2, e3] = buildChain()
    const forged = { ...e3, actor: { uid: 'someone-else', name: 'Not Me' } }
    const v = verifyAuditChain([e1, e2, forged])
    expect(v.ok).toBe(false)
    expect(v.breaks.some((b) => b.reason === 'hash_mismatch' && b.rev === 3)).toBe(true)
  })

  it('flags edit-and-rehash: a self-consistent rewrite orphans the successor', () => {
    const [e1, e2, e3] = buildChain()
    // Attacker edits e2 AND recomputes its hash so it self-validates…
    const edited = { ...e2, diff: { before: {}, changed: { limit: 5 } } }
    edited.hash = computeAuditHash(edited)
    // …but e3.prevHash still points at the ORIGINAL e2 hash, so e3 is orphaned.
    const v = verifyAuditChain([e1, edited, e3])
    expect(v.ok).toBe(false)
    expect(v.breaks.some((b) => b.reason === 'orphaned' && b.rev === 3)).toBe(true)
  })

  it('flags mid-chain event deletion (successor becomes unreachable)', () => {
    const [e1, , e3] = buildChain()
    const v = verifyAuditChain([e1, e3])
    expect(v.ok).toBe(false)
    expect(v.breaks.some((b) => b.reason === 'orphaned' && b.rev === 3)).toBe(true)
  })

  it('flags an inserted forged event as a fork', () => {
    const [e1, e2, e3] = buildChain()
    const injected: AuditChainEvent = {
      ...e2, id: 'aud:evil', rev: 2, at: '2026-07-13T10:06:00.000Z',
      diff: { before: {}, changed: { limit: 1 } }, prevHash: e1.hash!,
    }
    injected.hash = computeAuditHash(injected)
    const v = verifyAuditChain([e1, e2, injected, e3])
    expect(v.ok).toBe(false)
    expect(v.breaks.some((b) => b.reason === 'fork')).toBe(true)
  })

  it('flags destruction of the first event (no chain head remains)', () => {
    const [, e2, e3] = buildChain()
    const v = verifyAuditChain([e2, e3])
    expect(v.ok).toBe(false)
    expect(v.breaks.some((b) => b.reason === 'link_broken')).toBe(true)
  })

  it('flags tail truncation against the chainHead anchor', () => {
    const [e1, e2, e3] = buildChain()
    // The newest event (e3) is deleted; links alone cannot see it…
    expect(verifyAuditChain([e1, e2]).ok).toBe(true)
    // …but the chainHead anchor still says the chain must end at e3.
    const v = verifyAuditChain([e1, e2], new Map([[KEY, e3.hash!]]))
    expect(v.ok).toBe(false)
    expect(v.breaks.some((b) => b.reason === 'tail_missing')).toBe(true)
  })
})

// ─── Provenance (H4): AI/voice-authoring attestation sealed WITHOUT forking ─────
// A governed mutation may carry `provenance` (fleet-sourced model id, citation refs,
// confidence, authoredBy) so an AI/voice/restore-authored change is attributable. It is
// sealed into the audit hash CONDITIONALLY: present → tamper-evident; absent → the event
// hashes byte-identically to a pre-provenance (legacy) event, so no existing chain forks.
describe('provenance — attributable authoring sealed without forking the chain (H4)', () => {
  const base: AuditChainEvent = {
    tenantId: 't1', entityPath: 'products/P1', entityType: 'product',
    actor: { uid: 'ai', name: 'Import brain' }, source: '/api/db/mutateBatch',
    op: 'create', rev: 1, at: '2026-07-15T00:00:00.000Z',
    diff: { before: {}, changed: { name: 'X' } }, prevHash: null,
  }
  const PROV = { authoredBy: 'ai', model: 'claude-opus-4-8', citations: ['GL.COV.001'], confidence: 0.94 }

  it('an ABSENT provenance hashes IDENTICALLY (undefined ≡ null ≡ missing) — the no-fork guarantee', () => {
    const h = computeAuditHash(base)
    expect(computeAuditHash({ ...base, provenance: undefined })).toBe(h)
    expect(computeAuditHash({ ...base, provenance: null })).toBe(h)
  })

  it('a PRESENT provenance is COVERED by the hash (differs from the un-provenanced event)', () => {
    expect(computeAuditHash({ ...base, provenance: PROV })).not.toBe(computeAuditHash(base))
  })

  it('altering the model, citations, or confidence changes the hash (forgery is caught)', () => {
    const sealed = computeAuditHash({ ...base, provenance: PROV })
    expect(computeAuditHash({ ...base, provenance: { ...PROV, model: 'claude-haiku-4-5' } })).not.toBe(sealed)
    expect(computeAuditHash({ ...base, provenance: { ...PROV, citations: ['GL.COV.999'] } })).not.toBe(sealed)
    expect(computeAuditHash({ ...base, provenance: { ...PROV, confidence: 0.1 } })).not.toBe(sealed)
  })

  it('verify FLAGS provenance stripped OR altered after the write (hash_mismatch both ways)', () => {
    const evt: AuditChainEvent = { ...base, provenance: PROV }
    evt.hash = computeAuditHash(evt)               // sealed WITH provenance
    expect(verifyAuditChain([evt]).ok).toBe(true)  // intact verifies
    const stripped = { ...evt }; delete (stripped as Record<string, unknown>).provenance
    expect(verifyAuditChain([stripped]).breaks.some((b) => b.reason === 'hash_mismatch')).toBe(true)
    const altered = { ...evt, provenance: { ...PROV, confidence: 0.1 } }
    expect(verifyAuditChain([altered]).breaks.some((b) => b.reason === 'hash_mismatch')).toBe(true)
  })

  it('provenance is canonicalized (nested key order does not change the hash)', () => {
    const p1 = { authoredBy: 'ai', model: 'm', citations: ['a', 'b'] }
    const p2 = { citations: ['a', 'b'], model: 'm', authoredBy: 'ai' }
    expect(computeAuditHash({ ...base, provenance: p1 })).toBe(computeAuditHash({ ...base, provenance: p2 }))
  })

  it('a provenance-bearing event chains normally with legacy (un-provenanced) events', () => {
    // Mixed chain: e1 legacy (no provenance), e2 provenance-bearing — links + verify hold.
    const e1: AuditChainEvent = { ...base, id: 'aud:1' }
    e1.hash = computeAuditHash(e1)
    const e2: AuditChainEvent = {
      ...base, id: 'aud:2', op: 'update', rev: 2, at: '2026-07-15T00:05:00.000Z',
      diff: { before: { name: 'X' }, changed: { name: 'Y' } }, prevHash: e1.hash, provenance: PROV,
    }
    e2.hash = computeAuditHash(e2)
    expect(verifyAuditChain([e1, e2]).ok).toBe(true)
  })
})
