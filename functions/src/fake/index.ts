// fake/index.ts — functions-level test double for the Anthropic client.
//
// Structurally unreachable in production: tsup bundles only what is reachable from
// src/index.ts. This file lives in src/fake/ and is imported ONLY from *.test.ts
// files — it is never reachable from a production import chain. The AI_FAKE=1 env
// var (set in functions/vitest.config.ts) gates the describe blocks that import it,
// so the gate always exercises these tests and no live Anthropic call ever happens.
//
// The canned responses use real refIds and form numbers from the seeded portfolio
// (PH.COV.001, PH.LD.003, HO 00 03) so the citation guard functions pass without
// a model call, exactly as they would on a well-grounded live answer.
import type Anthropic from '@anthropic-ai/sdk'

// ─── Canned chat response ─────────────────────────────────────────────────────
// Tokens include a [PH.COV.001] citation so the chat citation guard passes and the
// UI renders a clickable chip for the real coverage.
export const CANNED_CHAT_TOKENS = [
  'Based on the HO-3 policy, your dwelling ',
  'is covered under [PH.COV.001] Coverage A — Dwelling. ',
  'The base form [HO 00 03] confirms coverage for direct physical loss. ',
  'Your deductible applies per the Declarations page.',
]

// ─── Canned determination ─────────────────────────────────────────────────────
// Every cited token resolves against the seeded catalogue (verified in fake.test.ts).
// All citation guard paths are satisfied: explicit citations[], coverage refId,
// limit source, and [bracketed] reasoning. Used by the claims E2E test.
export const CANNED_DETERMINATION: Record<string, unknown> = {
  verdict:    'COVERED',
  summary:    'The policy covers this loss under Coverage A — Dwelling.',
  formNumber: 'HO 00 03',
  coverages: [
    {
      name:       'Coverage A — Dwelling',
      refId:      'PH.COV.001',
      formNumber: 'HO 00 03',
      definition: 'Covers direct physical loss to the dwelling structure.',
    },
  ],
  exclusions: [],
  limits: [
    { label: 'All-peril deductible', value: 'Per Declarations', source: 'PH.LD.003' },
  ],
  reasoning: [
    'The loss is a direct physical loss to the dwelling [Section I – Coverage A].',
    'No applicable exclusion bars this peril [PH.COV.001].',
    'The all-peril deductible applies per the Declarations page [PH.LD.003].',
  ],
  openItems:  ['Exact deductible amount requires the Declarations page.'],
  citations:  ['PH.COV.001', 'HO 00 03'],
}

// ─── Fake stream builder ──────────────────────────────────────────────────────
// Implements the MessageStream surface that runChatAgent / streamTurn uses:
//   .on('error' | 'text', handler) — chainable
//   .finalMessage()               — emits text tokens then returns the Anthropic Message

type AnyFn = (...args: unknown[]) => void

function makeFakeStream(tokens: string[], msg: Record<string, unknown>) {
  const handlers = new Map<string, AnyFn[]>()
  const stream = {
    on(event: string, handler: AnyFn) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return stream
    },
    async finalMessage() {
      for (const token of tokens)
        for (const h of handlers.get('text') ?? []) h(token)
      return msg
    },
  }
  return stream
}

const FAKE_USAGE = {
  input_tokens: 10, output_tokens: 20,
  cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
}

// ─── createFakeChatClient ─────────────────────────────────────────────────────
// One text turn — tokens contain [PH.COV.001]; no tool_use → loop ends after turn 1.
export function createFakeChatClient(): Anthropic {
  return {
    messages: {
      stream(_params: unknown, _opts?: unknown) {
        return makeFakeStream(CANNED_CHAT_TOKENS, {
          content: [{ type: 'text', text: CANNED_CHAT_TOKENS.join('') }],
          stop_reason: 'end_turn',
          usage: FAKE_USAGE,
        })
      },
    },
  } as unknown as Anthropic
}

// ─── createFakeClaimsClient ────────────────────────────────────────────────────
// Two turns:
//   Turn 1: tool_use for emit_determination → runTool captures it and emits json event
//   Turn 2: plain text acknowledgement → loop ends
// The test supplies its own runTool to handle emit_determination.
export function createFakeClaimsClient(): Anthropic {
  let callCount = 0
  return {
    messages: {
      stream(_params: unknown, _opts?: unknown) {
        callCount++
        if (callCount === 1) {
          return makeFakeStream([], {
            content: [{
              type: 'tool_use', id: 'fake_tu_001',
              name: 'emit_determination', input: CANNED_DETERMINATION,
            }],
            stop_reason: 'tool_use',
            usage: FAKE_USAGE,
          })
        }
        return makeFakeStream(['Determination recorded.'], {
          content: [{ type: 'text', text: 'Determination recorded.' }],
          stop_reason: 'end_turn',
          usage: FAKE_USAGE,
        })
      },
    },
  } as unknown as Anthropic
}
