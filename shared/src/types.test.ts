// Smoke test — verifies shared types compile and are exported correctly.
// Real tests (rating evaluator, rules engine, seed assertions) are added in Prompt 2.
import { describe, it, expect } from 'vitest'
import type { GovernanceBlock, Status, Lifecycle } from './types'

describe('shared types', () => {
  it('GovernanceBlock has expected fields', () => {
    const block: GovernanceBlock = {
      status: 'ACTIVE' as Status,
      lifecycle: 'LAUNCHED' as Lifecycle,
      reviewStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: 'uid-001',
      rev: 1,
    }
    expect(block.status).toBe('ACTIVE')
    expect(block.rev).toBe(1)
  })
})
