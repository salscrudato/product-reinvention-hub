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
  return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
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
    const idx = brainQueue.findIndex(b => nameKey(b.data?.name) === key)
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
        for (const f of ISO_IDENTITY_FIELDS) if (isoProduct.data[f] !== undefined && productPlanned.data[f] === undefined) productPlanned.data[f] = isoProduct.data[f]
        if (!productPlanned.data.name && isoProduct.data.name) { productPlanned.data.name = isoProduct.data.name; productPlanned.label = isoProduct.data.name }
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
