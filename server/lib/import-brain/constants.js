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

// ─── Runtime schema validation on model output (P0-7 / ledger F16) ─────────────
// A syntactically-parseable-but-malformed model response must never degrade to a
// silent null. parseWithRetry runs a call, validates via `parse` (which returns
// null for an unusable shape), and on failure emits STRUCTURED TELEMETRY (a review
// item) plus exactly ONE targeted retry of the same call. Transport-level failures
// (empty raw — ai-call.js already retried the network) are not retried again.

// Stop reasons that mean "output hit the token ceiling" — anthropic-style and
// openai-style respectively. Truncation is a DETECTABLE condition (ledger F10):
// retrying the identical prompt re-truncates identically, so parseWithRetry
// never burns its retry on it — callers with a recovery strategy (stage-4
// batch halving) pass onTruncation; everyone else gets named telemetry + null.
const TRUNCATED_STOP_REASONS = new Set(['max_tokens', 'length', 'model_context_window_exceeded'])

// Stop reasons that mean "the model declined to answer" — anthropic 'refusal'
// and the openai content-filter finish (callOpenAI also normalizes a non-empty
// message.refusal field to 'refusal'). A refusal is its own vote class: like
// truncation it never burns the retry (an identical retry re-refuses), but it
// is named in telemetry instead of falling through as an empty raw.
const REFUSAL_STOP_REASONS = new Set(['refusal', 'content_filter'])

// Per-family vote-participation counters on the budget (surfaced via
// brain:spend). A dual-family site whose OpenAI leg silently stops voting is
// otherwise indistinguishable from a healthy run — these counters make a
// degraded run measurable: participation = cast / attempted per family.
// 'retry' increments the retry counter only (the retry is not a new attempt).
function recordVote(budget, site, family, outcome) {
  if (!budget || !site || !family) return
  if (!budget.votes) budget.votes = {}
  const s = budget.votes[site] || (budget.votes[site] = {})
  const f = s[family] || (s[family] = { attempted: 0, cast: 0, truncated: 0, refused: 0, empty: 0, malformed: 0, retries: 0 })
  if (outcome === 'retry') { f.retries += 1; return }
  f.attempted += 1
  if (typeof f[outcome] === 'number') f[outcome] += 1
}

async function parseWithRetry({ call, parse, review, stage, sheetName, what, onTruncation, vote }) {
  const tally = (outcome) => { if (vote) recordVote(vote.budget, vote.site, vote.family, outcome) }
  let res
  try { res = await call() } catch { res = { raw: '' } }
  if (res && TRUNCATED_STOP_REASONS.has(res.stopReason)) {
    tally('truncated')
    if (typeof onTruncation === 'function') return onTruncation(res)
    if (Array.isArray(review)) review.push({ kind: 'truncated-model-output', sheetName, detail: `${stage}: ${what} — model output hit the token ceiling (${res.stopReason}); treated as a missing vote (an identical retry would re-truncate).` })
    return null
  }
  if (res && REFUSAL_STOP_REASONS.has(res.stopReason)) {
    tally('refused')
    if (Array.isArray(review)) review.push({ kind: 'refused-model-output', sheetName, detail: `${stage}: ${what} — model refused to answer (${res.stopReason}); treated as a missing vote (an identical retry would re-refuse).` })
    return null
  }
  let parsed = res && res.raw ? parse(res.raw) : null
  if (parsed != null) { tally('cast'); return parsed }
  if (!res || !res.raw) { tally('empty'); return null }
  // The raw head rides the telemetry: "malformed" with no evidence is
  // undiagnosable after the fact (the first instrumented Core run lost a map
  // chunk to a shape nobody could reconstruct).
  const rawHead = String(res.raw).replace(/\s+/g, ' ').slice(0, 160)
  if (Array.isArray(review)) review.push({ kind: 'malformed-model-output', sheetName, detail: `${stage}: ${what} — model returned unparseable/malformed output; retrying once. Raw head: "${rawHead}"` })
  tally('retry')
  // The retry must NEVER replay the bytes it is retrying: cache-wrapped thunks
  // honor bypassCache and go straight to the model (a fresh good result then
  // overwrites the entry). Plain thunks ignore the argument.
  try { res = await call({ bypassCache: true }) } catch { tally('malformed'); return null }
  parsed = res && res.raw ? parse(res.raw) : null
  if (parsed == null && Array.isArray(review)) review.push({ kind: 'malformed-model-output', sheetName, detail: `${stage}: ${what} — retry also malformed; treated as a missing vote (never silent). Raw head: "${String(res && res.raw || '').replace(/\s+/g, ' ').slice(0, 160)}"` })
  tally(parsed == null ? 'malformed' : 'cast')
  return parsed
}

// Shape guard for extraction payloads: keeps only entities with a numeric
// sourceRowIndex and fields shaped {fieldName: string}; malformed items are
// DROPPED AND COUNTED so the caller reports them instead of passing NaN/undefined
// downstream.
function sanitizeEntities(rawEntities) {
  const entities = []
  let dropped = 0
  for (const e of Array.isArray(rawEntities) ? rawEntities : []) {
    if (!e || typeof e !== 'object' || !Number.isFinite(Number(e.sourceRowIndex))) { dropped++; continue }
    const fields = []
    for (const f of Array.isArray(e.fields) ? e.fields : []) {
      if (!f || typeof f !== 'object' || typeof f.fieldName !== 'string' || f.fieldName === '') { dropped++; continue }
      fields.push(f)
    }
    entities.push({ ...e, sourceRowIndex: Number(e.sourceRowIndex), fields })
  }
  return { entities, dropped }
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

// ─── Bounded parallel map ──────────────────────────────────────────────────────
// Runs fn over items with at most `concurrency` in flight; results keep item order.
// Brain stages use this to overlap independent AI calls (per sheet / per batch)
// without stampeding the Foundry endpoints.

async function pMap(items, fn, concurrency) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: n }, worker))
  return results
}

module.exports = {
  pMap,
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
  parseWithRetry,
  recordVote,
  sanitizeEntities,
  TRUNCATED_STOP_REASONS,
  REFUSAL_STOP_REASONS,
}
