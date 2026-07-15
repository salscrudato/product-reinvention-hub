// fleet.lock.test.ts — H5: PIN the task→model routing (the FLEET_AUDIT decision).
//
// This lock lives in shared/src so it runs in the @pf/shared CI canary step — i.e. it is
// DEPLOY-BLOCKING. It fixes each routed task to the IMPORT-CERTIFIED deployment. A change to
// ANY import-path model (the haiku→sonnet→opus ladder + the gpt judge/validator + the gpt-mini
// prefilter) MUST first re-run the import certification slice green on the new model
// (docs/build/FLEET_AUDIT.md · `npx tsx scripts/phaseg-holdout.mts --check --seed GL/IM`
// + offline `npx tsx scripts/import-eval.mts`); a red slice reverts the swap. This test turning
// red is the tripwire that forces that process — do not "fix" it by editing the numbers without
// re-certifying. The Claude Code coding-driver selection is out of scope (pinned by the build pack).
import { describe, it, expect } from 'vitest'
import {
  resolveDeployment, allDeployments, degradedRole, ESCALATION_LADDER,
  DEPLOY_OPUS, DEPLOY_SONNET, DEPLOY_HAIKU, DEPLOY_GPT, DEPLOY_GPT_MINI, DEPLOY_EMBED,
  type ModelRole,
} from './fleet'

// The certified fleet — role → { deployment, sdk }. Deployment names are Foundry identifiers.
const CERTIFIED: Record<ModelRole, { deployment: string; sdk: 'anthropic' | 'openai' }> = {
  GROUNDED_CITED: { deployment: 'claude-opus-4-8', sdk: 'anthropic' }, // deep grounded+cited reasoning; import stages 0/2/3/4-ladder-top/7
  MID_REASONER:   { deployment: 'claude-sonnet-5', sdk: 'anthropic' }, // import ladder mid-rung + filing verifier
  BULK_VERIFY:    { deployment: 'claude-haiku-4-5', sdk: 'anthropic' }, // import bulk extract + product summaries
  VISION:         { deployment: 'gpt-5.1', sdk: 'openai' },            // decorrelated judge/validator + vision extraction
  CHEAP_GENERAL:  { deployment: 'gpt-5-mini', sdk: 'openai' },         // cheap prefilter + degrade target
  EMBED:          { deployment: 'text-embedding-3-small', sdk: 'openai' }, // dense RAG vectors (no cheaper alt provisioned)
}

describe('H5 fleet lock — task → model routing is pinned to the certified fleet', () => {
  it('every role resolves to its certified deployment + SDK family', () => {
    for (const role of Object.keys(CERTIFIED) as ModelRole[]) {
      const d = resolveDeployment(role)
      expect(d.deploymentName).toBe(CERTIFIED[role].deployment)
      expect(d.sdkFamily).toBe(CERTIFIED[role].sdk)
    }
  })

  it('the named deployment constants match the certified fleet', () => {
    expect(DEPLOY_OPUS).toBe('claude-opus-4-8')
    expect(DEPLOY_SONNET).toBe('claude-sonnet-5')
    expect(DEPLOY_HAIKU).toBe('claude-haiku-4-5')
    expect(DEPLOY_GPT).toBe('gpt-5.1')
    expect(DEPLOY_GPT_MINI).toBe('gpt-5-mini')
    expect(DEPLOY_EMBED).toBe('text-embedding-3-small')
  })

  it('the import escalation ladder is exactly haiku → sonnet → opus (re-cert required to change)', () => {
    expect([...ESCALATION_LADDER]).toEqual(['BULK_VERIFY', 'MID_REASONER', 'GROUNDED_CITED'])
    expect(ESCALATION_LADDER.map((r) => resolveDeployment(r).deploymentName))
      .toEqual(['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-4-8'])
  })

  it('the cost-degrade graph stays within the same SDK family (import path bypasses it)', () => {
    expect(degradedRole('GROUNDED_CITED')).toBe('BULK_VERIFY')  // opus → haiku (anthropic)
    expect(degradedRole('MID_REASONER')).toBe('BULK_VERIFY')    // sonnet → haiku (anthropic)
    expect(degradedRole('VISION')).toBe('CHEAP_GENERAL')        // gpt-5.1 → gpt-mini (openai)
    expect(degradedRole('BULK_VERIFY')).toBe('BULK_VERIFY')     // cheapest tier — no cheaper rung
    expect(degradedRole('EMBED')).toBe('EMBED')
  })

  it('NEVER routes to claude-fable-5 (forbidden per CLAUDE.md model-ids invariant)', () => {
    for (const d of allDeployments()) expect(d.deploymentName).not.toBe('claude-fable-5')
  })

  it('the registry has exactly the six routed roles — no silent additions', () => {
    expect(allDeployments().map((d) => d.role).sort()).toEqual(
      ['BULK_VERIFY', 'CHEAP_GENERAL', 'EMBED', 'GROUNDED_CITED', 'MID_REASONER', 'VISION'],
    )
  })
})
