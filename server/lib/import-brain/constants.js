'use strict'
// server/lib/import-brain/constants.js — brain-stage constants inlined from
// functions/src/import/brain/types.ts. Kept here (not in brain-server-entry.ts)
// to avoid TypeScript-to-CJS coupling across workspaces.

// ─── Sheet domains ─────────────────────────────────────────────────────────────

const SHEET_DOMAINS = [
  'product-framework', 'forms', 'rating-roc', 'rules',
  'limits-deductibles', 'rate-tables', 'definitions', 'ignore',
]

// Entity kinds plausible for each domain — prunes the canonical dictionary
// sent to the model (smaller prompt = lower cost + less hallucination surface).
const DOMAIN_ENTITY_KINDS = {
  'product-framework':  ['product', 'coverage'],
  'forms':              ['form', 'dynamicField', 'formRule'],
  'rating-roc':         ['ratingProgram', 'ratingStep', 'rtTable'],
  'rules':              ['rule', 'formRule'],
  'limits-deductibles': ['ldTable', 'coverage'],
  'rate-tables':        ['rtTable', 'ratingStep'],
  'definitions':        [],
  'ignore':             [],
}

// ─── Confidence thresholds ─────────────────────────────────────────────────────

const CONFIDENCE_ACCEPT  = 0.85   // above → auto-accept both-model agreement
const CONFIDENCE_REVIEW  = 0.60   // below → always route to review queue
const CONFIDENCE_DISCARD = 0.40   // below → discard (too noisy to be useful)

// ─── Blank/TBD refId patterns ─────────────────────────────────────────────────

const BLANK_REFID = /^(tbd|n\/a|na|blank|—|–|-|\?+|x+)$/i

// ─── Multi-refId splitter ──────────────────────────────────────────────────────
// Splits "GL.COV.002 GL.COV.003" → ["GL.COV.002", "GL.COV.003"].
// Handles all line-style refId schemes: GL, IM, PR, HO (2-4 segment).

const REFID_TOKEN = /[A-Z]{1,4}(?:\.[A-Z0-9]+){2,}/i

function splitMultiRefId(raw) {
  const tokens = raw.match(new RegExp(REFID_TOKEN.source, 'gi'))
  return (tokens && tokens.length > 1) ? tokens : [raw.trim()]
}

// ─── JSON parse helper ─────────────────────────────────────────────────────────
// Extracts JSON from a model response that may include markdown fences or prose.

function extractJson(raw) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const text = fenced ? fenced[1] : raw.trim()
  return JSON.parse(text)
}

// ─── Column letter helper ──────────────────────────────────────────────────────
// Convert 0-based column index to Excel column letter(s): 0→A, 25→Z, 26→AA.

function colLetter(idx) {
  let result = ''
  let n = idx
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}

module.exports = {
  SHEET_DOMAINS,
  DOMAIN_ENTITY_KINDS,
  CONFIDENCE_ACCEPT,
  CONFIDENCE_REVIEW,
  CONFIDENCE_DISCARD,
  BLANK_REFID,
  REFID_TOKEN,
  splitMultiRefId,
  extractJson,
  colLetter,
}
