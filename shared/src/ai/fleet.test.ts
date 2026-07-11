import { describe, it, expect } from 'vitest'
import {
  resolveDeployment,
  allDeployments,
  degradedRole,
  estimateCostUsd,
  FLEET_PRICING,
  DEPLOY_OPUS,
  DEPLOY_HAIKU,
  DEPLOY_GPT,
  DEPLOY_GPT_MINI,
} from './fleet'

describe('fleet registry', () => {
  it('maps each role to its Foundry deployment + SDK family', () => {
    expect(resolveDeployment('GROUNDED_CITED')).toMatchObject({ deploymentName: 'claude-opus-4-8', sdkFamily: 'anthropic' })
    expect(resolveDeployment('BULK_VERIFY')).toMatchObject({ deploymentName: 'claude-haiku-4-5', sdkFamily: 'anthropic' })
    expect(resolveDeployment('VISION')).toMatchObject({ deploymentName: 'gpt-5.1', sdkFamily: 'openai' })
    expect(resolveDeployment('CHEAP_GENERAL')).toMatchObject({ deploymentName: 'gpt-5-mini', sdkFamily: 'openai' })
  })

  it('never resolves to a banned model id', () => {
    for (const d of allDeployments()) expect(d.deploymentName).not.toBe('claude-fable-5')
  })

  it('exposes convenience name constants matching the registry', () => {
    expect(DEPLOY_OPUS).toBe('claude-opus-4-8')
    expect(DEPLOY_HAIKU).toBe('claude-haiku-4-5')
    expect(DEPLOY_GPT).toBe('gpt-5.1')
    expect(DEPLOY_GPT_MINI).toBe('gpt-5-mini')
  })

  it('honours per-role name overrides', () => {
    expect(resolveDeployment('GROUNDED_CITED', { GROUNDED_CITED: 'claude-opus-test' }).deploymentName).toBe('claude-opus-test')
  })
})

describe('degradedRole', () => {
  it('degrades heavy roles to the cheaper same-family tier', () => {
    expect(degradedRole('GROUNDED_CITED')).toBe('BULK_VERIFY')
    expect(degradedRole('VISION')).toBe('CHEAP_GENERAL')
  })
  it('leaves already-cheap roles unchanged (no cheaper tier)', () => {
    expect(degradedRole('BULK_VERIFY')).toBe('BULK_VERIFY')
    expect(degradedRole('CHEAP_GENERAL')).toBe('CHEAP_GENERAL')
  })
})

describe('estimateCostUsd', () => {
  it('prices a call from the per-deployment table', () => {
    // opus: $15/M in, $75/M out → 1M in + 1M out = $90
    expect(estimateCostUsd(DEPLOY_OPUS, 1_000_000, 1_000_000)).toBeCloseTo(90, 6)
    // haiku: $0.80/M in, $4/M out → 500k in + 250k out = 0.4 + 1.0 = $1.4
    expect(estimateCostUsd(DEPLOY_HAIKU, 500_000, 250_000)).toBeCloseTo(1.4, 6)
  })

  it('has pricing for every deployment', () => {
    for (const d of allDeployments()) expect(FLEET_PRICING[d.deploymentName]).toBeDefined()
  })

  it('fails safe: an unknown deployment is priced at the most-expensive tier', () => {
    expect(estimateCostUsd('mystery-model', 1_000_000, 0)).toBe(estimateCostUsd(DEPLOY_OPUS, 1_000_000, 0))
  })

  it('never returns a negative cost for negative token counts', () => {
    expect(estimateCostUsd(DEPLOY_OPUS, -5, -5)).toBe(0)
  })
})
