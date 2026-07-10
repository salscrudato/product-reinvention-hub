// extract.test.ts — unit tests for the cheap-first escalation logic.
//
// The extraction endpoint runs each section through a fast model (Haiku) first,
// then escalates to the reasoning model ONLY when the sanitizer signals the output
// is ungrounded or the section is suspiciously empty for a real base form.
// These tests prove the escalation trigger fires in exactly the right cases — no
// network call, no live model, no Firebase.
import { describe, it, expect } from 'vitest'
import { sectionNeedsEscalation, proposedCount } from './extract'

// ─── sectionNeedsEscalation ──────────────────────────────────────────────────

describe('sectionNeedsEscalation', () => {
  // Fabrication signal: model proposed items but sanitizer dropped them ALL.
  it('escalates when raw items were proposed but ALL were dropped by the sanitizer', () => {
    expect(sectionNeedsEscalation('coverages', 3, 0)).toBe(true)
    expect(sectionNeedsEscalation('forms', 2, 0)).toBe(true)
    expect(sectionNeedsEscalation('rules', 1, 0)).toBe(true)
    expect(sectionNeedsEscalation('rating', 1, 0)).toBe(true)
  })

  // Under-read signal: a real base form always defines coverages and is itself a form —
  // an empty output for these two sections means the fast pass missed the obvious.
  it('escalates when the coverages section is empty (zero kept, even if model proposed nothing)', () => {
    expect(sectionNeedsEscalation('coverages', 0, 0)).toBe(true)
  })

  it('escalates when the forms section is empty', () => {
    expect(sectionNeedsEscalation('forms', 0, 0)).toBe(true)
  })

  // Rules and rating can legitimately be empty on simple base forms — only the
  // "proposed but all dropped" pattern escalates them.
  it('does NOT escalate rules or rating when the model honestly found nothing', () => {
    expect(sectionNeedsEscalation('rules', 0, 0)).toBe(false)
    expect(sectionNeedsEscalation('rating', 0, 0)).toBe(false)
  })

  // Clean fast pass — some items survived: no escalation needed.
  it('does NOT escalate when at least one item survived the sanitizer', () => {
    expect(sectionNeedsEscalation('coverages', 3, 2)).toBe(false)
    expect(sectionNeedsEscalation('forms', 1, 1)).toBe(false)
    expect(sectionNeedsEscalation('rules', 4, 1)).toBe(false)
    expect(sectionNeedsEscalation('rating', 2, 1)).toBe(false)
  })

  it('does NOT escalate when only some items were dropped (partial success)', () => {
    // rawCount=3, keptCount=1 → some survived → no escalation
    expect(sectionNeedsEscalation('coverages', 3, 1)).toBe(false)
  })
})

// ─── proposedCount ───────────────────────────────────────────────────────────

describe('proposedCount', () => {
  it('counts items in the standard array field (coverages, forms, rules)', () => {
    expect(proposedCount('coverages', { coverages: [{}, {}] })).toBe(2)
    expect(proposedCount('forms', { forms: [{}] })).toBe(1)
    expect(proposedCount('rules', { rules: [] })).toBe(0)
  })

  it('counts items in the rating `hints` field (not `rating`)', () => {
    // The propose_rating tool uses `hints` as the array key, not `rating`.
    expect(proposedCount('rating', { hints: [{}, {}, {}] })).toBe(3)
    expect(proposedCount('rating', { hints: [] })).toBe(0)
    expect(proposedCount('rating', { rating: [{}] })).toBe(0)   // wrong key → 0
  })

  it('returns 0 when the field is absent or not an array', () => {
    expect(proposedCount('coverages', {})).toBe(0)
    expect(proposedCount('coverages', { coverages: 'not-an-array' })).toBe(0)
    expect(proposedCount('coverages', { coverages: null })).toBe(0)
  })
})

// ─── Integration: sectionNeedsEscalation + proposedCount ─────────────────────
// Mirror the actual usage in extract.ts:
//   sectionNeedsEscalation(s.key, proposedCount(s.key, cheapInput), section.items.length)

describe('escalation decision from raw model output', () => {
  it('escalates coverages when the model proposed items but the sanitizer cleared them all', () => {
    // Simulate: model proposed 2 coverages but both lack a citation → sanitizer drops them
    const cheapInput = { coverages: [{ name: 'A', confidence: 0.9 }, { name: 'B', confidence: 0.8 }] }
    const raw = proposedCount('coverages', cheapInput)   // 2
    const kept = 0                                       // sanitizer dropped all (no citation)
    expect(sectionNeedsEscalation('coverages', raw, kept)).toBe(true)
  })

  it('does not escalate when the model found nothing and that is expected (rating)', () => {
    const cheapInput = { hints: [] }
    const raw = proposedCount('rating', cheapInput)      // 0
    const kept = 0
    expect(sectionNeedsEscalation('rating', raw, kept)).toBe(false)
  })
})
