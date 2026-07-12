// functions/src/import/brain/types.ts — Adaptive Import Brain type vocabulary.
// Pure TypeScript; zero platform imports.
// All AI calls are server-side (functions/); this file is consumed only by brain stages.

import type { StructuralModel, LayoutShape, CanonicalEntityKind } from '@pf/shared'
import type { RoutingBudget } from '../../ai/router'
import type { StreamEvent } from '../../runtime'

// ─── Sheet domain ─────────────────────────────────────────────────────────────

export type SheetDomain =
  | 'product-framework'
  | 'forms'
  | 'rating-roc'
  | 'rules'
  | 'limits-deductibles'
  | 'rate-tables'
  | 'definitions'
  | 'ignore'

export const SHEET_DOMAINS: readonly SheetDomain[] = [
  'product-framework', 'forms', 'rating-roc', 'rules',
  'limits-deductibles', 'rate-tables', 'definitions', 'ignore',
]

// Entity kinds plausible for each domain — used to prune the canonical dictionary
// provided to the model (smaller prompt = lower cost + less hallucination surface).
export const DOMAIN_ENTITY_KINDS: Record<SheetDomain, CanonicalEntityKind[]> = {
  'product-framework':  ['product', 'coverage'],
  'forms':              ['form', 'dynamicField', 'formRule'],
  'rating-roc':         ['ratingProgram', 'ratingStep', 'rtTable'],
  // formRule added: form-attachment-rule sheets ("GL Optional Forms Rules") classify as
  // 'rules'; without it Stage 3 never sees the formRule field dictionary for those sheets.
  'rules':              ['rule', 'formRule'],
  'limits-deductibles': ['ldTable', 'coverage'],
  'rate-tables':        ['rtTable', 'ratingStep'],
  'definitions':        [],
  'ignore':             [],
}

// ─── Source cell citation ─────────────────────────────────────────────────────
// Format: sheet name + Excel cell address (column letter(s) + 1-based row number).
// Example: { sheet: "ProductFramework", cell: "A3", verbatim: "GL.COV.001" }

export interface BrainCitation {
  sheet:    string
  cell:     string    // e.g. "A3", "B5", "C:D7" for merged ranges
  verbatim: string    // exact text found in that cell
}

// ─── Per-field produced unit ───────────────────────────────────────────────────

export interface BrainEntityField {
  fieldName:  string
  value:      unknown
  confidence: number
  citation:   BrainCitation
}

// ─── Produced canonical entity ─────────────────────────────────────────────────
// One entity per logical row (or per refId when a cell contains multiple refIds).

export interface BrainEntity {
  kind:                CanonicalEntityKind
  fields:              BrainEntityField[]
  overallConfidence:   number
  sourceSheet:         string
  sourceRowIndex:      number
  reviewFlag:          boolean
  needsRefIdSynthesis: boolean   // true when the source refId cell is blank/TBD
}

// ─── Review queue item ─────────────────────────────────────────────────────────

export type ReviewItemKind =
  | 'low-confidence-map'
  | 'unmapped-column'
  | 'validator-discrepancy'
  | 'disagreement'
  | 'ungrounded'
  | 'refid-synthesis-needed'

export interface ReviewItem {
  kind:       ReviewItemKind
  sheetName:  string
  detail:     string
  colIndex?:  number
  colLabel?:  string
  rowIndex?:  number
  fieldPath?: string
}

// ─── Stage 1: Sheet classification ────────────────────────────────────────────

export interface ClassifiedSheet {
  sheetName:        string
  domain:           SheetDomain
  confidence:       number          // 1.0 = both reasoners agreed; <1.0 = adjudicated
  rationale:        string
  reasonerADomain?: SheetDomain
  reasonerBDomain?: SheetDomain
  disagreed:        boolean
  humanFlagNeeded:  boolean         // true when adjudicator also could not resolve
}

// ─── Stage 2: Header lock ─────────────────────────────────────────────────────

export interface HeaderLock {
  sheetName:      string
  headerRowIndex: number            // 0-based row in sheet cells array
  layoutShape:    LayoutShape
  columnCount:    number
  isConfirmed:    boolean           // false when AI could not confirm; needs human review
}

// ─── Stage 3: Column mapping ───────────────────────────────────────────────────

export interface ColumnMappingEntry {
  colIndex:        number
  headerLabel:     string | null
  canonicalField:  string | null    // null = unmapped
  entityKind:      CanonicalEntityKind | null
  confidence:      number
  citation:        BrainCitation | null
  reasonerAField?: string
  reasonerBField?: string
  disagreed:       boolean
  needsReview:     boolean
}

export interface SheetColumnMap {
  sheetName:       string
  mappings:        ColumnMappingEntry[]
  unmappedIndices: number[]
}

// ─── Stage 4: Extraction ───────────────────────────────────────────────────────

export interface ExtractionRow {
  sheetName:      string
  sourceRowIndex: number
  entities:       BrainEntity[]
  bulkModel:      string            // Foundry deployment name used for primary extraction
  bulkAltModel:   string
}

// ─── Stage 5: Validation ───────────────────────────────────────────────────────

export type DiscrepancyKind =
  | 'ungrounded-field'
  | 'refId-mismatch'
  | 'enum-out-of-range'
  | 'orphan-coverage'
  | 'dropped-row'
  | 'form-number-mismatch'

export interface ValidationDiscrepancy {
  kind:         DiscrepancyKind
  entityIndex?: number
  fieldName?:   string
  expected?:    string
  found?:       string
  detail:       string
}

// ─── Stage 6: Brain output ─────────────────────────────────────────────────────

export interface SummaryCounts {
  sheetsTotal:            number
  sheetsClassified:       number
  sheetsIgnored:          number
  columnsTotal:           number
  columnsMapped:          number
  columnsUnmapped:        number
  rowsExtracted:          number
  rowsInReview:           number
  validatorDiscrepancies: number
  entitiesProduced:       number
}

export interface BrainOutput {
  entities:                BrainEntity[]
  perEntityConfidence:     number[]
  reviewQueue:             ReviewItem[]
  summaryCounts:           SummaryCounts
  classifiedSheets:        ClassifiedSheet[]
  headerLocks:             HeaderLock[]
  columnMaps:              SheetColumnMap[]
  validationDiscrepancies: ValidationDiscrepancy[]
}

// ─── Pipeline options ──────────────────────────────────────────────────────────

export interface BrainOpts {
  structural:     StructuralModel
  lobRefIdHint?:  string
  budget:         RoutingBudget
  emit?:          (ev: StreamEvent) => void
}

// ─── JSON parse helper ─────────────────────────────────────────────────────────
// Extracts JSON from a model response that may include markdown fences or prose.

export function extractJson(raw: string): unknown {
  // Strip markdown code fences if present
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const text = fenced ? fenced[1]! : raw.trim()
  return JSON.parse(text)
}

// ─── Column letter helper ──────────────────────────────────────────────────────
// Convert 0-based column index to Excel column letter(s): 0→A, 25→Z, 26→AA, etc.

export function colLetter(idx: number): string {
  let result = ''
  let n = idx
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}

// ─── Confidence floor ─────────────────────────────────────────────────────────

export const CONFIDENCE_ACCEPT  = 0.85   // above → auto-accept both-model agreement
export const CONFIDENCE_REVIEW  = 0.60   // below → always route to review queue
export const CONFIDENCE_DISCARD = 0.40   // below → discard (too noisy to be useful)
