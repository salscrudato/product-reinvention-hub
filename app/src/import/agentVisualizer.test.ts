// buildVizModel — the agent visualizer's pure event-fold. These tests pin the
// honesty contract: the model reflects ONLY events actually received (no invented
// activity), family detection follows the server's real event vocabulary, and
// telemetry appears only once the pipeline's own spend event lands.
import { describe, it, expect } from 'vitest'
import { buildVizModel } from './AgentVisualizer'
import type { UnifiedStageEvent } from './unifiedImportClient'

const t0 = 1_000_000
let seq = 0
function tool(name: string, phase: 'start' | 'progress' | 'end', summary?: string): UnifiedStageEvent {
  return { kind: 'tool', name, phase, summary, at: t0 + (seq += 250) }
}
function json(key: string, value: unknown): UnifiedStageEvent {
  return { kind: 'json', key, value, at: t0 + (seq += 250) }
}

describe('buildVizModel', () => {
  it('is an explicit empty state before any event (idle looks idle)', () => {
    const m = buildVizModel([])
    expect(m.family).toBe('unknown')
    expect(m.stages).toHaveLength(0)
    expect(m.spend).toBeUndefined()
    expect(m.announcements).toHaveLength(0)
  })

  it('shows only the router until the family is known (route precedes both families)', () => {
    const m = buildVizModel([tool('brain:stage0:route', 'start', 'Routing 1 artifact(s)')])
    expect(m.family).toBe('unknown')
    expect(m.stages.map(s => s.id)).toEqual(['route'])
    expect(m.stages[0]!.status).toBe('active')
  })

  it('folds a full brain run: statuses, timings, notes, discrepancies, output, spend', () => {
    const events: UnifiedStageEvent[] = [
      tool('brain:stage0:route', 'start', 'Routing 1 artifact(s)'),
      tool('brain:stage0:route', 'end', '1 workbook'),
      json('brain:input', { sourceName: 'GL.xlsx', sourceType: 'xlsx', sheetCount: 3, sheetNames: ['Coverages', 'Rules', 'Notes'] }),
      tool('brain:stage1:classify', 'start', 'Classifying 3 sheet(s)'),
      tool('brain:stage1:classify', 'end', '2 content sheet(s), 1 ignored'),
      tool('brain:stage2:headerLock', 'start'),
      tool('brain:stage2:headerLock', 'end', '2 header(s) locked'),
      tool('brain:stage3:columnMap', 'start'),
      tool('brain:stage3:columnMap', 'end', '14 mapped, 2 unmapped'),
      tool('brain:stage4:extract', 'start', 'Extracting rows'),
      tool('brain:stage4:extract', 'progress', 'batch 1/4'),
      tool('brain:stage4:extract', 'progress', 'batch 2/4'),
      tool('brain:stage4:extract', 'end', '41 entities extracted, 3 flagged'),
      tool('brain:stage5:validate', 'start', 'Validating 41 entities'),
      json('brain:stage5', [
        { fieldLabel: 'Base loss cost', reason: 'value drift between extractors' },
        { fieldPath: 'lcm', note: 'rounding mismatch' },
      ]),
      tool('brain:stage5:validate', 'end', '2 discrepancy(ies) found'),
      tool('brain:stage6:reconcile', 'start'),
      tool('brain:stage6:reconcile', 'end', '41 entities, 5 review items'),
      json('brain:output', { entitiesProduced: 41, coverages: 22 }),
      json('brain:spend', {
        spendUsd: 1.2345, calls: 17, noCap: true,
        byDeployment: { 'claude-haiku-4-5': { calls: 9, inputTokens: 120_000, outputTokens: 8_000, usd: 0.2 } },
      }),
    ]
    const m = buildVizModel(events)

    expect(m.family).toBe('brain')
    expect(m.stages.map(s => s.id)).toEqual(
      ['route', 'classify', 'headerLock', 'columnMap', 'extract', 'validate', 'reconcile'])
    // Every stage that ended is done; route state survived the family switch.
    for (const s of m.stages) expect(s.status).toBe('done')
    expect(m.stages[0]!.detail).toBe('1 workbook')

    const extract = m.stages.find(s => s.id === 'extract')!
    expect(extract.notes).toEqual(['batch 1/4', 'batch 2/4'])
    expect(extract.startAt).toBeLessThan(extract.endAt!)

    expect(m.input).toEqual({ sourceName: 'GL.xlsx', sheetCount: 3, sheetNames: ['Coverages', 'Rules', 'Notes'] })
    expect(m.discrepancyCount).toBe(2)
    expect(m.discrepancies[0]).toEqual({ field: 'Base loss cost', note: 'value drift between extractors' })
    expect(m.outputCounts).toEqual({ entitiesProduced: 41, coverages: 22 })

    expect(m.spend).toBeDefined()
    expect(m.spend!.noCap).toBe(true)
    expect(m.spend!.byDeployment['claude-haiku-4-5']!.inputTokens).toBe(120_000)

    // Announcements exist for starts and ends (aria-live source).
    expect(m.announcements.some(a => a.includes('Sheet classify started'))).toBe(true)
    expect(m.announcements.some(a => a.includes('Reconcile complete'))).toBe(true)
  })

  it('detects the filing family from filing:* events', () => {
    const m = buildVizModel([
      tool('brain:stage0:route', 'start'),
      tool('brain:stage0:route', 'end', '1 filing PDF'),
      tool('filing:classify', 'start'),
      tool('filing:classify', 'end', 'form.pdf -> policyForm'),
      tool('filing:extract:policyForm', 'start'),
    ])
    expect(m.family).toBe('filing')
    const ids = m.stages.map(s => s.id)
    expect(ids).toContain('policyForm')
    expect(m.stages.find(s => s.id === 'route')!.status).toBe('done')       // preserved
    expect(m.stages.find(s => s.id === 'policyForm')!.status).toBe('active')
    expect(m.stages.find(s => s.id === 'rateOrder')!.status).toBe('queued') // not yet observed
  })

  it('detects the single-pass fallback family', () => {
    const m = buildVizModel([tool('extract:coverages', 'start', 'form.pdf')])
    expect(m.family).toBe('fallback')
    expect(m.stages.map(s => s.id)).toEqual(['coverages'])
  })

  it('marks active stages as error on stream failure — never fakes completion', () => {
    const m = buildVizModel([
      tool('brain:stage0:route', 'end'),
      json('brain:input', { sheetCount: 1 }),
      tool('brain:stage1:classify', 'start'),
    ], 'fetch: terminated')
    expect(m.stages.find(s => s.id === 'classify')!.status).toBe('error')
    expect(m.stages.find(s => s.id === 'headerLock')!.status).toBe('queued')
    expect(m.announcements[m.announcements.length - 1]).toContain('Import stream error')
  })

  it('records degrade notices from the real budget-guard event', () => {
    const m = buildVizModel([
      { kind: 'notice', at: t0, notice: { level: 'warn', message: 'soft ceiling', kind: 'degrade' } },
    ])
    expect(m.degraded).toBe(true)
    expect(m.notices).toHaveLength(1)
  })

  it('ignores unknown tool events rather than guessing a stage', () => {
    const m = buildVizModel([tool('load:context', 'start')])
    expect(m.family).toBe('unknown')
    expect(m.stages).toHaveLength(0)
  })
})
