// Duck Creek Author XML export — shared types.
//
// Binding spec: docs/export-templates/author-xml/XML_EXPORT_SPEC.md (P1, SPEC_READY).
// One export = one delivery bundle: overlay.xml + CoverageConfig.xlsx + TableConfig.xlsx
// + export-manifest.json. The overlay is a DELTA on an inherited base chain — never a
// flattened document (spec §1). Rates never ride in the XML (spec §3.6).

import type {
  Product, Coverage, Form, FormRule, Rule, RatingProgram, LDTable, RTTable, RatingInputField,
} from '../../types'

// ─── Export input (assembled from the Hub canonical model) ────────────────────

export interface ExportInput {
  /** PascalCase-able tenant display name; manuscriptID prefix (spec §3.1). */
  tenantName:    string
  product:       Product
  coverages:     Coverage[]
  forms:         Form[]
  rules:         Rule[]
  formRules:     FormRule[]
  ratingProgram: RatingProgram | null
  /** Keyed by refId, e.g. 'PA.LD.001'. */
  ldTables:      Record<string, LDTable>
  /** Keyed by refId, e.g. 'PA.RT.001'. */
  rtTables:      Record<string, RTTable>
  ratingInputSpec: RatingInputField[]
  /** Deterministic clock — the export date (tests pass a fixed value). */
  now:           Date
}

// ─── Workbook IR (pure — serialized to .xlsx by the server/test layer) ────────

export type CellValue = string | number | boolean | null

export interface SheetModel {
  name: string
  /** 1-based sparse row matrix: rows[r][c] with r,c starting at 1. */
  rows: Map<number, Map<number, CellValue>>
}

export interface WorkbookModel {
  sheets: SheetModel[]
}

// ─── Gap report (spec §5 — the 17-row completeness & HITL inventory) ──────────

export type GapStatus = 'MAPPED' | 'DEFAULTED' | 'MISSING'

export interface GapRow {
  /** Spec §5 row number (1..17). */
  specRow: number
  field:   string
  status:  GapStatus
  /** MAPPED: the canonical source the value came from. */
  source?: string
  /** DEFAULTED: the spec default rule applied — named verbatim, never invented. */
  rule?:   string
  /** The value the exporter used (or would need). */
  value?:  string
  detail?: string
}

export interface GapReport {
  productRefId: string
  rows:         GapRow[]
  /** MISSING required fields — a non-empty list BLOCKS the export. */
  missing:      GapRow[]
  blocked:      boolean
  counts:       { mapped: number; defaulted: number; missing: number }
}

// ─── Manifest (spec §2 — refId is load-bearing; the two-way proof reads this) ─

export interface ManifestTable {
  tableName:   string
  sheetName:   string
  dcTableId:   string
  keyColumns:  string[]
  valueColumn: string
  /** Hub rtTable refId. */
  hubRefId:    string
}

export interface ManifestHitlNote {
  kind:   string
  target: string
  note:   string
  /** Spec §5 row this note is grounded on. */
  specRow?: number
}

/**
 * P4 provenance envelope (CONTRACTS row, published shape): fleet-sourced model id,
 * citation refs, confidence, authoredBy. The export is deterministic and
 * human-triggered, so authoredBy is 'human' and no model/role fields are set.
 */
export interface ExportProvenance {
  authoredBy:  'human' | 'ai' | 'voice' | 'restore'
  model?:      string
  role?:       string
  citations?:  string[]
  confidence?: number
}

export interface ExportManifest {
  manuscriptID:  string
  base:          { inherited: string; fileNameForm: string; physicalPath: string }
  product:       { refId: string; name: string }
  /** Every net-new DC id → the Hub refId (or 'hubRef#part' synthetic role) it traces to. */
  ids:           Record<string, string>
  tables:        ManifestTable[]
  hitl:          ManifestHitlNote[]
  gapReport:     GapReport
  provenance:    ExportProvenance
  generatedAt:   string
}

// ─── Lint (spec §1.3 OVERLAY-DELTA LINT + §6 ladder L0–L3) ────────────────────

export type LintLevel = 'FAIL' | 'WARN'

export interface LintFinding {
  level:   LintLevel
  rule:    string
  element: string
  id?:     string
  detail:  string
}

export interface LintResult {
  ok:       boolean
  findings: LintFinding[]
}

// ─── Bundle (the export result) ───────────────────────────────────────────────

export interface ExportBundle {
  blocked:        boolean
  gapReport:      GapReport
  /** Present only when not blocked. */
  overlayXml?:    string
  overlayFileName?: string
  coverageConfig?: WorkbookModel
  tableConfig?:    WorkbookModel
  manifest?:       ExportManifest
  lint?:           LintResult
}
