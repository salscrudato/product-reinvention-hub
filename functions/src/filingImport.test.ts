// filingImport.test.ts — the AI_FAKE end-to-end for the filing pipeline. Drives
// CLASSIFY → EXTRACT → RECONCILE with the fake forced-tool client (no live Anthropic call),
// exercising the real sanitizers, deterministic table parser and reconcile, and asserts the
// SSE event sequence a client (the review UI) would consume, plus the reconciled bundle.
import { describe, it, expect } from 'vitest'
import { runFilingPipeline } from './filingImport'
import { createFakeFilingClient } from './fake'
import { emptyUsage } from './telemetry'
import type { StreamEvent } from './runtime'
import { evaluate, makePHRtGetter, makePHLdGetter, FILING_WORKED_EXAMPLE } from '@pf/shared'
import type { RTTable, LDTable, RatingProgram } from '@pf/shared'

// The three reference documents, passed as text so the fake classifier can read the filename.
const documents = [
  { name: 'NJ HO Rate Order of Calculations.pdf', text: 'RATE ORDER OF CALCULATIONS' },
  { name: 'NJ HO Manual 02.27.24.pdf', text: 'HOMEOWNERS MANUAL' },
  { name: 'LEM 03 05 23 Lemonade Homeowners_FINAL.pdf', text: 'LEM 03 05 23 Lemonade Homeowners policy form' },
]

async function run() {
  const events: StreamEvent[] = []
  const { bundle } = await runFilingPipeline({
    client: createFakeFilingClient(),
    documents,
    degraded: false,
    cheapUsage: emptyUsage(),
    strongUsage: emptyUsage(),
    emit: (ev) => events.push(ev),
  })
  return { events, bundle }
}

describe('filing pipeline (AI_FAKE) — upload → classify → extract → reconcile', () => {
  it('classifies each document by its structural role', async () => {
    const { events } = await run()
    const classify = events.find(e => e.t === 'json' && e.key === 'classifications')
    expect(classify).toBeDefined()
    const roles = (classify as { value: { name: string; role: string }[] }).value
    expect(roles.find(r => /Rate Order/.test(r.name))!.role).toBe('rateOrder')
    expect(roles.find(r => /Manual/.test(r.name))!.role).toBe('manual')
    expect(roles.find(r => /LEM 03/.test(r.name))!.role).toBe('policyForm')
  })

  it('streams the staged tool events in order (classify → extract → reconcile)', async () => {
    const { events } = await run()
    const toolStarts = events.filter(e => e.t === 'tool' && e.phase === 'start').map(e => (e as { name: string }).name)
    expect(toolStarts[0]).toBe('classify')
    expect(toolStarts).toContain('extract:rateOrder')
    expect(toolStarts).toContain('extract:manual')
    expect(toolStarts.some(n => n.startsWith('policyForm:'))).toBe(true)
    expect(toolStarts[toolStarts.length - 1]).toBe('reconcile')
  })

  it('emits a reviewable bundle with zero silent drops', async () => {
    const { events, bundle } = await run()
    const bundleEv = events.find(e => e.t === 'json' && e.key === 'bundle')
    expect(bundleEv).toBeDefined()
    expect(bundle.counts.proposed).toBe(bundle.counts.accepted + bundle.counts.unresolved)
    expect(bundle.unresolved.length).toBeGreaterThan(0)
    for (const u of bundle.unresolved) expect(u.citation.length).toBeGreaterThan(0)
  })

  it('produces a priceable product — the imported program computes the $1,281 canary', async () => {
    const { bundle } = await run()
    const rt: Record<string, RTTable> = {}
    for (const t of bundle.plan.rtTables) rt[t.refId!] = t.data as unknown as RTTable
    const ld: Record<string, LDTable> = {}
    for (const t of bundle.plan.ldTables) ld[t.refId!] = t.data as unknown as LDTable
    const prog = bundle.plan.ratingProgram!.data as unknown as RatingProgram
    const result = evaluate(prog, FILING_WORKED_EXAMPLE, makePHRtGetter(rt), makePHLdGetter(ld))
    expect(result.finalPremium).toBe(1281)
    expect(prog.creditFloor).toBe(0.5)
    expect(bundle.plan.product!.data['states']).toEqual(['NJ'])
  })
})
