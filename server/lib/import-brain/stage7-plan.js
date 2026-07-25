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
const { LOB_REGISTRY, refIdToDocId, isPlaceholder } = brainShared

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

// docId minting: refIds go through THE canonical case-preserving mint (bridged
// refIdToDocId, BACKLOG_SEED item 1) so the parentId validator's dot->dash
// candidate resolves brain-minted parents ("CORE.COV.001" -> "CORE-COV-001").
// The old lowercasing here stranded every non-ISO-joined child behind a 422
// INVALID_PARENT. Label-derived fallbacks (no refId, e.g. "coverage-3") keep the
// legacy slug — they are never parentId targets, and slugs stay URL-tame.
function toDocId(refId, fallback) {
  if (typeof refId === 'string' && refId.trim()) return refIdToDocId(refId.trim())
  const base = String(fallback ?? 'entity').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
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
  // Leading-token match, not whole-string: real workbooks qualify the state in the same cell
  // ("Inactive - No Longer in Use", "Active — Renewal Only"). The fully-anchored form failed to
  // fold those, so they fell through to sourceStatus and then defaulted to ACTIVE — importing a
  // RETIRED coverage as in-force. 'inactive' cannot be shadowed by 'active' (different first
  // letter), and \b keeps the bare words matching.
  status:      [[/^active\b/i, 'ACTIVE'], [/^inactive\b/i, 'INACTIVE'], [/^future\b/i, 'FUTURE']],
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
  // Yes/No cells → booleans on boolean-shaped canonical fields. A BLANK cell states nothing,
  // so it stays undefined rather than folding to false — "the source did not say" and "the
  // source said No" are different facts, and the source enum below turns on the difference.
  for (const f of BOOLEANISH_FIELDS) {
    if (typeof data[f] === 'string') {
      const v = data[f].trim().toLowerCase()
      if (v === 'yes' || v === 'y' || v === 'true' || v === 'x') data[f] = true
      else if (v === 'no' || v === 'n' || v === 'false') data[f] = false
      else if (v === '') delete data[f]
    }
  }
  // Flag aliases fold into the canonical source enum — POSITIVE EVIDENCE ONLY. Deriving
  // BUREAU from proprietaryFlag===false inferred a filing provenance from a negation: a row
  // whose "Proprietary?" cell says No (or, before the blank handling above, is EMPTY) states
  // only that it is not proprietary — it does not name ISO/AAIS/NCCI as the filing bureau.
  // Absent positive evidence the field stays unset for a human to resolve.
  if (data.source === undefined) {
    if (data.proprietaryFlag === true) data.source = 'PROPRIETARY'
    else if (data.bureauFlag === true) data.source = 'BUREAU'
    else if (data.proprietaryFlag === false) data.sourceUnknownReason = 'row states it is not proprietary but names no bureau'
  }
  delete data.proprietaryFlag
  delete data.bureauFlag
  // Form numbers as arrays, always.
  if (typeof data.formNumbers === 'string') {
    data.formNumbers = data.formNumbers.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)
  }
}

// Yes/No/X cell → boolean (mirrors foldEnums' BOOLEANISH handling for a raw value).
function booleanish(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'yes' || s === 'y' || s === 'true' || s === 'x'
  }
  return false
}

// Dynamic-field data type fold: the canonical model stores TEXT | CURRENCY | DATE |
// LIST | PERCENT; Number / Alphanumeric / Address and anything unrecognized fold onto
// TEXT (canonicalMap dynamicField.dataType contract). Citations keep the verbatim byte.
const DF_TYPE_FOLD = [
  [/^date/i, 'DATE'],
  [/^(currency|money|dollar|amount|\$)/i, 'CURRENCY'],
  [/^(percent|percentage|pct|%)/i, 'PERCENT'],
  [/^(list|enum|dropdown|drop-down|select|option|picklist|choice)/i, 'LIST'],
]
function foldDynamicFieldType(v) {
  if (typeof v !== 'string' || !v.trim()) return 'TEXT'
  const s = v.trim()
  for (const [re, canonical] of DF_TYPE_FOLD) if (re.test(s)) return canonical
  return 'TEXT'
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
  // A PLACEHOLDER cell states NOTHING — drop it rather than carry it as a value. PCM
  // workbooks fill the inapplicable level of the hierarchy with a literal sentinel
  // ("<Intentionally Blank>", "N/A"), so a parent coverage row's SUB-COVERAGE cell is the
  // sentinel by design. Keeping it made every parent import named "<Intentionally Blank>"
  // (and surface that way anywhere a coverage is referenced, e.g. a form's "Where used").
  // The deterministic mapper has always blanked these; this is the same predicate.
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && isPlaceholder(v.trim())) delete data[k]
  }
  // PCM sheets carry separate product / coverage / sub-coverage name columns per
  // row; the entity's OWN name is the most specific one present (canonicalMap's
  // coverageName/subCoverageName → name semantics). With the sentinel dropped above, a
  // parent row now correctly falls through subCoverageName to coverageName.
  const ownName = [data.subCoverageName, data.coverageName, data.name]
    .find(v => typeof v === 'string' && v.trim() !== '')
  if (ownName) data.name = ownName
  foldEnums(data)
  // Provenance summary mirrors the filing path's coverage shape (confidence + citation
  // live in data so the review UI can render them without a side lookup).
  data.confidence = entity.overallConfidence
  const refField = entity.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
  data.citation = citationString(refField?.citation) || citationString(entity.fields[0]?.citation)
  // CE3 Step 1: sheet provenance rides every planned entity (hidden-source stamping
  // and near-dup cluster folding key on it; the review UI can render it directly).
  if (entity.sourceSheet) data.sourceSheet = entity.sourceSheet
  Object.assign(data, extraData || {})
  return {
    docId: toDocId(refId, `${entity.kind}-${entity.sourceRowIndex}`),
    refId,
    label: (typeof data.name === 'string' && data.name.trim()) ? data.name : entityLabel(entity),
    data,
  }
}

// ─── Rating-step normalization (extracted field bag → canonical RatingStep) ───
// canonicalMap declares the rate reference as the DOTTED key 'source.ref', so an extracted
// step is a flat bag — `{'source.ref': 'RT.001', op: '*'}` — with NO nested `source` object.
// Handing that bag straight to the app as a RatingStep meant every consumer that reads
// `step.source.type` (shared/src/rating/gridInputs.ts, evaluator.ts, the Pricing screen)
// threw "Cannot read properties of undefined (reading 'type')" and white-screened the
// Pricing tab for every brain-imported product. The deterministic mapper has always built a
// well-formed source (isoImport parseRating); this brings the brain to the same contract.

/** Source cell operator → canonical op. Mirrors canonicalMap's documented mapping. */
function foldStepOp(raw) {
  const s = String(raw ?? '').trim().toUpperCase()
  if (s === 'SET' || s === 'MUL' || s === 'ADD' || s === 'MIN_FLOOR') return s
  if (s === '=' ) return 'SET'
  if (s === '*' || s === '/' || s === 'X') return 'MUL'
  if (s === '+' || s === '-') return 'ADD'
  return 'MUL'   // a rating step with no stated operator multiplies the running total
}

/**
 * Coerce one extracted step bag into a canonical RatingStep. NEVER invents a rate: when the
 * source names no table, the step becomes an INPUT keyed on its own label — the identical
 * fallback the deterministic mapper uses — and the gap is reported, not hidden.
 */
function normalizeRatingStep(data, index, planWarnings) {
  const order = Number.isFinite(data.order) ? Number(data.order) : index + 1
  const id    = [data.id, data.stepId, data.refId].find(v => typeof v === 'string' && v.trim() !== '')
    || `step-${order}`
  const label = [data.label, data.description, id].find(v => typeof v === 'string' && v.trim() !== '') || id

  // An already-canonical nested source (the ISO-mapper join path) is authoritative.
  let source = null
  if (data.source && typeof data.source === 'object' && typeof data.source.type === 'string') {
    source = data.source
  } else {
    const ref = [data['source.ref'], data.rateReference, data.reference]
      .find(v => typeof v === 'string' && v.trim() !== '')
    source = ref ? { type: 'RT', ref: ref.trim() } : { type: 'INPUT', ref: label }
    if (!ref && planWarnings) {
      planWarnings.push({
        kind: 'rating-step-source-unstated', sheet: null, row: null, field: 'source',
        detail: `Rating step "${label}" names no rate table; staged as an INPUT keyed on its own label. No rate was assumed — point it at a table before pricing depends on it.`,
      })
    }
  }

  const step = { id, order, label, op: foldStepOp(data.op), source }
  if (Number.isFinite(data.roundTo)) step.roundTo = Number(data.roundTo)
  if (typeof data.condition === 'string' && data.condition.trim() !== '') step.condition = data.condition
  if (typeof data.groupName === 'string' && data.groupName.trim() !== '') step.groupName = data.groupName
  // Keep the provenance the review UI renders; it rides alongside the canonical shape.
  if (data.citation) step.citation = data.citation
  if (data.confidence !== undefined) step.confidence = data.confidence
  if (typeof data.coverageRef === 'string' && data.coverageRef.trim() !== '') step.coverageRef = data.coverageRef
  return step
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

// Fields the deterministic mapper genuinely ESTABLISHES from the source structure — it is the
// canonical oracle for these and its value wins outright.
const ISO_ORACLE_FIELDS = ['refId', 'parentId', 'order', 'terms']
// Fields the mapper merely STAMPS as workflow defaults (same set stampDefaults writes below):
// importer-supplied review metadata carrying no citation. These must never overwrite a value
// the brain read and cited from the source — a hardcoded 'ACTIVE' clobbering a cited
// "Inactive - No Longer in Use", or an empty formNumbers:[] erasing cited endorsements, is
// absence beating evidence. The mapper's value is used only to GAP-FILL.
const ISO_STAMPED_FIELDS = ['formNumbers', 'allStates', 'states', 'status', 'lifecycle', 'reviewStatus', 'reviewer']
const ISO_IDENTITY_FIELDS = [...ISO_ORACLE_FIELDS, ...ISO_STAMPED_FIELDS]

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
    // The mapper is the identity ORACLE — its value wins outright.
    for (const f of ISO_ORACLE_FIELDS) {
      if (isoP.data[f] !== undefined) brainP.data[f] = isoP.data[f]
    }
    // ABSENCE NEVER BEATS A CITED VALUE. For fields the mapper only STAMPS, its uncited
    // default may fill a gap but must never overwrite what the brain read from the source.
    for (const f of ISO_STAMPED_FIELDS) {
      const iso = isoP.data[f]
      if (iso === undefined) continue
      const brain = brainP.data[f]
      if (Array.isArray(iso)) {
        // Arrays UNION: either side may legitimately hold form numbers the other missed, so
        // neither an empty mapper array nor a partial brain array may truncate the other.
        const brainArr = Array.isArray(brain) ? brain : []
        const union = [...brainArr]
        for (const v of iso) if (!union.some(x => String(x) === String(v))) union.push(v)
        brainP.data[f] = union
        continue
      }
      const brainHas = brain !== undefined && brain !== null && brain !== ''
      if (!brainHas) brainP.data[f] = iso            // gap-fill only
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

  // Leftovers. A formRule leftover whose refId already exists in the joined
  // plan is a ROW-SLICE of that entity (sources encode one form rule as N rows,
  // one per attached form; the mapper folds them, the brain extracts per row —
  // ledger F28): fold it — array fields union (a cited value is never dropped),
  // scalars gap-fill only (the joined identity wins). Appending it instead
  // creates same-refId near-duplicates whose refId-keyed persist upserts are
  // last-write-wins — silent attachment loss. Scoped to formRule: that is the
  // one kind whose row-slice shape the deterministic mapper itself folds; for
  // other kinds a same-refId duplicate stays warn-and-keep (a silent fold could
  // hide a genuine authoring conflict the duplicate-refId check surfaces).
  // Genuine no-counterpart leftovers: kept, flagged — never silently dropped.
  const outByRefId = new Map()
  for (const p of out) { if (p.refId && !outByRefId.has(p.refId)) outByRefId.set(p.refId, p) }
  let leftover = 0
  for (const brainP of brainQueue) {
    const host = kindLabel === 'formRule' && brainP.refId ? outByRefId.get(brainP.refId) : undefined
    if (host) {
      for (const [k, v] of Object.entries(brainP.data)) {
        if (k === 'confidence' || k === 'citation' || k === 'consensus' || k === 'needsReview') continue
        if (Array.isArray(v)) {
          const existing = Array.isArray(host.data[k]) ? host.data[k] : []
          const merged = [...existing]
          for (const item of v) { if (!merged.some(m => m === item || JSON.stringify(m) === JSON.stringify(item))) merged.push(item) }
          host.data[k] = merged
        } else if (host.data[k] === undefined && v !== undefined) {
          host.data[k] = v
        }
      }
      continue
    }
    brainP.data.needsReview = true
    out.push(brainP)
    leftover += 1
  }
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

  // ── CE3 Step 4: sweeper outputs are first-class plan citizens ────────────────
  // Residue the sweeper could not classify becomes census_unaccounted unresolved
  // items (sheet + refs + verbatim sample + reason) — never a silent loss.
  for (const item of (brainOutput.sweeper && brainOutput.sweeper.unresolvedItems) || []) {
    unresolved.push({
      section: 'census',
      kind: 'census_unaccounted',
      label: item.label,
      refId: null,
      sheet: item.sheet,
      refs: item.refs,
      verbatimSample: item.verbatimSample,
      reason: item.reason,
      citation: String(item.citation || ''),
    })
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
  if (ratingProgram && steps.length > 0) {
    ratingProgram.data.steps = steps.map((s, i) => normalizeRatingStep(s.data, i, planWarnings))
  }

  // Canonical workflow defaults every imported entity carries (identical to the
  // deterministic ISO mapper's conventions) — these are importer-stamped review
  // metadata, not extracted data, so they carry no citation.
  const stampDefaults = (p) => {
    // A source status the fold could NOT canonicalize is preserved under sourceStatus with
    // `status` deleted. Silently stamping ACTIVE there presents an unread lifecycle state as a
    // confirmed in-force one. GovernanceBlock.status is required, so a value must be written —
    // but it is marked ASSUMED and review-flagged, never passed off as extracted.
    if (p.data.status === undefined) {
      p.data.status = 'ACTIVE'
      if (typeof p.data.sourceStatus === 'string' && p.data.sourceStatus.trim() !== '') {
        p.data.statusAssumed = true
        p.data.needsReview = true
      }
    }
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

  // ── CE3 Step 4: sweeper FACT proposals join the plan review-flagged ──────────
  // Each carries the VERBATIM source text + the citing cell; refId stays null (a
  // model can nominate a cell, never mint an id — SYNTH minting is the accepted
  // entities' deterministic pass, not the sweeper's).
  {
    const groupOf = { coverage: coverages, form: forms, rule: rules, formRule: formRules, ldTable: ldTables, rtTable: rtTables }
    for (const f of (brainOutput.sweeper && brainOutput.sweeper.facts) || []) {
      const group = groupOf[f.entityKind]
      if (!group) continue // product/ratingStep proposals stay review items only
      group.push({
        docId: toDocId(null, `sweeper-${f.sheet}-${String(f.ref).replace(/[^A-Za-z0-9]/g, '-')}`),
        refId: null,
        label: String(f.name),
        data: {
          name: String(f.name),
          citation: String(f.ref),
          sourceSheet: f.sheet,
          needsReview: true,
          sweeperFact: true,
          confidence: 0.5,
        },
      })
    }
  }

  // ── CE3 Step 1: hidden-sheet provenance stamping ─────────────────────────────
  // Hidden sheets now ENTER extraction (policy flip); every entity they yielded is
  // stamped so the review UI warns on provenance before anything persists.
  {
    const hiddenSet = new Set(opts.hiddenSheets || [])
    if (hiddenSet.size > 0) {
      for (const group of [coverages, forms, rules, formRules, ldTables, rtTables]) {
        for (const p of group) {
          if (typeof p.data.sourceSheet === 'string' && hiddenSet.has(p.data.sourceSheet)) {
            p.data.hiddenSource = true
            p.data.needsReview = true
          }
        }
      }
      if (productPlanned && typeof productPlanned.data.sourceSheet === 'string' && hiddenSet.has(productPlanned.data.sourceSheet)) {
        productPlanned.data.hiddenSource = true
      }
    }
  }

  // ── CE3 Step 1: near-dup sheet cluster fold ─────────────────────────────────
  // Every cluster member was extracted (never a silent authority pick). Byte-identical
  // facts across a cluster fold to one entity (citations merged); CONFLICTING copies
  // stay in the plan review-flagged AND become unresolved items carrying the cluster
  // evidence, so a human picks the authority.
  {
    const clusters = Array.isArray(opts.sheetClusters) ? opts.sheetClusters : []
    if (clusters.length > 0) {
      const clusterOf = new Map()
      clusters.forEach((c, i) => (c.sheets || []).forEach(s => clusterOf.set(s.name, i)))
      const factBag = (p) => JSON.stringify(
        Object.entries(p.data)
          .filter(([k, v]) => !['citation', 'confidence', 'sourceSheet', 'clusterCitations', 'needsReview', 'hiddenSource'].includes(k) && (typeof v !== 'object' || Array.isArray(v)))
          .sort(([a], [b]) => (a < b ? -1 : 1)))
      let foldedTotal = 0
      let conflictTotal = 0
      const foldGroup = (group, section) => {
        const seen = new Map() // clusterIdx|identity -> { p, bag }
        const kept = []
        for (const p of group) {
          const sheet = typeof p.data.sourceSheet === 'string' ? p.data.sourceSheet : null
          const clusterIdx = sheet !== null ? clusterOf.get(sheet) : undefined
          if (clusterIdx === undefined) { kept.push(p); continue }
          const identity = `${clusterIdx}|${(p.refId || String(p.data.name || p.label)).toLowerCase()}`
          const prior = seen.get(identity)
          if (!prior) { seen.set(identity, { p, bag: factBag(p) }); kept.push(p); continue }
          if (factBag(p) === prior.bag) {
            // Byte-identical fact from a sibling copy — fold, keep the citation trail.
            const trail = Array.isArray(prior.p.data.clusterCitations) ? prior.p.data.clusterCitations : (prior.p.data.clusterCitations = [])
            if (p.data.citation) trail.push(String(p.data.citation))
            foldedTotal++
            continue
          }
          // Conflicting copy: keep it (review-flagged) + a first-class review item.
          p.data.needsReview = true
          p.data.clusterConflict = true
          kept.push(p)
          unresolved.push({
            section,
            label: p.label,
            refId: p.refId,
            reason: `near-duplicate sheet cluster carries a CONFLICTING copy of this ${section} (cluster: ${(clusters[clusterIdx].sheets || []).map(s => s.name).join(' / ')}) — pick the authoritative row.`,
            citation: String(p.data.citation || ''),
          })
          conflictTotal++
        }
        return kept
      }
      coverages = foldGroup(coverages, 'coverage')
      forms     = foldGroup(forms, 'form')
      rules     = foldGroup(rules, 'rule')
      formRules = foldGroup(formRules, 'formRule')
      ldTables  = foldGroup(ldTables, 'ldTable')
      rtTables  = foldGroup(rtTables, 'rtTable')
      if (foldedTotal > 0 || conflictTotal > 0) {
        planWarnings.push({ kind: 'dup-cluster-fold', sheet: null, row: null, field: null, detail: `Near-duplicate sheet clusters: ${foldedTotal} byte-identical fact(s) folded (citations merged), ${conflictTotal} conflicting cop(ies) held for review.` })
      }
    }
  }

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

  // ── Dynamic-field 1:many join (Forms Dynamic Data → Form.dynamicFields[]) ────
  // Each dynamicField entity carries a formNumber (canonicalMap: role source, mapsTo
  // form.number). Fold those rows into their parent form's dynamicFields[] so a form's
  // fillable fields travel WITH the form (the canonical Form.dynamicFields shape) instead
  // of floating as orphan rows. Matching uses the same case/punctuation-insensitive key
  // as the ISO join (F11), so "CG 01 13" ≡ "CG-01-13". A form that gains fields is, by
  // definition, dynamic. Rows whose formNumber matches no form in this plan — or that
  // carry no field name — are surfaced for review (flag-not-invent), never silently
  // dropped; their per-field citations remain in provenance.
  {
    const dynamicFieldEntities = byKind('dynamicField')
    // Canonical shape: every form carries a dynamicFields[] array (defaulted empty).
    for (const f of forms) if (!Array.isArray(f.data.dynamicFields)) f.data.dynamicFields = []

    if (dynamicFieldEntities.length > 0) {
      const formByNum = new Map()
      for (const f of forms) {
        const key = nameKey(f.data.number ?? f.refId)
        if (key) formByNum.set(key, f)
      }
      let attached = 0
      let skippedNoName = 0
      const unmatched = new Map()

      for (const e of dynamicFieldEntities) {
        const rawName = fieldValue(e, 'name')
        if (typeof rawName !== 'string' || !rawName.trim()) { skippedNoName++; continue }

        const df = {
          name:      rawName.trim(),
          dataType:  foldDynamicFieldType(fieldValue(e, 'dataType')),
          repeating: booleanish(fieldValue(e, 'repeating')),
        }
        const options = fieldValue(e, 'options')
        if (Array.isArray(options)) {
          const o = options.map(v => String(v).trim()).filter(Boolean)
          if (o.length) df.options = o
        } else if (typeof options === 'string' && options.trim()) {
          const o = options.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)
          if (o.length) df.options = o
        }
        const notes = fieldValue(e, 'notes'); if (typeof notes === 'string' && notes.trim()) df.notes = notes.trim()
        const eff = fieldValue(e, 'effectiveDate'); if (typeof eff === 'string' && eff.trim()) df.effectiveDate = eff.trim()
        const exp = fieldValue(e, 'expirationDate'); if (typeof exp === 'string' && exp.trim()) df.expirationDate = exp.trim()

        const formNum = fieldValue(e, 'formNumber')
        const host = formByNum.get(nameKey(formNum))
        if (host) {
          host.data.dynamicFields.push(df)
          host.data.dynamic = true   // a form carrying fillable fields IS dynamic
          attached++
        } else {
          const label = (typeof formNum === 'string' && formNum.trim()) ? formNum.trim() : '(no form number)'
          unmatched.set(label, (unmatched.get(label) ?? 0) + 1)
        }
      }

      if (attached > 0) {
        const formsWithFields = forms.filter(f => f.data.dynamicFields.length > 0).length
        importWarnings.push({ kind: 'dynamic-fields-attached', sheet: null, row: null, field: null, detail: `${attached} dynamic-field row(s) attached to ${formsWithFields} form(s) as Form.dynamicFields.` })
      }
      if (unmatched.size > 0) {
        const total = [...unmatched.values()].reduce((a, b) => a + b, 0)
        const list = [...unmatched.keys()].slice(0, 12).join(', ')
        importWarnings.push({ kind: 'dynamic-fields-unmatched', sheet: null, row: null, field: null, detail: `${total} dynamic-field row(s) reference form number(s) not in this plan (${list}${unmatched.size > 12 ? ', …' : ''}) — surfaced in provenance, not attached.` })
      }
      if (skippedNoName > 0) {
        importWarnings.push({ kind: 'dynamic-fields-unnamed', sheet: null, row: null, field: null, detail: `${skippedNoName} dynamic-field row(s) had no field name — surfaced in provenance, not attached.` })
      }
    }
  }

  // ── Plan integrity (first principles: relationships are first-class; the
  // Framework ID is the linkage key across all pillars) ───────────────────────
  {
    // 1. Duplicate refIds within a group → keep the first, flag the rest (a
    //    duplicate create would fail or silently overwrite at persist time).
    for (const [label, group] of [['coverage', coverages], ['form', forms], ['rule', rules], ['formRule', formRules], ['ldTable', ldTables], ['rtTable', rtTables]]) {
      const seen = new Map()
      for (const p of group) {
        if (!p.refId) continue
        const n = seen.get(p.refId) ?? 0
        if (n > 0) {
          p.data.needsReview = true
          p.data.duplicateOf = p.refId
          // docId is derived from refId, so duplicates COLLIDED: the review UI keys exclusions
          // by docId (excluding one silently dropped both) and the server keys creates by it
          // (persisting both threw 409 and failed the whole chunk). Give each copy a distinct
          // docId so the reviewer can keep one, drop one, or keep both. refId is untouched —
          // it is load-bearing and byte-for-byte; only the storage key is disambiguated.
          p.docId = `${toDocId(p.refId)}--dup${n + 1}`
          importWarnings.push({ kind: 'duplicate-refId', sheet: null, row: null, field: label, detail: `Duplicate ${label} refId "${p.refId}" (${p.label}) — review which row is authoritative before persisting; this copy is staged as "${p.docId}" so it can be resolved independently.` })
        }
        seen.set(p.refId, n + 1)
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

    // 3b. Assumed status: a source workflow string the enum fold could not canonicalize left
    //    the lifecycle state unread. Each such entity was stamped ACTIVE (the schema requires a
    //    Status) and marked statusAssumed — report them together so a reviewer can confirm
    //    none of them is actually retired before they import as in-force.
    {
      const assumed = []
      for (const group of [coverages, forms, rules, formRules]) {
        for (const p of group) {
          if (p.data.statusAssumed === true) assumed.push(`${p.refId ?? p.label} ("${p.data.sourceStatus}")`)
        }
      }
      if (assumed.length > 0) {
        importWarnings.push({ kind: 'status-assumed', sheet: null, row: null, field: 'status', detail: `${assumed.length} entit(ies) carry a source status this importer could not map to ACTIVE/INACTIVE/FUTURE; each was stamped ACTIVE and flagged, NOT read from the source (${assumed.slice(0, 8).join('; ')}${assumed.length > 8 ? ', …' : ''}). Confirm none is retired.` })
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
  // A pillar means EXTRACTED content, not a nomination. Sweeper FACTs are unconfirmed cell
  // proposals (refId null, confidence 0.5, needsReview) that join the groups for review; one
  // of them flipping `framework` true made a forms-only upload look like it carried a product
  // backbone, so the review UI offered "mint a NEW product" instead of "attach to existing".
  const extracted = (group) => group.filter(p => p.data.sweeperFact !== true).length
  const pillars = {
    framework: extracted(coverages) > 0,
    forms:     extracted(forms) > 0,
    rules:     (extracted(rules) + extracted(formRules)) > 0,
    rating:    Boolean(ratingProgram) || extracted(rtTables) > 0 || extracted(ldTables) > 0 || stepsCount > 0,
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
      // Rate-table placeholders are an ISO-mapper concept (minted when a rating step names
      // a factor whose VALUES are absent from the source). The brain path surfaces missing
      // rates as warnings/unresolved instead, so it mints none — but the field is a required
      // part of the ImportPlan contract that importPlan() spreads, so it must be present
      // (an absent array crashes the client with "ratePlaceholders is not iterable").
      ratePlaceholders: [],
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

module.exports = { buildImportPlan, normalizeRatingStep }
