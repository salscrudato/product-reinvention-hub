// guid.test.ts — the deterministic id derivation must be reproducible (same seed ⇒ same
// id, across runs/platforms), correctly shaped (prefix letter + 32 uppercase hex), and
// collision-free in practice for our node counts.
import { describe, it, expect } from 'vitest'
import { guid128, deriveId } from './guid'

describe('guid128', () => {
  it('is deterministic — same seed, same 32-char uppercase hex', () => {
    const a = guid128('PH.COV.001')
    const b = guid128('PH.COV.001')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9A-F]{32}$/)
  })

  it('varies across the full width when the seed changes', () => {
    expect(guid128('a')).not.toBe(guid128('b'))
    expect(guid128('PH.COV.001')).not.toBe(guid128('PH.COV.002'))
    // A one-char change should not leave the tail identical (all four words are salted).
    expect(guid128('x').slice(24)).not.toBe(guid128('y').slice(24))
  })

  it('does not collide across a large synthetic batch', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 5000; i++) ids.add(guid128(`coverage|PH.COV.${i}`))
    expect(ids.size).toBe(5000)
  })
})

describe('deriveId', () => {
  it('prepends the type-prefix letter to the GUID body', () => {
    const id = deriveId('c', 'coverage|PH.COV.001')
    expect(id[0]).toBe('c')
    expect(id.slice(1)).toMatch(/^[0-9A-F]{32}$/)
  })

  it('distinguishes node types that share a refId space', () => {
    // A coverage and a rule could conceptually share an id string; the type-scoped seed
    // keeps their derived ids distinct.
    expect(deriveId('c', 'coverage|X')).not.toBe(deriveId('r', 'rule|X'))
  })
})
