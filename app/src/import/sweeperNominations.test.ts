// A sweeper nomination is a PROPOSAL and must be opt-in.
//
// Stage 4.5 sweeps cells no extractor claimed and nominates possible entities so nothing is
// silently dropped. They carry confidence 0.5, needsReview, and no refId. They defaulted to
// ACCEPTED in the review, so clicking Import wrote them as peer coverages: a real E+ run
// against the live host offered 59 of them among 154 "coverages", with names like
// "EPLS.COV.005; EPLS.COV.007" — a Forms-Specs reference cell, not a coverage.
import { describe, it, expect } from 'vitest'
import { sweeperNominations } from './UnifiedImportModal'
import type { UnifiedProposalBundle } from '@pf/shared'

const bundle = (plan: Record<string, unknown>) => ({ plan }) as unknown as UnifiedProposalBundle
const nom = (docId: string) => ({ docId, refId: '', data: { name: 'X', sweeperFact: true, needsReview: true, confidence: 0.5 } })
const real = (docId: string, refId: string) => ({ docId, refId, data: { name: 'Bodily Injury Liability Coverage' } })

describe('sweeperNominations', () => {
  it('collects nominations across every group', () => {
    const s = sweeperNominations(bundle({
      coverages: [real('c1', 'A.COV.1'), nom('sweep-a1')],
      rules:     [nom('sweep-r1')],
      forms:     [real('f1', 'F1')],
      ldTables:  [nom('sweep-l1')],
    }))
    expect([...s].sort()).toEqual(['sweep-a1', 'sweep-l1', 'sweep-r1'])
  })

  it('never excludes a genuinely extracted entity', () => {
    const s = sweeperNominations(bundle({ coverages: [real('c1', 'A.COV.1'), real('c2', 'A.COV.2')] }))
    expect(s.size).toBe(0)
  })

  it('tolerates a bundle with missing or malformed groups', () => {
    expect(sweeperNominations(bundle({})).size).toBe(0)
    expect(sweeperNominations(bundle({ coverages: null, rules: 'nope' })).size).toBe(0)
    expect(sweeperNominations({} as unknown as UnifiedProposalBundle).size).toBe(0)
  })

  it('falls back to refId when a nomination carries no docId', () => {
    const s = sweeperNominations(bundle({ coverages: [{ refId: 'R9', data: { sweeperFact: true } }] }))
    expect([...s]).toEqual(['R9'])
  })
})
