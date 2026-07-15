/**
 * hardening-f13-role-partition.test.ts — regression lock for ledger F13.
 *
 * Pre-fix, the filing path selected documents with findIndex — the FIRST doc
 * per role won and every other document (a second manual, a multi-role doc,
 * an 'other') was silently ignored: no warning, no unresolved item, and the
 * bundle's fingerprint.documentRoles were minted 'unknown' placeholders.
 * Role assignment is a partition, not a lookup — every document must land
 * somewhere visible.
 *
 * The stub classifies from DOCUMENT CONTENT (structural cues), never
 * filenames (anti-overfit).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../server/lib/fleet', () => ({
  guard:                () => ({ allow: true, degrade: false, reason: 'ok' }),
  record:               () => {},
  resolveModel:         (role: string) => `stub-${role}`,
  anthropicMessagesUrl: () => 'http://stub/anthropic',
  openaiChatUrl:        () => 'http://stub/openai',
  anthropicHeaders:     () => ({ 'Content-Type': 'application/json' }),
  openaiHeaders:        () => ({ 'Content-Type': 'application/json' }),
  openaiChatBody:       (model: string, msgs: unknown[], maxTokens: number) => ({ model, messages: msgs, max_completion_tokens: maxTokens }),
  DEPLOY_GPT:           'stub-gpt',
  DEPLOY_GPT_MINI:      'stub-gpt-mini',
  DEPLOY_OPUS:          'stub-opus',
  DEPLOY_HAIKU:         'stub-haiku',
  isConfigured:         () => false,
  estimateCostUsd:      () => 0,
  IMPORT_CONTEXT:       'import-no-cap',
  ESCALATION_LADDER:    ['BULK_VERIFY', 'MID_REASONER', 'GROUNDED_CITED'],
}))

// Content-keyed model stub: classification derives from structural markers in
// the document text; extractors return items derived from the SAME text so
// per-document provenance is checkable.
function stubFetch() {
  vi.stubGlobal('fetch', async (_url: string, opts: { body: string }) => {
    const body = JSON.parse(opts?.body ?? '{}')
    const toolName = body?.tool_choice?.name ?? ''
    const text = JSON.stringify(body.messages ?? '')
    const ok = (input: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'tool_use', input }], usage: { input_tokens: 1, output_tokens: 1 } }) })
    if (toolName === 'classify_filing_document') {
      if (/RATE ORDER OF CALCULATIONS/.test(text)) return ok({ role: 'rateOrder', cue: 'rate order heading', confidence: 0.95 })
      if (/RULE \d+\./.test(text) && /RATE ORDER APPENDIX/.test(text)) return ok({ role: 'manual', secondaryRoles: ['rateOrder'], cue: 'numbered rules + embedded rate order appendix', confidence: 0.9 })
      if (/RULE \d+\./.test(text)) return ok({ role: 'manual', cue: 'numbered rules', confidence: 0.9 })
      if (/INSURING AGREEMENT/.test(text)) return ok({ role: 'policyForm', cue: 'insuring agreement', confidence: 0.9 })
      return ok({ role: 'other', cue: 'no structural cue', confidence: 0.4 })
    }
    if (toolName === 'propose_manual_rules') {
      const m = /SOURCEMARK-([A-Z]+)/.exec(text)
      return ok({ rules: [{ ruleNumber: '100', title: `Rule from ${m?.[1] ?? 'UNKNOWN'}`, kind: 'OTHER', confidence: 0.9, citation: `Rule 100 (${m?.[1] ?? 'UNKNOWN'})` }] })
    }
    if (toolName === 'propose_rate_order') {
      return ok({ variables: [{ name: 'Base Premium', op: 'ADD', stage: 'BASE_LOSS_COST', forms: ['HO3'], confidence: 0.9, citation: 'row 1' }] })
    }
    if (toolName === 'propose_coverages') {
      return ok({ coverages: [] })
    }
    return ok({})
  })
}

const DOCS = [
  { name: 'doc-a.pdf', text: 'HOMEOWNERS MANUAL SOURCEMARK-ALPHA RULE 1. Base rates. RULE 2. Territories.' },
  { name: 'doc-b.pdf', text: 'AUTO MANUAL SOURCEMARK-BRAVO RULE 1. Classifications. RULE 2. Factors.' },
  { name: 'doc-c.pdf', text: 'RATE ORDER OF CALCULATIONS Premium/Factor rows follow.' },
  { name: 'doc-d.pdf', text: 'A cover letter with no structural cues whatsoever.' },
]

async function run(documents: Array<{ name: string; text: string }>) {
  stubFetch()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runFilingPipeline } = require('../../server/lib/import-brain/stage-filing.js')
  return runFilingPipeline({
    documents, productNameHint: 'Test Product', filingStateHint: 'NJ',
    budget: { noCap: true }, extractPdfText: () => null, emit: () => {},
  })
}

describe('F13: role assignment is a partition, not a lookup', () => {
  it('BOTH manuals extract, with per-document provenance', async () => {
    const { extraction } = await run(DOCS)
    const citations = extraction.manual.rules.map((r: { citation: string }) => r.citation)
    expect(citations.some((c: string) => /ALPHA/.test(c))).toBe(true)
    expect(citations.some((c: string) => /BRAVO/.test(c))).toBe(true)
    // >1 manual → each merged rule's citation names its source document.
    expect(citations.every((c: string) => /doc-[ab]\.pdf/.test(c))).toBe(true)
  })

  it("an 'other' document lands visibly: unresolved (contract shape) + warning, counts conserved", async () => {
    const { bundle } = await run(DOCS)
    // UnresolvedItem contract: the review UI renders u.name — the document
    // NAME must be there, with stage/kind/citation populated (judge-locked).
    const unproc = (bundle.unresolved ?? []).filter((u: { kind?: string }) => u.kind === 'unprocessed-document')
    expect(unproc.some((u: { name?: string }) => u.name === 'doc-d.pdf')).toBe(true)
    for (const u of unproc as Array<{ stage?: string; name?: string; citation?: string }>) {
      expect(u.stage).toBe('classify')
      expect(typeof u.name).toBe('string')
      expect(String(u.citation)).not.toBe('')
    }
    expect((bundle.importWarnings ?? []).some((w: { kind: string; detail: string }) => w.kind === 'unprocessed-document' && /doc-d\.pdf/.test(w.detail))).toBe(true)
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
  })

  it('the bundle carries REAL document roles AND keeps the fingerprint scalars', async () => {
    const { bundle } = await run(DOCS)
    const roles = new Map((bundle.fingerprint?.documentRoles ?? []).map((r: { documentName: string; role: string }) => [r.documentName, r.role]))
    expect(roles.get('doc-a.pdf')).toBe('manual')
    expect(roles.get('doc-c.pdf')).toBe('rateOrder')
    expect(roles.get('doc-d.pdf')).toBe('other')
    // Pre-creating the fingerprint must not blank the format badges (judge-found).
    expect(bundle.fingerprint.container).toBe('PDF')
    expect(bundle.fingerprint.detectedFormat).toBe('COMPANY_FILING_PDF')
  })

  it('a multi-role document (manual + embedded rate order) is extracted for BOTH roles', async () => {
    const docs = [
      { name: 'combo.pdf', text: 'COMBINED MANUAL SOURCEMARK-COMBO RULE 1. Rates. RATE ORDER APPENDIX inside.' },
      { name: 'form.pdf', text: 'INSURING AGREEMENT Part A.' },
    ]
    const { extraction } = await run(docs)
    expect(extraction.manual.rules.length).toBeGreaterThan(0)
    expect(extraction.rateOrder.variables.length).toBeGreaterThan(0)
  })

  it('surplus rate-order documents are surfaced, never silently ignored (order semantics: first extracts)', async () => {
    const docs = [
      { name: 'ro-1.pdf', text: 'RATE ORDER OF CALCULATIONS one.' },
      { name: 'ro-2.pdf', text: 'RATE ORDER OF CALCULATIONS two.' },
    ]
    const { bundle } = await run(docs)
    expect((bundle.importWarnings ?? []).some((w: { kind: string; detail: string }) => w.kind === 'unprocessed-document' && /ro-2\.pdf/.test(w.detail))).toBe(true)
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
  })

  it('sanitizeClassification rejects dirty secondaryRoles (other/dupes/junk)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sanitizeClassification } = require('../../server/lib/filing-shared.cjs')
    const c = sanitizeClassification('x.pdf', {
      role: 'manual',
      secondaryRoles: ['other', 'manual', 'rateOrder', 'rateOrder', 'nonsense'],
      cue: 'rules', confidence: 0.9,
    })
    expect(c.secondaryRoles).toEqual(['rateOrder'])
    const clean = sanitizeClassification('y.pdf', { role: 'manual', cue: 'rules', confidence: 0.9 })
    expect(clean.secondaryRoles).toBeUndefined()
  })
})
