// changeset/types.ts — typed change-set shapes for clone-based product diffs.
//
// A ChangeSet captures everything a TDI filing examiner needs to understand
// what changed between a parent product and its CLONE. Produced by diff.ts;
// consumed by the SERFF bundle assembler (serff/bundle.ts) and the server-side
// memo generator. Pure TypeScript; zero platform imports.

import type { TermKind } from '../types'

// ─── Coverage-level changes ─────────────────────────────────────────────────

/** A change to a single field of a coverage term (limit/deductible/option). */
export interface TermFieldChange {
  field: 'options' | 'default' | 'min' | 'max' | 'label' | 'notes' | 'optionSet' | 'basis' | 'constraintNote'
  before: unknown
  after: unknown
}

/** A change to a specific StandardOption inside a term's `optionSet`. */
export interface OptionSetChange {
  optionId: string
  kind: 'added' | 'removed' | 'modified'
  field?: string        // for 'modified': which field changed
  before?: unknown
  after?: unknown
}

/** All changes to a single coverage term. */
export interface TermChange {
  termId:      string
  termLabel:   string
  termKind:    TermKind
  fieldChanges: TermFieldChange[]
  optionSetChanges: OptionSetChange[]
}

/** One coverage that was added, removed, or modified between parent and clone. */
export interface CoverageChange {
  kind:   'added' | 'removed' | 'modified'
  refId:  string
  name:   string
  /** Present only for 'modified'. */
  termChanges?:  TermChange[]
  fieldChanges?: Array<{ field: string; before: unknown; after: unknown }>
}

// ─── Rate-table cell changes ─────────────────────────────────────────────────

/** A single RT table cell that changed value between parent and clone.
 *  `pctChange` = (after − before) / before × 100 (null when before is 0). */
export interface RateTableCellChange {
  tableRefId: string
  tableName:  string
  /** The row-key values that identify this cell (e.g. { classCode: '41677' }). */
  rowKey:     Record<string, unknown>
  column:     string
  before:     number
  after:      number
  pctChange:  number | null
}

// ─── LD table (option set) changes ──────────────────────────────────────────

export interface LDTableChange {
  tableRefId: string
  tableName:  string
  kind:       'row-added' | 'row-removed' | 'row-modified' | 'default-changed'
  label?:     string      // the row label involved
  field?:     'value' | 'label' | 'constraintNote' | 'defaultValue'
  before?:    unknown
  after?:     unknown
}

// ─── Form changes ─────────────────────────────────────────────────────────────

/** A form whose edition, status, or category changed. */
export interface FormEditionChange {
  formNumber: string
  formName:   string
  field:      'edition' | 'status' | 'category' | 'description'
  before:     unknown
  after:      unknown
}

// ─── The ChangeSet ───────────────────────────────────────────────────────────

export interface ChangeSetSummary {
  coveragesAdded:       number
  coveragesRemoved:     number
  coveragesModified:    number
  rateTableCellsChanged: number
  ldTableChanges:       number
  formEditionChanges:   number
  hasRateImpact:        boolean   // true when any RT cell changed (drives rate exhibit requirement)
  hasFormChanges:       boolean   // true when any form edition changed (drives marked-copy requirement)
  hasCoverageOptionChanges: boolean  // true when any LIMIT/DEDUCTIBLE/OPTION term changed
}

/** Full typed diff between a parent product and its CLONE. */
export interface ChangeSet {
  cloneRefId:   string
  parentRefId:  string
  cloneName:    string
  parentName:   string
  generatedAt:  string   // ISO-8601

  coverageChanges:      CoverageChange[]
  rateTableCellChanges: RateTableCellChange[]
  ldTableChanges:       LDTableChange[]
  formEditionChanges:   FormEditionChange[]

  summary: ChangeSetSummary
}
