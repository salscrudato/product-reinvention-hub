// serff/bundle.ts — assembles a Texas SERFF-ready filing bundle.
//
// Takes the ChangeSet + generated documents and places them under the correct
// SERFF tabs matching TDI's tab structure (Filings Made Easy guide, TDI edition).
//
// Tab assignment:
//   GeneralInformation        — filing metadata (always present)
//   RateRuleSchedule          — rate exhibits (when hasRateImpact)
//   FormSchedule              — clean form placeholders (when hasFormChanges)
//   SupportingDocumentation   — marked copies (always, when any change exists) + memo
//
// Texas Insurance Code §2251.101: file-and-use; rates effective on filing.
// 28 TAC §5.9327: marked copies required in Supporting Documentation.
// 28 TAC §5.9334: filing memorandum required.
//
// Pure TypeScript; zero platform imports.

import type { ChangeSet } from '../changeset/types'
import type {
  SerffBundle, SerffDocument, RedlineContent, RateExhibitContent, MemoContent,
} from './types'

// ─── Document factory helpers ─────────────────────────────────────────────────────

function redlineDoc(rd: RedlineContent): SerffDocument {
  return {
    title:        rd.title,
    tabName:      'SupportingDocumentation',
    grouping:     'MarkedCopies',
    documentType: 'redline',
    refIds:       [rd.coverageRefId ?? rd.formNumber ?? 'unknown'].filter(Boolean),
    content:      rd,
  }
}

function rateExhibitDoc(re: RateExhibitContent): SerffDocument {
  return {
    title:        `Rate Exhibit — ${re.tableName} (Before/After)`,
    tabName:      'RateRuleSchedule',
    grouping:     'RateExhibits',
    documentType: 'rateExhibit',
    refIds:       [re.tableRefId],
    content:      re,
  }
}

function memoDoc(memo: MemoContent): SerffDocument {
  return {
    title:        `Explanation of Changes — ${memo.productName}`,
    tabName:      'SupportingDocumentation',
    grouping:     'FilingMemorandum',
    documentType: 'memo',
    refIds:       [],
    content:      memo,
  }
}

function cleanFormPlaceholder(formNumber: string, formName: string): SerffDocument {
  return {
    title:        `Filed Form — ${formNumber} (${formName})`,
    tabName:      'FormSchedule',
    grouping:     'FiledForms',
    documentType: 'cleanForm',
    refIds:       [formNumber],
    content:      `Clean copy of form ${formNumber} — ${formName}. Attach PDF of the final approved form text.`,
  }
}

function generalInfoDoc(cs: ChangeSet, state: string, filingId: string): SerffDocument {
  const content = [
    `Filing ID: ${filingId}`,
    `State: ${state}`,
    `Filing Type: File-and-Use (Texas Insurance Code §2251.101)`,
    `Product: ${cs.cloneName} [${cs.cloneRefId}]`,
    `Based On: ${cs.parentName} [${cs.parentRefId}]`,
    `Generated: ${cs.generatedAt}`,
    `Changes: ${cs.summary.coveragesAdded} added, ${cs.summary.coveragesRemoved} removed, ${cs.summary.coveragesModified} modified coverages; ` +
      `${cs.summary.rateTableCellsChanged} rate cells changed; ` +
      `${cs.summary.formEditionChanges} form edition changes.`,
  ].join('\n')

  return {
    title:        'General Information',
    tabName:      'GeneralInformation',
    grouping:     'GeneralInfo',
    documentType: 'other',
    refIds:       [cs.cloneRefId],
    content,
  }
}

// ─── Public entry point ────────────────────────────────────────────────────────────

export interface BundleInput {
  filingId:    string
  state:       string
  productRefId: string
  productName: string
  changeset:   ChangeSet
  redlines:    RedlineContent[]
  rateExhibit: RateExhibitContent | null
  memo:        MemoContent
}

/** Assemble the complete SERFF bundle, placing documents under the correct tabs.
 *  The order within each tab follows the TDI Filings Made Easy guide. */
export function assembleSerffBundle(input: BundleInput): SerffBundle {
  const { filingId, state, productRefId, productName, changeset, redlines, rateExhibit, memo } = input
  const documents: SerffDocument[] = []

  // 1. General Information tab (always)
  documents.push(generalInfoDoc(changeset, state, filingId))

  // 2. Rate/Rule Schedule — rate exhibits when rate cells changed
  if (rateExhibit && changeset.summary.hasRateImpact) {
    documents.push(rateExhibitDoc(rateExhibit))
  }

  // 3. Form Schedule — clean form placeholders for each changed form
  for (const fe of changeset.formEditionChanges) {
    documents.push(cleanFormPlaceholder(fe.formNumber, fe.formName))
  }

  // 4. Supporting Documentation — marked copies (redlines) first
  for (const rd of redlines) documents.push(redlineDoc(rd))

  // 5. Supporting Documentation — filing memorandum last
  documents.push(memoDoc(memo))

  return {
    filingId,
    state,
    filingType:   'file-and-use',
    productRefId,
    productName,
    changeSet:    changeset,
    documents,
    generatedAt:  new Date().toISOString(),
  }
}

/** Return all documents under a given tab, preserving their order in the bundle. */
export function documentsInTab(bundle: SerffBundle, tab: SerffBundle['documents'][number]['tabName']) {
  return bundle.documents.filter(d => d.tabName === tab)
}
