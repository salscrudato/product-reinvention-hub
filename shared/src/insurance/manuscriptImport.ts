// manuscriptImport.ts — deterministic ManuScript-overlay reader (spec §6.1, XE-05).
//
// The SMALLEST re-import seam the spec recommends: a deterministic
// mapManuscriptOverlay() — sibling of mapIsoWorkbook — that reads an Author XML
// OVERLAY (plus its export-manifest.json when present) back into the canonical
// ImportPlan shape the ISO identity-join consumes. It exists as a VALIDATION
// seam (the round-trip fidelity proof, L5's XML half); it is NOT exposed as a
// user-facing import source (stage-0 only routes here behind an opts-only flag;
// ledger XE-10 keeps the two-way plug on BACKLOG).
//
// PARSER HARDENING (binding): the shared parser has NO DTD machinery at all —
// <!DOCTYPE is rejected outright, so XXE and billion-laughs entity expansion are
// structurally impossible; only the five predefined entities + numeric character
// references resolve; input size, element depth and node count are capped.
//
// Honesty rules: refIds come ONLY from the bundled manifest (spec §2 — the
// manifest is what makes identity scoring possible) or stay null; foreign
// (non-Hub-emitted) overlays land as products with cited-but-opaque logic
// notices — honest PARTIAL, never invented structure.

import type { ImportNotice, ImportPlan, ImportSummary, PlannedEntity } from './isoImport'
import { parseXml, DEFAULT_PARSE_LIMITS, type ParseLimits, type XmlNode } from '../export/duckcreek/xml'

export interface ManuscriptManifest {
  manuscriptID?: string
  product?: { refId?: string; name?: string }
  /** dcId → Hub refId (or `<refId>#<part>` synthetic role). */
  ids?: Record<string, string>
  tables?: { tableName: string; sheetName?: string; dcTableId: string; keyColumns: string[]; valueColumn: string; hubRefId: string }[]
}

/** True when the text's root element is <ManuScript> — the stage-0 sniff clause. */
export function sniffManuscriptXml(text: string): boolean {
  const head = text.slice(0, 4096).replace(/^﻿/, '')
  // Skip leading prolog/comments/whitespace without parsing.
  const stripped = head
    .replace(/<\?[^?]*\?>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .trimStart()
  return /^<ManuScript[\s>]/.test(stripped)
}

function walk(node: XmlNode, visit: (n: XmlNode, ancestors: XmlNode[]) => void, ancestors: XmlNode[] = []): void {
  visit(node, ancestors)
  for (const c of node.children) walk(c, visit, [...ancestors, node])
}

const COVERAGE_PATH_RE = /^coverage\[Type="(.+)"\]$/

/**
 * Deterministic inverse of the Hub manuscriptID grammar
 * `<Tenant>_<REF_ID_SAFE>_d_d_d_d` — accepted ONLY when the recovered value
 * matches the Hub refId grammar (`PA.PROD.001`). A foreign manuscript that
 * merely LOOKS similar (e.g. `DCT_SampleProduct_3_0_0_0`) must NOT yield an
 * invented identity: refIds are recovered, never fabricated.
 */
function refIdFromManuscriptId(manuscriptID: string): string | null {
  const m = manuscriptID.match(/^[A-Za-z0-9]+_([A-Za-z0-9_]+?)_\d+_\d+_\d+_\d+$/)
  if (!m) return null
  const candidate = m[1]!.replace(/_/g, '.')
  return /^[A-Z]{2,4}\.[A-Z]+\.\d+$/.test(candidate) ? candidate : null
}

function summaryBase(): ImportSummary {
  return {
    productName: null, productRefId: null, lobName: null,
    counts: {}, warnings: [], unmappedColumns: [], sheetsRecognized: [], sheetsSkipped: [],
    defects: [], notices: [],
  }
}

/**
 * Map an Author XML overlay (+ optional export manifest) to the canonical
 * ImportPlan. Throws XmlParseError on malformed/hostile input (DOCTYPE, size,
 * depth, node caps) and Error when the root is not <ManuScript>.
 */
export function mapManuscriptOverlay(
  xmlText: string,
  manifest?: ManuscriptManifest | null,
  limits: ParseLimits = DEFAULT_PARSE_LIMITS,
): ImportPlan {
  const root = parseXml(xmlText, limits)
  if (root.name !== 'ManuScript') {
    throw new Error(`not a ManuScript overlay (root element <${root.name}>)`)
  }
  const ids = manifest?.ids ?? {}
  const summary = summaryBase()
  const notices: ImportNotice[] = summary.notices

  // ── Product identity from <properties> ───────────────────────────────────────
  const properties = root.children.find((c) => c.name === 'properties')
  const manuscriptID = properties?.attrs.manuscriptID ?? null
  const caption = properties?.attrs.caption ?? null
  const keyInfos = new Map<string, string>()
  walk(root, (n) => { if (n.name === 'keyInfo' && n.attrs.name) keyInfos.set(n.attrs.name, n.attrs.value ?? '') })
  const productRefId = manifest?.product?.refId
    ?? (manuscriptID ? refIdFromManuscriptId(manuscriptID) : null)
  if (!manifest?.product?.refId && productRefId) {
    notices.push({ code: 'refid-derived', message: `product refId ${productRefId} derived from manuscriptID grammar (no manifest)` })
  }
  if (!productRefId) {
    notices.push({ code: 'foreign-overlay', message: 'no Hub manifest and no Hub manuscriptID grammar — identities are opaque (honest PARTIAL)' })
  }
  const productName = manifest?.product?.name ?? caption ?? manuscriptID ?? 'ManuScript overlay'
  const product: PlannedEntity = {
    docId: productRefId ?? manuscriptID ?? 'manuscript-overlay',
    refId: productRefId,
    label: productName,
    data: {
      name: productName,
      manuscriptID,
      inherited: properties?.attrs.inherited ?? null,
      lob: keyInfos.get('lob') ?? null,
      source: 'manuscript-xml',
    },
  }
  summary.productName = productName
  summary.productRefId = productRefId
  summary.lobName = keyInfos.get('lob') ?? null

  // ── Coverages ────────────────────────────────────────────────────────────────
  // (a) overlay coverage objects (path = coverage[Type="…"]), (b) manifest-mapped
  // coverage identities the overlay never restates (Express generates them from
  // CoverageConfig — the manifest is the id source, spec §2).
  const coverageByRefId = new Map<string, PlannedEntity>()
  walk(root, (n) => {
    if (n.name !== 'object' || !n.attrs.path || !n.attrs.id) return
    const m = n.attrs.path.match(COVERAGE_PATH_RE)
    if (!m) return
    const display = m[1]!
    const refId = ids[n.attrs.id] ?? null
    const entity: PlannedEntity = {
      docId: refId ? refId.replace(/\./g, '-') : n.attrs.id,
      refId,
      label: display,
      data: { name: display, dcObjectId: n.attrs.id },
    }
    if (refId) coverageByRefId.set(refId, entity)
    else notices.push({ code: 'coverage-unmapped', message: `coverage object ${n.attrs.id} ("${display}") has no manifest identity` })
  })
  for (const [dcId, refId] of Object.entries(ids)) {
    if (!/^[A-Z]{2,3}\.COV\./.test(refId) || coverageByRefId.has(refId)) continue
    coverageByRefId.set(refId, {
      docId: refId.replace(/\./g, '-'),
      refId,
      label: dcId,
      data: { name: dcId, dcObjectId: dcId, recoveredFrom: 'manifest' },
    })
  }
  // parent-before-child order via refId nesting (the Hub's refId grammar).
  const coverages = [...coverageByRefId.values()].sort((a, b) => (a.refId ?? '').localeCompare(b.refId ?? ''))
  for (const cov of coverages) {
    if (!cov.refId) continue
    const parentRefId = cov.refId.split('.').slice(0, -1).join('.')
    cov.data.parentId = coverageByRefId.has(parentRefId) ? parentRefId : null
  }

  // ── Forms from <documents>/<documentSet> ─────────────────────────────────────
  const forms: PlannedEntity[] = []
  walk(root, (n) => {
    if (n.name !== 'documentSet' || !n.attrs.name) return
    const setName = n.attrs.name
    const number = ids[setName] ?? null
    const editionRaw = setName.includes('_') ? setName.slice(setName.lastIndexOf('_') + 1) : null
    forms.push({
      docId: (number ?? setName).replace(/\s+/g, '-'),
      refId: number,
      label: number ?? setName,
      data: {
        number: number ?? setName,
        edition: editionRaw,
        mandatoryDefault: n.attrs.printDefault === 'Mandatory',
        attachmentCondition: n.attrs.condition ? 'RULE' : 'NONE',
        documentSetName: setName,
      },
    })
  })

  // ── Rate tables — manifest first (the shared source of truth), overlay refs second ──
  const rtTables: PlannedEntity[] = []
  const seenTables = new Set<string>()
  for (const t of manifest?.tables ?? []) {
    seenTables.add(t.dcTableId)
    rtTables.push({
      docId: t.hubRefId,
      refId: t.hubRefId,
      label: t.tableName,
      data: { name: t.tableName, columns: [...t.keyColumns, t.valueColumn], dcTableId: t.dcTableId, sheetName: t.sheetName ?? null },
    })
  }
  walk(root, (n) => {
    if (n.name !== 'tableRef' || n.attrs.value === undefined) return
    if (seenTables.has(n.attrs.value)) return
    seenTables.add(n.attrs.value)
    rtTables.push({
      docId: n.attrs.value,
      refId: null,
      label: n.attrs.value,
      data: { name: n.attrs.value, dcTableId: n.attrs.value, recoveredFrom: 'overlay-tableRef' },
    })
    notices.push({ code: 'table-unmapped', message: `tableRef ${n.attrs.value} has no manifest row — identity opaque` })
  })

  // ── Rating-step skeletons from the compute chain ─────────────────────────────
  // Step privates are recognized by the manifest synthetic role `<prog>#<step>`
  // (Hub bundles) or by their lookup wiring (foreign overlays → opaque skeletons).
  const steps: { id: string; dcId: string; order: number; tableRef: string | null }[] = []
  let programRefId: string | null = null
  walk(root, (n, ancestors) => {
    if (n.name !== 'private' || !n.attrs.id) return
    const mapped = ids[n.attrs.id]
    const stepMatch = mapped?.match(/^(.+)#(s[\w]+)$/)
    const lookup = (function findLookup(node: XmlNode): XmlNode | null {
      if (node.name === 'lookup') return node
      for (const c of node.children) { const hit = findLookup(c); if (hit) return hit }
      return null
    })(n)
    if (stepMatch) {
      programRefId = programRefId ?? stepMatch[1]!
      steps.push({
        id: stepMatch[2]!,
        dcId: n.attrs.id,
        order: steps.length + 1,
        tableRef: lookup?.children.find((c) => c.name === 'tableRef')?.attrs.value ?? null,
      })
    } else if (!mapped && lookup && ancestors.some((a) => a.name === 'object')) {
      notices.push({ code: 'opaque-logic', message: `private ${n.attrs.id} carries lookup wiring with no manifest step mapping — kept as cited-but-opaque logic` })
    }
  })
  const ratingProgram: PlannedEntity | null = programRefId
    ? {
        docId: (programRefId as string).replace(/\./g, '-'),
        refId: programRefId,
        label: `${productName} rating program`,
        data: { stepCount: steps.length, steps, recoveredFrom: 'overlay-compute-chain' },
      }
    : null

  // Rules / formRules / LD tables are NOT recoverable from an overlay by design
  // (rules ride annotations/HITL, spec §3.9; LD value lists ride definition/options).
  notices.push({ code: 'not-recovered', message: 'rules, formRules and ldTables are not recoverable from an overlay (spec §3.9) — workbook/manifest half owns them' })

  summary.counts = {
    products: 1,
    coverages: coverages.length,
    forms: forms.length,
    rtTables: rtTables.length,
    ratingSteps: steps.length,
  }

  return {
    productId: productRefId,
    product,
    products: [product],
    coverages,
    forms,
    rules: [],
    formRules: [],
    ratingProgram,
    ldTables: [],
    rtTables,
    // Overlay recovery lifts rate tables directly from the compute chain; the D4
    // placeholder-minting path (workbook rating-area parse) never runs here.
    ratePlaceholders: [],
    summary,
  }
}
