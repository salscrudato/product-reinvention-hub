/**
 * hardening-m1-mixed-visibility.test.ts — regression lock for ledger M1 (Phase M).
 *
 * A mixed upload (workbooks + PDFs) produces the workbook plan and SKIPS the
 * PDFs. The skip itself is the right call (no cross-artifact merge exists, and
 * building one without a red fixture demanding it is prohibited) — but the skip
 * is a FILTER ABOVE THE CONSERVATION LEDGER (F22's lesson): pre-fix, the skipped
 * documents surfaced only as one count-only warning ("re-upload the 2 PDF(s)"),
 * with no names anywhere in the bundle contract the review UI renders.
 *
 * The lock (mirrors F13's judged contract for unprocessed documents, verbatim):
 *   1. every skipped PDF lands in bundle.unresolved as
 *      {stage:'classify', kind:'unprocessed-document', name:<doc>} — named,
 *      review-UI renderable;
 *   2. counts.proposed / counts.unresolved move together (conservation identity
 *      proposed === accepted + unresolved keeps holding WITH the docs counted);
 *   3. every skipped PDF gets a NAMED importWarnings entry;
 *   4. the aggregate mixed-upload SSE notice stays (exactly one).
 *
 * Offline (import-enumerate pattern): fleet env stubbed, global fetch answers
 * minimal-valid AI shapes, real unifiedImport handler end-to-end.
 */
import { describe, it, expect } from 'vitest'

process.env.AZURE_FOUNDRY_ENDPOINT ||= 'https://offline-stub.local'
process.env.AZURE_FOUNDRY_KEY ||= 'offline-stub'
process.env.AUTH_JWT_SECRET ??= 'test-secret-m1-mixed-visibility-32chars'

// Minimal-valid AI stub (import-enumerate pattern): forced tools get {}, text gets '{}'.
function stubGlobalFetch() {
  globalThis.fetch = (async (url: string, opts?: { body?: string }) => {
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(opts?.body ?? '{}') } catch { /* ignore */ }
    const toolName = (body?.tool_choice as { name?: string } | undefined)?.name
    const content = toolName
      ? [{ type: 'tool_use', name: toolName, input: {} }]
      : [{ type: 'text', text: '{}' }]
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ content, usage: { input_tokens: 1, output_tokens: 1 } }),
      arrayBuffer: async () => new ArrayBuffer(0),
    }
  }) as unknown as typeof fetch
}

type Ev = { t: string; key?: string; value?: unknown; kind?: string; code?: number }
function makeRes(events: Ev[]) {
  const closeHandlers: Array<() => void> = []
  return {
    closeHandlers,
    setHeader() {}, flushHeaders() {},
    on(ev: string, fn: () => void) { if (ev === 'close') closeHandlers.push(fn) },
    status(code: number) { return { json: (o: unknown) => events.push({ t: 'http', code, value: o }) } },
    write(chunk: unknown) {
      for (const line of String(chunk).split('\n')) {
        if (!line.startsWith('data: ')) continue
        try { events.push(JSON.parse(line.slice(6))) } catch { /* :hb */ }
      }
      return true
    },
    end() { for (const fn of closeHandlers) { try { fn() } catch { /* ignore */ } } },
  }
}

const WB_FRAMEWORK = {
  name: 'mini-framework.csv',
  text: [
    'PRODUCT FRAMEWORK - GENERAL LIABILITY',
    'STATUS,PRODUCT FRAMEWORK ID,PRODUCT,LINE OF BUSINESS,COVERAGE,FORM NUMBER(S)',
    'Active,GL.PROD.001,Monoline GL,Commercial General Liability,,CG 00 01',
    'Active,GL.COV.001,Monoline GL,Commercial General Liability,Premises Liability,CG 00 01',
  ].join('\n'),
  mediaType: 'text/csv',
}
const WB_SECOND = {
  name: 'mini-framework-2.csv',
  text: [
    'PRODUCT FRAMEWORK - GENERAL LIABILITY',
    'STATUS,PRODUCT FRAMEWORK ID,PRODUCT,LINE OF BUSINESS,COVERAGE,FORM NUMBER(S)',
    'Active,GL.COV.002,Monoline GL,Commercial General Liability,Products-Completed Operations,CG 00 01',
  ].join('\n'),
  mediaType: 'text/csv',
}
// Magic-byte-valid minimal PDFs: stage-0 sniffs %PDF and routes them to
// filingDocs; content never matters because the workbook path skips them.
const pdfDoc = (name: string) => ({
  name,
  base64: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8').toString('base64'),
  mediaType: 'application/pdf',
})

async function runImport(documents: unknown[]) {
  stubGlobalFetch()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unifiedImport } = require('../../server/lib/ai/unified-import.js')
  const events: Ev[] = []
  const res = makeRes(events)
  const req = { user: { role: 'ADMIN', sub: 'm1-test', tenantId: 'accenture-test' }, body: { documents } }
  try {
    await Promise.race([
      unifiedImport(req as never, res as never),
      new Promise((_, rej) => setTimeout(() => rej(new Error('harness timeout 90s')), 90_000)),
    ])
  } finally {
    for (const fn of res.closeHandlers) { try { fn() } catch { /* ignore */ } }
  }
  const bundle = events.find(e => e.t === 'json' && e.key === 'bundle')?.value as {
    unresolved: Array<{ stage?: string; kind?: string; name?: string }>
    counts: { proposed: number; accepted: number; unresolved: number }
    importWarnings: Array<{ kind?: string; detail?: string }>
  } | undefined
  return { events, bundle }
}

describe('M1: mixed upload — skipped PDFs are conserved, named, review-visible', () => {
  it('one workbook + two PDFs: each PDF is a NAMED unresolved item and counts conserve', async () => {
    const pdfs = ['wa-rate-manual.pdf', 'nj-rate-order.pdf']
    const { events, bundle } = await runImport([WB_FRAMEWORK, pdfDoc(pdfs[0]), pdfDoc(pdfs[1])])
    expect(bundle).toBeTruthy()
    const b = bundle!

    // 1. Named unresolved items in F13's exact contract shape.
    for (const name of pdfs) {
      const item = b.unresolved.find(u => u.kind === 'unprocessed-document' && u.name === name)
      expect(item, `skipped ${name} must be a named unresolved item`).toBeTruthy()
      expect(item?.stage).toBe('classify')
    }

    // 2. Conservation: the docs are IN the ledger and the identity still holds.
    expect(b.counts.unresolved).toBeGreaterThanOrEqual(pdfs.length)
    expect(b.counts.proposed).toBe(b.counts.accepted + b.counts.unresolved)

    // 3. Per-document NAMED warning on the review contract.
    for (const name of pdfs) {
      expect(
        b.importWarnings.some(w => w.kind === 'unprocessed-document' && String(w.detail).includes(name)),
        `importWarnings must name ${name}`,
      ).toBe(true)
    }

    // 4. The aggregate mixed-upload notice survives, exactly once.
    expect(events.filter(e => e.t === 'notice' && e.kind === 'mixed-upload').length).toBe(1)
  }, 120_000)

  it('two workbooks + one PDF: merge stays duplicate-free and the single PDF is still accounted', async () => {
    const { bundle } = await runImport([WB_FRAMEWORK, WB_SECOND, pdfDoc('pa-auto-manual.pdf')])
    expect(bundle).toBeTruthy()
    const b = bundle! as typeof bundle & { plan?: { coverages?: Array<{ refId?: string; data?: { refId?: string } }> } }

    const item = b!.unresolved.find(u => u.kind === 'unprocessed-document' && u.name === 'pa-auto-manual.pdf')
    expect(item, 'the single skipped PDF must be a named unresolved item').toBeTruthy()
    expect(b!.counts.proposed).toBe(b!.counts.accepted + b!.counts.unresolved)

    // No double-created entities across the two merged workbooks.
    const covIds = (b!.plan?.coverages ?? [])
      .map(c => c.data?.refId ?? c.refId)
      .filter(Boolean)
    expect(new Set(covIds).size).toBe(covIds.length)
  }, 120_000)
})
