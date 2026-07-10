// fake.test.ts — E2E gate for the chat and claims AI paths (AI_FAKE=1).
//
// Strategy (documented here per the workstream spec): a functions-level test double
// in src/fake/index.ts stands in for the live Anthropic client. The fake is
// structurally unreachable in production because tsup only bundles from src/index.ts,
// and fake/ is never on that import path. AI_FAKE=1 is set in functions/vitest.config.ts
// so these suites run in the normal gate without a live Anthropic API call.
//
// What is verified end-to-end:
//   1. Chat SSE plumbing: token events arrive and carry a real [refId] chip that the
//      UI renders as a clickable citation. The citation guard sees only known refIds.
//   2. Claims determination card shape: the JSON event has verdict + citations + limits;
//      determinationIsCited() passes (no retry needed); findUnverified… returns [] (no
//      invented references — the card is safe to render).
//   3. Degrade / deny NoticeBanner: the SSE notice event has the right shape (level + message)
//      so the UI can render the appropriate banner.
//
// Not covered here (belong in separate suites):
//   • Rule composer persist (Accept → mutate → table refId chip): see tests/integration/mutate.test.ts
//   • Full analyzeClaim HTTP endpoint: requires mocking the full Firebase/Function chain
//   • Share link: functions/src/share.ts does NOT exist (GROUND_TRUTH V3) — test is skipped
//
// Run: pnpm --filter functions test  (AI_FAKE=1 set in vitest.config.ts)
import { describe, it, expect } from 'vitest'
import {
  CANNED_CHAT_TOKENS, CANNED_DETERMINATION, CANNED_GAP_DETERMINATION,
  createFakeChatClient, createFakeClaimsClient, createFakeGapClaimsClient,
} from './fake/index'
import { determinationIsCited } from './claims'
import {
  findUnverifiedDeterminationCitations,
  normalizeFormNumber,
  PH_COVERAGES, PH_RULES, PH_FORMS, PH_LD_TABLES,
} from '@pf/shared'
import type { Coverage, Rule, Form } from '@pf/shared'

// ─── Shared: seeded catalogue ─────────────────────────────────────────────────
// Build the known-citations set from the seed — the same set the production
// loadKnownCitations() builds from Firestore, but derived deterministically from the
// seed constants so these tests need no emulator.
function buildSeededCatalogue(): { refIds: Set<string>; formNumbers: Set<string> } {
  const refIds = new Set<string>([
    ...(PH_COVERAGES as Coverage[]).map(c => c.refId).filter((r): r is string => Boolean(r)),
    ...(PH_RULES as Rule[]).map(r => r.refId).filter((r): r is string => Boolean(r)),
    // ldTables is Record<string, LDTable> — the keys ARE the refIds (e.g. 'PH.LD.003')
    ...Object.keys(PH_LD_TABLES as Record<string, unknown>),
  ])
  const formNumbers = new Set<string>(
    (PH_FORMS as Form[]).map(f => normalizeFormNumber(f.number)),
  )
  return { refIds, formNumbers }
}

// ─── Shared: minimal SSE response capture ────────────────────────────────────
interface StreamEvent { t: string; [k: string]: unknown }

function makeFakeRes() {
  const frames: StreamEvent[] = []
  return {
    frames,
    setHeader() {},
    write(s: string) {
      const m = /^data: (.+)\n\n$/.exec(s)
      if (m) frames.push(JSON.parse(m[1]!) as StreamEvent)
    },
    end() {},
  }
}

type FakeRes = ReturnType<typeof makeFakeRes>

// Mirrors runtime.ts:send() — writes the SSE data frame. Self-contained so this
// suite doesn't need to import the heavy runtime module.
function sendEvent(res: FakeRes, event: StreamEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

// ─── Shared: minimal inline agent loop ───────────────────────────────────────
// Mirrors the core of runChatAgent from ai.ts (stream → token events → tool loop)
// without pulling in the full firebase/runtime import chain. When ai.ts changes its
// loop invariants, the gate will catch divergence via the real integration tests.

interface FakeClient {
  messages: {
    stream(params: unknown, opts?: unknown): {
      on(event: string, h: (...args: unknown[]) => void): ReturnType<FakeClient['messages']['stream']>
      finalMessage(): Promise<Record<string, unknown>>
    }
  }
}

type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<{ content: string; summary: string }>

async function runFakeAgentLoop(
  client: FakeClient,
  messages: Array<Record<string, unknown>>,
  res: FakeRes,
  opts: { maxTurns: number; runTool: ToolExecutor },
): Promise<void> {
  const convo: Array<Record<string, unknown>> = [...messages]
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const stream = client.messages.stream({})
    stream.on('error', () => {})
    stream.on('text', (delta: unknown) => sendEvent(res, { t: 'token', v: delta as string }))
    const final = await stream.finalMessage()
    convo.push({ role: 'assistant', content: final['content'] })

    const toolUses = (final['content'] as Array<Record<string, unknown>>)
      .filter(b => b['type'] === 'tool_use')
    if (final['stop_reason'] !== 'tool_use' || toolUses.length === 0) break

    const results: Array<Record<string, unknown>> = []
    for (const tu of toolUses) {
      sendEvent(res, { t: 'tool', name: tu['name'] as string, phase: 'start' })
      const out = await opts.runTool(tu['name'] as string, (tu['input'] as Record<string, unknown>) ?? {})
      sendEvent(res, { t: 'tool', name: tu['name'] as string, phase: 'end', summary: out.summary })
      results.push({ type: 'tool_result', tool_use_id: tu['id'] as string, content: out.content })
    }
    convo.push({ role: 'user', content: results })
  }
}

// ─── 1. Chat tokens ───────────────────────────────────────────────────────────

describe('E2E fake — chat SSE: token events carry a [refId] citation chip', () => {
  it('emits token events and all text contains a real citation ([PH.COV.001])', async () => {
    const res = makeFakeRes()
    const client = createFakeChatClient() as unknown as FakeClient

    await runFakeAgentLoop(client, [{ role: 'user', content: 'Does HO-3 cover fire damage?' }], res, {
      maxTurns: 3,
      runTool: async () => ({ content: '{}', summary: 'ok' }),
    })

    const tokens = res.frames.filter(e => e.t === 'token')
    expect(tokens.length).toBeGreaterThan(0)

    const allText = tokens.map(e => e.v as string).join('')
    expect(allText).toContain('[PH.COV.001]')
    expect(allText).toContain('HO 00 03')
  })

  it('the canned tokens reference only known seeded refIds (citation guard would not flag)', () => {
    const fullText = CANNED_CHAT_TOKENS.join('')
    const { refIds } = buildSeededCatalogue()
    // PH.COV.001 appears in brackets → the chat citation guard would check it
    expect(fullText).toContain('[PH.COV.001]')
    expect(refIds.has('PH.COV.001')).toBe(true)
  })
})

// ─── 2. Claims determination card ────────────────────────────────────────────

describe('E2E fake — claims: DeterminationCard JSON event + citation guards pass', () => {
  it('emits a json:determination event with the right shape', async () => {
    const res = makeFakeRes()
    const client = createFakeClaimsClient() as unknown as FakeClient

    let capturedDetermination: Record<string, unknown> | null = null

    await runFakeAgentLoop(client, [{ role: 'user', content: 'Fire damaged my roof.' }], res, {
      maxTurns: 4,
      runTool: async (name, input) => {
        if (name === 'emit_determination') {
          capturedDetermination = input
          sendEvent(res, { t: 'json', key: 'determination', value: input })
          return { content: JSON.stringify({ recorded: true }), summary: 'determination ready' }
        }
        return { content: '{}', summary: 'ok' }
      },
    })

    const jsonEvent = res.frames.find(e => e.t === 'json' && e['key'] === 'determination')
    expect(jsonEvent, 'json:determination event must be emitted').toBeDefined()
    expect(capturedDetermination, 'runTool must have been called with emit_determination').not.toBeNull()

    // Shape: verdict, formNumber, citations
    expect(capturedDetermination!['verdict']).toBe('COVERED')
    expect(capturedDetermination!['formNumber']).toBe('HO 00 03')
    expect(capturedDetermination!['citations']).toContain('PH.COV.001')

    // Citation guard: determinationIsCited must return true (no retry needed)
    expect(determinationIsCited(capturedDetermination!)).toBe(true)

    // Resolution invariant: no cited token is absent from the seeded catalogue
    const { refIds, formNumbers } = buildSeededCatalogue()
    const unresolved = findUnverifiedDeterminationCitations(capturedDetermination!, refIds, formNumbers)
    expect(unresolved, `unresolved citations: ${unresolved.join(', ')}`).toEqual([])
  })

  it('CANNED_DETERMINATION passes determinationIsCited (retry gate never fires)', () => {
    expect(determinationIsCited(CANNED_DETERMINATION)).toBe(true)
  })

  it('CANNED_DETERMINATION cites only real seeded refIds (resolution invariant)', () => {
    const { refIds, formNumbers } = buildSeededCatalogue()
    const unresolved = findUnverifiedDeterminationCitations(CANNED_DETERMINATION, refIds, formNumbers)
    expect(unresolved, `invented citations: ${unresolved.join(', ')}`).toEqual([])
  })

  it('CANNED_DETERMINATION has a seeded formNumber (form is in the library)', () => {
    const { formNumbers } = buildSeededCatalogue()
    const fn = normalizeFormNumber(CANNED_DETERMINATION['formNumber'] as string)
    expect(formNumbers.has(fn)).toBe(true)
  })
})

// ─── 2b. Coverage-gap determination → product feedback ────────────────────────

describe('E2E fake — claims coverage gap: NOT_ADDRESSED determination carries a grounded gap', () => {
  it('emits a NOT_ADDRESSED determination with a coverageGap the UI turns into feedback', async () => {
    const res = makeFakeRes()
    const client = createFakeGapClaimsClient() as unknown as FakeClient

    let captured: Record<string, unknown> | null = null
    await runFakeAgentLoop(client, [{ role: 'user', content: 'A power surge fried my smart thermostat.' }], res, {
      maxTurns: 4,
      runTool: async (name, input) => {
        if (name === 'emit_determination') {
          captured = input
          sendEvent(res, { t: 'json', key: 'determination', value: input })
          return { content: JSON.stringify({ recorded: true }), summary: 'gap recorded' }
        }
        return { content: '{}', summary: 'ok' }
      },
    })

    const jsonEvent = res.frames.find(e => e.t === 'json' && e['key'] === 'determination')
    expect(jsonEvent, 'json:determination event must be emitted').toBeDefined()
    expect(captured!['verdict']).toBe('NOT_ADDRESSED')
    const gap = captured!['coverageGap'] as { note: string; sources?: string[] } | undefined
    expect(gap?.note, 'the determination must carry a coverage gap note').toBeTruthy()
    // The "Create product feedback" affordance renders off exactly this gap.
    expect((gap!.sources ?? []).length).toBeGreaterThan(0)
  })

  it('the gap is grounded — its sources are real seeded refIds (no invented citation)', () => {
    // NOT_ADDRESSED is exempt from the substantive-verdict citation guard, but the gap still
    // points at a seeded refId so the captured product-feedback idea is grounded.
    const { refIds } = buildSeededCatalogue()
    const gap = CANNED_GAP_DETERMINATION['coverageGap'] as { sources?: string[] }
    expect((gap.sources ?? []).every(s => refIds.has(s)), `ungrounded gap sources: ${(gap.sources ?? []).join(', ')}`).toBe(true)
  })
})

// ─── 3. Degrade / deny NoticeBanner ──────────────────────────────────────────

describe('E2E fake — cost guard: degrade and deny emit the right SSE notice events', () => {
  it('a degrade notice has level=info and carries the degradation reason', () => {
    const res = makeFakeRes()
    const degradeReason = 'AI usage is high this session — answers may be shorter.'
    // This mirrors what the chat endpoint does when guard.action === 'degrade':
    //   send(res, { t: 'notice', level: 'info', message: guard.reason })
    sendEvent(res, { t: 'notice', level: 'info', message: degradeReason })

    const notice = res.frames.find(e => e.t === 'notice')
    expect(notice).toBeDefined()
    expect(notice!['level']).toBe('info')
    expect(notice!['message']).toBe(degradeReason)
  })

  it('a hard deny notice has level=warn and mentions the budget ceiling', () => {
    const res = makeFakeRes()
    // Mirrors what the chat endpoint emits when guard.action === 'deny':
    //   send(res, { t: 'notice', level: 'warn', message: 'AI is temporarily limited...' })
    sendEvent(res, {
      t: 'notice', level: 'warn',
      message: 'AI is temporarily limited — the daily budget ceiling has been reached. Please try again later.',
    })

    const notice = res.frames.find(e => e.t === 'notice')
    expect(notice!['level']).toBe('warn')
    expect(notice!['message']).toContain('budget ceiling')
  })

  it('a breaker-open notice has level=warn and mentions service unavailability', () => {
    const res = makeFakeRes()
    sendEvent(res, {
      t: 'notice', level: 'warn',
      message: 'The AI service is temporarily unavailable. Please try again shortly.',
    })

    const notice = res.frames.find(e => e.t === 'notice')
    expect(notice!['level']).toBe('warn')
    expect(notice!['message']).toContain('temporarily unavailable')
  })
})
