// import/plan.ts — registry-driven extraction planner.
// Takes a FormatFingerprint and returns ONE ExtractionPlan that is fully data-driven
// from the matched LineArchetype: document roles → extractors, split strategy, archetype.
// No per-format branching: the archetype data IS the format-specific logic.
// Pure function — no I/O, no AI calls.

import type {
  FormatFingerprint, ExtractionPlan, DocumentRoleAssignment, ExtractorKind, DetectedFormat,
} from '@pf/shared'
import { resolveLineArchetype, allLineArchetypes } from '@pf/shared'
import type { LineArchetype } from '@pf/shared'

/** Build an ExtractionPlan from a fingerprint. The plan is fully data-driven:
 *  document role assignments come from the archetype's documentRoleFingerprints,
 *  and the split strategy comes from the archetype's translationRecipe.
 *  Caller can pass an explicit archetype override (e.g. for the test harness). */
export function planExtraction(
  fingerprint: FormatFingerprint,
  archetypeOverride?: LineArchetype,
): ExtractionPlan {
  const archetype = archetypeOverride ?? resolveArchetypeFromFingerprint(fingerprint)

  // Build role assignments for each document in the fingerprint.
  // If fingerprint.documentRoles is empty (e.g. ISO_WORKBOOK has no per-doc roles yet),
  // generate assignments from the archetype's documentRoleFingerprints instead.
  let assignments: DocumentRoleAssignment[]

  if (fingerprint.documentRoles.length > 0) {
    assignments = fingerprint.documentRoles.map(({ documentName, role }) => ({
      documentName,
      role,
      extractor: selectExtractor(fingerprint.detectedFormat, role),
    }))
  } else {
    // Fallback: assign each archetype role to the first (and only) doc
    const primaryName = fingerprint.documentRoles[0]?.documentName ?? 'upload'
    assignments = archetype.documentRoleFingerprints.map(fp => ({
      documentName: primaryName,
      role:         fp.role,
      extractor:    selectExtractor(fingerprint.detectedFormat, fp.role),
    }))
    // If still nothing, at least one MANUAL assignment so the pipeline runs
    if (assignments.length === 0) {
      assignments = [{ documentName: primaryName, role: 'MANUAL', extractor: selectExtractor(fingerprint.detectedFormat, 'MANUAL') }]
    }
  }

  return {
    format:                  fingerprint.detectedFormat,
    lobRefId:                archetype.lobRefId,
    archetype,
    documentRoleAssignments: assignments,
    splitStrategy:           archetype.translationRecipe.productSplitStrategy,
  }
}

// ─── Archetype resolution ─────────────────────────────────────────────────────

function resolveArchetypeFromFingerprint(fp: FormatFingerprint): LineArchetype {
  // Prefer the best line guess
  if (fp.lineGuesses.length > 0) {
    const best = fp.lineGuesses[0]!
    const resolved = resolveLineArchetype(best.lobRefId)
    if (resolved) return resolved
  }

  // Format heuristics when no line signal exists
  switch (fp.detectedFormat) {
    case 'ISO_WORKBOOK':      return resolveLineArchetype('PH.LOB.001') ?? fallback()
    case 'ERC_PACKAGE':       return resolveLineArchetype('WC.FAMILY')  ?? fallback()
    case 'COMPANY_FILING_PDF':return resolveLineArchetype('PH.LOB.001') ?? fallback()
    default:                  return fallback()
  }
}

function fallback(): LineArchetype {
  const all = allLineArchetypes()
  if (all.length === 0) throw new Error('LINE_INTELLIGENCE_REGISTRY is empty')
  return all[0]!
}

// ─── Extractor selection ──────────────────────────────────────────────────────

function selectExtractor(format: DetectedFormat, role: string): ExtractorKind {
  // Deterministic-only formats: XLSX workbooks, ERC packages (CSV + XML members)
  if (format === 'ISO_WORKBOOK' || format === 'ERC_PACKAGE') return 'DETERMINISTIC_TABLE'

  // SERFF: schedule/class/territory tables are deterministic; supplementals use AI
  if (format === 'SERFF_PACKAGE') {
    if (role === 'SERFF_SCHEDULE' || role === 'CLASS_TABLE' || role === 'TERRITORY_TABLE') {
      return 'DETERMINISTIC_TABLE'
    }
    return 'AI_EXTRACT_FAST'
  }

  // Company filing PDFs: policy form uses full model (4-section machinery);
  // rate order and manual use cheap-first with escalation.
  if (role === 'POLICY_FORM') return 'AI_EXTRACT_FULL'
  if (role === 'RATE_ORDER' || role === 'MANUAL' || role === 'RULES') return 'AI_EXTRACT_FAST'

  // Default for other roles (DECLARATIONS, TERRITORY_TABLE, etc.)
  return 'AI_EXTRACT_FAST'
}
