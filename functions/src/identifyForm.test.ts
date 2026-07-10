// identifyForm.test.ts — E: verify the forms-catalogue escalation logic in identifyBaseForm.
//
// Three invariants under test:
//   1. haiku reads a formNumber IN catalogue → accepted, Sonnet not called.
//   2. haiku reads a formNumber NOT in catalogue → escalate once to Sonnet.
//   3. Sonnet's formNumber ALSO not in catalogue → result carries verified:false,
//      so statusAfterIdentify() returns NEEDS_REVIEW and the form is held for review.
//
// Anthropic client and Firestore are mocked so no real API or DB calls are made.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── vi.hoisted mocks (created before module imports resolve) ─────────────────

const mockCreate  = vi.hoisted(() => vi.fn())   // Anthropic messages.create
const mockFormGet = vi.hoisted(() => vi.fn())   // Firestore forms collection get()

// Stub the Anthropic client so no real API key or network is needed.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic { messages = { create: mockCreate } },
}))

// Stub Firebase Admin initialization and Firestore.
vi.mock('firebase-admin/app', () => ({
  getApps:       () => ['__app__'],
  initializeApp: vi.fn(),
}))

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({
      where: () => ({ limit: () => ({ get: mockFormGet }) }),
    }),
  }),
}))

// Stub Firebase Storage (used by analyzeClaim, not identifyBaseForm — silent no-op).
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({ bucket: () => ({ file: () => ({ download: vi.fn() }) }) }),
}))

// Stub telemetry to avoid writes.
vi.mock('./telemetry', () => ({
  emptyUsage:     () => ({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 }),
  addUsage:       vi.fn(),
  recordCascade:  vi.fn().mockResolvedValue(undefined),
  recordUsage:    vi.fn().mockResolvedValue(undefined),
}))

// Stub modules used only by analyzeClaim (not identifyBaseForm).
vi.mock('./ai', () => ({
  runChatAgent:  vi.fn(),
  assistantText: vi.fn().mockReturnValue(''),
  sseCostGate:   vi.fn(),
}))
vi.mock('./tools', () => ({
  TOOLS:               [],
  runTool:             vi.fn(),
  loadKnownCitations:  vi.fn().mockResolvedValue({ refIds: new Set(), formNumbers: new Set() }),
}))
vi.mock('./retrieval/index', () => ({ retrieve: vi.fn().mockResolvedValue([]) }))
vi.mock('./retrieval/citations', () => ({
  buildCiteableDocuments: vi.fn().mockReturnValue({ blocks: [], index: [] }),
  citationsFromConvo:     vi.fn().mockReturnValue([]),
  verifyCitations:        vi.fn().mockReturnValue({ valid: 0, invalid: 0 }),
}))

// Stub runtime to avoid secret resolution (ANTHROPIC_API_KEY.value() throws in test env).
vi.mock('./runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('./runtime')>()
  return {
    ...original,
    anthropic:           () => ({ messages: { create: mockCreate } }),
    ANTHROPIC_API_KEY:   { value: () => 'test-key' },
    VOYAGE_API_KEY:      { value: () => '' },
    voyageKey:           () => undefined,
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Build the minimal CallableRequest identifyBaseForm.run() needs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function editorReq(data: Record<string, unknown>): any {
  return { data, auth: { uid: 'editor-uid', token: { role: 'EDITOR', name: 'Alice' } } }
}

/** Anthropic response shaped like a successful identify_form tool call. */
function anthropicIdentifyResponse(formNumber: string, lob = 'HO', title = 'Test Form') {
  return {
    content: [{
      type: 'tool_use',
      name: 'identify_form',
      input: { title, formNumber, edition: '05 11', lob },
    }],
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  }
}

/** Firestore snapshot: empty = form NOT in catalogue; non-empty = found. */
const notInCatalogue = () => Promise.resolve({ empty: true  })
const inCatalogue    = () => Promise.resolve({ empty: false })

// ─── Import after mocks are wired ─────────────────────────────────────────────
import { identifyBaseForm } from './claims'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('identifyBaseForm — E: forms-catalogue verification and escalation', () => {
  const validPayload = { formText: 'INSURANCE FORM HO 00 03', fileName: 'HO-00-03.txt' }

  beforeEach(() => {
    mockCreate.mockClear()
    mockFormGet.mockClear()
  })

  it('accepts a formNumber that resolves in the catalogue — Sonnet is NOT called', async () => {
    mockCreate.mockResolvedValueOnce(anthropicIdentifyResponse('HO 00 03'))
    mockFormGet.mockImplementation(inCatalogue)

    const result = await identifyBaseForm.run(editorReq(validPayload))

    expect(result.formNumber).toBe('HO 00 03')
    expect((result as Record<string, unknown>).verified).toBeUndefined()
    // Only one model call (haiku); Sonnet was not needed.
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('escalates to Sonnet when haiku reads a formNumber not in catalogue', async () => {
    // Haiku returns a number; Sonnet returns a different (verified) one.
    mockCreate
      .mockResolvedValueOnce(anthropicIdentifyResponse('XX 99 99'))   // haiku: unverified
      .mockResolvedValueOnce(anthropicIdentifyResponse('HO 00 03'))   // sonnet: verified
    mockFormGet
      .mockImplementationOnce(notInCatalogue)   // haiku's number check → not found
      .mockImplementationOnce(inCatalogue)      // sonnet's number check → found

    const result = await identifyBaseForm.run(editorReq(validPayload))

    expect(result.formNumber).toBe('HO 00 03')
    expect((result as Record<string, unknown>).verified).toBeUndefined()
    expect(mockCreate).toHaveBeenCalledTimes(2)   // haiku + Sonnet escalation
  })

  it('returns verified:false when both haiku and Sonnet produce numbers not in catalogue', async () => {
    mockCreate
      .mockResolvedValueOnce(anthropicIdentifyResponse('XX 99 99'))   // haiku: unverified
      .mockResolvedValueOnce(anthropicIdentifyResponse('YY 00 00'))   // sonnet: also unverified
    mockFormGet.mockImplementation(notInCatalogue)   // both numbers absent

    const result = await identifyBaseForm.run(editorReq(validPayload))

    expect((result as Record<string, unknown>).verified).toBe(false)
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('returns verified:false when Sonnet drops the formNumber entirely (returns empty)', async () => {
    // Haiku has an unverified number; Sonnet is uncertain and returns no number.
    const noNumber = { ...anthropicIdentifyResponse(''), lob: 'HO' }
    noNumber.content[0] = { ...noNumber.content[0], input: { title: 'Unknown Form', formNumber: '', edition: '', lob: 'HO' } }
    mockCreate
      .mockResolvedValueOnce(anthropicIdentifyResponse('XX 99 99'))
      .mockResolvedValueOnce(noNumber)
    mockFormGet.mockImplementation(notInCatalogue)

    const result = await identifyBaseForm.run(editorReq(validPayload))

    expect((result as Record<string, unknown>).verified).toBe(false)
  })

  it('rejects VIEWER with permission-denied (role guard unchanged)', async () => {
    const req = { data: validPayload, auth: { uid: 'v1', token: { role: 'VIEWER' } } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(identifyBaseForm.run(req as any)).rejects.toMatchObject({ code: 'permission-denied' })
  })
})
