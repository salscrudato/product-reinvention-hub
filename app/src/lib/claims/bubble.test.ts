// Proves the "no empty assistant bubble" invariant of the Claims view: every terminal SSE
// path — a deny/breaker/degrade notice, an error routed to text, or the absence of any token
// before `done` — resolves to exactly one VISIBLE thing, never a blank bubble.
import { describe, it, expect } from 'vitest'
import { assistantBubbleContent, EMPTY_TURN_FALLBACK } from './bubble'

const empty = { text: '', hasDetermination: false, notice: null }

describe('assistantBubbleContent', () => {
  it('shows the determination card when one arrived', () => {
    expect(assistantBubbleContent({ ...empty, hasDetermination: true }, false)).toBe('determination')
  })

  it('shows streamed text when text arrived', () => {
    expect(assistantBubbleContent({ ...empty, text: 'Covered under Coverage A.' }, false)).toBe('text')
  })

  it('shows a notice when a deny/breaker/degrade advisory arrived before any token', () => {
    expect(assistantBubbleContent({ ...empty, notice: { level: 'warn', message: 'Budget ceiling reached.' } }, false)).toBe('notice')
  })

  it('shows a thinking spinner while the turn is still streaming with nothing yet', () => {
    expect(assistantBubbleContent(empty, true)).toBe('thinking')
  })

  it('NEVER blanks: a finished turn with no card, text or notice falls back to a visible message', () => {
    expect(assistantBubbleContent(empty, false)).toBe('fallback')
    expect(EMPTY_TURN_FALLBACK.trim().length).toBeGreaterThan(0)
  })

  it('a card wins over a notice, and text wins over a notice (advisory renders alongside, never alone-blank)', () => {
    expect(assistantBubbleContent({ text: 'x', hasDetermination: false, notice: { level: 'info', message: 'i' } }, false)).toBe('text')
    expect(assistantBubbleContent({ text: '', hasDetermination: true, notice: { level: 'warn', message: 'w' } }, false)).toBe('determination')
  })

  it('whitespace-only text is treated as empty (does not mask a blank bubble)', () => {
    expect(assistantBubbleContent({ ...empty, text: '   \n ' }, false)).toBe('fallback')
  })
})
