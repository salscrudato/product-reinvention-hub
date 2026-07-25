// pricingLinks — resolve which rating steps (and the tables they read) reference a
// given coverage, so the Pricing surface can show the linkage a PM needs: "these
// steps price this coverage." Grounded, not guessed — a step is linked when it reads
// a table one of the coverage's terms references (`ldTableRef`), or when the step's
// own label / input keys name the coverage (e.g. the "Coverage E increased-limit
// charge" step ↔ Coverage E, "Water back-up flat premium" ↔ Water Back-Up). Pure and
// line-agnostic: it works off whatever the coverage and rating program actually say.
import type { Coverage, RatingProgram, RatingStep, RTTable, LDTable } from '@pf/shared'

export interface PricingLinkTable { ref: string; name: string }
export interface PricingLink {
  steps:  RatingStep[]
  tables: PricingLinkTable[]
}

// Generic words that would over-match if treated as coverage identifiers.
const STOPWORDS = new Set([
  'coverage', 'limit', 'limits', 'amount', 'increased', 'other', 'personal',
  'property', 'per', 'and', 'the', 'for', 'with',
])

/** Distinctive lowercase tokens that identify a coverage in free text: the "coverage
 *  X" section phrase and any non-generic word (≥4 chars) from its name. */
function coverageTokens(cov: Pick<Coverage, 'name'>): { phrase: string | null; words: string[] } {
  const letter = /coverage\s+([a-z])\b/i.exec(cov.name)?.[1]?.toLowerCase()
  const words = cov.name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOPWORDS.has(w))
  return { phrase: letter ? `coverage ${letter}` : null, words }
}

/** The rating steps that reference this coverage, plus the distinct tables they read. */
export function linkCoverageToPricing(
  cov: Pick<Coverage, 'name' | 'terms'> & { refId?: string | null },
  program: Pick<RatingProgram, 'steps'> | null | undefined,
  rtTables: Record<string, RTTable>,
  ldTables: Record<string, LDTable>,
): PricingLink {
  const steps = program?.steps ?? []
  const { phrase, words } = coverageTokens(cov)
  const termRefs = new Set((cov.terms ?? []).map(t => t.ldTableRef).filter((r): r is string => !!r))

  // A STATED link beats every heuristic below. Core-format rating sheets name the coverage
  // each step prices in their own column (canonicalMap's `coverageRef`, e.g. "CORE.COV.018"),
  // and the importer now carries it onto the step. Matching on it first means a step is
  // attributed because the SOURCE said so — not because its label happened to share a word
  // with the coverage's name, which both over-matches ("Automotive Tools" ↔ any step
  // mentioning tools) and under-matches (a step labelled only "Base rate" links to nothing).
  const covRefId = (cov.refId ?? '').trim()
  const stepCoverageRef = (s: RatingStep): string =>
    String((s as RatingStep & { coverageRef?: unknown }).coverageRef ?? '').trim()
  const stated = covRefId
    ? steps.filter(s => {
        const cr = stepCoverageRef(s)
        // The cell may list several coverages ("CORE.COV.005; CORE.COV.007").
        return cr !== '' && cr.split(/[;,]/).some(p => p.trim() === covRefId)
      })
    : []
  if (stated.length > 0) {
    const tables: PricingLinkTable[] = []
    const seen = new Set<string>()
    for (const step of stated) {
      const ref = step.source?.ref
      if (!ref || seen.has(ref)) continue
      seen.add(ref)
      tables.push({ ref, name: rtTables[ref]?.name ?? ldTables[ref]?.name ?? ref })
    }
    return { steps: stated, tables }
  }

  const matched = steps.filter(step => {
    const ref = step.source?.ref
    if (ref && termRefs.has(ref)) return true                       // shares a table with the coverage
    const haystack = `${step.label} ${(step.source?.keys ?? []).join(' ')} ${ref ?? ''}`.toLowerCase()
    if (phrase && haystack.includes(phrase)) return true            // step names the coverage section
    const stepWords = new Set(haystack.split(/[^a-z0-9]+/))
    return words.some(w => stepWords.has(w))                        // step names a distinctive word
  })

  const tables: PricingLinkTable[] = []
  const seen = new Set<string>()
  for (const step of matched) {
    const ref = step.source?.ref
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    tables.push({ ref, name: rtTables[ref]?.name ?? ldTables[ref]?.name ?? ref })
  }

  return { steps: matched, tables }
}
