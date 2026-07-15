// CORE (Hagerty collector-auto) concept-linker acceptance — pins the golden-VISIBLE half of
// the acceptance table (product / coverage / rule / reference-table / rate-placeholder entities
// + the D8 coverage-resolution scalars) so a regression in the deterministic concept-matched
// parse reddens the gate cheaply (reads the golden JSON — no 3.5 MB workbook parse).
//
// The golden-INVISIBLE half — 153 coverage terms, 57 rating groups / 54 matched / 3 flagged,
// 107 form anchor-upgrades — lives in nested arrays / refId:null form entities the golden
// mechanism drops by design; it is verified end-to-end by `pnpm import:eval` (offline) against
// the same file and reported at review time. See docs/prompts/PROMPT_IMPORT_CONCEPT_LINKER.md.
import { describe, it, expect } from 'vitest'
import CORE from '../golden/import/CORE.golden.json'

interface GEntity { kind: string; refId: string; fields: Record<string, unknown> }
const entities = (CORE as { entities: GEntity[] }).entities
const byKind = (k: string): GEntity[] => entities.filter(e => e.kind === k)

describe('CORE concept-linker acceptance (golden-visible counts)', () => {
  it('recovers the full linked model the sheet-name-only mapper dropped', () => {
    expect(byKind('product')).toHaveLength(1)
    expect(byKind('coverage')).toHaveLength(112)        // 19 coverages + 93 sub-coverages (114 nodes incl. product+line)
    expect(byKind('rule')).toHaveLength(234)
    expect(byKind('ldTable')).toHaveLength(51)          // reference tables recovered by signature — was 0
    expect(byKind('ratePlaceholder')).toHaveLength(123) // one per distinct factor the algorithm names (D4)
  })

  it('every reference table is a MINTED id (never reads as a source id)', () => {
    const tables = byKind('ldTable')
    expect(tables.every(t => t.fields['mintedId'] === true)).toBe(true)
    expect(tables.every(t => /\.TBL\.\d{3}$/.test(t.refId))).toBe(true)
  })

  it('resolves exactly the 3 rule references that name a coverage rather than a table (D8)', () => {
    expect(byKind('rule').filter(r => r.fields['resolvedCoverageRefId']).length).toBe(3)
  })
})
