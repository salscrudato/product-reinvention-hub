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

const BOOLEANISH_FIELDS = ['premiumGenerating', 'dynamic', 'mandatoryDefault', 'admitted', 'displayOnSchedule', 'multiUse', 'allStates', 'bureauFlag', 'proprietaryFlag']

function foldEnums(data) {
  for (const [field, rules] of Object.entries(ENUM_FOLD)) {
    const v = data[field]
    if (typeof v !== 'string') continue
    for (const [re, canonical] of rules) {
      if (re.test(v.trim())) { data[field] = canonical; break }
    }
  }
  // Source workflow strings ("Approved - Completed") are NOT the canonical entity
  // status — preserve them under sourceStatus and default the canonical field.
  if (typeof data.status === 'string' && !/^(ACTIVE|INACTIVE|FUTURE)$/.test(data.status)) {
    data.sourceStatus = data.status
    delete data.status
  }
  // Yes/No cells → booleans on boolean-shaped canonical fields.
  for (const f of BOOLEANISH_FIELDS) {
    if (typeof data[f] === 'string') {
      const v = data[f].trim().toLowerCase()
      if (v === 'yes' || v === 'y' || v === 'true' || v === 'x') data[f] = true
      else if (v === 'no' || v === 'n' || v === 'false' || v === '') data[f] = false
    }
  }
  // Flag aliases fold into the canonical source enum.
  if (data.source === undefined) {
    if (data.proprietaryFlag === true) data.source = 'PROPRIETARY'
    else if (data.proprietaryFlag === false || data.bureauFlag === true) data.source = 'BUREAU'
  }
  delete data.proprietaryFlag
  delete data.bureauFlag
  // Form numbers as arrays, always.
  if (typeof data.formNumbers === 'string') {
    data.formNumbers = data.formNumbers.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)
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

// ─── Deterministic ISO-mapper join ────────────────────────────────────────────
// When the raw grids parse under the battle-tested ISO-family mapper, its output
// is the CANONICAL-IDENTITY ORACLE: registry-derived refIds (TBD sources), parent
// linkage, sibling order, and cross-sheet formNumbers joins. The brain remains the
// PROVENANCE source (citations + confidence per field). Join rules:
//   * identity fields (refId, parentId, order, formNumbers, workflow defaults)
//     come from the mapper when the entities correspond;
//   * extracted value fields keep the brain's cited values;
//   * mapper-only entities are appended (cited to the deterministic parse);
//   * brain-only entities stay, flagged for review. Nothing is dropped silently.

const ISO_IDENTITY_FIELDS = ['refId', 'parentId', 'order', 'formNumbers', 'allStates', 'states', 'status', 'lifecycle', 'reviewStatus', 'reviewer', 'terms']

function nameKey(v) {
  // Join keys need the same canonicalization discipline as value comparison:
  // case, whitespace AND punctuation ('HO 3' ≡ 'HO-3' ≡ 'HO–3', ledger F11).
  return String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function joinGroupWithIso(brainGroup, isoGroup, kindLabel, importWarnings, refIdRemap) {
  if (!Array.isArray(isoGroup) || isoGroup.length === 0) return brainGroup
  const out = []
  const isoByRefId = new Map(isoGroup.map(p => [p.refId, p]))
  const consumedIso = new Set()
  const unmatchedBrain = []

  const adoptIdentity = (brainP, isoP) => {
    const oldRefId = brainP.refId
    for (const f of ISO_IDENTITY_FIELDS) {
      if (isoP.data[f] !== undefined) brainP.data[f] = isoP.data[f]
    }
    // Gap-fill: any template field the brain did NOT extract comes from the
    // deterministic parse (requirement, claimsBasis, source, …). The brain's
    // cited value always wins when both sides carry the field.
    for (const [k, v] of Object.entries(isoP.data)) {
      if (brainP.data[k] === undefined && k !== 'confidence' && k !== 'citation') brainP.data[k] = v
    }
    brainP.refId = isoP.refId
    brainP.docId = isoP.docId ?? toDocId(isoP.refId)
    brainP.data.refId = isoP.refId
    brainP.label = (typeof brainP.data.name === 'string' && brainP.data.name) || isoP.label
    brainP.data.consensus = 'iso-join'
    if (oldRefId && oldRefId !== isoP.refId) refIdRemap.set(`${kindLabel}|${oldRefId}`, isoP.refId)
  }

  // Pass 1: exact refId correspondence (sources that ship real ids).
  for (const brainP of brainGroup) {
    const isoP = brainP.refId ? isoByRefId.get(brainP.refId) : undefined
    if (isoP && !consumedIso.has(isoP.refId)) {
      adoptIdentity(brainP, isoP)
      consumedIso.add(isoP.refId)
      out.push(brainP)
    } else {
      unmatchedBrain.push(brainP)
    }
  }

  // Pass 2: sequence-aligned name matching for synthesized/mismatched ids.
  const remainingIso = isoGroup.filter(p => !consumedIso.has(p.refId))
  const brainQueue = [...unmatchedBrain]
  for (const isoP of remainingIso) {
    const key = nameKey(isoP.data?.name ?? isoP.label)
    // An empty canonical key ('---', '###', …) must never join — two unnamed
    // entities matching on '' would be a false merge.
    const idx = key === '' ? -1 : brainQueue.findIndex(b => nameKey(b.data?.name) === key)
    if (idx >= 0) {
      const brainP = brainQueue.splice(idx, 1)[0]
      adoptIdentity(brainP, isoP)
      consumedIso.add(isoP.refId)
      out.push(brainP)
    } else {
      // Mapper-only entity: include it, cited to the deterministic parse.
      const p = {
        docId: isoP.docId ?? toDocId(isoP.refId),
        refId: isoP.refId,
        label: isoP.label,
        data: { ...isoP.data, confidence: 0.95, citation: '(deterministic ISO-family parse)' },
      }
      out.push(p)
    }
  }

  // Brain-only leftovers: kept, flagged — never silently dropped.
  for (const brainP of brainQueue) {
    brainP.data.needsReview = true
    out.push(brainP)
  }
  const leftover = brainQueue.length
  if (leftover > 0) {
    importWarnings.push({ kind: 'not-in-deterministic-map', sheet: null, row: null, field: kindLabel, detail: `${leftover} extracted ${kindLabel} entit(y|ies) have no counterpart in the deterministic template parse — kept with review flags.` })
  }

  return out
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

  // Template-placeholder rows ("<Enter step>", "[INSERT PRODUCT NAME]", "xxx") are
  // form filler, not product data — route to unresolved, never into the plan.
  const PLACEHOLDER_RE = /^\s*(<[^>]*>|\[[^\]]*\]|insert\b.*|enter\b.*|example\b.*|placeholder.*|tbd|n\/a|xxx+|\.{3,})\s*$/i
  const isPlaceholderEntity = (e) => {
    const strFields = e.fields.filter(f => typeof f.value === 'string' && f.value.trim() !== '' && f.citation?.verbatim !== '(synthesized)')
    return strFields.length > 0 && strFields.every(f => PLACEHOLDER_RE.test(f.value))
  }

  const accepted = []
  const unresolved = []
  for (const e of brainOutput.entities || []) {
    if (isPlaceholderEntity(e)) {
      unresolved.push({
        section: e.kind,
        label:   entityLabel(e),
        refId:   entityRefId(e),
        reason:  'placeholder-only row (template filler, not product data)',
        citation: citationString(e.fields[0]?.citation),
      })
      continue
    }
    // BLOCKING grounding failures from the stage-5 deterministic citation resolver
    // (P0-6 / ledger F08): the entity is NOT auto-accepted — it moves to unresolved
    // with its evidence and reasons, never silently planned, never dropped.
    if (e.blocked) {
      unresolved.push({
        section: e.kind,
        label:   entityLabel(e),
        refId:   entityRefId(e),
        severity: 'BLOCKING',
        reason:  `blocked by deterministic citation verification: ${(Array.isArray(e.blockReasons) ? e.blockReasons : []).join('; ') || 'grounding check failed'}`,
        citation: citationString(e.fields[0]?.citation),
      })
      continue
    }
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

  // Conservation (P0-5 / ledger F06): the plan carries ONE product and ONE rating
  // program — every extra ACCEPTED entity of those kinds becomes a BLOCKING
  // unresolved item with its evidence, never a silent drop.
  for (const extra of productEntities.slice(1)) {
    unresolved.push({
      section: 'product', label: entityLabel(extra), refId: entityRefId(extra),
      severity: 'BLOCKING',
      reason: `multiple product rows extracted — the plan carries one product ("${productPlanned?.label ?? ''}"); this row was NOT imported. Split the workbook or import it separately.`,
      citation: citationString(extra.fields[0]?.citation),
    })
  }
  if (productEntities.length > 1) {
    planWarnings.push({ kind: 'multiple-products', sheet: null, row: null, field: 'refId', detail: `${productEntities.length} product rows extracted — kept "${productPlanned?.refId ?? productPlanned?.label ?? ''}"; ${productEntities.length - 1} moved to unresolved (BLOCKING review).` })
  }

  // A product stub is only justified when the source yielded real content — a
  // blank template must produce an EMPTY plan, not a synthesized product.
  const contentEntityCount = accepted.filter(e => e.kind !== 'product').length
  if (!productPlanned && contentEntityCount > 0) {
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
  for (const extra of programs.slice(1)) {
    unresolved.push({
      section: 'rating', label: entityLabel(extra), refId: entityRefId(extra),
      severity: 'BLOCKING',
      reason: 'multiple rating-program rows extracted — the plan carries one program; this row was NOT imported (conservation).',
      citation: citationString(extra.fields[0]?.citation),
    })
  }
  if (programs.length > 1) {
    planWarnings.push({ kind: 'multiple-rating-programs', sheet: null, row: null, field: 'refId', detail: `${programs.length} rating-program rows extracted — kept the first; ${programs.length - 1} moved to unresolved (BLOCKING review).` })
  }
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
  let coverages = byKind('coverage').map(e => toPlanned(e))
  let forms     = byKind('form').map(e => toPlanned(e, productRefId ? { productRefIds: [productRefId] } : {}))
  let rules     = byKind('rule').map(e => toPlanned(e))
  let formRules = byKind('formRule').map(e => toPlanned(e))
  let ldTables  = byKind('ldTable').map(e => toPlanned(e, productRefId ? { productId: productRefId } : {}))
  let rtTables  = byKind('rtTable').map(e => toPlanned(e, productRefId ? { productId: productRefId } : {}))

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

  // ── Deterministic ISO-mapper join (canonical-identity oracle) ──────────────
  const refIdRemap = new Map()
  const joinWarnings = []
  const iso = opts.isoPlan && typeof opts.isoPlan === 'object' ? opts.isoPlan : null
  if (iso) {
    coverages = joinGroupWithIso(coverages, iso.coverages, 'coverage', joinWarnings, refIdRemap)
    forms     = joinGroupWithIso(forms, iso.forms, 'form', joinWarnings, refIdRemap)
    rules     = joinGroupWithIso(rules, iso.rules, 'rule', joinWarnings, refIdRemap)
    formRules = joinGroupWithIso(formRules, iso.formRules, 'formRule', joinWarnings, refIdRemap)
    ldTables  = joinGroupWithIso(ldTables, iso.ldTables, 'ldTable', joinWarnings, refIdRemap)
    rtTables  = joinGroupWithIso(rtTables, iso.rtTables, 'rtTable', joinWarnings, refIdRemap)

    // Product identity from the mapper (registry-shaped id beats a SYNTH stub).
    const isoProduct = iso.product ?? (Array.isArray(iso.products) ? iso.products[0] : null)
    if (isoProduct && isoProduct.refId) {
      if (!productPlanned) {
        productPlanned = { docId: isoProduct.docId ?? toDocId(isoProduct.refId), refId: isoProduct.refId, label: isoProduct.label, data: { ...isoProduct.data, confidence: 0.95, citation: '(deterministic ISO-family parse)' } }
      } else if (productPlanned.refId !== isoProduct.refId) {
        if (productPlanned.refId) refIdRemap.set(`product|${productPlanned.refId}`, isoProduct.refId)
        productPlanned.refId = isoProduct.refId
        productPlanned.docId = isoProduct.docId ?? toDocId(isoProduct.refId)
        productPlanned.data.refId = isoProduct.refId
        for (const [k, v] of Object.entries(isoProduct.data)) {
          if (productPlanned.data[k] === undefined && k !== 'confidence' && k !== 'citation') productPlanned.data[k] = v
        }
      }
      // The template's own product name beats a filename-derived stub name.
      if (typeof isoProduct.data.name === 'string' && isoProduct.data.name.trim()) {
        productPlanned.data.name = isoProduct.data.name
        productPlanned.label = isoProduct.data.name
      }
      productRefId = productPlanned.refId
      // Re-stamp product linkage on dependents after any identity change.
      for (const f of forms) f.data.productRefIds = [productRefId]
      for (const t of [...ldTables, ...rtTables]) t.data.productId = productRefId
    }

    // Rating program: adopt the mapper's when the brain produced none.
    if (!ratingProgram && iso.ratingProgram) {
      const ip = iso.ratingProgram
      ratingProgram = { docId: ip.docId ?? toDocId(ip.refId ?? 'rating-program'), refId: ip.refId ?? null, label: ip.label ?? 'Rating Program', data: { ...ip.data, confidence: 0.95, citation: '(deterministic ISO-family parse)' } }
    } else if (ratingProgram && iso.ratingProgram) {
      if (iso.ratingProgram.refId && ratingProgram.refId !== iso.ratingProgram.refId) {
        if (ratingProgram.refId) refIdRemap.set(`ratingProgram|${ratingProgram.refId}`, iso.ratingProgram.refId)
        ratingProgram.refId = iso.ratingProgram.refId
        ratingProgram.data.refId = iso.ratingProgram.refId
      }
      if ((!Array.isArray(ratingProgram.data.steps) || ratingProgram.data.steps.length === 0) && Array.isArray(iso.ratingProgram.data?.steps)) {
        ratingProgram.data.steps = iso.ratingProgram.data.steps
      }
    }
  }

  // ── refId remap: rewrite EDGES, not just node names (ledger F17) ────────────
  // Identity adoption is a graph operation. Every field that can reference a
  // remapped refId must follow it, or the plan carries dangling relations and
  // the orphan check below falsely promotes children whose parent simply got a
  // new id. Falsy remap targets never rewrite (iso forms carry refId null).
  if (refIdRemap.size > 0) {
    const remapTo = (kind, id) => (typeof id === 'string' && id !== '' && refIdRemap.get(`${kind}|${id}`)) || null
    for (const c of coverages) {
      const p = remapTo('coverage', c.data.parentId)
      if (p) c.data.parentId = p
      if (Array.isArray(c.data.terms)) {
        for (const t of c.data.terms) {
          const ld = t && remapTo('ldTable', t.ldTableRef)
          if (ld) t.ldTableRef = ld
        }
      }
    }
    for (const r of [...rules, ...formRules]) {
      if (Array.isArray(r.data.coverageRefIds)) {
        r.data.coverageRefIds = r.data.coverageRefIds.map((id) => remapTo('coverage', id) || id)
      }
      const tableRef = remapTo('ldTable', r.data.ldTableRef) || remapTo('rtTable', r.data.ldTableRef)
      if (tableRef) r.data.ldTableRef = tableRef
    }
    if (ratingProgram && Array.isArray(ratingProgram.data.steps)) {
      for (const s of ratingProgram.data.steps) {
        const ref = s && s.source && s.source.ref
        const to = remapTo('rtTable', ref) || remapTo('ldTable', ref)
        if (to) s.source.ref = to
      }
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

  // Empty-plan cleanup: when NO group carries content, SYNTH stubs (product /
  // rating program) must not survive — a blank template yields an EMPTY plan.
  const planHasContent = coverages.length + forms.length + rules.length + formRules.length +
    ldTables.length + rtTables.length + steps.length > 0
  if (!planHasContent) {
    if (productPlanned && /SYNTH/.test(String(productPlanned.refId ?? ''))) {
      productPlanned = null
      productRefId = null
      planWarnings.push({ kind: 'empty-source', sheet: null, row: null, field: null, detail: 'Source produced no plan content — synthesized product stub removed; nothing to import.' })
    }
    if (ratingProgram && /SYNTH/.test(String(ratingProgram.refId ?? ''))) ratingProgram = null
  }

  // refId identity adopted from the mapper → keep provenance rows addressable.
  if (refIdRemap.size > 0) {
    for (const row of provenance) {
      const remapped = refIdRemap.get(`${row.kind}|${row.refId}`)
      if (remapped) row.refId = remapped
    }
  }

  const importWarnings = [
    ...(opts.routerWarnings || []).map(w => ({ kind: w.kind, sheet: w.doc ?? null, row: null, field: null, detail: w.detail })),
    ...planWarnings,
    ...joinWarnings,
    ...(brainOutput.importWarnings || []),
  ]

  const dynamicFieldCount = byKind('dynamicField').length
  if (dynamicFieldCount > 0) {
    importWarnings.push({ kind: 'dynamic-fields-surfaced', sheet: null, row: null, field: null, detail: `${dynamicFieldCount} dynamic-field row(s) extracted; review them in provenance (not auto-attached to forms).` })
  }

  // ── Plan integrity (first principles: relationships are first-class; the
  // Framework ID is the linkage key across all pillars) ───────────────────────
  {
    // 1. Duplicate refIds within a group → keep the first, flag the rest (a
    //    duplicate create would fail or silently overwrite at persist time).
    for (const [label, group] of [['coverage', coverages], ['form', forms], ['rule', rules], ['formRule', formRules], ['ldTable', ldTables], ['rtTable', rtTables]]) {
      const seen = new Set()
      for (const p of group) {
        if (!p.refId) continue
        if (seen.has(p.refId)) {
          p.data.needsReview = true
          p.data.duplicateOf = p.refId
          importWarnings.push({ kind: 'duplicate-refId', sheet: null, row: null, field: label, detail: `Duplicate ${label} refId "${p.refId}" (${p.label}) — review which row is authoritative before persisting.` })
        }
        seen.add(p.refId)
      }
    }

    // 2. Orphan sub-coverages: a parentId that resolves to no coverage in this plan
    //    would be rejected by the server's parent validation — promote to top level
    //    with a warning (same convention as the deterministic mapper).
    const covIds = new Set(coverages.map(c => c.refId).filter(Boolean))
    for (const c of coverages) {
      const pid = c.data.parentId
      if (pid != null && pid !== '' && !covIds.has(pid)) {
        importWarnings.push({ kind: 'orphan-promoted', sheet: null, row: null, field: 'parentId', detail: `Sub-coverage ${c.refId ?? c.label} references parent "${pid}" which is not in this plan — promoted to top level; re-parent after import if needed.` })
        c.data.parentId = null
        c.data.needsReview = true
      }
    }

    // 3. Cross-pillar linkage: coverage/rule formNumbers should resolve to forms in
    //    this upload (or an already-imported product). Dangling references are the
    //    #1 sign of a missing artifact — reported, never dropped.
    const formNumberSet = new Set(forms.map(f => String(f.data.number ?? f.refId ?? '').trim()).filter(Boolean))
    if (formNumberSet.size > 0) {
      const dangling = new Map()
      for (const p of [...coverages, ...rules, ...formRules]) {
        for (const fn of Array.isArray(p.data.formNumbers) ? p.data.formNumbers : []) {
          const t = String(fn).trim()
          if (t && !formNumberSet.has(t)) dangling.set(t, (dangling.get(t) ?? 0) + 1)
        }
      }
      if (dangling.size > 0) {
        const list = [...dangling.keys()].slice(0, 12).join(', ')
        importWarnings.push({ kind: 'dangling-form-reference', sheet: null, row: null, field: 'formNumbers', detail: `${dangling.size} referenced form number(s) are not in this upload's forms specifications (${list}${dangling.size > 12 ? ', …' : ''}) — they may live in a forms workbook that was not uploaded, or in the target product.` })
      }
    }

    // 4. Exclusion-as-coverage smell: per first principles an exclusion is NOT a
    //    coverage (no limit/deductible/premium) — it is a form/rule that removes
    //    or amends coverage. Flag for review, keep the extraction.
    for (const c of coverages) {
      if (/\bexclusion\b|\bexcluded\b/i.test(String(c.data.name ?? ''))) {
        c.data.needsReview = true
        importWarnings.push({ kind: 'exclusion-as-coverage', sheet: null, row: null, field: 'name', detail: `"${c.data.name}" (${c.refId}) looks like an EXCLUSION — per the product model an exclusion is a form/rule that removes coverage, not a coverage. Review its classification.` })
      }
    }
  }

  // ── Completeness intelligence (first principles: a product is a PCM backbone
  // plus three specification pillars — governed / presented / priced) ──────────
  // A single artifact (forms-only, rating-only …) rarely constitutes a product.
  // Assess what this upload actually provides and tell the user what is likely
  // missing — deterministic, derived from the assembled plan itself.
  const stepsCount = ratingProgram && Array.isArray(ratingProgram.data.steps) ? ratingProgram.data.steps.length : 0
  const pillars = {
    framework: coverages.length > 0,
    forms:     forms.length > 0,
    rules:     (rules.length + formRules.length) > 0,
    rating:    Boolean(ratingProgram) || rtTables.length > 0 || ldTables.length > 0 || stepsCount > 0,
  }
  const missing = []
  const anyContent = Object.values(pillars).some(Boolean)
  if (anyContent) {
    if (!pillars.framework) missing.push({ pillar: 'framework', expectedArtifact: 'Product Framework / Product Component Model workbook', why: 'Coverages are the atomic unit of protection — the backbone that forms, rules, and rating attach to. Without the PCM this upload cannot stand alone as a product.' })
    if (!pillars.forms)     missing.push({ pillar: 'forms', expectedArtifact: 'Forms Specifications (form numbers, editions, attachment conditions)', why: 'How the product is PRESENTED in the market — base coverage forms, endorsements, exclusions, notices.' })
    if (!pillars.rules)     missing.push({ pillar: 'rules', expectedArtifact: 'Rules Specifications / Rules Repository', why: 'How the product is GOVERNED — eligibility, availability, packaging, mandatory/optional coverage, limit & deductible ranges.' })
    if (!pillars.rating)    missing.push({ pillar: 'rating', expectedArtifact: 'Rating Specifications / rate order of calculations + factor tables', why: 'How the product is PRICED — ordered rating steps and the factor tables they consume.' })
  }
  const completeness = {
    assessment: !anyContent ? 'EMPTY' : (missing.length === 0 ? 'COMPLETE' : (!pillars.framework ? 'PARTIAL_NO_BACKBONE' : 'PARTIAL')),
    // Specifications without a backbone should ATTACH to an existing product
    // rather than mint a new one — the review UI can offer that flow directly.
    attachStrategy: anyContent && !pillars.framework ? 'ATTACH_TO_EXISTING_PRODUCT' : 'NEW_PRODUCT',
    pillars,
    missing,
    guidance: !anyContent
      ? 'No product content was found in this upload.'
      : missing.length === 0
        ? 'Upload covers the product backbone and all three specification pillars (governed / presented / priced).'
        : (!pillars.framework
            ? `This upload provides ${Object.entries(pillars).filter(([, v]) => v).map(([k]) => k).join(' + ')} specifications but NO product framework (coverage hierarchy). Import is saved as a partial: upload the Product Framework / Component Model workbook so these specifications have a backbone to attach to.`
            : `Product backbone imported. Likely missing: ${missing.map(m => m.expectedArtifact).join('; ')}. Upload those artifacts to complete the product.`),
  }
  if (missing.length > 0 && anyContent) {
    importWarnings.push({ kind: 'incomplete-product', sheet: null, row: null, field: null, detail: completeness.guidance })
  }

  const acceptedCount = coverages.length + forms.length + rules.length + formRules.length +
    ldTables.length + rtTables.length + (productPlanned ? 1 : 0) + (ratingProgram ? 1 : 0)
  const counts = {
    proposed:   acceptedCount + unresolved.length,
    accepted:   acceptedCount,
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
    completeness,
    importWarnings,
    provenance,
    coverages: coverages.map(p => ({ refId: p.refId ?? '', name: p.label, formNumbers: Array.isArray(p.data.formNumbers) ? p.data.formNumbers : [] })),
  }

  return bundle
}

module.exports = { buildImportPlan }
