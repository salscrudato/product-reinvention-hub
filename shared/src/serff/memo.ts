// serff/memo.ts — Explanation-of-changes memo structure.
//
// Builds a structured MemoContent from a ChangeSet. Prose sections (`prose` field)
// are left empty here — the server fills them via AI (Foundry Claude, server-side
// only, per CLAUDE.md). The structure is deterministic and fully testable without AI.
//
// Texas 28 Tex. Admin. Code §5.9334 requires a filing memorandum that explains the
// purpose of the filing, briefly describes each change, and states the overall rate
// impact. §5.9334(d) specifically requires the overall impact to be expressed as a
// percentage when rates are changed.
//
// Pure TypeScript; zero platform imports; every citation is grounded.

import type { ChangeSet } from '../changeset/types'
import type { MemoContent, MemoSection } from './types'

// ─── Section builders ─────────────────────────────────────────────────────────────

function purposeSection(cs: ChangeSet): MemoSection {
  return {
    heading: 'Purpose of Filing',
    items: [
      { label: 'Product',        value: cs.cloneName, citation: `Product refId: ${cs.cloneRefId}` },
      { label: 'Parent Product', value: cs.parentName, citation: `Basis: ${cs.parentRefId}` },
      { label: 'Filing Basis',   value: 'Clone-based revision under Texas Insurance Code §2251.101 (File-and-Use)', citation: 'Texas Ins. Code §2251.101' },
    ],
  }
}

function coverageChangesSection(cs: ChangeSet): MemoSection | null {
  const { coveragesAdded, coveragesRemoved, coveragesModified } = cs.summary
  if (coveragesAdded + coveragesRemoved + coveragesModified === 0) return null

  const items: MemoSection['items'] = []
  for (const cov of cs.coverageChanges) {
    if (cov.kind === 'added') {
      items.push({ label: `Added: ${cov.name}`, value: `New coverage [${cov.refId}] added in this filing.`, citation: `Coverage refId: ${cov.refId}` })
    } else if (cov.kind === 'removed') {
      items.push({ label: `Removed: ${cov.name}`, value: `Coverage [${cov.refId}] removed from the product.`, citation: `Coverage refId: ${cov.refId}` })
    } else {
      const termLabels = (cov.termChanges ?? []).map(tc => tc.termLabel).join(', ')
      const desc = termLabels ? `Modified terms: ${termLabels}` : 'Coverage fields updated.'
      items.push({ label: `Modified: ${cov.name}`, value: desc, citation: `Coverage refId: ${cov.refId}` })
    }
  }
  return { heading: 'Coverage Changes', items }
}

function rateChangesSection(cs: ChangeSet, overallImpactPct: number | null): MemoSection | null {
  if (!cs.summary.hasRateImpact) return null

  const items: MemoSection['items'] = []
  const tableNames = [...new Set(cs.rateTableCellChanges.map(c => c.tableName))]
  for (const name of tableNames) {
    const cells = cs.rateTableCellChanges.filter(c => c.tableName === name)
    items.push({
      label: `Rate Table: ${name}`,
      value: `${cells.length} cell(s) changed.`,
      citation: `Table refId: ${cells[0]!.tableRefId}`,
    })
  }
  const ldTableNames = [...new Set(cs.ldTableChanges.map(c => c.tableName))]
  for (const name of ldTableNames) {
    items.push({ label: `Limit/Deductible Table: ${name}`, value: 'Option values or defaults changed.', citation: `Table: ${name}` })
  }

  if (overallImpactPct !== null) {
    const sign = overallImpactPct >= 0 ? '+' : ''
    items.push({
      label:    'Overall Rate Level Impact',
      value:    `${sign}${overallImpactPct.toFixed(2)}% (exposure-weighted average across representative policyholders)`,
      citation: '28 Tex. Admin. Code §5.9334(d)',
    })
  }

  return { heading: 'Rate Changes', items }
}

function formChangesSection(cs: ChangeSet): MemoSection | null {
  if (!cs.summary.hasFormChanges) return null

  const items: MemoSection['items'] = cs.formEditionChanges.map(fe => ({
    label:    `Form ${fe.formNumber}: ${fe.formName}`,
    value:    `${fe.field} changed from "${fe.before}" to "${fe.after}".`,
    citation: `Form number: ${fe.formNumber}; 28 Tex. Admin. Code §5.9327`,
  }))
  return { heading: 'Form Changes', items }
}

function regulatoryComplianceSection(_stateCode: string): MemoSection {
  return {
    heading: 'Regulatory Compliance',
    items: [
      {
        label:    'Filing Type',
        value:    'File-and-Use — rates effective upon filing.',
        citation: 'Texas Insurance Code §2251.101',
      },
      {
        label:    'Commissioner Review Period',
        value:    'The Commissioner may disapprove within 30 days of filing under §2251.102.',
        citation: 'Texas Insurance Code §2251.102',
      },
      {
        label:    'Marked Copies',
        value:    'Marked copies of all changed forms are included under the Supporting Documentation tab.',
        citation: '28 Tex. Admin. Code §5.9327',
      },
    ],
  }
}

// ─── Public entry point ────────────────────────────────────────────────────────────

/** Build the structured explanation-of-changes memo from a ChangeSet.
 *  `overallImpactPct` comes from the rate exhibit's `overallImpactPct` field
 *  (computed by the actual evaluate() engine). Pass null when no rate changes exist.
 *  The server fills `prose` fields via Foundry Claude (server-side only). */
export function buildMemoStructure(
  changeset:       ChangeSet,
  overallImpactPct: number | null,
  stateCode = 'TX',
): MemoContent {
  const sections: MemoSection[] = [purposeSection(changeset)]

  const covSec  = coverageChangesSection(changeset)
  const rateSec = rateChangesSection(changeset, overallImpactPct)
  const frmSec  = formChangesSection(changeset)
  const regSec  = regulatoryComplianceSection(stateCode)

  if (covSec)  sections.push(covSec)
  if (rateSec) sections.push(rateSec)
  if (frmSec)  sections.push(frmSec)
  sections.push(regSec)

  return {
    kind:            'memo',
    productName:     changeset.cloneName,
    filingType:      'File-and-Use (Texas Insurance Code §2251.101)',
    overallImpactPct,
    sections,
    citations: [
      'Texas Insurance Code Chapter 2251 (File-and-Use)',
      '28 Tex. Admin. Code §5.9327 (Marked Copies)',
      '28 Tex. Admin. Code §5.9334 (Filing Memorandum)',
      '28 Tex. Admin. Code §5.9334(d) (Rate Indication and Relativity Analysis)',
    ],
  }
}
