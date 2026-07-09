// bubble.ts — the single decision for what an assistant turn renders in the Claims view, so
// it can NEVER show an empty bubble. Every terminal SSE path (a deny/degrade/breaker notice,
// an error, or the absence of any token before `done`) resolves to exactly one visible thing.
// Pure + unit-tested so the "no blank bubble" invariant is proven without a live stream.

export type BubbleContent = 'determination' | 'text' | 'notice' | 'thinking' | 'fallback'

export interface AssistantBubbleState {
  text: string
  hasDetermination: boolean
  // A non-fatal advisory surfaced from a `notice` SSE event (budget cap, breaker, unverified
  // citation, degrade). Null/absent when none arrived.
  notice?: { level: 'info' | 'warn'; message: string } | null
}

/** What the assistant bubble should render. Priority: a determination card, else streamed
 *  text, else a notice advisory, else (while the turn is still streaming) a thinking spinner,
 *  else a plain-language fallback — so a turn that ends with nothing to show is never blank. */
export function assistantBubbleContent(m: AssistantBubbleState, streamingThisTurn: boolean): BubbleContent {
  if (m.hasDetermination) return 'determination'
  if (m.text.trim()) return 'text'
  if (m.notice) return 'notice'
  if (streamingThisTurn) return 'thinking'
  return 'fallback'
}

// The plain-language message shown when a turn ends with no card, no text and no notice — the
// last-resort guard so the interface always says *something* in its own voice.
export const EMPTY_TURN_FALLBACK =
  "I couldn't produce a response for that. Please try again in a moment, or rephrase the scenario."
