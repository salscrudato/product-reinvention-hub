// OVERLAY-DELTA LINT (spec §1.3, normative) + validation ladder L0–L2 (spec §6).
//
// This is a HARD GATE on every export: any node not traceable to an intended
// override or a manifest-mapped net-new id fails the export. It runs offline —
// no engine needed — as the export-side analogue of the import brain's
// plan-integrity checks.
//
// Clause summary (§1.3):
//   1. id ∈ B restated → MUST carry override="1".
//      (Extension, grounded in §5 row 10 "override of the generated input":
//       ids the bundle's own CoverageConfig generates — set C — are override-legal
//       the same way, because Express lands them in the same composed manuscript.)
//   2. id ∉ B, no override → net-new; MUST appear in the manifest id map.
//   3. abstract="1" restatement is legal scaffolding iff its subtree contains a
//      node passing (1) or (2) — dead scaffolding FAILs. (Observed SP3 shape:
//      abstract restatements carry NO override attribute.)
//   4. structural containers without an id are judged by their id-bearing ancestor.
// Plus R-flatten, R-rates, R-override-attr, R-idref.

import type { LintFinding, LintResult, ManifestTable } from './types'
import { NODE_INDEX_SUBSET, REQUIRED_ATTRS } from './nodeIndex'
import { firstNonAsciiIndex, parseXml, XmlParseError, type XmlNode } from './xml'

export interface LintInputs {
  /** B — ids harvested from the configured base chain (or the pinned scaffold set). */
  baseIds: Set<string>
  /** C — ids the bundle's CoverageConfig generates (fields + input containers). */
  generatedIds: Set<string>
  /** T — the manifest table list (single source shared with TableConfig). */
  tables: ManifestTable[]
  /** Net-new id → Hub refId traceability (manifest `ids`). */
  manifestIds: Record<string, string>
  /**
   * Platform ids that resolve ABOVE the available base chain. Pinned, cited:
   * True/False (SP3:1768 `default idref="False"`), AccountInput.Name +
   * PolicyOutput.PolicyNumber (SP3:11084-11085 mergeFields — the spec §5 row 7
   * default pair). The corpus itself references these without declaring them.
   */
  platformIdrefTargets?: Set<string>
  /** Serialized base nodes by id — enables the byte-identical R-flatten check. */
  baseNodeTexts?: Map<string, string>
}

export const PLATFORM_IDREF_TARGETS: ReadonlySet<string> = new Set([
  'True', 'False', 'AccountInput.Name', 'PolicyOutput.PolicyNumber',
])

const ID_BEARING = new Set(['object', 'public', 'private', 'table', 'documentSet', 'modelCollection', 'page'])
const VALUE_XOR_IDREF = new Set(['operand', 'argument', 'then', 'else', 'tableRef', 'keyRef', 'default', 'caption', 'value'])

function walk(node: XmlNode, visit: (n: XmlNode, parent: XmlNode | null) => void, parent: XmlNode | null = null): void {
  if (node.name === '#comment') return
  visit(node, parent)
  for (const c of node.children) walk(c, visit, node)
}

/** Serialize one node compactly for the byte-identity flatten check. */
function nodeText(n: XmlNode): string {
  if (n.name === '#comment') return ''
  const attrs = Object.entries(n.attrs)
    .filter(([k]) => k !== 'override')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`).join(' ')
  const kids = n.children.map(nodeText).filter(Boolean).join('')
  return `<${n.name} ${attrs}>${n.text ?? ''}${kids}</${n.name}>`
}

export function harvestIds(root: XmlNode): Set<string> {
  const ids = new Set<string>()
  walk(root, (n) => { if (n.attrs.id) ids.add(n.attrs.id); if (n.name === 'documentSet' && n.attrs.name) ids.add(n.attrs.name) })
  return ids
}

export function runOverlayLint(xml: string, inputs: LintInputs): LintResult {
  const findings: LintFinding[] = []
  const fail = (rule: string, element: string, detail: string, id?: string) =>
    findings.push({ level: 'FAIL', rule, element, id, detail })
  const warn = (rule: string, element: string, detail: string, id?: string) =>
    findings.push({ level: 'WARN', rule, element, id, detail })

  // ── L0 — well-formed + ASCII ────────────────────────────────────────────────
  let root: XmlNode
  try {
    root = parseXml(xml)
  } catch (e) {
    fail('L0-well-formed', '(document)', e instanceof XmlParseError ? e.message : String(e))
    return { ok: false, findings }
  }
  const nonAscii = firstNonAsciiIndex(xml)
  if (nonAscii >= 0) {
    fail('L0-ascii', '(document)', `non-ASCII byte at offset ${nonAscii} (spec §4.1 "ASCII only")`)
  }
  if (root.name !== 'ManuScript') {
    fail('L0-root', root.name, 'root element must be <ManuScript> (SP3:1)')
    return { ok: false, findings }
  }

  const B = inputs.baseIds
  const C = inputs.generatedIds
  const platform = inputs.platformIdrefTargets ?? PLATFORM_IDREF_TARGETS
  const overlayIds = harvestIds(root)
  const tablesById = new Map(inputs.tables.map((t) => [t.dcTableId, t]))
  const tableNamesLower = new Set(inputs.tables.flatMap((t) => [t.tableName.toLowerCase(), t.dcTableId.toLowerCase()]))

  // ── L1 — grammar conformance vs the node index ─────────────────────────────
  walk(root, (n, parent) => {
    const entry = NODE_INDEX_SUBSET[n.name]
    if (!entry) {
      fail('L1-unknown-element', n.name, 'element is outside the emitted-vocabulary node-index subset (observed grammar: 240 elements)')
      return
    }
    if (parent) {
      const pEntry = NODE_INDEX_SUBSET[parent.name]
      if (pEntry && !entry.parents.includes(parent.name)) {
        fail('L1-parent', n.name, `<${n.name}> under <${parent.name}> — observed parents: ${entry.parents.join(', ') || '(root)'}`)
      }
    }
    for (const a of Object.keys(n.attrs)) {
      if (!entry.attributes.includes(a)) {
        fail('L1-attribute', n.name, `attribute "${a}" is not observed on <${n.name}>`, n.attrs.id)
      }
    }
    for (const req of REQUIRED_ATTRS[n.name] ?? []) {
      if (!(req in n.attrs)) {
        fail('L1-required-attr', n.name, `required attribute "${req}" missing (spec §6 L1 / §3.10)`, n.attrs.id)
      }
    }
    if (n.attrs.value !== undefined && n.attrs.idref !== undefined && VALUE_XOR_IDREF.has(n.name)) {
      fail('L1-value-xor-idref', n.name, 'carries BOTH value and idref (spec §4.3)', n.attrs.id)
    }
  })

  // ── L2 — the overlay-delta clauses ──────────────────────────────────────────
  let restatedIdenticalCount = 0
  let restatedBaseCount = 0

  const judgeAbstract = (n: XmlNode): boolean => {
    // Clause 3: legal iff subtree contains a legal override or traceable net-new.
    let alive = false
    walk(n, (d) => {
      if (d === n || !d.attrs.id) return
      const id = d.attrs.id
      if ((B.has(id) || C.has(id)) && d.attrs.override === '1') alive = true
      if (!B.has(id) && !C.has(id) && d.attrs.abstract !== '1' && inputs.manifestIds[id] !== undefined) alive = true
    })
    return alive
  }

  walk(root, (n) => {
    if (!ID_BEARING.has(n.name)) return
    const id = n.attrs.id ?? (n.name === 'documentSet' ? n.attrs.name : undefined)
    if (!id) return
    const override = n.attrs.override

    if (override !== undefined && override !== '1') {
      fail('R-override-attr', n.name, `override="${override}" — only override="1" is observed (guide §2.3)`, id)
    }

    if (n.attrs.abstract === '1') {
      if (!judgeAbstract(n)) {
        fail('L2-dead-scaffolding', n.name, 'abstract restatement with no overriding or net-new descendant (clause 3)', id)
      }
      return
    }

    if (B.has(id)) {
      restatedBaseCount++
      if (override !== '1') {
        fail('L2-missing-override', n.name, `restates base id without override="1" (clause 1)`, id)
      }
      const baseText = inputs.baseNodeTexts?.get(id)
      if (baseText !== undefined && nodeText(n) === baseText) {
        restatedIdenticalCount++
        warn('R-flatten', n.name, 'pointless-restatement: byte-identical to the base node', id)
      }
      return
    }
    if (C.has(id)) {
      if (override !== '1') {
        fail('L2-generated-id-no-override', n.name, `restates a CoverageConfig-generated id without override="1" (spec §5 row 10)`, id)
      }
      return
    }
    // Net-new.
    if (override === '1') {
      fail('L2-override-of-unknown-id', n.name, `override="1" on an id in neither the base chain nor the generated set (clause 1)`, id)
    }
    if (inputs.manifestIds[id] === undefined) {
      fail('L2-untraceable-net-new', n.name, 'net-new id absent from the export-manifest id map — an untraceable id is a fabrication (clause 2)', id)
    }
  })

  // R-flatten hard trigger: >5% of B restated-identical (or, when base bytes are
  // unavailable, >5% of B restated concretely at all — a full flatten restates
  // nearly everything; a real overlay restates almost nothing concrete).
  if (B.size > 0) {
    const numerator = inputs.baseNodeTexts ? restatedIdenticalCount : restatedBaseCount
    if (numerator / B.size > 0.05) {
      fail('R-flatten', '(document)', `${numerator}/${B.size} base ids restated${inputs.baseNodeTexts ? ' byte-identically' : ''} — flattening detected (>5%, spec §1.3)`)
    }
  }

  // ── R-rates — the inline-rate tripwire (spec §3.6) ──────────────────────────
  walk(root, (n) => {
    if (n.name !== 'table') return
    const hasData = n.children.some((c) => c.name === 'data')
    if (n.attrs.tableType === 'local' && hasData && tableNamesLower.has((n.attrs.id ?? '').toLowerCase())) {
      fail('R-rates', 'table', `rate-table-inlined: local table "${n.attrs.id}" collides with the TableConfig manifest — rates ride Unity, never the XML`, n.attrs.id)
    }
  })

  // ── R-idref — every reference resolves in the composed namespace ────────────
  const resolvable = (ref: string): boolean =>
    overlayIds.has(ref) || B.has(ref) || C.has(ref) || platform.has(ref) || tablesById.has(ref)

  walk(root, (n, parent) => {
    if (n.name === 'lookup') {
      const tableRef = n.children.find((c) => c.name === 'tableRef')
      const fieldRef = n.children.find((c) => c.name === 'fieldRef')
      const table = tableRef?.attrs.value !== undefined ? tablesById.get(tableRef.attrs.value) : undefined
      if (tableRef && tableRef.attrs.value !== undefined && !table) {
        fail('R-idref', 'tableRef', `dangling-reference: tableRef "${tableRef.attrs.value}" resolves to no TableConfig manifest row (L3)`)
      }
      if (table && fieldRef && fieldRef.attrs.value !== table.valueColumn) {
        fail('R-idref', 'fieldRef', `fieldRef "${fieldRef.attrs.value}" must byte-match the value header "${table.valueColumn}" of ${table.tableName} (L3)`)
      }
      for (const kr of n.children.filter((c) => c.name === 'keyRef')) {
        if (table && kr.attrs.name !== undefined && !table.keyColumns.includes(kr.attrs.name)) {
          fail('R-idref', 'keyRef', `keyRef name "${kr.attrs.name}" must byte-match a key header of ${table.tableName} (${table.keyColumns.join(', ')}) (L3)`)
        }
      }
      return
    }
    const idref = n.attrs.idref
    if (idref !== undefined && !resolvable(idref)) {
      fail('R-idref', n.name, `dangling-reference: idref "${idref}" resolves in neither overlay, base chain, generated set, platform set, nor tables`, parent?.attrs.id)
    }
    if (n.name === 'documentSet' && n.attrs.condition) {
      if (!resolvable(n.attrs.condition)) {
        fail('R-idref', 'documentSet', `condition "${n.attrs.condition}" does not resolve`, n.attrs.name)
      }
    }
  })

  return { ok: !findings.some((f) => f.level === 'FAIL'), findings }
}
