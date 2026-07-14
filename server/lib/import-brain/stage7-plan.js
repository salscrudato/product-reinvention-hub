'use strict'
// server/lib/import-brain/stage7-plan.js — BrainOutput → persistable ImportPlan bundle.
//
// PURE + DETERMINISTIC (no AI calls, writes nothing). Assembles the brain's cited,
// confidence-scored entities into the same FilingImportPlan-shaped bundle the app's
// importPlan() persist path already consumes (plan.product / coverages / forms /
// rules / formRules / ratingProgram / ldTables / rtTables), so a workbook import
// persists through the STANDARD adapter.db.mutate path with zero new write code.
//
// Grounding invariants:
//   * Every entity keeps per-field citations in bundle.provenance (sheet!cell + verbatim
//     + confidence + consensus method) — nothing loses its source trace.
//   * refIds come from source cells byte-for-byte, or are SYNTH placeholders whose
//     prefix derives from the LOB registry hint. Never model-invented.
//   * Entities below CONFIDENCE_DISCARD are NOT silently dropped — they move to
//     bundle.unresolved with their citations (conservation: proposed = accepted + unresolved).

const { CONFIDENCE_DISCARD } = require('./constants')

const brainShared = require('../import-brain-shared.cjs')
const { LOB_REGISTRY } = brainShared

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fieldValue(entity, name) {
  const f = entity.fields.find(x => x.fieldName === name)
  return f ? f.value : undefined
}

function entityRefId(entity) {
  const v = fieldValue(entity, 'refId') ?? fieldValue(entity, 'number')
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function entityLabel(entity) {
  const v = fieldValue(entity, 'name') ?? fieldValue(entity, 'title') ?? fieldValue(entity, 'label')
  return typeof v === 'string' && v.trim() ? v.trim() : (entityRefId(entity) ?? entity.kind)
}

function toDocId(refId, fallback) {
  const base = (refId ?? fallback ?? 'entity').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base || 'entity'
}

function citationString(cit) {
  if (!cit || (!cit.sheet && !cit.cell)) return ''
  return `${cit.sheet ?? ''}!${cit.cell ?? ''}`.replace(/^!/, '')
}

// Enum folding: deterministic extraction copies cell bytes; the canonical model
// stores normalized enum tokens. Values fold to the canonical token when the source
// is a faithful synonym — citations keep the verbatim source text.
const ENUM_FOLD = {
  requirement: [[/^(m|mand|mandatory|required|req)$/i, 'MANDATORY'], [/^(o|opt|optional)$/i, 'OPTIONAL']],
  source:      [[/^(bureau|iso|aais|ncci|acord)$/i, 'BUREAU'], [/^(proprietary|prop|carrier)$/i, 'PROPRIETARY']],
  status:      [[/^active$/i, 'ACTIVE'], [/^inactive$/i, 'INACTIVE'], [/^future$/i, 'FUTURE']],
  claimsBasis: [[/^occ(urrence)?$/i, 'OCCURRENCE'], [/^claims[- ]?made$/i, 'CLAIMS_MADE']],
}

function foldEnums(data) {
  for (const [field, rules] of Object.entries(ENUM_FOLD)) {
    const v = data[field]
    if (typeof v !== 'string') continue
    for (const [re, canonical] of rules) {
      if (re.test(v.trim())) { data[field] = canonical; break }
    }
  }
}

/** Convert a BrainEntity into a PlannedEntity ({docId, refId, label, data}). */
function toPlanned(entity, extraData) {
  const refId = entityRefId(entity)
  const data = {}
  for (const f of entity.fields) {
    if (f.value === undefined) continue
    data[f.fieldName] = f.value
  }
  if (refId && !data.refId && entity.kind !== 'form') data.refId = refId
  // PCM sheets carry separate product / coverage / sub-coverage name columns per
  // row; the entity's OWN name is the most specific one present (canonicalMap's
  // coverageName/subCoverageName → name semantics).
  const ownName = [data.subCoverageName, data.coverageName, data.name]
    .find(v => typeof v === 'string' && v.trim() !== '')
  if (ownName) data.name = ownName
  foldEnums(data)
  // Provenance summary mirrors the filing path's coverage shape (confidence + citation
  // live in data so the review UI can render them without a side lookup).
  data.confidence = entity.overallConfidence
  const refField = entity.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
  data.citation = citationString(refField?.citation) || citationString(entity.fields[0]?.citation)
  Object.assign(data, extraData || {})
  return {
    docId: toDocId(refId, `${entity.kind}-${entity.sourceRowIndex}`),
    refId,
    label: (typeof data.name === 'string' && data.name.trim()) ? data.name : entityLabel(entity),
    data,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * @param {object}  brainOutput   BrainOutput from stage 6
 * @param {object}  opts
 * @param {string}  [opts.lobRefIdHint]  e.g. 'GL.LOB.001' (from stage 0 router)
 * @param {string}  [opts.sourceName]
 * @param {string}  [opts.edition]
 * @param {object[]} [opts.routerWarnings]
 * @returns {object} bundle (FilingImportPlan-shaped + fingerprint/provenance extras)
 */
function buildImportPlan(brainOutput, opts = {}) {
  const { lobRefIdHint, sourceName, edition } = opts
  const lob = lobRefIdHint ? LOB_REGISTRY[lobRefIdHint] : undefined

  const accepted = []
  const unresolved = []
  for (const e of brainOutput.entities || []) {
    if (e.overallConfidence < CONFIDENCE_DISCARD) {
      unresolved.push({
        section: e.kind,
        label:   entityLabel(e),
        refId:   entityRefId(e),
        reason:  `confidence ${e.overallConfidence.toFixed(2)} below discard floor ${CONFIDENCE_DISCARD}`,
        citation: citationString(e.fields[0]?.citation),
      })
    } else {
      accepted.push(e)
    }
  }

  const byKind = (kind) => accepted.filter(e => e.kind === kind)

  // ── Product ────────────────────────────────────────────────────────────────
  const productEntities = byKind('product')
  let productPlanned = productEntities.length > 0 ? toPlanned(productEntities[0]) : null
  let productRefId   = productPlanned?.refId ?? null
  const planWarnings = []

  if (!productPlanned && accepted.length > 0) {
    // No product row in the source — derive a stub refId from the LOB registry
    // (registry-scheme synthesis, never model-invented) so children can persist.
    const prefix = lob ? (lob.refIdPrefix || lob.code || lobRefIdHint.split('.')[0]) : 'XX'
    productRefId = `${prefix}.PROD.SYNTH001`
    productPlanned = {
      docId: toDocId(productRefId),
      refId: productRefId,
      label: sourceName ? sourceName.replace(/\.[^.]+$/, '') : 'Imported Product',
      data: {
        refId: productRefId,
        name:  sourceName ? sourceName.replace(/\.[^.]+$/, '') : 'Imported Product',
        status: 'DRAFT',
        confidence: 0.5,
        citation: '(synthesized: source had no product row)',
      },
    }
    planWarnings.push({ kind: 'product-synthesized', sheet: null, row: null, field: 'refId', detail: `Source contained no product entity; synthesized DRAFT product ${productRefId} — human review required.` })
  }
  if (productPlanned) {
    // product.lob must be the { refId, name } object shape the app reads everywhere.
    if (lob) productPlanned.data.lob = { refId: lob.refId, name: lob.name }
    if (edition && !productPlanned.data.edition) productPlanned.data.edition = edition
    productRefId = productPlanned.refId ?? productRefId
  }

  // ── Rating program: fold ratingSteps under the program entity ──────────────
  const programs = byKind('ratingProgram')
  const steps    = byKind('ratingStep').map(e => toPlanned(e))
  let ratingProgram = programs.length > 0 ? toPlanned(programs[0]) : null
  if (!ratingProgram && steps.length > 0) {
    const prefix = lob ? (lob.refIdPrefix || lob.code) : 'XX'
    const refId = `${prefix}.PROG.SYNTH001`
    ratingProgram = {
      docId: toDocId(refId), refId, label: 'Imported Rating Program',
      data: { refId, name: 'Imported Rating Program', confidence: 0.5, citation: '(synthesized: steps present without a program row)' },
    }
    planWarnings.push({ kind: 'program-synthesized', sheet: null, row: null, field: 'refId', detail: `Rating steps present without a program row; synthesized ${refId}.` })
  }
  if (ratingProgram && steps.length > 0) ratingProgram.data.steps = steps.map(s => s.data)

  // Canonical workflow defaults every imported entity carries (identical to the
  // deterministic ISO mapper's conventions) — these are importer-stamped review
  // metadata, not extracted data, so they carry no citation.
  const stampDefaults = (p) => {
    if (p.data.status === undefined)       p.data.status = 'ACTIVE'
    if (p.data.lifecycle === undefined)    p.data.lifecycle = 'DRAFT'
    if (p.data.reviewStatus === undefined) p.data.reviewStatus = 'NOT_STARTED'
    if (p.data.reviewer === undefined)     p.data.reviewer = ''
    if (p.data.allStates === undefined)    p.data.allStates = !Array.isArray(p.data.states) || p.data.states.length === 0
    if (p.data.formNumbers === undefined)  p.data.formNumbers = []
    return p
  }

  // ── Groups ─────────────────────────────────────────────────────────────────
  const coverages = byKind('coverage').map(e => toPlanned(e))
  const forms     = byKind('form').map(e => toPlanned(e, productRefId ? { productRefIds: [productRefId] } : {}))
  const rules     = byKind('rule').map(e => toPlanned(e))
  const formRules = byKind('formRule').map(e => toPlanned(e))
  const ldTables  = byKind('ldTable').map(e => toPlanned(e, productRefId ? { productId: productRefId } : {}))
  const rtTables  = byKind('rtTable').map(e => toPlanned(e, productRefId ? { productId: productRefId } : {}))

  // Parent-before-child ordering for coverages (importPlan flushes batches on
  // forward-references; sorting parents first minimizes flushes and orphan risk).
  coverages.sort((a, b) => {
    const ap = a.data.parentId ? 1 : 0
    const bp = b.data.parentId ? 1 : 0
    return ap - bp
  })

  // Canonical defaults + positional `order` (1..n among siblings, same convention
  // as the deterministic ISO mapper — a derived display position, never a cell).
  for (const group of [coverages, forms, rules, formRules, ldTables, rtTables]) {
    group.forEach(p => stampDefaults(p))
  }
  {
    const siblingSeq = new Map()
    for (const c of coverages) {
      if (c.data.order !== undefined) continue
      const key = c.data.parentId ?? '(top)'
      const n = (siblingSeq.get(key) ?? 0) + 1
      siblingSeq.set(key, n)
      c.data.order = n
    }
  }

  // ── Provenance: every field of every accepted entity keeps its citation ────
  const provenance = []
  for (const e of accepted) {
    const refId = entityRefId(e)
    for (const f of e.fields) {
      provenance.push({
        kind:       e.kind,
        refId,
        field:      f.fieldName,
        value:      f.value,
        confidence: f.confidence,
        sheet:      f.citation?.sheet ?? '',
        cell:       f.citation?.cell ?? '',
        verbatim:   f.citation?.verbatim ?? '',
        consensus:  f.consensus ?? null,
      })
    }
  }

  const importWarnings = [
    ...(opts.routerWarnings || []).map(w => ({ kind: w.kind, sheet: w.doc ?? null, row: null, field: null, detail: w.detail })),
    ...planWarnings,
    ...(brainOutput.importWarnings || []),
  ]

  const dynamicFieldCount = byKind('dynamicField').length
  if (dynamicFieldCount > 0) {
    importWarnings.push({ kind: 'dynamic-fields-surfaced', sheet: null, row: null, field: null, detail: `${dynamicFieldCount} dynamic-field row(s) extracted; review them in provenance (not auto-attached to forms).` })
  }

  const counts = {
    proposed:   (brainOutput.entities || []).length,
    accepted:   accepted.length,
    unresolved: unresolved.length,
  }

  const reviewItem = (p, section) => ({
    section, label: p.label, refId: p.refId, docId: p.docId,
    confidence: Number(p.data.confidence ?? 0), citation: String(p.data.citation ?? ''),
  })

  const bundle = {
    plan: {
      productId: productRefId,
      product:   productPlanned,
      products:  productPlanned ? [productPlanned] : [],
      coverages, forms, rules, formRules,
      ratingProgram, ldTables, rtTables,
      summary: {
        productName:      productPlanned?.label ?? '',
        productRefId:     productRefId ?? '',
        lobName:          lob?.name ?? '',
        counts: {
          coverages: coverages.length, forms: forms.length, rules: rules.length,
          formRules: formRules.length, ldTables: ldTables.length, rtTables: rtTables.length,
          ratingSteps: steps.length,
        },
        warnings:         importWarnings.map(w => `[${w.kind}]${w.sheet ? ` ${w.sheet}` : ''}${w.field ? ` ${w.field}` : ''}: ${w.detail}`),
        unmappedColumns:  (brainOutput.columnMaps || []).flatMap(m =>
          m.unmappedIndices.map(i => `${m.sheetName}:${i}`)),
        sheetsRecognized: (brainOutput.classifiedSheets || []).filter(s => s.domain !== 'ignore').map(s => s.sheetName),
        sheetsSkipped:    (brainOutput.classifiedSheets || []).filter(s => s.domain === 'ignore').map(s => s.sheetName),
        defects: [],
        notices: [],
      },
    },
    filingState:     '',
    baseFormNumber:  forms[0]?.refId ?? '',
    baseFormEdition: edition ?? '',
    review: {
      product:   { items: productPlanned ? [reviewItem(productPlanned, 'product')] : [] },
      coverages: { items: coverages.map(p => reviewItem(p, 'coverages')) },
      tables:    { items: [...ldTables, ...rtTables].map(p => reviewItem(p, 'tables')) },
      rules:     { items: [...rules, ...formRules].map(p => reviewItem(p, 'rules')) },
      rating:    { items: ratingProgram ? [reviewItem(ratingProgram, 'rating')] : [] },
    },
    unresolved,
    counts,
    fingerprint: {
      container:      'XLSX',
      detectedFormat: 'ISO_WORKBOOK',
      lineGuesses:    lob ? [{ lobRefId: lob.refId, confidence: 0.9, signals: ['refId-prefix-majority'] }] : [],
      documentRoles:  sourceName ? [{ documentName: sourceName, role: 'workbook', confidence: 0.9 }] : [],
    },
    extractionPlan: {
      format: 'ISO_WORKBOOK',
      lobRefId: lob?.refId ?? '',
      archetype: null,
      documentRoleAssignments: sourceName ? [{ documentName: sourceName, role: 'workbook', extractor: 'AI_EXTRACT_FULL' }] : [],
      splitStrategy: 'SINGLE_PRODUCT',
    },
    sampledVerifications: [],
    splitProducts: [],
    importWarnings,
    provenance,
    coverages: coverages.map(p => ({ refId: p.refId ?? '', name: p.label, formNumbers: Array.isArray(p.data.formNumbers) ? p.data.formNumbers : [] })),
  }

  return bundle
}

module.exports = { buildImportPlan }
