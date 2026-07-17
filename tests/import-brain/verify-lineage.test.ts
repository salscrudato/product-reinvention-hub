/**
 * CE3 step 0 lock: the cross-vendor verify panel's xai lineage is probe-guarded.
 * Grok was deprovisioned 2026-07-16 (operator statement); the registry degrade map
 * (EXTENDED_DEGRADE) plus the runtime guard must route xai -> deepseek by default,
 * honor FOUNDRY_ENABLE_XAI=1, and cache a probe death (404/400) for the process.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vl = require('../../server/lib/import-brain/verify-lineage.js') as {
  resolveVerifyLineage: (l: string) => { lineage: string; degraded: boolean; reason: string }
  verifyWithLineage: (l: string, m: unknown[], o?: unknown, judge?: (lineage: string, m: unknown[], o?: unknown) => Promise<{ text: string }>) => Promise<{ text: string; lineage: string; degraded: boolean }>
  _resetProbeCache: () => void
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bridge = require('../../server/lib/fleet-shared.cjs') as { EXTENDED_DEGRADE: Record<string, string>; degradedExtendedRole: (r: string) => string; WORKBOOK_DIGEST: { primary: string; fallback: string } }

const judgeCalls: string[] = []
let judgeImpl: (lineage: string) => Promise<{ text: string }> = async () => ({ text: 'ok' })
const judge = (lineage: string) => { judgeCalls.push(lineage); return judgeImpl(lineage) }

describe('verify-lineage (CE3 step 0)', () => {
  beforeEach(() => { judgeCalls.length = 0; vl._resetProbeCache(); delete process.env.FOUNDRY_ENABLE_XAI; judgeImpl = async () => ({ text: 'ok' }) })
  afterEach(() => { delete process.env.FOUNDRY_ENABLE_XAI })

  it('registry carries the xai -> deepseek degrade and the WORKBOOK_DIGEST descriptor', () => {
    expect(bridge.EXTENDED_DEGRADE['VERIFY_XAI']).toBe('VERIFY_DEEPSEEK')
    expect(bridge.degradedExtendedRole('VERIFY_XAI')).toBe('VERIFY_DEEPSEEK')
    expect(bridge.WORKBOOK_DIGEST.primary).toBe('DEEP_REASONER')
    expect(bridge.WORKBOOK_DIGEST.fallback).toBe('GROUNDED_CITED')
  })

  it('xai degrades to deepseek when not configured (the 2026-07-16 default)', () => {
    const r = vl.resolveVerifyLineage('xai')
    expect(r).toEqual({ lineage: 'deepseek', degraded: true, reason: 'xai_not_configured' })
  })

  it('deepseek passes through untouched', () => {
    expect(vl.resolveVerifyLineage('deepseek')).toEqual({ lineage: 'deepseek', degraded: false, reason: 'ok' })
  })

  it('FOUNDRY_ENABLE_XAI=1 re-enables the lineage', () => {
    process.env.FOUNDRY_ENABLE_XAI = '1'
    expect(vl.resolveVerifyLineage('xai')).toEqual({ lineage: 'xai', degraded: false, reason: 'ok' })
  })

  it('verifyWithLineage dispatches the degraded lineage', async () => {
    const out = await vl.verifyWithLineage('xai', [], {}, judge)
    expect(out.lineage).toBe('deepseek')
    expect(out.degraded).toBe(true)
    expect(judgeCalls).toEqual(['deepseek'])
  })

  it('a 404 from an enabled xai call caches the death and retries once on deepseek', async () => {
    process.env.FOUNDRY_ENABLE_XAI = '1'
    judgeImpl = async (lineage) => {
      if (lineage === 'xai') { const e = new Error('foundry_404: model not found') as Error & { status: number }; e.status = 404; throw e }
      return { text: 'ds ok' }
    }
    const out = await vl.verifyWithLineage('xai', [], {}, judge)
    expect(out.lineage).toBe('deepseek')
    expect(out.text).toBe('ds ok')
    expect(judgeCalls).toEqual(['xai', 'deepseek'])
    // Probe death is cached: the next request never re-attempts xai.
    judgeCalls.length = 0
    const out2 = await vl.verifyWithLineage('xai', [], {}, judge)
    expect(out2.lineage).toBe('deepseek')
    expect(judgeCalls).toEqual(['deepseek'])
    expect(vl.resolveVerifyLineage('xai').reason).toBe('xai_probe_dead')
  })

  it('a genuine non-availability error from xai is NOT swallowed', async () => {
    process.env.FOUNDRY_ENABLE_XAI = '1'
    judgeImpl = async (lineage) => {
      if (lineage === 'xai') { const e = new Error('foundry_500: upstream') as Error & { status: number }; e.status = 500; throw e }
      return { text: 'ds' }
    }
    await expect(vl.verifyWithLineage('xai', [], {}, judge)).rejects.toThrow('foundry_500')
  })
})
