// TEMPORARY — live-fold proof (not committed). Runs the REAL buildVizModel reducer
// over SSE events captured from the DEPLOYED server, proving the deployed feature
// renders real content end-to-end. Reads the fixture path from VIZ_FIXTURE.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { buildVizModel } from './AgentVisualizer'
import type { UnifiedStageEvent } from './unifiedImportClient'

const fixturePath = process.env.VIZ_FIXTURE
const cap = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null

describe.skipIf(!cap)('buildVizModel over DEPLOYED-server live events', () => {
  const events: UnifiedStageEvent[] = cap?.events ?? []

  it('detects a real pipeline family (not unknown)', () => {
    const m = buildVizModel(events)
    expect(m.family).not.toBe('unknown')
    console.log(`\n  family=${m.family}  stages=${m.stages.length}  events=${events.length}`)
  })

  it('lights stages to completion from live events', () => {
    const m = buildVizModel(events)
    const done = m.stages.filter(s => s.status === 'done').length
    const errored = m.stages.filter(s => s.status === 'error').length
    console.log(`  stages: ${m.stages.map(s => `${s.id}:${s.status}`).join(' ')}`)
    expect(done).toBeGreaterThanOrEqual(1)
    expect(errored).toBe(0)
  })

  it('surfaces real fleet telemetry (spend) and/or output counts', () => {
    const m = buildVizModel(events)
    console.log(`  spend=${m.spend ? `$${m.spend.spendUsd} across ${m.spend.calls} calls, deployments=${Object.keys(m.spend.byDeployment).join(',')}` : 'none'}`)
    console.log(`  outputCounts=${JSON.stringify(m.outputCounts)}  discrepancies=${m.discrepancyCount}`)
    // A brain run yields spend; a filing run yields at least output/stage detail.
    const hasTelemetry = !!m.spend || !!m.outputCounts || m.stages.some(s => s.detail)
    expect(hasTelemetry).toBe(true)
  })

  it('produces aria-live announcements from real transitions', () => {
    const m = buildVizModel(events)
    console.log(`  announcements(${m.announcements.length}): ${m.announcements.slice(0, 4).join(' | ')}`)
    expect(m.announcements.length).toBeGreaterThan(0)
  })
})
