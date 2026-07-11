// serff/redline.ts — generates redline (marked-copy) form documents from a ChangeSet.
//
// Produces a RedlineContent for each changed form and coverage, showing insertions
// and deletions in a structured block format. The client can render these as marked
// documents (underline for INS, strikethrough for DEL) and the server can export them
// to PDF. Does NOT invent text — every block derives from the ChangeSet's typed diffs.
//
// Texas requirement: 28 Tex. Admin. Code §5.9327 requires marked copies of every
// changed form under the Supporting Documentation tab. Each marked copy must clearly
// show what was added (underlined) and what was deleted (struck through) relative to
// the previously filed version.
//
// Pure TypeScript; zero platform imports.

import type { ChangeSet, CoverageChange, FormEditionChange, TermChange, LDTableChange, RateTableCellChange } from '../changeset/types'
import type { RedlineContent, RedlineBlock } from './types'

// ─── Coverage/term redlines ────────────────────────────────────────────────────────

function termChangeBlocks(tc: TermChange): RedlineBlock[] {
  const blocks: RedlineBlock[] = []
  blocks.push({ type: 'unchanged', text: `${tc.termLabel} (${tc.termKind})\n` })

  for (const fc of tc.fieldChanges) {
    const before = formatValue(fc.before)
    const after  = formatValue(fc.after)
    if (before) blocks.push({ type: 'del', text: `  ${fc.field}: ${before}\n` })
    if (after)  blocks.push({ type: 'ins', text: `  ${fc.field}: ${after}\n` })
  }

  for (const oc of tc.optionSetChanges) {
    if (oc.kind === 'added') {
      blocks.push({ type: 'ins', text: `  Option ${oc.optionId}: [added]\n` })
    } else if (oc.kind === 'removed') {
      blocks.push({ type: 'del', text: `  Option ${oc.optionId}: [removed]\n` })
    } else if (oc.field && oc.before !== undefined && oc.after !== undefined) {
      blocks.push({ type: 'del', text: `  Option ${oc.optionId} ${oc.field}: ${formatValue(oc.before)}\n` })
      blocks.push({ type: 'ins', text: `  Option ${oc.optionId} ${oc.field}: ${formatValue(oc.after)}\n` })
    }
  }
  return blocks
}

function coverageRedline(cov: CoverageChange): RedlineContent {
  const sections: RedlineContent['sections'] = []

  if (cov.kind === 'added') {
    sections.push({
      heading: 'Coverage Added',
      blocks:  [{ type: 'ins', text: `${cov.name} [${cov.refId}] — new coverage added in this filing.\n`, refId: cov.refId }],
    })
  } else if (cov.kind === 'removed') {
    sections.push({
      heading: 'Coverage Removed',
      blocks:  [{ type: 'del', text: `${cov.name} [${cov.refId}] — coverage removed in this filing.\n`, refId: cov.refId }],
    })
  } else {
    // modified
    if (cov.fieldChanges && cov.fieldChanges.length > 0) {
      const fieldBlocks: RedlineBlock[] = [{ type: 'unchanged', text: `Coverage: ${cov.name} [${cov.refId}]\n`, refId: cov.refId }]
      for (const fc of cov.fieldChanges) {
        fieldBlocks.push({ type: 'del', text: `  ${fc.field}: ${formatValue(fc.before)}\n` })
        fieldBlocks.push({ type: 'ins', text: `  ${fc.field}: ${formatValue(fc.after)}\n` })
      }
      sections.push({ heading: 'Coverage Fields', blocks: fieldBlocks })
    }

    if (cov.termChanges && cov.termChanges.length > 0) {
      const termBlocks: RedlineBlock[] = [{ type: 'unchanged', text: `Coverage: ${cov.name} [${cov.refId}]\n`, refId: cov.refId }]
      for (const tc of cov.termChanges) {
        termBlocks.push(...termChangeBlocks(tc))
      }
      sections.push({ heading: 'Terms and Options', blocks: termBlocks })
    }
  }

  return {
    kind:          'redline',
    coverageRefId: cov.refId,
    title:         `Marked Copy — Coverage: ${cov.name} [${cov.refId}]`,
    sections,
  }
}

// ─── Form edition redlines ─────────────────────────────────────────────────────────

function formEditionRedline(fe: FormEditionChange): RedlineContent {
  return {
    kind:       'redline',
    formNumber: fe.formNumber,
    title:      `Marked Copy — Form: ${fe.formNumber} (${fe.formName})`,
    sections: [{
      heading: `Form ${fe.field.charAt(0).toUpperCase() + fe.field.slice(1)} Change`,
      blocks: [
        { type: 'unchanged', text: `Form: ${fe.formNumber} — ${fe.formName}\n` },
        { type: 'del', text: `  ${fe.field}: ${formatValue(fe.before)}\n` },
        { type: 'ins', text: `  ${fe.field}: ${formatValue(fe.after)}\n` },
      ],
    }],
  }
}

// ─── Rate table redlines ───────────────────────────────────────────────────────────

function rateTableRedlines(cells: RateTableCellChange[]): RedlineContent[] {
  const byTable = new Map<string, RateTableCellChange[]>()
  for (const c of cells) {
    const list = byTable.get(c.tableRefId) ?? []
    list.push(c)
    byTable.set(c.tableRefId, list)
  }

  const docs: RedlineContent[] = []
  for (const [tableRef, tableCells] of byTable.entries()) {
    const tableName = tableCells[0]!.tableName
    const sections: RedlineContent['sections'] = [{
      heading: 'Rate Factor Changes',
      blocks: tableCells.flatMap(cell => {
        const keyStr = Object.entries(cell.rowKey).map(([k, v]) => `${k}=${v}`).join(', ')
        const sign = (cell.pctChange ?? 0) >= 0 ? '+' : ''
        const pct  = cell.pctChange !== null ? ` (${sign}${cell.pctChange.toFixed(2)}%)` : ''
        return [
          { type: 'unchanged' as const, text: `  Row [${keyStr}] column "${cell.column}":\n` },
          { type: 'del' as const, text: `    Before: ${cell.before}\n` },
          { type: 'ins' as const, text: `    After:  ${cell.after}${pct}\n` },
        ]
      }),
    }]

    docs.push({
      kind:  'redline',
      title: `Marked Copy — Rate Table: ${tableName} [${tableRef}]`,
      sections,
    })
  }
  return docs
}

// ─── LD table redlines ─────────────────────────────────────────────────────────────

function ldTableRedlines(changes: LDTableChange[]): RedlineContent[] {
  const byTable = new Map<string, LDTableChange[]>()
  for (const c of changes) {
    const list = byTable.get(c.tableRefId) ?? []
    list.push(c)
    byTable.set(c.tableRefId, list)
  }

  const docs: RedlineContent[] = []
  for (const [tableRef, tableChanges] of byTable.entries()) {
    const tableName = tableChanges[0]!.tableName
    const blocks: RedlineBlock[] = []
    for (const ch of tableChanges) {
      if (ch.kind === 'default-changed') {
        blocks.push({ type: 'del', text: `  Default value: ${formatValue(ch.before)}\n` })
        blocks.push({ type: 'ins', text: `  Default value: ${formatValue(ch.after)}\n` })
      } else if (ch.kind === 'row-added') {
        blocks.push({ type: 'ins', text: `  Option row added: "${ch.label}"\n` })
      } else if (ch.kind === 'row-removed') {
        blocks.push({ type: 'del', text: `  Option row removed: "${ch.label}"\n` })
      } else {
        blocks.push({ type: 'del', text: `  "${ch.label}" ${ch.field}: ${formatValue(ch.before)}\n` })
        blocks.push({ type: 'ins', text: `  "${ch.label}" ${ch.field}: ${formatValue(ch.after)}\n` })
      }
    }

    docs.push({
      kind:  'redline',
      title: `Marked Copy — Limit/Deductible Table: ${tableName} [${tableRef}]`,
      sections: [{ heading: 'Option Changes', blocks }],
    })
  }
  return docs
}

// ─── Public entry point ────────────────────────────────────────────────────────────

/** Generate all redline (marked-copy) documents from a ChangeSet. Returns one
 *  RedlineContent per changed coverage, form, and rate table — each ready to be
 *  placed in the Supporting Documentation tab under the "Marked Copies" grouping. */
export function generateRedlineDocuments(changeset: ChangeSet): RedlineContent[] {
  const docs: RedlineContent[] = []

  // Coverage redlines (added, removed, modified)
  for (const cov of changeset.coverageChanges) docs.push(coverageRedline(cov))

  // Form edition redlines
  for (const fe of changeset.formEditionChanges) docs.push(formEditionRedline(fe))

  // RT table cell redlines (grouped by table)
  docs.push(...rateTableRedlines(changeset.rateTableCellChanges))

  // LD table option redlines (grouped by table)
  docs.push(...ldTableRedlines(changeset.ldTableChanges))

  return docs
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
