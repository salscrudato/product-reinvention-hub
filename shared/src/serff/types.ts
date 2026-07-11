// serff/types.ts — SERFF bundle shapes for Texas (file-and-use, Chapter 2251).
//
// Mirrors the SERFF Filing tab structure as described in the "Filings Made Easy"
// guide published by NAIC/SERFF and the TDI-specific supplement. Texas uses five
// standard tabs; Supporting Documentation carries marked copies and the memo.
//
// Pure TypeScript; zero platform imports.

import type { ChangeSet } from '../changeset/types'

// ─── SERFF tab names ────────────────────────────────────────────────────────────
// Matches the official SERFF tab labels used in the TDI filing system.

export type SerffTabName =
  | 'GeneralInformation'   // filing metadata, company, product, effective date
  | 'RateRuleSchedule'     // rate/rule pages with before-after exhibits
  | 'FormSchedule'         // clean (final) form copies
  | 'SupportingDocumentation' // marked copies + memo + actuarial
  | 'CorrespondenceNotes'  // examiner notes (populated during review)

/** Logical grouping within a tab (e.g. "Marked Copies" under Supporting Documentation). */
export type SerffGrouping =
  | 'MarkedCopies'         // Supporting Documentation — redline/marked copies per 28 TAC §5.9327
  | 'FilingMemorandum'     // Supporting Documentation — explanation-of-changes memo per 28 TAC §5.9334
  | 'RateExhibits'         // Rate/Rule Schedule — before-and-after rate pages
  | 'RulePages'            // Rate/Rule Schedule — rule-level change pages
  | 'FiledForms'           // Form Schedule — clean, final forms
  | 'GeneralInfo'          // General Information
  | 'Other'

// ─── Document content types ──────────────────────────────────────────────────────

/** Structural representation of a redline (marked) document.
 *  Each `block` is a text segment annotated as inserted, deleted, or unchanged.
 *  In a real filing this is rendered as a PDF with underline/strikethrough; here
 *  we emit the structured blocks so the UI can render it and the server can export
 *  it to a marked-copy document format. */
export interface RedlineBlock {
  type: 'ins' | 'del' | 'unchanged'
  text: string
  /** Load-bearing refId chip for the coverage/term/form being discussed. */
  refId?: string
}

export interface RedlineContent {
  kind:          'redline'
  formNumber?:   string
  coverageRefId?: string
  title:         string
  sections:      Array<{
    heading: string
    blocks:  RedlineBlock[]
  }>
}

/** Before-and-after rate page for a single RT/LD table change. */
export interface RateExhibitRow {
  label:      string              // e.g. "Territory T002 — Base Rate"
  before:     number
  after:      number
  pctChange:  number | null
}

/** Premium impact computed by running the actual evaluate() function. */
export interface PremiumImpactRow {
  inputLabel: string   // e.g. "Territory T002, PC5, CovA $400k, Ded $1,000"
  before:     number   // run on parent rating program
  after:      number   // run on clone rating program
  pctChange:  number | null
}

/** Histogram bucket of policyholder-level premium impacts. */
export interface HistogramBucket {
  band:        string   // e.g. "–10% to –5%"
  low:         number   // inclusive lower bound (percentage)
  high:        number   // exclusive upper bound
  count:       number   // number of representative inputs in this bucket
  pctOfTotal:  number   // % of the total scenario set
}

export interface RateExhibitContent {
  kind:              'rateExhibit'
  tableRefId:        string
  tableName:         string
  rows:              RateExhibitRow[]
  premiumImpacts:    PremiumImpactRow[]
  histogram:         HistogramBucket[]
  overallImpactPct:  number | null  // exposure-weighted average impact
}

/** Explanation-of-changes memo structure (for AI-generated prose fill on the server). */
export interface MemoSection {
  heading:   string
  /** Structured items; the server's AI fills in `prose` when generating the full memo. */
  items:     Array<{ label: string; value: string; citation?: string }>
  prose?:    string   // AI-generated prose — server-side only; never from client
}

export interface MemoContent {
  kind:              'memo'
  productName:       string
  filingType:        string           // e.g. "File-and-Use (Texas Ins. Code §2251.101)"
  overallImpactPct:  number | null
  sections:          MemoSection[]
  /** Regulatory basis for each section — grounded citations, never invented. */
  citations:         string[]
}

// ─── SerffDocument — one document in the bundle ─────────────────────────────────

export type SerffDocumentContent = RedlineContent | RateExhibitContent | MemoContent

export interface SerffDocument {
  /** Display title for this document in the SERFF filing system. */
  title:        string
  tabName:      SerffTabName
  grouping:     SerffGrouping
  /** The type of content this document carries. */
  documentType: 'redline' | 'rateExhibit' | 'memo' | 'cleanForm' | 'other'
  /** Load-bearing refId chips — the product entities this document relates to. */
  refIds:       string[]
  content:      SerffDocumentContent | string   // string for 'cleanForm'/'other' placeholders
}

// ─── The SERFF bundle ─────────────────────────────────────────────────────────────

/** The complete SERFF filing bundle, tab-grouped and ready for submission.
 *  For Texas (file-and-use) the bundle structure is:
 *    GeneralInformation        — filing metadata
 *    RateRuleSchedule          — rate exhibits (when rates changed)
 *    FormSchedule              — clean forms
 *    SupportingDocumentation   — marked copies + memo
 */
export interface SerffBundle {
  filingId:       string   // e.g. "TX-PH.PROD.001-2026-001" (carrier-assigned)
  state:          string   // "TX"
  filingType:     string   // "file-and-use"
  productRefId:   string
  productName:    string
  changeSet:      ChangeSet
  documents:      SerffDocument[]
  generatedAt:    string   // ISO-8601
}

// ─── Reviewer lens types ─────────────────────────────────────────────────────────

export type ReviewerSeverity = 'error' | 'warning' | 'info'

/** One gap or issue flagged by the Texas DOI reviewer lens. Every finding cites its
 *  source regulation so the fix guidance is grounded, never invented. */
export interface ReviewerFinding {
  /** Human-readable description of what is missing or problematic. */
  message:   string
  /** Texas regulatory source (statute / admin code section). */
  citation:  string
  severity:  ReviewerSeverity
  /** The SERFF tab where the issue manifests. */
  tab:       SerffTabName
  /** Load-bearing refId chip for the specific coverage/form/table at issue (when applicable). */
  refId?:    string
}

/** Checklist item that the reviewer lens evaluates. `passed` is true when the
 *  bundle satisfies the requirement. Each item cites its Texas source. */
export interface ReviewerCheckItem {
  id:        string
  label:     string
  citation:  string
  tab:       SerffTabName
  passed:    boolean
  finding?:  ReviewerFinding   // populated when !passed
}

/** Full result of running the Texas DOI reviewer lens over a SERFF bundle. */
export interface ReviewerResult {
  state:        string
  bundleId:     string
  checklist:    ReviewerCheckItem[]
  findings:     ReviewerFinding[]
  passed:       boolean   // true when all 'error' severity checks pass
  /** Gaps the lens cannot detect — a human examiner may still reject the bundle.
   *  These are structural limitations of the automated check, not bugs. */
  knownGaps:    string[]
  generatedAt:  string
}
