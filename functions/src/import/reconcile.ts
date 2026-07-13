// import/reconcile.ts — unified reconciliation stage.
// Wraps the existing pure reconcileFiling() (shared/src/insurance/filing/reconcile.ts)
// for the COMPANY_FILING_PDF path and builds UnifiedProposalBundle shells for the
// ISO_WORKBOOK path and generic formats. The output shape is ALWAYS UnifiedProposalBundle
// regardless of input format — one type for the review UI and the persistence layer.
// Pure functions — no I/O, no AI calls.

import type {
  UnifiedProposalBundle, FormatFingerprint, ExtractionPlan,
  SampledVerification, SplitProductProposal, FormatCard,
} from '@pf/shared'
import { reconcileFiling } from '@pf/shared'
import type { FilingExtraction, FilingImportPlan, UnresolvedItem } from '@pf/shared'
import type { ImportPlan, ImportSummary } from '@pf/shared'

// ─── Wrap an existing FilingImportPlan ────────────────────────────────────────

/** Wrap a FilingImportPlan (from reconcileFiling()) into a UnifiedProposalBundle
 *  by adding fingerprint, plan, verification and split metadata. */
export function wrapFilingBundle(
  base: FilingImportPlan,
  fingerprint: FormatFingerprint,
  extractionPlan: ExtractionPlan,
  sampledVerifications: SampledVerification[],
  splitProducts: SplitProductProposal[],
  formatCard?: FormatCard,
): UnifiedProposalBundle {
  return {
    ...base,
    fingerprint,
    extractionPlan,
    sampledVerifications,
    splitProducts,
    ...(formatCard ? { formatCard } : {}),
  }
}

// ─── Wrap an ISO workbook ImportPlan ──────────────────────────────────────────

/** Wrap an ISO workbook ImportPlan (from mapIsoWorkbook()) into a UnifiedProposalBundle.
 *  The workbook path is fully deterministic, so review sections are empty and
 *  unresolved is empty (all items accepted). */
export function wrapWorkbookBundle(
  importPlan: ImportPlan,
  fingerprint: FormatFingerprint,
  extractionPlan: ExtractionPlan,
  sampledVerifications: SampledVerification[],
  splitProducts: SplitProductProposal[],
): UnifiedProposalBundle {
  const total = countImportPlanItems(importPlan)

  const filingShell: FilingImportPlan = {
    plan: importPlan,
    filingState:       '',
    baseFormNumber:    importPlan.product?.refId ?? importPlan.productId ?? '',
    baseFormEdition:   '',
    review: {
      product:   { items: [] },
      coverages: { items: [] },
      tables:    { items: [] },
      rules:     { items: [] },
      rating:    { items: [] },
    },
    unresolved: [],
    counts: {
      proposed:   total,
      accepted:   total,
      unresolved: 0,
    },
  }

  return {
    ...filingShell,
    fingerprint,
    extractionPlan,
    sampledVerifications,
    splitProducts,
  }
}

// ─── Reconcile a filing extraction into a bundle ──────────────────────────────

/** Reconcile a FilingExtraction (from CLASSIFY+EXTRACT stages) into a UnifiedProposalBundle.
 *  Delegates to the existing pure reconcileFiling() and wraps the result. */
export function reconcileFilingToBundle(
  extraction: FilingExtraction,
  fingerprint: FormatFingerprint,
  extractionPlan: ExtractionPlan,
  sampledVerifications: SampledVerification[],
  splitProducts: SplitProductProposal[],
  formatCard?: FormatCard,
): UnifiedProposalBundle {
  const base = reconcileFiling(extraction)
  return wrapFilingBundle(base, fingerprint, extractionPlan, sampledVerifications, splitProducts, formatCard)
}

// ─── Empty bundle (for error / unsupported formats) ──────────────────────────

/** Build a minimal UnifiedProposalBundle with one UNRESOLVED item carrying the reason. */
export function buildEmptyBundle(
  fingerprint: FormatFingerprint,
  extractionPlan: ExtractionPlan,
  sampledVerifications: SampledVerification[],
  splitProducts: SplitProductProposal[],
  unresolvedReason: string,
  formatCard?: FormatCard,
): UnifiedProposalBundle {
  const emptySummary: ImportSummary = {
    productName:      null,
    productRefId:     null,
    lobName:          null,
    counts:           {},
    warnings:         [unresolvedReason],
    unmappedColumns:  [],
    sheetsRecognized: [],
    sheetsSkipped:    [],
    defects:          [],
    notices:          [],
  }

  const emptyPlan: ImportPlan = {
    productId:     null,
    product:       null,
    products:      [],
    coverages:     [],
    forms:         [],
    rules:         [],
    formRules:     [],
    ratingProgram: null,
    ldTables:      [],
    rtTables:      [],
    summary:       emptySummary,
  }

  const unresolved: UnresolvedItem[] = [{
    stage:    'rateOrder',
    kind:     'OTHER',
    name:     'Extraction',
    reason:   unresolvedReason,
    citation: '',
  }]

  const filingShell: FilingImportPlan = {
    plan:            emptyPlan,
    filingState:     '',
    baseFormNumber:  '',
    baseFormEdition: '',
    review: {
      product:   { items: [] },
      coverages: { items: [] },
      tables:    { items: [] },
      rules:     { items: [] },
      rating:    { items: [] },
    },
    unresolved,
    counts:          { proposed: 1, accepted: 0, unresolved: 1 },
  }

  return {
    ...filingShell,
    fingerprint,
    extractionPlan,
    sampledVerifications,
    splitProducts,
    ...(formatCard ? { formatCard } : {}),
  }
}

// ─── Count items in an ImportPlan ────────────────────────────────────────────

function countImportPlanItems(plan: ImportPlan): number {
  // Use summary.counts when available (more accurate for nested coverages / dynamic fields)
  if (plan.summary?.counts) {
    const total = Object.values(plan.summary.counts).reduce((a, b) => a + b, 0)
    if (total > 0) return total
  }
  // Fallback: count top-level arrays
  return (
    (plan.product ? 1 : 0) +
    plan.coverages.length +
    plan.forms.length +
    plan.rules.length +
    plan.formRules.length +
    plan.rtTables.length +
    plan.ldTables.length +
    (plan.ratingProgram ? 1 : 0)
  )
}
