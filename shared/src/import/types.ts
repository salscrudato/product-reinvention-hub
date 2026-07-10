// shared/src/import/types.ts — unified ingestion service types (platform-free).
// Extends the filing domain without modifying it: the UnifiedProposalBundle extends
// FilingImportPlan so the existing importPlan() app path can persist any format.
// SampledCell is imported (not re-declared) from the existing tableParser export
// to avoid duplicate-export collisions in the shared barrel.
// Zero platform imports; consumed by both app/ and functions/.

import type { DocumentRoleFingerprint, TranslationRecipe, LineArchetype } from '../lines/types'
import type { FilingImportPlan } from '../insurance/filing/types'
import type { SampledCell } from '../insurance/filing/tableParser'

// ─── Format container ──────────────────────────────────────────────────────────

export type FormatContainer = 'XLSX' | 'PDF' | 'ZIP' | 'XML' | 'CSV' | 'TXT' | 'UNKNOWN'

// ─── Detected format ───────────────────────────────────────────────────────────

export type DetectedFormat =
  | 'ISO_WORKBOOK'        // ISO template XLSX (Framework / Forms / Rating / Rules sheets)
  | 'SERFF_PACKAGE'       // NAIC SERFF filing with schedule structure + TOI code
  | 'ERC_PACKAGE'         // Experience Rating Calculation ZIP (NCCI WC; ALG/RCRN/RC/DS/TC members)
  | 'ACORD'               // ACORD standard form / XML interchange
  | 'COMPANY_FILING_PDF'  // Carrier-proprietary PDFs (rate order + manual + policy form)
  | 'UNKNOWN'             // None of the above — triggers a FormatCard proposal

// ─── Line guess ────────────────────────────────────────────────────────────────

export interface LineGuess {
  lobRefId:   string    // e.g. 'PH.LOB.001'
  confidence: number    // 0–1
  signals:    string[]  // the tokens / patterns that triggered this guess
}

// ─── Document role assignment (per document in a multi-doc upload) ─────────────

export type ExtractorKind =
  | 'DETERMINISTIC_TABLE'   // exceljs / CSV / XML parse — zero AI calls
  | 'AI_EXTRACT_FAST'       // MODEL_FAST (claude-haiku-4-5) forced-tool cascade
  | 'AI_EXTRACT_FULL'       // MODEL (claude-sonnet-5) forced-tool (policy-form 4-section)

export interface DocumentRoleAssignment {
  documentName:  string
  role:          string         // DocumentRole value from lines/types
  extractor:     ExtractorKind
}

// ─── Extraction plan ───────────────────────────────────────────────────────────

// One plan per upload; built from the matched LineArchetype so it is data-driven, not
// per-format branching code. The `archetype` field is typed as LineArchetype (imported
// type only) so there is no runtime dependency on the registry from shared/src/import/.
export interface ExtractionPlan {
  format:                  DetectedFormat
  lobRefId:                string
  archetype:               LineArchetype
  documentRoleAssignments: DocumentRoleAssignment[]
  splitStrategy:           'SINGLE_PRODUCT' | 'SINGLE_PRODUCT_MULTI_FORM' | 'SIBLING_PRODUCTS_PER_FORM'
}

// ─── Mapped field (per-field provenance) ───────────────────────────────────────

export type SanitizerVerdict = 'PASS' | 'FAIL' | 'UNRESOLVED'

export interface FieldCitation {
  sourceDoc: string    // document name or refId
  locus:     string    // page / cell / rule number
  verbatim?: string    // quoted text from the source
}

export interface MappedField<T = unknown> {
  value:            T
  confidence:       number
  citation:         FieldCitation
  sanitizerVerdict: SanitizerVerdict
}

// ─── Split product proposal ────────────────────────────────────────────────────

export interface SplitProductProposal {
  productToken:       string    // e.g. 'HO3' | 'HO4' | 'HO6'
  formScope?:         string    // the form number that scopes this product
  name:               string    // display name for the review UI
  coveragePartScope?: string    // e.g. 'PropertyCoveragePart' for CPP
}

// ─── Sampled table verification ────────────────────────────────────────────────

// The AI verification path ONLY produces a verdict + notes; it cannot emit rows.
// The tool schema in bulkTables.ts has no `rows` property — enforced by TypeScript.
export type SampledVerificationResult = 'PASS' | 'FAIL' | 'PARTIAL'

export interface SampledVerification {
  tableRefId:         string
  sampledCells:       SampledCell[]
  verificationResult: SampledVerificationResult
  notes:              string
  model:              string  // always MODEL_FAST (claude-haiku-4-5)
}

// ─── Format card (for UNKNOWN formats) ────────────────────────────────────────

// A FormatCard is a human-reviewable PROPOSAL that teaches the registry a new format.
// Nothing auto-persists: the card's status starts as PROPOSED; a reviewer approves it
// in the review UI; only then does the app write it as a new registry entry proposal
// (data, not code). The actual registry mutation is a SEPARATE step after approval.
export type FormatCardStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED'

export interface FormatCard {
  id:                         string
  status:                     FormatCardStatus
  proposedAt:                 string                        // ISO date-time
  detectedContainer:          FormatContainer
  documentRoleFingerprints:   DocumentRoleFingerprint[]     // candidate signals
  translationRecipeFragment:  Partial<TranslationRecipe>   // candidate recipe
  reviewNotes?:               string
  approvedAt?:                string
  approvedBy?:                string
}

// ─── Detected document role entry ─────────────────────────────────────────────

// A single document's detected role with per-document confidence (different from
// DocumentRoleFingerprint which describes the SIGNAL patterns, not a detection result).
export interface DocumentRoleEntry {
  documentName: string
  role:         string
  confidence:   number
}

// ─── Format fingerprint ────────────────────────────────────────────────────────

export interface FormatFingerprint {
  container:      FormatContainer
  detectedFormat: DetectedFormat
  lineGuesses:    LineGuess[]      // ranked by confidence descending
  documentRoles:  DocumentRoleEntry[]
}

// ─── Upload document ───────────────────────────────────────────────────────────

// Extends the FilingDoc shape with XLSX-specific metadata so the client can provide
// sheet names (read client-side) without requiring exceljs in the browser again.
export interface UploadDoc {
  name:        string
  base64?:     string
  text?:       string                // first-page or full text for fingerprinting
  mediaType?:  string
  sheetNames?: string[]              // XLSX only: sheet names extracted by the client
}

// ─── Unified proposal bundle ───────────────────────────────────────────────────

// Extends FilingImportPlan (which already wraps ImportPlan + review sections +
// unresolved items + conservation-law counts). The unified bundle adds:
//   • fingerprint        — how the upload was classified
//   • extractionPlan     — which extractor each document was routed to
//   • sampledVerifications — AI-sampled table checks (verdict only, never rows)
//   • splitProducts      — proposed product-level splits from translationRecipe
//   • formatCard?        — present only when detectedFormat === 'UNKNOWN'
export interface UnifiedProposalBundle extends FilingImportPlan {
  fingerprint:           FormatFingerprint
  extractionPlan:        ExtractionPlan
  sampledVerifications:  SampledVerification[]
  splitProducts:         SplitProductProposal[]
  formatCard?:           FormatCard
}
