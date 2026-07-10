// golden.test.ts — byte-stable GOLDEN snapshots of the FULL Duck Creek export for every
// seeded line (Personal Home, Personal Auto, General Liability). Three guarantees:
//   1. DETERMINISM — two independent builds serialize byte-identically (no clocks / no RNG).
//   2. REGRESSION LOCK — each export equals a committed golden .xml file, so an unintended
//      serializer/mapping change surfaces as a reviewable diff, never a silent rewrite.
//   3. VALIDITY — every golden export passes validateDuckCreek (ok=true).
// Regenerate deliberately: `UPDATE_GOLDEN=1 pnpm --filter @pf/shared test golden`. The golden
// files live under __golden__/ and are committed + diff-reviewed.
//
// The Prompt-6 filing-import fixture (NJ Lemonade) is intentionally NOT snapshotted here: it is
// an import-time artifact produced by reconcileFiling(), not a seeded standing DomainProductBundle,
// so there is no PDM to serialize. See docs/reviews/DUCKCREEK_RECONCILIATION.md.
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  buildPersonalHomePdm, buildPersonalAutoPdm, buildGeneralLiabilityPdm,
} from '../pdm/source'
import { serializePdmToDuckCreek } from './serialize'
import { validateDuckCreek } from './validate'
import type { PdmProduct } from '../pdm/types'

const HERE       = dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = join(HERE, '__golden__')
const UPDATE     = process.env.UPDATE_GOLDEN === '1'

// [display name, file slug, PDM builder]
const LINES: Array<[string, string, () => PdmProduct]> = [
  ['Personal Home',     'personalHome',     buildPersonalHomePdm],
  ['Personal Auto',     'personalAuto',     buildPersonalAutoPdm],
  ['General Liability', 'generalLiability', buildGeneralLiabilityPdm],
]

// Normalise CRLF → LF so the compare survives a Windows checkout even though .gitattributes
// pins these files to eol=lf; the serializer only ever emits LF.
const lf = (s: string): string => s.replace(/\r\n/g, '\n')

describe.each(LINES)('golden Duck Creek export — %s', (_name, slug, build) => {
  const file = join(GOLDEN_DIR, `${slug}.duckcreek.xml`)
  const xml  = serializePdmToDuckCreek(build())

  it('serializes byte-identically across two independent builds (determinism)', () => {
    expect(serializePdmToDuckCreek(build())).toBe(xml)
  })

  it('matches the committed golden file (regenerate with UPDATE_GOLDEN=1)', () => {
    if (UPDATE) {
      if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true })
      writeFileSync(file, xml, 'utf8')
    }
    expect(existsSync(file), `golden missing: ${file} — regenerate with UPDATE_GOLDEN=1`).toBe(true)
    expect(xml).toBe(lf(readFileSync(file, 'utf8')))
  })

  it('the golden export validates clean (ok=true)', () => {
    const report = validateDuckCreek(build(), xml)
    expect(report.ok).toBe(true)
  })
})
